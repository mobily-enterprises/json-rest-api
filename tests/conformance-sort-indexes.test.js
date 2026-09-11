import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { applyColumnOrder, applyQueryFieldOrder } from '../plugins/core/lib/querying/query-field-sort-helpers.js'

describe(`Indexed ordering and null placement (${storageMode.mode})`, () => {
  let fixture, adapter, idColumn, rankColumn
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1), name: `Item ${index + 1}`, rank: index % 4 ? index % 3 : null }))
  const byId = (a, b) => storageMode.isAnyApi() ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : Number(a.id) - Number(b.id)
  before(async () => {
    fixture = await createConformanceFixture()
    adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
    idColumn = adapter.getIdColumn()
    rankColumn = adapter.translateColumn('rank')
    await fixture.knex.schema.alterTable(adapter.getTableName(), table => table.index([
      ...(storageMode.isAnyApi() ? ['tenant_id', 'resource'] : []), rankColumn, idColumn
    ], 'sort_conformance_rank'))
  })
  beforeEach(async () => {
    await fixture.reset()
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, rows)
  })
  after(async () => { await fixture?.close() })

  for (const projection of [false, true]) {
    for (const direction of ['asc', 'desc']) {
      for (const nulls of ['first', 'last']) {
        it(`orders ${projection ? 'a projected' : 'a stored'} value ${direction}, nulls ${nulls}`, async () => {
          const query = adapter.buildBaseQuery().select({ id: idColumn, sortRank: rankColumn })
          if (projection) applyQueryFieldOrder(query, { fieldName: 'sortRank', sql: '??', bindings: [rankColumn] }, direction, nulls)
          else applyColumnOrder(query, rankColumn, direction, nulls)
          applyColumnOrder(query, idColumn, 'asc', 'last')
          const expected = [...rows].sort((a, b) => {
            if (a.rank === null || b.rank === null) {
              if (a.rank === b.rank) return byId(a, b)
              return (a.rank === null ? 1 : -1) * (nulls === 'last' ? 1 : -1)
            }
            return (direction === 'asc' ? 1 : -1) * (a.rank - b.rank) || byId(a, b)
          })
          const result = await query
          assert.deepEqual(result.map(row => String(row.id)), expected.map(row => row.id))
          if (databaseClient === 'better-sqlite3' && direction === 'asc') {
            const { sql, bindings } = query.toSQL()
            const plan = await fixture.knex.raw('EXPLAIN QUERY PLAN ' + sql, bindings)
            assert.ok(plan.some(row => row.detail.includes('sort_conformance_rank')), 'ascending rank order must use its index')
            // SQLite can still sort ID ties within each already ordered rank group.
            assert.ok(plan.every(row => row.detail !== 'USE TEMP B-TREE FOR ORDER BY'), 'ascending rank order must not sort the complete input')
          }
        })
      }
    }
  }

  it('preserves expression bindings and nullable values', async () => {
    const query = adapter.buildBaseQuery().select({ id: idColumn }).select(fixture.knex.raw('?? + ? as ??', [rankColumn, 5, 'sortRank']))
    applyQueryFieldOrder(query, { fieldName: 'sortRank', sql: '?? + ?', bindings: [rankColumn, 5] }, 'asc', 'last')
    const result = await query
    assert.equal(result.length, rows.length)
    assert.deepEqual(result.map(row => row.sortRank), [...rows.map(row => row.rank === null ? null : row.rank + 5)].sort((a, b) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b))
  })

  it('pages by the logical ID without an extra SQLite sort', async () => {
    const statements = []
    const capture = query => { if (/^select /i.test(query.sql)) statements.push(query) }
    fixture.knex.on('query', capture)
    let result
    try {
      result = await fixture.api.resources.items.query({ queryParams: { sort: ['id'], fields: { items: 'name' }, page: { size: 3 } } })
    } finally { fixture.knex.off('query', capture) }
    assert.deepEqual(result.data.map(row => row.id), [...rows].sort(byId).slice(0, 3).map(row => row.id))
    if (databaseClient === 'better-sqlite3') {
      const { sql, bindings } = statements[0]
      const plan = await fixture.knex.raw('EXPLAIN QUERY PLAN ' + sql, bindings)
      assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')), 'ID pagination must not materialize a sort')
    }
  })
})
