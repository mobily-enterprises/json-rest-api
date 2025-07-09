/**
 * Example showing how the transport:request hook works across different transports
 * 
 * The transport:request hook is a unified interception point that allows plugins
 * to handle requests from any transport layer (HTTP, WebSocket, GraphQL, etc.)
 * before they reach the API methods.
 */

// Example Auth Plugin that works with ALL transports
const UniversalAuthPlugin = {
  name: 'universal-auth',
  install({ addHook }) {
    addHook('transport:request', 'authenticate', {}, async ({ context, methodParams }) => {
      console.log(`Auth check for ${context.source} transport`);
      
      // The context.source tells us which transport this came from
      switch (context.source) {
        case 'http':
        case 'express':
          // HTTP-based auth (headers)
          const authHeader = context.request.headers.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            context.auth.userId = validateJWT(token).userId;
            context.auth.claims = validateJWT(token).claims;
          }
          break;
          
        case 'websocket':
          // WebSocket auth might come from initial connection or message
          const wsToken = methodParams.token || context.request.query.token;
          if (wsToken) {
            context.auth.userId = validateJWT(wsToken).userId;
            context.auth.claims = validateJWT(wsToken).claims;
          }
          break;
          
        case 'graphql':
          // GraphQL might use headers or operation context
          const gqlAuth = context.request.headers.authorization || 
                          methodParams.operationContext?.auth;
          if (gqlAuth) {
            context.auth.userId = validateJWT(gqlAuth).userId;
            context.auth.claims = validateJWT(gqlAuth).claims;
          }
          break;
      }
      
      // Log who's making the request
      console.log(`  User: ${context.auth.userId || 'anonymous'}`);
      
      return true; // Continue processing
    });
  }
};

// Example Rate Limiting Plugin that works with ALL transports
const RateLimitPlugin = {
  name: 'rate-limit',
  install({ addHook, vars }) {
    vars.requestCounts = new Map();
    
    addHook('transport:request', 'rate-limit', {}, async ({ context, methodParams }) => {
      // Get client identifier based on transport
      let clientId;
      
      switch (context.source) {
        case 'http':
        case 'express':
          clientId = context.request.ip;
          break;
        case 'websocket':
          clientId = context.connectionId || context.request.ip;
          break;
        case 'graphql':
          clientId = context.request.ip;
          break;
      }
      
      // Check rate limit
      const count = vars.requestCounts.get(clientId) || 0;
      if (count > 100) {
        // Handle rate limit based on transport
        if (context.source === 'http' || context.source === 'express') {
          context.raw.res.writeHead(429, { 'Content-Type': 'application/json' });
          context.raw.res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
          context.handled = true;
          return false; // Stop processing
        } else if (context.source === 'websocket') {
          // Send rate limit message over WebSocket
          context.ws.send(JSON.stringify({ 
            error: 'Rate limit exceeded',
            type: 'rate_limit' 
          }));
          context.handled = true;
          return false;
        }
      }
      
      // Increment counter
      vars.requestCounts.set(clientId, count + 1);
      return true;
    });
  }
};

// Example Logging Plugin that works with ALL transports
const RequestLoggingPlugin = {
  name: 'request-logger',
  install({ addHook }) {
    addHook('transport:request', 'log-request', {}, async ({ context, methodParams }) => {
      const timestamp = new Date().toISOString();
      
      // Log differently based on transport
      switch (context.source) {
        case 'http':
        case 'express':
          console.log(`[${timestamp}] ${context.source.toUpperCase()} ${context.request.method} ${context.request.path} from ${context.request.ip}`);
          break;
          
        case 'websocket':
          console.log(`[${timestamp}] WS ${methodParams.event || 'message'} from ${context.request.ip}`);
          break;
          
        case 'graphql':
          console.log(`[${timestamp}] GQL ${methodParams.operationName || 'query'} from ${context.request.ip}`);
          break;
      }
      
      return true;
    });
  }
};

// How different transports would call the hook:

// 1. HTTP Plugin (already implemented)
const HttpPlugin = {
  name: 'http',
  async install({ runHooks, api }) {
    const handleRequest = async (req, res) => {
      const context = {
        source: 'http',
        auth: { userId: null, claims: null },
        request: {
          ip: req.socket.remoteAddress,
          method: req.method,
          path: req.url,
          headers: req.headers
        },
        raw: { req, res }
      };
      
      const hookParams = { req, res, url: req.url, method: req.method };
      const shouldContinue = await runHooks('transport:request', context, hookParams);
      
      if (!shouldContinue || context.handled) return;
      
      // Continue with normal HTTP processing...
    };
  }
};

// 2. WebSocket Plugin (hypothetical)
const WebSocketPlugin = {
  name: 'websocket',
  async install({ runHooks, api }) {
    const handleMessage = async (ws, message, connectionId) => {
      const context = {
        source: 'websocket',
        auth: { userId: null, claims: null },
        request: {
          ip: ws._socket.remoteAddress,
          headers: ws.upgradeReq?.headers || {},
          query: parseQuery(ws.upgradeReq?.url)
        },
        connectionId,
        ws,
        raw: { ws, message }
      };
      
      const parsed = JSON.parse(message);
      const hookParams = { 
        ws, 
        message: parsed, 
        event: parsed.type,
        token: parsed.token 
      };
      
      const shouldContinue = await runHooks('transport:request', context, hookParams);
      
      if (!shouldContinue || context.handled) return;
      
      // Continue with WebSocket message processing...
    };
  }
};

// 3. GraphQL Plugin (hypothetical)
const GraphQLPlugin = {
  name: 'graphql',
  async install({ runHooks, api }) {
    const handleGraphQLRequest = async (req, res, { query, variables, operationName }) => {
      const context = {
        source: 'graphql',
        auth: { userId: null, claims: null },
        request: {
          ip: req.socket.remoteAddress,
          method: 'POST',
          path: '/graphql',
          headers: req.headers
        },
        raw: { req, res }
      };
      
      const hookParams = { 
        req, 
        res, 
        query,
        variables,
        operationName,
        operationContext: { /* GraphQL context */ }
      };
      
      const shouldContinue = await runHooks('transport:request', context, hookParams);
      
      if (!shouldContinue || context.handled) return;
      
      // Continue with GraphQL processing...
    };
  }
};

// Example usage showing how it all works together:
/*
import { Api } from 'hooked-api';

const api = new Api({ name: 'my-api', version: '1.0.0' });

// Install plugins - they work with ANY transport!
await api.use(UniversalAuthPlugin);
await api.use(RateLimitPlugin);
await api.use(RequestLoggingPlugin);

// Install transport plugins
await api.use(HttpPlugin);
await api.use(WebSocketPlugin);
await api.use(GraphQLPlugin);

// Now ALL transports have:
// - Authentication handling
// - Rate limiting  
// - Request logging
// - Any other plugins that hook into transport:request

// The beauty is that security/logging/middleware plugins only need to 
// hook into ONE place to work with ALL transports!
*/