import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import knexLib from 'knex'
import { JsonRestApi } from '../lib/runtime/json-rest-api.js'
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'
import { inListLimit } from '../plugins/core/lib/querying/in-lists.js'
import { useStoragePlugin } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'

// A port nothing listens on: bound, read and released.
async function closedPort () {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

const firstRow = result => databaseClient === 'pg' ? result.rows[0] : result[0][0]

describe(`Capabilities a start could not observe (${storageMode.mode})`, {
  skip: databaseClient.includes('sqlite') && 'SQLite opens a file: no server to start before'
}, () => {
  let database, knex, api, target, live
  const warnings = []
  const observations = []

  before(async () => {
    database = await createTestDatabase()
    live = { ...JSON.parse(process.env.JSON_REST_API_TEST_CONNECTION), database: database.name }
    // The runner's servers listen on sockets; the closed port is reached by TCP instead.
    target = { ...live, host: '127.0.0.1', port: await closedPort() }
    delete target.socketPath
    // The connection is read for every new connection, so the same Knex moves to the live server.
    knex = knexLib({ client: databaseClient, connection: () => ({ ...target, expirationChecker: () => true }), pool: { min: 0, max: 4 }, acquireConnectionTimeout: 5000 })
    knex.on('query', ({ sql }) => { if (/version\(\)/i.test(sql)) observations.push(sql) })
    api = new JsonRestApi({ name: 'provisional-capabilities', logger: { warn: (...args) => warnings.push(args) } })
    await api.use(RestApiPlugin, { format: 'jsonapi', returning: 'full' })
    await useStoragePlugin(api, knex, { pluginOptions: { ensureSchema: false } })
  })

  after(async () => {
    await knex?.destroy()
    await database?.close()
  })

  const addResources = async () => {
    await api.addResource('groups', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true } },
      relationships: { items: { type: 'hasMany', target: 'items', foreignKey: 'groupId', include: { strategy: 'window', limit: 1, orderBy: ['name'] } } },
      tableName: 'provisional_groups'
    })
    await api.addResource('items', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true }, groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true } },
      tableName: 'provisional_items'
    })
  }

  it('starts unknown, observes again on each call while the database is away, then settles on the server\'s', async () => {
    const { capabilities } = api.knex
    assert.equal(capabilities.dbInfo.version, 'unknown')
    assert.match(capabilities.dbInfo.error, /ECONNREFUSED/)
    assert.equal(capabilities.windowFunctions, databaseClient === 'pg')
    assert.equal(inListLimit(knex), Infinity)
    const failures = () => warnings.filter(args => JSON.stringify(args).includes('version-observation'))
    assert.equal(failures().length, 1)

    if (!api.anyapi) {
      // Table storage adds resources without the database: calls while it is away each
      // observe again, concurrent ones through one attempt whose failure is logged.
      await addResources()
      const away = await Promise.allSettled(Array.from({ length: 4 }, () => api.resources.groups.query({})))
      assert.deepEqual(away.map(outcome => outcome.status), ['rejected', 'rejected', 'rejected', 'rejected'])
      assert.equal(failures().length, 2)
      assert.match(JSON.stringify(failures()[1]), /ECONNREFUSED/)
      assert.equal(capabilities.dbInfo.version, 'unknown')
    }

    target = live
    if (api.anyapi) {
      await ensureAnyApiSchema(knex)
      await addResources()
    }
    await api.resources.groups.createKnexTable()
    await api.resources.items.createKnexTable()
    observations.length = 0

    const pages = await Promise.all(Array.from({ length: 4 }, () => api.resources.groups.query({})))
    assert.deepEqual(pages.map(page => page.data), [[], [], [], []])
    assert.equal(observations.length, 1, 'Concurrent calls share one observation')

    const server = firstRow(await database.knex.raw('SELECT VERSION() AS version'))
    assert.equal(capabilities.dbInfo.version, server.version)
    assert.equal('error' in capabilities.dbInfo, false)
    assert.equal(capabilities.windowFunctions, true)
    if (databaseClient !== 'pg') {
      const settings = firstRow(await database.knex.raw('SELECT @@max_allowed_packet AS packet'))
      assert.equal(capabilities.dbInfo.maxAllowedPacket, Number(settings.packet))
    }
    if (/mariadb/i.test(server.version)) {
      const { threshold } = firstRow(await database.knex.raw('SELECT @@in_predicate_conversion_threshold AS threshold'))
      assert.equal(capabilities.dbInfo.inPredicateConversionThreshold, Number(threshold))
      if (Number(threshold) > 0) assert.equal(inListLimit(knex), Number(threshold) - 1)
    }
    assert.equal(failures().length, api.anyapi ? 1 : 2)

    // Settled: a per-parent include limit runs, and no call observes again.
    const group = await api.resources.groups.post({ format: 'plain', data: { name: 'Group' } })
    for (const name of ['Beta', 'Alpha']) await api.resources.items.post({ format: 'plain', data: { name, group: group.id } })
    const result = await api.resources.groups.query({ queryParams: { include: ['items'] } })
    assert.deepEqual(result.included.map(item => item.attributes.name), ['Alpha'])
    assert.equal(observations.length, 1)
  })
})
