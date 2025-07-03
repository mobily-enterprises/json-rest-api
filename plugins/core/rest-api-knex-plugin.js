
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
    
    // Register the core searchSchema filter hook
    addHook('knexQueryFiltering', 'searchSchemaFilter', {}, 
      async ({ query, filters, searchSchema, scopeName }) => {
        if (!filters || !searchSchema) return;
        
        // Wrap all searchSchema filters in a group for safety
        // This prevents any OR conditions from escaping and affecting other filters
        query.where(function() {
          Object.entries(filters).forEach(([filterKey, filterValue]) => {
            const fieldDef = searchSchema[filterKey];
            if (!fieldDef) return; // Ignore unknown filters
            
            // Handle multi-field OR search via likeOneOf
            if (fieldDef.likeOneOf && Array.isArray(fieldDef.likeOneOf)) {
              // This creates a sub-group within our main group
              this.where(function() {
                fieldDef.likeOneOf.forEach((field, index) => {
                  if (index === 0) {
                    this.where(field, 'like', `%${filterValue}%`);
                  } else {
                    this.orWhere(field, 'like', `%${filterValue}%`);
                  }
                });
              });
            } 
            // Handle custom filter function
            else if (fieldDef.applyFilter && typeof fieldDef.applyFilter === 'function') {
              // Pass 'this' context to applyFilter so it operates within our group
              fieldDef.applyFilter.call(this, this, filterValue);
            } 
            // Standard filtering with operators
            else {
              const dbField = fieldDef.actualField || filterKey;
              const operator = fieldDef.filterUsing || '=';
              
              if (operator === 'like') {
                this.where(dbField, 'like', `%${filterValue}%`);
              } else if (operator === 'in' && Array.isArray(filterValue)) {
                this.whereIn(dbField, filterValue);
              } else if (operator === 'between' && Array.isArray(filterValue) && filterValue.length === 2) {
                this.whereBetween(dbField, filterValue);
              } else {
                this.where(dbField, operator, filterValue);
              }
            }
          });
        });
      }
    );
    
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