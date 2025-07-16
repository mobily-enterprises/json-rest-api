# WebSocket Subscription Plugin Implementation Plan

## Overview
Implement a WebSocket plugin that allows clients to subscribe to real-time changes in resources, fully integrated with the JWT authentication plugin and declarative permission system.

## Key Changes from Original Plan

### 1. Authentication Integration
The WebSocket plugin now integrates with the JWT Auth Plugin we just built:
- Uses the same JWT validation logic
- Supports the same declarative auth rules
- Automatically disconnects on token revocation/logout

### 2. Simplified Architecture
Instead of custom auth hooks, we leverage the existing system:
- Reuses `context.auth` from JWT plugin
- Uses declarative `auth` rules on resources
- No need for separate `authenticateWebSocket` hook

## Updated Implementation

### 1. **plugins/core/websocket-plugin.js** - Main Plugin
```javascript
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import { connectionManager } from './lib/websocket-connection-manager.js';
import { subscriptionManager } from './lib/websocket-subscription-manager.js';
import { messageHandlers } from './lib/websocket-message-handlers.js';

export const WebSocketPlugin = {
  name: 'websocket',
  dependencies: ['rest-api', 'jwt-auth'], // Now depends on JWT auth
  
  async install({ api, addHook, log, scopes, helpers, vars, on }) {
    const config = {
      port: api.config.websocket?.port || 3001,
      path: api.config.websocket?.path || '/ws',
      heartbeatInterval: api.config.websocket?.heartbeatInterval || 30000,
      maxSubscriptionsPerConnection: api.config.websocket?.maxSubscriptionsPerConnection || 100,
      ...api.config.websocket
    };
    
    // Initialize WebSocket server
    const wss = new WebSocketServer({ 
      port: config.port,
      path: config.path
    });
    
    // Store managers in vars
    vars.wsConnectionManager = connectionManager;
    vars.wsSubscriptionManager = subscriptionManager;
    
    // Store on API instance for external access
    api.ws = {
      server: wss,
      connections: connectionManager.connections,
      subscriptions: subscriptionManager.subscriptions,
      broadcast: (scopeName, operation, record, context) => {
        subscriptionManager.broadcast(scopeName, operation, record, context);
      },
      disconnectUser: (userId) => {
        // Disconnect all connections for a user (e.g., on logout)
        for (const [connId, conn] of connectionManager.connections) {
          if (conn.context.auth?.userId === userId) {
            conn.ws.close(1000, 'User logged out');
            connectionManager.remove(connId);
          }
        }
      }
    };
    
    // Handle new connections
    wss.on('connection', async (ws, request) => {
      const connectionId = nanoid();
      
      // Extract token and validate using JWT plugin
      const token = extractToken(request);
      const context = {
        request: { token },
        auth: null
      };
      
      // Run JWT auth hook to populate context.auth
      if (token) {
        const authHooks = api.getHooks('transport:request');
        const jwtHook = authHooks.find(h => h.name === 'jwt-populate-auth');
        if (jwtHook) {
          await jwtHook.handler({ context, runHooks: async () => {} });
        }
      }
      
      // Store connection with auth context
      connectionManager.add(connectionId, ws, context);
      
      // Setup heartbeat
      const heartbeat = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        } else {
          clearInterval(heartbeat);
        }
      }, config.heartbeatInterval);
      
      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await messageHandlers.handle(message, {
            connectionId,
            ws,
            api,
            scopes,
            context,
            config,
            helpers,
            vars
          });
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: {
              code: 'INVALID_MESSAGE',
              message: error.message
            }
          }));
        }
      });
      
      // Handle disconnect
      ws.on('close', () => {
        connectionManager.remove(connectionId);
        subscriptionManager.removeAllForConnection(connectionId);
        clearInterval(heartbeat);
      });
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        authenticated: !!context.auth,
        userId: context.auth?.userId,
        timestamp: new Date().toISOString()
      }));
    });
    
    // Hook into logout to disconnect WebSocket connections
    addHook('afterLogout', 'websocket-disconnect-on-logout', {}, async ({ context }) => {
      if (context.auth?.userId) {
        api.ws.disconnectUser(context.auth.userId);
      }
    });
    
    // Hook into REST API data operations for broadcasting
    addHook('afterDataWrite', 'websocket-broadcast', {}, async (result) => {
      const { scopeName, operation, record, context } = result;
      
      // Skip if no subscriptions exist for this scope
      if (!subscriptionManager.hasSubscriptionsForScope(scopeName)) {
        return result;
      }
      
      // Broadcast to subscribers
      await subscriptionManager.broadcast(scopeName, operation, record, context, { 
        scopes, 
        helpers, 
        vars 
      });
      
      return result;
    });
    
    log.info(`WebSocket server started on port ${config.port}`);
  }
};

// Helper to extract token from WebSocket request
function extractToken(request) {
  // 1. Check Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  // 2. Check query parameters
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');
  if (token) return token;
  
  // 3. Check WebSocket protocol (for browsers that don't support headers)
  if (request.headers['sec-websocket-protocol']) {
    const protocols = request.headers['sec-websocket-protocol'].split(',').map(p => p.trim());
    const authProtocol = protocols.find(p => p.startsWith('token-'));
    if (authProtocol) {
      return authProtocol.slice(6);
    }
  }
  
  return null;
}
```

### 2. **Updated Security Integration**

The security layer now uses the declarative auth system:

```javascript
// In websocket-subscription-manager.js
async broadcast(scopeName, operation, record, context, deps) {
  const subs = this.subscriptions.get(scopeName);
  if (!subs) return;
  
  const { scopes, helpers, vars } = deps;
  const scope = scopes[scopeName];
  const scopeVars = scope.vars;
  
  for (const subscription of subs) {
    try {
      // Get connection and its auth context
      const connection = connectionManager.get(subscription.connectionId);
      if (!connection) continue;
      
      // Check if record matches subscription filters
      const matchesFilters = await this.recordMatchesFilters(
        record, 
        subscription.filters, 
        scope, 
        context
      );
      
      if (!matchesFilters) continue;
      
      // Use declarative auth rules if available
      const authRules = scopeVars?.authRules;
      if (authRules) {
        // Check if user can read this resource
        const readRules = authRules.query || authRules.get;
        if (readRules) {
          const authCheckers = vars.authCheckers;
          let hasPermission = false;
          
          for (const rule of readRules) {
            const checker = authCheckers[rule];
            if (checker && await checker(connection.context, { existingRecord: record, scopeVars })) {
              hasPermission = true;
              break;
            }
          }
          
          if (!hasPermission) continue;
        }
      }
      
      // Transform and send
      const jsonApiRecord = await this.transformToJsonApi(
        scopeName, 
        record, 
        subscription, 
        context
      );
      
      connectionManager.send(subscription.connectionId, {
        type: 'resource.update',
        subscriptionId: subscription.id,
        operation,
        data: jsonApiRecord,
        meta: {
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('Error broadcasting to subscription:', error);
    }
  }
}
```

### 3. **Simplified Client Usage**

```javascript
// Frontend with Supabase auth
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Login and get token
const { data: { session } } = await supabase.auth.signIn({
  email: 'user@example.com',
  password: 'password'
});

// Connect to WebSocket with same token
const ws = new WebSocket(`ws://localhost:3001/ws?token=${session.access_token}`);

ws.onopen = () => {
  // Subscribe to books I own
  ws.send(JSON.stringify({
    id: 'my-books',
    type: 'subscribe',
    resource: 'books',
    filters: {
      user_id: session.user.id
    }
  }));
  
  // Subscribe to all published books
  ws.send(JSON.stringify({
    id: 'published-books',
    type: 'subscribe',
    resource: 'books',
    filters: {
      published: true
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'resource.update':
      // Real-time update!
      console.log('Book updated:', message.data);
      updateBookInUI(message.data);
      break;
      
    case 'connected':
      console.log('Connected, authenticated:', message.authenticated);
      break;
  }
};

// On logout
await supabase.auth.signOut();
// WebSocket automatically disconnects due to afterLogout hook
```

## How Authentication Works

### Connection Flow
1. Client connects with JWT token (via query param, header, or protocol)
2. WebSocket plugin uses JWT plugin to validate token
3. Connection stores `context.auth` with user info
4. All subscriptions from this connection use this auth context

### Permission Checking
1. When subscribing, checks if user can access the resource type
2. When broadcasting, checks each record against declarative auth rules
3. Only sends updates for records the user has permission to see

### Logout Handling
1. When user logs out via REST API, `afterLogout` hook fires
2. WebSocket plugin disconnects all connections for that user
3. Token revocation prevents reconnection with same token

## Security Benefits

1. **Unified Auth System**: Same tokens, same permissions as REST API
2. **Automatic Enforcement**: Declarative rules apply to WebSocket too
3. **No Auth Duplication**: Reuses JWT plugin's validation logic
4. **Clean Logout**: Connections closed when tokens revoked

## Implementation Steps

1. **Install dependencies**: `npm install ws nanoid`
2. **Create plugin files** in order shown above
3. **No custom auth needed**: JWT plugin handles everything
4. **Test with auth provider**: Use same tokens as REST API

## Example Resource with WebSocket Support

```javascript
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    published: { type: 'boolean', default: false }
  },
  
  // Same auth rules apply to WebSocket!
  auth: {
    query: ['public'],           // Anyone can subscribe to posts
    get: ['public'],            
    post: ['authenticated'],     
    patch: ['is_owner'],        
    delete: ['is_owner', 'admin']
  }
});

// WebSocket will:
// - Allow anyone to subscribe (query: ['public'])
// - Only send updates for posts they can see
// - Filter unpublished posts for non-owners automatically
```

This approach is much cleaner than the original plan - it reuses all the authentication and authorization infrastructure we just built!