import { RestApiResourceError } from "../../../lib/rest-api-errors.js";
import { findRelationshipDefinition } from "./common.js";
import { buildRelationshipUrl } from "../lib/querying/url-helpers.js";

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

  // Determine target type based on relationship type
  let targetType;
  if (relDef.type === 'hasMany' || relDef.type === 'hasOne') {
    targetType = relDef.target;
  } else if (relDef.type === 'manyToMany') {
    targetType = context.relationshipName; // For manyToMany, use the relationship name
  } else if (relDef.belongsTo) {
    targetType = relDef.belongsTo; // belongsTo still in schema
  }

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
  if (relDef.belongsTo || relDef.type === 'hasOne') {
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
          links: { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) },
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
        links: { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) },
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
          links: { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) },
          data: null
        };
      }

      // Find the full related resource in the included array
      // The include system already fetched it for us!
      const relatedResource = parent.included?.find(
        r => r.type === targetType && r.id === relatedId
      );

      return {
        links: { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) },
        data: relatedResource || null
      };
    }
  }

  // Handle simple hasMany (one-to-many, NOT many-to-many)
  if (relDef.type === 'hasMany') {
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
      result.links.self = buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false);
      return result;
    } else {
      // Regular hasMany with foreignKey
      // Need to find the relationship name in the target resource that points back to this resource
      const targetSchema = scopes[targetType].vars.schemaInfo.schemaStructure;
      let relationshipFilterName = null;
      
      // Find the field in target schema that has the foreign key and get its relationship name
      for (const [fieldName, fieldDef] of Object.entries(targetSchema)) {
        if (fieldName === relDef.foreignKey && fieldDef.belongsTo === scopeName && fieldDef.as) {
          relationshipFilterName = fieldDef.as;
          break;
        }
      }
      
      // Fall back to foreign key if no relationship name found (shouldn't happen with proper schema)
      const filterKey = relationshipFilterName || relDef.foreignKey;
      
      const filters = {
        ...context.queryParams.filters,
        [filterKey]: context.id
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
      result.links.self = buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false);
      return result;
    }
  }

  // Handle many-to-many relationships
  // For example: GET /api/authors/1/books (where authors and books are linked via book_authors)
  if (relDef?.through) {
    if (api.youapi?.links?.listMany) {
      const identifiers = await api.youapi.links.listMany({
        context,
        scopeName,
        relName: context.relationshipName,
      });

      const results = [];
      for (const identifier of identifiers) {
        const related = await api.resources[targetType].get({
          id: identifier.id,
          queryParams: context.queryParams,
          transaction: context.transaction,
          simplified: false,
          isTransport: params.isTransport,
        });
        if (related?.data) {
          results.push(related.data);
        }
      }

      return {
        links: {
          self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false)
        },
        data: results,
      };
    }

    // Legacy fallback
    const pivotResource = relDef.through;
    const foreignKey = relDef.foreignKey;
    const otherKey = relDef.otherKey;
    if (!foreignKey || !otherKey) {
      throw new Error(`Missing foreignKey or otherKey in many-to-many relationship`);
    }
    const pivotScope = scopes[pivotResource];
    if (!pivotScope) {
      throw new RestApiResourceError(
        `Pivot table resource '${pivotResource}' not found`,
        { subtype: 'pivot_table_not_found' }
      );
    }
    const pivotSchema = pivotScope.vars.schemaInfo.schemaStructure;
    let parentRelationshipName = null;
    for (const [fieldName, fieldDef] of Object.entries(pivotSchema)) {
      if (fieldName === foreignKey && fieldDef.belongsTo === scopeName && fieldDef.as) {
        parentRelationshipName = fieldDef.as;
        break;
      }
    }
    const filterKey = parentRelationshipName || foreignKey;
    const pivotFilters = {
      [filterKey]: context.id
    };
    const pivotResult = await api.resources[pivotResource].query({
      queryParams: {
        filters: pivotFilters,
        include: [context.relationshipName],
        fields: context.queryParams.fields,
        sort: context.queryParams.sort,
        page: context.queryParams.page
      },
      transaction: context.transaction,
      simplified: false,
      isTransport: params.isTransport
    });
    let includedResources = pivotResult.included?.filter((r) => r.type === targetType) || [];

    if (includedResources.length === 0) {
      const pivotData = pivotResult.data || [];
      const relatedIds = [...new Set(pivotData
        .map((item) => {
          const attrId = item?.attributes?.[otherKey];
          if (attrId !== null && attrId !== undefined) {
            return String(attrId);
          }
          const relationships = item?.relationships || {};
          for (const rel of Object.values(relationships)) {
            const data = rel?.data;
            if (data?.type === targetType && data?.id != null) {
              return String(data.id);
            }
          }
          return null;
        })
        .filter((id) => id !== null)
      )];

      if (relatedIds.length > 0) {
        includedResources = [];
        for (const relatedId of relatedIds) {
          const related = await api.resources[targetType].get({
            id: relatedId,
            queryParams: context.queryParams,
            transaction: context.transaction,
            simplified: false,
            isTransport: params.isTransport,
          });
          if (related?.data) {
            includedResources.push(related.data);
          }
        }
      }
    }

    return {
      links: {
        self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false)
      },
      data: includedResources,
      meta: pivotResult.meta
    };
  }
}
