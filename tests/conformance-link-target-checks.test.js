import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSystemContext } from '../index.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createLinkCheckApi } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'

// A write checks the targets its rows link to (belongs-to) with one statement
// per target type: a scoped read of the targets' ids that also locks them.
const tables = { lc_items: 'lc_items', lc_owners: 'lc_owners', lc_tags: 'lc_tags' }
// The database's foreign key stands in for the check of a link to a table
// without a row policy, in a system context; SQLite enforces foreign keys only
// on connections that turn them on, so there the link is still checked.
const foreignKeyChecks = !storageMode.isAnyApi() && databaseClient !== 'better-sqlite3'

const createFixture = apiOptions => createConformanceFixture({ createApi: createLinkCheckApi, apiOptions, tables })

// Every statement a call runs, as { sql, bindings }.
const statementsOf = async (fixture, run) => {
  const queries = []
  const capture = ({ sql, bindings }) => queries.push({ sql, bindings: bindings || [] })
  fixture.knex.on('query', capture)
  try { await run() } finally { fixture.knex.off('query', capture) }
  return queries
}
// The statements that read rows of `type`.
const readsOf = (fixture, queries, type) => queries.filter(({ sql, bindings }) => /^select /i.test(sql) &&
  (fixture.storage === 'anyapi' ? bindings.includes(type) : sql.includes(type)))
// The columns a statement's outer select list names, quoted names only.
const selected = sql => [...sql.slice('select '.length, sql.search(/ from /i)).matchAll(/"([^"]+)"|`([^`]+)`/g)].map(match => match[1] ?? match[2])
const describeReads = reads => reads.map(({ sql }) => sql).join('\n')

const assertIdsOnly = (fixture, read, type) => {
  const adapter = fixture.api.knex.helpers.getStorageAdapter(type)
  const allowed = new Set([adapter.getTableName(), adapter.getIdColumn(), 'id'])
  assert.ok(!/^select\s+(\S+\.)?\*/i.test(read.sql) && !/ \* /.test(read.sql.slice(0, read.sql.search(/ from /i))), read.sql)
  assert.deepEqual(selected(read.sql).filter(name => !allowed.has(name)), [], read.sql)
}
const assertLocked = read => {
  if (databaseClient === 'pg') assert.match(read.sql, /for key share$/i)
  else if (databaseClient === 'mysql2') assert.match(read.sql, /lock in share mode$/i)
}
// One statement per type: a locking read of the ids alone, scoped by the target's row policy.
const assertOneLockingIdRead = (fixture, queries, type) => {
  const reads = readsOf(fixture, queries, type)
  assert.equal(reads.length, 1, `${type} reads:\n${describeReads(reads)}`)
  assertIdsOnly(fixture, reads[0], type)
  assertLocked(reads[0])
  if (type === 'lc_tags') {
    const archived = fixture.api.knex.helpers.getStorageAdapter(type).translateColumn('archived').split('.').pop()
    assert.ok(reads[0].sql.includes(archived), reads[0].sql)
  }
}

// The refusal of a link to a missing or hidden target: the write fails with the
// link check's resource error as its cause.
const missing = (type, id) => error => {
  assert.ok(error.cause instanceof RestApiResourceError, String(error.cause))
  assert.deepEqual(
    { code: error.code, subtype: error.subtype, message: error.message, details: error.details },
    { code: 'REST_API_RESOURCE', subtype: 'not_found', message: `Cannot create relationship to non-existent ${type} with id ${id}`, details: { resourceType: type, resourceId: id } }
  )
  return true
}

describe(`Link target checks on writes (${storageMode.mode})`, () => {
  let fixture
  const item = (index, owner, tag) => ({
    type: 'lc_items',
    attributes: { title: `Item ${index}` },
    relationships: {
      ...(owner === undefined ? {} : { owner: { data: owner === null ? null : { type: 'lc_owners', id: String(owner) } } }),
      ...(tag === undefined ? {} : { tag: { data: tag === null ? null : { type: 'lc_tags', id: String(tag) } } })
    }
  })
  const postMany = (rows, context) => fixture.api.resources.lc_items.postMany({ document: { data: rows }, returning: 'none' }, context)
  const post = (row, context) => fixture.api.resources.lc_items.post({ document: { data: row }, returning: 'none' }, context)
  const create = async row => (await fixture.api.resources.lc_items.post({ document: { data: row }, returning: 'minimal' })).data.id
  const patchOwner = (id, owner) => fixture.api.resources.lc_items.patch({
    id, returning: 'none', document: { data: { type: 'lc_items', id, relationships: { owner: { data: { type: 'lc_owners', id: owner } } } } }
  })
  const linkOf = async (id, name) => (await fixture.api.resources.lc_items.get({ id, queryParams: { fields: { lc_items: name } } })).data.relationships[name].data?.id ?? null

  before(async () => { fixture = await createFixture() })
  beforeEach(async () => {
    await fixture.reset()
    for (let id = 1; id <= 10; id++) {
      await fixture.seed('lc_owners', { name: `Owner ${id}`, profile: { notes: 'x'.repeat(200) } })
      await fixture.seed('lc_tags', { name: `Tag ${id}` })
    }
    // Tag 10 is archived, so its row policy hides it.
    const tags = fixture.api.knex.helpers.getStorageAdapter('lc_tags')
    await tags.buildBaseQuery().where(tags.getIdColumn(), '10').update(tags.toStorageRow({ archived: true }))
  })
  after(async () => { await fixture?.close() })

  it('checks a 100-row create linking to two types with one id read per type', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => item(index, index % 9 + 1, (index * 7) % 9 + 1))
    const queries = await statementsOf(fixture, () => postMany(rows))
    assertOneLockingIdRead(fixture, queries, 'lc_owners')
    assertOneLockingIdRead(fixture, queries, 'lc_tags')
    assert.equal(await fixture.count('lc_items'), 100)
  })

  it('checks a single create with one id read per linked type', async () => {
    const queries = await statementsOf(fixture, () => post(item(1, 3, 4)))
    assertOneLockingIdRead(fixture, queries, 'lc_owners')
    assertOneLockingIdRead(fixture, queries, 'lc_tags')
  })

  it('checks a patch that changes a link with one id read of the new target', async () => {
    const id = await create(item(1, 1, 1))
    const queries = await statementsOf(fixture, () => patchOwner(id, '2'))
    assertOneLockingIdRead(fixture, queries, 'lc_owners')
    assert.deepEqual(readsOf(fixture, queries, 'lc_tags'), [])
    assert.equal(await linkOf(id, 'owner'), '2')
  })

  it('reads no target a declared foreign key protects in a system context, and still checks one behind a row policy', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => item(index, index % 9 + 1, index % 9 + 1))
    const queries = await statementsOf(fixture, () => postMany(rows, createSystemContext('link check test')))
    if (foreignKeyChecks) assert.deepEqual(readsOf(fixture, queries, 'lc_owners'), [])
    else assertOneLockingIdRead(fixture, queries, 'lc_owners')
    assertOneLockingIdRead(fixture, queries, 'lc_tags')
    assert.equal(await fixture.count('lc_items'), 100)
    const single = await statementsOf(fixture, () => post(item(101, 2, 2), createSystemContext('link check test')))
    assert.equal(readsOf(fixture, single, 'lc_owners').length, foreignKeyChecks ? 0 : 1)
    assertOneLockingIdRead(fixture, single, 'lc_tags')
  })

  it('leaves a missing target to the foreign key in a system context: the write fails and writes nothing', async () => {
    const rejected = post(item(1, 999, 1), createSystemContext('link check test'))
    if (foreignKeyChecks) await assert.rejects(rejected)
    else await assert.rejects(rejected, missing('lc_owners', '999'))
    assert.equal(await fixture.count('lc_items'), 0)
  })

  it('refuses a missing target as before', async () => {
    await assert.rejects(post(item(1, 999, 1)), missing('lc_owners', '999'))
    await assert.rejects(postMany([item(1, 1, 1), item(2, 1, 998)]), missing('lc_tags', '998'))
    const id = await create(item(1, 1, 1))
    await assert.rejects(patchOwner(id, '997'), missing('lc_owners', '997'))
    assert.equal(await linkOf(id, 'owner'), '1')
    assert.equal(await fixture.count('lc_items'), 1)
  })

  it('refuses a target its row policy hides as missing, in a system context too', async () => {
    await assert.rejects(post(item(1, 1, 10)), missing('lc_tags', '10'))
    await assert.rejects(postMany([item(1, 1, 1), item(2, 2, 10)]), missing('lc_tags', '10'))
    await assert.rejects(post(item(1, 1, 10), createSystemContext('link check test')), missing('lc_tags', '10'))
    assert.equal(await fixture.count('lc_items'), 0)
  })
})

describe(`Link targets with a permission hook (${storageMode.mode})`, () => {
  let fixture
  // The hook records the minimal records it sees, once seeding is done, and refuses owners named Refused.
  let seen
  before(async () => {
    fixture = await createFixture({
      ownerPermission: ({ context }) => {
        if (context.method !== 'get' || !seen) return
        const { id, minimalRecord } = context.originalContext
        seen.push({ id, name: minimalRecord.attributes.name })
        if (minimalRecord.attributes.name === 'Refused') throw new RestApiResourceError('Owner refused', { subtype: 'forbidden' })
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    seen = undefined
    await fixture.seed('lc_owners', { name: 'Kept' })
    await fixture.seed('lc_owners', { name: 'Refused' })
    await fixture.seed('lc_tags', { name: 'Tag' })
    seen = []
  })
  after(async () => { await fixture?.close() })

  const post = (owner, context) => fixture.api.resources.lc_items.post({
    returning: 'none',
    document: { data: { type: 'lc_items', attributes: { title: 'Item' }, relationships: { owner: { data: { type: 'lc_owners', id: owner } }, tag: { data: { type: 'lc_tags', id: '1' } } } } }
  }, context)

  it('gives the hook each target\'s minimal record from the one locking read, and keeps its refusal', async () => {
    const queries = await statementsOf(fixture, () => post('1'))
    const reads = readsOf(fixture, queries, 'lc_owners')
    assert.equal(reads.length, 1, describeReads(reads))
    assertLocked(reads[0])
    assert.deepEqual(seen, [{ id: '1', name: 'Kept' }])
    // The targets without a hook are still read by their ids alone.
    assertOneLockingIdRead(fixture, queries, 'lc_tags')
    await assert.rejects(post('2'), { code: 'REST_API_RESOURCE', subtype: 'forbidden', message: 'Owner refused' })
    // A hook that would see the record runs in a system context too.
    seen = []
    await post('1', createSystemContext('link check test'))
    assert.deepEqual(seen, [{ id: '1', name: 'Kept' }])
    assert.equal(await fixture.count('lc_items'), 2)
  })
})
