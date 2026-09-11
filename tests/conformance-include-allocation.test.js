import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { loadIncludedParentMap } from '../plugins/core/lib/querying/include-query-helpers.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

for (const [strategy, limit] of [['standard', 20], ['window', 20], ['standard', 0], ['standard', null]]) {
  describe(`Limited include allocation, ${strategy}/${limit} (${storageMode.mode})`, () => {
    let fixture
    const calls = []
    const size = 205
    const parents = ['100000', '100001']
    const targets = Array.from({ length: size }, (_, i) => ({ id: String(i + 1), name: `${i === 0 ? 'Hidden' : 'Target'} ${String(i + 1).padStart(4, '0')}` }))
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' },
        apiOptions: {
          inverseMembership: true,
          collectionInclude: { limit: null },
          manyToManyInclude: { strategy, limit, orderBy: ['name'] },
          fieldCallback: (kind, type, value) => { calls.push(`${kind}:${type}:${value}`); return value },
          resourcePolicy: ({ query, context, column }) => {
            if (context.hideRows) query.whereNot(column('name'), 'like', 'Hidden%')
            return true
          }
        }
      })
    })
    const seed = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
    }
    beforeEach(async () => {
      await fixture.reset()
      await seed('groups', [...targets, { id: '100000', name: 'Root' }])
      await seed('items', parents.map(id => ({ id, name: 'Parent', groupId: '100000' })))
      const pairs = [...targets.map(({ id }) => ({ parent: parents[0], child: id })), ...targets.slice(100).map(({ id }) => ({ parent: parents[1], child: id }))]
      // Repeated physical edges must not change include limits or child counts.
      pairs.push(...Array.from({ length: 30 }, () => ({ parent: parents[0], child: '2' })))
      if (storageMode.isAnyApi()) {
        await fixture.api.anyapi.links.attachMany({ scopeName: 'items', relName: 'groups', relData: [{ type: 'groups', id: '1' }], context: { id: parents[0], db: fixture.knex } })
        const { id, ...template } = await fixture.knex('any_links').first()
        const parentColumn = template.left_resource === 'items' ? 'left_id' : 'right_id'
        const targetColumn = parentColumn === 'left_id' ? 'right_id' : 'left_id'
        await seedCanonicalLinkRows(fixture.knex, pairs.slice(1).map(({ parent, child }, index) => {
          const row = { ...template, [parentColumn]: parent, [targetColumn]: child }
          return index % 2 ? row : { ...row, relationship: row.inverse_relationship, inverse_relationship: row.relationship, left_resource: row.right_resource, left_id: row.right_id, right_resource: row.left_resource, right_id: row.left_id }
        }))
      } else await seed('memberships', pairs.map(({ parent, child }) => ({ itemId: parent, groupId: child })))
      calls.length = 0
    })
    after(async () => { await fixture?.close() })
    const expected = (parent, removed = []) => {
      const visible = targets.filter(({ id }) => id !== '1' && !removed.includes(id)).map(({ id }) => id)
      const belongs = id => parent === parents[0] || Number(id) >= 101
      const candidates = strategy === 'window' ? visible.filter(belongs) : visible
      return (limit === null ? candidates : candidates.slice(0, limit)).filter(belongs)
    }
    const measure = async operation => {
      const reads = []
      const capture = (rows, query) => {
        if (Array.isArray(rows) && /^select /i.test(query.sql)) reads.push({ rows: rows.length, sql: query.sql })
      }
      fixture.knex.on('query-response', capture)
      try { return { value: await operation(), reads } } finally { fixture.knex.off('query-response', capture) }
    }

    for (const format of ['jsonapi', 'plain']) {
      for (const method of ['get', 'query']) {
        for (const field of ['name', 'derivedName']) {
          it(`${method} ${format} ${field} reads only the limited visible membership and preserves callback counts`, async () => {
            const { value, reads } = await measure(() => fixture.api.resources.items[method]({
              id: parents[0], format, queryParams: { fields: { items: 'name,groups', groups: field }, include: ['groups'], sort: ['id'] }
            }, { hideRows: true }))
            const rows = method === 'query' ? value.data : [format === 'plain' ? value : value.data]
            assert.equal(rows.length, method === 'get' ? 1 : 2)
            for (const row of rows) {
              const children = format === 'plain' ? row.groups : row.relationships.groups.data
              assert.deepEqual(children.map(child => child.id), expected(row.id))
            }
            const selected = new Set(rows.flatMap(row => expected(row.id)))
            const count = selected.size
            if (format === 'jsonapi') assert.equal((value.included || []).length, count)
            const names = targets.filter(target => selected.has(target.id)).map(target => target.name)
            assert.deepEqual(calls.filter(call => call.startsWith('getter:groups:')).sort(), names.map(name => `getter:groups:${name}`).sort())
            assert.deepEqual(calls.filter(call => call.startsWith('computed:groups:')).sort(), field === 'derivedName' ? names.map(name => `computed:groups:${name}`).sort() : [])
            assert.ok(!calls.some(call => call.startsWith('setter:')), 'reads must not invoke setters')
            const included = format === 'jsonapi' ? value.included || [] : rows.flatMap(row => row.groups)
            for (const child of included) {
              const attributes = format === 'jsonapi' ? child.attributes : Object.fromEntries(Object.entries(child).filter(([key]) => key !== 'id'))
              assert.deepEqual(attributes, { [field]: targets.find(target => target.id === child.id).name })
            }
            assert.ok(reads.every(read => read.rows <= (limit === null ? size : 40)), JSON.stringify(reads.map(read => read.rows)))
            assert.ok(!reads.some(read => /^select ["`]id["`], ["`]relationship["`]/.test(read.sql)), 'explicit includes must not prefetch complete linkage')
            if (strategy === 'standard') {
              const mappings = reads.filter(read => read.sql.includes('included_links'))
              assert.ok(mappings.every(read => read.rows <= 101))
              if (limit !== null) assert.equal(mappings.length, count ? 1 : 0)
              else assert.ok(mappings.length >= 3 && mappings.length <= 5)
            }
          })
        }
      }
    }

    it('avoids preliminary linkage at nested include paths', async () => {
      const { value, reads } = await measure(() => fixture.api.resources.groups.get({
        id: '100000', format: 'jsonapi', queryParams: { fields: { groups: 'name,items', items: 'name,groups' }, include: ['items.groups'] }
      }, { hideRows: true }))
      const items = value.included.filter(row => row.type === 'items')
      assert.equal(items.length, 2)
      for (const row of items) assert.deepEqual(row.relationships.groups.data.map(child => child.id), expected(row.id))
      assert.ok(reads.every(read => read.rows <= (limit === null ? size : 40)), JSON.stringify(reads.map(read => read.rows)))
    })

    it('uses pending membership in a borrowed transaction without completing it', async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await fixture.api.resources.items.deleteRelationship({ id: parents[0], relationshipName: 'groups', relationshipData: [{ type: 'groups', id: '2' }], transaction })
        const value = await fixture.api.resources.items.get({ id: parents[0], transaction, queryParams: { fields: { items: 'groups', groups: 'name' }, include: ['groups'] } }, { hideRows: true })
        assert.deepEqual(value.data.relationships.groups.data.map(row => row.id), expected(parents[0], ['2']))
        assert.equal(transaction.isCompleted(), false)
      } finally { await unit.rollback() }
      const value = await fixture.api.resources.items.get({ id: parents[0], queryParams: { fields: { items: 'groups', groups: 'name' }, include: ['groups'] } }, { hideRows: true })
      assert.deepEqual(value.data.relationships.groups.data.map(row => row.id), expected(parents[0]))
    })

    if (strategy === 'standard' && limit === null) {
      for (const borrowed of [false, true]) {
        it(`propagates second mapping-batch failures during full PATCH (${borrowed ? 'borrowed' : 'owned'})`, async t => {
          const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
          const transaction = unit?.transaction
          const failure = new RestApiValidationError('Mapping batch failed')
          let attempts = 0; let observed
          await fixture.api.customize({
            hooks: {
              beforeDataCall: {
                functionName: 'included-mapping-failure',
                handler: ({ context }) => {
                  if (!context.injectMappingFailure || observed) return
                  observed = context.transaction
                  const query = observed.client.query
                  t.mock.method(observed.client, 'query', function (connection, statement) {
                    if (statement?.sql?.includes('included_links') && ++attempts === 2) throw failure
                    return query.call(this, connection, statement)
                  })
                }
              }
            }
          })
          try {
            await assert.rejects(fixture.api.resources.items.patch({
              id: parents[0],
              transaction,
              inputRecord: { data: { type: 'items', attributes: { name: 'Changed' } } },
              queryParams: { fields: { items: 'name,groups', groups: 'name' }, include: ['groups'] }
            }, { hideRows: true, injectMappingFailure: true }), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
            assert.equal(attempts, 2)
            assert.equal(observed.isCompleted(), !borrowed)
            const value = await fixture.api.resources.items.get({ id: parents[0], transaction, queryParams: { fields: { items: 'name' } } })
            assert.equal(value.data.attributes.name, borrowed ? 'Changed' : 'Parent')
            if (borrowed) assert.equal(transaction.isCompleted(), false)
          } finally { await unit?.rollback() }
          const value = await fixture.api.resources.items.get({ id: parents[0], queryParams: { fields: { items: 'name' } } })
          assert.equal(value.data.attributes.name, 'Parent')
        })
      }
    }
  })
}

describe(`Included parent-map batches (${storageMode.mode})`, () => {
  let fixture, adapter
  const ids = Array.from({ length: 205 }, (_, i) => String(i + 1))
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { idType: 'string', idColumnType: 'bigint' }, tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' } })
    adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
  })
  beforeEach(async () => {
    await fixture.reset()
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100)
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, batch.map(id => ({ id, name: 'Parent' })))
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, batch.map(id => ({ id, groupId: id, subjectId: '1', name: 'Child' })))
    }
  })
  after(async () => { await fixture?.close() })
  const fetch = async (parentIds, childIds, childField = 'id') => {
    const reads = []
    const capture = (rows, query) => { reads.push({ rows: rows.length, bindings: query.bindings.length }) }
    fixture.knex.on('query-response', capture)
    try {
      const map = await loadIncludedParentMap({ query: adapter.buildBaseQuery().select({ parentId: adapter.translateColumn('groupId'), childId: adapter.translateColumn(childField) }), parentIds, childIds, knex: fixture.knex })
      return { map, reads }
    } finally { fixture.knex.off('query-response', capture) }
  }

  it('bounds target batches without multiplying them by the number of parents', async () => {
    const { map, reads } = await fetch(ids, ids)
    assert.equal(map.size, ids.length)
    for (const id of ids) assert.deepEqual([...map.get(id)], [id])
    assert.equal(reads.length, 3)
    assert.equal(reads.reduce((total, read) => total + read.rows, 0), ids.length)
    assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 310))
  })

  it('pages complete parent/child pairs when one child has many parents', async () => {
    const { map, reads } = await fetch(ids, ['1'], 'subjectId')
    assert.deepEqual([...map.get('1')].sort(), [...ids].sort())
    assert.deepEqual(reads.map(read => read.rows), [101, 101, 3])
  })

  it('deduplicates 33,000 repeated inputs without changing their arrays', async () => {
    const repeated = Array(33000).fill('1')
    const { map, reads } = await fetch(repeated, repeated)
    assert.deepEqual([...map.entries()].map(([child, parents]) => [child, [...parents]]), [['1', ['1']]])
    assert.equal(reads.length, 1)
    assert.equal(reads[0].rows, 1)
    assert.equal(repeated.length, 33000)
    assert.ok(repeated.every(id => id === '1'))
  })

  it('does not query when either selection is empty', async () => {
    for (const [parents, children] of [[[], ids], [ids, []]]) {
      const { map, reads } = await fetch(parents, children)
      assert.equal(map.size, 0)
      assert.deepEqual(reads, [])
    }
  })

  it('keeps adjacent signed 64-bit child IDs distinct', async () => {
    const large = ['9223372036854775806', '9223372036854775807']
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, large.map(id => ({ id, name: 'Parent' })))
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, large.map(id => ({ id, groupId: id, name: 'Child' })))
    const { map } = await fetch(large, large)
    assert.equal(map.size, 2)
    for (const id of large) assert.deepEqual([...map.get(id)], [id])
  })
})
