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
      targetSchema = (await scopes[targetScopeName].getSchemaInfo()).schema;
      log.trace('[VALIDATE] Got target schema:', { scopeName: targetScopeName, schemaKeys: Object.keys(targetSchema || {}) });
    } catch (error) {
      log.trace('[VALIDATE] Error getting target schema:', error.message);
      throw new Error(`Target scope '${targetScopeName}' not found`);
    }
    
    if (!targetSchema) {
      log.trace('[VALIDATE] Target schema is null/undefined');
      throw new Error(`Target scope '${targetScopeName}' has no schema`);
    }
    
    const fieldDef = targetSchema.structure[fieldName];
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
   * Builds a JOIN chain for cross-table search using explicit paths only
   * 
   * @async
   * @param {string} fromScopeName - The starting scope (e.g., 'articles')
   * @param {string} targetPath - The target field path (e.g., 'comments.body' or 'comments.tags.name')
   * @param {Set<string>} [searchedScopes=new Set()] - Used internally to prevent circular references
   * @returns {Promise<Object>} JOIN information including alias, condition, and chain details
   * @throws {Error} If path is invalid or relationship not found
   * 
   * @property {string} returns.joinAlias - The alias to use for the joined table
   * @property {string} returns.targetTableName - The actual database table name
   * @property {string} returns.joinCondition - The SQL JOIN condition
   * @property {string} returns.targetField - The field name in the target table
   * @property {boolean} returns.isOneToMany - Whether this is a one-to-many relationship
   * @property {boolean} returns.isMultiLevel - Whether this requires multiple JOINs
   * @property {Array} [returns.joinChain] - Array of JOIN steps for multi-level paths
   * 
   * @example <caption>Simple cross-table search</caption>
   * // Build JOIN for searching articles by comment body
   * const joinInfo = await buildJoinChain('articles', 'comments.body');
   * // Returns: {
   * //   joinAlias: 'articles_to_comments_comments',
   * //   targetTableName: 'comments',
   * //   joinCondition: 'articles.id = articles_to_comments_comments.article_id',
   * //   targetField: 'body',
   * //   isOneToMany: true
   * // }
   * 
   * @example <caption>Multi-level explicit path</caption>
   * // Build JOIN chain for searching articles by comment tags
   * const joinInfo = await buildJoinChain('articles', 'comments.tags.name');
   * // Returns: {
   * //   joinAlias: 'comments_to_tags_tags',
   * //   targetTableName: 'tags',
   * //   targetField: 'name',
   * //   isOneToMany: true,
   * //   isMultiLevel: true,
   * //   joinChain: [
   * //     { targetTableName: 'comments', joinAlias: 'articles_to_comments_comments', ... },
   * //     { targetTableName: 'tags', joinAlias: 'comments_to_tags_tags', ... }
   * //   ]
   * // }
   */
  const buildJoinChain = async (fromScopeName, targetPath, searchedScopes = new Set()) => {
    log.trace('[BUILD-JOIN] Starting buildJoinChain:', { fromScopeName, targetPath });
    
    // Parse the path into segments
    const pathSegments = targetPath.split('.');
    if (pathSegments.length < 2) {
      throw new Error(`Invalid cross-table path '${targetPath}'. Must contain at least 'scope.field'`);
    }
    
    // The last segment is always the field name
    const targetFieldName = pathSegments[pathSegments.length - 1];
    const relationshipPath = pathSegments.slice(0, -1);
    
    log.trace('[BUILD-JOIN] Parsed path:', { relationshipPath, targetFieldName });
    
    // Build the join chain by following each relationship in the path
    const joinChain = [];
    let currentScope = fromScopeName;
    
    for (let i = 0; i < relationshipPath.length; i++) {
      const targetScope = relationshipPath[i];
      
      log.trace('[BUILD-JOIN] Looking for direct relationship:', { from: currentScope, to: targetScope });
      
      // Prevent circular references
      if (searchedScopes.has(currentScope)) {
        throw new Error(`Circular reference detected in path: ${Array.from(searchedScopes).join(' -> ')} -> ${currentScope}`);
      }
      searchedScopes.add(currentScope);
      
      // Get current scope's schema and relationships
      const schemaInfo = await scopes[currentScope].getSchemaInfo();
      const currentSchema = schemaInfo.schema;
      const currentRelationships = schemaInfo.relationships;
      
      let foundRelationship = null;
      let relationshipType = null;
      let relationshipField = null;
      let relationshipDef = null;
      
      // First check hasMany relationships (one-to-many)
      if (currentRelationships) {
        for (const [relName, relDef] of Object.entries(currentRelationships)) {
          if (relDef.hasMany === targetScope && (relDef.sideSearchMany === true)) {
            foundRelationship = targetScope;
            relationshipType = 'hasMany';
            relationshipField = relDef.foreignKey || `${currentScope.slice(0, -1)}_id`;
            relationshipDef = relDef;
            log.trace('[BUILD-JOIN] Found hasMany relationship:', { relName, targetScope, foreignKey: relationshipField });
            break;
          }
        }
      }
      
      // If not found, check belongsTo relationships (many-to-one)
      if (!foundRelationship) {
        for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
          if (fieldDef.belongsTo === targetScope && (fieldDef.sideSearchSingle !== false)) {
            foundRelationship = targetScope;
            relationshipType = 'belongsTo';
            relationshipField = fieldName;
            relationshipDef = fieldDef;
            log.trace('[BUILD-JOIN] Found belongsTo relationship:', { fieldName, targetScope });
            break;
          }
        }
      }
      
      if (!foundRelationship) {
        throw new Error(
          `No searchable relationship from '${currentScope}' to '${targetScope}'. ` +
          `Ensure a direct relationship exists with 'sideSearchSingle: true' or 'sideSearchMany: true'`
        );
      }
      
      // Get table names
      const sourceSchema = (await scopes[currentScope].getSchemaInfo()).schema;
      const sourceTableName = sourceSchema.tableName || currentScope;
      const targetSchema = (await scopes[targetScope].getSchemaInfo()).schema;
      const targetTableName = targetSchema.tableName || targetScope;
      
      // Generate unique alias
      const joinAlias = `${currentScope}_to_${targetScope}_${targetScope}`;
      
      // Build join condition
      let joinCondition;
      if (relationshipType === 'hasMany') {
        // One-to-many: source.id = target.foreign_key
        const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
        joinCondition = `${previousAlias}.id = ${joinAlias}.${relationshipField}`;
      } else {
        // Many-to-one: source.foreign_key = target.id
        const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
        joinCondition = `${previousAlias}.${relationshipField} = ${joinAlias}.id`;
      }
      
      joinChain.push({
        targetTableName,
        joinAlias,
        joinCondition,
        isOneToMany: relationshipType === 'hasMany',
        relationshipField,
        relationshipType
      });
      
      currentScope = targetScope;
    }
    
    // Validate the final field exists and is indexed
    const finalScope = relationshipPath[relationshipPath.length - 1];
    await validateCrossTableField(finalScope, targetFieldName, searchedScopes);
    
    // Return the complete join information
    if (joinChain.length === 0) {
      throw new Error(`Invalid path '${targetPath}': no relationships to traverse`);
    }
    
    const lastJoin = joinChain[joinChain.length - 1];
    
    if (joinChain.length > 1) {
      // Multi-level path
      return {
        targetTableName: lastJoin.targetTableName,
        joinAlias: lastJoin.joinAlias,
        joinCondition: joinChain.map(j => j.joinCondition).join(' AND '),
        targetField: targetFieldName,
        isOneToMany: joinChain.some(j => j.isOneToMany),
        isMultiLevel: true,
        joinChain
      };
    } else {
      // Single-level path
      return {
        joinAlias: lastJoin.joinAlias,
        targetTableName: lastJoin.targetTableName,
        sourceField: lastJoin.relationshipField,
        targetField: targetFieldName,
        joinCondition: lastJoin.joinCondition,
        isOneToMany: lastJoin.isOneToMany
      };
    }
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
    
    // Handle both raw schema and schema object
    const schemaToAnalyze = searchSchema.structure || searchSchema;
    
    Object.entries(schemaToAnalyze).forEach(([filterKey, fieldDef]) => {
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
      const schema = (await scopes[scope].getSchemaInfo()).schema;
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