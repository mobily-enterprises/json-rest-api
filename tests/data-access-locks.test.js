import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RestApiLockOutsideTransactionError,
  RestApiRecordsNotFoundError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
const serverDatabase = databaseClient !== 'better-sqlite3'
const tableOnly = storageMode.isAnyApi() && 'locks need table storage'

describe(`Row locks and claims (${storageMode.mode})`, { skip: tableOnly }, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture({ databaseOptions: { maxConnections: 4 } }) })
  after(async () => { await fixture?.close() })

  const seedJobs = async () => {
    await seedLedger(fixture)
    await fixture.seed('da_jobs', [
      { id: '1', state: 'queued', priority: 1, workspace_id: 'ws-a', account_id: 1 },
      { id: '2', state: 'queued', priority: 5, workspace_id: 'ws-a', account_id: 1 },
      { id: '3', state: 'queued', priority: 3, workspace_id: 'ws-a', account_id: 2 },
      { id: '4', state: 'done', priority: 9, workspace_id: 'ws-a', account_id: 1 },
      { id: '5', state: 'queued', priority: 4, workspace_id: 'ws-a', account_id: 1 },
      { id: '6', state: 'queued', priority: 8, workspace_id: 'ws-b', account_id: 3 }
    ])
  }

  it('refuses to lock outside a transaction', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    await assert.rejects(entries.lockByIds({ ids: ['1'] }, workspaceA()), isA(RestApiLockOutsideTransactionError))
    await assert.rejects(fixture.api.resources.da_jobs.claim({}, workspaceA()), isA(RestApiLockOutsideTransactionError))
  })

  it('locks the visible rows in id order and returns them as the lock read them', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    await fixture.api.transaction(async transaction => {
      const locked = await entries.lockByIds({ ids: ['3', '1', '2'], transaction }, workspaceA())
      assert.deepEqual(locked.data.map(record => [String(record.id), record.code]), [['1', 'E1'], ['2', 'E2'], ['3', 'E3']])
      assert.equal(String(locked.data[0].account.id), '1')

      const sparse = await entries.lockByIds({ ids: ['1'], transaction, queryParams: { fields: { da_entries: 'amount' } }, format: 'jsonapi' }, workspaceA())
      assert.deepEqual(Object.keys(sparse.data[0].attributes), ['amount'])

      // 4 is hidden by the row policy, 7 belongs to ws-b.
      await assert.rejects(entries.lockByIds({ ids: ['1', '4'], transaction }, workspaceA()), isA(RestApiRecordsNotFoundError))
      await assert.rejects(entries.lockByIds({ ids: ['1', '7'], transaction }, workspaceA()), isA(RestApiRecordsNotFoundError))
      const skipped = await entries.lockByIds({ ids: ['1', '4', '7'], transaction, missing: 'skip' }, workspaceA())
      assert.deepEqual(skipped.data.map(record => String(record.id)), ['1'])
      const theirs = await entries.lockByIds({ ids: ['7'], transaction }, workspaceB())
      assert.deepEqual(theirs.data.map(record => String(record.id)), ['7'])
      const all = await entries.lockByIds({ ids: ['4', '7'], transaction }, createSystemContext('ledger close'))
      assert.equal(all.data.length, 2)
      await assert.rejects(entries.lockByIds({ ids: ['1'], transaction, queryParams: { filters: { status: 'open' } } }, workspaceA()), isA(RestApiValidationError))
    })
  })

  it('locks 10 and 200 rows with the same statements', async () => {
    await seedLedger(fixture, { entriesPerAccount: 200 })
    const entries = fixture.api.resources.da_entries
    const lock = count => fixture.measure(() => fixture.api.transaction(transaction =>
      entries.lockByIds({ ids: Array.from({ length: count }, (_, index) => String(index + 1)), transaction }, workspaceA())))
    const small = await lock(10)
    const large = await lock(200)
    assert.equal(small.result.data.length, 10)
    assert.equal(large.result.data.length, 200)
    assert.equal(large.statements, small.statements, `10 rows: ${small.sql.join(' | ')}\n200 rows: ${large.sql.join(' | ')}`)
  })

  it('holds the lock against other transactions', { skip: !serverDatabase && 'SQLite has one writer; its locks are scoped reads' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    await fixture.api.transaction(async transaction => {
      await entries.lockByIds({ ids: ['1', '2'], transaction }, workspaceA())
      await assert.rejects(fixture.knex.transaction(other => other('da_entries').where({ id: 1 }).forUpdate().noWait().select('id')))
      const free = await fixture.knex.transaction(other => other('da_entries').where({ id: 3 }).forUpdate().noWait().select('id'))
      assert.equal(free.length, 1)
    })
  })

  it('reads the latest committed row, not the transaction snapshot', { skip: !serverDatabase && 'needs a second connection' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    await fixture.api.transaction(async transaction => {
      const before = await entries.get({ id: '1', transaction }, workspaceA())
      assert.equal(Number(before.amount), 10)
      await fixture.knex('da_entries').where({ id: 1 }).update({ amount: 555 })
      const [locked] = (await entries.lockByIds({ ids: ['1'], transaction }, workspaceA())).data
      assert.equal(Number(locked.amount), 555)
    })
  })

  it('claims matching rows in sort order inside the scope', async () => {
    await seedJobs()
    const jobs = fixture.api.resources.da_jobs
    await fixture.api.transaction(async transaction => {
      const claimed = await jobs.claim({ filters: { state: 'queued' }, sort: ['-priority'], limit: 2, transaction }, workspaceA())
      assert.deepEqual(claimed.data.map(record => String(record.id)), ['2', '5'])
      const one = await jobs.claim({ filters: { state: 'queued' }, transaction }, workspaceB())
      assert.deepEqual(one.data.map(record => String(record.id)), ['6'])
      await assert.rejects(jobs.claim({ limit: 0, transaction }, workspaceA()), isA(RestApiValidationError))
      await assert.rejects(jobs.claim({ sort: ['label'], transaction }, workspaceA()), isA(RestApiValidationError))
    })
  })

  it('skips rows another transaction has claimed', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
    await seedJobs()
    const jobs = fixture.api.resources.da_jobs
    await fixture.api.transaction(async first => {
      const mine = await jobs.claim({ filters: { state: 'queued' }, sort: ['-priority'], limit: 2, transaction: first }, workspaceA())
      assert.deepEqual(mine.data.map(record => String(record.id)), ['2', '5'])
      const theirs = await fixture.api.transaction(second =>
        jobs.claim({ filters: { state: 'queued' }, sort: ['-priority'], limit: 2, transaction: second }, workspaceA()))
      assert.deepEqual(theirs.data.map(record => String(record.id)), ['3', '1'])
    })
  })

  it('refuses a claim whose row policy joins tables', async () => {
    await seedJobs()
    await fixture.api.transaction(async transaction => {
      await assert.rejects(
        fixture.api.resources.da_jobs.claim({ filters: { state: 'queued' }, transaction }, { ...workspaceA(), joinPolicy: true }),
        error => isA(RestApiValidationError)(error) && JSON.stringify(cause(error).details).includes('claim_single_table')
      )
    })
  })
})
