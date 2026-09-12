import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Mutable hook context contract (${storageMode.mode})`, () => {
  let fixture
  let handlers = {}
  const events = [
    'beforeProcessingPost', 'beforeProcessingPatch', 'beforeSchemaValidatePost',
    'beforeSchemaValidatePatch', 'afterSchemaValidatePost', 'beforeDataCallPost',
    'afterDataCallPost', 'finishPost', 'afterCommit', 'afterRollback',
    'checkPermissions', 'beforeDataGet', 'enrichAttributes', 'finishGet',
    'finishPatch', 'finishPatchRelationship', 'checkPermissionsGetRelationship', 'checkPermissionsGetRelated'
  ]

  before(async () => {
    fixture = await createConformanceFixture()
    fixture.api.customize({
      hooks: Object.fromEntries(events.map(event => [event, {
        functionName: `context-contract-${event}`,
        handler: args => handlers[event]?.(args)
      }]))
    })
  })
  beforeEach(async () => { handlers = {}; await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('shares caller identity, cached information and pending attributes through write and completion hooks', async () => {
    const context = { requestId: 'create-item' }
    const seen = []
    for (const event of ['beforeProcessingPost', 'beforeSchemaValidatePost', 'afterSchemaValidatePost', 'beforeDataCallPost', 'afterDataCallPost', 'finishPost', 'afterCommit']) {
      handlers[event] = ({ context: actual }) => {
        assert.equal(actual, context)
        seen.push(event)
        if (event === 'beforeProcessingPost') actual.nameCache = { name: actual.inputRecord.data.attributes.name.trim() }
        else if (event === 'beforeSchemaValidatePost') actual.inputRecord.data.attributes.name = actual.nameCache.name
        else if (event === 'afterSchemaValidatePost') assert.equal(actual.inputRecord.data.attributes.name, 'Prepared')
        else if (event === 'beforeDataCallPost') actual.preparedName = actual.nameCache.name
        else if (event === 'afterDataCallPost') assert.ok(actual.id)
        else if (event === 'finishPost') assert.equal(actual.responseRecord.data.id, String(actual.id))
        else if (event === 'afterCommit') actual.savedItemId = String(actual.id)
      }
    }

    const result = await fixture.api.resources.items.post({
      data: { name: ' Prepared ' }, format: 'jsonapi', returning: 'minimal'
    }, context)

    assert.deepEqual(seen, ['beforeProcessingPost', 'beforeSchemaValidatePost', 'afterSchemaValidatePost', 'beforeDataCallPost', 'afterDataCallPost', 'finishPost', 'afterCommit'])
    assert.equal(context.requestId, 'create-item')
    assert.equal(context.preparedName, 'Prepared')
    assert.equal(context.savedItemId, result.data.id)
    const stored = await fixture.api.resources.items.get({ id: result.data.id, format: 'jsonapi' })
    assert.equal(stored.data.attributes.name, 'Prepared')
  })

  it('validates hook changes made before schema validation and retains failure information for the caller', async () => {
    const item = await fixture.seed('items', { name: 'Original' })
    const context = {}
    handlers.beforeSchemaValidatePatch = ({ context: actual }) => {
      assert.equal(actual, context)
      actual.inputRecord.data.attributes.name = 'x'.repeat(61)
      actual.attemptedName = actual.inputRecord.data.attributes.name
    }
    handlers.afterRollback = ({ context: actual }) => {
      assert.equal(actual, context)
      actual.rollbackObserved = true
    }

    await assert.rejects(fixture.api.resources.items.patch({
      id: item.id, data: { name: 'Requested' }, format: 'jsonapi'
    }, context), error => {
      assertWriteFailure(error, { outcome: 'rolledBack' })
      assert.equal(error.code, 'REST_API_VALIDATION')
      return true
    })
    assert.equal(context.attemptedName.length, 61)
    assert.equal(context.rollbackObserved, true)
    const stored = await fixture.api.resources.items.get({ id: item.id, format: 'jsonapi' })
    assert.equal(stored.data.attributes.name, 'Original')
  })

  it('distinguishes persisted input, finish output and after-commit observations', async () => {
    const context = {}
    handlers.afterDataCallPost = ({ context }) => { context.inputRecord.data.attributes.name = 'After storage' }
    handlers.finishPost = ({ context }) => { context.responseRecord.data.attributes.name = 'Presented' }
    handlers.afterCommit = ({ context }) => { context.responseRecord.data.attributes.name = 'After commit' }

    const result = await fixture.api.resources.items.post({
      data: { name: 'Stored' }, format: 'jsonapi', returning: 'full'
    }, context)

    assert.equal(result.data.attributes.name, 'Presented')
    assert.equal(context.responseRecord.data.attributes.name, 'After commit')
    const stored = await fixture.api.resources.items.get({ id: result.data.id, format: 'jsonapi' })
    assert.equal(stored.data.attributes.name, 'Stored')
  })

  it('exposes the operation context through permission and enrichment wrappers', async () => {
    const item = await fixture.seed('items', { name: 'Stored' })
    const context = { user: { id: 'reader' } }
    const wrappers = []
    handlers.checkPermissions = ({ context: permission }) => {
      assert.notEqual(permission, context)
      assert.equal(permission.originalContext, context)
      permission.originalContext.authorized = true
      wrappers.push(permission)
    }
    handlers.beforeDataGet = ({ context: actual }) => {
      assert.equal(actual, context)
      assert.equal(actual.authorized, true)
    }
    handlers.enrichAttributes = ({ context: enrichment }) => {
      assert.notEqual(enrichment, context)
      assert.equal(enrichment.parentContext, context)
      enrichment.parentContext.enrichmentVisited = true
      enrichment.attributes.name = 'Enriched'
      wrappers.push(enrichment)
    }
    handlers.finishGet = ({ context: actual }) => {
      assert.equal(actual, context)
      assert.equal(actual.enrichmentVisited, true)
    }

    const result = await fixture.api.resources.items.get({ id: item.id, format: 'jsonapi' }, context)
    assert.equal(wrappers.length, 2)
    assert.equal(result.data.attributes.name, 'Enriched')
    assert.equal(context.enrichmentVisited, true)
  })

  it('keeps a full-response GET separate while inheriting application references and the transaction', async () => {
    const context = { auth: { userId: 'writer' }, cache: { visits: [] }, localMarker: 'parent' }
    let child
    handlers.beforeDataGet = ({ context: actual }) => {
      child = actual
      assert.notEqual(child, context)
      assert.equal(child.auth, context.auth)
      assert.equal(child.cache, context.cache)
      assert.equal(child.transaction, context.transaction)
      assert.equal(child.method, 'get')
      assert.equal(context.method, 'post')
      child.cache.visits.push('response read')
      child.localMarker = 'child'
    }
    handlers.finishPost = ({ context: actual }) => {
      assert.equal(actual, context)
      assert.equal(actual.localMarker, 'parent')
      assert.equal(actual.method, 'post')
    }

    const result = await fixture.api.resources.items.post({
      data: { name: 'Stored' }, format: 'jsonapi', returning: 'full'
    }, context)

    assert.equal(child.id, result.data.id)
    assert.equal(String(context.id), result.data.id)
    assert.equal(context.localMarker, 'parent')
    assert.deepEqual(context.cache.visits, ['response read'])
    assert.equal(child.localMarker, 'child')
  })

  it('keeps nested relationship PATCH state separate and shares its application cache deliberately', async () => {
    const group = await fixture.seed('groups', { name: 'Group' })
    const item = await fixture.seed('items', { name: 'Item' })
    const context = { auth: { userId: 'writer' }, cache: { phases: [] }, localMarker: 'parent' }
    let child
    handlers.beforeProcessingPatch = ({ context: actual }) => {
      child = actual
      assert.notEqual(child, context)
      assert.equal(child.transaction, context.transaction)
      assert.equal(child.auth, context.auth)
      assert.equal(child.cache, context.cache)
      child.localMarker = 'child'
      child.cache.phases.push('patch')
    }
    handlers.finishPatch = ({ context: actual }) => {
      assert.equal(actual, child)
      assert.equal(actual.localMarker, 'child')
    }
    handlers.finishPatchRelationship = ({ context: actual }) => {
      assert.equal(actual, context)
      assert.equal(actual.method, 'patchRelationship')
      assert.equal(actual.localMarker, 'parent')
      assert.deepEqual(actual.cache.phases, ['patch'])
    }

    await fixture.api.resources.items.patchRelationship({
      id: item.id, relationshipName: 'group', relationshipData: { type: 'groups', id: group.id }
    }, context)

    assert.ok(child)
    assert.equal(context.method, 'patchRelationship')
    const stored = await fixture.api.resources.items.get({ id: item.id, format: 'jsonapi' })
    assert.equal(stored.data.relationships.group.data.id, group.id)
  })

  it('keeps concurrent reads and their hook caches independent when each call receives its own context', async () => {
    const first = await fixture.seed('items', { name: 'First' })
    const second = await fixture.seed('items', { name: 'Second' })
    const contexts = [{ requestedId: first.id }, { requestedId: second.id }]
    const ready = Promise.withResolvers()
    let arrived = 0
    handlers.beforeDataGet = async ({ context }) => {
      context.cachedId = context.id
      if (++arrived === 2) ready.resolve()
      await ready.promise
      assert.equal(context.id, context.requestedId)
      assert.equal(context.cachedId, context.requestedId)
    }
    handlers.finishGet = ({ context }) => { context.seenName = context.record.data.attributes.name }

    const results = await Promise.all(contexts.map(context => fixture.api.resources.items.get({
      id: context.requestedId, format: 'jsonapi'
    }, context)))

    assert.deepEqual(results.map(result => result.data.attributes.name), ['First', 'Second'])
    assert.deepEqual(contexts.map(context => context.seenName), ['First', 'Second'])
    assert.notEqual(contexts[0].record, contexts[1].record)
  })
  for (const method of ['getRelationship', 'getRelated']) {
    it(`${method} establishes its parent scope before permission hooks`, async () => {
      const item = await fixture.seed('items', { name: 'Item' })
      const context = { scopeName: 'stale-parent' }
      let seen = false
      const event = `checkPermissions${method[0].toUpperCase()}${method.slice(1)}`
      handlers[event] = ({ context: actual }) => {
        assert.equal(actual, context)
        assert.equal(actual.scopeName, 'items')
        assert.equal(actual.method, method)
        assert.equal(actual.id, item.id)
        assert.equal(actual.relationshipName, 'group')
        seen = true
      }
      await fixture.api.resources.items[method]({
        id: item.id, relationshipName: 'group', format: 'jsonapi'
      }, context)
      assert.equal(seen, true)
      assert.equal(context.scopeName, 'items')
    })
  }
})
