import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createAnyApiFieldEvolutionApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { filterVisibleIdentifiers } from '../plugins/core/lib/querying/include-query-helpers.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const identifiers = (type, size) => Array.from({ length: size }, (_, index) => ({ type, id: String(index + 1) }))
const isVisibilityQuery = ({ sql }) => /^select distinct .* as ["`](?:groups_key|items_key|logical_id)["`] from /.test(sql)
const policy = async ({ query, context, column, db }) => {
  await Promise.resolve()
  if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
  if (context.duplicateRows) {
    const copies = db.select(db.raw('1 as copy')).unionAll([db.select(db.raw('2 as copy')), db.select(db.raw('3 as copy'))])
    query.crossJoin(copies.as('copies'))
  }
  return true
}
const measure = async (fixture, operation) => {
  const queries = []; const rowCounts = []
  const capture = query => { if (isVisibilityQuery(query)) queries.push(query) }
  const captureRows = (rows, query) => { if (isVisibilityQuery(query)) rowCounts.push(rows.length) }
  fixture.knex.on('query', capture)
  fixture.knex.on('query-response', captureRows)
  try { return { result: await operation(), queries, rowCounts } } finally {
    fixture.knex.off('query', capture)
    fixture.knex.off('query-response', captureRows)
  }
}
const seed = (fixture, type, records) => seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records)

describe(`Visibility identifier batches (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { resourcePolicy: policy } })
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'visibility-batch-permissions',
          handler: ({ context, scopeName }) => {
            const request = context.originalContext
            const probe = request?.visibilityProbe
            if (context.method !== 'query' || !probe) return
            probe.permissions.push({
              scopeName,
              auth: request.auth,
              transaction: request.transaction,
              filters: request.queryParams.filters,
              id: request.id,
              schemaInfo: request.schemaInfo
            })
            if (probe.permissions.length === probe.denyAt) throw probe.failure
          }
        },
        knexQueryFiltering: {
          functionName: 'visibility-batch-filter-clone',
          handler: async ({ context }) => {
            const probe = context.visibilityProbe
            if (!probe) return
            probe.filters++
            await Promise.resolve()
            if (probe.filters === probe.failFilterAt) throw probe.failure
            if (probe.clone) context.knexQuery.query = context.knexQuery.query.clone()
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', [
      { id: '1', name: 'Visible first' }, { id: '101', name: 'Visible boundary' },
      { id: '201', name: 'Hidden group' }, { id: '33000', name: 'Visible last' }
    ])
    await seed(fixture, 'items', [{ id: '1', name: 'Visible item' }, { id: '101', name: 'Hidden item' }])
  })
  after(async () => { await fixture?.close() })
  const visible = (input, context = {}) => filterVisibleIdentifiers({ identifiers: input, scopes: fixture.api.resources, knex: fixture.knex, context })
  const probeContext = extra => ({
    hideRows: true,
    auth: { user: 'reader' },
    queryParams: { filters: { name: 'Parent-only filter' } },
    visibilityProbe: { permissions: [], filters: 0, clone: true },
    ...extra
  })

  it('handles 33,000 unique IDs without oversized SQL or losing later visible IDs', async () => {
    const input = identifiers('groups', 33000)
    input.push(input[0], input[100])
    const context = probeContext()
    const { result, queries, rowCounts } = await measure(fixture, () => visible(input, context))
    const expected = [input[0], input[100], input[32999], input[33000], input[33001]]
    assert.deepEqual(result, expected)
    result.forEach((row, index) => { assert.equal(row, expected[index]) })
    assert.equal(queries.length, 330)
    assert.ok(queries.every(query => query.bindings.length <= 103))
    assert.equal(rowCounts.length, 330)
    assert.ok(rowCounts.every(count => count <= 100))
    assert.equal(context.visibilityProbe.filters, 330)
    assert.equal(context.visibilityProbe.permissions.length, 330)
    for (const entry of context.visibilityProbe.permissions) {
      assert.equal(entry.scopeName, 'groups')
      assert.equal(entry.auth, context.auth)
      assert.equal(entry.transaction, undefined)
      assert.equal(entry.id, undefined)
      assert.deepEqual(entry.filters, {})
      assert.equal(entry.schemaInfo, fixture.api.resources.groups.vars.schemaInfo)
    }
    assert.equal(Object.hasOwn(context, 'knexQuery'), false)
    assert.deepEqual(context.queryParams.filters, { name: 'Parent-only filter' })
  })

  it('queries repeated IDs once and preserves every input occurrence despite duplicate join rows', async () => {
    const input = Array.from({ length: 33000 }, () => ({ type: 'groups', id: '1' }))
    const { result, queries, rowCounts } = await measure(fixture, () => visible(input, { hideRows: true, duplicateRows: true }))
    assert.equal(queries.length, 1)
    assert.deepEqual(rowCounts, [1])
    assert.equal(result.length, input.length)
    assert.ok(result.every((row, index) => row === input[index]))
  })

  it('keeps overlapping IDs separate by type and applies visibility to each batch', async () => {
    const input = [...identifiers('groups', 205), ...identifiers('items', 205)]
    const { result, queries, rowCounts } = await measure(fixture, () => visible(input, { hideRows: true, duplicateRows: true }))
    assert.deepEqual(result, [input[0], input[100], input[205]])
    assert.equal(queries.length, 6)
    assert.ok(rowCounts.every(count => count <= 100))
    assert.equal(rowCounts.reduce((sum, count) => sum + count, 0), 3)
  })

  it('does not reuse visibility between callers with different policy context', async () => {
    const input = identifiers('groups', 205)
    const { result, queries } = await measure(fixture, async () => [
      await visible(input, { hideRows: true }),
      await visible(input, { hideRows: false }),
      await visible(input, { hideRows: true })
    ])
    assert.deepEqual(result, [[input[0], input[100]], [input[0], input[100], input[200]], [input[0], input[100]]])
    assert.equal(queries.length, 9)
  })

  it('uses the caller transaction and does not retain its uncommitted visibility after rollback', async () => {
    const transaction = await fixture.knex.transaction()
    const input = identifiers('groups', 205)
    const context = probeContext({ transaction, db: transaction })
    try {
      const adapter = fixture.api.knex.helpers.getStorageAdapter('groups')
      await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '101').update(adapter.toStorageRow({ name: 'Hidden pending' }))
      const { result, queries } = await measure(fixture, () => visible(input, context))
      assert.deepEqual(result, [input[0]])
      assert.equal(queries.length, 3)
      assert.equal(transaction.isCompleted(), false)
      assert.ok(context.visibilityProbe.permissions.every(entry => entry.transaction === transaction))
    } finally { await transaction.rollback() }
    assert.deepEqual(await visible(input, { hideRows: true }), [input[0], input[100]])
  })

  for (const phase of ['permissions', 'filter']) {
    it(`rejects a later ${phase} failure without returning partial results or completing the caller transaction`, async () => {
      const transaction = await fixture.knex.transaction()
      const input = identifiers('groups', 205)
      const failure = phase === 'permissions'
        ? new RestApiResourceError('Later visibility batch denied', { subtype: 'forbidden' })
        : new RestApiValidationError('Later visibility filter failed')
      const context = probeContext({ transaction, db: transaction })
      Object.assign(context.visibilityProbe, { failure, ...(phase === 'permissions' ? { denyAt: 2 } : { failFilterAt: 2 }) })
      try {
        const { queries } = await measure(fixture, () => assert.rejects(visible(input, context), error => error === failure))
        assert.equal(queries.length, 1)
        assert.equal(context.visibilityProbe.permissions.length, 2)
        assert.equal(context.visibilityProbe.filters, phase === 'permissions' ? 1 : 2)
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual(await visible(input, { transaction, db: transaction, hideRows: true }), [input[0], input[100]])
      } finally { await transaction.rollback() }
    })
  }

  it('does no database work for empty input', async () => {
    const context = probeContext()
    const { result, queries } = await measure(fixture, () => visible([], context))
    assert.deepEqual(result, [])
    assert.deepEqual(queries, [])
    assert.deepEqual(context.visibilityProbe.permissions, [])
  })

  if (storageMode.isAnyApi()) {
    it('keeps text identity visibility on the covering index', async () => {
      const { queries } = await measure(fixture, () => visible(identifiers('groups', 3)))
      assert.equal(queries.length, 1)
      if (fixture.knex.client.config.client === 'better-sqlite3') {
        const plan = await fixture.knex.raw(`EXPLAIN QUERY PLAN ${queries[0].sql}`, queries[0].bindings)
        assert.ok(plan.some(row => row.detail.includes('COVERING INDEX')))
        assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE FOR DISTINCT')), JSON.stringify(plan))
      }
    })

    it('keeps separate tenant APIs isolated when they reuse the same input IDs', async () => {
      const other = await createAnyApiFieldEvolutionApi(fixture.knex, { tenantId: 'other_visibility', canonicalFieldsMap: { name: 'string_3' } })
      await seedStorageAdapterRecords(fixture.knex, other.resources.items.vars.schemaInfo, [{ id: '101', name: 'Other tenant only' }])
      const input = identifiers('items', 205)
      const { result, queries } = await measure(fixture, async () => [
        await visible(input, { hideRows: true }),
        await filterVisibleIdentifiers({ identifiers: input, scopes: other.resources, knex: fixture.knex, context: {} }),
        await visible(input, { hideRows: true })
      ])
      assert.deepEqual(result, [[input[0]], [input[100]], [input[0]]])
      assert.equal(queries.length, 9)
      assert.ok(queries.every(query => query.bindings.length <= 103))
    })
  }
})

describe(`Visibility batches in full include responses (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { resourcePolicy: policy, collectionInclude: { limit: null } } })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed(fixture, 'groups', [
      { id: '1000', name: 'Parent' },
      ...identifiers('groups', 205).map(({ id }) => ({ id, name: `${Number(id) % 50 === 0 ? 'Hidden' : 'Visible'} group ${id}` }))
    ])
    await seed(fixture, 'items', identifiers('items', 205).map(({ id }) => ({
      id, name: `Item ${id}`, groupId: id, subjectType: 'groups', subjectId: '1000', active: true, score: 0
    })))
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    it(`returns every included child with filtered references beyond two batches (${format})`, async () => {
      const { result, queries, rowCounts } = await measure(fixture, () => fixture.api.resources.groups.get({
        id: '1000', format, queryParams: { include: ['mentions'] }
      }, { hideRows: true }))
      const children = format === 'jsonapi' ? result.included : result.mentions
      assert.equal(children.length, 205)
      assert.deepEqual(children.map(row => row.id).sort(), identifiers('items', 205).map(row => row.id).sort())
      if (format === 'jsonapi') assert.deepEqual(result.data.relationships.mentions.data.map(row => row.id), children.map(row => row.id))
      for (const child of children) {
        const hidden = Number(child.id) % 50 === 0
        const group = format === 'jsonapi' ? child.relationships.group.data : child.group
        if (hidden) assert.equal(group, format === 'jsonapi' ? null : undefined)
        else assert.equal(group.id, child.id)
        const subject = format === 'jsonapi' ? child.relationships.subject.data : child.subject
        assert.equal(subject.id, '1000')
      }
      assert.equal(queries.length, 3)
      assert.ok(queries.every(query => query.bindings.length <= 103))
      assert.ok(rowCounts.every(count => count <= 100))
    })
  }
})
