import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const methods = ['post', 'put', 'patch', 'delete', 'get', 'query', 'getRelated', 'getRelationship', 'postRelationship', 'patchRelationship', 'deleteRelationship', 'bulkPost', 'bulkPatch', 'bulkDelete']
const returningMethods = new Set(['post', 'put', 'patch', 'bulkPost', 'bulkPatch'])
const removed = ['simplified', 'simplifiedApi', 'simplifiedTransport', 'returnFullRecord', 'returnRecordApi', 'returnRecordTransport', 'isTransport']

describe(`Response option rejection before storage (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { bulk: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  async function rejectsBeforeStorage (method, options, field) {
    const statements = []
    const capture = query => statements.push(query.sql)
    fixture.knex.on('query', capture)
    try {
      await assert.rejects(fixture.api.resources.items[method]({
        id: '1',
        relationshipName: 'groups',
        relationshipData: [],
        document: { data: { type: 'items', id: '1', attributes: { name: 'Unexpected write' } } },
        operations: [{ id: '1', data: { type: 'items', id: '1', attributes: { name: 'Unexpected write' } } }],
        ids: ['1'],
        format: 'jsonapi',
        ...options
      }), error => {
        assert.equal(error.code, 'REST_API_VALIDATION')
        assert.ok(error.details.fields.includes(field), JSON.stringify(error.details))
        return true
      })
      assert.deepEqual(statements, [], 'invalid controls must reject before SQL or transaction acquisition')
    } finally { fixture.knex.off('query', capture) }
  }

  for (const method of methods) {
    it(`${method} rejects removed controls even when false or explicitly undefined`, async () => {
      for (const field of removed) {
        for (const value of [true, false, undefined]) await rejectsBeforeStorage(method, { [field]: value }, field)
      }
    })
    it(`${method} rejects malformed format values`, async () => {
      for (const value of [null, true, false, '', 'JSONAPI', 'simple', {}, []]) {
        await rejectsBeforeStorage(method, { format: value }, 'format')
      }
    })
    if (returningMethods.has(method)) {
      it(`${method} rejects malformed returning values`, async () => {
        for (const value of [null, true, false, '', 'FULL', 'no', {}, { post: 'full' }, []]) {
          await rejectsBeforeStorage(method, { returning: value }, 'returning')
        }
      })
    }
  }
})
