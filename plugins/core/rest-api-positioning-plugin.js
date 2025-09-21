import { 
  calculatePosition, 
  getInitialPosition, 
  isValidPosition,
  assignInitialPositions 
} from './lib/fractional-positioning.js';

export const PositioningPlugin = {
  name: 'positioning',
  dependencies: ['rest-api', 'rest-api-knex|rest-api-youapi-knex'],

  install({ api, addHook, vars, helpers, log, scopes, pluginOptions }) {

    const installedPlugins = Array.from(api._installedPlugins || []);
    const legacyStorageInstalled = installedPlugins.includes('rest-api-knex');
    const canonicalStorageInstalled = installedPlugins.includes('rest-api-youapi-knex');
    if (!legacyStorageInstalled && !canonicalStorageInstalled) {
      throw new Error(
        "Positioning plugin requires either 'rest-api-knex' or 'rest-api-youapi-knex' to be installed before it."
      );
    }

    if (!api.knex?.instance) {
      throw new Error('Positioning plugin requires a storage plugin with knex support (rest-api-knex or rest-api-youapi-knex)');
    }

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

    const hasCanonicalStorage = (schemaInfo) => Boolean(schemaInfo?.descriptor?.canonical?.tableName);

    const getStorageTableName = (schemaInfo) => schemaInfo?.descriptor?.canonical?.tableName || schemaInfo?.tableName;

    const translateColumn = (schemaInfo, column) => {
      if (!schemaInfo || !column) return column;
      const descriptor = schemaInfo.descriptor;
      if (!descriptor) return column;

      const canonicalMap = descriptor.canonicalFieldMap || {};
      const mapEntry = canonicalMap[column];
      if (typeof mapEntry === 'string') {
        return mapEntry;
      }
      if (mapEntry && typeof mapEntry === 'object') {
        if (mapEntry.slot) return mapEntry.slot;
        if (mapEntry.slotColumn) return mapEntry.slotColumn;
        if (mapEntry.idSlot) return mapEntry.idSlot;
        if (mapEntry.typeSlot && column.endsWith('_type')) return mapEntry.typeSlot;
      }

      if (!mapEntry && column.endsWith('_id')) {
        const alias = column.slice(0, -3);
        const aliasEntry = canonicalMap[alias];
        if (typeof aliasEntry === 'string') {
          return aliasEntry;
        }
        if (aliasEntry?.idSlot) {
          return aliasEntry.idSlot;
        }
      }

      if (!mapEntry && column.endsWith('_type')) {
        const alias = column.slice(0, -5);
        const aliasEntry = canonicalMap[alias];
        if (aliasEntry?.typeSlot) {
          return aliasEntry.typeSlot;
        }
      }

      const fieldInfo = descriptor.fields?.[column];
      if (fieldInfo?.slot) return fieldInfo.slot;

      const belongsToInfo = descriptor.belongsTo?.[column];
      if (belongsToInfo?.idColumn) return belongsToInfo.idColumn;

      return column;
    };

    const applyResourceScope = (query, schemaInfo) => {
      const descriptor = schemaInfo?.descriptor;
      const canonical = descriptor?.canonical;
      if (!descriptor || !canonical?.tableName) {
        return query;
      }
      return query
        .where(canonical.tenantColumn, descriptor.tenant)
        .where(canonical.resourceColumn, descriptor.resource);
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
    function buildPositionFilterConditions(schemaInfo, {
      attributes = {},
      rawRecord = {},
      simplifiedRecord = {},
      inputRelationships = {},
      minimalRelationships = {},
    }) {
      const conditions = {};

      log.debug('*** buildPositionFilterConditions', {
        filters: vars.positioning.filters,
        attributeKeys: Object.keys(attributes || {}),
        rawKeys: Object.keys(rawRecord || {}),
        simplifiedKeys: Object.keys(simplifiedRecord || {}),
      });

      const tryAssign = (holder, field) => (holder && field in holder ? holder[field] : undefined);

      vars.positioning.filters.forEach((filterField) => {
        const searchField = schemaInfo.searchSchemaStructure?.[filterField] || null;
        const schemaField = schemaInfo.schemaStructure?.[filterField] || null;
        const isRelationship = Boolean(
          searchField?.isRelationship
          || schemaField?.belongsTo
          || schemaField?.belongsToPolymorphic
        );

        if (!searchField && !schemaField) {
          log.warn(`Filter field '${filterField}' not found in search schema or resource schema for positioning`);
        }

        const dbField = searchField?.actualField || filterField;
        let value;

        const attempt = (candidate) => {
          if (value === undefined && candidate !== undefined) {
            value = candidate;
          }
        };

        attempt(tryAssign(rawRecord, filterField));
        attempt(tryAssign(simplifiedRecord, filterField));
        attempt(tryAssign(rawRecord, dbField));
        attempt(tryAssign(attributes, filterField));
        attempt(tryAssign(attributes, dbField));

        if (isRelationship) {
          attempt(inputRelationships?.[filterField]?.data?.id);
          attempt(minimalRelationships?.[filterField]?.data?.id);
          // Some contexts may expose relationship data under attributes
          attempt(tryAssign(rawRecord?.relationships, filterField)?.data?.id);
        }

        if (value !== undefined) {
          const descriptorField = schemaInfo.descriptor?.fields?.[dbField];
          const isBelongsToSlot = descriptorField?.slotType === 'belongsTo'
            || Boolean(schemaField?.belongsTo || schemaField?.belongsToPolymorphic)
            || Boolean(searchField?.isRelationship);

          if (value === null) {
            conditions[dbField] = null;
          } else if (isBelongsToSlot) {
            conditions[dbField] = String(value);
          } else {
            conditions[dbField] = value;
          }
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

      // Validate filter fields exist (check both relationship names and actual field names)
      vars.positioning.filters.forEach(filterField => {
        // Check if it's a relationship field by looking for a field with matching 'as' property
        let fieldExists = false;
        
        // First check if the field exists directly in the schema
        if (schema[filterField]) {
          fieldExists = true;
        } else {
          // Check if it's a relationship name (as property)
          for (const [fieldName, fieldDef] of Object.entries(schema)) {
            if (fieldDef.as === filterField) {
              fieldExists = true;
              break;
            }
          }
        }
        
        if (!fieldExists) {
          throw new Error(
            `Resource '${scopeName}' must have '${filterField}' field or relationship in schema for position filtering`
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

      if (hasCanonicalStorage(schemaInfo)) {
        log.debug(`Skipping positioning index for canonical storage on ${scopeName}`);
        return;
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
        
        // Build index columns: map filter fields to actual database columns
        const indexColumns = [];
        
        // Map each filter field to its database column
        vars.positioning.filters.forEach(filterField => {
          const searchField = schemaInfo.searchSchemaStructure?.[filterField];
          if (searchField) {
            // Use actualField if it exists (for relationships)
            const dbField = searchField.actualField || filterField;
            indexColumns.push(dbField);
          } else if (schemaInfo.schemaStructure[filterField]) {
            // Direct database field
            indexColumns.push(filterField);
          }
        });
        
        // Add the position field
        indexColumns.push(vars.positioning.field);
        
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
      const attributes = context.inputRecord?.data?.attributes
        || (context.simplified && context.inputRecord && typeof context.inputRecord === 'object'
          ? context.inputRecord
          : {});
      const beforeId = attributes[vars.positioning.beforeIdField];

      // Store beforeId in context for later use
      if (beforeId !== undefined) {
        context.positioningBeforeId = beforeId;

        // Remove beforeId from attributes so it doesn't get stored
        delete attributes[vars.positioning.beforeIdField];

        if (context.simplified && context.inputRecord && typeof context.inputRecord === 'object') {
          delete context.inputRecord[vars.positioning.beforeIdField];
        }
      }

      // Remove any manually provided position field - position is managed by this plugin
      if (attributes[vars.positioning.field] !== undefined) {
        delete attributes[vars.positioning.field];

        log.debug('Positioning beforeId extracted', { 
          scopeName, 
          beforeId,
          method
        });

        if (context.simplified && context.inputRecord && typeof context.inputRecord === 'object') {
          delete context.inputRecord[vars.positioning.field];
        }
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

      const recordData = (() => {
        if (context.inputRecord?.data?.attributes) {
          return { ...context.inputRecord.data.attributes };
        }
        if (context.simplified && context.inputRecord && typeof context.inputRecord === 'object') {
          return { ...context.inputRecord };
        }
        return {};
      })();
        
      log.debug('*** Record data for positioning', { 
        recordData,
        simplified: context.simplified,
        inputRecord: context.inputRecord
      });

      const jsonApiRecord = context.inputRecord?.data || {};
      const inputRelationships = jsonApiRecord.relationships || {};
      const simplifiedRecord = context.simplified && context.inputRecord && typeof context.inputRecord === 'object'
        ? context.inputRecord
        : {};

      const minimalAttributes = context.minimalRecord?.attributes
        || context.minimalRecord?.data?.attributes
        || {};
      const minimalRelationships = context.minimalRecord?.relationships
        || context.minimalRecord?.data?.relationships
        || {};

      const combinedAttributes = {
        ...minimalAttributes,
        ...recordData,
      };

      // Build filter conditions for the position group
      const schemaInfo = context.schemaInfo;
      const filterConditions = buildPositionFilterConditions(schemaInfo, {
        attributes: combinedAttributes,
        rawRecord: recordData,
        simplifiedRecord,
        inputRelationships,
        minimalRelationships,
      });

      // Query existing items in the same position group
      const knex = api.knex.instance;
      const tableName = getStorageTableName(schemaInfo);
      const idProperty = schemaInfo.idProperty;
      const idColumn = translateColumn(schemaInfo, idProperty);
      const positionColumn = translateColumn(schemaInfo, vars.positioning.field);
      
      log.debug('*** Building position query', {
        tableName,
        idProperty,
        idColumn,
        positionField: vars.positioning.field,
        positionColumn,
        filterConditions
      });
      
      // Check if we have a transaction to use
      const db = context.transaction || knex;
      
      // Build base query with filter conditions
      const baseQuery = applyResourceScope(db(tableName), schemaInfo);
      Object.entries(filterConditions).forEach(([field, value]) => {
        const column = translateColumn(schemaInfo, field);
        if (value === null) {
          baseQuery.whereNull(column);
        } else {
          baseQuery.where(column, value);
        }
      });
      
      // For updates, exclude the current record
      if ((context.method === 'patch' || context.method === 'put') && context.id) {
        baseQuery.whereNot(idColumn, context.id);
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
      
      const selectColumns = {
        [idProperty]: idColumn,
        [vars.positioning.field]: positionColumn,
      };
      const selectWithAliases = (builder) => builder.select(selectColumns);

      try {
        log.debug('*** Positioning query start', {
          effectiveBeforeId,
          selectColumns,
        });
        if (effectiveBeforeId === null) {
          // Positioning at end - only get the last item
          const lastItem = await selectWithAliases(baseQuery
            .clone())
            .orderBy(positionColumn, 'desc')
            .first();
          
          if (lastItem) {
            items = [lastItem];
          }
        } else if (effectiveBeforeId === 'FIRST') {
          // Positioning at beginning - get the first item
          const firstItem = await selectWithAliases(baseQuery
            .clone())
            .orderBy(positionColumn, 'asc')
            .first();
          
          if (firstItem) {
            items = [firstItem];
            effectiveBeforeId = firstItem[idProperty];
          } else {
            effectiveBeforeId = null;
          }
        } else if (effectiveBeforeId) {
          // Positioning before a specific item - get that item and the one before it
          const targetItem = await selectWithAliases(baseQuery
            .clone())
            .where(idColumn, effectiveBeforeId)
            .first();
          
          if (targetItem) {
            // Get the item immediately before the target
            const prevItem = await selectWithAliases(baseQuery
              .clone())
              .where(positionColumn, '<', targetItem[vars.positioning.field])
              .orderBy(positionColumn, 'desc')
              .first();
            
            items = prevItem ? [prevItem, targetItem] : [targetItem];
          }
        } else {
          // First item in group - no items needed
          items = [];
        }
        
        log.debug('*** Query completed', { itemCount: items.length, items });
      } catch (error) {
        log.error('*** Query failed', { error: error.message, stack: error.stack });
        throw error;
      }
      
      // Calculate new position
      const newPosition = items.length === 0 
        ? getInitialPosition()
        : calculatePosition(items, effectiveBeforeId, idProperty, vars.positioning.field);
      
      // Set the position on the incoming payload so downstream steps persist it
      if (context.inputRecord?.data) {
        context.inputRecord.data.attributes = context.inputRecord.data.attributes || {};
        context.inputRecord.data.attributes[vars.positioning.field] = newPosition;
      }

      if (context.simplified && context.inputRecord && typeof context.inputRecord === 'object') {
        context.inputRecord[vars.positioning.field] = newPosition;
      }
      
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
