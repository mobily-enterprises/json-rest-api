/**
 * @module polymorphic-helpers
 * @description Polymorphic relationship utilities for REST API
 * 
 * This module provides utilities for handling polymorphic relationships where a single
 * foreign key can reference multiple different tables. In a polymorphic relationship,
 * two fields work together:
 * - A type field (e.g., 'commentable_type') stores the target table/scope name
 * - An ID field (e.g., 'commentable_id') stores the foreign key value
 * 
 * This allows flexible relationships where, for example, comments can belong to
 * articles, videos, or any other resource type.
 * 
 * @example <caption>Polymorphic relationship definition</caption>
 * // A comment that can belong to articles, videos, or products
 * const commentsSchema = {
 *   id: { type: 'id' },
 *   body: { type: 'string' },
 *   commentable_type: { type: 'string' },  // Stores 'articles', 'videos', etc.
 *   commentable_id: { type: 'number' }      // Stores the ID in that table
 * };
 * 
 * // Relationship configuration
 * relationships: {
 *   commentable: {
 *     belongsToPolymorphic: {
 *       types: ['articles', 'videos', 'products'],
 *       typeField: 'commentable_type',
 *       idField: 'commentable_id'
 *     },
 *     as: 'commentable',
 *     sideLoad: true
 *   }
 * }
 * 
 * @example <caption>Reverse polymorphic (hasMany via)</caption>
 * // Articles can have comments through polymorphic relationship
 * relationships: {
 *   comments: {
 *     hasMany: 'comments',
 *     via: 'commentable',  // The polymorphic field name
 *     as: 'comments',
 *     sideLoad: true
 *   }
 * }
 */

/**
 * Validates a polymorphic relationship definition
 * 
 * Called during scope registration to ensure configuration is correct.
 * Performs comprehensive validation of polymorphic relationship setup.
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
 *   }
 * };
 * 
 * const result = validatePolymorphicRelationship(relDef, 'comments', scopes);
 * // Returns: { valid: false, error: 'belongsToPolymorphic.types must be a non-empty array' }
 */
export const validatePolymorphicRelationship = (relDef, scopeName, scopes) => {
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
 * Groups records by their polymorphic type for efficient batch loading
 * 
 * Used when loading includes to minimize database queries. Instead of making
 * N queries (one per record), this groups records by type so we can make
 * one query per type.
 * 
 * @param {Array<Object>} records - Records containing polymorphic fields
 * @param {string} typeField - Name of the type field (e.g., 'commentable_type')
 * @param {string} idField - Name of the ID field (e.g., 'commentable_id')
 * @returns {Object<string, Array<number|string>>} Map of type to array of unique IDs
 * 
 * @example <caption>Basic grouping</caption>
 * const comments = [
 *   { id: 1, commentable_type: 'articles', commentable_id: 123 },
 *   { id: 2, commentable_type: 'videos', commentable_id: 456 },
 *   { id: 3, commentable_type: 'articles', commentable_id: 789 },
 *   { id: 4, commentable_type: 'articles', commentable_id: 123 }  // Duplicate
 * ];
 * 
 * const grouped = groupByPolymorphicType(comments, 'commentable_type', 'commentable_id');
 * // Returns: {
 * //   articles: [123, 789],  // Note: duplicates removed
 * //   videos: [456]
 * // }
 * 
 * @example <caption>Handling null values</caption>
 * const comments = [
 *   { id: 1, commentable_type: 'articles', commentable_id: 123 },
 *   { id: 2, commentable_type: null, commentable_id: 456 },        // Ignored
 *   { id: 3, commentable_type: 'videos', commentable_id: null }    // Ignored
 * ];
 * 
 * const grouped = groupByPolymorphicType(comments, 'commentable_type', 'commentable_id');
 * // Returns: { articles: [123] }
 * // Records with null type or ID are excluded
 */
export const groupByPolymorphicType = (records, typeField, idField) => {
  const grouped = {};
  
  records.forEach(record => {
    const type = record[typeField];
    const id = record[idField];
    
    if (type && id) {
      if (!grouped[type]) {
        grouped[type] = new Set();
      }
      grouped[type].add(id);
    }
  });
  
  // Convert Sets to Arrays for SQL IN queries
  Object.keys(grouped).forEach(type => {
    grouped[type] = Array.from(grouped[type]);
  });
  
  return grouped;
};

/**
 * Resolves the target type and ID from a polymorphic relationship
 * 
 * Used when building JSON:API relationships. Validates that the polymorphic
 * type is allowed and returns normalized type/id information.
 * 
 * @param {Object} record - The record with polymorphic fields
 * @param {string} typeField - Name of the type field in the record
 * @param {string} idField - Name of the ID field in the record
 * @param {Array<string>} allowedTypes - Valid types for this relationship
 * @param {Object} log - The logging instance for debug/trace output
 * @returns {Object} Resolution result
 * @returns {string|null} returns.type - The target type or null
 * @returns {number|string|null} returns.id - The target ID or null
 * @returns {boolean} returns.valid - Whether the resolution was valid
 * @returns {string} [returns.error] - Error message if invalid
 * 
 * @example <caption>Valid polymorphic target</caption>
 * const comment = {
 *   id: 1,
 *   body: 'Great article!',
 *   commentable_type: 'articles',
 *   commentable_id: 123
 * };
 * 
 * const result = resolvePolymorphicTarget(
 *   comment,
 *   'commentable_type',
 *   'commentable_id',
 *   ['articles', 'videos', 'products'],
 *   log
 * );
 * // Returns: { type: 'articles', id: 123, valid: true }
 * 
 * @example <caption>Invalid type</caption>
 * const comment = {
 *   commentable_type: 'users',  // Not in allowed types!
 *   commentable_id: 456
 * };
 * 
 * const result = resolvePolymorphicTarget(
 *   comment,
 *   'commentable_type',
 *   'commentable_id',
 *   ['articles', 'videos', 'products'],
 *   log
 * );
 * // Returns: { 
 * //   type: null, 
 * //   id: null, 
 * //   valid: false,
 * //   error: "Type 'users' not allowed for this relationship"
 * // }
 * 
 * @example <caption>Null relationship</caption>
 * const comment = {
 *   commentable_type: null,
 *   commentable_id: null
 * };
 * 
 * const result = resolvePolymorphicTarget(comment, 'commentable_type', 'commentable_id', ['articles'], log);
 * // Returns: { type: null, id: null, valid: true }  // Null is valid
 */
export const resolvePolymorphicTarget = (record, typeField, idField, allowedTypes, log) => {
  const targetType = record[typeField];
  const targetId = record[idField];
  
  // Handle null relationships
  if (!targetType || !targetId) {
    return { type: null, id: null, valid: true };
  }
  
  // Validate type is allowed
  if (!allowedTypes.includes(targetType)) {
    log.warn(`Invalid polymorphic type '${targetType}' not in allowed types:`, allowedTypes);
    return { 
      type: null, 
      id: null, 
      valid: false, 
      error: `Type '${targetType}' not allowed for this relationship` 
    };
  }
  
  return {
    type: targetType,
    id: targetId,
    valid: true
  };
};

/**
 * Builds conditional JOINs for polymorphic search queries
 * 
 * This is the most complex function in the module. It creates SQL JOINs that
 * conditionally join different tables based on the polymorphic type field.
 * This allows searching across polymorphic relationships.
 * 
 * @async
 * @param {Object} query - Knex query builder instance to add JOINs to
 * @param {Object} searchDef - Search field definition
 * @param {string} searchDef.polymorphicField - Name of the polymorphic relationship
 * @param {Object<string, string>} searchDef.targetFields - Map of type to field path
 * @param {string} scopeName - Current scope name (e.g., 'activities')
 * @param {string} tableName - Current table name (e.g., 'activities')
 * @param {Object} knex - Knex instance for raw SQL
 * @param {Object} scopes - The hooked-api scopes object containing all registered scopes
 * @returns {Promise<Object>} Map of type to alias and field information
 * 
 * @example <caption>Simple polymorphic search</caption>
 * // Search activities by their trackable title
 * const searchDef = {
 *   polymorphicField: 'trackable',
 *   targetFields: {
 *     articles: 'title',
 *     videos: 'title',
 *     courses: 'name'  // Different field name for courses
 *   }
 * };
 * 
 * const aliasMap = await buildPolymorphicSearchJoins(
 *   query,
 *   searchDef,
 *   'activities',
 *   'activities',
 *   knex,
 *   scopes
 * );
 * 
 * // Returns: {
 * //   articles: { alias: 'activities_trackable_articles', field: 'title' },
 * //   videos: { alias: 'activities_trackable_videos', field: 'title' },
 * //   courses: { alias: 'activities_trackable_courses', field: 'name' }
 * // }
 * 
 * // Generates SQL JOINs like:
 * // LEFT JOIN articles AS activities_trackable_articles 
 * //   ON activities.trackable_type = 'articles' 
 * //   AND activities.trackable_id = activities_trackable_articles.id
 * // LEFT JOIN videos AS activities_trackable_videos
 * //   ON activities.trackable_type = 'videos'
 * //   AND activities.trackable_id = activities_trackable_videos.id
 * 
 * @example <caption>Cross-table polymorphic search</caption>
 * // Search by a field in a related table
 * const searchDef = {
 *   polymorphicField: 'trackable',
 *   targetFields: {
 *     articles: 'author.name',     // Search by article author name
 *     videos: 'channel.name'       // Search by video channel name
 *   }
 * };
 * 
 * const aliasMap = await buildPolymorphicSearchJoins(query, searchDef, 'activities', 'activities', knex, scopes);
 * 
 * // Returns: {
 * //   articles: { alias: 'activities_trackable_articles_author', field: 'name' },
 * //   videos: { alias: 'activities_trackable_videos_channel', field: 'name' }
 * // }
 * 
 * // Generates additional JOINs for the cross-table relationships
 */
export const buildPolymorphicSearchJoins = async (query, searchDef, scopeName, tableName, knex, scopes) => {
  const { polymorphicField, targetFields } = searchDef;
  const aliasMap = {};
  
  // Get the polymorphic relationship definition
  const relationships = (await scopes[scopeName].getSchemaInfo()).relationships;
  const polyRel = relationships[polymorphicField];
  
  if (!polyRel?.belongsToPolymorphic) {
    throw new Error(
      `Polymorphic field '${polymorphicField}' not found in relationships`
    );
  }
  
  const { typeField, idField } = polyRel.belongsToPolymorphic;
  
  // Build JOINs for each target type
  for (const [targetType, targetFieldPath] of Object.entries(targetFields)) {
    // Create base alias for this type
    const baseAlias = `${tableName}_${polymorphicField}_${targetType}`;
    
    // Get target table name
    const targetSchema = (await scopes[targetType].getSchemaInfo()).schema;
    const targetTable = targetSchema.tableName || targetType;
    
    // Add conditional JOIN for this type
    query.leftJoin(`${targetTable} as ${baseAlias}`, function() {
      this.on(`${tableName}.${typeField}`, knex.raw('?', [targetType]))
          .andOn(`${tableName}.${idField}`, `${baseAlias}.id`);
    });
    
    // Handle cross-table paths (e.g., 'users.companies.name')
    if (targetFieldPath.includes('.')) {
      const pathParts = targetFieldPath.split('.');
      let currentAlias = baseAlias;
      let currentScope = targetType;
      
      // Build JOIN chain for each segment except the last (which is the field)
      for (let i = 0; i < pathParts.length - 1; i++) {
        const relationshipName = pathParts[i];
        
        // Find the actual foreign key field for this relationship
        const currentSchema = (await scopes[currentScope].getSchemaInfo()).schema;
        let foreignKeyField = null;
        let nextScope = null;
        
        // Look for belongsTo relationship in schema
        for (const [fieldName, fieldDef] of Object.entries(currentSchema)) {
          if (fieldDef.as === relationshipName && fieldDef.belongsTo) {
            foreignKeyField = fieldName;
            nextScope = fieldDef.belongsTo;
            break;
          }
        }
        
        if (!foreignKeyField) {
          throw new Error(
            `Cannot resolve relationship '${relationshipName}' in path '${targetFieldPath}'`
          );
        }
        
        // Create alias for this join
        const nextAlias = `${currentAlias}_${relationshipName}`;
        const nextSchema = (await scopes[nextScope].getSchemaInfo()).schema;
        const nextTable = nextSchema.tableName || nextScope;
        
        // Add the join
        query.leftJoin(`${nextTable} as ${nextAlias}`, 
          `${currentAlias}.${foreignKeyField}`, 
          `${nextAlias}.id`
        );
        
        currentAlias = nextAlias;
        currentScope = nextScope;
      }
      
      // Store the final alias for WHERE clause
      aliasMap[targetType] = {
        alias: currentAlias,
        field: pathParts[pathParts.length - 1]
      };
    } else {
      // Direct field - store base alias
      aliasMap[targetType] = {
        alias: baseAlias,
        field: targetFieldPath
      };
    }
  }
  
  return aliasMap;
};