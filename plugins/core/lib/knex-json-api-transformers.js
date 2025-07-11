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

/**
 * Converts a database record to JSON:API format.
 * 
 * This function transforms a flat database record into the hierarchical JSON:API
 * structure, separating regular attributes from foreign keys. Foreign key fields
 * are filtered out of attributes because they're represented as relationships
 * in JSON:API format. This maintains the clean separation between data and
 * relationships that JSON:API requires.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {Object} record - The database record
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
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
export const toJsonApiRecord = (scopeName, record, schema, scopes, vars) => {
  const idProperty = vars.idProperty || 'id';
  
  // Build polymorphic fields set
  const polymorphicFields = new Set();
  try {
    const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        if (relDef.typeField) polymorphicFields.add(relDef.typeField);
        if (relDef.idField) polymorphicFields.add(relDef.idField);
      }
    });
  } catch (e) {
    // Scope might not have relationships
  }
  
  return toJsonApi(scopeName, record, schema, idProperty, polymorphicFields);
};

/**
 * Builds the final JSON:API response with data and optional included resources
 * @param {Array<Object>} records - The primary records
 * @param {string} scopeName - The scope name
 * @param {Object} schema - The schema definition
 * @param {Array<Object>} included - Optional included resources
 * @param {boolean} isSingle - Whether this is a single resource response
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars
 * @returns {Promise<Object>} Complete JSON:API response object
 * 
 * @example
 * const response = await buildJsonApiResponse([article], 'articles', schema, [author], true, scopes, vars);
 * // Returns { data: { type: 'articles', id: '1', ... }, included: [...] }
 */
export const buildJsonApiResponse = async (records, scopeName, schema, included = [], isSingle = false, scopes, vars) => {
  // Get relationships configuration
  const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema?.structure || schema || {};
  
  // Process records to JSON:API format
  const processedRecords = records.map(record => {
    const { _relationships, ...cleanRecord } = record;
    const jsonApiRecord = toJsonApiRecord(scopeName, cleanRecord, schema, scopes, vars);
    
    // Add any loaded relationships
    if (_relationships) {
      jsonApiRecord.relationships = _relationships;
    }
    
    // Add regular belongsTo relationships (only if not already loaded)
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.belongsTo && fieldDef.as && cleanRecord[fieldName]) {
        jsonApiRecord.relationships = jsonApiRecord.relationships || {};
        if (!jsonApiRecord.relationships[fieldDef.as]) {
          jsonApiRecord.relationships[fieldDef.as] = {
            data: {
              type: fieldDef.belongsTo,
              id: String(cleanRecord[fieldName])
            }
          };
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
          jsonApiRecord.relationships[relName] = {
            data: {
              type: typeValue,
              id: String(idValue)
            }
          };
        } else if (typeValue === null || idValue === null) {
          // Explicitly null relationship
          jsonApiRecord.relationships = jsonApiRecord.relationships || {};
          jsonApiRecord.relationships[relName] = {
            data: null
          };
        }
      }
    });
    
    return jsonApiRecord;
  });
  
  const response = {
    data: isSingle ? processedRecords[0] : processedRecords
  };
  
  if (included.length > 0) {
    response.included = included;
  }
  
  return response;
};

/**
 * Processes belongsTo relationships from JSON:API input to foreign key updates
 * @param {Object} inputRecord - The JSON:API input record
 * @param {Object} schema - The schema definition
 * @returns {Object} Object mapping foreign key fields to their values
 * 
 * @example
 * const updates = processBelongsToRelationships(inputRecord, schema);
 * // Converts relationships.author.data.id to { author_id: '123' }
 */
export const processBelongsToRelationships = (inputRecord, schema) => {
  const foreignKeyUpdates = {};
  
  if (!inputRecord.data.relationships) {
    return foreignKeyUpdates;
  }
  
  // Schema might be a Schema object or plain object
  const schemaStructure = schema.structure || schema;
  
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