import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'

let fixture
let afterDataCallIds
before(async () => {
  fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { idType: 'string', idColumnType: 'bigint' } })
  await fixture.api.customize({
    hooks: { afterDataCallPost: { functionName: 'observe-storage-id', handler: ({ context }) => { afterDataCallIds.push(context.id) } } }
  })
})
beforeEach(async () => { afterDataCallIds = []; await fixture.reset() })
after(async () => { await fixture?.close() })

for (const [label, returnedId] of [
  ['undefined', undefined], ['null', null], ['object', { id: '1' }],
  ['empty string', ''], ['whitespace', ' '], ['NaN', NaN], ['infinity', Infinity]
]) {
  for (const returning of ['none', 'minimal', 'full']) {
    test(`POST rejects ${label} returned by storage with returning:${returning}`, async t => {
      const dataPost = fixture.api.helpers.dataPost
      t.mock.method(fixture.api.helpers, 'dataPost', async request => {
        await dataPost(request)
        return returnedId
      })
      await assert.rejects(fixture.api.resources.items.post({
        document: { data: { type: 'items', id: '1', attributes: { name: 'Item' } } },
        format: 'jsonapi',
        returning
      }), error => {
        assert.equal(error.transactionOutcome, 'rolledBack')
        assert.match(error.message, /Storage POST did not return a valid resource ID/)
        return true
      })
      assert.deepEqual(afterDataCallIds, [])
      assert.equal(await fixture.count('items'), 0)
    })
  }
}

for (const returnedId of ['1', 1]) {
  test(`POST preserves a valid ${typeof returnedId} storage ID in hooks`, async t => {
    const dataPost = fixture.api.helpers.dataPost
    t.mock.method(fixture.api.helpers, 'dataPost', async request => {
      await dataPost(request)
      return returnedId
    })
    const context = {}
    const record = await fixture.api.resources.items.post({
      document: { data: { type: 'items', id: '1', attributes: { name: 'Item' } } },
      format: 'jsonapi'
    }, context)
    assert.equal(context.id, returnedId)
    assert.equal(record.data.id, '1')
    assert.deepEqual(afterDataCallIds, [returnedId])
    assert.equal(await fixture.count('items'), 1)
  })
}

test('POST converts a large native bigint storage ID to its lossless string', async t => {
  const returnedId = 9007199254740993n
  const dataPost = fixture.api.helpers.dataPost
  t.mock.method(fixture.api.helpers, 'dataPost', async request => {
    await dataPost(request)
    return returnedId
  })
  const context = {}
  const record = await fixture.api.resources.items.post({
    document: { data: { type: 'items', id: String(returnedId), attributes: { name: 'Large ID' } } },
    format: 'jsonapi'
  }, context)
  assert.equal(context.id, String(returnedId))
  assert.equal(record.data.id, String(returnedId))
  assert.deepEqual(afterDataCallIds, [String(returnedId)])
  assert.equal(await fixture.count('items'), 1)
})
