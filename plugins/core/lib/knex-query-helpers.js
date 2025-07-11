/**
 * @module knex-query-helpers
 * @description Knex query filter hooks for complex SQL query building
 * 
 * This module contains three separate hooks for filtering queries:
 * 1. polymorphicFiltersHook - Handles polymorphic relationship filters
 * 2. crossTableFiltersHook - Handles filters requiring JOINs
 * 3. basicFiltersHook - Handles basic filters on the main table
 * 
 * These hooks are designed to run in this specific order to ensure
 * proper field qualification when JOINs are present. They implement
 * sophisticated query building patterns to handle complex filtering
 * scenarios while maintaining SQL injection safety and performance.
 * 
 * Why this is useful upstream:
 * - Enables filtering on polymorphic relationships (e.g., find all comments on posts by John)
 * - Supports cross-table filtering without N+1 queries
 * - Automatically adds JOINs based on filter requirements
 * - Handles field qualification to prevent ambiguous column errors
 * - Provides extensible hook system for custom filter logic
 * - Maintains SQL injection safety through parameterized queries
 */

/**
 * Hook 1: Polymorphic Filters Hook
 * 
 * Processes filters that target polymorphic relationships, where a single
 * relationship can point to different types of resources. This hook adds
 * conditional JOINs for each possible type and applies OR conditions to
 * search across all of them. Must run first to establish JOINs before
 * other hooks process their filters.
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example <caption>Polymorphic filter in searchSchema</caption>
 * // Find comments where the commentable item has 'JavaScript' in the title
 * searchSchema: {
 *   commentable_title: {
 *     type: 'string',
 *     polymorphicField: 'commentable',  // The polymorphic relationship
 *     targetFields: {
 *       posts: 'title',      // When commentable_type='posts', search posts.title
 *       videos: 'title',     // When commentable_type='videos', search videos.title
 *       articles: 'headline' // When commentable_type='articles', search articles.headline
 *     },
 *     filterUsing: 'like'
 *   }
 * }
 * 
 * @example <caption>Generated SQL for polymorphic search</caption>
 * // For filter: { commentable_title: 'JavaScript' }
 * // Generates:
 * // LEFT JOIN posts ON comments.commentable_type = 'posts' AND comments.commentable_id = posts.id
 * // LEFT JOIN videos ON comments.commentable_type = 'videos' AND comments.commentable_id = videos.id
 * // LEFT JOIN articles ON comments.commentable_type = 'articles' AND comments.commentable_id = articles.id
 * // WHERE (
 * //   (comments.commentable_type = 'posts' AND posts.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'videos' AND videos.title LIKE '%JavaScript%') OR
 * //   (comments.commentable_type = 'articles' AND articles.headline LIKE '%JavaScript%')
 * // )
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Enable filtering on polymorphic relationships without knowing the type
 * // 2. Search across multiple tables with a single filter parameter
 * // 3. Support complex queries like "find all comments on content by John"
 * // 4. Handle conditional JOINs that only match when type is correct
 * // 5. Maintain query performance by using indexed type/id columns
 */
export const polymorphicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
    return;
  }

  // Step 1: Identify polymorphic searches
  const polymorphicSearches = new Map();
  const polymorphicJoins = new Map();

  for (const [filterKey, filterValue] of Object.entries(filters)) {
    const fieldDef = searchSchema.structure[filterKey];

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
        const targetSchema = scopes[targetType].vars.schemaInfo.schema;;
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
            const currentSchema = scopes[currentScope].vars.schemaInfo.schema;
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
            const nextSchema = scopes[nextScope].vars.schemaInfo.schema;
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

              const operator = searchInfo.fieldDef.filterUsing || '=';
              if (operator === 'like') {
                this.where(`${finalAlias}.${fieldName}`, 'like', `%${searchInfo.filterValue}%`);
              } else {
                this.where(`${finalAlias}.${fieldName}`, operator, searchInfo.filterValue);
              }
            } else {
              // Direct field
              const operator = searchInfo.fieldDef.filterUsing || '=';
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
 * Hook 2: Cross-Table Filters Hook
 * 
 * Processes filters that require JOINs to access fields in related tables.
 * This hook handles dot-notation field paths (e.g., 'author.name') by building
 * the necessary JOIN chain and applying filters on the joined tables. It also
 * handles DISTINCT when one-to-many JOINs are detected to prevent duplicate results.
 * Must run after polymorphic but before basic to ensure hasJoins flag is set.
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example <caption>Cross-table filter with actualField</caption>
 * // Find articles where the author's name contains 'Smith'
 * searchSchema: {
 *   author_name: {
 *     type: 'string',
 *     actualField: 'author.name',  // Dot notation for cross-table access
 *     filterUsing: 'like'
 *   }
 * }
 * // Generates:
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // WHERE articles_author.name LIKE '%Smith%'
 * 
 * @example <caption>Multi-field search across tables with likeOneOf</caption>
 * searchSchema: {
 *   search: {
 *     type: 'string',
 *     likeOneOf: [
 *       'title',           // Search in articles.title
 *       'content',         // Search in articles.content
 *       'author.name',     // Search in joined users.name
 *       'category.title'   // Search in joined categories.title
 *     ]
 *   }
 * }
 * // For filter: { search: 'JavaScript' }
 * // Generates multiple JOINs and OR conditions across all fields
 * 
 * @example <caption>Deep nested relationships</caption>
 * searchSchema: {
 *   company_country: {
 *     type: 'string',
 *     actualField: 'author.company.country.name',  // 3-level deep
 *     filterUsing: '='
 *   }
 * }
 * // Generates chain of JOINs:
 * // LEFT JOIN users AS articles_author ON articles.author_id = articles_author.id
 * // LEFT JOIN companies AS articles_author_company ON articles_author.company_id = articles_author_company.id
 * // LEFT JOIN countries AS articles_author_company_country ON articles_author_company.country_id = articles_author_company_country.id
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Enable filtering on related table fields without manual JOINs
 * // 2. Support deep relationship traversal with dot notation
 * // 3. Automatically detect and handle one-to-many JOINs with DISTINCT
 * // 4. Build optimized JOIN chains with proper aliasing
 * // 5. Enable powerful search across multiple related tables
 * // 6. Maintain clean API design - clients don't need to know about JOINs
 */
export const crossTableFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex, crossTableSearchHelpers } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
    return;
  }

  // Step 1: Analyze indexes
  const requiredIndexes = crossTableSearchHelpers.analyzeRequiredIndexes(scopeName, searchSchema);
  if (requiredIndexes.length > 0) {
    log.debug(`Cross-table search requires indexes:`, requiredIndexes);
  }

  // Step 2: Build JOIN maps
  const joinMap = new Map();
  const fieldPathMap = new Map();
  let hasCrossTableFilters = false;

  for (const [filterKey, fieldDef] of Object.entries(searchSchema.structure)) {
    if (filters[filterKey] === undefined) continue;

    // Skip polymorphic filters
    if (fieldDef.polymorphicField) continue;

    // Check actualField for cross-table references
    if (fieldDef.actualField?.includes('.')) {
      hasCrossTableFilters = true;
      log.trace('[JOIN-DETECTION] Cross-table actualField found', { filterKey, actualField: fieldDef.actualField, scopeName });
      const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, fieldDef.actualField);
      if (!joinMap.has(joinInfo.joinAlias)) {
        joinMap.set(joinInfo.joinAlias, joinInfo);
      }
      fieldPathMap.set(fieldDef.actualField, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
    }

    // Check likeOneOf for cross-table references
    if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
      for (const field of fieldDef.likeOneOf) {
        if (field.includes('.')) {
          hasCrossTableFilters = true;
          log.trace('[JOIN-DETECTION] Cross-table likeOneOf field found', { filterKey, field, scopeName });
          const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, field);
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
          const [leftSide, rightSide] = join.joinCondition.split(' = ');
          query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function() {
            this.on(leftSide, rightSide);
          });
          appliedJoins.add(joinKey);
        }
      });
    } else {
      const joinKey = `${joinInfo.joinAlias}:${joinInfo.joinCondition}`;
      if (!appliedJoins.has(joinKey)) {
        const [leftSide, rightSide] = joinInfo.joinCondition.split(' = ');
        query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, function() {
          this.on(leftSide, rightSide);
        });
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
      const fieldDef = searchSchema.structure[filterKey];
      if (!fieldDef) continue;

      // Skip non-cross-table and polymorphic filters
      if (fieldDef.polymorphicField) continue;
      if (!fieldDef.actualField?.includes('.') &&
          !fieldDef.likeOneOf?.some(f => f.includes('.'))) {
        continue;
      }

      // Process cross-table filters
      switch (true) {
        case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
          this.where(function() {
            fieldDef.likeOneOf.forEach((field, index) => {
              const dbField = fieldPathMap.get(field) ||
                             (!field.includes('.') && joinMap.size > 0 ? `${tableName}.${field}` : field);
              const condition = `%${filterValue}%`;

              if (index === 0) {
                this.where(dbField, 'like', condition);
              } else {
                this.orWhere(dbField, 'like', condition);
              }
            });
          });
          break;

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          let dbField = fieldDef.actualField || filterKey;
          if (dbField.includes('.')) {
            dbField = fieldPathMap.get(dbField) || dbField;
          }

          const operator = fieldDef.filterUsing || '=';

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
 * Hook 3: Basic Filters Hook
 * 
 * Processes filters that apply directly to fields on the main table.
 * This hook handles standard filtering operations like equality, LIKE,
 * IN, BETWEEN, etc. It automatically qualifies field names with the table
 * name when JOINs are present to prevent ambiguous column errors.
 * Must run last to ensure all JOINs have been established.
 * 
 * @param {Object} hookParams - Hook parameters containing context
 * @param {Object} dependencies - Dependencies injected by the plugin
 * 
 * @example <caption>Basic equality filter</caption>
 * searchSchema: {
 *   status: {
 *     type: 'string',
 *     filterUsing: '='  // Exact match
 *   }
 * }
 * // For filter: { status: 'published' }
 * // Generates: WHERE articles.status = 'published'
 * 
 * @example <caption>LIKE filter for partial matches</caption>
 * searchSchema: {
 *   title: {
 *     type: 'string',
 *     filterUsing: 'like'
 *   }
 * }
 * // For filter: { title: 'JavaScript' }
 * // Generates: WHERE articles.title LIKE '%JavaScript%'
 * 
 * @example <caption>Multi-field OR search with likeOneOf</caption>
 * searchSchema: {
 *   search: {
 *     type: 'string',
 *     likeOneOf: ['title', 'content', 'summary']
 *   }
 * }
 * // For filter: { search: 'API' }
 * // Generates: WHERE (
 * //   articles.title LIKE '%API%' OR 
 * //   articles.content LIKE '%API%' OR 
 * //   articles.summary LIKE '%API%'
 * // )
 * 
 * @example <caption>Advanced filters - IN and BETWEEN</caption>
 * searchSchema: {
 *   category_id: {
 *     type: 'array',
 *     filterUsing: 'in'
 *   },
 *   created_at: {
 *     type: 'array',
 *     filterUsing: 'between'
 *   }
 * }
 * // For filters: { 
 * //   category_id: [1, 2, 3],
 * //   created_at: ['2024-01-01', '2024-12-31']
 * // }
 * // Generates:
 * // WHERE articles.category_id IN (1, 2, 3)
 * // AND articles.created_at BETWEEN '2024-01-01' AND '2024-12-31'
 * 
 * @example <caption>Custom filter function</caption>
 * searchSchema: {
 *   has_comments: {
 *     type: 'boolean',
 *     applyFilter: function(query, value) {
 *       if (value) {
 *         query.whereExists(function() {
 *           this.select('id')
 *               .from('comments')
 *               .whereRaw('comments.article_id = articles.id');
 *         });
 *       }
 *     }
 *   }
 * }
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Implement standard SQL filtering operations safely
 * // 2. Automatically qualify fields to prevent ambiguous column errors
 * // 3. Support multiple filter operators (=, like, in, between, etc.)
 * // 4. Enable multi-field OR searches with likeOneOf
 * // 5. Allow custom filter logic through applyFilter functions
 * // 6. Maintain SQL injection safety through Knex query builder
 */
export const basicFiltersHook = async (hookParams, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  // Extract context
  const scopeName = hookParams.context?.knexQuery?.scopeName;
  const filters = hookParams.context?.knexQuery?.filters;
  const searchSchema = hookParams.context?.knexQuery?.searchSchema;
  const query = hookParams.context?.knexQuery?.query;
  const tableName = hookParams.context?.knexQuery?.tableName;
  const db = hookParams.context?.knexQuery?.db || knex;

  if (!filters || !searchSchema) {
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
      const fieldDef = searchSchema.structure[filterKey];
      if (!fieldDef) continue;

      // Skip if this is a cross-table filter
      if (fieldDef.actualField?.includes('.') ||
          fieldDef.likeOneOf?.some(f => f.includes('.')) ||
          fieldDef.polymorphicField) {
        continue;
      }

      // Process basic filters
      switch (true) {
        case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
          // Multi-field OR search
          this.where(function() {
            fieldDef.likeOneOf.forEach((field, index) => {
              // Always qualify field names
              const dbField = qualifyField(field);
              const condition = `%${filterValue}%`;

              if (index === 0) {
                this.where(dbField, 'like', condition);
              } else {
                this.orWhere(dbField, 'like', condition);
              }
            });
          });
          break;

        case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
          // Custom filter
          fieldDef.applyFilter.call(this, this, filterValue);
          break;

        default:
          // Standard filtering
          const actualField = fieldDef.actualField || filterKey;
          // Always qualify field names
          const dbField = qualifyField(actualField);

          const operator = fieldDef.filterUsing || '=';

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