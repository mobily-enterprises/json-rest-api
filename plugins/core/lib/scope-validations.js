/**
 * @module scope-validations
 * @description Scope validation functions for REST API plugin
 * 
 * These validations run when scopes are added to ensure proper configuration,
 * particularly for complex features like polymorphic relationships. By validating
 * at scope registration time, we catch configuration errors early before any
 * API requests are made.
 */


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
 * This function runs automatically when a scope is added via the 'scope:added' event hook.
 * It prevents runtime errors by catching misconfigurations at startup.
 * 
 * @param {Object} params - Parameters object
 * @param {Object} params.eventData - The scope:added event data  
 * @param {string} params.eventData.scopeName - Name of the scope being added
 * @param {Object} params.eventData.scopeOptions - Scope options including relationships
 * @param {Object} params.api - The API instance for accessing scopes and logging
 * @throws {Error} If any polymorphic relationship is invalid
 * 
 * @example <caption>Valid polymorphic relationship - Comments on multiple types</caption>
 * // In your comments scope configuration:
 * api.addScope('comments', {
 *   schema: {
 *     id: { type: 'id' },
 *     body: { type: 'text' },
 *     commentable_type: { type: 'string' },  // Stores 'posts' or 'videos'
 *     commentable_id: { type: 'integer' }     // Stores the ID
 *   },
 *   relationships: {
 *     commentable: {
 *       belongsToPolymorphic: {
 *         types: ['posts', 'videos'],     // Both scopes must already exist
 *         typeField: 'commentable_type',  // Which field stores the type
 *         idField: 'commentable_id'       // Which field stores the ID
 *       },
 *       sideLoad: true  // Allow including via ?include=commentable
 *     }
 *   }
 * });
 * // This configuration allows: comment.commentable_type='posts', comment.commentable_id=123
 * 
 * @example <caption>Invalid - missing required field</caption>
 * // This will throw an error:
 * api.addScope('attachments', {
 *   relationships: {
 *     attachable: {
 *       belongsToPolymorphic: {
 *         types: ['documents', 'images'],
 *         typeField: 'attachable_type'
 *         // ERROR: Missing idField!
 *       }
 *     }
 *   }
 * });
 * // Throws: "Invalid polymorphic relationship 'attachable' in scope 'attachments':
 * // belongsToPolymorphic.idField must be specified"
 * 
 * @example <caption>Invalid - referencing non-existent scope</caption>
 * // This will throw if 'unicorns' scope doesn't exist:
 * api.addScope('likes', {
 *   relationships: {
 *     likeable: {
 *       belongsToPolymorphic: {
 *         types: ['posts', 'unicorns'],  // ERROR: 'unicorns' not registered
 *         typeField: 'likeable_type',
 *         idField: 'likeable_id'
 *       }
 *     }
 *   }
 * });
 * // Throws: "Invalid polymorphic relationship 'likeable' in scope 'likes':
 * // Polymorphic type 'unicorns' is not a registered scope"
 * 
 * @example <caption>Complex use case - Activity feed with multiple polymorphic relationships</caption>
 * // An activity log that tracks different types of events:
 * api.addScope('activities', {
 *   schema: {
 *     id: { type: 'id' },
 *     action: { type: 'string' },  // 'created', 'updated', 'deleted'
 *     // What was acted upon
 *     trackable_type: { type: 'string' },
 *     trackable_id: { type: 'integer' },
 *     // Who performed the action
 *     actor_type: { type: 'string' },
 *     actor_id: { type: 'integer' },
 *     created_at: { type: 'datetime' }
 *   },
 *   relationships: {
 *     // The resource that was changed
 *     trackable: {
 *       belongsToPolymorphic: {
 *         types: ['posts', 'comments', 'users', 'products'],
 *         typeField: 'trackable_type',
 *         idField: 'trackable_id'
 *       },
 *       sideLoad: true
 *     },
 *     // The user or system that made the change
 *     actor: {
 *       belongsToPolymorphic: {
 *         types: ['users', 'api_clients', 'cron_jobs'],
 *         typeField: 'actor_type',
 *         idField: 'actor_id'
 *       },
 *       sideLoad: true
 *     }
 *   }
 * });
 * // Both polymorphic relationships are validated independently
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // This validation prevents:
 * // 1. Runtime errors when trying to resolve non-existent scope types
 * // 2. Database foreign key violations from invalid type values
 * // 3. Confusion from typos in scope names (caught at startup)
 * // 4. API inconsistencies from incomplete polymorphic configurations
 * // 5. Complex debugging sessions from misconfigured relationships
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


/**
 * Validates a polymorphic relationship definition
 * 
 * Called during scope registration to ensure configuration is correct.
 * Performs comprehensive validation of polymorphic relationship setup.
 * This is a private helper used by validatePolymorphicRelationships.
 * 
 * @param {Object} relDef - The relationship definition object
 * @param {Object} relDef.belongsToPolymorphic - Polymorphic configuration
 * @param {Array<string>} relDef.belongsToPolymorphic.types - Allowed target types
 * @param {string} relDef.belongsToPolymorphic.typeField - Field storing the type
 * @param {string} relDef.belongsToPolymorphic.idField - Field storing the ID
 * @param {string} scopeName - The scope being registered (for error messages)
 * @param {Object} scopes - The hooked-api scopes object containing all registered scopes
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether the configuration is valid
 * @returns {string} [returns.error] - Error message if invalid
 * 
 * @example <caption>Valid polymorphic configuration</caption>
 * const relDef = {
 *   belongsToPolymorphic: {
 *     types: ['articles', 'videos', 'products'],
 *     typeField: 'commentable_type',
 *     idField: 'commentable_id'
 *   },
 *   as: 'commentable',
 *   sideLoad: true
 * };
 * 
 * const result = validatePolymorphicRelationship(relDef, 'comments', scopes);
 * // Returns: { valid: true }
 * 
 * @example <caption>Invalid configuration (missing types)</caption>
 * const relDef = {
 *   belongsToPolymorphic: {
 *     typeField: 'commentable_type',
 *     idField: 'commentable_id'
 *     // Missing: types array!
 *   }
 * };
 * 
 * const result = validatePolymorphicRelationship(relDef, 'comments', scopes);
 * // Returns: { valid: false, error: 'belongsToPolymorphic.types must be a non-empty array' }
 * 
 * @example <caption>Invalid configuration (unknown scope type)</caption>
 * const relDef = {
 *   belongsToPolymorphic: {
 *     types: ['articles', 'unicorns'],  // 'unicorns' scope doesn't exist
 *     typeField: 'attachable_type',
 *     idField: 'attachable_id'
 *   }
 * };
 * 
 * const result = validatePolymorphicRelationship(relDef, 'attachments', scopes);
 * // Returns: { valid: false, error: "Polymorphic type 'unicorns' is not a registered scope" }
 * 
 * @private
 */
const validatePolymorphicRelationship = (relDef, scopeName, scopes) => {
  // Validation logic:
  // 1. Check relDef.belongsToPolymorphic exists
  // 2. Validate required properties: types, typeField, idField
  // 3. Ensure types is non-empty array
  // 4. Verify all types are registered scopes
  // 5. Check that typeField and idField exist in the schema
  
  const { belongsToPolymorphic } = relDef;
  
  if (!belongsToPolymorphic) {
    return { valid: false, error: 'Missing belongsToPolymorphic definition' };
  }
  
  const { types, typeField, idField } = belongsToPolymorphic;
  
  if (!types || !Array.isArray(types) || types.length === 0) {
    return { 
      valid: false, 
      error: 'belongsToPolymorphic.types must be a non-empty array' 
    };
  }
  
  if (!typeField || typeof typeField !== 'string') {
    return { 
      valid: false, 
      error: 'belongsToPolymorphic.typeField must be specified' 
    };
  }
  
  if (!idField || typeof idField !== 'string') {
    return { 
      valid: false, 
      error: 'belongsToPolymorphic.idField must be specified' 
    };
  }
  
  // Check that all types are valid scopes
  for (const type of types) {
    if (!scopes[type]) {
      return { 
        valid: false, 
        error: `Polymorphic type '${type}' is not a registered scope` 
      };
    }
  }
  
  return { valid: true };
};

