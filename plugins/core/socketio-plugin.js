import { requirePackage } from 'hooked-api'

const pendingBroadcasts = new WeakMap()

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

function matchesFilters (record, filters, searchSchemaStructure) {
  if (!filters || Object.keys(filters).length === 0) return true

  if (!record) return false

  if (!searchSchemaStructure || Object.keys(searchSchemaStructure).length === 0) {
    return false
  }

  for (const [filterKey, filterValue] of Object.entries(filters)) {
    const fieldDef = searchSchemaStructure[filterKey]
    if (!fieldDef) continue

    const fieldName = fieldDef.actualField || filterKey

    let recordValue
    if (fieldDef.isRelationship) {
      const relationshipData = record.relationships?.[filterKey]?.data
      recordValue = relationshipData?.id
    } else {
      recordValue = record.attributes?.[fieldName] ?? record[fieldName]
    }

    if (recordValue === null || recordValue === undefined) {
      if (filterValue !== null && filterValue !== undefined) {
        return false
      }
      continue
    }

    if (typeof fieldDef.filterOperator === 'function') {
      if (!fieldDef.filterRecord?.(record, filterValue)) {
        return false
      }
      continue
    }

    const operator = fieldDef.filterOperator || '='

    switch (operator) {
      case 'like':
        if (!String(recordValue).toLowerCase().includes(String(filterValue).toLowerCase())) {
          return false
        }
        break
      case 'in':
        if (Array.isArray(filterValue)) {
          if (!filterValue.includes(recordValue)) {
            return false
          }
        } else if (recordValue !== filterValue) {
          return false
        }
        break
      case 'between':
        if (Array.isArray(filterValue) && filterValue.length === 2) {
          if (recordValue < filterValue[0] || recordValue > filterValue[1]) {
            return false
          }
        }
        break
      case '>':
        if (!(recordValue > filterValue)) return false
        break
      case '>=':
        if (!(recordValue >= filterValue)) return false
        break
      case '<':
        if (!(recordValue < filterValue)) return false
        break
      case '<=':
        if (!(recordValue <= filterValue)) return false
        break
      case '!=':
      case '<>':
        if (recordValue === filterValue) return false
        break
      case '=':
      default:
        if (fieldDef.isRelationship) {
          if (String(recordValue) !== String(filterValue)) {
            return false
          }
        } else if (recordValue !== filterValue) {
          return false
        }
    }
  }

  return true
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
        log.error('socketio auth failure handler threw error', hookError)
      }
    }
    throw error
  }
}

async function registerSubscription ({
  socket,
  data,
  scopes,
  runHooks,
  log,
  config
}) {
  const { resource, filters = {}, include, fields, subscriptionId } = data || {}

  if (!resource || typeof resource !== 'string') {
    throw Object.assign(new Error('Resource is required'), { code: 'RESOURCE_REQUIRED' })
  }

  const scope = scopes[resource]
  if (!scope) {
    throw Object.assign(new Error(`Resource '${resource}' not found`), { code: 'RESOURCE_NOT_FOUND' })
  }

  const auth = socket.data.auth || null

  if (scope.checkPermissions) {
    await scope.checkPermissions({
      method: 'query',
      originalContext: { auth }
    })
  }

  const schemaInfo = scope.vars?.schemaInfo
  const searchSchemaStructure = schemaInfo?.searchSchemaStructure
  const searchSchemaInstance = schemaInfo?.searchSchemaInstance

  const validatedFilters = { ...filters }
  if (Object.keys(validatedFilters).length > 0) {
    if (!searchSchemaStructure || Object.keys(searchSchemaStructure).length === 0 || !searchSchemaInstance) {
      throw Object.assign(new Error(`Filtering is not enabled for resource '${resource}'`), { code: 'FILTERING_NOT_ENABLED' })
    }

    for (const filterKey of Object.keys(validatedFilters)) {
      const fieldDef = searchSchemaStructure[filterKey]
      if (fieldDef && typeof fieldDef.filterOperator === 'function' && !fieldDef.filterRecord) {
        throw Object.assign(
          new Error(`Filter '${filterKey}' uses custom SQL logic and requires 'filterRecord' for real-time subscriptions`),
          { code: 'UNSUPPORTED_FILTER' }
        )
      }
    }

    const { validatedObject, errors } = await searchSchemaInstance.validate(validatedFilters, {
      onlyObjectValues: true
    })

    if (errors && Object.keys(errors).length > 0) {
      const error = new Error('Invalid filter values')
      error.code = 'INVALID_FILTERS'
      error.details = errors
      throw error
    }

    Object.assign(validatedFilters, validatedObject)
  }

  if (include !== undefined) {
    if (!Array.isArray(include)) {
      throw Object.assign(new Error('Include parameter must be an array'), { code: 'INVALID_INCLUDE' })
    }

    const relationships = schemaInfo?.schemaRelationships || {}
    for (const includePath of include) {
      const baseName = includePath.split('.')[0]
      if (!relationships[baseName]) {
        throw Object.assign(new Error(`Invalid relationship '${baseName}' for resource '${resource}'`), {
          code: 'INVALID_INCLUDE'
        })
      }
    }
  }

  if (fields !== undefined) {
    if (typeof fields !== 'object' || Array.isArray(fields) || fields === null) {
      throw Object.assign(new Error('Fields parameter must be an object'), { code: 'INVALID_FIELDS' })
    }

    for (const [resourceType, fieldList] of Object.entries(fields)) {
      if (!Array.isArray(fieldList)) {
        throw Object.assign(new Error(`Fields for '${resourceType}' must be an array`), { code: 'INVALID_FIELDS' })
      }
    }
  }

  if (!socket.data.subscriptions) {
    socket.data.subscriptions = new Map()
  }

  if (socket.data.subscriptions.size >= config.subscriptions.maxPerSocket) {
    throw Object.assign(new Error('Subscription limit reached for this connection'), { code: 'SUBSCRIPTION_LIMIT' })
  }

  const subscription = {
    id: subscriptionId || `${resource}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    resource,
    filters: validatedFilters,
    include: include || [],
    fields: fields || {},
    auth,
    createdAt: new Date()
  }

  await runHooks('subscriptionFilters', { subscription, auth })

  const roomName = `${resource}:updates`
  socket.join(roomName)
  socket.data.subscriptions.set(subscription.id, subscription)

  log.info(`Socket ${socket.id} subscribed to ${resource}`, {
    subscriptionId: subscription.id,
    filters: subscription.filters
  })

  return {
    subscriptionId: subscription.id,
    resource: subscription.resource,
    filters: subscription.filters,
    include: subscription.include,
    fields: subscription.fields,
    status: 'active'
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
        error: {
          code: error.code || 'SUBSCRIBE_ERROR',
          message: error.message
        }
      })
    }
  }

  return { restored, failed }
}

function getRecordForFiltering (context) {
  return context?.minimalRecord || context?.originalMinimalRecord || null
}

async function performBroadcast ({ method, scopeName, id, context, api, io, log }) {
  if (!io) return

  const scope = api.resources[scopeName]
  if (!scope) {
    log.warn(`Socket.IO broadcast skipped: unknown resource ${scopeName}`)
    return
  }

  const roomName = `${scopeName}:updates`
  const socketsInRoom = await io.in(roomName).fetchSockets()
  if (!socketsInRoom || socketsInRoom.length === 0) {
    log.debug(`Socket.IO broadcast skipped: no subscribers for ${roomName}`)
    return
  }

  const schemaInfo = scope.vars?.schemaInfo
  const searchSchemaStructure = schemaInfo?.searchSchemaStructure
  const recordForFiltering = getRecordForFiltering(context)

  for (const socket of socketsInRoom) {
    const subscriptions = socket.data.subscriptions
    if (!subscriptions || subscriptions.size === 0) continue

    for (const subscription of subscriptions.values()) {
      if (subscription.resource !== scopeName) continue

      if (recordForFiltering && subscription.filters && Object.keys(subscription.filters).length > 0) {
        if (!matchesFilters(recordForFiltering, subscription.filters, searchSchemaStructure)) {
          continue
        }
      }

      const notification = {
        type: `resource.${method}d`,
        resource: scopeName,
        id,
        action: method,
        subscriptionId: subscription.id,
        meta: {
          timestamp: new Date().toISOString()
        }
      }

      if (method === 'delete') {
        notification.deletedRecord = { id }
      }

      socket.emit('subscription.update', notification)
      log.debug(`Socket.IO broadcast: ${scopeName}/${id} -> socket ${socket.id}`)
      break
    }
  }
}

export const SocketIOPlugin = {
  name: 'socketio',
  dependencies: ['rest-api'],

  async install ({ api, addHook, log, scopes, helpers, vars, runHooks, pluginOptions = {} }) {
    const config = buildConfig(pluginOptions)

    let Server
    try {
      ({ Server } = await import('socket.io'))
    } catch (error) {
      requirePackage('socket.io', 'socketio', 'Socket.IO is required for WebSocket support. This is a peer dependency.')
      throw error
    }

    let createAdapter
    let createClient
    let io

    api.startSocketServer = async (server, startOptions = {}) => {
      const transportConfig = { ...config.transport, ...startOptions.transport }
      const authConfig = { ...config.auth, ...(startOptions.auth || {}) }
      const redisConfig = startOptions.redis ?? pluginOptions.redis ?? null

      config.auth = authConfig

      const defaultPath = vars.transport?.mountPath ? `${vars.transport.mountPath}/socket.io` : '/socket.io'
      const path = startOptions.path || config.transport.path || defaultPath
      const cors = startOptions.cors || config.transport.cors || { origin: '*', methods: ['GET', 'POST'] }

      io = new Server(server, {
        path,
        cors,
        transports: ['websocket', 'polling']
      })

      vars.socketIO = io
      api.io = io

      if (redisConfig) {
        try {
          ({ createClient } = await import('redis'))
        } catch (error) {
          requirePackage('redis', 'socketio', 'Redis is required for Socket.IO horizontal scaling. This is a peer dependency.')
          throw error
        }

        try {
          ({ createAdapter } = await import('@socket.io/redis-adapter'))
        } catch (error) {
          requirePackage('@socket.io/redis-adapter', 'socketio',
            'Socket.IO Redis adapter is required for horizontal scaling. This is a peer dependency.')
          throw error
        }

        const pubClient = createClient(redisConfig)
        const subClient = pubClient.duplicate()

        await Promise.all([
          pubClient.connect(),
          subClient.connect()
        ])

        io.adapter(createAdapter(pubClient, subClient))
        vars.socketIORedisClients = { pubClient, subClient }
        log.info('Socket.IO configured with Redis adapter')
      }

      io.use(async (socket, next) => {
        try {
          const authContext = await authenticateSocket({ socket, api, helpers, log, config })
          socket.data.auth = authContext
          socket.data.subscriptions = new Map()
          next()
        } catch (error) {
          log.warn('Socket.IO authentication failed', error)
          next(new Error(error.message || 'Authentication failed'))
        }
      })

      io.on('connection', (socket) => {
        log.info(`Socket connected: ${socket.id}`, {
          userId: socket.data.auth?.userId ?? null
        })

        socket.emit('connected', {
          socketId: socket.id,
          serverTime: new Date().toISOString()
        })

        socket.on('subscribe', async (payload, callback) => {
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
            log.error('Socket.IO subscribe error', error)
            const response = {
              error: {
                code: error.code || 'SUBSCRIBE_ERROR',
                message: error.message
              }
            }
            if (callback) callback(response)
            else socket.emit('subscription.error', response.error)
          }
        })

        socket.on('unsubscribe', (payload, callback) => {
          try {
            const subscriptionId = payload?.subscriptionId
            if (!subscriptionId) {
              const error = { code: 'MISSING_SUBSCRIPTION_ID', message: 'Subscription ID is required' }
              if (callback) callback({ error })
              return
            }

            const subscription = socket.data.subscriptions?.get(subscriptionId)
            if (!subscription) {
              const error = { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' }
              if (callback) callback({ error })
              return
            }

            socket.data.subscriptions.delete(subscriptionId)
            const hasOther = Array.from(socket.data.subscriptions.values())
              .some((sub) => sub.resource === subscription.resource)
            if (!hasOther) {
              socket.leave(`${subscription.resource}:updates`)
            }

            if (callback) callback({ success: true })
            log.info(`Socket ${socket.id} unsubscribed from ${subscription.resource}`, { subscriptionId })
          } catch (error) {
            log.error('Socket.IO unsubscribe error', error)
            if (callback) {
              callback({
                error: {
                  code: 'UNSUBSCRIBE_ERROR',
                  message: error.message
                }
              })
            }
          }
        })

        socket.on('restore-subscriptions', async (payload, callback) => {
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
            log.error('Socket.IO restore subscriptions error', error)
            if (callback) {
              callback({
                error: {
                  code: 'RESTORE_ERROR',
                  message: error.message
                }
              })
            }
          }
        })

        socket.on('disconnect', (reason) => {
          log.info(`Socket disconnected: ${socket.id}`, {
            reason,
            subscriptionCount: socket.data.subscriptions?.size || 0
          })
        })
      })

      log.info('Socket.IO server started', { path })
      return io
    }

    addHook('finish', 'socketio-broadcast', {}, async ({ context }) => {
      const { method, scopeName, id } = context

      if (!io) {
        log.debug('Socket.IO broadcast skipped: server not started')
        return
      }

      if (!['post', 'put', 'patch', 'delete'].includes(method)) {
        return
      }

      if (!id && method !== 'delete') {
        log.debug('Socket.IO broadcast skipped: missing record id')
        return
      }

      if (context.transaction) {
        if (!pendingBroadcasts.has(context.transaction)) {
          pendingBroadcasts.set(context.transaction, [])
        }
        pendingBroadcasts.get(context.transaction).push({ method, scopeName, id, context })
        return
      }

      await performBroadcast({ method, scopeName, id, context, api, io, log })
    })

    addHook('afterCommit', 'socketio-broadcast-deferred', {}, async ({ context }) => {
      if (!context?.transaction) return
      const broadcasts = pendingBroadcasts.get(context.transaction)
      if (!broadcasts) return

      for (const broadcast of broadcasts) {
        await performBroadcast({ ...broadcast, api, io, log })
      }

      pendingBroadcasts.delete(context.transaction)
    })

    addHook('afterRollback', 'socketio-cleanup-broadcasts', {}, async ({ context }) => {
      if (!context?.transaction) return
      pendingBroadcasts.delete(context.transaction)
    })
  }
}
