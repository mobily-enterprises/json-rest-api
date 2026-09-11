import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Relationship setter storage parity (${storageMode.mode})`, () => {
  let fixture
  let group
  let calls = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' },
      apiOptions: {
        relationshipSetter: async (value, context) => {
          calls.push({ value, method: context.method })
          await Promise.resolve()
          return null
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    await fixture.seed('items', { name: 'Existing item' })
    calls = []
  })
  after(async () => { await fixture?.close() })

  for (const operation of ['post', 'put-create', 'put-update', 'patch']) {
    for (const format of ['jsonapi', 'plain']) {
      it(`stores the setter result once for ${operation} (${format})`, async () => {
        const method = operation.startsWith('put') ? 'put' : operation
        const id = ['post', 'put-create'].includes(operation) ? '2' : '1'
        const result = await fixture.api.resources.items[method]({
          ...(method === 'post' ? {} : { id }),
          format,
          inputRecord: format === 'plain'
            ? { id, name: 'Written item', active: true, score: 0, group: group.id }
            : {
                data: {
                  type: 'items',
                  id,
                  attributes: { name: 'Written item', active: true, score: 0 },
                  relationships: { group: { data: { type: 'groups', id: group.id } } }
                }
              }
        })
        assert.equal(calls.length, 1)
        assert.equal(String(calls[0].value), group.id)
        assert.equal(calls[0].method, method)
        const data = format === 'jsonapi' ? result.data : result
        if (format === 'jsonapi') assert.equal(data.relationships.group.data, null)
        else assert.equal(Object.hasOwn(data, 'group'), false)
        const adapter = fixture.api.knex.helpers.getStorageAdapter('items')
        const row = await adapter.buildBaseQuery().where(adapter.getIdColumn(), id).first()
        assert.equal(adapter.getFieldValue(row, 'groupId'), null)
      })
    }
  }
})
