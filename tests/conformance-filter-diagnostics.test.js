import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'
import { basicFiltersHook } from '../plugins/core/lib/querying/knex-query-helpers.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Filter diagnostic payloads (${storageMode.mode})`, () => {
  let fixture
  const events = []
  const capture = (...args) => events.push(args)
  const longFilter = `filter_${'x'.repeat(65536)}`
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        logging: { logger: { trace: capture, debug: capture, info: capture, warn: capture, error: capture } },
        fields: { name: { type: 'string', hidden: true } },
        searchSchema: {
          name: { type: 'string', default: 'PRIVATE_SCHEMA_DEFAULT' },
          [longFilter]: { type: 'string', actualField: 'name' }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset(); events.length = 0 })
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

  it('bounds storage-owned query diagnostics without changing the query or exposing hidden values', async () => {
    const secret = 'PRIVATE_FILTER_VALUE'
    const item = await fixture.seed('items', { name: secret })
    events.length = 0
    const filters = { name: secret, [longFilter]: secret }
    const result = await fixture.api.resources.items.query({ queryParams: { filters }, format: 'jsonapi' })
    assert.deepEqual(result.data.map(row => row.id), [item.id])
    assert.equal(filters[longFilter], secret)
    assert.ok(events.some(args => String(args[0]).includes('basicFiltersHook')))
    for (const args of events) {
      const event = JSON.stringify(args)
      assert.ok(event.length < 20000, 'one diagnostic event must use the shared preview budget')
      assert.ok(!event.includes(longFilter))
      assert.ok(!event.includes(secret))
      assert.ok(!event.includes('PRIVATE_SCHEMA_DEFAULT'))
    }
  })
})

if (!storageMode.isAnyApi()) {
  describe('Ordinary query warning boundaries', () => {
    let fixture, restrictSort, warningFailure
    const calls = []
    before(async () => {
      fixture = await createConformanceFixture({
        apiOptions: {
          logging: {
            logger: {
              warn: (...args) => {
                calls.push(args)
                if (warningFailure === 'throw') throw new Error('Warning writer failed')
                if (warningFailure === 'reject') return Promise.reject(new Error('Warning writer failed'))
              }
            }
          },
          groupOptions: { relationships: { firstItem: { type: 'hasOne', target: 'items', foreignKey: 'groupId' } } }
        }
      })
      await fixture.api.customize({
        hooks: {
          beforeDataQuery: {
            functionName: 'restrict-diagnostic-sort',
            handler: ({ context }) => {
              if (restrictSort) {
                context.sortableFields = ['id']
                context.queryParams.sort = ['name']
              }
            }
          }
        }
      })
    })
    beforeEach(async () => { await fixture.reset(); calls.length = 0; restrictSort = false; warningFailure = undefined })
    after(async () => { await fixture?.close() })

    it('reports duplicate hasOne matches without putting the parent identifier in diagnostics', async () => {
      const group = (await fixture.api.resources.groups.post({
        format: 'jsonapi', document: { data: { type: 'groups', id: '910001', attributes: { name: 'Group' } } }
      })).data
      const first = await fixture.seed('items', { name: 'First' }, { group: { data: { type: 'groups', id: group.id } } })
      const second = await fixture.seed('items', { name: 'Second' }, { group: { data: { type: 'groups', id: group.id } } })
      const result = await fixture.api.resources.groups.query({ format: 'jsonapi', queryParams: { include: ['firstItem'] } })
      assert.equal(result.data.length, 1)
      assert.ok([first.id, second.id].includes(result.data[0].relationships.firstItem.data.id))
      const diagnostic = calls.find(([message]) => message.includes('Multiple records found for hasOne'))?.[1]
      assert.deepEqual(diagnostic, {
        method: 'query',
        scopeName: 'groups',
        phase: 'include',
        backend: fixture.knex.client.config.client,
        transactionOutcome: 'none',
        includeName: 'firstItem',
        foreignKey: 'groupId'
      })
      assert.doesNotMatch(JSON.stringify(calls), /910001/)
    })

    for (const writer of ['none', 'throw', 'reject']) {
      it(`retains a skipped internal sort with ${writer} warning writer`, async () => {
        const item = await fixture.seed('items', { name: 'Item' })
        restrictSort = true
        warningFailure = writer
        const result = await fixture.api.resources.items.query({ format: 'jsonapi' })
        assert.deepEqual(result.data.map(record => record.id), [item.id])
        const diagnostic = calls.find(([message]) => message === 'Ignoring non-sortable field')?.[1]
        assert.deepEqual(diagnostic, {
          method: 'query',
          scopeName: 'items',
          phase: 'querySort',
          backend: fixture.knex.client.config.client,
          transactionOutcome: 'none',
          field: 'name'
        })
      })
    }
  })
}
