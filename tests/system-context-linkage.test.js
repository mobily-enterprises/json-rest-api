import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin, RowPolicyPlugin, createSystemContext } from '../index.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'

// A response's to-one links are read for visibility, one read per linked type.
// A system context needs no read for a link that a declared foreign key protects,
// to a table resource without a row policy or a filtering hook of the app's own.
describe('Linkage reads in a system context', { skip: storageMode.isAnyApi() && 'table storage only' }, () => {
  let database
  let api
  const hookCalls = []
  before(async () => {
    database = await createTestDatabase()
    api = new JsonRestApi({ name: 'system-linkage-api' })
    await api.use(RestApiPlugin)
    await api.use(RestApiKnexPlugin, { knex: database.knex })
    await api.use(RowPolicyPlugin, {
      policies: {
        // Hides archived rows from every context, system contexts included.
        notArchived: ({ query, column }) => { query.where(column('archived'), false); return true }
      }
    })
    await api.addResource('sl_owners', { schema: { id: { type: 'id' }, name: { type: 'string', max: 40 } } })
    await api.addResource('sl_secrets', {
      schema: { id: { type: 'id' }, name: { type: 'string', max: 40 }, archived: { type: 'boolean', defaultTo: false } },
      rowPolicy: 'notArchived'
    })
    await api.addResource('sl_hooked', {
      schema: { id: { type: 'id' }, name: { type: 'string', max: 40 } },
      hooks: {
        knexQueryFiltering: {
          functionName: 'sl-hooked-filter',
          handler: ({ context }) => { if (context.knexQuery?.queryPurpose === 'relationship-identifiers') hookCalls.push('sl_hooked') }
        }
      }
    })
    // A link whose column a declared foreign key protects.
    const link = (target, as) => ({ type: 'id', nullable: true, belongsTo: target, as, references: { table: target } })
    await api.addResource('sl_things', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', max: 40 },
        owner_id: link('sl_owners', 'owner'),
        loose_owner_id: { type: 'id', nullable: true, belongsTo: 'sl_owners', as: 'loose_owner' },
        secret_id: link('sl_secrets', 'secret'),
        hooked_id: link('sl_hooked', 'hooked')
      }
    })
    for (const name of ['sl_owners', 'sl_secrets', 'sl_hooked', 'sl_things']) await api.resources[name].createKnexTable()
    await database.knex('sl_owners').insert([{ id: 1, name: 'one' }])
    await database.knex('sl_secrets').insert([{ id: 1, name: 'kept', archived: false }, { id: 2, name: 'archived', archived: true }])
    await database.knex('sl_hooked').insert([{ id: 1, name: 'hooked' }])
    // loose_owner_id has no foreign key, so it can point at a row that is gone.
    await database.knex('sl_things').insert([
      { id: 1, title: 'first', owner_id: 1, loose_owner_id: 1, secret_id: 1, hooked_id: 1 },
      { id: 2, title: 'second', owner_id: 1, loose_owner_id: 99, secret_id: 2, hooked_id: null }
    ])
  })
  after(async () => { await database?.close() })

  const statementsOf = async run => {
    let statements = 0
    const count = () => { statements++ }
    database.knex.on('query', count)
    try {
      return { result: await run(), statements }
    } finally {
      database.knex.off('query', count)
    }
  }
  const links = document => [document.data].flat().map(resource => Object.fromEntries(
    Object.entries(resource.relationships).map(([name, relationship]) => [name, relationship.data?.id ?? null])))
  const read = (fields, context) => statementsOf(() => api.resources.sl_things.query({ format: 'jsonapi', queryParams: { fields: { sl_things: fields }, sort: ['id'] } }, context))

  it('reads no link that a foreign key protects, with the same response', async () => {
    const user = await read('title,owner', {})
    const system = await read('title,owner', createSystemContext('linkage test'))
    assert.deepEqual(links(system.result), links(user.result))
    assert.deepEqual(links(system.result), [{ owner: '1' }, { owner: '1' }])
    // SQLite enforces foreign keys only on connections that turn them on, so it still reads.
    assert.equal(system.statements, databaseClient === 'better-sqlite3' ? user.statements : user.statements - 1)
  })

  it('still reads a link without a foreign key, and clears one whose row is gone', async () => {
    const user = await read('title,loose_owner', {})
    const system = await read('title,loose_owner', createSystemContext('linkage test'))
    assert.deepEqual(links(system.result), [{ loose_owner: '1' }, { loose_owner: null }])
    assert.equal(system.statements, user.statements)
  })

  it('still reads a link to a resource with a row policy or a filtering hook of its own', async () => {
    const system = await read('title,secret', createSystemContext('linkage test'))
    assert.deepEqual(links(system.result), [{ secret: '1' }, { secret: null }])
    hookCalls.length = 0
    const hooked = await read('title,hooked', createSystemContext('linkage test'))
    assert.deepEqual(links(hooked.result), [{ hooked: '1' }, { hooked: null }])
    assert.deepEqual(hookCalls, ['sl_hooked'])
  })

  it('reads the links of a get the same way', async () => {
    const get = context => statementsOf(() => api.resources.sl_things.get({ id: '1', format: 'jsonapi', queryParams: { fields: { sl_things: 'title,owner' } } }, context))
    const user = await get({})
    const system = await get(createSystemContext('linkage test'))
    assert.deepEqual(links(system.result), [{ owner: '1' }])
    assert.equal(system.statements, databaseClient === 'better-sqlite3' ? user.statements : user.statements - 1)
  })
})
