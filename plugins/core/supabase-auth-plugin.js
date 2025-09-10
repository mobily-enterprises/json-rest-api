/**
 * Supabase Authentication Plugin for REST API
 * 
 * This plugin provides:
 * 1. User sync endpoints for Supabase authentication
 * 2. Session management endpoints
 * 3. Anonymous user support
 * 
 * Requirements:
 * - JWT plugin must be installed first (for token validation)
 * - App must define a users resource with proper auth rules
 */

export const SupabaseAuthPlugin = {
  name: 'supabase-auth',
  dependencies: ['rest-api', 'jwt-auth', 'express'],
  
  async install({ api, log, helpers, pluginOptions }) {
    // Check Express router availability
    if (!api.http?.express?.router) {
      throw new Error('SupabaseAuthPlugin: Express router not available. Ensure ExpressPlugin is installed.')
    }
    
    const router = api.http.express.router
    
    // Configuration
    const config = {
      usersResource: pluginOptions.usersResource || 'users',
      syncEndpoint: pluginOptions.syncEndpoint || '/auth/sync-user',
      meEndpoint: pluginOptions.meEndpoint || '/auth/me',
      requiredFields: pluginOptions.requiredFields || ['id', 'email']
    }
    
    // // Validate users resource exists
    // const usersScope = api.scopes[config.usersResource]
    // if (!usersScope) {
    //   throw new Error(
    //     `SupabaseAuthPlugin: Resource '${config.usersResource}' not found. ` +
    //     `Please create it with proper auth rules before installing this plugin.`
    //   )
    // }
    
    // // Validate auth rules were defined
    // if (!usersScope.vars?.authRules) {
    //   throw new Error(
    //     `SupabaseAuthPlugin: Resource '${config.usersResource}' must have auth rules defined. ` +
    //     `Add auth: { query: ['authenticated'], get: ['authenticated'], post: ['public'], patch: ['owns'], delete: ['owns'] } ` +
    //     `when calling addResource('${config.usersResource}', { ... })`
    //   )
    // }
    
    // // Validate required fields exist
    // const userSchema = usersScope.vars.schemaInfo?.schema
    // if (userSchema) {
    //   const missingFields = config.requiredFields.filter(field => !userSchema[field])
    //   if (missingFields.length > 0) {
    //     throw new Error(
    //       `SupabaseAuthPlugin: Users resource missing required fields: ${missingFields.join(', ')}`
    //     )
    //   }
    // }
    
    // User sync endpoint - creates/updates user record from Supabase
    router.post(config.syncEndpoint, async (req, res) => {
      try {
        // Note: JWT plugin validates token before this runs
        const authUserId = req.auth?.userId
        
        const { user } = req.body
        if (!user?.id || !user?.email) {
          return res.status(400).json({ 
            error: 'Invalid user data',
            details: 'Request must include user object with id and email' 
          })
        }
        
        // Only allow syncing your own user (unless admin)
        if (authUserId && authUserId !== user.id && !req.auth?.roles?.includes('admin')) {
          return res.status(403).json({ 
            error: 'Forbidden',
            details: 'Cannot sync other users' 
          })
        }
        
        try {
          // Check if user exists - use system context to bypass ownership filtering
          const systemContext = { 
            auth: { userId: 'system', system: true },
            // Pass request object for Express plugin
            request: req,
            response: res
          }
          
          let existingUser
          try {
            const result = await api.resources[config.usersResource].query({
              queryParams: { filters: { id: user.id } },
              simplified: true
            }, systemContext)
            existingUser = result.data?.[0]
          } catch (queryError) {
            // User doesn't exist yet
            existingUser = null
          }
          
          // Prepare user data
          const userData = {
            id: user.id,
            email: user.email,
            is_anonymous: user.is_anonymous || false
          }
          
          // Add optional fields if they exist in schema
          // TODO: Re-enable when we can check schema after resources are loaded
          // if (userSchema?.name) {
          //   userData.name = user.user_metadata?.name || user.email.split('@')[0]
          // }
          // if (userSchema?.avatar_url) {
          //   userData.avatar_url = user.user_metadata?.avatar_url || ''
          // }
          // if (userSchema?.metadata) {
          //   userData.metadata = user.user_metadata || {}
          // }
          // For now, always add these fields
          userData.name = user.user_metadata?.name || user.email.split('@')[0]
          userData.avatar_url = user.user_metadata?.avatar_url || ''
          userData.metadata = user.user_metadata || {}
          
          let syncedUser
          
          if (!existingUser) {
            // Create new user - post auth rule must be ['public'] for this to work
            const createContext = { 
              auth: null, // No auth for creation (relies on 'public' rule)
              request: req,
              response: res
            }
            
            const createResult = await api.resources[config.usersResource].post({
              inputRecord: {
                data: {
                  type: config.usersResource,
                  attributes: userData
                }
              }
            }, createContext)
            syncedUser = createResult.data
            log.info(`Created new user: ${user.id}`)
          } else {
            // Update existing user - use user's own auth context
            const updates = {}
            Object.keys(userData).forEach(key => {
              if (userData[key] !== existingUser[key]) {
                updates[key] = userData[key]
              }
            })
            
            if (Object.keys(updates).length > 0) {
              const updateContext = { 
                auth: { userId: user.id },
                request: req,
                response: res
              }
              
              const updateResult = await api.resources[config.usersResource].patch({
                id: user.id,
                inputRecord: {
                  data: {
                    type: config.usersResource,
                    id: user.id,
                    attributes: updates
                  }
                }
              }, updateContext)
              syncedUser = updateResult.data
              log.debug(`Updated user: ${user.id}`)
            } else {
              syncedUser = existingUser
              log.debug(`User unchanged: ${user.id}`)
            }
          }
          
          res.json({ 
            success: true,
            user: syncedUser
          })
        } catch (dbError) {
          log.error(`Failed to sync user ${user.id}:`, dbError)
          res.status(500).json({ 
            error: 'Database error',
            details: dbError.message 
          })
        }
      } catch (error) {
        log.error('User sync error:', error)
        res.status(500).json({ 
          error: 'Internal server error',
          details: error.message 
        })
      }
    })
    
    // Get current user endpoint
    router.get(config.meEndpoint, async (req, res) => {
      try {
        if (!req.auth?.userId) {
          return res.status(401).json({ 
            error: 'Not authenticated' 
          })
        }
        
        const context = {
          auth: req.auth,
          request: req,
          response: res
        }
        
        const result = await api.resources[config.usersResource].get({
          id: req.auth.userId,
          simplified: true
        }, context)
        
        res.json(result.data)
      } catch (error) {
        if (error.statusCode === 404) {
          res.status(404).json({ 
            error: 'User profile not found',
            details: 'Please sync your user profile' 
          })
        } else {
          log.error('Get user error:', error)
          res.status(500).json({ 
            error: 'Failed to get user profile',
            details: error.message 
          })
        }
      }
    })
    
    // Add helper method
    helpers.supabaseAuth = {
      async syncUser(userId, userData, context = {}) {
        return api.resources[config.usersResource].post({
          inputRecord: {
            data: {
              type: config.usersResource,
              attributes: { id: userId, ...userData }
            }
          }
        }, { ...context, auth: { userId, system: true } })
      }
    }
    
    log.info(`SupabaseAuthPlugin installed (users resource: ${config.usersResource})`)
  }
}