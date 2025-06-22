import { BadRequestError } from '../../lib/errors.js';

/**
 * Views Plugin
 * 
 * Provides view-based control over response shapes:
 * - Smart defaults for query vs get operations
 * - Resource-level default configuration
 * - Named views for different use cases
 * - No field control in URLs - keeps API simple
 * 
 * Priority order:
 * 1. Named view (if ?view=name specified)
 * 2. Resource defaults (if configured)
 * 3. Smart built-in defaults
 */
export const ViewsPlugin = {
  name: 'ViewsPlugin',
  version: '1.0.0',
  
  // Smart defaults built into the plugin
  defaults: {
    query: {
      joins: [],          // No joins for lists by default
      pageSize: 20,
      maxPageSize: 100
    },
    get: {
      joins: true,        // All joins for single records
      includeComputed: true
    }
  },
  
  install(api, options = {}) {
    // Allow global default overrides
    const globalDefaults = {
      query: { ...this.defaults.query, ...options.defaults?.query },
      get: { ...this.defaults.get, ...options.defaults?.get }
    };
    
    // Storage for configurations
    api._viewsConfig = {
      defaults: globalDefaults,
      resources: new Map()
    };
    
    // Override addResource to capture view configurations
    const originalAddResource = api.addResource.bind(api);
    api.addResource = function(type, schema, options = {}) {
      // Call original
      const result = originalAddResource(type, schema, options);
      
      // Store view configurations
      if (options?.defaults || options?.views) {
        const config = {
          defaults: options.defaults || {},
          views: options.views || {},
          viewPermissions: options.viewPermissions || {}
        };
        
        // Validate view names don't clash with query parameters
        if (options.views) {
          const reservedParams = ['page', 'sort', 'filter', 'fields', 'include'];
          for (const viewName of Object.keys(options.views)) {
            if (reservedParams.includes(viewName)) {
              throw new Error(`View name '${viewName}' conflicts with reserved query parameter`);
            }
          }
        }
        
        api._viewsConfig.resources.set(type, config);
      }
      
      return result;
    };
    
    // Apply views to GET operations
    api.hook('beforeGet', async (context) => {
      await applyView(api, context, 'get');
    }, 10); // Run early
    
    // Apply views to QUERY operations
    api.hook('beforeQuery', async (context) => {
      await applyView(api, context, 'query');
    }, 10); // Run early
    
    // Note: We don't apply views to CREATE/UPDATE responses
    // because they don't have params.view set during those operations
    
    // Apply field filtering after all operations
    api.hook('afterGet', async (context) => {
      if (context._viewConfig?.fields && context.result) {
        context.result = filterFields(context.result, context._viewConfig.fields);
      }
    }, 90); // Run late
    
    api.hook('afterQuery', async (context) => {
      if (context._viewConfig?.fields && context.results) {
        context.results = context.results.map(item => 
          filterFields(item, context._viewConfig.fields)
        );
      }
    }, 90); // Run late
    
    // API method to get available views for a resource
    api.getResourceViews = (resourceType) => {
      const config = api._viewsConfig.resources.get(resourceType);
      if (!config) return [];
      
      return Object.keys(config.views);
    };
    
    // API method to get view configuration
    api.getViewConfig = (resourceType, viewName, operation) => {
      const resourceConfig = api._viewsConfig.resources.get(resourceType);
      if (!resourceConfig) return null;
      
      const view = resourceConfig.views[viewName];
      if (!view) return null;
      
      // Return operation-specific config or the whole view
      return operation ? view[operation] : view;
    };
  }
};

/**
 * Apply view logic to determine configuration
 */
async function applyView(api, context, operation) {
  const { type } = context.options;
  const params = context.params || {};
  const user = context.options.user;
  
  // For GET operations, check options for view parameter
  if (operation === 'get' && context.options.view && !params.view) {
    params.view = context.options.view;
  }
  
  // Start with global defaults
  let config = { ...api._viewsConfig.defaults[operation] };
  
  // Get resource configuration
  const resourceConfig = api._viewsConfig.resources.get(type);
  
  // Apply resource defaults if they exist
  if (resourceConfig?.defaults?.[operation]) {
    config = mergeConfigs(config, resourceConfig.defaults[operation]);
  }
  
  // Check if a view is requested
  if (params?.view && resourceConfig?.views) {
    const requestedView = params.view;
    const view = resourceConfig.views[requestedView];
    
    if (!view) {
      throw new BadRequestError(`View '${requestedView}' does not exist for resource '${type}'`)
        .withContext({ 
          availableViews: Object.keys(resourceConfig.views),
          resource: type 
        });
    }
    
    // Check view permissions
    const permission = resourceConfig.viewPermissions?.[requestedView];
    if (permission) {
      // Check if user has permission
      if (!user) {
        throw new BadRequestError(`View '${requestedView}' requires authentication`);
      }
      
      if (!checkViewPermission(user, permission)) {
        throw new BadRequestError(`Insufficient permissions for view '${requestedView}'`)
          .withContext({ required: permission });
      }
    }
    
    // Apply view configuration for this operation
    if (view[operation]) {
      config = mergeConfigs(config, view[operation]);
    } else if (!view.query && !view.get) {
      // View has no operation-specific config, use it for all operations
      config = mergeConfigs(config, view);
    }
  }
  
  // Apply configuration to context
  applyConfigToContext(context, config);
  
  // Store config for later use (field filtering)
  context._viewConfig = config;
}

/**
 * Merge two configurations, handling special cases
 */
function mergeConfigs(base, override) {
  const merged = { ...base };
  
  for (const [key, value] of Object.entries(override)) {
    if (value === null || value === undefined) {
      // null/undefined means use default
      continue;
    }
    
    if (key === 'joins' && value === true) {
      // true means all joins
      merged.joins = true;
    } else if (key === 'joins' && value === false) {
      // false means no joins
      merged.joins = [];
    } else if (Array.isArray(value)) {
      // Arrays are replaced, not merged
      merged[key] = [...value];
    } else if (typeof value === 'object' && value !== null) {
      // Objects are merged
      merged[key] = { ...merged[key], ...value };
    } else {
      // Primitives are replaced
      merged[key] = value;
    }
  }
  
  return merged;
}

/**
 * Apply configuration to the context
 */
function applyConfigToContext(context, config) {
  // Ensure params exists
  if (!context.params) {
    context.params = {};
  }
  
  const { params } = context;
  
  // Apply joins configuration as include parameter
  if ('joins' in config) {
    if (config.joins === true) {
      // Find all refs in the schema
      const schema = context.api.schemas?.get(context.options.type);
      if (schema) {
        const refs = [];
        for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
          if (fieldDef.refs) {
            refs.push(fieldName);
          }
        }
        params.include = refs.join(',');
      }
    } else if (Array.isArray(config.joins)) {
      // Convert joins array to include string
      params.include = config.joins.join(',');
    } else if (config.joins === false || (Array.isArray(config.joins) && config.joins.length === 0)) {
      // No includes
      params.include = '';
    }
  }
  
  // Apply pagination
  if (config.pageSize) {
    if (!params.page) {
      params.page = {};
    }
    if (!params.page.size) {
      params.page.size = config.pageSize;
    }
    
    // Enforce max page size
    if (config.maxPageSize && params.page.size > config.maxPageSize) {
      params.page.size = config.maxPageSize;
    }
  }
  
  // Apply default sort
  if (config.sort && !params.sort) {
    params.sort = config.sort;
  }
  
  // Store other config for later use
  context._viewConfig = config;
}

/**
 * Filter fields based on configuration
 */
function filterFields(data, allowedFields) {
  if (!allowedFields || !Array.isArray(allowedFields)) {
    return data;
  }
  
  // Handle array of results
  if (Array.isArray(data)) {
    return data.map(item => filterFields(item, allowedFields));
  }
  
  // Handle JSON:API format
  if (data.type && data.attributes) {
    const filtered = {
      type: data.type,
      id: data.id
    };
    
    // Filter attributes
    if (data.attributes) {
      filtered.attributes = {};
      for (const field of allowedFields) {
        if (field !== 'id' && field in data.attributes) {
          filtered.attributes[field] = data.attributes[field];
        }
      }
    }
    
    // Include relationships if any of their fields are allowed
    if (data.relationships) {
      filtered.relationships = {};
      for (const field of allowedFields) {
        if (data.relationships[field]) {
          filtered.relationships[field] = data.relationships[field];
        }
      }
    }
    
    // Include meta if present
    if (data.meta) {
      filtered.meta = data.meta;
    }
    
    return filtered;
  }
  
  // Handle plain object format
  const filtered = {};
  
  // Always include id
  if ('id' in data) {
    filtered.id = data.id;
  }
  
  // Filter allowed fields
  for (const field of allowedFields) {
    if (field in data) {
      filtered[field] = data[field];
    }
  }
  
  return filtered;
}

/**
 * Check if user has permission for a view
 */
function checkViewPermission(user, permission) {
  if (typeof permission === 'string') {
    // Check role
    if (user.roles && user.roles.includes(permission)) {
      return true;
    }
    
    // Check specific permission
    if (user.permissions && user.permissions.includes(permission)) {
      return true;
    }
    
    // Check permission method
    if (typeof user.can === 'function' && user.can(permission)) {
      return true;
    }
  } else if (typeof permission === 'function') {
    // Custom permission check
    return permission(user);
  } else if (Array.isArray(permission)) {
    // Any of the permissions
    return permission.some(p => checkViewPermission(user, p));
  }
  
  return false;
}