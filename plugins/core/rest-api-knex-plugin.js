
/**
 * REST API Knex Plugin - SQL Storage Implementation
 * 
 * This plugin provides SQL database operations for the REST API plugin using Knex.js.
 * It implements filtering, sorting, and pagination with a hook-based architecture.
 * 
 * ## Filtering System
 * 
 * Filtering is implemented via the 'knexQueryFiltering' hook, allowing extensibility.
 * 
 * ### IMPORTANT: Filter Grouping Best Practice
 * 
 * To prevent accidental filter bypass, ALWAYS wrap your filter conditions in a group
 * using query.where(function() { ... }):
 * 
 * ```javascript
 * addHook('knexQueryFiltering', 'myPlugin', {}, ({ query, filters }) => {
 *   query.where(function() {
 *     // All your conditions go inside this function
 *     this.where('tenant_id', getCurrentTenant());
 *     this.where('deleted_at', null);
 *     
 *     // Even OR conditions are safe when grouped
 *     if (filters.status) {
 *       this.where('status', filters.status)
 *           .orWhere('override_status', filters.status);
 *     }
 *   });
 * });
 * ```
 * 
 * This produces SQL like:
 * WHERE (existing conditions) AND (tenant_id = 123 AND deleted_at IS NULL AND (status = 'active' OR override_status = 'active'))
 * 
 * ### Why Grouping Matters
 * 
 * Without grouping, OR conditions can accidentally bypass security filters:
 * 
 * ❌ BAD (without grouping):
 * ```javascript
 * // Plugin A adds security filter
 * query.where('tenant_id', 123);
 * 
 * // Plugin B adds feature filter with OR
 * query.where('status', 'active').orWhere('featured', true);
 * ```
 * Result: WHERE tenant_id = 123 AND status = 'active' OR featured = true
 * This exposes ALL featured items regardless of tenant!
 * 
 * ✅ GOOD (with grouping):
 * ```javascript
 * // Plugin A adds security filter
 * query.where(function() { 
 *   this.where('tenant_id', 123);
 * });
 * 
 * // Plugin B adds feature filter with OR
 * query.where(function() { 
 *   this.where('status', 'active').orWhere('featured', true);
 * });
 * ```
 * Result: WHERE (tenant_id = 123) AND (status = 'active' OR featured = true)
 * Only shows active or featured items from tenant 123!
 * 
 * ### Core searchSchema Filter
 * 
 * The built-in searchSchema filter handles various filter types:
 * 
 * 1. Basic equality filtering: { status: 'published' } => WHERE status = 'published'
 * 2. Operator-based filtering via 'filterUsing':
 *    - 'like': Contains search => WHERE field LIKE '%value%'
 *    - '>', '<', '>=', '<=': Comparison operators
 *    - 'in': Array values => WHERE field IN (...)
 *    - 'between': Range values => WHERE field BETWEEN x AND y
 * 
 * 3. Multi-field search via 'likeOneOf':
 *    searchSchema: {
 *      search: {
 *        type: 'string',
 *        likeOneOf: ['title', 'body', 'tags']
 *      }
 *    }
 *    => WHERE (title LIKE '%value%' OR body LIKE '%value%' OR tags LIKE '%value%')
 * 
 * 4. Custom filters via 'applyFilter' function:
 *    searchSchema: {
 *      complexSearch: {
 *        type: 'string',
 *        applyFilter: (query, value) => {
 *          // IMPORTANT: Use grouping for safety!
 *          query.where(function() {
 *            this.whereRaw('MATCH(title, body) AGAINST (?)', [value]);
 *          });
 *        }
 *      }
 *    }
 * 
 * 5. Field mapping via 'actualField':
 *    searchSchema: {
 *      publishedAfter: {
 *        type: 'date',
 *        actualField: 'published_at',
 *        filterUsing: '>='
 *      }
 *    }
 * 
 * ## Cross-Table Search (NEW FEATURE)
 * 
 * The plugin now supports searching across related tables using JOIN operations.
 * This allows you to filter records based on fields in related tables.
 * 
 * ### Requirements for Cross-Table Search
 * 
 * 1. **Indexed Fields**: Target fields must be marked with `indexed: true` in their schema
 * 2. **Relationship Configuration**: Source table must have a `belongsTo` relationship with `sideSearch: true`
 * 3. **Explicit Configuration**: No "magic" - all relationships must be explicitly defined
 * 
 * ### Basic Cross-Table Search Syntax
 * 
 * #### Many-to-One Search (belongsTo)
 * ```javascript
 * // In articles scope, search by author name
 * searchSchema: {
 *   authorName: {
 *     type: 'string',
 *     actualField: 'people.name',  // Reference to people.name field
 *     filterUsing: 'like'
 *   }
 * }
 * 
 * // Requires: articles.author_id belongsTo people with sideSearch: true
 * // Requires: people.name has indexed: true
 * ```
 * 
 * #### One-to-Many Search (hasMany)
 * ```javascript
 * // In people scope, search by their article titles
 * searchSchema: {
 *   articleTitle: {
 *     type: 'string',
 *     actualField: 'articles.title',  // Reference to articles.title field
 *     filterUsing: 'like'
 *   }
 * }
 * 
 * // Requires: people scope has relationships: { articles: { hasMany: 'articles', sideSearch: true } }
 * // Requires: articles.title has indexed: true
 * ```
 * 
 * ### Multi-Field Cross-Table Search
 * 
 * ```javascript
 * // Search across multiple fields, including cross-table
 * searchSchema: {
 *   search: {
 *     type: 'string',
 *     likeOneOf: [
 *       'title',              // Local field
 *       'body',               // Local field
 *       'people.name',        // Cross-table field
 *       'people.email'        // Cross-table field
 *     ]
 *   }
 * }
 * ```
 * 
 * ### Schema Configuration for Cross-Table Search
 * 
 * #### Many-to-One: Articles → People (belongsTo)
 * ```javascript
 * const articlesSchema = {
 *   id: { type: 'id' },
 *   title: { type: 'string' },
 *   body: { type: 'string' },
 *   
 *   // This belongsTo relationship enables cross-table search
 *   author_id: { 
 *     belongsTo: 'people', 
 *     as: 'author',
 *     sideLoad: true,    // Enable loading related records
 *     sideSearch: true   // Enable searching by related fields
 *   }
 * }
 * 
 * const peopleSchema = {
 *   id: { type: 'id' },
 *   name: { type: 'string', indexed: true },    // indexed: true required!
 *   email: { type: 'string', indexed: true },   // indexed: true required!
 *   bio: { type: 'string' }                     // Not indexed = not searchable
 * }
 * ```
 * 
 * #### One-to-Many: People → Articles (hasMany)
 * ```javascript
 * // People scope configuration
 * api.scope('people', {
 *   schema: peopleSchema,
 *   relationships: {
 *     articles: { 
 *       hasMany: 'articles', 
 *       foreignKey: 'author_id',  // Field in articles table
 *       sideLoad: true,           // Enable loading related records
 *       sideSearch: true          // Enable searching by related fields
 *     }
 *   }
 * });
 * 
 * const articlesSchema = {
 *   id: { type: 'id' },
 *   title: { type: 'string', indexed: true },   // indexed: true required for cross-table search!
 *   body: { type: 'string', indexed: true },
 *   author_id: { belongsTo: 'people', as: 'author' }
 * }
 * ```
 * 
 * ### Complete Example: 3-Level Cross-Table Search
 * 
 * ```javascript
 * // Database structure:
 * // articles.author_id -> people.id
 * // people.company_id -> companies.id
 * 
 * // Articles schema
 * const articlesSchema = {
 *   id: { type: 'id' },
 *   title: { type: 'string' },
 *   author_id: { 
 *     belongsTo: 'people', 
 *     as: 'author',
 *     sideSearch: true 
 *   }
 * }
 * 
 * // People schema
 * const peopleSchema = {
 *   id: { type: 'id' },
 *   name: { type: 'string', indexed: true },
 *   company_id: { 
 *     belongsTo: 'companies', 
 *     as: 'company',
 *     sideSearch: true 
 *   }
 * }
 * 
 * // Companies schema
 * const companiesSchema = {
 *   id: { type: 'id' },
 *   name: { type: 'string', indexed: true },
 *   industry: { type: 'string', indexed: true }
 * }
 * 
 * // Articles searchSchema (enables 3-level search)
 * const articlesSearchSchema = {
 *   authorName: {
 *     type: 'string',
 *     actualField: 'people.name',
 *     filterUsing: 'like'
 *   },
 *   
 *   // Multi-level search: articles -> people -> companies
 *   search: {
 *     type: 'string',
 *     likeOneOf: [
 *       'title',
 *       'people.name',
 *       'companies.name'  // 3-level: articles->people->companies
 *     ]
 *   }
 * }
 * ```
 * 
 * ### Generated SQL Examples
 * 
 * #### Many-to-One Search (articles → people)
 * For query: `GET /articles?filter[authorName]=john`
 * 
 * ```sql
 * SELECT articles.* 
 * FROM articles 
 * LEFT JOIN people AS articles_to_people_people ON articles.author_id = articles_to_people_people.id
 * WHERE (articles_to_people_people.name LIKE '%john%')
 * ```
 * 
 * #### One-to-Many Search (people → articles)
 * For query: `GET /people?filter[articleTitle]=javascript`
 * 
 * ```sql
 * SELECT people.* 
 * FROM people 
 * LEFT JOIN articles AS people_to_articles_articles ON people.id = articles.author_id
 * WHERE (people_to_articles_articles.title LIKE '%javascript%')
 * ```
 * 
 * #### Multi-Level Search (articles → people → companies)
 * For query: `GET /articles?filter[search]=tech`
 * 
 * ```sql
 * SELECT articles.* 
 * FROM articles 
 * LEFT JOIN people AS articles_to_people_people ON articles.author_id = articles_to_people_people.id
 * LEFT JOIN companies AS articles_to_companies_companies ON articles_to_people_people.company_id = articles_to_companies_companies.id
 * WHERE (
 *   articles.title LIKE '%tech%' OR 
 *   articles_to_people_people.name LIKE '%tech%' OR 
 *   articles_to_companies_companies.name LIKE '%tech%'
 * )
 * ```
 * 
 * ### Automatic Index Analysis
 * 
 * The plugin automatically analyzes your searchSchema and identifies required database indexes:
 * 
 * ```javascript
 * // Enable automatic index creation (optional)
 * api.crossTableSearch.createRequiredIndexes([
 *   { scope: 'people', field: 'name', reason: 'Cross-table search from articles' },
 *   { scope: 'companies', field: 'name', reason: 'Cross-table search from articles' }
 * ]);
 * ```
 * 
 * ### Error Handling
 * 
 * The plugin provides comprehensive error messages for misconfigurations:
 * 
 * - `Field 'people.name' is not indexed` - Add `indexed: true` to the field
 * - `No searchable relationship found` - Add `belongsTo` with `sideSearch: true`
 * - `Circular reference detected` - Check for infinite loops in relationships
 * - `Target scope 'people' not found` - Verify scope names are correct
 * 
 * ### Security Considerations
 * 
 * - Only indexed fields can be searched across tables (prevents performance issues)
 * - Relationships must be explicitly configured (no automatic discovery)
 * - All filter conditions are properly grouped to prevent SQL injection
 * - JOIN operations use proper aliasing to prevent conflicts
 * 
 * ## Real-World Hook Examples
 * 
 * ### Multi-tenant Security Filter
 * ```javascript
 * addHook('knexQueryFiltering', 'tenantSecurity', { order: -100 }, ({ query }) => {
 *   query.where(function() {
 *     this.where('tenant_id', getCurrentTenant())
 *         .where('deleted_at', null);
 *   });
 * });
 * ```
 * 
 * ### Region-based Filtering with Fallback
 * ```javascript
 * addHook('knexQueryFiltering', 'regionFilter', {}, ({ query, filters }) => {
 *   query.where(function() {
 *     const userRegion = getUserRegion();
 *     this.where(function() {
 *       this.where('region', userRegion)
 *           .orWhere('region', 'global')
 *           .orWhereNull('region');
 *     });
 *   });
 * });
 * ```
 * 
 * ### Complex Permission System
 * ```javascript
 * addHook('knexQueryFiltering', 'permissions', {}, ({ query, scopeName }) => {
 *   if (scopeName === 'documents') {
 *     query.where(function() {
 *       const userId = getCurrentUser().id;
 *       const userGroups = getCurrentUser().groups;
 *       
 *       // User can see: their own docs, public docs, or group docs they belong to
 *       this.where('owner_id', userId)
 *           .orWhere('visibility', 'public')
 *           .orWhere(function() {
 *             this.where('visibility', 'group')
 *                 .whereIn('group_id', userGroups);
 *           });
 *     });
 *   }
 * });
 * ```
 * 
 * ### Advanced Search with Multiple Conditions
 * ```javascript
 * addHook('knexQueryFiltering', 'advancedSearch', {}, ({ query, filters }) => {
 *   if (filters.q) {
 *     query.where(function() {
 *       // Full-text search across multiple fields
 *       const searchTerm = `%${filters.q}%`;
 *       this.where('title', 'like', searchTerm)
 *           .orWhere('description', 'like', searchTerm)
 *           .orWhere('tags', 'like', searchTerm);
 *     });
 *   }
 *   
 *   if (filters.priceRange) {
 *     query.where(function() {
 *       const [min, max] = filters.priceRange;
 *       this.whereBetween('price', [min, max]);
 *     });
 *   }
 * });
 * ```
 * 
 * ## Direct Knex Access
 * 
 * The plugin exposes Knex directly via api.knex for advanced use cases:
 * 
 * const results = await api.knex('articles')
 *   .join('users', 'articles.author_id', 'users.id')
 *   .where('status', 'published')
 *   .select('articles.*', 'users.name as author_name');
 * 
 * ## Cross-Table Search Helper Functions
 * 
 * The plugin exposes helper functions via api.crossTableSearch:
 * 
 * ```javascript
 * // Validate a cross-table field reference
 * api.crossTableSearch.validateCrossTableField('people', 'name');
 * 
 * // Build join chain for complex relationships
 * const joinInfo = api.crossTableSearch.buildJoinChain('articles', 'people.name');
 * 
 * // Analyze required indexes for a searchSchema
 * const indexes = api.crossTableSearch.analyzeRequiredIndexes('articles', searchSchema);
 * 
 * // Create required database indexes
 * await api.crossTableSearch.createRequiredIndexes(indexes);
 * ```
 */

export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install({ helpers, vars, pluginOptions, api, log, scopes, addHook, runHooks }) {
    
    // Get Knex configuration from plugin options
    const knexOptions = pluginOptions.knex || pluginOptions['rest-api-knex'];
    if (!knexOptions || !knexOptions.knex) {
      throw new Error('RestApiKnexPlugin requires a knex instance in pluginOptions');
    }
    
    const knex = knexOptions.knex;
    
    // Expose Knex directly for advanced use cases
    api.knex = knex;
    
    // Helper to get table name for a scope
    const getTableName = (scopeName) => {
      const scopeOptions = scopes[scopeName]?.options || {};
      return scopeOptions.tableName || scopeName;
    };
    
    // Cross-table search helper functions
    const crossTableSearchHelpers = {
      // Validates that a field reference is allowed for cross-table search
      validateCrossTableField: (targetScopeName, fieldName, searchedScopes = new Set()) => {
        // Prevent circular references
        if (searchedScopes.has(targetScopeName)) {
          throw new Error(`Circular reference detected: ${targetScopeName} -> ${Array.from(searchedScopes).join(' -> ')}`);
        }
        
        const targetScope = scopes[targetScopeName];
        if (!targetScope) {
          throw new Error(`Target scope '${targetScopeName}' not found`);
        }
        
        const targetSchema = targetScope.options.schema;
        if (!targetSchema) {
          throw new Error(`Target scope '${targetScopeName}' has no schema`);
        }
        
        const fieldDef = targetSchema[fieldName];
        if (!fieldDef) {
          throw new Error(`Field '${fieldName}' not found in scope '${targetScopeName}'`);
        }
        
        // Check if field is marked as indexed (required for cross-table search)
        if (!fieldDef.indexed) {
          throw new Error(`Field '${targetScopeName}.${fieldName}' is not indexed. Add 'indexed: true' to allow cross-table search`);
        }
        
        return { targetScope, fieldDef };
      },
      
      // Builds join chain for cross-table search with proper aliasing
      buildJoinChain: (fromScopeName, targetPath, searchedScopes = new Set()) => {
        const pathParts = targetPath.split('.');
        if (pathParts.length !== 2) {
          throw new Error(`Invalid cross-table path '${targetPath}'. Use format: 'targetScope.fieldName'`);
        }
        
        const [targetScopeName, targetFieldName] = pathParts;
        
        // Validate the target field
        crossTableSearchHelpers.validateCrossTableField(targetScopeName, targetFieldName, searchedScopes);
        
        // Find the relationship path from source to target
        const sourceScopeOptions = scopes[fromScopeName]?.options;
        if (!sourceScopeOptions) {
          throw new Error(`Source scope '${fromScopeName}' not found`);
        }
        
        const sourceSchema = sourceScopeOptions.schema;
        if (!sourceSchema) {
          throw new Error(`Source scope '${fromScopeName}' has no schema`);
        }
        
        // Look for a belongsTo relationship to the target scope (many-to-one)
        let relationshipField = null;
        let relationshipConfig = null;
        let isOneToMany = false;
        
        for (const [fieldName, fieldDef] of Object.entries(sourceSchema)) {
          if (fieldDef.belongsTo === targetScopeName) {
            // Check if this relationship allows side search
            if (fieldDef.sideSearch !== true) {
              throw new Error(`Relationship '${fromScopeName}.${fieldName}' to '${targetScopeName}' does not allow side search. Add 'sideSearch: true' to enable`);
            }
            relationshipField = fieldName;
            relationshipConfig = fieldDef;
            break;
          }
        }
        
        // If no belongsTo found, look for hasMany relationship (one-to-many)
        if (!relationshipField) {
          const relationships = sourceScopeOptions.relationships || {};
          
          for (const [relName, relDef] of Object.entries(relationships)) {
            if (relDef.hasMany === targetScopeName && relDef.sideSearch === true) {
              // For hasMany, the foreign key is in the target table pointing to source
              relationshipField = relDef.foreignKey || `${fromScopeName.slice(0, -1)}_id`;
              relationshipConfig = relDef;
              isOneToMany = true;
              break;
            }
          }
        }
        
        if (!relationshipField) {
          throw new Error(
            `No searchable relationship found from '${fromScopeName}' to '${targetScopeName}'. ` +
            `Add either:\n` +
            `  1. A belongsTo relationship with 'sideSearch: true' in schema, or\n` +
            `  2. A hasMany relationship with 'sideSearch: true' in relationships config`
          );
        }
        
        // Generate unique alias for this join to prevent conflicts
        const pathId = `${fromScopeName}_to_${targetScopeName}`;
        const joinAlias = `${pathId}_${targetScopeName}`;
        
        // Get table names
        const sourceTableName = sourceSchema.tableName || fromScopeName;
        const targetTableName = scopes[targetScopeName].options.schema.tableName || targetScopeName;
        
        // Build join condition based on relationship direction
        let joinCondition;
        if (isOneToMany) {
          // One-to-many: source.id = target.foreign_key
          joinCondition = `${sourceTableName}.id = ${joinAlias}.${relationshipField}`;
        } else {
          // Many-to-one: source.foreign_key = target.id
          joinCondition = `${sourceTableName}.${relationshipField} = ${joinAlias}.id`;
        }
        
        return {
          joinAlias,
          targetTableName,
          sourceField: relationshipField,
          targetField: targetFieldName,
          joinCondition,
          isOneToMany
        };
      },
      
      // Creates index analysis for required database indexes
      analyzeRequiredIndexes: (scopeName, searchSchema) => {
        const requiredIndexes = [];
        
        if (!searchSchema) return requiredIndexes;
        
        Object.entries(searchSchema).forEach(([filterKey, fieldDef]) => {
          // Check for cross-table references
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
      },
      
      // Auto-generates database indexes for cross-table search fields
      createRequiredIndexes: async (requiredIndexes) => {
        const createdIndexes = [];
        
        for (const indexInfo of requiredIndexes) {
          const { scope, field } = indexInfo;
          const tableName = scopes[scope]?.options?.schema?.tableName || scope;
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
      }
    };
    
    // Register the enhanced searchSchema filter hook with cross-table search support
    addHook('knexQueryFiltering', 'searchSchemaFilter', {}, 
      async ({ query, filters, searchSchema, scopeName }) => {
        if (!filters || !searchSchema) return;
        
        // Analyze and optionally create required indexes
        const requiredIndexes = crossTableSearchHelpers.analyzeRequiredIndexes(scopeName, searchSchema);
        if (requiredIndexes.length > 0) {
          log.debug(`Cross-table search requires indexes:`, requiredIndexes);
          // Uncomment to auto-create indexes:
          // await crossTableSearchHelpers.createRequiredIndexes(requiredIndexes);
        }
        
        // Build join map for cross-table searches
        const joinMap = new Map();
        
        // Pre-process searchSchema to identify required joins
        Object.entries(searchSchema).forEach(([filterKey, fieldDef]) => {
          // Check actualField for cross-table references
          if (fieldDef.actualField && fieldDef.actualField.includes('.')) {
            const joinInfo = crossTableSearchHelpers.buildJoinChain(scopeName, fieldDef.actualField);
            joinMap.set(joinInfo.joinAlias, joinInfo);
          }
          
          // Check likeOneOf for cross-table references
          if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
            fieldDef.likeOneOf.forEach(field => {
              if (field.includes('.')) {
                const joinInfo = crossTableSearchHelpers.buildJoinChain(scopeName, field);
                joinMap.set(joinInfo.joinAlias, joinInfo);
              }
            });
          }
        });
        
        // Apply all required joins
        joinMap.forEach((joinInfo) => {
          query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, 
            joinInfo.joinCondition);
        });
        
        // Wrap all searchSchema filters in a group for safety
        // This prevents any OR conditions from escaping and affecting other filters
        query.where(function() {
          Object.entries(filters).forEach(([filterKey, filterValue]) => {
            const fieldDef = searchSchema[filterKey];
            if (!fieldDef) return; // Ignore unknown filters
            
            // Use switch-case for clean filter logic
            switch (true) {
              // Handle multi-field OR search via likeOneOf
              case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
                // This creates a sub-group within our main group
                this.where(function() {
                  fieldDef.likeOneOf.forEach((field, index) => {
                    let dbField = field;
                    
                    // Handle cross-table field references
                    if (field.includes('.')) {
                      const joinInfo = crossTableSearchHelpers.buildJoinChain(scopeName, field);
                      dbField = `${joinInfo.joinAlias}.${joinInfo.targetField}`;
                    }
                    
                    if (index === 0) {
                      this.where(dbField, 'like', `%${filterValue}%`);
                    } else {
                      this.orWhere(dbField, 'like', `%${filterValue}%`);
                    }
                  });
                });
                break;
                
              // Handle custom filter function
              case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
                // Pass 'this' context to applyFilter so it operates within our group
                fieldDef.applyFilter.call(this, this, filterValue);
                break;
                
              // Standard filtering with operators (including cross-table)
              default:
                let dbField = fieldDef.actualField || filterKey;
                
                // Handle cross-table field references
                if (dbField.includes('.')) {
                  const joinInfo = crossTableSearchHelpers.buildJoinChain(scopeName, dbField);
                  dbField = `${joinInfo.joinAlias}.${joinInfo.targetField}`;
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
          });
        });
      }
    );
    
    // Expose cross-table search helpers for advanced usage
    api.crossTableSearch = crossTableSearchHelpers;
    
    // Helper to convert DB record to JSON:API format
    const toJsonApi = (scopeName, record) => {
      if (!record) return null;
      
      const idProperty = vars.idProperty || 'id';
      const { [idProperty]: id, ...attributes } = record;
      
      return {
        type: scopeName,
        id: String(id),
        attributes
      };
    };

    // EXISTS - check if a record exists by ID
    helpers.dataExists = async ({ scopeName, id, idProperty, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProp = idProperty || vars.idProperty || 'id';
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      const record = await knex(tableName)
        .where(idProp, id)
        .select(idProp)
        .first();
      
      return !!record;
    };

    // GET - retrieve a single record by ID
    helpers.dataGet = async ({ scopeName, id, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] GET ${tableName}/${id}`);
      
      const record = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!record) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      return {
        data: toJsonApi(scopeName, record)
      };
    };
    
    // QUERY - retrieve multiple records
    helpers.dataQuery = async function({ scopeName, queryParams = {}, searchSchema, runHooks }) {
      const tableName = getTableName(scopeName);
      const scope = scopes[scopeName];
      const scopeOptions = scope?.options || {};
      const sortableFields = scopeOptions.sortableFields || vars.sortableFields;
      
      log.debug(`[Knex] QUERY ${tableName}`, queryParams);
      
      // Start building the query
      let query = knex(tableName);
      
      // Run filtering hooks
      // IMPORTANT: Each hook should wrap its conditions in query.where(function() {...})
      // to ensure proper grouping and prevent accidental filter bypass.
      // See plugin documentation for examples and best practices.
      await runHooks('knexQueryFiltering', {
        query,
        filters: queryParams.filter,
        searchSchema,
        scopeName,
        tableName
      });
      
      // Apply sorting directly (no hooks)
      if (queryParams.sort && queryParams.sort.length > 0) {
        queryParams.sort.forEach(sortField => {
          const desc = sortField.startsWith('-');
          const field = desc ? sortField.substring(1) : sortField;
          
          // Check if field is sortable
          if (sortableFields && sortableFields.length > 0 && !sortableFields.includes(field)) {
            log.warn(`Ignoring non-sortable field: ${field}`);
            return; // Skip non-sortable fields
          }
          
          query.orderBy(field, desc ? 'desc' : 'asc');
        });
      }
      
      // Apply pagination directly (no hooks)
      if (queryParams.page) {
        const pageSize = Math.min(
          queryParams.page.size || vars.pageSize || 20,
          vars.maxPageSize || 100
        );
        const pageNumber = queryParams.page.number || 1;
        
        query
          .limit(pageSize)
          .offset((pageNumber - 1) * pageSize);
      }
      
      // Execute the query
      const records = await query;
      
      return {
        data: records.map(record => toJsonApi(scopeName, record))
      };
    };
    
    // POST - create a new record
    helpers.dataPost = async ({ scopeName, inputRecord, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] POST ${tableName}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Insert and get the new ID
      const [id] = await knex(tableName).insert(attributes).returning(idProperty);
      
      // Fetch the created record
      const newRecord = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: toJsonApi(scopeName, newRecord)
      };
    };
    
    // PUT - replace an entire record or create if it doesn't exist
    helpers.dataPut = async ({ scopeName, id, inputRecord, isCreate, idProperty, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProp = idProperty || vars.idProperty || 'id';
      
      log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${isCreate})`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      if (isCreate) {
        // Create mode - insert new record with specified ID
        const recordData = {
          ...attributes,
          [idProp]: id
        };
        
        await knex(tableName).insert(recordData);
        
        // Fetch the created record
        const newRecord = await knex(tableName)
          .where(idProp, id)
          .first();
        
        return {
          data: toJsonApi(scopeName, newRecord)
        };
      } else {
        // Update mode - check if record exists first
        const exists = await knex(tableName)
          .where(idProp, id)
          .first();
        
        if (!exists) {
          const error = new Error(`Record not found: ${scopeName}/${id}`);
          error.code = 'REST_API_RESOURCE';
          error.subtype = 'not_found';
          throw error;
        }
        
        // Update the record (replace all fields)
        await knex(tableName)
          .where(idProp, id)
          .update(attributes);
        
        // Fetch the updated record
        const updatedRecord = await knex(tableName)
          .where(idProp, id)
          .first();
        
        return {
          data: toJsonApi(scopeName, updatedRecord)
        };
      }
    };
    
    // PATCH - partially update a record
    helpers.dataPatch = async ({ scopeName, id, inputRecord, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] PATCH ${tableName}/${id}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Check if record exists
      const exists = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Update only provided fields
      await knex(tableName)
        .where(idProperty, id)
        .update(attributes);
      
      // Fetch the updated record
      const updatedRecord = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: toJsonApi(scopeName, updatedRecord)
      };
    };
    
    // DELETE - remove a record
    helpers.dataDelete = async ({ scopeName, id, runHooks }) => {
      const tableName = getTableName(scopeName);
      const idProperty = vars.idProperty || 'id';
      
      log.debug(`[Knex] DELETE ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await knex(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Delete the record
      await knex(tableName)
        .where(idProperty, id)
        .delete();
      
      return { success: true };
    };
    
    log.info('RestApiKnexPlugin installed - basic CRUD operations ready');
  }
}