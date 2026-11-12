import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  FileHandlingPlugin,
  RestApiBulkWriteUnsupportedError,
  RestApiRecordsNotFoundError,
  RestApiResourceError,
  RestApiScopedQueryReadOnlyError,
  RestApiValidationError,
  createSystemContext
} from '../index.js'
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js'
import { readOnlyQueryBuilder } from '../plugins/core/lib/querying/read-only-query.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { cleanTables } from './helpers/test-utils.js'
import { createDataAccessFixture, seedLedger, workspaceA, workspaceB } from './fixtures/data-access-api.js'

// Regression tests for the security review of many-row writes, scoped reads and locks.
const cause = error => error?.cause ?? error
const isA = Class => error => cause(error) instanceof Class
const forbidden = error => isA(RestApiResourceError)(error) && cause(error).subtype === 'forbidden'
const tableOnly = storageMode.isAnyApi() && 'needs table storage'
// A caller whose workspace does not resolve: optional owner filters stay open.
const anonymous = () => ({ visibility: { groups: ['g1'] } })
const EXTRA_TABLES = ['da_tag_items', 'da_tags', 'da_notes', 'da_assets', 'da_merge_hooked', 'da_ranked', 'da_docs', 'da_flags', 'da_stock']
const UNPOSITIONED = ['da_accounts', 'da_entries', 'da_labels', 'da_entry_labels', 'da_jobs', ...EXTRA_TABLES.filter(table => table !== 'da_ranked')]

describe(`Data-access hardening (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createDataAccessFixture({
      extraPlugins: async api => {
        // Positioning applies to every resource it does not exclude; only da_ranked is positioned.
        if (!storageMode.isAnyApi()) await api.use(PositioningPlugin, { excludeResources: ['system_migrations', 'system_logs', ...UNPOSITIONED] })
        await api.use(FileHandlingPlugin)
      }
    })
    const hook = (functionName, handler) => ({ functionName, handler })
    await fixture.api.customize({
      hooks: {
        // Masks a field in every read record the caller names.
        enrichRecord: hook('hardening-mask', ({ context }) => {
          if (!context.maskField || !Array.isArray(context.record?.data)) return
          for (const entry of context.record.data) entry.attributes[context.maskField] = `masked:${context.lock === true}`
        }),
        checkDataPermissions: hook('hardening-deny', ({ context }) => {
          if (context.denyIds?.includes(String(context.id))) throw new RestApiResourceError('Denied', { subtype: 'forbidden' })
        }),
        checkPermissions: hook('hardening-permissions', async ({ context }) => {
          const original = context.originalContext || {}
          if (context.method === 'patch' && original.denyPatch) throw new RestApiResourceError('No patches', { subtype: 'forbidden' })
          // Another writer moves rows to workspace B between the visibility read and the write.
          if (original.moveToB) await original.transaction('da_entries').whereIn('id', original.moveToB).update({ workspace_id: 'ws-b' })
        })
      }
    })
    if (storageMode.isAnyApi()) return
    const add = async (name, options) => {
      await fixture.api.addResource(name, { tableName: name, ...options })
      await fixture.api.resources[name].createKnexTable()
    }
    await add('da_tags', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, workspace_id: { type: 'string', nullable: true, max: 40 } },
      relationships: { items: { type: 'manyToMany', target: 'da_entries', through: 'da_tag_items', foreignKey: 'tag_id', otherKey: 'entry_id' } },
      autofilter: 'workspace_or_shared'
    })
    await add('da_tag_items', {
      schema: {
        id: { type: 'id' },
        tag_id: { type: 'number', required: true, belongsTo: 'da_tags', as: 'tag' },
        entry_id: { type: 'number', required: true, belongsTo: 'da_entries', as: 'entry' }
      }
    })
    await add('da_notes', {
      schema: { id: { type: 'id' }, body: { type: 'string', required: true, max: 40 }, workspace_id: { type: 'string', nullable: true, max: 40 } },
      autofilter: [{ field: 'workspace_id', resolver: 'workspace', shared: true, required: false }]
    })
    await add('da_assets', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, max: 40 },
        owner_type: { type: 'string', nullable: true, max: 40 },
        owner_id: { type: 'string', required: true, max: 40 }
      },
      relationships: { owner: { belongsToPolymorphic: { types: ['da_accounts', 'da_labels'], typeField: 'owner_type', idField: 'owner_id' } } },
      autofilter: [{ field: 'owner_id', resolver: 'workspace' }]
    })
    await add('da_merge_hooked', {
      schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, color: { type: 'string', nullable: true, max: 20 } },
      indexes: [{ columns: ['name'], unique: true }],
      hooks: { beforeDataCallPatch: { functionName: 'per-record-patch', handler: () => {} } }
    })
    await add('da_ranked', { schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, position: { type: 'string', nullable: true, max: 255 } } })
    await add('da_docs', {
      schema: { id: { type: 'id' }, title: { type: 'string', required: true, max: 40 }, attachment: { type: 'file', nullable: true, storage: { upload: async () => 'stored' } } }
    })
    await add('da_flags', { schema: { id: { type: 'id' }, name: { type: 'string', required: true, max: 40 }, color: { type: 'string', nullable: true, max: 20 }, note: { type: 'string', virtual: true } } })
    await add('da_stock', {
      schema: {
        id: { type: 'id' },
        sku: { type: 'string', required: true, max: 40 },
        active: { type: 'boolean', required: true },
        qty: { type: 'integer', defaultTo: 0 },
        note: { type: 'string', defaultTo: 'none', max: 40 },
        // A setter that produces its field from another one.
        label: { type: 'string', nullable: true, max: 40, runSetterAfter: ['sku'], setter: (_value, { attributes }) => `label-${attributes.sku}` }
      },
      indexes: [{ columns: ['sku', 'active'], unique: true }]
    })
  })
  after(async () => { await fixture?.close() })

  const resetAll = async () => {
    if (!storageMode.isAnyApi()) await cleanTables(fixture.knex, EXTRA_TABLES)
    await seedLedger(fixture)
  }
  const count = async query => Number((await query.count({ total: '*' }).first()).total)

  describe('scopedQuery', () => {
    it('cannot be widened by OR conditions a caller adds', async () => {
      await resetAll()
      const entries = fixture.api.resources.da_entries
      // Resolves to { query }: awaiting the builder itself would run it.
      const scoped = () => entries.scopedQuery({}, workspaceA())
      assert.equal(await count((await scoped()).query), 3)
      assert.equal(await count((await scoped()).query.whereRaw('1 = 0 or 1 = 1')), 3)
      assert.equal(await count((await scoped()).query.whereRaw('1 = 0').orWhereRaw('1 = 1')), 3)
      if (!storageMode.isAnyApi()) {
        assert.equal(await count((await scoped()).query.where('amount', '<', 0).orWhere('workspace_id', 'ws-b')), 0)
        assert.equal(await count((await scoped()).query.where('amount', '>', 0).orWhereIn('id', [7, 8, 9])), 3)
        const { query } = await entries.scopedQuery({ alias: 'e' }, workspaceA())
        const codes = await query.where('e.amount', '>', 10).orWhere('e.code', 'E7').orderBy('e.id').pluck('e.code')
        assert.deepEqual(codes, ['E2', 'E3'])
      }
    })

    it('refuses set operations, common table expressions, the client and property tricks', async () => {
      await resetAll()
      const { query } = await fixture.api.resources.da_entries.scopedQuery({}, workspaceA())
      for (const [method, args] of [
        ['with', ['x', fixture.knex.raw('select 1')]], ['withRecursive', ['x', fixture.knex.raw('select 1')]],
        ['withMaterialized', ['x', fixture.knex.raw('select 1')]], ['union', [fixture.knex('da_entries')]],
        ['unionAll', [fixture.knex('da_entries')]], ['intersect', [fixture.knex('da_entries')]],
        ['except', [fixture.knex('da_entries')]], ['fromRaw', ['da_entries']]
      ]) {
        assert.throws(() => query[method](...args), RestApiScopedQueryReadOnlyError, method)
      }
      assert.throws(() => query.client, RestApiScopedQueryReadOnlyError)
      assert.throws(() => { query.client = null }, RestApiScopedQueryReadOnlyError)
      assert.throws(() => Object.defineProperty(query, '_method', { value: 'del' }), RestApiScopedQueryReadOnlyError)
      assert.throws(() => { delete query._statements }, RestApiScopedQueryReadOnlyError)
      assert.throws(() => { delete query._method }, RestApiScopedQueryReadOnlyError)
      // Compilers take a read-only builder as a subquery value, whatever database this run
      // uses: MySQL's inspects it as an object, SQLite's rewrites its limit.
      for (const client of ['mysql2', 'better-sqlite3']) {
        const db = knexLib({ client, useNullAsDefault: true })
        const subquery = readOnlyQueryBuilder(db('da_entries').select('account_id').limit(1))
        assert.match(db('da_accounts').where('id', '=', subquery).toSQL().sql, /= \(select `account_id` from `da_entries` limit \?\)/, client)
        await db.destroy()
      }
      assert.throws(() => { query._statements = [] }, RestApiScopedQueryReadOnlyError)
      assert.throws(() => { query._single = {} }, RestApiScopedQueryReadOnlyError)
      // The statement lists read as frozen copies, so they cannot change in place.
      const narrowed = query.clone().whereRaw('1 = 1')
      const statements = narrowed._statements
      assert.ok(statements.length && Object.isFrozen(statements) && statements.every(statement => Object.isFrozen(statement)))
      assert.throws(() => statements.push({ grouping: 'where', type: 'whereRaw', value: fixture.knex.raw('1 = 1') }), TypeError)
      assert.throws(() => { statements[0].value = null }, TypeError)
      // The single values read as a copy; changing it changes no query.
      narrowed._single.table = 'da_accounts'
      assert.equal(await count(narrowed), 3)
      // Knex's own methods still reach the client, and modify passes the read-only builder on.
      assert.throws(() => query.clone().modify(builder => builder.del()), RestApiScopedQueryReadOnlyError)
      assert.equal(await count(query.clone().modify(builder => builder.whereRaw('1 = 1'))), 3)
    })

    // A plain builder compiles a read-only one as a subquery from its statement copies, which dropped every join
    // before 3.1.5: the statement failed, or ran without the join's narrowing and matched more rows.
    it('keeps its joins when a plain builder compiles it as a subquery, on every compiler', async () => {
      for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
        const db = knexLib({ client, useNullAsDefault: true })
        try {
          // A join a predicate names, and one whose ON clause alone narrows.
          const named = () => db('tasks as t').join('projects as p', 'p.id', 't.project_id').where('p.owner_id', 7)
          const onOnly = () => db('notes as n').join('memberships as m', function () {
            this.on('m.workspace_id', 'n.workspace_id').andOnVal('m.user_id', '=', 42)
          })
          const shapes = {
            whereExists: wrap => db('docs').whereExists(wrap(onOnly().select(1).whereColumn('n.id', 'docs.note_id'))),
            whereIn: wrap => db('docs').whereIn('note_id', wrap(onOnly().select('n.id'))),
            joinedSubquery: wrap => db('docs').join(wrap(onOnly().select('n.id')).as('v'), 'v.id', 'docs.note_id'),
            fromSubquery: wrap => db.from(wrap(onOnly().select('n.id')).as('v')).select('v.id'),
            namedJoin: wrap => db('docs').whereExists(wrap(named().select(1).whereColumn('t.id', 'docs.task_id'))),
            // A derived table over a read-only builder with a join (a JSKIT join source's shape), in a plain whereExists.
            derivedTable: wrap => db('users as u').whereExists(
              wrap(db.from(wrap(named().select('t.id', 't.owner_id')).as('k'))).select(1).whereColumn('k.owner_id', 'u.id')
            )
          }
          for (const [shape, build] of Object.entries(shapes)) {
            const plain = build(builder => builder).toSQL()
            const readOnly = build(builder => readOnlyQueryBuilder(builder)).toSQL()
            assert.match(plain.sql, /\bjoin\b/i, `${client} ${shape}`)
            assert.equal(readOnly.sql, plain.sql, `${client} ${shape}`)
            assert.deepEqual(readOnly.bindings, plain.bindings, `${client} ${shape}`)
          }
          // The copies still refuse changes, and a copied join is still a join.
          const statements = readOnlyQueryBuilder(onOnly())._statements
          const join = statements.find(statement => statement.joinType)
          assert.equal(join.grouping, 'join', client)
          assert.ok(Object.isFrozen(statements) && Object.isFrozen(join), client)
          assert.throws(() => statements.push({ grouping: 'where', type: 'whereRaw', value: db.raw('1 = 1') }), TypeError, client)
          assert.throws(() => { join.table = 'other' }, TypeError, client)
        } finally {
          await db.destroy()
        }
      }
    })

    it('keeps its joins when a plain builder runs it as a subquery', { skip: tableOnly }, async () => {
      await resetAll()
      const db = fixture.knex
      const scoped = () => fixture.api.resources.da_entries.scopedQuery({ alias: 'e' }, workspaceA())
      // Workspace A sees E1 to E3 (amounts 10, 20, 30). The join's ON clause alone keeps E2 and E3. It answers
      // { query }, as scopedQuery does: an async function answering the builder itself would run it.
      const narrowed = async () => {
        const { query } = await scoped()
        return { query: query.join('da_accounts as ja', function () { this.on('ja.id', 'e.account_id').andOnVal('e.amount', '>', 15) }) }
      }
      const expected = ['E2', 'E3']
      const runs = {
        topLevel: subquery => subquery.orderBy('e.code').pluck('e.code'),
        whereExists: subquery => db('da_entries as o').whereExists(subquery.select(1).whereColumn('e.id', 'o.id')).orderBy('o.code').pluck('o.code'),
        whereIn: subquery => db('da_entries').whereIn('id', subquery.select('e.id')).orderBy('code').pluck('code'),
        joinedSubquery: subquery => db('da_entries as o').join(subquery.select('e.id').as('v'), 'v.id', 'o.id').orderBy('o.code').pluck('o.code'),
        fromSubquery: subquery => db.from(subquery.select('e.code').as('v')).orderBy('v.code').pluck('v.code')
      }
      for (const [shape, run] of Object.entries(runs)) {
        assert.deepEqual(await run((await narrowed()).query), expected, shape)
      }
      // A predicate on the joined table: without the join the statement fails.
      const { query } = await scoped()
      const named = query.join('da_accounts as ja', 'ja.id', 'e.account_id').where('ja.name', 'A visible').where('e.amount', '>', 15)
      assert.deepEqual(await runs.whereExists(named), expected)
    })
  })

  describe('upserts', { skip: tableOnly }, () => {
    it('refuses ids and repeated keys, whatever the action', async () => {
      await resetAll()
      await fixture.seed('da_labels', [
        { id: '1', name: 'urgent', color: 'red', slug: 'a-urgent', workspace_id: 'ws-a' },
        { id: '2', name: 'urgent', color: 'blue', slug: 'b-urgent', workspace_id: 'ws-b' }
      ])
      const labels = fixture.api.resources.da_labels
      for (const action of ['ignore', 'merge']) {
        const onConflict = { keys: ['workspace_id', 'name'], action, ...(action === 'merge' ? { merge: ['color'] } : {}) }
        // An explicit id would reach workspace B's row through the primary key.
        await assert.rejects(labels.postMany({ data: [{ id: '2', name: 'urgent', color: 'black' }], onConflict }, workspaceA()), isA(RestApiValidationError), action)
        await assert.rejects(labels.postMany({ data: [{ name: 'twice', color: 'a' }, { name: 'twice', color: 'b' }], onConflict }, workspaceA()), isA(RestApiValidationError), action)
      }
      assert.deepEqual((await fixture.rows('da_labels')).map(row => [row.workspace_id, row.color]), [['ws-a', 'red'], ['ws-b', 'blue']])
    })

    it('merges with flat statement counts and checks patch permission on the rows it updates', async () => {
      const labels = fixture.api.resources.da_labels
      const run = async size => {
        await resetAll()
        await fixture.seed('da_labels', Array.from({ length: size }, (_, index) => ({ id: String(index + 1), name: `L${index}`, color: 'red', workspace_id: 'ws-a' })))
        const data = Array.from({ length: size * 2 }, (_, index) => ({ name: `L${index}`, color: 'green' }))
        const measured = await fixture.measure(() => labels.postMany({ data, returning: 'minimal', onConflict: { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] } }, workspaceA()))
        assert.equal(measured.result.data.length, size * 2)
        assert.deepEqual(measured.result.data.slice(0, size).map(item => String(item.id)), Array.from({ length: size }, (_, index) => String(index + 1)))
        const stored = await fixture.rows('da_labels')
        assert.equal(stored.length, size * 2)
        assert.ok(stored.every(row => row.color === 'green' && row.workspace_id === 'ws-a'))
        return measured.statements
      }
      // The first upsert on a table also reads its unique indexes.
      await run(4)
      assert.equal(await run(4), await run(60))

      await resetAll()
      await fixture.seed('da_labels', [{ id: '1', name: 'kept', color: 'red', workspace_id: 'ws-a' }])
      const merge = { keys: ['workspace_id', 'name'], action: 'merge', merge: ['color'] }
      await assert.rejects(labels.postMany({ data: [{ name: 'kept', color: 'x' }, { name: 'new', color: 'x' }], onConflict: merge }, { ...workspaceA(), denyPatch: true }), forbidden)
      assert.deepEqual((await fixture.rows('da_labels')).map(row => [row.name, row.color]), [['kept', 'red']])
      // Rows that only insert need no patch permission.
      await labels.postMany({ data: [{ name: 'new', color: 'x' }], onConflict: merge }, { ...workspaceA(), denyPatch: true })

      // Merged rows are patches: a per-record patch hook without a batch form refuses merge, not ignore.
      const hooked = fixture.api.resources.da_merge_hooked
      await hooked.post({ data: { name: 'one', color: 'red' } })
      await assert.rejects(hooked.postMany({ data: [{ name: 'one', color: 'x' }], onConflict: { keys: ['name'], action: 'merge' } }), isA(RestApiBulkWriteUnsupportedError))
      const ignored = await hooked.postMany({ data: [{ name: 'one' }, { name: 'two' }], returning: 'minimal', onConflict: { keys: ['name'], action: 'ignore' } })
      assert.equal(ignored.data.length, 1)
    })

    it('merges only the fields a row supplies, never schema defaults', async () => {
      await resetAll()
      const stock = fixture.api.resources.da_stock
      await fixture.knex('da_stock').insert({ id: 1, sku: 'A', active: true, qty: 5, note: 'kept', label: 'old' })
      const merge = onConflict => stock.postMany({ data: [{ sku: 'A', active: true, note: 'new' }], onConflict: { keys: ['sku', 'active'], action: 'merge', ...onConflict } })
      const stored = async () => {
        const row = await fixture.knex('da_stock').where('id', 1).first()
        return [Number(row.qty), row.note, row.label]
      }
      // qty defaults to 0 and was not sent; the setter adds label from sku.
      await merge({})
      assert.deepEqual(await stored(), [5, 'new', 'label-A'])
      await fixture.knex('da_stock').where('id', 1).update({ note: 'kept', label: 'old' })
      await merge({ merge: ['qty', 'note'] })
      assert.deepEqual(await stored(), [5, 'new', 'old'])
      assert.equal(await count(fixture.knex('da_stock')), 1)
    })

    it('compares conflict keys exactly, after each field\'s read normalization', async () => {
      await resetAll()
      const stock = fixture.api.resources.da_stock
      await fixture.knex('da_stock').insert({ id: 1, sku: 'ab', active: true, qty: 5, note: 'kept' })
      const onConflict = action => ({ keys: ['sku', 'active'], action, ...(action === 'merge' ? { merge: ['qty'] } : {}) })
      // Booleans come back as 1 or true depending on the database; both match true.
      await stock.postMany({ data: [{ sku: 'ab', active: true, qty: 9 }], onConflict: onConflict('merge') })
      const ignored = await stock.postMany({ data: [{ sku: 'ab', active: true }], returning: 'minimal', onConflict: onConflict('ignore') })
      assert.deepEqual(ignored.data, [])
      assert.deepEqual((await fixture.knex('da_stock').select('sku', 'qty')).map(row => [row.sku, Number(row.qty)]), [['ab', 9]])
      // MySQL's default collations ignore case, so the database matches a key that is
      // not equal. The test databases use utf8mb4_bin; give the column a _ci collation.
      const sku = collation => fixture.knex.raw(`ALTER TABLE da_stock MODIFY sku VARCHAR(40) CHARACTER SET utf8mb4 COLLATE ${collation} NOT NULL`)
      if (databaseClient === 'mysql2') await sku('utf8mb4_general_ci')
      try {
        for (const action of ['ignore', 'merge']) {
          const upsert = stock.postMany({ data: [{ sku: 'AB', active: true, qty: 1 }], onConflict: onConflict(action) })
          if (databaseClient === 'mysql2') {
            await assert.rejects(upsert, error => isA(RestApiResourceError)(error) && cause(error).subtype === 'conflict' && /match exactly/.test(cause(error).message), action)
          } else {
            await upsert
            await fixture.knex('da_stock').where('sku', 'AB').del()
          }
        }
      } finally {
        if (databaseClient === 'mysql2') await sku('utf8mb4_bin')
      }
      assert.deepEqual((await fixture.knex('da_stock').select('sku', 'qty')).map(row => [row.sku, Number(row.qty)]), [['ab', 9]])
    })

    it('refuses merge when no unique index covers the conflict keys', async () => {
      await resetAll()
      const flags = fixture.api.resources.da_flags
      await flags.post({ data: { name: 'one' } })
      await assert.rejects(flags.postMany({ data: [{ name: 'one', color: 'red' }], onConflict: { keys: ['name'], action: 'merge' } }), error => isA(RestApiBulkWriteUnsupportedError)(error) && /no unique index/.test(cause(error).message))
      if (databaseClient === 'mysql2') {
        await assert.rejects(flags.postMany({ data: [{ name: 'one' }], onConflict: { keys: ['name'], action: 'ignore' } }), isA(RestApiBulkWriteUnsupportedError))
      }
      assert.equal(await count(fixture.knex('da_flags')), 1)
    })
  })

  describe('shared rows', { skip: tableOnly }, () => {
    it('refuses relationship changes on shared rows and leaves links to hidden targets', async () => {
      await resetAll()
      await fixture.seed('da_tags', [{ id: '1', name: 'shared', workspace_id: null }, { id: '2', name: 'mine', workspace_id: 'ws-a' }])
      await fixture.seed('da_tag_items', [
        { id: '1', tag_id: 1, entry_id: 1 },
        { id: '2', tag_id: 1, entry_id: 7 },
        { id: '3', tag_id: 2, entry_id: 1 },
        { id: '4', tag_id: 2, entry_id: 7 }
      ])
      const tags = fixture.api.resources.da_tags
      const link = (id, entryId) => ({ id, relationshipName: 'items', relationshipData: [{ type: 'da_entries', id: entryId }] })
      const pivots = async () => (await fixture.rows('da_tag_items')).map(row => `${row.tag_id}-${row.entry_id}`)
      await assert.rejects(tags.deleteRelationship(link('1', '7'), workspaceA()), forbidden)
      await assert.rejects(tags.deleteRelationship(link('1', '1'), workspaceA()), forbidden)
      await assert.rejects(tags.postRelationship(link('1', '2'), workspaceA()), forbidden)
      // Workspace A cannot see entry 7, so removing that link from its own tag leaves it, like a missing one.
      await tags.deleteRelationship(link('2', '7'), workspaceA())
      assert.deepEqual(await pivots(), ['1-1', '1-7', '2-1', '2-7'])
      await tags.deleteRelationship(link('2', '1'), workspaceA())
      await tags.deleteRelationship(link('1', '7'), createSystemContext('tidy shared tags'))
      assert.deepEqual(await pivots(), ['1-1', '2-7'])
    })

    it('keeps shared rows out of writes when an optional owner does not resolve', async () => {
      await resetAll()
      await fixture.seed('da_notes', [
        { id: '1', body: 'shared', workspace_id: null },
        { id: '2', body: 'a', workspace_id: 'ws-a' },
        { id: '3', body: 'b', workspace_id: 'ws-b' }
      ])
      const notes = fixture.api.resources.da_notes
      assert.equal(await count((await notes.scopedQuery({}, anonymous())).query), 3)
      assert.equal(await count((await notes.scopedQuery({ purpose: 'bulk-write' }, anonymous())).query), 2)
      await assert.rejects(notes.patchMany({ data: [{ id: '1', body: 'x' }] }, anonymous()), isA(RestApiRecordsNotFoundError))
      await assert.rejects(notes.deleteMany({ ids: ['1'] }, anonymous()), isA(RestApiRecordsNotFoundError))
      await assert.rejects(notes.post({ data: { body: 'new shared' } }, anonymous()), forbidden)
      await assert.rejects(notes.postMany({ data: [{ body: 'new shared' }] }, anonymous()), forbidden)
      await notes.post({ data: { body: 'owned', workspace_id: 'ws-a' } }, anonymous())
      const stored = await fixture.rows('da_notes')
      assert.deepEqual(stored.map(row => [row.body, row.workspace_id]), [['shared', null], ['a', 'ws-a'], ['b', 'ws-b'], ['owned', 'ws-a']])
    })
  })

  describe('row moves between the visibility read and the write', { skip: tableOnly }, () => {
    it('writes, deletes and locks only rows still in the caller scope', async () => {
      await resetAll()
      const entries = fixture.api.resources.da_entries
      const moving = { ...workspaceA(), moveToB: ['1'] }
      await assert.rejects(entries.patchMany({ data: [{ id: '1', amount: 1 }, { id: '2', amount: 2 }] }, moving), isA(RestApiRecordsNotFoundError))
      assert.deepEqual((await fixture.knex('da_entries').where({ id: 1 }).first()).workspace_id, 'ws-a', 'the batch rolled back')

      const skipped = await entries.patchMany({ data: [{ id: '1', amount: 1 }, { id: '2', amount: 2 }], missing: 'skip', returning: 'minimal' }, moving)
      assert.deepEqual(skipped.data.map(item => String(item.id)), ['2'])
      const moved = await fixture.knex('da_entries').where({ id: 1 }).first()
      assert.deepEqual([moved.workspace_id, Number(moved.amount)], ['ws-b', 10])

      await resetAll()
      await assert.rejects(entries.deleteMany({ ids: ['1', '2'] }, moving), isA(RestApiRecordsNotFoundError))
      const deleted = await entries.deleteMany({ ids: ['1', '2'], missing: 'skip', returning: 'minimal' }, moving)
      assert.deepEqual(deleted.data.map(item => String(item.id)), ['2'])
      assert.equal((await fixture.knex('da_entries').where({ id: 1 }).first()).workspace_id, 'ws-b')

      await resetAll()
      await fixture.api.transaction(async transaction => {
        const locked = await entries.lockByIds({ ids: ['1', '2'], missing: 'skip', transaction }, { ...moving })
        assert.deepEqual(locked.data.map(record => String(record.id)), ['2'])
      })
    })
  })

  describe('lock reads', { skip: tableOnly }, () => {
    it('run the read hooks of query and get on the locked rows', async () => {
      await resetAll()
      await fixture.seed('da_jobs', [
        { id: '1', state: 'queued', priority: 1, workspace_id: 'ws-a', account_id: 1 },
        { id: '2', state: 'queued', priority: 5, workspace_id: 'ws-a', account_id: 1 }
      ])
      const entries = fixture.api.resources.da_entries
      const jobs = fixture.api.resources.da_jobs
      await fixture.api.transaction(async transaction => {
        const locked = await entries.lockByIds({ ids: ['1', '2'], transaction }, { ...workspaceA(), maskField: 'code' })
        assert.deepEqual(locked.data.map(record => record.code), ['masked:true', 'masked:true'])
        await assert.rejects(entries.lockByIds({ ids: ['1', '2'], transaction }, { ...workspaceA(), denyIds: ['2'] }), forbidden)
        const claimed = await jobs.claim({ filters: { state: 'queued' }, sort: ['-priority'], limit: 2, transaction }, { ...workspaceA(), maskField: 'state' })
        assert.deepEqual(claimed.data.map(record => [String(record.id), record.state]), [['2', 'masked:true'], ['1', 'masked:true']])
        await assert.rejects(jobs.claim({ filters: { state: 'queued' }, transaction }, { ...workspaceA(), denyIds: ['1'] }), forbidden)
      })
    })

    it('locks a MySQL claim window by primary key on the bare table', { skip: databaseClient !== 'mysql2' && 'MySQL and MariaDB only' }, async () => {
      await resetAll()
      await fixture.seed('da_jobs', [
        { id: '1', state: 'queued', priority: 1, workspace_id: 'ws-a', account_id: 1 },
        { id: '2', state: 'done', priority: 5, workspace_id: 'ws-a', account_id: 1 },
        { id: '3', state: 'queued', priority: 3, workspace_id: 'ws-a', account_id: 1 }
      ])
      await fixture.api.transaction(async transaction => {
        const { result, sql } = await fixture.measure(() =>
          fixture.api.resources.da_jobs.claim({ filters: { state: 'queued' }, sort: ['-priority'], limit: 2, transaction }, workspaceA()))
        assert.deepEqual(result.data.map(record => String(record.id)), ['3', '1'])
        const [byKey] = sql.filter(statement => /skip locked/i.test(statement))
        assert.match(byKey, /where `da_jobs`\.`id` in \(\?, \?\) and `da_jobs`\.`workspace_id` = \? for update skip locked$/i)
      })
    })
  })

  describe('many-row input', { skip: tableOnly }, () => {
    it('refuses ownership changes through a polymorphic relationship', async () => {
      await resetAll()
      await fixture.seed('da_assets', [{ id: '1', name: 'logo', owner_type: null, owner_id: 'ws-a' }])
      const assets = fixture.api.resources.da_assets
      await assert.rejects(assets.patchMany({
        document: { data: [{ type: 'da_assets', id: '1', relationships: { owner: { data: { type: 'da_accounts', id: '1' } } } }] }
      }, workspaceA()), isA(RestApiValidationError))
      assert.equal((await fixture.knex('da_assets').where({ id: 1 }).first()).owner_id, 'ws-a')
    })

    it('treats only real Knex raw values as SQL and checks them against positions and files', async () => {
      await resetAll()
      const entries = fixture.api.resources.da_entries
      const fake = { isRawInstance: true, sql: 'amount + 1' }
      await assert.rejects(entries.patchMany({ data: [{ id: '1', amount: fake }] }, workspaceA()), isA(RestApiValidationError))
      await assert.rejects(entries.postMany({ document: { data: [{ type: 'da_entries', attributes: { code: 'R', amount: fake, access_group: 'g1' } }] } }, workspaceA()), isA(RestApiValidationError))
      await entries.patchMany({ data: [{ id: '1', amount: fixture.knex.raw('?? + 1', ['amount']) }] }, workspaceA())
      assert.equal(Number((await fixture.knex('da_entries').where({ id: 1 }).first()).amount), 11)

      const ranked = fixture.api.resources.da_ranked
      const row = await ranked.post({ data: { name: 'first' } })
      const refusedFor = reason => error => isA(RestApiBulkWriteUnsupportedError)(error) && cause(error).details.reason.includes(reason)
      await assert.rejects(ranked.patchMany({ data: [{ id: row.id, position: fixture.knex.raw('?', ['a0']) }] }), refusedFor('positioned'))
      const docs = fixture.api.resources.da_docs
      const doc = await docs.post({ data: { title: 'report' } })
      await assert.rejects(docs.patchMany({ data: [{ id: doc.id, attachment: fixture.knex.raw('?', ['elsewhere']) }] }), refusedFor('file fields'))
    })

    it('reports a compare-and-set row unchanged when no stored column changes', async () => {
      await resetAll()
      const flags = fixture.api.resources.da_flags
      const row = await flags.post({ data: { name: 'on' } })
      const missed = await flags.patchMany({ data: [{ id: row.id, note: 'x' }], onlyIf: { name: 'off' }, returning: 'minimal' })
      assert.deepEqual(missed.data, [])
      const hit = await flags.patchMany({ data: [{ id: row.id, note: 'x' }], onlyIf: { name: 'on' }, returning: 'minimal' })
      assert.deepEqual(hit.data.map(item => String(item.id)), [String(row.id)])
    })

    it('patches and deletes every visible row only when asked with all: true', async () => {
      await resetAll()
      const entries = fixture.api.resources.da_entries
      for (const params of [{}, { filters: {} }, { all: false }, { all: true, filters: { status: 'open' } }]) {
        await assert.rejects(entries.patchWhere({ ...params, data: { status: 'x' } }, workspaceA()), isA(RestApiValidationError), JSON.stringify(params))
        await assert.rejects(entries.deleteWhere(params, workspaceA()), isA(RestApiValidationError), JSON.stringify(params))
      }
      const patched = await entries.patchWhere({ all: true, data: { status: 'closed' }, returning: 'minimal' }, workspaceA())
      assert.equal(patched.data.length, 3)
      const deleted = await entries.deleteWhere({ all: true, returning: 'minimal' }, workspaceB())
      assert.equal(deleted.data.length, 3)
      assert.equal((await fixture.rows('da_entries')).length, 6)
    })
  })
})
