import { createSchema, createKnexTable } from 'json-rest-schema';
import { createCrossTableSearchHelpers } from './lib/knex-cross-table-search.js';
import { createRelationshipIncludeHelpers } from './lib/knex-relationship-includes.js';
import { getForeignKeyFields, buildFieldSelection } from './lib/knex-field-helpers.js';
import { buildQuerySelection } from './lib/knex-query-helpers-base.js';
import { toJsonApi, buildJsonApiResponse, processBelongsToRelationships } from './lib/knex-json-api-transformers.js';
import { processIncludes } from './lib/knex-process-includes.js';
import {
  polymorphicFiltersHook,
  crossTableFiltersHook,
  basicFiltersHook
} from './lib/knex-query-helpers.js';


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
    api.knex.helpers.relationshipIncludes = relationshipIncludeHelpers;
    

    // Now initialize relationship include helpers
    relationshipIncludeHelpers = createRelationshipIncludeHelpers(scopes, log, knex);

    // Helper scope method to get all schema-related information
      addScopeMethod('createKnexTable', async ({ vars, scope, scopeName, scopeOptions, runHooks }) => {   
        await createKnexTable(api.knex.instance, scopeName, vars.schemaInfo.schema)
      })
    

    /* ╔═════════════════════════════════════════════════════════════════════╗
     * ║                    DATA OPERATION METHODS                           ║
     * ║  Implementation of the storage interface required by REST API plugin║
     * ╚═════════════════════════════════════════════════════════════════════╝ */

    helpers.dataExists = async ({ scopeName, context, trx }) => {
      const id = context.id;
      const scope = api.resources[scopeName];

      const tableName = context.schemaInfo.tableName
      const idProperty = context.schemaInfo.idProperty
      const db = trx || knex;
      
      log.debug(`[Knex] EXISTS ${tableName}/${id}`);
      
      const record = await db(tableName)
        .where(idProperty, id)
        .select(idProperty)
        .first();
      
      return !!record;
    };

    helpers.dataGet = async ({ scopeName, context, trx }) => {
      const id = context.id;      
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const queryParams = context.queryParams
      const db = trx || knex;
      
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
        scopes,
        knex,
        relationshipIncludeHelpers
      });
      
      // Build and return response
      return buildJsonApiResponse(records, scopeName, schema, included, true, scopes, vars);
    };

    helpers.dataQuery = async ({ scopeName, context, trx }) => {    
      const tableName = context.schemaInfo.tableName;
      const schema =  context.schemaInfo.schema;
      const searchSchema =  context.schemaInfo.schema;
      const queryParams = context.queryParams
      const db = trx || knex;
      const sortableFields = context.sortableFields

      log.trace('[DATA-QUERY] Starting dataQuery', { scopeName, hasSearchSchema: !!searchSchema });
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
        scopes,
        knex,
        relationshipIncludeHelpers
      });
      
      // Build and return response
      return buildJsonApiResponse(records, scopeName, schema, included, false, scopes, vars);
    };
    
    helpers.dataPost = async ({ scopeName, context, trx }) => {
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = trx || knex;
      const inputRecord = context.inputRecord      
      
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
    
    helpers.dataPut = async ({ scopeName, context, trx }) => {
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = trx || knex;
      const inputRecord = context.inputRecord      
    
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
    
    helpers.dataPatch = async ({ scopeName, context, trx }) => {
      const id = context.id;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const schema =  context.schemaInfo.schema;
      const db = trx || knex;
      const inputRecord = context.inputRecord      
      
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
    
    helpers.dataDelete = async ({ scopeName, context, trx }) => {
      const id = context.id;

      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty
      const db = trx || knex;
      
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