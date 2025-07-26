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
import { ValidationError } from 'hooked-api';
import { validatePolymorphicRelationships } from './lib/scope-validations.js';
import { transformSimplifiedToJsonApi, transformJsonApiToSimplified, transformSingleJsonApiToSimplified } from './lib/simplified-helpers.js';
import { processRelationships } from './lib/relationship-processor.js';
import { updateManyToManyRelationship, createPivotRecords } from './lib/many-to-many-manipulations.js';
import { createDefaultDataHelpers } from './lib/default-data-helpers.js';
import { compileSchemas } from './lib/compile-schemas.js';
import { createEnhancedLogger } from '../../lib/enhanced-logger.js';
import { getRequestedComputedFields, filterHiddenFields } from './lib/knex-field-helpers.js';
import { DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_INCLUDE_DEPTH_LIMIT, ERROR_SUBTYPES } from './utils/knex-constants.js';
import { normalizeRecordAttributes } from './lib/database-value-normalizers.js';
import { parseJsonApiQuery } from './utils/connectors-query-parser.js';


const cascadeConfig = (settingName, sources, defaultValue) =>
  sources.find(source => source?.[settingName] !== undefined)?.[settingName] ?? defaultValue

export const RestApiPlugin = {
  name: 'rest-api',

  install({ helpers, addScopeMethod, addApiMethod, vars, addHook, runHooks, apiOptions, pluginOptions, api, setScopeAlias, scopes, log, on }) {

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
    addHook('scope:added', 'validatePolymorphicRelationships', {}, validatePolymorphicRelationships);
    
    // Listen for scope creation to compile schemas immediately.
    // This ensures schemas are compiled and cached before any scope methods are called,
    // making them available for queries and other operations that need schema information.
    addHook('scope:added', 'compileResourceSchemas', {}, async ({context, scopes, runHooks}) => {
      const scope = scopes[context.scopeName];
      // Pass scopeOptions and vars from context since scope object structure is different
      return compileSchemas({ ...scope, scopeOptions: context.scopeOptions, vars: context.vars }, { context: { scopeName: context.scopeName }, runHooks });
    });
    
    // Validate include configurations in relationships after schemas are compiled
    addHook('scope:added', 'validateIncludeConfigurations', {}, async ({context, scopes}) => {
      const { scopeName } = context;
      const scope = scopes[scopeName];
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
    addHook('scope:added', 'turnScopeInitIntoVars', {}, async ({context, scopes, vars: apiVars}) => {
      // Refer to the scope's vars
      const scope = scopes[context.scopeName];
      const scopeOptions = scope?.scopeOptions || context.scopeOptions || {};
      const vars = scope?.vars || apiVars

      // The scope-specific ones
      vars.sortableFields = scopeOptions.sortableFields || [];
      vars.defaultSort = scopeOptions.defaultSort || null;     

      // The general ones that are also set at api level, but overrideable
      if (typeof scopeOptions.queryDefaultLimit !== 'undefined') vars.queryDefaultLimit = scopeOptions.queryDefaultLimit
      if (typeof scopeOptions.queryMaxLimit !== 'undefined') vars.queryMaxLimit = scopeOptions.queryMaxLimit
      if (typeof scopeOptions.includeDepthLimit !== 'undefined') vars.includeDepthLimit = scopeOptions.includeDepthLimit
      if (typeof scopeOptions.publicBaseUrl !== 'undefined') vars.publicBaseUrl = scopeOptions.publicBaseUrl
      if (typeof scopeOptions.enablePaginationCounts !== 'undefined') vars.enablePaginationCounts = scopeOptions.enablePaginationCounts
      
      // Set simplified settings as scope vars
      if (typeof scopeOptions.simplifiedApi !== 'undefined') vars.simplifiedApi = scopeOptions.simplifiedApi
      if (typeof scopeOptions.simplifiedTransport !== 'undefined') vars.simplifiedTransport = scopeOptions.simplifiedTransport
      
      // Set returnRecord settings as scope vars
      if (typeof scopeOptions.returnRecordApi !== 'undefined') vars.returnRecordApi = scopeOptions.returnRecordApi
      if (typeof scopeOptions.returnRecordTransport !== 'undefined') vars.returnRecordTransport = scopeOptions.returnRecordTransport
      
      // Set idProperty as scope var
      if (typeof scopeOptions.idProperty !== 'undefined') vars.idProperty = scopeOptions.idProperty

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
    const restApiOptions = pluginOptions || {};

    // These will be used as default fallbacks by the vars proxy if
    // they are not set in the scope options
    vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
    vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
    vars.includeDepthLimit = restApiOptions.includeDepthLimit || DEFAULT_INCLUDE_DEPTH_LIMIT
    vars.publicBaseUrl = restApiOptions.publicBaseUrl || ''
    vars.enablePaginationCounts = restApiOptions.enablePaginationCounts || true


    // New simplified settings
    vars.simplifiedTransport = restApiOptions.simplifiedTransport !== undefined 
      ? restApiOptions.simplifiedTransport 
      : false; // Default false for JSON:API compliance over the wire
    
    vars.simplifiedApi = restApiOptions.simplifiedApi !== undefined 
      ? restApiOptions.simplifiedApi 
      : true; // Default true for better DX in programmatic API
    
    vars.idProperty = restApiOptions.idProperty || 'id'

    // Return full record configuration for API and Transport
    // Support values: 'no', 'minimal', 'full'
    const normalizeReturnValue = (value, defaultValue) => {
      if (['no', 'minimal', 'full'].includes(value)) return value;
      return defaultValue;
    };

    // Process returnRecordApi options (default: 'full' for better DX)
    if (typeof restApiOptions.returnRecordApi === 'object' && restApiOptions.returnRecordApi !== null) {
      vars.returnRecordApi = {
        post: normalizeReturnValue(restApiOptions.returnRecordApi.post, 'full'),
        put: normalizeReturnValue(restApiOptions.returnRecordApi.put, 'full'),
        patch: normalizeReturnValue(restApiOptions.returnRecordApi.patch, 'full'),
      };
    } else if (restApiOptions.returnRecordApi !== undefined) {
      // Single string value applies to all methods
      const normalized = normalizeReturnValue(restApiOptions.returnRecordApi, 'full');
      vars.returnRecordApi = { post: normalized, put: normalized, patch: normalized };
    } else {
      // Default to 'full' for all methods
      vars.returnRecordApi = { post: 'full', put: 'full', patch: 'full' };
    }

    // Process returnRecordTransport options (default: 'no' for performance)
    if (typeof restApiOptions.returnRecordTransport === 'object' && restApiOptions.returnRecordTransport !== null) {
      vars.returnRecordTransport = {
        post: normalizeReturnValue(restApiOptions.returnRecordTransport.post, 'no'),
        put: normalizeReturnValue(restApiOptions.returnRecordTransport.put, 'no'),
        patch: normalizeReturnValue(restApiOptions.returnRecordTransport.patch, 'no'),
      };
    } else if (restApiOptions.returnRecordTransport !== undefined) {
      // Single string value applies to all methods
      const normalized = normalizeReturnValue(restApiOptions.returnRecordTransport, 'no');
      vars.returnRecordTransport = { post: normalized, put: normalized, patch: normalized };
    } else {
      // Default to 'no' for all methods
      vars.returnRecordTransport = { post: 'no', put: 'no', patch: 'no' };
    }
    
    log.debug('returnRecordApi configuration:', vars.returnRecordApi);
    log.debug('returnRecordTransport configuration:', vars.returnRecordTransport);

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
            
      // Determine which simplified setting to use based on transport
      const isTransport = params.isTransport === true;
      
      // Use vars which automatically cascade from scope to global
      const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi;
      
      // Get simplified setting - from params only (per-call override) or use default
      context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified;

      // Assign common context properties
      context.schemaInfo = scopes[scopeName].vars.schemaInfo; // This is the object variable created by compileSchemas
      context.queryParams = params.queryParams || {};

      // These only make sense as parameter per query
      context.queryParams.fields = cascadeConfig('fields', [params.queryParams], {});
      context.queryParams.include = cascadeConfig('include', [params.queryParams], []);
      context.queryParams.sort = cascadeConfig('sort', [params.queryParams], [])
      context.queryParams.page = cascadeConfig('page', [params.queryParams], {})
  
      context.transaction = params.transaction;
      context.db = context.transaction || api.knex.instance;
      
      context.scopeName = scopeName;

      // These are just shortcuts used in this function and will be returned
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

      // Centralised checkPermissions function
      await scope.checkPermissions({
        method: 'query',
        auth: context.auth,
        transaction: context.transaction
      })

      await runHooks ('beforeData')
      await runHooks ('beforeDataQuery')
      context.record = await helpers.dataQuery({
        scopeName,
        context,
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

      // Determine which simplified setting to use based on transport
      const isTransport = params.isTransport === true;
      
      // Use vars which automatically cascade from scope to global
      const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi;
      
      // Get simplified setting - from params only (per-call override) or use default
      context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified;

      // Assign common context properties
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;
      context.queryParams = params.queryParams || {};
    
      // These only make sense as parameter per query
      context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {});
      context.queryParams.include = cascadeConfig('include', [context.queryParams], []);
      
      context.transaction = params.transaction;
      context.db = context.transaction || api.knex.instance;

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

      // Fetch minimal record for authorization checks
      const minimalRecord = await helpers.dataGetMinimal({
        scopeName,
        context,
        runHooks
      });

      if (!minimalRecord) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: 'not_found',
            resourceType: scopeName,
            resourceId: context.id
          }
        );
      }

      context.minimalRecord = minimalRecord;

      // Centralised checkPermissions function
      await scope.checkPermissions({
        method: 'get',
        auth: context.auth,
        id: context.id,
        minimalRecord: context.minimalRecord,
        transaction: context.transaction
      })
      
      await runHooks('beforeData')
      await runHooks('beforeDataGet')

      context.record = await helpers.dataGet({
        scopeName,
        context,
        runHooks
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
        // Determine which simplified setting to use based on transport
        const isTransport = params.isTransport === true;
        
        // Use vars which automatically cascade from scope to global
        const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi;
        
        // Get simplified setting - from params only (per-call override) or use default
        context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified;
        
        // Special case: if no inputRecord provided, force simplified mode
        if (!params.inputRecord && context.simplified === false) {
            context.simplified = true;
        }

        // Params is totally bypassed in simplified mode
        if (context.simplified) {
            if (params.inputRecord) {
                context.inputRecord = params.inputRecord;
                context.params = params;
            } else {
                context.inputRecord = params;
                // Preserve returnFullRecord if specified in params
                context.params = params.returnFullRecord ? { returnFullRecord: params.returnFullRecord } : {};
            }
        } else {
            context.inputRecord = params.inputRecord;
            context.params = params;
        }

        // Assign common context properties
        context.schemaInfo = scopes[scopeName].vars.schemaInfo;
        
        // Use vars which automatically cascade from scope to global
        const defaultReturnFullRecord = isTransport ? vars.returnRecordTransport : vars.returnRecordApi;
        
        // Get return record setting - from params only (per-call override) or use default
        const returnFullRecordRaw = context.params.returnFullRecord !== undefined 
            ? context.params.returnFullRecord 
            : defaultReturnFullRecord;
        
        // Normalize return record setting to always be an object with method keys
        if (typeof returnFullRecordRaw === 'object' && returnFullRecordRaw !== null) {
            // It's already an object, normalize the values
            context.returnRecordSetting = {
                post: normalizeReturnValue(returnFullRecordRaw.post),
                put: normalizeReturnValue(returnFullRecordRaw.put),
                patch: normalizeReturnValue(returnFullRecordRaw.patch)
            };
        } else {
            // It's a single value (string or boolean), apply to all methods
            const normalized = normalizeReturnValue(returnFullRecordRaw);
            context.returnRecordSetting = {
                post: normalized,
                put: normalized,
                patch: normalized
            };
        }
        
        // Helper function to normalize return values (same as above)
        function normalizeReturnValue(value) {
            if (['no', 'minimal', 'full'].includes(value)) return value;
            return 'no'; // default
        }

        // These only make sense as parameter per query, not in vars etc.
        context.queryParams = params.queryParams || {};
        context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {});
        context.queryParams.include = cascadeConfig('include', [context.queryParams], []);

        context.scopeName = scopeName;

        // Transaction handling
        context.transaction = params.transaction || 
            (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
        context.shouldCommit = !params.transaction && !!context.transaction;
        context.db = context.transaction || api.knex.instance;

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
        // Convert both to strings for comparison since databases may return numeric IDs
        if (context.id && context.inputRecord.data.id && String(context.id) !== String(context.inputRecord.data.id)) {
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
    await runHooks('afterRollback');
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
      
      // Get virtual fields from schema info
      const virtualFields = context.schemaInfo?.virtual || {};
      
      // Separate virtual fields from regular attributes
      const inputAttributes = context.inputRecord.data.attributes || {};
      const virtualFieldValues = {};
      const attributesForValidation = {};
      
      // Split attributes into virtual and regular
      Object.entries(inputAttributes).forEach(([key, value]) => {
        if (key in virtualFields) {
          virtualFieldValues[key] = value;
        } else {
          attributesForValidation[key] = value;
        }
      });
      
      // Store virtual fields in context for later use
      context.virtualFieldValues = virtualFieldValues;
      
      // Merge belongsTo updates with non-virtual attributes for validation
      const attributesToValidate = {
          ...attributesForValidation,
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
        if (fieldDef && fieldDef.belongsTo && fieldDef.as) {
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
      
      // Combine validated attributes with virtual fields
      context.inputRecord.data.attributes = {
          ...validatedObject,
          ...virtualFieldValues
      };

      await runHooks (`afterSchemaValidate${methodSpecificHookSuffix}`);
      await runHooks ('afterSchemaValidate');
    };

    /**
     * Validates that the user has read access to all related resources in relationships.
     * This ensures users can only create relationships to resources they can access.
     * 
     * @param {object} context - The context object from addScopeMethod
     * @param {object} inputRecord - The JSON:API input record with relationships
     * @param {object} helpers - Data helpers including dataGetMinimal
     * @param {function} runHooks - Function to run hooks
     * @param {object} api - API instance to access resources
     * @throws {Error} If user doesn't have access to any related resource
     */
    const validateRelationshipAccess = async (context, inputRecord) => {
      if (!inputRecord?.data?.relationships) return;
      
      for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
        if (!relData?.data) continue;
        
        // Handle both single and array relationships
        const relatedItems = Array.isArray(relData.data) ? relData.data : [relData.data];
        
        for (const item of relatedItems) {
          // Get the scope for the related resource
          const relatedScope = api.resources[item.type];
          if (!relatedScope) {
            throw new Error(`Unknown resource type: ${item.type}`);
          }
          
          // Create context for dataGetMinimal
          const getContext = {
            ...context,
            id: item.id,
            schemaInfo: relatedScope.vars.schemaInfo,
            scopeName: item.type,
            method: 'get', // We're checking read permission
            isUpdate: false
          };

      
          // Get the minimal record
          const record = await helpers.dataGetMinimal({ 
            scopeName: item.type, 
            context: getContext, 
            runHooks 
          });
          
          if (!record) {
            throw new Error(`Related ${item.type} with id ${item.id} not found`);
          }
          
          // Now check permissions on the related record
          getContext.minimalRecord = record;
          await relatedScope.checkPermissions({
            method: 'get',
            auth: getContext.auth,
            id: item.id,
            minimalRecord: record,
            transaction: getContext.transaction
          });
        }
      }
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
        scopes,
        schemaStructure,
        schemaRelationships,
        scopeOptions,
        vars,
        runHooks,
        helpers,
        enhancedLog
    }) {
        const methodSpecificHookSuffix = getMethodHookSuffix(context.method);
        
        // Step 1: Set up record state for hooks
        // Handle originalMinimalRecord and minimalRecord based on method type
        if (context.method === 'DELETE') {
            // For DELETE, keep the deleted record reference
            if (context.minimalRecord) {
                context.originalMinimalRecord = context.minimalRecord;
            }
        } else {
            // For POST, PUT, PATCH - save the original state if it exists
            if (context.minimalRecord) {
                context.originalMinimalRecord = context.minimalRecord;
            }
            
            // Fetch the current state of the record after the write operation
            try {
                const currentRecord = await helpers.dataGetMinimal({
                    scopeName,
                    context,
                    runHooks
                });
                context.minimalRecord = currentRecord;
            } catch (error) {
                enhancedLog.warn(`Could not fetch minimal record after ${context.method} operation`, { error, id: context.id });
            }
        }

        // Step 2: Determine what to return based on configuration
        const returnMode = context.returnRecordSetting[context.method];
        
        // Case 1: Return nothing (204 No Content)
        if (returnMode === 'no') {
            context.responseRecord = undefined;
            await runHooks('finish');
            await runHooks(`finish${methodSpecificHookSuffix}`);
            return undefined;
        }
        
        // Case 2: Return minimal record (just type and id)
        if (returnMode === 'minimal') {
            if (context.simplified) {
                context.responseRecord = { 
                    id: String(context.id), 
                    type: scopeName 
                };
            } else {
                context.responseRecord = {
                    data: {
                        type: scopeName,
                        id: String(context.id)
                    }
                };
            }
            await runHooks('finish');
            await runHooks(`finish${methodSpecificHookSuffix}`);
            return context.responseRecord;
        }
        
        // Case 3: Return full record
        if (returnMode === 'full') {
            // Fetch the complete record using the GET method
            const fullRecord = await api.resources[scopeName].get({
                id: context.id,
                queryParams: context.queryParams,
                transaction: context.transaction,
                simplified: context.simplified
            }, {...context });
            
            context.responseRecord = fullRecord || undefined;
            
            // Run finish hooks
            await runHooks('finish');
            await runHooks(`finish${methodSpecificHookSuffix}`);
            
            // Transform to simplified format if needed
            if (context.simplified && context.responseRecord) {
                return transformJsonApiToSimplified(
                    { record: context.responseRecord },
                    { context: { schemaStructure, schemaRelationships } }
                );
            }
            
            return context.responseRecord;
        }
        
        // This should never be reached, but just in case
        throw new Error(`Invalid returnMode: ${returnMode}`);
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
        
        // Validate that user has read access to all related resources
        // This ensures users can only create relationships to resources they can access
        await validateRelationshipAccess(context, context.inputRecord);
        
        // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
        // Example: relationships.author -> author_id: '123' for storage
        // Example: relationships.tags -> array of pivot records to create later
        const { belongsToUpdates, manyToManyRelationships } = await processRelationships(
          scope,
          { context }
        );

        // Merge belongsTo updates into attributes before validation (like PUT/PATCH do)
        if (Object.keys(belongsToUpdates).length > 0) {
          context.inputRecord.data.attributes = {
            ...context.inputRecord.data.attributes,
            ...belongsToUpdates
          };
        }

        await validateResourceAttributesBeforeWrite({ 
            context, 
            schema, 
            belongsToUpdates, 
            runHooks , 
        });

        // Centralised checkPermissions function
        await scope.checkPermissions({
          method: 'post',
          auth: context.auth,
          transaction: context.transaction
        })

        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallPost')
        
        // Create the main record - storage helper should return the created record with its ID
        context.id = await helpers.dataPost({
          scopeName,
          context
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
          runHooks,
          helpers,
          enhancedLog
      });


        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
          await runHooks('afterCommit');

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
    
    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, runHooks, api);
    
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

    // Check existence first
    context.exists = await helpers.dataExists({
      scopeName,
      context
    });
  
    context.isCreate = !context.exists;
    context.isUpdate = context.exists;

    // Fetch minimal record for authorization checks (only for updates)
    if (context.isUpdate) {
      const minimalRecord = await helpers.dataGetMinimal({
        scopeName,
        context,
        runHooks
      });

      if (!minimalRecord) {
        throw new RestApiResourceError(
          `Resource not found: ${scopeName}/${context.id}`,
          ERROR_SUBTYPES.NOT_FOUND
        );
      }

      context.minimalRecord = minimalRecord;
    }

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
      if (fieldDef.as && fieldDef.belongsTo) {
        allRelationships[fieldDef.as] = { 
          type: 'belongsTo',
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

    // Centralised checkPermissions function
    await scope.checkPermissions({
      method: 'put',
      auth: context.auth,
      id: context.id,
      minimalRecord: context.minimalRecord,
      isUpdate: context.isUpdate,
      transaction: context.transaction
    })
  
    await runHooks ('beforeDataCall')
    await runHooks ('beforeDataCallPut')
    // Pass the operation type to the helper
    await helpers.dataPut({
      scopeName,
      context
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
        runHooks,
        helpers,
        enhancedLog
    });


      // Commit transaction if we created it
      if (context.shouldCommit) {
        await context.transaction.commit();
        await runHooks('afterCommit');
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
        
        // Validate that user has read access to all related resources
        // This ensures users can only create relationships to resources they can access
        await validateRelationshipAccess(context, context.inputRecord);

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

        // Fetch minimal record for authorization checks
        const minimalRecord = await helpers.dataGetMinimal({
          scopeName,
          context,
          runHooks
        });

        if (!minimalRecord) {
          throw new RestApiResourceError(
            `Resource not found: ${scopeName}/${context.id}`,
            ERROR_SUBTYPES.NOT_FOUND
          );
        }

        context.minimalRecord = minimalRecord;
    
        // Centralised checkPermissions function
        await scope.checkPermissions({
          method: 'patch',
          auth: context.auth,
          id: context.id,
          minimalRecord: context.minimalRecord,
          transaction: context.transaction
        })

        // Merge belongsTo updates into attributes before patching the record
        if (Object.keys(belongsToUpdates).length > 0) {
          context.inputRecord.data.attributes = {
            ...context.inputRecord.data.attributes,
            ...belongsToUpdates
          };
        }

        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallPatch')

        // Call the storage helper - should return the patched record
        await helpers.dataPatch({
          scopeName,
          context
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
          runHooks,
          helpers,
          enhancedLog
      });


        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
          await runHooks('afterCommit');
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
      
      // Set scopeName in context (needed for broadcasting)
      context.scopeName = scopeName
      
      // Set schema info even for DELETE (needed by storage layer)
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;
      
      // Transaction handling
      context.transaction = params.transaction || 
          (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
      context.shouldCommit = !params.transaction && !!context.transaction;
      context.db = context.transaction || api.knex.instance;
      
      try {
        // No payload validation needed for DELETE
        
        // Fetch minimal record for authorization and logging
        const minimalRecord = await helpers.dataGetMinimal({
          scopeName,
          context,
          runHooks
        });
        
        if (!minimalRecord) {
          throw new RestApiResourceError(
            `Resource not found`,
            { 
              subtype: 'not_found',
              resourceType: scopeName,
              resourceId: context.id
            }
          );
        }
        
        context.originalMinimalRecord = minimalRecord;
        context.minimalRecord = minimalRecord;
        
        // Centralised checkPermissions function
        await scope.checkPermissions({
          method: 'delete',
          auth: context.auth,
          id: context.id,
          minimalRecord: context.minimalRecord,
          transaction: context.transaction
        })
        
        // Before data operations
        await runHooks ('beforeDataCall')
        await runHooks ('beforeDataCallDelete')
        
        // Initialize record context for hooks
        context.record = {}
        
        // Call the storage helper
        await helpers.dataDelete({
          scopeName,
          context
        });
        
        await runHooks ('afterDataCallDelete')
        await runHooks ('afterDataCall')
        
        // No return record for DELETE (204 No Content)
        
        await runHooks ('finish')
        await runHooks ('finishDelete')
        
        // Commit transaction if we created it
        if (context.shouldCommit) {
          await context.transaction.commit();
          await runHooks('afterCommit');
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
     */
    addScopeMethod('enrichAttributes', async ({ context, params, runHooks, scopeName, scopes, api, helpers }) => {
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

      // Get schema, computed field, and virtual field definitions
      const schemaStructure = scopes[scopeName]?.vars?.schemaInfo?.schemaStructure || {};
      const computedFields = scopes[scopeName]?.vars?.schemaInfo?.computed || {};
      const virtualFields = scopes[scopeName]?.vars?.schemaInfo?.virtual || {};

      // Filter hidden fields from attributes based on visibility rules
      // This removes hidden:true fields and normallyHidden:true fields (unless requested)
      const requestedFields = parentContext?.queryParams?.fields?.[scopeName];
      const filteredAttributes = filterHiddenFields(attributes, { structure: schemaStructure }, requestedFields);
      
      // Add virtual fields from context if they were provided in the request
      // Virtual fields come from user input and are passed through the context
      if (parentContext?.virtualFieldValues) {
        // Only include virtual fields that are defined in the schema
        Object.entries(parentContext.virtualFieldValues).forEach(([fieldName, value]) => {
          if (fieldName in virtualFields) {
            // Check if this virtual field should be included based on sparse fieldsets
            if (!requestedFields || 
                requestedFields.length === 0 || 
                (typeof requestedFields === 'string' ? requestedFields.split(',').map(f => f.trim()) : requestedFields).includes(fieldName)) {
              filteredAttributes[fieldName] = value;
            }
          }
        });
      }

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
        context: parentContext,       
        helpers,                             // API helpers for complex operations
        api,                                 // Full API instance
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

      // Remove fields that were only fetched as dependencies
      // This is the key to the dependency resolution feature:
      // 1. We fetched dependencies from DB (e.g., 'cost' for profit_margin)
      // 2. We used them in compute functions
      // 3. Now we remove them if they weren't explicitly requested
      // Example: User requests profit_margin, we fetch cost, compute, then remove cost
      const finalAttributes = { ...filteredAttributes };
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

      // Create context for enrichAttributes hooks
      Object.assign(context, {
        parentContext,
        attributes: finalAttributes,  // Use the final attributes after dependency removal
        computedFields,
        requestedComputedFields: fieldsToCompute,
        scopeName,
        helpers,
        api
      });

      // Run enrichAttributes hooks for additional/override computations
      await runHooks('enrichAttributes');

      // Return the attributes from context, which hooks may have modified
      return context.attributes;
    });

     /**
     * checkPermissions
     * Check if ther are permissions to access a resource.
     * 
     */
    addScopeMethod('checkPermissions', async ({ context, params, runHooks, scopeName, scopes, helpers }) => {
     
      Object.assign(context, {
        method: params.method,
        isUpdate: params.isUpdate,
        id: params.id,
        auth: params.auth,
        transaction: params.transaction,
        minimalRecord: params.minimalRecord
      })
      
      await runHooks('checkPermissions');
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
    
    // Helper to get the URL prefix for generating links
    helpers.getUrlPrefix = ({ scope, context }) => {
      // Check for publicBaseUrl first, then fall back to mountPath from transport
      return scope?.vars?.publicBaseUrl || vars.publicBaseUrl || vars.transport?.mountPath || '';
    };

    /**
     * Route registration for transport plugins
     * This creates a protocol-agnostic interface for registering HTTP-like routes
     */
    addApiMethod('addRoute', async ({ params }) => {
      const { method, path, handler } = params;
      
      // Validate route configuration
      if (!method || !path || !handler) {
        throw new ValidationError('Route requires method, path, and handler');
      }

      // This function converts the passed parameters into the hook's context
      const context = params
      
      // Run the addRoute hook to notify transport plugins
      await runHooks('addRoute', context);
      
      return { registered: true, method, path };
    });

    // Listen for scope additions to register routes
    addHook('scope:added', 'registerScopeRoutes', {}, async ({ context }) => {
      const { scopeName } = context;
      const basePath = vars.transport?.mountPath || '';
      
      // Helper to create route handlers
      const createRouteHandler = (scopeName, methodName) => {
        return async ({ queryString, headers, params, body, context }) => {
          const scope = api.scopes[scopeName];
          if (!scope) {
            throw new RestApiResourceError(
              `Scope '${scopeName}' not found`,
              { 
                subtype: 'not_found',
                resourceType: 'scope',
                resourceId: scopeName
              }
            );
          }
          
          // Build parameters for the scope method
          const methodParams = {};
          
          // Add ID for single-resource operations
          if (['get', 'put', 'patch', 'delete'].includes(methodName)) {
            methodParams.id = params.id;
          }
          
          // Parse query parameters for read operations
          if (['query', 'get'].includes(methodName)) {
            methodParams.queryParams = parseJsonApiQuery(queryString);
            methodParams.isTransport = true;
          }
          
          // Add body for write operations
          if (['post', 'put', 'patch'].includes(methodName)) {
            methodParams.inputRecord = body;
            methodParams.isTransport = true;
            
            // Add query params for includes/fields on write operations
            if (queryString) {
              methodParams.queryParams = parseJsonApiQuery(queryString);
            }
          }
          
          // Call the scope method
          const result = await scope[methodName](methodParams, context);
          
          // Return the result (transport plugin handles response formatting)
          return result;
        };
      };
      
      const scopePath = `${basePath}/${scopeName}`;
      
      // Register routes for each HTTP method
      // GET /api/{scope} - Query collection
      await api.addRoute({
        method: 'GET',
        path: scopePath,
        handler: createRouteHandler(scopeName, 'query')
      });
      
      // GET /api/{scope}/{id} - Get single resource
      await api.addRoute({
        method: 'GET',
        path: `${scopePath}/:id`,
        handler: createRouteHandler(scopeName, 'get')
      });
      
      // POST /api/{scope} - Create resource
      await api.addRoute({
        method: 'POST',
        path: scopePath,
        handler: createRouteHandler(scopeName, 'post')
      });
      
      // PUT /api/{scope}/{id} - Replace resource
      await api.addRoute({
        method: 'PUT',
        path: `${scopePath}/:id`,
        handler: createRouteHandler(scopeName, 'put')
      });
      
      // PATCH /api/{scope}/{id} - Update resource
      await api.addRoute({
        method: 'PATCH',
        path: `${scopePath}/:id`,
        handler: createRouteHandler(scopeName, 'patch')
      });
      
      // DELETE /api/{scope}/{id} - Delete resource
      await api.addRoute({
        method: 'DELETE',
        path: `${scopePath}/:id`,
        handler: createRouteHandler(scopeName, 'delete')
      });
      
      log.info(`Routes registered for scope '${scopeName}'`);
    });



  }
};