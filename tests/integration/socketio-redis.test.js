import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { io as ioClient } from 'socket.io-client'
import { createClient } from 'redis'
import { createTestDatabase } from '../helpers/test-database.js'
import { storageMode } from '../helpers/storage-mode.js'
import { cleanTables } from '../helpers/test-utils.js'
import { drainSocketEvents, installSocketBarrier, waitForSocketEvent } from '../helpers/socketio.js'
import { closeWebSocketApi, createRowPolicyApi, createWebSocketApi, seedPolicyConformanceApi } from '../fixtures/api-configs.js'

if (!process.env.JSON_REST_API_REDIS_CONNECTION) throw new Error('Redis integration requires the disposable runner: node scripts/test-databases.js redis')
const redis = JSON.parse(process.env.JSON_REST_API_REDIS_CONNECTION)

for (const transport of ['websocket', 'polling']) {
  describe(`Redis notifications over ${transport} (${storageMode.mode})`, { timeout: 60000 }, () => {
    let database, seeded, failFinish, deliveryGate, gateEntered, failBulkIndex
    const bulkError = new Error('Redis bulk entry rejected')
    const cleanupError = new Error('Redis bulk rollback hook failed')
    const nodes = []
    const clients = new Set()
    const post = (node, name, accessGroup = 'group-a', context = seeded.admin) => nodes[node].api.resources.policy_projects.post({
      format: 'plain', data: { name, access_group: accessGroup }
    }, context)
    const patch = (node, id, attributes) => nodes[node].api.resources.policy_projects.patch({
      id, format: 'plain', data: attributes
    }, seeded.admin)
    const connect = async (node, token = 'viewer') => {
      const socket = ioClient(`http://127.0.0.1:${nodes[node].server.address().port}`, {
        path: '/api/socket.io',
        transports: [transport],
        autoConnect: false,
        reconnection: false,
        auth: { token, groups: ['group-b'], workspace: 'spoofed' }
      })
      clients.add(socket)
      const connected = waitForSocketEvent(socket, 'connect', 3000, 'connect_error')
      socket.connect()
      await connected
      return socket
    }
    const subscribe = async socket => {
      const result = await socket.timeout(3000).emitWithAck('subscribe', { resource: 'policy_projects', subscriptionId: 'view' })
      assert.equal(result.success, true, JSON.stringify(result))
      const events = []
      socket.on('subscription.update', event => events.push(event))
      return events
    }
    const drain = async writer => {
      // This request follows published notifications on the writer's Redis connection.
      await nodes[writer].api.io.serverSideEmitWithAck('test:redis-barrier')
      await Promise.all([...clients].map(drainSocketEvents))
    }

    before(async () => {
      database = await createTestDatabase()
      for (let node = 0; node < 2; node++) {
        const result = await createWebSocketApi(database.knex, {
          createApi: createRowPolicyApi,
          connector: 'express',
          searchIds: true,
          bulk: true,
          createTables: node === 0,
          socketio: {
            redis: { ...redis, name: `jra-notifications-${transport}-${node}` },
            auth: { authenticate: ({ socket }) => ({ userId: socket.handshake.auth.token, groups: ['group-a'], workspace: socket.handshake.auth.token === 'other' ? 'workspace-b' : 'workspace-a' }) }
          }
        })
        nodes.push(result)
        installSocketBarrier(result.api.io)
        result.api.io.on('test:redis-barrier', acknowledge => acknowledge())
        await result.api.customize({
          hooks: {
            subscriptionFilters: {
              functionName: 'redis-subscriber-context',
              handler: ({ context: { subscription, auth } }) => {
                subscription.context = { visibility: { groups: auth.groups }, scopeValues: { workspaceId: auth.workspace } }
              }
            },
            finish: {
              functionName: 'redis-write-failure',
              afterFunction: 'socketio-broadcast',
              handler: ({ context }) => {
                if (failFinish && context.method === 'patch') throw new Error('Redis fixture write rejected')
                if (context.bulkOperation && context.bulkIndex === failBulkIndex && ['post', 'patch', 'delete'].includes(context.method)) throw bulkError
              }
            },
            afterRollback: {
              functionName: 'redis-bulk-cleanup-failure',
              afterFunction: 'socketio-cleanup-broadcasts',
              handler: ({ context }) => {
                if (context.bulkOperation && context.bulkIndex === failBulkIndex) throw cleanupError
              }
            },
            afterCommit: {
              functionName: 'redis-delivery-gate',
              beforeFunction: 'socketio-broadcast-deferred',
              handler: async () => {
                if (deliveryGate) {
                  gateEntered?.()
                  await deliveryGate
                }
              }
            }
          }
        })
      }
    })
    beforeEach(async () => {
      failFinish = false
      failBulkIndex = undefined
      deliveryGate = undefined
      gateEntered = undefined
      await cleanTables(database.knex, ['row_policy_project_tasks', 'row_policy_tasks', 'row_policy_projects', 'row_policy_broken'])
      seeded = await seedPolicyConformanceApi(nodes[0].api)
    })
    afterEach(() => {
      for (const socket of clients) socket.disconnect()
      clients.clear()
    })
    after(async () => {
      try {
        const results = await Promise.allSettled(nodes.map(({ api, server }) => closeWebSocketApi(api, server)))
        for (const result of results) if (result.status === 'rejected') throw result.reason
      } finally {
        try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) }
      }
    })

    for (const writer of [0, 1]) {
      it(`delivers committed CRUD from node ${writer} to the other node exactly once`, async () => {
        const events = await subscribe(await connect(1 - writer))
        const created = await post(writer, 'Created')
        await patch(writer, created.id, { name: 'Updated' })
        await nodes[writer].api.resources.policy_projects.delete({ id: created.id }, seeded.admin)
        await drain(writer)
        assert.deepEqual(events.map(event => [event.type, event.id, event.subscriptionId]), [
          ['resource.created', created.id, 'view'], ['resource.updated', created.id, 'view'], ['resource.deleted', created.id, 'view']
        ])
        for (const event of events) assert.equal(event.attributes, undefined)
      })

      for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
        it(`delivers only committed non-atomic ${method} entries from node ${writer} after cleanup failure`, async () => {
          const ids = []
          if (method !== 'bulkPost') for (let index = 0; index < 3; index++) ids.push((await post(writer, `Original ${index}`)).id)
          const events = await subscribe(await connect(1 - writer))
          failBulkIndex = 1
          const records = Array.from({ length: 3 }, (_, index) => ({ name: `Bulk ${index}`, access_group: 'group-a' }))
          const params = method === 'bulkPost' ? { data: records } : method === 'bulkPatch' ? { operations: records.map((data, index) => ({ id: ids[index], data })) } : { ids }
          const context = { ...seeded.admin }
          const result = await nodes[writer].api.resources.policy_projects[method]({ ...params, atomic: false, format: 'plain' }, context)
          assert.deepEqual(result.errors.map(entry => [entry.index, entry.error.message]), [[1, bulkError.message]])
          assert.equal(result.meta.succeeded, 2)
          assert.equal(result.meta.failed, 1)
          assert.deepEqual(context.cleanupErrors, [{ phase: 'afterRollback', error: cleanupError, bulkIndex: 1, operationIndex: 0, scopeName: 'policy_projects', method: method.slice(4).toLowerCase() }])
          await drain(writer)
          const expectedIds = method === 'bulkPost' ? result.data.map(record => record.id) : [ids[0], ids[2]]
          const type = method === 'bulkPost' ? 'resource.created' : method === 'bulkPatch' ? 'resource.updated' : 'resource.deleted'
          assert.deepEqual(events.map(event => [event.id, event.type]), expectedIds.map(id => [id, type]))
          const stored = (await nodes[1 - writer].api.resources.policy_projects.query({ format: 'plain' }, seeded.admin)).data
          assert.equal(stored.some(record => record.name === 'Bulk 1'), false)
          if (method !== 'bulkPost') assert.equal(stored.find(record => record.id === ids[1]).name, 'Original 1')
        })
      }
    }

    for (const node of [0, 1]) {
      for (const role of ['pubClient', 'subClient']) {
        it(`resumes notifications after node ${node}'s ${role} reconnects`, async () => {
          const socket = await connect(1)
          const events = await subscribe(socket)
          const first = await post(0, 'Before reconnect')
          await drain(0)
          const observer = createClient(redis).on('error', () => {})
          try {
            await observer.connect()
            const connections = (await observer.clientList()).filter(client => client.name === `jra-notifications-${transport}-${node}`)
            assert.equal(connections.length, 2)
            const connection = connections.find(client => client.flags.includes('P') === (role === 'subClient'))
            assert.ok(connection)
            const client = nodes[node].api.vars.socketIORedisClients[role]
            const ready = waitForSocketEvent(client, 'ready', 3000)
            await observer.sendCommand(['CLIENT', 'KILL', 'ID', String(connection.id)])
            await ready
            assert.equal(client.isReady, true)
            assert.equal(socket.connected, true)
            const second = await post(0, 'After reconnect')
            await drain(0)
            assert.deepEqual(events.map(event => event.id), [first.id, second.id])
          } finally { if (observer.isOpen) observer.destroy() }
        })
      }
    }

    it('preserves remote row policies and trusted workspace context', async () => {
      const visible = await subscribe(await connect(1))
      const other = await subscribe(await connect(1, 'other'))
      const first = await post(0, 'Visible')
      await post(0, 'Hidden group', 'group-b')
      const second = await post(0, 'Other workspace', 'group-a', { ...seeded.admin, scopeValues: { workspaceId: 'workspace-b' } })
      await drain(0)
      assert.deepEqual(visible.map(event => event.id), [first.id])
      assert.deepEqual(other.map(event => event.id), [second.id])
    })

    it('invalidates a remote result when a row leaves visibility', async () => {
      const events = await subscribe(await connect(1))
      await patch(0, seeded.project.id, { access_group: 'group-b' })
      await patch(0, seeded.project.id, { name: 'Still hidden' })
      await drain(0)
      assert.deepEqual(events.map(event => [event.type, event.id]), [['resource.updated', seeded.project.id]])
    })

    it('does not publish a rolled-back write to the other server', async () => {
      const events = await subscribe(await connect(1))
      failFinish = true
      await assert.rejects(patch(0, seeded.project.id, { name: 'Rejected' }), /Redis fixture write rejected/)
      failFinish = false
      await drain(0)
      assert.deepEqual(events, [])
      assert.equal((await nodes[1].api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)).name, 'Visible parent')
    })

    for (const method of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`delivers a committed ${method} to the remote parent subscription`, async () => {
        const events = await subscribe(await connect(1))
        const task = await nodes[0].api.resources.policy_tasks.post({
          format: 'plain', data: { title: 'Additional task', access_group: 'group-a' }
        }, seeded.admin)
        await nodes[0].api.resources.policy_projects[method]({
          id: seeded.project.id,
          relationshipName: 'shared_tasks',
          relationshipData: [{ type: 'policy_tasks', id: method === 'deleteRelationship' ? seeded.task.id : task.id }]
        }, seeded.admin)
        await drain(0)
        assert.deepEqual(events.map(event => [event.type, event.id, event.action]), [['resource.updated', seeded.project.id, 'patch']])
      })
    }

    it('discards a queued event after the remote subscription is replaced', async () => {
      const socket = await connect(1)
      const events = await subscribe(socket)
      let release
      deliveryGate = new Promise(resolve => { release = resolve })
      const entered = new Promise(resolve => { gateEntered = resolve })
      const write = patch(0, seeded.project.id, { name: 'Queued' })
      try {
        await Promise.race([entered, write.then(() => { throw new Error('Write did not reach its delivery gate') })])
        const removed = await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'view' })
        assert.equal(removed.success, true)
        await subscribe(socket)
      } finally {
        release()
        await write
        deliveryGate = undefined
      }
      await drain(0)
      assert.deepEqual(events, [])
      await patch(0, seeded.project.id, { name: 'New generation' })
      await drain(0)
      assert.deepEqual(events.map(event => event.id), [seeded.project.id])
    })
  })
}
