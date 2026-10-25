import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import express from 'express'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { createJsonApiDocument, createRelationship, resourceIdentifier } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { AnyapiRegistry } from '../plugins/core/lib/anyapi/anyapi-registry.js'
import { ensureAnyApiSchema } from '../plugins/core/lib/anyapi/schema-utils.js'

const tenant = 'field_evolution'
const note = { type: 'string', nullable: true, search: true }

// Each case owns a database: these tests are about what several servers
// sharing one set of metadata rows see.
function syncCase (name, run, databaseOptions) {
  describe(`AnyAPI schema sync (${databaseClient}): ${name}`, () => {
    let database
    before(async () => { database = await createTestDatabase(undefined, databaseOptions) })
    after(async () => {
      try { await database?.close() } finally { if (database) storageMode.clearRegistry(database.knex) }
    })
    it(name, async () => run(database.knex))
  })
}

const server = (knex, options = {}) => createAnyApiFieldEvolutionApi(knex, options)
const slotsOf = async (knex, resource = 'items') => {
  const config = await knex('any_resource_configs').where({ tenant_id: tenant, resource }).first()
  return Object.fromEntries((await knex('any_field_configs').where({ resource_config_id: config.id })).map(row => [row.field_name, row.slot_column]))
}
const versionOf = async (knex, resource = 'items') => Number((await knex('any_resource_configs').where({ tenant_id: tenant, resource }).first()).schema_version)
const post = (api, attributes) => api.resources.items.post({ document: createJsonApiDocument('items', attributes) })
const countQueries = async (knex, pattern, run) => {
  let count = 0
  const listener = ({ sql }) => { if (pattern.test(sql)) count++ }
  knex.on('query', listener)
  try { await run() } finally { knex.off('query', listener) }
  return count
}

syncCase('concurrent field additions never share a slot', async (knex) => {
  const api = await server(knex)
  const registry = api.anyapi.registry
  const other = new AnyapiRegistry({ knex })
  let allocated, release
  const firstAllocated = new Promise(resolve => { allocated = resolve })
  const released = new Promise(resolve => { release = resolve })
  let locks = 0
  let secondWaiting
  const waiting = new Promise(resolve => { secondWaiting = resolve })
  const listener = ({ sql }) => { if (/any_resource_configs.*for update/i.test(sql) && ++locks === 2) secondWaiting() }
  knex.on('query', listener)
  try {
    const first = api.transaction(async transaction => {
      await registry.allocateField({ tenant, resource: 'items', fieldName: 'first', definition: { type: 'string' } }, { transaction })
      allocated()
      await released
    })
    await firstAllocated
    // A separate registry and connection: the second server's view.
    const second = other.allocateField({ tenant, resource: 'items', fieldName: 'second', definition: { type: 'string' } })
    await Promise.race([second.catch(() => {}), waiting])
    release()
    const results = await Promise.allSettled([first, second])
    assert.equal(results[0].status, 'fulfilled')
    if (results[1].status === 'rejected') {
      // SQLite refuses the second writer instead of queueing it.
      assert.equal(databaseClient, 'better-sqlite3')
      assert.match(String(results[1].reason?.cause?.code || results[1].reason?.code), /SQLITE_BUSY/)
    }
  } finally {
    knex.off('query', listener)
  }
  const slots = await slotsOf(knex)
  assert.equal(new Set(Object.values(slots)).size, Object.keys(slots).length, `Shared slot in ${JSON.stringify(slots)}`)
  assert.equal(await versionOf(knex), 1 + Object.keys(slots).filter(name => ['first', 'second'].includes(name)).length)
}, { concurrent: true, maxConnections: 4 })

syncCase('the metadata tables refuse two fields in one slot', async (knex) => {
  await server(knex)
  const config = await knex('any_resource_configs').where({ tenant_id: tenant, resource: 'items' }).first()
  await assert.rejects(knex('any_field_configs').insert({
    resource_config_id: config.id, field_name: 'copy', slot_type: 'string', slot_index: 1, slot_column: 'string_1'
  }), /unique|duplicate/i)
})

syncCase('an upgrade refuses metadata whose fields already share a slot', async (knex) => {
  await server(knex)
  await knex.schema.alterTable('any_field_configs', table => table.dropUnique(['resource_config_id', 'slot_column'], 'any_field_configs_resource_slot_unique'))
  const config = await knex('any_resource_configs').where({ tenant_id: tenant, resource: 'items' }).first()
  await knex('any_field_configs').insert({ resource_config_id: config.id, field_name: 'copy', slot_type: 'string', slot_index: 1, slot_column: 'string_1' })
  await assert.rejects(ensureAnyApiSchema(knex), /slot metadata repair required.*string_1/)
})

for (const populated of [false, true]) {
  syncCase(`a server with the older declaration keeps runtime fields (${populated ? 'populated' : 'empty'})`, async (knex) => {
    const first = await server(knex)
    await first.resources.items.addKnexFields({
      fields: { note },
      searchSchema: { noteContains: { type: 'string', actualField: 'note', filterOperator: 'contains' } }
    })
    const slots = await slotsOf(knex)
    if (populated) await post(first, { name: 'Stored', note: 'kept value' })

    // Before the fix, this registration deleted note's mapping, or refused to boot once records existed.
    const restarted = await server(knex)
    assert.deepEqual(await slotsOf(knex), slots)
    const created = await post(restarted, { name: 'After restart', note: 'new value' })
    assert.equal(created.data.attributes.note, 'new value')
    const found = await restarted.resources.items.query({ queryParams: { filters: { noteContains: 'value' } } })
    assert.equal(found.data.length, populated ? 2 : 1)
  })
}

syncCase('runtime fields whose callbacks no code supplies are hidden, not served without them', async (knex) => {
  const first = await server(knex)
  const serialize = value => value == null ? null : `stored:${value}`
  await first.resources.items.addKnexFields({ fields: { coded: { type: 'string', nullable: true, storage: { serialize } } } })
  const created = await post(first, { name: 'Value', coded: 'secret' })
  const slots = await slotsOf(knex)

  const warnings = []
  const restarted = await server(knex, { logger: { warn: (...args) => warnings.push(args) } })
  assert.match(String(warnings[0]?.[0]), /hides stored fields/)
  const read = await restarted.resources.items.get({ id: created.data.id })
  assert.equal(Object.hasOwn(read.data.attributes, 'coded'), false)
  await assert.rejects(post(restarted, { name: 'Other', coded: 'plain' }), /validation failed/)
  assert.deepEqual(await slotsOf(knex), slots)

  const declared = await server(knex, { fields: { coded: { type: 'string', nullable: true, storage: { serialize } } } })
  assert.equal((await declared.resources.items.get({ id: created.data.id })).data.attributes.coded, 'stored:secret')
})

syncCase('another server reloads a runtime field with its search schema', async (knex) => {
  const changes = []
  const first = await server(knex, { pluginOptions: { onSchemaChanged: change => changes.push(change) } })
  assert.deepEqual(changes.map(change => [change.resource, change.version]), [['groups', 1], ['items', 1]])
  changes.length = 0
  const second = await server(knex, { pluginOptions: { onSchemaChanged: change => changes.push(change) } })
  assert.deepEqual(changes, [], 'Repeating an unchanged declaration changes nothing')
  const version = await versionOf(knex)
  assert.equal(version, 1)

  await first.resources.items.addKnexFields({
    fields: { note },
    searchSchema: { noteContains: { type: 'string', actualField: 'note', filterOperator: 'contains' } }
  })
  assert.deepEqual(changes, [{ tenant, resource: 'items', version: version + 1 }])
  await assert.rejects(post(second, { name: 'Stale', note: 'value' }))

  assert.equal(await second.anyapi.handleSchemaChange(changes[0]), true)
  assert.equal(await second.anyapi.handleSchemaChange(changes[0]), false)
  assert.equal(await second.anyapi.handleSchemaChange({ ...changes[0], tenant: 'other' }), false)
  assert.equal(second.resources.items.vars.schemaInfo.descriptor.schemaVersion, version + 1)
  const created = await post(second, { name: 'Fresh', note: 'value' })
  assert.equal(created.data.attributes.note, 'value')
  const found = await second.resources.items.query({ queryParams: { filters: { noteContains: 'alu' } } })
  assert.deepEqual(found.data.map(row => row.id), [created.data.id])

  await assert.rejects(first.resources.items.addKnexFields({ fields: { name: { type: 'string' } } }), /already exists/)
  assert.equal(changes.length, 1, 'A rejected addition is not announced')
  assert.equal(await versionOf(knex), version + 1)
})

syncCase('each server keeps the fields the other added', async (knex) => {
  const first = await server(knex)
  const second = await server(knex)
  await first.resources.items.addKnexFields({ fields: { fromFirst: note } })
  await second.resources.items.addKnexFields({ fields: { fromSecond: note } })
  const created = await post(second, { name: 'Both', fromFirst: 'one', fromSecond: 'two' })
  assert.deepEqual([created.data.attributes.fromFirst, created.data.attributes.fromSecond], ['one', 'two'])
  await first.resources.items.reloadSchema()
  assert.equal((await first.resources.items.get({ id: created.data.id })).data.attributes.fromSecond, 'two')
})

syncCase('schema checks pick up changes without notifications', async (knex) => {
  const first = await server(knex)
  const eager = await server(knex, { pluginOptions: { schemaCheckInterval: 0 } })
  const lazy = await server(knex, { pluginOptions: { schemaCheckInterval: 60000 } })
  const checks = await countQueries(knex, /schema_version/, () => eager.resources.items.query())
  assert.equal(checks, 1)
  assert.equal(await countQueries(knex, /schema_version/, () => lazy.resources.items.query()), 0)

  await first.resources.items.addKnexFields({ fields: { note } })
  assert.equal((await post(eager, { name: 'Eager', note: 'checked' })).data.attributes.note, 'checked')
  // The interval has not elapsed; the rejected write itself triggers the check and one retry.
  assert.equal((await post(lazy, { name: 'Lazy', note: 'retried' })).data.attributes.note, 'retried')

  await first.resources.items.addKnexFields({ fields: { other: note } })
  await assert.rejects(lazy.transaction(async transaction => lazy.resources.items.post({
    document: createJsonApiDocument('items', { name: 'Inside', other: 'value' }), transaction
  })), 'A caller transaction never reloads from metadata it may not have committed')
})

syncCase('a server with no declarations loads stored resources on demand', async (knex) => {
  const first = await server(knex, {
    fields: { groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true } }
  })
  await first.resources.items.addKnexFields({ fields: { note } })
  const group = await first.resources.groups.post({ document: createJsonApiDocument('groups', { name: 'Group' }) })
  const item = await first.resources.items.post({
    document: createJsonApiDocument('items', { name: 'Item', note: 'runtime' }, { group: createRelationship(resourceIdentifier('groups', group.data.id)) })
  })

  const empty = await server(knex, { declare: false })
  assert.equal(await empty.anyapi.loadResource('missing'), null)
  const items = await empty.anyapi.loadResource('items')
  assert.equal(items, empty.resources.items)
  assert.ok(empty.resources.groups, 'belongsTo targets load with the resource')
  const read = await items.get({ id: item.data.id, queryParams: { include: ['group'] } })
  assert.equal(read.data.attributes.note, 'runtime')
  assert.equal(read.included[0].attributes.name, 'Group')
  assert.equal(await empty.anyapi.loadResource('items'), items)

  const all = await server(knex, { declare: false })
  await all.anyapi.loadResources()
  assert.deepEqual(Object.keys(all.resources).sort(), ['groups', 'items'])
  const before = await slotsOf(knex)
  await all.resources.items.addKnexFields({ fields: { later: note } })
  assert.deepEqual({ ...await slotsOf(knex), later: undefined }, { ...before, later: undefined })
})

syncCase('middleware loads a stored resource before the API router handles it', async (knex) => {
  const first = await server(knex)
  const item = await post(first, { name: 'Over HTTP' })
  const api = await server(knex, { declare: false, includeExpress: true })
  const app = express()
  app.use('/api/:resource', (req, res, next) => api.anyapi.loadResource(req.params.resource).then(() => next(), next))
  api.http.express.mount(app)
  const httpServer = createServer(app)
  httpServer.listen(0)
  await once(httpServer, 'listening')
  try {
    const base = `http://127.0.0.1:${httpServer.address().port}/api`
    const response = await fetch(`${base}/items/${item.data.id}`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.attributes.name, 'Over HTTP')
    assert.equal((await fetch(`${base}/missing`)).status, 404)
  } finally {
    httpServer.close()
    await once(httpServer, 'close')
  }
})

syncCase('stored resources whose options need code are not loaded from storage', async (knex) => {
  await server(knex, { declare: false, codeOnlyResource: true })
  const empty = await server(knex, { declare: false })
  await assert.rejects(empty.anyapi.loadResource('scored'), /normalizeId.*declare the resource in code/)
  assert.equal(Object.hasOwn(empty.resources, 'scored'), false)
})

syncCase('tenant instances share one registry and leave the shared connection open', async (knex) => {
  const registry = new AnyapiRegistry({ knex, cacheSize: 2 })
  const first = await server(knex, { tenantId: 'tenant_a', pluginOptions: { registry, ownsKnex: false } })
  assert.equal(first.anyapi.registry, registry)
  const queries = await countQueries(knex, /./, () => server(knex, {
    tenantId: 'tenant_b', declare: false, pluginOptions: { registry, ensureSchema: false, ownsKnex: false }
  }))
  assert.equal(queries, 0, 'A cheap instance repeats no start-up checks')

  const tenants = await Promise.all(['tenant_c', 'tenant_d', 'tenant_e'].map(tenantId => server(knex, {
    tenantId, pluginOptions: { registry, ensureSchema: false, ownsKnex: false }
  })))
  assert.ok(registry.cache.size <= 2)
  const ddl = await countQueries(knex, /create table|alter table|create unique index/i, () => tenants[0].resources.items.createKnexTable())
  assert.equal(ddl, 0)

  await first.release()
  assert.equal((await tenants[1].resources.items.query()).data.length, 0, 'Releasing one tenant API leaves the shared connection open')
  await assert.rejects(server(knex, { pluginOptions: { registry: new AnyapiRegistry({ knex: { client: {} } }) } }), /same knex instance/)
})

syncCase('a migration raises slot limits for every server', async (knex) => {
  const api = await server(knex)
  const registry = api.anyapi.registry
  assert.equal((await registry.getSlotPools()).string.length, 10)
  const fields = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`text${index}`, { type: 'string', nullable: true }]))
  await api.resources.items.addKnexFields({ fields })
  await assert.rejects(api.resources.items.addKnexFields({ fields: { overflow: note } }), /No available string slots remaining/)

  await ensureAnyApiSchema(knex, { slots: { string: 12, belongsTo: 6 } })
  // This server read the layout before the migration and rereads it once exhausted.
  await api.resources.items.addKnexFields({ fields: { overflow: note } })
  assert.equal((await slotsOf(knex)).overflow, 'string_11')
  await api.anyapi.registry.allocateField({ tenant, resource: 'items', fieldName: 'pinned', definition: note, canonicalField: 'string_12' })
  const columns = Object.keys(await knex('any_records').columnInfo())
  assert.ok(columns.includes('rel_6_id') && columns.includes('rel_6_type'))

  await ensureAnyApiSchema(knex, { slots: { string: 2 } })
  assert.ok(Object.keys(await knex('any_records').columnInfo()).includes('string_12'), 'Lower counts never drop columns')
  await assert.rejects(ensureAnyApiSchema(knex, { slots: { string: 0 } }), /positive integer/)
  await assert.rejects(ensureAnyApiSchema(knex, { slots: { text: 3 } }), /Unknown AnyAPI slot pool/)
})
