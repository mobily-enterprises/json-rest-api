import { createSchema, createKnexTable } from 'json-rest-schema';
import { createCrossTableSearchHelpers } from './lib/knex-cross-table-search.js';
import { createRelationshipIncludeHelpers } from './lib/knex-relationship-includes.js';
import {
  getTableName,
  getForeignKeyFields,
  buildFieldSelection,
  toJsonApi,
  buildQuerySelection,
  processIncludes,
  buildJsonApiResponse,
  processBelongsToRelationships
} from './lib/knex-helpers.js';
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook
} from './lib/knex-query-helpers.js';

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
 * The plugin exposes Knex directly via api.knex.instance for advanced use cases:
 * 
 * const results = await api.knex.instance('articles')
 *   .join('users', 'articles.author_id', 'users.id')
 *   .where('status', 'published')
 *   .select('articles.*', 'users.name as author_name');
 * 
 * ## Helper Functions
 * 
 * The plugin exposes helper functions via api.knex.helpers:
 * 
 * ```javascript
 * // Cross-table search helpers
 * api.knex.helpers.crossTableSearch.validateCrossTableField('people', 'name');
 * const joinInfo = api.knex.helpers.crossTableSearch.buildJoinChain('articles', 'people.name');
 * const indexes = api.knex.helpers.crossTableSearch.analyzeRequiredIndexes('articles', searchSchema);
 * await api.knex.helpers.crossTableSearch.createRequiredIndexes(indexes);
 * 
 * // Relationship include helpers  
 * // (typically used internally, but available for advanced use)
 * 
 * // Polymorphic helpers
 * // (typically used internally, but available for advanced use)
 * ```
 */

export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install({ helpers, vars, pluginOptions, api, log, scopes, addHook, addScopeMethod }) {
    
    // Get Knex configuration from plugin options
    const knexOptions = pluginOptions.knex || pluginOptions['rest-api-knex'];
    if (!knexOptions || !knexOptions.knex) {
      throw new Error('RestApiKnexPlugin requires a knex instance in pluginOptions');
    }
    
    const knex = knexOptions.knex;
    
    // Expose Knex instance and helpers in a structured way
    api.knex = {
      instance: knex,
      helpers: {}
    };
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                          HELPER FUNCTIONS                               ║
     * ║  Small utility functions used throughout the plugin                     ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    // Helper functions are imported from './lib/knex-helpers.js'
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                     PLUGIN INITIALIZATION                               ║
     * ║  Initialize helper modules and expose them via api.knex                 ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    // Initialize cross-table search helpers
    const crossTableSearchHelpers = createCrossTableSearchHelpers(scopes, log);
    
    // Initialize relationship include helpers (will get access to helper functions after they're defined)
    let relationshipIncludeHelpers;
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                  MAIN QUERY FILTERING HOOK                              ║
     * ║  This is the heart of the filtering system. It processes searchSchema   ║
     * ║  filters and builds SQL WHERE conditions with proper JOINs              ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */
    
    // Register the three separate filter hooks
    // Dependencies object for the hooks
    const hookDependencies = {
      log,
      scopes,
      knex,
      crossTableSearchHelpers
    };
    
    // Register in specific order: polymorphic → cross-table → basic
    // This ensures proper field qualification when JOINs are present
    
    // 1. Polymorphic filters (adds JOINs for polymorphic relationships)
    addHook('knexQueryFiltering', 'polymorphicFiltersHook', {}, 
      async (hookParams) => polymorphicFiltersHook(hookParams, hookDependencies)
    );
    
    // 2. Cross-table filters (adds JOINs for cross-table fields)
    addHook('knexQueryFiltering', 'crossTableFiltersHook', {}, 
      async (hookParams) => crossTableFiltersHook(hookParams, hookDependencies)
    );
    
    // 3. Basic filters (processes simple main table filters)
    addHook('knexQueryFiltering', 'basicFiltersHook', {}, 
      async (hookParams) => basicFiltersHook(hookParams, hookDependencies)
    );
    
    // OLD MONOLITHIC HOOK REMOVED - The functionality is now split into the three hooks above
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    HELPER FUNCTION EXPORTS                          ║
     * ║  Expose helper modules for external use via api.knex.helpers        ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */
    
    // Expose helpers under api.knex.helpers
    api.knex.helpers.crossTableSearch = crossTableSearchHelpers;
    api.knex.helpers.relationshipIncludes = relationshipIncludeHelpers;
    

    // Now initialize relationship include helpers with access to the helper functions
    relationshipIncludeHelpers = createRelationshipIncludeHelpers(scopes, log, knex, {
      getForeignKeyFields,
      buildFieldSelection
    });


    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    SCOPE METHODS                                    ║
     * ║  Expose helper modules for external use via api.knex.helpers        ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */
    
    // Helper scope method to get all schema-related information
      addScopeMethod('createKnexTable', async ({ vars, scope, scopeName, scopeOptions, runHooks }) => {   
        await createKnexTable(api.knex.instance, scopeName, vars.schemaInfo.schema)
      })
    

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    DATA OPERATION METHODS                               ║
     * ║  Implementation of the storage interface required by REST API plugin    ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    /**
     * EXISTS - Check if a record exists by ID
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {string|number} params.id - The record ID to check
     * @param {string} params.idProperty - The ID column name (default: 'id')
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<boolean>} True if record exists, false otherwise
     * @description
     * Performs efficient existence check using SELECT with just the ID field
     */
    helpers.dataExists = async ({ scopeName, id, idProperty, runHooks, methodParams }) => {
      const tableName = await getTableName(scopeName, scopes);
      idProperty = idProperty || vars.idProperty || 'id';
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      const record = await db(tableName)
        .where(idProperty, id)
        .select(idProperty)
        .first();
      
      return !!record;
    };

    /**
     * GET - Retrieve a single record by ID with optional includes and sparse fieldsets
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {string|number} params.id - The record ID to retrieve
     * @param {Object} params.queryParams - Query parameters
     * @param {Array<string>} params.queryParams.include - Related resources to include
     * @param {Object} params.queryParams.fields - Sparse fieldsets by resource type
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<Object>} JSON:API response with data and optional included
     * @throws {Error} With code 'REST_API_RESOURCE' if record not found
     * @example
     * const result = await dataGet({ 
     *   scopeName: 'articles', 
     *   id: '123',
     *   queryParams: { include: ['author'], fields: { articles: 'title,body' } }
     * });
     * // Returns: { data: { type: 'articles', id: '123', attributes: {...}, relationships: {...} }, included: [...] }
     */
    helpers.dataGet = async ({ scopeName, id, queryParams = {}, runHooks, methodParams }) => {
      const tableName = await getTableName(scopeName, scopes);
      const idProperty = vars.idProperty || 'id';
      const schema =  scopes[scopeName].vars.schemaInfo.schema;;
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] GET ${tableName}/${id}`);
      
      // Build field selection for sparse fieldsets
      const fieldsToSelect = await buildFieldSelection(
        scopeName,
        queryParams.fields?.[scopeName],
        schema,
        scopes,
        vars
      );
      
      // Build and execute query
      let query = db(tableName).where(idProperty, id);
      query = buildQuerySelection(query, tableName, fieldsToSelect, false);
      
      const record = await query.first();
      
      if (!record) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Process includes
      const records = [record]; // Wrap in array for processing
      const included = await processIncludes(records, scopeName, queryParams, db, {
        log,
        relationshipIncludeHelpers,
        createRelationshipIncludeHelpers,
        scopes
      });
      
      // Build and return response
      return buildJsonApiResponse(records, scopeName, schema, included, true, scopes, vars);
    };
    
    /**
     * QUERY - Retrieve multiple records with filtering, sorting, pagination, and includes
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {Object} params.queryParams - Query parameters
     * @param {Object} params.queryParams.filters - Filter conditions
     * @param {Array<string>} params.queryParams.sort - Sort fields (prefix with - for DESC)
     * @param {Object} params.queryParams.page - Pagination { number, size }
     * @param {Array<string>} params.queryParams.include - Related resources to include
     * @param {Object} params.queryParams.fields - Sparse fieldsets by resource type
     * @param {Object} params.searchSchema - Schema defining available filters
     * @param {Function} params.runHooks - Hook runner function
     * @param {Object} params.context - Context object for sharing data with hooks
     * @returns {Promise<Object>} JSON:API response with data array and optional included
     * @description
     * This is the most complex method, handling:
     * - Cross-table filtering with automatic JOINs
     * - Polymorphic filtering
     * - Sorting with validation
     * - Pagination with limits
     * - Batch loading of includes
     * @example
     * const result = await dataQuery({
     *   scopeName: 'articles',
     *   queryParams: {
     *     filters: { title: 'JavaScript', 'author.name': 'John' },
     *     sort: ['-createdAt', 'title'],
     *     page: { number: 2, size: 20 },
     *     include: ['author', 'comments']
     *   },
     *   searchSchema: { title: { filterUsing: 'like' }, 'author.name': { actualField: 'users.name' } }
     * });
     */
    helpers.dataQuery = async ({ scopeName, queryParams = {}, searchSchema, runHooks, context, methodParams }) => {
      log.trace('[DATA-QUERY] Starting dataQuery', { scopeName, hasSearchSchema: !!searchSchema });
      
      const tableName = await getTableName(scopeName, scopes);
      const schema =  scopes[scopeName].vars.schemaInfo.schema;;
      const sortableFields = schema?.sortableFields || vars.sortableFields;
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] QUERY ${tableName}`, queryParams);
      
      // Build field selection for sparse fieldsets
      const fieldsToSelect = await buildFieldSelection(
        scopeName,
        queryParams.fields?.[scopeName],
        schema,
        scopes,
        vars
      );
      
      // Start building query with table prefix (for JOIN support)
      let query = db(tableName);
      query = buildQuerySelection(query, tableName, fieldsToSelect, true);
      
      /* ═══════════════════════════════════════════════════════════════════
       * FILTERING HOOKS
       * This is where the magic happens. The knexQueryFiltering hook is called
       * to apply all filter conditions. The searchSchemaFilter hook (registered
       * above) will process the searchSchema and apply filters with JOINs.
       * 
       * IMPORTANT: Each hook should wrap its conditions in query.where(function() {...})
       * to ensure proper grouping and prevent accidental filter bypass.
       * ═══════════════════════════════════════════════════════════════════ */
      
      log.trace('[DATA-QUERY] Calling knexQueryFiltering hook', { hasQuery: !!query, hasFilters: !!queryParams.filters, scopeName, tableName });
      
      log.trace('[DATA-QUERY] About to call runHooks', { hookName: 'knexQueryFiltering' });
      
      log.trace('[DATA-QUERY] Storing query data in context before calling runHooks');
      
      // Store the query data in context where hooks can access it
      // This is the proper way to share data between methods and hooks
      if (context) {
        context.knexQuery = { query, filters: queryParams.filters, searchSchema, scopeName, tableName, db };
        
        log.trace('[DATA-QUERY] Stored data in context', { hasStoredData: !!context.knexQuery, filters: queryParams.filters });
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
      
      // Execute query
      const records = await query;
      
      // Process includes
      const included = await processIncludes(records, scopeName, queryParams, db, {
        log,
        relationshipIncludeHelpers,
        createRelationshipIncludeHelpers,
        scopes
      });
      
      // Build and return response
      return buildJsonApiResponse(records, scopeName, schema, included, false, scopes, vars);
    };
    
    /**
     * POST - Create a new record
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {Object} params.inputRecord - JSON:API input document
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<Object>} JSON:API response with created resource
     * @description
     * - Extracts attributes from JSON:API format
     * - Inserts into database
     * - Returns the created record in JSON:API format
     * Note: Relationship processing is handled by REST API plugin layer
     * @example
     * const result = await dataPost({
     *   scopeName: 'articles',
     *   inputRecord: { data: { type: 'articles', attributes: { title: 'New Article' } } }
     * });
     * // Returns: { data: { type: 'articles', id: '456', attributes: { title: 'New Article' } } }
     */
    helpers.dataPost = async ({ scopeName, inputRecord, runHooks, methodParams }) => {
      const tableName = await getTableName(scopeName, scopes);
      const idProperty = vars.idProperty || 'id';
      const schema =  scopes[scopeName].vars.schemaInfo.schema;;
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] POST ${tableName}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Insert and get the new ID
      const result = await db(tableName).insert(attributes).returning(idProperty);
      
      // Extract the ID value (SQLite returns array of objects)
      const id = result[0]?.[idProperty] || result[0];
      
      // Fetch the created record
      const newRecord = await db(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: await toJsonApi(scopeName, newRecord, schema, scopes, vars)
      };
    };
    
    /**
     * PUT - Replace an entire record or create if it doesn't exist
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {string|number} params.id - The record ID
     * @param {Object} params.inputRecord - JSON:API input document
     * @param {Object} params.queryParams - Query parameters for response
     * @param {boolean} params.isCreate - True if creating new record (from REST API layer)
     * @param {string} params.idProperty - The ID column name
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<Object>} JSON:API response with updated/created resource
     * @throws {Error} With code 'REST_API_RESOURCE' if record not found (update mode)
     * @description
     * PUT has dual behavior:
     * - Create mode (isCreate=true): Insert with specified ID
     * - Update mode (isCreate=false): Replace all fields
     * Also processes belongsTo relationships to foreign key updates
     * @example
     * const result = await dataPut({
     *   scopeName: 'articles',
     *   id: '123',
     *   inputRecord: { data: { type: 'articles', attributes: { title: 'Replaced' } } },
     *   isCreate: false
     * });
     */
    helpers.dataPut = async ({ scopeName, id, inputRecord, queryParams, isCreate, idProperty, runHooks, methodParams }) => {
      const tableName = await getTableName(scopeName, scopes);
      idProperty = idProperty || vars.idProperty || 'id';
      const schema =  scopes[scopeName].vars.schemaInfo.schema;;
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${isCreate})`);
      
      // Extract attributes and process relationships using helper
      const attributes = inputRecord.data.attributes || {};
      const foreignKeyUpdates = processBelongsToRelationships(inputRecord, schema);
      const finalAttributes = { ...attributes, ...foreignKeyUpdates };
      
      if (isCreate) {
        // Create mode - insert new record with specified ID
        const recordData = {
          ...finalAttributes,
          [idProperty]: id
        };
        
        await db(tableName).insert(recordData);
      } else {
        // Update mode - check if record exists first
        const exists = await db(tableName)
          .where(idProperty, id)
          .first();
        
        if (!exists) {
          const error = new Error(`Record not found: ${scopeName}/${id}`);
          error.code = 'REST_API_RESOURCE';
          error.subtype = 'not_found';
          throw error;
        }
        
        // Update the record (replace all fields)
        if (Object.keys(finalAttributes).length > 0) {
          await db(tableName)
            .where(idProperty, id)
            .update(finalAttributes);
        }
      }
      
      // Fetch and return the updated record
      const updatedRecord = await db(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: await toJsonApi(scopeName, updatedRecord, schema, scopes, vars)
      };
    };
    
    /**
     * PATCH - Partially update a record (only specified fields)
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {string|number} params.id - The record ID to update
     * @param {Object} params.inputRecord - JSON:API input document with partial data
     * @param {Object} params.schema - Schema object (optional, will fetch if not provided)
     * @param {Object} params.queryParams - Query parameters for response
     * @param {string} params.idProperty - The ID column name
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<Object>} JSON:API response with updated resource
     * @throws {Error} With code 'REST_API_RESOURCE' if record not found
     * @description
     * - Only updates provided fields, leaving others unchanged
     * - Processes belongsTo relationships
     * - Can return full record with includes based on queryParams
     * @example
     * const result = await dataPatch({
     *   scopeName: 'articles',
     *   id: '123',
     *   inputRecord: { data: { type: 'articles', id: '123', attributes: { title: 'New Title' } } }
     * });
     * // Only updates title, other fields remain unchanged
     */
    helpers.dataPatch = async ({ scopeName, id, inputRecord, schema, queryParams, idProperty, runHooks, methodParams }) => {
      const tableName = await getTableName(scopeName, scopes);
      idProperty = idProperty || vars.idProperty || 'id';
      schema = schema ||  scopes[scopeName].vars.schemaInfo.schema;;
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] PATCH ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await db(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Extract attributes and process relationships using helper
      const attributes = inputRecord.data.attributes || {};
      const foreignKeyUpdates = processBelongsToRelationships(inputRecord, schema);
      const finalAttributes = { ...attributes, ...foreignKeyUpdates };
      
      log.debug(`[Knex] PATCH finalAttributes:`, finalAttributes);
      
      // Update only if there are changes
      if (Object.keys(finalAttributes).length > 0) {
        await db(tableName)
          .where(idProperty, id)
          .update(finalAttributes);
      }
      
      // Fetch and return the updated record
      const updatedRecord = await db(tableName)
        .where(idProperty, id)
        .first();
      
      return {
        data: await toJsonApi(scopeName, updatedRecord, schema, scopes, vars)
      };
    };
    
    /**
     * DELETE - Remove a record from the database
     * @param {Object} params - Parameters object
     * @param {string} params.scopeName - The scope/resource name
     * @param {string|number} params.id - The record ID to delete
     * @param {Function} params.runHooks - Hook runner function
     * @returns {Promise<Object>} Success object { success: true }
     * @throws {Error} With code 'REST_API_RESOURCE' if record not found
     * @description
     * - Checks existence before deletion
     * - Performs hard delete (not soft delete)
     * - Returns success indicator
     * Note: Cascading deletes depend on database foreign key constraints
     * @example
     * await dataDelete({ scopeName: 'articles', id: '123' });
     * // Returns: { success: true }
     */
    helpers.dataDelete = async ({ scopeName, id, runHooks, methodParams, idProperty }) => {
      const tableName = await getTableName(scopeName, scopes);
      idProperty = idProperty || vars.idProperty || 'id';
      const { transaction } = methodParams || {};
      const db = transaction || knex;
      
      log.debug(`[Knex] DELETE ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await db(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        const error = new Error(`Record not found: ${scopeName}/${id}`);
        error.code = 'REST_API_RESOURCE';
        error.subtype = 'not_found';
        throw error;
      }
      
      // Delete the record
      await db(tableName)
        .where(idProperty, id)
        .delete();
      
      return { success: true };
    };
    
    log.info('RestApiKnexPlugin installed - basic CRUD operations ready');
  }
}