/**
 * JSON:API Strict Plugin
 * 
 * Transforms responses to be fully compliant with JSON:API specification.
 * This includes proper relationship objects, compound documents with included array,
 * and correct meta information structure.
 * 
 * @example
 * import { JSONAPIStrictPlugin } from 'json-rest-api';
 * 
 * api.use(JSONAPIStrictPlugin);
 */

export const JSONAPIStrictPlugin = {
  install(api, options = {}) {
    // Track included resources to avoid duplicates
    const includedCache = new WeakMap();
    
    /**
     * Transform a resource to strict JSON:API format
     */
    function transformResource(resource, type, schema, included = new Set()) {
      if (!resource) return null;
      
      const { [api.options.idProperty]: id, ...attributes } = resource;
      const relationships = {};
      
      // Process each field to extract relationships
      for (const [field, value] of Object.entries(attributes)) {
        const fieldDef = schema?.structure?.[field];
        
        if (fieldDef?.refs && value !== null && value !== undefined) {
          // This is a relationship field
          const relType = fieldDef.refs.resource;
          
          // Create relationship object
          relationships[field.replace(/Id$/, '')] = {
            data: typeof value === 'object' 
              ? { type: relType, id: String(value[api.options.idProperty]) }
              : { type: relType, id: String(value) }
          };
          
          // If we have the full object (from a join), add to included
          if (typeof value === 'object') {
            const relSchema = api.schemas.get(relType);
            const includedResource = transformResource(value, relType, relSchema, included);
            if (includedResource) {
              const key = `${relType}:${includedResource.id}`;
              if (!included.has(key)) {
                included.add(key);
                included[key] = includedResource;
              }
            }
          }
          
          // Remove from attributes
          delete attributes[field];
        }
      }
      
      // Build the resource object
      const result = {
        id: String(id),
        type
      };
      
      // Only add attributes if there are any
      if (Object.keys(attributes).length > 0) {
        result.attributes = attributes;
      }
      
      // Only add relationships if there are any
      if (Object.keys(relationships).length > 0) {
        result.relationships = relationships;
      }
      
      return result;
    }
    
    /**
     * Transform response to strict JSON:API format
     */
    function transformResponse(response, type, schema) {
      // Handle single resource responses
      if (response.data && !Array.isArray(response.data)) {
        const included = new Set();
        const transformed = transformResource(response.data, type, schema, included);
        
        const result = { data: transformed };
        
        // Add included resources if any
        const includedArray = Array.from(included)
          .filter(key => typeof key === 'string')
          .map(key => included[key])
          .filter(Boolean);
          
        if (includedArray.length > 0) {
          result.included = includedArray;
        }
        
        // Add meta if present
        if (response.meta) {
          result.meta = response.meta;
        }
        
        // Add links if present
        if (response.links) {
          result.links = response.links;
        }
        
        return result;
      }
      
      // Handle collection responses
      if (response.data && Array.isArray(response.data)) {
        const included = new Set();
        const transformedData = response.data.map(item => 
          transformResource(item, type, schema, included)
        );
        
        const result = { data: transformedData };
        
        // Add included resources if any
        const includedArray = Array.from(included)
          .filter(key => typeof key === 'string')
          .map(key => included[key])
          .filter(Boolean);
          
        if (includedArray.length > 0) {
          result.included = includedArray;
        }
        
        // Ensure meta follows JSON:API format
        if (response.meta) {
          result.meta = {
            ...response.meta,
            ...(response.meta.total !== undefined && { totalCount: response.meta.total }),
            ...(response.meta.page !== undefined && { 
              currentPage: response.meta.page,
              pageSize: response.meta.pageSize || response.meta.limit
            })
          };
        }
        
        // Add links if present
        if (response.links) {
          result.links = response.links;
        }
        
        return result;
      }
      
      // Return as-is if not a data response
      return response;
    }
    
    // Hook into HTTP response formatting
    api.hook('afterHTTPResponse', async (context) => {
      // Only transform successful data responses
      if (context.response && context.response.data !== undefined) {
        const type = context.type || context.options?.type;
        const schema = api.schemas.get(type);
        
        if (type && schema) {
          context.response = transformResponse(context.response, type, schema);
        }
      }
    });
    
    // Add relationship links to resources
    api.hook('beforeHTTPResponse', async (context) => {
      if (context.response?.data && context.options?.type) {
        const baseUrl = context.baseUrl || '/api';
        const type = context.options.type;
        
        // Add self and related links to relationships
        const addRelationshipLinks = (resource) => {
          if (resource.relationships) {
            for (const [relName, rel] of Object.entries(resource.relationships)) {
              if (!rel.links) {
                rel.links = {
                  self: `${baseUrl}/${type}/${resource.id}/relationships/${relName}`,
                  related: `${baseUrl}/${type}/${resource.id}/${relName}`
                };
              }
            }
          }
        };
        
        if (Array.isArray(context.response.data)) {
          context.response.data.forEach(addRelationshipLinks);
        } else if (context.response.data) {
          addRelationshipLinks(context.response.data);
        }
      }
    });
    
    // Handle include parameter for proper compound documents
    api.hook('beforeQuery', async (context) => {
      // The include parameter is already processed by the HTTP plugin
      // We just need to ensure the included resources are formatted correctly
      // This happens automatically in the transformResponse function
    });
    
    // Ensure errors follow JSON:API format
    api.hook('afterError', async (context) => {
      if (context.error && !context.error.errors) {
        // Transform single error to JSON:API errors array
        const error = context.error;
        context.response = {
          errors: [{
            status: String(error.statusCode || 500),
            code: error.code || 'UNKNOWN_ERROR',
            title: error.name || 'Error',
            detail: error.message || 'An error occurred',
            ...(error.source && { source: error.source }),
            ...(error.meta && { meta: error.meta })
          }]
        };
      }
    });
  }
};