/**
 * Extracts all foreign key fields from a schema definition
 *
 * @param {Object} schema - The schema definition (Schema object or plain object)
 * @returns {Set<string>} Set of foreign key field names
 *
 * @example
 * // Input: Schema with belongsTo relationships
 * const schema = {
 *   title: { type: 'string' },
 *   content: { type: 'string' },
 *   author_id: { type: 'number', belongsTo: 'users', as: 'author' },
 *   category_id: { type: 'number', belongsTo: 'categories', as: 'category' },
 *   status: { type: 'string' }
 * };
 *
 * const foreignKeys = getForeignKeyFields(schema);
 *
 * // Output: Set containing only foreign key fields
 * // Set(['author_id', 'category_id'])
 *
 * @example
 * // Input: Works with compiled Schema objects too
 * const schemaObject = {
 *   structure: {
 *     post_id: { type: 'id', belongsTo: 'posts', as: 'post' },
 *     user_id: { type: 'id', belongsTo: 'users', as: 'user' }
 *   }
 * };
 *
 * const foreignKeys = getForeignKeyFields(schemaObject);
 *
 * // Output: Handles both formats
 * // Set(['post_id', 'user_id'])
 *
 * @description
 * Used by:
 * - toJsonApi to filter foreign keys from attributes
 * - buildFieldSelection to ensure foreign keys are always selected
 * - knex-json-api-helpers for field filtering
 *
 * Purpose:
 * - Identifies fields that should be relationships, not attributes
 * - Foreign keys are stored in DB but not exposed as JSON:API attributes
 * - Ensures these fields are included in SELECT for relationship building
 * - Helps transform database structure to JSON:API format
 *
 * Data flow:
 * 1. Accepts schema in either format (plain or with structure property)
 * 2. Iterates through all field definitions
 * 3. Collects fields with belongsTo property
 * 4. Returns Set for efficient lookups
 */
export const getForeignKeyFields = (schema) => {
  const foreignKeys = new Set()
  if (!schema) return foreignKeys

  // Handle both Schema objects and plain objects
  const schemaStructure = schema.structure || schema

  Object.entries(schemaStructure).forEach(([field, def]) => {
    if (def.belongsTo) {
      foreignKeys.add(field)
    }
  })
  return foreignKeys
}

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
  const filtered = {}

  // Parse requested fields if it's a string (from query params)
  // Example: "name,price,cost" -> ['name', 'price', 'cost']
  const requested = requestedFields
    ? (
        typeof requestedFields === 'string'
          ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
          : requestedFields
      )
    : null

  Object.entries(attributes).forEach(([field, value]) => {
    const fieldDef = schema.structure?.[field]

    // Never include hidden fields - these are completely invisible
    // Example: password_hash with hidden:true is always filtered out
    if (fieldDef?.hidden === true) return

    // Include normallyHidden fields only if explicitly requested
    // Example: 'cost' with normallyHidden:true is only included if user requests it
    // via sparse fieldsets like ?fields[products]=name,cost
    if (fieldDef?.normallyHidden === true) {
      if (!requested || !requested.includes(field)) {
        return // Filter out normallyHidden field
      }
    }

    filtered[field] = value
  })

  return filtered
}
