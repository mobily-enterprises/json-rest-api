const STRING_OR_NUMBER_SCHEMA = {
  anyOf: [
    { type: 'string' },
    { type: 'number' }
  ]
}

const NULLABLE_STRING_OR_NUMBER_SCHEMA = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'null' }
  ]
}

function cloneSchema (schema) {
  return structuredClone(schema)
}

function removeRequiredField (schema, fieldName) {
  if (!Array.isArray(schema.required)) return
  schema.required = schema.required.filter((entry) => entry !== fieldName)
  if (schema.required.length === 0) {
    delete schema.required
  }
}

function buildAttributesSchema (schemaInfo, mode) {
  const attributesSchema = cloneSchema(
    schemaInfo.schemaInstance.toJsonSchema({
      mode,
      additionalProperties: false
    })
  )

  delete attributesSchema.$schema

  const schemaStructure = schemaInfo.schemaStructure || {}
  const idProperty = schemaInfo.idProperty || 'id'

  delete attributesSchema.properties?.[idProperty]
  removeRequiredField(attributesSchema, idProperty)

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef) continue

    if (fieldDef.computed === true) {
      delete attributesSchema.properties?.[fieldName]
      removeRequiredField(attributesSchema, fieldName)
      continue
    }

    if (fieldDef.belongsTo && fieldDef.as) {
      delete attributesSchema.properties?.[fieldName]
      removeRequiredField(attributesSchema, fieldName)
    }
  }

  return attributesSchema
}

function buildResourceIdentifierSchema (allowedTypes = null) {
  const typeSchema = Array.isArray(allowedTypes) && allowedTypes.length > 0
    ? { enum: allowedTypes }
    : { type: 'string', minLength: 1 }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'id'],
    properties: {
      type: typeSchema,
      id: STRING_OR_NUMBER_SCHEMA
    }
  }
}

function buildRelationshipValueSchema (allowedTypes = null) {
  const identifierSchema = buildResourceIdentifierSchema(allowedTypes)

  return {
    anyOf: [
      { type: 'null' },
      identifierSchema,
      {
        type: 'array',
        items: identifierSchema
      }
    ]
  }
}

function buildRelationshipsSchema (schemaInfo) {
  const properties = {}
  const schemaStructure = schemaInfo.schemaStructure || {}
  const schemaRelationships = schemaInfo.schemaRelationships || {}

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef?.belongsTo || !fieldDef.as) continue
    properties[fieldDef.as] = {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        data: buildRelationshipValueSchema([fieldDef.belongsTo])
      }
    }
  }

  for (const [relationshipName, relDef] of Object.entries(schemaRelationships)) {
    if (!relDef) continue

    if (relDef.belongsToPolymorphic?.types?.length) {
      properties[relationshipName] = {
        type: 'object',
        additionalProperties: false,
        required: ['data'],
        properties: {
          data: buildRelationshipValueSchema(relDef.belongsToPolymorphic.types)
        }
      }
      continue
    }

    if (relDef.type === 'manyToMany') {
      const allowedTypes = relDef.target ? [relDef.target] : null
      properties[relationshipName] = {
        type: 'object',
        additionalProperties: false,
        required: ['data'],
        properties: {
          data: buildRelationshipValueSchema(allowedTypes)
        }
      }
    }
  }

  const genericRelationshipSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: {
      data: buildRelationshipValueSchema()
    }
  }

  return {
    type: 'object',
    properties,
    additionalProperties: genericRelationshipSchema
  }
}

function buildRelationshipRouteBodySchema (operation) {
  if (!['postRelationship', 'patchRelationship', 'deleteRelationship'].includes(operation)) {
    return null
  }

  const dataSchema = operation === 'patchRelationship'
    ? buildRelationshipValueSchema()
    : {
        type: 'array',
        items: buildResourceIdentifierSchema()
      }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: {
      data: dataSchema
    }
  }
}

export function buildTransportResourceBodySchema ({ scopeName, schemaInfo, mode }) {
  const dataProperties = {
    type: { const: scopeName }
  }
  const dataRequired = ['type']
  const attributesSchema = buildAttributesSchema(schemaInfo, mode)
  const relationshipsSchema = buildRelationshipsSchema(schemaInfo)

  dataProperties.attributes = attributesSchema
  dataProperties.relationships = relationshipsSchema

  if (mode === 'create') {
    dataProperties.id = NULLABLE_STRING_OR_NUMBER_SCHEMA
  } else {
    dataProperties.id = STRING_OR_NUMBER_SCHEMA
    dataRequired.push('id')
  }

  const dataSchema = {
    type: 'object',
    additionalProperties: false,
    required: dataRequired,
    properties: dataProperties
  }

  if (mode === 'patch') {
    dataSchema.anyOf = [
      { required: ['attributes'] },
      { required: ['relationships'] }
    ]
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: {
      data: dataSchema
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

  const mode = routeMeta.operation === 'post'
    ? 'create'
    : routeMeta.operation === 'put'
      ? 'replace'
      : 'patch'

  return {
    body: buildTransportResourceBodySchema({
      scopeName: routeMeta.scopeName,
      schemaInfo,
      mode
    })
  }
}
