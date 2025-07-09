/**
 * Transport-Agnostic Authentication Example
 * 
 * This example shows how the reject function and token extraction
 * at the transport layer enables truly transport-agnostic auth plugins.
 */

// A real authentication plugin that works with ANY transport
const JWTAuthPlugin = {
  name: 'jwt-auth',
  install({ addHook, vars }) {
    // Configure JWT secret
    vars.jwtSecret = process.env.JWT_SECRET || 'development-secret';
    
    addHook('transport:request', 'authenticate', {}, async ({ context, methodParams }) => {
      // Skip auth for public endpoints
      const publicPaths = ['/api/auth/login', '/api/auth/register', '/api/health'];
      if (publicPaths.includes(methodParams.url)) {
        return true;
      }
      
      // Check for token - transport already extracted it for us!
      if (!context.request.token) {
        // No token provided - reject with 401
        context.reject(401, 'Authentication required', {
          title: 'Unauthorized',
          code: 'AUTH_REQUIRED'
        });
        return false;
      }
      
      try {
        // Validate JWT token
        const decoded = await validateJWT(context.request.token, vars.jwtSecret);
        
        // Check if token is expired
        if (decoded.exp && decoded.exp < Date.now() / 1000) {
          context.reject(401, 'Token expired', {
            title: 'Unauthorized',
            code: 'TOKEN_EXPIRED'
          });
          return false;
        }
        
        // Populate auth context
        context.auth.userId = decoded.sub || decoded.userId;
        context.auth.claims = {
          email: decoded.email,
          role: decoded.role,
          permissions: decoded.permissions || []
        };
        
        return true; // Continue processing
        
      } catch (error) {
        // Invalid token
        context.reject(401, 'Invalid token', {
          title: 'Unauthorized',
          code: 'INVALID_TOKEN',
          detail: error.message
        });
        return false;
      }
    });
  }
};

// Role-based access control plugin
const RBACPlugin = {
  name: 'rbac',
  dependencies: ['jwt-auth'], // Runs after JWT auth
  install({ addHook }) {
    addHook('transport:request', 'check-permissions', {}, async ({ context, methodParams }) => {
      // Define role requirements for different paths
      const roleRequirements = {
        '/api/admin': ['admin'],
        '/api/moderator': ['admin', 'moderator'],
        '/api/user': ['admin', 'moderator', 'user']
      };
      
      // Find matching requirement
      const path = methodParams.url;
      const requiredRoles = Object.entries(roleRequirements)
        .find(([prefix]) => path.startsWith(prefix))?.[1];
      
      if (requiredRoles && context.auth.userId) {
        const userRole = context.auth.claims?.role;
        if (!requiredRoles.includes(userRole)) {
          // User doesn't have required role
          context.reject(403, 'Insufficient permissions', {
            title: 'Forbidden',
            code: 'INSUFFICIENT_ROLE',
            requiredRoles,
            userRole
          });
          return false;
        }
      }
      
      return true;
    });
  }
};

// Rate limiting plugin - also transport-agnostic!
const RateLimitPlugin = {
  name: 'rate-limit',
  install({ addHook, vars }) {
    vars.rateLimits = new Map();
    
    addHook('transport:request', 'rate-limit', {}, async ({ context }) => {
      const key = context.auth.userId || context.request.ip;
      const limit = context.auth.userId ? 1000 : 100; // Higher limit for authenticated users
      
      const current = vars.rateLimits.get(key) || 0;
      if (current >= limit) {
        context.reject(429, 'Rate limit exceeded', {
          title: 'Too Many Requests',
          retryAfter: 60 // seconds
        });
        return false;
      }
      
      vars.rateLimits.set(key, current + 1);
      
      // Reset counters every minute
      setTimeout(() => {
        vars.rateLimits.set(key, 0);
      }, 60000);
      
      return true;
    });
  }
};

// Example JWT validation function (simplified)
async function validateJWT(token, secret) {
  // In real app, use jsonwebtoken or similar library
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  
  // Decode payload (in real app, verify signature)
  const payload = JSON.parse(
    Buffer.from(parts[1], 'base64').toString()
  );
  
  return payload;
}

// Usage example showing it works with different transports:

/*
// With HTTP
import { HttpPlugin } from './plugins/http.js';
api.use(JWTAuthPlugin);
api.use(RBACPlugin);
api.use(RateLimitPlugin);
api.use(HttpPlugin);

// With Express
import { ExpressPlugin } from './plugins/express.js';
api.use(JWTAuthPlugin);
api.use(RBACPlugin);
api.use(RateLimitPlugin);
api.use(ExpressPlugin);

// Future: With WebSocket
import { WebSocketPlugin } from './plugins/websocket.js';
api.use(JWTAuthPlugin);  // Same plugins work!
api.use(RBACPlugin);      // No changes needed!
api.use(RateLimitPlugin); // Transport-agnostic!
api.use(WebSocketPlugin);

// The auth plugins don't need ANY changes to work with new transports!
*/

export { JWTAuthPlugin, RBACPlugin, RateLimitPlugin };