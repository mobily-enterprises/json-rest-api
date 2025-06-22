/**
 * Core discovery functionality
 * Extracts permission-aware schemas and API metadata
 */

/**
 * Extract all resources and their schemas, filtered by user permissions
 * @param {Api} api - The API instance
 * @param {Object} user - The current user (null for anonymous)
 * @returns {Object} Permission-filtered API metadata
 */
export async function extractPermittedSchema(api, user) {
  const resources = {};
  
  if (!api.schemas) {
    return { resources };
  }
  
  // Process each registered resource
  for (const [resourceType, schema] of api.schemas) {
    const resourceInfo = await extractResourceInfo(api, resourceType, schema, user);
    
    // Only include resource if user has access to at least one field
    if (resourceInfo && Object.keys(resourceInfo.fields).length > 0) {
      resources[resourceType] = resourceInfo;
    }
  }
  
  return {
    resources,
    meta: {
      apiName: api.options.name || 'API',
      apiVersion: api.options.version || '1.0.0',
      totalResources: Object.keys(resources).length,
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Extract resource information filtered by permissions
 * @param {Api} api - The API instance
 * @param {string} resourceType - The resource type name
 * @param {Schema} schema - The resource schema
 * @param {Object} user - The current user
 * @returns {Object|null} Resource information or null if no access
 */
async function extractResourceInfo(api, resourceType, schema, user) {
  const fields = {};
  const relationships = {};
  const searchableFields = [];
  
  // Get resource options for searchable field mappings
  const resourceOptions = api.resourceOptions?.get(resourceType) || {};
  
  // Process each field in the schema
  for (const [fieldName, fieldDef] of Object.entries(schema.structure)) {
    // Check read permission for this field
    const canRead = api.checkFieldPermission(user, fieldDef.permissions?.read, null);
    
    if (!canRead) {
      continue; // Skip fields user cannot read
    }
    
    // Build field info
    const fieldInfo = {
      type: fieldDef.type,
      required: fieldDef.required || false,
      description: fieldDef.description
    };
    
    // Add validation rules (only what's relevant for API consumers)
    if (fieldDef.min !== undefined) fieldInfo.min = fieldDef.min;
    if (fieldDef.max !== undefined) fieldInfo.max = fieldDef.max;
    if (fieldDef.enum) fieldInfo.enum = fieldDef.enum;
    if (fieldDef.pattern) fieldInfo.pattern = fieldDef.pattern.toString();
    if (fieldDef.unique) fieldInfo.unique = true;
    
    // Add default value if it's not a function
    if (fieldDef.default !== undefined && typeof fieldDef.default !== 'function') {
      fieldInfo.default = fieldDef.default;
    }
    
    // For arrays, include item type
    if (fieldDef.type === 'array' && fieldDef.items) {
      fieldInfo.items = fieldDef.items;
    }
    
    // Check if field is searchable
    if (fieldDef.searchable) {
      searchableFields.push(fieldName);
    }
    
    // Handle relationships
    if (fieldDef.refs) {
      // To-one relationship
      const canInclude = await api.checkIncludePermission(user, fieldDef);
      
      relationships[fieldName] = {
        type: 'to-one',
        resource: fieldDef.refs.resource,
        canInclude
      };
      
      // Add relationship endpoint info if available
      if ((fieldDef.provideUrl || fieldDef.refs.provideUrl) && canInclude) {
        relationships[fieldName].endpoints = {
          self: `/relationships/${fieldName}`,
          related: `/${fieldName}`
        };
      }
    } else if (fieldDef.type === 'list' && fieldDef.foreignResource) {
      // To-many relationship
      const canInclude = await api.checkIncludePermission(user, fieldDef);
      
      relationships[fieldName] = {
        type: 'to-many',
        resource: fieldDef.foreignResource,
        foreignKey: fieldDef.foreignKey,
        canInclude
      };
      
      // Add relationship endpoint info if available
      if (fieldDef.provideUrl && canInclude) {
        relationships[fieldName].endpoints = {
          self: `/relationships/${fieldName}`,
          related: `/${fieldName}`
        };
      }
    }
    
    fields[fieldName] = fieldInfo;
  }
  
  // Add mapped searchable fields from resource options
  if (resourceOptions.searchableFields) {
    for (const [searchField, mapping] of Object.entries(resourceOptions.searchableFields)) {
      if (!searchableFields.includes(searchField)) {
        searchableFields.push(searchField);
      }
    }
  }
  
  // Check if user can perform operations on this resource
  const operations = await checkResourceOperations(api, resourceType, user);
  
  return {
    fields,
    relationships: Object.keys(relationships).length > 0 ? relationships : undefined,
    searchableFields: searchableFields.length > 0 ? searchableFields : undefined,
    operations
  };
}

/**
 * Check which operations user can perform on a resource
 * @param {Api} api - The API instance
 * @param {string} resourceType - The resource type
 * @param {Object} user - The current user
 * @returns {Object} Available operations
 */
async function checkResourceOperations(api, resourceType, user) {
  // For now, assume if user can read any field, they can query
  // More sophisticated permission checking could be added here
  const operations = {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true
  };
  
  // Check if bulk operations are available
  if (api._resourceProxies?.get(resourceType)?.bulk) {
    operations.bulk = {
      create: true,
      update: true,
      delete: true
    };
  }
  
  return operations;
}

/**
 * Build endpoint paths for a resource
 * @param {string} basePath - API base path
 * @param {string} resourceType - Resource type name
 * @param {Object} relationships - Resource relationships
 * @returns {Object} Endpoint paths
 */
export function buildEndpoints(basePath, resourceType, relationships = {}) {
  const endpoints = {
    collection: `${basePath}/${resourceType}`,
    item: `${basePath}/${resourceType}/{id}`
  };
  
  // Add relationship endpoints
  const relationshipEndpoints = {};
  for (const [fieldName, relInfo] of Object.entries(relationships)) {
    if (relInfo.endpoints) {
      relationshipEndpoints[fieldName] = {
        self: `${basePath}/${resourceType}/{id}${relInfo.endpoints.self}`,
        related: `${basePath}/${resourceType}/{id}${relInfo.endpoints.related}`
      };
    }
  }
  
  if (Object.keys(relationshipEndpoints).length > 0) {
    endpoints.relationships = relationshipEndpoints;
  }
  
  // Add bulk endpoints
  endpoints.bulk = {
    create: `${basePath}/${resourceType}/bulk`,
    update: `${basePath}/${resourceType}/bulk`,
    delete: `${basePath}/${resourceType}/bulk`
  };
  
  return endpoints;
}