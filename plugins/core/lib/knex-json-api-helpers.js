/**
 * @module knex-json-api-helpers
 * @description JSON:API transformation helpers for database records
 * 
 * This module provides functions to transform database records into
 * JSON:API format, filtering out foreign keys and internal fields.
 */

import { getForeignKeyFields } from '../utils/field-utils.js';

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
  
  const { [idProperty]: id, ...allAttributes } = record;
  
  // Get foreign keys to filter out
  const foreignKeys = schema ? getForeignKeyFields(schema) : new Set();
  
  // Build attributes excluding foreign keys and polymorphic fields
  const attributes = {};
  Object.entries(allAttributes).forEach(([key, value]) => {
    if (!foreignKeys.has(key) && !polymorphicFields.has(key)) {
      attributes[key] = value;
    }
  });
  
  return {
    type: scopeName,
    id: String(id),
    attributes
  };
};