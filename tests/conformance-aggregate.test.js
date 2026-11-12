import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createAggregateApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { databaseClient } from './helpers/test-database.js'
import { createSystemContext } from '../lib/system-context.js'

const tables = { customers: 'aggregate_customers', sales: 'aggregate_sales' }
const customers = [
  { name: 'Acme', workspace: 'w1' },
  { name: 'Globex', workspace: 'w2' },
  { name: 'Initech', workspace: 'w2' }
]
const sales = [
  { salesperson: 'Ann', region: 'north', amount: 100.5, units: 2, closed: true, closedOn: '2026-01-01', closedAt: '2026-01-01T10:00:00.000Z', loggedAt: '2026-01-01T10:00:00.250Z', workspace: 'w1', customer: 1, cents: 150 },
  { salesperson: 'Ann', region: 'south', amount: 50, units: 1, closed: false, closedOn: '2026-01-03', closedAt: null, workspace: 'w1', customer: 1, cents: 25 },
  { salesperson: 'Bob', region: 'north', amount: 30, units: 3, closed: true, closedOn: null, closedAt: '2026-02-01T08:30:00.000Z', workspace: 'w1', customer: 2, cents: null },
  { salesperson: 'Bob', region: 'north', amount: 20, units: 4, closed: true, closedOn: '2026-02-01', closedAt: '2026-02-02T00:00:00.000Z', loggedAt: '2026-02-02T23:59:59.900Z', workspace: 'w2', customer: 2, cents: 10 },
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
const cause = error => error?.cause ?? error
const sum = values => values.reduce((total, value) => total + value, 0)
// Monday of a 'YYYY-MM-DD' date's week.
const mondayOf = day => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
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

  it('groups by a hidden ownership field only in a system context', async () => {
    const customerAggregate = (params, context) => fixture.api.resources.customers.aggregate(params, context)
    const system = createSystemContext('find the workspaces with customers')
    const owners = await customerAggregate({ groupBy: ['workspace'], measures: { rows: { count: '*' } } }, system)
    assert.deepEqual(owners.data, [{ workspace: 'w1', rows: 1 }, { workspace: 'w2', rows: 2 }])
    const distinct = await customerAggregate({ measures: { owners: { countDistinct: 'workspace' } } }, createSystemContext('count the workspaces'))
    assert.deepEqual(distinct.data, [{ owners: 2 }])

    // A scoped caller, and one whose optional owner filter does not resolve, may not.
    const refused = error => cause(error) instanceof RestApiValidationError && /'workspace' is not an attribute of 'customers' that can be aggregated/.test(cause(error).message)
    for (const context of [{ workspace: 'w1' }, {}]) {
      await assert.rejects(customerAggregate({ groupBy: ['workspace'], measures: { rows: { count: '*' } } }, context), refused)
      await assert.rejects(customerAggregate({ measures: { owners: { countDistinct: 'workspace' } } }, context), refused)
    }
    // Other uses of the field, and other hidden fields, stay refused in a system context.
    await assert.rejects(customerAggregate({ measures: { first: { min: 'workspace' } } }, createSystemContext('min')), refused)
    await assert.rejects(aggregate({ groupBy: ['secret'], measures: { rows: { count: '*' } } }, createSystemContext('secret')),
      error => cause(error) instanceof RestApiValidationError && /'secret' is not an attribute/.test(cause(error).message))
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
      [{ measures: { x: { count: '*' } }, queryParams: { filters: { unknown: 1 } } }, /not allowed/],
      [{ measures: { x: { count: 'loggedAt' } } }, /transforms its stored values/],
      [{ groupBy: ['loggedAt'], measures: { x: { count: '*' } } }, /transforms its stored values/],
      [{ measures: { x: { count: '*', where: {} } } }, /map fields to conditions/],
      [{ measures: { x: { count: '*', where: { region: { like: 'n%' } } } } }, /Unknown operator/],
      [{ measures: { x: { count: '*', where: { region: { gt: null } } } } }, /cannot compare with null/],
      [{ measures: { x: { count: '*', where: { region: { in: [] } } } } }, /non-empty array/],
      [{ measures: { x: { count: '*', where: { cents: 1 } } } }, /transforms its stored values/],
      [{ measures: { x: { count: '*', where: { loggedAt: null } } } }, /transforms its stored values/],
      [{ groupBy: [{ field: 'region', bucket: 'day' }], measures: { x: { count: '*' } } }, /date or dateTime/],
      [{ groupBy: [{ field: 'closedAt', bucket: 'hour' }], measures: { x: { count: '*' } } }, /bucket must be one of/],
      [{ groupBy: [{ field: 'closedAt', bucket: 'day', timezone: 'Mars/Base' }], measures: { x: { count: '*' } } }, /not a time zone/],
      [{ groupBy: [{ field: 'closedAt', bucket: 'day', timezone: '+15:00' }], measures: { x: { count: '*' } } }, /not a UTC offset/],
      [{ groupBy: [{ field: 'closedOn', bucket: 'day', timezone: '+10:00' }], measures: { x: { count: '*' } } }, /no time of day/],
      [{ groupBy: [{ field: 'closedAt', bucket: 'day', every: 2 }], measures: { x: { count: '*' } } }, /Unknown bucket options/],
      [{ groupBy: ['closedAt', { field: 'closedAt', bucket: 'day' }], measures: { x: { count: '*' } } }, /give the bucket another name/]
    ]
    for (const [params, message] of cases) {
      await assert.rejects(aggregate(params), error => error instanceof RestApiValidationError && message.test(error.message), JSON.stringify(params))
    }
  })

  it('computes conditional measures in the same query', async () => {
    const result = await aggregate({
      groupBy: ['region'],
      measures: {
        rows: { count: '*' },
        closedRows: { count: '*', where: { closed: true } },
        closedAmount: { sum: 'amount', where: { closed: true } },
        busySellers: { countDistinct: 'salesperson', where: { units: { gte: 2 } } },
        nobody: { count: '*', where: { salesperson: null } },
        openUnits: { sum: 'units', where: { salesperson: ['Ann', 'Bob'], closed: false } },
        lastClose: { max: 'closedAt', where: { closedAt: { lt: '2026-02-02T00:00:00.000Z' } } }
      },
      queryParams: { page: { size: 4 } }
    })
    const expected = group(sales, ['region']).map(rows => {
      const closed = rows.filter(row => row.closed)
      const open = rows.filter(row => !row.closed && ['Ann', 'Bob'].includes(row.salesperson))
      const closes = rows.map(row => row.closedAt).filter(value => value && value < '2026-02-02T00:00:00.000Z').sort()
      return {
        region: rows[0].region,
        rows: rows.length,
        closedRows: closed.length,
        closedAmount: closed.length ? sum(closed.map(row => row.amount)) : null,
        busySellers: new Set(rows.filter(row => row.units >= 2 && row.salesperson !== null).map(row => row.salesperson)).size,
        nobody: rows.filter(row => row.salesperson === null).length,
        openUnits: open.length ? sum(open.map(row => row.units)) : null,
        lastClose: closes.at(-1) ?? null
      }
    }).sort(byKeys(['region']))
    assert.deepEqual(result.data, expected)

    const totals = await aggregate({
      measures: {
        notNorth: { count: '*', where: { region: { ne: 'north' } } },
        southOrEast: { count: '*', where: { region: { notIn: ['north'] } } },
        closedTimes: { count: '*', where: { closedAt: { ne: null } } },
        february: { count: 'closedOn', where: { closedOn: { gte: '2026-02-01', lt: '2026-03-01' } } },
        firstFebruary: { min: 'closedAt', where: { closedAt: { gt: '2026-02-01T00:00:00.000Z' } } }
      }
    })
    assert.deepEqual(totals.data, [{ notNorth: 3, southOrEast: 3, closedTimes: 3, february: 1, firstFebruary: '2026-02-01T08:30:00.000Z' }])
  })

  it('groups dates by day, week, month and year', { skip: storageMode.isAnyApi() && 'buckets need table storage' }, async () => {
    const buckets = async (groupEntry, size = 4) => (await aggregate({ groupBy: [groupEntry], measures: { rows: { count: '*' } }, queryParams: { page: { size } } })).data
    const counts = values => {
      const totals = new Map()
      for (const value of values) totals.set(value, (totals.get(value) || 0) + 1)
      return [...totals].sort(([left], [right]) => left === null ? -1 : right === null ? 1 : left < right ? -1 : 1)
    }
    const pairs = (rows, name) => rows.map(row => [row[name], row.rows])

    assert.deepEqual(pairs(await buckets({ field: 'closedAt', bucket: 'day' }), 'closedAt'),
      counts(sales.map(row => row.closedAt?.slice(0, 10) ?? null)))
    assert.deepEqual(pairs(await buckets({ field: 'closedOn', bucket: 'week', as: 'week' }), 'week'),
      counts(sales.map(row => row.closedOn && mondayOf(row.closedOn))))
    assert.deepEqual(pairs(await buckets({ field: 'closedOn', bucket: 'month', as: 'month' }), 'month'),
      counts(sales.map(row => row.closedOn && `${row.closedOn.slice(0, 7)}-01`)))
    assert.deepEqual(pairs(await buckets({ field: 'closedAt', bucket: 'year', as: 'year' }), 'year'),
      counts(sales.map(row => row.closedAt && `${row.closedAt.slice(0, 4)}-01-01`)))

    // Nine hours west of UTC: 08:30 on 1 February is still 31 January.
    const local = value => value && new Date(Date.parse(value) - 9 * 3600 * 1000).toISOString().slice(0, 10)
    const west = counts(sales.map(row => local(row.closedAt)))
    assert.deepEqual(pairs(await buckets({ field: 'closedAt', bucket: 'day', timezone: '-09:00', as: 'day' }), 'day'), west)
    assert.deepEqual(pairs(await buckets({ field: 'closedAt', bucket: 'week', timezone: '-09:00', as: 'week' }), 'week'),
      counts(sales.map(row => row.closedAt && mondayOf(local(row.closedAt)))))

    // A zone name with standard time nine hours west in winter.
    const named = { field: 'closedAt', bucket: 'day', timezone: 'America/Anchorage', as: 'day' }
    if (databaseClient === 'better-sqlite3') {
      await assert.rejects(buckets(named), error => cause(error) instanceof RestApiValidationError && /SQLite has no time zone data/.test(cause(error).message))
    } else if (databaseClient === 'pg') {
      assert.deepEqual(pairs(await buckets(named), 'day'), west)
    } else {
      const [rows] = await fixture.knex.raw("select convert_tz('2000-01-01 00:00:00', '+00:00', 'America/Anchorage') as converted")
      if (rows[0].converted == null) {
        await assert.rejects(buckets(named), error => cause(error) instanceof RestApiValidationError && /no time zone data/.test(cause(error).message))
      } else {
        assert.deepEqual(pairs(await buckets(named), 'day'), west)
      }
    }

    // Buckets combine with fields, conditional measures, sorting and pages.
    const months = await aggregate({
      groupBy: ['closed', { field: 'closedOn', bucket: 'month', as: 'month' }],
      measures: { rows: { count: '*' }, big: { sum: 'amount', where: { amount: { gt: 25 } } } },
      queryParams: { sort: ['-month'], filters: { closed: true }, page: { size: 1, number: 2 } }
    })
    assert.deepEqual(months, { data: [{ closed: true, month: '2026-01-01', rows: 1, big: 100.5 }], meta: { page: { size: 1, number: 2, hasMore: true } } })
  })

  it('buckets and bounds dateTime fields that have a storage serializer', async () => {
    const bounds = await aggregate({ measures: { first: { min: 'loggedAt' }, last: { max: 'loggedAt' } } })
    // Results are the stored values, read back as dateTime.
    assert.deepEqual(bounds.data, [{ first: '2026-01-01T10:00:00.000Z', last: '2026-02-02T23:59:59.000Z' }])
    if (storageMode.isAnyApi()) {
      await assert.rejects(aggregate({ groupBy: [{ field: 'loggedAt', bucket: 'day' }], measures: { rows: { count: '*' } } }),
        error => cause(error) instanceof RestApiValidationError && /table storage/.test(cause(error).message))
      return
    }
    const days = await aggregate({ groupBy: [{ field: 'loggedAt', bucket: 'day', timezone: '+00:30' }], measures: { rows: { count: '*' } }, queryParams: { page: { size: 4 } } })
    assert.deepEqual(days.data, [{ loggedAt: null, rows: 4 }, { loggedAt: '2026-01-01', rows: 1 }, { loggedAt: '2026-02-03', rows: 1 }])
  })

  it('aggregates normally hidden fields, which callers can request', async () => {
    const result = await aggregate({ measures: { internal: { sum: 'internal' } } })
    assert.deepEqual(result.data, [{ internal: 3 * sales.length }])
  })

  // The aggregate statements an operation sends: those naming the first measure.
  const aggregateStatements = async (run) => {
    const statements = []
    const listener = query => { if (/ as ["`]m0["`]/.test(query.sql)) statements.push(query) }
    fixture.knex.on('query', listener)
    try { await run() } finally { fixture.knex.off('query', listener) }
    return statements
  }

  it('answers alike whether its filters join another table or not, under row policies and ownership', async () => {
    // A filter on the customer's name joins customers, so the aggregate groups the rows whose
    // ids the filtered query selects; a filter on the customer's id groups the filtered rows.
    const measures = {
      rows: { count: '*' },
      regions: { countDistinct: 'region' },
      total: { sum: 'amount' },
      meanUnits: { avg: 'units' },
      first: { min: 'closedOn' },
      last: { max: 'closedAt' },
      closedTotal: { sum: 'amount', where: { closed: true } }
    }
    const expectedOf = rows => group(rows, ['salesperson']).map(rows => {
      const closed = rows.filter(row => row.closed)
      return {
        salesperson: rows[0].salesperson,
        rows: rows.length,
        regions: new Set(rows.map(row => row.region)).size,
        total: sum(rows.map(row => row.amount)),
        meanUnits: sum(rows.map(row => row.units)) / rows.length,
        first: rows.map(row => row.closedOn).filter(Boolean).sort()[0] ?? null,
        last: rows.map(row => row.closedAt).filter(Boolean).sort().at(-1) ?? null,
        closedTotal: closed.length ? sum(closed.map(row => row.amount)) : null
      }
    }).sort(byKeys(['salesperson']))
    const contexts = [{}, { workspace: 'w2' }, { region: 'north' }, { workspace: 'w2', region: 'north' }]
    const statements = await aggregateStatements(async () => {
      for (const context of contexts) {
        const visible = sales.filter(row => row.customer === 2 && [row.workspace, undefined].includes(context.workspace) && [row.region, undefined].includes(context.region))
        const joined = await aggregate({ groupBy: ['salesperson'], measures, queryParams: { filters: { customerName: 'Globex' } } }, { ...context })
        const direct = await aggregate({ groupBy: ['salesperson'], measures, queryParams: { filters: { customerId: '2' } } }, { ...context })
        assert.deepEqual(direct, joined, JSON.stringify(context))
        assert.deepEqual(direct.data, expectedOf(visible), JSON.stringify(context))
        const totals = await aggregate({ measures, queryParams: { filters: { customerName: 'Globex' } } }, { ...context })
        assert.deepEqual(await aggregate({ measures, queryParams: { filters: { customerId: '2' } } }, { ...context }), totals, JSON.stringify(context))
      }
    })
    // Each pair compared the two reads: the joined one by ids, the direct one not.
    assert.deepEqual(statements.map(({ sql }) => sql.includes('__jra_aggregate')), contexts.flatMap(() => [true, false, true, false]))
  })

  // The rows a statement reads, as each database reports them. A small table hides whether a
  // statement reads the table's other rows: a full scan costs less there than an index, and
  // looking selected ids up one by one less than joining them, where on a large table
  // PostgreSQL joins a long id list by hash over the whole table. So PostgreSQL, MySQL and
  // MariaDB are asked to prefer an index wherever one applies and not to look ids up one by
  // one. PostgreSQL 18 also folds a table's join to itself on its primary key into one read,
  // which it cannot do for a partitioned table or before 18, so it is asked not to. SQLite
  // reports no rows read: its plan stands in for them, and must reach every table through an
  // index rather than scan it whole.
  const rowsRead = async ({ sql, bindings }) => {
    const statement = sql.replace(/\$\d+/g, '?')
    if (databaseClient === 'pg') {
      return fixture.knex.transaction(async (trx) => {
        await trx.raw("select set_config(name, 'off', true) from pg_settings where name in ('enable_seqscan', 'enable_nestloop', 'enable_self_join_elimination')")
        await trx.raw('set local max_parallel_workers_per_gather = 0')
        const [{ Plan: plan }] = (await trx.raw(`explain (analyze, format json) ${statement}`, bindings)).rows[0]['QUERY PLAN']
        const read = node => (node['Relation Name'] ? Math.round((node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Index Recheck'] ?? 0)) * node['Actual Loops']) : 0) +
          (node.Plans ?? []).reduce((total, child) => total + read(child), 0)
        return read(plan)
      })
    }
    if (databaseClient === 'mysql2') {
      return fixture.knex.transaction(async (trx) => {
        const handlerReads = async () => (await trx.raw("show session status like 'Handler_read%'"))[0].reduce((total, row) => total + Number(row.Value), 0)
        await trx.raw("set session max_seeks_for_key = 1, optimizer_switch = 'semijoin=off'")
        try {
          const before = await handlerReads()
          await trx.raw(statement, bindings)
          return (await handlerReads()) - before
        } finally { await trx.raw('set session max_seeks_for_key = default, optimizer_switch = default') }
      })
    }
    const plan = (await fixture.knex.raw(`explain query plan ${statement}`, bindings)).map(row => row.detail)
    assert.ok(plan.every(step => !/^SCAN (?!CONSTANT)/.test(step)), plan.join('\n'))
    return plan.join('\n')
  }

  it('reads the rows its filters select, however many other rows the table holds', async () => {
    let next = 1000
    const write = (count, attributes) => fixture.api.resources.sales.postMany({
      returning: 'minimal',
      document: { data: Array.from({ length: count }, (_, index) => ({ type: 'sales', id: String(next++), attributes: { salesperson: `S${index % 7}`, amount: 1, units: 1, ...attributes(index) } })) }
    })
    // Planner statistics, as a live database keeps them; SQLite keeps none unless asked.
    const analyze = () => databaseClient === 'mysql2'
      ? fixture.knex.raw('analyze table ??', [storageMode.isAnyApi() ? 'any_records' : tables.sales])
      : databaseClient === 'pg' && fixture.knex.raw('analyze')
    // 490 rows of one region beside 500 of others, then beside ten times as many.
    await write(490, () => ({ region: 'west' }))
    const report = { groupBy: ['salesperson'], measures: { rows: { count: '*' }, total: { sum: 'amount' } }, queryParams: { filters: { region: 'west' }, page: { size: 4 } } }
    const readsBeside = async (others) => {
      await write(others, index => ({ region: `r${index % 10}` }))
      await analyze()
      let result
      const [statement] = await aggregateStatements(async () => { result = await aggregate(report) })
      return { result, read: await rowsRead(statement) }
    }
    const few = await readsBeside(500)
    assert.deepEqual(few.result.data, [0, 1, 2, 3].map(index => ({ salesperson: `S${index}`, rows: 70, total: 70 })))
    const many = await readsBeside(4500)
    assert.deepEqual(many, few, `rows read beside 500 other rows: ${few.read}; beside 5,000: ${many.read}`)
  })
})
