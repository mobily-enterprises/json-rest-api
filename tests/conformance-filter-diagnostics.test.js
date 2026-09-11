import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { basicFiltersHook } from '../plugins/core/lib/querying/knex-query-helpers.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Filter diagnostic payloads (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        fields: { name: { type: 'string', hidden: true } },
        searchSchema: { name: { type: 'string', default: 'PRIVATE_SCHEMA_DEFAULT' } }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('omits filter values and schema definitions while retaining executable bindings', async () => {
    const secret = 'PRIVATE_FILTER_VALUE'
    await fixture.seed('items', { name: secret })
    const schemaInfo = fixture.api.resources.items.vars.schemaInfo
    const adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo })
    const query = adapter.buildBaseQuery({ tableAlias: schemaInfo.tableName })
    const logs = []
    await basicFiltersHook({
      context: {
        knexQuery: {
          scopeName: 'items',
          tableName: schemaInfo.tableName,
          db: fixture.knex,
          storageAdapter: adapter,
          query,
          filters: { name: secret }
        }
      }
    }, {
      knex: fixture.knex,
      scopes: fixture.api.resources,
      log: { trace: (...args) => logs.push(args) }
    })
    assert.ok(query.toSQL().bindings.includes(secret))
    assert.equal((await query).length, 1)
    assert.ok(logs.length > 0)
    assert.ok(!JSON.stringify(logs).includes(secret))
    assert.ok(!JSON.stringify(logs).includes('PRIVATE_SCHEMA_DEFAULT'))
    assert.match(JSON.stringify(logs), /name/)
  })
})
