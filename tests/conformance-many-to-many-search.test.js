import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi } from './fixtures/api-configs.js'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { storageMode } from './helpers/storage-mode.js'

// Omit the parallel hasMany route so the search must traverse membership links.
describe(`Many-to-many search (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      apiOptions: {
        groupOptions: {
          relationships: { members: { type: 'manyToMany', target: 'items', through: 'memberships', foreignKey: 'groupId', otherKey: 'itemId' } }
        }
      },
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
    })
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'many-search-denial',
          handler: ({ context, scopeName }) => {
            if ((scopeName === 'items' && context.originalContext?.denyItems) || (scopeName === 'memberships' && context.originalContext?.denyPivots)) throw new RestApiResourceError('Items denied', { subtype: 'forbidden' })
          }
        },
        knexQueryFiltering: {
          functionName: 'many-search-visibility',
          handler: ({ context }) => {
            const state = context.knexQuery
            if ((context.hideItems && state.scopeName === 'items') || (context.hidePivots && state.scopeName === 'memberships')) state.query.whereRaw('1 = 0')
          }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  const post = (scope, attributes) => fixture.api.resources[scope].post({ format: 'jsonapi', inputRecord: { data: { type: scope, attributes } } })

  it('filters parents through an aliased membership and counts each parent once', async () => {
    const group = await post('groups', { name: 'Selected' })
    await post('groups', { name: 'Empty' })
    const first = await post('items', { name: 'Match one' })
    const second = await post('items', { name: 'Match two' })
    await fixture.api.resources.groups.postRelationship({
      id: group.data.id,
      relationshipName: 'members',
      relationshipData: [first.data, second.data].map(({ type, id }) => ({ type, id }))
    })
    const result = await fixture.api.resources.groups.query({
      format: 'jsonapi', queryParams: { filters: { childName: 'Match' }, page: { number: 1, size: 1 } }
    })
    assert.deepEqual(result.data.map(record => record.id), [group.data.id])
    assert.equal(result.meta.pagination.total, 1)
  })

  it('stops matching after the last membership is removed', async () => {
    const group = await post('groups', { name: 'Selected' })
    const item = await post('items', { name: 'Match' })
    // Public relationship writes are the membership source for both backends.
    await fixture.api.resources.groups.postRelationship({
      id: group.data.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.data.id }]
    })
    await fixture.api.resources.groups.deleteRelationship({
      id: group.data.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.data.id }]
    })
    const result = await fixture.api.resources.groups.query({ format: 'jsonapi', queryParams: { filters: { childName: 'Match' } } })
    assert.deepEqual(result.data, [])
  })
  it('uses inverse-created membership and enforces target query visibility', async () => {
    const group = await post('groups', { name: 'Selected' })
    const item = await post('items', { name: 'Match' })
    await fixture.api.resources.items.postRelationship({
      id: item.data.id, relationshipName: 'collections', relationshipData: [{ type: 'groups', id: group.data.id }]
    })
    const params = { format: 'jsonapi', queryParams: { filters: { childName: 'Match' }, page: { number: 1, size: 1 } } }
    const visible = await fixture.api.resources.groups.query(params)
    assert.deepEqual(visible.data.map(record => record.id), [group.data.id])
    const hidden = await fixture.api.resources.groups.query(params, { hideItems: true })
    assert.deepEqual(hidden.data, [])
    assert.equal(hidden.meta.pagination.total, 0)
    await assert.rejects(fixture.api.resources.groups.query(params, { denyItems: true }), error => error instanceof RestApiResourceError && error.subtype === 'forbidden')
  })
  it('applies pivot visibility to ordinary rows while canonical links stay independent', async () => {
    const group = await post('groups', { name: 'Selected' })
    const item = await post('items', { name: 'Match' })
    await fixture.api.resources.groups.postRelationship({
      id: group.data.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.data.id }]
    })
    const params = { format: 'jsonapi', queryParams: { filters: { childName: 'Match' } } }
    const result = await fixture.api.resources.groups.query(params, { hidePivots: true })
    assert.equal(result.data.length, storageMode.mode === 'anyapi' ? 1 : 0)
    if (storageMode.mode === 'anyapi') {
      assert.equal((await fixture.api.resources.groups.query(params, { denyPivots: true })).data.length, 1)
    } else {
      await assert.rejects(fixture.api.resources.groups.query(params, { denyPivots: true }), error => error instanceof RestApiResourceError)
    }
  })
})
