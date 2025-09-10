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
    const config = {
      usersResource: pluginOptions.usersResource || 'users',
      syncEndpoint: pluginOptions.syncEndpoint || '/auth/sync-supabase-user'
    };
    
    // Extend users schema with Supabase fields
    addHook('schema:enrich', 'supabase-extend-users-schema', {}, async ({ context }) => {

      const { fields, scopeName } = context

      // Only modify the users resource
      debugger
      if (scopeName !== config.usersResource) return;
      
      debugger
      // Add Supabase-specific fields (prefixed to avoid conflicts)
      const supabaseFields = {
        supabase_id: { type: 'string', nullable: true, unique: true },
        supabase_is_anonymous: { type: 'boolean', default: false },
        supabase_provider: { type: 'string', nullable: true },
        supabase_metadata: { type: 'object', nullable: true, hidden: true },
        supabase_app_metadata: { type: 'object', nullable: true, hidden: true },
        supabase_user_metadata: { type: 'object', nullable: true, hidden: true }
      };
      
      // Merge fields into the mutable fields object
      Object.assign(fields, supabaseFields);
      
      log.info(`Extended ${scopeName} with Supabase fields: ${Object.keys(supabaseFields).join(', ')}`);
    });
    
    // Add Supabase user sync endpoint using Express router
    const router = api.http?.express?.router;
    if (!router) {
      log.warn('SupabaseAuthPlugin: Express router not available. Sync endpoint will not be added.');
      return;
    }
    
    router.post(config.syncEndpoint, async (req, res) => {
      try {
        const { user } = req.body;
        
        if (!user?.id || !user?.email) {
          return res.status(400).json({ 
            error: 'Invalid user data',
            details: 'User object must contain id and email' 
          });
        }
        
        // Only allow syncing your own user (unless admin)
        if (req.auth?.userId && req.auth.userId !== user.id && !req.auth?.roles?.includes('admin')) {
          return res.status(403).json({ 
            error: 'Forbidden',
            details: 'Cannot sync other users' 
          });
        }
        
        // Map Supabase user to our schema
        const userData = {
          email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0],
          avatar_url: user.user_metadata?.avatar_url || '',
          // Supabase-specific fields with prefix
          supabase_id: user.id,
          supabase_is_anonymous: user.is_anonymous || false,
          supabase_provider: user.app_metadata?.provider || 'email',
          supabase_metadata: user.user_metadata || {},
          supabase_app_metadata: user.app_metadata || {},
          supabase_user_metadata: user.user_metadata || {}
        };
        
        // Use JWT helper to upsert user
        const syncedUser = await helpers.jwtAuth.upsertUser(user.id, userData);
        
        log.debug(`Synced Supabase user ${user.id}`);
        res.json({ 
          success: true,
          user: syncedUser.data
        });
      } catch (error) {
        log.error('Supabase user sync error:', error);
        res.status(500).json({ 
          error: 'Failed to sync user',
          details: error.message 
        });
      }
    });
    
    log.info(`SupabaseAuthPlugin installed with sync endpoint: ${config.syncEndpoint}`);
  }
}