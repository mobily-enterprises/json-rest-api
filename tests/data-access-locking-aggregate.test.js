import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RestApiBulkWriteUnsupportedError,
  RestApiLockOutsideTransactionError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { connectionId, waitForLockWait } from './helpers/lock-wait.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
const refusedAs = rule => error => isA(RestApiValidationError)(error) && JSON.stringify(cause(error).details).includes(rule)
const serverDatabase = databaseClient !== 'better-sqlite3'
const isMysql = databaseClient === 'mysql2'
const isPostgres = databaseClient === 'pg'
// The seed's visible ws-a entries are 1-3 (amount id * 10); 4-6 are policy-hidden, 7-9 are ws-b's.
const TOTALS = { rows: { count: '*' }, total: { sum: 'amount' }, open: { count: '*', where: { status: 'open' } } }
const newEntry = (id, attributes = {}) => ({ id, code: `W${id}`, amount: 1, status: 'open', workspace_id: 'ws-a', access_group: 'g1', account_id: 1, ...attributes })

// Fails, instead of waiting for a lock timeout, when `work` waits for a lock.
const withoutWaiting = (work, label) => {
  let timer
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} waited for a lock`)), 5000) })
  ])
}

describe(`Locking aggregate (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture({ databaseOptions: { maxConnections: 4 } }) })
  after(async () => { await fixture?.close() })

  const totals = (transaction, context = workspaceA(), params = {}) =>
    fixture.api.resources.da_entries.aggregate({ measures: TOTALS, lockMode: 'share', transaction, ...params }, context).then(result => result.data[0])

  it('is refused by AnyAPI storage, which has no row locks', { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, async () => {
    await seedLedger(fixture)
    await fixture.api.transaction(async transaction => {
      await assert.rejects(totals(transaction), error => isA(RestApiBulkWriteUnsupportedError)(error) && /no row locks/.test(cause(error).message))
    })
  })

  describe('on table storage', { skip: storageMode.isAnyApi() && 'locks need table storage' }, () => {
    // B starts while A holds its locks; A runs `write` and commits while B waits.
    const whileWaiting = async ({ hold, waiter, write = async () => {} }) => {
      let reportWaiter
      const waiterId = new Promise(resolve => { reportWaiter = resolve })
      let second
      await fixture.api.transaction(async first => {
        await hold(first)
        second = fixture.api.transaction(async transaction => {
          reportWaiter(await connectionId(transaction))
          return waiter(transaction)
        })
        await waitForLockWait(fixture.knex, await waiterId, second)
        await write(first)
      })
      return second
    }

    it('refuses outside a transaction, with groupBy, with an unknown lock mode and with a query that joins', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      await assert.rejects(entries.aggregate({ measures: TOTALS, lockMode: 'share' }, workspaceA()), error =>
        isA(RestApiLockOutsideTransactionError)(error) && cause(error).message === "aggregate on 'da_entries' needs a transaction from api.transaction")
      await fixture.api.transaction(async transaction => {
        await assert.rejects(totals(transaction, workspaceA(), { groupBy: ['status'] }), refusedAs('lock_aggregate_group'))
        await assert.rejects(totals(transaction, workspaceA(), { lockMode: 'exclusive' }), refusedAs('lock_mode'))
        // A filter on another table's field joins it; so does this row policy.
        await assert.rejects(totals(transaction, workspaceA(), { queryParams: { filters: { accountName: 'A visible' } } }), refusedAs('lock_single_table'))
        await assert.rejects(
          fixture.api.resources.da_jobs.aggregate({ measures: { rows: { count: '*' } }, lockMode: 'share', transaction }, { ...workspaceA(), joinPolicy: true }),
          refusedAs('lock_single_table')
        )
      })
    })

    it('totals the visible rows the filters select, as a lock read scopes them', async () => {
      await seedLedger(fixture)
      await fixture.knex('da_entries').where({ id: 2 }).update({ status: 'held' })
      const context = { ...workspaceA(), policyCalls: [] }
      await fixture.api.transaction(async transaction => {
        assert.deepEqual(await totals(transaction, context), { rows: 3, total: 60, open: 2 })
        // Once, or on PostgreSQL once a read.
        assert.ok(context.policyCalls.length && context.policyCalls.every(call => call.queryPurpose === 'lock'), JSON.stringify(context.policyCalls))
        assert.deepEqual(await totals(transaction, workspaceB()), { rows: 3, total: 240, open: 3 })
        assert.deepEqual(await totals(transaction, workspaceA(), { queryParams: { filters: { status: 'open' } } }), { rows: 2, total: 40, open: 2 })
        assert.deepEqual(await totals(transaction, workspaceA(), { queryParams: { filters: { status: 'none' } } }), { rows: 0, total: null, open: 0 })
        for (const lockMode of ['update', 'noKeyUpdate']) {
          assert.deepEqual(await totals(transaction, workspaceA(), { lockMode }), { rows: 3, total: 60, open: 2 })
        }
        // A system context has no ownership condition: MySQL needs an index that starts with a filtered column.
        const system = totals(transaction, createSystemContext('ledger close'))
        if (isMysql) await assert.rejects(system, error => isA(RestApiBulkWriteUnsupportedError)(error) && /^aggregate on 'da_entries' is not supported: .*add a visible index of 'da_entries' that starts with a column the filters compare/.test(cause(error).message))
        else assert.deepEqual(await system, { rows: 9, total: 450, open: 8 })
      })
    })

    it('totals 2,000 rows exactly, in the statements it takes for 3, without reading a row', async () => {
      const measure = () => fixture.measure(() => fixture.api.transaction(transaction => totals(transaction)))
      await seedLedger(fixture)
      await measure() // MySQL reads the table's indexes once
      const small = await measure()
      await seedLedger(fixture, { entriesPerAccount: 2000 })
      const large = await measure()
      assert.deepEqual(small.result, { rows: 3, total: 60, open: 3 })
      assert.deepEqual(large.result, { rows: 2000, total: 20010000, open: 2000 })
      assert.equal(large.statements, small.statements, `3 rows: ${small.sql.join(' | ')}\n2000 rows: ${large.sql.join(' | ')}`)
      const reads = large.sql.filter(sql => /da_entries/.test(sql))
      const lock = { pg: /for share/i, mysql2: /lock in share mode/i }[databaseClient]
      // PostgreSQL reads again once, under its locks, to find rows committed while it waited.
      assert.equal(reads.filter(sql => /count\(/i.test(sql) && (!lock || lock.test(sql))).length, isPostgres ? 2 : 1, reads.join(' | '))
      assert.deepEqual(reads.filter(sql => !/count\(/i.test(sql) && !/^update/i.test(sql)), [], 'no statement reads the rows themselves')
    })

    it('makes an update or delete of a counted row wait until its transaction ends', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      for (const [name, write, expected] of [
        ['update', transaction => transaction('da_entries').where({ id: 1 }).update({ amount: 999 }), { rows: 3, total: 1049, open: 3 }],
        ['delete', transaction => transaction('da_entries').where({ id: 1 }).delete(), { rows: 2, total: 50, open: 2 }]
      ]) {
        await seedLedger(fixture)
        let held
        await whileWaiting({
          hold: async first => { held = await totals(first) },
          waiter: write,
          // The totals hold while the write waits.
          write: async first => assert.deepEqual(await totals(first), held, name)
        })
        assert.deepEqual(held, { rows: 3, total: 60, open: 3 }, name)
        assert.deepEqual(await fixture.api.transaction(transaction => totals(transaction)), expected, name)
      }
    })

    it('leaves other owners\' rows free', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      await seedLedger(fixture)
      await fixture.api.transaction(async first => {
        await totals(first)
        await withoutWaiting(fixture.knex.transaction(other => other('da_entries').where({ id: 7 }).update({ amount: 1 })), 'a write of ws-b\'s row')
        // Another shared check of the same rows goes on too.
        assert.deepEqual(await withoutWaiting(fixture.api.transaction(other => totals(other)), 'a second shared aggregate'), { rows: 3, total: 60, open: 3 })
      })
    })

    it('makes an insert into the totals wait on MySQL and MariaDB', { skip: !isMysql && 'InnoDB next-key locks; PostgreSQL does not hold new rows' }, async () => {
      await seedLedger(fixture)
      await whileWaiting({
        hold: first => totals(first),
        waiter: transaction => transaction('da_entries').insert(newEntry(100)),
        write: async first => assert.deepEqual(await totals(first), { rows: 3, total: 60, open: 3 })
      })
      assert.deepEqual(await fixture.api.transaction(transaction => totals(transaction)), { rows: 4, total: 61, open: 4 })
    })

    it('lets an insert into the totals go on on PostgreSQL, which holds only rows that exist', { skip: !isPostgres && 'PostgreSQL only' }, async () => {
      await seedLedger(fixture)
      await fixture.api.transaction(async first => {
        assert.deepEqual(await totals(first), { rows: 3, total: 60, open: 3 })
        await withoutWaiting(fixture.knex.transaction(other => other('da_entries').insert(newEntry(100))), 'an insert')
        assert.deepEqual(await totals(first), { rows: 4, total: 61, open: 4 })
      })
    })

    it('counts the rows the transaction it waited for committed', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      await seedLedger(fixture)
      const counted = await whileWaiting({
        hold: first => fixture.api.resources.da_entries.lockByIds({ ids: ['1'], transaction: first }, workspaceA()),
        waiter: transaction => totals(transaction),
        write: async first => {
          await first('da_entries').insert(newEntry(100))
          await first('da_entries').where({ id: 1 }).update({ amount: 500 })
        }
      })
      assert.deepEqual(counted, { rows: 4, total: 551, open: 4 })
    })

    it('takes the SQLite write lock, so another connection cannot write until the holder ends', { skip: databaseClient !== 'better-sqlite3' && 'SQLite only' }, async () => {
      // A file database in WAL mode with busy_timeout 0: a second writer fails at once.
      const local = await createDataAccessFixture({ databaseOptions: { concurrent: true, maxConnections: 4 } })
      try {
        await seedLedger(local)
        const busy = error => /SQLITE_BUSY|database is locked/.test(`${cause(error)?.code} ${cause(error)?.message}`)
        const otherWrite = () => local.knex.transaction(other => other('da_entries').where({ id: 7 }).update({ amount: 1 }))
        await local.api.transaction(async transaction => {
          const result = await local.api.resources.da_entries.aggregate({ measures: TOTALS, lockMode: 'share', transaction }, workspaceA())
          assert.deepEqual(result.data, [{ rows: 3, total: 60, open: 3 }])
          await assert.rejects(otherWrite(), busy)
        })
        await otherWrite()
      } finally {
        await local.close()
      }
    })
  })
})
