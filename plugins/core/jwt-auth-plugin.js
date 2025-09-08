/**
 * JWT Authentication Plugin for REST API
 * 
 * This plugin provides:
 * 1. JWT token validation and authentication
 * 2. Declarative authorization rules on resources
 * 3. Token revocation support
 * 4. Built-in and custom auth checkers
 * 5. Helper methods for auth operations
 * 
 * The plugin works by:
 * - Intercepting requests in the transport:request hook
 * - Validating JWT tokens and populating context.auth
 * - Checking permissions in the checkPermissions hook
 * - Providing helpers for programmatic auth checks
 */

import { requirePackage } from 'hooked-api';
import { 
  verifyToken, 
  decodeToken,
  createRevocationResource, 
  checkRevocation,
  cleanupExpiredTokens 
} from './lib/jwt-auth-helpers.js';

/* =========================================================================
 * PLUGIN EXPORTS
 * ========================================================================= */

/* =========================================================================
 * PLUGIN DEFINITION AND MAIN INSTALL FUNCTION
 * ========================================================================= */

export const JwtAuthPlugin = {
  name: 'jwt-auth',
  dependencies: ['rest-api'], // Requires REST API plugin for resource operations
  
  async install({ api, addHook, log, runHooks, helpers, vars, on, pluginOptions }) {
    
    /* -----------------------------------------------------------------------
     * INITIALIZATION
     * ----------------------------------------------------------------------- */
    
    // Use plugin options directly
    const jwtOptions = pluginOptions || {};
    
    // Initialize plugin state
    // State is scoped to this install method and accessible via closure
    const state = {
      // Timer ID for periodic cleanup of expired revoked tokens
      cleanupJob: null,
      
      // In-memory storage for revoked tokens (alternative to database storage)
      // WARNING: Memory storage is cleared on restart - use database for production
      memoryRevocationStore: new Map(),
      
      // Registry of auth checker functions (public, authenticated, is_owner, etc.)
      authCheckers: new Map()
    };
    
    /* -----------------------------------------------------------------------
     * CONFIGURATION PARSING
     * 
     * Parses and validates all configuration options with sensible defaults.
     * Configuration is divided into logical groups for clarity.
     * ----------------------------------------------------------------------- */
    
    const config = {
      // Token validation strategies
      // - secret: For symmetric algorithms (HS256)
      // - publicKey: For asymmetric algorithms (RS256)
      // - jwksUrl: For dynamic key rotation (fetches public key by kid)
      secret: jwtOptions.secret,
      publicKey: jwtOptions.publicKey,
      jwksUrl: jwtOptions.jwksUrl,
      algorithms: jwtOptions.algorithms || ['HS256', 'RS256'],
      audience: jwtOptions.audience,
      issuer: jwtOptions.issuer,
      
      // Token claim mapping
      // These configure which JWT claims map to auth context properties
      // Example JWT payload:
      // {
      //   "sub": "user123",
      //   "email": "user@example.com",
      //   "roles": ["user", "editor"],
      //   "permissions": ["posts:write", "comments:*"]
      // }
      userIdField: jwtOptions.userIdField || 'sub',         // Standard JWT subject claim
      emailField: jwtOptions.emailField || 'email',
      rolesField: jwtOptions.rolesField || 'roles',
      permissionsField: jwtOptions.permissionsField || 'permissions',
      
      // Resource ownership
      // Configures which field in resources indicates the owner
      ownershipField: jwtOptions.ownershipField || 'user_id',
      
      // Token revocation configuration
      // Supports both database and in-memory storage
      revocation: {
        enabled: jwtOptions.revocation?.enabled !== false,    // Default: enabled
        storage: jwtOptions.revocation?.storage || 'database', // 'database' or 'memory'
        cleanupInterval: jwtOptions.revocation?.cleanupInterval || 3600000, // 1 hour
        tableName: jwtOptions.revocation?.tableName || 'revoked_tokens'
      },
      
      // Optional REST endpoints
      // The plugin can automatically add logout and session endpoints
      endpoints: {
        logout: jwtOptions.endpoints?.logout || false,   // e.g., '/auth/logout'
        session: jwtOptions.endpoints?.session || false  // e.g., '/auth/session'
      }
    };
    
    /* -----------------------------------------------------------------------
     * CONFIGURATION VALIDATION
     * ----------------------------------------------------------------------- */
    
    // Ensure at least one token validation method is provided
    if (!config.secret && !config.publicKey && !config.jwksUrl) {
      throw new Error('JwtAuthPlugin requires either secret, publicKey, or jwksUrl');
    }
    
    /* -----------------------------------------------------------------------
     * JWKS CLIENT SETUP
     * 
     * For Auth0, Supabase, and other providers that use rotating keys.
     * The JWKS client fetches public keys dynamically based on the 'kid' claim.
     * 
     * When to use each verification method:
     * - secret: For simple symmetric keys (HS256) - same key signs and verifies
     * - publicKey: For static asymmetric keys (RS256) - private key signs, public verifies
     * - jwksUrl: For providers with key rotation - fetches current public key by kid
     * 
     * JWKS is preferred for production as it:
     * - Supports automatic key rotation
     * - Caches keys to reduce network calls
     * - Rate limits to prevent abuse
     * ----------------------------------------------------------------------- */
    
    /* -----------------------------------------------------------------------
     * NO MORE JWKS CLIENT SETUP - jose handles this internally
     * ----------------------------------------------------------------------- */
    
    /* -----------------------------------------------------------------------
     * TOKEN REVOCATION SETUP
     * 
     * Supports two storage backends:
     * 1. Database: Persistent, survives restarts, scalable
     * 2. Memory: Fast, ephemeral, good for development
     * ----------------------------------------------------------------------- */
    
    if (config.revocation.enabled && config.revocation.storage === 'database') {
      // Create the revoked_tokens table if it doesn't exist
      await createRevocationResource(api, config.revocation.tableName);
      
      // Set up periodic cleanup of expired tokens
      // This prevents the revocation table from growing indefinitely
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
        
        // Store cleanup job in state for proper cleanup later
        state.cleanupJob = cleanupJob;
      }
    }
    // Note: In-memory revocation store has limitations:
    // - Tokens are NOT persisted across restarts
    // - No automatic cleanup of expired tokens
    // - Not suitable for multi-instance deployments
    // Use database storage for production systems
    
    /* -----------------------------------------------------------------------
     * BUILT-IN AUTH CHECKERS
     * 
     * These are the authorization rules that can be used in resource definitions.
     * Each checker is a function that returns true/false for permission.
     * 
     * Usage in resource definition:
     *   auth: {
     *     query: ['public'],
     *     post: ['authenticated'],
     *     patch: ['is_owner', 'admin'],
     *     delete: ['admin']
     *   }
     * ----------------------------------------------------------------------- */
    
    // 'public' - Anyone can access, no authentication required
    state.authCheckers.set('public', (context) => true);
    
    // 'authenticated' - User must be logged in (have a valid token)
    state.authCheckers.set('authenticated', (context) => {
      return !!context.auth?.userId;
    });
    
    // 'is_owner' - User must own the resource
    // This is the most complex checker as it handles multiple data formats
    state.authCheckers.set('is_owner', (context, { existingRecord, scopeVars }) => {
      if (!context.auth?.userId) return false;
      
      // For new records being created, ownership check passes
      const record = existingRecord || context.attributes;
      if (!record) return true;
      
      // Determine which field indicates ownership (configurable per scope)
      const ownerField = scopeVars?.ownershipField || config.ownershipField;
      
      // Handle JSON:API format (record has type and attributes)
      if (record.type && record.attributes) {
        // First check attributes for the ownership field
        if (record.attributes[ownerField] !== undefined) {
          return record.attributes[ownerField] === context.auth.userId;
        }
        
        // If not in attributes, check relationships
        // This handles belongsTo relationships (e.g., user_id stored as 'user' relationship)
        if (record.relationships) {
          // Convert 'user_id' to 'user' for relationship name
          const relationshipName = ownerField.replace(/_id$/, '');
          const relationship = record.relationships[relationshipName];
          if (relationship?.data?.id) {
            return String(relationship.data.id) === String(context.auth.userId);
          }
        }
        
        return false;
      }
      
      // Handle simplified/flat format
      return record[ownerField] === context.auth.userId;
    });
    
    // 'admin' - User must have the 'admin' role
    state.authCheckers.set('admin', (context) => {
      return context.auth?.roles?.includes('admin');
    });
    
    // 'has_role:X' - User must have a specific role
    // Usage: 'has_role:editor', 'has_role:moderator'
    state.authCheckers.set('has_role', (context, { param }) => {
      if (!param) throw new Error('has_role requires a role parameter');
      return context.auth?.roles?.includes(param);
    });
    
    // 'has_permission:X' - User must have a specific permission
    // Usage: 'has_permission:posts:write', 'has_permission:users:delete'
    state.authCheckers.set('has_permission', (context, { param }) => {
      if (!param) throw new Error('has_permission requires a permission parameter');
      const permissions = context.auth?.permissions || [];
      
      // Check for exact permission match
      if (permissions.includes(param)) return true;
      
      // Check for wildcard permissions (e.g., 'posts:*' or '*')
      const [resource] = param.split(':');
      return permissions.includes(`${resource}:*`) || permissions.includes('*');
    });
    
    /*
     * Summary: All built-in auth checkers are now registered in state.
     * Resources can use these in their auth definitions:
     * - 'public', 'authenticated', 'is_owner', 'admin'
     * - 'has_role:X', 'has_permission:X'
     * Custom checkers can be added via helpers.auth.registerChecker()
     */
    
    /* -----------------------------------------------------------------------
     * HOOK REGISTRATIONS
     * 
     * Hooks integrate the JWT plugin with the REST API flow.
     * They execute in this order for a typical authenticated request:
     * 
     * 1. scope:added (at startup) - Process auth rules from resource definitions
     * 2. transport:request (per request) - Validate JWT and populate context.auth
     * 3. checkPermissions (per operation) - Enforce auth rules before data access
     * 
     * Example request flow:
     * - Client: POST /api/posts with Bearer token
     * - Hook 2: Validates token, sets context.auth = {userId: '123', roles: ['user']}
     * - REST API: Routes to posts resource, method = 'post'
     * - Hook 3: Checks posts.auth.post rules against context.auth
     * - If authorized: Operation proceeds
     * - If not: 403 Forbidden error
     * ----------------------------------------------------------------------- */
    
    // HOOK 1: Process auth rules when a scope is added
    // This extracts the 'auth' configuration from resource definitions
    // 
    // Example resource definition:
    // api.declareResource('posts', {
    //   auth: {
    //     query: ['public'],           // Anyone can read
    //     post: ['authenticated'],     // Must be logged in to create
    //     patch: ['is_owner', 'admin'], // Owner or admin can edit
    //     delete: ['admin']            // Only admin can delete
    //   }
    // });
    addHook('scope:added', 'jwt-process-auth-rules', {}, ({ context, scopes }) => {
      const { scopeName } = context;
      const scope = scopes[scopeName];
      
      // Extract auth rules from the resource definition
      const auth = context.scopeOptions?.auth;
      
      if (!auth) return;
      
      // Store auth rules in scope vars for later permission checking
      scope.vars.authRules = auth;
      
      log.debug(`Auth rules registered for ${scopeName}:`, scope.vars.authRules);
    });
    
    // HOOK 2: Authenticate incoming requests
    // 
    // WHEN: This hook fires for EVERY incoming HTTP request, very early in the pipeline
    // WHO CALLS IT: The transport plugin (e.g., express-plugin) triggers this hook
    // EXECUTION ORDER: After request parsing but BEFORE any resource operation
    // 
    // DATA FLOW:
    // 1. Transport extracts JWT from Authorization header: "Bearer <token>"
    // 2. Transport sets context.request.token = extracted token string
    // 3. This hook validates the token and populates context.auth
    // 4. All subsequent hooks/operations can access context.auth
    // 
    // FAILURE HANDLING:
    // - No token provided → context.auth = null → request continues as anonymous
    // - Invalid/expired token → context.auth = null → request continues as anonymous
    // - Revoked token → context.auth = null → request continues as anonymous
    // 
    // The request is NEVER blocked here. Instead:
    // - Resources with auth: { query: ['public'] } → Will allow anonymous access
    // - Resources with auth: { query: ['authenticated'] } → Will reject with 403 later
    // 
    // IMPORTANT: This hook ALWAYS returns true (never blocks requests)
    // Authorization happens later in the checkPermissions hook
    addHook('transport:request', 'jwt-populate-auth', {}, async ({ context }) => {
      // Token is extracted by transport layer (e.g., Express plugin)
      const token = context.request.token;
      
      if (!token) {
        // No token provided - this is fine, anonymous access is allowed
        // Individual resources will enforce their own auth requirements
        context.auth = null;
        return true;
      }
      
      try {
        // Step 1: Verify the token signature and claims
        const payload = await verifyToken(token, {
          secret: config.secret,
          publicKey: config.publicKey,
          algorithms: config.algorithms,
          audience: config.audience,
          issuer: config.issuer,
          jwksUrl: config.jwksUrl
        });
        
        // Step 2: Check if token has been revoked (logout functionality)
        if (config.revocation.enabled && payload.jti) {
          const isRevoked = await checkRevocation(
            payload.jti,
            api,
            config.revocation,
            state.memoryRevocationStore
          );
          
          if (isRevoked) {
            // Token has been revoked - treat as anonymous
            context.auth = null;
            return true;
          }
        }
        
        // Step 3: Extract user information from token claims
        
        /**
         * Helper to extract potentially nested values from JWT payload
         * Some providers (like Supabase) nest roles/permissions under app_metadata
         * 
         * Examples:
         * - 'roles' → payload.roles
         * - 'app_metadata.roles' → payload.app_metadata.roles
         * - 'user.permissions' → payload.user.permissions
         * 
         * @param {object} payload - JWT payload object
         * @param {string} field - Dot-notation path to the field
         * @returns {array} - Array of values, or empty array if not found
         */
        const getRoleValue = (payload, field) => {
          const keys = field.split('.');
          let value = payload;
          
          for (const key of keys) {
            value = value?.[key];
            if (value === undefined) break;
          }
          
          return Array.isArray(value) ? value : [];
        };
        
        // Step 4: Populate context.auth with user information
        // This object will be available throughout the request lifecycle
        context.auth = {
          userId: payload[config.userIdField],
          email: payload[config.emailField],
          roles: getRoleValue(payload, config.rolesField),
          permissions: getRoleValue(payload, config.permissionsField),
          token: payload,        // Full token payload for advanced use cases
          tokenId: payload.jti   // JWT ID for revocation
        };
        
        // Step 5: Allow other plugins to react to successful authentication
        context.authPayload = payload;
        await runHooks('afterAuthentication', context);
        
      } catch (error) {
        // Invalid token - log for debugging but treat as anonymous
        // This allows requests to continue with no auth context
        // 
        // Common errors:
        // - TokenExpiredError: JWT has expired (exp claim in past)
        // - JsonWebTokenError: Invalid signature, malformed token
        // - NotBeforeError: Token not active yet (nbf claim in future)
        // 
        // By setting context.auth = null, we allow:
        // - Public endpoints to still work
        // - Protected endpoints to return proper 403 errors
        // - Better error messages from checkPermissions hook
        log.debug('Token validation failed:', error.message);
        context.auth = null;
      }
      
      // Always return true - authentication is separate from authorization
      // Resources will check permissions based on context.auth
      return true;
    });
    
    /*
     * Summary: Hooks are registered. Every request now:
     * 1. Has its JWT validated and context.auth populated
     * 2. Has its permissions checked against resource auth rules
     * This creates a declarative, centralized auth system.
     * 
     * Example flow with bad token:
     * - Client: POST /api/posts with expired Bearer token
     * - HOOK 2: Token validation fails, sets context.auth = null
     * - REST API: Routes to posts resource, method = 'post'
     * - HOOK 3: Checks posts.auth.post = ['authenticated']
     * - Since context.auth is null, 'authenticated' checker returns false
     * - Result: 403 Forbidden - "Access denied. Required one of: authenticated"
     */
    
    // HOOK 3: Enforce authorization rules
    // 
    // WHEN: Fires AFTER successful routing, BEFORE the actual operation executes
    // WHO CALLS IT: The REST API plugin triggers this after determining which resource/method
    // EXECUTION ORDER: After transport:request, route matching, but BEFORE data operations
    // 
    // DATA PROVIDED:
    // - context: Contains auth (from HOOK 2), method, attributes, request details
    // - scope: The resource definition including vars.authRules from HOOK 1
    // - scopeName: The resource name (e.g., 'posts', 'users')
    // 
    // FLOW:
    // 1. Check if resource has auth rules (from scope.vars.authRules)
    // 2. Get rules for current operation (e.g., auth.post = ['authenticated'])
    // 3. Evaluate each rule using registered auth checkers
    // 4. If ANY rule passes = allow, if ALL fail = throw 403 error
    // 
    // Sequence -100 ensures this runs BEFORE custom permission checks
    addHook('checkPermissions', 'declarative-auth-check', { sequence: -100 }, 
      async ({ context, scope, scopeName }) => {
        const operation = context.method; // 'post', 'get', 'patch', etc.
        const scopeVars = scope?.vars;
        const existingRecord = context.minimalRecord;
        
        const authRules = scopeVars?.authRules;
        if (!authRules) return; // No auth rules defined
        
        const rules = authRules[operation];
        if (!rules) {
          // No rules for this operation - deny by default
          // Example: If posts only defines auth: { query: ['public'] }
          // Then POST, PATCH, DELETE will all be denied
          throw new Error(`Operation '${operation}' not allowed on resource '${scopeName}'`);
        }
        
        // Check if any rule passes (OR logic)
        // Example: auth.patch = ['is_owner', 'admin'] means:
        // Allow if user is owner OR user is admin
        let passed = false;
        let failureReasons = [];
        
        for (const rule of rules) {
          try {
            let checker;
            let param;
            
            // Parse rule (e.g., 'has_role:moderator' -> checker='has_role', param='moderator')
            if (rule.includes(':')) {
              const [checkerName, ...paramParts] = rule.split(':');
              checker = state.authCheckers.get(checkerName);
              param = paramParts.join(':');
            } else {
              checker = state.authCheckers.get(rule);
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
    
    /* -----------------------------------------------------------------------
     * HELPER METHODS
     * 
     * These methods provide programmatic access to auth functionality.
     * They can be used in hooks, custom endpoints, or other plugins.
     * 
     * Access via: helpers.auth.methodName()
     * ----------------------------------------------------------------------- */
    
    // Add verifyToken helper for other plugins (like socketio)
    // This allows external plugins to verify JWT tokens using our config
    helpers.verifyToken = (token) => verifyToken(token, config);
    
    // Add auth helpers using the standard pattern
    helpers.auth = {
      /**
       * HELPER: requireAuth
       * Require user to be authenticated
       * Throws 401 error if no valid auth context exists
       * 
       * @example
       * // In a custom hook
       * helpers.auth.requireAuth(context);
       * console.log('User ID:', context.auth.userId);
       */
      requireAuth(context) {
        if (!context.auth?.userId) {
          const error = new Error('Authentication required');
          error.statusCode = 401;
          throw error;
        }
        return context.auth;
      },
      
      /**
       * HELPER: requireRoles
       * Require user to have one of the specified roles
       * Automatically calls requireAuth first
       * 
       * @example
       * // Require admin OR moderator role
       * helpers.auth.requireRoles(context, ['admin', 'moderator']);
       */
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
      
      /**
       * HELPER: requireOwnership
       * Require user to own the resource (or be admin)
       * Supports multiple formats: direct user ID, resource object, or uses context
       * 
       * @example
       * // Check ownership of a fetched record
       * const post = await api.resources.posts.get(postId);
       * helpers.auth.requireOwnership(context, post);
       * 
       * // Check direct user ID
       * helpers.auth.requireOwnership(context, '123');
       */
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
      
      /**
       * HELPER: registerChecker
       * Register a custom auth checker for use in declarative rules
       * 
       * @example
       * // Register a time-based checker
       * helpers.auth.registerChecker('business_hours', (context) => {
       *   const hour = new Date().getHours();
       *   return hour >= 9 && hour < 17;
       * });
       * 
       * // Use in resource: auth: { post: ['business_hours'] }
       */
      registerChecker(name, checkerFn) {
        state.authCheckers.set(name, checkerFn);
        log.debug(`Registered custom auth checker: ${name}`);
      },
      
      /**
       * HELPER: checkPermission
       * Check if context passes any of the given auth rules
       * Returns true if any rule passes, false otherwise
       * 
       * @example
       * // Check multiple rules programmatically
       * const canEdit = await helpers.auth.checkPermission(
       *   context, 
       *   ['is_owner', 'admin', 'has_role:editor']
       * );
       */
      async checkPermission(context, rules, options = {}) {
        if (!rules || rules.length === 0) return true;
        
        const { existingRecord, scopeVars } = options;
        
        for (const rule of rules) {
          const [checkerName, param] = rule.split(':');
          const checker = state.authCheckers.get(checkerName);
          
          if (checker && await checker(context, { existingRecord, scopeVars, param })) {
            return true;
          }
        }
        
        return false;
      },
      
      /**
       * HELPER: logout
       * Logout the current session by revoking the JWT token
       * Requires token to have 'jti' claim for revocation tracking
       * 
       * @example
       * // In a custom logout endpoint
       * const result = await helpers.auth.logout(context);
       * return { message: 'Logged out successfully' };
       */
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
            state.memoryRevocationStore.set(token.jti, {
              userId: context.auth.userId,
              expiresAt: token.exp * 1000,
              revokedAt: Date.now()
            });
          }
        }
        
        // Run logout hooks
        context.logoutUserId = context.auth.userId;
        await runHooks('afterLogout', context);
        
        return { success: true, message: 'Logged out successfully' };
      },
      
      /**
       * HELPER: revokeToken
       * Manually revoke a specific token by its JWT ID
       * Useful for external auth system integration
       * 
       * @example
       * // Revoke a token received from webhook
       * await helpers.auth.revokeToken('token-id-123', 'user-456', 1234567890);
       */
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
          state.memoryRevocationStore.set(jti, {
            userId,
            expiresAt: expiresAt * 1000,
            revokedAt: Date.now()
          });
        }
      },
      
      /**
       * HELPER: cleanup
       * Clean up all plugin resources
       * IMPORTANT: Call this in tests to prevent memory leaks and hanging processes
       * 
       * @example
       * // In test teardown
       * afterAll(() => helpers.auth.cleanup());
       */
      cleanup() {
        // Clean up all resources
        if (state.cleanupJob) {
          clearInterval(state.cleanupJob);
          state.cleanupJob = null;
        }
        state.memoryRevocationStore.clear();
        state.authCheckers.clear();
      }
    };
    
    /* -----------------------------------------------------------------------
     * END OF HELPER METHODS
     * -----------------------------------------------------------------------
     * Summary: Auth helpers are now available for programmatic auth checks.
     * Use these in hooks, custom endpoints, or other plugins via helpers.auth.*
     * ----------------------------------------------------------------------- */
    
    /* -----------------------------------------------------------------------
     * OPTIONAL ENDPOINTS
     * 
     * The plugin can automatically create REST endpoints for auth operations.
     * These are opt-in via configuration.
     * ----------------------------------------------------------------------- */
    
    // Add logout endpoint if configured
    if (config.endpoints.logout && api.addRoute) {
      // Add as a public route that checks its own auth
      await api.addRoute({
        method: 'POST',
        path: config.endpoints.logout,
        handler: async ({ context }) => {
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
      }});
      
      log.info(`Added logout endpoint: POST ${config.endpoints.logout}`);
    }
    
    // Add session endpoint if configured  
    // Returns current user info or {authenticated: false} for anonymous
    if (config.endpoints.session && api.addRoute) {
      await api.addRoute({
        method: 'GET',
        path: config.endpoints.session,
        handler: async ({ context }) => {
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
      }});
      
      log.info(`Added session endpoint: GET ${config.endpoints.session}`);
    }
    
    /*
     * Summary: Optional endpoints provide REST API access to auth operations.
     * Enable via config: endpoints: { logout: '/auth/logout', session: '/auth/session' }
     */
    
    log.info('JWT authentication plugin installed with declarative auth support');
  }
};