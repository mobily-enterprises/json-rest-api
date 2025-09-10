/**
 * JWT Authentication Plugin for REST API
 * 
 * This plugin provides:
 * 1. JWT token validation (authentication only)
 * 2. Minimal built-in checkers: 'public', 'authenticated', 'owns'
 * 3. Framework for custom authorization checkers
 * 4. Token revocation support
 * 5. Helper methods for auth operations
 * 
 * The plugin makes minimal assumptions:
 * - Tokens contain 'sub' (userId) and 'email' fields
 * - No built-in concepts of roles, permissions, or teams
 * - Users register domain-specific checkers for their needs
 * 
 * The plugin works by:
 * - Validating JWT tokens and extracting userId and email
 * - Providing a generic checker:parameter pattern
 * - Enforcing declarative auth rules on resources
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
      // Minimal assumptions - only userId and email are extracted
      // Example JWT payload:
      // {
      //   "sub": "user123",
      //   "email": "user@example.com"
      //   // Any other fields are available in context.auth.token
      // }
      userIdField: jwtOptions.userIdField || 'sub',         // Standard JWT subject claim
      emailField: jwtOptions.emailField || 'email',
      
      // Resource ownership
      // Configures which field in resources indicates the owner
      ownershipField: jwtOptions.ownershipField || 'user_id',
      
      // Users resource configuration
      usersResource: jwtOptions.usersResource || 'users',
      
      // Auto-ownership configuration
      // Automatically adds user_id field and manages ownership
      autoOwnership: {
        enabled: jwtOptions.autoOwnership?.enabled !== false, // Default true
        field: jwtOptions.autoOwnership?.field || 'user_id',
        userResource: jwtOptions.autoOwnership?.userResource || 'users',
        excludeResources: jwtOptions.autoOwnership?.excludeResources || [],
        filterByOwner: jwtOptions.autoOwnership?.filterByOwner !== false, // Default true
        requireOwnership: jwtOptions.autoOwnership?.requireOwnership || false
      },
      
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
     * Minimal set of generic authorization checkers.
     * The plugin makes no assumptions about roles, permissions, or other domain-specific concepts.
     * 
     * Usage in resource definition:
     *   auth: {
     *     query: ['public'],
     *     post: ['authenticated'],
     *     patch: ['owns'],
     *     delete: ['owns']
     *   }
     * 
     * Users should register their own domain-specific checkers for roles, permissions, etc.
     * ----------------------------------------------------------------------- */
    
    // 'public' - Anyone can access, no authentication required
    state.authCheckers.set('public', () => true);
    
    // 'authenticated' - User must be logged in (have a valid token)
    state.authCheckers.set('authenticated', (context) => {
      return !!context.auth?.userId;
    });
    
    // 'owns' - User must own the resource
    // Checks the ownership field (default: user_id) against the authenticated user
    state.authCheckers.set('owns', (context, { existingRecord, scopeVars }) => {
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
    
    /*
     * Summary: Only 3 minimal built-in checkers:
     * - 'public': Anyone can access
     * - 'authenticated': Must have valid token
     * - 'owns': Must own the resource
     * 
     * For domain-specific authorization (roles, permissions, teams, etc.),
     * register custom checkers using helpers.auth.registerChecker()
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
     * - Hook 2: Validates token, sets context.auth = {userId: '123', email: 'user@example.com'}
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
    
    // HOOK: Automatically add user_id field to schemas with ownership
    addHook('schema:enrich', 'jwt-auto-add-ownership-field', {}, async ({ context, scopes }) => {
      //
      const { fields, scopeName } = context
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled) return;
      

      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) return;
      
      // Check if resource has ownership enabled via resource options
      const scope = scopes[scopeName];
      const hasOwnership = scope?._scopeOptions?.ownership === true;
      
      if (!hasOwnership) return;
      
      const ownershipField = config.autoOwnership.field;
      
      // Check if field already exists
      if (fields[ownershipField]) {
        // Enhance existing field if it doesn't have belongsTo
        if (!fields[ownershipField].belongsTo) {
          log.warn(`Resource '${scopeName}' has '${ownershipField}' field but missing belongsTo relationship. Adding it.`);
          fields[ownershipField].belongsTo = config.autoOwnership.userResource;
          fields[ownershipField].as = 'owner';
        }
        return;
      }
      
      // Add the user_id field with proper configuration
      fields[ownershipField] = {
        type: 'string', // UUID for Supabase/Auth0, string for others
        required: false, // Will be set automatically
        belongsTo: config.autoOwnership.userResource,
        as: 'owner',
        nullable: true,
        indexed: true, // Important for query performance
        description: 'Automatically managed ownership field'
      };
      
      log.debug(`Added ${ownershipField} field to resource '${scopeName}' for ownership tracking`);
    });
    
    // HOOK: Automatically set user_id on record creation
    addHook('beforeSchemaValidate', 'jwt-auto-set-ownership', { sequence: -50 }, async ({ context, scopeName, scopes }) => {
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled) return;
      
      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) return;
      
      // Skip if no auth context
      if (!context.auth?.userId) {
        if (config.autoOwnership.requireOwnership) {
          throw new Error(`Cannot create ${scopeName} without authentication`);
        }
        return;
      }
      
      // Check if resource has ownership enabled
      const scope = scopes[scopeName];
      const hasOwnership = scope?._scopeOptions?.ownership === true;
      
      if (!hasOwnership) return;
      
      // Only set on POST (create)
      if (context.method !== 'post') return;
      
      const ownershipField = config.autoOwnership.field;
      
      // Check if schema has the ownership field
      const schemaInfo = scope?.vars?.schemaInfo;
      if (!schemaInfo?.schemaStructure?.[ownershipField]) {
        log.warn(`Resource '${scopeName}' has ownership enabled but no ${ownershipField} field in schema`);
        return;
      }
      
      // Set the ownership field in the input record
      // Handle both JSON:API and simplified formats
      if (context.inputRecord?.data?.attributes) {
        // JSON:API format
        context.inputRecord.data.attributes[ownershipField] = context.auth.userId;
      } else if (context.inputRecord) {
        // Simplified format
        context.inputRecord[ownershipField] = context.auth.userId;
      }
      
      log.trace(`Set ${ownershipField} to ${context.auth.userId} for new ${scopeName} record`);
    });
    
    // HOOK: Automatically filter queries by owner (unless admin)
    addHook('knexQueryFiltering', 'jwt-filter-by-owner', { sequence: -40 }, async ({ context, scopes }) => {
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled || !config.autoOwnership.filterByOwner) return;
      
      const { query, tableName, scopeName } = context.knexQuery;
      
      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) return;
      
      // Skip if no auth context
      if (!context.auth?.userId) {
        if (config.autoOwnership.requireOwnership) {
          throw new Error(`Cannot query ${scopeName} without authentication`);
        }
        return;
      }
      
      // Skip filtering for admins
      if (context.auth.roles?.includes('admin')) {
        log.trace(`Admin user - skipping ownership filter for ${scopeName}`);
        return;
      }
      
      // Check if resource has ownership enabled
      const scope = scopes[scopeName];
      const hasOwnership = scope?._scopeOptions?.ownership === true;
      
      if (!hasOwnership) return;
      
      const ownershipField = config.autoOwnership.field;
      
      // Check if schema has the ownership field
      const schemaInfo = scope?.vars?.schemaInfo;
      if (!schemaInfo?.schemaStructure?.[ownershipField]) {
        log.trace(`Resource '${scopeName}' has no ${ownershipField} field - skipping ownership filter`);
        return;
      }
      
      // Add WHERE clause for ownership
      query.where(function() {
        this.where(`${tableName}.${ownershipField}`, context.auth.userId);
      });
      
      log.trace(`Added ownership filter for ${scopeName}: ${ownershipField} = ${context.auth.userId}`);
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
        
        // Step 3: Populate context.auth with minimal user information
        // Only userId and email are extracted - no assumptions about roles or permissions
        context.auth = {
          userId: payload[config.userIdField],   // User identifier (default: 'sub')
          email: payload[config.emailField],     // User email (default: 'email')
          token: payload,                        // Full token payload for custom use
          tokenId: payload.jti                   // JWT ID for revocation
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
       * HELPER: requireOwnership
       * Require user to own the resource
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
        if (context.auth.userId !== resourceUserId) {
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
       *   ['owns', 'role:admin']
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
     * JWT AUTH HELPER METHODS FOR USER MANAGEMENT
     * 
     * These helpers provide user management functionality for auth providers.
     * They work with an existing users resource that must be defined separately.
     * ----------------------------------------------------------------------- */
    
    helpers.jwtAuth = {
      /**
       * HELPER: upsertUser
       * Create or update a user record in the users resource
       * Used by auth providers (Supabase, Google, etc.) to sync user data
       * 
       * @param {string} userId - User ID to create or update
       * @param {object} userData - User attributes to set
       * @returns {Promise<object>} The created or updated user record
       * 
       * @example
       * const user = await helpers.jwtAuth.upsertUser('user-123', {
       *   email: 'user@example.com',
       *   name: 'John Doe',
       *   supabase_id: '550e8400-e29b-41d4-a716-446655440000'
       * });
       */
      async upsertUser(userId, userData) {
        const resource = api.resources[config.usersResource];
        if (!resource) {
          throw new Error(`Users resource '${config.usersResource}' not found. Ensure it's defined in server/api/users.js`);
        }
        
        // Check if user exists
        const existing = await resource.query({
          filters: { id: userId },
          simplified: true,
          context: { auth: { userId: 'system', system: true } }
        });
        
        if (existing.data?.length > 0) {
          // Update existing user
          return resource.patch(userId, {
            inputRecord: { 
              data: { 
                type: config.usersResource, 
                id: userId, 
                attributes: userData 
              } 
            },
            context: { auth: { userId, system: true } }
          });
        } else {
          // Create new user
          return resource.post({
            inputRecord: { 
              data: { 
                type: config.usersResource, 
                attributes: { id: userId, ...userData } 
              } 
            },
            context: { auth: null }  // Public endpoint
          });
        }
      },
      
      /**
       * HELPER: getUser
       * Retrieve a user record from the users resource
       * 
       * @param {string} userId - User ID to retrieve
       * @returns {Promise<object>} The user record
       * 
       * @example
       * const user = await helpers.jwtAuth.getUser('user-123');
       */
      async getUser(userId) {
        const resource = api.resources[config.usersResource];
        if (!resource) {
          throw new Error(`Users resource '${config.usersResource}' not found. Ensure it's defined in server/api/users.js`);
        }
        return resource.get(userId, {
          simplified: true,
          context: { auth: { userId } }
        });
      }
    };
    
    
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
    
    // Add /auth/me endpoint using Express router (always enabled)
    if (api.http?.express?.router) {
      const router = api.http.express.router;
      router.get('/auth/me', async (req, res) => {
        if (!req.auth?.userId) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        
        try {
          const user = await helpers.jwtAuth.getUser(req.auth.userId);
          res.json(user.data);
        } catch (error) {
          res.status(404).json({ error: 'User not found' });
        }
      });
      
      log.info('Added /auth/me endpoint');
    }
    
    /*
     * Summary: Optional endpoints provide REST API access to auth operations.
     * Enable via config: endpoints: { logout: '/auth/logout', session: '/auth/session' }
     */
    
    log.info('JWT authentication plugin installed with declarative auth support');
  }
};