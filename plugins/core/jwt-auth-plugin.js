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
import { RestApiResourceError } from '../../lib/rest-api-errors.js';

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
    
    log.info('Installing JWT Authentication plugin');
    
    // Use plugin options directly
    const jwtOptions = pluginOptions || {};
    log.debug('JWT plugin options received', { 
      hasProviders: !!jwtOptions.providers,
      defaultProvider: jwtOptions.defaultProvider,
      autoOwnership: jwtOptions.autoOwnership?.enabled,
      revocation: jwtOptions.revocation?.enabled
    });
    
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
    
    // Initialize providers registry
    const providers = {};
    
    // Create a hook point for other plugins to register providers
    // This hook will be called by JWT plugin to collect providers
    const providerContext = { providers };
    await runHooks('jwt:register-provider', providerContext);
    
    // Also accept providers passed directly (for backward compatibility)
    if (jwtOptions.providers) {
      Object.entries(jwtOptions.providers).forEach(([name, providerConfig]) => {
        providers[name] = {
          secret: providerConfig.secret,
          publicKey: providerConfig.publicKey,
          jwksUrl: providerConfig.jwksUrl,
          algorithms: providerConfig.algorithms || ['HS256', 'RS256'],
          audience: providerConfig.audience,
          issuer: providerConfig.issuer,
          userIdField: providerConfig.userIdField || 'sub',
          emailField: providerConfig.emailField || 'email'
        };
        log.info(`Registered auth provider via config: ${name}`, {
          hasSecret: !!providerConfig.secret,
          hasPublicKey: !!providerConfig.publicKey,
          hasJwksUrl: !!providerConfig.jwksUrl,
          algorithms: providerConfig.algorithms || ['HS256', 'RS256'],
          userIdField: providerConfig.userIdField || 'sub',
          emailField: providerConfig.emailField || 'email'
        });
      });
    }
    
    // Validate we have at least one provider configured
    if (Object.keys(providers).length === 0) {
      log.error('No auth providers configured');
      throw new Error('JwtAuthPlugin requires at least one auth provider to be configured');
    }
    
    // Default provider to use when no header is specified
    const defaultProvider = jwtOptions.defaultProvider || Object.keys(providers)[0] || 'default';
    
    log.info('Auth providers collected', { 
      providers: Object.keys(providers),
      defaultProvider: defaultProvider,
      totalProviders: Object.keys(providers).length
    });
    
    const config = {
      // Store all provider configurations
      providers,
      defaultProvider,
      
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
      
      // Account linking configuration
      // When enabled, automatically links accounts with the same email address
      autoLinkByEmail: jwtOptions.autoLinkByEmail || false, // Default: disabled for backward compatibility
      
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
    
    // Ensure at least one provider is configured with a validation method
    const hasValidProvider = Object.values(config.providers).some(
      p => p.secret || p.publicKey || p.jwksUrl
    );
    
    if (!hasValidProvider) {
      log.error('No valid auth provider configured', { providers: Object.keys(config.providers) });
      throw new Error('JwtAuthPlugin requires at least one provider with secret, publicKey, or jwksUrl');
    }
    
    log.debug('JWT configuration validated', {
      providersCount: Object.keys(config.providers).length,
      autoOwnership: config.autoOwnership.enabled,
      revocation: config.revocation.enabled
    });
    
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
      log.info('Setting up token revocation with database storage', {
        tableName: config.revocation.tableName,
        cleanupInterval: config.revocation.cleanupInterval
      });
      // Create the revoked_tokens table if it doesn't exist
      await createRevocationResource(api, config.revocation.tableName, log);
      
      // Set up periodic cleanup of expired tokens
      // This prevents the revocation table from growing indefinitely
      if (config.revocation.cleanupInterval > 0) {
        const cleanupJob = setInterval(async () => {
          try {
            const deleted = await cleanupExpiredTokens(api, config.revocation.tableName, log);
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
    log.debug('Registered built-in auth checker: public');
    
    // 'authenticated' - User must be logged in (have a valid token)
    state.authCheckers.set('authenticated', (context) => {
      // Allow system context
      if (context.auth?.system === true) {
        log.trace('Auth check "authenticated": true (system context)');
        return true;
      }
      
      // Allow if has internal ID OR provider ID (for users not synced yet)
      const isAuth = !!(context.auth?.userId || context.auth?.providerId);
      log.trace(`Auth check 'authenticated': ${isAuth}`, { 
        userId: context.auth?.userId,
        providerId: context.auth?.providerId
      });
      return isAuth;
    });
    log.debug('Registered built-in auth checker: authenticated');
    
    // 'owns' - User must own the resource
    // Checks the ownership field (default: user_id) against the authenticated user
    state.authCheckers.set('owns', (context, { existingRecord, scopeVars }) => {
      log.trace('Auth check "owns" starting', {
        hasAuth: !!context.auth?.userId,
        hasExistingRecord: !!existingRecord,
        scopeVars: scopeVars,
        contextKeys: Object.keys(context),
        existingRecordKeys: existingRecord ? Object.keys(existingRecord) : null
      });

      // Allow system context
      if (context.auth?.system === true) {
        log.trace('Auth check "owns": true (system context)');
        return true;
      }

      // User must be synced to check ownership
      if (!context.auth?.userId) {
        log.trace('Auth check "owns" failed: user not synced', {
          providerId: context.auth?.providerId
        });
        return false;
      }

      // For new records being created, ownership check passes
      const record = existingRecord || context.attributes;
      if (!record) {
        log.trace('Auth check "owns": no record to check ownership');
        return true;
      }

      // Determine which field indicates ownership (configurable per scope)
      const ownerField = scopeVars?.ownershipField || config.ownershipField;
      log.trace('Auth check "owns" determining owner field', {
        ownerField,
        scopeVarsOwnershipField: scopeVars?.ownershipField,
        configOwnershipField: config.ownershipField,
        recordKeys: Object.keys(record),
        recordType: record.type,
        hasAttributes: !!record.attributes,
        recordId: record.id,
        recordAttributesId: record.attributes?.id
      });
      
      // Handle JSON:API format (record has type and attributes)
      if (record.type && record.attributes) {

        // Special case in case ownershipField is 'id': it won't be in attributes,
        // but in the record itself, as per JSON:API.
        // This is important for tables where the id IS the user ID, rather than
        // the default user_id
        const userIdFieldValue = ownerField === 'id' ? record.id : record.attributes[ownerField]

        // First check attributes for the ownership field
        if (userIdFieldValue !== undefined) {
          // Convert both to strings for consistent comparison (handles integer vs string)
          const recordOwnerId = String(userIdFieldValue);
          const userIdStr = String(context.auth.userId);
          return recordOwnerId === userIdStr;
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
      
      // Handle simplified/flat format - convert to strings for comparison
      const recordOwnerId = String(record[ownerField]);
      const userIdStr = String(context.auth.userId);
      const owns = recordOwnerId === userIdStr;
      
      log.trace(`Auth check 'owns' result: ${owns}`, {
        ownerField,
        recordOwnerId: record[ownerField],
        recordOwnerIdStr: recordOwnerId,
        userId: context.auth.userId,
        userIdStr: userIdStr
      });
      return owns;
    });
    log.debug('Registered built-in auth checker: owns');
    
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
     * OWNERSHIP FILTERING - Three-state logic:
     * Resources can control ownership filtering with the 'ownership' option:
     * - ownership: true   -> ALWAYS filter by user_id (even if field doesn't exist)
     * - ownership: false  -> NEVER filter by user_id (even if field exists)
     * - ownership: undefined -> AUTO filter based on user_id field presence
     *
     * Examples:
     * - projects: has user_id field, no ownership option = AUTO filters by owner
     * - users: has user_id field, ownership: false = NEVER filters
     * - special_table: no user_id field, ownership: true = ALWAYS filters
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
      
      if (!auth) {
        log.trace(`No auth rules defined for scope: ${scopeName}`);
        return;
      }
      
      // Store auth rules in scope vars for later permission checking
      scope.vars.authRules = auth;
      
      log.info(`Auth rules registered for ${scopeName}`, {
        query: auth.query,
        get: auth.get,
        post: auth.post,
        patch: auth.patch,
        delete: auth.delete
      });
    });
    
    // HOOK: Automatically add user_id field to schemas with ownership
    addHook('schema:enrich', 'jwt-auto-add-ownership-field', {}, async ({ context, scopes, scopeOptions }) => {
      //
      const { fields, scopeName } = context
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled) return;
      

      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) return;

      // Skip if ownership is explicitly disabled
      if (scopeOptions?.ownership === false) return;

      // For auto-adding fields, only proceed if ownership is explicitly true
      // We don't auto-add fields just because the field exists (that would be circular logic)
      const hasOwnership = scopeOptions?.ownership === true;

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
        type: 'integer', // Changed to integer to match new user ID type
        required: false, // Will be set automatically
        belongsTo: config.autoOwnership.userResource,
        as: 'owner',
        nullable: true,
        indexed: true, // Important for query performance
        description: 'Automatically managed ownership field'
      };
      
      log.debug(`Added ${ownershipField} field to resource '${scopeName}' for ownership tracking`);
    });
    
    // HOOK: Add provider ID fields to users resource for all configured providers
    addHook('schema:enrich', 'jwt-add-provider-id-fields', {}, async ({ context, scopes }) => {
      const { fields, scopeName } = context;
      
      // Only modify the users resource
      if (scopeName !== config.usersResource) return;
      
      // Add fields for all configured providers
      Object.keys(config.providers).forEach(providerName => {
        const fieldName = `${providerName}_id`;
        
        // Skip if field already exists (e.g., added by provider-specific plugin)
        if (!fields[fieldName]) {
          fields[fieldName] = {
            type: 'string',
            nullable: true,
            unique: true,
            indexed: true,
            description: `User ID from ${providerName} provider`
          };
          log.debug(`Added ${fieldName} field to ${scopeName} resource`);
        }
      });
    });
    
    // HOOK: Automatically set user_id on record creation
    addHook('beforeSchemaValidate', 'jwt-auto-set-ownership', { sequence: -50 }, async ({ context, scopeName, scopes, scopeOptions }) => {
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled) return;
      
      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) return;
      
      // Skip if no auth context or user not synced yet
      if (!context.auth?.userId) {
        if (context.auth?.needsSync) {
          // User is authenticated but not synced - skip for now
          log.debug(`Skipping auto-ownership for unsynced user on ${scopeName}`, {
            providerId: context.auth.providerId,
            provider: context.auth.provider
          });
          // The ownership will need to be set later after sync
          return;
        }
        
        if (config.autoOwnership.requireOwnership) {
          throw new Error(`Cannot create ${scopeName} without authentication`);
        }
        return;
      }
      
      // Skip if ownership is explicitly disabled
      if (scopeOptions?.ownership === false) return;

      const ownershipField = config.autoOwnership.field;

      // Check if schema has the ownership field
      const scope = scopes[scopeName];
      const schemaInfo = scope?.vars?.schemaInfo;
      const hasOwnershipField = !!schemaInfo?.schemaStructure?.[ownershipField];

      // Three-state logic for auto-setting ownership:
      // - ownership: true -> ALWAYS set (even if no user_id field in schema)
      // - ownership: false -> NEVER set (even if has user_id field)
      // - ownership: undefined -> AUTO set if user_id field exists
      const shouldSetOwnership = scopeOptions?.ownership === true ||
                                 (scopeOptions?.ownership === undefined && hasOwnershipField);

      log.trace('Auto-ownership: checking configuration', {
        scopeName,
        method: context.method,
        ownershipOption: scopeOptions?.ownership,
        hasOwnershipField,
        shouldSetOwnership,
        userId: context.auth?.userId
      });

      if (!shouldSetOwnership) return;
      
      // Only set on POST (create)
      if (context.method !== 'post') return;
      if (!schemaInfo?.schemaStructure?.[ownershipField]) {
        log.warn(`Resource '${scopeName}' has ownership enabled but no ${ownershipField} field in schema`);
        return;
      }
      
      // Set the ownership field in the input record
      // Handle both JSON:API and simplified formats
      log.trace('Auto-ownership: setting ownership field', {
        scopeName,
        ownershipField,
        userId: context.auth?.userId,
        hasInputRecord: !!context.inputRecord,
        hasJsonApi: !!context.inputRecord?.data?.attributes,
        inputRecord: context.inputRecord
      });
      
      // Get the actual relationship name from the schema
      const fieldSchema = schemaInfo.schemaStructure[ownershipField];
      const relationshipName = fieldSchema?.as || ownershipField.replace(/_id$/, ''); // Fallback to removing _id if no 'as' field
      
      if (context.inputRecord?.data) {
        // JSON:API format - set as relationship, not attribute
        if (!context.inputRecord.data.relationships) {
          context.inputRecord.data.relationships = {};
        }
        
        context.inputRecord.data.relationships[relationshipName] = {
          data: {
            type: fieldSchema?.belongsTo || config.autoOwnership.userResource || 'users',
            id: String(context.auth.userId)
          }
        };
        log.trace('Auto-ownership: set in JSON:API format as relationship', { relationshipName, relationship: context.inputRecord.data.relationships[relationshipName] });
      } else if (context.inputRecord) {
        // Simplified format - use the actual relationship name
        context.inputRecord[relationshipName] = context.auth.userId;
        log.trace('Auto-ownership: set in simplified format', { relationshipName, value: context.inputRecord[relationshipName] });
      }
      
      log.trace(`Set ${ownershipField} to ${context.auth.userId} for new ${scopeName} record`);
    });
    
    // HOOK: Automatically filter queries by owner (unless admin)
    addHook('knexQueryFiltering', 'jwt-filter-by-owner', { sequence: -40 }, async ({ context, scopes, scopeOptions }) => {
      // Skip if auto-ownership is disabled
      if (!config.autoOwnership.enabled || !config.autoOwnership.filterByOwner) {
        log.trace(`Ownership filter skipped - autoOwnership disabled or filterByOwner false`);
        return;
      }

      const { query, tableName, scopeName } = context.knexQuery;

      log.trace(`Ownership filter check for ${scopeName}:`, {
        scopeName,
        tableName,
        hasAuth: !!context.auth,
        userId: context.auth?.userId,
        autoOwnershipEnabled: config.autoOwnership.enabled,
        filterByOwner: config.autoOwnership.filterByOwner,
        excludedResources: config.autoOwnership.excludeResources,
        scopeOptions
      });

      // Skip excluded resources
      if (config.autoOwnership.excludeResources.includes(scopeName)) {
        log.trace(`Ownership filter skipped for ${scopeName} - in exclude list`);
        return;
      }

      // Skip if no auth context
      if (!context.auth?.userId) {
        if (config.autoOwnership.requireOwnership) {
          throw new Error(`Cannot query ${scopeName} without authentication`);
        }
        log.trace(`Ownership filter skipped for ${scopeName} - no auth context`);
        return;
      }

      // Skip filtering for admins
      if (context.auth.roles?.includes('admin')) {
        log.trace(`Admin user - skipping ownership filter for ${scopeName}`);
        return;
      }

      // Check if ownership is explicitly disabled (ownership: false)
      if (scopeOptions?.ownership === false) {
        log.trace(`Ownership filter explicitly disabled for ${scopeName}`);
        return;
      }

      const ownershipField = config.autoOwnership.field;

      // Check if schema has the ownership field
      const scope = scopes[scopeName];
      const schemaInfo = scope?.vars?.schemaInfo;
      const hasOwnershipField = !!schemaInfo?.schemaStructure?.[ownershipField];

      // Three-state ownership logic:
      // - ownership: true -> ALWAYS filter (even if no user_id field)
      // - ownership: false -> NEVER filter (even if has user_id field)
      // - ownership: undefined -> AUTO detect based on user_id field presence
      const shouldFilterByOwner = scopeOptions?.ownership === true ||
                                  (scopeOptions?.ownership === undefined && hasOwnershipField);

      log.trace(`Ownership check for ${scopeName}:`, {
        ownershipOption: scopeOptions?.ownership,
        hasOwnershipField,
        shouldFilterByOwner,
        decision: shouldFilterByOwner ? 'WILL FILTER' : 'WILL NOT FILTER'
      });

      if (!shouldFilterByOwner) {
        log.trace(`Ownership filter skipped for ${scopeName} - not applicable`);
        return;
      }

      log.trace(`Schema check for ${scopeName}:`, {
        hasScope: !!scope,
        hasSchemaInfo: !!schemaInfo,
        hasSchemaStructure: !!schemaInfo?.schemaStructure,
        ownershipField,
        hasOwnershipField: !!schemaInfo?.schemaStructure?.[ownershipField],
        schemaFields: schemaInfo?.schemaStructure ? Object.keys(schemaInfo.schemaStructure) : []
      });

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
      
      log.trace('JWT authentication hook triggered', {
        hasToken: !!token,
        method: context.method,
        path: context.request?.path
      });
      
      if (!token) {
        // No token provided - this is fine, anonymous access is allowed
        // Individual resources will enforce their own auth requirements
        log.debug('No auth token provided, proceeding as anonymous');
        context.auth = null;
        return true;
      }
      
      // Get the auth provider from request header (X-Auth-Provider)
      // Falls back to default provider if not specified
      const providerName = context.request.headers?.['x-auth-provider'] || 
                          context.request.headers?.['X-Auth-Provider'] || 
                          config.defaultProvider;
      
      log.debug('Determining auth provider', {
        headerProvider: context.request.headers?.['x-auth-provider'] || context.request.headers?.['X-Auth-Provider'],
        defaultProvider: config.defaultProvider,
        selectedProvider: providerName
      });
      
      // Get provider configuration
      const providerConfig = config.providers[providerName];
      
      if (!providerConfig) {
        log.warn(`Unknown auth provider: ${providerName}`, {
          requestedProvider: providerName,
          availableProviders: Object.keys(config.providers)
        });
        context.auth = null;
        return true;
      }
      
      log.trace('Provider configuration found', {
        provider: providerName,
        hasSecret: !!providerConfig.secret,
        hasPublicKey: !!providerConfig.publicKey,
        hasJwksUrl: !!providerConfig.jwksUrl
      });
      
      try {
        log.debug('Verifying JWT token', { provider: providerName });
        
        // Step 1: Verify the token signature and claims using provider-specific config
        const payload = await verifyToken(token, {
          secret: providerConfig.secret,
          publicKey: providerConfig.publicKey,
          algorithms: providerConfig.algorithms,
          audience: providerConfig.audience,
          issuer: providerConfig.issuer,
          jwksUrl: providerConfig.jwksUrl
        }, log);
        
        // Step 2: Check if token has been revoked (logout functionality)
        if (config.revocation.enabled && payload.jti) {
          log.trace('Checking token revocation', { jti: payload.jti });
          const isRevoked = await checkRevocation(
            payload.jti,
            api,
            config.revocation,
            state.memoryRevocationStore,
            log
          );
          
          if (isRevoked) {
            log.info('Token has been revoked', { jti: payload.jti });
            // Token has been revoked - treat as anonymous
            context.auth = null;
            return true;
          }
        }
        
        // Step 3: Get provider-specific user ID from token
        log.trace('JWT AUTH: Token payload:', { payload });
        log.trace('JWT AUTH: Provider config userIdField:', { userIdField: providerConfig.userIdField });
        const providerId = payload[providerConfig.userIdField];
        const email = payload[providerConfig.emailField];
        log.trace('JWT AUTH: Extracted providerId and email', { providerId, email });

        // Step 4: Look up internal user ID from provider ID
        let internalUserId = null;

        if (helpers.jwtAuth && helpers.jwtAuth.getUserByProviderId) {
          try {
            log.trace('Looking up user by provider ID', { providerId, providerName });
            let user = await helpers.jwtAuth.getUserByProviderId(providerId, providerName);
            log.trace('Provider ID lookup result', { userFound: !!user, userId: user?.id });
            
            if (user) {
              internalUserId = user.id;
              log.trace('User found by provider ID, using existing user', { internalUserId });
              log.debug('Found internal user ID from provider ID', {
                providerId,
                internalUserId,
                provider: providerName
              });
            } else {
              log.trace('User not found by provider ID, checking email linking', { 
                autoLinkByEmail: config.autoLinkByEmail, 
                hasEmail: !!email,
                email 
              });
              // User not found by provider ID - check if we should link by email
              if (config.autoLinkByEmail && email) {
                log.trace('Auto-link by email enabled, looking up by email', { email });
                log.debug('Checking for existing user by email', {
                  email,
                  provider: providerName
                });
                
                user = await helpers.jwtAuth.getUserByEmail(email);
                log.trace('Email lookup result', { userFoundByEmail: !!user, userId: user?.id });
                
                if (user) {
                  // Found existing user with same email - link this provider
                  log.trace('Found user by email, will link provider', { 
                    userId: user.id,
                    currentAuth0Id: user.auth0_id,
                    newProviderId: providerId 
                  });
                  log.info('Found existing user with same email, linking provider', {
                    userId: user.id,
                    email: email,
                    newProvider: providerName,
                    newProviderId: providerId
                  });
                  
                  // Update user to add this provider ID
                  try {
                    const providerField = `${providerName}_id`;
                    const updateData = {
                      [providerField]: providerId
                    };
                    log.trace('Preparing to patch user with provider ID', { 
                      userId: user.id,
                      providerField,
                      updateData 
                    });
                    
                    // If this provider provides additional metadata, update it
                    if (payload.user_metadata) {
                      updateData.name = payload.user_metadata.name || user.name;
                      updateData.avatar_url = payload.user_metadata.avatar_url || user.avatar_url;
                      log.trace('Added metadata to update', updateData);
                    }
                    
                    const resource = api.resources[config.usersResource];
                    log.trace('Calling resource.patch to link provider', {
                      id: user.id,
                      ...updateData
                    });
                    await resource.patch({
                      id: user.id,
                      ...updateData
                    }, { auth: { userId: 'system', system: true } });
                    log.trace('Provider linking patch completed successfully');
                    
                    internalUserId = user.id;
                    log.info('Successfully linked provider to existing account', {
                      userId: user.id,
                      email: email,
                      provider: providerName,
                      providerId: providerId
                    });
                  } catch (linkError) {
                    log.error('Failed to link provider to existing user', {
                      error: linkError.message,
                      userId: user.id,
                      provider: providerName
                    });
                    // Still set the internal ID since we found the user
                    internalUserId = user.id;
                  }
                } else {
                }
              } else {
              }
              
              // No existing user found (or auto-link disabled) - create new user
              if (!user) {
                log.info('Creating new user account', {
                  providerId,
                  email,
                  provider: providerName,
                  autoLinkByEmail: config.autoLinkByEmail
                });
                
                // Prepare user data for sync
                const userData = {
                  email: email || null,
                  name: email ? email.split('@')[0] : 'User',
                  // Provider-specific fields will be added by upsertUser
                };
                
                // Extract additional user metadata from token if available
                if (payload.user_metadata) {
                  userData.name = payload.user_metadata.name || userData.name;
                  userData.avatar_url = payload.user_metadata.avatar_url || '';
                }
                
                // Auto-sync: Create user in database
                try {
                  const syncedUser = await helpers.jwtAuth.upsertUser(
                    providerId,      // Provider-specific ID
                    userData,        // User data
                    providerName     // Provider name (e.g., 'supabase')
                  );
                  
                  // Handle both simplified and JSON:API response formats
                  const userId = syncedUser?.id || syncedUser?.data?.id;
                  if (userId) {
                    internalUserId = userId;
                    log.info('User auto-synced successfully', {
                      providerId,
                      internalUserId,
                      email,
                      provider: providerName
                    });
                  } else {
                    log.error('Auto-sync returned invalid user data', {
                      providerId,
                      provider: providerName,
                      syncResult: syncedUser
                    });
                  }
                } catch (syncError) {
                  log.error('Failed to auto-sync user', {
                    error: syncError.message,
                    providerId,
                    email,
                    provider: providerName
                  });
                  // Continue without internal ID - user can still access public resources
                }
              }
            }
          } catch (error) {
            log.warn('Failed to lookup/sync user', {
              error: error.message,
              providerId,
              provider: providerName
            });
          }
        }
        
        // Step 5: Populate context.auth with both IDs
        context.auth = {
          userId: internalUserId,                        // Internal database ID (may be null if sync failed)
          providerId: providerId,                        // Provider-specific ID
          email: email,                                  // User email
          provider: providerName,                        // Track which provider authenticated this user
          token: payload,                                // Full token payload for custom use
          tokenId: payload.jti                           // JWT ID for revocation
        };
        
        log.info('JWT authentication successful', {
          userId: context.auth.userId,
          providerId: context.auth.providerId,
          email: context.auth.email,
          provider: providerName,
          hasJti: !!payload.jti,
          exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined
        });
        
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
        // If a token is provided but validation fails, this is an authentication error
        // We should reject the request rather than treating it as unauthenticated
        log.warn('JWT token validation failed', {
          error: error.message,
          errorType: error.name,
          provider: providerName
        });
        
        // Return 401 Unauthorized for invalid tokens
        context.rejection = {
          status: 401,
          title: 'Authentication Failed',
          message: `Invalid token for provider: ${providerName}`
        };
        return false; // Stop processing
      }
      
      // Return true to continue processing
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
        const minimalRecord = context.originalContext?.minimalRecord;
        const auth = context.originalContext?.auth;

        log.trace('Checking permissions', {
          scopeName,
          operation,
          hasAuth: !!auth?.userId,
          userId: auth?.userId
        });
        
        const authRules = scopeVars?.authRules;
        if (!authRules) {
          log.trace(`No auth rules for scope ${scopeName}, allowing access`);
          return; // No auth rules defined
        }
        
        const rules = authRules[operation];
        if (!rules) {
          // No rules for this operation - deny by default
          // Example: If posts only defines auth: { query: ['public'] }
          // Then POST, PATCH, DELETE will all be denied
          log.warn(`No auth rules for operation ${operation} on ${scopeName}, denying access`);
          throw new Error(`Operation '${operation}' not allowed on resource '${scopeName}'`);
        }
        
        log.debug(`Checking auth rules for ${scopeName}.${operation}`, {
          rules,
          hasAuth: !!auth
        });

        
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
              log.error(`Unknown auth rule: ${rule}`, {
                availableCheckers: Array.from(state.authCheckers.keys())
              });
              throw new Error(`Unknown auth rule: ${rule}`);
            }
            
            // Run the checker (pass originalContext to the checker)
            const result = await checker(context.originalContext || context, {
              existingRecord: minimalRecord, 
              scopeVars, 
              param 
            });
            
            if (result) {
              log.debug(`Auth rule '${rule}' passed for ${scopeName}.${operation}`);
              passed = true;
              break; // Any rule passing is enough
            } else {
              log.trace(`Auth rule '${rule}' failed for ${scopeName}.${operation}`);
              failureReasons.push(rule);
            }
          } catch (error) {
            log.error(`Error checking auth rule ${rule}:`, error);
            failureReasons.push(`${rule} (error: ${error.message})`);
          }
        }
        
        if (!passed) {
          log.warn(`Access denied for ${scopeName}.${operation}`, {
            requiredRules: rules,
            failedChecks: failureReasons,
            userId: context.auth?.userId
          });
          const error = new Error(
            `Access denied. Required one of: ${rules.join(', ')}. ` +
            `Failed checks: ${failureReasons.join(', ')}`
          );
          error.statusCode = 403;
          throw error;
        }
        
        log.debug(`Access granted for ${scopeName}.${operation}`, {
          passedRule: rules.find(r => !failureReasons.includes(r)),
          userId: auth?.userId
        });
      }
    );


    
    // HOOK: Check ownership for GET operations (single record fetch)
    // The knexQueryFiltering hook only applies to query operations, not GET by ID
    // This hook runs during checkPermissions to verify ownership of minimalRecord
    addHook('checkPermissions', 'jwt-check-ownership-for-get', { sequence: -80 },
      async ({ context, scope, scopeName, scopeOptions }) => {

        if (scopeName === 'projects') debugger

        // Extract the needed values from originalContext
        const auth = context.originalContext?.auth;
        const minimalRecord = context.originalContext?.minimalRecord;
        const id = context.originalContext?.id;

        // Only check for GET operations (single record)
        if (!['get', 'put', 'patch', 'delete'].includes(context.method)) return;

        // Skip if auto-ownership is disabled
        if (!config.autoOwnership.enabled || !config.autoOwnership.filterByOwner) return;

        // Skip excluded resources
        if (config.autoOwnership.excludeResources.includes(scopeName)) return;

        // Skip if no auth context
        if (!auth?.userId) return;

        // Skip for admin users
        if (auth.roles?.includes('admin')) return;

        // Check if ownership is explicitly disabled
        if (scopeOptions?.ownership === false) return;

        const ownershipField = config.autoOwnership.field;

        // Check if schema has the ownership field
        const schemaInfo = scope?.vars?.schemaInfo;
        const hasOwnershipField = !!schemaInfo?.schemaStructure?.[ownershipField];

        // Three-state ownership logic (same as query filtering)
        const shouldCheckOwnership = scopeOptions?.ownership === true ||
                                    (scopeOptions?.ownership === undefined && hasOwnershipField);

        if (!shouldCheckOwnership) return;

        // Get the minimal record that was already fetched
        if (!minimalRecord) return; // No record fetched (404 will be handled elsewhere)

        // Check ownership
        const recordOwnerId = minimalRecord.attributes[ownershipField];
        if (recordOwnerId && String(recordOwnerId) !== String(auth.userId)) {
          log.info(`Ownership check failed for GET ${scopeName}/${id}`, {
            recordOwnerId,
            userId: auth.userId
          });

          // Return 404 instead of 403 to prevent information leakage
          // (don't reveal that the record exists but is owned by someone else)
          throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
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
    helpers.verifyToken = (token) => verifyToken(token, config, log);
    
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
       * log.info('User ID:', context.auth.userId);
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
       * @param {string} providerId - Provider-specific user ID
       * @param {object} userData - User attributes to set
       * @param {string} provider - Provider name (e.g., 'supabase', 'google')
       * @returns {Promise<object>} The created or updated user record
       * 
       * @example
       * const user = await helpers.jwtAuth.upsertUser(
       *   '550e8400-e29b-41d4-a716-446655440000',
       *   { email: 'user@example.com', name: 'John Doe' },
       *   'supabase'
       * );
       */
      async upsertUser(providerId, userData, provider = null) {
        log.trace('Upsert user called', { providerId, userData, provider });
        const resource = api.resources[config.usersResource];
        if (!resource) {
          throw new Error(`Users resource '${config.usersResource}' not found. Ensure it's defined in server/api/users.js`);
        }
        
        // First try to find user by provider ID (handles email changes)
        let existing = null;
        if (provider) {
          const providerField = `${provider}_id`;
          log.trace('Looking for existing user by provider field', { providerField, providerId });
          const byProviderId = await resource.query({
            queryParams: {
              filters: { [providerField]: providerId }
            },
          }, { auth: { userId: 'system', system: true } });
          existing = byProviderId.data?.[0];
          log.trace('Provider field query result', { found: !!existing, existingId: existing?.id });

          if (existing && userData.email && existing.email !== userData.email) {
            log.info('User email changed at provider', {
              provider,
              providerId,
              oldEmail: existing.email,
              newEmail: userData.email
            });
            // Will update email in the patch operation below
          }
        }

        // If not found by provider ID, check by email to avoid duplicate email errors
        if (!existing && userData.email) {
          log.trace('Provider ID not found, checking by email', { email: userData.email });
          const byEmail = await resource.query({
            queryParams: {
              filters: { email: userData.email }
            },
          }, { auth: { userId: 'system', system: true } });
          existing = byEmail.data?.[0];
          if (existing) {
            log.debug('Found existing user by email', {
              userId: existing.id,
              email: userData.email,
              provider,
              willAddProviderId: !!provider
            });
          }
        }
        
        
        if (existing) {
          // Update existing user
          const updateData = { ...userData };
          if (provider) {
            updateData[`${provider}_id`] = providerId;
          }
          
          return resource.patch({
            id: existing.id,
            ...updateData
          }, { auth: { userId: existing.id, system: true } });
        } else {
          // Create new user
          const createData = { ...userData };
          if (provider) {
            createData[`${provider}_id`] = providerId;
          }
          
          // Since we now check by email upfront, duplicate email errors should be rare
          // Only occurring in true race conditions where two requests create users simultaneously
          try {
            return await resource.post(createData, { auth: { userId: 'system', system: true } });
          } catch (error) {
            // Handle true race condition - if duplicate key error, try to find the user again
            if (error.code === 'ER_DUP_ENTRY' || error.code === '23505' || // MySQL/PostgreSQL
                error.message?.includes('UNIQUE constraint') || // SQLite
                error.message?.includes('duplicate key')) {
              log.info('Race condition detected during user creation, retrying lookup', {
                email: userData.email,
                provider,
                errorCode: error.code
              });

              // Retry finding the user
              if (userData.email) {
                const retryByEmail = await resource.query({
                  queryParams: {
                    filters: { email: userData.email }
                  },
                }, { auth: { userId: 'system', system: true } });
                if (retryByEmail.data?.[0]) {
                  // Update with provider ID if needed
                  const updateData = { ...userData };
                  if (provider) {
                    updateData[`${provider}_id`] = providerId;
                  }
                  return resource.patch({
                    id: retryByEmail.data[0].id,
                    ...updateData
                  }, { auth: { userId: retryByEmail.data[0].id, system: true } });
                }
              }
            }
            throw error;
          }
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
        return resource.get({
          id: userId,
          simplified: true
        }, { auth: { userId: 'system', system: true } });
      },
      
      /**
       * HELPER: getUserByProviderId
       * Retrieve a user record by provider-specific ID
       * 
       * @param {string} providerId - Provider-specific user ID
       * @param {string} provider - Provider name (e.g., 'supabase', 'google')
       * @returns {Promise<object|null>} The user record or null if not found
       * 
       * @example
       * const user = await helpers.jwtAuth.getUserByProviderId(
       *   '550e8400-e29b-41d4-a716-446655440000',
       *   'supabase'
       * );
       */
      async getUserByProviderId(providerId, provider) {
        const resource = api.resources[config.usersResource];
        if (!resource) {
          throw new Error(`Users resource '${config.usersResource}' not found. Ensure it's defined in server/api/users.js`);
        }
        
        const providerField = `${provider}_id`;
        const result = await resource.query({
          queryParams: {
            filters: { [providerField]: providerId }
          },
        }, { auth: { userId: 'system', system: true } });
        
        return result.data?.[0] || null;
      },
      
      /**
       * HELPER: getUserByEmail
       * Retrieve a user record by email address
       * Used for auto-linking accounts with the same email
       * 
       * @param {string} email - The email address to search for
       * @returns {Promise<Object|null>} User record or null if not found
       * 
       * @example
       * const user = await helpers.jwtAuth.getUserByEmail('user@example.com');
       */
      async getUserByEmail(email) {
        const resource = api.resources[config.usersResource];
        if (!resource) {
          throw new Error(`Users resource '${config.usersResource}' not found. Ensure it's defined in server/api/users.js`);
        }
        
        if (!email) {
          return null;
        }
        
        const result = await resource.query({
          queryParams: {
            filters: { email: email }
          },
        }, { auth: { userId: 'system', system: true } });
        
        return result.data?.[0] || null;
      }
    };
    
    
    /* -----------------------------------------------------------------------
     * OPTIONAL ENDPOINTS
     * 
     * The plugin can automatically create REST endpoints for auth operations.
     * These are opt-in via configuration.
     * ----------------------------------------------------------------------- */

    await api.addRoute({
      method: 'GET',
      path: '/api/auth/me',
      handler: async ({ context }) => {
        // Check if user needs to be synced first
        if (context.auth?.needsSync) {
          return {
            statusCode: 404,
            body: {
              error: 'User not synced',
              message: 'Please sync your user data first',
              needsSync: true,
              providerId: context.auth.providerId,
              provider: context.auth.provider
            }
          };
        }

        if (!context.auth?.userId) {
          return {
            statusCode: 401,
            body: { error: 'Not authenticated' }
          };
        }

        try {
          const user = await helpers.jwtAuth.getUser(context.auth.userId);
          log.info('GET /api/auth/me - Full user object:', JSON.stringify(user, null, 2));

          // In simplified mode, the user object is the data directly
          const userData = user.data || user;
          log.info('GET /api/auth/me - User data to return:', JSON.stringify(userData, null, 2));

          return {
            statusCode: 200,
            body: { data: userData }  // Wrap in data property for consistency
          };
        } catch (error) {
          log.error('GET /api/auth/me - Error fetching user:', error);
          return {
            statusCode: 404,
            body: { error: 'User not found' }
          };
        }
      }
    });

    log.info('Added /api/auth/me endpoint');

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
        }
      });

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
        }
      });

      log.info(`Added session endpoint: GET ${config.endpoints.session}`);
    }
    
    /*
     * Summary: Optional endpoints provide REST API access to auth operations.
     * Enable via config: endpoints: { logout: '/auth/logout', session: '/auth/session' }
     * Always enabled: /auth/me
     */
    
    log.info('JWT authentication plugin installed successfully', {
      providers: Object.keys(config.providers),
      defaultProvider: config.defaultProvider,
      autoOwnership: config.autoOwnership.enabled,
      revocation: config.revocation.enabled,
      builtInCheckers: Array.from(state.authCheckers.keys())
    });
  }
};