import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { RestApiVersionConflictError } from '../index.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { mapRestApiErrorToHttp } from '../plugins/core/connectors/lib/transport-http-helpers.js'

async function failureOf (call) {
  let failure
  await assert.rejects(call, error => { failure = error; return true })
  return failure
}

describe(`Version conflict visibility (${storageMode.mode})`, () => {
  let fixture, item
  const successfulWrites = []
  const commits = []
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: {
        hooks: {
          afterDataCall: { functionName: 'observe-version-success', handler: ({ context }) => { successfulWrites.push(context.method) } },
          afterCommit: { functionName: 'observe-version-commit', handler: ({ context }) => { commits.push(context.method) } }
        },
        fields: { revision: { type: 'string', required: true }, parentId: { type: 'id', belongsTo: 'items', as: 'parent', nullable: true } },
        resourceOptions: { versionField: 'revision', rowPolicy: 'visible', relationships: { children: { type: 'hasMany', target: 'items', foreignKey: 'parentId' } } },
        rowPolicyOptions: {
          policies: {
            visible: ({ context, query, column, value }) => {
              if (context.hide === true) return false
              if (context.allowedName !== undefined) query.where(column('name'), value('name', context.allowedName))
              return true
            }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    item = await fixture.seed('items', { name: 'Original' })
    successfulWrites.length = 0
    commits.length = 0
  })
  after(async () => { await fixture?.close() })

  it('runs the observed success and commit hooks for an accepted conditional write', async () => {
    await fixture.api.resources.items.patch({ id: item.id, expectedVersion: item.attributes.revision, format: 'plain', data: { name: 'Accepted' } })
    assert.ok(successfulWrites.includes('patch'))
    assert.ok(commits.includes('patch'))
  })

  for (const method of ['patch', 'put', 'delete', 'postRelationship', 'patchRelationship', 'deleteRelationship']) {
    const change = (id, expectedVersion, context = {}) => fixture.api.resources.items[method]({
      id,
      expectedVersion,
      format: 'jsonapi',
      ...(method.endsWith('Relationship') ? { relationshipName: 'children', relationshipData: [] } : method === 'delete' ? {} : { document: { data: { type: 'items', attributes: { name: 'Changed' } } } })
    }, context)

    it(`identifies a visible ${method} version conflict without exposing revision values`, async () => {
      const error = await failureOf(change(item.id, 'stale-token'))
      assert.deepEqual(successfulWrites, [])
      assert.deepEqual(commits, [])
      assert.equal(error.code, 'REST_API_VERSION_CONFLICT')
      assertWriteFailure(error, { type: RestApiVersionConflictError, outcome: 'rolledBack' })
      const http = mapRestApiErrorToHttp(error)
      assert.equal(http.status, 409)
      assert.equal(http.body.errors[0].code, 'REST_API_VERSION_CONFLICT')
      assert.ok(!JSON.stringify(http).includes(item.attributes.revision))
      assert.ok(!JSON.stringify(http).includes('stale-token'))
      const stored = (await fixture.api.resources.items.get({ id: item.id, format: 'jsonapi' })).data
      assert.equal(stored.attributes.revision, item.attributes.revision)
      assert.equal(stored.attributes.name, 'Original')
    })

    it(`does not distinguish a policy-hidden ${method} target from the same missing target`, async () => {
      const hidden = await failureOf(change(item.id, item.attributes.revision, { hide: true }))
      await fixture.api.resources.items.delete({ id: item.id })
      const missing = await failureOf(change(item.id, item.attributes.revision, { hide: true }))
      assert.equal(hidden.subtype, 'not_found')
      assert.equal(missing.subtype, 'not_found')
      assert.deepEqual(mapRestApiErrorToHttp(hidden), mapRestApiErrorToHttp(missing))
      assert.equal(await fixture.count('items'), 0)
    })

    it(`applies SQL row policy before accepting or disclosing a ${method} revision`, async () => {
      const before = await fixture.api.resources.items.get({ id: item.id })
      const context = { allowedName: 'Someone else' }
      const current = await failureOf(change(item.id, item.attributes.revision, context))
      const stale = await failureOf(change(item.id, 'stale-token', context))
      for (const error of [current, stale]) {
        assert.equal(error.code, 'REST_API_RESOURCE')
        assert.equal(error.subtype, 'not_found')
      }
      assert.deepEqual(mapRestApiErrorToHttp(current), mapRestApiErrorToHttp(stale))
      assert.deepEqual(await fixture.api.resources.items.get({ id: item.id }), before)
      await fixture.api.resources.items.delete({ id: item.id })
      const missing = await failureOf(change(item.id, item.attributes.revision, context))
      assert.deepEqual(mapRestApiErrorToHttp(current), mapRestApiErrorToHttp(missing))
    })
  }
})
