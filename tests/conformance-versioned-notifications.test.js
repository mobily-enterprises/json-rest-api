import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'
import { createConformanceFixture } from './fixtures/conformance.js'
import { closeWebSocketApi, createQueryConformanceApi, createWebSocketApi } from './fixtures/api-configs.js'
import { drainSocketEvents, installSocketBarrier, waitForSocketEvent } from './helpers/socketio.js'
import { storageMode } from './helpers/storage-mode.js'
import { BulkOperationsPlugin } from '../plugins/core/bulk-operations-plugin.js'

for (const transport of ['websocket', 'polling']) {
  describe(`Conditional notification suppression ${transport} (${storageMode.mode})`, { timeout: 20000 }, () => {
    let fixture, server, socket, parent, child
    const events = []
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: async knex => {
          const result = await createWebSocketApi(knex, {
            createApi: createQueryConformanceApi,
            groupOptions: {
              schema: { id: { type: 'id' }, name: { type: 'string', required: true }, revision: { type: 'string', required: true } },
              versionField: 'revision'
            },
            socketio: { auth: { authenticate: async () => ({ userId: 'viewer' }) } }
          })
          server = result.server
          await result.api.use(BulkOperationsPlugin)
          installSocketBarrier(result.api.io)
          return result.api
        },
        tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      const created = await fixture.seed('groups', { name: 'Parent' })
      child = await fixture.seed('items', { name: 'Child' }, { collections: { data: [{ type: 'groups', id: created.id }] } })
      parent = await fixture.api.resources.groups.get({ id: created.id, format: 'plain' })
      socket = ioClient(`http://127.0.0.1:${server.address().port}`, {
        path: '/api/socket.io', transports: [transport], reconnection: false, autoConnect: false
      })
      const connected = waitForSocketEvent(socket, 'connect', 3000, 'connect_error')
      socket.connect()
      await connected
      assert.equal((await socket.timeout(3000).emitWithAck('subscribe', { resource: 'groups' })).success, true)
      events.length = 0
      socket.on('subscription.update', event => events.push(event))
    })
    afterEach(() => { socket?.disconnect() })
    after(async () => {
      try { await closeWebSocketApi(fixture?.api, server) } finally { await fixture?.close() }
    })
    it('discards an earlier relationship notification when a caller transaction hits a stale write', async () => {
      const groups = fixture.api.resources.groups
      const membership = await groups.getRelationship({ id: parent.id, relationshipName: 'members' })
      await assert.rejects(fixture.api.transaction(async transaction => {
        await groups.patchRelationship({ id: parent.id, expectedVersion: parent.revision, relationshipName: 'members', relationshipData: [], transaction })
        const changed = await groups.get({ id: parent.id, transaction, format: 'plain' })
        assert.notEqual(changed.revision, parent.revision)
        await groups.patch({ id: parent.id, expectedVersion: parent.revision, inputRecord: { name: 'Stale' }, format: 'plain', transaction })
      }), error => error.code === 'REST_API_VERSION_CONFLICT')
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      assert.deepEqual(await groups.get({ id: parent.id, format: 'plain' }), parent)
      assert.deepEqual(await groups.getRelationship({ id: parent.id, relationshipName: 'members' }), membership)
    })
    for (const method of ['bulkPatch', 'bulkDelete']) {
      it(`discards successful-child notifications when atomic ${method} encounters a stale child`, async () => {
        const groups = fixture.api.resources.groups
        const sibling = await fixture.seed('groups', { name: 'Sibling' })
        await drainSocketEvents(socket)
        events.length = 0
        const membership = await groups.getRelationship({ id: parent.id, relationshipName: 'members' })
        const ids = [parent.id, sibling.id]
        await assert.rejects(groups[method]({
          atomic: true,
          expectedVersions: [parent.revision, 'stale-token'],
          format: 'plain',
          ...(method === 'bulkDelete' ? { ids } : { operations: ids.map(id => ({ id, data: { name: 'Provisional' } })) })
        }), error => error.code === 'REST_API_VERSION_CONFLICT')
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        assert.deepEqual(await groups.get({ id: parent.id, format: 'plain' }), parent)
        assert.deepEqual((await groups.get({ id: sibling.id })).data, sibling)
        assert.deepEqual(await groups.getRelationship({ id: parent.id, relationshipName: 'members' }), membership)
      })
    }
    for (const method of ['patch', 'put', 'delete', 'postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`emits no committed update for rejected ${method}`, async () => {
        const groups = fixture.api.resources.groups
        const membership = await groups.getRelationship({ id: parent.id, relationshipName: 'members' })
        const mutate = expectedVersion => groups[method]({
          id: parent.id,
          expectedVersion,
          format: 'plain',
          ...(method.endsWith('Relationship')
            ? { relationshipName: 'members', relationshipData: method === 'patchRelationship' ? [] : [{ type: 'items', id: child.id }] }
            : method === 'delete' ? {} : { inputRecord: { name: 'Updated' } })
        })
        await assert.rejects(mutate('stale-token'), error => error.code === 'REST_API_VERSION_CONFLICT')
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        assert.deepEqual(await groups.get({ id: parent.id, format: 'plain' }), parent)
        assert.deepEqual(await groups.getRelationship({ id: parent.id, relationshipName: 'members' }), membership)
        await mutate(parent.revision)
        await drainSocketEvents(socket)
        assert.ok(events.length > 0, 'The accepted write must reach the subscribed client')
      })
    }
  })
}
