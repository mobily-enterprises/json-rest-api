import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RestApiBulkWriteUnsupportedError,
  RestApiLockOutsideTransactionError,
  RestApiRecordsNotFoundError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { connectionId, waitForLockWait } from './helpers/lock-wait.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
const serverDatabase = databaseClient !== 'better-sqlite3'
const tableOnly = storageMode.isAnyApi() && 'locks need table storage'

describe(`Row locks and claims (${storageMode.mode})`, { skip: tableOnly }, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture({ databaseOptions: { maxConnections: 4 } })
    // A filtering hook that reads from a derived table instead of the table.
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'locks-derived-table',
          handler: ({ context }) => {
            if (!context.deriveTable || !context.knexQuery) return
            const { query, db, tableName } = context.knexQuery
            context.knexQuery.query = db.from(query.clone().as(tableName))
          }
        }
      }
    })
  })
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

  // The lock's first statement must be the locking read: a plain read before it
  // would fix a REPEATABLE READ snapshot (MySQL, MariaDB) before the wait, so the
  // transaction would miss what the lock holder committed meanwhile.
  const isMysql = databaseClient === 'mysql2'

  // B starts its lock while A holds the rows; A writes and commits while B waits.
  const whileWaiting = async ({ hold, waiter, write, snapshotIsolation }) => {
    let reportWaiter
    const waiterId = new Promise(resolve => { reportWaiter = resolve })
    let second
    await fixture.api.transaction(async first => {
      await hold(first)
      second = fixture.api.transaction(async transaction => {
        if (snapshotIsolation) await transaction.raw(`SET SESSION innodb_snapshot_isolation = ${snapshotIsolation}`)
        try {
          reportWaiter(await connectionId(transaction))
          return await waiter(transaction)
        } finally {
          if (snapshotIsolation) await transaction.raw('SET SESSION innodb_snapshot_isolation = DEFAULT')
        }
      })
      await waitForLockWait(fixture.knex, await waiterId, second)
      await write(first)
    })
    return second
  }
  const newEntry = (id, attributes = {}) => ({ id, code: `W${id}`, amount: 1, status: 'open', workspace_id: 'ws-a', access_group: 'g1', account_id: 1, ...attributes })

  for (const snapshotIsolation of isMysql ? ['OFF', 'ON'] : [undefined]) {
    const name = snapshotIsolation ? ` (innodb_snapshot_isolation ${snapshotIsolation})` : ''
    it(`lockByIds sees what the lock holder committed while it waited${name}`, { skip: !serverDatabase && 'SQLite has one writer' }, async t => {
      if (snapshotIsolation) {
        try {
          await fixture.knex.raw('SELECT @@innodb_snapshot_isolation')
        } catch {
          return t.skip('the server has no innodb_snapshot_isolation')
        }
      }
      await seedLedger(fixture)
      const accounts = fixture.api.resources.da_accounts
      const { account, entry } = await whileWaiting({
        snapshotIsolation,
        hold: first => accounts.lockByIds({ ids: ['1'], transaction: first }, workspaceA()),
        write: async first => {
          await first('da_entries').insert(newEntry(100))
          await first('da_accounts').where({ id: 1 }).update({ name: 'A renamed' })
        },
        waiter: async transaction => {
          const [account] = (await accounts.lockByIds({ ids: ['1'], transaction }, workspaceA())).data
          return { account, entry: await transaction('da_entries').where({ id: 100 }).first() }
        }
      })
      assert.equal(account.name, 'A renamed')
      assert.equal(Number(entry?.account_id), 1, 'a plain read after the lock sees the row the holder committed')
    })
  }

  it('lockWhere locks the visible rows the filters select, in id order', async () => {
    await seedLedger(fixture)
    await fixture.knex('da_entries').whereIn('id', [3, 1, 4, 7]).update({ status: 'held' })
    const entries = fixture.api.resources.da_entries
    await assert.rejects(entries.lockWhere({ filters: { status: 'held' } }, workspaceA()), isA(RestApiLockOutsideTransactionError))
    await fixture.api.transaction(async transaction => {
      // 4 is hidden by the row policy, 7 belongs to ws-b.
      const locked = await entries.lockWhere({ filters: { status: 'held' }, transaction }, workspaceA())
      assert.deepEqual(locked.data.map(record => [String(record.id), record.code]), [['1', 'E1'], ['3', 'E3']])
      const sparse = await entries.lockWhere({ filters: { status: 'held' }, transaction, queryParams: { fields: { da_entries: 'amount' } }, format: 'jsonapi' }, workspaceB())
      assert.deepEqual(sparse.data.map(record => [String(record.id), Object.keys(record.attributes)]), [['7', ['amount']]])
      assert.deepEqual((await entries.lockWhere({ filters: { status: 'none' }, transaction }, workspaceA())).data, [])
      await assert.rejects(entries.lockWhere({ filters: { label: 'x' }, transaction }, workspaceA()), isA(RestApiValidationError))
      await assert.rejects(
        fixture.api.resources.da_jobs.lockWhere({ filters: { state: 'queued' }, transaction }, { ...workspaceA(), joinPolicy: true }),
        error => isA(RestApiValidationError)(error) && JSON.stringify(cause(error).details).includes('lock_single_table')
      )
    })
  })

  it('lockByIds sorts a list longer than one statement before it chunks it', async () => {
    await seedLedger(fixture)
    // Listed backwards: each statement must still take a contiguous run, lowest first.
    const ids = Array.from({ length: 1003 }, (_, index) => String(1003 - index))
    const chunks = []
    const record = query => {
      const listed = (query.bindings || []).filter(value => /^\d+$/.test(String(value)) && /da_entries/.test(query.sql)).map(Number)
      if (listed.length > 2) chunks.push([Math.min(...listed), Math.max(...listed), listed.length])
    }
    fixture.knex.on('query', record)
    try {
      await fixture.api.transaction(async transaction => {
        const locked = await fixture.api.resources.da_entries.lockByIds({ ids, missing: 'skip', transaction }, workspaceA())
        assert.deepEqual(locked.data.map(row => String(row.id)), ['1', '2', '3'])
      })
    } finally { fixture.knex.removeListener('query', record) }
    assert.deepEqual(chunks.slice(0, 2), [[1, 1000, 1000], [1001, 1003, 3]])
  })

  it('lockWhere on MySQL forces an index that starts with the whole ownership or a filtered column', async () => {
    await seedJobs()
    const mysql = databaseClient === 'mysql2'
    const refused = error => isA(RestApiBulkWriteUnsupportedError)(error) && /index/.test(cause(error).message + JSON.stringify(cause(error).details))
    const jobs = () => fixture.api.transaction(transaction => fixture.api.resources.da_jobs.lockWhere({ filters: { state: 'queued' }, transaction }, workspaceA()))
    const lockSql = []
    const record = query => { if (/for update/i.test(query.sql)) lockSql.push(query.sql) }
    if (!mysql) {
      assert.deepEqual((await jobs()).data.map(item => String(item.id)).sort(), ['1', '2', '3', '5'])
      await fixture.api.transaction(async transaction => {
        assert.equal((await fixture.api.resources.da_entries.lockWhere({ filters: { status: 'open' }, transaction }, createSystemContext('lock every open entry'))).data.length, 9)
      })
      return
    }
    // da_jobs has no index that starts with workspace_id; without ownership
    // conditions the filters must use an index, and status has none.
    await assert.rejects(jobs(), refused)
    await fixture.api.transaction(async transaction => {
      await assert.rejects(fixture.api.resources.da_entries.lockWhere({ filters: { status: 'open' }, transaction }, createSystemContext('lock every open entry')), refused)
    })
    const [[{ version }]] = await fixture.knex.raw('select version() as version')
    const hidden = /mariadb/i.test(version) ? ['ignored', 'not ignored'] : ['invisible', 'visible']
    // A prefix of the owner column, or an index the optimizer may not use, does not count.
    await fixture.knex.raw('create index da_jobs_ws_prefix on da_jobs (workspace_id(2))')
    await assert.rejects(jobs(), refused)
    await fixture.knex.raw('drop index da_jobs_ws_prefix on da_jobs')
    await fixture.knex.raw('create index da_jobs_ws on da_jobs (workspace_id)')
    await fixture.knex.raw(`alter table da_jobs alter index da_jobs_ws ${hidden[0]}`)
    await assert.rejects(jobs(), refused)
    await fixture.knex.raw(`alter table da_jobs alter index da_jobs_ws ${hidden[1]}`)
    fixture.knex.on('query', record)
    try {
      assert.deepEqual((await jobs()).data.map(item => String(item.id)).sort(), ['1', '2', '3', '5'])
      await fixture.api.transaction(transaction => fixture.api.resources.da_entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA()))
    } finally { fixture.knex.removeListener('query', record) }
    const [{ name: entriesIndex }] = await fixture.knex('information_schema.statistics')
      .where({ table_schema: fixture.knex.raw('database()'), table_name: 'da_entries', column_name: 'workspace_id', seq_in_index: 1 })
      .select({ name: 'index_name' })
    assert.match(lockSql[0], /from `da_jobs` force index \(`da_jobs_ws`\)/)
    assert.ok(lockSql[1].includes(`from \`da_entries\` force index (\`${entriesIndex}\`)`), lockSql[1])
  })

  it('lockWhere on MySQL checks the index of the schema the connection uses', { skip: databaseClient !== 'mysql2' && 'MySQL and MariaDB only' }, async () => {
    await seedLedger(fixture)
    const refused = error => isA(RestApiBulkWriteUnsupportedError)(error) && /index/.test(cause(error).message + JSON.stringify(cause(error).details))
    const [[{ name: current }]] = await fixture.knex.raw('select database() as name')
    const other = `${current}_other`
    await fixture.knex.raw('create database ??', [other])
    try {
      // The other schema's da_entries has no index that starts with workspace_id.
      await fixture.knex.raw('create table ??.da_entries (id int primary key)', [other])
      const entries = fixture.api.resources.da_entries
      await fixture.api.transaction(async transaction => {
        await entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA())
        await transaction.raw('use ??', [other])
        try {
          await assert.rejects(entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA()), refused)
        } finally { await transaction.raw('use ??', [current]) }
      })
    } finally { await fixture.knex.raw('drop database ??', [other]) }
  })

  it('lockWhere locks a row that starts to match while it waits', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
    await seedLedger(fixture)
    await fixture.knex('da_entries').where({ id: 1 }).update({ status: 'held' })
    const entries = fixture.api.resources.da_entries
    const held = transaction => entries.lockWhere({ filters: { status: 'held' }, transaction }, workspaceA())
    const locked = await whileWaiting({
      hold: held,
      write: first => first('da_entries').insert(newEntry(100, { status: 'held' })),
      waiter: held
    })
    assert.deepEqual(locked.data.map(record => String(record.id)), ['1', '100'])
  })

  // A selection write is a compare-and-set on its filters: of two transactions
  // whose filters matched the same row, the second, waiting for the first's
  // lock, re-checks them on the row the first committed and changes nothing.
  for (const snapshotIsolation of isMysql ? ['OFF', 'ON'] : [undefined]) {
    const name = snapshotIsolation ? ` (innodb_snapshot_isolation ${snapshotIsolation})` : ''
    it(`patchWhere and deleteWhere re-check their filters on the row a concurrent writer committed${name}`, { skip: !serverDatabase && 'SQLite has one writer' }, async t => {
      if (snapshotIsolation) {
        try {
          await fixture.knex.raw('SELECT @@innodb_snapshot_isolation')
        } catch {
          return t.skip('the server has no innodb_snapshot_isolation')
        }
      }
      const entries = fixture.api.resources.da_entries
      const open = { filters: { code: 'E1', status: 'open' }, returning: 'count' }
      const take = transaction => entries.patchWhere({ ...open, data: { status: 'held' }, transaction }, workspaceA())
      const second = {
        patchWhere: transaction => entries.patchWhere({ ...open, data: { amount: 999 }, transaction }, workspaceA()),
        deleteWhere: transaction => entries.deleteWhere({ ...open, transaction }, workspaceA())
      }
      for (const [method, waiter] of Object.entries(second)) {
        await seedLedger(fixture)
        let first
        const outcome = await whileWaiting({ snapshotIsolation, hold: async transaction => { first = await take(transaction) }, write: () => {}, waiter })
          .then(result => result.meta.count, error => error)
        assert.equal(first.meta.count, 1)
        // With snapshot isolation, InnoDB refuses the stale row instead.
        if (snapshotIsolation === 'ON' && outcome instanceof Error) assert.match(String(cause(outcome)?.message), /changed since last read/i, method)
        else assert.equal(outcome, 0, method)
        const row = await fixture.knex('da_entries').where({ id: 1 }).first()
        assert.deepEqual({ status: row?.status, amount: Number(row?.amount) }, { status: 'held', amount: 10 }, method)
      }
    })
  }

  // A filter on another table's field is read through a derived table. PostgreSQL
  // reads it again once the row is locked; InnoDB would read it from the snapshot
  // without locking it, so MySQL and MariaDB refuse it in a selection write.
  it('re-checks a filter on another table on PostgreSQL, and MySQL and MariaDB refuse it', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const named = transaction => entries.patchWhere({ filters: { code: 'E1', accountName: 'A visible' }, data: { amount: 999 }, returning: 'count', transaction }, workspaceA())
    if (isMysql) {
      // The write and the transaction around it each wrap the refusal.
      const root = error => error?.cause ? root(error.cause) : error
      const refused = error => root(error) instanceof RestApiValidationError && root(error).details.violations.some(violation => violation.rule === 'selection_cross_table')
      // Refused whatever the data: also when no row matches.
      for (const write of [
        named,
        transaction => entries.deleteWhere({ filters: { accountName: 'A visible' }, transaction }, workspaceA()),
        transaction => entries.patchWhere({ filters: { accountName: 'No such account' }, data: { amount: 999 }, returning: 'count', transaction }, workspaceA()),
        transaction => entries.deleteWhere({ filters: { accountName: 'No such account' }, transaction }, workspaceA())
      ]) {
        await assert.rejects(fixture.api.transaction(write), refused)
      }
      assert.equal(Number((await fixture.knex('da_entries').where({ id: 1 }).first()).amount), 10)
      return
    }
    const outcome = await whileWaiting({
      hold: async transaction => {
        await transaction('da_entries').where({ id: 1 }).update({ amount: 5 })
        await transaction('da_accounts').where({ id: 1 }).update({ name: 'Renamed' })
      },
      write: () => {},
      waiter: named
    })
    assert.equal(outcome.meta.count, 0)
    assert.equal(Number((await fixture.knex('da_entries').where({ id: 1 }).first()).amount), 5)
  })

  // SQLite has one writer: the second selection write fails rather than waits, so it
  // cannot write over the first either.
  it('patchWhere and deleteWhere fail while a concurrent SQLite writer holds the row', { skip: serverDatabase && 'SQLite only' }, async () => {
    // A file database in WAL mode with busy_timeout 0: a second writer fails at once.
    const local = await createDataAccessFixture({ databaseOptions: { concurrent: true, maxConnections: 4 } })
    try {
      const busy = error => /SQLITE_BUSY|database is locked/.test(`${cause(error)?.code} ${cause(error)?.message}`)
      const entries = local.api.resources.da_entries
      const open = { filters: { code: 'E1', status: 'open' }, returning: 'count' }
      const second = {
        patchWhere: transaction => entries.patchWhere({ ...open, data: { amount: 999 }, transaction }, workspaceA()),
        deleteWhere: transaction => entries.deleteWhere({ ...open, transaction }, workspaceA())
      }
      for (const [method, waiter] of Object.entries(second)) {
        await seedLedger(local)
        await local.api.transaction(async transaction => {
          const first = await entries.patchWhere({ ...open, data: { status: 'held' }, transaction }, workspaceA())
          assert.equal(first.meta.count, 1)
          await assert.rejects(local.api.transaction(waiter), busy, method)
        })
        const row = await local.knex('da_entries').where({ id: 1 }).first()
        assert.deepEqual({ status: row?.status, amount: Number(row?.amount) }, { status: 'held', amount: 10 }, method)
      }
    } finally {
      await local.close()
    }
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

  it('takes the SQLite write lock, so another connection cannot write until the holder ends', { skip: databaseClient !== 'better-sqlite3' && 'SQLite only' }, async () => {
    // A file database in WAL mode with busy_timeout 0: a second writer fails at once.
    const local = await createDataAccessFixture({ databaseOptions: { concurrent: true, maxConnections: 4 } })
    try {
      await seedLedger(local)
      const busy = error => /SQLITE_BUSY|database is locked/.test(`${cause(error)?.code} ${cause(error)?.message}`)
      const otherWrite = () => local.knex.transaction(other => other('da_entries').where({ id: 2 }).update({ amount: 1 }))
      const locks = {
        lockByIds: transaction => local.api.resources.da_entries.lockByIds({ ids: ['1'], transaction }, workspaceA()),
        lockWhere: transaction => local.api.resources.da_entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA()),
        // No job matches: the write lock does not depend on the rows it finds.
        claim: transaction => local.api.resources.da_jobs.claim({ transaction }, workspaceA())
      }
      for (const [name, lock] of Object.entries(locks)) {
        await local.api.transaction(async transaction => {
          await lock(transaction)
          await assert.rejects(otherWrite(), busy, name)
        })
      }
      await otherWrite()
    } finally {
      await local.close()
    }
  })

  it('refuses a lock or claim whose filtering hook replaces the table', async () => {
    await seedJobs()
    const derived = { ...workspaceA(), deriveTable: true }
    const refusedAs = rule => error => isA(RestApiValidationError)(error) && JSON.stringify(cause(error).details).includes(rule)
    await fixture.api.transaction(async transaction => {
      await assert.rejects(fixture.api.resources.da_entries.lockByIds({ ids: ['1'], transaction }, derived), refusedAs('lock_single_table'))
      await assert.rejects(fixture.api.resources.da_entries.lockWhere({ filters: { status: 'open' }, transaction }, derived), refusedAs('lock_single_table'))
      await assert.rejects(fixture.api.resources.da_jobs.claim({ filters: { state: 'queued' }, transaction }, derived), refusedAs('claim_single_table'))
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

  // A parent row that child rows reference through a real foreign key.
  describe('lockMode', () => {
    const anyContext = () => ({})
    before(async () => {
      await fixture.knex.schema.createTable('da_lm_parents', table => {
        table.increments('id')
        // lockWhere on MySQL and MariaDB needs an index that starts with a filtered column.
        table.string('name', 40).notNullable().index()
        table.string('note', 40).nullable()
      })
      await fixture.knex.schema.createTable('da_lm_children', table => {
        table.increments('id')
        table.integer('parent_id').unsigned().notNullable().references('id').inTable('da_lm_parents')
      })
      await fixture.api.addResource('da_lm_parents', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true, max: 40, search: true },
          note: { type: 'string', nullable: true, max: 40 }
        },
        tableName: 'da_lm_parents'
      })
      await fixture.api.addResource('da_lm_children', {
        schema: {
          id: { type: 'id' },
          parent_id: { type: 'number', required: true, belongsTo: 'da_lm_parents', as: 'parent' }
        },
        tableName: 'da_lm_children'
      })
    })
    const seedParents = async () => {
      await fixture.knex('da_lm_children').delete()
      await fixture.knex('da_lm_parents').delete()
      await fixture.knex('da_lm_parents').insert([{ id: 1, name: 'p1' }, { id: 2, name: 'p2' }])
    }
    const parents = () => fixture.api.resources.da_lm_parents
    const holds = {
      lockByIds: (transaction, lockMode) => parents().lockByIds({ ids: ['1'], lockMode, transaction }, anyContext()),
      lockWhere: (transaction, lockMode) => parents().lockWhere({ filters: { name: 'p1' }, lockMode, transaction }, anyContext()),
      claim: (transaction, lockMode) => parents().claim({ filters: { name: 'p1' }, lockMode, transaction }, anyContext()),
      patchWhere: (transaction, lockMode) => parents().patchWhere({ filters: { name: 'p1' }, data: { note: 'held' }, lockMode, transaction }, anyContext())
    }
    // 'waits' when the work blocks on a row lock, 'proceeds' when it ends without one.
    const outcomeWhileHeld = async ({ hold, work }) => {
      const holder = await holdManagedTransaction(fixture.api)
      const other = await holdManagedTransaction(fixture.api)
      try {
        await hold(holder.transaction)
        const id = await connectionId(other.transaction)
        const pending = work(other.transaction)
        const outcome = await waitForLockWait(fixture.knex, id, pending).then(() => 'waits', () => pending.then(() => 'proceeds'))
        await holder.commit()
        const result = await pending
        await other.commit()
        return { outcome, result }
      } finally {
        for (const held of [holder, other]) if (!held.transaction.isCompleted()) await held.rollback()
      }
    }
    const insertChild = transaction => fixture.api.resources.da_lm_children.post({ data: { parent: '1' }, returning: 'none', transaction }, anyContext())

    it('refuses an unknown lock mode, and share on claim and patchWhere, before any statement', async () => {
      await seedParents()
      const control = /^\s*(begin|commit|rollback|savepoint|release|start transaction|set transaction)\b/i
      const statements = []
      const record = ({ sql }) => { if (!control.test(sql)) statements.push(sql) }
      fixture.knex.on('query', record)
      try {
        const refused = [...Object.keys(holds).map(name => [name, 'exclusive']), ['claim', 'share'], ['patchWhere', 'share']]
        for (const [name, lockMode] of refused) {
          const label = `${name} ${lockMode}`
          statements.length = 0
          let refusal
          // A refused patchWhere rolls back the transaction it joined, so each hold has its own.
          await fixture.api.transaction(async transaction => {
            refusal = await holds[name](transaction, lockMode).then(() => undefined, error => error)
            if (refusal) throw refusal
          }).catch(() => {})
          assert.equal(refusal?.code, 'REST_API_VALIDATION', label)
          assert.ok(JSON.stringify(refusal.details).includes('lockMode'), label)
          if (lockMode === 'share') assert.match(cause(refusal).message, new RegExp(`^${name} takes lockMode 'update' or 'noKeyUpdate', not 'share'`), label)
          assert.deepEqual(statements, [], label)
        }
        // The listener sees a transaction's statements.
        await fixture.api.transaction(transaction => transaction('da_lm_parents').count({ rows: '*' }))
        assert.equal(statements.length, 1)
      } finally {
        fixture.knex.off('query', record)
      }
    })

    it('holds child inserts with update, and lets them through with noKeyUpdate on PostgreSQL only', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      for (const [name, hold] of Object.entries(holds)) {
        for (const lockMode of [undefined, 'update', 'noKeyUpdate']) {
          await seedParents()
          const { outcome } = await outcomeWhileHeld({ hold: transaction => hold(transaction, lockMode), work: insertChild })
          // InnoDB's foreign key check takes a shared lock, which any exclusive lock blocks.
          const expected = lockMode === 'noKeyUpdate' && databaseClient === 'pg' ? 'proceeds' : 'waits'
          assert.equal(outcome, expected, `${name} ${lockMode ?? 'default'}`)
          assert.equal((await fixture.knex('da_lm_children').where({ parent_id: 1 })).length, 1)
        }
      }
    })

    it('with noKeyUpdate still holds the row against other locks and writes', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      const others = {
        'lockByIds update': transaction => holds.lockByIds(transaction, 'update'),
        'lockByIds noKeyUpdate': transaction => holds.lockByIds(transaction, 'noKeyUpdate'),
        patch: transaction => parents().patch({ id: '1', data: { note: 'changed' }, returning: 'none', transaction }, anyContext())
      }
      for (const [name, work] of Object.entries(others)) {
        await seedParents()
        const { outcome } = await outcomeWhileHeld({ hold: transaction => holds.lockByIds(transaction, 'noKeyUpdate'), work })
        assert.equal(outcome, 'waits', name)
      }
    })

    it('takes FOR SHARE with share (LOCK IN SHARE MODE on MySQL and MariaDB, the write lock alone on SQLite)', async () => {
      const lockClause = { pg: /\bfor share\b/i, mysql2: /\block in share mode\b/i }[databaseClient]
      for (const name of ['lockByIds', 'lockWhere']) {
        await seedParents()
        const { result, sql } = await fixture.measure(() => fixture.api.transaction(transaction => holds[name](transaction, 'share')))
        assert.deepEqual(result.data.map(record => String(record.id)), ['1'], name)
        const locking = sql.filter(statement => /\bfor (update|share|no key update|key share)\b|\block in share mode\b/i.test(statement))
        if (lockClause) assert.ok(locking.length > 0 && locking.every(statement => lockClause.test(statement)), `${name}: ${sql.join(' | ')}`)
        else assert.deepEqual(locking, [], name)
      }
    })

    it('with share lets reads, shared locks and child inserts through, and holds writes and exclusive locks', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      const others = {
        'lockByIds share': [transaction => holds.lockByIds(transaction, 'share'), 'proceeds'],
        'lockWhere share': [transaction => holds.lockWhere(transaction, 'share'), 'proceeds'],
        'plain read': [transaction => parents().get({ id: '1', transaction }, anyContext()), 'proceeds'],
        // PostgreSQL's foreign key check takes FOR KEY SHARE and InnoDB's a shared lock: neither waits for a shared lock.
        'child insert': [insertChild, 'proceeds'],
        'lockByIds update': [transaction => holds.lockByIds(transaction, 'update'), 'waits'],
        'lockByIds noKeyUpdate': [transaction => holds.lockByIds(transaction, 'noKeyUpdate'), 'waits'],
        'lockWhere update': [transaction => holds.lockWhere(transaction, 'update'), 'waits'],
        patch: [transaction => parents().patch({ id: '1', data: { note: 'changed' }, returning: 'none', transaction }, anyContext()), 'waits']
      }
      for (const holder of ['lockByIds', 'lockWhere']) {
        for (const [name, [work, expected]] of Object.entries(others)) {
          await seedParents()
          const { outcome } = await outcomeWhileHeld({ hold: transaction => holds[holder](transaction, 'share'), work })
          assert.equal(outcome, expected, `${holder} share, then ${name}`)
        }
      }
    })

    it('the lock helpers refuse an unknown mode instead of locking as for update', async () => {
      await seedParents()
      const lock = transaction => fixture.api.helpers.dataLockByIds({
        scopeName: 'da_lm_parents',
        context: { db: transaction, schemaInfo: parents().vars.schemaInfo, method: 'lockByIds', queryParams: {} },
        runHooks: async () => {},
        ids: ['1'],
        lockMode: 'exclusive'
      })
      await assert.rejects(fixture.api.transaction(lock), error => /^Unknown row lock mode "exclusive"/.test(cause(error).message))
    })

    it('claim with noKeyUpdate skips a row another transaction holds in any mode', { skip: !serverDatabase && 'SQLite has one writer' }, async () => {
      for (const lockMode of ['update', 'noKeyUpdate', 'share']) {
        await seedParents()
        const { outcome, result } = await outcomeWhileHeld({
          hold: transaction => holds.lockByIds(transaction, lockMode),
          work: transaction => parents().claim({ filters: {}, sort: ['id'], lockMode: 'noKeyUpdate', transaction }, anyContext())
        })
        assert.equal(outcome, 'proceeds', lockMode)
        assert.deepEqual(result.data.map(record => String(record.id)), ['2'], lockMode)
      }
    })
  })
})
