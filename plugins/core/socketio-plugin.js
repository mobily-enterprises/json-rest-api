import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export const SocketIOPlugin = {
  name: 'socketio',
  dependencies: ['rest-api', 'jwt-auth'],
  
  async install({ api, addHook, log, scopes, helpers, vars }) {
    const config = {
      port: api.config.socketio?.port || 3001,
      cors: {
        origin: '*',
        credentials: true,
        ...api.config.socketio?.cors
      },
      // Optional Redis configuration
      redis: api.config.socketio?.redis,
      ...api.config.socketio
    };
    
    // Create Socket.io server
    const io = new Server(config.port, {
      cors: config.cors,
      transports: ['websocket', 'polling']
    });
    
    // Setup Redis adapter if configured (for multi-server support)
    if (config.redis?.url) {
      try {
        const pubClient = createClient({ url: config.redis.url });
        const subClient = pubClient.duplicate();
        
        await Promise.all([
          pubClient.connect(),
          subClient.connect()
        ]);
        
        io.adapter(createAdapter(pubClient, subClient));
        log.info('Socket.io Redis adapter configured for multi-server support');
      } catch (error) {
        log.error('Failed to setup Redis adapter:', error);
        throw error;
      }
    }
    
    // Store io instance for external access
    vars.io = io;
    api.io = io;
    
    // Middleware to authenticate socket connections
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.slice(7);
        
        if (!token) {
          // Allow connection but mark as unauthenticated
          socket.data.auth = null;
          return next();
        }
        
        // Create context for JWT validation
        const context = {
          request: { token },
          auth: null
        };
        
        // Run the transport:request hooks which includes JWT validation
        await runHooks('transport:request', context);
        
        // Store auth data on socket
        socket.data.auth = context.auth;
        socket.data.userId = context.auth?.userId;
        
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
    
    // Handle socket connections
    io.on('connection', (socket) => {
      const { auth } = socket.data;
      
      log.debug(`Socket connected: ${socket.id}, authenticated: ${!!auth}`);
      
      // Join user-specific room if authenticated
      if (auth?.userId) {
        socket.join(`user:${auth.userId}`);
      }
      
      // Send connection confirmation
      socket.emit('connected', {
        socketId: socket.id,
        authenticated: !!auth,
        userId: auth?.userId,
        timestamp: new Date().toISOString()
      });
      
      // Handle resource subscriptions
      socket.on('subscribe', async (data, callback) => {
        try {
          const { resource, filters = {}, subscriptionId } = data;
          
          // Validate resource exists
          if (!scopes[resource]) {
            const error = { code: 'RESOURCE_NOT_FOUND', message: `Resource '${resource}' not found` };
            if (callback) callback({ error });
            else socket.emit('subscription.error', { subscriptionId, error });
            return;
          }
          
          // Check if user has permission to query this resource
          const scope = scopes[resource];
          const authRules = scope.vars?.authRules;
          
          if (authRules?.query) {
            const hasPermission = await helpers.auth.checkPermission(
              { auth },
              authRules.query,
              { scopeVars: scope.vars }
            );
            
            if (!hasPermission) {
              const error = { code: 'PERMISSION_DENIED', message: 'You do not have permission to subscribe to this resource' };
              if (callback) callback({ error });
              else socket.emit('subscription.error', { subscriptionId, error });
              return;
            }
          }
          
          // Join resource room
          const roomName = `resource:${resource}`;
          socket.join(roomName);
          
          // Store subscription metadata
          if (!socket.data.subscriptions) {
            socket.data.subscriptions = new Map();
          }
          
          const subId = subscriptionId || `${resource}-${Date.now()}`;
          socket.data.subscriptions.set(subId, {
            resource,
            filters,
            roomName,
            createdAt: new Date()
          });
          
          // Send confirmation
          const response = {
            subscriptionId: subId,
            resource,
            filters,
            status: 'active'
          };
          
          if (callback) callback({ success: true, data: response });
          else socket.emit('subscription.created', response);
          
        } catch (error) {
          log.error('Subscribe error:', error);
          const errorResponse = { code: 'SUBSCRIBE_ERROR', message: error.message };
          if (callback) callback({ error: errorResponse });
          else socket.emit('subscription.error', { error: errorResponse });
        }
      });
      
      // Handle unsubscribe
      socket.on('unsubscribe', (data, callback) => {
        const { subscriptionId } = data;
        
        if (!subscriptionId || !socket.data.subscriptions?.has(subscriptionId)) {
          const error = { code: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' };
          if (callback) callback({ error });
          return;
        }
        
        const subscription = socket.data.subscriptions.get(subscriptionId);
        socket.leave(subscription.roomName);
        socket.data.subscriptions.delete(subscriptionId);
        
        const response = { subscriptionId, status: 'removed' };
        if (callback) callback({ success: true, data: response });
        else socket.emit('subscription.removed', response);
      });
      
      // Handle disconnect
      socket.on('disconnect', (reason) => {
        log.debug(`Socket disconnected: ${socket.id}, reason: ${reason}`);
      });
    });
    
    // Hook into logout to disconnect user sockets
    addHook('afterLogout', 'socketio-disconnect-on-logout', {}, async ({ context }) => {
      if (context.auth?.userId) {
        // Disconnect all sockets for this user
        const userRoom = `user:${context.auth.userId}`;
        const sockets = await io.in(userRoom).fetchSockets();
        
        for (const socket of sockets) {
          socket.emit('logout', { message: 'You have been logged out' });
          socket.disconnect(true);
        }
      }
    });
    
    // Hook into REST API data operations for broadcasting
    addHook('afterDataWrite', 'socketio-broadcast', {}, async (result) => {
      const { scopeName, operation, record, context } = result;
      
      // Get all sockets in the resource room
      const roomName = `resource:${scopeName}`;
      const sockets = await io.in(roomName).fetchSockets();
      
      // Prepare the update message
      const message = {
        type: 'resource.update',
        resource: scopeName,
        operation, // 'create', 'update', 'delete'
        data: {
          type: scopeName,
          id: String(record.id),
          attributes: record
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      };
      
      // Check permissions and filters for each socket
      for (const socket of sockets) {
        try {
          // Find relevant subscriptions for this socket
          if (!socket.data.subscriptions) continue;
          
          for (const [subId, subscription] of socket.data.subscriptions) {
            if (subscription.resource !== scopeName) continue;
            
            // Check if record matches subscription filters
            let matchesFilters = true;
            if (subscription.filters && Object.keys(subscription.filters).length > 0) {
              for (const [key, value] of Object.entries(subscription.filters)) {
                if (record[key] !== value) {
                  matchesFilters = false;
                  break;
                }
              }
            }
            
            if (!matchesFilters) continue;
            
            // Check if user has permission to see this specific record
            const scope = scopes[scopeName];
            const authRules = scope.vars?.authRules;
            
            if (authRules) {
              const readRules = authRules.query || authRules.get;
              if (readRules) {
                const hasPermission = await helpers.auth.checkPermission(
                  { auth: socket.data.auth },
                  readRules,
                  { existingRecord: record, scopeVars: scope.vars }
                );
                
                if (!hasPermission) continue;
              }
            }
            
            // Send update to this socket with subscription ID
            socket.emit('resource.update', {
              ...message,
              subscriptionId: subId
            });
            
            // Only send once per socket, even if multiple subscriptions match
            break;
          }
        } catch (error) {
          log.error(`Error broadcasting to socket ${socket.id}:`, error);
        }
      }
      
      return result;
    });
    
    // Cleanup on shutdown
    if (api.on) {
      api.on('shutdown', async () => {
        await io.close();
        log.info('Socket.io server closed');
      });
    }
    
    log.info(`Socket.io server started on port ${config.port}`);
    if (config.redis?.url) {
      log.info('Socket.io configured for multi-server support with Redis');
    }
  }
};