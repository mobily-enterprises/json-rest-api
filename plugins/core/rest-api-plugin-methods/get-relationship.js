
import { RestApiResourceError } from "../../../lib/rest-api-errors.js";
import { findRelationshipDefinition } from "./common.js";
import { buildRelationshipUrl } from "../lib/querying/url-helpers.js";

/**
 * GET RELATIONSHIP
 * Retrieves relationship linkage data (just resource identifiers)
 * GET /api/articles/1/relationships/author
 * 
 * @param {string} id - The ID of the resource
 * @param {string} relationshipName - The name of the relationship
 * @returns {Promise<object>} Relationship linkage with links
 */
export default async function getRelationshipMethod ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName, api }) {
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
      self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, true),
      related: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false)
    },
    data: relationshipData?.data || (relDef.hasMany || relDef.manyToMany ? [] : null)
  };
};

