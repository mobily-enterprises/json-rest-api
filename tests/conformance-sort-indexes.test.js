import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { applyColumnOrder, applyQueryFieldOrder } from '../plugins/core/lib/querying/query-field-sort-helpers.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'
import { normalizeStableSort, parseSortEntry } from '../plugins/core/lib/querying/sort-helpers.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

const fromLink = link => parseJsonApiQuery(new URL(link, 'http://test.invalid').search.slice(1))

describe(`Indexed ordering and null placement (${storageMode.mode})`, () => {
  let fixture, adapter, idColumn, rankColumn
  // Thirty names repeat, so ID tie breakers decide within each name.
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1), name: `Item ${String(index % 30).padStart(2, '0')}`, rank: index % 4 ? index % 3 : null }))
  const byId = (a, b) => storageMode.isAnyApi() ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : Number(a.id) - Number(b.id)
  before(async () => {
    fixture = await createConformanceFixture()
    adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
    idColumn = adapter.getIdColumn()
    rankColumn = adapter.translateColumn('rank')
    await fixture.knex.schema.alterTable(adapter.getTableName(), table => table.index([
      ...(storageMode.isAnyApi() ? ['tenant_id', 'resource'] : []), rankColumn, idColumn
    ], 'sort_conformance_rank'))
    // AnyAPI attribute slots keep their null placement, so only table storage gets this index.
    if (!storageMode.isAnyApi()) {
      await fixture.knex.schema.alterTable(adapter.getTableName(), table => table.index([adapter.translateColumn('name'), idColumn], 'sort_conformance_name'))
    }
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

  const sortFields = sort => normalizeStableSort(sort).map(entry => parseSortEntry(entry).field)
  // Nulls sort last in both directions; IDs break ties.
  const expectedOrder = sort => [...rows].sort((a, b) => {
    for (const { field, desc } of normalizeStableSort(sort).map(parseSortEntry)) {
      if (a[field] === b[field]) continue
      if (a[field] === null || b[field] === null) return a[field] === null ? 1 : -1
      const order = field === 'id' ? byId(a, b) : a[field] < b[field] ? -1 : 1
      return desc ? -order : order
    }
    return 0
  })
  const readPages = async (sort, page) => {
    const pages = []
    let result = await fixture.api.resources.items.query({ queryParams: { sort, fields: { items: 'name' }, page } })
    for (;;) {
      pages.push(result.data.map(row => row.id))
      if (!result.links?.next) return pages
      result = await fixture.api.resources.items.query({ queryParams: fromLink(result.links.next) })
    }
  }

  // The ID and the required name hold no NULL, so table storage sorts them without
  // a null placement; the nullable rank keeps it.
  for (const sort of [['id'], ['-id'], ['name'], ['-name'], ['-name', '-id'], ['rank'], ['-rank', '-id']]) {
    it(`pages ${sort.join(',')} forward and backward in the same order`, async () => {
      const expected = expectedOrder(sort)
      const forward = await readPages(sort, { size: 7 })
      assert.deepEqual(forward.flat(), expected.map(row => row.id))
      assert.equal(forward.length, Math.ceil(rows.length / 7))
      const backward = await readPages(sort, { size: 7, before: createCursor(expected.at(-1), sortFields(sort)) })
      assert.deepEqual(backward.reverse().flat(), expected.slice(0, -1).map(row => row.id))
    })
  }

  // Each database is asked whether the index can supply the order, so that a small
  // table's cheaper full sort does not hide the answer: PostgreSQL explains with
  // sorting disabled, MySQL and MariaDB with the index forced.
  const explain = async ({ sql, bindings }, index) => {
    if (databaseClient === 'pg') {
      return fixture.knex.transaction(async trx => {
        await trx.raw('SET LOCAL enable_sort = off')
        const plan = await trx.raw(`EXPLAIN ${sql.replace(/\$\d+/g, '?')}`, bindings)
        return plan.rows.map(row => row['QUERY PLAN']).join('\n')
      })
    }
    if (databaseClient === 'mysql2') {
      const forced = sql.replace(/ from `[^`]+`( as `[^`]+`)?/, match => `${match} FORCE INDEX (\`${index}\`)`)
      const [plan] = await fixture.knex.raw(`EXPLAIN ${forced}`, bindings)
      return plan.map(row => `${row.table}: ${row.type} ${row.key} ${row.Extra}`).join('\n')
    }
    return (await fixture.knex.raw(`EXPLAIN QUERY PLAN ${sql}`, bindings)).map(row => row.detail).join('\n')
  }
  const sortsRows = plan => ({
    pg: /\bSort\b/,
    mysql2: /filesort/,
    'better-sqlite3': /TEMP B-TREE FOR (RIGHT PART OF )?ORDER BY/
  })[databaseClient].test(plan)
  const pageStatement = async queryParams => {
    const statements = []
    const capture = query => { if (/^select /i.test(query.sql)) statements.push(query) }
    fixture.knex.on('query', capture)
    try {
      await fixture.api.resources.items.query({ queryParams })
    } finally { fixture.knex.off('query', capture) }
    return statements.find(statement => / order by /i.test(statement.sql))
  }

  for (const { subject, sort, filters, index, tableOnly } of [
    { subject: 'the ID', sort: ['-id'], index: storageMode.isAnyApi() ? 'any_records_tenant_resource_logical_id_unique' : 'PRIMARY' },
    { subject: 'the ID within an indexed filter', sort: ['-id'], filters: { name: 'Item 07' }, index: 'sort_conformance_name', tableOnly: true },
    { subject: 'a required indexed attribute', sort: ['-name', '-id'], index: 'sort_conformance_name', tableOnly: true }
  ]) {
    it(`reads descending pages on ${subject} from an index`, { skip: tableOnly && storageMode.isAnyApi() && 'AnyAPI attribute slots keep their null placement' }, async () => {
      const boundary = createCursor(expectedOrder(sort).filter(row => !filters || row.name === filters.name)[1], sortFields(sort))
      for (const page of [{ size: 5 }, { size: 5, after: boundary }, { size: 5, before: boundary }]) {
        const plan = await explain(await pageStatement({ sort, ...(filters ? { filters } : {}), fields: { items: 'name' }, page }), index)
        assert.equal(sortsRows(plan), false, `page ${JSON.stringify(page)} sorted its rows:\n${plan}`)
      }
    })
  }
})
