import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const tables = { items: 'schema_enrichment_items' }

describe(`Version field configuration (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: { fields: { revision: { type: 'string', hidden: true } }, resourceOptions: { versionField: 'revision' } }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('publishes the explicit version field without changing its visibility', () => {
    const info = fixture.api.resources.items.vars.schemaInfo
    assert.equal(info.versionField, 'revision')
    assert.equal(info.outputFields.revision.hidden, true)
  })
})

for (const [name, versionField, fields] of [
  ['empty', '', {}],
  ['non-string', 1, {}],
  ['missing', 'revision', {}],
  ['numeric', 'revision', { revision: { type: 'number' } }],
  ['computed', 'revision', { revision: { type: 'string', computed: true, compute: () => 'x' } }],
  ['virtual', 'revision', { revision: { type: 'string', virtual: true } }],
  ['getter', 'revision', { revision: { type: 'string', getter: value => value } }],
  ['setter', 'revision', { revision: { type: 'string', setter: value => value } }],
  ['serializer', 'revision', { revision: { type: 'string', storage: { serialize: value => value } } }],
  ['relationship', 'revision', { revision: { type: 'string', belongsTo: 'items', as: 'parent' } }],
  ['primary ID', 'id', { id: { type: 'string' } }]
]) {
  it(`rejects ${name} version field configuration (${storageMode.mode})`, async () => {
    let fixture
    try {
      await assert.rejects(async () => {
        fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { fields, resourceOptions: { versionField } } })
      }, /versionField/)
    } finally { await fixture?.close() }
  })
}
