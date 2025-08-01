/**
 * Creates cross-table search helper functions that enable filtering across related database tables
 * 
 * @param {Object} scopes - All registered hooked-api scopes containing schema and relationship definitions
 * @param {Object} log - Logger instance for debug and trace output
 * @returns {Object} Object containing validateCrossTableField, buildJoinChain, analyzeRequiredIndexes, and createRequiredIndexes functions
 * 
 * @example
 * // Input: API scopes with relationships defined
 * const scopes = {
 *   articles: { vars: { schemaInfo: { schema: articlesSchema, tableName: 'articles' } } },
 *   authors: { vars: { schemaInfo: { schema: authorsSchema, tableName: 'authors' } } },
 *   companies: { vars: { schemaInfo: { schema: companiesSchema, tableName: 'companies' } } }
 * };
 * 
 * const helpers = createCrossTableSearchHelpers(scopes, logger);
 * 
 * // Output: Object with helper functions
 * // {
 * //   validateCrossTableField: [Function],
 * //   buildJoinChain: [Function],
 * //   analyzeRequiredIndexes: [Function],
 * //   createRequiredIndexes: [Function]
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin uses this during dataQuery to enable cross-table filtering
 * - Called when filter parameters reference fields from related tables (e.g., filter[author.name]=John)
 * 
 * Purpose:
 * - Enables powerful filtering across relationships without exposing SQL complexity to API consumers
 * - Automatically builds optimal JOIN chains based on schema relationships
 * - Prevents N+1 queries by using efficient SQL JOINs instead of multiple queries
 * 
 * Data flow:
 * 1. API receives filter like filter[author.company.name]=Acme
 * 2. rest-api-knex-plugin detects cross-table reference (contains dots)
 * 3. Calls buildJoinChain to construct SQL JOIN path from articles → authors → companies
 * 4. Adds JOINs to main query, enabling filtering on company name while querying articles
 * 5. Returns articles where author's company name matches 'Acme'
 */
export const createCrossTableSearchHelpers = (scopes, log) => {
  
  /**
   * Validates that a field exists and is indexed for cross-table search
   * 
   * @async
   * @param {string} targetScopeName - The scope containing the field to validate
   * @param {string} fieldName - The field name to check
   * @param {Set<string>} [searchedScopes=new Set()] - Internal parameter to prevent circular references
   * @returns {Promise<{targetSchema: Object, fieldDef: Object}>} The validated schema and field definition
   * @throws {Error} If scope not found, field not found, field not indexed, or circular reference detected
   * 
   * @example
   * // Input: Validate indexed field
   * // Schema has: companies.name with indexed: true
   * const result = await validateCrossTableField('companies', 'name');
   * 
   * // Output: Successfully returns schema and field definition
   * // {
   * //   targetSchema: { structure: { name: { type: 'string', indexed: true }, ... } },
   * //   fieldDef: { type: 'string', indexed: true }
   * // }
   * 
   * @example
   * // Input: Non-indexed field
   * // Schema has: companies.internal_code without indexed property
   * try {
   *   await validateCrossTableField('companies', 'internal_code');
   * } catch (error) {
   *   console.log(error.message);
   *   // "Field 'companies.internal_code' is not indexed. Add 'indexed: true' to allow cross-table search"
   * }
   * 
   * @description
   * Used by:
   * - buildJoinChain calls this to ensure target fields are properly indexed
   * - analyzeRequiredIndexes uses this to identify missing indexes
   * 
   * Purpose:
   * - Cross-table searches can be slow without proper indexes
   * - Forces developers to explicitly mark searchable fields with indexed: true
   * - Provides clear error messages when configuration is missing
   * 
   * Data flow:
   * - Called during query building to validate field configuration
   * - Ensures performance by requiring indexes on searchable fields
   * - Part of the validation phase before expensive JOIN operations
   */
  const validateCrossTableField = async (targetScopeName, fieldName, searchedScopes = new Set()) => {
    log.trace('[VALIDATE] Starting validateCrossTableField:', { targetScopeName, fieldName, searchedScopes: Array.from(searchedScopes) });
    
    if (searchedScopes.has(targetScopeName)) {
      throw new Error(`Circular reference detected: ${targetScopeName} -> ${Array.from(searchedScopes).join(' -> ')}`);
    }
    
    log.trace('[VALIDATE] Getting target schema for:', targetScopeName);
    let targetSchema;
    try {
      targetSchema = scopes[targetScopeName].vars.schemaInfo.schema;;
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
    
    log.trace('[VALIDATE] Checking indexed status:', { fieldName, indexed: fieldDef.indexed });
    if (!fieldDef.indexed) {
      throw new Error(`Field '${targetScopeName}.${fieldName}' is not indexed. Add 'indexed: true' to allow cross-table search`);
    }
    
    const result = { targetSchema, fieldDef };
    log.trace('[VALIDATE] Validation successful for field:', `${targetScopeName}.${fieldName}`);
    return result;
  };

  /**
   * Builds a chain of SQL JOINs to reach a field in a related table
   * 
   * @async
   * @param {string} fromScopeName - Starting scope (e.g., 'articles')
   * @param {string} targetPath - Dot-separated path to target field (e.g., 'author.company.name')
   * @param {Set<string>} [searchedScopes=new Set()] - Internal parameter to prevent circular references
   * @returns {Promise<Object>} JOIN information for query builder
   * @throws {Error} If path is invalid or relationships not properly configured
   * 
   * @example
   * // Input: Simple belongsTo relationship
   * // articles table has author_id field, authors schema defines belongsTo relationship
   * const joinInfo = await buildJoinChain('articles', 'author.name');
   * 
   * // Output: Single JOIN configuration
   * // {
   * //   joinAlias: 'articles_to_authors_authors',
   * //   targetTableName: 'authors',
   * //   sourceField: 'author_id',
   * //   targetField: 'name',
   * //   joinCondition: 'articles.author_id = articles_to_authors_authors.id',
   * //   isOneToMany: false,
   * //   isPolymorphic: false
   * // }
   * 
   * @example
   * // Input: Multi-level path through relationships
   * // articles → authors → companies
   * const joinInfo = await buildJoinChain('articles', 'author.company.name');
   * 
   * // Output: Multi-level JOIN chain
   * // {
   * //   targetTableName: 'companies',
   * //   joinAlias: 'authors_to_companies_companies',
   * //   joinCondition: 'articles.author_id = articles_to_authors_authors.id AND articles_to_authors_authors.company_id = authors_to_companies_companies.id',
   * //   targetField: 'name',
   * //   isOneToMany: false,
   * //   isMultiLevel: true,
   * //   joinChain: [
   * //     {
   * //       targetTableName: 'authors',
   * //       joinAlias: 'articles_to_authors_authors',
   * //       joinCondition: 'articles.author_id = articles_to_authors_authors.id',
   * //       isOneToMany: false,
   * //       relationshipField: 'author_id',
   * //       relationshipType: 'belongsTo'
   * //     },
   * //     {
   * //       targetTableName: 'companies',
   * //       joinAlias: 'authors_to_companies_companies',
   * //       joinCondition: 'articles_to_authors_authors.company_id = authors_to_companies_companies.id',
   * //       isOneToMany: false,
   * //       relationshipField: 'company_id',
   * //       relationshipType: 'belongsTo'
   * //     }
   * //   ]
   * // }
   * 
   * @example
   * // Input: One-to-many relationship (hasMany)
   * // authors have many articles
   * const joinInfo = await buildJoinChain('authors', 'articles.title');
   * 
   * // Output: JOIN with isOneToMany flag
   * // {
   * //   joinAlias: 'authors_to_articles_articles',
   * //   targetTableName: 'articles',
   * //   sourceField: 'author_id',
   * //   targetField: 'title',
   * //   joinCondition: 'authors.id = authors_to_articles_articles.author_id',
   * //   isOneToMany: true,
   * //   isPolymorphic: false
   * // }
   * 
   * @description
   * Used by:
   * - rest-api-knex-plugin's dataQuery method when processing cross-table filters
   * - Called for each filter that references a related table field
   * 
   * Purpose:
   * - Automatically constructs complex SQL JOINs from simple dot notation
   * - Supports many-to-one (belongsTo), one-to-many (hasMany), and many-to-many relationships
   * - Handles polymorphic relationships and multi-level paths
   * 
   * Data flow:
   * 1. Filter parser identifies cross-table reference (contains dots)
   * 2. buildJoinChain analyzes relationship path segment by segment
   * 3. For each segment, finds the appropriate relationship definition
   * 4. Constructs JOIN conditions based on foreign keys
   * 5. Returns complete JOIN information for SQL query builder
   * 6. Query builder adds these JOINs to enable filtering on related data
   */
  const buildJoinChain = async (fromScopeName, targetPath, searchedScopes = new Set()) => {
    log.trace('[BUILD-JOIN] Starting buildJoinChain:', { fromScopeName, targetPath });
    
    const pathSegments = targetPath.split('.');
    if (pathSegments.length < 2) {
      throw new Error(`Invalid cross-table path '${targetPath}'. Must contain at least 'scope.field'`);
    }
    
    const targetFieldName = pathSegments[pathSegments.length - 1];
    const relationshipPath = pathSegments.slice(0, -1);
    
    log.trace('[BUILD-JOIN] Parsed path:', { relationshipPath, targetFieldName });
    
    const joinChain = [];
    let currentScope = fromScopeName;
    
    for (let i = 0; i < relationshipPath.length; i++) {
      const targetScope = relationshipPath[i];
      
      log.trace('[BUILD-JOIN] Looking for direct relationship:', { from: currentScope, to: targetScope });
      
      if (searchedScopes.has(currentScope)) {
        throw new Error(`Circular reference detected in path: ${Array.from(searchedScopes).join(' -> ')} -> ${currentScope}`);
      }
      searchedScopes.add(currentScope);
      
      const schemaInfo = scopes[currentScope].vars.schemaInfo
      const currentSchema = schemaInfo.schema;
      const currentRelationships = schemaInfo.schemaRelationships;
      
      let foundRelationship = null;
      let relationshipType = null;
      let relationshipField = null;
      let relationshipDef = null;
      
      if (currentRelationships) {
        for (const [relName, relDef] of Object.entries(currentRelationships)) {
          if (relDef.hasMany === targetScope) {
            if (relDef.via) {
              const targetRelationships = scopes[targetScope].vars.schemaInfo.schemaRelationships;
              const viaRel = targetRelationships?.[relDef.via];
              
              if (viaRel?.belongsToPolymorphic) {
                const { typeField, idField } = viaRel.belongsToPolymorphic;
                foundRelationship = targetScope;
                relationshipType = 'hasManyPolymorphic';
                relationshipField = { typeField, idField, via: relDef.via };
                relationshipDef = relDef;
                log.trace('[BUILD-JOIN] Found polymorphic hasMany relationship:', { 
                  relName, targetScope, via: relDef.via, typeField, idField 
                });
                break;
              }
            }
            
            if (relDef.through) {
              foundRelationship = targetScope;
              relationshipType = 'manyToMany';
              relationshipField = {
                through: relDef.through,
                foreignKey: relDef.foreignKey,
                otherKey: relDef.otherKey
              };
              relationshipDef = relDef;
              log.trace('[BUILD-JOIN] Found many-to-many relationship:', { 
                relName, 
                targetScope, 
                through: relDef.through,
                foreignKey: relDef.foreignKey,
                otherKey: relDef.otherKey
              });
              break;
            }
            
            foundRelationship = targetScope;
            relationshipType = 'hasMany';
            relationshipField = relDef.foreignKey;
            if (!relationshipField) {
              log.error('[BUILD-JOIN] Missing foreignKey in hasMany relationship:', { relName, currentScope });
              throw new Error(`Missing foreignKey in hasMany relationship '${relName}' for scope '${currentScope}'`);
            }
            relationshipDef = relDef;
            log.trace('[BUILD-JOIN] Found hasMany relationship:', { relName, targetScope, foreignKey: relationshipField });
            break;
          }
        }
      }
      
      if (!foundRelationship) {
        for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
          if (fieldDef.belongsTo === targetScope) {
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
          `No searchable relationship from '${currentScope}' to '${targetScope}'. `
        );
      }
      
      const sourceSchema = scopes[currentScope].vars.schemaInfo.schema;
      const sourceTableName = scopes[currentScope].vars.schemaInfo.tableName
      const targetSchema = scopes[targetScope].vars.schemaInfo.schema;
      const targetTableName = scopes[targetScope].vars.schemaInfo.tableName
      
      if (relationshipType === 'manyToMany') {
        const { through, foreignKey, otherKey } = relationshipField;
        const pivotTableName = scopes[through].vars.schemaInfo.tableName || through;
        const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
        
        const pivotAlias = `${currentScope}_to_${through}_${through}`;
        const pivotJoinCondition = `${previousAlias}.id = ${pivotAlias}.${foreignKey}`;
        
        joinChain.push({
          targetTableName: pivotTableName,
          joinAlias: pivotAlias,
          joinCondition: pivotJoinCondition,
          isOneToMany: true,
          isPolymorphic: false,
          relationshipField: foreignKey,
          relationshipType: 'manyToMany_pivot'
        });
        
        const targetAlias = `${through}_to_${targetScope}_${targetScope}`;
        const targetJoinCondition = `${pivotAlias}.${otherKey} = ${targetAlias}.id`;
        
        joinChain.push({
          targetTableName,
          joinAlias: targetAlias,
          joinCondition: targetJoinCondition,
          isOneToMany: false,
          isPolymorphic: false,
          relationshipField: otherKey,
          relationshipType: 'manyToMany_target'
        });
      } else {
        const joinAlias = `${currentScope}_to_${targetScope}_${targetScope}`;
        
        let joinCondition;
        if (relationshipType === 'hasManyPolymorphic') {
          const { typeField, idField } = relationshipField;
          const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
          joinCondition = `${joinAlias}.${typeField} = '${currentScope}' AND ${joinAlias}.${idField} = ${previousAlias}.id`;
        } else if (relationshipType === 'hasMany') {
          const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
          joinCondition = `${previousAlias}.id = ${joinAlias}.${relationshipField}`;
        } else {
          const previousAlias = i === 0 ? sourceTableName : joinChain[i-1].joinAlias;
          joinCondition = `${previousAlias}.${relationshipField} = ${joinAlias}.id`;
        }
        
        joinChain.push({
          targetTableName,
          joinAlias,
          joinCondition,
          isOneToMany: relationshipType === 'hasMany' || relationshipType === 'hasManyPolymorphic',
          isPolymorphic: relationshipType === 'hasManyPolymorphic',
          relationshipField,
          relationshipType
        });
      }
      
      currentScope = targetScope;
    }
    
    const finalScope = relationshipPath[relationshipPath.length - 1];
    await validateCrossTableField(finalScope, targetFieldName, searchedScopes);
    
    if (joinChain.length === 0) {
      throw new Error(`Invalid path '${targetPath}': no relationships to traverse`);
    }
    
    const lastJoin = joinChain[joinChain.length - 1];
    
    if (joinChain.length > 1) {
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
      return {
        joinAlias: lastJoin.joinAlias,
        targetTableName: lastJoin.targetTableName,
        sourceField: lastJoin.relationshipField,
        targetField: targetFieldName,
        joinCondition: lastJoin.joinCondition,
        isOneToMany: lastJoin.isOneToMany,
        isPolymorphic: lastJoin.isPolymorphic
      };
    }
  };

  /**
   * Analyzes a search schema to identify which fields need database indexes
   * 
   * @param {string} scopeName - The scope being analyzed
   * @param {Object} searchSchema - Search schema definition with filter fields
   * @returns {Array<Object>} Array of required indexes with scope, field, and reason
   * 
   * @example
   * // Input: Search schema with cross-table references
   * const searchSchema = {
   *   authorName: { 
   *     type: 'string',
   *     actualField: 'authors.name',
   *     filterOperator: 'like'
   *   },
   *   companyName: {
   *     type: 'string', 
   *     actualField: 'authors.company.name'
   *   },
   *   search: { 
   *     type: 'string',
   *     oneOf: ['title', 'authors.name', 'authors.company.name']
   *   }
   * };
   * 
   * const requiredIndexes = analyzeRequiredIndexes('articles', searchSchema);
   * 
   * // Output: List of fields that need indexes
   * // [
   * //   { scope: 'authors', field: 'name', reason: 'Cross-table search from articles.authorName' },
   * //   { scope: 'authors', field: 'company', reason: 'Cross-table search from articles.companyName' },
   * //   { scope: 'authors', field: 'name', reason: 'Cross-table oneOf search from articles.search' },
   * //   { scope: 'authors', field: 'company', reason: 'Cross-table oneOf search from articles.search' }
   * // ]
   * 
   * @example
   * // Input: No cross-table references
   * const searchSchema = {
   *   title: { type: 'string' },
   *   status: { type: 'string' }
   * };
   * 
   * const requiredIndexes = analyzeRequiredIndexes('articles', searchSchema);
   * 
   * // Output: Empty array - no cross-table indexes needed
   * // []
   * 
   * @description
   * Used by:
   * - Called during API initialization to identify missing indexes
   * - Used by developers to understand performance requirements
   * 
   * Purpose:
   * - Cross-table searches require indexes for acceptable performance
   * - Helps identify configuration issues before they cause slow queries
   * - Provides clear documentation of index requirements
   * 
   * Data flow:
   * - Runs during schema compilation phase
   * - Analyzes search schemas to find cross-table references
   * - Output can be used to create indexes manually or automatically
   * - Prevents performance issues before queries are executed
   */
  const analyzeRequiredIndexes = (scopeName, searchSchema) => {
    const requiredIndexes = [];
    
    const schemaToAnalyze = searchSchema.structure || searchSchema;
    
    Object.entries(schemaToAnalyze).forEach(([filterKey, fieldDef]) => {
      if (fieldDef.actualField && fieldDef.actualField.includes('.')) {
        const [targetScopeName, targetFieldName] = fieldDef.actualField.split('.');
        requiredIndexes.push({
          scope: targetScopeName,
          field: targetFieldName,
          reason: `Cross-table search from ${scopeName}.${filterKey}`
        });
      }
      
      if (fieldDef.oneOf && Array.isArray(fieldDef.oneOf)) {
        fieldDef.oneOf.forEach(field => {
          if (field.includes('.')) {
            const [targetScopeName, targetFieldName] = field.split('.');
            requiredIndexes.push({
              scope: targetScopeName,
              field: targetFieldName,
              reason: `Cross-table oneOf search from ${scopeName}.${filterKey}`
            });
          }
        });
      }
    });
    
    return requiredIndexes;
  };

  /**
   * Creates database indexes for fields identified by analyzeRequiredIndexes
   * 
   * @async
   * @param {Array<Object>} requiredIndexes - Index requirements from analyzeRequiredIndexes
   * @param {Object} knex - Knex database connection instance
   * @returns {Promise<Array<Object>>} Array of successfully created indexes
   * 
   * @example
   * // Input: Required indexes from analysis
   * const requiredIndexes = [
   *   { scope: 'authors', field: 'name', reason: 'Cross-table search' },
   *   { scope: 'companies', field: 'name', reason: 'Cross-table search' }
   * ];
   * 
   * const createdIndexes = await createRequiredIndexes(requiredIndexes, knex);
   * 
   * // Output: Successfully created indexes
   * // [
   * //   { tableName: 'authors', field: 'name', indexName: 'idx_authors_name_search' },
   * //   { tableName: 'companies', field: 'name', indexName: 'idx_companies_name_search' }
   * // ]
   * 
   * // Database effect: CREATE INDEX idx_authors_name_search ON authors(name);
   * // Database effect: CREATE INDEX idx_companies_name_search ON companies(name);
   * 
   * @example
   * // Input: Some indexes already exist
   * const requiredIndexes = [
   *   { scope: 'authors', field: 'name', reason: 'Cross-table search' },  // Already exists
   *   { scope: 'authors', field: 'email', reason: 'Cross-table search' }  // New
   * ];
   * 
   * const createdIndexes = await createRequiredIndexes(requiredIndexes, knex);
   * 
   * // Output: Only newly created indexes
   * // [
   * //   { tableName: 'authors', field: 'email', indexName: 'idx_authors_email_search' }
   * // ]
   * 
   * @description
   * Used by:
   * - Can be called during database migration or setup
   * - Used by developers to automatically create performance indexes
   * 
   * Purpose:
   * - Automates index creation based on search schema requirements
   * - Ensures consistent index naming across the application
   * - Safely handles cases where indexes already exist
   * 
   * Data flow:
   * - Typically runs during database setup or migration
   * - Creates indexes identified by analyzeRequiredIndexes
   * - Improves query performance for cross-table searches
   * - Part of the database optimization phase
   */
  const createRequiredIndexes = async (requiredIndexes, knex) => {
    const createdIndexes = [];
    
    for (const indexInfo of requiredIndexes) {
      const { scope, field } = indexInfo;
      const schema = scopes[scope].vars.schemaInfo.schema;
      const tableName = scopes[scope].vars.schemaInfo.tableName
      const indexName = `idx_${tableName}_${field}_search`;
      
      try {
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

  return {
    validateCrossTableField,
    buildJoinChain,
    analyzeRequiredIndexes,
    createRequiredIndexes
  };
};