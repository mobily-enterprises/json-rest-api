import { createSchema, createKnexTable } from 'json-rest-schema';
import { createCrossTableSearchHelpers } from './lib/knex-cross-table-search.js';
import { getForeignKeyFields, buildFieldSelection } from './lib/knex-field-helpers.js';
import { buildQuerySelection } from './utils/knex-query-helpers-base.js';
import { toJsonApiRecord, buildJsonApiResponse, processBelongsToRelationships } from './lib/knex-json-api-transformers.js';
import { processIncludes } from './lib/knex-process-includes.js';
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook
} from './lib/knex-query-helpers.js';
import { RestApiResourceError } from '../../lib/rest-api-errors.js';
import { supportsWindowFunctions, getDatabaseInfo } from './lib/database-capabilities.js';
import { ERROR_SUBTYPES, DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT } from './utils/knex-constants.js';


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

    // Initialize cross-table search helpers
    const crossTableSearchHelpers = createCrossTableSearchHelpers(scopes, log);
    
    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                  MAIN QUERY FILTERING HOOK                              ║
     * ║  This is the heart of the filtering system. It processes searchSchema   ║
     * ║  filters and builds SQL WHERE conditions with proper JOINs              ║
     * ╚═════════════════════════════════════════════════════════════════════╝ */
    
    // Register the three separate filter hooks
    // Dependencies object for the hooks
    const polymorphicFiltersHookParams  = { log, scopes, knex, crossTableSearchHelpers };
    
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
    
    // Expose helpers under api.knex.helpers
    api.knex.helpers.crossTableSearch = crossTableSearchHelpers;

    // Helper scope method to get all schema-related information
      addScopeMethod('createKnexTable', async ({ vars, scope, scopeName, scopeOptions, runHooks }) => {   
        await createKnexTable(api.knex.instance, vars.schemaInfo.tableName, vars.schemaInfo.schema)
      })
    
      helpers.newTransaction = async () => {
        return knex.transaction()
      }

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    DATA OPERATION METHODS                           ║
     * ║  Implementation of the storage interface required by REST API plugin║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    helpers.dataExists = async ({ scopeName, context, transaction }) => {
      const id = context.id;
      const scope = api.resources[scopeName];

      const tableName = context.schemaInfo.tableName
      const idProperty = context.schemaInfo.idProperty
      const db = transaction || knex;
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      const record = await db(tableName)
        .where(idProperty, id)
        .select(idProperty)
        .first();
      
      return !!record;
    };

    helpers.dataGet = async ({ scopeName, context, transaction }) => {
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
      const schema =  context.schemaInfo.schema;
      const db = transaction || knex;
      
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
      
      // Build and execute query
      let query = db(tableName).where(idProperty, id);
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
      
      // Process includes
      const records = [record]; // Wrap in array for processing
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context
      });
      
      // Build and return response
      return buildJsonApiResponse(scope, records, included, true, scopeName);
    };

    helpers.dataQuery = async ({ scopeName, context, transaction, runHooks }) => {    
      const scope = api.resources[scopeName];
      const tableName = context.schemaInfo.tableName;
      const schema =  context.schemaInfo.schema;
      const searchSchema =  context.schemaInfo.searchSchema;
      const queryParams = context.queryParams
      const db = transaction || knex;
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
      
      // Apply pagination directly (no hooks)
      if (queryParams.page) {
        const pageSize = Math.min(
          queryParams.page.size || scope.vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT,
          scope.vars.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
        );
        const pageNumber = queryParams.page.number || 1;
        
        query
          .limit(pageSize)
          .offset((pageNumber - 1) * pageSize);
      }
      
      // Execute query
      const records = await query;
      
      // Process includes
      const included = await processIncludes(scope, records, {
        log,
        scopes,
        knex,
        context,
        api
      });
      

      // Build and return response
      return buildJsonApiResponse(scope, records, included, false, scopeName);
    };
    
    helpers.dataPost = async ({ scopeName, context, transaction }) => {
      const scope = api.resources[scopeName];
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = transaction || knex;
      const inputRecord = context.inputRecord      
      
      log.debug(`[Knex] POST ${tableName}`, inputRecord);
      
      // Extract attributes from JSON:API format
      const attributes = inputRecord.data.attributes;
      
      // Insert and get the new ID
      const result = await db(tableName).insert(attributes).returning(idProperty);
      
      // Extract the ID value (SQLite returns array of objects)
      const id = result[0]?.[idProperty] || result[0];
      return id
    };
    
    helpers.dataPut = async ({ scopeName, context, transaction }) => {
      const scope = api.resources[scopeName];
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = transaction || knex;
      const inputRecord = context.inputRecord      
      const isCreate = context.isCreate
    
      log.debug(`[Knex] PUT ${tableName}/${id} (isCreate: ${context.isCreate})`);
      
      // Extract attributes and process relationships using helper
      const attributes = inputRecord.data.attributes || {};
      const foreignKeyUpdates = processBelongsToRelationships(scope, { context });
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
          throw new RestApiResourceError(
            `Resource not found`,
            { 
              subtype: ERROR_SUBTYPES.NOT_FOUND,
              resourceType: scopeName,
              resourceId: id
            }
          );
        }
        
        // Update the record (replace all fields)
        if (Object.keys(finalAttributes).length > 0) {
          await db(tableName)
            .where(idProperty, id)
            .update(finalAttributes);
        }
      }
      
      return 
    };
    
    helpers.dataPatch = async ({ scopeName, context, transaction }) => {
      const scope = api.resources[scopeName];
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = transaction || knex;
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
      const finalAttributes = { ...attributes, ...foreignKeyUpdates };
      
      log.debug(`[Knex] PATCH finalAttributes:`, finalAttributes);
      
      // Update only if there are changes
      if (Object.keys(finalAttributes).length > 0) {
        await db(tableName)
          .where(idProperty, id)
          .update(finalAttributes);
      }
      
      return
    };
    
    helpers.dataDelete = async ({ scopeName, context, transaction }) => {
      const scope = api.resources[scopeName];
      const id = context.id;

      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const db = transaction || knex;
      
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