export const MultiHomePlugin = {
    name: 'multihome',
    dependencies: ['rest-api'],

    install({ api, addHook, vars, helpers, log, scopes, pluginOptions }) {

      if (!api.knex?.instance) {
        throw new Error('Multihome plugin requires a storage plugin with knex support (rest-api-knex or rest-api-youapi-knex)');
      }

      // Get configuration - hooked-api namespaces options by plugin name
      const multihomeOptions = pluginOptions || {};

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
      log.debug('Registering multihome filter hook');
      addHook('knexQueryFiltering', 'multihome-filter', {}, async ({ context, vars }) => {
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

      log.debug('Applying multihome tenant filter', {
        scopeName,
        tableName,
        tenant: context.auth.multihome_id,
      });

      // Check if this resource has multihome field
        const scope = scopes[scopeName];
        const hasMultihomeField = scope?.vars?.schemaInfo?.schemaStructure?.[vars.multihome.field];

        if (!hasMultihomeField) {
          if (vars.multihome.allowMissing) {
            log.trace(`Resource ${scopeName} has no ${vars.multihome.field} field - skipping filter`);
            return;
          } else {
            throw new Error(`Resource ${scopeName} missing required ${vars.multihome.field} field`);
          }
        }

      const adapter = context.knexQuery?.adapter;
      const columnRef = adapter
        ? adapter.translateColumn(`${tableName}.${vars.multihome.field}`)
        : `${tableName}.${vars.multihome.field}`;

      if (adapter) {
        query.whereRaw(`${columnRef} = ?`, [context.auth.multihome_id]);
      } else {
        query.where(function() {
          this.where(columnRef, context.auth.multihome_id);
        });
      }

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
        const hasMultihomeField = scope?.vars?.schemaInfo?.schemaStructure?.[vars.multihome.field];

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

      // Add checkPermissions hook to enforce tenant isolation
      // This is the single source of truth for single-record access control
      addHook('checkPermissions', 'multihome-check-permissions', {}, async ({ context, scopeName }) => {
        // Extract the needed values from originalContext
        const auth = context.originalContext?.auth;
        const minimalRecord = context.originalContext?.minimalRecord;
        const id = context.originalContext?.id;

        // Skip excluded resources
        if (vars.multihome.excludeResources.includes(scopeName)) {
          return;
        }

        // Skip if no multihome context
        if (!auth?.multihome_id) {
          if (vars.multihome.requireAuth) {
            throw new Error('No multihome context available');
          }
          return;
        }

        // Get the scope to check if it has multihome field
        const scope = scopes[scopeName];
        const hasMultihomeField = scope?.vars?.schemaInfo?.schemaStructure?.[vars.multihome.field];

        if (!hasMultihomeField) {
          return; // Resource doesn't support multihome
        }

        // For operations on existing records, verify tenant ownership
        if (minimalRecord) {
          // minimalRecord is in JSON:API format, so tenant_id is in attributes
          const recordTenant = minimalRecord.attributes?.[vars.multihome.field];
          const userTenant = auth.multihome_id;

          if (recordTenant !== userTenant) {
            log.error('Multihome permission violation', {
              scopeName,
              recordId: id,
              recordTenant: recordTenant,
              userTenant: userTenant,
              method: context.method
            });

            // Return 404 for GET to prevent information leakage
            // Return 403 for other operations
            if (context.method === 'get') {
              const error = new Error('Resource not found');
              error.code = 'REST_API_RESOURCE';
              throw error;
            } else {
              const error = new Error('Access denied - insufficient permissions');
              error.code = 'REST_API_FORBIDDEN';
              throw error;
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
