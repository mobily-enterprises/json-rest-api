import { RestApiValidationError, RestApiResourceError } from '../../lib/rest-api-errors.js';

export const BulkOperationsPlugin = {
  name: 'bulk-operations',
  dependencies: ['rest-api'],

  async install({ api, log, addHook, addScopeMethod, helpers, pluginOptions }) {
    const bulkOptions = pluginOptions || {};
    const {
      maxBulkOperations = 100,
      defaultAtomic = true,
      batchSize = 100,
      enableOptimizations = true
    } = bulkOptions;

    log.info('Installing Bulk Operations plugin', { maxBulkOperations, defaultAtomic });

    // Add bulk methods to each scope
    addScopeMethod('bulkPost', async ({ scope, scopeName, params, context, runHooks }) => {
      const { inputRecords, atomic = defaultAtomic } = params;
      
      // Validate bulk size
      if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
        throw new RestApiValidationError('Bulk operations require an array of records', {
          fields: ['data'],
          violations: [{ field: 'data', rule: 'required_array', message: 'Must be a non-empty array' }]
        });
      }

      if (inputRecords.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} records`, {
          fields: ['data'],
          violations: [{ 
            field: 'data', 
            rule: 'max_items', 
            message: `Cannot process more than ${maxBulkOperations} records at once` 
          }]
        });
      }

      const results = [];
      const errors = [];
      let transaction = null;

      try {
        // Start transaction if atomic mode
        if (atomic && helpers.newTransaction) {
          transaction = await helpers.newTransaction();
        }

        // Process records in batches
        for (let i = 0; i < inputRecords.length; i += batchSize) {
          const batch = inputRecords.slice(i, i + batchSize);
          
          for (let j = 0; j < batch.length; j++) {
            const recordIndex = i + j;
            const inputRecord = batch[j];
            
            try {
              // Create individual context for each record
              const recordContext = { 
                ...context,
                bulkOperation: true,
                bulkIndex: recordIndex
              };

              // Use the existing post method with transaction
              const result = await scope.post({
                inputRecord: inputRecord.data ? inputRecord : { data: inputRecord },
                transaction
              }, recordContext);

              results.push({
                index: recordIndex,
                status: 'success',
                data: result.data
              });
            } catch (error) {
              if (atomic) {
                // In atomic mode, rollback and throw
                if (transaction) await transaction.rollback();
                throw error;
              } else {
                // In non-atomic mode, collect errors
                errors.push({
                  index: recordIndex,
                  status: 'error',
                  error: {
                    code: error.code || 'UNKNOWN_ERROR',
                    message: error.message,
                    details: error.details
                  }
                });
              }
            }
          }
        }

        // Commit transaction if atomic
        if (transaction) {
          await transaction.commit();
        }

        // Build response
        return {
          data: results.filter(r => r.status === 'success').map(r => r.data),
          errors: errors.length > 0 ? errors : undefined,
          meta: {
            total: inputRecords.length,
            succeeded: results.length,
            failed: errors.length,
            atomic
          }
        };

      } catch (error) {
        // Ensure rollback on error
        if (transaction && !transaction.isCompleted()) {
          await transaction.rollback();
        }
        throw error;
      }
    });

    addScopeMethod('bulkPatch', async ({ scope, scopeName, params, context, runHooks }) => {
      const { operations, atomic = defaultAtomic } = params;
      
      // Validate operations
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new RestApiValidationError('Bulk patch requires an array of operations', {
          fields: ['operations'],
          violations: [{ field: 'operations', rule: 'required_array', message: 'Must be a non-empty array' }]
        });
      }

      if (operations.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} operations`, {
          fields: ['operations'],
          violations: [{ 
            field: 'operations', 
            rule: 'max_items', 
            message: `Cannot process more than ${maxBulkOperations} operations at once` 
          }]
        });
      }

      const results = [];
      const errors = [];
      let transaction = null;

      try {
        if (atomic && helpers.newTransaction) {
          transaction = await helpers.newTransaction();
        }

        for (let i = 0; i < operations.length; i++) {
          const operation = operations[i];
          
          // Validate operation structure
          if (!operation.id || !operation.data) {
            errors.push({
              index: i,
              status: 'error',
              error: {
                code: 'INVALID_OPERATION',
                message: 'Operation must include id and data',
                details: { operation }
              }
            });
            if (atomic) {
              if (transaction) await transaction.rollback();
              throw new RestApiValidationError('Invalid operation structure', {
                fields: [`operations[${i}]`],
                violations: [{ 
                  field: `operations[${i}]`, 
                  rule: 'required_fields', 
                  message: 'Operation must include id and data' 
                }]
              });
            }
            continue;
          }

          try {
            const recordContext = { 
              ...context,
              bulkOperation: true,
              bulkIndex: i
            };

            const result = await scope.patch({
              id: operation.id,
              inputRecord: { data: operation.data },
              transaction
            }, recordContext);

            // If patch doesn't return full record, fetch it
            let resultData = result.data;
            if (!resultData && result.id) {
              const fetchedRecord = await scope.get({
                id: result.id,
                transaction
              }, recordContext);
              resultData = fetchedRecord.data;
            }

            results.push({
              index: i,
              id: operation.id,
              status: 'success',
              data: resultData
            });
          } catch (error) {
            if (atomic) {
              if (transaction) await transaction.rollback();
              throw error;
            } else {
              errors.push({
                index: i,
                id: operation.id,
                status: 'error',
                error: {
                  code: error.code || 'UNKNOWN_ERROR',
                  message: error.message,
                  details: error.details
                }
              });
            }
          }
        }

        if (transaction) {
          await transaction.commit();
        }

        return {
          data: results.filter(r => r.status === 'success').map(r => r.data),
          errors: errors.length > 0 ? errors : undefined,
          meta: {
            total: operations.length,
            succeeded: results.length,
            failed: errors.length,
            atomic
          }
        };

      } catch (error) {
        if (transaction && !transaction.isCompleted()) {
          await transaction.rollback();
        }
        throw error;
      }
    });

    addScopeMethod('bulkDelete', async ({ scope, scopeName, params, context, runHooks }) => {
      const { ids, atomic = defaultAtomic } = params;
      
      // Validate IDs
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new RestApiValidationError('Bulk delete requires an array of IDs', {
          fields: ['ids'],
          violations: [{ field: 'ids', rule: 'required_array', message: 'Must be a non-empty array' }]
        });
      }

      if (ids.length > maxBulkOperations) {
        throw new RestApiValidationError(`Bulk operations limited to ${maxBulkOperations} IDs`, {
          fields: ['ids'],
          violations: [{ 
            field: 'ids', 
            rule: 'max_items', 
            message: `Cannot process more than ${maxBulkOperations} IDs at once` 
          }]
        });
      }

      const results = [];
      const errors = [];
      let transaction = null;

      try {
        if (atomic && helpers.newTransaction) {
          transaction = await helpers.newTransaction();
        }

        // Process deletes
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          
          try {
            const recordContext = { 
              ...context,
              bulkOperation: true,
              bulkIndex: i
            };

            await scope.delete({
              id,
              transaction
            }, recordContext);

            results.push({
              index: i,
              id,
              status: 'success'
            });
          } catch (error) {
            if (atomic) {
              if (transaction) await transaction.rollback();
              throw error;
            } else {
              errors.push({
                index: i,
                id,
                status: 'error',
                error: {
                  code: error.code || 'UNKNOWN_ERROR',
                  message: error.message,
                  details: error.details
                }
              });
            }
          }
        }

        if (transaction) {
          await transaction.commit();
        }

        return {
          meta: {
            total: ids.length,
            succeeded: results.length,
            failed: errors.length,
            deleted: results.filter(r => r.status === 'success').map(r => r.id),
            atomic
          },
          errors: errors.length > 0 ? errors : undefined
        };

      } catch (error) {
        if (transaction && !transaction.isCompleted()) {
          await transaction.rollback();
        }
        throw error;
      }
    });

    // Hook into scope creation to add bulk routes
    addHook('afterAddScope', 'bulkOperationsRoutes', {}, async ({ scopeName }) => {
      const urlPrefix = api.vars.transport?.mountPath || '';
      const scopePath = `${urlPrefix}/${scopeName}`;

      // Create route handlers
      const createBulkRouteHandler = (method) => {
        return async ({ context, body, query }) => {
          try {
            // Parse query params for atomic mode override
            const atomic = query?.atomic !== undefined 
              ? query.atomic === 'true' 
              : defaultAtomic;

            let params;
            if (method === 'bulkPost') {
              // For bulk create, expect array in data field (JSON:API style)
              params = {
                inputRecords: body?.data || body,
                atomic
              };
            } else if (method === 'bulkPatch') {
              // For bulk update, expect operations array
              params = {
                operations: body?.operations || body,
                atomic
              };
            } else if (method === 'bulkDelete') {
              // For bulk delete, expect IDs array
              params = {
                ids: body?.data || body?.ids || body,
                atomic
              };
            }

            // Call the scope method
            const result = await api.scopes[scopeName][method](params);
            
            return result;
          } catch (error) {
            // Let transport plugin handle error mapping
            throw error;
          }
        };
      };

      // Register bulk routes
      await api.addRoute({
        method: 'POST',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkPost')
      });

      await api.addRoute({
        method: 'PATCH',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkPatch')
      });

      await api.addRoute({
        method: 'DELETE',
        path: `${scopePath}/bulk`,
        handler: createBulkRouteHandler('bulkDelete')
      });

      log.debug(`Added bulk operation routes for scope: ${scopeName}`);
    });

    // Add optimized bulk insert for Knex if available
    if (enableOptimizations) {
      addHook('beforeBulkPost', 'optimizedBulkInsert', {}, async ({ scope, params, context }) => {
        // Check if we can use optimized path
        if (params.atomic && api.knex?.instance && context.bulkOperation === undefined) {
          // This is the main bulk operation, not individual records
          const { inputRecords } = params;
          
          // Transform records for direct insertion
          const recordsToInsert = [];
          for (const inputRecord of inputRecords) {
            // Run validation
            const validated = await scope.validateInput({ 
              inputRecord, 
              operation: 'create' 
            });
            
            // Transform to database format
            const dbRecord = await scope.transformForDatabase({ 
              record: validated,
              operation: 'create'
            });
            
            recordsToInsert.push(dbRecord);
          }

          // Perform bulk insert
          const knex = api.knex.instance;
          const tableName = scope.vars.schemaInfo.tableName;
          
          try {
            const inserted = await knex(tableName)
              .insert(recordsToInsert)
              .returning('*');
            
            // Transform back to API format
            const results = [];
            for (const record of inserted) {
              const apiRecord = await scope.transformFromDatabase({ record });
              results.push(apiRecord);
            }

            // Return optimized result
            return {
              data: results,
              meta: {
                total: inputRecords.length,
                succeeded: results.length,
                failed: 0,
                atomic: true,
                optimized: true
              },
              skipDefault: true // Tell the default handler to skip
            };
          } catch (error) {
            // Fall back to default handling
            log.warn('Optimized bulk insert failed, falling back to default', { error: error.message });
          }
        }
      });
    }

    log.info('Bulk Operations plugin installed successfully');
  }
};