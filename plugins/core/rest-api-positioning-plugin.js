import { 
  calculatePosition, 
  getInitialPosition, 
  isValidPosition,
  assignInitialPositions 
} from './lib/fractional-positioning.js';

export const PositioningPlugin = {
  name: 'positioning',
  dependencies: ['rest-api', 'rest-api-knex'],

  install({ api, addHook, vars, helpers, log, scopes, pluginOptions }) {
    
    // Get configuration - hooked-api namespaces options by plugin name
    const positioningOptions = pluginOptions || {};

    // Store configuration in vars (data only) - inspired by multihome pattern
    vars.positioning = {
      field: positioningOptions.field || 'position',
      filters: positioningOptions.filters || [],
      excludeResources: positioningOptions.excludeResources || ['system_migrations', 'system_logs'],
      strategy: positioningOptions.strategy || 'fractional',
      beforeIdField: positioningOptions.beforeIdField || 'beforeId',
      defaultPosition: positioningOptions.defaultPosition || 'last',
      autoIndex: positioningOptions.autoIndex !== undefined ? positioningOptions.autoIndex : true,
      rebalanceThreshold: positioningOptions.rebalanceThreshold || 50 // Max position string length
    };

    // Validate configuration
    if (!['fractional', 'integer'].includes(vars.positioning.strategy)) {
      throw new Error(`Invalid positioning strategy: ${vars.positioning.strategy}. Must be 'fractional' or 'integer'`);
    }

    if (vars.positioning.strategy === 'integer') {
      throw new Error("Integer positioning strategy not yet implemented. Please use 'fractional'");
    }

    // Helper to check if a resource should have positioning
    function shouldHavePositioning(scopeName) {
      return !vars.positioning.excludeResources.includes(scopeName);
    }

    // Helper to build filter conditions for position groups
    function buildPositionFilterConditions(record, schemaInfo) {
      const conditions = {};
      
      log.debug('*** buildPositionFilterConditions', { 
        filters: vars.positioning.filters,
        record: record,
        recordKeys: Object.keys(record)
      });
      
      vars.positioning.filters.forEach(filterField => {
        if (record[filterField] !== undefined) {
          conditions[filterField] = record[filterField];
        }
      });

      log.debug('*** Filter conditions built', { conditions });
      return conditions;
    }

    // Validate that resources have position field when added
    addHook('scope:added', 'validate-position-field', {}, ({ context, vars }) => {
      const { scopeName, scopeOptions } = context;

      // Skip excluded resources
      if (!shouldHavePositioning(scopeName)) {
        log.debug(`Resource ${scopeName} excluded from positioning`);
        return;
      }

      // Check if schema has position field
      const schema = scopeOptions.schema;
      if (schema && !schema[vars.positioning.field]) {
        throw new Error(
          `Resource '${scopeName}' must have '${vars.positioning.field}' field in schema to use positioning plugin`
        );
      }

      // Validate filter fields exist
      vars.positioning.filters.forEach(filterField => {
        if (!schema[filterField]) {
          throw new Error(
            `Resource '${scopeName}' must have '${filterField}' field in schema for position filtering`
          );
        }
      });
    });

    // Add index for position field if autoIndex is enabled
    addHook('scope:added', 'add-position-index', { afterFunction: 'validate-position-field' }, async ({ context, vars, scopes }) => {
      const { scopeName } = context;
      
      if (!shouldHavePositioning(scopeName) || !vars.positioning.autoIndex) {
        return;
      }

      const scope = scopes[scopeName];
      const schemaInfo = scope.vars.schemaInfo;
      
      if (!schemaInfo || !api.knex?.instance) {
        return; // Skip if no database connection
      }

      try {
        const knex = api.knex.instance;
        const tableName = schemaInfo.tableName;
        
        // Check if table exists first
        const tableExists = await knex.schema.hasTable(tableName);
        if (!tableExists) {
          log.debug(`Table ${tableName} doesn't exist yet, skipping index creation`);
          return;
        }
        
        // Build index columns: filters + position field
        const indexColumns = [
          ...vars.positioning.filters,
          vars.positioning.field
        ];
        
        const indexName = `idx_${tableName}_positioning`;
        
        // Check if index already exists
        const hasIndex = await knex.schema.hasIndex(tableName, indexColumns, indexName);
        
        if (!hasIndex) {
          await knex.schema.table(tableName, table => {
            table.index(indexColumns, indexName);
          });
          
          log.info(`Created positioning index on ${tableName}`, { columns: indexColumns });
        }
      } catch (error) {
        log.warn(`Could not create positioning index for ${scopeName}:`, error.message);
      }
    });

    // Process beforeId parameter in requests
    addHook('beforeSchemaValidate', 'process-beforeid', {}, async ({ context, scopeName, vars }) => {
      log.debug('*** beforeSchemaValidate positioning hook', { 
        scopeName, 
        method: context.method,
        shouldHavePositioning: shouldHavePositioning(scopeName)
      });
      
      // Skip excluded resources
      if (!shouldHavePositioning(scopeName)) {
        log.debug('*** Skipping beforeId processing - excluded resource');
        return;
      }

      // Skip if no positioning context needed
      const method = context.method;
      if (!['post', 'put', 'patch'].includes(method)) {
        log.debug('*** Skipping beforeId processing - wrong method', { method });
        return;
      }

      // Check if resource has position field
      const scope = scopes[scopeName];
      const hasPositionField = scope?.vars?.schemaInfo?.schemaStructure?.[vars.positioning.field];
      
      if (!hasPositionField) {
        return;
      }

      // Extract beforeId from JSON:API format attributes
      const attributes = context.inputRecord?.data?.attributes || {};
      const beforeId = attributes[vars.positioning.beforeIdField];

      // Store beforeId in context for later use
      if (beforeId !== undefined) {
        context.positioningBeforeId = beforeId;
        
        // Remove beforeId from attributes so it doesn't get stored
        delete attributes[vars.positioning.beforeIdField];
      }
      
      // Remove any manually provided position field - position is managed by this plugin
      if (attributes[vars.positioning.field] !== undefined) {
        delete attributes[vars.positioning.field];
        
        log.debug('Positioning beforeId extracted', { 
          scopeName, 
          beforeId,
          method
        });
      }

      // For new records without explicit position, mark for positioning
      if (method === 'post' && !attributes[vars.positioning.field]) {
        context.needsPositioning = true;
      }
    });

    // Calculate and set position before create/update
    addHook('beforeDataCallPost', 'calculate-position-post', {}, async ({ context, scopeName, vars, helpers }) => {
      log.debug('*** beforeDataCallPost hook fired for positioning', { scopeName, method: context.method });
      await calculateAndSetPosition(context, scopeName, vars, helpers, log, scopes, api);
    });

    addHook('beforeDataCallPut', 'calculate-position-put', {}, async ({ context, scopeName, vars, helpers }) => {
      log.debug('*** beforeDataCallPut hook fired for positioning', { scopeName, method: context.method });
      // Only process if beforeId was provided or it's a new record
      if (context.positioningBeforeId !== undefined || context.needsPositioning) {
        await calculateAndSetPosition(context, scopeName, vars, helpers, log, scopes, api);
      }
    });

    addHook('beforeDataCallPatch', 'calculate-position-patch', {}, async ({ context, scopeName, vars, helpers }) => {
      log.debug('*** beforeDataCallPatch hook fired for positioning', { scopeName, method: context.method });
      // Only process if beforeId was provided
      if (context.positioningBeforeId !== undefined) {
        await calculateAndSetPosition(context, scopeName, vars, helpers, log, scopes, api);
      }
    });

    // Helper function to calculate and set position
    async function calculateAndSetPosition(context, scopeName, vars, helpers, log, scopes, api) {
      log.debug('*** calculateAndSetPosition called', { 
        scopeName, 
        method: context.method,
        shouldHavePositioning: shouldHavePositioning(scopeName),
        beforeId: context.positioningBeforeId,
        needsPositioning: context.needsPositioning
      });
      
      // Skip if no positioning needed
      if (!shouldHavePositioning(scopeName)) {
        log.debug('*** Skipping - resource excluded from positioning');
        return;
      }

      const beforeId = context.positioningBeforeId;
      const needsPositioning = context.needsPositioning;
      
      // Skip if no positioning action needed
      if (beforeId === undefined && !needsPositioning) {
        log.debug('*** Skipping - no positioning needed', { beforeId, needsPositioning });
        return;
      }

      // Always work with JSON:API format - get attributes
      const recordData = context.inputRecord?.data?.attributes || {};
        
      log.debug('*** Record data for positioning', { 
        recordData,
        simplified: context.simplified,
        inputRecord: context.inputRecord
      });


      // For PATCH/PUT, we need to get the current record's filter values
      let filterData = recordData;
      if ((context.method === 'patch' || context.method === 'put') && context.minimalRecord) {
        // Use the minimalRecord that was already fetched by REST API plugin
        // Merge current record's filter fields with the update data
        filterData = { ...context.minimalRecord, ...recordData };
      }
      
      // Build filter conditions for the position group
      const filterConditions = buildPositionFilterConditions(filterData, context.schemaInfo);
      
      // Query existing items in the same position group
      const knex = api.knex.instance;
      const tableName = context.schemaInfo.tableName;
      const idProperty = context.schemaInfo.idProperty;
      
      log.debug('*** Building position query', { tableName, idProperty, filterConditions });
      
      // Check if we have a transaction to use
      const db = context.transaction || knex;
      
      // Build base query with filter conditions
      const baseQuery = db(tableName);
      Object.entries(filterConditions).forEach(([field, value]) => {
        if (value === null) {
          baseQuery.whereNull(field);
        } else {
          baseQuery.where(field, value);
        }
      });
      
      // For updates, exclude the current record
      if ((context.method === 'patch' || context.method === 'put') && context.id) {
        baseQuery.whereNot(idProperty, context.id);
      }
      
      // Calculate effective beforeId first
      let effectiveBeforeId = beforeId;
      
      // Handle default positioning when no beforeId is provided
      if (beforeId === undefined) {
        if (vars.positioning.defaultPosition === 'last') {
          effectiveBeforeId = null; // null means position at end
        } else if (vars.positioning.defaultPosition === 'first') {
          effectiveBeforeId = 'FIRST'; // Special marker for first position
        }
      }
      
      let items = [];
      
      try {
        if (effectiveBeforeId === null) {
          // Positioning at end - only get the last item
          const lastItem = await baseQuery
            .clone()
            .select(idProperty, vars.positioning.field)
            .orderBy(vars.positioning.field, 'desc')
            .first();
          
          if (lastItem) {
            items = [lastItem];
          }
        } else if (effectiveBeforeId === 'FIRST') {
          // Positioning at beginning - get the first item
          const firstItem = await baseQuery
            .clone()
            .select(idProperty, vars.positioning.field)
            .orderBy(vars.positioning.field, 'asc')
            .first();
          
          if (firstItem) {
            items = [firstItem];
            effectiveBeforeId = firstItem[idProperty];
          } else {
            effectiveBeforeId = null;
          }
        } else if (effectiveBeforeId) {
          // Positioning before a specific item - get that item and the one before it
          const targetItem = await baseQuery
            .clone()
            .select(idProperty, vars.positioning.field)
            .where(idProperty, effectiveBeforeId)
            .first();
          
          if (targetItem) {
            // Get the item immediately before the target
            const prevItem = await baseQuery
              .clone()
              .select(idProperty, vars.positioning.field)
              .where(vars.positioning.field, '<', targetItem[vars.positioning.field])
              .orderBy(vars.positioning.field, 'desc')
              .first();
            
            items = prevItem ? [prevItem, targetItem] : [targetItem];
          }
        } else {
          // First item in group - no items needed
          items = [];
        }
        
        log.debug('*** Query completed', { itemCount: items.length });
      } catch (error) {
        log.error('*** Query failed', { error: error.message, stack: error.stack });
        throw error;
      }
      
      // Calculate new position
      const newPosition = items.length === 0 
        ? getInitialPosition()
        : calculatePosition(items, effectiveBeforeId, idProperty, vars.positioning.field);
      
      // Set the position in JSON:API format
      context.inputRecord.data.attributes = context.inputRecord.data.attributes || {};
      context.inputRecord.data.attributes[vars.positioning.field] = newPosition;
      
      log.debug('Position calculated', {
        scopeName,
        newPosition,
        beforeId: effectiveBeforeId,
        filterConditions,
        itemCount: items.length,
        method: context.method,
        id: context.id
      });
    }

    // Add positioning info back to response
    addHook('afterGet', 'add-beforeid-to-response', {}, async ({ context, vars }) => {
      // Only add if beforeId was in the original request
      if (context.positioningBeforeId !== undefined && context.record) {
        if (context.simplified) {
          context.record[vars.positioning.beforeIdField] = context.positioningBeforeId;
        } else {
          // For JSON:API, add to meta
          context.meta = context.meta || {};
          context.meta.positioning = {
            [vars.positioning.beforeIdField]: context.positioningBeforeId
          };
        }
      }
    });

    // Apply default sort by position if no other sort specified
    addHook('beforeQuery', 'apply-position-sort', {}, async ({ context, scopeName, vars }) => {
      if (!shouldHavePositioning(scopeName)) {
        return;
      }

      // Check if sort is already specified
      const hasSort = context.queryParams?.sort && context.queryParams.sort.length > 0;
      
      if (!hasSort) {
        // Apply position sort
        context.queryParams = context.queryParams || {};
        context.queryParams.sort = [vars.positioning.field];
        
        log.trace('Applied default position sort', { scopeName });
      }
    });

    // API methods for positioning operations
    api.positioning = {
      /**
       * Reorder items by providing new positions
       * @param {string} scopeName - Resource scope name
       * @param {Array} positions - Array of {id, position} or {id, beforeId}
       * @param {Object} filters - Filter conditions for position group
       */
      async reorder(scopeName, positions, filters = {}) {
        const scope = scopes[scopeName];
        if (!scope) {
          throw new Error(`Unknown resource: ${scopeName}`);
        }

        // Implementation would go here for bulk reordering
        log.info('Bulk reorder requested', { scopeName, count: positions.length });
      },

      /**
       * Get positioning configuration
       */
      getConfig() {
        return { ...vars.positioning };
      },

      /**
       * Check if a resource has positioning enabled
       */
      isEnabled(scopeName) {
        return shouldHavePositioning(scopeName);
      }
    };

    log.info('Positioning plugin installed', {
      field: vars.positioning.field,
      strategy: vars.positioning.strategy,
      filters: vars.positioning.filters,
      excludedResources: vars.positioning.excludeResources
    });
  }
};

/* 
Usage examples:

// Basic usage - positioning for all resources
await api.use(PositioningPlugin);

// With configuration
await api.use(PositioningPlugin, {
  field: 'sortOrder',
  filters: ['status', 'projectId'],
  excludeResources: ['users', 'logs']
});

// Position grouping example
await api.use(PositioningPlugin, {
  filters: ['boardId', 'listId'], // Separate positions per board/list combo
  defaultPosition: 'last'
});

// In requests:
// POST /api/tasks
{
  "title": "New Task",
  "boardId": 123,
  "listId": 456,
  "beforeId": "task-789"  // Position before this task
}

// Or to add at end:
{
  "title": "New Task",
  "boardId": 123,
  "listId": 456,
  "beforeId": null  // Explicit last position
}
*/