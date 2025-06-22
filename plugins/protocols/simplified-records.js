/**
 * Simplified Records Plugin
 * 
 * This plugin transforms JSON:API compliant responses into a simplified format
 * that's more convenient for developers.
 * 
 * Features:
 * - Moves relationships back into attributes
 * - Optionally flattens the response structure (removes data wrapper)
 * - Optionally excludes the type field
 * - Restores embedded objects in place of IDs
 * 
 * Example:
 * ```javascript
 * api.use(SimplifiedRecordsPlugin, {
 *   flattenResponse: true,    // Remove { data: ... } wrapper
 *   includeType: false,       // Exclude type field
 *   embedRelationships: true  // Put related objects in attributes
 * });
 * ```
 */
export const SimplifiedRecordsPlugin = {
  install(api, options = {}) {
    const {
      flattenResponse = false,
      includeType = true,
      embedRelationships = true
    } = options;
    
    // Keep JSON:API compliance enabled in the core
    // We'll intercept and transform the responses
    
    // Override the format methods to transform responses
    const originalFormatResponse = api._formatResponse.bind(api);
    const originalFormatQueryResponse = api._formatQueryResponse.bind(api);
    
    api._formatResponse = function(context) {
      const response = originalFormatResponse(context);
      return transformResponse(response);
    };
    
    api._formatQueryResponse = function(context) {
      const response = originalFormatQueryResponse(context);
      return transformResponse(response);
    };
    
    /**
     * Transform a JSON:API response to simplified format
     */
    function transformResponse(response) {
      if (!response || !response.data) return response;
      
      if (Array.isArray(response.data)) {
        // Query response
        response.data = response.data.map(record => 
          simplifyRecord(record, response.included, includeType)
        );
        
        // Flatten if requested
        if (flattenResponse) {
          const { data, meta, links, ...rest } = response;
          
          // For queries with meta, use records/meta structure
          if (meta && Object.keys(meta).length > 0) {
            const flattened = {
              records: data,
              meta
            };
            if (links) {
              flattened.links = links;
            }
            return flattened;
          }
          
          // Otherwise just return the array
          return data;
        }
      } else if (response.data === null) {
        // Null response
        if (flattenResponse) {
          return null;
        }
      } else {
        // Single record response
        response.data = simplifyRecord(
          response.data, 
          response.included,
          includeType
        );
        
        // Flatten if requested
        if (flattenResponse) {
          return response.data;
        }
      }
      
      // Remove included section as it's now embedded
      if (embedRelationships && response && typeof response === 'object') {
        delete response.included;
      }
      
      return response;
    }
    
    /**
     * Simplify a single record
     */
    function simplifyRecord(record, included = [], keepType = true) {
      if (!record) return record;
      
      const simplified = {};
      
      // Add ID
      if (record.id !== undefined) {
        simplified.id = record.id;
      }
      
      // Add type if requested
      if (keepType && record.type) {
        simplified.type = record.type;
      }
      
      // Copy attributes directly into the simplified object
      if (record.attributes) {
        Object.assign(simplified, record.attributes);
      }
      
      // Embed relationships if requested
      if (embedRelationships && record.relationships) {
        const includedMap = new Map();
        
        // Build map of included resources
        if (included) {
          for (const resource of included) {
            const key = `${resource.type}:${resource.id}`;
            includedMap.set(key, resource);
          }
        }
        
        // Process each relationship
        for (const [relName, relData] of Object.entries(record.relationships)) {
          if (!relData.data) continue;
          
          if (Array.isArray(relData.data)) {
            // To-many relationship
            simplified[relName] = relData.data.map(ref => {
              const key = `${ref.type}:${ref.id}`;
              const related = includedMap.get(key);
              if (related) {
                return simplifyRecord(related, [], keepType);
              }
              return ref;
            });
          } else {
            // To-one relationship
            const key = `${relData.data.type}:${relData.data.id}`;
            const related = includedMap.get(key);
            
            if (related) {
              simplified[relName] = simplifyRecord(related, [], keepType);
            } else {
              // If no included data, at least provide the ID
              // Try to restore the original field name with 'Id' suffix
              const idFieldName = relName.endsWith('Id') ? relName : `${relName}Id`;
              if (!simplified[idFieldName]) {
                simplified[idFieldName] = relData.data.id;
              }
            }
          }
        }
      }
      
      return simplified;
    }
    
    // Also handle HTTP responses via beforeSend hook
    api.hook('beforeSend', async (context) => {
      // Only process HTTP responses
      if (!context.isHttp || !context.result) return;
      
      context.result = transformResponse(context.result);
    }, 10); // Low priority to run after other transformations
    
    // Handle error responses
    api.hook('beforeSendError', async (context) => {
      if (!context.isHttp || !flattenResponse) return;
      
      // For simplified format, could unwrap error response if needed
    }, 10);
  }
};