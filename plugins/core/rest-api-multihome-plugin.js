// Helper function for single record validation
  function validateSingleRecordAccess(context, scopeName, multihomeConfig, scopes, log) {
    // Skip if no multihome context
    if (!context.auth?.multihome_id) {
      if (multihomeConfig.requireAuth) {
        throw new Error('No multihome context available - cannot access record');
      }
      return;
    }

    // Skip excluded resources
    if (multihomeConfig.excludeResources.includes(scopeName)) {
      return;
    }

    // Check if resource has multihome field
    const scope = scopes[scopeName];
    const hasMultihomeField = scope?.vars?.schemaInfo?.schema?.structure?.[multihomeConfig.field];

    if (!hasMultihomeField && !multihomeConfig.allowMissing) {
      throw new Error(`Resource ${scopeName} missing required ${multihomeConfig.field} field`);
    }

    // For existing records, the knexQueryFiltering hook will handle filtering
    // This is just an additional safety check
    if (context.minimalRecord && hasMultihomeField) {
      const recordMultihomeId = context.minimalRecord[multihomeConfig.field];
      if (recordMultihomeId && recordMultihomeId !== context.auth.multihome_id) {
        log.error('Multihome security violation attempt', {
          scopeName,
          recordId: context.id,
          recordMultihomeId,
          contextMultihomeId: context.auth.multihome_id
        });
        throw new Error('Access denied - invalid tenant context');
      }
    }
  }

  export const MultiHomePlugin = {
    name: 'multihome',
    dependencies: ['rest-api', 'rest-api-knex'],

    install({ api, addHook, vars, helpers, log, scopes, pluginOptions }) {

      // Get configuration - hooked-api namespaces options by plugin name
      const multihomeOptions = pluginOptions?.['multihome'] || pluginOptions || {};

      // Store configuration in vars (data only)
      vars.multihome = {
        field: multihomeOptions.field || 'multihome_id',
        excludeResources: multihomeOptions.excludeResources || ['system_migrations', 'system_logs'],
        requireAuth: multihomeOptions.requireAuth !== undefined ? multihomeOptions.requireAuth : true,
        allowMissing: multihomeOptions.allowMissing || false
      };

      // Default extractor function
      function defaultSubdomainExtractor(request) {
        // Extract from subdomain (e.g., 'mobily' from 'mobily.app.com')
        const host = request.headers?.host || request.hostname || '';
        const subdomain = host.split('.')[0];

        // Don't use 'www' or 'api' as tenant IDs
        if (subdomain && !['www', 'api', 'app'].includes(subdomain)) {
          return subdomain;
        }

        // Fallback to header
        return request.headers?.['x-multihome-id'] || null;
      }

      // Store extractor function in helpers
      helpers.extractMultihomeId = multihomeOptions.extractor || defaultSubdomainExtractor;

      // Hook into transport layer to extract multihome_id
      addHook('transport:request', 'extract-multihome-id', {}, async ({ context, request, helpers }) => {
        // Extract multihome_id using configured extractor
        const multihomeId = helpers.extractMultihomeId(request);

        if (multihomeId) {
          // Store in auth context (even if no user auth)
          context.auth = context.auth || {};
          context.auth.multihome_id = multihomeId;

          log.debug('Multihome ID extracted', {
            multihome_id: multihomeId,
            source: request.headers?.host
          });
        } else if (vars.multihome.requireAuth) {
          log.warn('No multihome ID found in request', {
            host: request.headers?.host,
            headers: Object.keys(request.headers || {})
          });
        }
      });

      // Validate that resources have multihome field when added
      addHook('scope:added', 'validate-multihome-field', {}, ({ context, vars }) => {
        const { scopeName, scopeOptions } = context;

        // Skip excluded resources
        if (vars.multihome.excludeResources.includes(scopeName)) {
          log.debug(`Resource ${scopeName} excluded from multihome validation`);
          return;
        }

        // Check if schema has multihome field
        const schema = scopeOptions.schema;
        if (schema && !schema[vars.multihome.field]) {
          if (vars.multihome.allowMissing) {
            log.warn(`Resource ${scopeName} missing ${vars.multihome.field} field - multihome filtering disabled for this 
  resource`);
          } else {
            throw new Error(
              `Resource '${scopeName}' must have '${vars.multihome.field}' field in schema for multi-tenancy`
            );
          }
        }
      });

      // Main filtering hook - adds WHERE clause to all queries
      addHook('knexQueryFiltering', 'multihome-filter', { beforePlugin: 'rest-api-knex' }, async ({ context, vars }) => {
        // Get query info from context
        const { query, tableName, scopeName } = context.knexQuery;

        // Skip excluded resources first
        if (vars.multihome.excludeResources.includes(scopeName)) {
          log.trace(`Skipping multihome filter for excluded resource: ${scopeName}`);
          return;
        }

        // Skip if no multihome context
        if (!context.auth?.multihome_id) {
          if (vars.multihome.requireAuth) {
            throw new Error('No multihome context available - cannot execute query');
          }
          return;
        }

        // Check if this resource has multihome field
        const scope = scopes[scopeName];
        const hasMultihomeField = scope?.vars?.schemaInfo?.schema?.structure?.[vars.multihome.field];

        if (!hasMultihomeField) {
          if (vars.multihome.allowMissing) {
            log.trace(`Resource ${scopeName} has no ${vars.multihome.field} field - skipping filter`);
            return;
          } else {
            throw new Error(`Resource ${scopeName} missing required ${vars.multihome.field} field`);
          }
        }

        // Add WHERE condition wrapped in function for proper grouping
        query.where(function() {
          this.where(`${tableName}.${vars.multihome.field}`, context.auth.multihome_id);
        });

        log.trace('Added multihome filter', {
          scopeName,
          tableName,
          multihome_id: context.auth.multihome_id
        });
      });

      // Set multihome_id on new records
      addHook('beforeSchemaValidate', 'set-multihome-id', {}, async ({ context, scopeName, vars }) => {
        
        // Skip excluded resources first
        if (vars.multihome.excludeResources.includes(scopeName)) {
          return;
        }

        // Skip if no multihome context
        if (!context.auth?.multihome_id) {
          if (vars.multihome.requireAuth) {
            throw new Error('Cannot create record without multihome context');
          }
          return;
        }

        // Check if this resource has multihome field
        const scope = scopes[scopeName];
        const hasMultihomeField = scope?.vars?.schemaInfo?.schema?.structure?.[vars.multihome.field];

        if (!hasMultihomeField) {
          if (!vars.multihome.allowMissing) {
            throw new Error(`Resource ${scopeName} missing required ${vars.multihome.field} field`);
          }
          return;
        }

        // For POST, always set multihome_id
        if (context.method === 'post') {
          context.inputRecord.data.attributes = context.inputRecord.data.attributes || {};
          context.inputRecord.data.attributes[vars.multihome.field] = context.auth.multihome_id;

          log.debug('Set multihome_id on new record', {
            scopeName,
            multihome_id: context.auth.multihome_id
          });
        }

        // For PUT/PATCH, validate multihome_id if provided
        if ((context.method === 'put' || context.method === 'patch') &&
            context.inputRecord.data.attributes?.[vars.multihome.field]) {

          const providedId = context.inputRecord.data.attributes[vars.multihome.field];
          if (providedId !== context.auth.multihome_id) {
            throw new Error(
              `Cannot set ${vars.multihome.field} to '${providedId}' - must match current context '${context.auth.multihome_id}'`
            );
          }
        }
      });

      // Hook into single record GET queries to add tenant filter
      addHook('knexGetFiltering', 'multihome-get-filter', { beforePlugin: 'rest-api-knex' }, async ({ context, vars }) => {
        // Get scope name from context
        const scopeName = context.scopeName;
        if (!scopeName) return;

        // Skip excluded resources first
        if (vars.multihome.excludeResources.includes(scopeName)) {
          return;
        }

        // Skip if no multihome context
        if (!context.auth?.multihome_id) {
          if (vars.multihome.requireAuth) {
            throw new Error('No multihome context available - cannot access record');
          }
          return;
        }

        // Check if this resource has multihome field
        const scope = scopes[scopeName];
        const hasMultihomeField = scope?.vars?.schemaInfo?.schema?.structure?.[vars.multihome.field];

        if (!hasMultihomeField) {
          return; // Resource doesn't have multihome field
        }

        // Add tenant filter to the query
        context.query = context.query.where(function() {
          this.where(vars.multihome.field, context.auth.multihome_id);
        });

        log.debug('Added multihome filter to GET query', {
          scopeName,
          multihome_id: context.auth.multihome_id
        });
      });

      // Validate cross-tenant relationships before they are saved
      // This is critical for security - we must prevent any cross-tenant relationships
      addHook('beforeSchemaValidate', 'validate-cross-tenant-relationships', { afterPlugin: 'rest-api' }, async ({ context, scopeName, vars }) => {
        // Skip if no multihome context or excluded resource
        if (!context.auth?.multihome_id || vars.multihome.excludeResources.includes(scopeName)) {
          return;
        }

        // Only check on create and update operations with relationships
        if (!context.inputRecord?.data?.relationships) {
          return;
        }

        // Use context.db for database queries (respects transactions)
        const db = context.db || api.knex?.instance;
        if (!db) {
          throw new Error('Cannot access database for cross-tenant security validation');
        }

        // Get the current resource's schema
        const scope = scopes[scopeName];
        const schemaFields = scope?.vars?.schemaInfo?.schema?.structure || {};

        // Get relationships info from the scope
        const relationships = scope?.vars?.schemaInfo?.schemaRelationships || {};

        // Group relationships by resource type for efficient validation
        const relationshipsByResource = {};
        
        // Check each relationship in the input
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          // Skip if no data
          if (!relData?.data) continue;

          // Handle both single and array relationships
          const relatedItems = Array.isArray(relData.data) ? relData.data : [relData.data];
          
          // Find what resource this relationship points to
          let relatedResourceName = null;
          
          // Check schema fields for belongsTo relationships
          const belongsToField = Object.entries(schemaFields).find(([fieldName, fieldDef]) => 
            (fieldDef.as === relName || fieldName.replace('_id', '') === relName) && fieldDef.belongsTo
          );
          
          if (belongsToField) {
            relatedResourceName = belongsToField[1].belongsTo;
          }
          
          // Check for polymorphic belongsTo
          const polymorphicField = Object.entries(schemaFields).find(([fieldName, fieldDef]) => 
            fieldDef.as === relName && fieldDef.belongsToPolymorphic
          );
          
          if (polymorphicField) {
            // For polymorphic relationships, get the type from the data
            const polymorphicTypes = polymorphicField[1].belongsToPolymorphic.types;
            relatedResourceName = relData.data.type;
            if (!polymorphicTypes.includes(relatedResourceName)) {
              throw new Error(`Invalid polymorphic type: ${relatedResourceName}`);
            }
          } else if (relationships[relName]) {
            // Check relationships definition for hasMany/manyToMany
            const relDef = relationships[relName];
            if (relDef.hasMany) {
              relatedResourceName = relDef.hasMany;
            } else if (relDef.manyToMany) {
              relatedResourceName = relDef.manyToMany.related;
            }
          }

          if (!relatedResourceName) {
            log.warn('Could not determine related resource for relationship', { relName, scopeName });
            continue;
          }

          const relatedScope = scopes[relatedResourceName];
          if (!relatedScope) {
            log.warn('Related scope not found', { relatedResourceName });
            continue;
          }

          // Skip if related resource doesn't have multihome field
          if (!relatedScope.vars?.schemaInfo?.schema?.structure?.[vars.multihome.field]) {
            continue;
          }

          // Skip if related resource is excluded
          if (vars.multihome.excludeResources.includes(relatedResourceName)) {
            continue;
          }

          // Group IDs by resource type
          if (!relationshipsByResource[relatedResourceName]) {
            relationshipsByResource[relatedResourceName] = {
              scope: relatedScope,
              ids: [],
              relName
            };
          }
          
          // Collect all IDs for this resource type
          for (const item of relatedItems) {
            relationshipsByResource[relatedResourceName].ids.push(item.id);
          }
        }
        
        // Now validate all relationships with efficient IN queries
        for (const [resourceName, resourceData] of Object.entries(relationshipsByResource)) {
          const { scope: relatedScope, ids, relName } = resourceData;
          const relatedTable = relatedScope.vars.tableName;
          
          // Single query to check all records of this type
          const results = await db(relatedTable)
            .select('id', vars.multihome.field)
            .whereIn('id', ids);
          
          // Create a map for quick lookup
          const resultMap = {};
          for (const row of results) {
            resultMap[row.id] = row[vars.multihome.field];
          }
          
          // Check each ID
          for (const id of ids) {
            if (!resultMap[id]) {
              throw new Error(
                `Cannot link to ${resourceName} '${id}' - resource not found`
              );
            }
            
            if (resultMap[id] !== context.auth.multihome_id) {
              log.error('Cross-tenant relationship attempt blocked', {
                scopeName,
                relatedResource: resourceName,
                relatedId: id,
                expectedTenant: context.auth.multihome_id,
                actualTenant: resultMap[id]
              });
              throw new Error(
                `Cannot link to ${resourceName} '${id}' - belongs to different tenant`
              );
            }
          }
        }
      });

      // Note: PUT, PATCH, and DELETE operations will fail naturally if the record
      // doesn't exist due to tenant filtering in the GET operation that precedes them

      // Add API method to get current multihome context  
      api.multihome = {
        getCurrentTenant: () => {
          // This would need to be called within a request context
          // Real implementation would need access to current request context
          return null;
        },

        // Runtime configuration helper (for debugging/testing)
        getConfig: () => ({
          ...vars.multihome,
          hasCustomExtractor: helpers.extractMultihomeId !== defaultSubdomainExtractor
        })
      };

      log.info('MultiHome plugin installed', {
        field: vars.multihome.field,
        excludedResources: vars.multihome.excludeResources,
        requireAuth: vars.multihome.requireAuth,
        hasCustomExtractor: helpers.extractMultihomeId !== defaultSubdomainExtractor
      });
    }
  };
