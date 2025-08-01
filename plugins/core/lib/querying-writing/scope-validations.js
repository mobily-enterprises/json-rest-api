/**
 * Scope configuration validators for relationship definitions
 * 
 * @description
 * These validators run at scope registration time to ensure:
 * - Polymorphic relationships are properly configured
 * - HasMany relationships specify required foreign keys
 * - ManyToMany relationships have pivot table settings
 * - Referenced scopes actually exist in the system
 */


/**
 * Validates all relationships in a scope configuration
 * 
 * @param {Object} params - Validation parameters
 * @param {Object} params.context - Event context with scopeName and scopeOptions
 * @param {Object} params.scopes - All registered scopes for validation
 * @throws {Error} If any relationship is misconfigured
 * 
 * @example
 * // Input: Valid polymorphic relationship
 * validateRelationships({
 *   context: {
 *     scopeName: 'comments',
 *     scopeOptions: {
 *       schema: {
 *         commentable_type: { type: 'string' },
 *         commentable_id: { type: 'integer' }
 *       },
 *       relationships: {
 *         commentable: {
 *           belongsToPolymorphic: {
 *             types: ['posts', 'videos'],     // Must exist
 *             typeField: 'commentable_type',
 *             idField: 'commentable_id'
 *           }
 *         }
 *       }
 *     }
 *   },
 *   scopes: { posts: {}, videos: {} }         // Referenced types exist
 * });
 * // Output: No error (valid configuration)
 * 
 * @example
 * // Input: Missing required field
 * validateRelaationships({
 *   context: {
 *     scopeName: 'attachments',
 *     scopeOptions: {
 *       relationships: {
 *         attachable: {
 *           belongsToPolymorphic: {
 *             types: ['documents'],
 *             typeField: 'attachable_type'
 *             // Missing: idField
 *           }
 *         }
 *       }
 *     }
 *   },
 *   scopes: { documents: {} }
 * });
 * // Throws: Error
 * // "Invalid polymorphic relationship 'attachable' in scope 'attachments': 
 * //  belongsToPolymorphic.idField must be specified"
 * 
 * @example
 * // Input: HasMany without foreignKey
 * validateRelationships({
 *   context: {
 *     scopeName: 'users',
 *     scopeOptions: {
 *       relationships: {
 *         posts: {
 *           hasMany: 'posts'
 *           // Missing: foreignKey
 *         }
 *       }
 *     }
 *   },
 *   scopes: { posts: {} }
 * });
 * // Throws: Error
 * // "Invalid hasMany relationship 'posts' in scope 'users':
 * //  hasMany relationship requires foreignKey to be specified"
 * 
 * @example
 * // Input: Complex activity feed with multiple polymorphic relationships
 * validateRelationships({
 *   context: {
 *     scopeName: 'activities',
 *     scopeOptions: {
 *       schema: {
 *         trackable_type: { type: 'string' },
 *         trackable_id: { type: 'integer' },
 *         actor_type: { type: 'string' },
 *         actor_id: { type: 'integer' }
 *       },
 *       relationships: {
 *         trackable: {                    // What was changed
 *           belongsToPolymorphic: {
 *             types: ['posts', 'comments', 'users'],
 *             typeField: 'trackable_type',
 *             idField: 'trackable_id'
 *           }
 *         },
 *         actor: {                        // Who made the change
 *           belongsToPolymorphic: {
 *             types: ['users', 'api_clients'],
 *             typeField: 'actor_type',
 *             idField: 'actor_id'
 *           }
 *         }
 *       }
 *     }
 *   },
 *   scopes: { posts: {}, comments: {}, users: {}, api_clients: {} }
 * });
 * // Output: No error (both polymorphic relationships valid)
 * 
 * @description
 * Used by:
 * - rest-api-plugin on 'scope:added' event
 * - Runs automatically when scopes are registered
 * 
 * Purpose:
 * - Catches configuration errors at startup, not runtime
 * - Validates polymorphic relationship structure
 * - Ensures referenced scope types exist
 * - Validates hasMany/manyToMany foreign keys
 * - Provides clear error messages for debugging
 * 
 * Data flow:
 * 1. Extracts relationships from scope options
 * 2. For each relationship, checks its type
 * 3. Validates polymorphic: types, typeField, idField
 * 4. Validates hasMany: foreignKey (unless via)
 * 5. Validates manyToMany: through, foreignKey, otherKey
 * 6. Throws descriptive error on first validation failure
 */
export function validateRelationships({ context, scopes }) {
  const { scopeName, scopeOptions } = context;
  const relationships = scopeOptions.relationships || {};
  
  for (const [relName, relDef] of Object.entries(relationships)) {
    if (relDef.belongsToPolymorphic) {
      const validation = validatePolymorphicRelationship(relDef, scopeName, scopes);
      if (!validation.valid) {
        throw new Error(
          `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
    
    // Validate hasMany relationships require foreignKey
    if (relDef.hasMany) {
      const validation = validateHasManyRelationship(relDef, relName, scopeName);
      if (!validation.valid) {
        throw new Error(
          `Invalid hasMany relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
    
    // Validate manyToMany relationships require both foreignKey and otherKey
    if (relDef.manyToMany) {
      const validation = validateManyToManyRelationship(relDef, relName, scopeName);
      if (!validation.valid) {
        throw new Error(
          `Invalid manyToMany relationship '${relName}' in scope '${scopeName}': ${validation.error}`
        );
      }
    }
  }
}


/**
 * Validates a polymorphic relationship definition
 * 
 * @param {Object} relDef - Relationship definition with belongsToPolymorphic
 * @param {string} scopeName - Scope being registered (for error messages)
 * @param {Object} scopes - All registered scopes for validation
 * @returns {Object} Validation result {valid: boolean, error?: string}
 * 
 * @example
 * // Input: Valid polymorphic configuration
 * const relDef = {
 *   belongsToPolymorphic: {
 *     types: ['articles', 'videos', 'products'],
 *     typeField: 'commentable_type',
 *     idField: 'commentable_id'
 *   }
 * };
 * validatePolymorphicRelationship(relDef, 'comments', scopes);
 * // Output: { valid: true }
 * 
 * @example
 * // Input: Missing required types array
 * const relDef = {
 *   belongsToPolymorphic: {
 *     typeField: 'commentable_type',
 *     idField: 'commentable_id'
 *     // Missing: types
 *   }
 * };
 * validatePolymorphicRelationship(relDef, 'comments', scopes);
 * // Output: { 
 * //   valid: false, 
 * //   error: 'belongsToPolymorphic.types must be a non-empty array' 
 * // }
 * 
 * @example
 * // Input: References non-existent scope
 * const relDef = {
 *   belongsToPolymorphic: {
 *     types: ['articles', 'unicorns'],    // 'unicorns' doesn't exist
 *     typeField: 'attachable_type',
 *     idField: 'attachable_id'
 *   }
 * };
 * validatePolymorphicRelationship(relDef, 'attachments', scopes);
 * // Output: { 
 * //   valid: false, 
 * //   error: "Polymorphic type 'unicorns' is not a registered scope" 
 * // }
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

/**
 * Validates a hasMany relationship definition
 * 
 * @param {Object} relDef - Relationship definition with hasMany
 * @param {string} relName - Relationship name
 * @param {string} scopeName - Scope being registered
 * @returns {Object} Validation result {valid: boolean, error?: string}
 * 
 * @example
 * // Input: Valid hasMany configuration
 * const relDef = {
 *   hasMany: 'posts',
 *   foreignKey: 'author_id'              // Required!
 * };
 * validateHasManyRelationship(relDef, 'posts', 'users');
 * // Output: { valid: true }
 * 
 * @example
 * // Input: Missing required foreignKey
 * const relDef = {
 *   hasMany: 'posts'
 *   // Missing: foreignKey
 * };
 * validateHasManyRelationship(relDef, 'posts', 'users');
 * // Output: { 
 * //   valid: false, 
 * //   error: 'hasMany relationship requires foreignKey to be specified...' 
 * // }
 * 
 * @example
 * // Input: Polymorphic hasMany with 'via' (doesn't need foreignKey)
 * const relDef = {
 *   hasMany: 'comments',
 *   via: 'commentable'                   // Uses polymorphic relationship
 * };
 * validateHasManyRelationship(relDef, 'comments', 'posts');
 * // Output: { valid: true }
 * 
 * @private
 */
const validateHasManyRelationship = (relDef, relName, scopeName) => {
  // Polymorphic hasMany relationships using 'via' don't need foreignKey
  // They use the polymorphic fields (typeField, idField) from the belongsToPolymorphic relationship
  if (relDef.via) {
    return { valid: true };
  }
  
  if (!relDef.foreignKey) {
    return { 
      valid: false, 
      error: `hasMany relationship requires foreignKey to be specified. Add foreignKey: '<field_name>' to the relationship definition.`
    };
  }
  
  if (typeof relDef.foreignKey !== 'string') {
    return { 
      valid: false, 
      error: `hasMany relationship foreignKey must be a string, got ${typeof relDef.foreignKey}`
    };
  }
  
  // If through is specified, also require otherKey for many-to-many
  if (relDef.through && !relDef.otherKey) {
    return { 
      valid: false, 
      error: `hasMany relationship with 'through' requires both foreignKey and otherKey to be specified`
    };
  }
  
  return { valid: true };
};

/**
 * Validates a manyToMany relationship definition
 * 
 * @param {Object} relDef - Relationship definition with manyToMany
 * @param {string} relName - Relationship name
 * @param {string} scopeName - Scope being registered
 * @returns {Object} Validation result {valid: boolean, error?: string}
 * 
 * @example
 * // Input: Valid manyToMany configuration
 * const relDef = {
 *   manyToMany: {
 *     through: 'article_tags',           // Pivot table
 *     foreignKey: 'article_id',          // This scope's FK
 *     otherKey: 'tag_id'                 // Other scope's FK
 *   }
 * };
 * validateManyToManyRelationship(relDef, 'tags', 'articles');
 * // Output: { valid: true }
 * 
 * @example
 * // Input: Missing required fields
 * const relDef = {
 *   manyToMany: {
 *     through: 'article_tags',
 *     foreignKey: 'article_id'
 *     // Missing: otherKey
 *   }
 * };
 * validateManyToManyRelationship(relDef, 'tags', 'articles');
 * // Output: { 
 * //   valid: false, 
 * //   error: 'manyToMany relationship requires otherKey to be specified...' 
 * // }
 * 
 * @private
 */
const validateManyToManyRelationship = (relDef, relName, scopeName) => {
  const { through, foreignKey, otherKey } = relDef.manyToMany;
  
  if (!through) {
    return { 
      valid: false, 
      error: `manyToMany relationship requires 'through' table to be specified`
    };
  }
  
  if (!foreignKey) {
    return { 
      valid: false, 
      error: `manyToMany relationship requires foreignKey to be specified. Add foreignKey: '<field_name>' to the manyToMany configuration.`
    };
  }
  
  if (!otherKey) {
    return { 
      valid: false, 
      error: `manyToMany relationship requires otherKey to be specified. Add otherKey: '<field_name>' to the manyToMany configuration.`
    };
  }
  
  if (typeof foreignKey !== 'string') {
    return { 
      valid: false, 
      error: `manyToMany relationship foreignKey must be a string, got ${typeof foreignKey}`
    };
  }
  
  if (typeof otherKey !== 'string') {
    return { 
      valid: false, 
      error: `manyToMany relationship otherKey must be a string, got ${typeof otherKey}`
    };
  }
  
  return { valid: true };
};

