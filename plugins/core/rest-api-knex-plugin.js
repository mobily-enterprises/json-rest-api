
import { createCrossTableSearchHelpers } from './lib/cross-table-search.js';
import { createRelationshipIncludeHelpers } from './lib/relationship-includes.js';

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

  async install({ helpers, vars, pluginOptions, api, log, scopes, addHook }) {
    
    // Get Knex configuration from plugin options
    const knexOptions = pluginOptions.knex || pluginOptions['rest-api-knex'];
    if (!knexOptions || !knexOptions.knex) {
      throw new Error('RestApiKnexPlugin requires a knex instance in pluginOptions');
    }
    
    const knex = knexOptions.knex;
    
    // Expose Knex directly for advanced use cases
    api.knex = knex;
    
    // Helper to get table name for a scope
    const getTableName = async (scopeName) => {
      const schema = await scopes[scopeName].getSchema();
      return schema?.tableName || scopeName;
    };
    
    // Initialize cross-table search helpers
    const crossTableSearchHelpers = createCrossTableSearchHelpers(scopes, log);
    
    // Initialize relationship include helpers
    const relationshipIncludeHelpers = createRelationshipIncludeHelpers(scopes, log, knex);
    
    // Register the enhanced searchSchema filter hook with cross-table search support
    addHook('knexQueryFiltering', 'searchSchemaFilter', {}, 
      async (hookParams) => {
        log.trace('[CROSS-TABLE-SEARCH] Hook inspection', { scopeName: hookParams.scopeName, hasMethodParams: !!hookParams.methodParams, hasContext: !!hookParams.context });
        
        // Try to access the searchSchema from scopeOptions
        log.trace('[CROSS-TABLE-SEARCH] Checking scopeOptions', { hasSearchSchema: !!hookParams.scopeOptions?.searchSchema });
        
        // Extract the data from the context we actually receive
        const scopeName = hookParams.context?.knexQuery?.scopeName
        // const scopeName = hookParams.scopeName; // this would be identical
        
        log.trace('[CROSS-TABLE-SEARCH] Method params inspection', { hasFilter: !!hookParams.methodParams?.queryParams?.filter });

        const filters = hookParams.context?.knexQuery?.filters;
        const searchSchema = hookParams.context?.knexQuery?.searchSchema;
        const query = hookParams.context?.knexQuery?.query;
        const tableName = hookParams.context?.knexQuery?.tableName;


        log.trace('[CROSS-TABLE-SEARCH] Extracted from hook context', { scopeName, hasFilters: !!filters, hasSearchSchema: !!searchSchema });
        
        if (!filters || !searchSchema) {
          log.trace('[CROSS-TABLE-SEARCH] Early return - missing filters or searchSchema');
          return;
        }
        
        // We need to get the query object somehow - let's see if we can access it through helpers
        log.trace('[CROSS-TABLE-SEARCH] Looking for query object in context');
        log.trace('[CROSS-TABLE-SEARCH] Available in hookParams', { hasKnexQuery: !!hookParams.context?.knexQuery });
        
        // Analyze and optionally create required indexes
        const requiredIndexes = crossTableSearchHelpers.analyzeRequiredIndexes(scopeName, searchSchema);
        if (requiredIndexes.length > 0) {
          log.debug(`Cross-table search requires indexes:`, requiredIndexes);
          // Uncomment to auto-create indexes:
          // await crossTableSearchHelpers.createRequiredIndexes(requiredIndexes, knex);
        }
        
        // Build join map and field path lookup for cross-table searches
        const joinMap = new Map();
        const fieldPathMap = new Map(); // Maps 'scope.field' to join alias and field
        
        // Only process searchSchema entries that are actually being used in filters
        log.trace('[SCHEMA-PROCESS] Processing only used searchSchema entries', { 
          searchSchemaCount: Object.keys(searchSchema).length,
          filtersCount: Object.keys(filters).length 
        });
        
        for (const [filterKey, fieldDef] of Object.entries(searchSchema)) {
          // Skip this searchSchema entry if it's not being used in the current query
          if (filters[filterKey] === undefined) {
            log.trace('[SCHEMA-ENTRY] Skipping unused filter', { filterKey });
            continue;
          }
          
          log.trace('[SCHEMA-ENTRY] Processing used filter', { filterKey, filterValue: filters[filterKey] });
          
          // Check actualField for cross-table references
          if (fieldDef.actualField && fieldDef.actualField.includes('.')) {
            log.trace('[JOIN-DETECTION] Cross-table actualField found', { filterKey, actualField: fieldDef.actualField, scopeName });
            const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, fieldDef.actualField);
            log.trace('[JOIN-INFO] Built join chain for actualField', { joinAlias: joinInfo.joinAlias });
            // Check if this exact join already exists
            if (!joinMap.has(joinInfo.joinAlias)) {
              joinMap.set(joinInfo.joinAlias, joinInfo);
              log.trace('[JOIN-MAP] Added new join', { joinAlias: joinInfo.joinAlias });
            } else {
              log.trace('[JOIN-MAP] Join already exists, skipping', { joinAlias: joinInfo.joinAlias });
            }
            fieldPathMap.set(fieldDef.actualField, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
            log.trace('[MAP-SET] Added to fieldPathMap', { key: fieldDef.actualField, value: `${joinInfo.joinAlias}.${joinInfo.targetField}` });
          }
          
          // Check likeOneOf for cross-table references
          if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
            log.trace('[LIKE-ONE-OF] Processing likeOneOf fields', { count: fieldDef.likeOneOf.length });
            for (const field of fieldDef.likeOneOf) {
              if (field.includes('.')) {
                log.trace('[JOIN-DETECTION] Cross-table likeOneOf field found', { filterKey, field, scopeName });
                const joinInfo = await crossTableSearchHelpers.buildJoinChain(scopeName, field);
                log.trace('[JOIN-INFO] Built join chain for likeOneOf field', { joinAlias: joinInfo.joinAlias });
                // Check if this exact join already exists
                if (!joinMap.has(joinInfo.joinAlias)) {
                  joinMap.set(joinInfo.joinAlias, joinInfo);
                  log.trace('[JOIN-MAP] Added new join', { joinAlias: joinInfo.joinAlias });
                } else {
                  log.trace('[JOIN-MAP] Join already exists, skipping', { joinAlias: joinInfo.joinAlias });
                }
                fieldPathMap.set(field, `${joinInfo.joinAlias}.${joinInfo.targetField}`);
                log.trace('[MAP-SET] Added to fieldPathMap', { key: field, value: `${joinInfo.joinAlias}.${joinInfo.targetField}` });
              }
            }
          }
        }
        
        log.trace('[MAPS] Final join structures', { joinMapSize: joinMap.size, fieldPathMapSize: fieldPathMap.size });
        
        // Apply all required joins (track applied joins to avoid duplicates)
        log.trace('[JOIN-APPLY] Applying JOINs');
        const appliedJoins = new Set();
        
        joinMap.forEach((joinInfo) => {
          if (joinInfo.isMultiLevel && joinInfo.joinChain) {
            log.trace('[JOIN-APPLY] Processing multi-level JOIN chain', { chainLength: joinInfo.joinChain.length });
            // Apply each join in the chain
            joinInfo.joinChain.forEach((join, index) => {
              const joinKey = `${join.joinAlias}:${join.joinCondition}`;
              if (!appliedJoins.has(joinKey)) {
                log.trace('[JOIN-APPLY] Applying JOIN', { index: index + 1, total: joinInfo.joinChain.length, alias: join.joinAlias });
                // Parse the join condition into left and right parts
                const [leftSide, rightSide] = join.joinCondition.split(' = ');
                query.leftJoin(`${join.targetTableName} as ${join.joinAlias}`, function() {
                  this.on(leftSide, rightSide);
                });
                appliedJoins.add(joinKey);
              } else {
                log.trace('[JOIN-APPLY] Skipping already applied JOIN', { joinAlias: join.joinAlias });
              }
            });
          } else {
            const joinKey = `${joinInfo.joinAlias}:${joinInfo.joinCondition}`;
            if (!appliedJoins.has(joinKey)) {
              log.trace('[JOIN-APPLY] Applying single-level JOIN', { alias: joinInfo.joinAlias });
              const [leftSide, rightSide] = joinInfo.joinCondition.split(' = ');
              query.leftJoin(`${joinInfo.targetTableName} as ${joinInfo.joinAlias}`, function() {
                this.on(leftSide, rightSide);
              });
              appliedJoins.add(joinKey);
            } else {
              log.trace('[JOIN-APPLY] Skipping already applied JOIN', { joinAlias: joinInfo.joinAlias });
            }
          }
        });
        
        // Add DISTINCT only when we have one-to-many JOINs to avoid duplicates
        let hasOneToManyJoins = false;
        joinMap.forEach((joinInfo) => {
          if (joinInfo.isOneToMany) {
            hasOneToManyJoins = true;
          } else if (joinInfo.isMultiLevel && joinInfo.joinChain) {
            // Check if any join in the chain is one-to-many
            joinInfo.joinChain.forEach(join => {
              if (join.isOneToMany) {
                hasOneToManyJoins = true;
              }
            });
          }
        });
        
        if (hasOneToManyJoins) {
          log.trace('[DISTINCT] Adding DISTINCT to query due to one-to-many JOINs');
          query.distinct();
        } else if (joinMap.size > 0) {
          log.trace('[DISTINCT] Not adding DISTINCT - only many-to-one JOINs present');
        }
        
        // Wrap all searchSchema filters in a group for safety
        // This prevents any OR conditions from escaping and affecting other filters
        log.trace('[FILTER-START] Starting filter processing', { filterCount: Object.keys(filters).length });
        query.where(function() {
          log.trace('[WHERE-GROUP] Entered main WHERE group');
          Object.entries(filters).forEach(([filterKey, filterValue]) => {
            log.trace('[FILTER-ENTRY] Processing filter', { filterKey });
            const fieldDef = searchSchema[filterKey];
            log.trace('[FIELD-DEF] Field definition found', { filterKey });
            if (!fieldDef) {
              log.trace('[FILTER-SKIP] No fieldDef found', { filterKey });
              return; // Ignore unknown filters
            }
            
            // Use switch-case for clean filter logic
            log.trace('[SWITCH] Determining filter type', { filterKey });
            switch (true) {
              // Handle multi-field OR search via likeOneOf
              case fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf):
                log.trace('[SWITCH] Using likeOneOf case', { filterKey });
                log.trace('[LIKE-ONE-OF] Processing fields', { count: fieldDef.likeOneOf.length });
                // This creates a sub-group within our main group
                this.where(function() {
                  log.trace('[WHERE-SUB-GROUP] Entered likeOneOf sub-group');
                  fieldDef.likeOneOf.forEach((field, index) => {
                    // Use pre-computed field mapping for cross-table references
                    const originalField = field;
                    let dbField = fieldPathMap.get(field) || field;
                    
                    // If it's a local field (no dot) and we have joins, qualify it with the table name
                    if (!field.includes('.') && joinMap.size > 0) {
                      dbField = `${tableName}.${field}`;
                      log.trace('[QUALIFY] Qualifying local field with table name', { originalField: field, qualifiedField: dbField });
                    }
                    
                    log.trace('[FIELD-MAP] likeOneOf field mapping', { originalField, mappedField: dbField, index });
                    
                    const condition = `%${filterValue}%`;
                    if (index === 0) {
                      log.trace('[WHERE-APPLY] Adding first LIKE condition', { field: dbField });
                      this.where(dbField, 'like', condition);
                    } else {
                      log.trace('[WHERE-APPLY] Adding OR LIKE condition', { field: dbField });
                      this.orWhere(dbField, 'like', condition);
                    }
                  });
                });
                break;
                
              // Handle custom filter function
              case fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function':
                log.trace('[SWITCH] Using custom applyFilter case', { filterKey });
                log.trace('[CUSTOM-FILTER] Calling custom applyFilter function');
                // Pass 'this' context to applyFilter so it operates within our group
                fieldDef.applyFilter.call(this, this, filterValue);
                break;
                
              // Standard filtering with operators (including cross-table)
              default:
                log.trace('[SWITCH] Using standard filtering case', { filterKey });
                let dbField = fieldDef.actualField || filterKey;
                log.trace('[FIELD-RESOLVE] Initial dbField', { actualField: fieldDef.actualField, filterKey, resolvedField: dbField });
                
                // Handle cross-table field references using pre-computed mapping
                if (dbField.includes('.')) {
                  const originalDbField = dbField;
                  dbField = fieldPathMap.get(dbField) || dbField;
                  log.trace('[FIELD-MAP] actualField mapping', { originalField: originalDbField, mappedField: dbField });
                }
                
                const operator = fieldDef.filterUsing || '=';
                log.trace('[OPERATOR] Using operator', { operator, dbField });
                
                switch (operator) {
                  case 'like':
                    const likeValue = `%${filterValue}%`;
                    log.trace('[WHERE-APPLY] Adding LIKE condition', { field: dbField });
                    this.where(dbField, 'like', likeValue);
                    break;
                  case 'in':
                    log.trace('[WHERE-APPLY] Adding IN condition', { field: dbField, isArray: Array.isArray(filterValue) });
                    if (Array.isArray(filterValue)) {
                      this.whereIn(dbField, filterValue);
                    } else {
                      this.where(dbField, operator, filterValue);
                    }
                    break;
                  case 'between':
                    log.trace('[WHERE-APPLY] Adding BETWEEN condition', { field: dbField, isValidArray: Array.isArray(filterValue) && filterValue.length === 2 });
                    if (Array.isArray(filterValue) && filterValue.length === 2) {
                      this.whereBetween(dbField, filterValue);
                    } else {
                      this.where(dbField, operator, filterValue);
                    }
                    break;
                  default:
                    log.trace('[WHERE-APPLY] Adding default condition', { field: dbField, operator });
                    this.where(dbField, operator, filterValue);
                    break;
                }
                break;
            }
            log.trace('[FILTER-COMPLETE] Finished processing filter', { filterKey });
          });
          log.trace('[WHERE-GROUP] Exiting main WHERE group');
        });
        log.trace('[FILTER-END] Completed all filter processing');
      }
    );
    
    // Expose cross-table search helpers for advanced usage
    api.crossTableSearch = crossTableSearchHelpers;
    
    // Expose relationship include helpers for advanced usage
    api.relationshipIncludes = relationshipIncludeHelpers;
    
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
      const tableName = await getTableName(scopeName);
      const idProp = idProperty || vars.idProperty || 'id';
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      const record = await knex(tableName)
        .where(idProp, id)
        .select(idProp)
        .first();
      
      return !!record;
    };

    // GET - retrieve a single record by ID
    helpers.dataGet = async ({ scopeName, id, queryParams = {}, runHooks }) => {
      const tableName = await getTableName(scopeName);
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
      
      // Process includes if requested
      let included = [];
      const records = [record]; // Wrap in array for processing
      
      if (queryParams.include) {
        log.debug('[DATA-GET] Processing includes:', queryParams.include);
        
        const includeResult = await relationshipIncludeHelpers.buildIncludedResources(
          records,
          scopeName,
          queryParams.include
        );
        
        included = includeResult.included;
        log.debug('[DATA-GET] Include result:', { includedCount: included.length, hasRelationships: !!record._relationships });
        // The record now has _relationships added
      }
      
      // Extract relationships from internal _relationships property
      const { _relationships, ...cleanRecord } = record;
      const jsonApiRecord = toJsonApi(scopeName, cleanRecord);
      
      // Add relationships if any were loaded
      if (_relationships) {
        jsonApiRecord.relationships = _relationships;
      }
      
      // Build the response
      const response = {
        data: jsonApiRecord
      };
      
      // Add included array if any resources were included
      if (included.length > 0) {
        response.included = included;
      }
      
      return response;
    };
    
    // QUERY - retrieve multiple records
    helpers.dataQuery = async ({ scopeName, queryParams = {}, searchSchema, runHooks, context }) => {
      log.trace('[DATA-QUERY] Starting dataQuery', { scopeName, hasSearchSchema: !!searchSchema });
      
      const tableName = await getTableName(scopeName);
      const schema = await scopes[scopeName].getSchema();
      const sortableFields = schema?.sortableFields || vars.sortableFields;
      
      log.debug(`[Knex] QUERY ${tableName}`, queryParams);
      
      // Start building the query
      let query = knex(tableName).select(`${tableName}.*`);
      
      // Run filtering hooks
      // IMPORTANT: Each hook should wrap its conditions in query.where(function() {...})
      // to ensure proper grouping and prevent accidental filter bypass.
      // See plugin documentation for examples and best practices.
      log.trace('[DATA-QUERY] Calling knexQueryFiltering hook', { hasQuery: !!query, hasFilters: !!queryParams.filters, scopeName, tableName });
      
      log.trace('[DATA-QUERY] About to call runHooks', { hookName: 'knexQueryFiltering' });
      
      log.trace('[DATA-QUERY] Storing query data in context before calling runHooks');
      
      // Store the query data in context where hooks can access it
      // This is the proper way to share data between methods and hooks
      if (context) {
        context.knexQuery = { query, filters: queryParams.filters, searchSchema, scopeName, tableName };
        
        log.trace('[DATA-QUERY] Stored data in context', { hasStoredData: !!context.knexQuery });
      }
      
      await runHooks('knexQueryFiltering');
      
      // Clean up after hook execution
      if (context && context.knexQuery) {
        delete context.knexQuery;
      }
      
      log.trace('[DATA-QUERY] Finished knexQueryFiltering hook');
      
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
      
      // Process includes if requested
      let included = [];
      if (queryParams.include) {
        log.trace('[DATA-QUERY] Processing includes:', queryParams.include);
        
        const includeResult = await relationshipIncludeHelpers.buildIncludedResources(
          records,
          scopeName,
          queryParams.include
        );
        
        included = includeResult.included;
        // The records now have _relationships added
      }
      
      // Build the response
      const response = {
        data: records.map(record => {
          // Extract relationships from internal _relationships property
          const { _relationships, ...cleanRecord } = record;
          const jsonApiRecord = toJsonApi(scopeName, cleanRecord);
          
          // Add relationships if any were loaded
          if (_relationships) {
            jsonApiRecord.relationships = _relationships;
          }
          
          return jsonApiRecord;
        })
      };
      
      // Add included array if any resources were included
      if (included.length > 0) {
        response.included = included;
      }
      
      return response;
    };
    
    // POST - create a new record
    helpers.dataPost = async ({ scopeName, inputRecord, runHooks }) => {
      const tableName = await getTableName(scopeName);
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
      const tableName = await getTableName(scopeName);
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
      const tableName = await getTableName(scopeName);
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
      const tableName = await getTableName(scopeName);
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