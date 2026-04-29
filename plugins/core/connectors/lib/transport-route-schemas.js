import { getRequestContracts } from '../../lib/querying-writing/request-contracts.js'

const STRING_OR_NUMBER_SCHEMA = {
  anyOf: [
    { type: 'string' },
    { type: 'number' }
  ]
}

function buildResourceIdentifierSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'id'],
    properties: {
      type: { type: 'string', minLength: 1 },
      id: STRING_OR_NUMBER_SCHEMA
    }
  }
}

function buildRelationshipValueSchema (operation) {
  if (operation === 'patchRelationship') {
    return {
      anyOf: [
        { type: 'null' },
        buildResourceIdentifierSchema(),
        {
          type: 'array',
          items: buildResourceIdentifierSchema()
        }
      ]
    }
  }

  return {
    type: 'array',
    items: buildResourceIdentifierSchema()
  }
}

function buildRelationshipRouteBodySchema (operation) {
  if (!['postRelationship', 'patchRelationship', 'deleteRelationship'].includes(operation)) {
    return null
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: {
      data: buildRelationshipValueSchema(operation)
    }
  }
}

export function buildTransportRouteSchema ({ routeMeta, api }) {
  if (!routeMeta) {
    return null
  }

  if (routeMeta.kind === 'relationship') {
    const relationshipBodySchema = buildRelationshipRouteBodySchema(routeMeta.operation)
    return relationshipBodySchema ? { body: relationshipBodySchema } : null
  }

  if (routeMeta.kind !== 'resource' || !['post', 'put', 'patch'].includes(routeMeta.operation)) {
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

  return {
    body: contract.schema.toJsonSchema({ mode: contract.mode, additionalProperties: false })
  }
}
