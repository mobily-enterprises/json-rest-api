import CreateSchema from 'json-rest-schema'
import { 
  validateGetPayload, 
  validateQueryPayload, 
  validatePostPayload, 
  validatePutPayload, 
  validatePatchPayload 
} from '../../lib/payload-validators.js';
import { 
  RestApiValidationError, 
  RestApiResourceError, 
  RestApiPayloadError 
} from '../../lib/rest-api-errors.js';
import { createPolymorphicHelpers } from '../../lib/polymorphic-helpers.js';

/**
 * Automatically marks searchSchema fields as indexed to support cross-table searches
 * @param {Object} searchSchema - The searchSchema object to process
 */
function ensureSearchFieldsAreIndexed(searchSchema) {
  if (!searchSchema) return;
  
  Object.keys(searchSchema).forEach(fieldName => {
    const fieldDef = searchSchema[fieldName];
    if (fieldDef && typeof fieldDef === 'object') {
      // Mark the field as indexed for cross-table search support
      fieldDef.indexed = true;
    }
  });
}

export const RestApiPlugin = {
  name: 'rest-api',

  install({ helpers, addScopeMethod, vars, addHook, apiOptions, pluginOptions, api, setScopeAlias, scopes, log }) {

    // Initialize the rest namespace for REST API functionality
    api.rest = {};
    
    // Initialize polymorphic helpers
    const polymorphicHelpers = createPolymorphicHelpers(scopes, log);
    api._polymorphicHelpers = polymorphicHelpers;
    
    // Helper function to move HTTP objects from params to context
    const moveHttpObjectsToContext = (params, context) => {
      // Check for request ID from Express/HTTP plugins
      if (params._requestId && api._httpRequests) {
        const httpData = api._httpRequests.get(params._requestId);
        if (httpData) {
          if (httpData.req && httpData.res) {
            // Express request
            context.expressReq = httpData.req;
            context.expressRes = httpData.res;
          } else if (httpData.httpReq && httpData.httpRes) {
            // HTTP request
            context.httpReq = httpData.httpReq;
            context.httpRes = httpData.httpRes;
          }
          // Clean up the WeakMap entry
          api._httpRequests.delete(params._requestId);
        }
        delete params._requestId;
      }
      
      // Legacy support - remove if present
      if (params._expressReq) {
        context.expressReq = params._expressReq;
        context.expressRes = params._expressRes;
        delete params._expressReq;
        delete params._expressRes;
      }
      if (params._httpReq) {
        context.httpReq = params._httpReq;
        context.httpRes = params._httpRes;
        delete params._httpReq;
        delete params._httpRes;
      }
      
      // Preserve transaction if present
      if (params.transaction) {
        context.transaction = params.transaction;
      }
    };

    // Helper function to generate complete searchSchema from schema and explicit searchSchema
    const generateSearchSchemaFromSchema = (schema, explicitSearchSchema) => {
      // Start with explicit searchSchema or empty object
      const searchSchema = explicitSearchSchema ? {...explicitSearchSchema} : {};
      
      if (!schema) {
        return Object.keys(searchSchema).length > 0 ? searchSchema : null;
      }
      
      // Process schema fields with 'search' property
      Object.entries(schema).forEach(([fieldName, fieldDef]) => {
        if (fieldDef.search) {
          if (fieldDef.search === true) {
            // Check for conflicts with explicit searchSchema
            if (searchSchema[fieldName]) {
              throw new RestApiValidationError(
                `Field '${fieldName}' is defined in both schema (with search: true) and explicit searchSchema. Remove one definition to avoid conflicts.`,
                { 
                  fields: [fieldName],
                  violations: [{
                    field: fieldName,
                    rule: 'duplicate_search_field',
                    message: 'Field cannot be defined in both schema and searchSchema'
                  }]
                }
              );
            }
            
            // Simple boolean - copy entire field definition (except search) and add filterUsing
            const { search, ...fieldDefWithoutSearch } = fieldDef;
            searchSchema[fieldName] = {
              ...fieldDefWithoutSearch,
              // Default filter behavior based on type
              filterUsing: fieldDef.type === 'string' ? '=' : '='
            };
          } else if (typeof fieldDef.search === 'object') {
            // Check if search defines multiple filter fields
            const hasNestedFilters = Object.values(fieldDef.search).some(
              v => typeof v === 'object' && v.filterUsing
            );
            
            if (hasNestedFilters) {
              // Multiple filters from one field (like published_after/before)
              Object.entries(fieldDef.search).forEach(([filterName, filterDef]) => {
                // Check for conflicts
                if (searchSchema[filterName]) {
                  throw new RestApiValidationError(
                    `Field '${filterName}' is defined in both schema (with search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
                    { 
                      fields: [filterName],
                      violations: [{
                        field: filterName,
                        rule: 'duplicate_search_field',
                        message: 'Field cannot be defined in both schema and searchSchema'
                      }]
                    }
                  );
                }
                
                searchSchema[filterName] = {
                  type: fieldDef.type,
                  actualField: fieldName,
                  ...filterDef
                };
              });
            } else {
              // Check for conflicts
              if (searchSchema[fieldName]) {
                throw new RestApiValidationError(
                  `Field '${fieldName}' is defined in both schema (with search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
                  { 
                    fields: [fieldName],
                    violations: [{
                      field: fieldName,
                      rule: 'duplicate_search_field',
                      message: 'Field cannot be defined in both schema and searchSchema'
                    }]
                  }
                );
              }
              
              // Single filter with config
              searchSchema[fieldName] = {
                type: fieldDef.type,
                ...fieldDef.search
              };
            }
          }
        }
      });
      
      // Handle _virtual search definitions
      if (schema._virtual?.search) {
        Object.entries(schema._virtual.search).forEach(([filterName, filterDef]) => {
          // Check for conflicts
          if (searchSchema[filterName]) {
            throw new RestApiValidationError(
              `Field '${filterName}' is defined in both schema (_virtual.search) and explicit searchSchema. Remove one definition to avoid conflicts.`,
              { 
                fields: [filterName],
                violations: [{
                  field: filterName,
                  rule: 'duplicate_search_field',
                  message: 'Field cannot be defined in both schema and searchSchema'
                }]
              }
            );
          }
          
          searchSchema[filterName] = filterDef;
        });
      }
      
      return Object.keys(searchSchema).length > 0 ? searchSchema : null;
    };

    // Set up REST-friendly aliases
    setScopeAlias('resources', 'addResource');
    
    // Helper function to process relationships from input
    const processRelationships = (inputRecord, schemaFields, relationships) => {
      const belongsToUpdates = {};
      const manyToManyRelationships = [];
      
      if (!inputRecord.data.relationships) {
        return { belongsToUpdates, manyToManyRelationships };
      }
      
      for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
        const relDef = relationships?.[relName];
        
        // Find the schema field that defines this relationship
        const schemaField = Object.entries(schemaFields).find(([fieldName, fieldDef]) => 
          fieldDef.as === relName
        );
        
        if (schemaField) {
          const [fieldName, fieldDef] = schemaField;
          
          // Handle regular belongsTo (1:1)
          if (fieldDef.belongsTo && !fieldDef.belongsToPolymorphic) {
            if (relData.data === null) {
              belongsToUpdates[fieldName] = null;
            } else if (relData.data?.id) {
              belongsToUpdates[fieldName] = relData.data.id;
            }
          }
          // Handle polymorphic belongsTo
          else if (fieldDef.belongsToPolymorphic) {
            if (relData.data === null) {
              const { typeField, idField } = fieldDef.belongsToPolymorphic;
              belongsToUpdates[typeField] = null;
              belongsToUpdates[idField] = null;
            } else if (relData.data) {
              const { type, id } = relData.data;
              const { types, typeField, idField } = fieldDef.belongsToPolymorphic;
              
              // Validate type is allowed
              if (!types.includes(type)) {
                throw new RestApiValidationError(
                  `Invalid type '${type}' for polymorphic relationship '${relName}'. Allowed types: ${types.join(', ')}`,
                  { 
                    fields: [`data.relationships.${relName}.data.type`],
                    violations: [{
                      field: `data.relationships.${relName}.data.type`,
                      rule: 'polymorphic_type',
                      message: `Type must be one of: ${types.join(', ')}`
                    }]
                  }
                );
              }
              
              belongsToUpdates[typeField] = type;
              belongsToUpdates[idField] = id;
            }
          }
        }
        
        // Check for many-to-many relationships defined in relationships object
        if (relDef?.manyToMany && relData.data !== undefined) {
          manyToManyRelationships.push({
            relName,
            relDef,
            relData: relData.data || []  // null means empty array for many-to-many
          });
        }
      }
      
      return { belongsToUpdates, manyToManyRelationships };
    };
    
    // Helper function to delete existing pivot records
    const deleteExistingPivotRecords = async (resourceId, relDef, trx) => {
      // Query for all existing pivot records
      const existingPivotRecords = await api.resources[relDef.through].query({
        transaction: trx,
        queryParams: {
          filters: { [relDef.foreignKey]: resourceId }
        }
      });
      
      // Delete each found record
      for (const record of existingPivotRecords.data || []) {
        await api.resources[relDef.through].delete({
          transaction: trx,
          id: record.id
        });
      }
    };
    
    // Helper function to create pivot records
    const createPivotRecords = async (resourceId, relDef, relData, trx) => {
      for (const related of relData) {
        // Optionally validate related resource exists
        if (relDef.validateExists !== false) {
          try {
            await api.resources[related.type].get({
              id: related.id,
              transaction: trx
            });
          } catch (error) {
            throw new RestApiResourceError(
              `Related ${related.type} with id ${related.id} not found`,
              { 
                subtype: 'not_found',
                resourceType: related.type, 
                resourceId: related.id 
              }
            );
          }
        }
        
        // Create pivot record
        await api.resources[relDef.through].post({
          transaction: trx,
          inputRecord: {
            data: {
              type: relDef.through,
              attributes: {
                [relDef.foreignKey]: resourceId,
                [relDef.otherKey]: related.id
              }
            }
          }
        });
      }
    };

    // Add hook to validate polymorphic relationships when scopes are created
    addHook('afterScopeCreate', 'validatePolymorphicRelationships', {}, ({ scopeName, scopeOptions }) => {
      const relationships = scopeOptions.relationships || {};
      
      for (const [relName, relDef] of Object.entries(relationships)) {
        if (relDef.belongsToPolymorphic) {
          const validation = polymorphicHelpers.validatePolymorphicRelationship(relDef, scopeName);
          if (!validation.valid) {
            throw new Error(
              `Invalid polymorphic relationship '${relName}' in scope '${scopeName}': ${validation.error}`
            );
          }
        }
      }
    });

    // Initialize default vars for the plugin from pluginOptions
    const restApiOptions = pluginOptions['rest-api'] || {};
    
    vars.sortableFields = restApiOptions.sortableFields || [];
    vars.defaultSort = restApiOptions.defaultSort || null;
    vars.idProperty = restApiOptions.idProperty || 'id';
    vars.pageSize = restApiOptions.pageSize || 20;
    vars.maxPageSize = restApiOptions.maxPageSize || 100;
    vars.loadRecordOnPut = !!restApiOptions.loadRecordOnPut;
    
    // Return full record configuration
    vars.returnFullRecord = {
      post: restApiOptions.returnFullRecord?.post ?? false,
      put: restApiOptions.returnFullRecord?.put ?? false,
      patch: restApiOptions.returnFullRecord?.patch ?? false
    };

    addScopeMethod('enrichAttributes', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {
      
      // This will make sure that when this method calls "runHooks", the hooks will have the same context as api.post()
      // although it will be a COPY 
      context.parentContext = params.parentContext
      context.attributes = params.attributes

      // Hooks will receive enrichRecord's context as context, and their jobs is to change context.record
      runHooks('enrichAttributes')

      return context.attributes
    })

    // Helper scope methods for cross-table search functionality
    addScopeMethod('getSchema', async ({ scopeOptions }) => {
      return scopeOptions.schema || null;
    })

    addScopeMethod('getSearchSchema', async ({ scopeOptions }) => {
      // Return explicit searchSchema if defined, otherwise generate from schema
      if (scopeOptions.searchSchema) {
        return scopeOptions.searchSchema;
      }
      
      // Generate searchSchema from schema fields with 'search' property
      if (scopeOptions.schema) {
        return generateSearchSchemaFromSchema(scopeOptions.schema);
      }
      
      return null;
    })

    addScopeMethod('getRelationships', ({ scopeOptions }) => {
      return scopeOptions.relationships || {};
    })


/**
 * QUERY
 * Retrieves a collection of resources (e.g., a list of articles) based on provided criteria.
 * This function sends a GET request to /api/{resourceType}.
 *
 * @param {string} resourceType - The type of resource collection to fetch (e.g., "articles").
 * @param {object} [queryParams={}] - Optional. An object to customize the query for the collection.
 * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload for each resource in the collection. These paths will be converted to a comma-separated string for the URL (e.g., `['author', 'comments.user']` becomes `author,comments.user`). Supports deep relationships (e.g., "publisher.country").
 * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets) for each resource in the collection and its included relationships. Keys are resource types, values are comma-separated field names.
 * @param {object} [queryParams.filters] - An object to filter the collection. Keys are filter parameters (specific to your API's implementation, e.g., 'status', 'title'), values are the filter criteria.
 * @param {string[]} [queryParams.sort=[]] - An optional array of fields to sort the collection by. Each string represents a field; prefix with '-' for descending order (e.g., `['title', '-published-date']` becomes `title,-published-date`).
 * @param {object} [queryParams.page] - An object for pagination. Typically includes `number` (page number) and `size` (items per page). E.g., `{ number: 1, size: 10 }`.
 * @returns {Promise<object>} A Promise that resolves to the JSON:API response document containing the resource collection.
 *
 * @example
 * // Example 1: Get a paginated list of articles, including their authors.
 * const articlesResponse = await api.getCollection('articles', {
 *   include: ['author'],
 *   fields: {
 *     articles: 'title,published-date',
 *     people: 'name'
 *   },
 *   page: { number: 1, size: 2 },
 *   sort: ['-published-date']
 * });
 * @see GET /api/articles?include=author&fields[articles]=title,published-date&fields[people]=name&page[number]=1&page[size]=2&sort=-published-date
 * // Example Return Value for articlesResponse:
 * // {
 * //   "data": [
 * //     {
 * //       "type": "articles", "id": "123",
 * //       "attributes": { "title": "First Article", "published-date": "2024-07-01T10:00:00Z" },
 * //       "relationships": { "author": { "data": { "type": "people", "id": "9" } } }
 * //     },
 * //     {
 * //       "type": "articles", "id": "124",
 * //       "attributes": { "title": "Second Article", "published-date": "2024-06-30T15:30:00Z" },
 * //       "relationships": { "author": { "data": { "type": "people", "id": "10" } } }
 * //     }
 * //   ],
 * //   "included": [
 * //     { "type": "people", "id": "9", "attributes": { "name": "John Doe" } },
 * //     { "type": "people", "id": "10", "attributes": { "name": "Jane Smith" } }
 * //   ]
 * // }
 *
 * @example
 * // Example 2: Get a filtered list of articles with deep relationships (publisher and its country).
 * const complexArticles = await api.getCollection('articles', {
 *   filter: {
 *     status: 'published',
 *     author_id: '9'
 *   },
 *   include: ['publisher.country'],
 *   fields: {
 *     articles: 'title',
 *     publishers: 'name',
 *     countries: 'iso-code'
 *   },
 *   sort: ['title']
 * });
 * @see GET /api/articles?filter[status]=published&filter[author_id]=9&include=publisher.country&fields[articles]=title&fields[publishers]=name&fields[countries]=iso-code&sort=title
 * // Example Return Value for complexArticles:
 * // {
 * //   "data": [
 * //     {
 * //       "type": "articles",
 * //       "id": "1",
 * //       "attributes": { "title": "Advanced API Design" },
 * //       "relationships": {
 * //         "publisher": { "data": { "type": "publishers", "id": "pub-1" } }
 * //       }
 * //     },
 * //     {
 * //       "type": "articles",
 * //       "id": "2",
 * //       "attributes": { "title": "Understanding Filters" },
 * //       "relationships": {
 * //         "publisher": { "data": { "type": "publishers", "id": "pub-2" } }
 * //       }
 * //     }
 * //   ],
 * //   "included": [
 * //     { // The publisher resource
 * //       "type": "publishers", "id": "pub-1", "attributes": { "name": "Awesome Books Inc." },
 * //       "relationships": { // This relationship links to the country
 * //         "country": { "data": { "type": "countries", "id": "us" } }
 * //       }
 * //     },
 * //     { // The country resource, referenced by 'pub-1'
 * //       "type": "countries", "id": "us", "attributes": { "name": "United States", "iso-code": "US" }
 * //     },
 * //     { // Another publisher resource
 * //       "type": "publishers", "id": "pub-2", "attributes": { "name": "Global Publishers Ltd." },
 * //       "relationships": { // This relationship links to its country
 * //         "country": { "data": { "type": "countries", "id": "uk" } }
 * //       }
 * //     },
 * //     { // Another country resource, referenced by 'pub-2'
 * //       "type": "countries", "id": "uk", "attributes": { "name": "United Kingdom", "iso-code": "GB" }
 * //     }
 * //   ]
 * // }
 *
 * @example
 * // Example 3: Get articles by a specific author, with comments and their users.
 * const authorArticles = await api.getCollection('articles', {
 *   filters: {
 *     author_id: '456'
 *   },
 *   include: ['comments.user'],
 *   fields: {
 *     articles: 'title',
 *     comments: 'body',
 *     users: 'username'
 *   },
 *   sort: ['created-at']
 * });
 * @see GET /api/articles?filters[author_id]=456&include=comments.user&fields[articles]=title&fields[comments]=body&fields[users]=username&sort=created-at
 * // Example Return Value for authorArticles (truncated for brevity):
 * // {
 * //   "data": [
 * //     {
 * //       "type": "articles", "id": "art-a",
 * //       "attributes": { "title": "Article A by Author 456" },
 * //       "relationships": { "comments": { "data": [{ "type": "comments", "id": "comment-1" }] } }
 * //     }
 * //   ],
 * //   "included": [
 * //     {
 * //       "type": "comments", "id": "comment-1", "attributes": { "body": "Great article!" },
 * //       "relationships": { "user": { "data": { "type": "users", "id": "user-a" } } }
 * //     },
 * //     { "type": "users", "id": "user-a", "attributes": { "username": "CommenterOne" } }
 * //   ]
 * // }
 */
    addScopeMethod('query', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName, log }) => {
      // Make the method available to all hooks
      context.method = 'query'
      
      // Move HTTP objects from params to context
      moveHttpObjectsToContext(params, context);

      // Sanitise parameters
      log.trace('[QUERY-METHOD] Before sanitizing params:', params);
      params.queryParams = params.queryParams || {}
      params.queryParams.include = params.queryParams.include || []
      params.queryParams.fields = params.queryParams.fields || {}
      params.queryParams.filters = params.queryParams.filters || {} 
      params.queryParams.sort = params.queryParams.sort || []
      params.queryParams.page = params.queryParams.page || {}
      log.trace('[QUERY-METHOD] After sanitizing params:', params);

      // Get scope-specific or global configuration
      const sortableFields = scopeOptions.sortableFields || vars.sortableFields;
      const defaultSort = scopeOptions.defaultSort || vars.defaultSort;
      const idProperty = scopeOptions.idProperty || vars.idProperty;

      // Apply default sort if no sort specified
      if (params.queryParams.sort.length === 0 && defaultSort) {
        params.queryParams.sort = Array.isArray(defaultSort) ? defaultSort : [defaultSort];
      }

      // Check payload with sortable fields validation
      validateQueryPayload(params, sortableFields);

      // Generate complete searchSchema from both schema and explicit searchSchema
      const searchSchema = generateSearchSchemaFromSchema(scopeOptions.schema, scopeOptions.searchSchema);
      
      // Ensure searchSchema fields are marked as indexed
      ensureSearchFieldsAreIndexed(searchSchema);

      // Validate search/filter parameters against searchSchema
      if (params.queryParams.filters && Object.keys(params.queryParams.filters).length > 0) {
        // Use searchSchema (explicit or generated) for validation
        const schemaToValidate = searchSchema || scopeOptions.schema;
        
        if (schemaToValidate) {
          // Create a schema instance for validation
          const filterSchema = CreateSchema(schemaToValidate);
          
          // Validate the filter parameters
          const { validatedObject, errors } = await filterSchema.validate(params.queryParams.filters, { 
            onlyObjectValues: true // Partial validation for filters
          });
          
          // If there are validation errors, throw an error
          if (Object.keys(errors).length > 0) {
            const violations = Object.entries(errors).map(([field, error]) => ({
              field: `filters.${field}`,
              rule: error.code || 'invalid_value',
              message: error.message
            }));
            
            debugger
            throw new RestApiValidationError(
              'Invalid filter parameters',
              { 
                fields: Object.keys(errors).map(field => `filters.${field}`),
                violations 
              }
            );
          }
          
          // Replace filter with validated/transformed values
          params.queryParams.filters = validatedObject;
        }
      }
    
      /*
      TODO: Make them general context fields
      const filters = hookParams.context?.knexQuery?.filters;
      const searchSchema = hookParams.context?.knexQuery?.searchSchema;
      const tableName = hookParams.context?.knexQuery?.tableName; 
      */

      runHooks('checkPermissions')
      runHooks('checkPermissionsQuery')
      
      runHooks('beforeData')
      runHooks('beforeDataQuery')
      context.record = await helpers.dataQuery({
        scopeName, 
        queryParams: params.queryParams,
        idProperty: vars.idProperty,
        searchSchema,  // Pass the searchSchema (explicit or generated)
        runHooks,
        context,  // Pass context so it can be shared with hooks
        methodParams: { transaction: context.transaction }
      })
    
      // Make a backup
      try {
        context.originalRecord = structuredClone(context.record)
      } catch (e) {
        log.error('Failed to clone record:', {
          error: e.message,
          recordKeys: Object.keys(context.record || {}),
          hasExpressReq: !!context.expressReq
        });
        throw e;
      }

      // This will enhance record, which is the WHOLE JSON:API record
      runHooks('enrichRecord')

      // Run enrichAttributes for every single set of attribute, calling it from the right API
      for (const entry of context.record.data) {
        entry.attributes = await scope.enrichAttributes({attributes: entry.attributes, parentContext: context})
      }
      for (const entry of (context.record.included || [])) {
        entry.attributes = await scopes[entry.type].enrichAttributes({attributes: entry.attributes, parentContext: context})
      }

      // The called hooks should NOT change context.record
      runHooks('finish')
      runHooks('finishQuery')
      return context.record
    })

    /**
  * GET
  * Retrieves a single resource by its type and ID.
  * @param {(string|number)} id - The unique ID of the resource to fetch.
  * @param {object} [queryParams={}] - Optional. An object to customize the query.
  * @param {string} [queryParams.include] - A comma-separated string of relationship paths to sideload (e.g., "authors,publisher").
  * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, values are comma-separated field names.
  * @returns {Promise<object>} A Promise that resolves to the JSON:API response document.
  *
  * @example
  * // Example 1: Get a single article with its to-one 'author' relationship
  * const articleResponse = await api.get('articles', '123', {
  *   include: 'author',
  *   fields: {
  *     articles: 'title,body,published-date',
  *     people: 'name'
  *   }
  * });
  * @see GET /api/articles/123?include=author&fields[articles]=title,body,published-date&fields[people]=name
  * // Example Return Value for articleResponse:
  * // {
  * //   "links": { "self": "/api/articles/123" },
  * //   "data": {
  * //     "type": "articles", "id": "123",
  * //     "attributes": { "title": "...", "body": "...", "published-date": "..." },
  * //     "relationships": { "author": { "data": { "type": "people", "id": "9" } } }
  * //   },
  * //   "included": [{ "type": "people", "id": "9", "attributes": { "name": "John Doe" } }]
  * // }
  *
  * @example
  * // Example 2: Get a single article with both to-many 'authors' and to-one 'publisher'
  * const complexArticle = await api.get('articles', '123', {
  * include: 'authors,publisher',
  *   fields: {
  *     articles: 'title',
  *     people: 'name',
  *     publishers: 'name,country-code'
  *   }
  * });
  * @see GET /api/articles/123?include=authors,publisher&fields[articles]=title&fields[people]=name&fields[publishers]=name,country-code
  * // Example Return Value for complexArticle:
  * // {
  * //   "links": { "self": "/api/articles/123" },
  * //   "data": {
  * //     "type": "articles",
  * //     "id": "123",
  * //     "attributes": { "title": "A Joint Effort" },
  * //     "relationships": {
  * //       "authors": {
  * //         "data": [
  * //           { "type": "people", "id": "9" },
  * //           { "type": "people", "id": "10" }
  * //         ]
  * //       },
  * //       "publisher": {
  * //         "data": { "type": "publishers", "id": "pub-1" }
  * //       }
  * //     }
  * //   },
  * //   "included": [
  * //     { "type": "people", "id": "9", "attributes": { "name": "John Doe" } },
  * //     { "type": "people", "id": "10", "attributes": { "name": "Richard Roe" } },
  * //     { "type": "publishers", "id": "pub-1", "attributes": { "name": "Awesome Books Inc.", "country-code": "US" } }
  * //   ]
  * // }
  */
    addScopeMethod('get', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {

      // Make the method available to all hooks
      context.method = 'get'
      
      // Move HTTP objects from params to context
      moveHttpObjectsToContext(params, context);

      // Sanitise parameters
      params.queryParams = params.queryParams || {}
      params.queryParams.include = params.queryParams.include || []
      params.queryParams.fields = params.queryParams.fields || {}
      
      // Check payload
      validateGetPayload(params);

      runHooks('checkPermissions')
      runHooks('checkPermissionsGet')
      
      runHooks('beforeData')
      runHooks('beforeDataGet')
      context.record = await helpers.dataGet({
        scopeName, 
        id: params.id, 
        queryParams: params.queryParams,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: context.transaction }
      })
    
      // Check if record was found
      if (!context.record || !context.record.data) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: 'not_found',
            resourceType: scopeName,
            resourceId: params.id
          }
        );
      }
    
      runHooks('checkDataPermissions')
      runHooks('checkDataPermissionsGet')
      
      // Make a backup
      context.originalRecord = structuredClone(context.record)

      // This will enhance record, which is the WHOLE JSON:API record
      runHooks('enrichRecord')
      context.record.data.attributes = await scope.enrichAttributes({attributes: context.record.data.attributes, parentContext: context})
      for (const entry of (context.record.included || [])) {
        entry.attributes = await scopes[entry.type].enrichAttributes({attributes: entry.attributes, parentContext: context})
      }
      
      // The called hooks should NOT change context.record
      runHooks('finish')
      runHooks('finishGet')
      return context.record
    })

    /**
     * POST
     * Creates a new resource with optional relationships to existing resources.
     * 
     * This method follows the JSON:API specification for resource creation. It supports:
     * - Creating a resource with attributes only
     * - Creating a resource with one-to-one relationships (belongsTo) to existing resources
     * - Creating a resource with many-to-many relationships to existing resources
     * 
     * NOTE: This method does NOT support creating multiple resources in a single request.
     * The JSON:API specification does not define 'included' for POST requests.
     *
     * @param {object} inputRecord - The JSON:API document for the request. It must contain a `data` object for the primary resource.
     * @param {object} [queryParams={}] - Optional. An object to customize the query for the returned document.
     * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload in the response. These paths will be converted to a comma-separated string (e.g., `['author', 'tags']`).
     * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, values are comma-separated field names.
     * @param {object} [transaction] - Optional. An existing database transaction to use for this operation.
     * @returns {Promise<object>} A Promise that resolves to the JSON:API document containing the newly created resource.
     *
     * @example
     * // Case 1: Create a simple resource with only attributes
     * const article = await api.resources.articles.post({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "attributes": {
     *         "title": "My Article",
     *         "body": "This article has no relationships.",
     *         "status": "draft"
     *       }
     *     }
     *   }
     * });
     * @see POST /api/articles
     * // Returns:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "123",
     * //     "attributes": {
     * //       "title": "My Article",
     * //       "body": "This article has no relationships.",
     * //       "status": "draft"
     * //     }
     * //   }
     * // }
     *
     * @example
     * // Case 2: Create a resource with a one-to-one relationship (belongsTo)
     * const article = await api.resources.articles.post({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "attributes": {
     *         "title": "Article with Author",
     *         "body": "Content here"
     *       },
     *       "relationships": {
     *         "author": {
     *           "data": { "type": "people", "id": "42" }  // Must be existing person
     *         }
     *       }
     *     }
     *   }
     * });
     * @see POST /api/articles
     * // Returns:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "124",
     * //     "attributes": {
     * //       "title": "Article with Author",
     * //       "body": "Content here"
     * //     },
     * //     "relationships": {
     * //       "author": {
     * //         "data": { "type": "people", "id": "42" }
     * //       }
     * //     }
     * //   }
     * // }
     *
     * @example
     * // Case 3: Create a resource with many-to-many relationships
     * const article = await api.resources.articles.post({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "attributes": {
     *         "title": "Tagged Article",
     *         "body": "Article with multiple tags"
     *       },
     *       "relationships": {
     *         "author": {
     *           "data": { "type": "people", "id": "42" }  // One-to-one
     *         },
     *         "tags": {
     *           "data": [                                 // Many-to-many
     *             { "type": "tags", "id": "1" },         // Must be existing tags
     *             { "type": "tags", "id": "2" },
     *             { "type": "tags", "id": "3" }
     *           ]
     *         }
     *       }
     *     }
     *   },
     *   queryParams: {
     *     include: ['author', 'tags']  // Include related resources in response
     *   }
     * });
     * @see POST /api/articles?include=author,tags
     * // Returns:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "125",
     * //     "attributes": {
     * //       "title": "Tagged Article",
     * //       "body": "Article with multiple tags"
     * //     },
     * //     "relationships": {
     * //       "author": {
     * //         "data": { "type": "people", "id": "42" }
     * //       },
     * //       "tags": {
     * //         "data": [
     * //           { "type": "tags", "id": "1" },
     * //           { "type": "tags", "id": "2" },
     * //           { "type": "tags", "id": "3" }
     * //         ]
     * //       }
     * //     }
     * //   },
     * //   "included": [
     * //     {
     * //       "type": "people",
     * //       "id": "42",
     * //       "attributes": { "name": "John Doe", "email": "john@example.com" }
     * //     },
     * //     {
     * //       "type": "tags",
     * //       "id": "1",
     * //       "attributes": { "name": "javascript", "slug": "javascript" }
     * //     },
     * //     {
     * //       "type": "tags",
     * //       "id": "2",
     * //       "attributes": { "name": "api", "slug": "api" }
     * //     },
     * //     {
     * //       "type": "tags",
     * //       "id": "3",
     * //       "attributes": { "name": "rest", "slug": "rest" }
     * //     }
     * //   ]
     * // }
     *
     * @example
     * // Case 4: Using transactions for atomic operations
     * const trx = await api.knex.instance.transaction();
     * try {
     *   const author = await api.resources.people.post({
     *     transaction: trx,
     *     inputRecord: {
     *       "data": {
     *         "type": "people",
     *         "attributes": { "name": "Jane Author" }
     *       }
     *     }
     *   });
     *   
     *   const article = await api.resources.articles.post({
     *     transaction: trx,
     *     inputRecord: {
     *       "data": {
     *         "type": "articles",
     *         "attributes": { "title": "Jane's First Article" },
     *         "relationships": {
     *           "author": {
     *             "data": { "type": "people", "id": author.data.id }
     *           }
     *         }
     *       }
     *     }
     *   });
     *   
     *   await trx.commit();
     * } catch (error) {
     *   await trx.rollback();
     *   throw error;
     * }
     */

    addScopeMethod('post', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {

      // Make the method available to all hooks
      context.method = 'post'
      
      // Move HTTP objects from params to context
      moveHttpObjectsToContext(params, context);
      context.scopeName = scopeName
      context.params = params
      
      // Extract transaction from params if provided
      const existingTrx = params.transaction;
      const trx = existingTrx || (api.knex?.instance ? await api.knex.instance.transaction() : null);
      const shouldCommit = trx && !existingTrx;
      
      try {
        // Update context with transaction
        context.transaction = trx;
        
        // Run early hooks for pre-processing (e.g., file handling)
        await runHooks('beforeProcessing')
        await runHooks('beforeProcessingPost')

        // Sanitise parameters and payload
        params.queryParams = params.queryParams  || {}
        params.queryParams.fields = params.queryParams.fields  || {}
        params.queryParams.include = params.queryParams.include  || []

        // Place the record in the context
        context.inputRecord = params.inputRecord
        context.queryParams = params.queryParams

        // Check payload with scope validation
        validatePostPayload(params.inputRecord, scopes)
        
        // Validate that the resource type matches the current scope
        if (params.inputRecord.data.type !== scopeName) {
          throw new RestApiValidationError(
            `Resource type mismatch. Expected '${scopeName}' but got '${params.inputRecord.data.type}'`,
            { 
              fields: ['data.type'], 
              violations: [{ 
                field: 'data.type', 
                rule: 'resource_type_match', 
                message: `Resource type must be '${scopeName}'` 
              }] 
            }
          );
        }

        // Create schema for validation
        context.schema = CreateSchema(scopeOptions.insertSchema || scopeOptions.schema || {})

        // Apply schema to the main attributes
        runHooks('beforeSchemaValidate')
        runHooks('beforeSchemaValidatePost')
        // Validate main resource attributes
        const { validatedObject: validatedAttrs, errors: mainErrors } = await context.schema.validate(context.inputRecord.data.attributes || {});
        if (Object.keys(mainErrors).length > 0) {
          const violations = Object.entries(mainErrors).map(([field, error]) => ({
            field: `data.attributes.${field}`,
            rule: error.code || 'invalid_value',
            message: error.message
          }));
          
          throw new RestApiValidationError(
            'Schema validation failed for resource attributes',
            { 
              fields: Object.keys(mainErrors).map(field => `data.attributes.${field}`),
              violations 
            }
          );
        }
        context.inputRecord.data.attributes = validatedAttrs;
        
        // Remove included validation since JSON:API doesn't support it
        if (context.inputRecord.included) {
          throw new RestApiPayloadError(
            'POST requests cannot include an "included" array. JSON:API does not support creating multiple resources in a single request.',
            { path: 'included', expected: 'undefined', received: 'array' }
          );
        }
        
        runHooks('afterSchemaValidatePost')
        runHooks('afterSchemaValidate')

        // Get relationships definition
        const relationships = scopes[scopeName].getRelationships();
        const schemaFields = scopeOptions.schema || {};
        
        // Process relationships using helper
        const { belongsToUpdates, manyToManyRelationships } = processRelationships(
          context.inputRecord,
          schemaFields,
          relationships
        );

        // Merge belongsTo updates with attributes
        if (Object.keys(belongsToUpdates).length > 0) {
          context.inputRecord.data.attributes = {
            ...context.inputRecord.data.attributes,
            ...belongsToUpdates
          };
        }

        runHooks('checkPermissions')
        runHooks('checkPermissionsPost')
        
        runHooks('beforeDataCall')
        runHooks('beforeDataCallPost')
        
        // Create the main record - storage helper should return the created record with its ID
        context.record = await helpers.dataPost({
          scopeName,
          inputRecord: context.inputRecord,
          idProperty: vars.idProperty,
          runHooks,
          methodParams: { transaction: trx }
        });
        
        runHooks('afterDataCallPost')
        runHooks('afterDataCall')
        
        // Process many-to-many relationships after main record creation
        for (const { relName, relDef, relData } of manyToManyRelationships) {
          // Validate pivot resource exists
          if (!scopes[relDef.through]) {
            throw new RestApiValidationError(
              `Pivot resource '${relDef.through}' not found for relationship '${relName}'`,
              { 
                fields: [`relationships.${relName}`],
                violations: [{
                  field: `relationships.${relName}`,
                  rule: 'missing_pivot_resource',
                  message: `Pivot resource '${relDef.through}' must be defined`
                }]
              }
            );
          }
          
          // Create pivot records using helper
          await createPivotRecords(context.record.data.id, relDef, relData, trx);
        }
        
        // Commit transaction if we created it
        if (shouldCommit) {
          await trx.commit();
        }
        
        // Get the full record with relationships if requested
        if (vars.returnFullRecord?.post !== false) {
          context.returnRecord = await helpers.dataGet({
            scopeName,
            id: context.record.data.id,
            queryParams: params.queryParams,
            idProperty: vars.idProperty,
            runHooks,
            methodParams: { transaction: existingTrx } // Use original transaction for read
          });
        } else {
          context.returnRecord = context.record;
        }
        
        // Enrich the return record's attributes
        if (context.returnRecord?.data?.attributes) {
          context.returnRecord.data.attributes = await scope.enrichAttributes({
            attributes: context.returnRecord.data.attributes, 
            parentContext: context
          });
        }
        
        // Enrich included resources if any
        for (const entry of (context.returnRecord?.included || [])) {
          entry.attributes = await scopes[entry.type].enrichAttributes({
            attributes: entry.attributes, 
            parentContext: context
          });
        }
        
        runHooks('finish')
        runHooks('finishPost')
        return context.returnRecord
        
      } catch (error) {
        // Rollback transaction if we created it
        if (shouldCommit) {
          await trx.rollback();
        }
        throw error;
      }
    })

   /**
   * PUT
   * Updates an existing top-level resource by completely replacing it.
   * This method supports updating both attributes and relationships (1:1 and n:n).
   * PUT is a complete replacement - any relationships not provided will be removed/nulled.
   * This method does NOT support creating new related resources via an `included` array.
   *
   * @param {string} id - The ID of the resource to update.
   * @param {object} inputRecord - The JSON:API document for the request. It must contain a `data` object for the primary resource. 
   * It CANNOT include an `included` array - all relationships must reference existing resources.
   * @param {object} [queryParams={}] - Optional. An object to customize the query for the returned document.
   * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload in the response. These paths 
   * will be converted to a comma-separated string (e.g., `['author', 'comments.user']`).
   * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, 
   * values are comma-separated field names.
   * @returns {Promise<object>} A Promise that resolves to the JSON:API document containing the updated resource.
   *
   * @example
   * // Case 1: Update a simple resource with only attributes.
   * const updatedArticle = await api.resources.articles.put({
   *   inputRecord: {
   *     "data": {
   *       "type": "articles",
   *       "id": "123",
   *       "attributes": {
   *         "title": "Updated Title",
   *         "body": "This is the completely replaced content."
   *       }
   *     }
   *   }
   * });
   * @see PUT /api/articles/123
   * // Example Return Value for updatedArticle:
   * // {
   * //   "data": {
   * //     "type": "articles",
   * //     "id": "123",
   * //     "attributes": {
   * //       "title": "Updated Title",
   * //       "body": "This is the completely replaced content."
   * //     }
   * //   }
   * // }
   *
   * @example
   * // Case 2: Replace a resource and update its relationships to EXISTING resources.
   * const replacedArticle = await api.resources.articles.put({
   *   inputRecord: {
   *     "data": {
   *       "type": "articles",
   *       "id": "124",
   *       "attributes": {
   *         "title": "Completely New Title",
   *         "body": "Entirely new content"
   *       },
   *       "relationships": {
   *         "authors": {
   *           "data": [
   *             { "type": "people", "id": "15" },
   *             { "type": "people", "id": "16" }
   *           ]
   *         },
   *         "publisher": {
   *           "data": { "type": "publishers", "id": "pub-3" }
   *         }
   *       }
   *     }
   *   }
   * });
   * @see PUT /api/articles/124
   * // Example Return Value for replacedArticle:
   * // {
   * //   "data": {
   * //     "type": "articles",
   * //     "id": "124",
   * //     "attributes": { 
   * //       "title": "Completely New Title",
   * //       "body": "Entirely new content"
   * //     },
   * //     "relationships": { 
   * //       "authors": {
   * //         "data": [
   * //           { "type": "people", "id": "15" },
   * //           { "type": "people", "id": "16" }
   * //         ]
   * //       },
   * //       "publisher": {
   * //         "data": { "type": "publishers", "id": "pub-3" }
   * //       }
   * //     }
   * //   }
   * // }
   *
   * @example
   * // Case 3: Replace a resource and include related resources in the response.
   * const replacedWithIncluded = await api.resources.articles.put({
   *   inputRecord: {
   *     "data": {
   *       "type": "articles",
   *       "id": "125",
   *       "attributes": {
   *         "title": "Article with Author Included",
   *         "body": "Content that replaces the previous version"
   *       },
   *       "relationships": {
   *         "author": {
   *           "data": { "type": "people", "id": "20" }
   *         }
   *       }
   *     }
   *   },
   *   queryParams: {
   *     include: ['author'],
   *     fields: {
   *       articles: 'title,body',
   *       people: 'name,email'
   *     }
   *   }
   * });
   * @see PUT /api/articles/125?include=author&fields[articles]=title,body&fields[people]=name,email
   * // Example Return Value for replacedWithIncluded:
   * // {
   * //   "data": {
   * //     "type": "articles",
   * //     "id": "125",
   * //     "attributes": { 
   * //       "title": "Article with Author Included",
   * //       "body": "Content that replaces the previous version"
   * //     },
   * //     "relationships": { 
   * //       "author": {
   * //         "data": { "type": "people", "id": "20" }
   * //       }
   * //     }
   * //   },
   * //   "included": [
   * //     { 
   * //       "type": "people", 
   * //       "id": "20", 
   * //       "attributes": { 
   * //         "name": "Alice Johnson",
   * //         "email": "alice@example.com"
   * //       } 
   * //     }
   * //   ]
   * // }
   *
   * @example
   * // Case 4: Invalid - attempting to create new resources with PUT will fail.
   * // This will throw an error because PUT cannot create new resources:
   * try {
   *   await api.resources.articles.put({
   *     inputRecord: {
   *       "data": {
   *         "type": "articles",
   *         "id": "126",
   *         "attributes": {
   *           "title": "Invalid PUT"
   *         },
   *         "relationships": {
   *           "author": {
   *             "data": { "type": "people", "id": "temp-new-author" }
   *           }
   *         }
   *       },
   *     "included": [
   *       { "type": "people", "id": "temp-new-author", "attributes": { "name": "New Author" } }
   *     ]
   *   });
   * } catch (error) {
   *   // Error: PUT requests cannot include an 'included' array for creating new resources
   * }
   */
   addScopeMethod('put', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions,
  scopeName }) => {
    
    context.method = 'put'
    
    // Move HTTP objects from params to context
    moveHttpObjectsToContext(params, context);
    
    context.scopeName = scopeName
    context.params = params
    
    // Extract transaction from params if provided
    const existingTrx = params.transaction;
    const trx = existingTrx || (api.knex?.instance ? await api.knex.instance.transaction() : null);
    const shouldCommit = trx && !existingTrx;
    
    try {
      // Update context with transaction
      context.transaction = trx;
      
      // Run early hooks for pre-processing (e.g., file handling)
      await runHooks('beforeProcessing')
      await runHooks('beforeProcessingPut')

    // Sanitise parameters
    params.queryParams = params.queryParams || {}
    params.queryParams.fields = params.queryParams.fields || {}
    params.queryParams.include = params.queryParams.include || []

    context.inputRecord = params.inputRecord
    context.queryParams = params.queryParams
    
    // Extract ID from request body as per JSON:API spec
    context.id = params.inputRecord.data.id
    
    // If both URL path ID and request body ID are provided, they must match
    if (params.id && params.id !== context.id) {
      throw new RestApiValidationError(
        `ID mismatch. URL path ID '${params.id}' does not match request body ID '${context.id}'`,
        { 
          fields: ['data.id'], 
          violations: [{ 
            field: 'data.id', 
            rule: 'id_consistency', 
            message: `Request body ID must match URL path ID when both are provided` 
          }] 
        }
      );
    }

    // Validate - PUT cannot have included
    if (context.inputRecord.included) {
      throw new RestApiPayloadError(
        'PUT requests cannot include an "included" array for creating new resources',
        { path: 'included', expected: 'undefined', received: 'array' }
      );
    }

    // Validate payload with scope validation
    validatePutPayload(context.inputRecord, scopes)
    
    // Validate that the resource type matches the current scope
    if (context.inputRecord.data.type !== scopeName) {
      throw new RestApiValidationError(
        `Resource type mismatch. Expected '${scopeName}' but got '${context.inputRecord.data.type}'`,
        { 
          fields: ['data.type'], 
          violations: [{ 
            field: 'data.type', 
            rule: 'resource_type_match', 
            message: `Resource type must be '${scopeName}'` 
          }] 
        }
      );
    }

    if (vars.loadRecordOnPut) {
      context.recordBefore = await helpers.dataGet({
        scopeName,
        id: context.id,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: context.transaction }
      });

      context.exists = !!context.recordBefore
    } else {
      // CHECK EXISTENCE FIRST - hooks need to know!
      context.exists = await helpers.dataExists({
        scopeName,
        id: context.id,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: context.transaction }
      });
    }
    context.isCreate = !context.exists;
    context.isUpdate = context.exists;

    // Create schema based on operation type
    context.schema = CreateSchema((context.isCreate ? scopeOptions.insertSchema : scopeOptions.updateSchema) || scopeOptions.schema || {})

    // Schema validation can now be different for create vs update
    runHooks('beforeSchemaValidate')
    runHooks('beforeSchemaValidatePut')
    runHooks(`beforeSchemaValidatePut${context.isCreate ? 'Create' : 'Update'}`)
  
    const { validatedObject, errors } = await context.schema.validate(context.inputRecord.data.attributes || {});
    if (Object.keys(errors).length > 0) {
      const violations = Object.entries(errors).map(([field, error]) => ({
        field: `data.attributes.${field}`,
        rule: error.code || 'invalid_value',
        message: error.message
      }));
      
      throw new RestApiValidationError(
        'Schema validation failed for resource attributes',
        { 
          fields: Object.keys(errors).map(field => `data.attributes.${field}`),
          violations 
        }
      );
    }
    context.inputRecord.data.attributes = validatedObject;

    runHooks('afterSchemaValidatePut')
    runHooks('afterSchemaValidate')

    // Get relationships definition
    const relationships = scopes[scopeName].getRelationships();
    const schemaFields = scopeOptions.schema || {};
    
    // Process relationships using helper
    const { belongsToUpdates, manyToManyRelationships } = processRelationships(
      context.inputRecord,
      schemaFields,
      relationships
    );
    
    // For PUT, we also need to handle relationships that are NOT provided
    // (they should be set to null/empty as PUT is a complete replacement)
    const allRelationships = {};
    
    // Collect all defined relationships for this resource
    for (const [relName, relDef] of Object.entries(relationships || {})) {
      if (relDef.manyToMany) {
        allRelationships[relName] = { type: 'manyToMany', relDef };
      }
    }
    
    // Also check schema fields for belongsTo relationships
    for (const [fieldName, fieldDef] of Object.entries(schemaFields)) {
      if (fieldDef.as && (fieldDef.belongsTo || fieldDef.belongsToPolymorphic)) {
        allRelationships[fieldDef.as] = { 
          type: fieldDef.belongsToPolymorphic ? 'polymorphic' : 'belongsTo',
          fieldName,
          fieldDef 
        };
      }
    }
    
    // Process missing relationships (PUT should null them out)
    const providedRelationships = new Set(Object.keys(context.inputRecord.data.relationships || {}));
    for (const [relName, relInfo] of Object.entries(allRelationships)) {
      if (!providedRelationships.has(relName)) {
        if (relInfo.type === 'belongsTo') {
          belongsToUpdates[relInfo.fieldName] = null;
        } else if (relInfo.type === 'polymorphic') {
          const { typeField, idField } = relInfo.fieldDef.belongsToPolymorphic;
          belongsToUpdates[typeField] = null;
          belongsToUpdates[idField] = null;
        } else if (relInfo.type === 'manyToMany') {
          // Add to manyToManyRelationships with empty array
          manyToManyRelationships.push({
            relName,
            relDef: relInfo.relDef,
            relData: []  // Empty array means delete all
          });
        }
      }
    }

    // Merge belongsTo updates with attributes
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      };
    }

    // Permissions can now check differently
    runHooks('checkPermissions')
    runHooks('checkPermissionsPut')
    runHooks(`checkPermissionsPut${context.isCreate ? 'Create' : 'Update'}`)
  
    runHooks('beforeDataCall')
    runHooks('beforeDataCallPut')
    // Pass the operation type to the helper
    context.record = await helpers.dataPut({
      scopeName,
      id: context.id,
      schema: context.schema,
      inputRecord: context.inputRecord,
      queryParams: context.queryParams,
      isCreate: context.isCreate,  // Helper knows what to do
      idProperty: vars.idProperty,
      runHooks,
      methodParams: { transaction: context.transaction }
    });
    runHooks('afterDataCallPut')
    runHooks('afterDataCall')

    // Process many-to-many relationships after main record update (only if update succeeded)
    if (context.isUpdate) {
      for (const { relName, relDef, relData } of manyToManyRelationships) {
        // Validate pivot resource exists
        if (!scopes[relDef.through]) {
          throw new RestApiValidationError(
            `Pivot resource '${relDef.through}' not found for relationship '${relName}'`,
            { 
              fields: [`relationships.${relName}`],
              violations: [{
                field: `relationships.${relName}`,
                rule: 'missing_pivot_resource',
                message: `Pivot resource '${relDef.through}' must be defined`
              }]
            }
          );
        }
        
        // Delete existing pivot records
        await deleteExistingPivotRecords(context.id, relDef, trx);
        
        // Create new pivot records
        if (relData.length > 0) {
          await createPivotRecords(context.id, relDef, relData, trx);
        }
      }
    }
    
    // Commit transaction if we created it
    if (shouldCommit) {
      await trx.commit();
    }

    // If there was previous data, run a data permission check
    if (context.recordBefore) {      
      runHooks('checkDataPermissions')
      runHooks('checkDataPermissionsPut')
      runHooks(`checkDataPermissionsPut${context.isCreate ? 'Create' : 'Update'}`)
    }

    // Get return record if needed
    if (vars.returnFullRecord?.put !== false) {
      context.returnRecord = await helpers.dataGet({
        scopeName,
        id: context.id,
        queryParams: params.queryParams,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: existingTrx }  // Use original transaction for read
      });
    } else {
      context.returnRecord = context.record;
    }
    
    // Enrich the return record's attributes
    if (context.returnRecord?.data?.attributes) {
      context.returnRecord.data.attributes = await scope.enrichAttributes({
        attributes: context.returnRecord.data.attributes, 
        parentContext: context
      });
    }
    
    // Enrich included resources if any
    for (const entry of (context.returnRecord?.included || [])) {
      entry.attributes = await scopes[entry.type].enrichAttributes({
        attributes: entry.attributes, 
        parentContext: context
      });
    }

    runHooks('finish')
    runHooks('finishPut')
    return context.returnRecord
    
    } catch (error) {
      // Rollback transaction if we created it
      if (shouldCommit) {
        await trx.rollback();
      }
      throw error;
    }
  })

    /**
     * PATCH
     * Performs a partial update on an existing resource's attributes or relationships.
     * Unlike PUT, PATCH only updates the fields provided, leaving other fields unchanged.
     * This method supports updating both attributes and relationships (1:1 and n:n).
     * For relationships, only the ones explicitly provided will be updated.
     * Just like PUT, it CANNOT have the `included` array in data.
     *
     * @param {string} id - The ID of the resource to update.
     * @param {object} inputRecord - The JSON:API document for the request. It must contain a `data` object with partial updates. It CANNOT include an `included` array.
     * @param {object} [queryParams={}] - Optional. An object to customize the query for the returned document.
     * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload in the response. These paths will be converted to a comma-separated string (e.g., `['author', 'comments.user']`).
     * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, values are comma-separated field names.
     * @returns {Promise<object>} A Promise that resolves to the JSON:API document containing the updated resource.
     *
     * @example
     * // Case 1: Update only specific attributes of a resource.
     * const patchedArticle = await api.resources.articles.patch({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "id": "123",
     *       "attributes": {
     *         "title": "Updated Title Only"
     *         // Note: 'body' and other attributes remain unchanged
     *       }
     *     }
     *   }
     * });
     * @see PATCH /api/articles/123
     * // Example Return Value for patchedArticle:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "123",
     * //     "attributes": {
     * //       "title": "Updated Title Only",
     * //       "body": "Original body content remains",
     * //       "published-date": "2024-01-01T00:00:00Z"
     * //     }
     * //   }
     * // }
     *
     * @example
     * // Case 2: Update attributes and relationships partially.
     * const patchedWithRelationships = await api.resources.articles.patch({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "id": "124",
     *       "attributes": {
     *         "status": "published"
     *         // Other attributes like title, body remain unchanged
     *       },
     *       "relationships": {
     *         "reviewer": {
     *           "data": { "type": "people", "id": "30" }
     *         }
     *         // Other relationships like authors, publisher remain unchanged
     *       }
     *     }
     *   }
     * });
     * @see PATCH /api/articles/124
     * // Example Return Value for patchedWithRelationships:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "124",
     * //     "attributes": {
     * //       "title": "Original Title",
     * //       "body": "Original Content",
     * //       "status": "published"
     * //     },
     * //     "relationships": {
     * //       "authors": { "data": [{ "type": "people", "id": "9" }] },
     * //       "reviewer": { "data": { "type": "people", "id": "30" } },
     * //       "publisher": { "data": { "type": "publishers", "id": "pub-1" } }
     * //     }
     * //   }
     * // }
     *
     * @example
     * // Case 3: Patch with included resources in response.
     * const patchedWithIncluded = await api.resources.articles.patch({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "id": "125",
     *       "attributes": {
     *         "last-modified": "2024-07-01T12:00:00Z"
     *       }
     *     }
     *   },
     *   queryParams: {
     *     include: ['author', 'reviewer'],
     *     fields: {
     *       articles: 'title,last-modified',
     *       people: 'name'
     *     }
     *   }
     * });
     * @see PATCH /api/articles/125?include=author,reviewer&fields[articles]=title,last-modified&fields[people]=name
     * // Example Return Value for patchedWithIncluded:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "125",
     * //     "attributes": {
     * //       "title": "Existing Article Title",
     * //       "last-modified": "2024-07-01T12:00:00Z"
     * //     },
     * //     "relationships": {
     * //       "author": { "data": { "type": "people", "id": "15" } },
     * //       "reviewer": { "data": { "type": "people", "id": "20" } }
     * //     }
     * //   },
     * //   "included": [
     * //     { "type": "people", "id": "15", "attributes": { "name": "John Author" } },
     * //     { "type": "people", "id": "20", "attributes": { "name": "Jane Reviewer" } }
     * //   ]
     * // }
     *
     * @example
     * // Case 4: Clear a relationship using null.
     * const clearedRelationship = await api.resources.articles.patch({
     *   inputRecord: {
     *     "data": {
     *       "type": "articles",
     *       "id": "126",
     *       "relationships": {
     *         "reviewer": {
     *           "data": null  // Clear the reviewer relationship
     *         }
     *       }
     *     }
     *   }
     * });
     * @see PATCH /api/articles/126
     * // Example Return Value for clearedRelationship:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "126",
     * //     "attributes": { ... },
     * //     "relationships": {
     * //       "reviewer": { "data": null },
     * //       "author": { "data": { "type": "people", "id": "5" } }
     * //     }
     * //   }
     * // }
     */
    addScopeMethod('patch', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {
      
      // Make the method available to all hooks
      context.method = 'patch'
      
      // Move HTTP objects from params to context
      moveHttpObjectsToContext(params, context);
      
      context.scopeName = scopeName
      context.params = params
      
      // Extract transaction from params if provided
      const existingTrx = params.transaction;
      const trx = existingTrx || (api.knex?.instance ? await api.knex.instance.transaction() : null);
      const shouldCommit = trx && !existingTrx;
      
      try {
        // Update context with transaction
        context.transaction = trx;
        
        // Run early hooks for pre-processing (e.g., file handling)
        await runHooks('beforeProcessing')
        await runHooks('beforeProcessingPatch')

      // Sanitise parameters
      params.queryParams = params.queryParams || {}
      params.queryParams.fields = params.queryParams.fields || {}
      params.queryParams.include = params.queryParams.include || []

      context.inputRecord = params.inputRecord
      context.queryParams = params.queryParams
      
      // Extract ID from request body as per JSON:API spec
      context.id = params.inputRecord.data.id
      
      // If both URL path ID and request body ID are provided, they must match
      if (params.id && params.id !== context.id) {
        throw new RestApiValidationError(
          `ID mismatch. URL path ID '${params.id}' does not match request body ID '${context.id}'`,
          { 
            fields: ['data.id'], 
            violations: [{ 
              field: 'data.id', 
              rule: 'id_consistency', 
              message: `Request body ID must match URL path ID when both are provided` 
            }] 
          }
        );
      }

      // Validate - PATCH cannot have included
      if (context.inputRecord.included) {
        throw new RestApiPayloadError(
          'PATCH requests cannot include an "included" array for creating new resources',
          { path: 'included', expected: 'undefined', received: 'array' }
        );
      }

      validatePatchPayload(params.inputRecord, scopes)
      
      // Validate that the resource type matches the current scope
      if (params.inputRecord.data.type !== scopeName) {
        throw new RestApiValidationError(
          `Resource type mismatch. Expected '${scopeName}' but got '${params.inputRecord.data.type}'`,
          { 
            fields: ['data.type'], 
            violations: [{ 
              field: 'data.type', 
              rule: 'resource_type_match', 
              message: `Resource type must be '${scopeName}'` 
            }] 
          }
        );
      }

      // Create schema for validation
      context.schema = CreateSchema(scopeOptions.updateSchema || scopeOptions.schema || {})

      // Schema validation for partial updates
      runHooks('beforeSchemaValidate')
      runHooks('beforeSchemaValidatePatch')
      
      // Validate only the provided attributes (partial validation)
      if (context.inputRecord.data.attributes) {
        const { validatedObject, errors } = await context.schema.validate(
          context.inputRecord.data.attributes, 
          { onlyObjectValues: true }
        );
        if (Object.keys(errors).length > 0) {
          const violations = Object.entries(errors).map(([field, error]) => ({
            field: `data.attributes.${field}`,
            rule: error.code || 'invalid_value',
            message: error.message
          }));
          
          throw new RestApiValidationError(
            'Schema validation failed for resource attributes',
            { 
              fields: Object.keys(errors).map(field => `data.attributes.${field}`),
              violations 
            }
          );
        }
        context.inputRecord.data.attributes = validatedObject;
      }

      runHooks('afterSchemaValidatePatch')
      runHooks('afterSchemaValidate')

      // Get relationships definition
      const relationships = scopes[scopeName].getRelationships();
      const schemaFields = scopeOptions.schema || {};
      
      // Process relationships using helper (only for provided relationships in PATCH)
      const { belongsToUpdates, manyToManyRelationships } = processRelationships(
        context.inputRecord,
        schemaFields,
        relationships
      );

      // Merge belongsTo updates with attributes
      if (Object.keys(belongsToUpdates).length > 0) {
        context.inputRecord.data.attributes = {
          ...context.inputRecord.data.attributes,
          ...belongsToUpdates
        };
      }

      // Permissions check
      runHooks('checkPermissions')
      runHooks('checkPermissionsPatch')
      
      runHooks('beforeDataCall')
      runHooks('beforeDataCallPatch')

      // Call the storage helper - should return the patched record
      context.record = await helpers.dataPatch({
        scopeName,
        id: context.id,
        schema: context.schema,
        inputRecord: context.inputRecord,
        queryParams: context.queryParams,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: context.transaction }
      });

      runHooks('afterDataCallPatch')
      runHooks('afterDataCall')

      // Process many-to-many relationships after main record update
      // For PATCH, we only update the relationships that were explicitly provided
      for (const { relName, relDef, relData } of manyToManyRelationships) {
        // Validate pivot resource exists
        if (!scopes[relDef.through]) {
          throw new RestApiValidationError(
            `Pivot resource '${relDef.through}' not found for relationship '${relName}'`,
            { 
              fields: [`relationships.${relName}`],
              violations: [{
                field: `relationships.${relName}`,
                rule: 'missing_pivot_resource',
                message: `Pivot resource '${relDef.through}' must be defined`
              }]
            }
          );
        }
        
        // Delete existing pivot records for this relationship
        await deleteExistingPivotRecords(context.id, relDef, trx);
        
        // Create new pivot records if any
        if (relData.length > 0) {
          await createPivotRecords(context.id, relDef, relData, trx);
        }
      }
      
      // Commit transaction if we created it
      if (shouldCommit) {
        await trx.commit();
      }

      runHooks('checkDataPermissions')
      runHooks('checkDataPermissionsPatch')

      // Get return record if needed
      if (vars.returnFullRecord?.patch !== false) {
        context.returnRecord = await helpers.dataGet({
          scopeName,
          id: context.id,
          queryParams: params.queryParams,
          idProperty: vars.idProperty,
          runHooks,
          methodParams: { transaction: existingTrx }  // Use original transaction for read
        });
      } else {
        context.returnRecord = context.record;
      }
      
      // Enrich the return record's attributes
      if (context.returnRecord?.data?.attributes) {
        context.returnRecord.data.attributes = await scope.enrichAttributes({
          attributes: context.returnRecord.data.attributes, 
          parentContext: context
        });
      }
      
      // Enrich included resources if any
      for (const entry of (context.returnRecord?.included || [])) {
        entry.attributes = await scopes[entry.type].enrichAttributes({
          attributes: entry.attributes, 
          parentContext: context
        });
      }

      runHooks('finish')
      runHooks('finishPatch')
      return context.returnRecord
      
      } catch (error) {
        // Rollback transaction if we created it
        if (shouldCommit) {
          await trx.rollback();
        }
        throw error;
      }
    })

    /**
     * DELETE
     * Permanently deletes a resource.
     *
     * @param {string} id - The ID of the resource to delete.
     * @returns {Promise<void>} A Promise that resolves when the deletion is complete. Typically returns no content (204).
     *
     * @example
     * // Case 1: Delete a simple resource
     * await api.scopes.articles.delete({ id: '123' });
     * @see DELETE /api/articles/123
     * // Returns: 204 No Content (no response body)
     *
     * @example
     * // Case 2: Delete with cascading relationships (handled by storage layer)
     * await api.scopes.authors.delete({ id: '456' });
     * @see DELETE /api/authors/456
     * // The storage layer may handle cascading deletes based on foreign key constraints
     * // Returns: 204 No Content
     *
     * @example
     * // Case 3: Attempting to delete non-existent resource
     * try {
     *   await api.scopes.articles.delete({ id: 'non-existent' });
     * } catch (error) {
     *   // Error: 404 Not Found - Resource does not exist
     * }
     */
    addScopeMethod('delete', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {
      // Make the method available to all hooks
      context.method = 'delete'
      
      // Move HTTP objects from params to context
      moveHttpObjectsToContext(params, context);
      
      // Set the ID in context
      context.id = params.id
      
      // No payload validation needed for DELETE
      // No schema needed for DELETE
      
      // Run permission checks
      runHooks('checkPermissions')
      runHooks('checkPermissionsDelete')
      
      // Before data operations
      runHooks('beforeDataCall')
      runHooks('beforeDataCallDelete')
      
      // Initialize record context for hooks
      context.record = {}
      
      // Call the storage helper
      await helpers.dataDelete({
        scopeName,
        id: context.id,
        idProperty: vars.idProperty,
        runHooks,
        methodParams: { transaction: context.transaction }
      });
      
      runHooks('afterDataCallDelete')
      runHooks('afterDataCall')
      
      // No return record for DELETE (204 No Content)
      
      runHooks('finish')
      runHooks('finishDelete')
      
      // DELETE typically returns void/undefined (204 No Content)
      return;
    })


        // Define default storage helpers that throw errors
    helpers.dataExists = async function({ scopeName, id, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for exists. Install a storage plugin.`);
    };

    helpers.dataGet = async function({ scopeName, id, queryParams, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for get. Install a storage plugin.`);
    };
    
    helpers.dataQuery = async function({ scopeName, queryParams, idProperty, searchSchema, runHooks, context, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for query. Install a storage plugin.`);
    };
    
    helpers.dataPost = async function({ scopeName, inputRecord, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for post. Install a storage plugin.`);
    };

    helpers.dataPatch = async function({ scopeName, id, inputRecord, schema, queryParams, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const _schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for patch. Install a storage plugin.`);
    };

    helpers.dataPut = async function({ scopeName, id, schema, inputRecord, isCreate, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schemaDefinition = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for put. Install a storage plugin.`);
    };
    
    helpers.dataDelete = async function({ scopeName, id, idProperty, runHooks, transaction }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = api.scopes[scopeName];
      if (scope && scope._scopeOptions) {
        const schema = scope._scopeOptions.schema;
        const relationships = scope._scopeOptions.relationships;
        const tableName = scope._scopeOptions.tableName || scopeName;
      }
      
      throw new Error(`No storage implementation for delete. Install a storage plugin.`);
    };



  }
};