import { getForeignKeyFields } from './knex-field-helpers.js';

/**
 * Converts a database record to JSON:API format
 * Filters out foreign keys and optionally polymorphic fields
 */
export const toJsonApi = (scopeName, record, schema, idProperty = 'id', polymorphicFields = new Set()) => {
  if (!record) return null;
  
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