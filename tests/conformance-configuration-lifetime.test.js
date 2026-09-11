import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSchema } from 'json-rest-schema'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { snapshotResourceConfiguration } from '../plugins/core/lib/querying-writing/schema-helpers.js'

for (const initiallySerialized of [false, true]) {
  describe(`Compiled configuration snapshot (${storageMode.mode}, serializer ${initiallySerialized})`, () => {
    let fixture, definition, enriched
    const serialize = value => `original:${value}`
    before(async () => {
      definition = { type: 'string', storage: { column: 'name', ...(initiallySerialized ? { serialize } : {}) } }
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          fields: { name: definition },
          hooks: {
            'schema:enrich': {
              functionName: 'capture-configuration',
              handler: ({ context }) => { enriched = context.fields }
            }
          }
        }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('detaches authored and hook-retained definitions while preserving compiled aliases', async () => {
      const resource = fixture.api.resources.items
      const info = resource.vars.schemaInfo
      assert.equal(info.schemaInstance.structure, info.schemaStructure)
      assert.equal(info.storageInfo.fields.name.definition, info.schemaStructure.name)
      assert.notEqual(info.schemaStructure.name.storage, definition.storage)
      assert.notEqual(info.schemaStructure.name.storage, enriched.name.storage)
      assert.equal(info.schemaStructure.name.storage.serialize, initiallySerialized ? serialize : undefined)
      definition.storage.column = 'authored_change'
      definition.storage.serialize = value => `authored:${value}`
      enriched.name.storage.column = 'hook_change'
      enriched.name.storage.serialize = value => `hook:${value}`
      enriched.name.required = true
      const created = await fixture.seed('items', { name: 'after' })
      const expected = initiallySerialized ? 'original:after' : 'after'
      assert.equal(created.attributes.name, expected)
      assert.equal(resource.vars.storageAdapter.translateFilterValue('name', 'after'), expected)
      assert.equal(info.schemaStructure.name.storage.column, 'name')
      assert.equal(info.schemaStructure.name.required, undefined)
      assert.equal(Object.isFrozen(definition.storage), false)
    })
  })
}

describe('Declaration snapshot values', () => {
  it('retains file backend handles but copies file column mapping declarations', () => {
    const backend = { async upload () {}, async delete () {} }
    const mapping = { column: 'file_url' }
    const original = {
      uploaded: { type: 'file', storage: backend, accepts: ['image/png'] },
      stored: { type: 'file', storage: mapping }
    }
    const copy = snapshotResourceConfiguration(original)
    assert.equal(copy.uploaded.storage, backend)
    assert.notEqual(copy.uploaded.accepts, original.uploaded.accepts)
    assert.notEqual(copy.stored.storage, mapping)
    mapping.column = 'changed'
    assert.equal(copy.stored.storage.column, 'file_url')
  })

  it('preserves callback and opaque object identity while detaching cyclic declaration data', () => {
    class Service {}
    const service = new Service()
    const callback = value => value
    const original = { callback, service, date: new Date('2020-01-01'), pattern: /item/g, values: ['one'] }
    original.self = original
    original.shared = original.values
    const copy = snapshotResourceConfiguration(original)
    assert.equal(copy.self, copy)
    assert.equal(copy.values, copy.shared)
    assert.equal(copy.callback, callback)
    assert.equal(copy.service, service)
    assert.equal(Object.isFrozen(service), false)
    original.values.push('two')
    original.date.setUTCFullYear(2021)
    original.pattern.lastIndex = 4
    assert.deepEqual(copy.values, ['one'])
    assert.equal(copy.date.getUTCFullYear(), 2020)
    assert.equal(copy.pattern.lastIndex, 0)
  })

  it('copies nested schema definitions and retains custom type handlers', async () => {
    const factory = createSchema.createFactory()
    factory.addType('upperText', ({ value }) => value.toUpperCase())
    const nested = factory({ value: { type: 'upperText', required: true } })
    const copy = snapshotResourceConfiguration({ nested, same: nested })
    assert.equal(copy.nested, copy.same)
    assert.notEqual(copy.nested, nested)
    nested.structure.value.required = false
    assert.equal(copy.nested.structure.value.required, true)
    assert.deepEqual(await copy.nested.create({ value: 'hello' }), { validatedObject: { value: 'HELLO' }, errors: {} })
  })
})

if (storageMode.mode === 'anyapi') {
  describe('Canonical recompilation input ownership', () => {
    let fixture, original
    const serialize = value => `original:${value}`
    before(async () => {
      original = { type: 'string', storage: { serialize } }
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { fields: { name: original } }
      })
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())

    it('recompiles from owned declarations after initial and later field additions', async () => {
      const resource = fixture.api.resources.items
      original.storage.serialize = value => `mutated:${value}`
      const extra = { type: 'string', storage: { serialize } }
      await resource.addKnexFields({ fields: { extra } })
      let result = await fixture.seed('items', { name: 'first', extra: 'first' })
      assert.equal(result.attributes.name, 'original:first')
      assert.equal(result.attributes.extra, 'original:first')
      extra.storage.serialize = value => `mutated:${value}`
      await resource.addKnexFields({ fields: { another: { type: 'string' } } })
      result = await fixture.seed('items', { name: 'second', extra: 'second', another: 'added' })
      assert.equal(result.attributes.name, 'original:second')
      assert.equal(result.attributes.extra, 'original:second')
      assert.equal(result.attributes.another, 'added')
    })
  })
}

describe(`Sort configuration ownership (${storageMode.mode})`, () => {
  let fixture, defaultSort, sortableFields
  before(async () => {
    defaultSort = ['name']
    sortableFields = ['name']
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: { resourceOptions: { defaultSort, sortableFields } }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())

  it('detaches authored sort arrays and retains explicit runtime variable overrides', async () => {
    const resource = fixture.api.resources.items
    await fixture.seed('items', { name: 'a' })
    await fixture.seed('items', { name: 'b' })
    const names = async () => (await resource.query()).data.map(item => item.attributes.name)
    defaultSort[0] = '-name'
    sortableFields.length = 0
    assert.deepEqual(await names(), ['a', 'b'])
    assert.deepEqual(resource.vars.sortableFields, ['name'])
    resource.vars.defaultSort = ['-name']
    assert.deepEqual(await names(), ['b', 'a'])
  })
})

describe(`Runtime customization and compiled cache ownership (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: { resourceOptions: { sortableFields: ['name', 'amount'] } }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await fixture.api.customize({ vars: { format: 'jsonapi', queryDefaultLimit: 20 } })
    fixture.api.resources.items.vars.sortableFields = ['name', 'amount']
    await fixture.seed('items', { name: 'a', amount: 'second' })
    await fixture.seed('items', { name: 'b', amount: 'first' })
  })
  after(async () => fixture?.close())

  it('observes new defaults and hooks on the next call without recompiling fields', async () => {
    const resource = fixture.api.resources.items
    const schemaInfo = resource.vars.schemaInfo
    assert.equal((await resource.query()).data.length, 2)
    const contracts = schemaInfo.requestContracts
    let calls = 0
    await fixture.api.customize({
      vars: { format: 'plain', queryDefaultLimit: 1 },
      hooks: {
        beforeDataQuery: {
          functionName: 'observe-runtime-customization',
          handler: () => { calls++ }
        }
      }
    })
    const result = await resource.query()
    assert.equal(result.data.length, 1)
    assert.equal(typeof result.data[0].name, 'string')
    assert.equal(Object.hasOwn(result.data[0], 'attributes'), false)
    assert.equal(calls, 1)
    const explicit = await resource.query({ format: 'jsonapi', queryParams: { page: { size: 2 } } })
    assert.equal(explicit.data.length, 2)
    assert.equal(typeof explicit.data[0].attributes.name, 'string')
    assert.equal(calls, 2)
    assert.equal(resource.vars.schemaInfo, schemaInfo)
    assert.equal(schemaInfo.requestContracts, contracts)
  })

  it('refreshes sort validation while retaining the unchanged storage adapter', async () => {
    const resource = fixture.api.resources.items
    const schemaInfo = resource.vars.schemaInfo
    const query = () => resource.query({ queryParams: { sort: ['amount'] } })
    assert.deepEqual((await query()).data.map(item => item.attributes.name), ['b', 'a'])
    const contracts = schemaInfo.requestContracts
    const adapter = fixture.api.helpers.getStorageAdapter('items')
    resource.vars.sortableFields = ['name']
    await assert.rejects(query(), { code: 'REST_API_VALIDATION' })
    const restricted = schemaInfo.requestContracts
    assert.notEqual(restricted, contracts)
    resource.vars.sortableFields = ['amount', 'name']
    assert.deepEqual((await query()).data.map(item => item.attributes.name), ['b', 'a'])
    assert.notEqual(schemaInfo.requestContracts, restricted)
    assert.equal(fixture.api.helpers.getStorageAdapter('items'), adapter)
    assert.equal(resource.vars.schemaInfo, schemaInfo)
  })
})

describe(`Enrichment original definitions (${storageMode.mode})`, () => {
  let fixture, originalAttribute, originalSearch, originalComputed
  const serialize = value => `authored:${value}`
  const enrichedSerialize = value => `enriched:${value}`
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        fields: {
          name: { type: 'string', storage: { serialize } },
          summary: { type: 'string', computed: true, dependencies: ['name'], compute: ({ attributes }) => `${attributes.name}/${attributes.amount}` }
        },
        searchSchema: { lookup: { type: 'string', oneOf: ['name'] } },
        hooks: {
          'schema:enrich': {
            functionName: 'enrich-storage-with-original-input',
            handler: ({ context }) => {
              context.fields.name.storage.serialize = enrichedSerialize
              originalAttribute = context.originalFields.name.storage.serialize
            }
          },
          'searchSchema:enrich': {
            functionName: 'enrich-search-with-original-input',
            handler: ({ context }) => {
              context.fields.lookup.oneOf.push('amount')
              originalSearch = [...context.originalFields.lookup.oneOf]
            }
          },
          'computedSchema:enrich': {
            functionName: 'enrich-computed-with-original-input',
            handler: ({ context }) => {
              context.fields.summary.dependencies.push('amount')
              originalComputed = [...context.originalFields.summary.dependencies]
            }
          }
        }
      }
    })
  })
  beforeEach(async () => fixture.reset())
  after(async () => fixture?.close())

  it('keeps original nested metadata separate from mutable enrichment fields', async () => {
    assert.equal(originalAttribute, serialize)
    assert.deepEqual(originalSearch, ['name'])
    assert.deepEqual(originalComputed, ['name'])
    const created = await fixture.seed('items', { name: 'name', amount: 'amount' })
    assert.equal(created.attributes.name, 'enriched:name')
    assert.equal(created.attributes.summary, 'enriched:name/amount')
  })
})
