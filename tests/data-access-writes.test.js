import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  JsonRestApi,
  RestApiAnyapiKnexPlugin,
  RestApiPlugin,
  RowPolicyPlugin,
  RestApiBulkInsertIdsError,
  RestApiBulkWriteUnsupportedError,
  RestApiRecordsNotFoundError,
  RestApiResourceError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'
import { connectionId, waitForLockWait } from './helpers/lock-wait.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
// AnyAPI resources have no lock version, and the canonical table's only unique key is the id.
const noLockVersion = storageMode.isAnyApi() && 'AnyAPI resources have no lock version'
const idKeysOnly = storageMode.isAnyApi() && 'AnyAPI storage has a unique key only on the id'
// Rows on table storage keep their id type; a canonical logical id is text.
const rowsById = async (fixture, table, ids) => {
  const wanted = ids.map(String)
  return (await fixture.rows(table)).filter(row => wanted.includes(String(row.id)))
}

const newEntries = (count, { start = 100, account = 1 } = {}) => Array.from({ length: count }, (_, index) => ({
  code: `N${start + index}`,
  amount: start + index,
  access_group: 'g1',
  account
}))

describe(`Many-row writes (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })

  it('refuses row locks on AnyAPI storage', { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const refused = isA(RestApiBulkWriteUnsupportedError)
    await fixture.api.transaction(async transaction => {
      await assert.rejects(entries.lockByIds({ ids: ['1'], transaction }, workspaceA()), refused)
      await assert.rejects(entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA()), refused)
      await assert.rejects(entries.claim({ transaction }, workspaceA()), refused)
    })
  })

  describe('postMany', () => {
    it('stamps the owner, checks every row and returns ids in input order', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      assert.equal(await entries.postMany({ data: newEntries(2) }, workspaceA()), undefined, "returning defaults to 'none'")
      const minimal = await entries.postMany({ data: newEntries(3, { start: 200 }), returning: 'minimal' }, workspaceA())
      assert.equal(minimal.data.length, 3)
      const created = await rowsById(fixture, 'da_entries', minimal.data.map(item => item.id))
      assert.deepEqual(created.map(row => [row.code, row.workspace_id]), [['N200', 'ws-a'], ['N201', 'ws-a'], ['N202', 'ws-a']])
      assert.deepEqual(minimal.data.map(item => item.type), ['da_entries', 'da_entries', 'da_entries'])

      const full = await entries.postMany({ data: newEntries(2, { start: 300 }), returning: 'full' }, workspaceA())
      assert.deepEqual(full.data.map(record => record.code), ['N300', 'N301'])
      assert.equal(full.data[0].workspace_id, 'ws-a')
      assert.equal(String(full.data[0].account.id), '1')

      const jsonapi = await entries.postMany({ data: newEntries(1, { start: 400 }), returning: 'full', format: 'jsonapi' }, workspaceA())
      assert.equal(jsonapi.data[0].attributes.code, 'N400')
    })

    it('runs one INSERT per chunk: 10 and 200 rows cost the same statements', async () => {
      const entries = fixture.api.resources.da_entries
      await seedLedger(fixture)
      const small = await fixture.measure(() => entries.postMany({ data: newEntries(10), returning: 'minimal' }, workspaceA()))
      await seedLedger(fixture)
      const large = await fixture.measure(() => entries.postMany({ data: newEntries(200), returning: 'minimal' }, workspaceA()))
      assert.equal(small.result.data.length, 10)
      assert.equal(large.result.data.length, 200)
      assert.equal(large.statements, small.statements, `10 rows: ${small.sql.join(' | ')}\n200 rows: ${large.sql.join(' | ')}`)

      const rows = await rowsById(fixture, 'da_entries', large.result.data.map(item => item.id))
      assert.deepEqual(rows.map(row => row.code), newEntries(200).map(entry => entry.code), 'every returned id names its input row')

      await seedLedger(fixture)
      const chunked = await fixture.measure(() => entries.postMany({ data: newEntries(200), chunkSize: 50 }, workspaceA()))
      const inserts = chunked.sql.filter(sql => /^insert/i.test(sql))
      assert.equal(inserts.length, 4, 'chunkSize 50 splits 200 rows into 4 INSERTs')
    })

    it('rolls back the whole batch on one bad row and names its index', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const rows = newEntries(6)
      delete rows[4].amount
      await assert.rejects(entries.postMany({ data: rows }, workspaceA()), error => {
        const failure = cause(error)
        return failure instanceof RestApiValidationError && JSON.stringify(failure.details).includes('data.4.')
      })
      assert.equal((await fixture.rows('da_entries')).length, 9, 'nothing was inserted')
    })

    it('keeps rows inside the caller scope', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      // Another workspace's account and a hidden account are not valid parents.
      await assert.rejects(entries.postMany({ data: newEntries(2, { account: 3 }) }, workspaceA()))
      await assert.rejects(entries.postMany({ data: newEntries(2, { account: 2 }) }, workspaceA()))
      // Ownership cannot be set to another workspace.
      await assert.rejects(entries.postMany({ data: [{ ...newEntries(1)[0], workspace_id: 'ws-b' }] }, workspaceA()))
      assert.equal((await fixture.rows('da_entries')).length, 9)

      await assert.rejects(
        entries.postMany({ data: newEntries(1) }, createSystemContext('import')),
        error => JSON.stringify(cause(error).details || {}).includes('system_ownership_required')
      )
      const imported = await entries.postMany({ data: [{ ...newEntries(1, { account: 3 })[0], workspace_id: 'ws-b' }], returning: 'full' }, createSystemContext('import'))
      assert.equal(imported.data[0].workspace_id, 'ws-b')
    })

    it('runs permission checks per row', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const seen = []
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'data-access-deny-big',
            handler: ({ context }) => {
              const original = context.originalContext
              if (!original?.permissionLog) return
              original.permissionLog.push(original.method)
              if (original.method === 'post' && original.inputRecord?.data?.attributes?.amount > 1000) throw new Error('too big')
            }
          }
        }
      })
      await assert.rejects(entries.postMany({ data: [...newEntries(2), newEntries(1, { start: 5000 })[0]] }, { ...workspaceA(), permissionLog: seen }))
      // The shared parent account is checked once for the batch, then each row.
      assert.deepEqual(seen, ['get', 'post', 'post', 'post'])
      assert.equal((await fixture.rows('da_entries')).length, 9)
    })

    describe('upserts (R1)', () => {
      it('refuses conflict keys without the ownership field and merge under a row policy', async () => {
        await seedLedger(fixture)
        const entries = fixture.api.resources.da_entries
        const refused = isA(RestApiBulkWriteUnsupportedError)
        await assert.rejects(entries.postMany({ data: newEntries(1), onConflict: { keys: ['code'], action: 'ignore' } }, workspaceA()), refused)
        await assert.rejects(entries.postMany({ data: newEntries(1), onConflict: { keys: ['workspace_id', 'code'], action: 'merge' } }, workspaceA()), refused)
        await assert.rejects(
          fixture.api.resources.da_labels.postMany({ data: [{ name: 'x' }], onConflict: { keys: ['name'], action: 'merge' } }, workspaceA()),
          refused
        )
        await assert.rejects(
          fixture.api.resources.da_labels.postMany({ data: [{ name: 'x' }], onConflict: { keys: ['workspace_id', 'name'], action: 'merge', merge: ['workspace_id'] } }, workspaceA()),
          isA(RestApiValidationError)
        )
        assert.equal((await fixture.rows('da_entries')).length, 9)
      })

      it('ignores the caller own duplicates and reports only inserted rows', { skip: idKeysOnly }, async () => {
        await seedLedger(fixture)
        const entries = fixture.api.resources.da_entries
        const rows = [
          { code: 'E1', amount: 999, access_group: 'g1', account: 1 },
          { code: 'E7', amount: 777, access_group: 'g1', account: 1 },
          { code: 'NEW', amount: 5, access_group: 'g1', account: 1 }
        ]
        const result = await entries.postMany({ data: rows, returning: 'minimal', onConflict: { keys: ['workspace_id', 'code'], action: 'ignore' } }, workspaceA())
        assert.equal(result.data.length, 2, 'E1 is ws-a\'s own and was ignored; E7 belongs to ws-b, so ws-a gets its own E7')
        const stored = await fixture.knex('da_entries').whereIn('id', result.data.map(item => item.id)).orderBy('id')
        assert.deepEqual(stored.map(row => [row.code, row.workspace_id]), [['E7', 'ws-a'], ['NEW', 'ws-a']])
        const original = await fixture.knex('da_entries').where({ code: 'E1' }).first()
        assert.equal(Number(original.amount), 10, 'the ignored row is untouched')
        const theirs = await fixture.knex('da_entries').where({ code: 'E7', workspace_id: 'ws-b' }).first()
        assert.equal(Number(theirs.amount), 70, 'another workspace\'s row is untouched')
      })

      it('merges into the caller own rows only and never through another unique index', { skip: idKeysOnly }, async () => {
        await fixture.reset()
        await fixture.seed('da_labels', [
          { id: '1', name: 'urgent', color: 'red', slug: 'a-urgent', workspace_id: 'ws-a' },
          { id: '2', name: 'urgent', color: 'blue', slug: 'b-urgent', workspace_id: 'ws-b' },
          { id: '3', name: 'urgent', color: 'grey', slug: 'shared-urgent', workspace_id: null }
        ])
        const labels = fixture.api.resources.da_labels
        const merged = await labels.postMany({
          data: [{ name: 'urgent', color: 'orange' }, { name: 'later', color: 'green', slug: 'a-later' }],
          returning: 'full',
          onConflict: { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] }
        }, workspaceA())
        assert.deepEqual(merged.data.map(record => [String(record.id) === '1', record.name, record.color]), [[true, 'urgent', 'orange'], [false, 'later', 'green']])
        const after = await fixture.rows('da_labels')
        assert.deepEqual(after.filter(row => row.name === 'urgent').map(row => [row.workspace_id, row.color]), [['ws-a', 'orange'], ['ws-b', 'blue'], [null, 'grey']])

        // A row that collides with another workspace's slug must not merge into it or vanish.
        for (const action of ['ignore', 'merge']) {
          await assert.rejects(labels.postMany({
            data: [{ name: 'stolen', color: 'black', slug: 'b-urgent' }],
            onConflict: { keys: ['workspace_id', 'name'], action, ...(action === 'merge' ? { merge: ['color'] } : {}) }
          }, workspaceA()))
          const theirs = await fixture.knex('da_labels').where({ id: 2 }).first()
          assert.deepEqual([theirs.name, theirs.color, theirs.workspace_id], ['urgent', 'blue', 'ws-b'], action)
          assert.equal((await fixture.knex('da_labels').where({ name: 'stolen' })).length, 0, action)
        }
      })

      it('upserts on keys that add the ownership field to a unique index on fewer columns', { skip: idKeysOnly }, async () => {
        await fixture.reset()
        await fixture.seed('da_labels', [
          { id: '1', name: 'urgent', color: 'red', slug: 'a-urgent', workspace_id: 'ws-a' },
          { id: '2', name: 'urgent', color: 'blue', slug: 'b-urgent', workspace_id: 'ws-b' }
        ])
        const labels = fixture.api.resources.da_labels
        // The unique index on the slug is on the slug alone, without workspace_id.
        const bySlug = action => ({ keys: ['workspace_id', 'slug'], action, ...(action === 'merge' ? { merge: ['color'] } : {}) })
        const ignored = await labels.postMany({
          data: [{ name: 'again', color: 'black', slug: 'a-urgent' }, { name: 'fresh', color: 'green', slug: 'a-fresh' }],
          returning: 'full',
          onConflict: bySlug('ignore')
        }, workspaceA())
        assert.deepEqual(ignored.data.map(record => record.slug), ['a-fresh'])
        const merged = await labels.postMany({
          data: [{ name: 'urgent', color: 'orange', slug: 'a-urgent' }, { name: 'later', color: 'white', slug: 'a-later' }],
          returning: 'full',
          onConflict: bySlug('merge')
        }, workspaceA())
        assert.deepEqual(merged.data.map(record => [record.slug, record.color]), [['a-urgent', 'orange'], ['a-later', 'white']])
        // Another workspace's slug clashes on the index without matching the keys: the batch fails.
        for (const action of ['ignore', 'merge']) {
          await assert.rejects(labels.postMany({ data: [{ name: 'stolen', color: 'black', slug: 'b-urgent' }], onConflict: bySlug(action) }, workspaceA()), action)
        }
        const after = await fixture.knex('da_labels').orderBy('slug')
        assert.deepEqual(after.map(row => [row.slug, row.name, row.color, row.workspace_id]), [
          ['a-fresh', 'fresh', 'green', 'ws-a'],
          ['a-later', 'later', 'white', 'ws-a'],
          ['a-urgent', 'urgent', 'orange', 'ws-a'],
          ['b-urgent', 'urgent', 'blue', 'ws-b']
        ])
      })

      it('inserts an ignore row with the id it carries, skips a duplicate by the keys, and fails on an id another row has', { skip: idKeysOnly }, async () => {
        await fixture.reset()
        await fixture.seed('da_labels', [
          { id: '1', name: 'urgent', color: 'red', slug: 'a-urgent', workspace_id: 'ws-a' },
          { id: '2', name: 'urgent', color: 'blue', slug: 'b-urgent', workspace_id: 'ws-b' }
        ])
        const labels = fixture.api.resources.da_labels
        const byName = action => ({ keys: ['workspace_id', 'name'], action, ...(action === 'merge' ? { merge: ['color'] } : {}) })
        const ignored = await labels.postMany({
          data: [{ id: '7', name: 'urgent', color: 'black', slug: 'a-again' }, { id: '8', name: 'fresh', color: 'green', slug: 'a-fresh' }],
          returning: 'minimal',
          onConflict: byName('ignore')
        }, workspaceA())
        assert.deepEqual(ignored.data.map(item => String(item.id)), ['8'])
        // Row 1's id under other keys, and another workspace's row 2's: a duplicate each, never skipped.
        const duplicate = (error) => {
          for (let cause = error; cause; cause = cause.cause) {
            if (['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(cause.code)) return true
          }
          return false
        }
        for (const id of ['1', '2']) {
          await assert.rejects(labels.postMany({ data: [{ id, name: 'other', color: 'white' }], onConflict: byName('ignore') }, workspaceA()), duplicate, id)
        }
        await assert.rejects(labels.postMany({ data: [{ id: '9', name: 'urgent', color: 'pink' }], onConflict: byName('merge') }, workspaceA()), isA(RestApiValidationError))
        const after = await fixture.knex('da_labels').orderBy('id')
        assert.deepEqual(after.map(row => [String(row.id), row.name, row.color, row.workspace_id]), [
          ['1', 'urgent', 'red', 'ws-a'],
          ['2', 'urgent', 'blue', 'ws-b'],
          ['8', 'fresh', 'green', 'ws-a']
        ])
      })
    })

    it('verifies MySQL insert ids against the inserted rows', { skip: databaseClient !== 'mysql2' && 'MySQL and MariaDB only' }, async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const knex = fixture.knex
      const { capabilities } = fixture.api.knex
      const mariadb = /mariadb/i.test(capabilities.dbInfo.version)
      // MariaDB 10.5+ returns ids with INSERT … RETURNING; MySQL derives them from
      // insertId and the increment, then reads them back. A MariaDB server can run
      // the MySQL path by reporting a MySQL version.
      const asMysql = async work => {
        fixture.api.knex.capabilities = { ...capabilities, dbInfo: { ...capabilities.dbInfo, version: '8.4.11' } }
        try { return await work() } finally { fixture.api.knex.capabilities = capabilities }
      }
      const paths = mariadb ? [['RETURNING', work => work()], ['insertId', asMysql]] : [['insertId', work => work()]]
      for (const [path, run] of paths) {
        await seedLedger(fixture)
        // A server stepping ids by 2 still yields the right ids.
        await run(() => fixture.api.transaction(async transaction => {
          await transaction.raw('SET SESSION auto_increment_increment = 2')
          const result = await entries.postMany({ data: newEntries(5), returning: 'minimal', transaction }, workspaceA())
          const codes = await stored(fixture, 'da_entries', transaction).values('code')
          assert.deepEqual(result.data.map(item => codes[item.id]), newEntries(5).map(entry => entry.code), path)
          await transaction.raw('SET SESSION auto_increment_increment = 1')
        }))
        // A trigger that rewrites rows: RETURNING still names them, but insertId
        // cannot be verified, so that path refuses the batch and rolls back.
        const table = stored(fixture, 'da_entries')
        const code = table.column('code')
        await knex.raw("CREATE TRIGGER da_entries_rewrite BEFORE INSERT ON ?? FOR EACH ROW SET NEW.?? = CONCAT(NEW.??, '-x')", [table.name, code, code])
        try {
          const before = (await fixture.rows('da_entries')).length
          const write = () => entries.postMany({ data: newEntries(3, { start: 700 }), returning: 'minimal' }, workspaceA())
          if (path === 'insertId') {
            await assert.rejects(run(write), isA(RestApiBulkInsertIdsError))
            assert.equal((await fixture.rows('da_entries')).length, before)
          } else {
            const result = await run(write)
            const codes = await table.values('code')
            assert.deepEqual(result.data.map(item => codes[item.id]), ['N700-x', 'N701-x', 'N702-x'])
          }
        } finally {
          await knex.raw('DROP TRIGGER da_entries_rewrite')
        }
      }
    })
  })

  describe('patchMany, patchWhereIds and patchWhere', () => {
    it('updates each row by id with one statement per chunk and advances the lock version', async () => {
      const entries = fixture.api.resources.da_entries
      const patchRows = count => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), amount: 1000 + index, status: index % 2 ? 'held' : 'open' }))

      await seedLedger(fixture, { entriesPerAccount: 10 })
      const small = await fixture.measure(() => entries.patchMany({ data: patchRows(10), returning: 'minimal' }, { ...workspaceA(), visibility: { all: true } }))
      await seedLedger(fixture, { entriesPerAccount: 200 })
      const large = await fixture.measure(() => entries.patchMany({ data: patchRows(200), returning: 'minimal' }, { ...workspaceA(), visibility: { all: true } }))
      assert.equal(small.result.data.length, 10)
      assert.equal(large.result.data.length, 200)
      assert.equal(large.statements, small.statements, `10 rows: ${small.sql.join(' | ')}\n200 rows: ${large.sql.join(' | ')}`)

      const rows = await rowsById(fixture, 'da_entries', [1, 2, 3])
      assert.deepEqual(rows.map(row => [Number(row.amount), row.status]), [[1000, 'open'], [1001, 'held'], [1002, 'open']])
      if (!noLockVersion) assert.deepEqual(rows.map(row => Number(row.lock_version)), [1, 1, 1])
    })

    it('finds only the caller rows and refuses or skips the rest', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      // 4 is hidden by the row policy, 7 belongs to ws-b, 99 does not exist.
      for (const id of ['4', '7', '99']) {
        await assert.rejects(
          entries.patchMany({ data: [{ id: '1', amount: 1 }, { id, amount: 1 }] }, workspaceA()),
          error => cause(error) instanceof RestApiRecordsNotFoundError && cause(error).details.missing === 1 && !JSON.stringify(cause(error).details).includes(`"${id}"`)
        )
      }
      assert.equal(Number((await rowsById(fixture, 'da_entries', [1]))[0].amount), 10, 'refusals roll back')
      const skipped = await entries.patchWhereIds({ ids: ['1', '4', '7'], data: { status: 'held' }, missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(skipped.data.map(item => item.id), ['1'])
      const statuses = (await rowsById(fixture, 'da_entries', [1, 4, 7])).map(row => row.status)
      assert.deepEqual(statuses, ['held', 'open', 'open'])
    })

    it('refuses ownership, identity and lock-version input', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const invalid = isA(RestApiValidationError)
      await assert.rejects(entries.patchMany({ data: [{ id: '1', workspace_id: 'ws-b' }] }, workspaceA()), invalid)
      await assert.rejects(entries.patchMany({ data: [{ id: '1', lock_version: 9 }] }, workspaceA()), invalid)
      await assert.rejects(entries.patchWhereIds({ ids: ['1'], data: { id: '5' } }, workspaceA()), invalid)
      await assert.rejects(entries.patchWhereIds({ ids: ['1', '1'], data: { amount: 1 } }, workspaceA()), invalid)
      await assert.rejects(entries.patchMany({ data: [{ id: '1', amount: 'many' }] }, workspaceA()), invalid)
      await assert.rejects(fixture.api.resources.da_accounts.patchMany({ data: [{ id: '1' }] }, workspaceA()), invalid, 'an empty patch row')
    })

    it('advances the lock version of a row with no fields to change', { skip: noLockVersion }, async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const touched = await entries.patchMany({ data: [{ id: '1' }, { id: '2' }], missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(touched.data.map(item => item.id), ['1', '2'])
      // As a compare-and-set, the version it advances is the condition.
      const claimed = await entries.patchWhereIds({ ids: ['1', '3'], data: {}, onlyIf: { lock_version: 0 }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(claimed.data.map(item => item.id), ['3'])
      const rows = await fixture.knex('da_entries').whereIn('id', [1, 2, 3]).orderBy('id')
      assert.deepEqual(rows.map(row => [Number(row.amount), Number(row.lock_version)]), [[10, 1], [20, 1], [30, 1]])
    })

    it('applies onlyIf as compare-and-set and returns only the changed ids', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const table = stored(fixture, 'da_entries')
      await table.row('2').update({ [table.column('status')]: 'held' })
      const result = await entries.patchWhereIds({ ids: ['1', '2', '3'], data: { status: 'closed' }, onlyIf: { status: 'open' }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(result.data.map(item => item.id).sort(), ['1', '3'])
      const rows = await rowsById(fixture, 'da_entries', [1, 2, 3])
      assert.deepEqual(rows.map(row => row.status), ['closed', 'held', 'closed'])
      if (noLockVersion) return
      assert.deepEqual(rows.map(row => Number(row.lock_version)), [1, 0, 1])

      // The lock version is the usual compare-and-set column.
      const stale = await entries.patchWhereIds({ ids: ['1'], data: { amount: 5 }, onlyIf: { lock_version: 0 }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(stale.data, [])
    })

    it('accepts raw expressions for stored fields', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const knex = fixture.knex
      // A raw expression names stored columns: on AnyAPI, the field's slot.
      const amount = stored(fixture, 'da_entries').column('amount')
      await entries.patchWhereIds({ ids: ['1', '2'], data: { amount: knex.raw('?? + ?', [amount, 5]) } }, workspaceA())
      assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 2])).map(row => Number(row.amount)), [15, 25])
      await assert.rejects(entries.patchWhereIds({ ids: ['1'], data: { account: knex.raw('1') } }, workspaceA()), isA(RestApiValidationError))
    })

    it('patches every row a filter selects inside the scope', async () => {
      await seedLedger(fixture, { entriesPerAccount: 30 })
      const entries = fixture.api.resources.da_entries
      const result = await entries.patchWhere({ filters: { status: 'open' }, data: { status: 'archived' }, returning: 'minimal' }, workspaceA())
      assert.equal(result.data.length, 30)
      const counts = new Map()
      for (const row of await fixture.rows('da_entries')) {
        const key = JSON.stringify([row.workspace_id, row.access_group, row.status])
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      assert.deepEqual([...counts].sort().map(([key, total]) => [...JSON.parse(key), total]), [
        ['ws-a', 'g1', 'archived', 30], ['ws-a', 'g2', 'open', 30], ['ws-b', 'g1', 'open', 30]
      ])
      const none = await entries.patchWhere({ filters: { status: 'open' }, data: { status: 'x' }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(none.data, [])
      await assert.rejects(entries.patchWhere({ filters: { unknown_field: 1 }, data: { status: 'x' } }, workspaceA()), isA(RestApiValidationError))
    })

    it('advances the lock version on single writes too', { skip: noLockVersion }, async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const patched = await entries.patch({ id: '1', data: { amount: 11 } }, workspaceA())
      assert.equal(Number(patched.lock_version), 1)
      const put = await entries.put({ id: '1', data: { code: 'E1', amount: 12, status: 'open', access_group: 'g1', account: 1, lock_version: 50 } }, workspaceA())
      assert.equal(Number(put.lock_version), 2, 'input cannot set the lock version')
      const omitted = await entries.put({ id: '1', data: { code: 'E1', amount: 13, status: 'open', access_group: 'g1', account: 1 } }, workspaceA())
      assert.equal(Number(omitted.lock_version), 3, 'a PUT need not repeat the lock version')
    })
  })

  describe('deleteMany and deleteWhere', () => {
    it('deletes visible rows by id with flat statement counts and removes their links', async () => {
      const entries = fixture.api.resources.da_entries
      await seedLedger(fixture, { entriesPerAccount: 10 })
      const small = await fixture.measure(() => entries.deleteMany({ ids: Array.from({ length: 10 }, (_, index) => String(index + 1)), returning: 'minimal' }, workspaceA()))
      await seedLedger(fixture, { entriesPerAccount: 200 })
      await fixture.seed('da_labels', [{ id: '1', name: 'flag', workspace_id: 'ws-a' }])
      if (storageMode.isAnyApi()) {
        // AnyAPI keeps many-to-many links in its link table.
        for (const id of ['1', '250']) {
          await fixture.api.anyapi.links.attachMany({ scopeName: 'da_entries', relName: 'labels', context: { id, db: fixture.knex }, relData: [{ type: 'da_labels', id: '1' }] })
        }
      } else {
        await fixture.seed('da_entry_labels', [{ id: '1', entry_id: 1, label_id: 1 }, { id: '2', entry_id: 250, label_id: 1 }])
      }
      const large = await fixture.measure(() => entries.deleteMany({ ids: Array.from({ length: 200 }, (_, index) => String(index + 1)), returning: 'minimal' }, workspaceA()))
      assert.equal(small.result.data.length, 10)
      assert.equal(large.result.data.length, 200)
      assert.equal(large.statements, small.statements, `10 rows: ${small.sql.join(' | ')}\n200 rows: ${large.sql.join(' | ')}`)
      assert.deepEqual((await fixture.rows('da_entry_labels')).map(row => Number(row.entry_id)), [250])
    })

    it('refuses or skips rows outside the scope', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      await assert.rejects(entries.deleteMany({ ids: ['1', '4'] }, workspaceA()), isA(RestApiRecordsNotFoundError))
      await assert.rejects(entries.deleteMany({ ids: ['1', '7'] }, workspaceA()), isA(RestApiRecordsNotFoundError))
      assert.equal((await fixture.rows('da_entries')).length, 9)
      const skipped = await entries.deleteMany({ ids: ['1', '4', '7'], missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(skipped.data, [{ type: 'da_entries', id: '1' }])
      await assert.rejects(entries.deleteMany({ ids: ['2'], returning: 'full' }, workspaceA()), isA(RestApiValidationError))
    })

    it('deletes every row a filter selects inside the scope', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      assert.equal(await entries.deleteWhere({ filters: { status: 'open' } }, workspaceB()), undefined)
      const remaining = await fixture.rows('da_entries')
      assert.deepEqual(remaining.map(row => Number(row.id)), [1, 2, 3, 4, 5, 6])
      const system = await entries.deleteWhere({ filters: { access_group: 'g2' }, returning: 'minimal' }, createSystemContext('purge hidden group'))
      assert.deepEqual(system.data.map(item => item.id), ['4', '5', '6'])
    })
  })

  describe('batch hooks', () => {
    it('refuses resources with per-record hooks that have no batch form', async () => {
      await seedLedger(fixture)
      await fixture.api.addResource('da_hooked', {
        schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 } },
        tableName: 'da_hooked',
        hooks: {
          beforeDataCallPatch: { functionName: 'per-record-only', handler: () => {} },
          beforeDataCallPost: { functionName: 'batchable', batch: true, handler: () => {} }
        }
      })
      await fixture.api.resources.da_hooked.createKnexTable()
      const hooked = fixture.api.resources.da_hooked
      await hooked.post({ data: { name: 'one' } })
      // The hook names reach server code through details, not the message HTTP clients see.
      await assert.rejects(hooked.patchMany({ data: [{ id: '1', name: 'x' }] }), error =>
        cause(error) instanceof RestApiBulkWriteUnsupportedError && !cause(error).message.includes('per-record-only') &&
        cause(error).details.hooks.includes('beforeDataCallPatch:per-record-only'))
      // A hook marked batch: true does not block, and other resources are unaffected.
      const created = await hooked.postMany({ data: [{ name: 'two' }, { name: 'three' }], returning: 'minimal' })
      assert.equal(created.data.length, 2)
      await fixture.api.resources.da_entries.patchMany({ data: [{ id: '1', amount: 3 }] }, workspaceA())
    })

    it('runs batch hooks once per operation with every id', async () => {
      await seedLedger(fixture)
      const calls = []
      const auditHook = event => ({
        functionName: `data-access-audit-${event}`,
        handler: ({ context }) => {
          if (context.auditTrail) calls.push([event, context.method, (context.ids || []).length])
        }
      })
      for (const event of ['beforeDataCallPostMany', 'afterDataCallPostMany', 'afterDataCallPatchMany', 'afterDataCallDeleteMany', 'afterCommit']) {
        await fixture.api.customize({ hooks: { [event]: auditHook(event) } })
      }
      const audit = { ...workspaceA(), auditTrail: true }
      await fixture.api.resources.da_entries.postMany({ data: newEntries(3) }, audit)
      await fixture.api.resources.da_entries.patchWhereIds({ ids: ['1', '2'], data: { amount: 1 } }, audit)
      await fixture.api.resources.da_entries.deleteMany({ ids: ['1'] }, audit)
      assert.deepEqual(calls, [
        ['beforeDataCallPostMany', 'postMany', 0],
        ['afterDataCallPostMany', 'postMany', 3],
        ['afterCommit', 'postMany', 3],
        ['afterDataCallPatchMany', 'patchWhereIds', 2],
        ['afterCommit', 'patchWhereIds', 2],
        ['afterDataCallDeleteMany', 'deleteMany', 1],
        ['afterCommit', 'deleteMany', 1]
      ])
    })
  })

  it('serves the second workspace the same way', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const created = await entries.postMany({ data: newEntries(2, { account: 3 }), returning: 'minimal' }, workspaceB())
    await entries.patchWhereIds({ ids: ['7', ...created.data.map(item => item.id)], data: { status: 'held' } }, workspaceB())
    await assert.rejects(entries.patchWhereIds({ ids: ['1'], data: { status: 'held' } }, workspaceB()), isA(RestApiRecordsNotFoundError))
    const held = (await fixture.rows('da_entries')).filter(row => row.status === 'held').map(row => row.workspace_id)
    assert.deepEqual(held, ['ws-b', 'ws-b', 'ws-b'])
  })
})

// A fixture of its own: the one above gains permission and batch hooks, which
// keep the visibility read.
describe(`Many-row writes that skip missing rows (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })

  it('carries the scope in the UPDATE or DELETE instead of reading the visible ids first', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    // MySQL keeps the visibility read for listed ids: InnoDB would lock every listed row first.
    const saved = databaseClient === 'mysql2' ? 0 : 1
    // 4 is hidden by the row policy, 7 belongs to ws-b, 99 does not exist.
    const patched = await fixture.measure(() => entries.patchWhereIds({ ids: ['1', '4', '7', '99'], data: { status: 'held' }, missing: 'skip', returning: 'minimal' }, workspaceA()))
    assert.deepEqual(patched.result.data.map(item => item.id), ['1'])
    assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 4, 7])).map(row => row.status), ['held', 'open', 'open'])
    const refused = await fixture.measure(() => entries.patchWhereIds({ ids: ['2', '3'], data: { status: 'held' }, returning: 'minimal' }, workspaceA()))
    // On MySQL the one row left is written by an UPDATE that answers from its count, without a locking read first.
    assert.equal(patched.statements, refused.statements - 1, `skip: ${patched.sql.join(' | ')}\nthrow: ${refused.sql.join(' | ')}`)

    const deleted = await fixture.measure(() => entries.deleteMany({ ids: ['1', '4', '7', '99'], missing: 'skip', returning: 'minimal' }, workspaceA()))
    assert.deepEqual(deleted.result.data, [{ type: 'da_entries', id: '1' }])
    assert.deepEqual((await fixture.rows('da_entries')).map(row => Number(row.id)), [2, 3, 4, 5, 6, 7, 8, 9])
    const removed = await fixture.measure(() => entries.deleteMany({ ids: ['2', '3'], returning: 'minimal' }, workspaceA()))
    assert.equal(deleted.statements, removed.statements - saved, `skip: ${deleted.sql.join(' | ')}\nthrow: ${removed.sql.join(' | ')}`)

    // onlyIf narrows the scoped statement too.
    const guarded = await entries.patchWhereIds({ ids: ['5', '6'], data: { status: 'held' }, onlyIf: { amount: 50 }, missing: 'skip', returning: 'minimal' }, { ...workspaceA(), visibility: { all: true } })
    assert.deepEqual(guarded.data.map(item => item.id), ['5'])
  })
})

// Each statement's first word: begin, select, insert, update, delete, commit or rollback.
const kinds = sql => sql.map(statement => statement.trim().split(/\s/)[0].replace(';', '').toLowerCase())
const notFound = error => cause(error) instanceof RestApiResourceError && cause(error).subtype === 'not_found'
// A resource's stored rows on table or AnyAPI storage, through `db` (a transaction, say).
const stored = (fixture, scopeName, db = fixture.knex) => {
  const adapter = fixture.api.knex.helpers.getStorageAdapter(scopeName)
  const rows = () => adapter.buildBaseQuery({ transaction: db })
  return {
    name: adapter.getTableName(),
    rows,
    row: id => rows().where(adapter.getIdColumn(), adapter.translateFilterValue('id', id)),
    column: field => adapter.translateColumn(field),
    // One field of every row, by id.
    values: async field => Object.fromEntries((await rows().select({ id: adapter.getIdColumn(), value: adapter.translateColumn(field) })).map(row => [String(row.id), row.value]))
  }
}

// A fixture of its own: the last test adds hooks.
describe(`One-record write statements (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })

  it('reads the row once before its UPDATE, and again only for a full response', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    for (const returning of ['none', 'minimal']) {
      const patched = await fixture.measure(() => entries.patch({ id: '1', data: { amount: 11 }, returning }, workspaceA()))
      assert.deepEqual(kinds(patched.sql), ['begin', 'select', 'update', 'commit'], patched.sql.join(' | '))
    }
    const full = await fixture.measure(() => entries.patch({ id: '1', data: { amount: 12 } }, workspaceA()))
    assert.equal(full.result.amount, 12)
    const write = kinds(full.sql).indexOf('update')
    assert.deepEqual(kinds(full.sql).slice(0, write + 1), ['begin', 'select', 'update'], full.sql.join(' | '))
    assert.ok(kinds(full.sql).slice(write + 1, -1).every(kind => kind === 'select'), 'the response reads the written record')

    // Hidden by the row policy, in another workspace, or missing: not found from that one read.
    for (const id of ['4', '7', '99']) {
      const missing = await fixture.measure(() => assert.rejects(entries.patch({ id, data: { amount: 1 }, returning: 'none' }, workspaceA()), notFound))
      assert.deepEqual(kinds(missing.sql), ['begin', 'select', 'rollback'], missing.sql.join(' | '))
    }
    const amounts = await stored(fixture, 'da_entries').values('amount')
    assert.deepEqual(['1', '4', '7'].map(id => Number(amounts[id])), [12, 40, 70])
  })

  it('skips a row with missing: \'skip\' in its guarded UPDATE, without a locking read', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const skip = (id, options = {}) => fixture.measure(() => entries.patchMany({ data: [{ id, status: 'held' }], missing: 'skip', returning: 'minimal', ...options }, workspaceA()))
    const written = ({ result }) => result.data.map(item => item.id)
    // MySQL and MariaDB read the visible ids first: InnoDB would lock a listed row before checking the scope.
    const mysql = databaseClient === 'mysql2'
    const write = mysql ? ['begin', 'select', 'update', 'commit'] : ['begin', 'update', 'commit']

    const plain = await skip('1')
    assert.deepEqual(written(plain), ['1'])
    assert.deepEqual(kinds(plain.sql), write, plain.sql.join(' | '))
    const won = await skip('2', { onlyIf: { status: 'open' } })
    assert.deepEqual(written(won), ['2'])
    assert.deepEqual(kinds(won.sql), write, won.sql.join(' | '))
    // A lost compare-and-set writes nothing, from the same one UPDATE.
    const lost = await skip('2', { onlyIf: { status: 'open' } })
    assert.deepEqual(written(lost), [])
    assert.deepEqual(kinds(lost.sql), write, lost.sql.join(' | '))
    assert.ok([plain, won, lost].every(({ sql }) => !sql.some(statement => /for update/i.test(statement))))

    for (const id of ['4', '7', '99']) {
      const skipped = await skip(id)
      assert.deepEqual(written(skipped), [])
      assert.deepEqual(kinds(skipped.sql), mysql ? ['begin', 'select', 'commit'] : write, skipped.sql.join(' | '))
    }
    assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 2, 3, 4, 7])).map(row => row.status), ['held', 'held', 'open', 'open', 'open'])
  })

  it('replaces a row after its existence check and one scoped read, or creates a missing one', async () => {
    await seedLedger(fixture)
    // Accounts have no relationships, so a PUT writes only its own row.
    const accounts = fixture.api.resources.da_accounts
    const put = (id, name) => accounts.put({ id, data: { name, access_group: 'g1' }, returning: 'none' }, workspaceA())
    const replaced = await fixture.measure(() => put('1', 'A renamed'))
    assert.deepEqual(kinds(replaced.sql), ['begin', 'select', 'select', 'update', 'commit'], replaced.sql.join(' | '))

    // Hidden by the row policy or in another workspace: the row exists, so not found from the scoped read.
    for (const id of ['2', '3']) {
      const hidden = await fixture.measure(() => assert.rejects(put(id, 'Taken over'), notFound))
      assert.deepEqual(kinds(hidden.sql), ['begin', 'select', 'select', 'rollback'], hidden.sql.join(' | '))
    }
    // A missing row is created at its id.
    const created = await fixture.measure(() => put('99', 'Created'))
    assert.deepEqual(kinds(created.sql), ['begin', 'select', 'insert', 'commit'], created.sql.join(' | '))
    assert.deepEqual(await stored(fixture, 'da_accounts').values('name'), { 1: 'A renamed', 2: 'A hidden', 3: 'B visible', 99: 'Created' })
  })

  it('deletes a row after one scoped read', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    // The second DELETE removes the row's label links.
    const deleted = await fixture.measure(() => entries.delete({ id: '1' }, workspaceA()))
    assert.deepEqual(kinds(deleted.sql), ['begin', 'select', 'delete', 'delete', 'commit'], deleted.sql.join(' | '))

    // Hidden by the row policy, in another workspace, or missing: not found from that one read.
    for (const id of ['4', '7', '99']) {
      const missing = await fixture.measure(() => assert.rejects(entries.delete({ id }, workspaceA()), notFound))
      assert.deepEqual(kinds(missing.sql), ['begin', 'select', 'rollback'], missing.sql.join(' | '))
    }
    assert.deepEqual(Object.keys(await stored(fixture, 'da_entries').values('code')), ['2', '3', '4', '5', '6', '7', '8', '9'])
  })

  // Registers a hook, so it runs last.
  it('gives a permission hook the minimal record from the same one read', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const seen = []
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'data-access-patch-reader',
          handler: ({ context: { originalContext } }) => { if (originalContext?.method === 'patch') seen.push(Number(originalContext.minimalRecord.attributes.amount)) }
        }
      }
    })
    const patched = await fixture.measure(() => entries.patch({ id: '1', data: { amount: 11 }, returning: 'minimal' }, workspaceA()))
    assert.deepEqual(seen, [10])
    assert.deepEqual(kinds(patched.sql), ['begin', 'select', 'update', 'commit'], patched.sql.join(' | '))
  })
})

// A fixture of its own: its hooks move or delete the row between a write's
// read and its write, as a concurrent writer could.
describe(`One-record writes beside a concurrent writer (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture()
    const vanish = async ({ context }) => { if (context.vanish) await stored(fixture, context.vanish, context.transaction).row(context.id).delete() }
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'data-access-move-away',
          handler: async ({ context: { originalContext } }) => {
            if (!originalContext?.moveAway) return
            const moved = stored(fixture, originalContext.moveAway, originalContext.transaction)
            await moved.row(originalContext.id).update({ [moved.column('workspace_id')]: 'ws-b' })
          }
        },
        beforeDataCallPatch: { functionName: 'data-access-patch-vanish', batch: true, handler: vanish },
        beforeDataCallPut: { functionName: 'data-access-put-vanish', batch: true, handler: vanish },
        beforeDataCallDelete: { functionName: 'data-access-delete-vanish', batch: true, handler: vanish }
      }
    })
    // No lock version: a patch of its virtual field alone stores nothing.
    await fixture.api.addResource('da_notes', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, note: { type: 'string', virtual: true } },
      tableName: 'da_notes'
    })
    await fixture.api.resources.da_notes.createKnexTable()
  })
  after(async () => { await fixture?.close() })

  const entry = async id => {
    const entries = stored(fixture, 'da_entries')
    const row = await entries.row(id).first()
    return { workspace: row[entries.column('workspace_id')], amount: Number(row[entries.column('amount')]) }
  }

  it('answers not found for a row that vanished after the read, and writes nothing', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const patched = await fixture.measure(() => assert.rejects(entries.patch({ id: '2', data: { amount: 1 }, returning: 'none' }, { ...workspaceA(), vanish: 'da_entries' }), notFound))
    assert.deepEqual(kinds(patched.sql), ['begin', 'select', 'delete', 'update', 'rollback'], patched.sql.join(' | '))
    const deleted = await fixture.measure(() => assert.rejects(entries.delete({ id: '3' }, { ...workspaceA(), vanish: 'da_entries' }), notFound))
    assert.deepEqual(kinds(deleted.sql), ['begin', 'select', 'delete', 'delete', 'rollback'], deleted.sql.join(' | '))
    assert.deepEqual([await entry(2), await entry(3)], [{ workspace: 'ws-a', amount: 20 }, { workspace: 'ws-a', amount: 30 }], 'the hook deletes rolled back')

    const put = await fixture.measure(() => assert.rejects(fixture.api.resources.da_accounts.put({ id: '1', data: { name: 'Renamed', access_group: 'g1' }, returning: 'none' }, { ...workspaceA(), vanish: 'da_accounts' }), notFound))
    assert.deepEqual(kinds(put.sql), ['begin', 'select', 'select', 'delete', 'update', 'rollback'], put.sql.join(' | '))

    // With nothing stored to change, a locking read checks the row instead of an UPDATE.
    const notes = fixture.api.resources.da_notes
    await stored(fixture, 'da_notes').rows().delete()
    await fixture.seed('da_notes', [{ id: '1', name: 'one' }, { id: '2', name: 'two' }])
    const kept = await fixture.measure(() => notes.patch({ id: '1', data: { note: 'virtual only' }, returning: 'minimal' }, {}))
    assert.equal(kept.result.id, '1')
    assert.deepEqual(kinds(kept.sql), ['begin', 'select', 'select', 'commit'], kept.sql.join(' | '))
    const gone = await fixture.measure(() => assert.rejects(notes.patch({ id: '2', data: { note: 'virtual only' }, returning: 'minimal' }, { vanish: 'da_notes' }), notFound))
    assert.deepEqual(kinds(gone.sql), ['begin', 'select', 'delete', 'select', 'rollback'], gone.sql.join(' | '))
    assert.deepEqual(Object.keys(await stored(fixture, 'da_notes').values('name')), ['1', '2'])
  })

  it('answers not found for a row that moved to another workspace after the read, and writes nothing', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const away = { ...workspaceA(), moveAway: 'da_entries' }
    const patched = await fixture.measure(() => assert.rejects(entries.patch({ id: '1', data: { amount: 111 }, returning: 'none' }, away), notFound))
    assert.deepEqual(kinds(patched.sql), ['begin', 'select', 'update', 'update', 'rollback'], patched.sql.join(' | '))
    const deleted = await fixture.measure(() => assert.rejects(entries.delete({ id: '2' }, away), notFound))
    assert.deepEqual(kinds(deleted.sql), ['begin', 'select', 'update', 'delete', 'rollback'], deleted.sql.join(' | '))
    assert.deepEqual([await entry(1), await entry(2)], [{ workspace: 'ws-a', amount: 10 }, { workspace: 'ws-a', amount: 20 }])

    const put = await fixture.measure(() => assert.rejects(fixture.api.resources.da_accounts.put({ id: '1', data: { name: 'Taken over', access_group: 'g1' }, returning: 'none' }, { ...workspaceA(), moveAway: 'da_accounts' }), notFound))
    assert.deepEqual(kinds(put.sql), ['begin', 'select', 'select', 'update', 'update', 'rollback'], put.sql.join(' | '))
    assert.equal((await stored(fixture, 'da_accounts').values('name'))['1'], 'A visible')
  })

  it('leaves out a one-row patchMany whose row moved to another workspace after the visibility read', async () => {
    const entries = fixture.api.resources.da_entries
    const patchOne = missing => fixture.measure(() => entries.patchMany({ data: [{ id: '3', amount: 333 }], missing, returning: 'minimal' }, { ...workspaceA(), moveAway: 'da_entries' }))
    // Its UPDATE carries the owner: it matches nothing, and the move, another writer's, stands.
    await seedLedger(fixture)
    const skipped = await patchOne('skip')
    assert.deepEqual(skipped.result.data, [])
    assert.deepEqual(kinds(skipped.sql), ['begin', 'select', 'update', 'update', 'commit'], skipped.sql.join(' | '))
    assert.deepEqual(await entry(3), { workspace: 'ws-b', amount: 30 })
    await seedLedger(fixture)
    await assert.rejects(patchOne('throw'), isA(RestApiRecordsNotFoundError))
    assert.deepEqual(await entry(3), { workspace: 'ws-a', amount: 30 })
  })
})

// MySQL and MariaDB report changed rather than matched rows without FOUND_ROWS.
describe(`One-record writes without FOUND_ROWS (${storageMode.mode})`, { skip: databaseClient !== 'mysql2' && 'MySQL and MariaDB only' }, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture({ databaseOptions: { connectionOptions: { flags: '-FOUND_ROWS' } } })
    // Counts the rows each UPDATE of the accounts' table touches, as an audit trigger would.
    await fixture.knex.schema.createTable('da_audit', table => { table.increments('id'); table.integer('row_id') })
    const table = fixture.api.knex.helpers.getStorageAdapter('da_accounts').getTableName()
    await fixture.knex.raw('CREATE TRIGGER da_accounts_audit AFTER UPDATE ON ?? FOR EACH ROW INSERT INTO da_audit (row_id) VALUES (OLD.id)', [table])
  })
  after(async () => { await fixture?.close() })

  // Trigger runs since the last call.
  const triggered = async () => {
    const [{ count }] = await fixture.knex('da_audit').count({ count: '*' })
    await fixture.knex('da_audit').delete()
    return Number(count)
  }

  it('still writes a row whose values do not change, with one UPDATE', async () => {
    await seedLedger(fixture)
    await triggered()
    // Accounts have no lock version, so the UPDATE changes nothing and counts zero rows.
    const accounts = fixture.api.resources.da_accounts
    const same = await fixture.measure(() => accounts.patch({ id: '1', data: { name: 'A visible' }, returning: 'minimal' }, workspaceA()))
    assert.equal(same.result.id, '1')
    assert.deepEqual(kinds(same.sql), ['begin', 'select', 'update', 'select', 'commit'], same.sql.join(' | '))
    assert.equal(await triggered(), 1)
    await assert.rejects(accounts.patch({ id: '3', data: { name: 'B visible' }, returning: 'minimal' }, workspaceA()), notFound)
    const replaced = await fixture.measure(() => accounts.put({ id: '1', data: { name: 'A visible', access_group: 'g1' }, returning: 'none' }, workspaceA()))
    assert.deepEqual(kinds(replaced.sql), ['begin', 'select', 'select', 'update', 'select', 'commit'], replaced.sql.join(' | '))
    assert.equal(await triggered(), 1)
    // A DELETE counts the rows it removed whatever the flag says.
    const deleted = await fixture.measure(() => fixture.api.resources.da_entries.delete({ id: '1' }, workspaceA()))
    assert.deepEqual(kinds(deleted.sql), ['begin', 'select', 'delete', 'delete', 'commit'], deleted.sql.join(' | '))
  })

  it('locks a one-row patchMany\'s row, then updates it once', async () => {
    await seedLedger(fixture)
    await triggered()
    // Without counts of matched rows, the UPDATE's count cannot answer whether the row is there.
    const skipped = await fixture.measure(() => fixture.api.resources.da_accounts.patchMany({ data: [{ id: '1', name: 'A visible' }], missing: 'skip', returning: 'minimal' }, workspaceA()))
    assert.deepEqual(skipped.result.data.map(item => item.id), ['1'])
    assert.deepEqual(kinds(skipped.sql), ['begin', 'select', 'select', 'update', 'commit'], skipped.sql.join(' | '))
    assert.equal(await triggered(), 1)
  })
})

// A row policy hides a link's target: the read shows the link as unassigned,
// and a write of null by the same reader, as a form sends what it read, keeps
// the stored link.
describe(`Links to targets the caller cannot see (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })

  const linkTo = (id, account) => {
    const entries = stored(fixture, 'da_entries')
    // A string: better-sqlite3 binds a number as REAL, which a text column stores as '2.0'.
    return entries.row(id).update({ [entries.column('account_id')]: String(account) })
  }
  const accountOf = async id => {
    const entries = stored(fixture, 'da_entries')
    const value = (await entries.row(id).first())[entries.column('account_id')]
    return value === null ? null : Number(value)
  }

  it('keeps the link when the reader writes the record back, and applies a visible change', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    // Account 2 is in the reader's workspace, in a group the reader cannot see.
    await linkTo('1', 2)
    const read = await entries.get({ id: '1' }, workspaceA())
    assert.equal(read.account ?? null, null)
    await entries.patch({ id: '1', data: { amount: 11, account: null }, returning: 'none' }, workspaceA())
    assert.equal(await accountOf('1'), 2, 'patch')
    const { code, status, access_group: group } = read
    await entries.put({ id: '1', data: { code, amount: 12, status, access_group: group, account: null }, returning: 'none' }, workspaceA())
    assert.equal(await accountOf('1'), 2, 'put')
    assert.equal(Number((await entries.get({ id: '1' }, workspaceA())).amount), 12, 'the rest of the write applies')

    // A visible target is linked and cleared as asked, and so is a link to a record that is gone.
    await entries.patch({ id: '1', data: { account: 1 }, returning: 'none' }, workspaceA())
    assert.equal(await accountOf('1'), 1)
    await entries.patch({ id: '1', data: { account: null }, returning: 'none' }, workspaceA())
    assert.equal(await accountOf('1'), null)
    await linkTo('1', 99)
    await entries.patch({ id: '1', data: { account: null }, returning: 'none' }, workspaceA())
    assert.equal(await accountOf('1'), null)
  })

  it('reads a link to an included target without a separate visibility read', async () => {
    await seedLedger(fixture)
    const read = async (id, params = {}) => {
      const context = { ...workspaceA(), policyCalls: [] }
      const record = await fixture.api.resources.da_entries.get({ id, format: 'jsonapi', ...params }, context)
      return { link: record.data.relationships.account.data, checks: context.policyCalls.filter(call => call.queryPurpose === 'relationship-identifiers').length }
    }
    const include = { queryParams: { include: ['account'] } }
    const alone = await read('1')
    const included = await read('1', include)
    assert.deepEqual(included.link, { type: 'da_accounts', id: '1' })
    assert.equal(included.checks, alone.checks - 1)
    // The include does not find a hidden target; its link is still hidden.
    await linkTo('1', 2)
    assert.equal((await read('1', include)).link, null)
  })

  it('checks the links of 1,205 rows with as many statements as the links of three', async () => {
    const checks = async () => {
      const context = { ...workspaceA(), policyCalls: [] }
      const result = await fixture.api.resources.da_entries.queryAll({ pageSize: 2000, format: 'jsonapi' }, context)
      return { rows: result.data.length, checks: context.policyCalls.filter(call => call.queryPurpose === 'relationship-identifiers').length }
    }
    await seedLedger(fixture)
    const few = await checks()
    const ids = Array.from({ length: 1205 }, (_, index) => String(index + 10))
    await fixture.seed('da_accounts', ids.map(id => ({ id, name: `Account ${id}`, workspace_id: 'ws-a', access_group: 'g1' })))
    const version = storageMode.isAnyApi() ? {} : { lock_version: 0 }
    await fixture.seed('da_entries', ids.map(id => ({ id, code: `E${id}`, amount: 1, status: 'open', workspace_id: 'ws-a', access_group: 'g1', account_id: Number(id), ...version })))
    const many = await checks()
    assert.equal(many.rows, few.rows + 1205)
    assert.ok(few.checks > 0)
    assert.equal(many.checks, few.checks)
  })

  it('keeps a hidden link in a many-row patch, row by row', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    await linkTo('2', 2)
    for (const missing of ['throw', 'skip']) {
      await linkTo('3', 1)
      const written = await entries.patchMany({ data: [{ id: '2', account: null }, { id: '3', account: null }], missing, returning: 'minimal' }, workspaceA())
      assert.deepEqual(written.data.map(item => item.id), ['2', '3'], missing)
      assert.deepEqual([await accountOf('2'), await accountOf('3')], [2, null], missing)
    }
  })
})

// Tasks link to an account and to a polymorphic owner, an account or a label;
// the row policy hides account 2, and workspace ws-a cannot see label 2.
describe(`Polymorphic links and merge upserts (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture({ databaseOptions: { concurrent: true } })
    await fixture.api.addResource('da_tasks', {
      schema: {
        id: { type: 'id' },
        code: { type: 'string', required: true, max: 40, search: true },
        amount: { type: 'integer', required: true },
        workspace_id: { type: 'string', required: true, max: 40 },
        account_id: { type: 'number', nullable: true, belongsTo: 'da_accounts', as: 'account' },
        owner_type: { type: 'string', nullable: true, max: 40 },
        owner_id: { type: 'string', nullable: true, max: 40 }
      },
      relationships: { owner: { belongsToPolymorphic: { types: ['da_accounts', 'da_labels'], typeField: 'owner_type', idField: 'owner_id' } } },
      autofilter: 'workspace',
      indexes: [{ columns: ['workspace_id', 'code'], unique: true }],
      tableName: 'da_tasks'
    })
    if (storageMode.isAnyApi()) storageMode.registerTable(fixture.knex, 'da_tasks', 'da_tasks', fixture.api.anyapi.tenantId)
    else await fixture.api.resources.da_tasks.createKnexTable()
  })
  after(async () => { await fixture?.close() })

  const seedTasks = async links => {
    await stored(fixture, 'da_tasks').rows().delete()
    await seedLedger(fixture)
    await fixture.seed('da_labels', [{ id: '1', name: 'a-one', workspace_id: 'ws-a' }, { id: '2', name: 'b-two', workspace_id: 'ws-b' }])
    await fixture.seed('da_tasks', [{ id: '1', code: 'T1', amount: 10, workspace_id: 'ws-a' }])
    await setLinks(links)
  }
  // Strings: better-sqlite3 binds a number as REAL, which a text column stores as '2.0'.
  const setLinks = async links => {
    if (Object.keys(links).length === 0) return
    const tasks = stored(fixture, 'da_tasks')
    return tasks.row('1').update(Object.fromEntries(Object.entries(links).map(([field, value]) => [tasks.column(field), value === null ? null : String(value)])))
  }
  const linksOf = async () => {
    const tasks = stored(fixture, 'da_tasks')
    const row = await tasks.row('1').first()
    const value = field => row[tasks.column(field)] == null ? null : String(row[tasks.column(field)])
    return { account: value('account_id'), owner: value('owner_type') && `${value('owner_type')}:${value('owner_id')}`, amount: Number(row[tasks.column('amount')]) }
  }

  it('keeps hidden links in a merge upsert and clears visible ones', { skip: idKeysOnly }, async () => {
    const tasks = fixture.api.resources.da_tasks
    const merge = () => tasks.postMany({ data: [{ code: 'T1', amount: 31, account: null, owner: null }], onConflict: { keys: ['workspace_id', 'code'], action: 'merge' }, returning: 'minimal' }, workspaceA())
    await seedTasks({ account_id: 2, owner_type: 'da_labels', owner_id: 2 })
    await merge()
    assert.deepEqual(await linksOf(), { account: '2', owner: 'da_labels:2', amount: 31 })
    await setLinks({ account_id: 1, owner_type: 'da_labels', owner_id: 1 })
    await merge()
    assert.deepEqual(await linksOf(), { account: null, owner: null, amount: 31 })
  })

  it('keeps a hidden link whose target another transaction committed after this one first read', { skip: idKeysOnly || (databaseClient === 'better-sqlite3' && 'SQLite has one writer') }, async () => {
    await seedTasks({})
    const tasks = fixture.api.resources.da_tasks
    const first = await holdManagedTransaction(fixture.api)
    try {
      await tasks.query({ transaction: first.transaction }, workspaceA())
      // Another transaction commits a hidden and a visible account, and a task linking to each.
      await fixture.seed('da_accounts', [
        { id: '7', name: 'A late hidden', workspace_id: 'ws-a', access_group: 'g2' },
        { id: '8', name: 'A late visible', workspace_id: 'ws-a', access_group: 'g1' }
      ])
      await fixture.seed('da_tasks', [
        { id: '7', code: 'T7', amount: 7, workspace_id: 'ws-a', account_id: '7' },
        { id: '8', code: 'T8', amount: 8, workspace_id: 'ws-a', account_id: '8' }
      ])
      await tasks.postMany({
        data: [{ code: 'T7', amount: 70, account: null }, { code: 'T8', amount: 80, account: null }],
        onConflict: { keys: ['workspace_id', 'code'], action: 'merge' },
        returning: 'minimal',
        transaction: first.transaction
      }, workspaceA())
      await first.commit()
    } finally {
      if (!first.transaction.isCompleted()) await first.rollback()
    }
    const rows = await fixture.knex('da_tasks').whereIn('code', ['T7', 'T8']).orderBy('code')
    assert.deepEqual(rows.map(row => [row.code, row.account_id === null ? null : String(row.account_id), Number(row.amount)]), [['T7', '7', 70], ['T8', null, 80]])
  })

  it('refuses the type and id fields of a polymorphic link in attributes, as it refuses foreign keys', async () => {
    await seedTasks({ owner_type: 'da_labels', owner_id: 1 })
    const tasks = fixture.api.resources.da_tasks
    const refused = error => cause(error)?.details?.violations?.some(violation => violation.rule === 'foreign_key_in_attributes' && violation.message.includes("'data.relationships.owner'"))
    const attempts = {
      'patch (plain)': () => tasks.patch({ id: '1', data: { owner_type: 'da_labels', owner_id: '2' }, returning: 'none' }, workspaceA()),
      'patch, id only': () => tasks.patch({ id: '1', data: { owner_id: null }, returning: 'none' }, workspaceA()),
      'patch (JSON:API)': () => tasks.patch({ id: '1', format: 'jsonapi', returning: 'none', document: { data: { type: 'da_tasks', id: '1', attributes: { owner_type: null, owner_id: null } } } }, workspaceA()),
      post: () => tasks.post({ data: { code: 'T2', amount: 1, owner_type: 'da_labels', owner_id: '2' }, returning: 'minimal' }, workspaceA()),
      put: () => tasks.put({ id: '1', data: { code: 'T1', amount: 1, owner_type: 'da_labels', owner_id: '2' }, returning: 'none' }, workspaceA()),
      postMany: () => tasks.postMany({ data: [{ code: 'T3', amount: 1, owner_type: 'da_labels', owner_id: '2' }], returning: 'minimal' }, workspaceA()),
      patchMany: () => tasks.patchMany({ data: [{ id: '1', owner_id: '2' }], returning: 'minimal' }, workspaceA())
    }
    for (const [name, attempt] of Object.entries(attempts)) await assert.rejects(attempt(), refused, name)
    assert.deepEqual(await linksOf(), { account: null, owner: 'da_labels:1', amount: 10 })
    // Through the relationship, the target is checked: label 2 is another workspace's.
    await assert.rejects(tasks.patch({ id: '1', data: { owner: { _type: 'da_labels', id: '2' } }, returning: 'none' }, workspaceA()))
    await tasks.patch({ id: '1', data: { owner: { _type: 'da_accounts', id: '1' } }, returning: 'none' }, workspaceA())
    assert.deepEqual(await linksOf(), { account: null, owner: 'da_accounts:1', amount: 10 })
  })
})

// A fixture of its own: these tests add hooks and a resource.
describe(`Selection writes, counts and upserts on the id (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createDataAccessFixture() })
  after(async () => { await fixture?.close() })
  const count = value => ({ meta: { count: value } })

  it('returns only the number of rows each many-row write wrote', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    assert.deepEqual(await entries.postMany({ data: newEntries(3), returning: 'count' }, workspaceA()), count(3))
    // 4 is hidden by the row policy.
    assert.deepEqual(await entries.patchMany({ data: [{ id: '1', amount: 1 }, { id: '4', amount: 1 }], missing: 'skip', returning: 'count' }, workspaceA()), count(1))
    assert.deepEqual(await entries.patchWhereIds({ ids: ['1', '2'], data: { status: 'held' }, returning: 'count' }, workspaceA()), count(2))
    assert.deepEqual(await entries.patchWhere({ filters: { status: 'held' }, data: { status: 'open' }, returning: 'count' }, workspaceA()), count(2))
    assert.deepEqual(await entries.patchWhere({ filters: { status: 'none' }, data: { status: 'open' }, returning: 'count' }, workspaceA()), count(0))
    // A count reads nothing back: it runs the statements of returning: 'none'.
    const counted = await fixture.measure(() => entries.patchWhereIds({ ids: ['1', '2'], data: { amount: 7 }, returning: 'count' }, workspaceA()))
    const silent = await fixture.measure(() => entries.patchWhereIds({ ids: ['1', '2'], data: { amount: 8 } }, workspaceA()))
    assert.deepEqual(counted.result, count(2))
    assert.equal(counted.statements, silent.statements, `count: ${counted.sql.join(' | ')}\nnone: ${silent.sql.join(' | ')}`)
    assert.deepEqual(await entries.deleteMany({ ids: ['3', '4'], missing: 'skip', returning: 'count' }, workspaceA()), count(1))
    assert.deepEqual(await entries.deleteWhere({ filters: { status: 'open' }, returning: 'count' }, workspaceB()), count(3))

    // An upsert counts what it inserted, and with merge what it updated too.
    if (!idKeysOnly) {
      const labels = fixture.api.resources.da_labels
      await fixture.seed('da_labels', [{ id: '1', name: 'flag', workspace_id: 'ws-a' }])
      const keys = ['workspace_id', 'name']
      assert.deepEqual(await labels.postMany({ data: [{ name: 'flag' }, { name: 'fresh' }], onConflict: { keys, action: 'ignore' }, returning: 'count' }, workspaceA()), count(1))
      assert.deepEqual(await labels.postMany({ data: [{ name: 'flag', color: 'red' }, { name: 'new' }], onConflict: { keys, action: 'merge', merge: ['color'] }, returning: 'count' }, workspaceA()), count(2))
    }

    await assert.rejects(entries.deleteMany({ ids: ['5'], returning: 'full' }, workspaceA()), isA(RestApiValidationError))
    await assert.rejects(entries.patch({ id: '1', data: { amount: 2 }, returning: 'count' }, workspaceA()), isA(RestApiValidationError))
  })

  it('writes the rows a selection still finds and never throws for one that vanished', async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    // After the selection has read its ids, a row goes or stops matching, through
    // the write's own transaction, as a concurrent write would have done.
    let change
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'selection-row-changes',
          handler: async ({ context }) => {
            const knexQuery = context.knexQuery
            if (!change || knexQuery?.scopeName !== 'da_entries' || knexQuery.queryPurpose !== 'bulk-write' || change.reads++ === 0) return
            const table = stored(fixture, 'da_entries', knexQuery.db)
            await change.run(table.row(change.id), table)
          }
        }
      }
    })
    const changing = async (id, run, work) => {
      change = { id, run, reads: 0 }
      try { return await work() } finally { change = undefined }
    }

    const deleted = await changing(2, rows => rows.delete(), () => entries.deleteWhere({ filters: { status: 'open' }, returning: 'minimal' }, workspaceA()))
    assert.deepEqual(deleted.data.map(item => item.id), ['1', '3'])
    await seedLedger(fixture)
    const patched = await changing(2, rows => rows.delete(), () => entries.patchWhere({ filters: { status: 'open' }, data: { status: 'held' }, returning: 'minimal' }, workspaceA()))
    assert.deepEqual(patched.data.map(item => item.id), ['1', '3'])
    // A row that stops matching the filters is left alone.
    await seedLedger(fixture)
    const filtered = await changing(2, (rows, table) => rows.update({ [table.column('status')]: 'closed' }), () => entries.patchWhere({ filters: { status: 'open' }, data: { status: 'held' }, returning: 'minimal' }, workspaceA()))
    assert.deepEqual(filtered.data.map(item => item.id), ['1', '3'])
    assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 2, 3])).map(row => row.status), ['held', 'closed', 'held'])

    await assert.rejects(entries.deleteWhere({ filters: { status: 'open' }, missing: 'skip' }, workspaceA()), isA(RestApiValidationError))
    await assert.rejects(entries.patchWhere({ all: true, data: { status: 'open' }, missing: 'throw' }, workspaceA()), isA(RestApiValidationError))
  })

  it('keeps a literal ? of a row filter as text in a SQLite DELETE … RETURNING', { skip: databaseClient !== 'better-sqlite3' && 'elsewhere Knex or the driver reads every ? as a parameter' }, async () => {
    await seedLedger(fixture)
    let literal = false
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'literal-question-mark',
          handler: ({ context }) => {
            const knexQuery = context.knexQuery
            if (literal && knexQuery?.scopeName === 'da_entries' && knexQuery.queryPurpose === 'bulk-write') {
              // No bindings: the ? stays inside the literal.
              knexQuery.query.whereRaw(`${knexQuery.tableName}.${stored(fixture, 'da_entries').column('code')} <> 'E?'`)
            }
          }
        }
      }
    })
    literal = true
    try {
      const deleted = await fixture.api.resources.da_entries.deleteMany({ ids: ['1', '2'], missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(deleted.data.map(item => item.id), ['1', '2'])
    } finally { literal = false }
    assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 2, 3])).map(row => String(row.id)), ['3'])
  })

  it('gives after-hooks the ids and inputs of the changed rows, in the same order', async () => {
    await seedLedger(fixture)
    const table = stored(fixture, 'da_entries')
    await table.row('2').update({ [table.column('status')]: 'held' })
    const seen = []
    await fixture.api.customize({
      hooks: {
        afterDataCallPatchMany: {
          functionName: 'pairing-audit',
          handler: ({ context }) => {
            if (context.pairing) seen.push(context.ids.map((id, index) => [id, String(context.inputRecords[index].data.id), context.inputRecords[index].data.attributes.amount]))
          }
        }
      }
    })
    // 2 fails onlyIf and 4 is hidden.
    const data = [1, 2, 3, 4].map(id => ({ id: String(id), amount: id * 11 }))
    await fixture.api.resources.da_entries.patchMany({ data, onlyIf: { status: 'open' }, missing: 'skip' }, { ...workspaceA(), pairing: true })
    assert.deepEqual(seen, [[['1', '1', 11], ['3', '3', 33]]])
  })

  it('upserts on the id of a resource without owners, and refuses it on owned resources', async () => {
    await seedLedger(fixture)
    await fixture.api.addResource('da_sign_ins', {
      idProperty: 'email',
      schema: {
        // AnyAPI keeps the id in its logical id column.
        id: { type: 'string', primary: true, required: true, maxLength: 100, ...(storageMode.isAnyApi() ? {} : { storage: { column: 'email' } }) },
        name: { type: 'string', required: true, max: 40 },
        visits: { type: 'integer', defaultTo: 0 }
      },
      tableName: 'da_sign_ins'
    })
    await fixture.api.resources.da_sign_ins.createKnexTable()
    const signIns = fixture.api.resources.da_sign_ins
    const created = await signIns.postMany({ data: [{ id: 'ann@example.com', name: 'Ann' }], onConflict: { keys: ['id'], action: 'ignore' }, returning: 'minimal' })
    assert.deepEqual(created.data.map(item => item.id), ['ann@example.com'])
    // The idProperty names the same key; the existing row is left alone.
    const again = await signIns.postMany({
      data: [{ id: 'ann@example.com', name: 'Ann again' }, { id: 'bob@example.com', name: 'Bob' }],
      onConflict: { keys: ['email'], action: 'ignore' },
      returning: 'minimal'
    })
    assert.deepEqual(again.data.map(item => item.id), ['bob@example.com'])
    assert.equal((await signIns.get({ id: 'ann@example.com' })).name, 'Ann')
    const merged = await signIns.postMany({ data: [{ id: 'ann@example.com', name: 'Ann', visits: 2 }], onConflict: { keys: ['id'], action: 'merge', merge: ['visits'] }, returning: 'count' })
    assert.deepEqual(merged, count(1))
    assert.equal(Number((await signIns.get({ id: 'ann@example.com' })).visits), 2)
    await assert.rejects(signIns.postMany({ data: [{ name: 'Nobody' }], onConflict: { keys: ['id'], action: 'ignore' } }), isA(RestApiValidationError))
    await assert.rejects(signIns.postMany({ data: [{ id: 'cy@example.com', name: 'Cy' }], onConflict: { keys: ['id', 'name'], action: 'ignore' } }), isA(RestApiValidationError))

    // Owned resources, and resources under a row policy, keep refusing it.
    const refused = isA(RestApiBulkWriteUnsupportedError)
    await assert.rejects(fixture.api.resources.da_labels.postMany({ data: [{ id: '1', name: 'flag' }], onConflict: { keys: ['id'], action: 'ignore' } }, workspaceA()), refused)
    await assert.rejects(fixture.api.resources.da_entries.postMany({ data: [{ id: '1', ...newEntries(1)[0] }], onConflict: { keys: ['id'], action: 'ignore' } }, workspaceA()), refused)
    assert.deepEqual((await signIns.query({ queryParams: { sort: ['id'] } })).data.map(record => record.id), ['ann@example.com', 'bob@example.com'])
  })
})

// AnyAPI keeps every tenant's and resource's rows in one table, where a logical
// id is unique only within its tenant and resource.
describe(`Many-row writes on AnyAPI's shared table (${storageMode.mode})`, { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, () => {
  const OTHER_TENANT = 'other_tenant'
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture()
    // No owners and no row policy: it takes upserts on the id.
    await fixture.api.addResource('da_tags', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, uses: { type: 'integer', default: 0 } },
      tableName: 'da_tags'
    })
    storageMode.registerTable(fixture.knex, 'da_tags', 'da_tags', fixture.api.anyapi.tenantId)
  })
  after(async () => { await fixture?.close() })

  // The canonical rows and links of `resource` under `tenant`, by logical id.
  const canonicalRows = (resource, tenant = fixture.api.anyapi.tenantId) =>
    fixture.knex('any_records').where({ tenant_id: tenant, resource }).orderBy('logical_id')
  const clearTags = () => fixture.knex('any_records').where({ resource: 'da_tags' }).delete()
  // Another tenant's copies of entries 1–3 and of their links: none may change.
  const seedOtherTenant = async () => {
    await fixture.knex('any_records').where({ tenant_id: OTHER_TENANT }).delete()
    await fixture.knex('any_links').where({ tenant_id: OTHER_TENANT }).delete()
    const rows = (await canonicalRows('da_entries')).filter(row => ['1', '2', '3'].includes(row.logical_id))
    await fixture.knex('any_records').insert(rows.map(({ id, ...row }) => ({ ...row, tenant_id: OTHER_TENANT })))
    const links = await fixture.knex('any_links').where({ tenant_id: fixture.api.anyapi.tenantId })
    if (links.length) await fixture.knex('any_links').insert(links.map(({ id, ...link }) => ({ ...link, tenant_id: OTHER_TENANT })))
  }
  const untouched = async () => ({
    otherTenant: (await canonicalRows('da_entries', OTHER_TENANT)).map(({ id, ...row }) => row),
    otherLinks: (await fixture.knex('any_links').where({ tenant_id: OTHER_TENANT }).orderBy('left_id')).map(({ id, ...link }) => link),
    // Accounts 1–3 share the entries' logical ids in the same tenant.
    accounts: await stored(fixture, 'da_accounts').values('name')
  })

  it('writes only its own tenant\'s and resource\'s rows under the same logical ids', async () => {
    await seedLedger(fixture)
    await fixture.seed('da_labels', [{ id: '1', name: 'flag', workspace_id: 'ws-a' }])
    for (const id of ['1', '2']) {
      await fixture.api.anyapi.links.attachMany({ scopeName: 'da_entries', relName: 'labels', context: { id, db: fixture.knex }, relData: [{ type: 'da_labels', id: '1' }] })
    }
    await seedOtherTenant()
    const before = await untouched()
    assert.equal(before.otherTenant.length, 3)
    assert.equal(before.otherLinks.length, 2)
    const entries = fixture.api.resources.da_entries
    const all = { ...workspaceA(), visibility: { all: true } }

    await entries.patchMany({ data: [{ id: '1', amount: 1 }, { id: '2', amount: 2 }, { id: '3', amount: 3 }], returning: 'none' }, all)
    await entries.patchWhereIds({ ids: ['1', '2'], data: { status: 'held' }, onlyIf: { status: 'open' }, returning: 'none' }, all)
    await entries.patchWhere({ filters: { status: 'open' }, data: { status: 'closed' }, returning: 'none' }, all)
    assert.deepEqual((await rowsById(fixture, 'da_entries', [1, 2, 3])).map(row => [Number(row.amount), row.status]), [[1, 'held'], [2, 'held'], [3, 'closed']])
    assert.deepEqual(await untouched(), before, 'updates')

    await entries.deleteMany({ ids: ['1'], returning: 'none' }, all)
    await entries.deleteWhere({ filters: { status: 'held' }, returning: 'none' }, all)
    assert.deepEqual((await fixture.rows('da_entries')).map(row => row.id), ['3', '4', '5', '6', '7', '8', '9'])
    assert.deepEqual(await fixture.rows('da_entry_labels'), [], 'the deleted entries\' links are gone')
    assert.deepEqual(await untouched(), before, 'deletes')
  })

  it('gives each generated row its row id as logical id, with one INSERT and one UPDATE per chunk', async () => {
    await clearTags()
    const tags = fixture.api.resources.da_tags
    const names = count => Array.from({ length: count }, (_, index) => ({ name: `tag ${index}` }))
    const small = await fixture.measure(() => tags.postMany({ data: names(10), returning: 'minimal' }))
    const large = await fixture.measure(() => tags.postMany({ data: names(200), returning: 'minimal' }))
    assert.equal(large.statements, small.statements, `10 rows: ${small.sql.join(' | ')}\n200 rows: ${large.sql.join(' | ')}`)
    // MySQL reads the generated ids back, MariaDB returns them, the others return them.
    const insertIds = databaseClient === 'mysql2' && !/mariadb/i.test(fixture.api.knex.capabilities.dbInfo.version) ? ['select', 'insert', 'select'] : ['insert']
    assert.deepEqual(kinds(small.sql), ['begin', ...insertIds, 'update', 'commit'], small.sql.join(' | '))

    const rows = await canonicalRows('da_tags')
    assert.equal(rows.length, 210)
    assert.ok(rows.every(row => row.logical_id === String(row.id)), 'every logical id is its row id')
    const byId = new Map(rows.map(row => [row.logical_id, row]))
    const slot = stored(fixture, 'da_tags').column('name')
    assert.deepEqual(large.result.data.map(item => byId.get(item.id)[slot]), names(200).map(tag => tag.name), 'every returned id names its input row')

    // Explicit ids are the logical ids, in one INSERT.
    const explicit = await fixture.measure(() => tags.postMany({ data: [{ id: '5001', name: 'Red' }, { id: '5002', name: 'Blue' }], returning: 'minimal' }))
    assert.deepEqual(explicit.result.data.map(item => item.id), ['5001', '5002'])
    assert.deepEqual(kinds(explicit.sql), ['begin', 'insert', 'commit'], explicit.sql.join(' | '))
    assert.equal((await tags.get({ id: '5002' })).name, 'Blue')
  })

  it('upserts on the id within its own tenant and resource, and refuses other keys', async () => {
    await clearTags()
    const tags = fixture.api.resources.da_tags
    await tags.postMany({ data: [{ id: '1', name: 'one', uses: 1 }] })
    // The same logical id under another tenant is not a conflict.
    const [own] = await canonicalRows('da_tags')
    const { id, ...copy } = own
    await fixture.knex('any_records').insert({ ...copy, tenant_id: OTHER_TENANT, logical_id: '2' })

    const ignored = await tags.postMany({ data: [{ id: '1', name: 'again' }, { id: '2', name: 'two' }], onConflict: { keys: ['id'], action: 'ignore' }, returning: 'minimal' })
    assert.deepEqual(ignored.data.map(item => item.id), ['2'])
    const merged = await tags.postMany({ data: [{ id: '1', name: 'one', uses: 5 }, { id: '3', name: 'three' }], onConflict: { keys: ['id'], action: 'merge', merge: ['uses'] }, returning: 'minimal' })
    assert.deepEqual(merged.data.map(item => item.id), ['1', '3'])
    const read = await tags.query({ queryParams: { sort: ['id'] } })
    assert.deepEqual(read.data.map(tag => [tag.id, tag.name, Number(tag.uses)]), [['1', 'one', 5], ['2', 'two', 0], ['3', 'three', 0]])
    assert.equal((await canonicalRows('da_tags', OTHER_TENANT)).length, 1, 'the other tenant\'s row stays')

    await assert.rejects(tags.postMany({ data: [{ name: 'one' }], onConflict: { keys: ['name'], action: 'ignore' } }), isA(RestApiBulkWriteUnsupportedError))
    assert.equal((await canonicalRows('da_tags')).length, 3)
  })
})

describe(`Many-row writes beside a concurrent commit (${storageMode.mode})`, { skip: databaseClient === 'better-sqlite3' && 'SQLite has one writer' }, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture({ databaseOptions: { concurrent: true } })
    // No owners and no row policy: it takes upserts on the id, on either storage.
    await fixture.api.addResource('da_counters', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, uses: { type: 'integer', default: 0 } },
      tableName: 'da_counters'
    })
    if (storageMode.isAnyApi()) storageMode.registerTable(fixture.knex, 'da_counters', 'da_counters', fixture.api.anyapi.tenantId)
    else await fixture.api.resources.da_counters.createKnexTable()
  })
  after(async () => { await fixture?.close() })

  it('merges into a matching row another transaction committed after this one first read', { skip: idKeysOnly }, async () => {
    await fixture.reset()
    const labels = fixture.api.resources.da_labels
    const merge = { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] }
    const first = await holdManagedTransaction(fixture.api)
    try {
      if (databaseClient === 'mysql2') {
        const [[{ level }]] = await first.transaction.raw('select @@transaction_isolation as level')
        assert.equal(level, 'REPEATABLE-READ', 'the default isolation, whose plain reads keep the first read\'s snapshot')
      }
      // This read fixes the transaction's snapshot: the label does not exist yet.
      assert.deepEqual((await labels.query({ transaction: first.transaction }, workspaceA())).data, [])
      // Another transaction creates it and commits.
      await labels.postMany({ data: [{ name: 'race', color: 'blue', slug: 'a-race' }] }, workspaceA())
      // The upsert's locking read finds the committed row; the caller may change it, so it merges.
      const merged = await labels.postMany({ data: [{ name: 'race', color: 'red' }], onConflict: merge, returning: 'full', transaction: first.transaction }, workspaceA())
      assert.deepEqual(merged.data.map(record => [record.name, record.color, record.slug]), [['race', 'red', 'a-race']])
      await first.commit()
    } finally {
      if (!first.transaction.isCompleted()) await first.rollback()
    }
    assert.deepEqual((await fixture.rows('da_labels')).map(row => [row.name, row.color, row.workspace_id]), [['race', 'red', 'ws-a']])
  })

  // The late label is created as blue; `row` is merged into it from the older snapshot.
  const mergeIntoLateLabel = async (row, returning) => {
    await fixture.reset()
    const labels = fixture.api.resources.da_labels
    const first = await holdManagedTransaction(fixture.api)
    try {
      assert.deepEqual((await labels.query({ transaction: first.transaction }, workspaceA())).data, [])
      await labels.postMany({ data: [{ name: 'race', color: 'blue', slug: 'a-race' }] }, workspaceA())
      const merged = await labels.postMany({
        data: [row],
        onConflict: { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] },
        returning,
        transaction: first.transaction
      }, workspaceA())
      await first.commit()
      return merged
    } finally {
      if (!first.transaction.isCompleted()) await first.rollback()
    }
  }

  it('returns a late matching row that the merge leaves unchanged', { skip: idKeysOnly }, async () => {
    // The stored values are the merged ones, so the merge changes nothing.
    const same = await mergeIntoLateLabel({ name: 'race', color: 'blue' }, 'full')
    assert.deepEqual(same.data.map(record => [record.name, record.color, record.slug]), [['race', 'blue', 'a-race']])
    assert.deepEqual(await mergeIntoLateLabel({ name: 'race', color: 'blue' }, 'count'), { meta: { count: 1 } })
  })

  it('returns a late matching row when the row supplies none of the fields to merge', { skip: idKeysOnly }, async () => {
    const nothing = await mergeIntoLateLabel({ name: 'race' }, 'full')
    assert.deepEqual(nothing.data.map(record => [record.name, record.color, record.slug]), [['race', 'blue', 'a-race']])
    assert.deepEqual((await fixture.rows('da_labels')).map(row => [row.name, row.color]), [['race', 'blue']])
  })

  // Another transaction changes the label's slug and commits after this one first
  // read it; `write` then stores values the row already holds. InnoDB leaves such
  // a row as it is, so a plain read-back would still answer the snapshot's slug.
  const writeAfterLateChange = async write => {
    await fixture.reset()
    const labels = fixture.api.resources.da_labels
    const [{ id }] = (await labels.postMany({ data: [{ name: 'race', color: 'blue', slug: 'a-race' }], returning: 'minimal' }, workspaceA())).data
    const first = await holdManagedTransaction(fixture.api)
    try {
      assert.deepEqual((await labels.query({ transaction: first.transaction }, workspaceA())).data.map(record => record.slug), ['a-race'])
      await labels.patch({ id, data: { slug: 'b-race' }, returning: 'none' }, workspaceA())
      const written = await write(labels, id, first.transaction)
      await first.commit()
      return written
    } finally {
      if (!first.transaction.isCompleted()) await first.rollback()
    }
  }

  it('answers a write that changes nothing with the row as another transaction committed it after this one first read', async () => {
    const patched = await writeAfterLateChange((labels, id, transaction) => labels.patch({ id, data: { color: 'blue' }, transaction }, workspaceA()))
    assert.deepEqual([patched.color, patched.slug], ['blue', 'b-race'])
    const replaced = await writeAfterLateChange((labels, id, transaction) => labels.put({ id, data: { name: 'race', color: 'blue', slug: 'b-race' }, transaction }, workspaceA()))
    assert.deepEqual([replaced.color, replaced.slug], ['blue', 'b-race'])
    const patchedMany = await writeAfterLateChange((labels, id, transaction) => labels.patchMany({ data: [{ id, color: 'blue' }], returning: 'full', transaction }, workspaceA()))
    assert.deepEqual(patchedMany.data.map(record => [record.color, record.slug]), [['blue', 'b-race']])
  })

  it('merges into a row another transaction had inserted but not committed when the merge began', { skip: idKeysOnly }, async () => {
    await fixture.reset()
    const labels = fixture.api.resources.da_labels
    const inserting = await holdManagedTransaction(fixture.api)
    const merging = await holdManagedTransaction(fixture.api)
    try {
      await labels.postMany({ data: [{ name: 'race', color: 'blue', slug: 'a-race' }], returning: 'none', transaction: inserting.transaction }, workspaceA())
      // Read before the merge: the transaction's connection runs one statement at a time.
      const mergingConnection = await connectionId(merging.transaction)
      const merged = labels.postMany({
        data: [{ name: 'race', color: 'red' }],
        onConflict: { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] },
        returning: 'full',
        transaction: merging.transaction
      }, workspaceA())
      // The merge waits for the insert's row; the insert then commits.
      await waitForLockWait(fixture.knex, mergingConnection, merged)
      await inserting.commit()
      assert.deepEqual((await merged).data.map(record => [record.name, record.color, record.slug]), [['race', 'red', 'a-race']])
      await merging.commit()
    } finally {
      for (const held of [inserting, merging]) if (!held.transaction.isCompleted()) await held.rollback()
    }
    assert.deepEqual((await fixture.rows('da_labels')).map(row => [row.name, row.color]), [['race', 'red']])
  })

  it('merges into a record with the same id that another transaction committed after this one first read', async () => {
    const counters = fixture.api.resources.da_counters
    const first = await holdManagedTransaction(fixture.api)
    try {
      assert.deepEqual((await counters.query({ transaction: first.transaction })).data, [])
      await counters.postMany({ data: [{ id: '5001', name: 'race', uses: 1 }] })
      const merged = await counters.postMany({
        data: [{ id: '5001', name: 'race', uses: 2 }],
        onConflict: { keys: ['id'], action: 'merge', merge: ['uses'] },
        returning: 'full',
        transaction: first.transaction
      })
      assert.deepEqual(merged.data.map(record => [record.id, record.name, Number(record.uses)]), [['5001', 'race', 2]])
      await first.commit()
    } finally {
      if (!first.transaction.isCompleted()) await first.rollback()
    }
    assert.deepEqual((await counters.query({})).data.map(record => [record.id, Number(record.uses)]), [['5001', 2]])

    // A late record that the merge leaves unchanged is returned too.
    const second = await holdManagedTransaction(fixture.api)
    try {
      assert.equal((await counters.query({ transaction: second.transaction })).data.length, 1)
      await counters.postMany({ data: [{ id: '5002', name: 'late', uses: 3 }] })
      const unchanged = await counters.postMany({
        data: [{ id: '5002', name: 'late', uses: 3 }],
        onConflict: { keys: ['id'], action: 'merge', merge: ['uses'] },
        returning: 'full',
        transaction: second.transaction
      })
      assert.deepEqual(unchanged.data.map(record => [record.id, record.name, Number(record.uses)]), [['5002', 'late', 3]])
      await second.commit()
    } finally {
      if (!second.transaction.isCompleted()) await second.rollback()
    }
  })

  // On MySQL and MariaDB a locking read of a key no row holds locks the gap where the key would go, and gap locks never
  // wait for each other: two transactions that each hold one on a gap, then insert into it, each wait for the other's,
  // a deadlock. An upsert reads its keys plainly and locks only the rows it finds, so new keys in one gap go in side
  // by side. Each test inserts keys of its own: InnoDB checks a new key that a deleted row not yet purged held with a
  // next-key lock, which the next test's insert beside it would wait for.
  const outcomeOf = promise => promise.then(() => 'saved', error => String(error?.code ?? error))
  const labelKeys = ['workspace_id', 'name']
  const GAP_UPSERTS = {
    'ignore on the owner and name': {
      skip: idKeysOnly,
      upsert: (transaction, n) => fixture.api.resources.da_labels.postMany({
        data: [{ name: `gap ${n}` }], onConflict: { keys: labelKeys, action: 'ignore' }, returning: 'none', transaction
      }, workspaceA()),
      stored: async () => (await fixture.rows('da_labels')).map(row => row.name).sort()
    },
    'merge on the owner and name': {
      skip: idKeysOnly,
      upsert: (transaction, n) => fixture.api.resources.da_labels.postMany({
        data: [{ name: `gap ${n} merged`, color: 'red' }], onConflict: { keys: labelKeys, action: 'merge', merge: ['color'] }, returning: 'none', transaction
      }, workspaceA()),
      stored: async () => (await fixture.rows('da_labels')).map(row => row.name.replace(' merged', '')).sort()
    },
    'ignore on the id': {
      skip: false,
      upsert: (transaction, n) => fixture.api.resources.da_counters.postMany({
        data: [{ id: String(7000 + n), name: `gap ${n}` }], onConflict: { keys: ['id'], action: 'ignore' }, returning: 'none', transaction
      }),
      stored: async () => (await fixture.api.resources.da_counters.query({})).data.map(record => record.name).filter(name => name.startsWith('gap ')).sort()
    }
  }
  const clearGapRows = async () => {
    await fixture.reset()
    const counters = (await fixture.api.resources.da_counters.query({})).data.map(record => record.id).filter(id => Number(id) >= 7000)
    if (counters.length) await fixture.api.resources.da_counters.deleteMany({ ids: counters })
  }

  for (const [name, { skip, upsert, stored }] of Object.entries(GAP_UPSERTS)) {
    it(`${name}: two transactions upserting new keys into one gap, interleaved, both save`, { skip }, async () => {
      await clearGapRows()
      const first = await holdManagedTransaction(fixture.api)
      const second = await holdManagedTransaction(fixture.api)
      let outcomes
      try {
        // The first transaction upserts key 1; the second, key 2, after it in the same gap; then the first, key 3.
        await upsert(first.transaction, 1)
        const secondConnection = await connectionId(second.transaction)
        const pending = outcomeOf(upsert(second.transaction, 2))
        // A gap-locking upsert waits here for the first transaction's gap lock; a plain one has already saved.
        await waitForLockWait(fixture.knex, secondConnection, pending).catch(() => {})
        const third = await outcomeOf(upsert(first.transaction, 3))
        if (third === 'saved') await first.commit()
        const other = await pending
        if (other === 'saved') await second.commit()
        outcomes = [third, other]
      } finally {
        for (const held of [first, second]) if (!held.transaction.isCompleted()) await held.rollback().catch(() => {})
      }
      assert.deepEqual(outcomes, ['saved', 'saved'])
      assert.deepEqual(await stored(), ['gap 1', 'gap 2', 'gap 3'])
    })
  }

  it('upserts of new keys in one gap from two transactions at once never deadlock: 20 rounds in each start order, no retry', { skip: idKeysOnly }, async () => {
    await clearGapRows()
    const outcomes = {}
    for (const action of ['ignore', 'merge']) {
      for (let round = 0; round < 20; round++) {
        for (const order of ['ab', 'ba']) {
          // Each name sorts after every stored one, so both rows go into the table's last gap for the owner.
          const results = await Promise.all([...order].map(side => outcomeOf(fixture.api.transaction(transaction => fixture.api.resources.da_labels.postMany({
            data: [{ name: `${action} ${String(round).padStart(2, '0')} ${order} ${side}`, color: 'red' }],
            onConflict: { keys: labelKeys, action, ...(action === 'merge' ? { merge: ['color'] } : {}) },
            returning: 'none',
            transaction
          }, workspaceA())))))
          for (const result of results) outcomes[result] = (outcomes[result] ?? 0) + 1
        }
      }
    }
    assert.deepEqual(outcomes, { saved: 160 })
    assert.equal((await fixture.rows('da_labels')).length, 160)
  })
})

// An app that imports rows into a wide AnyAPI resource: 155 string fields, a
// row policy that reads the caller's context, and its own audit insert in the
// same api.transaction.
describe(`An import into a wide AnyAPI resource (${storageMode.mode})`, { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, () => {
  const FIELDS = 155
  const fieldNames = Array.from({ length: FIELDS }, (_, index) => `f${index + 1}`)
  const importRows = (count, prefix) => Array.from({ length: count }, (_, row) =>
    Object.fromEntries(fieldNames.map(field => [field, `${prefix} ${row} ${field}`])))
  // Bound parameters per statement: PostgreSQL and MySQL take 65,535, SQLite 32,766.
  const bindLimit = databaseClient === 'better-sqlite3' ? 32766 : 65535
  let database
  let api
  before(async () => {
    database = await createTestDatabase()
    api = new JsonRestApi({ name: 'wide-import-test' })
    await api.use(RestApiPlugin, { format: 'plain', returning: 'full', queryMaxLimit: 100 })
    await api.use(RestApiAnyapiKnexPlugin, { knex: database.knex, tenantId: 'ws:1', ownsKnex: false, slots: { string: FIELDS + 5 } })
    await api.use(RowPolicyPlugin)
    await api.addResource('da_imports', {
      schema: {
        id: { type: 'id' },
        obsolete_at: { type: 'dateTime', nullable: true },
        ...Object.fromEntries(fieldNames.map(field => [field, { type: 'string', nullable: true, max: 60 }]))
      },
      rowPolicy: ({ query, column, context }) => {
        if (!context?.includeObsolete) query.whereNull(column('obsolete_at'))
        return true
      }
    })
    await database.knex.schema.createTable('da_audit_events', table => {
      table.increments('id')
      table.string('record_id').notNullable()
    })
  })
  after(async () => { await database?.close() })

  const importInTransaction = (data, { fail = false } = {}) => api.transaction(async transaction => {
    const created = await api.resources.da_imports.postMany({ data, returning: 'minimal', transaction }, { includeObsolete: true })
    await transaction('da_audit_events').insert(created.data.map(record => ({ record_id: record.id })))
    if (fail) throw new Error('the import fails after its audit rows')
    return created
  })

  it('inserts 500 wide rows in chunks under the bind limit, with ids in input order, in the app transaction', async () => {
    const data = importRows(500, 'row')
    const statements = []
    const record = query => statements.push(query)
    database.knex.on('query', record)
    let created
    try {
      created = await importInTransaction(data)
    } finally {
      database.knex.removeListener('query', record)
    }

    const inserts = statements.filter(query => /^insert into .any_records/i.test(query.sql.trim()))
    assert.ok(inserts.length > 1, `a 500-row chunk of ${FIELDS} fields is split: ${inserts.length} INSERT`)
    // BEGIN and COMMIT bind nothing.
    for (const { sql, bindings = [] } of statements) assert.ok(bindings.length <= bindLimit, `${bindings.length} bindings: ${sql.slice(0, 80)}`)

    const ids = created.data.map(item => item.id)
    assert.equal(new Set(ids).size, 500)
    for (const index of [0, 1, 249, 410, 411, 499]) {
      const imported = await api.resources.da_imports.get({ id: ids[index] }, { includeObsolete: true })
      assert.equal(imported.f1, `row ${index} f1`, `id ${ids[index]} names input row ${index}`)
      assert.equal(imported[`f${FIELDS}`], `row ${index} f${FIELDS}`)
    }
    // The audit rows the app wrote in the same transaction committed with the records.
    assert.deepEqual((await database.knex('da_audit_events').orderBy('id')).map(row => row.record_id), ids)
  })

  it('rolls the records back with the app\'s own writes, and leaves the row policy to reads', async () => {
    const recordsBefore = (await database.knex('any_records').where({ resource: 'da_imports' }).count({ total: '*' }))[0].total
    await assert.rejects(importInTransaction(importRows(3, 'lost'), { fail: true }), /the import fails after its audit rows/)
    assert.equal((await database.knex('any_records').where({ resource: 'da_imports' }).count({ total: '*' }))[0].total, recordsBefore)
    assert.equal((await database.knex('da_audit_events').count({ total: '*' }))[0].total, recordsBefore)

    // A row the policy hides by default is inserted, and is visible only to a caller that asks.
    const [obsolete] = (await importInTransaction([{ f1: 'old', obsolete_at: '2026-01-01T00:00:00.000Z' }])).data
    assert.equal((await api.resources.da_imports.get({ id: obsolete.id }, { includeObsolete: true })).f1, 'old')
    await assert.rejects(api.resources.da_imports.get({ id: obsolete.id }), isA(RestApiResourceError))
  })
})
