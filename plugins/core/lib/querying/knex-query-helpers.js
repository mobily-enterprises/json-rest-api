import { analyzeRequiredIndexes, buildJoinChain } from './knex-cross-table-search.js';

/**
 * Processes filters that target polymorphic relationships where a single relationship can point to different types of resources
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example
 * // Input: Search schema with polymorphic filter
 * const searchSchema = {
 *   commentable_title: {
 *     type: 'string',
 *     polymorphicField: 'commentable',  // Points to the polymorphic relationship
 *     targetFields: {
 *       posts: 'title',      // When commentable_type='posts', search posts.title
 *       videos: 'title',     // When commentable_type='videos', search videos.title  
 *       articles: 'headline' // When commentable_type='articles', search articles.headline
 *     },
 *     filterOperator: 'like'
 *   }
 * };
 * 
 * // Filter request: { commentable_title: 'JavaScript' }
 * 
 * // Result: Adds conditional LEFT JOINs and WHERE conditions
 * // SQL generated:
 * // LEFT JOIN posts ON comments.commentable_type = 'posts' AND comments.commentable_id = posts.id
 * // LEFT JOIN videos ON comments.commentable_type = 'videos' AND comments.commentable_id = videos.id
 * // LEFT JOIN articles ON comments.commentable_type = 'articles' AND comments.commentable_id = articles.id
 * // WHERE (
 * //   (comments.commentable_type = 'posts' AND posts.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'videos' AND videos.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'articles' AND articles.headline LIKE '%JavaScript%')
 * // )
 * 
 * @example
 * // Input: Complex polymorphic filter with cross-table paths
 * const searchSchema = {
 *   commentable_author: {
 *     type: 'string',
 *     polymorphicField: 'commentable',
 *     targetFields: {
 *       posts: 'author.name',     // Search post author's name
 *       videos: 'creator.name'    // Search video creator's name
 *     }
 *   }
 * };
 * 
 * // Result: Creates nested JOINs for each polymorphic type
 * // LEFT JOIN posts ON comments.commentable_type = 'posts' AND comments.commentable_id = posts.id
 * // LEFT JOIN users AS posts_author ON posts.author_id = posts_author.id
 * // LEFT JOIN videos ON comments.commentable_type = 'videos' AND comments.commentable_id = videos.id
 * // LEFT JOIN users AS videos_creator ON videos.creator_id = videos_creator.id
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook first during query building
 * - Must run before other filter hooks to establish JOINs
 * - Applied when searchSchema contains polymorphicField definitions
 * 
 * Purpose:
 * - Enables filtering on polymorphic relationships without knowing the concrete type
 * - Searches across multiple tables with a single filter parameter
 * - Supports queries like "find all comments on content containing 'JavaScript'"
 * - Uses conditional JOINs that only match when type field equals expected value
 * - Maintains performance by leveraging indexed type/id columns
 * 
 * Data flow:
 * 1. Identifies filters with polymorphicField in searchSchema
 * 2. For each polymorphic type, adds conditional LEFT JOIN
 * 3. Builds OR conditions checking type field and target field together
 * 4. Sets hasJoins flag for subsequent hooks
 * 5. Returns modified query with polymorphic search capabilities
 */
export const polymorphicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchemaInstance = hookParams.context?.knexQuery?.searchSchemaInstance;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchemaInstance) {
    return;
  }

  // Step 1: Identify polymorphic searches
  const polymorphicSearches = new Map();
  const polymorphicJoins = new Map();

  for (const [filterKey, filterValue] of Object.entries(filters)) {
    const fieldDef = searchSchemaInstance.structure[filterKey];

    if (fieldDef?.polymorphicField && fieldDef?.targetFields && filterValue !== undefined) {
      log.trace('[POLYMORPHIC-SEARCH] Found polymorphic search:', { 
        filterKey, 
        polymorphicField: fieldDef.polymorphicField 
      });
      
      polymorphicSearches.set(filterKey, {
        fieldDef,
        filterValue,
        polymorphicField: fieldDef.polymorphicField
      });
    }
  }

  if (polymorphicSearches.size === 0) {
    return;
  }

  // Step 2: Build polymorphic JOINs
  log.trace('[POLYMORPHIC-SEARCH] Building JOINs for polymorphic searches');
  
  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { fieldDef, polymorphicField } = searchInfo;
    
    // Get the relationship definition
    const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships;
    const polyRel = relationships[polymorphicField];
    
    if (!polyRel?.belongsToPolymorphic) {
      throw new Error(
        `Polymorphic field '${polymorphicField}' not found in relationships for scope '${scopeName}'`
      );
    }
    
    const { typeField, idField } = polyRel.belongsToPolymorphic;
    
    // Build JOINs for each target type
    for (const [targetType, targetFieldPath] of Object.entries(fieldDef.targetFields)) {
      const baseAlias = `${tableName}_${polymorphicField}_${targetType}`;
      
      // Skip if we already added this JOIN
      if (!polymorphicJoins.has(baseAlias)) {
        const targetSchema = scopes[targetType].vars.schemaInfo.schemaInstance;;
        const targetTable = targetSchema?.tableName || targetType;
        
        log.trace('[POLYMORPHIC-SEARCH] Adding conditional JOIN:', { 
          targetType, 
          alias: baseAlias 
        });
        
        // Conditional JOIN - only matches when type is correct
        query.leftJoin(`${targetTable} as ${baseAlias}`, function() {
          this.on(`${tableName}.${typeField}`, db.raw('?', [targetType]))
              .andOn(`${tableName}.${idField}`, `${baseAlias}.id`);
        });
        
        polymorphicJoins.set(baseAlias, {
          targetType,
          targetTable,
          targetFieldPath
        });
        
        // Handle cross-table paths
        if (targetFieldPath.includes('.')) {
          log.trace('[POLYMORPHIC-SEARCH] Building cross-table JOINs for path:', targetFieldPath);
          
          const pathParts = targetFieldPath.split('.');
          let currentAlias = baseAlias;
          let currentScope = targetType;
          
          // Build JOIN for each segment except the last
          for (let i = 0; i < pathParts.length - 1; i++) {
            const relationshipName = pathParts[i];
            
            // Find the foreign key for this relationship
            const currentSchema = scopes[currentScope].vars.schemaInfo.schemaInstance;
            let foreignKeyField = null;
            let nextScope = null;
            
            // Search schema for matching belongsTo
            for (const [fieldName, fieldDef] of Object.entries(currentSchema.structure)) {
              if (fieldDef.as === relationshipName && fieldDef.belongsTo) {
                foreignKeyField = fieldName;
                nextScope = fieldDef.belongsTo;
                break;
              }
            }
            
            if (!foreignKeyField) {
              // Check relationships for hasOne
              const currentRelationships = scopes[currentScope].vars.schemaInfo.schemaRelationships
              const rel = currentRelationships?.[relationshipName];
              if (rel?.hasOne) {
                // Handle hasOne - more complex
                throw new Error(
                  `Cross-table polymorphic search through hasOne relationships not yet supported`
                );
              }
              
              throw new Error(
                `Cannot resolve relationship '${relationshipName}' in path '${targetFieldPath}' for scope '${currentScope}'`
              );
            }
            
            // Build next JOIN
            const nextAlias = `${currentAlias}_${relationshipName}`;
            const nextSchema = scopes[nextScope].vars.schemaInfo.schemaInstance;
            const nextTable = nextSchema?.tableName || nextScope;
            
            log.trace('[POLYMORPHIC-SEARCH] Adding cross-table JOIN:', { 
              from: currentAlias, 
              to: nextAlias,
              table: nextTable 
            });
            
            query.leftJoin(`${nextTable} as ${nextAlias}`, 
              `${currentAlias}.${foreignKeyField}`, 
              `${nextAlias}.id`
            );
            
            currentAlias = nextAlias;
            currentScope = nextScope;
          }
        }
      }
    }
  }

  // Pre-fetch relationships for WHERE clause processing
  const polymorphicRelationships = new Map();
  const relationships = scopes[scopeName].vars.schemaInfo.schemaRelationships
  for (const [filterKey, searchInfo] of polymorphicSearches) {
    const { polymorphicField } = searchInfo;
    const polyRel = relationships[polymorphicField];
    if (polyRel?.belongsToPolymorphic) {
      polymorphicRelationships.set(filterKey, polyRel);
    }
  }

  // Mark that we have JOINs for other hooks
  hookParams.context.knexQuery.hasJoins = true;

  // Step 3: Apply WHERE conditions
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      if (!polymorphicSearches.has(filterKey)) continue;

      const searchInfo = polymorphicSearches.get(filterKey);
      const polyRel = polymorphicRelationships.get(filterKey);
      if (!polyRel) continue;

      const { typeField } = polyRel.belongsToPolymorphic;

      // Build OR conditions for each possible type
      this.where(function() {
        for (const [targetType, targetFieldPath] of Object.entries(searchInfo.fieldDef.targetFields)) {
          this.orWhere(function() {
            // First check the type matches
            this.where(`${tableName}.${typeField}`, targetType);

            // Then apply the field filter
            const baseAlias = `${tableName}_${searchInfo.polymorphicField}_${targetType}`;

            if (targetFieldPath.includes('.')) {
              // Complex path
              const pathParts = targetFieldPath.split('.');
              const fieldName = pathParts[pathParts.length - 1];

              let finalAlias = baseAlias;
              for (let i = 0; i < pathParts.length - 1; i++) {
                finalAlias = `${finalAlias}_${pathParts[i]}`;
              }

              const operator = searchInfo.fieldDef.filterOperator || '=';
              if (operator === 'like') {
                this.where(`${finalAlias}.${fieldName}`, 'like', `%${searchInfo.filterValue}%`);
              } else {
                this.where(`${finalAlias}.${fieldName}`, operator, searchInfo.filterValue);
              }
            } else {
              // Direct field
              const operator = searchInfo.fieldDef.filterOperator || '=';
              if (operator === 'like') {
                this.where(`${baseAlias}.${targetFieldPath}`, 'like', `%${searchInfo.filterValue}%`);
              } else {
                this.where(`${baseAlias}.${targetFieldPath}`, operator, searchInfo.filterValue);
              }
            }
          });
        }
      });
    }
  });
};

/**
 * Processes filters that require JOINs to access fields in related tables using dot notation
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example
 * // Input: Simple cross-table filter
 * const searchSchema = {
 *   author_name: {
 *     type: 'string',
 *     actualField: 'author.name',  // Dot notation indicates JOIN needed
 *     filterOperator: 'like'
 *   }
 * };
 * 
 * // Filter request: { author_name: 'Smith' }
 * // Query before: SELECT * FROM articles
 * 
 * // Result: Adds JOIN and qualified WHERE
 * // Query after:
 * // SELECT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // WHERE articles_author.name LIKE '%Smith%'
 * 
 * @example
 * // Input: Multi-field search across tables
 * const searchSchema = {
 *   search: {
 *     type: 'string',
 *     oneOf: [
 *       'title',           // Local field
 *       'content',         // Local field
 *       'author.name',     // Requires JOIN to users
 *       'category.title'   // Requires JOIN to categories
 *     ],
 *     filterOperator: 'like'
 *   }
 * };
 * 
 * // Filter request: { search: 'JavaScript' }
 * 
 * // Result: Multiple JOINs and OR conditions
 * // SELECT DISTINCT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // LEFT JOIN categories AS articles_category ON articles.category_id = articles_category.id
 * // WHERE (
 * //   articles.title LIKE '%JavaScript%' OR
 * //   articles.content LIKE '%JavaScript%' OR
 * //   articles_author.name LIKE '%JavaScript%' OR
 * //   articles_category.title LIKE '%JavaScript%'
 * // )
 * 
 * @example
 * // Input: Deep nested relationships (3 levels)
 * const searchSchema = {
 *   company_country: {
 *     type: 'string',
 *     actualField: 'author.company.country.name'
 *   }
 * };
 * 
 * // Filter request: { company_country: 'USA' }
 * 
 * // Result: Chain of JOINs following relationships
 * // SELECT * FROM articles
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // LEFT JOIN companies AS articles_author_company ON articles_author.company_id = articles_author_company.id
 * // LEFT JOIN countries AS articles_author_company_country ON articles_author_company.country_id = articles_author_company_country.id
 * // WHERE articles_author_company_country.name = 'USA'
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook second during query building
 * - Runs after polymorphicFiltersHook but before basicFiltersHook
 * - Applied when filters contain dot notation in actualField or oneOf
 * 
 * Purpose:
 * - Enables filtering on related table fields without manual JOIN writing
 * - Automatically builds JOIN chains from dot notation paths
 * - Detects one-to-many relationships and adds DISTINCT to prevent duplicates
 * - Creates unique aliases to avoid naming conflicts
 * - Validates that target fields are indexed for performance
 * 
 * Data flow:
 * 1. Scans filters for dot notation in actualField or oneOf arrays
 * 2. For each cross-table reference, builds JOIN chain via buildJoinChain
 * 3. Applies JOINs to query with proper aliasing
 * 4. Adds DISTINCT if any one-to-many JOINs detected
 * 5. Applies WHERE conditions using qualified field names
 * 6. Sets hasJoins flag for basicFiltersHook to use
 */
export const crossTableFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchemaInstance = hookParams.context?.knexQuery?.searchSchemaInstance;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchemaInstance) {
    return;
  }

  // Step 1: Analyze indexes
  const requiredIndexes = analyzeRequiredIndexes(scopes, log, scopeName, searchSchemaInstance);
  if (requiredIndexes.length > 0) {
    log.debug(`Cross-table search requires indexes:`, requiredIndexes);
  }

  // Step 2: Build JOIN maps
  const joinMap = new Map();
  const fieldPathMap = new Map();
  let hasCrossTableFilters = false;

  for (const [filterKey, fieldDef] of Object.entries(searchSchemaInstance.structure)) {
    if (filters[filterKey] === undefined) continue;

    // Skip polymorphic filters
    if (fieldDef.polymorphicField) continue;

    // Check actualField for cross-table references
    if (fieldDef.actualField?.includes('.')) {
      hasCrossTableFilters = true;
      log.trace('[JOIN-DETECTION] Cross-table actualField found', { filterKey, actualField: fieldDef.actualField, scopeName });
      const joinInfo = await buildJoinChain(scopes, log, scopeName, fieldDef.actualField);
      if (!joinMap.has(joinInfo.joinAlias)) {
        joinMap.set(joinInfo.joinAlias, joinInfo);
      }
      fieldPathMap.set(fieldDef.actualField, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
    }

    // Check oneOf for cross-table references
    if (fieldDef.oneOf && Array.isArray(fieldDef.oneOf)) {
      for (const field of fieldDef.oneOf) {
        if (field.includes('.')) {
          hasCrossTableFilters = true;
          log.trace('[JOIN-DETECTION] Cross-table oneOf field found', { filterKey, field, scopeName });
          const joinInfo = await buildJoinChain(scopes, log, scopeName, field);
          if (!joinMap.has(joinInfo.joinAlias)) {
            joinMap.set(joinInfo.joinAlias, joinInfo);
          }
          fieldPathMap.set(field, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
        }
      }
    }
  }

  if (!hasCrossTableFilters) {
    return;
  }

  // Step 3: Apply JOINs
  const appliedJoins = new Set();

  joinMap.forEach((joinInfo) => {
    if (joinInfo.isMultiLevel && joinInfo.joinChain) {
      joinInfo.joinChain.forEach((join) => {
        const joinKey = `${join.joinAlias}:${join.joinCondition}`;
        if (!appliedJoins.has(joinKey)) {
          // Check if this is a polymorphic join with AND condition
          if (join.isPolymorphic && join.joinCondition.includes(' AND ')) {
            query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function() {
              // Parse polymorphic condition: type_field = 'value' AND id_field = parent.id
              const parts = join.joinCondition.split(' AND ');
              const [typeCondition, idCondition] = parts;
              
              // Extract the type field and value from first part
              const typeMatch = typeCondition.match(/(.+?)\s*=\s*'(.+?)'/);
              if (typeMatch) {
                const typeField = typeMatch[1].trim();
                const typeValue = typeMatch[2];
                this.on(typeField, db.raw('?', [typeValue]));
              }
              
              // Extract the id fields from second part
              const idMatch = idCondition.match(/(.+?)\s*=\s*(.+)/);
              if (idMatch) {
                this.andOn(idMatch[1].trim(), idMatch[2].trim());
              }
            });
          } else {
            const [leftSide, rightSide] = join.joinCondition.split(' = ');
            query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function() {
              this.on(leftSide, rightSide);
            });
          }
          appliedJoins.add(joinKey);
        }
      });
    } else {
      const joinKey = `${joinInfo.joinAlias}:${joinInfo.joinCondition}`;
      if (!appliedJoins.has(joinKey)) {
        // Check if this is a polymorphic join with AND condition
        if (joinInfo.isPolymorphic && joinInfo.joinCondition.includes(' AND ')) {
          query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, function() {
            // Parse polymorphic condition: type_field = 'value' AND id_field = parent.id
            const parts = joinInfo.joinCondition.split(' AND ');
            const [typeCondition, idCondition] = parts;
            
            // Extract the type field and value from first part
            const typeMatch = typeCondition.match(/(.+?)\s*=\s*'(.+?)'/);
            if (typeMatch) {
              const typeField = typeMatch[1].trim();
              const typeValue = typeMatch[2];
              this.on(typeField, db.raw('?', [typeValue]));
            }
            
            // Extract the id fields from second part
            const idMatch = idCondition.match(/(.+?)\s*=\s*(.+)/);
            if (idMatch) {
              this.andOn(idMatch[1].trim(), idMatch[2].trim());
            }
          });
        } else {
          const [leftSide, rightSide] = joinInfo.joinCondition.split(' = ');
          query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, function() {
            this.on(leftSide, rightSide);
          });
        }
        appliedJoins.add(joinKey);
      }
    }
  });

  // Step 4: Handle DISTINCT
  let hasOneToManyJoins = false;
  joinMap.forEach((joinInfo) => {
    if (joinInfo.isOneToMany) {
      hasOneToManyJoins = true;
    } else if (joinInfo.isMultiLevel && joinInfo.joinChain) {
      joinInfo.joinChain.forEach(join => {
        if (join.isOneToMany) hasOneToManyJoins = true;
      });
    }
  });

  if (hasOneToManyJoins) {
    log.trace('[DISTINCT] Adding DISTINCT to query due to one-to-many JOINs');
    query.distinct();
  }

  // Store state for basic filters hook
  hookParams.context.knexQuery.hasJoins = true;

  // Step 5: Apply WHERE conditions for cross-table filters
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = searchSchemaInstance.structure[filterKey];
      if (!fieldDef) continue;

      // Skip non-cross-table and polymorphic filters
      if (fieldDef.polymorphicField) continue;
      if (!fieldDef.actualField?.includes('.') &&
          !fieldDef.oneOf?.some(f => f.includes('.'))) {
        continue;
      }

      // Process cross-table filters
      switch (true) {
        case fieldDef.oneOf && Array.isArray(fieldDef.oneOf): {
          const operator = fieldDef.filterOperator || '=';
          
          // Handle split search terms
          let searchTerms = [filterValue];
          if (fieldDef.splitBy && typeof filterValue === 'string') {
            searchTerms = filterValue.split(fieldDef.splitBy).filter(term => term.trim());
          }
          
          this.where(function() {
            if (fieldDef.matchAll && searchTerms.length > 1) {
              // AND logic - all terms must match
              searchTerms.forEach(term => {
                this.andWhere(function() {
                  fieldDef.oneOf.forEach((field, index) => {
                    const dbField = fieldPathMap.get(field) ||
                                   (!field.includes('.') && joinMap.size > 0 ? `${tableName}.${field}` : field);
                    
                    if (operator === 'like') {
                      const condition = `%${term}%`;
                      if (index === 0) {
                        this.where(dbField, 'like', condition);
                      } else {
                        this.orWhere(dbField, 'like', condition);
                      }
                    } else {
                      if (index === 0) {
                        this.where(dbField, operator, term);
                      } else {
                        this.orWhere(dbField, operator, term);
                      }
                    }
                  });
                });
              });
            } else {
              // OR logic for single term or matchAll=false
              fieldDef.oneOf.forEach((field, index) => {
                const dbField = fieldPathMap.get(field) ||
                               (!field.includes('.') && joinMap.size > 0 ? `${tableName}.${field}` : field);
                
                if (operator === 'like') {
                  const condition = `%${filterValue}%`;
                  if (index === 0) {
                    this.where(dbField, 'like', condition);
                  } else {
                    this.orWhere(dbField, 'like', condition);
                  }
                } else {
                  if (index === 0) {
                    this.where(dbField, operator, filterValue);
                  } else {
                    this.orWhere(dbField, operator, filterValue);
                  }
                }
              });
            }
          });
          break;
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          let dbField = fieldDef.actualField || filterKey;
          if (dbField.includes('.')) {
            dbField = fieldPathMap.get(dbField) || dbField;
          }

          const operator = fieldDef.filterOperator || '=';

          switch (operator) {
            case 'like':
              this.where(dbField, 'like', `%${filterValue}%`);
              break;
            case 'in':
              if (Array.isArray(filterValue)) {
                this.whereIn(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            case 'between':
              if (Array.isArray(filterValue) && filterValue.length === 2) {
                this.whereBetween(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
            default:
              this.where(dbField, operator, filterValue);
              break;
          }
          break;
      }
    }
  });
};

/**
 * Processes filters that apply directly to fields on the main table
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example
 * // Input: Basic equality filter
 * const searchSchema = {
 *   status: {
 *     type: 'string',
 *     filterOperator: '='  // Default is '=' if not specified
 *   }
 * };
 * 
 * // Filter request: { status: 'published' }
 * // Query before: SELECT * FROM articles
 * 
 * // Result: Adds qualified WHERE clause
 * // Query after: SELECT * FROM articles WHERE articles.status = 'published'
 * 
 * @example
 * // Input: LIKE filter for partial text matching
 * const searchSchema = {
 *   title: {
 *     type: 'string',
 *     filterOperator: 'like'
 *   },
 *   content: {
 *     type: 'string',
 *     filterOperator: 'like'
 *   }
 * };
 * 
 * // Filter request: { title: 'JavaScript', content: 'async' }
 * 
 * // Result: Multiple LIKE conditions
 * // WHERE articles.title LIKE '%JavaScript%' 
 * // AND articles.content LIKE '%async%'
 * 
 * @example
 * // Input: Multi-field OR search with oneOf
 * const searchSchema = {
 *   search: {
 *     type: 'string',
 *     oneOf: ['title', 'content', 'summary'],
 *     filterOperator: 'like',
 *     splitBy: ' ',        // Split search terms by space
 *     matchAll: true       // All terms must match somewhere
 *   }
 * };
 * 
 * // Filter request: { search: 'REST API' }
 * 
 * // Result: Each term must match in at least one field
 * // WHERE (
 * //   (articles.title LIKE '%REST%' OR articles.content LIKE '%REST%' OR articles.summary LIKE '%REST%')
 * //   AND
 * //   (articles.title LIKE '%API%' OR articles.content LIKE '%API%' OR articles.summary LIKE '%API%')
 * // )
 * 
 * @example
 * // Input: Advanced operators - IN and BETWEEN
 * const searchSchema = {
 *   category_id: {
 *     type: 'array',
 *     filterOperator: 'in'
 *   },
 *   price: {
 *     type: 'array',
 *     filterOperator: 'between'
 *   },
 *   tags: {
 *     type: 'array',
 *     filterOperator: 'in'
 *   }
 * };
 * 
 * // Filter request: { 
 * //   category_id: [1, 2, 3],
 * //   price: [10.00, 99.99],
 * //   tags: ['javascript', 'nodejs']
 * // }
 * 
 * // Result: IN and BETWEEN clauses
 * // WHERE articles.category_id IN (1, 2, 3)
 * // AND articles.price BETWEEN 10.00 AND 99.99  
 * // AND articles.tags IN ('javascript', 'nodejs')
 * 
 * @example
 * // Input: Custom filter function
 * const searchSchema = {
 *   has_comments: {
 *     type: 'boolean',
 *     applyFilter: function(query, value) {
 *       if (value === true) {
 *         query.whereExists(function() {
 *           this.select('id')
 *               .from('comments')
 *               .whereRaw('comments.article_id = articles.id');
 *         });
 *       } else if (value === false) {
 *         query.whereNotExists(function() {
 *           this.select('id')
 *               .from('comments')
 *               .whereRaw('comments.article_id = articles.id');
 *         });
 *       }
 *     }
 *   }
 * };
 * 
 * // Filter request: { has_comments: true }
 * 
 * // Result: Subquery to check existence
 * // WHERE EXISTS (
 * //   SELECT id FROM comments WHERE comments.article_id = articles.id
 * // )
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin calls this hook last during query building
 * - Runs after all JOINs have been established by previous hooks
 * - Handles all non-cross-table, non-polymorphic filters
 * 
 * Purpose:
 * - Implements standard SQL filtering operations safely via Knex
 * - Always qualifies field names with table name to prevent ambiguity
 * - Supports various operators: =, like, in, between, and custom
 * - Enables multi-field OR searches with optional term splitting
 * - Handles null values appropriately (using whereNull)
 * - Allows custom filter logic via applyFilter functions
 * 
 * Data flow:
 * 1. Skips filters already handled by polymorphic/cross-table hooks
 * 2. Qualifies all field names with table name (e.g., articles.title)
 * 3. Applies appropriate WHERE clause based on filterOperator
 * 4. For oneOf filters, creates OR conditions across specified fields
 * 5. For custom filters, delegates to applyFilter function
 * 6. Returns query with all basic filters applied
 */
export const basicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchemaInstance = hookParams.context?.knexQuery?.searchSchemaInstance;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  log.trace('[DEBUG basicFiltersHook] Called with:', {
    scopeName,
    hasFilters: !!filters,
    filters,
    hasSearchSchema: !!searchSchemaInstance,
    searchSchemaKeys: searchSchemaInstance ? Object.keys(searchSchemaInstance.structure || {}) : [],
    tableName
  });

  if (!filters || !searchSchemaInstance) {
    log.trace('[DEBUG basicFiltersHook] Returning early - no filters or searchSchema');
    return;
  }

  // Check if we have any JOINs applied (to know if we need to qualify fields)
  // Instead of relying on hasJoins flag, always qualify fields for safety
  const qualifyField = (field) => {
    return `${tableName}.${field}`;
  };

  // Main WHERE group
  query.where(function() {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      const fieldDef = searchSchemaInstance.structure[filterKey];
      if (!fieldDef) {
        log.trace(`[DEBUG basicFiltersHook] No field definition for filter key: ${filterKey}`);
        continue;
      }
      log.trace(`[DEBUG basicFiltersHook] Processing filter: ${filterKey} = ${filterValue}, fieldDef:`, fieldDef);

      // Skip if this is a cross-table filter
      if (fieldDef.actualField?.includes('.') ||
          fieldDef.oneOf?.some(f => f.includes('.')) ||
          fieldDef.polymorphicField) {
        log.trace(`[DEBUG basicFiltersHook] Skipping filter ${filterKey} - is cross-table or polymorphic`);
        continue;
      }

      // Process basic filters
      switch (true) {
        case fieldDef.oneOf && Array.isArray(fieldDef.oneOf): {
          // Multi-field OR search
          const operator = fieldDef.filterOperator || '=';
          
          // Handle split search terms
          let searchTerms = [filterValue];
          if (fieldDef.splitBy && typeof filterValue === 'string') {
            searchTerms = filterValue.split(fieldDef.splitBy).filter(term => term.trim());
          }
          
          this.where(function() {
            if (fieldDef.matchAll && searchTerms.length > 1) {
              // AND logic - all terms must match
              searchTerms.forEach(term => {
                this.andWhere(function() {
                  fieldDef.oneOf.forEach((field, index) => {
                    // Always qualify field names
                    const dbField = qualifyField(field);
                    
                    if (operator === 'like') {
                      const condition = `%${term}%`;
                      if (index === 0) {
                        this.where(dbField, 'like', condition);
                      } else {
                        this.orWhere(dbField, 'like', condition);
                      }
                    } else {
                      if (index === 0) {
                        this.where(dbField, operator, term);
                      } else {
                        this.orWhere(dbField, operator, term);
                      }
                    }
                  });
                });
              });
            } else {
              // OR logic for single term or matchAll=false
              fieldDef.oneOf.forEach((field, index) => {
                // Always qualify field names
                const dbField = qualifyField(field);
                
                if (operator === 'like') {
                  const condition = `%${filterValue}%`;
                  if (index === 0) {
                    this.where(dbField, 'like', condition);
                  } else {
                    this.orWhere(dbField, 'like', condition);
                  }
                } else {
                  if (index === 0) {
                    this.where(dbField, operator, filterValue);
                  } else {
                    this.orWhere(dbField, operator, filterValue);
                  }
                }
              });
            }
          });
          break;
        }

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          // Custom filter
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          // Standard filtering
          const actualField = fieldDef.actualField || filterKey;
          // Always qualify field names
          const dbField = qualifyField(actualField);

          const operator = fieldDef.filterOperator || '=';
          log.trace(`[DEBUG basicFiltersHook] Applying filter: ${dbField} ${operator} ${filterValue}`);

          switch (operator) {
            case 'like':
              this.where(dbField, 'like', `%${filterValue}%`);
              break;
            case 'in':
              if (Array.isArray(filterValue)) {
                this.whereIn(dbField, filterValue);
              } else {
                // Handle null values for 'in' operator
                if (filterValue === null) {
                  this.whereNull(dbField);
                } else {
                  this.where(dbField, operator, filterValue);
                }
              }
              break;
            case 'between':
              if (Array.isArray(filterValue) && filterValue.length === 2) {
                this.whereBetween(dbField, filterValue);
              } else {
                // Handle null values for 'between' operator
                if (filterValue === null) {
                  this.whereNull(dbField);
                } else {
                  this.where(dbField, operator, filterValue);
                }
              }
              break;
            default:
              // Handle null values specially
              if (filterValue === null) {
                this.whereNull(dbField);
              } else {
                this.where(dbField, operator, filterValue);
              }
              break;
          }
          break;
      }
    }
  });
};