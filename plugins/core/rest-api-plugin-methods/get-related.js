import { RestApiResourceError } from "../../../lib/rest-api-errors.js";
import { findRelationshipDefinition } from "./common.js";

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
export default async function getRelatedMethod ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName, api })  {
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
          links: { self: `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}` },
          data: null
        };
      }

      // Second call: Get the related resource with all queryParams applied
      const related = await api.resources[targetType].get({
        id: relatedId,
        queryParams: context.queryParams,
        transaction: context.transaction,
        simplified: false,
        isTransport: params.isTransport
      });

      return {
        links: { self: `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}` },
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
          links: { self: `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}` },
          data: null
        };
      }

      // Find the full related resource in the included array
      // The include system already fetched it for us!
      const relatedResource = parent.included?.find(
        r => r.type === targetType && r.id === relatedId
      );

      return {
        links: { self: `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}` },
        data: relatedResource || null
      };
    }
  }

  // Handle simple hasMany (one-to-many)
  if (relDef.hasMany && !relDef.through) {
    // Check if this is a polymorphic relationship using 'via'
    if (relDef.via) {
      // Polymorphic hasMany relationship
      // Example: publishers hasMany reviews via reviewable
      const targetRelationships = scopes[targetType].vars.schemaInfo.schemaRelationships;
      const viaRel = targetRelationships?.[relDef.via];
      
      if (!viaRel?.belongsToPolymorphic) {
        throw new RestApiResourceError(
          `Via relationship '${relDef.via}' not found or not polymorphic in '${targetType}'`,
          { subtype: 'invalid_via_relationship' }
        );
      }
      
      const { typeField, idField } = viaRel.belongsToPolymorphic;
      
      // Add polymorphic filters
      const filters = {
        ...context.queryParams.filters,
        [typeField]: scopeName,
        [idField]: context.id
      };
      
      const result = await api.resources[targetType].query({
        queryParams: { ...context.queryParams, filters },
        transaction: context.transaction,
        simplified: false,
        isTransport: params.isTransport
      });
      
      if (!result.links) {
        result.links = {};
      }
      result.links.self = `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}`;
      return result;
    } else {
      // Regular hasMany with foreignKey
      const filters = {
        ...context.queryParams.filters,
        [relDef.foreignKey]: context.id
      };

      const result = await api.resources[targetType].query({
        queryParams: { ...context.queryParams, filters },
        transaction: context.transaction,
        simplified: false,
        isTransport: params.isTransport
      });

      if (!result.links) {
        result.links = {};
      }
      result.links.self = `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}`;
      return result;
    }
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
    const foreignKey = relDef.foreignKey;
    const otherKey = relDef.otherKey;
    
    // These should already be validated by scope-validations.js
    if (!foreignKey || !otherKey) {
      throw new Error(`Missing foreignKey or otherKey in many-to-many relationship`);
    }
    
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
    const pivotResult = await api.resources[pivotResource].query({
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
        self: `${vars.returnBasePath || vars.transport?.mountPath || ''}/${scopeName}/${context.id}/${context.relationshipName}`
      },
      data: includedResources,
      meta: pivotResult.meta
    };
  }
}