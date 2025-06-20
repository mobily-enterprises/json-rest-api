import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

/**
 * Authorization Plugin for JSON REST API
 * 
 * Provides role-based access control (RBAC) with:
 * - Role definitions with permissions
 * - Resource-level access rules
 * - Ownership-based permissions (.own suffix)
 * - User enhancement bridge pattern
 * - Automatic permission checking in hooks
 */
export const AuthorizationPlugin = {
  name: 'AuthorizationPlugin',
  version: '1.0.0',
  
  install(api, options = {}) {
    // Initialize storage
    api._auth = {
      roles: new Map(),
      resources: new Map(),
      options: {
        defaultRole: options.defaultRole || 'user',
        superAdminRole: options.superAdminRole || 'admin',
        publicRole: options.publicRole || 'public',
        ownerField: options.ownerField || 'userId',
        cacheTimeout: options.cacheTimeout || 300,
        requireAuth: options.requireAuth !== false,
        ...options
      }
    };
    
    // Store the user enhancer function
    if (options.enhanceUser) {
      api._auth.enhanceUser = options.enhanceUser;
    }
    
    // API Methods
    
    /**
     * Define a role with permissions
     */
    api.defineRole = (name, config) => {
      const roleConfig = typeof config === 'object' ? config : { permissions: config };
      
      api._auth.roles.set(name, {
        name,
        permissions: normalizePermissions(roleConfig.permissions),
        description: roleConfig.description || '',
        priority: roleConfig.priority || 0
      });
      
      return api;
    };
    
    /**
     * Configure resource-specific auth rules
     */
    api.configureResourceAuth = (resourceName, config) => {
      api._auth.resources.set(resourceName, {
        ownerField: config.ownerField || api._auth.options.ownerField,
        public: config.public || [],
        authenticated: config.authenticated || [],
        owner: config.owner || [],
        permissions: config.permissions || {},
        condition: config.condition
      });
      
      return api;
    };
    
    /**
     * Check if a user has a specific permission
     */
    api.checkPermission = (user, permission) => {
      if (!user) return false;
      
      // Super admin bypass
      if (user.roles?.includes(api._auth.options.superAdminRole)) {
        return true;
      }
      
      // Check direct permissions
      if (user.permissions?.includes(permission) || user.permissions?.includes('*')) {
        return true;
      }
      
      // Check role-based permissions
      if (user.roles) {
        for (const roleName of user.roles) {
          const role = api._auth.roles.get(roleName);
          if (!role) continue;
          
          // Check exact permission or wildcards
          if (hasPermission(role.permissions, permission)) {
            return true;
          }
        }
      }
      
      return false;
    };
    
    /**
     * Enhance user object with auth methods and data
     */
    api.enhanceUserForAuth = async (user, context) => {
      if (!user) return null;
      
      // Already enhanced
      if (user._enhanced) return user;
      
      // Call the enhancer function if provided
      let enhanced = user;
      if (api._auth.enhanceUser) {
        enhanced = await api._auth.enhanceUser(user, context);
      }
      
      // Ensure we have arrays
      enhanced.roles = enhanced.roles || [];
      enhanced.permissions = enhanced.permissions || [];
      
      // Add the default role if user has no roles
      if (enhanced.roles.length === 0 && api._auth.options.defaultRole) {
        enhanced.roles.push(api._auth.options.defaultRole);
      }
      
      // Add helper methods
      enhanced.can = (permission) => api.checkPermission(enhanced, permission);
      enhanced.hasRole = (role) => enhanced.roles.includes(role);
      enhanced.hasAnyRole = (...roles) => roles.some(r => enhanced.roles.includes(r));
      enhanced.hasAllRoles = (...roles) => roles.every(r => enhanced.roles.includes(r));
      
      // Mark as enhanced
      enhanced._enhanced = true;
      enhanced._enhancedAt = Date.now();
      
      return enhanced;
    };
    
    // Define built-in roles if provided
    if (options.roles) {
      Object.entries(options.roles).forEach(([name, config]) => {
        api.defineRole(name, config);
      });
    }
    
    // Configure resource-specific rules if provided
    if (options.resources) {
      Object.entries(options.resources).forEach(([resourceName, config]) => {
        api.configureResourceAuth(resourceName, config);
      });
    }
    
    // Hook to enhance user in context
    api.hook('beforeOperation', async (context) => {
      if (context.options.user) {
        context.options.user = await api.enhanceUserForAuth(
          context.options.user,
          context
        );
      }
    }, 5); // Very high priority
    
    // Authorization checking hooks
    const checkAuth = (operation) => async (context) => {
      let { type, user } = context.options;
      
      // Skip if no resource type (non-resource operations)
      if (!type) return;
      
      // Skip if internal auth bypass flag is set
      if (context.options._skipAuth) return;
      
      // Enhance user if needed
      if (user && !user._enhanced) {
        user = context.options.user = await api.enhanceUserForAuth(user, context);
      }
      
      const resourceConfig = api._auth.resources.get(type) || {};
      const schema = api.schemas?.get(type);
      
      // Check if operation is public
      if (resourceConfig.public?.includes(operation)) {
        return;
      }
      
      // Require authentication if not public
      if (!user && api._auth.options.requireAuth) {
        throw new UnauthorizedError('Authentication required');
      }
      
      // If user is authenticated but no specific rules, check basic permission
      if (user) {
        const basePermission = `${type}.${operation}`;
        
        // Check if operation requires only authentication
        if (resourceConfig.authenticated?.includes(operation)) {
          return;
        }
        
        // Check ownership-based permissions FIRST if configured
        if (resourceConfig.owner?.includes(operation)) {
          const ownPermission = `${basePermission}.own`;
          
          if (user.can(ownPermission)) {
            // For read operations, we'll check ownership after fetch
            if (operation === 'read') {
              context._checkOwnership = true;
              return;
            }
            
            // For update/delete, fetch the resource to check ownership
            // Use internal flag to skip auth check on this fetch
            const result = await api.get(context.id, { type, _skipAuth: true });
            const ownerField = resourceConfig.ownerField || api._auth.options.ownerField;
            
            // Handle both raw result and formatted response
            const existing = result.data ? result.data.attributes : result;
            const ownerId = existing[ownerField];
            
            if (ownerId && String(ownerId) === String(user.id)) {
              return;
            }
          }
        }
        
        // Check if user has direct permission
        if (user.can(basePermission)) {
          return;
        }
        
        // Check custom permissions for the operation
        const customPermission = resourceConfig.permissions?.[operation];
        if (customPermission && user.can(customPermission)) {
          return;
        }
        
        // Check wildcard permissions
        if (user.can(`${type}.*`)) {
          return;
        }
        
        throw new ForbiddenError(`Permission denied: ${basePermission}`);
      }
    };
    
    // Register authorization hooks with operation mapping
    api.hook('beforeInsert', checkAuth('create'), 10);
    api.hook('beforeGet', checkAuth('read'), 10);
    api.hook('beforeQuery', checkAuth('read'), 10);
    api.hook('beforeUpdate', checkAuth('update'), 10);
    api.hook('beforeDelete', checkAuth('delete'), 10);
    
    // Post-operation ownership check for GET
    api.hook('afterGet', async (context) => {
      if (context._checkOwnership && context.result) {
        const { type, user } = context.options;
        const resourceConfig = api._auth.resources.get(type) || {};
        const ownerField = resourceConfig.ownerField || api._auth.options.ownerField;
        const ownerId = context.result[ownerField];
        
        if (!ownerId || String(ownerId) !== String(user.id)) {
          throw new ForbiddenError('You can only access your own resources');
        }
      }
    }, 10);
    
    // Helper to add field-level permissions in afterGet/afterQuery
    api.hook('transformResult', async (context) => {
      let { type, user } = context.options;
      if (!type || !context.result) return;
      
      // Enhance user if needed
      if (user && !user._enhanced) {
        user = context.options.user = await api.enhanceUserForAuth(user, context);
      }
      
      const schema = api.schemas?.get(type);
      if (!schema) return;
      
      // Check field-level permissions
      for (const [field, definition] of Object.entries(schema.structure)) {
        if (definition.permission) {
          // Remove field if user is not authenticated or lacks permission
          const hasPermission = user && user.can(definition.permission);
          if (!hasPermission) {
            if (context.method === 'query') {
              context.results.forEach(item => delete item[field]);
            } else {
              delete context.result[field];
            }
          }
        }
      }
    }, 20);
  }
};

// Helper functions

function normalizePermissions(permissions) {
  if (!permissions) return [];
  if (permissions === '*') return ['*'];
  if (typeof permissions === 'string') return [permissions];
  if (Array.isArray(permissions)) return permissions;
  return [];
}

function hasPermission(permissions, permission) {
  if (permissions.includes('*')) return true;
  if (permissions.includes(permission)) return true;
  
  // Check wildcards (e.g., 'posts.*' matches 'posts.create')
  const parts = permission.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const wildcard = parts.slice(0, i).join('.') + '.*';
    if (permissions.includes(wildcard)) return true;
  }
  
  return false;
}