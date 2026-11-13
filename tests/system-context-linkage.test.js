import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AutoFilterPlugin, JsonRestApi, RestApiPlugin, RestApiKnexPlugin, RowPolicyPlugin, createSystemContext } from '../index.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'

// A response's to-one links are read for visibility, one read per linked type.
// A link that a declared foreign key protects needs no read when its target
// narrows nothing for the context: a table resource without a row policy or a
// filtering hook of the app's own and, outside a system context, without
// ownership. SQLite enforces foreign keys only on connections that turn them
// on, so there every link is read.
describe('Linkage reads of links a foreign key protects', { skip: storageMode.isAnyApi() && 'table storage only' }, () => {
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
    await api.use(AutoFilterPlugin, {
      resolvers: { team: ({ context }) => context.scopeValues?.teamId },
      presets: { team: { filters: [{ field: 'team_id', resolver: 'team' }] } }
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
    await api.addResource('sl_teamed', {
      schema: { id: { type: 'id' }, name: { type: 'string', max: 40 }, team_id: { type: 'string', max: 20 } },
      autofilter: 'team'
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
        hooked_id: link('sl_hooked', 'hooked'),
        teamed_id: link('sl_teamed', 'teamed')
      }
    })
    for (const name of ['sl_owners', 'sl_secrets', 'sl_hooked', 'sl_teamed', 'sl_things']) await api.resources[name].createKnexTable()
    await database.knex('sl_owners').insert([{ id: 1, name: 'one' }])
    await database.knex('sl_secrets').insert([{ id: 1, name: 'kept', archived: false }, { id: 2, name: 'archived', archived: true }])
    await database.knex('sl_hooked').insert([{ id: 1, name: 'hooked' }])
    await database.knex('sl_teamed').insert([{ id: 1, name: 'ours', team_id: 't1' }, { id: 2, name: 'theirs', team_id: 't2' }])
    // loose_owner_id has no foreign key, so it can point at a row that is gone.
    await database.knex('sl_things').insert([
      { id: 1, title: 'first', owner_id: 1, loose_owner_id: 1, secret_id: 1, hooked_id: 1, teamed_id: 1 },
      { id: 2, title: 'second', owner_id: 1, loose_owner_id: 99, secret_id: 2, hooked_id: null, teamed_id: 2 }
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
    Object.entries(resource.relationships || {}).map(([name, relationship]) => [name, relationship.data?.id ?? null])))
  const read = (fields, context) => statementsOf(() => api.resources.sl_things.query({ format: 'jsonapi', queryParams: { fields: { sl_things: fields }, sort: ['id'] } }, context))
  const team = () => ({ scopeValues: { teamId: 't1' } })
  const system = () => createSystemContext('linkage test')
  // The statements a link adds to the read of its records.
  const linkReads = async (field, context) => {
    const bare = await read('title', context)
    const linked = await read(`title,${field}`, context)
    return { links: links(linked.result), reads: linked.statements - bare.statements }
  }
  const protectedReads = databaseClient === 'better-sqlite3' ? 1 : 0

  it('reads no link that a foreign key protects to a target that narrows nothing, in any context', async () => {
    for (const context of [team(), system()]) {
      assert.deepEqual(await linkReads('owner', context), { links: [{ owner: '1' }, { owner: '1' }], reads: protectedReads })
    }
  })

  it('still reads a link without a foreign key, and clears one whose row is gone', async () => {
    for (const context of [team(), system()]) {
      assert.deepEqual(await linkReads('loose_owner', context), { links: [{ loose_owner: '1' }, { loose_owner: null }], reads: 1 })
    }
  })

  it('still reads a link to an owned target outside a system context', async () => {
    assert.deepEqual(await linkReads('teamed', team()), { links: [{ teamed: '1' }, { teamed: null }], reads: 1 })
    assert.deepEqual(await linkReads('teamed', system()), { links: [{ teamed: '1' }, { teamed: '2' }], reads: protectedReads })
  })

  it('still reads a link to a resource with a row policy or a filtering hook of its own', async () => {
    for (const context of [team(), system()]) {
      assert.deepEqual(await linkReads('secret', context), { links: [{ secret: '1' }, { secret: null }], reads: 1 })
      hookCalls.length = 0
      assert.deepEqual(await linkReads('hooked', context), { links: [{ hooked: '1' }, { hooked: null }], reads: 1 })
      assert.deepEqual(hookCalls, ['sl_hooked'])
    }
  })

  it('reads the links of a get the same way', async () => {
    const get = (fields, context) => statementsOf(() => api.resources.sl_things.get({ id: '1', format: 'jsonapi', queryParams: { fields: { sl_things: fields } } }, context))
    for (const context of [team(), system()]) {
      const bare = await get('title', context)
      const linked = await get('title,owner', context)
      assert.deepEqual(links(linked.result), [{ owner: '1' }])
      assert.equal(linked.statements - bare.statements, protectedReads)
    }
  })
})
