/**
 * @module cross-table-search
 * @description SQL JOIN-based cross-table search utilities for REST API Knex Plugin
 * 
 * This module provides utilities for building complex SQL queries that search across
 * related database tables using JOINs. It supports:
 * - Many-to-one relationships (belongsTo with sideSearch: true)
 * - One-to-many relationships (hasMany with sideSearch: true)
 * - Multi-level relationship traversal (e.g., articles → people → companies)
 * - Automatic JOIN aliasing to prevent conflicts
 * - Field validation and index verification
 * 
 * @example <caption>Basic cross-table search setup</caption>
 * // In your schema definitions:
 * const peopleSchema = {
 *   id: { type: 'id' },
 *   name: { type: 'string', indexed: true },
 *   company_id: { 
 *     belongsTo: 'companies', 
 *     as: 'company',
 *     sideSearch: true  // Enable cross-table search
 *   }
 * };
 * 
 * const peopleSearchSchema = {
 *   // Search people by their company name
 *   companyName: {
 *     type: 'string',
 *     actualField: 'companies.name',  // Cross-table reference
 *     filterUsing: 'like'
 *   }
 * };
 * 
 * @example <caption>Multi-level cross-table search</caption>
 * const articlesSearchSchema = {
 *   // Search articles by the company of their author (3 levels)
 *   companyName: {
 *     type: 'string',
 *     actualField: 'companies.name',  // articles → people → companies
 *     filterUsing: 'like'
 *   }
 * };
 * 
 * @example <caption>One-to-many cross-table search</caption>
 * const peopleSearchSchema = {
 *   // Search people by their article titles (one person has many articles)
 *   articleTitle: {
 *     type: 'string',
 *     actualField: 'articles.title',
 *     filterUsing: 'like'
 *   }
 * };
 */

/**
 * Creates cross-table search helper functions with injected dependencies
 * 
 * @param {Object} scopes - The hooked-api scopes object containing all registered scopes
 * @param {Object} log - The logging instance for debug/trace output
 * @returns {Object} Object containing all cross-table search helper functions
 * 
 * @example
 * import { createCrossTableSearchHelpers } from './lib/cross-table-search.js';
 * 
 * const crossTableSearchHelpers = createCrossTableSearchHelpers(scopes, log);
 * 
 * // Validate a cross-table field reference
 * await crossTableSearchHelpers.validateCrossTableField('people', 'name');
 * 
 * // Build JOIN chain for complex path
 * const joinInfo = await crossTableSearchHelpers.buildJoinChain('articles', 'companies.name');
 */
export const createCrossTableSearchHelpers = (scopes, log) => {
  
  /**
   * Validates that a field is properly configured for cross-table search
   * 
   * @async
   * @param {string} targetScopeName - The scope containing the field
   * @param {string} fieldName - The field to validate
   * @param {Set<string>} [searchedScopes=new Set()] - Used internally to prevent circular references
   * @returns {Promise<{targetSchema: Object, fieldDef: Object}>} The validated schema and field definition
   * @throws {Error} If scope not found, field not found, field not indexed, or circular reference detected
   * 
   * @example
   * // Validate that 'people.name' is searchable
   * try {
   *   const { targetSchema, fieldDef } = await validateCrossTableField('people', 'name');
   *   console.log('Field is indexed:', fieldDef.indexed);
   * } catch (error) {
   *   console.error('Field validation failed:', error.message);
   * }
   */
  const validateCrossTableField = async (targetScopeName, fieldName, searchedScopes = new Set()) => {
    log.trace('[VALIDATE] Starting validateCrossTableField:', { targetScopeName, fieldName, searchedScopes: Array.from(searchedScopes) });
    
    // Prevent circular references
    if (searchedScopes.has(targetScopeName)) {
      throw new Error(`Circular reference detected: ${targetScopeName} -> ${Array.from(searchedScopes).join(' -> ')}`);
    }
    
    // Check if target scope exists by trying to call getSchema
    log.trace('[VALIDATE] Getting target schema for:', targetScopeName);
    let targetSchema;
    try {
      targetSchema = await scopes[targetScopeName].getSchema();
      log.trace('[VALIDATE] Got target schema:', { scopeName: targetScopeName, schemaKeys: Object.keys(targetSchema || {}) });
    } catch (error) {
      log.trace('[VALIDATE] Error getting target schema:', error.message);
      throw new Error(`Target scope '${targetScopeName}' not found`);
    }
    
    if (!targetSchema) {
      log.trace('[VALIDATE] Target schema is null/undefined');
      throw new Error(`Target scope '${targetScopeName}' has no schema`);
    }
    
    const fieldDef = targetSchema[fieldName];
    log.trace('[VALIDATE] Field lookup result:', { fieldName, fieldExists: !!fieldDef });
    if (!fieldDef) {
      throw new Error(`Field '${fieldName}' not found in scope '${targetScopeName}'`);
    }
    
    // Check if field is marked as indexed (required for cross-table search)
    log.trace('[VALIDATE] Checking indexed status:', { fieldName, indexed: fieldDef.indexed });
    if (!fieldDef.indexed) {
      throw new Error(`Field '${targetScopeName}.${fieldName}' is not indexed. Add 'indexed: true' to allow cross-table search`);
    }
    
    const result = { targetSchema, fieldDef };
    log.trace('[VALIDATE] Validation successful for field:', `${targetScopeName}.${fieldName}`);
    return result;
  };

  /**
   * Builds a JOIN chain for cross-table search, supporting multi-level relationships
   * 
   * @async
   * @param {string} fromScopeName - The starting scope (e.g., 'articles')
   * @param {string} targetPath - The target field path (e.g., 'companies.name')
   * @param {Set<string>} [searchedScopes=new Set()] - Used internally to prevent circular references
   * @returns {Promise<Object>} JOIN information including alias, condition, and chain details
   * @throws {Error} If path is invalid, relationship not found, or circular reference detected
   * 
   * @property {string} returns.joinAlias - The alias to use for the joined table
   * @property {string} returns.targetTableName - The actual database table name
   * @property {string} returns.joinCondition - The SQL JOIN condition
   * @property {string} returns.targetField - The field name in the target table
   * @property {boolean} returns.isOneToMany - Whether this is a one-to-many relationship
   * @property {boolean} returns.isMultiLevel - Whether this requires multiple JOINs
   * @property {Array} [returns.joinChain] - Array of JOIN steps for multi-level paths
   * 
   * @example <caption>Simple many-to-one JOIN</caption>
   * // Build JOIN for searching articles by author name
   * const joinInfo = await buildJoinChain('articles', 'people.name');
   * // Returns: {
   * //   joinAlias: 'articles_to_people_people',
   * //   targetTableName: 'people',
   * //   joinCondition: 'articles.author_id = articles_to_people_people.id',
   * //   targetField: 'name',
   * //   isOneToMany: false
   * // }
   * 
   * @example <caption>Multi-level JOIN chain</caption>
   * // Build JOIN chain for searching articles by author's company name
   * const joinInfo = await buildJoinChain('articles', 'companies.name');
   * // Returns: {
   * //   joinAlias: 'people_to_companies_companies',
   * //   targetTableName: 'companies',
   * //   targetField: 'name',
   * //   isOneToMany: false,
   * //   isMultiLevel: true,
   * //   joinChain: [
   * //     { targetTableName: 'people', joinAlias: 'articles_to_people_people', ... },
   * //     { targetTableName: 'companies', joinAlias: 'people_to_companies_companies', ... }
   * //   ]
   * // }
   */
  const buildJoinChain = async (fromScopeName, targetPath, searchedScopes = new Set()) => {
    log.trace('[BUILD-JOIN] Starting buildJoinChain:', { fromScopeName, targetPath });
    
    const pathParts = targetPath.split('.');
    if (pathParts.length !== 2) {
      throw new Error(`Invalid cross-table path '${targetPath}'. Use format: 'targetScope.fieldName'`);
    }
    
    const [targetScopeName, targetFieldName] = pathParts;
    log.trace('[BUILD-JOIN] Parsed path:', { targetScopeName, targetFieldName });
    
    // Validate the target field
    log.trace('[BUILD-JOIN] Validating target field');
    await validateCrossTableField(targetScopeName, targetFieldName, searchedScopes);
    
    // Helper function to find relationship path (potentially multi-level)
    const findRelationshipPath = async (currentScope, targetScope, visited = new Set(), path = []) => {
      log.trace('[PATH-FIND] Finding path:', { from: currentScope, to: targetScope, visitedCount: visited.size });
      
      if (currentScope === targetScope) {
        log.trace('[PATH-FIND] Found direct path to target');
        return path;
      }
      
      if (visited.has(currentScope)) {
        log.trace('[PATH-FIND] Already visited - avoiding cycle', { currentScope });
        return null;
      }
      
      visited.add(currentScope);
      
      try {
        // Get current scope's schema and relationships
        const currentSchema = await scopes[currentScope].getSchema();
        const currentRelationships = await scopes[currentScope].getRelationships();
        
        log.trace('[PATH-FIND] Checking schema and relationships', { currentScope });
        
        // Check belongsTo relationships (many-to-one)
        for (const [fieldName, fieldDef] of Object.entries(currentSchema)) {
          if (fieldDef.belongsTo && fieldDef.sideSearch === true) {
            const nextScope = fieldDef.belongsTo;
            log.trace('[PATH-FIND] Trying belongsTo', { fieldName, nextScope });
            
            if (!visited.has(nextScope)) {
              const subPath = await findRelationshipPath(
                nextScope, 
                targetScope, 
                new Set(visited), 
                [...path, { 
                  from: currentScope, 
                  to: nextScope, 
                  fieldName, 
                  fieldDef, 
                  type: 'belongsTo' 
                }]
              );
              
              if (subPath) {
                log.trace('[PATH-FIND] Found path via belongsTo', { fieldName });
                return subPath;
              }
            }
          }
        }
        
        // Check hasMany relationships (one-to-many)
        if (currentRelationships) {
          for (const [relName, relDef] of Object.entries(currentRelationships)) {
            if (relDef.hasMany && relDef.sideSearch === true) {
              const nextScope = relDef.hasMany;
              log.trace('[PATH-FIND] Trying hasMany', { relName, nextScope });
              
              if (!visited.has(nextScope)) {
                const subPath = await findRelationshipPath(
                  nextScope, 
                  targetScope, 
                  new Set(visited), 
                  [...path, { 
                    from: currentScope, 
                    to: nextScope, 
                    relName, 
                    relDef, 
                    type: 'hasMany' 
                  }]
                );
                
                if (subPath) {
                  log.trace('[PATH-FIND] Found path via hasMany', { relName });
                  return subPath;
                }
              }
            }
          }
        }
      } catch (error) {
        log.trace('[PATH-FIND] Error exploring from scope', { currentScope, error: error.message });
      }
      
      return null;
    };
    
    // Find the relationship path
    log.trace('[PATH-FIND] Starting path discovery', { from: fromScopeName, to: targetScopeName });
    const relationshipPath = await findRelationshipPath(fromScopeName, targetScopeName, searchedScopes);
    
    if (!relationshipPath || relationshipPath.length === 0) {
      throw new Error(`No searchable relationship found from '${fromScopeName}' to '${targetScopeName}'. Ensure relationships have 'sideSearch: true'`);
    }
    
    log.trace('[BUILD-JOIN] Found relationship path', { steps: relationshipPath.length });
    
    // Handle multi-level paths
    if (relationshipPath.length > 1) {
      log.trace('[BUILD-JOIN] Implementing multi-level path', { steps: relationshipPath.length });
      
      const joinChain = [];
      let currentFromScope = fromScopeName;
      
      for (let i = 0; i < relationshipPath.length; i++) {
        const step = relationshipPath[i];
        const stepTargetScope = step.to;
        const isOneToMany = step.type === 'hasMany';
        
        // Generate unique alias for this step
        const pathId = `${step.from}_to_${stepTargetScope}`;
        const joinAlias = `${pathId}_${stepTargetScope}`;
        
        // Get table names
        const fromSchema = await scopes[step.from].getSchema();
        const fromTableName = fromSchema.tableName || step.from;
        const targetSchema = await scopes[stepTargetScope].getSchema();
        const targetTableName = targetSchema.tableName || stepTargetScope;
        
        // Build join condition
        let joinCondition;
        if (isOneToMany) {
          const foreignKey = step.relDef.foreignKey || `${step.from.slice(0, -1)}_id`;
          const previousAlias = i === 0 ? fromTableName : joinChain[i-1].joinAlias;
          joinCondition = `${previousAlias}.id = ${joinAlias}.${foreignKey}`;
        } else {
          const relationshipField = step.fieldName || `${stepTargetScope.slice(0, -1)}_id`;
          const previousAlias = i === 0 ? fromTableName : joinChain[i-1].joinAlias;
          joinCondition = `${previousAlias}.${relationshipField} = ${joinAlias}.id`;
        }
        
        joinChain.push({
          targetTableName,
          joinAlias,
          joinCondition,
          isOneToMany
        });
      }
      
      log.trace('[BUILD-JOIN] Multi-level join chain', { joinCount: joinChain.length });
      
      // Return the final join info with the complete chain
      const lastJoin = joinChain[joinChain.length - 1];
      return {
        targetTableName: lastJoin.targetTableName,
        joinAlias: lastJoin.joinAlias,
        joinCondition: joinChain.map(j => j.joinCondition).join(' AND '),
        targetField: targetFieldName,
        isOneToMany: joinChain.some(j => j.isOneToMany),
        isMultiLevel: true,
        joinChain
      };
    }
    
    // Handle single-step relationship
    const step = relationshipPath[0];
    const relationshipField = step.fieldName || step.relDef.foreignKey || `${step.from.slice(0, -1)}_id`;
    const relationshipConfig = step.fieldDef || step.relDef;
    const isOneToMany = step.type === 'hasMany';
    
    log.trace('[BUILD-JOIN] Found relationship:', { relationshipField, isOneToMany });
    
    // Generate unique alias for this join to prevent conflicts
    const pathId = `${fromScopeName}_to_${targetScopeName}`;
    const joinAlias = `${pathId}_${targetScopeName}`;
    log.trace('[BUILD-JOIN] Generated alias:', { pathId, joinAlias });
    
    // Get source and target schemas for table names
    const sourceSchema = await scopes[fromScopeName].getSchema();
    const sourceTableName = sourceSchema.tableName || fromScopeName;
    const targetSchema = await scopes[targetScopeName].getSchema();
    const targetTableName = targetSchema.tableName || targetScopeName;
    log.trace('[BUILD-JOIN] Table names:', { sourceTableName, targetTableName });
    
    // Build join condition based on relationship direction
    let joinCondition;
    if (isOneToMany) {
      // One-to-many: source.id = target.foreign_key
      joinCondition = `${sourceTableName}.id = ${joinAlias}.${relationshipField}`;
      log.trace('[BUILD-JOIN] One-to-many join condition:', joinCondition);
    } else {
      // Many-to-one: source.foreign_key = target.id
      joinCondition = `${sourceTableName}.${relationshipField} = ${joinAlias}.id`;
      log.trace('[BUILD-JOIN] Many-to-one join condition:', joinCondition);
    }
    
    log.trace('[BUILD-JOIN] Final result:', { joinAlias, targetTableName, targetField: targetFieldName });
    
    return {
      joinAlias,
      targetTableName,
      sourceField: relationshipField,
      targetField: targetFieldName,
      joinCondition,
      isOneToMany
    };
  };

  /**
   * Analyzes searchSchema to identify fields that need database indexes
   * 
   * @param {string} scopeName - The scope to analyze
   * @param {Object} searchSchema - The search schema definition
   * @returns {Array<Object>} Array of required indexes with scope, field, and reason
   * 
   * @example
   * const searchSchema = {
   *   companyName: {
   *     actualField: 'companies.name',
   *     filterUsing: 'like'
   *   },
   *   search: {
   *     likeOneOf: ['name', 'email', 'companies.name']
   *   }
   * };
   * 
   * const requiredIndexes = analyzeRequiredIndexes('people', searchSchema);
   * // Returns: [
   * //   { scope: 'companies', field: 'name', reason: 'Cross-table search from people.companyName' },
   * //   { scope: 'companies', field: 'name', reason: 'Cross-table likeOneOf search from people.search' }
   * // ]
   */
  const analyzeRequiredIndexes = (scopeName, searchSchema) => {
    const requiredIndexes = [];
    
    Object.entries(searchSchema).forEach(([filterKey, fieldDef]) => {
      // Check actualField for cross-table references
      if (fieldDef.actualField && fieldDef.actualField.includes('.')) {
        const [targetScopeName, targetFieldName] = fieldDef.actualField.split('.');
        requiredIndexes.push({
          scope: targetScopeName,
          field: targetFieldName,
          reason: `Cross-table search from ${scopeName}.${filterKey}`
        });
      }
      
      // Check for likeOneOf cross-table references
      if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
        fieldDef.likeOneOf.forEach(field => {
          if (field.includes('.')) {
            const [targetScopeName, targetFieldName] = field.split('.');
            requiredIndexes.push({
              scope: targetScopeName,
              field: targetFieldName,
              reason: `Cross-table likeOneOf search from ${scopeName}.${filterKey}`
            });
          }
        });
      }
    });
    
    return requiredIndexes;
  };

  /**
   * Auto-generates database indexes for cross-table search fields
   * 
   * @async
   * @param {Array<Object>} requiredIndexes - Array of index requirements from analyzeRequiredIndexes
   * @param {Object} knex - The Knex instance for database operations
   * @returns {Promise<Array<Object>>} Array of successfully created indexes
   * 
   * @example
   * const requiredIndexes = analyzeRequiredIndexes('people', searchSchema);
   * const createdIndexes = await createRequiredIndexes(requiredIndexes, knex);
   * 
   * createdIndexes.forEach(idx => {
   *   console.log(`Created index ${idx.indexName} on ${idx.tableName}.${idx.field}`);
   * });
   */
  const createRequiredIndexes = async (requiredIndexes, knex) => {
    const createdIndexes = [];
    
    for (const indexInfo of requiredIndexes) {
      const { scope, field } = indexInfo;
      const schema = await scopes[scope].getSchema();
      const tableName = schema?.tableName || scope;
      const indexName = `idx_${tableName}_${field}_search`;
      
      try {
        // Check if index already exists
        const hasIndex = await knex.schema.hasIndex(tableName, [field]);
        if (!hasIndex) {
          await knex.schema.table(tableName, table => {
            table.index([field], indexName);
          });
          createdIndexes.push({ tableName, field, indexName });
          log.info(`Created index: ${indexName} on ${tableName}.${field}`);
        }
      } catch (error) {
        log.warn(`Failed to create index on ${tableName}.${field}:`, error.message);
      }
    }
    
    return createdIndexes;
  };

  // Return all helper functions
  return {
    validateCrossTableField,
    buildJoinChain,
    analyzeRequiredIndexes,
    createRequiredIndexes
  };
};