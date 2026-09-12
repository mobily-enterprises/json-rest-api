import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from 'redis'
import { io as ioClient } from 'socket.io-client'
import { createTestDatabase } from '../helpers/test-database.js'
import { storageMode } from '../helpers/storage-mode.js'
import { waitForSocketEvent } from '../helpers/socketio.js'
import { closeWebSocketApi, createConformanceApi, createWebSocketApi } from '../fixtures/api-configs.js'

if (!process.env.JSON_REST_API_REDIS_CONNECTION) throw new Error('Socket lifecycle integration requires the disposable Redis runner')
const redis = JSON.parse(process.env.JSON_REST_API_REDIS_CONNECTION)

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
