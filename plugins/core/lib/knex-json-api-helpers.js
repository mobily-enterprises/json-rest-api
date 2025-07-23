/**
 * @module knex-json-api-helpers
 * @description JSON:API transformation helpers for database records
 * 
 * This module provides functions to transform database records into
 * JSON:API format, filtering out foreign keys and internal fields.
 */

import { getForeignKeyFields } from '../utils/field-utils.js';
import { RELATIONSHIPS_KEY, RELATIONSHIP_METADATA_KEY, ROW_NUMBER_KEY } from '../utils/knex-constants.js';

/**
 * Converts a database record to JSON:API format
 * 
 * This function transforms a flat database record into JSON:API structure,
 * filtering out foreign keys and polymorphic fields from attributes.
 * Foreign keys are represented as relationships, not attributes in JSON:API.
 * 
 * @param {Object} scope - The scope object containing schema info
 * @param {Object} record - The database record to transform
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.context - Request context containing scopeName and polymorphicFields
 * @returns {Object|null} JSON:API formatted resource object or null if no record
 * 
 * @example
 * const scope = api.resources['articles'];
 * const record = { id: 1, title: 'Hello', author_id: 2 };
 * const deps = {
 *   context: {
 *     scopeName: 'articles',
 *     schemaInfo: { idProperty: 'id' },
 *     polymorphicFields: new Set()
 *   }
 * };
 * const jsonApiRecord = toJsonApi(scope, record, deps);
 * // Returns: {
 * //   type: 'articles',
 * //   id: '1',
 * //   attributes: { title: 'Hello' }
 * //   // Note: author_id is filtered out as it's a foreign key
 * // }
 */
export const toJsonApi = (scope, record, deps) => {
  if (!record) return null;
  
  // Extract values from scope
  const { 
    vars: { 
      schemaInfo: { schema }
    }
  } = scope;
  
  // Extract values from deps
  const { context } = deps;
  const scopeName = context.scopeName;
  const idProperty = context.schemaInfo?.idProperty || 'id';
  const polymorphicFields = context.polymorphicFields || new Set();
  
  // With aliasing approach, the record always has 'id' (even if DB column is different)
  const { id, ...allAttributes } = record;
  
  // Get foreign keys to filter out
  const foreignKeys = schema ? getForeignKeyFields(schema) : new Set();
  
  // Define internal fields that should never appear in attributes
  const internalFields = new Set([
    RELATIONSHIPS_KEY,        // '__$jsonrestapi_relationships$__'
    RELATIONSHIP_METADATA_KEY, // '__$jsonrestapi_metadata$__'
    ROW_NUMBER_KEY            // '__$jsonrestapi_rn$__'
  ]);
  
  // Build attributes excluding foreign keys, polymorphic fields, internal fields, and custom idProperty
  const attributes = {};
  Object.entries(allAttributes).forEach(([key, value]) => {
    // Also exclude the custom idProperty field (e.g., 'country_id' for countries table)
    if (!foreignKeys.has(key) && !polymorphicFields.has(key) && !internalFields.has(key) && key !== idProperty) {
      attributes[key] = value;
    }
  });
  
  return {
    type: scopeName,
    id: String(id),
    attributes
  };
};