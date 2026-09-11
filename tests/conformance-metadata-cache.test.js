import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getRequestContracts, validateRequestContractOrThrow } from '../plugins/core/lib/querying-writing/request-contracts.js'
import { normalizeAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }

describe(`Request contract reuse (${storageMode.mode})`, () => {
  let fixture, schemaInfo
  before(async () => { fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables }) })
  beforeEach(async () => {
    await fixture.reset()
    schemaInfo = fixture.api.resources.items.vars.schemaInfo
    delete schemaInfo.requestContracts
    delete schemaInfo.requestContractsCacheKey
  })
  after(async () => { await fixture?.close() })
  const contracts = extra => getRequestContracts({ scopeName: 'items', schemaInfo, includeDepthLimit: 3, sortableFields: ['id', 'name'], ...extra })

  it('builds write contracts from compiled relationship membership and definitions', () => {
    const indexed = new Proxy({ ...schemaInfo, requestContracts: undefined, requestContractsCacheKey: undefined }, {
      get (target, key, receiver) {
        if (key === 'schemaRelationships') throw new Error('Relationship declarations read while building contracts')
        return Reflect.get(target, key, receiver)
      }
    })
    const contract = getRequestContracts({ scopeName: 'items', schemaInfo: indexed }).post
    const input = (group, subject) => ({
      data: {
        type: 'items',
        attributes: { name: 'Item' },
        relationships: { group: { data: group }, subject: { data: subject } }
      }
    })
    const valid = input({ type: 'groups', id: '1' }, { type: 'groups', id: '2' })
    assert.deepEqual(validateRequestContractOrThrow(contract, valid).data.relationships, valid.data.relationships)
    assert.throws(() => validateRequestContractOrThrow(contract, input([], null)), { code: 'REST_API_VALIDATION' })
    assert.throws(() => validateRequestContractOrThrow(contract, input({ type: 'items', id: '1' }, null)), { code: 'REST_API_VALIDATION' })
    assert.throws(() => validateRequestContractOrThrow(contract, input(null, { type: 'unknown', id: '1' })), { code: 'REST_API_VALIDATION' })
    assert.deepEqual(validateRequestContractOrThrow(contract, input(null, null)).data.relationships, { group: { data: null }, subject: { data: null } })
  })

  it('uses the belongs-to resource when a definition also carries target metadata', () => {
    const indexed = {
      ...schemaInfo,
      requestContracts: undefined,
      requestContractsCacheKey: undefined,
      outputRelationships: {
        ...schemaInfo.outputRelationships,
        group: { ...schemaInfo.outputRelationships.group, target: 'items' }
      }
    }
    const contract = getRequestContracts({ scopeName: 'items', schemaInfo: indexed }).post
    const input = type => ({
      data: {
        type: 'items',
        attributes: { name: 'Item' },
        relationships: { group: { data: { type, id: '1' } } }
      }
    })
    assert.equal(validateRequestContractOrThrow(contract, input('groups')).data.relationships.group.data.type, 'groups')
    assert.throws(() => validateRequestContractOrThrow(contract, input('items')), { code: 'REST_API_VALIDATION' })
  })

  it('reuses one compiled contract set across values and equivalent sort declarations', () => {
    const first = contracts()
    for (let index = 0; index < 100; index++) {
      const next = contracts({ sortableFields: index % 2 ? ['name', 'id'] : ['id', 'name'] })
      assert.equal(next, first)
      const payload = { data: { type: 'items', id: String(index), attributes: { name: `Item ${index}` } } }
      assert.equal(validateRequestContractOrThrow(next.post, payload).data.id, String(index))
    }
  })

  it('includes the resource name when reusing the same compiled field definitions', () => {
    const first = contracts()
    const other = contracts({ scopeName: 'other_items' })
    assert.notEqual(other, first)
    const payload = { data: { type: 'other_items', id: '1', attributes: { name: 'Other item' } } }
    assert.equal(validateRequestContractOrThrow(other.post, payload).data.type, 'other_items')
    assert.throws(() => validateRequestContractOrThrow(other.post, { data: { ...payload.data, type: 'items' } }), { code: 'REST_API_VALIDATION' })
    assert.equal(validateRequestContractOrThrow(contracts().post, { data: { ...payload.data, type: 'items' } }).data.type, 'items')
  })

  it('replaces the retained variant when include depth or sortable fields change', () => {
    const original = contracts()
    const narrow = contracts({ includeDepthLimit: 1, sortableFields: ['id'] })
    assert.notEqual(narrow, original)
    assert.throws(() => validateRequestContractOrThrow(narrow.query, { queryParams: { sort: ['name'] } }), { code: 'REST_API_VALIDATION' })
    assert.throws(() => validateRequestContractOrThrow(narrow.get, { id: '1', queryParams: { include: ['group.items'] } }), { code: 'REST_API_VALIDATION' })
    assert.equal(schemaInfo.requestContracts, narrow)
    assert.equal(contracts({ includeDepthLimit: 1, sortableFields: ['id'] }), narrow)
    const restored = contracts()
    assert.notEqual(restored, narrow)
    assert.equal(schemaInfo.requestContracts, restored)
    assert.deepEqual(validateRequestContractOrThrow(restored.query, { queryParams: { sort: ['name'] } }).queryParams.sort, ['name'])
  })
})

// Registry metadata always uses canonical storage, including the ordinary-mode job.
describe('Bounded registry descriptor retention', () => {
  let fixture, registry
  const schema = { id: { type: 'id' }, name: { type: 'string' } }
  const definitions = Array.from({ length: 130 }, (_, index) => ({
    tenant: `metadata_${Math.floor(index / 10)}`, resource: `resource_${index % 10}`, schema
  }))
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'anyapi', createApi: createIdConformanceApi, tables })
    registry = fixture.api.anyapi.registry
    for (const definition of definitions) await registry.registerResource(definition)
  })
  beforeEach(async () => { await fixture.reset(); registry.cache.clear() })
  after(async () => { await fixture?.close() })
  const load = (index, options) => registry.getDescriptor(definitions[index].tenant, definitions[index].resource, options)
  const fill = async count => { for (let index = 0; index < count; index++) await load(index) }
  const measured = async operation => {
    const queries = []
    const capture = query => queries.push(query)
    fixture.knex.on('query', capture)
    try { return { result: await operation(), queries } } finally { fixture.knex.off('query', capture) }
  }

  it('retains at most 100 descriptors while reading more tenant/resource pairs', async () => {
    for (let index = 0; index < definitions.length; index++) {
      const descriptor = await load(index)
      assert.equal(descriptor.tenant, definitions[index].tenant)
      assert.equal(descriptor.resource, definitions[index].resource)
      assert.ok(registry.cache.size <= 100)
    }
    assert.equal(registry.cache.size, 100)
    assert.equal((await measured(() => load(129))).queries.length, 0)
    const reloaded = await measured(() => load(0))
    assert.equal(reloaded.queries.length, 3)
    assert.equal(reloaded.result.tenant, definitions[0].tenant)
    assert.equal(registry.cache.size, 100)
  })

  it('keeps recently read entries and clones returned metadata', async () => {
    await fill(100)
    const first = await load(0)
    first.schema.name.type = 'number'
    for (let index = 100; index < 130; index++) await load(index)
    const hot = await measured(() => load(0))
    assert.equal(hot.queries.length, 0)
    assert.equal(hot.result.schema.name.type, 'string')
    assert.equal((await measured(() => load(1))).queries.length, 3)
    assert.equal(registry.cache.size, 100)
  })

  it('bounds publication through registration and field allocation too', async () => {
    await fill(100)
    const definition = { tenant: 'metadata_written', resource: 'items', schema }
    const registered = await registry.registerResource(definition)
    assert.equal(registry.cache.size, 100)
    const published = await measured(() => registry.getDescriptor(definition.tenant, definition.resource))
    assert.equal(published.queries.length, 0)
    assert.deepEqual(published.result, registered)
    const { tenant, resource } = definitions[120]
    const allocated = await registry.allocateField({ tenant, resource, fieldName: 'cacheMarker', definition: { type: 'string' } })
    assert.equal(allocated.schema.cacheMarker.type, 'string')
    assert.equal(registry.cache.size, 100)
    const warm = await measured(() => load(120))
    assert.equal(warm.queries.length, 0)
    assert.deepEqual(warm.result, allocated)
  })

  it('retains explicit invalidation and refresh without growing the cache', async () => {
    await fill(100)
    registry.invalidateDescriptor(definitions[0].tenant, definitions[0].resource)
    assert.equal(registry.cache.size, 99)
    assert.ok((await measured(() => load(0))).queries.length > 0)
    assert.ok((await measured(() => load(1, { bypassCache: true }))).queries.length > 0)
    assert.equal(registry.cache.size, 100)
    assert.equal((await measured(() => load(1))).queries.length, 0)
  })

  it('does not publish or reorder committed metadata through a borrowed transaction', async () => {
    await fill(100)
    const before = [...registry.cache.entries()]
    const unit = await holdManagedTransaction(fixture.api)
    const transaction = unit.transaction
    try {
      await load(0, { transaction })
      await load(129, { transaction })
      await registry.registerResource({ tenant: 'metadata_pending', resource: 'items', schema }, { transaction })
      await transaction('any_resource_configs').where({ tenant_id: definitions[0].tenant, resource: definitions[0].resource }).delete()
      assert.equal(await load(0, { transaction }), null)
      assert.deepEqual([...registry.cache.entries()], before)
      assert.equal(transaction.isCompleted(), false)
    } finally { await unit.rollback() }
    assert.equal(await registry.getDescriptor('metadata_pending', 'items'), null)
    assert.deepEqual([...registry.cache.entries()], before)
  })

  it('keeps published resource operations independent of registry eviction', async () => {
    const descriptor = fixture.api.resources.items.vars.schemaInfo.descriptor
    await fill(130)
    assert.equal(registry.cache.has(JSON.stringify(['conformance', 'items'])), false)
    const { result, queries } = await measured(() => fixture.seed('items', { name: 'After eviction' }))
    assert.equal(result.attributes.name, 'After eviction')
    assert.equal(fixture.api.resources.items.vars.schemaInfo.descriptor, descriptor)
    assert.equal(queries.filter(({ sql }) => /any_(?:resource|field|relationship)_configs/.test(sql)).length, 0)
  })

  it('does not retain negative lookups', async () => {
    await fill(100)
    const before = [...registry.cache.keys()]
    for (let index = 0; index < 110; index++) assert.equal(await registry.getDescriptor('missing', `resource_${index}`), null)
    assert.deepEqual([...registry.cache.keys()], before)
  })

  it('discards a cached descriptor when an explicit refresh confirms its removal', async () => {
    const definition = definitions[129]
    await load(129)
    try {
      await fixture.knex('any_resource_configs').where({ tenant_id: definition.tenant, resource: definition.resource }).delete()
      assert.equal(await load(129, { bypassCache: true }), null)
      assert.equal(await load(129), null)
      assert.equal(registry.cache.size, 0)
    } finally { await registry.registerResource(definition) }
  })
})

describe('Temporal contract reuse boundaries', () => {
  for (const type of ['dateTime', 'time']) {
    it(`preserves ${type} validation for common and unusual precision`, () => {
      const prefix = type === 'dateTime' ? '2024-02-29T12:34:56' : '12:34:56'
      const suffix = type === 'dateTime' ? 'Z' : ''
      const fraction = '123456789'
      const value = `${prefix}.${fraction}${suffix}`
      for (let repeat = 0; repeat < 2; repeat++) {
        for (const temporalPrecision of [0, 3, 6, 7, 9, 50, 10000]) {
          const digits = type === 'time' ? fraction.slice(0, temporalPrecision).padEnd(temporalPrecision, '0') : fraction.slice(0, temporalPrecision)
          const expected = `${prefix}${temporalPrecision ? `.${digits}` : ''}${suffix}`
          assert.deepEqual(normalizeAttributes({ at: value }, { at: { type, temporalPrecision } }), { at: expected })
          assert.throws(() => normalizeAttributes({ at: 'invalid' }, { at: { type, temporalPrecision } }), { code: 'REST_API_TEMPORAL_DATA_INVALID' })
        }
        assert.deepEqual(normalizeAttributes({ at: value }, { at: { type } }), { at: value })
      }
    })
  }
})
