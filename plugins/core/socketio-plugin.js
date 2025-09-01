import { requirePackage } from 'hooked-api';

// WeakMap to store pending broadcasts per transaction
const pendingBroadcasts = new WeakMap();

export const SocketIOPlugin = {
  name: 'socketio',
  dependencies: ['rest-api', 'jwt-auth'],

  async install({ api, addHook, log, scopes, helpers, vars, runHooks }) {
    // Dynamic imports for socket.io and related packages
    let Server, createAdapter, createClient;
    
    try {
      ({ Server } = await import('socket.io'));
    } catch (e) {
      requirePackage('socket.io', 'socketio', 
        'Socket.IO is required for WebSocket support. This is a peer dependency.');
    }
    
    let io;

    // Helper function to match filters using searchSchema
    function matchesFilters(record, filters, searchSchema) {
      if (!filters || Object.keys(filters).length === 0) {
        return true;
      }

      if (!searchSchema) {
        return true; // No schema means no filtering
      }

      // Check each filter
      for (const [filterKey, filterValue] of Object.entries(filters)) {
        const fieldDef = searchSchema.structure[filterKey];
        if (!fieldDef) continue; // Skip unknown filters

        // Get the actual field name and value
        const fieldName = fieldDef.actualField || filterKey;
        
        // Check if this is a foreign key field (ends with _id and has belongsTo)
        let recordValue;
        if (filterKey.endsWith('_id') && fieldDef.belongsTo) {
          // For foreign keys, check the relationship
          const relationName = fieldDef.as || fieldDef.belongsTo;
          const relationshipData = record.relationships?.[relationName]?.data;
          recordValue = relationshipData?.id;
        } else {
          // Handle both JSON:API structure (attributes nested) and flat structure (minimal records)
          recordValue = record.attributes?.[fieldName] ?? record[fieldName];
        }

        // Handle null/undefined
        if (recordValue === null || recordValue === undefined) {
          if (filterValue !== null && filterValue !== undefined) {
            return false;
          }
          continue;
        }

        // Check if filterOperator is a function
        if (typeof fieldDef.filterOperator === 'function') {
          // Must use filterRecord (validated during subscription)
          if (!fieldDef.filterRecord(record, filterValue)) {
            return false;
          }
        } else {
          // Use simple operator logic
          const operator = fieldDef.filterOperator || '=';

          switch (operator) {
            case 'like':
              if (!String(recordValue).toLowerCase().includes(String(filterValue).toLowerCase())) {
                return false;
              }
              break;

            case 'in':
              if (Array.isArray(filterValue)) {
                if (!filterValue.includes(recordValue)) {
                  return false;
                }
              } else if (recordValue !== filterValue) {
                return false;
              }
              break;

            case 'between':
              if (Array.isArray(filterValue) && filterValue.length === 2) {
                if (recordValue < filterValue[0] || recordValue > filterValue[1]) {
                  return false;
                }
              }
              break;

            case '=':
              // For ID comparisons, convert both to strings to handle JSON:API string IDs
              if (filterKey.endsWith('_id') && fieldDef.belongsTo) {
                if (String(recordValue) !== String(filterValue)) {
                  return false;
                }
              } else if (recordValue !== filterValue) {
                return false;
              }
              break;

            case '>':
              if (!(recordValue > filterValue)) return false;
              break;

            case '>=':
              if (!(recordValue >= filterValue)) return false;
              break;

            case '<':
              if (!(recordValue < filterValue)) return false;
              break;

            case '<=':
              if (!(recordValue <= filterValue)) return false;
              break;

            case '!=':
            case '<>':
              if (recordValue === filterValue) return false;
              break;

            default:
              // Unknown operator, treat as equality
              if (recordValue !== filterValue) return false;
          }
        }
      }

      return true;
    }

    // Main broadcast function
    async function performBroadcast({ method, scopeName, id, context }) {
      console.log(`[SOCKETIO DEBUG] performBroadcast called:`, { 
        method, 
        scopeName, 
        id,
        hasMinimalRecord: !!context.minimalRecord
      });
      
      const scope = api.resources[scopeName];
      if (!scope) {
        log.error(`Scope ${scopeName} not found for broadcasting`);
        return;
      }

      // Get all sockets in the resource room
      const roomName = `${scopeName}:updates`;
      const socketsInRoom = await io.in(roomName).fetchSockets();

      if (socketsInRoom.length === 0) {
        log.debug(`No sockets subscribed to ${roomName}`);
        return;
      }

      // Get searchSchema for filter matching
      const searchSchema = scope.vars.schemaInfo?.searchSchemaInstance;

      // Use context.minimalRecord - it's GUARANTEED to be there!
      const recordForFiltering = context.minimalRecord;
      

      // Process each socket's subscriptions
      for (const socket of socketsInRoom) {
        try {
          // Limit subscriptions per socket
          if (socket.data.subscriptions?.size > 100) {
            log.warn(`Socket ${socket.id} has too many subscriptions (${socket.data.subscriptions.size})`);
            continue;
          }

          // Find matching subscriptions
          const matchingSubscriptions = Array.from(socket.data.subscriptions?.values() || [])
            .filter(sub => sub.resource === scopeName);

          for (const subscription of matchingSubscriptions) {
            // Check if record matches filters using searchSchema
            if (!matchesFilters(recordForFiltering, subscription.filters, searchSchema)) {
              continue;
            }

            // Send minimal notification only
            const notification = {
              type: `resource.${method}d`,
              resource: scopeName,
              id: id,
              action: method,
              subscriptionId: subscription.id,
              meta: {
                timestamp: new Date().toISOString()
              }
            };

            // For delete, include minimal info since record is gone
            if (method === 'delete') {
              notification.deletedRecord = {
                id: id
              };
            }

            socket.emit('subscription.update', notification);
            log.debug(`Broadcast ${method} notification for ${scopeName}/${id} to socket ${socket.id}`);

            // Only send once per socket
            break;
          }
        } catch (error) {
          log.error(`Error broadcasting to socket ${socket.id}:`, error);
          // Continue with next socket
        }
      }
    }

    // Create Socket.IO server
    api.startSocketServer = async (server, options = {}) => {
      // Default path respects mountPath for consistency with REST API
      const defaultPath = vars.transport?.mountPath ? `${vars.transport.mountPath}/socket.io` : '/socket.io';
      
      const {
        path = defaultPath,
        cors = { origin: '*', methods: ['GET', 'POST'] },
        redis = null
      } = options;

      io = new Server(server, {
        path,
        cors,
        transports: ['websocket', 'polling']
      });

      // Store io instance for cleanup
      vars.socketIO = io;

      // Set up Redis adapter if configured
      if (redis) {
        // Dynamic import for Redis dependencies
        try {
          ({ createClient } = await import('redis'));
        } catch (e) {
          requirePackage('redis', 'socketio', 
            'Redis is required for Socket.IO horizontal scaling. This is a peer dependency.');
        }
        
        try {
          ({ createAdapter } = await import('@socket.io/redis-adapter'));
        } catch (e) {
          requirePackage('@socket.io/redis-adapter', 'socketio', 
            'Socket.IO Redis adapter is required for horizontal scaling. This is a peer dependency.');
        }
        
        const pubClient = createClient(redis);
        const subClient = pubClient.duplicate();

        await Promise.all([
          pubClient.connect(),
          subClient.connect()
        ]);

        io.adapter(createAdapter(pubClient, subClient));
        log.info('Socket.IO using Redis adapter');
        
        // Store Redis clients for cleanup
        vars.socketIORedisClients = { pubClient, subClient };
      }

      // Authentication middleware
      io.use(async (socket, next) => {
        try {
          const token = socket.handshake.auth.token;
          if (!token) {
            return next(new Error('Authentication required'));
          }

          const decoded = await helpers.verifyToken(token);
          socket.data.auth = decoded;
          socket.data.subscriptions = new Map();

          next();
        } catch (error) {
          next(new Error('Invalid authentication token'));
        }
      });

      // Connection handler
      io.on('connection', (socket) => {
        log.info(`Socket connected: ${socket.id}`, {
          userId: socket.data.auth?.userId
        });

        socket.emit('connected', {
          socketId: socket.id,
          serverTime: new Date().toISOString()
        });

        // Subscribe to resource updates
        socket.on('subscribe', async (data, callback) => {
          try {
            const { resource, filters = {}, include, fields, subscriptionId } = data;

            // Validate resource exists
            if (!scopes[resource]) {
              const error = {
                code: 'RESOURCE_NOT_FOUND',
                message: `Resource '${resource}' not found`
              };
              if (callback) callback({ error });
              else socket.emit('subscription.error', { subscriptionId, error });
              return;
            }

            const scope = scopes[resource];

            // Check permission to query this resource
            // If checkPermissions throws an error, permission is denied
            // If it completes without error, permission is granted
            try {
              await scope.checkPermissions({
                method: 'query',
                auth: socket.data.auth,
                transaction: null
              });
              // No error thrown = permission granted, continue
            } catch (permissionError) {
              // Error thrown = permission denied
              const error = {
                code: 'PERMISSION_DENIED',
                message: permissionError.message || 'You do not have permission to subscribe to this resource'
              };
              if (callback) callback({ error });
              else socket.emit('subscription.error', { subscriptionId, error });
              return;
            }

            // Validate and modify filters
            if (filters && Object.keys(filters).length > 0) {
              const searchSchema = scope.vars.schemaInfo?.searchSchemaInstance;

              if (!searchSchema) {
                const error = {
                  code: 'FILTERING_NOT_ENABLED',
                  message: `Filtering is not enabled for resource '${resource}'`
                };
                if (callback) callback({ error });
                else socket.emit('subscription.error', { subscriptionId, error });
                return;
              }

              // Check for function-based filters without filterRecord
              for (const filterKey of Object.keys(filters)) {
                const fieldDef = searchSchema.structure[filterKey];

                if (fieldDef && typeof fieldDef.filterOperator === 'function' && !fieldDef.filterRecord) {
                  const error = {
                    code: 'UNSUPPORTED_FILTER',
                    message: `Filter '${filterKey}' uses custom SQL logic and requires 'filterRecord' for real-time 
subscriptions`
                  };
                  if (callback) callback({ error });
                  else socket.emit('subscription.error', { subscriptionId, error });
                  return;
                }
              }

              // Validate filter values using searchSchema
              const { validatedObject, errors } = await searchSchema.validate(filters, {
                onlyObjectValues: true
              });

              if (Object.keys(errors).length > 0) {
                const error = {
                  code: 'INVALID_FILTERS',
                  message: 'Invalid filter values',
                  details: errors
                };
                if (callback) callback({ error });
                else socket.emit('subscription.error', { subscriptionId, error });
                return;
              }

              // Use validated filters
              data.filters = validatedObject;
            }

            // Create subscription object
            const subscription = {
              id: subscriptionId || `${resource}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              resource,
              filters: data.filters || {},
              include: include || [],
              fields: fields || {},
              auth: socket.data.auth,
              createdAt: new Date()
            };

            // Run hook to modify/validate subscription filters
            const hookContext = { subscription, auth: socket.data.auth };
            await runHooks('subscriptionFilters', hookContext);

            // Validate include parameter
            if (subscription.include && subscription.include.length > 0) {
              if (!Array.isArray(subscription.include)) {
                const error = {
                  code: 'INVALID_INCLUDE',
                  message: 'Include parameter must be an array'
                };
                if (callback) callback({ error });
                else socket.emit('subscription.error', { subscriptionId, error });
                return;
              }

              const relationships = scope.vars.schemaInfo?.schemaRelationships || {};
              for (const includePath of subscription.include) {
                const baseName = includePath.split('.')[0];
                if (!relationships[baseName]) {
                  const error = {
                    code: 'INVALID_INCLUDE',
                    message: `Invalid relationship '${baseName}' for resource '${resource}'`
                  };
                  if (callback) callback({ error });
                  else socket.emit('subscription.error', { subscriptionId, error });
                  return;
                }
              }
            }

            // Validate fields parameter
            if (subscription.fields && Object.keys(subscription.fields).length > 0) {
              if (typeof subscription.fields !== 'object' || Array.isArray(subscription.fields)) {
                const error = {
                  code: 'INVALID_FIELDS',
                  message: 'Fields parameter must be an object'
                };
                if (callback) callback({ error });
                else socket.emit('subscription.error', { subscriptionId, error });
                return;
              }

              for (const [resourceType, fieldList] of Object.entries(subscription.fields)) {
                if (!Array.isArray(fieldList)) {
                  const error = {
                    code: 'INVALID_FIELDS',
                    message: `Fields for '${resourceType}' must be an array`
                  };
                  if (callback) callback({ error });
                  else socket.emit('subscription.error', { subscriptionId, error });
                  return;
                }
              }
            }

            // Join resource room
            const roomName = `${resource}:updates`;
            socket.join(roomName);

            // Store subscription
            socket.data.subscriptions.set(subscription.id, subscription);

            // Send success response
            const response = {
              subscriptionId: subscription.id,
              resource,
              filters: subscription.filters,
              include: subscription.include,
              fields: subscription.fields,
              status: 'active'
            };

            if (callback) callback({ success: true, data: response });
            else socket.emit('subscription.created', response);

            log.info(`Socket ${socket.id} subscribed to ${resource}`, {
              subscriptionId: subscription.id,
              filters: subscription.filters
            });

          } catch (error) {
            log.error('Subscribe error:', error);
            const errorResponse = {
              code: 'SUBSCRIBE_ERROR',
              message: error.message
            };
            if (callback) callback({ error: errorResponse });
            else socket.emit('subscription.error', { subscriptionId, error: errorResponse });
          }
        });

        // Unsubscribe from resource updates
        socket.on('unsubscribe', async (data, callback) => {
          try {
            const { subscriptionId } = data;

            if (!subscriptionId) {
              const error = {
                code: 'MISSING_SUBSCRIPTION_ID',
                message: 'Subscription ID is required'
              };
              if (callback) callback({ error });
              return;
            }

            const subscription = socket.data.subscriptions.get(subscriptionId);
            if (!subscription) {
              const error = {
                code: 'SUBSCRIPTION_NOT_FOUND',
                message: 'Subscription not found'
              };
              if (callback) callback({ error });
              return;
            }

            // Remove subscription
            socket.data.subscriptions.delete(subscriptionId);

            // Leave room if no more subscriptions for this resource
            const hasOtherSubs = Array.from(socket.data.subscriptions.values())
              .some(sub => sub.resource === subscription.resource);

            if (!hasOtherSubs) {
              const roomName = `${subscription.resource}:updates`;
              socket.leave(roomName);
            }

            if (callback) callback({ success: true });

            log.info(`Socket ${socket.id} unsubscribed from ${subscription.resource}`, {
              subscriptionId
            });

          } catch (error) {
            log.error('Unsubscribe error:', error);
            if (callback) callback({
              error: {
                code: 'UNSUBSCRIBE_ERROR',
                message: error.message
              }
            });
          }
        });

        // Restore subscriptions on reconnect
        socket.on('restore-subscriptions', async (data, callback) => {
          try {
            const { subscriptions } = data;

            if (!Array.isArray(subscriptions)) {
              if (callback) callback({
                error: {
                  code: 'INVALID_DATA',
                  message: 'Subscriptions must be an array'
                }
              });
              return;
            }

            const restored = [];
            const failed = [];

            for (const sub of subscriptions) {
              await new Promise((resolve) => {
                socket.emit('subscribe', sub, (response) => {
                  if (response.error) {
                    failed.push({
                      subscriptionId: sub.subscriptionId,
                      error: response.error
                    });
                  } else {
                    restored.push(response.data.subscriptionId);
                  }
                  resolve();
                });
              });
            }

            if (callback) callback({
              success: true,
              restored,
              failed
            });

          } catch (error) {
            if (callback) callback({
              error: {
                code: 'RESTORE_ERROR',
                message: error.message
              }
            });
          }
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
          log.info(`Socket disconnected: ${socket.id}`, {
            reason,
            userId: socket.data.auth?.userId,
            subscriptionCount: socket.data.subscriptions?.size || 0
          });
        });
      });

      // Store io instance
      api.io = io;

      log.info('Socket.IO server started', { path });

      return io;
    };

    // Hook into REST API finish hook for broadcasting
    addHook('finish', 'socketio-broadcast', {}, async ({ context }) => {
      const { method, scopeName, id } = context;

      console.log(`[SOCKETIO DEBUG] finish hook called:`, { 
        method, 
        scopeName, 
        id, 
        hasMinimalRecord: !!context.minimalRecord,
        hasTransaction: !!context.transaction 
      });

      // Only broadcast for write operations
      if (!['post', 'put', 'patch', 'delete'].includes(method)) {
        log.debug(`[SOCKETIO DEBUG] Skipping broadcast for method: ${method}`);
        return;
      }

      // Skip if no ID (might happen in error cases)
      if (!id && method !== 'delete') {
        log.debug(`[SOCKETIO DEBUG] Skipping broadcast - no ID for method: ${method}`);
        return;
      }

      // Skip if io not initialized
      if (!io) {
        log.debug(`[SOCKETIO DEBUG] Skipping broadcast - io not initialized`);
        return;
      }

      // If there's a transaction, defer broadcasting
      if (context.transaction) {
        console.log(`[SOCKETIO DEBUG] Deferring broadcast until transaction commit`);
        // Store broadcast info in WeakMap
        if (!pendingBroadcasts.has(context.transaction)) {
          pendingBroadcasts.set(context.transaction, []);
        }
        pendingBroadcasts.get(context.transaction).push({
          method, scopeName, id, context
        });
        return;
      }

      // No transaction, broadcast immediately
      console.log(`[SOCKETIO DEBUG] Broadcasting immediately (no transaction)`);
      await performBroadcast({ method, scopeName, id, context });
    });

    // Hook to handle deferred broadcasts after transaction commit
    addHook('afterCommit', 'socketio-broadcast-deferred', {}, async ({ context }) => {
      if (context && context.transaction) {
        const broadcasts = pendingBroadcasts.get(context.transaction);
        if (broadcasts) {
          for (const broadcast of broadcasts) {
            await performBroadcast(broadcast);
          }
          pendingBroadcasts.delete(context.transaction);
        }
      }
    });

    // Hook to clean up on transaction rollback
    addHook('afterRollback', 'socketio-cleanup-broadcasts', {}, async ({ context }) => {
      if (context && context.transaction) {
        pendingBroadcasts.delete(context.transaction);
        log.debug(`Cleaned up pending broadcasts for rolled back transaction`);
      }
    });
  }
};
