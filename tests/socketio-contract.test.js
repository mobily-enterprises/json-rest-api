import { describe, it, before, beforeEach, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { io as ioClient } from 'socket.io-client'
import { createWebSocketApi, closeWebSocketApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument, createRelationship, resourceIdentifier } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { installSocketBarrier, drainSocketEvents, waitForSocketEvent } from './helpers/socketio.js'

for (const transport of ['websocket', 'polling']) {
  describe(`Real Socket.IO ${transport} contracts (${storageMode.mode})`, { timeout: 20000 }, () => {
    let api, server, knex, denyQuery, failFinish, subscriptionGate, gateEntered, authFailure, authHookFailure, observedAuthFailure
    const clients = new Set()
    const commits = []
    let diagnosticFailureKind, rejectNotification, resourceFailure, failAdmissionLog, failDiagnosticLog, rejectAuth
    const diagnosticEvents = []
    const captureDiagnostic = (...args) => {
      if (failDiagnosticLog && String(args[0]).includes(failDiagnosticLog)) throw new Error('Authentication diagnostic sink failed')
      if (failAdmissionLog && String(args[0]).includes('Socket.IO subscribe error')) throw new Error('Diagnostic sink failed')
      diagnosticEvents.push(args)
    }
    const connect = async (token = 'valid', expectError = false) => {
      const socket = ioClient(`http://127.0.0.1:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token, userId: 'client-spoof', roles: ['admin'] },
        transports: [transport],
        reconnection: false,
        autoConnect: false
      })
      clients.add(socket)
      const result = waitForSocketEvent(socket, expectError ? 'connect_error' : 'connect', 3000, expectError ? undefined : 'connect_error')
      socket.connect()
      const error = await result
      return expectError ? error : socket
    }
    const subscribe = (socket, payload) => socket.timeout(3000).emitWithAck('subscribe', payload)
    const record = async (resource, attributes, relationships) => (await api.resources[resource].post({
      document: createJsonApiDocument(resource, attributes, relationships), format: 'jsonapi'
    })).data
    const bookFixture = async () => {
      const country = await record('countries', { name: 'Country', code: 'AA' })
      const book = await record('books', { title: 'Book' }, { country: createRelationship(resourceIdentifier('countries', country.id)) })
      const author = await record('authors', { name: 'Author' })
      return { country, book, author }
    }
    const notifications = socket => {
      const events = []
      socket.on('subscription.update', value => events.push(value))
      return events
    }

    before(async () => {
      knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
      const applyTitleFilter = (query, value) => {
        const adapter = api.knex.helpers.getStorageAdapter('books')
        query.where(adapter.translateColumn('title'), adapter.translateFilterValue('title', value))
      }
      const result = await createWebSocketApi(knex, {
        apiName: `socket-contract-${transport}`,
        countryFields: { accessKey: { type: 'string', hidden: true }, privateNote: { type: 'string', normallyHidden: true } },
        logging: { level: 'info', format: 'pretty', logger: { log: captureDiagnostic, warn: captureDiagnostic, error: captureDiagnostic } },
        bookSearchSchema: {
          customTitle: {
            type: 'string',
            applyFilter: applyTitleFilter
          }
        },
        socketio: {
          subscriptions: { maxPerSocket: 2 },
          auth: {
            authenticate: async ({ socket }) => {
              if (rejectAuth || authFailure) throw authFailure
              if (socket.handshake.auth?.token !== 'valid') throw new Error('Authentication required')
              return { userId: 'server-user', roles: ['reader'] }
            },
            onAuthenticationFailed: async ({ error }) => {
              observedAuthFailure = error
              if (authHookFailure) throw authHookFailure
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
            functionName: 'socket-query-permission',
            handler: ({ context }) => {
              if (rejectNotification && context.method === 'query' && context.originalContext?.auth?.userId === 'server-user') throw resourceFailure
              if (denyQuery && context.method === 'query' && context.originalContext?.auth?.userId === 'server-user') {
                throw Object.assign(new Error('Subscription query denied'), { code: 'QUERY_DENIED' })
              }
            }
          },
          beforeDataQuery: {
            functionName: 'socket-resource-diagnostic-query',
            handler: ({ context }) => {
              if (diagnosticFailureKind === 'query' && context.auth?.userId === 'server-user') throw resourceFailure
            }
          },
          subscriptionFilters: {
            functionName: 'socket-subscription-gate',
            handler: async () => {
              if (subscriptionGate) {
                gateEntered?.()
                await subscriptionGate
              }
            }
          },
          finish: {
            functionName: 'socket-finish-failure',
            afterFunction: 'socketio-broadcast',
            handler: ({ context }) => {
              if (failFinish && context.method === failFinish) throw new Error('Finish failed before commit')
            }
          },
          afterCommit: {
            functionName: 'socket-commit-observer',
            beforeFunction: 'socketio-broadcast-deferred',
            handler: ({ context }) => {
              commits.push({ method: context.method, completed: context.transaction.isCompleted() })
              if (diagnosticFailureKind === 'permission') rejectNotification = true
            }
          }
        }
      })
    })
    beforeEach(async () => {
      await cleanTables(knex, ['basic_book_authors', 'basic_books', 'basic_authors', 'basic_publishers', 'basic_countries'])
      denyQuery = false
      failFinish = false
      subscriptionGate = undefined
      gateEntered = undefined
      commits.length = 0
      diagnosticEvents.length = 0
      authFailure = undefined
      authHookFailure = undefined
      observedAuthFailure = undefined
      diagnosticFailureKind = undefined
      rejectNotification = false
      resourceFailure = undefined
      failAdmissionLog = false
      failDiagnosticLog = undefined
      rejectAuth = false
    })
    afterEach(() => {
      for (const socket of clients) socket.disconnect()
      clients.clear()
    })
    after(async () => {
      try { await closeWebSocketApi(api, server) } finally {
        try { await knex.destroy() } finally { storageMode.clearRegistry(knex) }
      }
    })

    it('rejects failed authentication and uses server-authenticated identity', async () => {
      assert.match((await connect('invalid', true)).message, /Authentication required/)
      const socket = await connect()
      assert.deepEqual(api.io.sockets.sockets.get(socket.id).data.auth, { userId: 'server-user', roles: ['reader'] })
    })

    for (const value of [null, undefined]) {
      it(`rejects authentication when the callback throws ${value}`, async () => {
        rejectAuth = true
        authFailure = value
        const error = await connect('valid', true)
        assert.equal(error.message, 'Authentication failed')
        assert.equal(observedAuthFailure, value)
        assert.equal(api.io.sockets.sockets.size, 0)
      })
    }

    for (const message of ['auth failure handler', 'authentication failed']) {
      it(`preserves authentication rejection when ${message} logging throws`, async () => {
        authFailure = new Error('Original authentication rejection')
        authHookFailure = new Error('Failure hook rejection')
        failDiagnosticLog = message
        assert.equal((await connect('valid', true)).message, authFailure.message)
        assert.equal(observedAuthFailure, authFailure)
        assert.equal(api.io.sockets.sockets.size, 0)
      })
    }

    it('bounds authentication and failure-hook diagnostics while retaining the primary error', async () => {
      authFailure = new Error('Authentication rejected')
      authFailure.details = { upload: Buffer.from('PRIVATE_SOCKET_BYTES'), text: 'x'.repeat(100000) }
      authHookFailure = new Error('Failure hook rejected')
      authHookFailure.details = { text: 'y'.repeat(100000) }
      assert.equal((await connect('valid', true)).message, authFailure.message)
      assert.equal(observedAuthFailure, authFailure)
      const events = diagnosticEvents.filter(args => /authentication failed|auth failure handler/.test(String(args[0])))
      assert.equal(events.length, 2)
      for (const event of events) {
        const output = JSON.stringify(event)
        assert.ok(output.length < 30000, `Diagnostic length: ${output.length}`)
        assert.doesNotMatch(output, /PRIVATE_SOCKET_BYTES/)
      }
      assert.equal(authFailure.details.upload.toString(), 'PRIVATE_SOCKET_BYTES')
      assert.equal(authFailure.details.text.length, 100000)
      assert.equal(authHookFailure.details.text.length, 100000)
    })

    it('rejects a subscription denied by resource query permissions', async () => {
      const socket = await connect()
      denyQuery = true
      const result = await subscribe(socket, { resource: 'countries' })
      assert.equal(result.error?.code, 'QUERY_DENIED')
      const events = notifications(socket)
      await record('countries', { name: 'Hidden', code: 'AA' })
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
    })

    it('retains the admission rejection when its diagnostic sink throws', async () => {
      const socket = await connect()
      denyQuery = true
      failAdmissionLog = true
      const response = await subscribe(socket, { resource: 'countries' })
      assert.equal(response.error.code, 'QUERY_DENIED')
      assert.equal(response.error.message, 'Subscription query denied')
      assert.deepEqual(api.io.sockets.sockets.get(socket.id).data.subscriptions, [])
    })

    for (const admission of ['subscribe', 'subscribe-event', 'restore-subscriptions']) {
      it(`retains successful ${admission} when its success diagnostic throws`, async () => {
        const socket = await connect()
        failDiagnosticLog = ' subscribed to '
        const subscription = { resource: 'countries', subscriptionId: 'logged-success' }
        if (admission === 'subscribe-event') {
          const event = waitForSocketEvent(socket, 'subscription.created', 2000, 'subscription.error')
          socket.emit('subscribe', subscription)
          assert.equal((await event).subscriptionId, subscription.subscriptionId)
        } else if (admission === 'subscribe') {
          const result = await subscribe(socket, subscription)
          assert.equal(result.success, true)
          assert.equal(result.data.subscriptionId, subscription.subscriptionId)
        } else {
          const result = await socket.timeout(3000).emitWithAck(admission, { subscriptions: [subscription] })
          assert.deepEqual(result, { success: true, restored: [subscription.subscriptionId], failed: [] })
        }
        const serverSocket = api.io.sockets.sockets.get(socket.id)
        assert.deepEqual(serverSocket.data.subscriptions.map(item => item.id), [subscription.subscriptionId])
        assert.equal(serverSocket.rooms.has('countries:updates'), true)
      })
    }

    for (const value of [null, undefined]) {
      for (const admission of ['subscribe', 'subscribe-event', 'restore-subscriptions']) {
        it(`reports ${value} room-join rejection through ${admission}`, async () => {
          const socket = await connect()
          const serverSocket = api.io.sockets.sockets.get(socket.id)
          const originalJoin = serverSocket.join
          serverSocket.join = async () => { throw value }
          const subscription = { resource: 'countries', subscriptionId: 'join-rejection' }
          try {
            let failure
            if (admission === 'subscribe-event') {
              const event = waitForSocketEvent(socket, 'subscription.error')
              socket.emit('subscribe', subscription)
              failure = await event
            } else if (admission === 'subscribe') {
              failure = (await subscribe(socket, subscription)).error
            } else {
              const response = await socket.timeout(3000).emitWithAck(admission, { subscriptions: [subscription] })
              assert.equal(response.success, true)
              assert.deepEqual(response.restored, [])
              assert.equal(response.failed[0].subscriptionId, subscription.subscriptionId)
              failure = response.failed[0].error
            }
            assert.deepEqual(failure, { code: 'SUBSCRIBE_ERROR', message: 'Subscription failed' })
            assert.deepEqual(serverSocket.data.subscriptions, [])
            assert.equal(serverSocket.rooms.has('countries:updates'), false)
          } finally {
            serverSocket.join = originalJoin
          }
          assert.equal((await subscribe(socket, subscription)).success, true)
        })
      }
    }

    it('cleans a room join that completes after disconnection', async () => {
      const socket = await connect()
      const serverSocket = api.io.sockets.sockets.get(socket.id)
      const adapter = api.io.sockets.adapter
      const originalAddAll = adapter.addAll
      const entered = Promise.withResolvers()
      const release = Promise.withResolvers()
      const completed = Promise.withResolvers()
      const handler = serverSocket.listeners('subscribe')[0]
      serverSocket.removeListener('subscribe', handler)
      serverSocket.on('subscribe', async (...args) => {
        try { await handler(...args) } finally { completed.resolve() }
      })
      adapter.addAll = async (id, rooms) => {
        if (id === socket.id && rooms.has('countries:updates')) {
          entered.resolve()
          await release.promise
        }
        return originalAddAll.call(adapter, id, rooms)
      }
      try {
        socket.emit('subscribe', { resource: 'countries', subscriptionId: 'disconnected-join' })
        await entered.promise
        serverSocket.disconnect(true)
        release.resolve()
        await completed.promise
        assert.equal(serverSocket.connected, false)
        assert.deepEqual({
          subscriptions: serverSocket.data.subscriptions.length,
          roomMember: adapter.rooms.get('countries:updates')?.has(serverSocket.id) || false,
          trackedSocket: adapter.sids.has(serverSocket.id)
        }, { subscriptions: 0, roomMember: false, trackedSocket: false })
      } finally {
        release.resolve()
        adapter.addAll = originalAddAll
      }
    })

    it('waits for room departure before acknowledging unsubscribe and preserves a concurrent subscription', async () => {
      const socket = await connect()
      const serverSocket = api.io.sockets.sockets.get(socket.id)
      await subscribe(socket, { resource: 'countries', subscriptionId: 'old' })
      const originalLeave = serverSocket.leave
      const entered = Promise.withResolvers()
      const release = Promise.withResolvers()
      serverSocket.leave = async room => {
        entered.resolve()
        await release.promise
        return originalLeave.call(serverSocket, room)
      }
      let acknowledged = false
      const removal = socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'old' })
        .then(result => { acknowledged = true; return result })
      try {
        await entered.promise
        await drainSocketEvents(socket)
        assert.equal(acknowledged, false)
        const replacement = subscribe(socket, { resource: 'countries', subscriptionId: 'new' })
        await drainSocketEvents(socket)
        release.resolve()
        assert.deepEqual(await removal, { success: true })
        assert.equal((await replacement).success, true)
        assert.equal(serverSocket.rooms.has('countries:updates'), true)
        assert.deepEqual(serverSocket.data.subscriptions.map(item => item.id), ['new'])
      } finally {
        release.resolve()
        await removal
        serverSocket.leave = originalLeave
      }
    })

    it('reports a failed room departure while retaining logical unsubscribe', async () => {
      const socket = await connect()
      const serverSocket = api.io.sockets.sockets.get(socket.id)
      await subscribe(socket, { resource: 'countries', subscriptionId: 'old' })
      const originalLeave = serverSocket.leave
      const rejection = null
      serverSocket.leave = async () => { throw rejection }
      failDiagnosticLog = 'Socket.IO unsubscribe error'
      try {
        const result = await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'old' })
        assert.deepEqual(result.error, { code: 'UNSUBSCRIBE_ERROR', message: 'Unsubscribe failed' })
        assert.deepEqual(serverSocket.data.subscriptions, [])
      } finally {
        serverSocket.leave = originalLeave
        failDiagnosticLog = undefined
      }
      assert.equal((await subscribe(socket, { resource: 'countries', subscriptionId: 'new' })).success, true)
      assert.deepEqual(await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'new' }), { success: true })
      assert.equal(serverSocket.rooms.has('countries:updates'), false)
    })

    it('reports a room-join error even when its code accessor throws', async () => {
      const socket = await connect()
      const serverSocket = api.io.sockets.sockets.get(socket.id)
      const originalJoin = serverSocket.join
      const error = Object.defineProperty(new Error('Room join failed'), 'code', {
        get () { throw new Error('Invalid error code accessor') }
      })
      serverSocket.join = async () => { throw error }
      try {
        const response = await subscribe(socket, { resource: 'countries' })
        assert.deepEqual(response.error, { code: 'SUBSCRIBE_ERROR', message: 'Room join failed' })
        assert.deepEqual(serverSocket.data.subscriptions, [])
      } finally {
        serverSocket.join = originalJoin
      }
    })

    for (const admission of ['subscribe', 'restore-subscriptions']) {
      it(`redacts hidden resource fields in ${admission} admission diagnostics`, async () => {
        const socket = await connect()
        resourceFailure = new Error('Subscription admission rejected')
        resourceFailure.details = { accessKey: 'PRIVATE_ADMISSION_KEY', privateNote: 'PRIVATE_ADMISSION_NOTE', visible: 'retained' }
        rejectNotification = true
        const subscription = { resource: 'countries', subscriptionId: 'private-admission' }
        const response = await socket.timeout(3000).emitWithAck(admission, admission === 'subscribe'
          ? subscription
          : { subscriptions: [subscription] })
        assert.equal(admission === 'subscribe' ? response.error.message : response.failed[0].error.message, resourceFailure.message)
        assert.deepEqual(api.io.sockets.sockets.get(socket.id).data.subscriptions, [])
        const event = diagnosticEvents.find(args => String(args[0]).includes('Socket.IO subscribe error'))
        assert.ok(event, 'Expected subscription admission diagnostic')
        assert.equal(event[1].scopeName, 'countries')
        assert.equal(event[1].operation, 'subscribe')
        assert.equal(event[1].phase, 'admission')
        const output = JSON.stringify(event)
        assert.doesNotMatch(output, /PRIVATE_ADMISSION_KEY|PRIVATE_ADMISSION_NOTE/)
        assert.match(output, /retained/)
        assert.equal(resourceFailure.details.accessKey, 'PRIVATE_ADMISSION_KEY')
        assert.equal(resourceFailure.details.privateNote, 'PRIVATE_ADMISSION_NOTE')
      })
    }

    for (const phase of ['query', 'permission']) {
      it(`redacts hidden resource fields in notification ${phase} diagnostics`, async () => {
        const socket = await connect()
        assert.equal((await subscribe(socket, { resource: 'countries' })).success, true)
        const events = notifications(socket)
        resourceFailure = new Error('Subscription read rejected')
        resourceFailure.details = { accessKey: 'PRIVATE_SOCKET_KEY', privateNote: 'PRIVATE_SOCKET_NOTE', visible: 'retained' }
        diagnosticFailureKind = phase
        await record('countries', { name: 'Country', code: 'AA' })
        await drainSocketEvents(socket)
        assert.deepEqual(events, [])
        const event = diagnosticEvents.find(args => String(args[0]).includes(phase === 'query'
          ? 'Socket.IO subscription query failed'
          : 'Socket.IO notification permission check failed'))
        assert.ok(event, 'Expected the selected Socket.IO diagnostic boundary')
        const output = JSON.stringify(event)
        assert.doesNotMatch(output, /PRIVATE_SOCKET_KEY|PRIVATE_SOCKET_NOTE/)
        assert.match(output, /retained/)
        assert.equal(resourceFailure.details.accessKey, 'PRIVATE_SOCKET_KEY')
        assert.equal(resourceFailure.details.privateNote, 'PRIVATE_SOCKET_NOTE')
      })
    }

    for (const phase of ['query', 'permission']) {
      it(`retains resource success when notification ${phase} warning logging throws`, async () => {
        const socket = await connect()
        assert.equal((await subscribe(socket, { resource: 'countries' })).success, true)
        const events = notifications(socket)
        const permitted = await connect()
        api.io.sockets.sockets.get(permitted.id).data.auth.userId = 'other-user'
        assert.equal((await subscribe(permitted, { resource: 'countries' })).success, true)
        const permittedEvents = notifications(permitted)
        resourceFailure = new Error('Notification access rejected')
        diagnosticFailureKind = phase
        failDiagnosticLog = phase === 'query'
          ? 'Socket.IO subscription query failed'
          : 'Socket.IO notification permission check failed'
        const created = await record('countries', { name: 'Persisted despite notification failure', code: 'AA' })
        await drainSocketEvents(socket)
        await drainSocketEvents(permitted)
        assert.deepEqual(events, [])
        assert.equal(permittedEvents.length, 1)
        assert.equal(permittedEvents[0].id, created.id)
        const result = await api.resources.countries.get({ id: created.id, format: 'jsonapi' })
        assert.equal(result.data.attributes.name, 'Persisted despite notification failure')
        assert.equal(commits.some(entry => entry.method === 'post' && entry.completed), true)
      })
    }

    it('rechecks query permission before sending a later notification', async () => {
      const socket = await connect()
      assert.equal((await subscribe(socket, { resource: 'countries' })).success, true)
      const events = notifications(socket)
      denyQuery = true
      await record('countries', { name: 'Hidden after subscription', code: 'AA' })
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
    })

    for (const resource of ['missing', '__proto__', 'constructor', 'toString']) {
      it(`rejects unknown resource ${resource}`, async () => {
        const socket = await connect()
        assert.equal((await subscribe(socket, { resource })).error?.code, 'RESOURCE_NOT_FOUND')
      })
    }
    for (const filters of [null, [], 'name', true, 7]) {
      it(`rejects non-object filters ${JSON.stringify(filters)}`, async () => {
        const socket = await connect()
        assert.equal((await subscribe(socket, { resource: 'countries', filters })).error?.code, 'INVALID_FILTERS')
      })
    }
    for (const option of ['include', 'fields']) {
      it(`rejects unused notification option ${option} explicitly`, async () => {
        const socket = await connect()
        assert.equal((await subscribe(socket, { resource: 'countries', [option]: option === 'include' ? [] : {} })).error?.code, 'UNSUPPORTED_OPTION')
      })
    }

    it('rejects unknown and prototype-like filters without installing a subscription', async () => {
      const socket = await connect()
      for (const name of ['missing', '__proto__', 'constructor', 'toString']) {
        const filters = Object.fromEntries([[name, 'value']])
        assert.equal((await subscribe(socket, { resource: 'countries', filters })).error?.code, 'INVALID_FILTERS')
      }
      assert.equal((await subscribe(socket, { resource: 'countries' })).success, true)
    })

    it('rejects invalid and duplicate subscription IDs without replacing existing subscriptions', async () => {
      const socket = await connect()
      for (const subscriptionId of ['', 0, false, {}, []]) {
        assert.equal((await subscribe(socket, { resource: 'countries', subscriptionId })).error?.code, 'INVALID_SUBSCRIPTION_ID')
      }
      assert.equal((await subscribe(socket, { resource: 'countries', subscriptionId: 'original' })).success, true)
      assert.equal((await subscribe(socket, { resource: 'books', subscriptionId: 'original' })).error?.code, 'SUBSCRIPTION_EXISTS')
      const events = notifications(socket)
      await record('countries', { name: 'Country', code: 'AA' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.resource, event.subscriptionId]), [['countries', 'original']])
    })

    it('enforces the subscription limit after concurrent async admission hooks', async () => {
      const socket = await connect()
      let release
      subscriptionGate = new Promise(resolve => { release = resolve })
      let entered = 0
      const allEntered = new Promise(resolve => { gateEntered = () => { if (++entered === 3) resolve() } })
      const pending = ['one', 'two', 'three'].map(subscriptionId => subscribe(socket, { resource: 'countries', subscriptionId }))
      await allEntered
      release()
      const results = await Promise.all(pending)
      assert.equal(results.filter(result => result.success).length, 2)
      assert.equal(results.filter(result => result.error?.code === 'SUBSCRIPTION_LIMIT').length, 1)
    })

    it('notifies every matching subscription on one socket', async () => {
      const socket = await connect()
      await subscribe(socket, { resource: 'countries', subscriptionId: 'one' })
      await subscribe(socket, { resource: 'countries', subscriptionId: 'two', filters: { name: 'Country' } })
      const events = notifications(socket)
      await record('countries', { name: 'Country', code: 'AA' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.subscriptionId).sort(), ['one', 'two'])
    })

    it('uses explicit change names and string IDs for CRUD and both PUT outcomes', async () => {
      const socket = await connect()
      await subscribe(socket, { resource: 'countries' })
      const events = notifications(socket)
      await record('countries', { name: 'Posted', code: 'AA' })
      for (const name of ['PUT-created', 'PUT-replaced']) {
        await api.resources.countries.put({ id: '701', document: createJsonApiDocument('countries', { name }), format: 'jsonapi' })
      }
      await api.resources.countries.patch({ id: '701', document: createJsonApiDocument('countries', { name: 'Patched' }), format: 'jsonapi' })
      await api.resources.countries.delete({ id: '701' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.type, event.action]), [
        ['resource.created', 'post'], ['resource.created', 'put'], ['resource.updated', 'put'],
        ['resource.updated', 'patch'], ['resource.deleted', 'delete']
      ])
      assert.ok(events.every(event => typeof event.id === 'string'))
      assert.deepEqual(events.at(-1).deletedRecord, { id: '701' })
    })

    it('preserves subscription records across the JSON encoding used by the Redis adapter', async () => {
      const socket = await connect()
      await subscribe(socket, { resource: 'countries', subscriptionId: 'serializable', filters: { name: 'Country' } })
      const data = JSON.parse(JSON.stringify(api.io.sockets.sockets.get(socket.id).data))
      const saved = Object.values(data.subscriptions).find(item => item.id === 'serializable')
      assert.equal(saved?.resource, 'countries')
      assert.deepEqual(saved?.filters, { name: 'Country' })
      assert.equal(saved?.auth.userId, 'server-user')
    })

    it('notifies when an update enters or leaves a filtered result', async () => {
      const { book } = await bookFixture()
      const socket = await connect()
      await subscribe(socket, { resource: 'books', filters: { title: 'Book' } })
      const events = notifications(socket)
      for (const title of ['Other', 'Book']) {
        await api.resources.books.patch({ id: book.id, document: createJsonApiDocument('books', { title }), format: 'jsonapi' })
        await drainSocketEvents(socket)
      }
      assert.deepEqual(events.map(event => [String(event.id), event.action]), [[book.id, 'patch'], [book.id, 'patch']])
    })

    it('uses the actual custom SQL predicate without a separate record predicate', async () => {
      const socket = await connect()
      assert.equal((await subscribe(socket, { resource: 'books', subscriptionId: 'matching', filters: { customTitle: 'Book' } })).success, true)
      assert.equal((await subscribe(socket, { resource: 'books', subscriptionId: 'different', filters: { customTitle: 'Other' } })).success, true)
      const events = notifications(socket)
      const { book } = await bookFixture()
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.subscriptionId), ['matching'])
      for (const title of ['Book', 'Other']) {
        const result = await api.resources.books.query({ format: 'jsonapi', queryParams: { filters: { customTitle: title } } })
        assert.deepEqual(result.data.map(row => row.id), title === 'Book' ? [book.id] : [])
      }
    })

    it('keeps remaining subscriptions active when one is removed', async () => {
      const socket = await connect()
      for (const subscriptionId of ['one', 'two']) await subscribe(socket, { resource: 'countries', subscriptionId })
      assert.equal((await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'one' })).success, true)
      const events = notifications(socket)
      await record('countries', { name: 'Country', code: 'AA' })
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => event.subscriptionId), ['two'])
      assert.equal((await socket.timeout(3000).emitWithAck('unsubscribe', { subscriptionId: 'two' })).success, true)
      await record('countries', { name: 'Another', code: 'BB' })
      await drainSocketEvents(socket)
      assert.equal(events.length, 1)
    })

    it('reports restored and failed subscriptions individually', async () => {
      const socket = await connect()
      const result = await socket.timeout(3000).emitWithAck('restore-subscriptions', {
        subscriptions: [
          { resource: 'countries', subscriptionId: 'valid' },
          { resource: 'missing', subscriptionId: 'missing' },
          { resource: 'countries', subscriptionId: 'valid' }
        ]
      })
      assert.equal(result.success, true)
      assert.deepEqual(result.restored, ['valid'])
      assert.deepEqual(result.failed.map(item => item.error.code), ['RESOURCE_NOT_FOUND', 'SUBSCRIPTION_EXISTS'])
    })

    it('does not mistake a non-function event argument for an acknowledgement', async () => {
      const socket = await connect()
      const event = waitForSocketEvent(socket, 'subscription.created')
      socket.emit('subscribe', { resource: 'countries' }, 'not-an-acknowledgement')
      assert.equal((await event).resource, 'countries')
    })

    it('emits no change when a finish hook fails before commit', async () => {
      const socket = await connect()
      await subscribe(socket, { resource: 'countries' })
      const events = notifications(socket)
      failFinish = 'post'
      await assert.rejects(record('countries', { name: 'Rejected', code: 'AA' }), /Finish failed before commit/)
      assert.deepEqual((await api.resources.countries.query()).data, [])
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      assert.deepEqual(commits, [])
      failFinish = false
      await record('countries', { name: 'Committed', code: 'AA' })
      await drainSocketEvents(socket)
      assert.equal(events.length, 1)
      assert.ok(commits.every(entry => entry.completed))
    })

    it('notifies HTTP writes while HTTP validation failures emit nothing', async () => {
      const socket = await connect()
      await subscribe(socket, { resource: 'countries' })
      const events = notifications(socket)
      const url = `http://127.0.0.1:${server.address().port}/api/countries`
      const send = attributes => fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.api+json' },
        body: JSON.stringify(createJsonApiDocument('countries', attributes))
      })
      const created = await send({ name: 'HTTP-created', code: 'AA' })
      const createdText = await created.text()
      assert.equal(created.status, 201)
      const body = JSON.parse(createdText)
      await drainSocketEvents(socket)
      assert.deepEqual(events.map(event => [event.id, event.type]), [[body.data.id, 'resource.created']])
      const rejected = await send({})
      const rejectedText = await rejected.text()
      assert.equal(rejected.status, 422)
      assert.ok(Array.isArray(JSON.parse(rejectedText).errors))
      await drainSocketEvents(socket)
      assert.equal(events.length, 1)
    })

    for (const operation of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`notifies the parent once after ${operation} commits`, async () => {
        const { book, author } = await bookFixture()
        if (operation === 'deleteRelationship') await api.resources.books.postRelationship({ id: book.id, relationshipName: 'authors', relationshipData: [resourceIdentifier('authors', author.id)] })
        const socket = await connect()
        await subscribe(socket, { resource: 'books', filters: { title: 'Book' } })
        const events = notifications(socket)
        commits.length = 0
        await api.resources.books[operation]({ id: book.id, relationshipName: 'authors', relationshipData: [resourceIdentifier('authors', author.id)] })
        await drainSocketEvents(socket)
        assert.deepEqual(events.map(event => [event.resource, String(event.id), event.action]), [['books', book.id, 'patch']])
        const linkage = await api.resources.books.getRelationship({ id: book.id, relationshipName: 'authors' })
        assert.deepEqual(linkage.data.map(item => item.id), operation === 'deleteRelationship' ? [] : [author.id])
        assert.deepEqual(commits, (operation === 'patchRelationship' ? [operation, 'patch'] : [operation]).map(method => ({ method, completed: true })))
      })
    }

    it('does not notify rejected relationship mutations', async () => {
      const { book } = await bookFixture()
      const socket = await connect()
      await subscribe(socket, { resource: 'books' })
      const events = notifications(socket)
      await assert.rejects(api.resources.books.postRelationship({ id: book.id, relationshipName: 'authors', relationshipData: [resourceIdentifier('authors', '9999')] }))
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      assert.deepEqual((await api.resources.books.getRelationship({ id: book.id, relationshipName: 'authors' })).data, [])
    })

    for (const operation of ['postRelationship', 'patchRelationship', 'deleteRelationship']) {
      it(`notifies parent and changed child once for reverse ${operation}`, async () => {
        const { book } = await bookFixture()
        const publisher = await record('publishers', { name: 'Publisher' })
        if (operation === 'deleteRelationship') await api.resources.publishers.postRelationship({ id: publisher.id, relationshipName: 'books', relationshipData: [resourceIdentifier('books', book.id)] })
        const socket = await connect()
        await subscribe(socket, { resource: 'publishers' })
        await subscribe(socket, { resource: 'books' })
        const events = notifications(socket)
        commits.length = 0
        await api.resources.publishers[operation]({ id: publisher.id, relationshipName: 'books', relationshipData: [resourceIdentifier('books', book.id)] })
        await drainSocketEvents(socket)
        assert.deepEqual(events.map(event => [event.resource, String(event.id), event.action]).sort(), [['books', book.id, 'patch'], ['publishers', publisher.id, 'patch']].sort())
        assert.deepEqual(commits, (operation === 'patchRelationship' ? [operation, 'patch', 'patch'] : [operation, 'patch']).map(method => ({ method, completed: true })))
      })
    }

    it('rolls back a relationship and its child changes without any queued events', async () => {
      const { book } = await bookFixture()
      const publisher = await record('publishers', { name: 'Publisher' })
      const socket = await connect()
      await subscribe(socket, { resource: 'publishers' })
      await subscribe(socket, { resource: 'books' })
      const events = notifications(socket)
      failFinish = 'postRelationship'
      commits.length = 0
      await assert.rejects(api.resources.publishers.postRelationship({ id: publisher.id, relationshipName: 'books', relationshipData: [resourceIdentifier('books', book.id)] }), /Finish failed before commit/)
      await drainSocketEvents(socket)
      assert.deepEqual(events, [])
      assert.deepEqual(commits, [])
      assert.deepEqual((await api.resources.publishers.getRelationship({ id: publisher.id, relationshipName: 'books' })).data, [])
    })

    it('does not notify a filtered subscriber about a nonmatching relationship parent', async () => {
      const { book, author } = await bookFixture()
      const socket = await connect()
      await subscribe(socket, { resource: 'books', filters: { title: 'Other' } })
      const events = notifications(socket)
      for (const operation of ['postRelationship', 'deleteRelationship']) {
        await api.resources.books[operation]({ id: book.id, relationshipName: 'authors', relationshipData: [resourceIdentifier('authors', author.id)] })
        await drainSocketEvents(socket)
      }
      assert.deepEqual(events, [])
    })
  })
}
