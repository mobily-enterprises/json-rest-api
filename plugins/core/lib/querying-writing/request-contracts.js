import { addType, addValidator, createSchema } from 'json-rest-schema'
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { requireDocumentResourceId, requireExistingResourceId } from './resource-id-normalization.js'
import { getRelationshipCardinality } from './relationship-contracts.js'

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

function buildRelationshipDataTransportSchema (allowedTypes = null, cardinality = null) {
  const identifierSchema = buildResourceIdentifierTransportSchema(allowedTypes)

  if (cardinality === 'one') {
    return identifierSchema
  }

  if (cardinality === 'many') {
    return {
      type: 'array',
      items: identifierSchema
    }
  }

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
    number: { type: 'integer', min: 1 },
    size: { type: 'integer', min: 1 },
    limit: { type: 'integer', min: 1 },
    offset: { type: 'integer', min: 0 },
    after: { type: 'string', min: 1 },
    before: { type: 'string', min: 1 },
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
    const cardinality = context.definition.cardinality || null

    if (Array.isArray(context.value)) {
      if (cardinality === 'one') {
        context.throwParamError(
          'INVALID_RELATIONSHIP_CARDINALITY',
          'Relationship data must be a single resource identifier or null.'
        )
      }
      context.value.forEach((entry) => validateResourceIdentifierValue(entry, context, allowedTypes))
      return context.value
    }

    if (cardinality === 'many') {
      context.throwParamError(
        'INVALID_RELATIONSHIP_CARDINALITY',
        'Relationship data must be an array of resource identifiers.'
      )
    }

    return validateResourceIdentifierValue(context.value, context, allowedTypes)
  }
  jsonApiRelationshipDataType.toJsonSchema = ({ definition }) => buildRelationshipDataTransportSchema(
    Array.isArray(definition.allowedTypes) ? definition.allowedTypes : null,
    definition.cardinality || null
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
    for (const direction of ['after', 'before']) {
      if (Object.hasOwn(knownPageParams, direction) && !validatedObject[direction]?.trim()) {
        context.throwParamError('INVALID_PAGE', `page[${direction}] must contain a cursor.`)
      }
    }

    if ((validatedObject.after !== undefined && validatedObject.before !== undefined) ||
        (validatedObject.number !== undefined && (validatedObject.after !== undefined || validatedObject.before !== undefined))) {
      context.throwParamError('INVALID_PAGE', 'Use either page[number], page[after], or page[before].')
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
  const idProperty = schemaInfo.idProperty || 'id'
  const attributesStructure = {}
  const excludedFieldNames = schemaInfo.foreignKeyFields

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef) continue
    if (fieldName === idProperty) continue
    if (excludedFieldNames.has(fieldName)) continue
    if (fieldDef.computed === true) continue
    if (fieldDef.type === undefined) continue
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

  if (relDef?.belongsTo) {
    return [relDef.belongsTo]
  }

  if (relDef?.target) {
    return [relDef.target]
  }

  if (relDef?.type === 'manyToMany' || relDef?.type === 'hasMany' || relDef?.type === 'hasOne') {
    return [relDef.target || relName]
  }

  return null
}

function buildRelationshipStructure (schemaInfo = {}) {
  const relationshipStructure = {}

  for (const [relName, relDef] of Object.entries(schemaInfo.outputRelationships || {})) {
    const cardinality = getRelationshipCardinality(relDef)
    relationshipStructure[relName] = {
      type: 'object',
      schema: createSchema({
        data: {
          type: 'jsonApiRelationshipData',
          required: true,
          nullable: cardinality === 'one',
          cardinality,
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
    data: dataFieldDefinition,
    meta: { type: 'object', additionalProperties: true },
    links: { type: 'object', additionalProperties: true },
    jsonapi: { type: 'object', additionalProperties: true }
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

function buildRelationshipRouteBodyContract (operation) {
  const isPatch = operation === 'patchRelationship'

  return {
    schema: createSchema({
      data: {
        type: 'jsonApiRelationshipData',
        required: true,
        nullable: isPatch,
        cardinality: isPatch ? null : 'many'
      }
    }),
    mode: 'replace'
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
    }),
    postRelationship: buildRelationshipRouteBodyContract('postRelationship'),
    patchRelationship: buildRelationshipRouteBodyContract('patchRelationship'),
    deleteRelationship: buildRelationshipRouteBodyContract('deleteRelationship')
  }
}

function buildContractCacheKey ({ scopeName, includeDepthLimit, sortableFields }) {
  return JSON.stringify({
    scopeName,
    includeDepthLimit,
    sortableFields: Array.isArray(sortableFields) ? [...sortableFields].sort() : []
  })
}

/** @param {{ scopeName: string, schemaInfo: object, includeDepthLimit?: number, sortableFields?: string[] }} options */
export function getRequestContracts ({ scopeName, schemaInfo, includeDepthLimit = 3, sortableFields = [] }) {
  installRequestContractSupport()

  const cacheKey = buildContractCacheKey({ scopeName, includeDepthLimit, sortableFields })
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

  if (!isPlainObject(payload)) {
    throw new RestApiValidationError('document must be an object', { fields: ['document'] })
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

/** Select input by argument name, independently of the response format. */
export function selectWriteInput (params) {
  const hasData = Object.hasOwn(params, 'data')
  const hasDocument = Object.hasOwn(params, 'document')
  if (hasData === hasDocument) {
    throw new RestApiValidationError('Supply exactly one of data or document', { fields: ['data', 'document'] })
  }
  if (hasDocument) {
    if (!isPlainObject(params.document)) {
      throw new RestApiValidationError('document must be an object', { fields: ['document'] })
    }
    const unsupported = ['errors', 'included'].filter(key => Object.hasOwn(params.document, key))
    if (unsupported.length) {
      throw new RestApiValidationError('Write documents do not support errors or included resources', {
        fields: unsupported.map(key => `document.${key}`)
      })
    }
  }
  return hasDocument ? 'document' : 'data'
}

/** Validate PUT/PATCH identity and body, then store the normalized document and ID on context. */
export function validateUpdateRequest ({ method, params, context, vars, scopeOptions, scopeName }) {
  const requestContracts = getRequestContracts({
    scopeName,
    schemaInfo: context.schemaInfo,
    includeDepthLimit: vars.includeDepthLimit,
    sortableFields: vars.sortableFields
  })
  const normalizedPathId = params.id === undefined
    ? null
    : requireExistingResourceId(params.id, {
      scopeOptions,
      vars,
      scopeName
    })

  if (normalizedPathId && context.inputRecord?.data?.id === undefined) {
    context.inputRecord = {
      ...context.inputRecord,
      data: {
        ...(context.inputRecord?.data || {}),
        id: normalizedPathId
      }
    }
  }

  context.inputRecord = validateRequestContractOrThrow(
    requestContracts[method],
    context.inputRecord,
    `${method.toUpperCase()} request body is invalid`
  )
  const normalizedBodyId = requireDocumentResourceId(context.inputRecord.data.id, {
    scopeOptions,
    vars
  })

  if (normalizedPathId && normalizedPathId !== normalizedBodyId) {
    throw new RestApiValidationError(
      `ID mismatch. URL path ID '${normalizedPathId}' does not match request body ID '${normalizedBodyId}'`,
      {
        fields: ['data.id'],
        violations: [{
          field: 'data.id',
          rule: 'id_consistency',
          message: 'Request body ID must match URL path ID when both are provided'
        }]
      }
    )
  }
  context.inputRecord.data.id = normalizedBodyId
  context.id = normalizedPathId || normalizedBodyId
}
