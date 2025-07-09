/**
 * Scope validation functions for REST API plugin
 * These validations run when scopes are added to ensure proper configuration
 */

import { createPolymorphicHelpers } from './polymorphic-helpers.js';

/**
 * Validates that all belongsTo relationship fields have an explicit type defined in the schema.
 * 
 * This validation is crucial for data integrity because belongsTo fields are foreign keys
 * that reference other resources. Without a type definition, the REST API cannot:
 * 1. Validate that the foreign key value is the correct data type
 * 2. Perform type coercion when needed
 * 3. Generate proper error messages for type mismatches
 * 
 * This function runs automatically when a scope is added (via the 'scope:added' event)
 * and throws an error immediately if any belongsTo field is missing its type, preventing
 * the scope from being registered with an invalid schema.
 * 
 * @param {Object} params - Event parameters object
 * @param {Object} params.eventData - The scope:added event data
 * @param {string} params.eventData.scopeName - Name of the scope being added
 * @param {Object} params.eventData.scopeOptions - Options for the scope including schema
 * @throws {Error} If any belongsTo field is missing a type definition
 * 
 * @example
 * // This schema will PASS validation:
 * const validSchema = {
 *   title: { type: 'string' },
 *   author_id: { 
 *     type: 'number',  // ✓ Has type
 *     belongsTo: 'users',
 *     as: 'author'
 *   },
 *   category_id: {
 *     type: 'integer', // ✓ Has type
 *     belongsTo: 'categories',
 *     as: 'category'
 *   }
 * };
 * 
 * @example
 * // This schema will FAIL validation:
 * const invalidSchema = {
 *   title: { type: 'string' },
 *   author_id: { 
 *     // ✗ Missing type!
 *     belongsTo: 'users',
 *     as: 'author'
 *   }
 * };
 * // Throws: "Schema error in 'articles': Field 'author_id' has belongsTo but no type.
 * // All belongsTo fields must have an explicit type for validation.
 * // Example: author_id: { type: 'number', belongsTo: 'users', as: 'author' }"
 * 
 * @example
 * // Common types for foreign keys:
 * const schema = {
 *   // Numeric ID (most common)
 *   user_id: { type: 'number', belongsTo: 'users', as: 'user' },
 *   
 *   // String UUID
 *   organization_id: { type: 'string', belongsTo: 'organizations', as: 'organization' },
 *   
 *   // Integer ID (for strict integer databases)
 *   product_id: { type: 'integer', belongsTo: 'products', as: 'product' }
 * };
 * 
 * @example
 * // Why this validation matters - without types:
 * // 1. String '123' might not match numeric ID 123
 * // 2. Validation can't catch invalid IDs like 'abc' for numeric fields
 * // 3. Storage plugins can't optimize queries based on data types
 */
export function validateBelongsToTypes({ eventData }) {
  const { scopeName, scopeOptions } = eventData;
  const schema = scopeOptions.schema || {};
  
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef.belongsTo && !fieldDef.type) {
      throw new Error(
        `Schema error in '${scopeName}': Field '${fieldName}' has belongsTo ` +
        `but no type. All belongsTo fields must have an explicit type for validation. ` +
        `Example: ${fieldName}: { type: 'number', belongsTo: '${fieldDef.belongsTo}', as: '${fieldDef.as || fieldName}' }`
      );
    }
  }
}

/**
 * Validates polymorphic relationships in scope configuration to ensure they are properly defined.
 * 
 * Polymorphic relationships allow a single foreign key to reference multiple different types
 * of resources. For example, a 'comments' table might have commentable_type and commentable_id
 * fields that can reference either 'posts' or 'videos'. This validation ensures:
 * 
 * 1. All required fields (types, typeField, idField) are defined
 * 2. The referenced types actually exist as registered scopes
 * 3. The configuration follows the expected structure
 * 
 * This function runs automatically when a scope is added and uses the polymorphicHelpers
 * to perform detailed validation of each polymorphic relationship definition.
 * 
 * @param {Object} params - Parameters object
 * @param {Object} params.eventData - The scope:added event data  
 * @param {string} params.eventData.scopeName - Name of the scope being added
 * @param {Object} params.eventData.scopeOptions - Scope options including relationships
 * @param {Object} params.api - The API instance for accessing scopes and logging
 * @throws {Error} If any polymorphic relationship is invalid
 * 
 * @example
 * // Valid polymorphic relationship configuration:
 * const relationships = {
 *   commentable: {
 *     belongsToPolymorphic: {
 *       types: ['posts', 'videos'],     // Both types must exist as scopes
 *       typeField: 'commentable_type',  // Field storing the type
 *       idField: 'commentable_id'       // Field storing the ID
 *     }
 *   }
 * };
 * // This will pass validation if 'posts' and 'videos' scopes exist
 * 
 * @example
 * // Invalid configuration - missing required field:
 * const relationships = {
 *   attachable: {
 *     belongsToPolymorphic: {
 *       types: ['documents', 'images'],
 *       typeField: 'attachable_type'
 *       // Missing idField!
 *     }
 *   }
 * };
 * // Throws: "Invalid polymorphic relationship 'attachable' in scope 'attachments':
 * // Missing required field: idField"
 * 
 * @example  
 * // Invalid configuration - referencing non-existent type:
 * const relationships = {
 *   taggable: {
 *     belongsToPolymorphic: {
 *       types: ['posts', 'nonexistent'],  // 'nonexistent' scope not registered
 *       typeField: 'taggable_type',
 *       idField: 'taggable_id'
 *     }
 *   }
 * };
 * // Throws: "Invalid polymorphic relationship 'taggable' in scope 'tags':
 * // Type 'nonexistent' does not exist as a scope"
 * 
 * @example
 * // Complex example with multiple polymorphic relationships:
 * const relationships = {
 *   // A notification can be about different things
 *   notifiable: {
 *     belongsToPolymorphic: {
 *       types: ['users', 'posts', 'comments'],
 *       typeField: 'notifiable_type',
 *       idField: 'notifiable_id'
 *     }
 *   },
 *   // And triggered by different actors
 *   actor: {
 *     belongsToPolymorphic: {
 *       types: ['users', 'systems'],  // Users or automated systems
 *       typeField: 'actor_type',
 *       idField: 'actor_id'
 *     }
 *   }
 * };
 * // Both relationships will be validated independently
 */
export function validatePolymorphicRelationships({ eventData, api }) {
  const { scopeName, scopeOptions } = eventData;
  const relationships = scopeOptions.relationships || {};
  
  // Create polymorphic helpers with access to scopes and logger
  const polymorphicHelpers = createPolymorphicHelpers(api.scopes, api.log);
  
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.belongsToPolymorphic) {
      const validation = polymorphicHelpers.validatePolymorphicRelationship(relDef, scopeName);
      if (!validation.valid) {
        throw new Error(
          `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
  }
}