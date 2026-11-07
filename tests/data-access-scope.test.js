import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RestApiFieldsetError,
  RestApiRecordsNotFoundError,
  RestApiResourceError,
  RestApiRowLimitError,
  RestApiScopedQueryReadOnlyError,
  RestApiValidationError,
  createSystemContext,
  isSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const ids = result => result.data.map(record => String(record.id)).sort((a, b) => Number(a) - Number(b))

describe(`System context, shared rows, scopedQuery and queryAll (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })

  it('creates system contexts only with a reason and refuses a copied flag', async () => {
    assert.throws(() => createSystemContext(), TypeError)
    assert.throws(() => createSystemContext('  '), TypeError)
    const system = createSystemContext('nightly ledger totals', { jobId: 7 })
    assert.equal(isSystemContext(system), true)
    assert.equal(isSystemContext({ ...system }), true, 'contexts the library copies stay system')
    assert.equal(system.systemReason, 'nightly ledger totals')
    assert.equal(isSystemContext({ system: true }), false)
    assert.equal(isSystemContext(JSON.parse(JSON.stringify(system))), false, 'a serialized context loses the marker')

    await seedLedger(fixture)
    await assert.rejects(
      fixture.api.resources.da_entries.query({ queryParams: { page: { size: 50 } } }, { ...workspaceA(), system: true }),
      error => cause(error).code === 'REST_API_SYSTEM_CONTEXT_FORGED'
    )
  })

  it('skips ownership for a system context and tells the row policy', async () => {
    await seedLedger(fixture)
    const policyCalls = []
    const all = await fixture.api.resources.da_entries.query({ queryParams: { page: { size: 50 } } }, createSystemContext('ledger audit', { policyCalls }))
    assert.deepEqual(ids(all), ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    assert.ok(policyCalls.length > 0 && policyCalls.every(call => call.system === true))

    const ownCalls = []
    const a = await fixture.api.resources.da_entries.query({ queryParams: { page: { size: 50 } } }, { ...workspaceA(), policyCalls: ownCalls })
    assert.deepEqual(ids(a), ['1', '2', '3'], 'workspace A without its hidden group')
    assert.ok(ownCalls.every(call => call.system === false))
    assert.deepEqual(ids(await fixture.api.resources.da_entries.query({ queryParams: { page: { size: 50 } } }, workspaceB())), ['7', '8', '9'])
  })

  it('makes a system create name its owner', async () => {
    await seedLedger(fixture)
    await assert.rejects(
      fixture.api.resources.da_accounts.post({ data: { name: 'Owner missing', access_group: 'g1' } }, createSystemContext('import')),
      error => cause(error) instanceof RestApiValidationError &&
        cause(error).details.violations.some(violation => violation.rule === 'system_ownership_required')
    )
    const created = await fixture.api.resources.da_accounts.post({
      data: { name: 'Imported', access_group: 'g1', workspace_id: 'ws-b' }
    }, createSystemContext('import'))
    assert.equal(created.workspace_id, 'ws-b')
  })

  it('reads shared rows alongside its own and changes only its own', async () => {
    await seedLedger(fixture)
    await fixture.seed('da_labels', [
      { id: '1', name: 'shared', workspace_id: null },
      { id: '2', name: 'mine', workspace_id: 'ws-a' },
      { id: '3', name: 'theirs', workspace_id: 'ws-b' }
    ])
    const labels = fixture.api.resources.da_labels
    assert.deepEqual(ids(await labels.query({}, workspaceA())), ['1', '2'])
    assert.deepEqual(ids(await labels.query({}, workspaceB())), ['1', '3'])

    const created = await labels.post({ data: { name: 'new' } }, workspaceA())
    assert.equal(created.workspace_id, 'ws-a')

    const forbidden = error => cause(error) instanceof RestApiResourceError && cause(error).subtype === 'forbidden'
    await assert.rejects(labels.patch({ id: '1', data: { name: 'renamed' } }, workspaceA()), forbidden)
    await assert.rejects(labels.put({ id: '1', data: { name: 'replaced' } }, workspaceA()), forbidden)
    await assert.rejects(labels.delete({ id: '1' }, workspaceA()), forbidden)
    await assert.rejects(labels.post({ data: { name: 'nobody' } }, { scopeValues: { workspaceId: null } }), forbidden,
      'a context without an owner cannot create a shared row')
    await assert.rejects(labels.patch({ id: '3', data: { name: 'stolen' } }, workspaceA()),
      error => cause(error) instanceof RestApiResourceError && cause(error).subtype === 'not_found')
    assert.equal((await labels.patch({ id: '2', data: { name: 'still mine' } }, workspaceA())).name, 'still mine')

    const system = createSystemContext('label maintenance')
    assert.equal((await labels.patch({ id: '1', data: { name: 'shared, renamed' } }, system)).name, 'shared, renamed')
    const shared = await labels.post({ data: { name: 'global', workspace_id: null } }, system)
    assert.equal(shared.workspace_id, null)
  })

  it('keeps shared rows out of write and lock scopes', { skip: storageMode.isAnyApi() && 'many-row writes need table storage' }, async () => {
    await fixture.reset()
    await fixture.seed('da_labels', [
      { id: '1', name: 'shared', workspace_id: null },
      { id: '2', name: 'mine', workspace_id: 'ws-a' }
    ])
    const labels = fixture.api.resources.da_labels
    const report = await labels.scopedQuery({}, workspaceA())
    assert.deepEqual((await report.query.select('id').orderBy('id')).map(row => String(row.id)), ['1', '2'])
    const writes = await labels.scopedQuery({ purpose: 'bulk-write' }, workspaceA())
    assert.deepEqual((await writes.query.select('id')).map(row => String(row.id)), ['2'])

    await assert.rejects(
      labels.patchMany({ data: [{ id: '1', name: 'x' }, { id: '2', name: 'y' }] }, workspaceA()),
      error => cause(error) instanceof RestApiRecordsNotFoundError && cause(error).details.missing === 1
    )
    const skipped = await labels.patchMany({ data: [{ id: '1', name: 'x' }, { id: '2', name: 'y' }], missing: 'skip', returning: 'minimal' }, workspaceA())
    assert.deepEqual(skipped.data, [{ type: 'da_labels', id: '2' }])
    assert.equal((await fixture.rows('da_labels'))[0].name, 'shared')
  })

  it('builds a read-only scoped query for each workspace and the row policy', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const countOf = async context => {
      const { query } = await entries.scopedQuery({}, context)
      const row = await query.count({ total: '*' }).first()
      return Number(row.total)
    }
    assert.equal(await countOf(workspaceA()), 3)
    assert.equal(await countOf(workspaceB()), 3)
    assert.equal(await countOf(createSystemContext('totals')), 9)
    assert.equal(await countOf({ ...workspaceA(), visibility: { groups: ['g2'] } }), 3)
    assert.equal(await countOf({ scopeValues: { workspaceId: 'ws-c' }, visibility: { groups: ['g1'] } }), 0)

    const { query } = await entries.scopedQuery({}, workspaceA())
    for (const [method, args] of [
      ['insert', [{ code: 'x' }]], ['update', [{ amount: 1 }]], ['del', []], ['delete', []], ['truncate', []],
      ['forUpdate', []], ['forShare', []], ['skipLocked', []], ['from', ['da_accounts']], ['clearWhere', []],
      ['clear', ['where']], ['onConflict', ['code']], ['increment', ['amount', 1]], ['upsert', [{ code: 'x' }]]
    ]) {
      assert.throws(() => query[method](...args), RestApiScopedQueryReadOnlyError, method)
    }
    assert.throws(() => query.clone().update({ amount: 1 }), RestApiScopedQueryReadOnlyError, 'clones stay read-only')
    assert.throws(() => query.where('amount', '>', 0).del(), RestApiScopedQueryReadOnlyError, 'chained builders stay read-only')
    await assert.rejects(entries.scopedQuery({ purpose: 'delete' }, workspaceA()), error => cause(error) instanceof RestApiValidationError)
  })

  it('serves reports, aliases and subqueries from the scoped builder', { skip: storageMode.isAnyApi() && 'canonical rows store fields in slots' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const { query } = await entries.scopedQuery({ alias: 'e', filters: { status: 'open' } }, workspaceA())
    const totals = await query.select('e.account_id').sum({ total: 'e.amount' }).groupBy('e.account_id')
    assert.deepEqual(totals.map(row => [Number(row.account_id), Number(row.total)]), [[1, 60]])

    // A scoped subquery keeps another workspace's rows out of a join.
    const { query: visible } = await entries.scopedQuery({}, workspaceB())
    const accounts = await fixture.knex('da_accounts').whereIn('id', visible.select('account_id')).select('id')
    assert.deepEqual(accounts.map(row => Number(row.id)), [3])
  })

  it('reads every visible row in cursor pages with flat statement counts', async () => {
    await seedLedger(fixture, { entriesPerAccount: 30 })
    const entries = fixture.api.resources.da_entries
    const all = await entries.queryAll({ pageSize: 7 }, workspaceA())
    assert.equal(all.data.length, 30)
    // Pages follow the storage's id order (AnyAPI compares ids as text); every row comes once.
    assert.deepEqual(all.data.map(record => Number(record.id)).sort((a, b) => a - b), Array.from({ length: 30 }, (_, index) => index + 1))

    const small = await fixture.measure(() => entries.queryAll({}, workspaceA()))
    await seedLedger(fixture, { entriesPerAccount: 90 })
    const large = await fixture.measure(() => entries.queryAll({}, workspaceA()))
    assert.equal(small.result.data.length, 30)
    assert.equal(large.result.data.length, 90)
    assert.equal(large.statements, small.statements, `30 rows: ${small.statements} statements, 90 rows: ${large.statements}`)

    await assert.rejects(entries.queryAll({ rowLimit: 50 }, workspaceA()), error => cause(error) instanceof RestApiRowLimitError)
    await assert.rejects(entries.queryAll({ queryParams: { page: { size: 5 } } }, workspaceA()), error => cause(error) instanceof RestApiValidationError)
    const filtered = await entries.queryAll({ queryParams: { filters: { amount: 20 } } }, workspaceA())
    assert.deepEqual(filtered.data.map(record => String(record.id)), ['2'])
  })

  // Registers a permission hook, so it runs last.
  it('reads one record in one statement unless a hook needs its minimal record first', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const notFound = error => cause(error) instanceof RestApiResourceError && cause(error).subtype === 'not_found'
    const once = await fixture.measure(() => entries.get({ id: '1' }, workspaceA()))
    assert.equal(String(once.result.id), '1')
    // Hidden by the row policy, in another workspace, or missing: not found, from the same one read.
    for (const id of ['4', '7', '99']) {
      const missing = await fixture.measure(() => assert.rejects(entries.get({ id }, workspaceA()), notFound))
      assert.equal(missing.statements, 1, missing.sql.join(' | '))
    }
    // A missing row answers not found before a bad fieldset, as it did with two reads.
    await assert.rejects(entries.get({ id: '99', queryParams: { fields: { da_nothing: 'name' } } }, workspaceA()), notFound)
    await assert.rejects(entries.get({ id: '1', queryParams: { fields: { da_nothing: 'name' } } }, workspaceA()), error => cause(error) instanceof RestApiFieldsetError)

    await fixture.api.customize({
      hooks: { checkPermissions: { functionName: 'data-access-get-reader', handler: () => {} } }
    })
    const twice = await fixture.measure(() => entries.get({ id: '1' }, workspaceA()))
    assert.deepEqual(twice.result, once.result)
    assert.equal(twice.statements, once.statements + 1, `one read: ${once.sql.join(' | ')}\nwith a permission hook: ${twice.sql.join(' | ')}`)
  })
})
