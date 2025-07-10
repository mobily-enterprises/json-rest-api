/**
 * Scope validation functions for REST API plugin
 * These validations run when scopes are added to ensure proper configuration
 */

import { validatePolymorphicRelationship } from './polymorphic-helpers.js';


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
  
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.belongsToPolymorphic) {
      const validation = validatePolymorphicRelationship(relDef, scopeName, api.scopes);
      if (!validation.valid) {
        throw new Error(
          `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
  }
}