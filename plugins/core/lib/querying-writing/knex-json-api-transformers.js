import { toJsonApiRecord } from '../querying/knex-json-api-transformers-querying.js';
import { getSchemaStructure } from './knex-constants.js';

/**
 * Converts database record to JSON:API format with belongsTo relationships
 * 
 * @param {Object} scope - Resource scope with schema and relationship info
 * @param {Object} record - Raw database record
 * @param {string} scopeName - Resource type name
 * @returns {Object} JSON:API resource with belongsTo relationships
 * 
 * @example
 * // Input: Database record with foreign keys
 * const dbRecord = {
 *   id: 1,
 *   title: 'Hello World',
 *   author_id: 2,
 *   publisher_id: 3,
 *   category_id: null
 * };
 * const result = toJsonApiRecordWithBelongsTo(scope, dbRecord, 'articles');
 * 
 * // Output: JSON:API with relationship objects
 * // {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: {
 * //     title: 'Hello World'
 * //     // Note: author_id, publisher_id, category_id removed
 * //   },
 * //   relationships: {
 * //     author: {
 * //       data: { type: 'authors', id: '2' }
 * //     },
 * //     publisher: {
 * //       data: { type: 'publishers', id: '3' }
 * //     },
 * //     category: {
 * //       data: null  // Explicit null for empty relationship
 * //     }
 * //   }
 * // }
 * 
 * @example
 * // Input: Polymorphic relationships
 * const dbRecord = {
 *   id: 5,
 *   content: 'Great post!',
 *   commentable_type: 'articles',
 *   commentable_id: 10
 * };
 * // With schema defining polymorphic relationship:
 * // relationships: {
 * //   commentable: {
 * //     belongsToPolymorphic: true,
 * //     typeField: 'commentable_type',
 * //     idField: 'commentable_id'
 * //   }
 * // }
 * 
 * // Output: Polymorphic relationship in JSON:API
 * // {
 * //   type: 'comments',
 * //   id: '5',
 * //   attributes: { content: 'Great post!' },
 * //   relationships: {
 * //     commentable: {
 * //       data: { type: 'articles', id: '10' }
 * //     }
 * //   }
 * // }
 * 
 * @description
 * Used by:
 * - dataGetMinimal for lightweight single record fetches
 * - dataDelete to return deleted record structure
 * - Internal operations needing quick JSON:API conversion
 * 
 * Purpose:
 * - Provides JSON:API structure without loading related data
 * - Transforms foreign keys into relationship objects
 * - Handles both regular and polymorphic belongsTo
 * - Maintains explicit nulls for empty relationships
 * 
 * Data flow:
 * 1. Calls toJsonApiRecord for basic transformation
 * 2. Scans schema for belongsTo field definitions
 * 3. Converts foreign key values to relationship objects
 * 4. Processes polymorphic relationships separately
 * 5. Returns complete JSON:API resource object
 */
export const toJsonApiRecordWithBelongsTo = (scope, record, scopeName) => {
  if (!record) return null;
  
  // Get the basic JSON:API structure (without relationships)
  const jsonApiRecord = toJsonApiRecord(scope, record, scopeName);
  
  // Extract schema info from scope
  const { 
    vars: { 
      schemaInfo: { instance: schemaInstance, schemaRelationships: relationships, idProperty }
    }
  } = scope;
  
  const idField = idProperty || 'id';
  
  // Get schema structure
  const schemaStructure = getSchemaStructure(schemaInstance);
  
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