/**
 * @module knex-json-api-transformers
 * @description JSON:API transformation functions for REST API Knex Plugin
 * 
 * This module handles the transformation between flat database records and
 * hierarchical JSON:API format. It manages the conversion of foreign keys
 * to relationships and builds proper JSON:API response structures.
 */

import { getForeignKeyFields } from './knex-field-helpers.js';
import { toJsonApi } from './knex-json-api-helpers.js';
import { RELATIONSHIPS_KEY, getSchemaStructure } from '../utils/knex-constants.js';
import { 
  generatePaginationLinks, 
  generateCursorPaginationLinks 
} from './knex-pagination-helpers.js';

/**
 * Converts a database record to JSON:API format.
 * 
 * This function transforms a flat database record into the hierarchical JSON:API
 * structure, separating regular attributes from foreign keys. Foreign key fields
 * are filtered out of attributes because they're represented as relationships
 * in JSON:API format. This maintains the clean separation between data and
 * relationships that JSON:API requires.
 * 
 * @param {Object} scope - The scope object containing schema and relationship info
 * @param {Object} record - The database record to transform
 * @param {string} scopeName - The name of the scope/resource type
 * @returns {Object} JSON:API formatted resource object
 * 
 * @example <caption>Basic transformation with foreign keys</caption>
 * const dbRecord = {
 *   id: 1,
 *   title: 'Hello World',
 *   content: 'Article content',
 *   author_id: 2,
 *   category_id: 5
 * };
 * const jsonApiRecord = toJsonApiRecord('articles', dbRecord, schema, scopes, vars);
 * // Returns:
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'Hello World',
 * //     content: 'Article content'
 * //     // Note: author_id and category_id are NOT in attributes
 * //   }
 * // }
 * 
 * @example <caption>Polymorphic fields are also filtered</caption>
 * const commentRecord = {
 *   id: 10,
 *   text: 'Great article!',
 *   commentable_type: 'articles',
 *   commentable_id: 1
 * };
 * const jsonApiComment = toJsonApiRecord('comments', commentRecord, schema, scopes, vars);
 * // commentable_type and commentable_id are filtered out of attributes
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Transform flat SQL records to hierarchical JSON:API format
 * // 2. Maintain clean separation between attributes and relationships
 * // 3. Filter out foreign keys that become relationship links
 * // 4. Handle polymorphic relationship fields automatically
 * // 5. Ensure consistent ID formatting (always strings in JSON:API)
 */
export const toJsonApiRecord = (scope, record, scopeName) => {
  // Extract values from scope
  const { 
    vars: { 
      schemaInfo: { schema, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  // Build polymorphic fields set
  const polymorphicFields = new Set();
  try {
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        if (relDef.typeField) polymorphicFields.add(relDef.typeField);
        if (relDef.idField) polymorphicFields.add(relDef.idField);
      }
    });
  } catch (e) {
    // Scope might not have relationships
  }
  
  // Create deps object for toJsonApi
  const deps = {
    context: {
      scopeName,
      schemaInfo: { idProperty },
      polymorphicFields
    }
  };
  
  return toJsonApi(scope, record, deps);
};

/**
 * Builds the final JSON:API response with data and optional included resources
 * 
 * @param {Object} scope - The scope object containing schema and relationship info
 * @param {Array<Object>} records - The primary records to transform
 * @param {Array<Object>} included - Optional array of included resources
 * @param {boolean} isSingle - Whether this is a single resource response
 * @param {string} scopeName - The name of the scope/resource type
 * @returns {Promise<Object>} Complete JSON:API response object
 * 
 * @example
 * const scope = api.resources['articles'];
 * const response = await buildJsonApiResponse(scope, [article], [author], true, 'articles');
 * // Returns { data: { type: 'articles', id: '1', ... }, included: [...] }
 */
export const buildJsonApiResponse = async (scope, records, included = [], isSingle = false, scopeName) => {
  // Extract values from scope
  const { 
    vars: { 
      schemaInfo: { schema, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  const idField = idProperty || 'id';
  
  // Handle both Schema objects and plain objects
  const schemaStructure = getSchemaStructure(schema);
  
  // Process records to JSON:API format
  const processedRecords = records.map(record => {
    const { [RELATIONSHIPS_KEY]: _relationships, ...cleanRecord } = record;
    const jsonApiRecord = toJsonApiRecord(scope, cleanRecord, scopeName);
    
    // Add any loaded relationships
    if (_relationships) {
      jsonApiRecord.relationships = _relationships;
    }
    
    // Add regular belongsTo relationships (only if not already loaded)
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.belongsTo && fieldDef.as && fieldName in cleanRecord) {
        jsonApiRecord.relationships = jsonApiRecord.relationships || {};
        if (!jsonApiRecord.relationships[fieldDef.as]) {
          if (cleanRecord[fieldName] !== null && cleanRecord[fieldName] !== undefined) {
            const relationshipObject = {
              data: {
                type: fieldDef.belongsTo,
                id: String(cleanRecord[fieldName])
              }
            };
            
            // Add links if urlPrefix is configured
            const urlPrefix = scope.vars.resourceUrlPrefix;
            if (urlPrefix) {
              relationshipObject.links = {
                self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${fieldDef.as}`,
                related: `${urlPrefix}/${scopeName}/${record[idField]}/${fieldDef.as}`
              };
            }
            
            jsonApiRecord.relationships[fieldDef.as] = relationshipObject;
          } else {
            // Explicitly null relationship
            const relationshipObject = {
              data: null
            };
            
            // Add links even for null relationships
            const urlPrefix = scope.vars.resourceUrlPrefix;
            if (urlPrefix) {
              relationshipObject.links = {
                self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${fieldDef.as}`,
                related: `${urlPrefix}/${scopeName}/${record[idField]}/${fieldDef.as}`
              };
            }
            
            jsonApiRecord.relationships[fieldDef.as] = relationshipObject;
          }
        }
      }
    }
    
    // Add polymorphic relationships
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        const typeValue = cleanRecord[relDef.typeField];
        const idValue = cleanRecord[relDef.idField];
        
        if (typeValue && idValue) {
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          const relationshipObject = {
            data: {
              type: typeValue,
              id: String(idValue)
            }
          };
          
          // Add links if urlPrefix is configured
          const urlPrefix = scope.vars.resourceUrlPrefix;
          if (urlPrefix) {
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${relName}`,
              related: `${urlPrefix}/${scopeName}/${record[idField]}/${relName}`
            };
          }
          
          jsonApiRecord.relationships[relName] = relationshipObject;
        } else if (typeValue === null || idValue === null) {
          // Explicitly null relationship
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          const relationshipObject = {
            data: null
          };
          
          // Add links even for null relationships
          const urlPrefix = scope.vars.resourceUrlPrefix;
          if (urlPrefix) {
            relationshipObject.links = {
              self: `${urlPrefix}/${scopeName}/${record[idField]}/relationships/${relName}`,
              related: `${urlPrefix}/${scopeName}/${record[idField]}/${relName}`
            };
          }
          
          jsonApiRecord.relationships[relName] = relationshipObject;
        }
      }
    });
    
    return jsonApiRecord;
  });
  
  // Add self links to individual resources if urlPrefix is configured
  const urlPrefix = scope.vars.resourceUrlPrefix;
  const normalizedData = isSingle ? processedRecords[0] : processedRecords;
  
  if (urlPrefix && normalizedData) {
    if (Array.isArray(normalizedData)) {
      // Collection: add self link to each item
      normalizedData.forEach(item => {
        if (!item.links) item.links = {};
        item.links.self = `${urlPrefix}/${scopeName}/${item.id}`;
      });
    } else {
      // Single resource: add self link
      if (!normalizedData.links) normalizedData.links = {};
      normalizedData.links.self = `${urlPrefix}/${scopeName}/${normalizedData.id}`;
    }
  }

  // Build response
  const response = {
    data: normalizedData
  };

  // Add included resources if any
  if (included.length > 0) {
    // Add self links to included resources
    if (urlPrefix) {
      included.forEach(item => {
        if (!item.links) item.links = {};
        item.links.self = `${urlPrefix}/${item.type}/${item.id}`;
      });
    }
    
    response.included = included;
  }

  // Add pagination metadata if provided
  if (scope.vars.paginationMeta) {
    response.meta = {
      pagination: scope.vars.paginationMeta
    };
  }
  
  // Add links to response
  if (scope.vars.paginationLinks) {
    response.links = scope.vars.paginationLinks;
  } else if (urlPrefix) {
    // Add basic self link for the response when no pagination links
    response.links = {
      self: isSingle 
        ? `${urlPrefix}/${scopeName}/${normalizedData.id}`
        : `${urlPrefix}/${scopeName}${scope.vars.queryString || ''}`
    };
  }

  return response;
};

/**
 * Converts a database record to JSON:API format with belongsTo relationships.
 * This is used internally by dataGetMinimal to provide consistent JSON:API
 * structure without requiring additional database queries.
 * 
 * @param {Object} scope - The scope object containing schema and relationship info
 * @param {Object} record - The raw database record to transform
 * @param {string} scopeName - The name of the scope/resource type
 * @returns {Object} JSON:API formatted resource object with belongsTo relationships
 * 
 * @example
 * const dbRecord = {
 *   id: 1,
 *   title: 'Hello World',
 *   author_id: 2,
 *   publisher_id: 3,
 *   category_id: null
 * };
 * const jsonApiRecord = toJsonApiRecordWithBelongsTo(scope, dbRecord, 'articles');
 * // Returns:
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'Hello World'
 * //   },
 * //   relationships: {
 * //     author: {
 * //       data: { type: 'authors', id: '2' }
 * //     },
 * //     publisher: {
 * //       data: { type: 'publishers', id: '3' }
 * //     },
 * //     category: {
 * //       data: null
 * //     }
 * //   }
 * // }
 */
export const toJsonApiRecordWithBelongsTo = (scope, record, scopeName) => {
  if (!record) return null;
  
  // Get the basic JSON:API structure (without relationships)
  const jsonApiRecord = toJsonApiRecord(scope, record, scopeName);
  
  // Extract schema info from scope
  const { 
    vars: { 
      schemaInfo: { schema, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  const idField = idProperty || 'id';
  
  // Get schema structure
  const schemaStructure = getSchemaStructure(schema);
  
  // Initialize relationships object
  jsonApiRecord.relationships = {};
  
  // Process regular belongsTo relationships from schema
  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const foreignKeyValue = record[fieldName];
      
      if (foreignKeyValue !== null && foreignKeyValue !== undefined) {
        jsonApiRecord.relationships[fieldDef.as] = {
          data: {
            type: fieldDef.belongsTo,
            id: String(foreignKeyValue)
          }
        };
      } else {
        // Explicitly null relationship
        jsonApiRecord.relationships[fieldDef.as] = {
          data: null
        };
      }
    }
  }
  
  // Process polymorphic belongsTo relationships
  Object.entries(relationships || {}).forEach(([relName, relDef]) => {
    if (relDef.belongsToPolymorphic) {
      const typeValue = record[relDef.typeField];
      const idValue = record[relDef.idField];
      
      if (typeValue && idValue) {
        jsonApiRecord.relationships[relName] = {
          data: {
            type: typeValue,
            id: String(idValue)
          }
        };
      } else {
        // Explicitly null relationship
        jsonApiRecord.relationships[relName] = {
          data: null
        };
      }
    }
  });
  
  // Remove relationships object if empty
  if (Object.keys(jsonApiRecord.relationships).length === 0) {
    delete jsonApiRecord.relationships;
  }
  
  return jsonApiRecord;
};

/**
 * Processes belongsTo relationships from JSON:API input to foreign key updates
 * 
 * @param {Object} scope - The scope object containing schema info
 * @param {Object} deps - Dependencies object containing context with inputRecord
 * @returns {Object} Object mapping foreign key fields to their values
 * 
 * @example
 * const scope = api.resources['articles'];
 * const deps = { context: { inputRecord: jsonApiData } };
 * const updates = processBelongsToRelationships(scope, deps);
 * // Converts relationships.author.data.id to { author_id: '123' }
 * // Returns: { author_id: '123', category_id: '456' }
 */
export const processBelongsToRelationships = (scope, deps) => {
  const foreignKeyUpdates = {};
  
  // Extract values from deps
  const { context } = deps;
  const inputRecord = context.inputRecord;
  
  if (!inputRecord.data.relationships) {
    return foreignKeyUpdates;
  }
  
  // Extract schema from scope
  const { 
    vars: { 
      schemaInfo: { schema }
    }
  } = scope;
  
  // Schema might be a Schema object or plain object
  const schemaStructure = getSchemaStructure(schema);
  
  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const relName = fieldDef.as;
      if (inputRecord.data.relationships[relName] !== undefined) {
        const relData = inputRecord.data.relationships[relName];
        foreignKeyUpdates[fieldName] = relData.data?.id || null;
      }
    }
  }
  
  return foreignKeyUpdates;
};