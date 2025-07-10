/**
 * @module defaultDataHelpers
 * @description Default data helper functions for REST API plugin
 * 
 * These are placeholder functions that throw errors when no storage plugin is installed.
 * They serve two critical purposes:
 * 1. Define the contract that storage plugins must implement
 * 2. Provide helpful error messages guiding users to install a storage plugin
 * 
 * Storage plugins like rest-api-knex-plugin override these methods with actual
 * database operations, allowing the REST API to work with different backends.
 */

/**
 * Creates the default data helper functions that serve as placeholders until a storage plugin is installed.
 * 
 * This factory function returns an object containing all the data access methods (dataExists, dataGet, etc.)
 * that the REST API plugin expects storage plugins to implement. Each method:
 * 1. Shows storage plugin developers how to access scope configuration
 * 2. Throws a helpful error message directing users to install a storage plugin
 * 
 * Storage plugins (like knex-storage-plugin) override these methods with actual database operations.
 * The REST API plugin uses these helpers to abstract away storage implementation details, allowing
 * it to work with different storage backends (SQL, NoSQL, in-memory, etc.).
 * 
 * @param {Object} api - The API instance providing access to scopes
 * @returns {Object} Object containing all data helper methods
 * 
 * @example
 * // How the REST API plugin uses this:
 * const defaultHelpers = createDefaultDataHelpers(api);
 * Object.assign(helpers, defaultHelpers);
 * // Now helpers.dataGet, helpers.dataPost, etc. are available
 * // but will throw errors until a storage plugin overrides them
 * 
 * @example
 * // What storage plugins do to override these:
 * // In knex-storage-plugin:
 * helpers.dataGet = async ({ scopeName, id, queryParams, idProperty, transaction }) => {
 *   const result = await knex(tableName)
 *     .where(idProperty, id)
 *     .first();
 *   return formatAsJsonApi(result);
 * };
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API plugin uses this factory to:
 * // 1. Provide a clear contract for storage plugin developers
 * // 2. Enable storage-agnostic REST API operations
 * // 3. Support multiple storage backends (SQL, NoSQL, in-memory, etc.)
 * // 4. Give helpful errors when no storage is configured
 * // 5. Show storage developers how to access scope configuration
 * // 6. Enable testing REST API logic without a real database
 */
export const createDefaultDataHelpers = (api) => {
  return {
    /**
     * Checks if a resource exists in the storage backend.
     * 
     * This method is used internally by the REST API to verify resource existence
     * before operations like PUT (upsert) or relationship validation. Storage plugins
     * must implement this to return a boolean indicating existence.
     * 
     * @param {Object} params - Parameters for the existence check
     * @param {string} params.scopeName - The scope/resource type to check
     * @param {string|number} params.id - The ID of the resource to check
     * @param {string} params.idProperty - The field name used as ID (default: 'id')
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<boolean>} True if resource exists, false otherwise
     * 
     * @example
     * // How it's used in PUT operations:
     * const exists = await helpers.dataExists({
     *   scopeName: 'articles',
     *   id: '123',
     *   idProperty: 'id',
     *   transaction: trx
     * });
     * if (exists) {
     *   // Update existing resource
     * } else {
     *   // Create new resource
     * }
     * 
     * @example
     * // Storage plugin implementation (e.g., Knex):
     * helpers.dataExists = async ({ scopeName, id, idProperty, transaction }) => {
     *   const tableName = scope._scopeOptions.tableName || scopeName;
     *   const result = await knex(tableName)
     *     .where(idProperty, id)
     *     .count('* as count')
     *     .first();
     *   return result.count > 0;
     * };
     */
    dataExists: async function({ scopeName, id, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for exists. Install a storage plugin.`);
    },

    /**
     * Retrieves a single resource by ID from the storage backend.
     * 
     * This method handles GET requests for individual resources. Storage plugins
     * must implement this to fetch a resource and optionally include related data
     * based on the queryParams.include parameter.
     * 
     * @param {Object} params - Parameters for retrieving the resource
     * @param {string} params.scopeName - The scope/resource type to retrieve
     * @param {string|number} params.id - The ID of the resource
     * @param {Object} params.queryParams - Query parameters (include, fields)
     * @param {string} params.idProperty - The field name used as ID
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<Object>} JSON:API formatted resource object
     * 
     * @example
     * // REST API calls this for GET /articles/123?include=author,tags
     * const result = await helpers.dataGet({
     *   scopeName: 'articles',
     *   id: '123',
     *   queryParams: {
     *     include: ['author', 'tags'],
     *     fields: { articles: ['title', 'content'] }
     *   },
     *   idProperty: 'id'
     * });
     * // Returns:
     * // {
     * //   data: {
     * //     type: 'articles',
     * //     id: '123',
     * //     attributes: { title: '...', content: '...' },
     * //     relationships: { author: {...}, tags: {...} }
     * //   },
     * //   included: [...]
     * // }
     * 
     * @example
     * // Storage plugin implementation with relationship loading:
     * helpers.dataGet = async ({ scopeName, id, queryParams, idProperty }) => {
     *   const record = await knex(tableName)
     *     .where(idProperty, id)
     *     .first();
     *   
     *   if (!record) {
     *     throw new Error('Resource not found');
     *   }
     *   
     *   // Load relationships if requested
     *   const included = await loadIncludes(record, queryParams.include);
     *   
     *   return formatAsJsonApi(record, included);
     * };
     */
    dataGet: async function({ scopeName, id, queryParams, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for get. Install a storage plugin.`);
    },
    
    /**
     * Queries for a collection of resources with filtering, sorting, and pagination.
     * 
     * This method handles GET requests for resource collections. It's the most complex
     * data helper as it must support the full range of JSON:API query features including
     * filtering, sorting, pagination, sparse fieldsets, and relationship inclusion.
     * 
     * @param {Object} params - Parameters for querying resources
     * @param {string} params.scopeName - The scope/resource type to query
     * @param {Object} params.queryParams - Complex query parameters object
     * @param {Object} params.queryParams.filters - Filter conditions
     * @param {Array} params.queryParams.sort - Sort fields and directions
     * @param {Object} params.queryParams.page - Pagination settings
     * @param {Array} params.queryParams.include - Related resources to include
     * @param {Object} params.queryParams.fields - Sparse fieldsets by type
     * @param {string} params.idProperty - The field name used as ID
     * @param {Object} params.searchSchema - Schema defining searchable fields
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.context - Request context with user info, etc.
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<Object>} JSON:API formatted collection response
     * 
     * @example
     * // REST API calls this for GET /articles?filter[status]=published&sort=-created_at
     * const result = await helpers.dataQuery({
     *   scopeName: 'articles',
     *   queryParams: {
     *     filters: { status: 'published' },
     *     sort: ['-created_at'],  // '-' prefix means descending
     *     page: { size: 10, number: 1 },
     *     include: ['author'],
     *     fields: {
     *       articles: ['title', 'summary'],
     *       users: ['name']
     *     }
     *   },
     *   searchSchema: {
     *     status: { type: 'string', filterUsing: '=' },
     *     title: { type: 'string', filterUsing: 'contains' }
     *   }
     * });
     * // Returns:
     * // {
     * //   data: [
     * //     { type: 'articles', id: '1', attributes: {...} },
     * //     { type: 'articles', id: '2', attributes: {...} }
     * //   ],
     * //   included: [
     * //     { type: 'users', id: '10', attributes: { name: '...' } }
     * //   ],
     * //   meta: {
     * //     total: 25,
     * //     page: { size: 10, number: 1, total: 3 }
     * //   }
     * // }
     * 
     * @example
     * // Complex filter example with searchSchema:
     * queryParams.filters = {
     *   title: 'JavaScript',        // searchSchema says filterUsing: 'contains'
     *   published_after: '2024-01-01',  // searchSchema says filterUsing: '>='
     *   author_name: 'John'         // Virtual field joining to authors table
     * };
     * 
     * @example
     * // Storage plugin implementation:
     * helpers.dataQuery = async ({ scopeName, queryParams, searchSchema }) => {
     *   let query = knex(tableName);
     *   
     *   // Apply filters based on searchSchema
     *   for (const [field, value] of Object.entries(queryParams.filters)) {
     *     const filterDef = searchSchema[field];
     *     if (filterDef.filterUsing === 'contains') {
     *       query = query.where(field, 'like', `%${value}%`);
     *     } else if (filterDef.filterUsing === '>=') {
     *       query = query.where(filterDef.actualField || field, '>=', value);
     *     }
     *     // Handle virtual fields, joins, etc.
     *   }
     *   
     *   // Apply sorting, pagination, etc.
     *   const results = await query;
     *   return formatAsJsonApi(results);
     * };
     */
    dataQuery: async function({ scopeName, queryParams, idProperty, searchSchema, runHooks, context, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for query. Install a storage plugin.`);
    },
    
    /**
     * Creates a new resource in the storage backend.
     * 
     * This method handles POST requests to create new resources. Storage plugins
     * must implement this to insert the resource data and return the created resource
     * with any auto-generated fields (like auto-increment IDs or timestamps).
     * 
     * @param {Object} params - Parameters for creating a resource
     * @param {string} params.scopeName - The scope/resource type to create
     * @param {Object} params.inputRecord - The resource data to create (already validated)
     * @param {string} params.idProperty - The field name used as ID
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<Object>} The created resource in JSON:API format
     * 
     * @example
     * // REST API calls this for POST /articles
     * const result = await helpers.dataPost({
     *   scopeName: 'articles',
     *   inputRecord: {
     *     data: {
     *       type: 'articles',
     *       attributes: {
     *         title: 'New Article',
     *         content: 'Article content...'
     *       }
     *     }
     *   },
     *   idProperty: 'id'
     * });
     * // Returns:
     * // {
     * //   data: {
     * //     type: 'articles',
     * //     id: '124',  // Auto-generated
     * //     attributes: {
     * //       title: 'New Article',
     * //       content: 'Article content...',
     * //       created_at: '2024-01-15T10:30:00Z',  // Auto-set
     * //       updated_at: '2024-01-15T10:30:00Z'   // Auto-set
     * //     }
     * //   }
     * // }
     * 
     * @example
     * // Storage plugin implementation:
     * helpers.dataPost = async ({ scopeName, inputRecord, idProperty, transaction }) => {
     *   const attributes = inputRecord.data.attributes;
     *   
     *   // Add timestamps
     *   attributes.created_at = new Date();
     *   attributes.updated_at = new Date();
     *   
     *   // Insert and get the auto-generated ID
     *   const [id] = await knex(tableName)
     *     .insert(attributes)
     *     .returning(idProperty);
     *   
     *   // Fetch the complete record
     *   const created = await knex(tableName)
     *     .where(idProperty, id)
     *     .first();
     *   
     *   return formatAsJsonApi(created);
     * };
     * 
     * @example
     * // With client-generated IDs (if supported):
     * const inputRecord = {
     *   data: {
     *     type: 'articles',
     *     id: 'client-generated-uuid',  // Some APIs allow this
     *     attributes: { ... }
     *   }
     * };
     */
    dataPost: async function({ scopeName, inputRecord, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for post. Install a storage plugin.`);
    },

    /**
     * Partially updates an existing resource in the storage backend.
     * 
     * This method handles PATCH requests for partial updates. Unlike PUT, PATCH only
     * updates the fields provided in the request, leaving other fields unchanged.
     * Storage plugins must implement this to perform partial updates and return
     * the updated resource.
     * 
     * @param {Object} params - Parameters for updating a resource
     * @param {string} params.scopeName - The scope/resource type to update
     * @param {string|number} params.id - The ID of the resource to update
     * @param {Object} params.inputRecord - The partial update data
     * @param {Object} params.schema - The resource schema for validation
     * @param {Object} params.queryParams - Query params (for include, fields)
     * @param {string} params.idProperty - The field name used as ID
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<Object>} The updated resource in JSON:API format
     * 
     * @example
     * // REST API calls this for PATCH /articles/123
     * const result = await helpers.dataPatch({
     *   scopeName: 'articles',
     *   id: '123',
     *   inputRecord: {
     *     data: {
     *       type: 'articles',
     *       id: '123',
     *       attributes: {
     *         title: 'Updated Title'  // Only updating title
     *         // content is NOT included, so it won't be changed
     *       }
     *     }
     *   },
     *   idProperty: 'id'
     * });
     * // Returns the full resource with only title changed
     * 
     * @example
     * // Storage plugin implementation:
     * helpers.dataPatch = async ({ scopeName, id, inputRecord, idProperty, transaction }) => {
     *   const updates = inputRecord.data.attributes || {};
     *   
     *   // Add updated timestamp
     *   updates.updated_at = new Date();
     *   
     *   // Perform partial update
     *   await knex(tableName)
     *     .where(idProperty, id)
     *     .update(updates);
     *   
     *   // Return the updated record
     *   const updated = await knex(tableName)
     *     .where(idProperty, id)
     *     .first();
     *   
     *   return formatAsJsonApi(updated);
     * };
     * 
     * @example
     * // PATCH with null values to clear fields:
     * inputRecord: {
     *   data: {
     *     type: 'articles',
     *     id: '123',
     *     attributes: {
     *       subtitle: null,      // Clear the subtitle
     *       published_at: null   // Unpublish
     *     }
     *   }
     * }
     * 
     * @example
     * // PATCH with relationships:
     * inputRecord: {
     *   data: {
     *     type: 'articles',
     *     id: '123',
     *     attributes: { title: 'New Title' },
     *     relationships: {
     *       author: {
     *         data: { type: 'users', id: '456' }  // Change author
     *       }
     *     }
     *   }
     * }
     */
    dataPatch: async function({ scopeName, id, inputRecord, schema, queryParams, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const _schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for patch. Install a storage plugin.`);
    },

    /**
     * Creates or completely replaces a resource in the storage backend.
     * 
     * This method handles PUT requests which can either create a new resource with a
     * client-specified ID, or completely replace an existing resource. Unlike PATCH,
     * PUT replaces the entire resource - any fields not included in the request
     * will be removed or reset to defaults.
     * 
     * @param {Object} params - Parameters for create/replace operation
     * @param {string} params.scopeName - The scope/resource type
     * @param {string|number} params.id - The ID for the resource
     * @param {Object} params.schema - The resource schema
     * @param {Object} params.inputRecord - The complete resource data
     * @param {boolean} params.isCreate - True if creating new, false if replacing
     * @param {string} params.idProperty - The field name used as ID
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<Object>} The created/replaced resource in JSON:API format
     * 
     * @example
     * // REST API calls this for PUT /articles/new-article-id
     * const result = await helpers.dataPut({
     *   scopeName: 'articles',
     *   id: 'new-article-id',
     *   inputRecord: {
     *     data: {
     *       type: 'articles',
     *       id: 'new-article-id',
     *       attributes: {
     *         title: 'Complete Article',
     *         content: 'All fields must be provided...'
     *       }
     *     }
     *   },
     *   isCreate: true,  // Determined by checking existence
     *   idProperty: 'id'
     * });
     * 
     * @example
     * // Storage plugin implementation for upsert:
     * helpers.dataPut = async ({ scopeName, id, inputRecord, isCreate, idProperty }) => {
     *   const attributes = {
     *     ...inputRecord.data.attributes,
     *     [idProperty]: id
     *   };
     *   
     *   if (isCreate) {
     *     // Create new record
     *     attributes.created_at = new Date();
     *     attributes.updated_at = new Date();
     *     await knex(tableName).insert(attributes);
     *   } else {
     *     // Replace existing - first delete, then insert
     *     // This ensures all fields are replaced
     *     await knex(tableName).where(idProperty, id).delete();
     *     attributes.created_at = new Date();  // Or preserve old created_at
     *     attributes.updated_at = new Date();
     *     await knex(tableName).insert(attributes);
     *   }
     *   
     *   const result = await knex(tableName)
     *     .where(idProperty, id)
     *     .first();
     *   
     *   return formatAsJsonApi(result);
     * };
     * 
     * @example
     * // PUT replacing existing resource (all fields replaced):
     * // Original: { id: '123', title: 'Old', content: 'Old', tags: ['a', 'b'] }
     * inputRecord: {
     *   data: {
     *     type: 'articles',
     *     id: '123',
     *     attributes: {
     *       title: 'New Title'
     *       // Note: content and tags are NOT included
     *     }
     *   }
     * }
     * // Result: { id: '123', title: 'New Title' }
     * // content and tags are gone - that's the difference from PATCH
     */
    dataPut: async function({ scopeName, id, schema, inputRecord, isCreate, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schemaDefinition = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for put. Install a storage plugin.`);
    },
    
    /**
     * Deletes a resource from the storage backend.
     * 
     * This method handles DELETE requests to remove resources. Storage plugins must
     * implement this to delete the resource and handle any cascading deletes or
     * orphaned relationship cleanup as configured.
     * 
     * @param {Object} params - Parameters for deleting a resource
     * @param {string} params.scopeName - The scope/resource type to delete
     * @param {string|number} params.id - The ID of the resource to delete
     * @param {string} params.idProperty - The field name used as ID
     * @param {Function} params.runHooks - Function to run storage hooks
     * @param {Object} params.transaction - Database transaction object
     * @returns {Promise<void>} Should not return any data (204 No Content)
     * 
     * @example
     * // REST API calls this for DELETE /articles/123
     * await helpers.dataDelete({
     *   scopeName: 'articles',
     *   id: '123',
     *   idProperty: 'id',
     *   transaction: trx
     * });
     * // Returns nothing (undefined) - REST API sends 204 No Content
     * 
     * @example
     * // Storage plugin implementation:
     * helpers.dataDelete = async ({ scopeName, id, idProperty, transaction }) => {
     *   // Check if resource exists
     *   const existing = await knex(tableName)
     *     .where(idProperty, id)
     *     .first();
     *   
     *   if (!existing) {
     *     throw new Error('Resource not found');
     *   }
     *   
     *   // Delete the resource
     *   await knex(tableName)
     *     .where(idProperty, id)
     *     .delete();
     *   
     *   // Note: Many-to-many pivot records are handled by REST API
     *   // before this is called. Storage plugin only needs to handle
     *   // database-level cascades or foreign key constraints.
     * };
     * 
     * @example
     * // With soft deletes (if configured):
     * helpers.dataDelete = async ({ scopeName, id, idProperty }) => {
     *   if (scopeOptions.softDelete) {
     *     // Mark as deleted instead of actually deleting
     *     await knex(tableName)
     *       .where(idProperty, id)
     *       .update({
     *         deleted_at: new Date(),
     *         updated_at: new Date()
     *       });
     *   } else {
     *     // Hard delete
     *     await knex(tableName)
     *       .where(idProperty, id)
     *       .delete();
     *   }
     * };
     */
    dataDelete: async function({ scopeName, id, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for delete. Install a storage plugin.`);
    }
  };
};