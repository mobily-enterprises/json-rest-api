/**
 * Polymorphic relationship helpers for REST API
 * 
 * This module provides utilities for handling polymorphic relationships
 * where a single foreign key can reference multiple different tables.
 */

export const createPolymorphicHelpers = (scopes, log) => {
  
  /**
   * Validates a polymorphic relationship definition
   * Called during scope registration to ensure configuration is correct
   * 
   * @param {Object} relDef - The relationship definition
   * @param {string} scopeName - The scope being registered
   * @returns {Object} { valid: boolean, error?: string }
   */
  const validatePolymorphicRelationship = (relDef, scopeName) => {
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
   * Used when loading includes to minimize database queries
   * 
   * @param {Array} records - Records containing polymorphic fields
   * @param {string} typeField - Name of the type field (e.g., 'commentable_type')
   * @param {string} idField - Name of the ID field (e.g., 'commentable_id')
   * @returns {Object} Map of type -> array of IDs
   * 
   * @example
   * // Input records:
   * [
   *   { id: 1, commentable_type: 'articles', commentable_id: 123 },
   *   { id: 2, commentable_type: 'books', commentable_id: 456 },
   *   { id: 3, commentable_type: 'articles', commentable_id: 789 }
   * ]
   * // Output:
   * {
   *   articles: [123, 789],
   *   books: [456]
   * }
   */
  const groupByPolymorphicType = (records, typeField, idField) => {
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
   * Used when building JSON:API relationships
   * 
   * @param {Object} record - The record with polymorphic fields
   * @param {string} typeField - Name of the type field
   * @param {string} idField - Name of the ID field
   * @param {Array} allowedTypes - Valid types for this relationship
   * @returns {Object} { type: string, id: any, valid: boolean }
   */
  const resolvePolymorphicTarget = (record, typeField, idField, allowedTypes) => {
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
   * Builds conditional JOINs for polymorphic search
   * This is the most complex function - handles different join paths per type
   * 
   * @param {Object} query - Knex query builder
   * @param {Object} searchDef - Search field definition with polymorphicField and targetFields
   * @param {string} scopeName - Current scope name
   * @param {string} tableName - Current table name
   * @param {Object} knex - Knex instance
   * @returns {Object} Map of aliases used for WHERE clause building
   */
  const buildPolymorphicSearchJoins = async (query, searchDef, scopeName, tableName, knex) => {
    const { polymorphicField, targetFields } = searchDef;
    const aliasMap = {};
    
    // Get the polymorphic relationship definition
    const relationships = scopes[scopeName].getRelationships();
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
      const targetSchema = await scopes[targetType].getSchema();
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
          const currentSchema = await scopes[currentScope].getSchema();
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
          const nextSchema = await scopes[nextScope].getSchema();
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
  
  return {
    validatePolymorphicRelationship,
    groupByPolymorphicType,
    resolvePolymorphicTarget,
    buildPolymorphicSearchJoins
  };
};