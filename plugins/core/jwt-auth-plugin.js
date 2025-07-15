import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { 
  verifyToken, 
  createRevocationResource, 
  checkRevocation,
  cleanupExpiredTokens 
} from './lib/jwt-auth-helpers.js';

export const JwtAuthPlugin = {
  name: 'jwt-auth',
  version: '1.0.0',
  dependencies: ['rest-api'],
  
  async install({ api, addHook, log, addRoute, runHooks, helpers, vars, on }) {
    const config = {
      // Token validation
      secret: api.config.jwtAuth?.secret,
      publicKey: api.config.jwtAuth?.publicKey,
      jwksUrl: api.config.jwtAuth?.jwksUrl,
      algorithms: api.config.jwtAuth?.algorithms || ['HS256', 'RS256'],
      audience: api.config.jwtAuth?.audience,
      issuer: api.config.jwtAuth?.issuer,
      
      // Token parsing
      userIdField: api.config.jwtAuth?.userIdField || 'sub',
      emailField: api.config.jwtAuth?.emailField || 'email',
      rolesField: api.config.jwtAuth?.rolesField || 'roles',
      permissionsField: api.config.jwtAuth?.permissionsField || 'permissions',
      
      // Ownership settings
      ownershipField: api.config.jwtAuth?.ownershipField || 'user_id',
      
      // Revocation settings
      revocation: {
        enabled: api.config.jwtAuth?.revocation?.enabled !== false,
        storage: api.config.jwtAuth?.revocation?.storage || 'database',
        cleanupInterval: api.config.jwtAuth?.revocation?.cleanupInterval || 3600000, // 1 hour
        tableName: api.config.jwtAuth?.revocation?.tableName || 'revoked_tokens'
      },
      
      // Endpoints
      endpoints: {
        logout: api.config.jwtAuth?.endpoints?.logout || false,
        session: api.config.jwtAuth?.endpoints?.session || false
      }
    };
    
    // Validate configuration
    if (!config.secret && !config.publicKey && !config.jwksUrl) {
      throw new Error('JwtAuthPlugin requires either secret, publicKey, or jwksUrl');
    }
    
    // Initialize JWKS client if needed
    let jwksClientInstance;
    if (config.jwksUrl) {
      jwksClientInstance = jwksClient({
        jwksUri: config.jwksUrl,
        cache: true,
        cacheMaxAge: 600000, // 10 minutes
        rateLimit: true,
        jwksRequestsPerMinute: 5
      });
    }
    
    // Create revocation resource if using database
    if (config.revocation.enabled && config.revocation.storage === 'database') {
      await createRevocationResource(api, config.revocation.tableName);
      
      // Set up cleanup interval
      if (config.revocation.cleanupInterval > 0) {
        const cleanupJob = setInterval(async () => {
          try {
            const deleted = await cleanupExpiredTokens(api, config.revocation.tableName);
            if (deleted > 0) {
              log.debug(`Cleaned up ${deleted} expired tokens from revocation list`);
            }
          } catch (error) {
            log.error('Failed to cleanup expired tokens:', error);
          }
        }, config.revocation.cleanupInterval);
        
        // Store cleanup job reference in vars
        vars.jwtAuthCleanupJob = cleanupJob;
      }
    }
    
    // In-memory revocation store (fallback)
    const memoryRevocationStore = new Map();
    
    // Store in vars for cleanup access
    vars.jwtAuthMemoryStore = memoryRevocationStore;
    
    // Store auth checkers for declarative auth
    const authCheckers = {
      // Anyone can access
      'public': (context) => true,
      
      // Must be authenticated
      'authenticated': (context) => {
        return !!context.auth?.userId;
      },
      
      // Must own the resource
      'is_owner': (context, { existingRecord, scopeVars }) => {
        if (!context.auth?.userId) return false;
        if (!existingRecord) return true; // Creating new record is OK
        
        const ownerField = scopeVars?.ownershipField || config.ownershipField;
        return existingRecord[ownerField] === context.auth.userId;
      },
      
      // Must be admin (special case of role check)
      'admin': (context) => {
        return context.auth?.roles?.includes('admin');
      },
      
      // Dynamic role check: 'has_role:moderator', 'has_role:editor'
      'has_role': (context, { param }) => {
        if (!param) throw new Error('has_role requires a role parameter');
        return context.auth?.roles?.includes(param);
      },
      
      // Dynamic permission check: 'has_permission:posts:write'
      'has_permission': (context, { param }) => {
        if (!param) throw new Error('has_permission requires a permission parameter');
        const permissions = context.auth?.permissions || [];
        
        // Check exact match
        if (permissions.includes(param)) return true;
        
        // Check wildcard
        const [resource] = param.split(':');
        return permissions.includes(`${resource}:*`) || permissions.includes('*');
      }
    };
    
    // Store checkers in vars for extension
    vars.authCheckers = authCheckers;
    
    // Hook into scope:added to process auth rules
    on('scope:added', ({ scope, scopeName, scopeVars }) => {
      // Get auth from scopeOptions (where addResource config goes)
      const auth = scope?.scopeOptions?.auth;
      
      if (!auth) return;
      
      // Store auth rules in scopeVars for permission checking
      scopeVars.authRules = auth;
      
      log.debug(`Auth rules registered for ${scopeName}:`, scopeVars.authRules);
    });
    
    // Simple auth population hook - just validates token and sets context.auth
    addHook('transport:request', 'jwt-populate-auth', {}, async ({ context, runHooks }) => {
      const token = context.request.token; // Already extracted by framework
      
      if (!token) {
        // No token - no problem, let resources decide if they need auth
        context.auth = null;
        return true;
      }
      
      try {
        // Verify token
        const payload = await verifyToken(token, {
          secret: config.secret,
          publicKey: config.publicKey,
          algorithms: config.algorithms,
          audience: config.audience,
          issuer: config.issuer,
          jwksClient: jwksClientInstance
        });
        
        // Check revocation if enabled
        if (config.revocation.enabled && payload.jti) {
          const isRevoked = await checkRevocation(
            payload.jti,
            api,
            config.revocation,
            memoryRevocationStore
          );
          
          if (isRevoked) {
            // Revoked token - treat as no auth
            context.auth = null;
            return true;
          }
        }
        
        // Parse nested fields (e.g., 'app_metadata.roles' for Supabase)
        const getRoleValue = (payload, field) => {
          const keys = field.split('.');
          let value = payload;
          
          for (const key of keys) {
            value = value?.[key];
            if (value === undefined) break;
          }
          
          return Array.isArray(value) ? value : [];
        };
        
        // Populate auth context
        context.auth = {
          userId: payload[config.userIdField],
          email: payload[config.emailField],
          roles: getRoleValue(payload, config.rolesField),
          permissions: getRoleValue(payload, config.permissionsField),
          token: payload,
          tokenId: payload.jti
        };
        
        // Run post-auth hooks if any
        await runHooks('afterAuthentication', context, { payload });
        
      } catch (error) {
        // Invalid token - treat as no auth
        log.debug('Token validation failed:', error.message);
        context.auth = null;
      }
      
      return true; // Always continue - let resources handle authorization
    });
    
    // Add the declarative auth check hook
    addHook('checkPermissions', 'declarative-auth-check', { sequence: -100 }, 
      async ({ context, scopeName, operation, existingRecord, scopeVars }) => {
        const authRules = scopeVars?.authRules;
        if (!authRules) return; // No auth rules defined
        
        const rules = authRules[operation];
        if (!rules) {
          // No rules for this operation - deny by default
          throw new Error(`Operation '${operation}' not allowed on resource '${scopeName}'`);
        }
        
        // Check if any rule passes
        let passed = false;
        let failureReasons = [];
        
        for (const rule of rules) {
          try {
            let checker;
            let param;
            
            // Parse rule (e.g., 'has_role:moderator' -> checker='has_role', param='moderator')
            if (rule.includes(':')) {
              const [checkerName, ...paramParts] = rule.split(':');
              checker = authCheckers[checkerName];
              param = paramParts.join(':');
            } else {
              checker = authCheckers[rule];
            }
            
            if (!checker) {
              throw new Error(`Unknown auth rule: ${rule}`);
            }
            
            // Run the checker
            const result = await checker(context, { 
              existingRecord, 
              scopeVars, 
              param 
            });
            
            if (result) {
              passed = true;
              break; // Any rule passing is enough
            } else {
              failureReasons.push(rule);
            }
          } catch (error) {
            log.error(`Error checking auth rule ${rule}:`, error);
            failureReasons.push(`${rule} (error: ${error.message})`);
          }
        }
        
        if (!passed) {
          const error = new Error(
            `Access denied. Required one of: ${rules.join(', ')}. ` +
            `Failed checks: ${failureReasons.join(', ')}`
          );
          error.statusCode = 403;
          throw error;
        }
      }
    );
    
    // Add auth helpers using the standard pattern
    helpers.auth = {
      // Check if user is authenticated
      requireAuth(context) {
        if (!context.auth?.userId) {
          const error = new Error('Authentication required');
          error.statusCode = 401;
          throw error;
        }
        return context.auth;
      },
      
      // Check if user has required roles
      requireRoles(context, requiredRoles) {
        this.requireAuth(context);
        
        const userRoles = context.auth.roles || [];
        const hasRole = requiredRoles.some(role => userRoles.includes(role));
        
        if (!hasRole) {
          const error = new Error(`Required role(s): ${requiredRoles.join(', ')}`);
          error.statusCode = 403;
          throw error;
        }
        
        return context.auth;
      },
      
      // Check if user owns resource
      requireOwnership(context, resourceOrUserId) {
        this.requireAuth(context);
        
        let resourceUserId;
        
        // If second parameter is an object (the record), extract the ownership field
        if (typeof resourceOrUserId === 'object' && resourceOrUserId !== null) {
          resourceUserId = resourceOrUserId[config.ownershipField];
          if (!resourceUserId) {
            throw new Error(`Resource does not have ownership field '${config.ownershipField}'`);
          }
        } else if (resourceOrUserId !== undefined) {
          // Direct user ID provided
          resourceUserId = resourceOrUserId;
        } else {
          // No second parameter - try to get from context.existingRecord
          if (context.existingRecord) {
            resourceUserId = context.existingRecord[config.ownershipField];
            if (!resourceUserId) {
              throw new Error(`Resource does not have ownership field '${config.ownershipField}'`);
            }
          } else {
            throw new Error('No resource or user ID provided for ownership check');
          }
        }
        
        // Check ownership
        if (context.auth.userId !== resourceUserId && !context.auth.roles?.includes('admin')) {
          const error = new Error('Access denied: you do not own this resource');
          error.statusCode = 403;
          throw error;
        }
        
        return context.auth;
      },
      
      // Register custom auth checker
      registerChecker(name, checkerFn) {
        authCheckers[name] = checkerFn;
        log.debug(`Registered custom auth checker: ${name}`);
      },
      
      // Check if context passes any of the given auth rules
      async checkPermission(context, rules, options = {}) {
        if (!rules || rules.length === 0) return true;
        
        const { existingRecord, scopeVars } = options;
        
        for (const rule of rules) {
          const [checkerName, param] = rule.split(':');
          const checker = authCheckers[checkerName];
          
          if (checker && await checker(context, { existingRecord, scopeVars, param })) {
            return true;
          }
        }
        
        return false;
      },
      
      // Logout current session
      async logout(context) {
        if (!context.auth?.token) {
          throw new Error('No active session to logout');
        }
        
        const token = context.auth.token;
        if (!token.jti) {
          throw new Error('Token must have jti claim for revocation');
        }
        
        // Add to revocation store
        if (config.revocation.enabled) {
          if (config.revocation.storage === 'database') {
            await api.resources[config.revocation.tableName].post({
              jti: token.jti,
              user_id: context.auth.userId,
              expires_at: new Date(token.exp * 1000),
              revoked_at: new Date()
            });
          } else {
            // Memory storage
            memoryRevocationStore.set(token.jti, {
              userId: context.auth.userId,
              expiresAt: token.exp * 1000,
              revokedAt: Date.now()
            });
          }
        }
        
        // Run logout hooks
        await runHooks('afterLogout', context, { userId: context.auth.userId });
        
        return { success: true, message: 'Logged out successfully' };
      },
      
      // Revoke specific token (for external auth integration)
      async revokeToken(jti, userId, expiresAt) {
        if (!config.revocation.enabled) {
          throw new Error('Token revocation is not enabled');
        }
        
        if (config.revocation.storage === 'database') {
          await api.resources[config.revocation.tableName].post({
            jti,
            user_id: userId,
            expires_at: new Date(expiresAt * 1000),
            revoked_at: new Date()
          });
        } else {
          memoryRevocationStore.set(jti, {
            userId,
            expiresAt: expiresAt * 1000,
            revokedAt: Date.now()
          });
        }
      }
    };
    
    // Add logout endpoint if configured
    if (config.endpoints.logout) {
      // Add as a public route that checks its own auth
      addRoute('POST', config.endpoints.logout, async ({ context }) => {
        try {
          if (!context.auth) {
            return {
              statusCode: 401,
              body: { error: 'Authentication required' }
            };
          }
          
          const result = await helpers.auth.logout(context);
          return { statusCode: 200, body: result };
        } catch (error) {
          return {
            statusCode: 400,
            body: { error: error.message }
          };
        }
      });
      
      log.info(`Added logout endpoint: POST ${config.endpoints.logout}`);
    }
    
    // Add session endpoint if configured
    if (config.endpoints.session) {
      addRoute('GET', config.endpoints.session, async ({ context }) => {
        if (!context.auth) {
          return {
            statusCode: 200,
            body: { authenticated: false }
          };
        }
        
        return {
          statusCode: 200,
          body: {
            authenticated: true,
            user: {
              id: context.auth.userId,
              email: context.auth.email,
              roles: context.auth.roles
            },
            expiresAt: new Date(context.auth.token.exp * 1000).toISOString()
          }
        };
      });
      
      log.info(`Added session endpoint: GET ${config.endpoints.session}`);
    }
    
    log.info('JWT authentication plugin installed with declarative auth support');
  }
};