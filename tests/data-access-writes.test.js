import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  RestApiBulkInsertIdsError,
  RestApiBulkWriteUnsupportedError,
  RestApiRecordsNotFoundError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
const tableOnly = storageMode.isAnyApi() && 'many-row writes need table storage'

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

  it('refuses many-row writes and locks on AnyAPI storage', { skip: !storageMode.isAnyApi() && 'AnyAPI only' }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const refused = isA(RestApiBulkWriteUnsupportedError)
    await assert.rejects(entries.postMany({ data: newEntries(2) }, workspaceA()), refused)
    await assert.rejects(entries.patchMany({ data: [{ id: '1', amount: 1 }] }, workspaceA()), refused)
    await assert.rejects(entries.patchWhere({ filters: { status: 'open' }, data: { amount: 1 } }, workspaceA()), refused)
    await assert.rejects(entries.deleteMany({ ids: ['1'] }, workspaceA()), refused)
    await assert.rejects(entries.deleteWhere({ filters: { status: 'open' } }, workspaceA()), refused)
    await fixture.api.transaction(async transaction => {
      await assert.rejects(entries.lockByIds({ ids: ['1'], transaction }, workspaceA()), refused)
      await assert.rejects(entries.lockWhere({ filters: { status: 'open' }, transaction }, workspaceA()), refused)
      await assert.rejects(entries.claim({ transaction }, workspaceA()), refused)
    })
  })

  describe('postMany', { skip: tableOnly }, () => {
    it('stamps the owner, checks every row and returns ids in input order', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      assert.equal(await entries.postMany({ data: newEntries(2) }, workspaceA()), undefined, "returning defaults to 'none'")
      const minimal = await entries.postMany({ data: newEntries(3, { start: 200 }), returning: 'minimal' }, workspaceA())
      assert.equal(minimal.data.length, 3)
      const created = await fixture.knex('da_entries').whereIn('id', minimal.data.map(item => item.id)).orderBy('id')
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

      const ids = large.result.data.map(item => Number(item.id))
      const rows = await fixture.knex('da_entries').whereIn('id', ids).orderBy('id')
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

      it('ignores the caller own duplicates and reports only inserted rows', async () => {
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

      it('merges into the caller own rows only and never through another unique index', async () => {
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
          const rows = await transaction('da_entries').whereIn('id', result.data.map(item => item.id)).orderBy('id')
          assert.deepEqual(rows.map(row => row.code), newEntries(5).map(entry => entry.code), path)
          await transaction.raw('SET SESSION auto_increment_increment = 1')
        }))
        // A trigger that rewrites rows: RETURNING still names them, but insertId
        // cannot be verified, so that path refuses the batch and rolls back.
        await knex.raw("CREATE TRIGGER da_entries_rewrite BEFORE INSERT ON da_entries FOR EACH ROW SET NEW.code = CONCAT(NEW.code, '-x')")
        try {
          const before = (await fixture.rows('da_entries')).length
          const write = () => entries.postMany({ data: newEntries(3, { start: 700 }), returning: 'minimal' }, workspaceA())
          if (path === 'insertId') {
            await assert.rejects(run(write), isA(RestApiBulkInsertIdsError))
            assert.equal((await fixture.rows('da_entries')).length, before)
          } else {
            const result = await run(write)
            const rows = await knex('da_entries').whereIn('id', result.data.map(item => item.id)).orderBy('id')
            assert.deepEqual(rows.map(row => row.code), ['N700-x', 'N701-x', 'N702-x'])
          }
        } finally {
          await knex.raw('DROP TRIGGER da_entries_rewrite')
        }
      }
    })
  })

  describe('patchMany, patchWhereIds and patchWhere', { skip: tableOnly }, () => {
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

      const rows = await fixture.knex('da_entries').whereIn('id', [1, 2, 3]).orderBy('id')
      assert.deepEqual(rows.map(row => [Number(row.amount), row.status, Number(row.lock_version)]), [[1000, 'open', 1], [1001, 'held', 1], [1002, 'open', 1]])
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
      assert.equal(Number((await fixture.knex('da_entries').where({ id: 1 }).first()).amount), 10, 'refusals roll back')
      const skipped = await entries.patchWhereIds({ ids: ['1', '4', '7'], data: { status: 'held' }, missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(skipped.data.map(item => item.id), ['1'])
      const statuses = await fixture.knex('da_entries').whereIn('id', [1, 4, 7]).orderBy('id').pluck('status')
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
      await assert.rejects(entries.patchMany({ data: [{ id: '1' }] }, workspaceA()), invalid, 'an empty patch row')
    })

    it('applies onlyIf as compare-and-set and returns only the changed ids', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      await fixture.knex('da_entries').where({ id: 2 }).update({ status: 'held' })
      const result = await entries.patchWhereIds({ ids: ['1', '2', '3'], data: { status: 'closed' }, onlyIf: { status: 'open' }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(result.data.map(item => item.id).sort(), ['1', '3'])
      const rows = await fixture.knex('da_entries').whereIn('id', [1, 2, 3]).orderBy('id')
      assert.deepEqual(rows.map(row => [row.status, Number(row.lock_version)]), [['closed', 1], ['held', 0], ['closed', 1]])

      // The lock version is the usual compare-and-set column.
      const stale = await entries.patchWhereIds({ ids: ['1'], data: { amount: 5 }, onlyIf: { lock_version: 0 }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(stale.data, [])
    })

    it('accepts raw expressions for stored fields', async () => {
      await seedLedger(fixture)
      const entries = fixture.api.resources.da_entries
      const knex = fixture.knex
      await entries.patchWhereIds({ ids: ['1', '2'], data: { amount: knex.raw('?? + ?', ['amount', 5]) } }, workspaceA())
      assert.deepEqual((await knex('da_entries').whereIn('id', [1, 2]).orderBy('id').pluck('amount')).map(Number), [15, 25])
      await assert.rejects(entries.patchWhereIds({ ids: ['1'], data: { account: knex.raw('1') } }, workspaceA()), isA(RestApiValidationError))
    })

    it('patches every row a filter selects inside the scope', async () => {
      await seedLedger(fixture, { entriesPerAccount: 30 })
      const entries = fixture.api.resources.da_entries
      const result = await entries.patchWhere({ filters: { status: 'open' }, data: { status: 'archived' }, returning: 'minimal' }, workspaceA())
      assert.equal(result.data.length, 30)
      const counts = await fixture.knex('da_entries').select('workspace_id', 'access_group', 'status').count({ total: '*' }).groupBy('workspace_id', 'access_group', 'status').orderBy(['workspace_id', 'access_group'])
      assert.deepEqual(counts.map(row => [row.workspace_id, row.access_group, row.status, Number(row.total)]), [
        ['ws-a', 'g1', 'archived', 30], ['ws-a', 'g2', 'open', 30], ['ws-b', 'g1', 'open', 30]
      ])
      const none = await entries.patchWhere({ filters: { status: 'open' }, data: { status: 'x' }, returning: 'minimal' }, workspaceA())
      assert.deepEqual(none.data, [])
      await assert.rejects(entries.patchWhere({ filters: { unknown_field: 1 }, data: { status: 'x' } }, workspaceA()), isA(RestApiValidationError))
    })

    it('advances the lock version on single writes too', async () => {
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

  describe('deleteMany and deleteWhere', { skip: tableOnly }, () => {
    it('deletes visible rows by id with flat statement counts and removes their links', async () => {
      const entries = fixture.api.resources.da_entries
      await seedLedger(fixture, { entriesPerAccount: 10 })
      const small = await fixture.measure(() => entries.deleteMany({ ids: Array.from({ length: 10 }, (_, index) => String(index + 1)), returning: 'minimal' }, workspaceA()))
      await seedLedger(fixture, { entriesPerAccount: 200 })
      await fixture.seed('da_labels', [{ id: '1', name: 'flag', workspace_id: 'ws-a' }])
      await fixture.seed('da_entry_labels', [{ id: '1', entry_id: 1, label_id: 1 }, { id: '2', entry_id: 250, label_id: 1 }])
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

  describe('batch hooks', { skip: tableOnly }, () => {
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

  it('serves the second workspace the same way', { skip: tableOnly }, async () => {
    await seedLedger(fixture)
    const entries = fixture.api.resources.da_entries
    const created = await entries.postMany({ data: newEntries(2, { account: 3 }), returning: 'minimal' }, workspaceB())
    await entries.patchWhereIds({ ids: ['7', ...created.data.map(item => item.id)], data: { status: 'held' } }, workspaceB())
    await assert.rejects(entries.patchWhereIds({ ids: ['1'], data: { status: 'held' } }, workspaceB()), isA(RestApiRecordsNotFoundError))
    const held = await fixture.knex('da_entries').where({ status: 'held' }).orderBy('id').pluck('workspace_id')
    assert.deepEqual(held, ['ws-b', 'ws-b', 'ws-b'])
  })
})

// A fixture of its own: the one above gains permission and batch hooks, which
// keep the visibility read.
describe(`Many-row writes that skip missing rows (${storageMode.mode})`, { skip: tableOnly }, () => {
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
    assert.deepEqual(await fixture.knex('da_entries').whereIn('id', [1, 4, 7]).orderBy('id').pluck('status'), ['held', 'open', 'open'])
    const refused = await fixture.measure(() => entries.patchWhereIds({ ids: ['2', '3'], data: { status: 'held' }, returning: 'minimal' }, workspaceA()))
    assert.equal(patched.statements, refused.statements - saved, `skip: ${patched.sql.join(' | ')}\nthrow: ${refused.sql.join(' | ')}`)

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

// A fixture of its own: these tests add hooks and a resource.
describe(`Selection writes, counts and upserts on the id (${storageMode.mode})`, { skip: tableOnly }, () => {
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
    const labels = fixture.api.resources.da_labels
    await fixture.seed('da_labels', [{ id: '1', name: 'flag', workspace_id: 'ws-a' }])
    const keys = ['workspace_id', 'name']
    assert.deepEqual(await labels.postMany({ data: [{ name: 'flag' }, { name: 'fresh' }], onConflict: { keys, action: 'ignore' }, returning: 'count' }, workspaceA()), count(1))
    assert.deepEqual(await labels.postMany({ data: [{ name: 'flag', color: 'red' }, { name: 'new' }], onConflict: { keys, action: 'merge', merge: ['color'] }, returning: 'count' }, workspaceA()), count(2))

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
            await change.run(knexQuery.db('da_entries').where('id', change.id))
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
    const filtered = await changing(2, rows => rows.update({ status: 'closed' }), () => entries.patchWhere({ filters: { status: 'open' }, data: { status: 'held' }, returning: 'minimal' }, workspaceA()))
    assert.deepEqual(filtered.data.map(item => item.id), ['1', '3'])
    assert.deepEqual(await fixture.knex('da_entries').whereIn('id', [1, 2, 3]).orderBy('id').pluck('status'), ['held', 'closed', 'held'])

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
            if (literal && knexQuery?.scopeName === 'da_entries' && knexQuery.queryPurpose === 'bulk-write') knexQuery.query.whereRaw("da_entries.code <> 'E?'")
          }
        }
      }
    })
    literal = true
    try {
      const deleted = await fixture.api.resources.da_entries.deleteMany({ ids: ['1', '2'], missing: 'skip', returning: 'minimal' }, workspaceA())
      assert.deepEqual(deleted.data.map(item => item.id), ['1', '2'])
    } finally { literal = false }
    assert.deepEqual(await fixture.knex('da_entries').whereIn('id', [1, 2, 3]).pluck('id'), [3])
  })

  it('gives after-hooks the ids and inputs of the changed rows, in the same order', async () => {
    await seedLedger(fixture)
    await fixture.knex('da_entries').where('id', 2).update({ status: 'held' })
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
        id: { type: 'string', primary: true, required: true, maxLength: 100, storage: { column: 'email' } },
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
    assert.deepEqual(await fixture.knex('da_sign_ins').orderBy('email').pluck('email'), ['ann@example.com', 'bob@example.com'])
  })
})
