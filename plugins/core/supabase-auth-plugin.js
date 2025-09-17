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
        supabase_email: { type: 'string', nullable: true }  // Current email at Supabase
      };
      
      // Merge fields into the mutable fields object
      Object.assign(fields, supabaseFields);
      
      log.info(`Extended ${scopeName} with Supabase fields`, {
        fields: Object.keys(supabaseFields),
        resource: scopeName
      });
    });
    
    log.info('SupabaseAuthPlugin installed successfully', {
      usersResource: config.usersResource,
      autoSync: 'Enabled via JWT plugin'
    });
  }
}