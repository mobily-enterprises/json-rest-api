import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Resource route transaction participation (${storageMode.mode})`, () => {
  let fixture, item
  const routes = new Map()
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        hooks: {
          addRoute: {
            functionName: 'capture-resource-transaction-routes',
            handler: ({ context }) => {
              if (context.routeMeta?.kind === 'resource') routes.set(context.routeMeta.operation, context.handler)
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    item = await fixture.seed('items', { name: 'Original' })
  })
  after(async () => { await fixture?.close() })
  const call = (operation, transaction, body) => routes.get(operation)({
    params: { id: item.id }, queryString: '', headers: {}, context: {}, transaction, body
  })

  for (const operation of ['patch', 'put', 'delete']) {
    it(`${operation} and the following GET share the owner and roll back together`, async () => {
      const rollback = new Error('Caller rollback')
      await assert.rejects(fixture.api.transaction(async transaction => {
        await call(operation, transaction, { data: { type: 'items', id: item.id, attributes: { name: 'Provisional' } } })
        assert.equal(transaction.isCompleted(), false)
        if (operation === 'delete') {
          await assert.rejects(call('get', transaction), error => error.subtype === 'not_found')
        } else {
          assert.equal((await call('get', transaction)).data.attributes.name, 'Provisional')
          const collection = await call('query', transaction)
          assert.equal(collection.data[0].attributes.name, 'Provisional')
        }
        throw rollback
      }), error => error.cause === rollback)
      assert.equal((await call('get')).data.attributes.name, 'Original')
    })
  }

  it('commits POST only when its caller completes', async () => {
    await fixture.api.transaction(async transaction => {
      await call('post', transaction, { data: { type: 'items', id: '99', attributes: { name: 'Created' } } })
      assert.equal(transaction.isCompleted(), false)
      assert.equal((await call('query', transaction)).data.length, 2)
    })
    assert.equal((await call('query')).data.length, 2)
  })
})
