/**
 * Supabase Authentication Plugin for REST API
 * 
 * This plugin provides:
 * 1. Supabase provider registration for JWT plugin
 * 2. Schema extension for Supabase-specific user fields
 * 3. Support for anonymous users and OAuth providers
 * 
 * User synchronization is now handled automatically by the JWT plugin
 * when users make their first authenticated request.
 * 
 * Requirements:
 * - JWT plugin must be installed after this plugin
 * - App must define a users resource
 */

export const SupabaseAuthPlugin = {
  name: 'supabase-auth',
  dependencies: ['rest-api'],
  
  async install({ api, addHook, log, helpers, pluginOptions }) {
    log.info('Installing Supabase Authentication plugin');
    
    const config = {
      usersResource: pluginOptions.usersResource || 'users',
      secret: pluginOptions.secret || pluginOptions.jwtSecret
    };
    
    log.debug('Supabase plugin configuration', config);
    
    // Register Supabase as an auth provider when JWT plugin asks
    addHook('jwt:register-provider', 'supabase-provider', {}, async ({ context }) => {
      // Check if secret is provided
      if (!config.secret) {
        log.warn('SupabaseAuthPlugin: No JWT secret provided, cannot register as provider');
        return;
      }
      
      // Add Supabase provider configuration
      context.providers.supabase = {
        secret: config.secret,
        algorithms: pluginOptions.algorithms || ['HS256'],
        userIdField: pluginOptions.userIdField || 'sub',
        emailField: pluginOptions.emailField || 'email'
      };
      
      log.info('Supabase registered as JWT auth provider');
    });
    
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
        supabase_id: { type: 'string', nullable: true, unique: true, indexed: true, search: true },
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
    
    // Note: User sync is now handled automatically by the JWT plugin
    // when a user makes their first authenticated request.
    // No manual sync endpoint is needed anymore.

    // Add link endpoint for Supabase accounts
    if (api.addRoute) {
      await api.addRoute({
        method: 'POST',
        path: '/api/auth/supabase/link',
        handler: async ({ body, context }) => {
          try {
            // Check if user is authenticated
            if (!context.auth?.userId) {
              return {
                statusCode: 401,
                body: { error: 'Must be logged in to link accounts' }
              };
            }

            // Fetch the current user
            log.info(`[Supabase Link] Fetching user with ID: ${context.auth.userId}`);
            const userResult = await api.scopes.users.methods.get({
              id: context.auth.userId
            }, context);

            const currentUser = userResult.data;
            log.info(`[Supabase Link] Current user:`, currentUser);

            const { supabase_id, email } = body;

            // Verify email matches
            log.info(`[Supabase Link] Comparing emails: Supabase=${email}, Current=${currentUser.email}`);
            if (email !== currentUser.email) {
              return {
                statusCode: 400,
                body: {
                  error: 'EMAIL_MISMATCH',
                  message: 'Email addresses must match'
                }
              };
            }

            // Check if Supabase ID already linked
            const existingUser = await api.scopes.users.methods.query({
              filter: { supabase_id: supabase_id }
            }, context);

            if (existingUser.length > 0 && existingUser[0].id !== currentUser.id) {
              return {
                statusCode: 400,
                body: {
                  error: 'ALREADY_LINKED',
                  message: 'This account is already linked to another user'
                }
              };
            }

            // Update user
            log.info(`[Supabase Link] Updating user ${currentUser.id} with supabase_id: ${supabase_id}`);
            await api.scopes.users.methods.patch({
              inputRecord: {
                id: currentUser.id,
                supabase_id: supabase_id
              }
            }, context);

            return {
              statusCode: 200,
              body: {
                success: true,
                linked: 'supabase'
              }
            };

          } catch (error) {
            return {
              statusCode: 500,
              body: { error: error.message }
            };
          }
        }
      });

      log.info('Added Supabase link endpoint: /api/auth/supabase/link');
    }

    log.info('SupabaseAuthPlugin installed successfully', {
      usersResource: config.usersResource,
      autoSync: 'Enabled via JWT plugin'
    });
  }
}