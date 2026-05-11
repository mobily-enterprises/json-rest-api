import { getRequestContracts } from '../../lib/querying-writing/request-contracts.js'

export function buildTransportRouteSchema ({ routeMeta, api }) {
  if (!routeMeta) {
    return null
  }

  if (!['resource', 'relationship'].includes(routeMeta.kind)) {
    return null
  }

  const scope = api.resources?.[routeMeta.scopeName]
  const schemaInfo = scope?.vars?.schemaInfo
  if (!schemaInfo?.schemaInstance) {
    return null
  }

  const requestContracts = getRequestContracts({
    scopeName: routeMeta.scopeName,
    schemaInfo,
    includeDepthLimit: scope?.vars?.includeDepthLimit,
    sortableFields: scope?.vars?.sortableFields
  })

  const contract = requestContracts[routeMeta.operation]
  if (!contract?.schema) {
    return null
  }

  if (routeMeta.kind === 'resource' && !['post', 'put', 'patch'].includes(routeMeta.operation)) {
    return null
  }

  if (
    routeMeta.kind === 'relationship' &&
    !['postRelationship', 'patchRelationship', 'deleteRelationship'].includes(routeMeta.operation)
  ) {
    return null
  }

  return {
    body: contract.schema.toJsonSchema({ mode: contract.mode, additionalProperties: false })
  }
}
