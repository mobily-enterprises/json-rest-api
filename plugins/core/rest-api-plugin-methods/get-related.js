import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { getVisibleRelationshipParent, validateRequestedIncludes } from './common.js'
import { findRelationshipDefinition } from '../lib/querying-writing/relationship-contracts.js'
import { buildRelationshipUrl, buildJsonApiLink } from '../lib/querying/url-helpers.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { queryConstraint } from '../lib/querying/query-constraint.js'

/**
 * Build a JSON:API document for the authorized related resource or collection.
 * The outer getRelated method selects the caller-facing representation.
 * Parent identity, relationship name and query controls come from params.
 */
async function getRelatedDocument ({ params, context, vars, helpers, scope, scopes, runHooks, scopeOptions, scopeName, api }) {
  context.method = 'getRelated'
  context.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  context.relationshipName = params.relationshipName
  context.queryParams = params.queryParams || {}
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

  await runHooks('checkPermissions')
  await runHooks('checkPermissionsGetRelated')
  const parentRecord = await getVisibleRelationshipParent({ context, helpers, scopeName, runHooks })
  if (!parentRecord) {
    throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
  }

  if (relDef.belongsTo || relDef.belongsToPolymorphic || relDef.type === 'hasOne') {
    const types = relDef.belongsToPolymorphic?.types || [relDef.belongsTo || relDef.target]
    validateRequestedIncludes({ ...context, scopeName: types.length === 1 ? types[0] : scopeName }, scopes, types)
  }

  // A polymorphic target is determined by the visible parent record.
  let targetType
  if (relDef.type === 'hasMany' || relDef.type === 'hasOne') {
    targetType = relDef.target
  } else if (relDef.type === 'manyToMany') {
    targetType = relDef.target || context.relationshipName
  } else if (relDef.belongsTo) {
    targetType = relDef.belongsTo // belongsTo still in schema
  } else if (relDef.belongsToPolymorphic) {
    targetType = parentRecord.relationships?.[context.relationshipName]?.data?.type
    if (!targetType) {
      return {
        links: { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) },
        data: null
      }
    }
  }

  if (!targetType || !scopes[targetType]) {
    throw new RestApiResourceError(
      `Related resource type '${targetType}' not found`,
      { subtype: 'related_type_not_found' }
    )
  }

  if (relDef.belongsTo || relDef.belongsToPolymorphic || relDef.type === 'hasOne') {
    // Resolve visible linkage, then use the target GET lifecycle for every selection.
    const parent = await scope.get({
      id: context.id,
      queryParams: {
        include: [context.relationshipName],
        fields: targetType === scopeName ? {} : { [targetType]: 'id' }
      },
      transaction: context.transaction,
      format: 'jsonapi'
    }, { ...context })

    const relatedId = parent.data.relationships?.[context.relationshipName]?.data?.id
    const links = { self: buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false) }
    if (relatedId == null) return { links, data: null }

    const related = await api.resources[targetType].get({
      id: relatedId,
      queryParams: context.queryParams,
      transaction: context.transaction,
      format: 'jsonapi'
    }, { ...context })

    return { links, data: related.data, ...(related.included ? { included: related.included } : {}) }
  }

  let constraint
  if (relDef.type === 'hasMany') {
    let values
    if (relDef.via) {
      const targetRelationships = scopes[targetType].vars.schemaInfo.schemaRelationships
      const viaRel = targetRelationships?.[relDef.via]
      if (!viaRel?.belongsToPolymorphic) {
        throw new RestApiResourceError(
          `Via relationship '${relDef.via}' not found or not polymorphic in '${targetType}'`,
          { subtype: 'invalid_via_relationship' }
        )
      }
      const { typeField, idField } = viaRel.belongsToPolymorphic
      values = { [typeField]: scopeName, [idField]: context.id }
    } else {
      values = { [relDef.foreignKey]: context.id }
    }
    constraint = { scopeName: targetType, values }
  } else if (relDef.type === 'manyToMany') {
    const { query } = await helpers.dataRelatedIdsQuery({ context, scopeName, relDef })
    constraint = { scopeName: targetType, idsQuery: query }
  }

  const result = await api.resources[targetType].query({
    queryParams: { ...context.queryParams },
    transaction: context.transaction,
    format: 'jsonapi',
    [queryConstraint]: constraint
  }, { ...context })

  const relatedUrl = buildRelationshipUrl(context, scope, scopeName, context.id, context.relationshipName, false)
  result.links ||= { self: relatedUrl }
  for (const name of ['self', 'first', 'last', 'prev', 'next']) {
    const link = result.links[name]
    if (typeof link !== 'string') continue
    const queryIndex = link.indexOf('?')
    result.links[name] = relatedUrl + (queryIndex === -1 ? '' : link.slice(queryIndex))
  }
  return result
}

export default async function getRelatedMethod (args) {
  const { params, vars, scopes } = args
  rejectRemovedOptions(params)
  const format = resolveFormat(params.format, vars.format)
  const record = await getRelatedDocument(args)
  if (params.queryParams?.include != null) record.included ||= []
  if (!Array.isArray(record.data)) record.links.self = buildJsonApiLink(record.links.self, args.context.queryParams)
  if (format === 'jsonapi') return record
  if (record.data === null) return null
  const type = Array.isArray(record.data) ? record.data[0]?.type : record.data.type
  const schemaInfo = scopes[type]?.vars.schemaInfo
  return transformJsonApiToSimplified({ record }, {
    context: { schemaStructure: schemaInfo?.schemaStructure, schemaRelationships: schemaInfo?.schemaRelationships, scopes }
  })
}
