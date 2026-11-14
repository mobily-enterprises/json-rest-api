import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { AutoFilterPlugin, RestApiPlugin, RestApiScopedQueryReadOnlyError, RowPolicyPlugin, readOnlyQueryBuilder } from '../index.js'
import { JsonRestApi } from '../lib/runtime/json-rest-api.js'
import { lockConditionSubqueries } from '../plugins/core/lib/querying/subquery-locks.js'
import { useStoragePlugin } from './fixtures/api-configs.js'
import { NOWAIT_MYSQL_CODE } from './helpers/transaction-completion.js'
import { storageMode } from './helpers/storage-mode.js'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'

// A read-only view's forceIndex (MySQL and MariaDB): a locking read examines,
// and so locks, every row its plan reaches, and a SELECT nested in a lock
// read's conditions takes a shared lock (subquery-locks.js). An index hint on
// the table the nested SELECT reads keeps its scan inside the caller's rows.

// Every method the view refuses: writes, locks, source-table changes, cleared
// predicates, common table expressions and set operations.
const REFUSED = [
  'insert', 'update', 'del', 'delete', 'truncate', 'upsert', 'increment', 'decrement',
  'onConflict', 'merge', 'ignore', 'returning',
  'forUpdate', 'forShare', 'forNoKeyUpdate', 'forKeyShare', 'skipLocked', 'noWait',
  'from', 'fromRaw', 'table', 'into', 'withSchema', 'clear', 'clearWhere',
  'with', 'withRecursive', 'withMaterialized', 'withNotMaterialized', 'withWrapped',
  'union', 'unionAll', 'intersect', 'except'
]

describe('A read-only view\'s forceIndex (compiled)', () => {
  const compilers = { mysql: knexLib({ client: 'mysql2' }), pg: knexLib({ client: 'pg' }), sqlite: knexLib({ client: 'better-sqlite3', useNullAsDefault: true }) }
  after(() => Promise.all(Object.values(compilers).map(db => db.destroy())))
  const db = compilers.mysql
  const sql = builder => builder.toSQL().sql
  // A scoped query's shape: a read-only view over a derived table of the resource's aliased rows.
  const scoped = (knex = db) => readOnlyQueryBuilder(knex.from(knex({ m: 'lp_members' }).where('m.workspace_id', 'ws-a').select('m.id', 'm.user_id').as('m')))

  it('hints the table the view reads: by name, aliased, and inside derived tables at any depth', () => {
    assert.equal(sql(readOnlyQueryBuilder(db('lp_members')).forceIndex('lp_owner').select('id').where('workspace_id', 'ws-a')),
      'select `id` from `lp_members` force index (`lp_owner`) where `workspace_id` = ?')
    assert.equal(sql(readOnlyQueryBuilder(db('lp_members as m')).forceIndex('lp_owner', 'PRIMARY').select('m.id')),
      'select `m`.`id` from `lp_members` as `m` force index (`lp_owner`, `PRIMARY`)')
    assert.equal(sql(readOnlyQueryBuilder(db({ m: 'lp_members' })).forceIndex('lp_owner').select('m.id')),
      'select `m`.`id` from `lp_members` as `m` force index (`lp_owner`)')
    // A view of a view hints the builder behind both.
    assert.equal(sql(readOnlyQueryBuilder(readOnlyQueryBuilder(db('lp_members'))).forceIndex('lp_owner')),
      'select * from `lp_members` force index (`lp_owner`)')
    const inner = 'select `m`.`id`, `m`.`user_id` from `lp_members` as `m` force index (`lp_owner`) where `m`.`workspace_id` = ?'
    assert.equal(sql(scoped().forceIndex('lp_owner').select('m.user_id')), `select \`m\`.\`user_id\` from (${inner}) as \`m\``)
    // A join source's shape: a view over a derived table of a scoped query's view.
    const joinSource = readOnlyQueryBuilder(db.from(scoped().select('m.id').as('k')))
    assert.equal(sql(joinSource.forceIndex('lp_owner').select('k.id')), `select \`k\`.\`id\` from (select \`m\`.\`id\` from (${inner}) as \`m\`) as \`k\``)
  })

  it('changes no clone, no builder a derived table holds, and no other view of it', () => {
    const base = db({ m: 'lp_members' }).select('m.id').as('m')
    const view = readOnlyQueryBuilder(db.from(base))
    const before = sql(view)
    const clone = view.clone().forceIndex('lp_owner')
    assert.match(sql(clone), /force index \(`lp_owner`\)/)
    assert.equal(sql(view), before)
    assert.doesNotMatch(sql(base), /force index/)
    const nested = scoped()
    const outer = readOnlyQueryBuilder(db.from(nested.as('k'))).forceIndex('lp_owner')
    assert.match(sql(outer), /force index/)
    assert.doesNotMatch(sql(nested), /force index/)
  })

  it('keeps its hint in a lock read, whose shared lock reaches the hinted SELECT', () => {
    const query = db('lp_projects').where('workspace_id', 'ws-a').whereIn('id', scoped().forceIndex('lp_owner').select('m.id')).forUpdate()
    lockConditionSubqueries(query, db)
    assert.equal(sql(query), 'select * from `lp_projects` where `workspace_id` = ? and `id` in (select `m`.`id` from ' +
      '(select `m`.`id`, `m`.`user_id` from `lp_members` as `m` force index (`lp_owner`) where `m`.`workspace_id` = ? lock in share mode) as `m` lock in share mode) for update')
  })

  it('PostgreSQL and SQLite refuse it with a TypeError that says why, and leave the view as it was', () => {
    for (const [family, name] of [['pg', 'PostgreSQL'], ['sqlite', 'SQLite']]) {
      const view = scoped(compilers[family])
      const before = sql(view)
      assert.throws(() => view.forceIndex('lp_owner'), { name: 'TypeError', message: `forceIndex is MySQL and MariaDB only: ${name} has no index hints, and its planner picks the index` })
      assert.equal(sql(view), before, family)
    }
  })

  it('takes plain index names only, so a name adds no SQL and names no table', () => {
    const notNames = [
      [], [''], ['lp_members.lp_owner'], ['lp_owner) join lp_grants g on (1'], ['lp_owner`'], ['lp_owner as x'], ['lp owner'],
      ['lp_owner; drop table lp_members'], ['1st'], ['$x'], ['a'.repeat(65)], [42], [null], [undefined], [{}], [['lp_owner']], ['lp_owner', 'x y']
    ]
    for (const names of notNames) {
      const view = readOnlyQueryBuilder(db('lp_members')).select('id')
      assert.throws(() => view.forceIndex(...names), { name: 'TypeError', message: /each a plain identifier/ }, JSON.stringify(names))
      assert.equal(sql(view), 'select `id` from `lp_members`', JSON.stringify(names))
    }
    assert.match(sql(readOnlyQueryBuilder(db('lp_members')).forceIndex(`a${'b'.repeat(63)}`, 'x$1', '_y')), /^select \* from `lp_members` force index \(`ab{63}`, `x\$1`, `_y`\)$/)
  })

  it('sets the hint once, and refuses a view that reads no table by name', () => {
    const hinted = readOnlyQueryBuilder(db('lp_members')).forceIndex('lp_owner')
    for (const view of [hinted, readOnlyQueryBuilder(db.select(1)), readOnlyQueryBuilder(db.from(db.raw('lp_members'))), readOnlyQueryBuilder(db.from(function () { this.from('lp_members').as('m') }))]) {
      assert.throws(() => view.forceIndex('other'), { name: 'TypeError', message: /needs a view that reads a table by name, or a derived table that does, and takes every index in one call/ })
    }
    assert.equal(sql(hinted), 'select * from `lp_members` force index (`lp_owner`)')
  })

  it('leaves the view refusing every write, lock and source change, as are its clones, what it returns and the views it hints inside', () => {
    const joinSource = readOnlyQueryBuilder(db.from(scoped().as('k'))).forceIndex('lp_owner')
    const views = {
      table: readOnlyQueryBuilder(db('lp_members')).forceIndex('lp_owner'),
      scoped: scoped().forceIndex('lp_owner'),
      joinSource,
      clone: joinSource.clone(),
      selected: joinSource.select('k.id').where('k.id', 1),
      // The scoped view a hinted join source now reads: a hinted copy, still read-only.
      inner: joinSource._single.table
    }
    for (const [label, view] of Object.entries(views)) {
      for (const method of REFUSED) assert.throws(() => view[method]('lp_grants'), RestApiScopedQueryReadOnlyError, `${label} ${method}`)
      assert.throws(() => view.client, RestApiScopedQueryReadOnlyError, label)
      assert.throws(() => { view._method = 'del' }, RestApiScopedQueryReadOnlyError, label)
      assert.throws(() => { view._single = {} }, RestApiScopedQueryReadOnlyError, label)
      assert.throws(() => Object.defineProperty(view, 'forceIndex', { value: () => view }), RestApiScopedQueryReadOnlyError, label)
      assert.throws(() => view.modify(builder => builder.del()), RestApiScopedQueryReadOnlyError, label)
      assert.match(sql(view), /^select /, label)
    }
    assert.match(sql(views.inner), /from `lp_members` as `m` force index \(`lp_owner`\)/)
  })
})

// Units a caller sees through stored paths: the policy reads the paths of the
// caller's workspace, nested in a whereIn, through a read-only view of the
// table (as an owned-table reader builds) or a scoped query (as a join source).
// The one index on the paths' owner leaves the unit read out, so for an owner
// that holds nearly every path the planner scans the table.
const FI_TABLES = ['fi_units', 'fi_paths']
const OWNER_INDEX = 'fi_paths_owner'

async function pathed ({ query, context, db, column, system, api }) {
  if (system) return true
  const paths = context.nested === 'scoped'
    ? (await api.resources.fi_paths.scopedQuery({ transaction: db, alias: 'p' }, { scopeValues: context.scopeValues })).query.select('p.unit_id')
    : readOnlyQueryBuilder(db('fi_paths')).select('unit_id').where('workspace_id', context.scopeValues.workspaceId)
  query.whereIn(column('id'), context.forced ? paths.forceIndex(OWNER_INDEX) : paths)
  return true
}

describe(`A lock read nesting a hinted view locks only the owner's rows (${databaseClient})`, { skip: storageMode.isAnyApi() && 'needs table storage' }, () => {
  const isMysql = databaseClient === 'mysql2'
  let database
  let api
  let otherPaths
  before(async () => {
    database = await createTestDatabase(undefined, { maxConnections: 4 })
    api = new JsonRestApi({ name: 'force-index-test-api' })
    await api.use(RestApiPlugin, { format: 'plain', returning: 'full', queryMaxLimit: 100 })
    await useStoragePlugin(api, database.knex, { storage: 'knex' })
    await api.use(RowPolicyPlugin, { policies: { pathed } })
    await api.use(AutoFilterPlugin, {
      resolvers: { workspace: ({ context }) => context.scopeValues?.workspaceId },
      presets: { workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] } }
    })
    await api.addResource('fi_paths', {
      schema: {
        id: { type: 'id' },
        workspace_id: { type: 'string', required: true, max: 40 },
        unit_id: { type: 'integer', required: true },
        depth: { type: 'integer', required: true }
      },
      autofilter: 'workspace',
      indexes: [{ columns: ['workspace_id'], name: OWNER_INDEX }],
      tableName: 'fi_paths'
    })
    await api.addResource('fi_units', {
      schema: { id: { type: 'id' }, workspace_id: { type: 'string', required: true, max: 40 }, name: { type: 'string', required: true, max: 40 } },
      autofilter: 'workspace',
      rowPolicy: 'pathed',
      indexes: [{ columns: ['workspace_id', 'name'] }],
      tableName: 'fi_units'
    })
    for (const table of FI_TABLES) await api.resources[table].createKnexTable()
    const { knex } = database
    await knex('fi_units').insert([1, 2, 3].map(id => ({ id, workspace_id: 'ws-a', name: `U${id}` })).concat({ id: 4, workspace_id: 'ws-b', name: 'U4' }))
    // The other owner's two paths sit between the caller's, so a scan of the table passes them.
    const paths = (from, count) => Array.from({ length: count }, (_, index) => ({ workspace_id: 'ws-a', unit_id: 1 + (from + index) % 3, depth: from + index }))
    await knex('fi_paths').insert(paths(0, 150))
    await knex('fi_paths').insert([{ workspace_id: 'ws-b', unit_id: 4, depth: 0 }, { workspace_id: 'ws-b', unit_id: 4, depth: 1 }])
    await knex('fi_paths').insert(paths(150, 150))
    if (isMysql) await knex.raw('analyze table fi_paths, fi_units')
    otherPaths = (await knex('fi_paths').where({ workspace_id: 'ws-b' }).orderBy('id').pluck('id')).map(String)
  })
  after(async () => { await database?.close() })

  const asCaller = (nested, forced) => ({ scopeValues: { workspaceId: 'ws-a' }, nested, forced })
  const lockBusy = error => NOWAIT_MYSQL_CODE.test(error?.code ?? '')
  const free = id => database.knex.transaction(probe => probe('fi_paths').where({ id }).forUpdate().noWait())
    .then(() => true, error => { if (lockBusy(error)) return false; throw error })

  for (const nested of ['view', 'scoped']) {
    it(`${nested}: unhinted, the nested scan locks the other owner's paths; hinted, it leaves them free`, { skip: !isMysql && 'MySQL and MariaDB only' }, async t => {
      const seen = {}
      for (const forced of [false, true]) {
        const statements = []
        const record = query => { if (query.sql.includes('`fi_units`') && / for update$/.test(query.sql)) statements.push(query) }
        database.knex.on('query', record)
        const held = []
        try {
          await api.transaction(async transaction => {
            const locked = await api.resources.fi_units.lockWhere({ transaction }, asCaller(nested, forced))
            assert.deepEqual(locked.data.map(unit => String(unit.id)), ['1', '2', '3'], `forced ${forced}`)
            for (const id of otherPaths) if (!(await free(id))) held.push(id)
          })
        } finally { database.knex.removeListener('query', record) }
        const [lockRead] = statements
        const [plan] = await database.knex.raw(`explain ${lockRead.sql.replaceAll(' lock in share mode', '').replace(/ for update$/, '')}`, lockRead.bindings)
        t.diagnostic(`forced ${forced}: held ${held.length} of ${otherPaths.length}; plan ${plan.map(row => `${row.table} ${row.type} ${row.key ?? '-'} ${row.rows}`).join(' | ')}`)
        seen[forced] = { held, sql: lockRead.sql }
      }
      // The outer read carries lockWhere's own hint on the units; the paths' hint is the policy's.
      const pathsHint = new RegExp(`force index \\(\`${OWNER_INDEX}\`\\)`)
      assert.doesNotMatch(seen.false.sql, pathsHint)
      assert.deepEqual(seen.false.held, otherPaths, 'unhinted: the scan holds the other owner\'s paths')
      assert.match(seen.true.sql, pathsHint)
      assert.deepEqual(seen.true.held, [], 'hinted: the other owner\'s paths stay free')
    })
  }

  it('PostgreSQL and SQLite: a scoped query\'s forceIndex throws the TypeError, and the policy that calls it fails the lock read', { skip: isMysql && 'PostgreSQL and SQLite only' }, async () => {
    const { query } = await api.resources.fi_paths.scopedQuery({}, { scopeValues: { workspaceId: 'ws-a' } })
    assert.throws(() => query.forceIndex(OWNER_INDEX), { name: 'TypeError', message: /^forceIndex is MySQL and MariaDB only/ })
    await assert.rejects(api.transaction(transaction => api.resources.fi_units.lockWhere({ transaction }, asCaller('scoped', true))), error => {
      for (let current = error; current; current = current.cause) if (/^forceIndex is MySQL and MariaDB only/.test(current.message)) return true
      return false
    })
  })
})
