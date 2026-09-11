import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createConformanceFixture } from '../tests/fixtures/conformance.js'
import { createQueryConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from '../tests/fixtures/api-configs.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { databaseClient } from '../tests/helpers/test-database.js'
import { storageMode } from '../tests/helpers/storage-mode.js'
import { holdManagedTransaction } from '../tests/helpers/transaction-completion.js'

// Only disposable synthetic fixtures are measured. EXPLAIN never uses ANALYZE.
const fixture = await createConformanceFixture({
  createApi: createQueryConformanceApi,
  tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
})
const { api, knex } = fixture
const canonical = storageMode.isAnyApi()
const size = 10000
const groupCount = 100
const itemRows = Array.from({ length: size }, (_, index) => ({
  id: String(index + 1),
  name: `Item ${String(index + 1).padStart(5, '0')}`,
  rank: (index + 1) % 10 ? (index + 1) % 100 : null,
  active: true,
  score: 0,
  secret: 'Must remain hidden',
  groupId: String(Math.floor(index / 100) + 1)
}))
const idCompare = (a, b) => canonical ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : Number(a.id) - Number(b.id)
const rankCompare = direction => (a, b) => {
  if (a.rank === null || b.rank === null) return a.rank === b.rank ? idCompare(a, b) : a.rank === null ? 1 : -1
  return direction * (a.rank - b.rank) || idCompare(a, b)
}
const identifiers = rows => rows.map(({ id }) => ({ type: 'items', id }))
const sortedIds = rows => rows.map(row => row.id).sort()
const memberships = itemRows.flatMap(row => [Number(row.groupId), Number(row.groupId) % groupCount + 1].map(groupId => ({ itemId: row.id, groupId: String(groupId) })))
const groupOne = itemRows.filter(row => row.groupId === '1' || row.groupId === '100')
const reports = []

async function seed (type, rows) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    await seedStorageAdapterRecords(knex, api.resources[type].vars.schemaInfo, rows.slice(offset, offset + 100))
  }
}

async function analyzeTables () {
  const tables = canonical ? ['any_records', 'any_links'] : ['conformance_items', 'conformance_groups', 'conformance_memberships']
  for (const table of tables) await knex.raw(databaseClient === 'mysql2' ? 'ANALYZE TABLE ??' : 'ANALYZE ??', [table])
}

function summarizePlan (value) {
  if (databaseClient === 'better-sqlite3') return value.map(({ id, parent, detail }) => ({ id, parent, detail }))
  const plan = databaseClient === 'pg' ? value.rows[0]['QUERY PLAN'][0].Plan : JSON.parse(value[0][0].EXPLAIN)
  const nodes = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (databaseClient === 'pg' && node['Node Type']) {
      nodes.push(Object.fromEntries(['Node Type', 'Relation Name', 'Alias', 'Index Name', 'Plan Rows', 'Total Cost', 'Sort Key'].filter(key => node[key] !== undefined).map(key => [key, node[key]])))
    } else if (databaseClient === 'mysql2' && (node.table_name || node.using_filesort || node.using_temporary_table)) {
      nodes.push(Object.fromEntries(['table_name', 'access_type', 'key', 'used_key_parts', 'rows_examined_per_scan', 'rows_produced_per_join', 'using_index', 'using_filesort', 'using_temporary_table'].filter(key => node[key] !== undefined).map(key => [key, node[key]])))
    }
    for (const child of Object.values(node)) if (typeof child === 'object') visit(child)
  }
  visit(plan)
  assert.ok(nodes.length, 'EXPLAIN must yield a plan')
  return nodes
}

async function measure (phase, name, operation, check) {
  const statements = []
  const capture = ({ sql, bindings }) => statements.push({ sql, bindings })
  const start = performance.now()
  let result
  knex.on('query', capture)
  try { result = await operation() } finally { knex.off('query', capture) }
  const elapsedMs = Number((performance.now() - start).toFixed(3))
  check(result)
  const queries = statements.filter(({ sql }) => /^(select|with|delete)\b/i.test(sql))
  assert.ok(queries.length, `${name} must execute explainable SQL`)
  const plans = []
  for (const query of queries) {
    const prefix = databaseClient === 'better-sqlite3' ? 'EXPLAIN QUERY PLAN ' : databaseClient === 'pg' ? 'EXPLAIN (FORMAT JSON) ' : 'EXPLAIN FORMAT=JSON '
    // Query events already contain driver placeholders (for example PostgreSQL $1).
    const connection = await knex.client.acquireConnection()
    let raw
    try {
      raw = (await knex.client.query(connection, { method: 'raw', sql: prefix + query.sql, bindings: query.bindings })).response
    } finally { await knex.client.releaseConnection(connection) }
    plans.push({ statement: query.sql.startsWith('delete') ? 'delete' : 'select', nodes: summarizePlan(raw) })
  }
  reports.push({ phase, name, statements: statements.length, elapsedMs, plans })
}

const query = queryParams => api.resources.items.query({ format: 'jsonapi', queryParams })
const checkPage = expected => result => {
  assert.deepEqual(result.data.map(row => row.id), expected.slice(0, 3).map(row => row.id))
  for (const row of [...result.data, ...(result.included || [])]) assert.equal(row.attributes.secret, undefined)
}
const related = relationshipName => api.resources.groups.getRelated({
  id: '1', relationshipName, format: 'jsonapi', queryParams: { sort: ['id'], page: { number: 1, size: 3 } }
})

async function mutate (method, rows) {
  const unit = await holdManagedTransaction(api)
  const transaction = unit.transaction
  try {
    await api.resources.groups[method]({ id: '1', relationshipName: 'members', relationshipData: identifiers(rows), transaction })
    const pending = await api.resources.groups.getRelationship({ id: '1', relationshipName: 'members', transaction })
    return pending.data
  } finally { await unit.rollback() }
}

async function runScenarios (phase) {
  const byId = [...itemRows].sort(idCompare)
  await measure(phase, 'flat-id', () => query({ sort: ['id'], page: { size: 3 } }), checkPage(byId))
  await measure(phase, 'sparse-id', () => query({ sort: ['id'], fields: { items: 'name' }, page: { size: 3 } }), result => {
    checkPage(byId)(result)
    assert.ok(result.data.every(row => Object.keys(row.attributes).join() === 'name'))
  })
  await measure(phase, 'selective-name', () => query({ filters: { name: 'Item 05001' }, sort: ['id'] }), checkPage([itemRows[5000]]))
  for (const direction of [1, -1]) {
    await measure(phase, `nullable-rank-${direction === 1 ? 'asc' : 'desc'}`, () => query({ sort: [direction === 1 ? 'rank' : '-rank', 'id'], page: { size: 3 } }), checkPage([...itemRows].sort(rankCompare(direction))))
  }
  const boundary = itemRows[4]
  await measure(phase, 'nullable-cursor', () => query({ sort: ['rank', 'id'], page: { after: 'rank:5,id:5', size: 3 } }), checkPage(itemRows.filter(row => rankCompare(1)(row, boundary) > 0).sort(rankCompare(1))))
  await measure(phase, 'has-many-count', () => related('items'), result => {
    checkPage(itemRows.filter(row => row.groupId === '1').sort(idCompare))(result)
    assert.equal(result.meta.pagination.total, 100)
  })
  await measure(phase, 'many-to-many-count', () => related('members'), result => {
    checkPage([...groupOne].sort(idCompare))(result)
    assert.equal(result.meta.pagination.total, 200)
  })
  await measure(phase, 'nested-includes', () => query({ sort: ['id'], include: ['group.items'], page: { size: 3 } }), result => {
    checkPage(byId)(result)
    const expected = new Set(byId.slice(0, 3).map(row => row.groupId))
    assert.deepEqual(sortedIds(result.included.filter(row => row.type === 'groups')), [...expected].sort())
  })
  const kept = groupOne.slice(0, 101)
  await measure(phase, 'replace-101-of-200', () => mutate('patchRelationship', kept), result => assert.deepEqual(sortedIds(result), sortedIds(kept)))
  await measure(phase, 'remove-101-of-200', () => mutate('deleteRelationship', kept), result => assert.deepEqual(sortedIds(result), sortedIds(groupOne.slice(101))))
  const restored = await api.resources.groups.getRelationship({ id: '1', relationshipName: 'members' })
  assert.deepEqual(sortedIds(restored.data), sortedIds(groupOne))
}

try {
  await seed('groups', Array.from({ length: groupCount }, (_, index) => ({ id: String(index + 1), name: `Group ${index + 1}` })))
  await seed('items', itemRows)
  if (canonical) {
    await api.resources.groups.postRelationship({ id: '1', relationshipName: 'members', relationshipData: identifiers([itemRows[0]]) })
    const { id, ...template } = await knex('any_links').first()
    await knex('any_links').delete()
    await seedCanonicalLinkRows(knex, memberships.map(({ itemId, groupId }) => ({
      ...template,
      left_id: template.left_resource === 'items' ? itemId : groupId,
      right_id: template.right_resource === 'items' ? itemId : groupId
    })))
  } else await seed('memberships', memberships.map((row, index) => ({ id: String(index + 1), ...row })))
  await analyzeTables()
  await runScenarios('existing-indexes')

  const items = createStorageAdapter({ knex, schemaInfo: api.resources.items.vars.schemaInfo })
  const table = items.getTableName()
  const scopeColumns = canonical ? ['tenant_id', 'resource'] : []
  const candidates = [
    { table, name: 'jra_plan_group', columns: [...scopeColumns, items.translateColumn('groupId')] },
    { table, name: 'jra_plan_rank', columns: [...scopeColumns, items.translateColumn('rank'), items.getIdColumn()] },
    ...(canonical
      ? [
          { table: 'any_links', name: 'jra_plan_left_owner', columns: ['tenant_id', 'left_resource', 'left_id'] },
          { table: 'any_links', name: 'jra_plan_right_owner', columns: ['tenant_id', 'right_resource', 'right_id'] }
        ]
      : [{ table: 'conformance_memberships', name: 'jra_plan_members', columns: ['parent_key', 'child_key'] }])
  ]
  // Use the same Knex schema mechanism as resource and canonical migrations.
  for (const candidate of candidates) await knex.schema.alterTable(candidate.table, table => table.index(candidate.columns, candidate.name))
  await analyzeTables()
  await runScenarios('candidate-indexes')
  console.log(JSON.stringify({ node: process.version, database: databaseClient, storage: storageMode.mode, fixture: { items: size, groups: groupCount, links: memberships.length, nullRanks: 1000 }, candidates, reports }, null, 2))
} finally { await fixture.close() }
