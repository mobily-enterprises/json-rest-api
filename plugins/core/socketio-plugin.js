import { throwMissingPackage } from '../../lib/missing-package.js'
import { randomUUID } from 'node:crypto'
import { createEnhancedLogger } from '../../lib/enhanced-logger.js'
import { errorMessage, getOperationDiagnosticContext } from '../../lib/error-context.js'
import { queryConstraint } from './lib/querying/query-constraint.js'

const pendingRoomChanges = new WeakMap()

// Preserve room mutation order when an adapter completes joins/leaves asynchronously.
async function changeRoom (socket, method, room) {
  const previous = pendingRoomChanges.get(socket) || Promise.resolve()
  const pending = previous.catch(() => {}).then(() => socket[method](room))
  pendingRoomChanges.set(socket, pending)
  try {
    await pending
  } finally {
    if (pendingRoomChanges.get(socket) === pending) pendingRoomChanges.delete(socket)
  }
}

function normalizeAuthContext (auth) {
  if (!auth) return null
  if (typeof auth !== 'object') return null
  const normalized = { ...auth }
  if (normalized.userId !== undefined && normalized.userId !== null) {
    normalized.userId = String(normalized.userId)
  }
  if (normalized.roles && !Array.isArray(normalized.roles)) {
    normalized.roles = [normalized.roles]
  }
  return normalized
}

async function matchesSubscription ({ subscription, scopeName, id, transaction, api, scopes, log }) {
  try {
    const result = await api.resources[scopeName].query({
      format: 'jsonapi',
      transaction,
      queryParams: { filters: subscription.filters, include: [], page: { size: 1 } },
      [queryConstraint]: { scopeName, values: { id } }
    }, { ...subscription.context, auth: subscription.auth })
    return result.data.some(record => record.type === scopeName && String(record.id) === String(id))
  } catch (error) {
    try {
      await createEnhancedLogger(log, { schemaInfo: scopes[scopeName]?.vars?.schemaInfo })
        .warn('Socket.IO subscription query failed', {
          ...getOperationDiagnosticContext({ transaction }, {
            phase: 'subscriptionMatch', method: 'query', scopeName, backend: api.knex?.instance?.client?.config?.client
          }),
          subscriptionId: subscription.id,
          error
        })
    } catch { /* Warning failure must preserve the existing non-match result. */ }
    return false
  }
}

function buildConfig (pluginOptions = {}) {
  const authOptions = pluginOptions.auth || {}
  const subscriptionOptions = pluginOptions.subscriptions || {}

  return {
    auth: {
      authenticate: authOptions.authenticate || null,
      requireAuth: authOptions.requireAuth === true,
      allowClientProvidedAuth: authOptions.allowClientProvidedAuth === true,
      anonymousContext: authOptions.anonymousContext || null,
      onAuthenticationFailed: authOptions.onAuthenticationFailed || null
    },
    subscriptions: {
      maxPerSocket: subscriptionOptions.maxPerSocket ?? 100
    },
    transport: pluginOptions.transport || {}
  }
}

async function authenticateSocket ({ socket, api, helpers, log, config }) {
  const { authenticate, allowClientProvidedAuth, anonymousContext, requireAuth, onAuthenticationFailed } = config.auth

  try {
    let authContext = null

    if (authenticate) {
      authContext = await authenticate({ socket, api, helpers, log })
    } else if (allowClientProvidedAuth && socket.handshake.auth && typeof socket.handshake.auth === 'object') {
      authContext = socket.handshake.auth
    } else if (anonymousContext) {
      authContext = anonymousContext
    }

    const normalized = normalizeAuthContext(authContext)
    if (!normalized && requireAuth) {
      throw new Error('Authentication required')
    }

    return normalized
  } catch (error) {
    if (onAuthenticationFailed) {
      try {
        await onAuthenticationFailed({ socket, error, log })
      } catch (hookError) {
        try {
          await log.error('socketio auth failure handler threw error', {
            ...getOperationDiagnosticContext({}, { phase: 'authenticationFailureHook', method: 'socketAuthenticate', backend: 'socketio' }), error: hookError
          })
        } catch { /* A diagnostic failure must not replace the authentication rejection. */ }
      }
    }
    throw error
  }
}

async function validateSubscriptionFilters (filters, scope, resource) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw Object.assign(new Error('Filters must be an object'), { code: 'INVALID_FILTERS' })
  }
  if (Object.keys(filters).length === 0) return {}
  const { searchSchemaStructure, searchSchemaInstance } = scope.vars.schemaInfo
  if (!searchSchemaStructure || !searchSchemaInstance) {
    throw Object.assign(new Error(`Filtering is not enabled for resource '${resource}'`), { code: 'FILTERING_NOT_ENABLED' })
  }
  for (const key of Object.keys(filters)) {
    if (!Object.hasOwn(searchSchemaStructure, key)) {
      throw Object.assign(new Error(`Unknown filter '${key}'`), { code: 'INVALID_FILTERS' })
    }
  }
  const { validatedObject, errors } = await searchSchemaInstance.patch(filters)
  if (errors && Object.keys(errors).length) {
    throw Object.assign(new Error('Invalid filter values'), { code: 'INVALID_FILTERS', details: errors })
  }
  return validatedObject
}

async function registerSubscription ({ socket, data, scopes, runHooks, log, config }) {
  let scope, scopeName
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw Object.assign(new Error('Subscription must be an object'), { code: 'INVALID_SUBSCRIPTION' })
    }
    for (const key of Object.keys(data)) {
      if (!['resource', 'filters', 'subscriptionId'].includes(key)) {
        throw Object.assign(new Error(`Subscription option '${key}' is not supported`), { code: 'UNSUPPORTED_OPTION' })
      }
    }
    const { resource, filters = {}, subscriptionId = randomUUID() } = data
    if (!resource || typeof resource !== 'string') {
      throw Object.assign(new Error('Resource is required'), { code: 'RESOURCE_REQUIRED' })
    }
    const candidate = Object.hasOwn(scopes, resource) ? scopes[resource] : undefined
    if (!candidate?.vars?.schemaInfo) {
      throw Object.assign(new Error(`Resource '${resource}' not found`), { code: 'RESOURCE_NOT_FOUND' })
    }
    scope = candidate
    scopeName = resource
    if (typeof subscriptionId !== 'string' || subscriptionId.trim() === '') {
      throw Object.assign(new Error('Subscription ID must be a nonempty string'), { code: 'INVALID_SUBSCRIPTION_ID' })
    }
    const auth = socket.data.auth || null
    const subscription = {
      id: subscriptionId,
      resource,
      filters: await validateSubscriptionFilters(filters, scope, resource),
      auth,
      context: {},
      createdAt: new Date()
    }
    await runHooks('subscriptionFilters', { subscription, auth })
    if (subscription.id !== subscriptionId || subscription.resource !== resource) {
      throw Object.assign(new Error('subscriptionFilters may change filters, not subscription identity'), { code: 'INVALID_SUBSCRIPTION' })
    }
    subscription.filters = await validateSubscriptionFilters(subscription.filters, scope, resource)
    if (!subscription.context || typeof subscription.context !== 'object' || Array.isArray(subscription.context)) {
      throw Object.assign(new Error('Subscription context must be an object'), { code: 'INVALID_SUBSCRIPTION_CONTEXT' })
    }
    await scope.checkPermissions({
      method: 'query',
      originalContext: { ...subscription.context, auth: subscription.auth, scopeName: resource, queryParams: { filters: subscription.filters } }
    })
    subscription.generation = randomUUID()

    if (!socket.connected) throw Object.assign(new Error('Socket disconnected during subscription'), { code: 'SOCKET_DISCONNECTED' })
    const subscriptions = socket.data.subscriptions
    if (subscriptions.some(item => item.id === subscriptionId)) {
      throw Object.assign(new Error('Subscription ID is already active'), { code: 'SUBSCRIPTION_EXISTS' })
    }
    if (subscriptions.length >= config.subscriptions.maxPerSocket) {
      throw Object.assign(new Error('Subscription limit reached for this connection'), { code: 'SUBSCRIPTION_LIMIT' })
    }
    // Reserve capacity before awaiting an adapter's room join.
    subscriptions.push(subscription)
    try {
      await changeRoom(socket, 'join', `${resource}:updates`)
      if (!socket.connected) {
        // A late adapter join can recreate the disconnected socket's membership entry.
        await socket.adapter.delAll(socket.id)
        throw Object.assign(new Error('Socket disconnected during subscription'), { code: 'SOCKET_DISCONNECTED' })
      }
    } catch (error) {
      const index = subscriptions.indexOf(subscription)
      if (index !== -1) subscriptions.splice(index, 1)
      throw error
    }
    try {
      await log.info(`Socket ${socket.id} subscribed to ${resource}`, {
        ...getOperationDiagnosticContext({}, { phase: 'subscriptionReady', method: 'subscribe', scopeName, backend: 'socketio' }), subscriptionId
      })
    } catch { /* Logging cannot undo a subscription already installed in its room. */ }
    return { subscriptionId, resource, filters: subscription.filters, status: 'active' }
  } catch (error) {
    // Only a successfully resolved resource supplies diagnostic field policy.
    try {
      await createEnhancedLogger(log, { schemaInfo: scope?.vars?.schemaInfo })
        .error('Socket.IO subscribe error', {
          ...getOperationDiagnosticContext({}, { phase: 'admission', method: 'subscribe', scopeName, backend: 'socketio' }), operation: 'subscribe', error
        })
    } catch { /* Logging must not replace the subscription rejection. */ }
    throw error
  }
}

function subscriptionError (error) {
  let code
  try { code = error?.code } catch { /* Invalid error metadata must not prevent rejection. */ }
  return {
    code: typeof code === 'string' && code ? code : 'SUBSCRIBE_ERROR',
    message: error == null ? 'Subscription failed' : errorMessage(error)
  }
}

async function handleRestoreSubscriptions ({ socket, subscriptions, scopes, runHooks, log, config }) {
  const restored = []
  const failed = []

  for (const sub of subscriptions) {
    try {
      const response = await registerSubscription({
        socket,
        data: sub,
        scopes,
        runHooks,
        log,
        config
      })
      restored.push(response.subscriptionId)
    } catch (error) {
      failed.push({
        subscriptionId: sub?.subscriptionId || null,
        error: subscriptionError(error)
      })
    }
  }

  return { restored, failed }
}

async function performBroadcast ({ method, scopeName, id, isCreate, recipients, api, scopes, io, log }) {
  if (!io || recipients.length === 0) return
  const scope = api.resources[scopeName]
  const sockets = new Map((await io.in(`${scopeName}:updates`).fetchSockets()).map(socket => [socket.id, socket]))

  for (const recipient of recipients) {
    const socket = sockets.get(recipient.socketId)
    const subscription = socket?.data.subscriptions?.find(item =>
      item.resource === scopeName && item.id === recipient.subscriptionId && item.generation === recipient.generation
    )
    if (!subscription) continue
    try {
      await scope.checkPermissions({
        method: 'query',
        originalContext: { ...subscription.context, auth: subscription.auth, scopeName, id, queryParams: { filters: subscription.filters } }
      })
    } catch (error) {
      try {
        await createEnhancedLogger(log, { schemaInfo: scopes[scopeName]?.vars?.schemaInfo })
          .warn('Socket.IO notification permission check failed', {
            ...getOperationDiagnosticContext({}, {
              phase: 'notificationPermission', method: 'query', scopeName, backend: api.knex?.instance?.client?.config?.client
            }),
            subscriptionId: subscription.id,
            error
          })
      } catch { /* Warning failure must not interrupt delivery to other recipients. */ }
      continue
    }

    let type = 'resource.updated'
    if (method === 'delete') type = 'resource.deleted'
    else if (method === 'post' || (method === 'put' && isCreate)) type = 'resource.created'
    const notification = {
      type,
      resource: scopeName,
      id: String(id),
      action: method,
      subscriptionId: subscription.id,
      meta: { timestamp: new Date().toISOString() }
    }
    if (method === 'delete') notification.deletedRecord = { id: String(id) }
    socket.emit('subscription.update', notification)
  }
}

export const SocketIOPlugin = {
  name: 'socketio',
  dependencies: ['rest-api'],

  async install ({ api, addHook, log, scopes, helpers, vars, runHooks, pluginOptions = {} }) {
    log = createEnhancedLogger(log)
    const config = buildConfig(pluginOptions)
    const pendingChanges = new WeakMap()
    const pendingBroadcasts = new WeakMap()

    let Server
    try {
      ({ Server } = await import('socket.io'))
    } catch {
      throwMissingPackage('socket.io', 'socketio', 'Socket.IO is required for WebSocket support. This is a peer dependency.')
    }

    let io
    let starting = false

    async function logRedisWarning (message, details) {
      try { await log.warn(message, details) } catch { /* Diagnostic writers must not escape Redis event handlers. */ }
    }

    async function logSocketInfo (message, details) {
      try { await log.info(message, details) } catch { /* Information logs must not interrupt socket event handling. */ }
    }

    async function closeRedisClient (role, client) {
      const diagnostic = getOperationDiagnosticContext({}, { phase: 'redisShutdown', method: 'socketioShutdown', backend: 'redis' })
      try {
        if (client.isOpen) await client.close()
      } catch (error) {
        await logRedisWarning('Socket.IO Redis shutdown failed', { ...diagnostic, role, error })
      }
    }

    api.startSocketServer = async (server, startOptions = {}) => {
      if (starting || io) throw new Error('Socket.IO server is already starting or started')
      const authConfig = { ...config.auth, ...(startOptions.auth || {}) }
      const redisConfig = startOptions.redis ?? pluginOptions.redis ?? null

      const defaultPath = vars.transport?.mountPath ? `${vars.transport.mountPath}/socket.io` : '/socket.io'
      const path = startOptions.path || config.transport.path || defaultPath
      const cors = startOptions.cors || config.transport.cors || { origin: '*', methods: ['GET', 'POST'] }

      let redisClients
      let createAdapter
      let pendingConnections = []
      starting = true
      try {
        if (redisConfig) {
          let createClient
          try {
            ({ createClient } = await import('redis'))
          } catch {
            throwMissingPackage('redis', 'socketio', 'Redis is required for Socket.IO horizontal scaling. This is a peer dependency.')
          }

          try {
            ({ createAdapter } = await import('@socket.io/redis-adapter'))
          } catch {
            throwMissingPackage('@socket.io/redis-adapter', 'socketio',
              'Socket.IO Redis adapter is required for horizontal scaling. This is a peer dependency.')
          }

          const pubClient = createClient(redisConfig)
          redisClients = { pubClient }
          redisClients.subClient = pubClient.duplicate()
          const diagnostic = getOperationDiagnosticContext({}, { phase: 'redisConnect', method: 'socketioStart', backend: 'redis' })
          for (const [role, client] of Object.entries(redisClients)) {
            client.on('error', error => logRedisWarning('Socket.IO Redis connection error', { ...diagnostic, role, error }))
          }
          // Async wrappers retain both attempts even if connect throws synchronously.
          pendingConnections = Object.values(redisClients).map(async client => client.connect())
          await Promise.all(pendingConnections)
        }

        const socketServer = new Server({ path, cors, transports: ['websocket', 'polling'] })
        if (redisClients) {
          socketServer.adapter(createAdapter(redisClients.pubClient, redisClients.subClient))
          await logSocketInfo('Socket.IO configured with Redis adapter', getOperationDiagnosticContext({}, {
            phase: 'redisConnect', method: 'socketioStart', backend: 'redis'
          }))
        }
        socketServer.attach(server)
        io = socketServer
        vars.socketIORedisClients = redisClients
        vars.socketIO = io
        api.io = io
        config.auth = authConfig
      } catch (error) {
        const errors = [error]
        for (const client of Object.values(redisClients || {})) {
          try {
            if (client.isOpen) await client.destroy()
          } catch (cleanupError) {
            errors.push(cleanupError)
          }
        }
        // Failed destruction may leave an attempt pending; do not wait for it forever.
        if (errors.length > 1) {
          throw new AggregateError(errors, 'Socket.IO Redis setup and cleanup failed', { cause: error })
        }
        await Promise.allSettled(pendingConnections)
        throw error
      } finally {
        starting = false
      }

      const socketServer = io
      server.once('close', () => {
        if (io !== socketServer) return
        io = undefined
        delete api.io
        vars.socketIO = undefined
        vars.socketIORedisClients = undefined
        for (const [role, client] of Object.entries(redisClients || {})) closeRedisClient(role, client)
      })

      io.use(async (socket, next) => {
        try {
          const authContext = await authenticateSocket({ socket, api, helpers, log, config })
          socket.data.auth = authContext
          socket.data.subscriptions = []
          next()
        } catch (error) {
          try {
            await log.warn('Socket.IO authentication failed', {
              ...getOperationDiagnosticContext({}, { phase: 'authentication', method: 'socketAuthenticate', backend: 'socketio' }), error
            })
          } catch { /* The client must still receive the authentication rejection. */ }
          const message = error == null ? 'Authentication failed' : errorMessage(error) || 'Authentication failed'
          next(new Error(message, { cause: error }))
        }
      })

      io.on('connection', (socket) => {
        logSocketInfo(`Socket connected: ${socket.id}`, {
          ...getOperationDiagnosticContext({}, { phase: 'socketConnected', method: 'socketConnect', backend: 'socketio' }),
          userId: socket.data.auth?.userId ?? null
        })

        socket.emit('connected', {
          socketId: socket.id,
          serverTime: new Date().toISOString()
        })

        socket.on('subscribe', async (payload, callback) => {
          callback = typeof callback === 'function' ? callback : null
          try {
            const result = await registerSubscription({
              socket,
              data: payload,
              scopes,
              runHooks,
              log,
              config
            })

            if (callback) callback({ success: true, data: result })
            else socket.emit('subscription.created', result)
          } catch (error) {
            const response = { error: subscriptionError(error) }
            if (callback) callback(response)
            else socket.emit('subscription.error', response.error)
          }
        })

        socket.on('unsubscribe', async (payload, callback) => {
          callback = typeof callback === 'function' ? callback : null
          let scopeName
          try {
            const subscriptionId = payload?.subscriptionId
            if (!subscriptionId) {
              const error = { code: 'MISSING_SUBSCRIPTION_ID', message: 'Subscription ID is required' }
              if (callback) callback({ error })
              return
            }

            const subscription = socket.data.subscriptions?.find(item => item.id === subscriptionId)
            if (!subscription) {
              const error = { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' }
              if (callback) callback({ error })
              return
            }
            scopeName = subscription.resource

            socket.data.subscriptions.splice(socket.data.subscriptions.indexOf(subscription), 1)
            const hasOther = socket.data.subscriptions
              .some((sub) => sub.resource === subscription.resource)
            if (!hasOther) {
              await changeRoom(socket, 'leave', `${subscription.resource}:updates`)
            }

            await logSocketInfo(`Socket ${socket.id} unsubscribed from ${subscription.resource}`, {
              ...getOperationDiagnosticContext({}, { phase: 'subscriptionRemoved', method: 'unsubscribe', scopeName, backend: 'socketio' }), subscriptionId
            })
            if (callback) callback({ success: true })
          } catch (error) {
            try {
              await createEnhancedLogger(log, { schemaInfo: scopes[scopeName]?.vars?.schemaInfo }).error('Socket.IO unsubscribe error', {
                ...getOperationDiagnosticContext({}, { phase: 'subscriptionRemoval', method: 'unsubscribe', scopeName, backend: 'socketio' }), error
              })
            } catch { /* Report the room failure even when diagnostics fail. */ }
            if (callback) {
              callback({
                error: {
                  code: 'UNSUBSCRIBE_ERROR',
                  message: error == null ? 'Unsubscribe failed' : errorMessage(error)
                }
              })
            }
          }
        })

        socket.on('restore-subscriptions', async (payload, callback) => {
          callback = typeof callback === 'function' ? callback : null
          try {
            const subscriptions = payload?.subscriptions
            if (!Array.isArray(subscriptions)) {
              const error = { code: 'INVALID_DATA', message: 'Subscriptions must be an array' }
              if (callback) callback({ error })
              return
            }

            const result = await handleRestoreSubscriptions({
              socket,
              subscriptions,
              scopes,
              runHooks,
              log,
              config
            })

            if (callback) callback({ success: true, ...result })
          } catch (error) {
            try {
              await log.error('Socket.IO restore subscriptions error', {
                ...getOperationDiagnosticContext({}, { phase: 'subscriptionRestore', method: 'restoreSubscriptions', backend: 'socketio' }), error
              })
            } catch { /* Report the restore failure even when diagnostics fail. */ }
            if (callback) {
              callback({
                error: {
                  code: 'RESTORE_ERROR',
                  message: error == null ? 'Subscription restore failed' : errorMessage(error)
                }
              })
            }
          }
        })

        socket.on('disconnect', (reason) => {
          logSocketInfo(`Socket disconnected: ${socket.id}`, {
            ...getOperationDiagnosticContext({}, { phase: 'socketDisconnected', method: 'socketDisconnect', backend: 'socketio' }),
            reason,
            subscriptionCount: socket.data.subscriptions?.length || 0
          })
        })
      })

      await logSocketInfo('Socket.IO server started', {
        ...getOperationDiagnosticContext({}, { phase: 'socketStartup', method: 'socketioStart', backend: 'socketio' }), path
      })
      return io
    }

    addHook('beforeDataCall', 'socketio-capture-before', {}, async ({ context }) => {
      pendingChanges.delete(context)
      if (!io || !['post', 'put', 'patch', 'delete', 'postRelationship', 'deleteRelationship'].includes(context.method)) return
      const { scopeName, id, transaction } = context
      const candidates = []
      const sockets = await io.in(`${scopeName}:updates`).fetchSockets()
      for (const socket of sockets) {
        for (const subscription of socket.data.subscriptions || []) {
          if (subscription.resource !== scopeName) continue
          const before = context.method !== 'post' && !(context.method === 'put' && context.isCreate) && id != null &&
            await matchesSubscription({ subscription, scopeName, id, transaction, api, scopes, log })
          candidates.push({ socketId: socket.id, subscription, before })
        }
      }
      pendingChanges.set(context, candidates)
    })

    addHook('finish', 'socketio-broadcast', {}, async ({ context }) => {
      const candidates = pendingChanges.get(context)
      if (!candidates) return
      pendingChanges.delete(context)
      const { scopeName, id, transaction, isCreate } = context
      if (!io || id == null || id === '') return
      const method = ['postRelationship', 'deleteRelationship'].includes(context.method) ? 'patch' : context.method
      const recipients = []
      for (const { socketId, subscription, before } of candidates) {
        const after = method !== 'delete' && await matchesSubscription({ subscription, scopeName, id, transaction, api, scopes, log })
        if (before || after) recipients.push({ socketId, subscriptionId: subscription.id, generation: subscription.generation })
      }
      if (recipients.length === 0) return
      // Capture operation values now; callers may reuse or mutate their context.
      const change = { method, scopeName, id, isCreate, recipients }
      if (transaction) {
        if (!pendingBroadcasts.has(transaction)) pendingBroadcasts.set(transaction, [])
        pendingBroadcasts.get(transaction).push(change)
      } else {
        await performBroadcast({ ...change, api, scopes, io, log })
      }
    })

    addHook('afterCommit', 'socketio-broadcast-deferred', {}, async ({ context }) => {
      if (!context?.transaction) return
      const broadcasts = pendingBroadcasts.get(context.transaction)
      if (!broadcasts) return
      pendingBroadcasts.delete(context.transaction)

      let failed = false
      let firstError
      for (const [broadcastIndex, broadcast] of broadcasts.entries()) {
        try {
          await performBroadcast({ ...broadcast, api, scopes, io, log })
        } catch (error) {
          (context.cleanupErrors ||= []).push({ phase: 'socketioBroadcast', broadcastIndex, error })
          if (!failed) {
            failed = true
            firstError = error
          }
        }
      }
      if (failed) throw firstError
    })

    addHook('afterRollback', 'socketio-cleanup-broadcasts', {}, async ({ context }) => {
      pendingChanges.delete(context)
      if (!context?.transaction) return
      pendingBroadcasts.delete(context.transaction)
    })
  }
}
