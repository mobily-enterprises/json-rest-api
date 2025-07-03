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

export const RestApiPlugin = {
  name: 'rest-api',

  install({ helpers, addScopeMethod, vars, addHook, apiOptions, pluginOptions, api, setScopeAlias }) {

    // Initialize the rest namespace for REST API functionality
    api.rest = {};

    // Helper function to generate searchSchema from schema fields with 'search' property
    const generateSearchSchemaFromSchema = (schema) => {
      if (!schema) return null;
      
      const searchSchema = {};
      
      Object.entries(schema).forEach(([fieldName, fieldDef]) => {
        if (fieldDef.search) {
          if (fieldDef.search === true) {
            // Simple boolean - use field definition with default filter
            searchSchema[fieldName] = {
              type: fieldDef.type,
              enum: fieldDef.enum,
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
                searchSchema[filterName] = {
                  type: fieldDef.type,
                  actualField: fieldName,
                  ...filterDef
                };
              });
            } else {
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
          searchSchema[filterName] = filterDef;
        });
      }
      
      return Object.keys(searchSchema).length > 0 ? searchSchema : null;
    };

    // Set up REST-friendly aliases
    setScopeAlias('resources', 'addResource');

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


/**
 * QUERY
 * Retrieves a collection of resources (e.g., a list of articles) based on provided criteria.
 * This function sends a GET request to /api/{resourceType}.
 *
 * @param {string} resourceType - The type of resource collection to fetch (e.g., "articles").
 * @param {object} [queryParams={}] - Optional. An object to customize the query for the collection.
 * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload for each resource in the collection. These paths will be converted to a comma-separated string for the URL (e.g., `['author', 'comments.user']` becomes `author,comments.user`). Supports deep relationships (e.g., "publisher.country").
 * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets) for each resource in the collection and its included relationships. Keys are resource types, values are comma-separated field names.
 * @param {object} [queryParams.filter] - An object to filter the collection. Keys are filter parameters (specific to your API's implementation, e.g., 'status', 'title'), values are the filter criteria.
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
 *   filter: {
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
 * @see GET /api/articles?filter[author_id]=456&include=comments.user&fields[articles]=title&fields[comments]=body&fields[users]=username&sort=created-at
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
    addScopeMethod('query', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {
      // Make the method available to all hooks
      context.method = 'query'

      // Sanitise parameters
      params.queryParams = params.queryParams || {}
      params.queryParams.include = params.queryParams.include || []
      params.queryParams.fields = params.queryParams.fields || {}
      params.queryParams.filter = params.queryParams.filter || {} 
      params.queryParams.sort = params.queryParams.sort || []
      params.queryParams.page = params.queryParams.page || {}

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

      // Generate searchSchema if not explicitly defined
      let searchSchema = scopeOptions.searchSchema;
      if (!searchSchema && scopeOptions.schema) {
        searchSchema = generateSearchSchemaFromSchema(scopeOptions.schema);
      }

      // Validate search/filter parameters against searchSchema
      if (params.queryParams.filter && Object.keys(params.queryParams.filter).length > 0) {
        // Use searchSchema (explicit or generated) for validation
        const schemaToValidate = searchSchema || scopeOptions.schema;
        
        if (schemaToValidate) {
          // Create a schema instance for validation
          const filterSchema = CreateSchema(schemaToValidate);
          
          // Validate the filter parameters
          const { validatedObject, errors } = await filterSchema.validate(params.queryParams.filter, { 
            onlyObjectValues: true // Partial validation for filters
          });
          
          // If there are validation errors, throw an error
          if (Object.keys(errors).length > 0) {
            const violations = Object.entries(errors).map(([field, error]) => ({
              field: `filter.${field}`,
              rule: error.code || 'invalid_value',
              message: error.message
            }));
            
            throw new RestApiValidationError(
              'Invalid filter parameters',
              { 
                fields: Object.keys(errors).map(field => `filter.${field}`),
                violations 
              }
            );
          }
          
          // Replace filter with validated/transformed values
          params.queryParams.filter = validatedObject;
        }
      }
      
      runHooks('checkPermissions')
      runHooks('checkPermissionsQuery')
      
      runHooks('beforeData')
      runHooks('beforeDataQuery')
      context.record = await helpers.dataQuery({
        scopeName, 
        queryParams: params.queryParams,
        idProperty: vars.idProperty,
        searchSchema  // Pass the searchSchema (explicit or generated)
      })
    
      // Make a backup
      context.originalRecord = structuredClone(context.record)

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
        idProperty: vars.idProperty
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
     * Creates a new top-level resource. Can also create related resources in the same request, via data.included
     *
     * @param {object} inputRecord - The JSON:API document for the request. It must contain a `data` object for the primary resource. It can also include an `included` array for compound document creation.
     * @param {object} [queryParams={}] - Optional. An object to customize the query for the returned document.
     * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload in the response. These paths will be converted to a comma-separated string (e.g., `['author', 'comments.user']`).
     * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, values are comma-separated field names.
     * @returns {Promise<object>} A Promise that resolves to the JSON:API document containing the newly created resource.
     *
     * @example
     * // Case 1: Create a simple resource with only attributes.
     * const simpleArticle = await api.post('articles', {
     *   "data": {
     *     "type": "articles",
     *     "attributes": {
     *       "title": "Standalone Post",
     *       "body": "This article has no relationships."
     *     }
     *   }
     * });
     * @see POST /api/articles
     * // Example Return Value for simpleArticle:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "123",
     * //     "attributes": {
     * //       "title": "Standalone Post",
     * //       "body": "This article has no relationships."
     * //     }
     * //   }
     * // }
     *
     * @example
     * // Case 2: Create a resource and link it to MULTIPLE EXISTING relationships.
     * const linkedArticle = await api.post('articles', {
     *   "data": {
     *     "type": "articles",
     *     "attributes": {
     *       "title": "Post by an Existing Team"
     *     },
     *     "relationships": {
     *       "authors": {
     *         "data": [
     *           { "type": "people", "id": "9" },
     *           { "type": "people", "id": "10" }
     *         ]
     *       },
     *       "publisher": {
     *         "data": { "type": "publishers", "id": "pub-1" }
     *       }
     *     }
     *   }
     * });
     * @see POST /api/articles
     * // Example Return Value for linkedArticle:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "124",
     * //     "attributes": { "title": "Post by an Existing Team" },
     * //     "relationships": { ... }
     * //   }
     * // }
     * // There is NO 'included' in the response because all related resources already existed.
     *
     * @example
     * // Case 3: Create a resource AND MULTIPLE NEW related resources (compound document).
     * const compoundArticle = await api.post('articles', {
     *   "data": {
     *     "type": "articles",
     *     "attributes": {
     *       "title": "A New Team's First Post"
     *     },
     *     "relationships": {
     *       "authors": {
     *         "data": [
     *           { "type": "people", "id": "temp-author-1" },
     *           { "type": "people", "id": "temp-author-2" }
     *         ]
     *       },
     *       "publisher": {
     *         "data": { "type": "publishers", "id": "temp-pub-xyz" }
     *       }
     *     }
     *   },
     *   "included": [
     *     { "type": "people", "id": "temp-author-1", "attributes": { "name": "Jane Doe" } },
     *     { "type": "people", "id": "temp-author-2", "attributes": { "name": "Richard Roe" } },
     *     { "type": "publishers", "id": "temp-pub-xyz", "attributes": { "name": "Awesome Books Inc." } }
     *   ]
     * });
     * @see POST /api/articles
     * // Example Return Value for compoundArticle:
     * // {
     * //   "data": {
     * //     "type": "articles",
     * //     "id": "125",
     * //     "attributes": { ... },
     * //     "relationships": { ... }
     * //   },
     * //   "included": [
     * //     { "type": "people", "id": "11", ... },
     * //     { "type": "people", "id": "12", ... },
     * //     { "type": "publishers", "id": "55", ... }
     * //   ]
     * // }
     *
     * @example
     * // Case 4: Create a resource linking to both NEW and EXISTING resources (mixed).
     * const mixedArticle = await api.post('articles', {
     *   "data": {
     *     "type": "articles",
     *     "attributes": {
     *       "title": "A New Member Joins the Team"
     *     },
     *     "relationships": {
     *       "authors": {
     *         "data": [
     *           { "type": "people", "id": "9" },             // Existing author
     *           { "type": "people", "id": "temp-author-3" }  // New author
     *         ]
     *       }
     *     }
     *   },
     *   "included": [
     *     { "type": "people", "id": "temp-author-3", "attributes": { "name": "Sam Smith" } }
     *   ]
     * });
     * @see POST /api/articles
     */

    addScopeMethod('post', async ({ params, context, vars, helpers, scope, scopes, runHooks, apiOptions, pluginOptions, scopeOptions, scopeName }) => {

      // Make the method available to all hooks
      context.method = 'post'
      context.scopeName = scopeName
      context.params = params
      
      // Run early hooks for pre-processing (e.g., file handling)
      runHooks('beforeProcessing')
      runHooks('beforeProcessingPost')

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

      // Apply schema to the main attributes and to ALL of the included ones
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
      
      // Validate included resources
      context.schemas = {}
      const includedResources = context.inputRecord.included || [];
      for (let i = 0; i < includedResources.length; i++) {
        const subInputRecord = includedResources[i];
        const scopeConfig = scopes[subInputRecord.type];
        // The validator already checked that the type exists, so scopeConfig should be valid
        const schemaFromOptions = scopeConfig?.options?.insertSchema || scopeConfig?.options?.schema || {};
        const schema = context.schemas[subInputRecord.type] = context.schemas[subInputRecord.type] || CreateSchema(schemaFromOptions);
        
        const { validatedObject: subValidatedAttrs, errors: subErrors } = await schema.validate(subInputRecord.attributes || {});
        if (Object.keys(subErrors).length > 0) {
          const violations = Object.entries(subErrors).map(([field, error]) => ({
            field: `included[${i}].attributes.${field}`,
            rule: error.code || 'invalid_value',
            message: error.message
          }));
          
          throw new RestApiValidationError(
            `Schema validation failed for included resource of type '${subInputRecord.type}'`,
            { 
              fields: Object.keys(subErrors).map(field => `included[${i}].attributes.${field}`),
              violations 
            }
          );
        }
        subInputRecord.attributes = subValidatedAttrs;
      }
      runHooks('afterSchemaValidatePost')
      runHooks('afterSchemaValidate')

      runHooks('checkPermissions')
      runHooks('checkPermissionsPost')
      
      runHooks('beforeDataCall')
      runHooks('beforeDataCallPost')
      
      // Create the record - storage helper should return the created record with its ID
      context.record = await helpers.dataPost({
        scopeName,
        inputRecord: context.inputRecord,
        idProperty: vars.idProperty
      });
      
      runHooks('afterDataCallPost')
      runHooks('afterDataCall')
      
      // Get the full record with relationships if requested
      if (vars.returnFullRecord?.post !== false) {
        context.returnRecord = await helpers.dataGet({
          scopeName,
          id: context.record.data.id,
          queryParams: params.queryParams,
          idProperty: vars.idProperty
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
    })

   /**
   * PUT
   * Updates an existing top-level resource by completely replacing it.
   * This method does NOT support creating new related resources via an `included` array.
   *
   * @param {string} id - The ID of the resource to update.
   * @param {object} inputRecord - The JSON:API document for the request. It must contain a `data` object for the primary resource. 
  It CANNOT include an `included` array - all relationships must reference existing resources.
   * @param {object} [queryParams={}] - Optional. An object to customize the query for the returned document.
   * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload in the response. These paths 
  will be converted to a comma-separated string (e.g., `['author', 'comments.user']`).
   * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, 
  values are comma-separated field names.
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
    context.scopeName = scopeName
    context.params = params
    
    // Run early hooks for pre-processing (e.g., file handling)
    runHooks('beforeProcessing')
    runHooks('beforeProcessingPut')

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
        idProperty: vars.idProperty
      });

      context.exists = !!context.recordBefore
    } else {
      // CHECK EXISTENCE FIRST - hooks need to know!
      context.exists = await helpers.dataExists({
        scopeName,
        id: context.id,
        idProperty: vars.idProperty
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
      isCreate: context.isCreate,  // Helper knows what to do
      idProperty: vars.idProperty
    });
    runHooks('afterDataCallPut')
    runHooks('afterDataCall')

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
        idProperty: vars.idProperty
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
  })

    /**
     * PATCH
     * Performs a partial update on an existing resource's attributes or relationships.
     * Unlike PUT, PATCH only updates the fields provided, leaving other fields unchanged.
     * Just like PUT, It CANNOT have the `included` in data
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
      context.scopeName = scopeName
      context.params = params
      
      // Run early hooks for pre-processing (e.g., file handling)
      runHooks('beforeProcessing')
      runHooks('beforeProcessingPatch')

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

      // Permissions check
      runHooks('checkPermissions')
      runHooks('checkPermissionsPatch')
      
      runHooks('beforeDataCall')
      runHooks('beforeDataCallPatch')

      // Call the storage helper - should return the patched record
      context.record = await helpers.dataPatch({
        scopeName,
        id: context.id,
        inputRecord: context.inputRecord,
        idProperty: vars.idProperty
      });

      runHooks('afterDataCallPatch')
      runHooks('afterDataCall')

      runHooks('checkDataPermissions')
      runHooks('checkDataPermissionsPatch')

      // Get return record if needed
      if (vars.returnFullRecord?.patch !== false) {
        context.returnRecord = await helpers.dataGet({
          scopeName,
          id: context.id,
          queryParams: params.queryParams,
          idProperty: vars.idProperty
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
        idProperty: vars.idProperty
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
    helpers.dataExists = async function({ scopeName, id, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for exists. Install a storage plugin.`);
    };

    helpers.dataGet = async function({ scopeName, id, queryParams, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for get. Install a storage plugin.`);
    };
    
    helpers.dataQuery = async function({ scopeName, queryParams, idProperty, searchSchema }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for query. Install a storage plugin.`);
    };
    
    helpers.dataPost = async function({ scopeName, inputRecord, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for post. Install a storage plugin.`);
    };

    helpers.dataPatch = async function({ scopeName, id, inputRecord, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for patch. Install a storage plugin.`);
    };

    helpers.dataPut = async function({ scopeName, id, schema, inputRecord, isCreate, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schemaDefinition = scope.schema;
      const relationships = scope.relationships;
      const tableName = schemaDefinition.tableName || scopeName;
      
      throw new Error(`No storage implementation for put. Install a storage plugin.`);
    };
    
    helpers.dataDelete = async function({ scopeName, id, idProperty }) {
      // Access scope configuration (example for storage plugin developers)
      const scope = this.scopes[scopeName];
      const schema = scope.schema;
      const relationships = scope.relationships;
      const tableName = schema.tableName || scopeName;
      
      throw new Error(`No storage implementation for delete. Install a storage plugin.`);
    };



  }
};