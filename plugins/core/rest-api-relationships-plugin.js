import { 
  RestApiResourceError, 
  RestApiValidationError, 
  RestApiPayloadError 
} from '../../lib/rest-api-errors.js';
import { createPivotRecords } from './lib/many-to-many-manipulations.js';

/**
 * Helper function to get relationship definition from either schemaRelationships or schema fields
 */
const findRelationshipDefinition = (schemaInfo, relationshipName) => {
  // First check schemaRelationships (for relationships defined in relationships object)
  const relDef = schemaInfo.schemaRelationships?.[relationshipName];
  if (relDef) {
    return relDef;
  }
  
  // Then check schema fields for belongsTo relationships with matching 'as' property
  for (const [fieldName, fieldDef] of Object.entries(schemaInfo.schemaStructure || {})) {
    if (fieldDef.as === relationshipName && (fieldDef.belongsTo || fieldDef.belongsToPolymorphic)) {
      return fieldDef;
    }
  }
  
  return null;
};

/**
 * Helper function to handle errors in write methods
 */
const handleWriteMethodError = async (error, context, method, scopeName, log) => {
  if (context.shouldCommit && context.transaction) {
    try {
      await context.transaction.rollback();
    } catch (rollbackError) {
      log.error(`Failed to rollback transaction after error in ${method}:`, rollbackError);
    }
  }
  throw error;
};

export const RestApiRelationshipsPlugin = {
  name: 'rest-api-relationships',
  dependencies: ['rest-api', 'rest-api-knex'],
  
  async install({ api, addScopeMethod, helpers, on, log, runHooks, addHook, scopes }) {
    
    // Store api reference for use in scope methods
    const apiRef = api;
    
    /**
     * GET RELATIONSHIP
     * Retrieves relationship linkage data (just resource identifiers)
     * GET /api/articles/1/relationships/author
     * 
     * @param {string} id - The ID of the resource
     * @param {string} relationshipName - The name of the relationship
     * @returns {Promise<object>} Relationship linkage with links
     */
    addScopeMethod('getRelationship', async ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName }) => {
      context.method = 'getRelationship';
      context.id = params.id;
      context.relationshipName = params.relationshipName;
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;

      // Validate the relationship exists
      const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName);

      if (!relDef) {
        throw new RestApiResourceError(
          `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
          { subtype: 'relationship_not_found' }
        );
      }

      // Check permissions
      await runHooks('checkPermissions');
      await runHooks('checkPermissionsGetRelationship');

      // Reuse existing get method with minimal fields
      const fullRecord = await scope.get({
        id: context.id,
        queryParams: {
          include: [context.relationshipName],
          fields: { [scopeName]: vars.idProperty || 'id' }
        },
        transaction: context.transaction,
        simplified: false,
        isTransport: params.isTransport
      });

      if (!fullRecord || !fullRecord.data) {
        throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
      }

      // Extract just the relationship data
      const relationshipData = fullRecord.data.relationships?.[context.relationshipName];

      // Build response with links
      return {
        links: {
          self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/relationships/${context.relationshipName}`,
          related: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}`
        },
        data: relationshipData?.data || (relDef.hasMany || relDef.manyToMany ? [] : null)
      };
    });

    /**
     * GET RELATED
     * Retrieves the actual related resources (full data)
     * GET /api/articles/1/comments
     * 
     * @param {string} id - The ID of the parent resource
     * @param {string} relationshipName - The name of the relationship
     * @param {object} queryParams - Standard query parameters
     * @returns {Promise<object>} Related resources with full data
     */
    addScopeMethod('getRelated', async ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName }) => {
      context.method = 'getRelated';
      context.id = params.id;
      context.relationshipName = params.relationshipName;
      context.queryParams = params.queryParams || {};
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;
      context.transaction = params.transaction;
      context.db = context.transaction || api.knex.instance

      // Validate the relationship exists
      const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName);

      if (!relDef) {
        throw new RestApiResourceError(
          `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
          { subtype: 'relationship_not_found' }
        );
      }

      // Determine target type - relationships are stored as strings
      const targetType = relDef.belongsTo || relDef.hasMany || 
                        relDef.manyToMany || relDef.hasOne;

      if (!targetType || !scopes[targetType]) {
        throw new RestApiResourceError(
          `Related resource type '${targetType}' not found`,
          { subtype: 'related_type_not_found' }
        );
      }

      // Check permissions
      await runHooks('checkPermissions');
      await runHooks('checkPermissionsGetRelated');

      // Verify parent exists
      const exists = await helpers.dataExists({
        scopeName,
        context: { db: context.db, id: context.id, schemaInfo: context.schemaInfo }
      });

      if (!exists) {
        throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
      }

      // Handle to-one relationships (belongsTo and hasOne)
      // For example: GET /api/books/1/country or GET /api/books/1/publisher
      if (relDef.belongsTo || relDef.hasOne) {
        // OPTIMIZATION: Detect if we actually need to make two API calls
        // 
        // The naive approach always makes 2 calls:
        // 1. Get parent with relationship included (fetches FULL related record)
        // 2. Extract just the ID and fetch the same record again with queryParams
        //
        // This optimization checks if there are queryParams that would affect
        // the related resource. If not, we can use the data from the first call.
        const hasRelevantQueryParams = context.queryParams && (
          // Check for includes on the related resource (e.g., ?include=some.nested.relation)
          context.queryParams.include?.length > 0 ||
          // Check for field selection on the related resource (e.g., ?fields[countries]=name,code)
          context.queryParams.fields?.[targetType] ||
          // Note: Filters and sorting don't make sense for a single to-one relationship
          // so we don't check for them
          false
        );

        if (hasRelevantQueryParams) {
          // CASE 1: Has queryParams that affect the related resource
          // We need to make two calls to properly apply the queryParams
          
          // First call: Get parent with minimal data (just need the related ID)
          const parent = await scope.get({
            id: context.id,
            queryParams: { 
              include: [context.relationshipName],
              fields: { [scopeName]: vars.idProperty || 'id' } // Only fetch parent ID to minimize data
            },
            transaction: context.transaction,
            simplified: false,
            isTransport: params.isTransport
          });

          const relatedId = parent.data.relationships?.[context.relationshipName]?.data?.id;
          if (!relatedId) {
            return {
              links: { self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}` },
              data: null
            };
          }

          // Second call: Get the related resource with all queryParams applied
          const related = await apiRef.resources[targetType].get({
            id: relatedId,
            queryParams: context.queryParams,
            transaction: context.transaction,
            simplified: false,
            isTransport: params.isTransport
          });

          return {
            links: { self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}` },
            data: related.data,
            included: related.included
          };
        } else {
          // CASE 2: No queryParams that affect the related resource
          // We can get everything in one call and extract from included
          
          // Single call: Get parent with full related resource included
          const parent = await scope.get({
            id: context.id,
            queryParams: { 
              include: [context.relationshipName],
              fields: context.queryParams.fields // Respect any field selections for the parent
            },
            transaction: context.transaction,
            simplified: false,
            isTransport: params.isTransport
          });

          // Extract the related resource from the parent's relationships
          const relatedId = parent.data.relationships?.[context.relationshipName]?.data?.id;
          if (!relatedId) {
            return {
              links: { self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}` },
              data: null
            };
          }

          // Find the full related resource in the included array
          // The include system already fetched it for us!
          const relatedResource = parent.included?.find(
            r => r.type === targetType && r.id === relatedId
          );

          return {
            links: { self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}` },
            data: relatedResource || null
          };
        }
      }

      // Handle simple hasMany (one-to-many)
      if (relDef.hasMany && !relDef.through) {
        const filters = {
          ...context.queryParams.filters,
          [relDef.foreignKey]: context.id
        };

        const result = await apiRef.resources[targetType].query({
          queryParams: { ...context.queryParams, filters },
          transaction: context.transaction,
          simplified: false,
          isTransport: params.isTransport
        });

        if (!result.links) {
          result.links = {};
        }
        result.links.self = `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}`;
        return result;
      }

      // Handle many-to-many relationships (hasMany with through)
      // For example: GET /api/authors/1/books (where authors and books are linked via book_authors)
      if (relDef.manyToMany || (relDef.hasMany && relDef.through)) {
        // APPROACH: Query the pivot table directly
        //
        // Instead of:
        // 1. Getting parent with relationship included to find related IDs
        // 2. Trying to filter by id:[array] which doesn't work
        //
        // We query the pivot table (e.g., book_authors) filtered by the parent ID
        // and include the target resources. This is simpler and uses existing
        // API functionality without needing special array filter support.
        
        const pivotResource = relDef.through;
        const foreignKey = relDef.foreignKey || `${scopeName.slice(0, -1)}_id`;
        const otherKey = relDef.otherKey || `${targetType.slice(0, -1)}_id`;
        
        // We need to find the relationship name on the pivot table that points to the target
        // The pivot table should have a belongsTo relationship to the target resource
        const pivotScope = scopes[pivotResource];
        if (!pivotScope) {
          throw new RestApiResourceError(
            `Pivot table resource '${pivotResource}' not found`,
            { subtype: 'pivot_table_not_found' }
          );
        }
        
        // Find the relationship name on the pivot table that points to the target
        let targetRelationshipName = null;
        const pivotSchema = pivotScope.vars.schemaInfo.schemaStructure;
        for (const [fieldName, fieldDef] of Object.entries(pivotSchema)) {
          if (fieldDef.belongsTo === targetType && fieldDef.as) {
            targetRelationshipName = fieldDef.as;
            break;
          }
        }
        
        if (!targetRelationshipName) {
          throw new RestApiResourceError(
            `Cannot find relationship to '${targetType}' in pivot table '${pivotResource}'`,
            { subtype: 'pivot_relationship_not_found' }
          );
        }
        
        // Build filters for the pivot table
        const pivotFilters = {
          [foreignKey]: context.id
        };
        
        // Query the pivot table with the target included
        const pivotResult = await apiRef.resources[pivotResource].query({
          queryParams: {
            filters: pivotFilters,
            include: [targetRelationshipName],
            // Pass through other query params that should apply to the included resources
            fields: context.queryParams.fields,
            sort: context.queryParams.sort,
            page: context.queryParams.page
          },
          transaction: context.transaction,
          simplified: false,
          isTransport: params.isTransport
        });
        
        // Extract the included target resources
        const includedResources = pivotResult.included?.filter(r => r.type === targetType) || [];
        
        // Build the response
        return {
          links: {
            self: `${vars.resourceUrlPrefix}/${scopeName}/${context.id}/${context.relationshipName}`
          },
          data: includedResources,
          meta: pivotResult.meta
        };
      }
    });

    /**
     * POST RELATIONSHIP
     * Adds members to a to-many relationship
     * POST /api/articles/1/relationships/tags
     * 
     * @param {string} id - The ID of the resource
     * @param {string} relationshipName - The name of the relationship
     * @param {array} relationshipData - Array of resource identifiers to add
     * @returns {Promise<void>} 204 No Content
     */
    addScopeMethod('postRelationship', async ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName }) => {
      context.method = 'postRelationship';
      context.id = params.id;
      context.relationshipName = params.relationshipName;
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;

      // Transaction handling
      context.transaction = params.transaction || 
        (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
      context.shouldCommit = !params.transaction && !!context.transaction;

      context.db = context.transaction || api.knex.instance
      
      try {
        // Validate
        const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName);
        if (!relDef) {
          throw new RestApiResourceError(
            `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
            { subtype: 'relationship_not_found' }
          );
        }

        if (!relDef.hasMany && !relDef.manyToMany) {
          throw new RestApiValidationError(
            `Cannot POST to to-one relationship '${context.relationshipName}'. Use PATCH instead.`,
            { fields: ['data'] }
          );
        }

        if (!Array.isArray(params.relationshipData)) {
          throw new RestApiPayloadError('POST to relationship requires array of resource identifiers');
        }

        // Check permissions
        await runHooks('checkPermissions');
        await runHooks('checkPermissionsPostRelationship');

        // Verify parent exists
        const exists = await helpers.dataExists({
          scopeName,
          context: { db: context.db, id: context.id, schemaInfo: context.schemaInfo },
        });

        if (!exists) {
          throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
        }

        // Add relationships
        if (relDef.manyToMany || (relDef.hasMany && relDef.through)) {
          const manyToManyDef = relDef.manyToMany || {
            through: relDef.through,
            foreignKey: relDef.foreignKey,
            otherKey: relDef.otherKey
          };
          
          await createPivotRecords(apiRef, context.id, manyToManyDef, params.relationshipData, context.transaction);
        } else {
          // Update foreign keys for hasMany
          const targetType = relDef.hasMany;
          for (const identifier of params.relationshipData) {
            await apiRef.resources[targetType].patch({
              id: identifier.id,
              inputRecord: {
                data: {
                  type: targetType,
                  id: identifier.id,
                  attributes: { [relDef.hasMany.foreignKey]: context.id }
                }
              },
              transaction: context.transaction,
              simplified: false
            });
          }
        }

        await runHooks('finish');
        await runHooks('finishPostRelationship');

        if (context.shouldCommit) {
          await context.transaction.commit();
        }

        return; // 204 No Content

      } catch (error) {
        await handleWriteMethodError(error, context, 'POST_RELATIONSHIP', scopeName, log);
      }
    });

    /**
     * PATCH RELATIONSHIP
     * Completely replaces a relationship
     * PATCH /api/articles/1/relationships/author
     * 
     * @param {string} id - The ID of the resource
     * @param {string} relationshipName - The name of the relationship
     * @param {object|array} relationshipData - New relationship data
     * @returns {Promise<void>} 204 No Content
     */
    addScopeMethod('patchRelationship', async ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName }) => {
      context.method = 'patchRelationship';
      context.id = params.id;
      context.relationshipName = params.relationshipName;

      // Transaction handling
      context.transaction = params.transaction || 
        (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
      context.shouldCommit = !params.transaction && !!context.transaction;
      context.db = context.transaction || api.knex.instance

      try {
        // Check permissions
        await runHooks('checkPermissions');
        await runHooks('checkPermissionsPatchRelationship');

        // Reuse existing patch with relationship data
        await scope.patch({
          id: context.id,
          inputRecord: {
            data: {
              type: scopeName,
              id: context.id,
              relationships: {
                [params.relationshipName]: { data: params.relationshipData }
              }
            }
          },
          transaction: context.transaction,
          simplified: false,
          isTransport: params.isTransport
        });

        await runHooks('finish');
        await runHooks('finishPatchRelationship');

        if (context.shouldCommit) {
          await context.transaction.commit();
        }

        return; // 204 No Content

      } catch (error) {
        await handleWriteMethodError(error, context, 'PATCH_RELATIONSHIP', scopeName, log);
      }
    });

    /**
     * DELETE RELATIONSHIP
     * Removes specific members from a to-many relationship
     * DELETE /api/articles/1/relationships/tags
     * 
     * @param {string} id - The ID of the resource
     * @param {string} relationshipName - The name of the relationship
     * @param {array} relationshipData - Array of resource identifiers to remove
     * @returns {Promise<void>} 204 No Content
     */
    addScopeMethod('deleteRelationship', async ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName }) => {
      context.method = 'deleteRelationship';
      context.id = params.id;
      context.relationshipName = params.relationshipName;
      context.schemaInfo = scopes[scopeName].vars.schemaInfo;

      // Transaction handling
      context.transaction = params.transaction || 
        (helpers.newTransaction && !params.transaction ? await helpers.newTransaction() : null);
      context.shouldCommit = !params.transaction && !!context.transaction;
      context.db = context.transaction || api.knex.instance

      try {
        // Validate
        const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName);
        if (!relDef) {
          throw new RestApiResourceError(
            `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
            { subtype: 'relationship_not_found' }
          );
        }

        if (!relDef.hasMany && !relDef.manyToMany) {
          throw new RestApiValidationError(
            `Cannot DELETE from to-one relationship '${context.relationshipName}'`,
            { fields: ['data'] }
          );
        }

        if (!Array.isArray(params.relationshipData)) {
          throw new RestApiPayloadError('DELETE from relationship requires array of resource identifiers');
        }

        // Check permissions
        await runHooks('checkPermissions');
        await runHooks('checkPermissionsDeleteRelationship');

        // Verify parent exists
        const exists = await helpers.dataExists({
          scopeName,
          context: {  db: context.db, id: context.id, schemaInfo: context.schemaInfo }
        });

        if (!exists) {
          throw new RestApiResourceError('Resource not found', { subtype: 'not_found' });
        }

        // Remove relationships
        if (relDef.manyToMany || (relDef.hasMany && relDef.through)) {
          const manyToManyDef = relDef.manyToMany || {
            through: relDef.through,
            foreignKey: relDef.foreignKey,
            otherKey: relDef.otherKey
          };

          const knex = apiRef.knex?.instance || helpers.db;
          const pivotResource = manyToManyDef.through;
          const pivotScope = apiRef.resources[pivotResource];
          const pivotTable = pivotScope?.vars?.schemaInfo?.tableName || pivotResource;
          const localKey = manyToManyDef.foreignKey;
          const foreignKey = manyToManyDef.otherKey;

          for (const identifier of params.relationshipData) {
            await knex(pivotTable)
              .where(localKey, context.id)
              .where(foreignKey, identifier.id)
              .delete()
              .transacting(context.transaction);
          }
        } else {
          // Null out foreign keys for hasMany
          const targetType = relDef.hasMany;
          for (const identifier of params.relationshipData) {
            await apiRef.resources[targetType].patch({
              id: identifier.id,
              inputRecord: {
                data: {
                  type: targetType,
                  id: identifier.id,
                  attributes: { [relDef.hasMany.foreignKey]: null }
                }
              },
              transaction: context.transaction,
              simplified: false
            });
          }
        }

        await runHooks('finish');
        await runHooks('finishDeleteRelationship');

        if (context.shouldCommit) {
          await context.transaction.commit();
        }

        return; // 204 No Content

      } catch (error) {
        await handleWriteMethodError(error, context, 'DELETE_RELATIONSHIP', scopeName, log);
      }
    });

    // Listen for scope additions to register relationship routes
    addHook('scope:added', 'registerRelationshipRoutes', {}, async ({ context }) => {
      const { scopeName } = context;
      const basePath = api.scopes[scopeName].vars.resourceUrlPrefix || '';
      const scopePath = `${basePath}/${scopeName}`;

      // Helper to create route handlers
      const createRouteHandler = (methodName) => {
        return async ({ params, body, queryString }) => {
          const scope = api.scopes[scopeName];
          
          const methodParams = {
            id: params.id,
            relationshipName: params.relationshipName,
            isTransport: true
          };

          // Add query params for getRelated
          if (methodName === 'getRelated' && queryString) {
            const { parseJsonApiQuery } = await import('./utils/connectors-query-parser.js');
            methodParams.queryParams = parseJsonApiQuery(queryString);
          }

          // Add body data for write operations
          if (body && body.data !== undefined) {
            methodParams.relationshipData = body.data;
          }

          return await scope[methodName](methodParams);
        };
      };

      // Register relationship routes
      
      // GET /api/{scope}/{id}/relationships/{relationshipName}
      await api.addRoute({
        method: 'GET',
        path: `${scopePath}/:id/relationships/:relationshipName`,
        handler: createRouteHandler('getRelationship')
      });

      // GET /api/{scope}/{id}/{relationshipName}
      await api.addRoute({
        method: 'GET',
        path: `${scopePath}/:id/:relationshipName`,
        handler: createRouteHandler('getRelated')
      });

      // POST /api/{scope}/{id}/relationships/{relationshipName}
      await api.addRoute({
        method: 'POST',
        path: `${scopePath}/:id/relationships/:relationshipName`,
        handler: createRouteHandler('postRelationship')
      });

      // PATCH /api/{scope}/{id}/relationships/{relationshipName}
      await api.addRoute({
        method: 'PATCH',
        path: `${scopePath}/:id/relationships/:relationshipName`,
        handler: createRouteHandler('patchRelationship')
      });

      // DELETE /api/{scope}/{id}/relationships/{relationshipName}
      await api.addRoute({
        method: 'DELETE',
        path: `${scopePath}/:id/relationships/:relationshipName`,
        handler: createRouteHandler('deleteRelationship')
      });

      log.trace(`Registered relationship routes for scope: ${scopeName}`);
    });
  }
};