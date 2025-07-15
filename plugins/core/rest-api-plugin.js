import { 
 validateGetPayload, 
  validateQueryPayload, 
  validatePostPayload, 
  validatePutPayload, 
  validatePatchPayload 
} from './lib/payload-validators.js';
import { 
  RestApiValidationError, 
  RestApiResourceError, 
  RestApiPayloadError 
} from '../../lib/rest-api-errors.js';
import { validatePolymorphicRelationships } from './lib/scope-validations.js';
import { transformSimplifiedToJsonApi, transformJsonApiToSimplified, transformSingleJsonApiToSimplified } from './lib/simplified-helpers.js';
import { processRelationships } from './lib/relationship-processor.js';
import { updateManyToManyRelationship, createPivotRecords } from './lib/many-to-many-manipulations.js';
import { createDefaultDataHelpers } from './lib/default-data-helpers.js';
import { compileSchemas } from './lib/compile-schemas.js';
import { createEnhancedLogger } from '../../lib/enhanced-logger.js';
import { getRequestedComputedFields, filterHiddenFields } from './lib/knex-field-helpers.js';
import { DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_INCLUDE_DEPTH_LIMIT } from './utils/knex-constants.js';
import { normalizeRecordAttributes } from './lib/database-value-normalizers.js';


const cascadeConfig = (settingName, sources, defaultValue) =>
  sources.find(source => source?.[settingName] !== undefined)?.[settingName] ?? defaultValue

/**
 * Determines which simplified setting to use based on request context
 * @param {Object} params - Request parameters
 * @param {Object} scopeOptions - Scope-specific options
 * @param {Object} vars - Plugin variables
 * @returns {boolean} Whether to use simplified mode
 */
const getSimplifiedSetting = (params, scopeOptions, vars) => {
  // Check if this request comes from a transport (HTTP/Express)
  const isTransport = params.isTransport === true;
  
  // Determine which default to use
  const defaultSetting = isTransport ? vars.simplifiedTransport : vars.simplifiedApi;
  
  // Allow override at request/scope level
  return cascadeConfig('simplified', [params, scopeOptions], defaultSetting);
}

export const RestApiPlugin = {
  name: 'rest-api',

  install({ helpers, addScopeMethod, vars, addHook, apiOptions, pluginOptions, api, setScopeAlias, scopes, log, on }) {

    // Enhance the logger to show full error details
    const enhancedLog = createEnhancedLogger(log, { 
      logFullErrors: true, 
      includeStack: true 
    });

    // Initialize the rest namespace for REST API functionality
    api.rest = {};

    // Set up REST-friendly aliases
    setScopeAlias('resources', 'addResource');

    // Listen for scope creation to validate polymorphic relationships at startup.
    // This validates that polymorphic relationships are properly configured with valid types,
    // typeField/idField definitions, and that all referenced scope types actually exist.
    // Example: For comments that can belong to posts or videos, it ensures commentable_type field
    // exists, commentable_id field exists, and that 'posts' and 'videos' are registered scopes.
    // Catches config errors early before any requests are made.
    on('scope:added', 'validatePolymorphicRelationships', validatePolymorphicRelationships);
    
    // Listen for scope creation to compile schemas immediately.
    // This ensures schemas are compiled and cached before any scope methods are called,
    // making them available for queries and other operations that need schema information.
    on('scope:added', 'compileResourceSchemas', async ({eventData}) => compileSchemas(eventData.scope, { context: { scopeName: eventData.scopeName } }));
    
    // Validate include configurations in relationships after schemas are compiled
    on('scope:added', 'validateIncludeConfigurations', async ({eventData}) => {
      const { scope, scopeName } = eventData;
      const relationships = scope.vars.schemaInfo?.schemaRelationships;
      
      if (!relationships) return;
      
      // Check each relationship for include configuration
      for (const [relName, relDef] of Object.entries(relationships)) {
        if (relDef.include?.strategy === 'window') {
          // This relationship requires window functions
          // We'll validate this at query time since the database might not be connected yet
          log.debug(`Relationship ${scopeName}.${relName} configured for window function includes`);
        }
        
        // Validate include configuration
        if (relDef.include?.limit) {
          if (typeof relDef.include.limit !== 'number') {
            throw new Error(
              `Invalid include limit for ${scopeName}.${relName}: limit must be a number`
            );
          }
          // Check against queryMaxLimit if available
          const maxLimit = scope.vars?.queryMaxLimit;
          if (maxLimit && relDef.include.limit > maxLimit) {
            throw new Error(
              `Invalid include limit for ${scopeName}.${relName}: ` +
              `limit (${relDef.include.limit}) exceeds queryMaxLimit (${maxLimit})`
            );
          }
        }
        
        if (relDef.include?.orderBy && !Array.isArray(relDef.include.orderBy)) {
          throw new Error(
            `Invalid include orderBy for ${scopeName}.${relName}: orderBy must be an array`
          );
        }
      }
    });


    // Set scope variables based on the the passed options
    // sortableFiels and defaultSort are always coming from options
    // and queryDefaultLimit and queryMaxLimit will be set if passed -- if not, the `vars`
    // proxy will point to the api's values (set as defaults)
    on('scope:added', 'turnScopeInitIntoVars', async ({eventData}) => {
      // Refer to the scope's vars
      const scopeOptions = eventData.scope?.scopeOptions || eventData.api?.scopeOptions || {};
      const vars = eventData.scope?.vars || eventData.api?.vars

      // The scope-specific ones
      vars.sortableFields = scopeOptions.sortableFields || [];
      vars.defaultSort = scopeOptions.defaultSort || null;     

      // The general ones that are also set at api level, but overrideable
      if (typeof scopeOptions.queryDefaultLimit !== 'undefined') vars.queryDefaultLimit = scopeOptions.queryDefaultLimit
      if (typeof scopeOptions.queryMaxLimit !== 'undefined') vars.queryMaxLimit = scopeOptions.queryMaxLimit
      if (typeof scopeOptions.includeDepthLimit !== 'undefined') vars.includeDepthLimit = scopeOptions.includeDepthLimit
      if (typeof scopeOptions.resourceUrlPrefix !== 'undefined') vars.resourceUrlPrefix = scopeOptions.resourceUrlPrefix
      if (typeof scopeOptions.enablePaginationCounts !== 'undefined') vars.enablePaginationCounts = scopeOptions.enablePaginationCounts
      

      // Add validation for query limits
      if (vars.queryDefaultLimit && vars.queryMaxLimit) {
        if (vars.queryDefaultLimit > vars.queryMaxLimit) {
          throw new Error(
            `Invalid scope '${eventData.scopeName}' configuration: ` +
            `queryDefaultLimit (${vars.queryDefaultLimit}) cannot exceed queryMaxLimit (${vars.queryMaxLimit})`
          );
        }
      }
      
      // Validate relationship include limits at scope creation time
      Object.entries(scopeOptions.relationships || {}).forEach(([relName, relDef]) => {
        if (relDef.include?.limit && vars.queryMaxLimit) {
          if (relDef.include.limit > vars.queryMaxLimit) {
            throw new Error(
              `Invalid relationship '${eventData.scopeName}.${relName}' configuration: ` +
              `include.limit (${relDef.include.limit}) cannot exceed queryMaxLimit (${vars.queryMaxLimit})`
            );
          }
        }
      });
    })
    // compileSchemas(eventData.scope, eventData.scopeName));

    // Initialize default vars for the plugin from pluginOptions
    // hooked-api wraps plugin options with the plugin name
    const restApiOptions = pluginOptions['rest-api'] || {};

    // These will be used as default fallbacks by the vars proxy if
    // they are not set in the scope options
    vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
    vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
    vars.includeDepthLimit = restApiOptions.includeDepthLimit || DEFAULT_INCLUDE_DEPTH_LIMIT
    vars.resourceUrlPrefix = restApiOptions.resourceUrlPrefix || ''
    vars.enablePaginationCounts = restApiOptions.enablePaginationCounts || true


    // New simplified settings
    vars.simplifiedTransport = restApiOptions.simplifiedTransport !== undefined 
      ? restApiOptions.simplifiedTransport 
      : false; // Default false for JSON:API compliance over the wire
    
    vars.simplifiedApi = restApiOptions.simplifiedApi !== undefined 
      ? restApiOptions.simplifiedApi 
      : true; // Default true for better DX in programmatic API
    
    vars.idProperty = restApiOptions.idProperty || 'id'

    // Return full record configuration
    vars.returnFullRecord = {
      post: restApiOptions.returnFullRecord?.post ?? true,
      put: restApiOptions.returnFullRecord?.put ?? true,
      patch: restApiOptions.returnFullRecord?.patch ?? true,
      allowRemoteOverride: restApiOptions.returnFullRecord?.allowRemoteOverride ?? false
    };

    // Schema cache vars
    vars.schemaProcessed = false;
    vars.schema = null;

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
      context.method = 'query'
            
      // Get configuration values using new helper
      context.simplified = getSimplifiedSetting(params, scopeOptions, vars);

      // Assign common context properties
      context.schemaInfo = scopes[scopeName].vars.schemaInfo; // This is the object variable created by compileSchemas
      context.returnFullRecord = cascadeConfig('returnFullRecord', [params, scopeOptions, vars], false);
      context.queryParams = params.queryParams || {};

      // These only make sense as parameter per query
      context.queryParams.fields = cascadeConfig('fields', [params.queryParams], {});
      context.queryParams.include = cascadeConfig('include', [params.queryParams], []);
      context.queryParams.sort = cascadeConfig('sort', [params.queryParams], [])
      context.queryParams.page = cascadeConfig('page', [params.queryParams], {})
  
      context.transaction = params.transaction; 
      
      context.scopeName = scopeName;

      // These are just shortcuts used in this function and will be returned
      const schema = context.schemaInfo.schema;
      const searchSchema = context.schemaInfo.searchSchema;
      const schemaStructure = context.schemaInfo.schema.structure;
      const schemaRelationships = context.schemaInfo.schemaRelationships;

      // Sortable fields and sort (mab)
      context.sortableFields = vars.sortableFields
      // Apply default sort if no sort specified
      if (context.queryParams.sort.length === 0 && vars.defaultSort) {
        context.queryParams.sort = Array.isArray(vars.defaultSort) ? vars.defaultSort : [vars.defaultSort];
      }

      // Validate query parameters to ensure they follow JSON:API specification and security rules.
      // This checks that filters are valid field names, sort fields exist in sortableFields array
      // (preventing SQL injection), pagination uses valid page[size]/page[number] format, and include
      // paths reference real relationships. Example: sort: ['-createdAt', 'title'] is checked against
      // sortableFields to ensure users can't sort by sensitive fields like 'password_hash'.
      validateQueryPayload({ queryParams: context.queryParams }, context.sortableFields, vars.includeDepthLimit);

      // Validate search/filter parameters against searchSchema
      if (context.queryParams.filters && Object.keys(context.queryParams.filters).length > 0) {
        // Only allow filtering if searchSchema is defined
        if (!searchSchema) {
          throw new RestApiValidationError(
            `Filtering is not enabled for resource '${scopeName}'. To enable filtering, add 'search: true' to schema fields or define a searchSchema.`,
            { 
              fields: Object.keys(context.queryParams.filters).map(field => `filters.${field}`),
              violations: [{
                field: 'filters',
                rule: 'filtering_not_enabled',
                message: 'Resource does not have searchable fields defined'
              }]
            }
          );
        }
      
        // Validate the filter parameters searchSchema
        const { validatedObject, errors } = await searchSchema.validate(context.queryParams.filters, { 
          onlyObjectValues: true // Partial validation for filters
        });
        
        // If there are validation errors, throw an error
        if (Object.keys(errors).length > 0) {
          const violations = Object.entries(errors).map(([field, error]) => ({
            field: `filters.${field}`,
            rule: error.code || 'invalid_value',
            message: error.message
          }));
          
          throw new RestApiValidationError(
            'Invalid filter parameters',
            { 
              fields: Object.keys(errors).map(field => `filters.${field}`),
              violations 
            }
          );
        }
        
        // Replace filter with validated/transformed values
        context.queryParams.filters = validatedObject;
      }
    
      await runHooks ('checkPermissions')
      await runHooks ('checkPermissionsQuery')
      
      await runHooks ('beforeData')
      await runHooks ('beforeDataQuery')
      context.record = await helpers.dataQuery({
        scopeName,
        context,
        transaction: context.transaction,
        runHooks
      })
    
      // Normalize database values (e.g., convert 1/0 to true/false for booleans)
      context.record = normalizeRecordAttributes(context.record, scopes);
    
      // Make a backup
      try {
        context.originalRecord = structuredClone(context.record)
      } catch (e) {
        log.error('Failed to clone record:', {
          error: e.message,
          recordKeys: Object.keys(context.record || {}),
          hasHttpRequest: !!context.raw?.req
        });
        throw e;
      }

      // This will enhance record, which is the WHOLE JSON:API record
      await runHooks ('enrichRecord')

      // Get computed field information for main resource
      const computedFields = scope.vars.schemaInfo?.computed || {};
      const requestedFields = context.queryParams.fields?.[scopeName];
      const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields);

      // Run enrichAttributes for every single set of attribute, calling it from the right scope
      for (const entry of context.record.data) {
        entry.attributes = await scope.enrichAttributes({ 
          attributes: entry.attributes, 
          parentContext: context,
          requestedComputedFields: requestedComputedFields,
          isMainResource: true,
          computedDependencies: context.computedDependencies
        })
      }
      for (const entry of (context.record.included || [])) {
        const entryScope = scopes[entry.type];
        const entryComputed = entryScope.vars.schemaInfo?.computed || {};
        const entryRequestedFields = context.queryParams.fields?.[entry.type];
        const entryRequestedComputed = getRequestedComputedFields(
          entry.type, 
          entryRequestedFields, 
          entryComputed
        );
        
        entry.attributes = await entryScope.enrichAttributes({ 
          attributes: entry.attributes, 
          parentContext: context,
          requestedComputedFields: entryRequestedComputed,
          isMainResource: false
        })
      }

      // The called hooks should NOT change context.record
      await runHooks ('finish')
      await runHooks ('finishQuery')
      
      // Transform output if in simplified mode
      if (context.simplified) {
        // Convert JSON:API response back to simplified format
        // Example: {data: {type: 'posts', id: '1', attributes: {title: 'My Post'}, relationships: {author: {data: {type: 'users', id: '123'}}}}} 
        // becomes: {id: '1', title: 'My Post', author_id: '123'} - flattens structure and restores foreign keys
        return transformJsonApiToSimplified(
          { record: context.record },
          { context: { schemaStructure, schemaRelationships } }
        );
      }
      
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
      context.method = 'get'

      // Get configuration values using new helper
      context.simplified = getSimplifiedSetting(params, scopeOptions, vars);

      // Assign common context properties
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;
      context.returnFullRecord = cascadeConfig('returnFullRecord', [context.params, scopeOptions, vars], false);
      context.queryParams = params.queryParams || {};
    
      // These only make sense as parameter per query
      context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {});
      context.queryParams.include = cascadeConfig('include', [context.queryParams], []);
      
      context.transaction = params.transaction; 

      context.scopeName = scopeName;

      // These are just shortcuts used in this function and will be returned
      // const schema = context.schemaInfo.schema; // Not needed
      const schemaStructure = context.schemaInfo.schema.structure;
      const schemaRelationships = context.schemaInfo.schemaRelationships;

      context.id = params.id;
  
      // Validate GET request to ensure required parameters are present and properly formatted.
      // This checks that 'id' parameter exists and is not empty (you can't GET without an ID),
      // validates 'include' contains valid relationship names (not arbitrary fields), and ensures
      // 'fields' for sparse fieldsets follow the format fields[type]=comma,separated,list.
      // Example: validates id: '123' exists, include: ['author', 'tags'] are real relationships.
      validateGetPayload({ id: context.id, queryParams: context.queryParams }, vars.includeDepthLimit);

      await runHooks('checkPermissions')
      await runHooks('checkPermissionsGet')
      
      await runHooks('beforeData')
      await runHooks('beforeDataGet')

      context.record = await helpers.dataGet({
        scopeName,
        context,
        transaction: context.transaction,
      })
    
      // Check if record was found - storage layer returns null/undefined for non-existent records.
      // This generates a proper 404 error with JSON:API error format instead of returning empty data.
      if (!context.record || !context.record.data) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: 'not_found',
            resourceType: scopeName,
            resourceId: context.id
          }
        );
      }
    
      // Normalize database values (e.g., convert 1/0 to true/false for booleans)
      context.record = normalizeRecordAttributes(context.record, scopes);
    
      await runHooks ('checkDataPermissions')
      await runHooks ('checkDataPermissionsGet')
      
      // Make a backup
      context.originalRecord = structuredClone(context.record)

      // This will enhance record, which is the WHOLE JSON:API record
      await runHooks ('enrichRecord')
      
      // Get computed field information for main resource
      const computedFields = scope.vars.schemaInfo?.computed || {};
      const requestedFields = context.queryParams.fields?.[scopeName];
      const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields);
      
      // Enrich attributes for the main resource
      // Pass computedDependencies from context (set by dataGet in Knex plugin)
      // This tells enrichAttributes which fields to remove after computation
      context.record.data.attributes = await scope.enrichAttributes({ 
        attributes: context.record.data.attributes, 
        parentContext: context,
        requestedComputedFields: requestedComputedFields,
        isMainResource: true,
        computedDependencies: context.computedDependencies  // Fields to remove if not requested
      })
      for (const entry of (context.record.included || [])) {
        const entryScope = scopes[entry.type];
        const entryComputed = entryScope.vars.schemaInfo?.computed || {};
        const entryRequestedFields = context.queryParams.fields?.[entry.type];
        const entryRequestedComputed = getRequestedComputedFields(
          entry.type, 
          entryRequestedFields, 
          entryComputed
        );
        
        entry.attributes = await entryScope.enrichAttributes({ 
          attributes: entry.attributes, 
          parentContext: context,
          requestedComputedFields: entryRequestedComputed,
          isMainResource: false
        })
      }
      
      await runHooks ('enrichRecordWithRelationships')

      // The called hooks should NOT change context.record
      await runHooks ('finish')
      await runHooks ('finishGet')
      
      // Get schema info for transformation
      context.schemaInfo = scopes[scopeName].vars.schemaInfo
      
      // Transform output if in simplified mode
      if (context.simplified) {
        // Convert JSON:API response back to simplified format
        // Example: {data: {type: 'posts', id: '1', attributes: {title: 'My Post'}, relationships: {author: {data: {type: 'users', id: '123'}}}}} 
        // becomes: {id: '1', title: 'My Post', author_id: '123'} - flattens structure and restores foreign keys
        return transformJsonApiToSimplified(
          { record: context.record },
          { context: { schemaStructure, schemaRelationships } }
        );
      }
      
      return context.record
    })


    /**
     * Performs common initial setup for POST, PUT, and PATCH methods.
     * This includes setting up context, handling simplified mode,
     * and extracting schema-related information.
     *
     * @param {object} args - The arguments object passed to the addScopeMethod function.
     * @param {object} args.params - Request parameters.
     * @param {object} args.context - The operation context object.
     * @param {object} args.vars - Variables accessible to the scope.
     * @param {object} args.scopes - All available scopes/resource definitions.
     * @param {object} args.scopeOptions - Options specific to the current scope.
     * @param {string} args.scopeName - The name of the current scope.
     * @returns {object} An object containing schema-related shortcuts.
     */
    async function setupCommonRequest({ params, context, vars, scopes, scopeOptions, scopeName }) {
        // Get configuration values using new helper
        context.simplified = getSimplifiedSetting(params, scopeOptions, vars);

        // Params is totally bypassed in simplified mode
        if (context.simplified) {
            if (params.inputRecord) {
                context.inputRecord = params.inputRecord;
            } else {
                context.inputRecord = params;
                context.params = {}; // Ensure params is an empty object if simplified
            }
        } else {
            context.inputRecord = params.inputRecord;
        }

        // Assign common context properties
        context.schemaInfo = scopes[scopeName].vars.schemaInfo;
        context.returnFullRecord = cascadeConfig('returnFullRecord',  [context.params, scopeOptions, vars], false);

        // These only make sense as parameter per query, not in vars etc.
        context.queryParams = params.queryParams || {};
        context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {});
        context.queryParams.include = cascadeConfig('include', [context.queryParams], []);

        context.scopeName = scopeName;

        // Transaction handling
        context.transaction = params.transaction || 
            (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
        context.shouldCommit = !params.transaction && !!context.transaction;

        // These are just shortcuts used in this function and will be returned
        const schema = context.schemaInfo.schema;
        const schemaStructure = context.schemaInfo.schema.structure;
        const schemaRelationships = context.schemaInfo.schemaRelationships;

        // Transform input if in simplified mode
        if (context.simplified) {
            context.inputRecord = transformSimplifiedToJsonApi(
                { inputRecord: context.inputRecord },
                { context: { scopeName, schemaStructure, schemaRelationships } }
            );
        } else {
            // Strict mode: validate no belongsTo fields in attributes
            if (context.inputRecord?.data?.attributes) {
                for (const [key, fieldDef] of Object.entries(schemaStructure)) {
                    if (fieldDef.belongsTo && key in context.inputRecord.data.attributes) {
                        throw new RestApiValidationError(
                            `Field '${key}' is a foreign key and must be set via relationships, not attributes`,
                            { fields: [`data.attributes.${key}`] }
                        );
                    }
                }
            }
        }

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

         // Remove included validation since JSON:API doesn't support it
        if (context.inputRecord.included) {
          throw new RestApiPayloadError(
            context.method + ' requests cannot include an "included" array. JSON:API does not support creating multiple resources in a single request.',
            { path: 'included', expected: 'undefined', received: 'array' }
          );
        }

        // If both URL path ID and request body ID are provided, they must match
        if (context.id && context.inputRecord.data.id && context.id !== context.inputRecord.data.id) {
          throw new RestApiValidationError(
            `ID mismatch. URL path ID '${context.id}' does not match request body ID '${context.inputRecord.data.id}'`,
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



        // Return key schema-related objects for direct use in the main methods
        return { schema, schemaStructure, schemaRelationships };
    }

/**
 * Common helper functions for REST API methods to reduce code duplication
 */

/**
 * Handles error cleanup and logging for write methods (POST, PUT, PATCH)
 * 
 * @param {Error} error - The error that was caught
 * @param {Object} context - The request context
 * @param {string} method - The HTTP method name (POST, PUT, PATCH)
 * @param {string} scopeName - The name of the resource scope
 * @param {Object} enhancedLog - The enhanced logger instance
 * @throws {Error} Re-throws the original error after cleanup
 */
  const  handleWriteMethodError = async (error, context, method, scopeName, enhancedLog) => {
  // Rollback transaction if we created it
  if (context.shouldCommit) {
    await context.transaction.rollback();
  }
  
  // Log the full error details
  enhancedLog.logError(`Error in ${method} method`, error, {
    scopeName,
    method: method.toLowerCase(),
    inputRecord: context.inputRecord
  });
  
  throw error;
}

/**
 * Validates that a pivot resource exists for many-to-many relationships
 * 
 * @param {Object} scopes - All available scopes/resources
 * @param {Object} relDef - The relationship definition
 * @param {string} relName - The relationship name
 * @throws {RestApiValidationError} If the pivot resource doesn't exist
 */
const validatePivotResource = (scopes, relDef, relName) => {
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
}



    const getMethodHookSuffix = (method) => {
      if (!method) {
        return ''; // Or throw an error, depending on desired strictness
      }
      return method.charAt(0).toUpperCase() + method.slice(1);
    };

    /**
     * Handles common schema validation logic for POST, PUT, and PATCH methods.
     *
     * @param {object} params - The params object from addScopeMethod.
     * @param {object} context - The context object from addScopeMethod.
     * @param {object} schema - The validation schema.
     * @param {object} belongsToUpdates - Object containing belongsTo foreign key updates.
     * @param {boolean} [isPartialValidation=false] - Whether to perform partial validation (for PATCH).
     * @returns {Promise<void>}
     * @throws {RestApiValidationError} If schema validation fails.
     */

    const validateResourceAttributesBeforeWrite = async ({ 
        context, 
        schema, 
        belongsToUpdates, 
        runHooks, 
        isPartialValidation = false 
    }) => {
      // Dynamically get the method suffix
      const methodSpecificHookSuffix = getMethodHookSuffix(context.method);

      await runHooks ('beforeSchemaValidate');
      await runHooks (`beforeSchemaValidate${methodSpecificHookSuffix}`);

      // Store original input attributes before validation adds defaults (primarily for POST)
      // Only if it's not already set and the current method is POST
      if (!context.originalInputAttributes && context.method === 'post') {
          context.originalInputAttributes = { ...(context.inputRecord.data.attributes || {}) };
      }
      
      // Merge belongsTo updates with attributes BEFORE validation
      const attributesToValidate = {
          ...(context.inputRecord.data.attributes || {}),
          ...belongsToUpdates
      };

      const validationOptions = isPartialValidation ? { onlyObjectValues: true } : {};

      const { validatedObject, errors } = await schema.validate(attributesToValidate, validationOptions);

      if (Object.keys(errors).length > 0) {
        // --- START OF MODIFICATION ---
        const schemaStructure = context.schemaInfo.schema.structure; // Get the schema structure for lookup

        const violations = Object.entries(errors).map(([field, error]) => {
        let fieldPath = `data.attributes.${field}`; // Default path for attributes

        // Check if this field is a foreign key that has an 'as' alias
        const fieldDef = schemaStructure[field];
        if (fieldDef && (fieldDef.belongsTo || fieldDef.belongsToPolymorphic) && fieldDef.as) {
          // If it's a belongsTo field with an alias, rewrite the path to the relationship alias
          fieldPath = `data.relationships.${fieldDef.as}.data.id`;
        }
        // For many-to-many relationships, the original `transformSimplifiedToJsonApi`
        // already puts them under `relationships.relName.data`, so `field` here
        // would already be the relationship name, not a foreign key.
        // However, if a validation error somehow slips through for a pivot table field
        // that doesn't have an 'as' alias but is a foreign key, you might need
        // more sophisticated mapping. For now, this covers belongsTo.

        return {
          field: fieldPath,
          rule: error.code || 'invalid_value',
          message: error.message
        };
          });
          // --- END OF MODIFICATION ---

          throw new RestApiValidationError(
              'Schema validation failed for resource attributes',
              { 
                  fields: violations.map(v => v.field), // Use the potentially rewritten fields
                  violations
              }
          );
      }
      context.inputRecord.data.attributes = validatedObject;

      await runHooks (`afterSchemaValidate${methodSpecificHookSuffix}`);
      await runHooks ('afterSchemaValidate');
    };


    // Function: handleRecordReturn
    // Location: You should place this in a common utility file that can be imported
    //           by your API scope methods (post, put, patch).
    //           A good place might be in './lib/commonResponseHelpers.js' or similar,
    //           and then import it into the main plugin file where your addScopeMethods are defined.

    async function handleRecordReturnAfterWrite({
        context,
        scopeName,
        api,
        scopes, // Required because api.resources[scopeName].get() uses 'scopes' internally.
        schemaStructure,
        schemaRelationships,
        scopeOptions, // Used for cascadeConfig
        vars,         // Used for cascadeConfig
        runHooks       // Used to run finish hooks
    }) {
        const methodSpecificHookSuffix = getMethodHookSuffix(context.method);

        // Determine if we should return the full record based on configurations.
        const shouldReturnRecord = context.returnFullRecord[context.method]
        
        if (shouldReturnRecord) {
            // If a full record is requested, use the API's own 'get' method.
            // The 'get' method itself is responsible for fetching the data,
            // applying its own enrichment hooks, and formatting to JSON:API.
            // Therefore, NO further enrichment is needed here.
            context.returnRecord = await api.resources[scopeName].get({
                id: context.id, // context.id is now reliably set by POST, PUT, and PATCH
                queryParams: context.queryParams,
                transaction: context.transaction,
                simplified: false // Request the full JSON:API format from GET for internal processing
            });
            
            // If the 'get' method returns null/undefined (e.g., resource was deleted between write and read),
            // we might still need to handle a potential 404 or just return undefined.
            // For this specific flow (POST/PUT/PATCH response), the record *should* exist.
            // If it doesn't, it implies a deeper issue or a race condition.
            if (!context.returnRecord) {
                // Decide how to handle this edge case. Returning undefined is consistent with
                // the 'else' branch if nothing is supposed to be returned.
                // Or you could throw an error if a record *must* be returned.
                context.returnRecord = undefined;
            }

        } else {
            // If 'shouldReturnRecord' is false, return minimal response with just the ID
            // Always return in simplified format for consistency - transport can use result.id
            context.returnRecord = { id: context.id };
            // Early return to skip transformation logic below
            await runHooks('finish');
            await runHooks(`finish${methodSpecificHookSuffix}`);
            return context.returnRecord;
        }

        // Run common finish hooks.
        await runHooks('finish');
        // Dynamically call method-specific finish hooks (e.g., 'finishPost', 'finishPut', 'finishPatch').
        await runHooks(`finish${methodSpecificHookSuffix}`);

        // Transform output if in simplified mode and there is a record to transform.
        if (context.simplified && context.returnRecord) {
            // Ensure we are transforming the 'returnRecord' which comes from the 'get' call,
            // as it contains the fully enriched and structured JSON:API data.
            return transformJsonApiToSimplified(
                { record: context.returnRecord },
                { context: { schemaStructure, schemaRelationships } }
            );
        }
        
        // Return the final record (will be undefined if shouldReturnRecord was false).
        return context.returnRecord;
    }


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
      context.method = 'post'
      
      try {
        const { schema, schemaStructure, schemaRelationships } = await setupCommonRequest({
            params, context, vars, scopes, scopeOptions, scopeName, helpers
        });

        // Run early hooks for pre-processing (e.g., file handling)
        await runHooks('beforeProcessing')
        await runHooks('beforeProcessingPost')

        // Validate POST payload to ensure it follows JSON:API format and references valid resources.
        // This checks the payload has required 'data' object with 'type' and 'attributes', validates
        // that data.type matches a real resource type (preventing creation of non-existent resources),
        // and ensures any relationships reference valid resource types with proper ID format.
        // Example: data.type: 'articles' must be a registered scope, relationships.author must reference 'users'.
        validatePostPayload(context.inputRecord, scopes)
        
        // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
        // Example: relationships.author -> author_id: '123' for storage
        // Example: relationships.tags -> array of pivot records to create later
        const { belongsToUpdates, manyToManyRelationships } = await processRelationships(
          scope,
          { context }
        );

        await validateResourceAttributesBeforeWrite({ 
            context, 
            schema, 
            belongsToUpdates, 
            runHooks , 
        });

        
        await runHooks ('checkPermissions')
        await runHooks ('checkPermissionsPost')
        
        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallPost')
        
        // Create the main record - storage helper should return the created record with its ID
        context.id = await helpers.dataPost({
          scopeName,
          context,
          transaction: context.transaction,
        });
        
        await runHooks ('afterDataCallPost')
        await runHooks ('afterDataCall')
        
        // Process many-to-many relationships after main record creation
        for (const { relName, relDef, relData } of manyToManyRelationships) {
          // Validate pivot resource exists
          validatePivotResource(scopes, relDef, relName);
          
          // Create pivot records in the through table to establish many-to-many relationships.
          // This creates records in the intermediary table (like 'article_tags') that link the main
          // resource to each related resource. Before creating each pivot record, it validates that
          // the related resource actually exists (preventing orphaned relationships). If validateExists
          // is false, it skips validation for performance in bulk operations.
          // Example: article.tags: [{id: '1'}, {id: '2'}] creates two article_tags records:
          // {article_id: 100, tag_id: 1} and {article_id: 100, tag_id: 2}
          await createPivotRecords(api, context.id, relDef, relData, context.transaction);
        }
        
        const ret = await handleRecordReturnAfterWrite({
          context,
          scopeName,
          api,
          scopes,
          schemaStructure,
          schemaRelationships,
          scopeOptions,
          vars,
          runHooks
      });


        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
        }

        return ret
        
      } catch (error) {
        await handleWriteMethodError(error, context, 'POST', scopeName, enhancedLog);
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
    
    try {
      const { schema, schemaStructure, schemaRelationships } = await setupCommonRequest({
          params, context, vars, scopes, scopeOptions, scopeName, helpers
      });
      context.id = context.inputRecord.data.id;
      // Run early hooks for pre-processing (e.g., file handling)
      await runHooks('beforeProcessing')
      await runHooks('beforeProcessingPut')
  
    // Validate PUT payload to ensure it's a complete resource replacement operation.
    // PUT requires the full resource representation including ID (unlike POST which generates ID).
    // It validates that data.id matches the URL parameter, prevents 'included' array (which is
    // read-only), and ensures the payload represents a complete replacement. Any fields not
    // provided will be removed or reset to defaults - this is the key difference from PATCH.
    // Example: PUT to /articles/123 must have data.id: '123' and all required fields.
    validatePutPayload(context.inputRecord, scopes)
    
    // Check existence first
    context.exists = await helpers.dataExists({
      scopeName,
      context,
      transaction: context.transaction
    });
  
    context.isCreate = !context.exists;
    context.isUpdate = context.exists;

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later
    const { belongsToUpdates, manyToManyRelationships } = processRelationships(
      scope,
      { context }
    );

    await validateResourceAttributesBeforeWrite({ 
            context, 
            schema, 
            belongsToUpdates, 
            runHooks, 
        });


    // For PUT, we also need to handle relationships that are NOT provided
    // (they should be set to null/empty as PUT is a complete replacement)
    const allRelationships = {};
    
    // Collect all defined relationships for this resource
    for (const [relName, relDef] of Object.entries(schemaRelationships || {})) {
      if (relDef.manyToMany) {
        allRelationships[relName] = { type: 'manyToMany', relDef: relDef.manyToMany };
      }
      // Also recognize hasMany with through as many-to-many
      else if (relDef.hasMany && relDef.through) {
        allRelationships[relName] = { 
          type: 'manyToMany', 
          relDef: {
            through: relDef.through,
            foreignKey: relDef.foreignKey,
            otherKey: relDef.otherKey
          }
        };
      }
    }
    
    // Also check schema fields for belongsTo relationships
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.as && (fieldDef.belongsTo || fieldDef.belongsToPolymorphic)) {
        allRelationships[fieldDef.as] = { 
          type: fieldDef.belongsToPolymorphic ? 'polymorphic' : 'belongsTo',
          fieldName,
          fieldDef 
        };
      }
    }
    
    // Process missing relationships (PUT should null them out only if relationships object exists)
    const hasRelationshipsObject = context.inputRecord.data.relationships !== undefined;
    const providedRelationships = new Set(Object.keys(context.inputRecord.data.relationships || {}));
    
    // Only null out missing relationships if a relationships object was provided
    if (hasRelationshipsObject) {
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
    }

    // Merge belongsTo updates with attributes
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      };
    }

    await runHooks ('checkPermissions')
    await runHooks ('checkPermissionsPut')
    await runHooks (`checkPermissionsPut${context.isCreate ? 'Create' : 'Update'}`)
  
    await runHooks ('beforeDataCall')
    await runHooks ('beforeDataCallPut')
    // Pass the operation type to the helper
    await helpers.dataPut({
      scopeName,
      context,
      transaction: context.transaction
    });
    await runHooks ('afterDataCallPut')
    await runHooks ('afterDataCall')

    // Process many-to-many relationships after main record update/creation
    for (const { relName, relDef, relData } of manyToManyRelationships) {
        // Validate pivot resource exists
        await validatePivotResource(scopes, relDef, relName);
        
        // Use smart sync for updates (like industry standard ORMs)
        if (context.isUpdate) {
          // Update many-to-many relationships using intelligent synchronization
          // This preserves existing pivot data while efficiently updating relationships
          await updateManyToManyRelationship(null, {
            api,
            context: {
              resourceId: context.id,
              relDef,
              relData,
              transaction: context.transaction
            }
          });
        } else {
          // For new records, just create the pivot records
          if (relData.length > 0) {
            await createPivotRecords(api, context.id, relDef, relData, context.transaction);
          }
        }
      }
   
       const ret = await handleRecordReturnAfterWrite({
        context,
        scopeName,
        api,
        scopes,
        schemaStructure,
        schemaRelationships,
        scopeOptions,
        vars,
        runHooks
    });


      // Commit transaction if we created it
      if (context.shouldCommit) {
        await context.transaction.commit();
      }

      return ret
   
    } catch (error) {
      await handleWriteMethodError(error, context, 'PUT', scopeName, enhancedLog);
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
      context.method = 'patch'
        
      try {
        const { schema, schemaStructure, schemaRelationships } = await setupCommonRequest({
            params, context, vars, scopes, scopeOptions, scopeName, helpers
        });
        context.id = context.inputRecord.data.id;        
        // Run early hooks for pre-processing (e.g., file handling)
        await runHooks('beforeProcessing')
        await runHooks('beforeProcessingPatch')

        // Validate PATCH payload to ensure the partial update actually contains changes.
        // PATCH requests must include either attributes to update or relationships to modify -
        // an empty PATCH is invalid. This prevents accidental no-op requests and ensures clients
        // are explicit about what they want to change. Unlike PUT, PATCH preserves all fields
        // not mentioned in the request.
        // Example: data must have either attributes: {title: 'New'} or relationships: {author: {...}}
        validatePatchPayload(context.inputRecord, scopes)
        

        // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
        // Example: relationships.author -> author_id: '123' for storage
        // Example: relationships.tags -> array of pivot records to create later (only for provided relationships in PATCH)
        const { belongsToUpdates, manyToManyRelationships } = processRelationships(
          scope,
          { context }
        );

        await validateResourceAttributesBeforeWrite({ 
            context, 
            schema, 
            belongsToUpdates, 
            runHooks,
            isPartialValidation: true 
        });

    
        // Permissions check
        await runHooks ('checkPermissions')
        await runHooks ('checkPermissionsPatch')
        
        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallPatch')

        // Call the storage helper - should return the patched record
        await helpers.dataPatch({
          scopeName,
          context,
          transaction: context.transaction
        });

        await runHooks ('afterDataCallPatch')
        await runHooks ('afterDataCall')

        // Process many-to-many relationships after main record update
        // For PATCH, we only update the relationships that were explicitly provided
        for (const { relName, relDef, relData } of manyToManyRelationships) {
          
          // Validate pivot resource exists
          validatePivotResource(scopes, relDef, relName);
          
          // Update many-to-many relationships using intelligent synchronization that preserves pivot data.
          // This compares current relationships with desired state: removes records no longer needed,
          // adds new relationships, and crucially preserves existing pivot records with their metadata
          // (like created_at timestamps or extra pivot fields). This is superior to delete-all-recreate
          // because it maintains audit trails and custom pivot data.
          // Example: If article has tags [1,2,3] and you update to [2,3,4], it keeps the pivot records
          // for tags 2&3 (preserving their created_at), deletes tag 1, and adds new record for tag 4.
          // Example: If article has tags [1,2,3] and update sends [2,3,4], tag 1 is removed, tags 2,3 kept, tag 4 added
          await updateManyToManyRelationship(null, {
            api,
            context: {
              resourceId: context.id,
              relDef,
              relData,
              transaction: context.transaction
            }
          });
        }
        
        const ret = await handleRecordReturnAfterWrite({
          context,
          scopeName,
          api,
          scopes,
          schemaStructure,
          schemaRelationships,
          scopeOptions,
          vars,
          runHooks
      });


        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
        }

        return ret
      
      } catch (error) {
        await handleWriteMethodError(error, context, 'PATCH', scopeName, enhancedLog);
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
      
      // Set the ID in context
      context.id = params.id
      
      // Set schema info even for DELETE (needed by storage layer)
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;
      
      // Transaction handling
      context.transaction = params.transaction || 
          (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
      context.shouldCommit = !params.transaction && !!context.transaction;
      
      try {
        // No payload validation needed for DELETE
        
        // Run permission checks
        await runHooks ('checkPermissions')
        await runHooks ('checkPermissionsDelete')
        
        // Before data operations
        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallDelete')
        
        // Initialize record context for hooks
        context.record = {}
        
        // Call the storage helper
        await helpers.dataDelete({
          scopeName,
          context,
          transaction: context.transaction
        });
        
        await runHooks ('afterDataCallDelete')
        await runHooks ('afterDataCall')
        
        // No return record for DELETE (204 No Content)
        
        await runHooks ('finish')
        await runHooks ('finishDelete')
        
        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
        }
        
        // DELETE typically returns void/undefined (204 No Content)
        return;
        
      } catch (error) {
        await handleWriteMethodError(error, context, 'DELETE', scopeName, enhancedLog);
      }
    })

    /**
     * enrichAttributes
     * Runs the enrichAttributes hook for a specific scope to allow plugins to modify attributes
     * before they are returned to the client. This is a scope method so each resource type
     * can have its own attribute enrichment logic.
     * 
     * @param {Object} attributes - The attributes to enrich
     * @param {Object} parentContext - The parent context from the calling method
     * @returns {Promise<Object>} The enriched attributes
     * 
     * @example
     * // Enrich attributes for the main resource
     * const enrichedAttrs = await scope.enrichAttributes({ 
     *   attributes: record.data.attributes,
     *   parentContext: context 
     * });
     * 
     * @example
     * // Enrich attributes for included resources
     * for (const entry of included) {
     *   const entryScope = scopes[entry.type];
     *   entry.attributes = await entryScope.enrichAttributes({
     *     attributes: entry.attributes,
     *     parentContext: context
     *   });
     * }
     */
    addScopeMethod('enrichAttributes', async ({ params, runHooks, scopeName, scopes, api, helpers }) => {
      // Extract parameters passed to enrichAttributes
      // - attributes: The raw attributes from database
      // - parentContext: The context from the calling method (has queryParams, transaction, etc.)
      // - requestedComputedFields: Which computed fields to calculate (from sparse fieldsets)
      // - isMainResource: Whether this is the main resource or an included one
      // - computedDependencies: Fields fetched only for computation (to be removed)
      const { attributes, parentContext, requestedComputedFields, isMainResource, computedDependencies } = params || {};
      
      // Return empty object if no attributes provided
      if (!attributes) {
        return {};
      }
      
      // Get schema and computed field definitions
      const schemaStructure = scopes[scopeName]?.vars?.schemaInfo?.schemaStructure || {};
      const computedFields = scopes[scopeName]?.vars?.schemaInfo?.computed || {};
      
      // Filter hidden fields from attributes based on visibility rules
      // This removes hidden:true fields and normallyHidden:true fields (unless requested)
      const requestedFields = parentContext?.queryParams?.fields?.[scopeName];
      const filteredAttributes = filterHiddenFields(attributes, { structure: schemaStructure }, requestedFields);
      
      // Determine which computed fields to calculate
      // We only compute fields that are requested to optimize performance
      let fieldsToCompute = [];
      if (requestedComputedFields) {
        // Explicit list provided (from sparse fieldsets)
        // Example: ?fields[products]=name,profit_margin -> only compute profit_margin
        fieldsToCompute = requestedComputedFields;
      } else if (isMainResource || !parentContext?.queryParams?.fields) {
        // No sparse fieldsets or this is the main resource - compute all fields
        // This ensures all computed fields are available when no filtering is applied
        fieldsToCompute = Object.keys(computedFields);
      }
      
      // Create compute context with all available resources
      // IMPORTANT: We pass the original attributes (including dependencies) to compute functions
      // This ensures computed fields can access normallyHidden dependencies like 'cost'
      // Example: profit_margin compute function gets access to both 'price' and 'cost'
      const computeContext = {
        attributes: attributes,              // All attributes including dependencies
        record: { ...attributes },           // Full record for convenience
        context: {
          ...parentContext,
          transaction: parentContext?.transaction,  // For DB queries in compute
          knex: parentContext?.knex || parentContext?.db,  // Direct DB access
          scopeName
        },
        helpers,                             // API helpers for complex operations
        api,                                 // Full API instance
        scopeName,                           // Current resource name
        requestContext: parentContext        // Original request context
      };
      
      // Auto-compute fields that have compute functions
      for (const fieldName of fieldsToCompute) {
        const fieldDef = computedFields[fieldName];
        if (fieldDef && fieldDef.compute) {
          try {
            // Call the compute function with full context
            // Example: profit_margin compute gets { attributes: { price: 100, cost: 60 } }
            // and returns: ((100 - 60) / 100 * 100) = "40.00"
            filteredAttributes[fieldName] = await fieldDef.compute(computeContext);
          } catch (error) {
            // Log error but don't fail the request - computed fields shouldn't break API
            console.error(`Error computing field '${fieldName}' for ${scopeName}:`, error);
            filteredAttributes[fieldName] = null;
          }
        }
      }
      
      // Create context for enrichAttributes hooks
      const hookContext = {
        parentContext,
        attributes: filteredAttributes,
        computedFields,
        requestedComputedFields: fieldsToCompute,
        scopeName,
        helpers,
        api
      };
      
      // Run enrichAttributes hooks for additional/override computations
      await runHooks('enrichAttributes', hookContext);
      
      // Remove fields that were only fetched as dependencies
      // This is the key to the dependency resolution feature:
      // 1. We fetched dependencies from DB (e.g., 'cost' for profit_margin)
      // 2. We used them in compute functions
      // 3. Now we remove them if they weren't explicitly requested
      // Example: User requests profit_margin, we fetch cost, compute, then remove cost
      const finalAttributes = { ...hookContext.attributes };
      if (requestedFields && computedDependencies && computedDependencies.length > 0) {
        // Parse requested fields if it's a string
        const requested = typeof requestedFields === 'string'
          ? requestedFields.split(',').map(f => f.trim()).filter(f => f)
          : requestedFields;
          
        for (const dep of computedDependencies) {
          // Only remove if it wasn't explicitly requested
          // Example: 'cost' is removed unless user explicitly asked for it
          if (!requested.includes(dep)) {
            delete finalAttributes[dep];
          }
        }
      }
      
      return finalAttributes;
    });

    // Initialize default data helpers that throw errors until a storage plugin is installed
    // These placeholders show storage plugin developers what methods to implement
    // Example: helpers.dataGet, helpers.dataPost, etc. will throw "No storage implementation" errors
    const defaultHelpers = createDefaultDataHelpers(api);
    Object.assign(helpers, defaultHelpers);
    
    // Add default getLocation helper for generating resource URLs
    // This can be overridden by storage plugins if needed
    helpers.getLocation = ({ scopeName, id }) => {
      return `/${scopeName}/${id}`;
    };



  }
};