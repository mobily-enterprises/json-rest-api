import { requirePackage } from 'hooked-api';
import { createSchema }  from 'json-rest-schema';
import { createKnexTable, addKnexFields } from './lib/dbTablesOperations.js';
import { buildFieldSelection, isNonDatabaseField } from './lib/querying-writing/knex-field-helpers.js';
import { getForeignKeyFields } from './lib/querying-writing/field-utils.js';
import { buildQuerySelection } from './lib/querying/knex-query-helpers-base.js';
import { toJsonApiRecord, buildJsonApiResponse } from './lib/querying/knex-json-api-transformers-querying.js';
import { processBelongsToRelationships } from './lib/writing/knex-json-api-transformers-writing.js';
import { toJsonApiRecordWithBelongsTo } from './lib/querying-writing/knex-json-api-transformers.js';
import { processIncludes } from './lib/querying/knex-process-includes.js';
import { loadRelationshipIdentifiers } from './lib/querying/knex-relationship-includes.js';
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook
} from './lib/querying/knex-query-helpers.js';
import { RestApiResourceError, RestApiValidationError } from '../../lib/rest-api-errors.js';
import { supportsWindowFunctions, getDatabaseInfo } from './lib/querying-writing/database-capabilities.js';
import { ERROR_SUBTYPES, DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT } from './lib/querying-writing/knex-constants.js';
import { 
  calculatePaginationMeta, 
  generatePaginationLinks,
  generateCursorPaginationLinks,
  buildCursorMeta,
  parseCursor
} from './lib/querying/knex-pagination-helpers.js';

/**
 * Strips non-database fields (computed and virtual) from attributes before database operations
 * @param {Object} attributes - The attributes object
 * @param {Object} schemaInfo - The schema info containing computed field definitions and schema structure
 * @returns {Object} Attributes with computed and virtual fields removed
 */
const stripNonDatabaseFields = (attributes, schemaInfo) => {
  if (!attributes || !schemaInfo) return attributes || {};
  
  const { computed = {}, schemaStructure = {} } = schemaInfo;
  return Object.entries(attributes)
    .filter(([key]) => {
      // Remove computed fields
      if (key in computed) return false;
      // Remove fields marked as virtual in the schema
      const fieldDef = schemaStructure[key];
      if (fieldDef && fieldDef.virtual === true) {
        return false;
      }
      return true;
    })
    .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {});
};


export const RestApiKnexPlugin = {
  name: 'rest-api-knex',
  dependencies: ['rest-api'],

  async install({ helpers, vars, pluginOptions, api, log, scopes, addHook, addScopeMethod }) {
    // Try to import knex dynamically
    let knexLib;
    try {
      knexLib = await import('knex');
    } catch (e) {
      requirePackage('knex', 'rest-api-knex', 
        'Knex.js is required for database operations. This is a peer dependency that allows you to control the version.');
    }
    
    // Get Knex instance from plugin options
    const knexOptions = pluginOptions || {};
    const knex = knexOptions.knex;
    
    // Expose Knex instance and helpers in a structured way
    api.knex = {
      instance: knex,
      helpers: {}
    };

    // Check database capabilities
    const hasWindowFunctions = await supportsWindowFunctions(knex);
    const dbInfo = await getDatabaseInfo(knex);
    
    // Store capabilities in API instance for access throughout
    api.knex.capabilities = {
      windowFunctions: hasWindowFunctions,
      dbInfo
    };
    
    log.info(`Database capabilities detected:`, {
      database: dbInfo.client,
      version: dbInfo.version,
      windowFunctions: hasWindowFunctions
    });

    // Cross-table search functions are now imported directly and used with full signatures
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                  MAIN QUERY FILTERING HOOK                              ║
     * ║  This is the heart of the filtering system. It processes searchSchema   ║
     * ║  filters and builds SQL WHERE conditions with proper JOINs              ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */
    
    // Register the three separate filter hooks
    // Dependencies object for the hooks
    const polymorphicFiltersHookParams  = { log, scopes, knex };
    
    // Register in specific order: polymorphic → cross-table → basic
    // This ensures proper field qualification when JOINs are present
    
    // 1. Polymorphic filters (adds JOINs for polymorphic relationships)
    addHook('knexQueryFiltering', 'polymorphicFiltersHook', {}, 
      async (hookParams) => polymorphicFiltersHook(hookParams, polymorphicFiltersHookParams)
    );
    
    // 2. Cross-table filters (adds JOINs for cross-table fields)
    addHook('knexQueryFiltering', 'crossTableFiltersHook', {}, 
      async (hookParams) => crossTableFiltersHook(hookParams, polymorphicFiltersHookParams)
    );
    
    // 3. Basic filters (processes simple main table filters)
    addHook('knexQueryFiltering', 'basicFiltersHook', {}, 
      async (hookParams) => basicFiltersHook(hookParams, polymorphicFiltersHookParams)
    );

        // 3. Basic filters (processes simple main table filters)
    addHook('release', 'releaseHook', {}, 
       async ({ api }) => api.knex.instance.destroy() 
    );


  // Helper scope method to get all schema-related information
    addScopeMethod('createKnexTable', async ({ vars, scope, scopeName, scopeOptions, runHooks }) => {
      // Create a filtered schema that excludes virtual fields
      const schemaStructure = vars.schemaInfo.schemaStructure || {};
      const filteredSchema = {};
      
      // Copy only non-virtual fields to the filtered schema
      Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
        if (!fieldDef.virtual) {
          filteredSchema[fieldName] = fieldDef;
        }
      });
      
      // Create schema object from filtered fields
      const tableSchema = createSchema(filteredSchema);
      
      await createKnexTable(api.knex.instance, vars.schemaInfo.tableName, tableSchema, vars.schemaInfo.idProperty)
    })

    // Helper scope method to add a field to an existing table
    addScopeMethod('addKnexFields', async ({ vars, scope, scopeName, scopeOptions, runHooks, params }) => {
      
      // Create schema object from filtered fields
      const partialTableSchema = createSchema(params.fields);
      
      await addKnexFields(api.knex.instance, vars.schemaInfo.tableName, partialTableSchema)
    })

    helpers.newTransaction = async () => {
      return knex.transaction()
    }

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    DATA OPERATION METHODS                           ║
     * ║  Implementation of the storage interface required by REST API plugin║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    /**
     * Checks if a resource exists in the database
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to check for existence
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<boolean>} True if the resource exists, false otherwise
     */
    helpers.dataExists = async ({ scopeName, context }) => {
      const id = context.id;
      const scope = api.resources[scopeName];

      const tableName = context.schemaInfo.tableName
      const idProperty = context.schemaInfo.idProperty
      const db = context.db;
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      // Select with alias if idProperty is not 'id'
      const selectClause = idProperty !== 'id' ? `${idProperty} as id` : 'id';
      
      const record = await db(tableName)
        .where(idProperty, id)
        .select(selectClause)
        .first();
      
      return !!record;
    };

    /**
     * Retrieves a single resource by ID with support for sparse fieldsets and includes
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to retrieve
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} [params.context.queryParams] - Query parameters for sparse fieldsets and includes
     * @param {Object} [params.context.queryParams.fields] - Sparse fieldset selections
     * @param {Array<string>} [params.context.queryParams.include] - Related resources to include
     * @param {Object} [params.context.computedDependencies] - Set by function to track computed field dependencies
     * @returns {Promise<Object>} JSON:API formatted response with data and optional included resources
     * @throws {RestApiResourceError} When the resource is not found
     */
    helpers.dataGet = async ({ scopeName, context, runHooks }) => {
      const scope = api.resources[scopeName];
      if (!scope) {
        log.error('[DATA-GET] scope is undefined!', { scopeName, availableScopes: Object.keys(api.resources || {}) });
        throw new Error(`Scope '${scopeName}' not found in api.resources`);
      }
      if (!scope.scopeName && !scope.name) {
        log.debug('[DATA-GET] Scope structure:', { 
          scopeKeys: Object.keys(scope),
          scopeName,
          hasVars: !!scope.vars,
          varKeys: scope.vars ? Object.keys(scope.vars) : []
        });
      }
      const id = context.id;      
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const db = context.db;
      
      log.debug(`[Knex] GET ${tableName}/${id}`);
      
      // Build field selection for sparse fieldsets
      // This determines which fields to SELECT from database
      // and tracks dependencies needed for computed fields
      const fieldSelectionInfo = await buildFieldSelection(
        scope,
        { context }
      );
      
      // Store dependency info in context for enrichAttributes
      // Example: If user requests 'profit_margin' (computed), this might contain ['cost']
      // The REST API plugin will use this to remove 'cost' from response if not requested
      context.computedDependencies = fieldSelectionInfo.computedDependencies;
      
      // Build query - no filtering hooks for single records
      // Permission checks will handle access control
      let query = db(tableName).where(idProperty, id);
      
      // Apply field selection
      query = buildQuerySelection(query, tableName, fieldSelectionInfo.fieldsToSelect, false);
      
      const record = await query.first();
      
      if (!record) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: ERROR_SUBTYPES.NOT_FOUND,
            resourceType: scopeName,
            resourceId: id
          }
        );
      }
      
      // Load relationship identifiers for all hasMany relationships
      const records = [record]; // Wrap in array for processing
      await loadRelationshipIdentifiers(records, scopeName, scopes, db);
      
      // Process includes
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context
      });
      
      // Build and return response
      return buildJsonApiResponse(scope, records, included, true, scopeName, context);
    };

    /**
     * Retrieves a single resource by ID with minimal processing (no includes or sparse fieldsets)
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to retrieve
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<Object|null>} JSON:API formatted resource with belongsTo relationships, or null if not found
     */
    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const scope = api.resources[scopeName];
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty;
      const db = context.db;
      
      log.debug(`[Knex] GET_MINIMAL ${tableName}/${id}`);
      
      // Build query - no filtering hooks for single records
      // Permission checks will handle access control
      let query = db(tableName).where(idProperty, id);
      
      // Add alias if idProperty is not 'id'
      if (idProperty !== 'id') {
        query = query.select('*', `${idProperty} as id`);
      }
      
      // Execute query
      const record = await query.first();
      
      if (!record) {
        return null;
      }
      
      // Transform to JSON:API format with belongsTo relationships
      return toJsonApiRecordWithBelongsTo(scope, record, scopeName);
    };

    /**
     * Queries resources with support for filtering, sorting, pagination, sparse fieldsets, and includes
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.schemaInfo.searchSchemaInstance - Search schema for filtering capabilities
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.queryParams - Query parameters object
     * @param {Object} [params.context.queryParams.filters] - Filter conditions
     * @param {Array<string>} [params.context.queryParams.sort] - Sort fields (prefix with - for DESC)
     * @param {Object} [params.context.queryParams.page] - Pagination parameters
     * @param {number} [params.context.queryParams.page.size] - Page size
     * @param {number} [params.context.queryParams.page.number] - Page number (offset pagination)
     * @param {string} [params.context.queryParams.page.after] - Cursor for forward pagination
     * @param {string} [params.context.queryParams.page.before] - Cursor for backward pagination
     * @param {Array<string>} [params.context.queryParams.include] - Related resources to include
     * @param {Object} [params.context.queryParams.fields] - Sparse fieldset selections
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Array<string>} params.context.sortableFields - Array of fields that can be sorted
     * @param {Object} [params.context.knexQuery] - Temporarily set during hooks for query building
     * @param {Object} [params.context.computedDependencies] - Set by function to track computed field dependencies
     * @param {Function} params.runHooks - Function to run hooks (e.g., 'knexQueryFiltering')
     * @returns {Promise<Object>} JSON:API formatted response with data array, optional included resources, and pagination meta/links
     */
    helpers.dataQuery = async ({ scopeName, context, runHooks }) => {    
      const scope = api.resources[scopeName];
      const tableName = context.schemaInfo.tableName;
      const schema =  context.schemaInfo.schemaInstance;
      const searchSchema =  context.schemaInfo.searchSchemaInstance;
      const queryParams = context.queryParams
      const db = context.db;
      const sortableFields = context.sortableFields
      const idProperty = context.schemaInfo.idProperty

      log.trace('[DATA-QUERY] Starting dataQuery', { scopeName, hasSearchSchema: !!searchSchema });
      log.debug(`[Knex] QUERY ${tableName}`, queryParams);
      
      // Build field selection for sparse fieldsets
      // This determines which fields to SELECT from database
      // and tracks dependencies needed for computed fields
      const fieldSelectionInfo = await buildFieldSelection(
        scope,
        { context }
      );
      
      // Store dependency info in context for enrichAttributes
      // Example: If user requests 'profit_margin' (computed), this might contain ['cost']
      // The REST API plugin will use this to remove 'cost' from response if not requested
      context.computedDependencies = fieldSelectionInfo.computedDependencies;
      
      // Start building query with table prefix (for JOIN support)
      let query = db(tableName);

      query = buildQuerySelection(query, tableName, fieldSelectionInfo.fieldsToSelect, true);
      
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
      
      // Apply pagination
      // Check if page object has any actual pagination parameters
      const hasPageParams = queryParams.page && 
        (queryParams.page.size !== undefined || 
         queryParams.page.number !== undefined || 
         queryParams.page.after !== undefined || 
         queryParams.page.before !== undefined);
      
      if (hasPageParams) {
        const requestedSize = queryParams.page.size || scope.vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT;
        const pageSize = Math.min(
          requestedSize,
          scope.vars.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
        );
        
        // Validate page size
        if (requestedSize <= 0) {
          throw new RestApiValidationError(
            'Page size must be greater than 0',
            {
              fields: ['page.size'],
              violations: [{
                field: 'page.size',
                rule: 'min_value',
                message: 'Page size must be a positive number'
              }]
            }
          );
        }
        
        // Offset-based pagination
        if (queryParams.page.number !== undefined) {
          const pageNumber = queryParams.page.number || 1;
          query
            .limit(pageSize)
            .offset((pageNumber - 1) * pageSize);
        }
        // Cursor-based pagination
        else if (queryParams.page.after || queryParams.page.before) {
          // Fetch one extra record to determine if there are more
          query.limit(pageSize + 1);
          
          // Get the configured ID property
          const idProperty = context.schemaInfo.idProperty || 'id';
          
          if (queryParams.page.after) {
            let cursorData;
            try {
              cursorData = parseCursor(queryParams.page.after);
            } catch (error) {
              throw new RestApiValidationError(
                'Invalid cursor format in page[after] parameter',
                {
                  fields: ['page.after'],
                  violations: [{
                    field: 'page.after',
                    rule: 'invalid_cursor',
                    message: 'The cursor value is not valid'
                  }]
                }
              );
            }
            
            // Build sort fields array with directions
            const sortFields = [];
            if (queryParams.sort && queryParams.sort.length > 0) {
              queryParams.sort.forEach(sortField => {
                const desc = sortField.startsWith('-');
                const field = desc ? sortField.substring(1) : sortField;
                sortFields.push({ field, direction: desc ? 'DESC' : 'ASC' });
              });
            } else if (scope.vars.defaultSort) {
              sortFields.push({
                field: scope.vars.defaultSort.field || idProperty,
                direction: scope.vars.defaultSort.direction || 'ASC'
              });
            } else {
              sortFields.push({ field: idProperty, direction: 'ASC' });
            }
            
            // Build compound WHERE clause for multi-field cursor
            query.where(function() {
              sortFields.forEach((sortInfo, index) => {
                const { field, direction } = sortInfo;
                const qualifiedField = `${tableName}.${field}`;
                const cursorValue = cursorData[field];
                
                if (cursorValue === undefined) {
                  log.warn(`Cursor missing value for sort field: ${field}`);
                  return;
                }
                
                // Build condition for this level and all previous levels
                this.orWhere(function() {
                  // All previous fields must be equal
                  for (let i = 0; i < index; i++) {
                    const prevField = sortFields[i].field;
                    const prevQualifiedField = `${tableName}.${prevField}`;
                    const prevValue = cursorData[prevField];
                    if (prevValue !== undefined) {
                      this.where(prevQualifiedField, '=', prevValue);
                    }
                  }
                  
                  // Current field must be greater/less than cursor value
                  if (direction === 'DESC') {
                    this.where(qualifiedField, '<', cursorValue);
                  } else {
                    this.where(qualifiedField, '>', cursorValue);
                  }
                });
              });
            });
            
          } else if (queryParams.page.before) {
            let cursorData;
            try {
              cursorData = parseCursor(queryParams.page.before);
            } catch (error) {
              throw new RestApiValidationError(
                'Invalid cursor format in page[before] parameter',
                {
                  fields: ['page.before'],
                  violations: [{
                    field: 'page.before',
                    rule: 'invalid_cursor',
                    message: 'The cursor value is not valid'
                  }]
                }
              );
            }
            
            // Build sort fields array with directions
            const sortFields = [];
            if (queryParams.sort && queryParams.sort.length > 0) {
              queryParams.sort.forEach(sortField => {
                const desc = sortField.startsWith('-');
                const field = desc ? sortField.substring(1) : sortField;
                sortFields.push({ field, direction: desc ? 'DESC' : 'ASC' });
              });
            } else if (scope.vars.defaultSort) {
              sortFields.push({
                field: scope.vars.defaultSort.field || idProperty,
                direction: scope.vars.defaultSort.direction || 'ASC'
              });
            } else {
              sortFields.push({ field: idProperty, direction: 'ASC' });
            }
            
            // Build compound WHERE clause for multi-field cursor (reversed for before)
            query.where(function() {
              sortFields.forEach((sortInfo, index) => {
                const { field, direction } = sortInfo;
                const qualifiedField = `${tableName}.${field}`;
                const cursorValue = cursorData[field];
                
                if (cursorValue === undefined) {
                  log.warn(`Cursor missing value for sort field: ${field}`);
                  return;
                }
                
                // Build condition for this level and all previous levels
                this.orWhere(function() {
                  // All previous fields must be equal
                  for (let i = 0; i < index; i++) {
                    const prevField = sortFields[i].field;
                    const prevQualifiedField = `${tableName}.${prevField}`;
                    const prevValue = cursorData[prevField];
                    if (prevValue !== undefined) {
                      this.where(prevQualifiedField, '=', prevValue);
                    }
                  }
                  
                  // Current field must be less/greater than cursor value (reversed)
                  if (direction === 'DESC') {
                    this.where(qualifiedField, '>', cursorValue);
                  } else {
                    this.where(qualifiedField, '<', cursorValue);
                  }
                });
              });
            });
          }
        }
        // Default pagination if only size is specified - treat as cursor-based for "load more"
        else {
          // Fetch one extra to detect hasMore
          query.limit(pageSize + 1);
        }
      } else {
        // No pagination params provided - apply default limit
        const defaultLimit = scope.vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT;
        query.limit(defaultLimit);
      }
      
      // Execute query
      const records = await query;
      
      // Store query string for response building
      const queryParts = [];
      Object.entries(queryParams).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          // Handle arrays (like sort, include)
          if (value.length > 0) {
            queryParts.push(`${key}=${value.map(v => encodeURIComponent(v)).join(',')}`);
          }
        } else if (typeof value === 'object' && value !== null) {
          // Handle nested objects (like filters, fields, page)
          Object.entries(value).forEach(([subKey, subValue]) => {
            if (subValue !== undefined && subValue !== null) {
              if (typeof subValue === 'object' && !Array.isArray(subValue)) {
                // Handle deeply nested objects (like filters[country][code])
                Object.entries(subValue).forEach(([subSubKey, subSubValue]) => {
                  if (subSubValue !== undefined && subSubValue !== null) {
                    queryParts.push(`${key}[${subKey}][${subSubKey}]=${encodeURIComponent(subSubValue)}`);
                  }
                });
              } else {
                queryParts.push(`${key}[${subKey}]=${encodeURIComponent(subValue)}`);
              }
            }
          });
        } else if (value !== undefined && value !== null) {
          queryParts.push(`${key}=${encodeURIComponent(value)}`);
        }
      });
      
      // Initialize returnMeta namespace for thread-safe metadata
      context.returnMeta = context.returnMeta || {};
      context.returnMeta.queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

      // Execute count query for pagination if offset-based pagination is used
      if (queryParams.page?.number !== undefined || (queryParams.page?.size !== undefined && !queryParams.page?.after && !queryParams.page?.before)) {
        const page = parseInt(queryParams.page?.number) || 1;
        const pageSize = parseInt(queryParams.page?.size) || scope.vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT;
        
        // Only execute count query if enabled
        if (scope.vars.enablePaginationCounts) {
          // Build count query with same filters as main query
          const countQuery = db(tableName);
          
          // Apply filters through hooks (same as main query)
          if (queryParams.filters && Object.keys(queryParams.filters).length > 0) {
            // Store query data in context for hooks
            if (context) {
              context.knexQuery = { query: countQuery, filters: queryParams.filters, searchSchema, scopeName, tableName, db };
            }
            
            // Run the same filtering hooks
            await runHooks('knexQueryFiltering');
            
            // Clean up
            if (context && context.knexQuery) {
              delete context.knexQuery;
            }
          }
          
          // Get total count
          const countResult = await countQuery.count('* as total').first();
          const total = parseInt(countResult.total);
          
          // Calculate pagination metadata with total
          context.returnMeta.paginationMeta = calculatePaginationMeta(total, page, pageSize);
        } else {
          // Without count, we can still provide basic pagination info
          context.returnMeta.paginationMeta = {
            page,
            pageSize
            // No total, pageCount, or hasMore when counts are disabled
          };
        }
        
        // Generate links 
        const urlPrefix = scope.vars.returnBasePath || scope.vars.transport?.mountPath || '';
        context.returnMeta.paginationLinks = generatePaginationLinks(
          urlPrefix,
          scopeName,
          queryParams,
          context.returnMeta.paginationMeta
        );
      }
      
      // Handle cursor-based pagination meta
      // Generate cursor metadata when using cursor parameters OR when only size is specified (no page number)
      if (queryParams.page?.after || queryParams.page?.before || 
          (queryParams.page?.size && queryParams.page?.number === undefined)) {
        const pageSize = parseInt(queryParams.page?.size) || scope.vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT;
        
        // Check if there are more records
        // We fetched pageSize + 1 records to detect if there are more
        const hasMore = records.length > pageSize;
        
        // Remove the extra record if present
        if (hasMore) {
          records.pop();
        }
        
        // Determine sort fields for cursor
        const idProperty = context.schemaInfo.idProperty || 'id';
        let sortFields = [idProperty];
        if (queryParams.sort && queryParams.sort.length > 0) {
          sortFields = queryParams.sort.map(s => s.startsWith('-') ? s.substring(1) : s);
        }
        
        context.returnMeta.paginationMeta = buildCursorMeta(records, pageSize, hasMore, sortFields);
        const urlPrefix = scope.vars.returnBasePath || scope.vars.transport?.mountPath || '';
        context.returnMeta.paginationLinks = generateCursorPaginationLinks(
          urlPrefix,
          scopeName,
          queryParams,
          records,
          pageSize,
          hasMore,
          sortFields
        );
      }
      
      // Load relationship identifiers for all hasMany relationships
      await loadRelationshipIdentifiers(records, scopeName, scopes, db);
      
      // Process includes
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context,
        api
      });
      

      // Build and return response
      return buildJsonApiResponse(scope, records, included, false, scopeName, context);
    };
    
    /**
     * Creates a new resource in the database
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} params.context.inputRecord.data.attributes - The resource attributes to insert
     * @returns {Promise<string|number>} The ID of the newly created resource
     */
    helpers.dataPost = async ({ scopeName, context }) => {
      const scope = api.resources[scopeName];
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schemaInstance;
      const db = context.db;
      const inputRecord = context.inputRecord      
      
      log.debug(`[Knex] POST ${tableName}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Strip non-database fields (computed and virtual) before insert
      const dbAttributes = stripNonDatabaseFields(attributes, context.schemaInfo);
      
      // Insert and get the new ID
      const result = await db(tableName).insert(dbAttributes).returning(idProperty);
      
      // Extract the ID value (SQLite returns array of objects)
      const id = result[0]?.[idProperty] || result[0];
      return id
    };
    
    /**
     * Replaces an entire resource (PUT operation) or creates it with a specific ID
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to replace or create
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} [params.context.inputRecord.data.attributes] - The resource attributes
     * @param {Object} [params.context.inputRecord.data.relationships] - The resource relationships (processed for foreign keys)
     * @param {boolean} params.context.isCreate - Whether this is a create operation (true) or update (false)
     * @returns {Promise<void>} Resolves when the operation is complete
     * @throws {RestApiResourceError} When updating and the resource is not found
     */
    helpers.dataPut = async ({ scopeName, context }) => {
      const scope = api.resources[scopeName];
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schemaInstance;
      const db = context.db;
      const inputRecord = context.inputRecord      
      const isCreate = context.isCreate
    
      log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${context.isCreate})`);
      
      // Extract attributes and process relationships using helper
      const attributes = inputRecord.data.attributes || {};
      const foreignKeyUpdates = processBelongsToRelationships(scope, { context });
      const mergedAttributes = { ...attributes, ...foreignKeyUpdates };
      
      // Strip non-database fields (computed and virtual) before database operation
      const finalAttributes = stripNonDatabaseFields(mergedAttributes, context.schemaInfo);
        
      // Map 'id' to actual idProperty if needed (for PUT with specific ID)
      if (idProperty !== 'id' && inputRecord.data.id) {
        finalAttributes[idProperty] = inputRecord.data.id;
      }

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
          throw new RestApiResourceError(
            `Resource not found`,
            { 
              subtype: ERROR_SUBTYPES.NOT_FOUND,
              resourceType: scopeName,
              resourceId: id
            }
          );
        }
        
        // Remove the idProperty from attributes to prevent updating the primary key
        delete finalAttributes[idProperty];
        
        // Update the record (replace all fields)
        if (Object.keys(finalAttributes).length > 0) {
          await db(tableName)
            .where(idProperty, id)
            .update(finalAttributes);
        }
      }
      
      return 
    };
    
    /**
     * Partially updates a resource (PATCH operation)
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to update
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.schemaInfo.schemaInstance - The full schema definition for the resource
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @param {Object} params.context.inputRecord - JSON:API formatted input record with partial updates
     * @param {Object} params.context.inputRecord.data - The resource data
     * @param {Object} [params.context.inputRecord.data.attributes] - The resource attributes to update
     * @param {Object} [params.context.inputRecord.data.relationships] - The resource relationships (processed for foreign keys)
     * @returns {Promise<void>} Resolves when the update is complete
     * @throws {RestApiResourceError} When the resource is not found
     */
    helpers.dataPatch = async ({ scopeName, context  }) => {
      const scope = api.resources[scopeName];
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const db = context.db;
      const inputRecord = context.inputRecord      
      
      log.debug(`[Knex] PATCH ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await db(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: ERROR_SUBTYPES.NOT_FOUND,
            resourceType: scopeName,
            resourceId: id
          }
        );
      }
      
      // Extract attributes and process relationships using helper
      const attributes = inputRecord.data.attributes || {};
      const foreignKeyUpdates = processBelongsToRelationships(scope, { context });
      const mergedAttributes = { ...attributes, ...foreignKeyUpdates };
      
      // Strip non-database fields (computed and virtual) before database operation
      const finalAttributes = stripNonDatabaseFields(mergedAttributes, context.schemaInfo);
      
      log.debug(`[Knex] PATCH finalAttributes:`, finalAttributes);
      
      // Remove the idProperty from attributes to prevent updating the primary key
      delete finalAttributes[idProperty];
      
      // Update only if there are changes
      if (Object.keys(finalAttributes).length > 0) {
        await db(tableName)
          .where(idProperty, id)
          .update(finalAttributes);
      }
      
      return
    };
    
    /**
     * Deletes a resource from the database
     * 
     * @param {Object} params - The parameters object
     * @param {string} params.scopeName - The name of the resource scope (e.g., 'books', 'authors')
     * @param {Object} params.context - The context object containing request-specific data
     * @param {string|number} params.context.id - The ID of the resource to delete
     * @param {Object} params.context.schemaInfo - Schema information for the resource
     * @param {string} params.context.schemaInfo.tableName - The database table name (e.g., 'basic_books')
     * @param {string} params.context.schemaInfo.idProperty - The primary key field name (e.g., 'id')
     * @param {Object} params.context.db - Database connection (knex instance or transaction)
     * @returns {Promise<Object>} Returns { success: true } when deletion is successful
     * @throws {RestApiResourceError} When the resource is not found
     */
    helpers.dataDelete = async ({ scopeName, context }) => {
      const scope = api.resources[scopeName];
      const id = context.id;

      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const db = context.db;
      
      log.debug(`[Knex] DELETE ${tableName}/${id}`);
      
      // Check if record exists
      const exists = await db(tableName)
        .where(idProperty, id)
        .first();
      
      if (!exists) {
        throw new RestApiResourceError(
          `Resource not found`,
          { 
            subtype: ERROR_SUBTYPES.NOT_FOUND,
            resourceType: scopeName,
            resourceId: id
          }
        );
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