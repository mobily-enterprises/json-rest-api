import { addType, addValidator, createSchema } from 'json-rest-schema'
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildJsonApiIdTransportSchema () {
  return {
    anyOf: [
      { type: 'string', minLength: 1 },
      { type: 'number' }
    ]
  }
}

function buildResourceIdentifierTransportSchema (allowedTypes = null) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'id'],
    properties: {
      type: Array.isArray(allowedTypes) && allowedTypes.length > 0
        ? { enum: allowedTypes }
        : { type: 'string', minLength: 1 },
      id: buildJsonApiIdTransportSchema()
    }
  }
}

function buildRelationshipDataTransportSchema (allowedTypes = null) {
  const identifierSchema = buildResourceIdentifierTransportSchema(allowedTypes)

  return {
    anyOf: [
      identifierSchema,
      {
        type: 'array',
        items: identifierSchema
      }
    ]
  }
}

function buildIncludeDepthPattern (maxDepth) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    return '^[^.]+(?:\\.[^.]+)*$'
  }

  if (maxDepth === 1) {
    return '^[^.]+$'
  }

  return `^[^.]+(?:\\.[^.]+){0,${maxDepth - 1}}$`
}

function buildFieldMapJsonSchemaFragment () {
  return {
    additionalProperties: {
      type: 'string'
    }
  }
}

function buildKnownPageSchema () {
  return createSchema({
    number: { type: 'number' },
    size: { type: 'number' },
    limit: { type: 'number' },
    offset: { type: 'number' },
    after: { type: 'string' },
    before: { type: 'string' },
    cursor: { type: 'string' }
  })
}

function pickFirstError (errors = {}) {
  return Object.values(errors)[0] || null
}

function buildLooseObjectTransportSchema (propertiesSchema = null) {
  const baseSchema = {
    type: 'object',
    additionalProperties: true
  }

  if (!propertiesSchema || !isPlainObject(propertiesSchema.properties)) {
    return baseSchema
  }

  return {
    ...baseSchema,
    properties: propertiesSchema.properties
  }
}

function validateJsonApiIdValue (value, context) {
  if (typeof value === 'string') {
    if (value.length === 0) {
      context.throwTypeError()
    }
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      context.throwTypeError()
    }
    return value
  }

  context.throwTypeError()
}

function validateResourceIdentifierValue (value, context, allowedTypes = null) {
  if (!isPlainObject(value)) {
    context.throwTypeError()
  }

  if (typeof value.type !== 'string' || value.type.length === 0) {
    context.throwParamError(
      'INVALID_RESOURCE_TYPE',
      'Relationship resource identifiers must have a non-empty type.'
    )
  }

  if (Array.isArray(allowedTypes) && allowedTypes.length > 0 && !allowedTypes.includes(value.type)) {
    context.throwParamError(
      'INVALID_RESOURCE_TYPE',
      `Relationship type must be one of: ${allowedTypes.join(', ')}.`
    )
  }

  if (!Object.hasOwn(value, 'id')) {
    context.throwParamError(
      'MISSING_RESOURCE_ID',
      'Relationship resource identifiers must have an id.'
    )
  }

  validateJsonApiIdValue(value.id, context)
  return value
}

let requestContractSupportInstalled = false

function installRequestContractSupport () {
  if (requestContractSupportInstalled) return
  requestContractSupportInstalled = true

  const jsonApiIdType = (context) => validateJsonApiIdValue(context.value, context)
  jsonApiIdType.toJsonSchema = () => buildJsonApiIdTransportSchema()
  addType('jsonApiId', jsonApiIdType)

  const jsonApiRelationshipDataType = (context) => {
    const allowedTypes = Array.isArray(context.definition.allowedTypes)
      ? context.definition.allowedTypes
      : null

    if (Array.isArray(context.value)) {
      context.value.forEach((entry) => validateResourceIdentifierValue(entry, context, allowedTypes))
      return context.value
    }

    return validateResourceIdentifierValue(context.value, context, allowedTypes)
  }
  jsonApiRelationshipDataType.toJsonSchema = ({ definition }) => buildRelationshipDataTransportSchema(
    Array.isArray(definition.allowedTypes) ? definition.allowedTypes : null
  )
  addType('jsonApiRelationshipData', jsonApiRelationshipDataType)

  const jsonApiAttributesType = (context) => {
    if (!isPlainObject(context.value)) {
      context.throwTypeError()
    }

    return context.value
  }
  jsonApiAttributesType.toJsonSchema = ({ definition }) => (
    definition?.transportSchema || buildLooseObjectTransportSchema()
  )
  addType('jsonApiAttributes', jsonApiAttributesType)

  const atLeastOneOfValidator = (context) => {
    if (!Array.isArray(context.parameterValue) || context.parameterValue.length === 0) {
      throw new Error(`Validator atLeastOneOf on '${context.fieldName}' requires a non-empty array.`)
    }

    if (!context.parameterValue.some((fieldName) => Object.hasOwn(context.value || {}, fieldName))) {
      context.throwParamError(
        'AT_LEAST_ONE_REQUIRED',
        `Must include at least one of: ${context.parameterValue.join(', ')}.`
      )
    }
  }
  atLeastOneOfValidator.toJsonSchema = ({ parameterValue }) => ({
    anyOf: parameterValue.map((fieldName) => ({ required: [fieldName] }))
  })
  addValidator('atLeastOneOf', atLeastOneOfValidator)

  const includePathsValidator = (context) => {
    const maxDepth = context.parameterValue
    if (!Number.isInteger(maxDepth) || maxDepth < 1) return

    for (const includePath of context.value || []) {
      const depth = String(includePath).split('.').length
      if (depth > maxDepth) {
        context.throwParamError(
          'MAX_INCLUDE_DEPTH',
          `Include path '${includePath}' exceeds maximum depth of ${maxDepth}.`
        )
      }
    }
  }
  includePathsValidator.toJsonSchema = ({ parameterValue }) => ({
    items: {
      type: 'string',
      pattern: buildIncludeDepthPattern(parameterValue)
    }
  })
  addValidator('includePaths', includePathsValidator)

  const sortableEntriesValidator = (context) => {
    const allowedFields = Array.isArray(context.parameterValue)
      ? context.parameterValue
      : []

    if (allowedFields.length === 0) return

    for (const sortEntry of context.value || []) {
      const normalizedField = String(sortEntry).startsWith('-')
        ? String(sortEntry).slice(1)
        : String(sortEntry)

      if (!allowedFields.includes(normalizedField)) {
        context.throwParamError(
          'UNSORTABLE_FIELD',
          `Field '${normalizedField}' is not sortable. Sortable fields are: ${allowedFields.join(', ')}.`
        )
      }
    }
  }
  sortableEntriesValidator.toJsonSchema = ({ parameterValue }) => {
    const allowedFields = Array.isArray(parameterValue) ? parameterValue : []
    if (allowedFields.length === 0) {
      return {
        items: { type: 'string' }
      }
    }

    const enumValues = allowedFields.flatMap((fieldName) => [fieldName, `-${fieldName}`])
    return {
      items: {
        type: 'string',
        enum: enumValues
      }
    }
  }
  addValidator('sortableEntries', sortableEntriesValidator)

  const stringMapValuesValidator = (context) => {
    for (const [key, value] of Object.entries(context.value || {})) {
      if (typeof value !== 'string') {
        context.throwParamError(
          'INVALID_MAP_VALUE',
          `Value for key '${key}' must be a string.`
        )
      }
    }
  }
  stringMapValuesValidator.toJsonSchema = () => buildFieldMapJsonSchemaFragment()
  addValidator('stringMapValues', stringMapValuesValidator)

  const pageParamsValidator = (context) => {
    const pageSchema = buildKnownPageSchema()
    const knownPageParams = {}

    for (const fieldName of Object.keys(pageSchema.structure)) {
      if (Object.hasOwn(context.value || {}, fieldName)) {
        knownPageParams[fieldName] = context.value[fieldName]
      }
    }

    const { validatedObject, errors } = pageSchema.patch(knownPageParams)
    if (Object.keys(errors).length > 0) {
      const firstError = pickFirstError(errors)
      context.throwParamError(firstError?.code || 'INVALID_PAGE', firstError?.message || 'Invalid page parameters.')
    }

    return {
      ...context.value,
      ...validatedObject
    }
  }
  pageParamsValidator.toJsonSchema = () => {
    const pageSchema = buildKnownPageSchema().toJsonSchema({
      mode: 'patch',
      additionalProperties: false
    })

    return {
      properties: pageSchema.properties,
      additionalProperties: true
    }
  }
  addValidator('pageParams', pageParamsValidator)
}

function buildWritableAttributesStructure (schemaInfo = {}) {
  const schemaStructure = schemaInfo.schemaStructure || {}
  const schemaRelationships = schemaInfo.schemaRelationships || {}
  const idProperty = schemaInfo.idProperty || 'id'
  const attributesStructure = {}
  const excludedFieldNames = new Set()

  for (const relDef of Object.values(schemaRelationships)) {
    if (!relDef?.belongsToPolymorphic) continue

    const { typeField, idField } = relDef.belongsToPolymorphic
    if (typeField) excludedFieldNames.add(typeField)
    if (idField) excludedFieldNames.add(idField)
  }

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef) continue
    if (fieldName === idProperty) continue
    if (excludedFieldNames.has(fieldName)) continue
    if (fieldDef.computed === true) continue
    if (fieldDef.type === undefined) continue
    if (fieldDef.belongsTo && fieldDef.as) continue
    attributesStructure[fieldName] = { ...fieldDef }
  }

  return attributesStructure
}

function buildWritableAttributesTransportSchema (schemaInfo = {}) {
  const writableAttributesSchema = createSchema(buildWritableAttributesStructure(schemaInfo))
  const jsonSchema = writableAttributesSchema.toJsonSchema({
    mode: 'patch',
    additionalProperties: true
  })

  return buildLooseObjectTransportSchema(jsonSchema)
}

function resolveRelationshipAllowedTypes (relName, relDef) {
  if (relDef?.belongsToPolymorphic?.types?.length) {
    return relDef.belongsToPolymorphic.types
  }

  if (relDef?.target) {
    return [relDef.target]
  }

  if (relDef?.belongsTo) {
    return [relDef.belongsTo]
  }

  if (relDef?.type === 'manyToMany' || relDef?.type === 'hasMany' || relDef?.type === 'hasOne') {
    return [relDef.target || relName]
  }

  return null
}

function buildRelationshipStructure (schemaInfo = {}) {
  const schemaStructure = schemaInfo.schemaStructure || {}
  const schemaRelationships = schemaInfo.schemaRelationships || {}
  const relationshipStructure = {}

  for (const [, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef?.belongsTo || !fieldDef?.as) continue

    relationshipStructure[fieldDef.as] = {
      type: 'object',
      schema: createSchema({
        data: {
          type: 'jsonApiRelationshipData',
          required: true,
          nullable: true,
          allowedTypes: [fieldDef.belongsTo]
        }
      })
    }
  }

  for (const [relName, relDef] of Object.entries(schemaRelationships)) {
    relationshipStructure[relName] = {
      type: 'object',
      schema: createSchema({
        data: {
          type: 'jsonApiRelationshipData',
          required: true,
          nullable: true,
          allowedTypes: resolveRelationshipAllowedTypes(relName, relDef)
        }
      })
    }
  }

  return relationshipStructure
}

function buildWriteDocumentContract (scopeName, schemaInfo, mode) {
  const relationshipStructure = buildRelationshipStructure(schemaInfo)

  const dataFieldDefinition = {
    type: 'object',
    required: true,
    schema: createSchema({
      type: {
        type: 'string',
        required: true,
        enum: [scopeName]
      },
      ...(mode === 'post'
        ? {
            id: {
              type: 'jsonApiId',
              nullable: true
            }
          }
        : {
            id: {
              type: 'jsonApiId',
              required: true
            }
          }),
      attributes: {
        type: 'jsonApiAttributes',
        transportSchema: buildWritableAttributesTransportSchema(schemaInfo)
      },
      relationships: {
        type: 'object',
        schema: createSchema(relationshipStructure)
      }
    })
  }

  if (mode === 'patch') {
    dataFieldDefinition.atLeastOneOf = ['attributes', 'relationships']
  }

  const schema = createSchema({
    data: dataFieldDefinition
  })

  return {
    schema,
    mode: mode === 'post' ? 'create' : mode === 'put' ? 'replace' : 'patch'
  }
}

function buildGetRequestContract ({ includeDepthLimit }) {
  const queryParamsSchema = createSchema({
    include: {
      type: 'array',
      items: { type: 'string' },
      includePaths: includeDepthLimit
    },
    fields: {
      type: 'object',
      additionalProperties: true,
      stringMapValues: true
    }
  })

  return {
    schema: createSchema({
      id: {
        type: 'jsonApiId',
        required: true
      },
      queryParams: {
        type: 'object',
        schema: queryParamsSchema
      }
    }),
    mode: 'replace'
  }
}

function buildQueryRequestContract ({ includeDepthLimit, sortableFields, searchSchemaInstance }) {
  const queryParamsSchema = createSchema({
    include: {
      type: 'array',
      items: { type: 'string' },
      includePaths: includeDepthLimit
    },
    fields: {
      type: 'object',
      additionalProperties: true,
      stringMapValues: true
    },
    filters: {
      type: 'object',
      schema: searchSchemaInstance || createSchema({})
    },
    sort: {
      type: 'array',
      items: { type: 'string' },
      sortableEntries: sortableFields
    },
    page: {
      type: 'object',
      additionalProperties: true,
      pageParams: true
    }
  })

  return {
    schema: createSchema({
      queryParams: {
        type: 'object',
        schema: queryParamsSchema
      }
    }),
    mode: 'patch'
  }
}

function buildRequestContracts ({ scopeName, schemaInfo, includeDepthLimit, sortableFields }) {
  return {
    post: buildWriteDocumentContract(scopeName, schemaInfo, 'post'),
    put: buildWriteDocumentContract(scopeName, schemaInfo, 'put'),
    patch: buildWriteDocumentContract(scopeName, schemaInfo, 'patch'),
    get: buildGetRequestContract({ includeDepthLimit }),
    query: buildQueryRequestContract({
      includeDepthLimit,
      sortableFields,
      searchSchemaInstance: schemaInfo.searchSchemaInstance
    })
  }
}

function buildContractCacheKey ({ includeDepthLimit, sortableFields }) {
  return JSON.stringify({
    includeDepthLimit,
    sortableFields: Array.isArray(sortableFields) ? [...sortableFields].sort() : []
  })
}

export function getRequestContracts ({ scopeName, schemaInfo, includeDepthLimit = 3, sortableFields = [] }) {
  installRequestContractSupport()

  const cacheKey = buildContractCacheKey({ includeDepthLimit, sortableFields })
  if (schemaInfo.requestContracts && schemaInfo.requestContractsCacheKey === cacheKey) {
    return schemaInfo.requestContracts
  }

  const requestContracts = buildRequestContracts({
    scopeName,
    schemaInfo,
    includeDepthLimit,
    sortableFields
  })

  schemaInfo.requestContracts = requestContracts
  schemaInfo.requestContractsCacheKey = cacheKey

  return requestContracts
}

export function validateRequestContractOrThrow (contract, payload, message = 'Request validation failed') {
  const mode = contract?.mode || 'replace'
  const schema = contract?.schema

  if (!schema || typeof schema[mode] !== 'function') {
    throw new Error('Invalid request contract.')
  }

  const { validatedObject, errors } = schema[mode](payload)
  if (Object.keys(errors).length === 0) {
    return validatedObject
  }

  const violations = Object.values(errors).map((error) => ({
    field: error.field,
    rule: error.code || 'invalid_value',
    message: error.message
  }))

  const firstViolationMessage = violations[0]?.message

  throw new RestApiValidationError(firstViolationMessage || message, {
    fields: violations.map((entry) => entry.field),
    violations
  })
}
