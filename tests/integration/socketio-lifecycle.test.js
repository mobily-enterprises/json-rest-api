import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from 'redis'
import { io as ioClient } from 'socket.io-client'
import { Server } from 'socket.io'
import { createTestDatabase } from '../helpers/test-database.js'
import { storageMode } from '../helpers/storage-mode.js'
import { waitForSocketEvent } from '../helpers/socketio.js'
import { closeWebSocketApi, createConformanceApi, createWebSocketApi } from '../fixtures/api-configs.js'

if (!process.env.JSON_REST_API_REDIS_CONNECTION) throw new Error('Socket lifecycle integration requires the disposable Redis runner')
const redis = JSON.parse(process.env.JSON_REST_API_REDIS_CONNECTION)

describe(`Redis secondary failures (${storageMode.mode})`, { timeout: 10000 }, () => {
  let database, api, server, failWarning, failInfo
  const warnings = []
  const clients = []
  beforeEach(async () => {
    warnings.length = 0
    clients.length = 0
    failWarning = null
    failInfo = null
    database = await createTestDatabase()
    ;({ api, server } = await createWebSocketApi(database.knex, {
      createApi: createConformanceApi,
      startSockets: false,
      logging: {
        logger: {
          log: () => {},
          error: () => {},
          info: () => {
            if (failInfo === 'throw') throw new Error('Info writer threw')
            if (failInfo === 'reject') return Promise.reject(new Error('Info writer rejected'))
          },
          warn: (...args) => {
            warnings.push(args)
            if (failWarning === 'throw') throw new Error('Warning writer threw')
            if (failWarning === 'reject') return Promise.reject(new Error('Warning writer rejected'))
          }
        }
      }
    }))
  })
  afterEach(async () => {
    try { await closeWebSocketApi(api, server) } finally {
      for (const client of clients) if (client.isOpen) client.destroy()
      try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) }
    }
  })

  it('reports failed destruction without waiting for a stranded connection attempt', async t => {
    const primary = Object.freeze(new Error('Redis connection failed'))
    const cleanup = Object.freeze(new Error('Redis destruction failed before closing'))
    const probe = createClient(redis)
    let prototype = Object.getPrototypeOf(probe)
    while (!Object.hasOwn(prototype, 'duplicate')) prototype = Object.getPrototypeOf(prototype)
    const duplicate = prototype.duplicate
    let markConnected, finishConnection, markDestroyed
    const connected = new Promise(resolve => { markConnected = resolve })
    const stranded = new Promise(resolve => { finishConnection = resolve })
    const destroyed = new Promise(resolve => { markDestroyed = resolve })
    t.mock.method(prototype, 'duplicate', function (...args) {
      const sub = duplicate.apply(this, args)
      clients.push(this, sub)
      for (const [index, client] of clients.entries()) {
        const connect = client.connect.bind(client)
        const destroy = client.destroy.bind(client)
        t.mock.method(client, 'connect', async () => {
          await connect()
          if (index === 1) markConnected()
          await connected
          if (index === 0) throw primary
          await stranded
          return client
        })
        t.mock.method(client, 'destroy', () => {
          if (index === 0) throw cleanup
          destroy()
          markDestroyed()
        })
      }
      return sub
    })
    let failure
    const starting = api.startSocketServer(server, { redis }).catch(error => { failure = error })
    try {
      await Promise.race([destroyed, starting])
      await new Promise(resolve => setImmediate(resolve))
      assert.ok(failure instanceof AggregateError, 'cleanup failure must be reported while the failed-to-cancel attempt is still pending')
      assert.equal(failure.cause, primary)
      assert.deepEqual(failure.errors, [primary, cleanup])
      assert.equal(clients[1].isOpen, false, 'the later client still receives cleanup')
    } finally {
      finishConnection()
      await starting
      t.mock.restoreAll()
    }
  })

  it('configures the adapter before attaching to the caller HTTP server', async t => {
    const primary = Object.freeze(new Error('Redis adapter setup failed'))
    const listeners = Object.fromEntries(['request', 'upgrade', 'close', 'listening'].map(event => [event, server.listeners(event)]))
    const adapter = Server.prototype.adapter
    let configured = 0
    t.mock.method(Server.prototype, 'adapter', function (...args) {
      if (args.length && ++configured === 2) throw primary
      return adapter.apply(this, args)
    })
    try {
      await assert.rejects(api.startSocketServer(server, { redis }), error => error === primary)
      assert.equal(configured, 2)
      assert.equal(api.io, undefined)
      assert.equal(api.vars.socketIORedisClients, undefined)
      assert.equal(server.listening, true)
      for (const [event, original] of Object.entries(listeners)) assert.deepEqual(server.listeners(event), original, event)
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/groups`)).status, 200)
    } finally { t.mock.restoreAll() }
    await api.startSocketServer(server, { redis })
    assert.ok(api.io)
  })

  for (const rejection of ['throw', 'reject']) {
    it(`preserves successful Redis startup when info writer ${rejection}s`, async () => {
      failInfo = rejection
      const io = await api.startSocketServer(server, { redis })
      clients.push(...Object.values(api.vars.socketIORedisClients))
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(api.io, io)
      assert.ok(clients.every(client => client.isReady))
    })

    it(`retains failed startup and attempts both clients when destroy ${rejection}s`, async t => {
      const primary = Object.freeze(new Error('Redis setup failed'))
      const cleanup = Object.freeze(new Error('Redis destruction failed'))
      const probe = createClient(redis)
      let prototype = Object.getPrototypeOf(probe)
      while (!Object.hasOwn(prototype, 'duplicate')) prototype = Object.getPrototypeOf(prototype)
      const duplicate = prototype.duplicate
      const destroyed = []
      let markConnected
      const connected = new Promise(resolve => { markConnected = resolve })
      t.mock.method(prototype, 'duplicate', function (...args) {
        const sub = duplicate.apply(this, args)
        clients.push(this, sub)
        for (const [index, client] of clients.entries()) {
          const connect = client.connect.bind(client)
          const destroy = client.destroy.bind(client)
          t.mock.method(client, 'connect', async () => {
            await connect()
            if (index === 1) markConnected()
            await connected
            if (index === 0) throw primary
            return client
          })
          t.mock.method(client, 'destroy', () => {
            destroyed.push(index)
            destroy()
            if (index === 0) {
              if (rejection === 'throw') throw cleanup
              return Promise.reject(cleanup)
            }
          })
        }
        return sub
      })
      try {
        await assert.rejects(api.startSocketServer(server, { redis }), error => {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.cause, primary)
          assert.deepEqual(error.errors, [primary, cleanup])
          return true
        })
        assert.deepEqual(destroyed, [0, 1])
        assert.ok(clients.every(client => !client.isOpen))
        assert.equal(api.io, undefined)
        assert.equal(api.vars.socketIORedisClients, undefined)
        assert.equal(server.listening, true)
      } finally { t.mock.restoreAll() }
      await api.startSocketServer(server, { redis })
      assert.ok(api.io)
    })

    it(`contains Redis error events when warning writer ${rejection}s`, async () => {
      await api.startSocketServer(server, { redis })
      clients.push(...Object.values(api.vars.socketIORedisClients))
      failWarning = rejection
      for (const client of clients) assert.doesNotThrow(() => client.emit('error', null))
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(warnings.length, 2)
      assert.deepEqual(warnings.map(([, details]) => details), ['pubClient', 'subClient'].map(role => ({
        method: 'socketioStart', scopeName: null, phase: 'redisConnect', backend: 'redis', transactionOutcome: 'none', role, error: null
      })))
      assert.ok(clients.every(client => client.isReady))
    })

    it(`attempts later Redis shutdown when close and warning writer ${rejection}`, async t => {
      await api.startSocketServer(server, { redis })
      const io = api.io
      clients.push(...Object.values(api.vars.socketIORedisClients))
      failWarning = rejection
      const closed = []
      const closingClients = []
      for (const [index, client] of clients.entries()) {
        const close = client.close.bind(client)
        t.mock.method(client, 'close', () => {
          closed.push(index)
          const error = new Error(`Close failed for ${index}`)
          const closing = close()
          closingClients.push(closing)
          closing.catch(() => {})
          if (rejection === 'throw') throw error
          return closing.then(() => { throw error })
        })
      }
      try {
        await new Promise((resolve, reject) => io.close(error => error ? reject(error) : resolve()))
        await Promise.allSettled(closingClients)
        await new Promise(resolve => setImmediate(resolve))
        assert.deepEqual(closed, [0, 1])
        assert.equal(warnings.length, 2)
        assert.deepEqual(warnings.map(([, details]) => ({ ...details, error: details.error.message })), ['pubClient', 'subClient'].map((role, index) => ({
          method: 'socketioShutdown', scopeName: null, phase: 'redisShutdown', backend: 'redis', transactionOutcome: 'none', role, error: `Close failed for ${index}`
        })))
        assert.ok(clients.every(client => !client.isOpen))
        assert.equal(api.io, undefined)
      } finally { t.mock.restoreAll() }
    })
  }
})

for (const failure of ['missing-socket', 'invalid-credentials', 'second-client', 'retry-exhausted']) {
  describe(`Redis startup failure: ${failure} (${storageMode.mode})`, { timeout: 10000 }, () => {
    let database, api, server, observer
    before(async () => {
      database = await createTestDatabase()
      observer = createClient(redis).on('error', () => {})
      await observer.connect()
      ;({ api, server } = await createWebSocketApi(database.knex, {
        createApi: createConformanceApi,
        startSockets: false,
        socketio: { auth: { authenticate: () => ({ userId: 'viewer' }) } }
      }))
    })
    after(async () => {
      try { await closeWebSocketApi(api, server) } finally {
        if (observer?.isOpen) observer.destroy()
        try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) }
      }
    })
    it('rejects startup without publishing Socket.IO state or changing the caller HTTP server', async () => {
      const listeners = Object.fromEntries(['request', 'upgrade', 'close', 'listening'].map(event => [event, server.listeners(event)]))
      let credentials = 0
      const retries = []
      const options = {
        ...redis,
        name: `jra-startup-${failure}`,
        ...(failure === 'invalid-credentials' ? { username: 'missing-user', password: 'invalid-test-password' } : {}),
        ...(failure === 'second-client'
          ? { credentialsProvider: { type: 'async-credentials-provider', credentials: async () => ++credentials === 1 ? {} : { username: 'missing-user', password: 'invalid-test-password' } } }
          : {}),
        socket: {
          ...redis.socket,
          ...(['missing-socket', 'retry-exhausted'].includes(failure) ? { path: `${redis.socket.path}.absent` } : {}),
          reconnectStrategy: failure === 'retry-exhausted' ? attempts => { retries.push(attempts); return attempts === 0 ? 1 : false } : false
        }
      }
      await assert.rejects(api.startSocketServer(server, {
        redis: options, auth: { authenticate: () => { throw new Error('Failed authentication override leaked') } }
      }), ['missing-socket', 'retry-exhausted'].includes(failure) ? { code: 'ENOENT' } : /WRONGPASS/)
      if (failure === 'second-client') assert.equal(credentials, 2)
      if (failure === 'retry-exhausted') {
        assert.equal(retries.filter(attempts => attempts === 0).length, 2)
        assert.ok(retries.includes(1))
      }
      assert.equal(api.io, undefined)
      assert.equal(api.vars.socketIO, undefined)
      assert.equal(api.vars.socketIORedisClients, undefined)
      assert.equal(server.listening, true)
      for (const [event, original] of Object.entries(listeners)) assert.deepEqual(server.listeners(event), original, event)
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/groups`)
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).data, [])
      assert.equal((await observer.clientList()).some(client => client.name === options.name), false)
      const started = await api.startSocketServer(server, { redis })
      assert.equal(started, api.io)
      assert.equal(api.vars.socketIORedisClients.pubClient.isReady, true)
      assert.equal(api.vars.socketIORedisClients.subClient.isReady, true)
      const socket = ioClient(`http://127.0.0.1:${server.address().port}`, { path: '/api/socket.io', autoConnect: false, reconnection: false })
      try {
        const connected = waitForSocketEvent(socket, 'connect', 3000, 'connect_error')
        socket.connect()
        await connected
      } finally { socket.disconnect() }
    })
  })
}

for (const close of ['socketio', 'http', 'reconnecting']) {
  describe(`Redis shutdown through ${close} (${storageMode.mode})`, { timeout: 10000 }, () => {
    let database, api, server, observer
    before(async () => {
      database = await createTestDatabase()
      observer = createClient(redis).on('error', () => {})
      await observer.connect()
      ;({ api, server } = await createWebSocketApi(database.knex, {
        createApi: createConformanceApi,
        socketio: { redis: { ...redis, name: 'jra-lifecycle-shutdown' }, auth: { authenticate: () => ({ userId: 'viewer' }) } }
      }))
    })
    after(async () => {
      try { await closeWebSocketApi(api, server) } finally {
        if (observer?.isOpen) observer.destroy()
        try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) }
      }
    })
    it('closes its two Redis clients when Socket.IO closes', async () => {
      const clients = Object.values(api.vars.socketIORedisClients)
      assert.equal(clients.length, 2)
      const shutdown = () => new Promise((resolve, reject) => (close === 'http' ? server : api.io).close(error => error ? reject(error) : resolve()))
      if (close === 'reconnecting') {
        const subscriber = (await observer.clientList()).find(client => client.name === 'jra-lifecycle-shutdown' && client.flags.includes('P'))
        assert.ok(subscriber)
        let closing
        const started = new Promise(resolve => api.vars.socketIORedisClients.subClient.once('reconnecting', () => { closing = shutdown(); resolve() }))
        await observer.sendCommand(['CLIENT', 'KILL', 'ID', String(subscriber.id)])
        await started
        await closing
      } else await shutdown()
      assert.equal(server.listening, false)
      for (const client of clients) assert.equal(client.isOpen, false)
      let connected
      const deadline = Date.now() + 2000
      do {
        connected = await observer.clientList()
      } while (connected.some(client => client.name === 'jra-lifecycle-shutdown') && Date.now() < deadline)
      assert.equal(connected.some(client => client.name === 'jra-lifecycle-shutdown'), false)
      assert.equal(api.io, undefined)
      assert.equal(api.vars.socketIO, undefined)
      assert.equal(api.vars.socketIORedisClients, undefined)
      const record = await api.resources.groups.post({ format: 'plain', data: { name: 'After shutdown' } })
      assert.equal(record.name, 'After shutdown')
      assert.equal((await api.resources.groups.query({ format: 'plain' })).data.length, 1)
    })
  })
}

describe(`Socket.IO startup ownership (${storageMode.mode})`, { timeout: 10000 }, () => {
  let database, api, server
  before(async () => {
    database = await createTestDatabase()
    ;({ api, server } = await createWebSocketApi(database.knex, { createApi: createConformanceApi, startSockets: false }))
  })
  after(async () => {
    try { await closeWebSocketApi(api, server) } finally {
      try { await database?.close() } finally { storageMode.clearRegistry(database?.knex) }
    }
  })
  it('rejects overlapping and duplicate starts without replacing the active server or clients', async () => {
    let release, markEntered
    const gate = new Promise(resolve => { release = resolve })
    const entered = new Promise(resolve => { markEntered = resolve })
    const start = api.startSocketServer(server, {
      redis: { ...redis, credentialsProvider: { type: 'async-credentials-provider', credentials: async () => { markEntered(); await gate; return {} } } }
    })
    try {
      await entered
      await assert.rejects(api.startSocketServer(server), /already starting or started/)
    } finally { release() }
    const io = await start
    const clients = api.vars.socketIORedisClients
    const listeners = server.listeners('request')
    await assert.rejects(api.startSocketServer(server), /already starting or started/)
    assert.equal(api.io, io)
    assert.equal(api.vars.socketIORedisClients, clients)
    assert.deepEqual(server.listeners('request'), listeners)
    assert.ok(Object.values(clients).every(client => client.isReady))
  })
})
