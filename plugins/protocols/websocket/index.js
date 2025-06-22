import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { RoomManager } from './room-manager.js';
import { SocketManager } from './socket-manager.js';
import { LiveQueryManager } from './live-queries.js';

export const WebSocketPlugin = {
  install(api, options = {}) {
    const {
      path = '/socket.io',
      cors = { origin: '*', credentials: true },
      transports = ['websocket', 'polling'],
      pingTimeout = 60000,
      pingInterval = 25000,
      maxHttpBufferSize = 1e6,
      connectionStateRecovery = {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
      },
      rateLimit = {
        points: 100,
        duration: 60
      },
      jwtSecret = api.config?.jwtSecret || 'your-secret-key',
      redis = api.redis
    } = options;

    let io;
    const roomManager = new RoomManager();
    const socketManager = new SocketManager();
    const liveQueryManager = new LiveQueryManager(api);

    // Initialize Socket.IO
    api.websocket = {
      io: null,
      roomManager,
      socketManager,
      liveQueryManager,

      // Initialize server
      init(server) {
        io = new SocketServer(server, {
          path,
          cors,
          transports,
          pingTimeout,
          pingInterval,
          maxHttpBufferSize,
          connectionStateRecovery
        });

        // Use Redis adapter for horizontal scaling
        if (redis) {
          import('@socket.io/redis-adapter').then(({ createAdapter }) => {
            io.adapter(createAdapter(redis, redis.duplicate()));
          }).catch(() => {
            console.warn('Redis adapter not available, using default adapter');
          });
        }

        // Authentication middleware
        io.use(async (socket, next) => {
          try {
            const token = socket.handshake.auth.token || 
                         socket.handshake.headers.authorization?.replace('Bearer ', '');

            if (token) {
              const decoded = jwt.verify(token, jwtSecret);
              socket.user = decoded;
              socket.userId = decoded.id || decoded.sub;
            }

            // Rate limiting
            if (rateLimit && socketManager.isRateLimited(socket.id)) {
              return next(new Error('Rate limit exceeded'));
            }

            next();
          } catch (error) {
            next(new Error('Authentication failed'));
          }
        });

        // Connection handler
        io.on('connection', (socket) => {
          socketManager.addSocket(socket);
          
          // Send socket ID to client so they can identify their own broadcasts
          socket.emit('connection:established', {
            socketId: socket.id,
            timestamp: new Date().toISOString()
          });
          
          // Join user room if authenticated
          if (socket.userId) {
            socket.join(`user:${socket.userId}`);
          }

          // Handle resource subscriptions
          socket.on('subscribe', async (data) => {
            const { resource, id, filter, options = {}, include, excludeSelf } = data;
            
            try {
              // Check permissions
              const hasPermission = await checkResourcePermission(
                api, 
                resource, 
                'read', 
                socket.user
              );

              if (!hasPermission) {
                socket.emit('subscription:error', {
                  resource,
                  error: 'Permission denied'
                });
                return;
              }
              
              // Store excludeSelf preference for this socket
              if (!socket.subscriptionPrefs) {
                socket.subscriptionPrefs = new Map();
              }
              const subKey = id ? `${resource}:${id}` : `${resource}:${filter ? JSON.stringify(filter) : 'all'}`;
              socket.subscriptionPrefs.set(subKey, { excludeSelf: excludeSelf || false });

              // Subscribe to resource changes
              if (id) {
                // Single resource subscription
                const room = `${resource}:${id}`;
                socket.join(room);
                roomManager.addSocketToRoom(socket.id, room);

                // Send current state
                try {
                  const queryOptions = {
                    user: socket.user
                  };
                  
                  // Add include parameter if provided
                  if (include) {
                    queryOptions.include = include;
                  }
                  
                  const result = await api.resources[resource].get(id, queryOptions);
                  
                  socket.emit('resource:state', {
                    resource,
                    id,
                    data: result.data,
                    included: result.included
                  });
                  
                  // Handle deep subscriptions for included resources
                  if (include && result.data) {
                    await handleDeepSubscriptions(socket, resource, result.data, include, api);
                  }
                } catch (error) {
                  // Resource might not exist yet
                }
              } else {
                // Collection subscription
                const room = filter 
                  ? `${resource}:filter:${JSON.stringify(filter)}`
                  : `${resource}:all`;
                
                socket.join(room);
                roomManager.addSocketToRoom(socket.id, room);

                // Set up live query if requested
                if (options.liveQuery) {
                  const queryId = liveQueryManager.createLiveQuery(
                    resource,
                    filter,
                    socket
                  );
                  socket.emit('livequery:created', { queryId });
                }

                // Send initial data
                const queryOptions = {
                  filter: filter || {},
                  include
                };
                
                const result = await api.resources[resource].query(queryOptions, {
                  user: socket.user
                });
                
                socket.emit('collection:state', {
                  resource,
                  filter,
                  data: result.data,
                  meta: result.meta,
                  included: result.included
                });
                
                // Handle deep subscriptions for included resources in collection
                if (include && result.data) {
                  for (const item of result.data) {
                    await handleDeepSubscriptions(socket, resource, item, include, api);
                  }
                }
              }

              socket.emit('subscription:success', { resource, id, filter, include });
            } catch (error) {
              socket.emit('subscription:error', {
                resource,
                error: error.message
              });
            }
          });

          // Handle unsubscribe
          socket.on('unsubscribe', (data) => {
            const { resource, id, filter } = data;
            
            if (id) {
              const room = `${resource}:${id}`;
              socket.leave(room);
              roomManager.removeSocketFromRoom(socket.id, room);
              
              // Clean up deep subscriptions
              const parentKey = `${resource}:${id}`;
              if (socket.deepSubscriptions?.has(parentKey)) {
                const deepRooms = socket.deepSubscriptions.get(parentKey);
                for (const deepRoom of deepRooms) {
                  socket.leave(deepRoom);
                  roomManager.removeSocketFromRoom(socket.id, deepRoom);
                }
                socket.deepSubscriptions.delete(parentKey);
              }
            } else {
              const room = filter 
                ? `${resource}:filter:${JSON.stringify(filter)}`
                : `${resource}:all`;
              socket.leave(room);
              roomManager.removeSocketFromRoom(socket.id, room);
              
              // Clean up live query
              liveQueryManager.removeLiveQueriesForSocket(socket.id);
            }
          });

          // Handle real-time operations
          socket.on('resource:create', async (data) => {
            const { resource, data: resourceData, requestId } = data;
            
            try {
              const result = await api.resources[resource].create(resourceData, {
                user: socket.user,
                socketId: socket.id,  // Track originating socket
                requestId  // Pass through request ID
              });
              
              socket.emit('resource:created', {
                requestId,
                data: result.data
              });
            } catch (error) {
              socket.emit('resource:error', {
                requestId,
                error: error.message
              });
            }
          });

          socket.on('resource:update', async (data) => {
            const { resource, id, data: updateData, requestId } = data;
            
            try {
              const result = await api.resources[resource].update(id, updateData, {
                user: socket.user,
                socketId: socket.id,  // Track originating socket
                requestId  // Pass through request ID
              });
              
              socket.emit('resource:updated', {
                requestId,
                data: result.data
              });
            } catch (error) {
              socket.emit('resource:error', {
                requestId,
                error: error.message
              });
            }
          });

          socket.on('resource:delete', async (data) => {
            const { resource, id, requestId } = data;
            
            try {
              await api.resources[resource].delete(id, {
                user: socket.user,
                socketId: socket.id,  // Track originating socket
                requestId  // Pass through request ID
              });
              
              socket.emit('resource:deleted', {
                requestId,
                id
              });
            } catch (error) {
              socket.emit('resource:error', {
                requestId,
                error: error.message
              });
            }
          });

          // Handle presence
          socket.on('presence:join', async (channel) => {
            const room = `presence:${channel}`;
            await socket.join(room);
            roomManager.addSocketToRoom(socket.id, room);
            io.to(room).emit('presence:user:joined', {
              userId: socket.userId,
              socketId: socket.id,
              timestamp: new Date()
            });
          });

          socket.on('presence:leave', (channel) => {
            const room = `presence:${channel}`;
            socket.leave(room);
            roomManager.removeSocketFromRoom(socket.id, room);
            io.to(room).emit('presence:user:left', {
              userId: socket.userId,
              socketId: socket.id,
              timestamp: new Date()
            });
          });

          // Handle custom events
          socket.on('custom:event', async (data) => {
            const { event, payload, room } = data;
            
            // Check if user can emit to this room
            if (room && socket.rooms.has(room)) {
              io.to(room).emit(`custom:${event}`, {
                from: socket.userId,
                payload,
                timestamp: new Date()
              });
            }
          });

          // Handle disconnect
          socket.on('disconnect', () => {
            socketManager.removeSocket(socket.id);
            roomManager.removeSocket(socket.id);
            liveQueryManager.removeLiveQueriesForSocket(socket.id);
            
            // Clean up all deep subscriptions
            if (socket.deepSubscriptions) {
              for (const [parentKey, deepRooms] of socket.deepSubscriptions) {
                for (const deepRoom of deepRooms) {
                  roomManager.removeSocketFromRoom(socket.id, deepRoom);
                }
              }
              socket.deepSubscriptions.clear();
            }
            
            // Notify presence channels
            socket.rooms.forEach(room => {
              if (room.startsWith('presence:')) {
                io.to(room).emit('presence:user:left', {
                  userId: socket.userId,
                  socketId: socket.id,
                  timestamp: new Date()
                });
              }
            });
          });
        });

        api.websocket.io = io;
        return io;
      },

      // Emit to specific rooms
      emit(room, event, data) {
        if (io) {
          io.to(room).emit(event, data);
        }
      },

      // Emit to specific user
      emitToUser(userId, event, data) {
        if (io) {
          io.to(`user:${userId}`).emit(event, data);
        }
      },

      // Broadcast to all connected clients
      broadcast(event, data) {
        if (io) {
          io.emit(event, data);
        }
      },

      // Clean up WebSocket server
      async close() {
        if (io) {
          // Disconnect all clients
          const sockets = await io.fetchSockets();
          for (const socket of sockets) {
            socket.disconnect(true);
          }
          
          // Close the server
          return new Promise((resolve) => {
            io.close(() => {
              io = null;
              resolve();
            });
          });
        }
      },

      // Get connected sockets
      getConnectedSockets() {
        return socketManager.getAllSockets();
      },

      // Get sockets in a room
      getSocketsInRoom(room) {
        return roomManager.getSocketsInRoom(room);
      },

      // Get user's sockets
      getUserSockets(userId) {
        return socketManager.getUserSockets(userId);
      },

      // Disconnect user
      disconnectUser(userId, reason = 'Disconnected by server') {
        const sockets = socketManager.getUserSockets(userId);
        sockets.forEach(socketId => {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(reason);
          }
        });
      }
    };

    // Helper function for smart broadcasting
    const smartBroadcast = (room, event, data, originSocketId = null) => {
      if (!originSocketId) {
        // No origin socket, broadcast to all
        io.to(room).emit(event, data);
        return;
      }
      
      // Get all sockets in the room
      const socketsInRoom = io.sockets.adapter.rooms.get(room);
      if (!socketsInRoom) return;
      
      // Check each socket's preferences
      socketsInRoom.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) return;
        
        // Check if this socket wants to exclude self
        let excludeSelf = false;
        if (socket.subscriptionPrefs) {
          // Check various subscription keys that might match this room
          for (const [subKey, prefs] of socket.subscriptionPrefs) {
            if (room.includes(subKey) || subKey.includes(room)) {
              excludeSelf = prefs.excludeSelf || false;
              break;
            }
          }
        }
        
        // Send to socket unless it's the origin and excludeSelf is true
        if (socketId !== originSocketId || !excludeSelf) {
          socket.emit(event, data);
        }
      });
    };

    // Hook into API lifecycle events
    api.hook('afterInsert', async (context) => {
      const resource = context.resource || context.options?.type;
      if (!resource || !io) return;

      // Format data as JSON:API if it's not already
      let data;
      if (context.result.data) {
        // Already in JSON:API format
        data = context.result;
      } else {
        // Convert to JSON:API format
        data = {
          data: {
            id: String(context.result.id),
            type: resource,
            attributes: { ...context.result }
          }
        };
        delete data.data.attributes.id;
      }
      
      const originSocketId = context.options?.socketId;
      const requestId = context.options?.requestId;
      
      // Emit to resource room with metadata
      smartBroadcast(`${resource}:all`, 'resource:created', {
        resource,
        data: data.data,
        meta: {
          originSocketId,
          requestId,
          timestamp: new Date().toISOString()
        }
      }, originSocketId);

      // Emit to filtered rooms
      roomManager.getFilteredRooms(resource).forEach(room => {
        const filter = roomManager.getFilterFromRoom(room);
        if (matchesFilter(data.data, filter)) {
          smartBroadcast(room, 'resource:created', {
            resource,
            data: data.data,
            filter,
            meta: {
              originSocketId,
              requestId,
              timestamp: new Date().toISOString()
            }
          }, originSocketId);
        }
      });

      // Update live queries
      await liveQueryManager.updateLiveQueries(resource, 'created', data.data);
    });

    api.hook('afterUpdate', async (context) => {
      const resource = context.resource || context.options?.type;
      if (!resource || !io) return;

      // Format data as JSON:API if it's not already
      let data;
      if (context.result.data) {
        // Already in JSON:API format
        data = context.result;
      } else {
        // Convert to JSON:API format
        data = {
          data: {
            id: String(context.result.id || context.id),
            type: resource,
            attributes: { ...context.result }
          }
        };
        delete data.data.attributes.id;
      }
      
      const id = context.id;
      const originSocketId = context.options?.socketId;
      const requestId = context.options?.requestId;
      
      // Emit to specific resource room
      smartBroadcast(`${resource}:${id}`, 'resource:updated', {
        resource,
        id,
        data: data.data,
        meta: {
          originSocketId,
          requestId,
          timestamp: new Date().toISOString()
        }
      }, originSocketId);

      // Emit to collection room
      smartBroadcast(`${resource}:all`, 'resource:updated', {
        resource,
        id,
        data: data.data,
        meta: {
          originSocketId,
          requestId,
          timestamp: new Date().toISOString()
        }
      }, originSocketId);

      // Emit to filtered rooms
      roomManager.getFilteredRooms(resource).forEach(room => {
        const filter = roomManager.getFilterFromRoom(room);
        if (matchesFilter(data.data, filter)) {
          smartBroadcast(room, 'resource:updated', {
            resource,
            id,
            data: data.data,
            filter,
            meta: {
              originSocketId,
              requestId,
              timestamp: new Date().toISOString()
            }
          }, originSocketId);
        }
      });

      // Update live queries
      await liveQueryManager.updateLiveQueries(resource, 'updated', data.data);
    });

    api.hook('afterDelete', async (context) => {
      const resource = context.resource || context.options?.type;
      if (!resource || !io) return;

      const id = context.id;
      const originSocketId = context.options?.socketId;
      const requestId = context.options?.requestId;
      
      // Emit to specific resource room
      smartBroadcast(`${resource}:${id}`, 'resource:deleted', {
        resource,
        id,
        meta: {
          originSocketId,
          requestId,
          timestamp: new Date().toISOString()
        }
      }, originSocketId);

      // Emit to collection room
      smartBroadcast(`${resource}:all`, 'resource:deleted', {
        resource,
        id,
        meta: {
          originSocketId,
          requestId,
          timestamp: new Date().toISOString()
        }
      }, originSocketId);

      // Emit to filtered rooms
      roomManager.getFilteredRooms(resource).forEach(room => {
        smartBroadcast(room, 'resource:deleted', {
          resource,
          id,
          meta: {
            originSocketId,
            timestamp: new Date().toISOString()
          }
        }, originSocketId);
      });

      // Update live queries
      await liveQueryManager.updateLiveQueries(resource, 'deleted', { id });
    });

    // Attach to HTTP server if available
    if (api.server) {
      api.websocket.init(api.server);
    }
  }
};

// Helper function to check resource permissions
async function checkResourcePermission(api, resource, operation, user) {
  // Implement your permission logic here
  // This is a simple example
  if (!api.resources[resource]) {
    return false;
  }

  // You can implement more complex permission checks
  // based on your application's requirements
  return true;
}

// Helper function to check if data matches filter
function matchesFilter(data, filter) {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  for (const [key, value] of Object.entries(filter)) {
    if (data.attributes) {
      // JSON:API format
      if (data.attributes[key] !== value) {
        return false;
      }
    } else {
      // Direct format
      if (data[key] !== value) {
        return false;
      }
    }
  }

  return true;
}

// Helper function to handle deep subscriptions for included resources
async function handleDeepSubscriptions(socket, parentResource, parentData, include, api) {
  if (!include || !parentData) return;
  
  // Parse include parameter (comma-separated list of relationships)
  const includes = typeof include === 'string' ? include.split(',') : include;
  const schema = api.schemas?.get(parentResource);
  if (!schema) return;
  
  // Track subscriptions for cleanup
  if (!socket.deepSubscriptions) {
    socket.deepSubscriptions = new Map();
  }
  
  const parentKey = `${parentResource}:${parentData.id}`;
  if (!socket.deepSubscriptions.has(parentKey)) {
    socket.deepSubscriptions.set(parentKey, new Set());
  }
  
  for (const includePath of includes) {
    // Handle nested includes (e.g., "authorId.countryId")
    const parts = includePath.split('.');
    let currentResource = parentResource;
    let currentData = parentData;
    let currentSchema = schema;
    
    for (let i = 0; i < parts.length; i++) {
      const fieldName = parts[i];
      const fieldDef = currentSchema?.structure?.[fieldName];
      
      if (!fieldDef) continue;
      
      // Handle 1:1 relationships (refs)
      if (fieldDef.refs?.resource) {
        const relatedId = currentData.attributes?.[fieldName] || currentData[fieldName];
        if (relatedId) {
          const room = `${fieldDef.refs.resource}:${relatedId}`;
          socket.join(room);
          api.websocket.roomManager.addSocketToRoom(socket.id, room);
          socket.deepSubscriptions.get(parentKey).add(room);
        }
        
        // Update current context for nested includes
        if (i < parts.length - 1) {
          currentResource = fieldDef.refs.resource;
          currentSchema = api.schemas?.get(currentResource);
          // Find the related data in included array or relationships
          if (currentData.relationships?.[fieldName.replace(/Id$/, '')]) {
            const rel = currentData.relationships[fieldName.replace(/Id$/, '')];
            currentData = { id: rel.data?.id, type: rel.data?.type };
          }
        }
      }
      
      // Handle 1:n relationships (virtual lists)
      else if (fieldDef.type === 'list' && fieldDef.foreignResource) {
        // Subscribe to filtered collection for this parent
        const filter = { [fieldDef.foreignKey]: currentData.id };
        if (fieldDef.defaultFilter) {
          Object.assign(filter, fieldDef.defaultFilter);
        }
        
        const room = `${fieldDef.foreignResource}:filter:${JSON.stringify(filter)}`;
        socket.join(room);
        api.websocket.roomManager.addSocketToRoom(socket.id, room);
        socket.deepSubscriptions.get(parentKey).add(room);
        
        // Also subscribe to the general collection for new items
        const allRoom = `${fieldDef.foreignResource}:all`;
        socket.join(allRoom);
        api.websocket.roomManager.addSocketToRoom(socket.id, allRoom);
        socket.deepSubscriptions.get(parentKey).add(allRoom);
      }
    }
  }
}