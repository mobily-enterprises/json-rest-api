import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { findRelationshipDefinition } from '../lib/querying-writing/relationship-contracts.js'
import { buildRelationshipUrl } from '../lib/querying/url-helpers.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'

/**
 * Read authorized relationship linkage for params.id/relationshipName.
 * This returns a JSON:API linkage document regardless of resource format;
 * to-many linkage must not be truncated by ordinary include limits.
 */
export default async function getRelationshipMethod ({ params, context, vars, scope, scopes, runHooks, scopeOptions, scopeName, api }) {
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  context.method = 'getRelationship'
  context.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  context.relationshipName = params.relationshipName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  // Validate the relationship exists
  const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName)

  if (!relDef) {
    throw new RestApiResourceError(
      `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
      { subtype: 'relationship_not_found' }
    )
  }

  // Check permissions
  await runHooks('checkPermissions')
  await runHooks('checkPermissionsGetRelationship')

  // Keep parent attributes available to its GET permission hooks.
  const fullRecord = await scope.get({
    id: context.id,
    queryParams: {
      // To-many linkage is loaded independently; include limits must not truncate it.
      include: relDef.type === 'hasMany' || relDef.type === 'manyToMany' ? [] : [context.relationshipName]
    },
    transaction: context.transaction,
    format: 'jsonapi',
  }, { ...context })

  if (!fullRecord || !fullRecord.data) {
    throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
  }

  // Extract just the relationship data
  const relationshipData = fullRecord.data.relationships?.[context.relationshipName]

  // Build response with links
  return {
    links: {
      self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, true),
      related: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false)
    },
    data: relationshipData?.data || (relDef.type === 'hasMany' || relDef.type === 'manyToMany' ? [] : null)
  }
};
