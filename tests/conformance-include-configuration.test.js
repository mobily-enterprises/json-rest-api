import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { items: 'schema_enrichment_items' }
const options = include => ({
  fields: { parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true } },
  resourceOptions: { relationships: { children: { type: 'hasMany', target: 'items', foreignKey: 'parentId', include } } }
})
const create = apiOptions => createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions })
const rejected = async (apiOptions, expected) => {
  let fixture
  try { await assert.rejects(async () => { fixture = await create(apiOptions) }, expected) } finally { await fixture?.close() }
}

describe(`Compiled include configuration (${storageMode.mode})`, () => {
  it('uses an explicit resource maximum before validating include limits', async () => {
    const config = options({ limit: 1500 })
    config.resourceOptions.queryMaxLimit = 2000
    let fixture
    try { fixture = await create(config) } finally { await fixture?.close() }
  })
  it('checks enriched limits against an explicit lower resource maximum', async () => {
    const config = options({ limit: 10 })
    config.resourceOptions.queryDefaultLimit = 5
    config.resourceOptions.queryMaxLimit = 20
    config.hooks = {
      'computedSchema:enrich': {
        functionName: 'raise-include-limit',
        handler: ({ context }) => { context.schemaRelationships.children.include.limit = 30 }
      }
    }
    await rejected(config, /exceeds queryMaxLimit/)
  })
  for (const limit of [-1, 0.5, NaN, '']) {
    it(`rejects invalid include limit ${String(limit)}`, async () => {
      await rejected(options({ limit }), /non-negative integer/)
    })
  }
  it('rejects invalid include sort entries during compilation', async () => {
    await rejected(options({ orderBy: [3] }), /sort must be a string or an array of strings/)
  })
  for (const limit of [0, null, false]) {
    it(`accepts the supported include limit ${String(limit)}`, async () => {
      let fixture
      try { fixture = await create(options({ limit })) } finally { await fixture?.close() }
    })
  }
})

if (storageMode.mode === 'anyapi') {
  describe('Include validation before canonical publication', () => {
    let fixture, invalid
    before(async () => {
      invalid = false
      const config = options({ limit: 10 })
      config.resourceOptions.queryDefaultLimit = 5
      config.resourceOptions.queryMaxLimit = 20
      config.hooks = {
        'computedSchema:enrich': {
          functionName: 'conditionally-invalid-include-limit',
          handler: ({ context }) => { if (invalid) context.schemaRelationships.children.include.limit = 30 }
        }
      }
      fixture = await create(config)
    })
    beforeEach(async () => fixture.reset())
    after(async () => fixture?.close())
    it('keeps the previous owner and descriptor when a candidate limit is invalid', async () => {
      const resource = fixture.api.resources.items
      const original = resource.vars.schemaInfo
      const record = await fixture.seed('items', { name: 'Existing' })
      invalid = true
      try {
        await assert.rejects(resource.addKnexFields({ fields: { rejected: { type: 'string', nullable: true } } }), /exceeds queryMaxLimit/)
      } finally { invalid = false }
      assert.equal(resource.vars.schemaInfo, original)
      assert.equal(original.schemaRelationships.children.include.limit, 10)
      const descriptor = await fixture.api.anyapi.registry.getDescriptor(fixture.api.anyapi.tenantId, 'items')
      assert.equal(Object.hasOwn(descriptor.fields, 'rejected'), false)
      const result = await resource.get({ id: record.id, queryParams: { include: ['children'] } })
      assert.equal(result.data.attributes.name, 'Existing')
    })
  })
}
