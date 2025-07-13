/**
 * @module knex-field-helpers
 * @description Field and schema manipulation helpers for Knex operations
 * 
 * This module contains low-level helper functions for working with schema fields,
 * foreign keys, and field selections. These are the most basic building blocks
 * used by other modules in the REST API Knex plugin.
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
 * Builds the field selection list for database queries, handling sparse fieldsets.
 * 
 * This function constructs the SELECT clause fields based on JSON:API sparse fieldsets
 * while ensuring all necessary fields are included for proper relationship handling.
 * It always includes ID and foreign key fields even if not explicitly requested,
 * because these are needed for JSON:API relationship links.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {string|null} requestedFields - Comma-separated list of requested fields or null for all
 * @param {Object} schema - The schema definition
 * @param {Object} scopes - The scopes object from the API
 * @param {Object} vars - Plugin vars containing configuration
 * @returns {Promise<Array<string>|string>} Array of field names to select or '*' for all
 * 
 * @example <caption>Sparse fieldset with automatic foreign key inclusion</caption>
 * const fields = await buildFieldSelection('articles', 'title,body', schema, scopes, vars);
 * // Returns ['id', 'title', 'body', 'author_id', 'category_id']
 * // Note: author_id and category_id included automatically for relationships
 * 
 * @example <caption>No specific fields requested - select all</caption>
 * const fields = await buildFieldSelection('articles', null, schema, scopes, vars);
 * // Returns '*' (select all columns)
 * 
 * @example <caption>Polymorphic relationships included</caption>
 * // For a comments table with polymorphic commentable relationship
 * const fields = await buildFieldSelection('comments', 'text', schema, scopes, vars);
 * // Returns ['id', 'text', 'commentable_type', 'commentable_id']
 * // Polymorphic type and id fields included automatically
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Optimize database queries by selecting only needed fields
 * // 2. Ensure relationship fields are always available for JSON:API links
 * // 3. Support JSON:API sparse fieldsets feature efficiently
 * // 4. Handle both regular and polymorphic foreign keys automatically
 * // 5. Reduce data transfer from database for large tables
 */
export const buildFieldSelection = async (scopeName, requestedFields, schema, scopes, vars) => {
  const idProperty = vars.idProperty || 'id';
  let fieldsToSelect = new Set();
  let computedDependencies = new Set();
  
  // Always include the ID
  fieldsToSelect.add(idProperty);
  
  // Get computed fields to exclude from SQL
  const computedFields = scopes[scopeName]?.vars?.schemaInfo?.computed || {};
  const computedFieldNames = new Set(Object.keys(computedFields));
  
  // Handle both Schema objects and plain objects
  const schemaStructure = schema?.structure || schema || {};
  
  // Parse requested fields
  const requested = requestedFields ? (
    typeof requestedFields === 'string' 
      ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
      : requestedFields
  ) : null;
  
  if (requested && requested.length > 0) {
    // Sparse fieldsets requested
    requested.forEach(field => {
      // Skip computed fields - they don't exist in database
      if (computedFieldNames.has(field)) return;
      
      const fieldDef = schemaStructure[field];
      if (!fieldDef) return;
      
      // NEVER include hidden fields, even if explicitly requested
      if (fieldDef.hidden === true) return;
      
      fieldsToSelect.add(field);
    });
    
    // Handle computed field dependencies
    const requestedComputedFields = requested.filter(f => computedFieldNames.has(f));
    for (const computedField of requestedComputedFields) {
      const fieldDef = computedFields[computedField];
      if (fieldDef.dependencies) {
        for (const dep of fieldDef.dependencies) {
          const depFieldDef = schemaStructure[dep];
          if (depFieldDef && depFieldDef.hidden !== true) {
            fieldsToSelect.add(dep);
            // Track if this dependency wasn't explicitly requested
            if (!requested.includes(dep)) {
              computedDependencies.add(dep);
            }
          }
        }
      }
    }
    
    // Still handle normallyHidden fields for backward compatibility
    if (requestedComputedFields.length > 0) {
      Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
        if (fieldDef.normallyHidden === true && fieldDef.hidden !== true) {
          // Only add if not already handled by dependencies
          if (!fieldsToSelect.has(field)) {
            fieldsToSelect.add(field);
            if (!requested.includes(field)) {
              computedDependencies.add(field);
            }
          }
        }
      });
    }
  } else {
    // No sparse fieldsets - return all non-hidden database fields
    Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
      // Skip hidden fields
      if (fieldDef.hidden === true) return;
      
      // Skip normallyHidden fields
      if (fieldDef.normallyHidden === true) return;
      
      fieldsToSelect.add(field);
    });
  }
  
  // Always include foreign keys for relationships (unless hidden)
  Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
    if (fieldDef.belongsTo && fieldDef.hidden !== true) {
      fieldsToSelect.add(field);
    }
  });
  
  // Always include polymorphic type and id fields from relationships
  if (scopes && scopes[scopeName]) {
    try {
      const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
      Object.entries(relationships || {}).forEach(([relName, relDef]) => {
        if (relDef.belongsToPolymorphic) {
          if (relDef.typeField) fieldsToSelect.add(relDef.typeField);
          if (relDef.idField) fieldsToSelect.add(relDef.idField);
        }
      });
    } catch (e) {
      // Scope might not have relationships
    }
  }
  
  // Return detailed information about field selection
  return {
    fieldsToSelect: Array.from(fieldsToSelect),
    requestedFields: requested,
    computedDependencies: Array.from(computedDependencies)
  };
};

/**
 * Gets the list of requested computed fields based on sparse fieldsets.
 * 
 * @param {string} scopeName - The name of the scope/resource
 * @param {Array<string>|string} requestedFields - Array or comma-separated string of requested fields
 * @param {Object} computedFields - Object containing computed field definitions
 * @returns {Array<string>} Array of computed field names to calculate
 */
export const getRequestedComputedFields = (scopeName, requestedFields, computedFields) => {
  if (!computedFields) return [];
  
  const allComputedFields = Object.keys(computedFields);
  
  if (!requestedFields || requestedFields.length === 0) {
    // No sparse fieldsets - return all computed fields
    return allComputedFields;
  }
  
  // Parse requested fields if it's a string
  const requested = typeof requestedFields === 'string'
    ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
    : requestedFields;
  
  // Return only requested computed fields that exist
  return requested.filter(field => allComputedFields.includes(field));
};

/**
 * Filters hidden fields from attributes based on schema rules.
 * 
 * @param {Object} attributes - The attributes object to filter
 * @param {Object} schema - The schema object with structure property
 * @param {Array<string>|string} requestedFields - Fields explicitly requested (for normallyHidden)
 * @returns {Object} Filtered attributes object
 */
export const filterHiddenFields = (attributes, schema, requestedFields) => {
  const filtered = {};
  
  // Parse requested fields if it's a string
  const requested = requestedFields ? (
    typeof requestedFields === 'string'
      ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
      : requestedFields
  ) : null;
  
  Object.entries(attributes).forEach(([field, value]) => {
    const fieldDef = schema.structure?.[field];
    
    // Never include hidden fields
    if (fieldDef?.hidden === true) return;
    
    // Include normallyHidden fields only if explicitly requested
    if (fieldDef?.normallyHidden === true) {
      if (!requested || !requested.includes(field)) {
        return;
      }
    }
    
    filtered[field] = value;
  });
  
  return filtered;
};