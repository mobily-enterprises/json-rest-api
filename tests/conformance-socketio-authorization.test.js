import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase, databaseClient } from './helpers/test-database.js'
import { io as ioClient } from 'socket.io-client'
import { createRowPolicyApi, createQueryConformanceApi, createWebSocketApi, closeWebSocketApi, seedPolicyConformanceApi } from './fixtures/api-configs.js'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { drainSocketEvents, installSocketBarrier, waitForSocketEvent } from './helpers/socketio.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

for (const transport of ['websocket', 'polling']) {
  describe(`Real Socket.IO authorization over ${transport} (${storageMode.mode})`, { timeout: 120000 }, () => {
    let api, server, knex, database, seeded, failQuery, failWrite, deliveryGate, gateEntered, requireContext, failBulkIndex, failBulkCleanup
    const bulkError = new RestApiValidationError('Bulk entry rejected before commit')
    const cleanupError = new Error('Bulk rollback hook failed')
    const managedError = new RestApiValidationError('Managed write rejected')
    const clients = new Set()
    const connect = async (token = 'viewer') => {
      const socket = ioClient(`http://127.0.0.1:${server.address().port}`, {
        path: '/api/socket.io',
        transports: [transport],
        reconnection: false,
        autoConnect: false,
        auth: { token, groups: ['group-b'], workspace: 'workspace-b', visibility: { all: true } }
      })
      clients.add(socket)
      const connected = waitForSocketEvent(socket, 'connect', 3000, 'connect_error')
      socket.connect()
      await connected
      return socket
    }
    const subscribe = async (socket, filters = {}, subscriptionId = 'view') => {
      const result = await socket.timeout(3000).emitWithAck('subscribe', { resource: 'policy_projects', filters, subscriptionId })
      assert.equal(result.success, true, JSON.stringify(result))
      const events = []
      socket.on('subscription.update', event => events.push(event))
      return events
    }
    const post = (name, group = 'group-a', context = seeded.admin, transaction) => api.resources.policy_projects.post({
      format: 'plain', returning: 'full', inputRecord: { name, access_group: group }, transaction
    }, context)
    const patch = (id, inputRecord, context = seeded.admin, transaction) => api.resources.policy_projects.patch({
      id, format: 'plain', returning: 'none', inputRecord, transaction
    }, context)

    before(async () => {
      database = await createTestDatabase()
      knex = database.knex
      const result = await createWebSocketApi(knex, {
        createApi: createRowPolicyApi,
        connector: 'express',
        searchIds: true,
        bulk: true,
        socketio: {
          auth: {
            authenticate: ({ socket }) => {
              const token = socket.handshake.auth.token
              if (!['viewer', 'other', 'missing-context'].includes(token)) throw new Error('Unknown viewer')
              return { userId: token, groups: ['group-a'], workspace: token === 'other' ? 'workspace-b' : 'workspace-a' }
            }
          }
        }
      })
      api = result.api
      server = result.server
      assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
      installSocketBarrier(api.io)
      await api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'subscriber-query-context',
            handler: ({ context }) => {
              const original = context.originalContext
              if (requireContext && context.method === 'query' && original?.auth?.userId === 'viewer' &&
                original.scopeValues?.workspaceId !== 'workspace-a') throw new Error('Subscriber workspace required')
            }
          },
          subscriptionFilters: {
            functionName: 'subscriber-workspace-context',
            handler: ({ context: { subscription, auth } }) => {
              if (auth.userId === 'missing-context') return
              subscription.context = {
                visibility: { groups: auth.groups }, scopeValues: { workspaceId: auth.workspace }
              }
            }
          },
          beforeDataQuery: {
            functionName: 'subscriber-query-failure',
            handler: ({ context }) => {
              if (failQuery && context.auth?.userId === 'viewer') throw new Error('Subscriber query failed')
            }
          },
          beforeDataCall: {
            functionName: 'pause-managed-socket-write',
            afterFunction: 'socketio-capture-before',
            handler: async ({ context }) => { await context.managedPause?.() }
          },
          finish: {
            functionName: 'authorized-socket-write-failure',
            afterFunction: 'socketio-broadcast',
            handler: ({ context }) => {
              if (failWrite && context.method === 'patch') throw new Error('Write rejected before commit')
              if (context.failManagedWrite) throw managedError
              if (context.bulkOperation && context.bulkIndex === failBulkIndex && ['post', 'patch', 'delete'].includes(context.method)) throw bulkError
            }
          },
          afterRollback: {
            functionName: 'authorized-bulk-cleanup-failure',
            afterFunction: 'socketio-cleanup-broadcasts',
            handler: ({ context }) => {
              context.managedCompletions?.push([context.managedIndex, 'rolledBack'])
              if (failBulkCleanup && context.bulkOperation && context.bulkIndex === failBulkIndex) throw cleanupError
              if (context.failManagedCompletion) throw cleanupError
            }
          },
          afterCommit: {
            functionName: 'authorized-socket-delivery-gate',
            beforeFunction: 'socketio-broadcast-deferred',
            handler: async ({ context }) => {
              context.managedCompletions?.push([context.managedIndex, 'committed'])
              if (context.failManagedCompletion) throw cleanupError
              if (context.waitForDelivery && deliveryGate) {
                gateEntered?.()
                await deliveryGate
              }
            }
          }
        }
      })
    })
    beforeEach(async () => {
      failQuery = false
      failWrite = false
      failBulkIndex = undefined
      failBulkCleanup = false
      requireContext = false
      deliveryGate = undefined
      gateEntered = undefined
      await cleanTables(knex, ['row_policy_project_tasks', 'row_policy_tasks', 'row_policy_projects', 'row_policy_broken'])
      seeded = await seedPolicyConformanceApi(api)
    })
    afterEach(() => {
      for (const socket of clients) socket.disconnect()
      clients.clear()
    })
    after(async () => {
      try { await closeWebSocketApi(api, server) } finally {
        try { await database?.close() } finally { storageMode.clearRegistry(knex) }
      }
    })

    it('delivers repeated managed changes in order only after commit, and awaits completion hooks', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      const entered = Promise.withResolvers()
      const release = Promise.withResolvers()
      deliveryGate = release.promise
      gateEntered = entered.resolve
      const managedCompletions = []
      const contexts = Array.from({ length: 6 }, (_, managedIndex) => ({ ...seeded.admin, managedIndex, managedCompletions }))
      contexts[0].waitForDelivery = true
      const owner = {}
      let created; let settled = false
      const work = api.transaction(async transaction => {
        created = await post('Transient managed record', 'group-a', contexts[0], transaction)
        await patch(created.id, { name: 'Transient changed' }, contexts[1], transaction)
        await api.resources.policy_projects.delete({ id: created.id, transaction }, contexts[2])
        await patch(seeded.project.id, { name: 'First managed change' }, contexts[3], transaction)
        await patch(seeded.project.id, { name: 'Final managed change' }, contexts[4], transaction)
        await post('Hidden managed record', 'group-b', contexts[5], transaction)
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        assert.deepEqual(managedCompletions, [])
        assert.equal(transaction.isCompleted(), false)
        return created
      }, owner)
      work.then(() => { settled = true }, () => { settled = true })
      try {
        await Promise.race([entered.promise, work.then(() => assert.fail('Completion gate was not reached'))])
        assert.equal(owner.transactionOutcome, 'committed')
        assert.equal(settled, false)
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        assert.equal((await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)).name, 'Final managed change')
      } finally { release.resolve() }
      assert.equal(await work, created)
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.id, event.type, event.action]), [
        [created.id, 'resource.created', 'post'], [created.id, 'resource.updated', 'patch'], [created.id, 'resource.deleted', 'delete'],
        [seeded.project.id, 'resource.updated', 'patch'], [seeded.project.id, 'resource.updated', 'patch']
      ])
      assert.deepEqual(events[2].deletedRecord, { id: created.id })
      assert.deepEqual(managedCompletions, [0, 1, 2, 3, 4, 5].map(index => [index, 'committed']))
      assert.equal((await api.resources.policy_projects.query({}, seeded.admin)).data.some(row => row.id === created.id), false)
    })

    it('captures overlapping notifications in write-finish order while completion hooks retain enlistment order', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      const managedCompletions = []
      let first, second
      await api.transaction(async transaction => {
        const pending = post('First started', 'group-a', {
          ...seeded.admin,
          managedIndex: 0,
          managedCompletions,
          managedPause: async () => { started.resolve(); await release.promise }
        }, transaction)
        pending.catch(() => {})
        try {
          await started.promise
          second = await post('First finished', 'group-a', { ...seeded.admin, managedIndex: 1, managedCompletions }, transaction)
          await drainSocketEvents(socket)
          assert.deepEqual(events, [])
          assert.deepEqual(managedCompletions, [])
        } finally { release.resolve() }
        first = await pending
      })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [second.id, first.id])
      assert.deepEqual(managedCompletions, [[0, 'committed'], [1, 'committed']])
    })

    for (const failure of ['callback', 'caught write', 'caught SQL']) {
      for (const cleanupFailure of [false, true]) {
        it(`discards every managed notification after ${failure} failure with ${cleanupFailure ? 'failed' : 'successful'} rollback hooks`, async () => {
          const socket = await connect()
          const events = await subscribe(socket)
          const original = await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)
          const managedCompletions = []
          const contexts = [0, 1, 2].map(managedIndex => ({ ...seeded.admin, managedIndex, managedCompletions, failManagedCompletion: cleanupFailure && managedIndex !== 1 }))
          const owner = {}
          let sqlError
          await assert.rejects(api.transaction(async transaction => {
            await patch(seeded.project.id, { name: 'First pending change' }, contexts[0], transaction)
            const created = await post('Pending managed record', 'group-a', contexts[1], transaction)
            contexts[2].failManagedWrite = failure === 'caught write'
            const changed = patch(seeded.project.id, { name: 'Second pending change' }, contexts[2], transaction)
            if (failure === 'caught write') await assert.rejects(changed, error => assertWriteFailure(error, { cause: managedError, outcome: 'pending' }))
            else await changed
            assert.equal((await api.resources.policy_projects.get({ id: created.id, transaction, format: 'plain' }, seeded.admin)).name, 'Pending managed record')
            await drainSocketEvents(socket)
            assert.deepEqual(events, [])
            assert.deepEqual(managedCompletions, [])
            if (failure === 'callback') throw managedError
            if (failure === 'caught SQL') {
              try { await transaction.raw('SELECT * FROM jra_missing_managed_socket_table') } catch (error) { sqlError = error }
              assert.ok(sqlError)
            }
          }, owner), error => assertWriteFailure(error, { cause: failure === 'caught SQL' ? sqlError : managedError, outcome: 'rolledBack' }))
          await drainSocketEvents(socket)
          assert.deepEqual(events, [])
          assert.deepEqual(managedCompletions, [2, 1, 0].map(index => [index, 'rolledBack']))
          assert.deepEqual(owner.cleanupErrors, cleanupFailure
            ? [2, 0].map(operationIndex => ({
                phase: 'afterRollback', error: cleanupError, operationIndex, scopeName: 'policy_projects', method: 'patch'
              }))
            : [])
          assert.deepEqual(await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin), original)
          const next = await post('Following independent transaction')
          await drainSocketEvents(socket)
          assert.deepEqual(events.map(event => event.id), [next.id])
        })
      }
    }

    it('flushes the managed notification queue once through a later operation after the first completion chain fails', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      const managedCompletions = []
      const contexts = [0, 1, 2].map(managedIndex => ({ ...seeded.admin, managedIndex, managedCompletions, failManagedCompletion: managedIndex !== 1 }))
      const owner = {}
      await assert.rejects(api.transaction(async transaction => {
        for (const [index, context] of contexts.entries()) {
          await patch(seeded.project.id, { name: `Managed change ${index}` }, context, transaction)
        }
      }, owner), error => assertWriteFailure(error, { cause: cleanupError, outcome: 'committed' }))
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.id, event.action]), Array.from({ length: 3 }, () => [seeded.project.id, 'patch']))
      assert.deepEqual(managedCompletions, [0, 1, 2].map(index => [index, 'committed']))
      assert.deepEqual(owner.cleanupErrors, [{ phase: 'afterCommit', error: cleanupError, operationIndex: 2, scopeName: 'policy_projects', method: 'patch' }])
      assert.equal((await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)).name, 'Managed change 2')
    })

    it('attempts later queued notices after adapter delivery failures without undoing committed writes', async t => {
      const socket = await connect()
      const events = await subscribe(socket)
      const entered = Promise.withResolvers()
      const release = Promise.withResolvers()
      deliveryGate = release.promise
      gateEntered = entered.resolve
      const primary = new Error('First delivery failed')
      const secondary = new Error('Second delivery failed')
      const contexts = [{ ...seeded.admin, waitForDelivery: true }, { ...seeded.admin }, { ...seeded.admin }]
      const owner = {}
      const work = api.transaction(async transaction => {
        for (const [index, context] of contexts.entries()) await patch(seeded.project.id, { name: `Delivery change ${index}` }, context, transaction)
      }, owner)
      let attempts = 0
      try {
        await Promise.race([entered.promise, work.then(() => assert.fail('Completion gate was not reached'))])
        assert.equal(owner.transactionOutcome, 'committed')
        const original = api.io.in.bind(api.io)
        t.mock.method(api.io, 'in', (...args) => {
          const operator = original(...args)
          const fetch = operator.fetchSockets.bind(operator)
          operator.fetchSockets = async () => {
            const index = attempts++
            if (index < 2) throw index === 0 ? primary : secondary
            return fetch()
          }
          return operator
        })
      } finally { release.resolve() }
      await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: 'committed' }))
      assert.equal(attempts, 3)
      assert.deepEqual(contexts[0].cleanupErrors, [primary, secondary].map((error, broadcastIndex) => ({ phase: 'socketioBroadcast', broadcastIndex, error })))
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.id, event.action]), [[seeded.project.id, 'patch']])
      assert.equal((await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)).name, 'Delivery change 2')
      await drainSocketEvents(socket)
      assert.equal(events.length, 1, 'Failed notices must not be replayed by later completion chains')
    })

    for (const hiddenBy of ['policy', 'workspace']) {
      it(`notifies only visible CRUD changes when hidden by ${hiddenBy}`, async () => {
        const socket = await connect()
        const events = await subscribe(socket)
        const hiddenContext = hiddenBy === 'workspace'
          ? { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-b' } }
          : seeded.admin
        const hiddenGroup = hiddenBy === 'policy' ? 'group-b' : 'group-a'
        const visible = await post('Visible')
        const hidden = await post('Hidden', hiddenGroup, hiddenContext)
        for (const [record, context, group] of [[visible, seeded.admin, 'group-a'], [hidden, hiddenContext, hiddenGroup]]) {
          await patch(record.id, { name: 'Changed' }, context)
          await api.resources.policy_projects.put({ id: record.id, format: 'plain', returning: 'none', inputRecord: { name: 'Replaced', access_group: group } }, context)
          await api.resources.policy_projects.delete({ id: record.id }, context)
        }
        await drainSocketEvents(socket)
        assert.deepEqual(events.map(event => [event.id, event.type]), [
          [visible.id, 'resource.created'], [visible.id, 'resource.updated'], [visible.id, 'resource.updated'], [visible.id, 'resource.deleted']
        ])
      })
    }

    it('isolates two subscriber workspaces from the administrator writer context', async () => {
      const a = await connect()
      const b = await connect('other')
      const aEvents = await subscribe(a)
      const bEvents = await subscribe(b)
      const left = await post('Workspace A')
      const right = await post('Workspace B', 'group-a', { visibility: { all: true }, scopeValues: { workspaceId: 'workspace-b' } })
      await drainSocketEvents(a)
      await drainSocketEvents(b)
      assert.deepEqual(aEvents.map(event => event.id), [left.id])
      assert.deepEqual(bEvents.map(event => event.id), [right.id])
      const serialized = JSON.parse(JSON.stringify(api.io.sockets.sockets.get(a.id).data))
      assert.deepEqual(serialized.subscriptions[0].context, { visibility: { groups: ['group-a'] }, scopeValues: { workspaceId: 'workspace-a' } })
    })

    it('invalidates records entering or leaving policy visibility without notifying hidden-to-hidden changes', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      await patch(seeded.project.id, { access_group: 'group-b' })
      await patch(seeded.project.id, { name: 'Still hidden' })
      await patch(seeded.project.id, { access_group: 'group-a' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [seeded.project.id, seeded.project.id])
    })

    it('intersects client ID filters with the actual changed ID', async () => {
      const socket = await connect()
      const events = await subscribe(socket, { id: seeded.project.id })
      const other = await post('Other visible record')
      await patch(other.id, { name: 'Other changed' })
      await patch(seeded.project.id, { name: 'Matching changed' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [seeded.project.id])
    })

    it('supplies trusted subscriber context to admission and notification permissions', async () => {
      requireContext = true
      const socket = await connect()
      const events = await subscribe(socket)
      const created = await post('Context authorized')
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [created.id])
    })

    it('captures leaving visibility after reusing a PUT-create context', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      const context = { ...seeded.admin }
      const created = await api.resources.policy_projects.put({
        id: '90', format: 'plain', inputRecord: { name: 'Created by PUT', access_group: 'group-a' }
      }, context)
      await patch(created.id, { access_group: 'group-b' }, context)
      await api.resources.policy_projects.delete({ id: created.id }, context)
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.id, event.type]), [
        ['90', 'resource.created'], ['90', 'resource.updated']
      ])
    })

    it('notifies only committed visible non-atomic bulk writes', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      const result = await api.resources.policy_projects.bulkPost({
        atomic: false,
        format: 'plain',
        inputRecords: [
          { name: 'Visible bulk', access_group: 'group-a' },
          { name: 'Hidden bulk', access_group: 'group-b' },
          { access_group: 'group-a' }
        ]
      }, seeded.admin)
      assert.equal(result.meta.succeeded, 2)
      assert.equal(result.meta.failed, 1)
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [result.data[0].id])
    })

    it('discards notifications for rolled-back atomic bulk writes', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      await assert.rejects(api.resources.policy_projects.bulkPost({
        atomic: true, format: 'plain', inputRecords: [{ name: 'Rolled back', access_group: 'group-a' }, { access_group: 'group-a' }]
      }, seeded.admin))
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      const rows = (await api.resources.policy_projects.query({}, seeded.admin)).data
      assert.equal(rows.some(row => row.attributes.name === 'Rolled back'), false)
    })

    for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
      for (const cleanupFailure of [false, true]) {
        it(`keeps non-atomic ${method} delivery and state correct with ${cleanupFailure ? 'failed' : 'successful'} rollback hooks`, async () => {
          const ids = []
          const groups = ['group-a', 'group-a', 'group-b', 'group-a']
          if (method === 'bulkPost') ids.push('90', '91', '92', '93')
          else for (let index = 0; index < 4; index++) ids.push((await post(`Original ${index}`, groups[index])).id)
          const socket = await connect()
          const events = await subscribe(socket)
          failBulkIndex = 1
          failBulkCleanup = cleanupFailure
          const records = ids.map((id, index) => ({ id, name: `Changed ${index}`, access_group: groups[index] }))
          const params = method === 'bulkPost' ? { inputRecords: records } : method === 'bulkPatch' ? { operations: records.map(data => ({ id: data.id, data })) } : { ids }
          const context = { ...seeded.admin }
          const result = await api.resources.policy_projects[method]({ ...params, format: 'plain', atomic: false }, context)
          assert.equal(result.meta.succeeded, 3)
          assert.equal(result.meta.failed, 1)
          assert.deepEqual(result.errors.map(entry => [entry.index, entry.error.code, entry.error.message]), [[1, bulkError.code, bulkError.message]])
          assert.deepEqual(context.cleanupErrors, cleanupFailure ? [{ phase: 'afterRollback', error: cleanupError, bulkIndex: 1, operationIndex: 0, scopeName: 'policy_projects', method: method.slice(4).toLowerCase() }] : undefined)
          await drainSocketEvents(socket)
          const type = method === 'bulkPost' ? 'resource.created' : method === 'bulkPatch' ? 'resource.updated' : 'resource.deleted'
          assert.deepEqual(events.map(event => [event.id, event.type]), [[ids[0], type], [ids[3], type]])
          const stored = (await api.resources.policy_projects.query({ format: 'plain' }, seeded.admin)).data
          for (const [index, id] of ids.entries()) {
            const row = stored.find(record => record.id === id)
            if (method === 'bulkPost' ? index === 1 : method === 'bulkDelete' && index !== 1) assert.equal(row, undefined)
            else assert.equal(row.name, index === 1 ? `Original ${index}` : `Changed ${index}`)
          }
        })
      }
    }

    for (const token of ['viewer', 'missing-context']) {
      it(`suppresses notifications on ${token === 'viewer' ? 'query failure' : 'missing required subscriber context'}`, async () => {
        const socket = await connect(token)
        const events = await subscribe(socket)
        failQuery = true
        const created = await post('Write still succeeds')
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        assert.equal((await api.resources.policy_projects.get({ id: created.id, format: 'plain' }, seeded.admin)).name, 'Write still succeeds')
      })
    }

    it('emits no notification after a failed write rolls back', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      failWrite = true
      await assert.rejects(patch(seeded.project.id, { name: 'Rejected' }), /Write rejected before commit/)
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      assert.equal((await api.resources.policy_projects.get({ id: seeded.project.id, format: 'plain' }, seeded.admin)).name, 'Visible parent')
    })

    it('does not deliver a queued change to a replacement subscription with the same public ID', async () => {
      const socket = await connect()
      const events = await subscribe(socket)
      let release
      deliveryGate = new Promise(resolve => { release = resolve })
      const entered = new Promise(resolve => { gateEntered = resolve })
      const pending = post('Before replacement', 'group-a', { ...seeded.admin, waitForDelivery: true })
      try {
        await Promise.race([entered, pending.then(() => { throw new Error('Write did not reach the delivery gate') })])
        assert.equal((await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'view' })).success, true)
        await subscribe(socket)
      } finally { release() }
      await pending
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      const next = await post('After replacement')
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.id), [next.id])
    })

    for (const operation of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`applies subscriber visibility to ${operation} parent events`, async () => {
        if (operation === 'deleteRelationship') {
          for (const project of [seeded.project, seeded.hiddenProject]) {
            await api.resources.policy_projects.postRelationship({
              id: project.id, relationshipName: 'shared_tasks', relationshipData: [{ type: 'policy_tasks', id: seeded.task.id }]
            }, seeded.admin)
          }
        }
        const socket = await connect()
        const events = await subscribe(socket)
        for (const project of [seeded.project, seeded.hiddenProject]) {
          await api.resources.policy_projects[operation]({
            id: project.id, relationshipName: 'shared_tasks', relationshipData: [{ type: 'policy_tasks', id: seeded.task.id }]
          }, seeded.admin)
        }
        await drainSocketEvents(socket)
        assert.deepEqual(events.map(event => [event.id, event.action]), [[seeded.project.id, 'patch']])
      })
    }
  })
}

for (const transport of ['websocket', 'polling']) {
  describe(`Real Socket.IO SQL filters over ${transport} (${storageMode.mode})`, { timeout: 120000 }, () => {
    let api, server, knex, database, socket, rows, group
    const input = [
      { name: 'Alpha', rank: 0, note: 'special' },
      { name: 'alpha', rank: 1, note: 'other' },
      { name: 'Beta', rank: null, note: null },
      { name: 'Gamma', rank: 2, note: '' }
    ]
    before(async () => {
      database = await createTestDatabase()
      knex = database.knex
      const result = await createWebSocketApi(knex, {
        createApi: createQueryConformanceApi,
        socketio: { auth: { authenticate: () => ({ userId: 'viewer' }) } }
      })
      api = result.api
      server = result.server
      installSocketBarrier(api.io)
    })
    beforeEach(async () => {
      await cleanTables(knex, ['conformance_memberships', 'conformance_items', 'conformance_groups'])
      group = (await api.resources.groups.post({ inputRecord: { data: { type: 'groups', attributes: { name: 'First' } } } })).data
      rows = []
      for (const record of input) {
        rows.push((await api.resources.items.post({
          inputRecord: { data: { type: 'items', attributes: record, relationships: { group: { data: { type: 'groups', id: group.id } } } } }
        })).data)
      }
      socket = ioClient(`http://127.0.0.1:${server.address().port}`, { path: '/api/socket.io', transports: [transport], reconnection: false, autoConnect: false })
      const connected = waitForSocketEvent(socket, 'connect', 3000, 'connect_error')
      socket.connect()
      await connected
    })
    afterEach(() => { socket?.disconnect() })
    after(async () => {
      try { await closeWebSocketApi(api, server) } finally {
        try { await database?.close() } finally { storageMode.clearRegistry(knex) }
      }
    })

    for (const [filters, expected] of [
      [{ nameContains: 'ph' }, [0, 1]],
      [{ nameStarts: 'Al' }, databaseClient === 'better-sqlite3' ? [0, 1] : [0]],
      [{ nameEnds: 'ma' }, [3]],
      [{ range: [0, 1] }, [0, 1]],
      [{ ranks: [0, 2] }, [0, 3]],
      [{ ranks: [] }, []],
      [{ rank: null }, [2]],
      [{ otherRank: null }, [0, 1, 3]],
      [{ eitherText: 'special' }, [0]],
      [{ allWords: 'alpha,other' }, [1]],
      [{ anyWords: 'Gamma,special' }, [0, 3]],
      [{ relatedAllWords: 'Alpha,First' }, databaseClient === 'better-sqlite3' ? [0, 1] : [0]],
      [{ customRank: 1 }, [1, 3]]
    ]) {
      it(`uses SQL membership for updates and deletion with ${JSON.stringify(filters)}`, async () => {
        const subscribed = await socket.timeout(3000).emitWithAck('subscribe', { resource: 'items', filters })
        assert.equal(subscribed.success, true, JSON.stringify(subscribed))
        const events = []
        socket.on('subscription.update', event => events.push([event.id, event.type]))
        for (const row of rows) await api.resources.items.patch({ id: row.id, returning: 'none', inputRecord: { data: { type: 'items', attributes: { active: false } } } })
        for (const row of rows) await api.resources.items.delete({ id: row.id })
        await drainSocketEvents(socket)
        assert.deepEqual(events, [
          ...expected.map(index => [rows[index].id, 'resource.updated']),
          ...expected.map(index => [rows[index].id, 'resource.deleted'])
        ])
      })
    }

    it('captures relationship filter membership before removing the last matching child', async () => {
      const subscribed = await socket.timeout(3000).emitWithAck('subscribe', { resource: 'groups', filters: { childName: 'Alpha' } })
      assert.equal(subscribed.success, true, JSON.stringify(subscribed))
      const events = []
      socket.on('subscription.update', event => events.push([event.id, event.type]))
      await api.resources.groups.deleteRelationship({
        id: group.id, relationshipName: 'items', relationshipData: rows.slice(0, 2).map(row => ({ type: 'items', id: row.id }))
      })
      await drainSocketEvents(socket)
      assert.deepEqual(events, [[group.id, 'resource.updated']])
      assert.deepEqual((await api.resources.groups.query({ queryParams: { filters: { childName: 'Alpha' } } })).data, [])
    })
  })
}
