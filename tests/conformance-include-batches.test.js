import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords, seedUnqueriedIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { groupByPolymorphicType } from '../plugins/core/lib/querying/include-query-helpers.js'

const rootId = '100000'
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const pathFor = kind => kind === 'belongsTo' ? 'mentions.group' : 'items.subject'
const foreignName = kind => kind === 'belongsTo' ? 'group' : 'subject'
const isTargetQuery = query => /["`](?:groups_key|items_key|logical_id)["`] in \(/.test(query.toSQL().sql)
const seed = (fixture, type, records) => seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records)
const createFixture = async (options = {}) => {
  const fixture = await createConformanceFixture({
    createApi: createIdConformanceApi,
    tables,
    apiOptions: {
      collectionInclude: { limit: null },
      polymorphicTargets: ['groups', 'items'],
      resourcePolicy: ({ query, context, column }) => {
        if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
        return true
      },
      ...options
    }
  })
  await fixture.api.customize({
    hooks: {
      checkPermissions: {
        functionName: 'include-batch-query-probe',
        handler: ({ context, scopeName }) => {
          const request = context.originalContext
          const query = request?.knexQuery
          const probe = request?.includeProbe
          if (context.method !== 'query' || !probe || query?.queryPurpose !== 'include' || !isTargetQuery(query.query)) return
          probe.queries.push({ scopeName, transaction: request.transaction, auth: request.auth, ...query.query.toSQL() })
          if (probe.queries.length === probe.denyAt) throw probe.failure
        }
      }
    }
  })
  return fixture
}
const seedTree = async (fixture, kind, size, repeats = 0) => {
  await seed(fixture, 'groups', [{ id: rootId, name: 'Parent' }])
  for (let offset = 0; offset < size; offset += 200) {
    const ids = Array.from({ length: Math.min(200, size - offset) }, (_, index) => String(offset + index + 1))
    await seed(fixture, 'groups', ids.map(id => ({ id, name: `${Number(id) % 100 === 0 ? 'Hidden' : 'Group'} ${id.padStart(5, '0')}` })))
    await seed(fixture, 'items', ids.map(id => ({
      id,
      name: `Child ${id.padStart(5, '0')}`,
      active: true,
      score: 0,
      groupId: kind === 'belongsTo' ? id : rootId,
      subjectType: 'groups',
      subjectId: kind === 'belongsTo' ? rootId : id
    })))
  }
  if (repeats) {
    await seed(fixture, 'items', Array.from({ length: repeats }, (_, index) => ({
      id: String(size + index + 1),
      name: `Repeated ${index}`,
      active: true,
      score: 0,
      groupId: kind === 'belongsTo' ? '1' : rootId,
      subjectType: 'groups',
      subjectId: kind === 'belongsTo' ? rootId : '1'
    })))
  }
}
const probe = () => ({ queries: [], projections: 0, computedIds: [] })
const read = (fixture, kind, options = {}, context = {}) => fixture.api.resources.groups.get({
  id: rootId, format: 'jsonapi', queryParams: { include: [pathFor(kind)] }, ...options
}, context)

for (const kind of ['belongsTo', 'polymorphic']) {
  describe(`Large ${kind} include batches (${storageMode.mode})`, () => {
    let fixture
    before(async () => { fixture = await createFixture() })
    beforeEach(async () => { await fixture.reset() })
    after(async () => { await fixture?.close() })
    it('loads all 33,000 children and visible targets without exceeding SQL parameter limits', async () => {
      await seedTree(fixture, kind, 33000)
      const includeProbe = probe()
      const result = await read(fixture, kind, {}, { hideRows: true, includeProbe })
      const children = result.included.filter(row => row.type === 'items')
      const targets = result.included.filter(row => row.type === 'groups')
      assert.equal(children.length, 33000)
      assert.equal(targets.length, 32670)
      assert.equal(result.data.relationships[kind === 'belongsTo' ? 'mentions' : 'items'].data.length, 33000)
      const byId = new Map(targets.map(row => [row.id, row]))
      for (const child of children) {
        const hidden = Number(child.id) % 100 === 0
        assert.deepEqual(child.relationships[foreignName(kind)].data, hidden ? null : { type: 'groups', id: child.id })
        if (!hidden) assert.equal(byId.get(child.id).attributes.name, `Group ${child.id.padStart(5, '0')}`)
      }
      assert.equal(includeProbe.queries.length, 330)
      assert.ok(includeProbe.queries.every(query => query.bindings.length <= 103))
    })
  })

  describe(`${kind} include batch contracts (${storageMode.mode})`, () => {
    let fixture
    before(async () => {
      fixture = await createFixture({
        includeProjection: true,
        computedDependencies: ['displayName'],
        projectionSelect: ({ knex, column, scopeName, context }) => {
          const state = context?.includeProbe
          if (state && scopeName === 'groups' && ++state.projections === state.failProjectionAt) throw state.failure
          return knex.raw('upper(??)', [column('name')])
        },
        fieldCallback: (phase, type, value, context) => {
          if (phase !== 'computed') return value
          if (type === 'groups' && context.context.includeProbe) context.context.includeProbe.computedIds.push(String(context.id))
          return `${context.attributes.displayName}!`
        }
      })
    })
    beforeEach(async () => { await fixture.reset(); await seedTree(fixture, kind, 205, 2) })
    after(async () => { await fixture?.close() })

    for (const format of ['jsonapi', 'plain']) {
      it(`preserves sparse projections, dependencies and repeated references (${format})`, async () => {
        const includeProbe = probe()
        const auth = { user: 'reader' }
        const result = await read(fixture, kind, {
          format,
          queryParams: { include: [pathFor(kind)], fields: { groups: 'derivedName,items,mentions', items: 'group,subject' } }
        }, { hideRows: true, includeProbe, auth })
        const children = format === 'jsonapi' ? result.included.filter(row => row.type === 'items') : result[kind === 'belongsTo' ? 'mentions' : 'items']
        assert.equal(children.length, 207)
        const targets = format === 'jsonapi'
          ? result.included.filter(row => row.type === 'groups')
          : [...new Map(children.map(row => row[foreignName(kind)]).filter(Boolean).map(row => [row.id, row])).values()]
        assert.equal(targets.length, 203)
        for (const row of targets) {
          const attributes = format === 'jsonapi' ? row.attributes : row
          assert.equal(attributes.derivedName, `GROUP ${row.id.padStart(5, '0')}!`)
          assert.equal(attributes.name, undefined)
          assert.equal(attributes.displayName, undefined)
          assert.equal(attributes.display_name, undefined)
        }
        assert.equal(includeProbe.queries.length, 3)
        assert.ok(includeProbe.queries.every(query => query.bindings.length <= 103 && query.auth === auth))
        assert.equal(includeProbe.projections, 4)
        assert.equal(includeProbe.computedIds.length, 204)
        assert.equal(new Set(includeProbe.computedIds).size, 204)
      })
    }

    for (const phase of ['permission', 'projection']) {
      for (const write of [false, true]) {
        it(`retains a later ${phase} failure during ${write ? 'an owned write response' : 'a borrowed read'}`, async () => {
          const transaction = write ? undefined : await fixture.knex.transaction()
          const includeProbe = probe()
          includeProbe.failure = phase === 'permission'
            ? new RestApiResourceError('Later include denied', { subtype: 'forbidden' })
            : new RestApiValidationError('Later include projection failed')
          Object.assign(includeProbe, phase === 'permission' ? { denyAt: 2 } : { failProjectionAt: 3 })
          const context = { hideRows: true, includeProbe }
          try {
            const operation = write
              ? fixture.api.resources.groups.patch({ id: rootId, returning: 'full', document: { data: { type: 'groups', attributes: { name: 'Changed' } } }, queryParams: { include: [pathFor(kind)] } }, context)
              : read(fixture, kind, { transaction }, context)
            await assert.rejects(operation, error => write ? assertWriteFailure(error, { cause: includeProbe.failure, outcome: 'rolledBack' }) : error === includeProbe.failure)
            assert.equal(includeProbe.queries.length, phase === 'permission' ? 2 : 1)
            assert.equal(context.transaction.isCompleted(), write)
            if (transaction) assert.ok(includeProbe.queries.every(query => query.transaction === transaction))
          } finally { if (transaction && !transaction.isCompleted()) await transaction.rollback() }
          assert.equal((await fixture.api.resources.groups.get({ id: rootId })).data.attributes.name, 'Parent')
        })
      }
    }
  })
}

for (const strategy of ['standard', 'window']) {
  describe(`Nested collection limits after include batches (${strategy}, ${storageMode.mode})`, () => {
    let fixture
    before(async () => {
      fixture = await createFixture({ collectionInclude: { strategy, limit: 1, orderBy: ['id'] }, reversePolymorphicInclude: { limit: null } })
    })
    beforeEach(async () => { await fixture.reset(); await seedTree(fixture, 'belongsTo', 205) })
    after(async () => { await fixture?.close() })
    it('applies the nested collection limit across the complete parent set', async () => {
      const result = await fixture.api.resources.groups.get({ id: rootId, queryParams: { include: ['mentions.group.items'] } })
      const groups = result.included.filter(row => row.type === 'groups')
      assert.equal(groups.length, 205)
      for (const group of groups) assert.deepEqual(group.relationships.items.data, strategy === 'window' || group.id === '1' ? [{ type: 'items', id: group.id }] : [])
      assert.equal(result.data.relationships.mentions.data.length, 205)
    })
  })
}

describe(`Polymorphic batches across resource types (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createFixture() })
  beforeEach(async () => {
    await fixture.reset()
    await seedTree(fixture, 'polymorphic', 205)
    await seed(fixture, 'items', Array.from({ length: 205 }, (_, index) => ({
      id: String(index + 206),
      name: `Second type ${index}`,
      groupId: rootId,
      subjectType: 'items',
      subjectId: String(index + 1),
      active: true,
      score: 0
    })))
  })
  after(async () => { await fixture?.close() })
  it('keeps overlapping target IDs distinct and includes every target type', async () => {
    const includeProbe = probe()
    const result = await read(fixture, 'polymorphic', {}, { includeProbe })
    const items = result.included.filter(row => row.type === 'items')
    assert.equal(items.length, 410)
    assert.equal(result.included.filter(row => row.type === 'groups').length, 205)
    for (const item of items) {
      const id = Number(item.id)
      assert.deepEqual(item.relationships.subject.data, id <= 205 ? { type: 'groups', id: item.id } : { type: 'items', id: String(id - 205) })
    }
    assert.equal(includeProbe.queries.length, 6)
    for (const type of ['groups', 'items']) assert.equal(includeProbe.queries.filter(query => query.scopeName === type).length, 3)
  })
})

it('groups polymorphic IDs without changing first values, type keys or duplicate semantics', () => {
  const token = Symbol('type')
  const sharedId = {}
  const records = [
    { type: '__proto__', id: -0 }, { type: '__proto__', id: 0 },
    { type: 'constructor', id: NaN }, { type: 'constructor', id: NaN },
    { type: token, id: sharedId }, { type: token, id: sharedId },
    { type: 'toString', id: '1' }, { type: 'toString', id: 1 },
    { type: null, id: 1 }, { type: 'missing', id: null }
  ]
  const grouped = groupByPolymorphicType(records, 'type', 'id')
  assert.deepEqual(Reflect.ownKeys(grouped), ['__proto__', 'constructor', 'toString', token])
  const protoIds = Object.getOwnPropertyDescriptor(grouped, '__proto__').value
  assert.equal(protoIds.length, 1)
  assert.ok(Object.is(protoIds[0], -0))
  assert.deepEqual(grouped.constructor, [NaN])
  assert.deepEqual(grouped.toString, ['1', 1])
  assert.equal(grouped[token][0], sharedId)
  assert.equal(grouped[token].length, 1)
  assert.equal(Object.getPrototypeOf(grouped), Object.prototype)
})

if (storageMode.isAnyApi()) {
  describe('Canonical parent link batches', () => {
    let fixture
    const ids = Array.from({ length: 205 }, (_, index) => String(index + 1))
    before(async () => { fixture = await createFixture({ inverseMembership: true }) })
    beforeEach(async () => {
      await fixture.reset()
      await seedUnqueriedIdConformanceApi(fixture.knex, fixture.api, ['0', ...ids])
    })
    after(async () => { await fixture?.close() })
    const fetch = (scopeName, relName, parentIds, context = {}) => fixture.api.anyapi.links.fetchManyToManyRows({ scopeName, relName, parentIds, context })
    const measured = async operation => {
      const queries = []
      const capture = query => { if (/^select .* from ["`]any_links["`]/.test(query.sql)) queries.push(query) }
      fixture.knex.on('query', capture)
      try { return { rows: await operation(), queries } } finally { fixture.knex.off('query', capture) }
    }

    for (const [scopeName, relName, childType] of [['items', 'groups', 'groups'], ['groups', 'members', 'items']]) {
      it(`retains ${scopeName}.${relName} edges across every parent batch and the inverse direction`, async () => {
        const { rows, queries } = await measured(() => fetch(scopeName, relName, [...ids, ids[0], ids.at(-1)]))
        assert.deepEqual(rows.sort((a, b) => Number(a.parentId) - Number(b.parentId)), ids.map(id => ({ parentId: id, childId: id, childType })))
        assert.equal(queries.length, 3)
        assert.ok(queries.every(query => query.bindings.length <= 208))
      })
    }

    it('deduplicates 33,000 repeated parent IDs and avoids queries for empty input', async () => {
      const repeated = await measured(() => fetch('items', 'groups', Array(33000).fill('1')))
      assert.deepEqual(repeated.rows, [{ parentId: '1', childId: '1', childType: 'groups' }])
      assert.equal(repeated.queries.length, 1)
      assert.ok(repeated.queries[0].bindings.length <= 10)
      assert.deepEqual(await measured(() => fetch('items', 'groups', [])), { rows: [], queries: [] })
    })

    it('rejects a later SQL failure without returning partial rows or ending a borrowed transaction', async t => {
      const transaction = await fixture.knex.transaction()
      const failure = new RestApiValidationError('Later link batch failed')
      const original = transaction.client.query
      let calls = 0
      t.mock.method(transaction.client, 'query', function (connection, query) {
        if (/^select .* from ["`]any_links["`]/.test(query.sql) && ++calls === 2) throw failure
        return original.call(this, connection, query)
      })
      try {
        await assert.rejects(fetch('items', 'groups', ids, { transaction }), error => error === failure)
        assert.equal(calls, 2)
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
    })
  })
}
