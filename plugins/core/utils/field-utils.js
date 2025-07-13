/**
 * @module field-utils
 * @description Pure utility functions for field and schema manipulation
 * 
 * This module contains pure functions extracted from knex-field-helpers.js
 * that don't require scope context or dependencies. These functions can be
 * used independently for schema inspection and field filtering.
 */

/**
 * Extracts all foreign key fields from a schema definition.
 * 
 * This function identifies fields that represent foreign keys based on belongsTo
 * relationships in the schema. These fields need special handling because they're
 * stored in the database but not exposed as attributes in JSON:API responses.
 * Instead, they're represented as relationships.
 * 
 * @param {Object} schema - The schema definition (can be Schema object or plain object)
 * @returns {Set<string>} Set of foreign key field names
 * 
 * @example <caption>Basic foreign key extraction</caption>
 * const schema = {
 *   title: { type: 'string' },
 *   author_id: { type: 'number', belongsTo: 'users', as: 'author' },
 *   category_id: { type: 'number', belongsTo: 'categories', as: 'category' }
 * };
 * const foreignKeys = getForeignKeyFields(schema);
 * // Returns Set(['author_id', 'category_id'])
 * 
 * @example <caption>Schema object vs plain object</caption>
 * // Works with both compiled Schema objects and plain schema definitions
 * const schemaObject = createSchema(schema);
 * const foreignKeys1 = getForeignKeyFields(schemaObject); // Schema object
 * const foreignKeys2 = getForeignKeyFields(schema);       // Plain object
 * // Both return the same Set
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Filter out foreign keys when building JSON:API attributes
 * // 2. Include foreign keys in SELECT even with sparse fieldsets
 * // 3. Identify which fields need relationship transformation
 * // 4. Optimize queries by knowing which fields are joins
 */
export const getForeignKeyFields = (schema) => {
  const foreignKeys = new Set();
  if (!schema) return foreignKeys;
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema.structure || schema;
  
  Object.entries(schemaStructure).forEach(([field, def]) => {
    if (def.belongsTo) {
      foreignKeys.add(field);
    }
  });
  return foreignKeys;
};

/**
 * Filters hidden fields from attributes based on schema rules.
 * 
 * This pure function removes fields marked as hidden or normallyHidden
 * based on the schema definition and requested fields. It ensures that
 * sensitive data is never exposed in API responses.
 * 
 * @param {Object} attributes - The attributes object to filter
 * @param {Object} schema - The schema object with structure property
 * @param {Array<string>|string} requestedFields - Fields explicitly requested (for normallyHidden)
 * @returns {Object} Filtered attributes object
 * 
 * @example <caption>Filtering hidden fields</caption>
 * const attributes = {
 *   name: 'John',
 *   email: 'john@example.com',
 *   password_hash: 'xxx',
 *   internal_id: '123'
 * };
 * const schema = {
 *   structure: {
 *     name: { type: 'string' },
 *     email: { type: 'string' },
 *     password_hash: { type: 'string', hidden: true },
 *     internal_id: { type: 'string', normallyHidden: true }
 *   }
 * };
 * const filtered = filterHiddenFields(attributes, schema, null);
 * // Returns: { name: 'John', email: 'john@example.com' }
 * // password_hash (hidden) and internal_id (normallyHidden) are removed
 * 
 * @example <caption>Including normallyHidden fields when requested</caption>
 * const filtered = filterHiddenFields(attributes, schema, 'name,internal_id');
 * // Returns: { name: 'John', internal_id: '123' }
 * // internal_id is included because explicitly requested
 * // password_hash is still filtered (always hidden)
 */
export const filterHiddenFields = (attributes, schema, requestedFields) => {
  const filtered = {};
  
  // Parse requested fields if it's a string (from query params)
  // Example: "name,price,cost" -> ['name', 'price', 'cost']
  const requested = requestedFields ? (
    typeof requestedFields === 'string'
      ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
      : requestedFields
  ) : null;
  
  Object.entries(attributes).forEach(([field, value]) => {
    const fieldDef = schema.structure?.[field];
    
    // Never include hidden fields - these are completely invisible
    // Example: password_hash with hidden:true is always filtered out
    if (fieldDef?.hidden === true) return;
    
    // Include normallyHidden fields only if explicitly requested
    // Example: 'cost' with normallyHidden:true is only included if user requests it
    // via sparse fieldsets like ?fields[products]=name,cost
    if (fieldDef?.normallyHidden === true) {
      if (!requested || !requested.includes(field)) {
        return; // Filter out normallyHidden field
      }
    }
    
    filtered[field] = value;
  });
  
  return filtered;
};