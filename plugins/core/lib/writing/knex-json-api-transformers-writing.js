import { getSchemaStructure } from '../querying-writing/knex-constants.js'

/**
 * Processes belongsTo relationships from JSON:API input to foreign key updates
 *
 * @param {Object} scope - The scope object containing schema info
 * @param {Object} deps - Dependencies object containing context with inputRecord
 * @returns {Object} Object mapping foreign key fields to their values
 *
 * @example
 * // Input: JSON:API document with relationships
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     attributes: { title: 'My Article' },
 *     relationships: {
 *       author: {
 *         data: { type: 'users', id: '123' }
 *       },
 *       category: {
 *         data: { type: 'categories', id: '456' }
 *       }
 *     }
 *   }
 * };
 *
 * // Schema has: author_id field with belongsTo: 'users', as: 'author'
 * // Schema has: category_id field with belongsTo: 'categories', as: 'category'
 *
 * const updates = processBelongsToRelationships(scope, { context: { inputRecord } });
 *
 * // Output: Foreign key values extracted
 * // {
 * //   author_id: '123',
 * //   category_id: '456'
 * // }
 *
 * @example
 * // Input: Removing a relationship (setting to null)
 * const inputRecord = {
 *   data: {
 *     type: 'articles',
 *     id: '1',
 *     relationships: {
 *       author: {
 *         data: null  // Remove author
 *       }
 *     }
 *   }
 * };
 *
 * const updates = processBelongsToRelationships(scope, { context: { inputRecord } });
 *
 * // Output: Foreign key set to null
 * // {
 * //   author_id: null
 * // }
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataPut and dataPatch methods
 * - Called before saving to extract foreign keys from JSON:API relationships
 * - Works in conjunction with relationship-processor for complete handling
 *
 * Purpose:
 * - Converts JSON:API relationship format to database foreign keys
 * - Maps from relationship names (e.g., 'author') to field names (e.g., 'author_id')
 * - Handles both setting relationships (with id) and removing them (null)
 * - Only processes belongsTo relationships, not hasMany
 *
 * Data flow:
 * 1. Receives JSON:API document with relationships section
 * 2. Looks up schema to find foreign key fields
 * 3. For each belongsTo field, checks if relationship exists in input
 * 4. Extracts id from relationship data or sets null
 * 5. Returns object ready to merge with attributes for database update
 */
export const processBelongsToRelationships = (scope, deps) => {
  const foreignKeyUpdates = {}

  // Extract values from deps
  const { context } = deps
  const inputRecord = context.inputRecord

  if (!inputRecord.data.relationships) {
    return foreignKeyUpdates
  }

  // Extract schema from scope
  const {
    vars: {
      schemaInfo: { schema }
    }
  } = scope

  // Schema might be a Schema object or plain object
  const schemaStructure = getSchemaStructure(schema)

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (fieldDef.belongsTo && fieldDef.as) {
      const relName = fieldDef.as
      if (inputRecord.data.relationships[relName] !== undefined) {
        const relData = inputRecord.data.relationships[relName]
        foreignKeyUpdates[fieldName] = relData.data?.id || null
      }
    }
  }

  return foreignKeyUpdates
}
