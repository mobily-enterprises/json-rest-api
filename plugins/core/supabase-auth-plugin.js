/**
 * Supabase Authentication Plugin for REST API
 * 
 * This plugin provides:
 * 1. Schema extension for Supabase-specific user fields
 * 2. User sync endpoints for Supabase authentication  
 * 3. Anonymous user support
 * 
 * Requirements:
 * - JWT plugin must be installed first (for token validation and helpers)
 * - App must define a users resource with proper auth rules
 */

export const SupabaseAuthPlugin = {
  name: 'supabase-auth',
  dependencies: ['rest-api', 'jwt-auth'],
  
  async install({ api, addHook, log, helpers, pluginOptions }) {
    log.info('Installing Supabase Authentication plugin');
    
    const config = {
      usersResource: pluginOptions.usersResource || 'users',
      syncEndpoint: pluginOptions.syncEndpoint || '/auth/sync-supabase-user'
    };
    
    log.debug('Supabase plugin configuration', config);
    
    // Extend users schema with Supabase fields
    addHook('schema:enrich', 'supabase-extend-users-schema', {}, async ({ context }) => {

      const { fields, scopeName } = context

      // Only modify the users resource
      if (scopeName !== config.usersResource) {
        log.trace(`Skipping schema enrichment for ${scopeName} (not users resource)`);
        return;
      }
      
      log.debug(`Extending ${scopeName} schema with Supabase fields`);
      
      // Add Supabase-specific fields (prefixed to avoid conflicts)
      const supabaseFields = {
        supabase_id: { type: 'string', nullable: true, unique: true, indexed: true },
        supabase_is_anonymous: { type: 'boolean', default: false },
        supabase_provider: { type: 'string', nullable: true },
        supabase_metadata: { type: 'object', nullable: true, hidden: true },
        supabase_app_metadata: { type: 'object', nullable: true, hidden: true },
        supabase_user_metadata: { type: 'object', nullable: true, hidden: true }
      };
      
      // Merge fields into the mutable fields object
      Object.assign(fields, supabaseFields);
      
      log.info(`Extended ${scopeName} with Supabase fields`, {
        fields: Object.keys(supabaseFields),
        resource: scopeName
      });
    });
    
    // Add Supabase user sync endpoint using Express router
    const router = api.http?.express?.router;
    if (!router) {
      log.warn('SupabaseAuthPlugin: Express router not available', {
        endpoint: config.syncEndpoint,
        message: 'Sync endpoint will not be added'
      });
      return;
    }
    
    log.debug(`Adding Supabase sync endpoint: ${config.syncEndpoint}`);
    
    router.post(config.syncEndpoint, async (req, res) => {
      log.trace('Supabase sync endpoint called', {
        hasAuth: !!req.auth,
        userId: req.auth?.userId,
        provider: req.auth?.provider
      });
      
      try {
        // Require authentication (check providerId for first-time users)
        if (!req.auth?.providerId) {
          log.warn('Sync attempt without authentication', {
            ip: req.ip,
            userAgent: req.headers['user-agent']
          });
          return res.status(401).json({ 
            error: 'Authentication required',
            details: 'You must be authenticated to sync user data'
          });
        }
        
        // CRITICAL FIX: Verify the provider is Supabase
        if (req.auth.provider !== 'supabase') {
          log.warn('Sync attempt with wrong provider', {
            expectedProvider: 'supabase',
            actualProvider: req.auth.provider,
            userId: req.auth.userId
          });
          return res.status(400).json({ 
            error: 'Invalid provider',
            details: 'This endpoint is for Supabase users only'
          });
        }
        
        const { user } = req.body;
        
        log.debug('Sync request received', {
          hasUser: !!user,
          userId: user?.id,
          email: user?.email,
          isAnonymous: user?.is_anonymous
        });
        
        if (!user?.id || !user?.email) {
          log.warn('Invalid user data in sync request', {
            hasId: !!user?.id,
            hasEmail: !!user?.email
          });
          return res.status(400).json({ 
            error: 'Invalid user data',
            details: 'User object must contain id and email' 
          });
        }
        
        // CRITICAL FIX: Ensure the authenticated user matches the user being synced
        // Check provider ID since internal ID might not exist yet
        if (req.auth.providerId !== user.id) {
          log.error('User ID mismatch in sync request', {
            authProviderId: req.auth.providerId,
            requestUserId: user.id,
            email: user.email
          });
          return res.status(403).json({ 
            error: 'Forbidden',
            details: 'You can only sync your own user data'
          });
        }
        
        // Map Supabase user to our schema
        const userData = {
          email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url || '',
          // Supabase-specific fields (supabase_id will be set by upsertUser)
          supabase_is_anonymous: user.is_anonymous || false,
          supabase_provider: user.app_metadata?.provider || 'email',
          supabase_metadata: user.user_metadata || {},
          supabase_app_metadata: user.app_metadata || {},
          supabase_user_metadata: user.user_metadata || {}
        };
        
        log.debug('Upserting user data', {
          userId: user.id,
          email: userData.email,
          isAnonymous: userData.supabase_is_anonymous,
          provider: userData.supabase_provider
        });
        
        // Use JWT helper to upsert user with provider info
        const syncedUser = await helpers.jwtAuth.upsertUser(
          user.id,      // Provider-specific ID
          userData,     // User data
          'supabase'    // Provider name
        );
        
        // Update auth context with internal ID
        if (syncedUser.data?.id) {
          req.auth.userId = syncedUser.data.id;
          log.debug('Updated auth context with internal user ID', {
            internalId: syncedUser.data.id,
            providerId: user.id
          });
        }
        
        log.info('Successfully synced Supabase user', {
          userId: user.id,
          email: userData.email,
          isAnonymous: userData.supabase_is_anonymous,
          provider: userData.supabase_provider
        });
        
        res.json({ 
          success: true,
          user: syncedUser.data
        });
      } catch (error) {
        log.error('Supabase user sync failed', {
          error: error.message,
          stack: error.stack,
          userId: req.auth?.userId,
          requestUserId: req.body?.user?.id
        });
        res.status(500).json({ 
          error: 'Failed to sync user',
          details: error.message 
        });
      }
    });
    
    log.info('SupabaseAuthPlugin installed successfully', {
      syncEndpoint: config.syncEndpoint,
      usersResource: config.usersResource
    });
  }
}