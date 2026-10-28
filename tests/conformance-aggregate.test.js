import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createAggregateApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'

const tables = { customers: 'aggregate_customers', sales: 'aggregate_sales' }
const customers = [
  { name: 'Acme', workspace: 'w1' },
  { name: 'Globex', workspace: 'w2' }
]
const sales = [
  { salesperson: 'Ann', region: 'north', amount: 100.5, units: 2, closed: true, closedOn: '2026-01-01', closedAt: '2026-01-01T10:00:00.000Z', workspace: 'w1', customer: 1, cents: 150 },
  { salesperson: 'Ann', region: 'south', amount: 50, units: 1, closed: false, closedOn: '2026-01-03', closedAt: null, workspace: 'w1', customer: 1, cents: 25 },
  { salesperson: 'Bob', region: 'north', amount: 30, units: 3, closed: true, closedOn: null, closedAt: '2026-02-01T08:30:00.000Z', workspace: 'w1', customer: 2, cents: null },
  { salesperson: 'Bob', region: 'north', amount: 20, units: 4, closed: true, closedOn: '2026-02-01', closedAt: '2026-02-02T00:00:00.000Z', workspace: 'w2', customer: 2, cents: 10 },
  { salesperson: 'Cy', region: 'south', amount: 5.25, units: 1, closed: false, closedOn: '2026-03-01', closedAt: null, workspace: 'w2', customer: 2, cents: 1 },
  { salesperson: null, region: 'east', amount: 1, units: 5, closed: false, closedOn: null, closedAt: null, workspace: 'w2', customer: null, cents: null }
]

// The oracle groups the seeded rows in JavaScript, independently of SQL.
const group = (rows, keys) => {
  const groups = new Map()
  for (const row of rows) {
    const key = JSON.stringify(keys.map(field => row[field]))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()]
}
const sum = values => values.reduce((total, value) => total + value, 0)
const byKeys = keys => (left, right) => {
  for (const key of keys) {
    // NULL sorts as the lowest value.
    if (left[key] === right[key]) continue
    if (left[key] === null) return -1
    if (right[key] === null) return 1
    return left[key] < right[key] ? -1 : 1
  }
  return 0
}

describe(`Resource aggregates (${storageMode.mode})`, () => {
  let fixture
  const aggregate = (params, context) => fixture.api.resources.sales.aggregate(params, context)

  before(async () => {
    fixture = await createConformanceFixture({ createApi: createAggregateApi, tables })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const customer of customers) await fixture.seed('customers', customer)
    for (const { customer, ...attributes } of sales) {
      // The getter field is written through its stored value.
      await fixture.seed('sales', { ...attributes, secret: 7, internal: 3 }, customer ? { customer: { data: { type: 'customers', id: String(customer) } } } : {})
    }
  })
  after(async () => { await fixture?.close() })

  it('groups and measures match the rows, with NULL groups first', async () => {
    const result = await aggregate({
      groupBy: ['salesperson'],
      measures: {
        total: { sum: 'amount' },
        rows: { count: '*' },
        closedDates: { count: 'closedOn' },
        regions: { countDistinct: 'region' },
        meanUnits: { avg: 'units' },
        first: { min: 'closedOn' },
        last: { max: 'closedAt' },
        fewest: { min: 'units' }
      },
      queryParams: { page: { size: 4 } }
    })
    const expected = group(sales, ['salesperson']).map(rows => {
      const dates = rows.map(row => row.closedOn).filter(Boolean).sort()
      const times = rows.map(row => row.closedAt).filter(Boolean).sort()
      return {
        salesperson: rows[0].salesperson,
        total: sum(rows.map(row => row.amount)),
        rows: rows.length,
        closedDates: dates.length,
        regions: new Set(rows.map(row => row.region)).size,
        meanUnits: sum(rows.map(row => row.units)) / rows.length,
        first: dates[0] ?? null,
        last: times.at(-1) ?? null,
        fewest: Math.min(...rows.map(row => row.units))
      }
    }).sort(byKeys(['salesperson']))
    assert.deepEqual(result, { data: expected, meta: { page: { size: 4, number: 1, hasMore: false } } })
  })

  it('groups by booleans, dates and relationships with their public values', async () => {
    const page = number => aggregate({ groupBy: ['closed', 'customerId'], measures: { units: { sum: 'units' } }, queryParams: { page: { size: 4, number } } })
    const result = { data: [...(await page(1)).data, ...(await page(2)).data] }
    const expected = group(sales, ['closed', 'customer'])
      .map(rows => ({ closed: rows[0].closed, customerId: rows[0].customer === null ? null : String(rows[0].customer), units: sum(rows.map(row => row.units)) }))
      .sort(byKeys(['closed', 'customerId']))
    assert.deepEqual(result.data, expected)

    const dates = await aggregate({ groupBy: ['closedOn'], measures: { rows: { count: '*' } }, queryParams: { sort: ['-closedOn'], page: { size: 4 } } })
    assert.deepEqual(dates.data.map(row => row.closedOn), ['2026-03-01', '2026-02-01', '2026-01-03', '2026-01-01'])
    assert.equal(dates.meta.page.hasMore, true)
  })

  it('applies filters and pages by the requested order', async () => {
    const filtered = await aggregate({ groupBy: ['region'], measures: { total: { sum: 'amount' } }, queryParams: { filters: { closed: true } } })
    assert.deepEqual(filtered.data, [{ region: 'north', total: 150.5 }])

    const totals = group(sales, ['salesperson'])
      .map(rows => ({ salesperson: rows[0].salesperson, total: sum(rows.map(row => row.amount)) }))
      .sort((left, right) => right.total - left.total)
    const first = await aggregate({ groupBy: ['salesperson'], measures: { total: { sum: 'amount' } }, queryParams: { sort: ['-total'] } })
    const second = await aggregate({ groupBy: ['salesperson'], measures: { total: { sum: 'amount' } }, queryParams: { sort: ['-total'], page: { number: 2 } } })
    assert.deepEqual([...first.data, ...second.data], totals)
    assert.deepEqual(first.meta.page, { size: 2, number: 1, hasMore: true })
    assert.deepEqual(second.meta.page, { size: 2, number: 2, hasMore: false })
  })

  it('counts only what the row policy and autofilter let the caller see', async () => {
    const context = { region: 'north', policyPurposes: [] }
    const visible = await aggregate({ measures: { rows: { count: '*' }, total: { sum: 'amount' } } }, context)
    assert.deepEqual(visible.data, [{ rows: 3, total: 150.5 }])
    assert.deepEqual(context.policyPurposes, ['aggregate'])

    const scoped = await aggregate({ groupBy: ['region'], measures: { rows: { count: '*' } } }, { workspace: 'w2' })
    assert.deepEqual(scoped.data, [{ region: 'east', rows: 1 }, { region: 'north', rows: 1 }])

    const both = await aggregate({ measures: { rows: { count: '*' } } }, { workspace: 'w2', region: 'south' })
    assert.deepEqual(both.data, [{ rows: 1 }])
  })

  it('returns one row over an empty selection', async () => {
    const result = await aggregate({ measures: { rows: { count: '*' }, total: { sum: 'amount' }, first: { min: 'closedAt' } }, queryParams: { filters: { region: 'west' } } })
    assert.deepEqual(result, { data: [{ rows: 0, total: null, first: null }] })
  })

  it('counts each record once when a filter joins many related rows', async () => {
    const result = await fixture.api.resources.customers.aggregate({ measures: { rows: { count: '*' } }, queryParams: { filters: { saleRegion: 'north' } } })
    // Globex has two north sales; a join row per sale would count it twice.
    assert.deepEqual(result.data, [{ rows: 2 }])
    const all = await fixture.api.resources.customers.aggregate({ measures: { rows: { count: '*' } }, queryParams: { filters: { saleRegion: 'south' } } })
    assert.deepEqual(all.data, [{ rows: 2 }])
  })

  it('sees uncommitted rows in a caller transaction', async () => {
    await fixture.api.transaction(async (transaction) => {
      await fixture.api.resources.sales.post({ transaction, document: { data: { type: 'sales', id: '99', attributes: { region: 'west', amount: 9, units: 1 } } } })
      const inside = await aggregate({ transaction, measures: { rows: { count: '*' } }, queryParams: { filters: { region: 'west' } } })
      assert.deepEqual(inside.data, [{ rows: 1 }])
    })
  })

  it('checks permissions as a query read', async () => {
    const seen = []
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'aggregate-permission-probe',
          handler: ({ context }) => {
            if (context.originalContext?.method !== 'aggregate') return
            seen.push(context.method)
            if (context.originalContext.denyAggregate) throw new RestApiResourceError('Aggregate denied', { subtype: 'forbidden' })
          }
        }
      }
    })
    await aggregate({ measures: { rows: { count: '*' } } })
    assert.deepEqual(seen, ['query'])
    await assert.rejects(aggregate({ measures: { rows: { count: '*' } } }, { denyAggregate: true }), /Aggregate denied/)
  })

  it('rejects fields and options it cannot aggregate faithfully', async () => {
    const cases = [
      [{ measures: { x: { sum: 'secret' } } }, /secret/],
      [{ measures: { x: { sum: 'cents' } } }, /transforms its stored values/],
      [{ measures: { x: { sum: 'salesperson' } } }, /sum cannot be applied/],
      [{ measures: { x: { min: 'closed' } } }, /min cannot be applied/],
      [{ measures: { x: { median: 'amount' } } }, /must be one of/],
      [{ measures: { x: { sum: '*' } } }, /Only count/],
      [{ measures: {} }, /at least one measure/],
      [{ measures: { 'not valid': { count: '*' } } }, /Measure name/],
      [{ groupBy: ['region'], measures: { region: { count: '*' } } }, /name of a grouped field/],
      [{ groupBy: ['region', 'region'], measures: { x: { count: '*' } } }, /twice/],
      [{ groupBy: ['id'], measures: { x: { count: '*' } } }, /not an attribute/],
      [{ measures: { x: { count: '*' } }, format: 'plain' }, /Unknown aggregate parameter/],
      [{ measures: { x: { count: '*' } }, queryParams: { include: ['customer'] } }, /queryParams.include/],
      [{ measures: { x: { count: '*' } }, queryParams: { page: { size: 1 } } }, /without groupBy/],
      [{ groupBy: ['region'], measures: { x: { count: '*' } }, queryParams: { page: { size: 5 } } }, /cannot exceed 4/],
      [{ groupBy: ['region'], measures: { x: { count: '*' } }, queryParams: { page: { after: 'x' } } }, /size and number/],
      [{ groupBy: ['region'], measures: { x: { count: '*' } }, queryParams: { sort: ['amount'] } }, /grouped field or a measure/],
      [{ measures: { x: { count: '*' } }, queryParams: { filters: { unknown: 1 } } }, /not allowed/]
    ]
    for (const [params, message] of cases) {
      await assert.rejects(aggregate(params), error => error instanceof RestApiValidationError && message.test(error.message), JSON.stringify(params))
    }
  })

  it('aggregates normally hidden fields, which callers can request', async () => {
    const result = await aggregate({ measures: { internal: { sum: 'internal' } } })
    assert.deepEqual(result.data, [{ internal: 3 * sales.length }])
  })
})
