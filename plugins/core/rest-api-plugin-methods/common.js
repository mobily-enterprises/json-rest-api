import { initializeResourceVersion } from '../lib/writing/resource-version.js'
import {
  RestApiIncludeError,
  RestApiResourceError,
  RestApiValidationError
} from '../../../lib/rest-api-errors.js'
import { transformSimplifiedToJsonApi } from '../lib/querying-writing/simplified-helpers.js'
import { normalizeRelationshipIdentifiers } from '../lib/querying-writing/resource-id-normalization.js'
import { createEnhancedLogger } from '../../../lib/enhanced-logger.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from '../lib/querying-writing/response-options.js'
import {
  getRequestContracts,
  selectWriteInput,
  validateRequestContractOrThrow
} from '../lib/querying-writing/request-contracts.js'
import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { beginWriteTransaction, commitTransaction, getOperationDiagnosticContext, isTransactionOwner, rollbackAfterError, wrapUnexpectedError } from '../../../lib/error-context.js'
import { filterVisibleIdentifiers } from '../lib/querying/include-query-helpers.js'
import { findRelationshipDefinition } from '../lib/querying-writing/relationship-contracts.js'
import { RELATIONSHIP_READ_BATCH_SIZE } from '../lib/querying-writing/knex-constants.js'
import { getResourceFieldset, parseFieldset } from '../lib/querying-writing/field-utils.js'

// A trusted connector callback, evaluated after normal write validation and authorization.
export const writePrecondition = Symbol('writePrecondition')

/**
 * Gets an enhanced logger instance with full error details and stack traces
 * @param {Object} log - The base logger instance
 * @param {Object} context - Request context carrying compiled field visibility
 * @returns {Object} Enhanced logger instance
 */
export const getEnhancedLogger = (log, context = {}) => {
  return createEnhancedLogger(log, {
    logFullErrors: true,
    includeStack: true,
    schemaInfo: context.schemaInfo
  })
}

/**
 * Sets up common request context for REST API methods
 * Handles simplified mode, transaction setup, and initial validation
 *
 * @param {Object} params - The method parameters
 * @param {Object} context - The request context
 * @param {Object} vars - Plugin variables
 * @param {Object} scopes - All available scopes
 * @param {string} scopeName - The name of the current scope
 * @param {Object} api - The API instance
 * @param {Object} helpers - Helper functions
 * @returns {Object} An object containing schema-related shortcuts
 */
export async function setupCommonRequest ({ params, context, vars, scopes, scopeName, api, helpers, runHooks }) {
  context.id = undefined
  context.originalInputAttributes = undefined
  context.minimalRecord = undefined
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  rejectRemovedOptions(params)
  context.format = resolveFormat(params.format, vars.format)
  context.simplified = context.format === 'plain'
  context.returning = resolveReturning(params.returning, vars.returning)
  context.params = params
  const inputKey = selectWriteInput(params)
  context.inputRecord = params[inputKey]
  if (!context.inputRecord || typeof context.inputRecord !== 'object' || Array.isArray(context.inputRecord)) {
    throw new RestApiValidationError(`${inputKey} must be a record object`, { fields: [inputKey] })
  }

  // These only make sense as parameter per query, not in vars etc.
  context.queryParams = params.queryParams || {}
  context.queryParams.fields = context.queryParams.fields ?? {}
  if (context.queryParams.include == null) delete context.queryParams.include

  context.scopeName = scopeName

  // Transaction handling
  await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
  context.db = context.transaction || api.knex.instance

  // These are just shortcuts used in this function and will be returned
  const schema = context.schemaInfo.schemaInstance
  const schemaStructure = context.schemaInfo.schemaInstance.structure
  const schemaRelationships = context.schemaInfo.schemaRelationships

  // Both input forms enter the same validation and hook pipeline.
  if (inputKey === 'data') {
    context.inputRecord = transformSimplifiedToJsonApi(
      { inputRecord: context.inputRecord },
      { context: { scopeName, schemaStructure, schemaRelationships } }
    )
  }

  // Return key schema-related objects for direct use in the main methods
  const versionState = initializeResourceVersion({ context, expectedVersion: params.expectedVersion })
  return { schema, schemaStructure, schemaRelationships, versionState }
}

/**
 * Handles error cleanup and logging for write methods (POST, PUT, PATCH)
 *
 * @param {Error} error - The error that was caught
 * @param {Object} context - The request context
 * @param {string} method - The HTTP method name (POST, PUT, PATCH)
 * @param {string} scopeName - The name of the resource scope
 * @param {Object} log - The logger instance
 * @throws {Error} Re-throws the original error after cleanup
 */
export const handleWriteMethodError = async (error, context, method, scopeName, log) => {
  await rollbackAfterError(error, context, context.transaction)
  const cleanupErrors = context.cleanupErrors

  try {
    await getEnhancedLogger(log, context).logError(`Error in ${method} method`, error, {
      ...getOperationDiagnosticContext(context, { phase: 'writeFailure', scopeName, method: method.toLowerCase() }),
      inputRecord: context.inputRecord,
      cleanupErrors
    })
  } catch (error) {
    cleanupErrors.push({ phase: 'logging', error })
  }

  throw error
}

export const commitOwnedTransaction = async (context) => {
  if (!isTransactionOwner(context)) {
    return
  }

  await commitTransaction(context.transaction, context)
}

export const validateRelationshipRoutePayload = ({
  context,
  vars,
  scopeName,
  operation,
  relationshipData
}) => {
  const contracts = getRequestContracts({
    scopeName,
    schemaInfo: context.schemaInfo,
    includeDepthLimit: vars.includeDepthLimit,
    sortableFields: vars.sortableFields
  })

  const validated = validateRequestContractOrThrow(
    contracts[operation],
    { data: relationshipData },
    `${operation} relationship request body is invalid`
  )

  const record = validateRequestContractOrThrow(
    contracts.patch,
    {
      data: {
        type: scopeName,
        id: context.id,
        relationships: { [context.relationshipName]: { data: validated.data } }
      }
    },
    `${operation} relationship data is invalid`
  )
  return record.data.relationships[context.relationshipName].data
}

/**
 * Validates that a pivot resource exists for many-to-many relationships
 *
 * @param {Object} scopes - All available scopes/resources
 * @param {Object} relDef - The relationship definition
 * @param {string} relName - The relationship name
 * @throws {RestApiValidationError} If the pivot resource doesn't exist
 */
export const validatePivotResource = (scopes, relDef, relName) => {
  if (!scopes[relDef.through]) {
    throw new RestApiValidationError(
      `Pivot resource '${relDef.through}' not found for relationship '${relName}'`,
      {
        fields: [`relationships.${relName}`],
        violations: [{
          field: `relationships.${relName}`,
          rule: 'missing_pivot_resource',
          message: `Pivot resource '${relDef.through}' must be defined`
        }]
      }
    )
  }
}

/**
 * Gets the appropriate hook suffix based on HTTP method
 *
 * @param {string} method - The HTTP method (e.g., 'post', 'get')
 * @returns {string} The capitalized method name for hook naming
 */
export const getMethodHookSuffix = (method) => {
  return method.charAt(0).toUpperCase() + method.slice(1)
}

export const validateCompleteReplacePayload = ({
  context,
  belongsToUpdates
}) => {
  const schemaInfo = context.schemaInfo || {}
  const schemaStructure = schemaInfo.schemaStructure || {}
  const idProperty = schemaInfo.idProperty || 'id'
  const originalInputAttributes = context.originalInputAttributes || context.inputRecord?.data?.attributes || {}
  const missingFields = []

  for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
    if (!fieldDef) continue
    if (fieldName === idProperty) continue
    if (Object.hasOwn(belongsToUpdates, fieldName)) continue
    if (fieldDef.computed === true || fieldDef.virtual === true) continue
    if (fieldDef.type === undefined) continue

    if (fieldDef.belongsTo && fieldDef.as) {
      const existingRelationshipData = context.minimalRecord?.relationships?.[fieldDef.as]?.data
      if (existingRelationshipData?.id !== undefined && existingRelationshipData?.id !== null) {
        missingFields.push({
          field: `data.relationships.${fieldDef.as}.data.id`,
          message: `PUT requests must explicitly include relationship '${fieldDef.as}' when it already has a value`
        })
      }
      continue
    }

    if (Object.hasOwn(originalInputAttributes, fieldName)) continue

    const existingValue = context.minimalRecord?.attributes?.[fieldName]
    if (existingValue !== undefined && existingValue !== null) {
      missingFields.push({
        field: `data.attributes.${fieldName}`,
        message: `PUT requests must explicitly include attribute '${fieldName}' when it already has a value`
      })
    }
  }

  if (missingFields.length > 0) {
    throw new RestApiValidationError(
      'PUT request omits persisted fields that already have stored values',
      {
        fields: missingFields.map(({ field }) => field),
        violations: missingFields.map(({ field, message }) => ({
          field,
          rule: 'complete_replacement',
          message
        }))
      }
    )
  }
}

/**
 * Validates resource attributes before write operations
 *
 * @param {Object} params - Validation parameters
 * @param {Object} params.context - The request context
 * @param {Object} params.schema - The resource schema
 * @param {Object} params.belongsToUpdates - BelongsTo relationship updates
 * @param {Function} params.runHooks - Function to run hooks
 * @param {boolean} params.isPartialValidation - Whether this is partial validation (for PATCH)
 * @throws {RestApiValidationError} If validation fails
 */
export const validateResourceAttributesBeforeWrite = async ({
  context,
  schema,
  belongsToUpdates,
  runHooks,
  isPartialValidation = false
}) => {
  // Dynamically get the method suffix
  const methodSpecificHookSuffix = getMethodHookSuffix(context.method)

  await runHooks('beforeSchemaValidate')
  await runHooks(`beforeSchemaValidate${methodSpecificHookSuffix}`)

  // Store original input attributes before validation adds defaults or casts.
  if (!context.originalInputAttributes) {
    context.originalInputAttributes = { ...(context.inputRecord.data.attributes || {}) }
  }

  const schemaStructure = context.schemaInfo.schemaStructure || {}
  const hasLogicalIdField = Object.hasOwn(schemaStructure, 'id')
  const resourceId = context.inputRecord?.data?.id

  // Merge belongsTo updates with attributes for validation
  const attributesToValidate = {
    ...context.inputRecord.data.attributes,
    ...belongsToUpdates,
    ...(hasLogicalIdField && resourceId !== undefined ? { id: resourceId } : {})
  }

  // Reject physical foreign keys supplied outside their relationship alias.
  const foreignKeyFields = {}
  Object.entries(attributesToValidate).forEach(([key, value]) => {
    const fieldDef = schemaStructure[key]
    // Foreign key fields (belongsTo with 'as' property) should NOT be in attributes
    // They should only come through relationships or belongsToUpdates
    // Check if key exists in belongsToUpdates (not just truthy value)
    if (fieldDef && fieldDef.belongsTo && fieldDef.as && value !== undefined && !Object.hasOwn(belongsToUpdates, key)) {
      foreignKeyFields[key] = value
    }
  })

  // Reject if foreign key fields were sent directly in attributes
  if (Object.keys(foreignKeyFields).length > 0) {
    const violations = Object.keys(foreignKeyFields).map(field => {
      const fieldDef = schemaStructure[field]
      return {
        field: `data.attributes.${field}`,
        rule: 'foreign_key_in_attributes',
        message: `Foreign key field '${field}' should not be in attributes. Use 'data.relationships.${fieldDef.as}' instead.`
      }
    })

    throw new RestApiValidationError(
      'Foreign key fields cannot be set directly in attributes',
      {
        fields: violations.map(v => v.field),
        violations
      }
    )
  }

  // Virtual input remains writable; computed fields are absent from this schema.
  const attributesForValidation = Object.fromEntries(Object.entries(attributesToValidate)
    .filter(([key, _]) => {
      const fieldDef = schemaStructure[key]
      // Exclude foreign key fields that weren't provided via belongsToUpdates
      if (fieldDef && fieldDef.belongsTo && fieldDef.as && !Object.hasOwn(belongsToUpdates, key)) {
        return false
      }
      return true
    }))

  const validationMethod = isPartialValidation
    ? 'patch'
    : context.method === 'put'
      ? 'replace'
      : 'create'

  const { validatedObject, errors } = await schema[validationMethod](attributesForValidation)

  if (Object.keys(errors).length > 0) {
    const violations = Object.entries(errors).map(([field, error]) => {
      let fieldPath = `data.attributes.${field}` // Default path for attributes

      if (field === 'id' && hasLogicalIdField) {
        fieldPath = 'data.id'
      }

      // Check if this field is a foreign key that has an 'as' alias
      const fieldDef = schemaStructure[field]
      if (fieldDef && fieldDef.belongsTo && fieldDef.as) {
      // If it's a belongsTo field with an alias, rewrite the path to the relationship alias
        fieldPath = `data.relationships.${fieldDef.as}.data.id`
      }
      // For many-to-many relationships, the original `transformSimplifiedToJsonApi`
      // already puts them under `relationships.relName.data`, so `field` here
      // would already be the relationship name, not a foreign key.
      // However, if a validation error somehow slips through for a pivot table field
      // that doesn't have an 'as' alias but is a foreign key, you might need
      // more sophisticated mapping. For now, this covers belongsTo.

      return {
        field: fieldPath,
        rule: error.code || 'invalid_value',
        message: error.message
      }
    })

    throw new RestApiValidationError(
      'Schema validation failed for resource attributes',
      {
        fields: violations.map(v => v.field), // Use the potentially rewritten fields
        violations
      }
    )
  }

  if (Object.hasOwn(validatedObject, 'id')) {
    context.inputRecord.data.id = validatedObject.id
  }
  const { id: _validatedId, ...validatedAttributes } = validatedObject

  // Update attributes with validated values
  // Virtual fields have now been validated and cast properly
  context.inputRecord.data.attributes = validatedAttributes

  await runHooks(`afterSchemaValidate${methodSpecificHookSuffix}`)
  await runHooks('afterSchemaValidate')
}

/**
 * Validates that the user has access to all resources referenced in relationships
 *
 * @param {object} context - The context object containing authentication info
 * @param {object} inputRecord - The input record containing relationships to validate
 * @param {object} helpers - Data helpers including dataGetMinimal
 * @param {object} api - API instance to access resources
 * @throws {Error} If user doesn't have access to any related resource
 */
export const validateRelationshipAccess = async (context, inputRecord, helpers, api) => {
  if (!inputRecord?.data?.relationships) return

  for (const [relName, relData] of Object.entries(inputRecord.data.relationships)) {
    if (!relData?.data) continue

    const normalizedRelationshipData = normalizeRelationshipIdentifiers(relData.data, { api })
    inputRecord.data.relationships[relName] = {
      ...relData,
      data: normalizedRelationshipData
    }

    // Handle both single and array relationships
    const relatedItems = Array.isArray(normalizedRelationshipData)
      ? normalizedRelationshipData
      : [normalizedRelationshipData]

    const unique = new Map()
    for (const item of relatedItems) unique.set(JSON.stringify([item.type, item.id]), item)
    const targets = [...unique.values()]
    for (let offset = 0; offset < targets.length; offset += RELATIONSHIP_READ_BATCH_SIZE) {
      const batch = targets.slice(offset, offset + RELATIONSHIP_READ_BATCH_SIZE)
      const byType = new Map()
      for (const item of batch) {
        if (!byType.has(item.type)) byType.set(item.type, [])
        byType.get(item.type).push(item)
      }
      const lookups = new Map()
      for (const [type, items] of byType) {
        const relatedScope = api.resources[type]
        if (!relatedScope) throw new Error(`Unknown resource type: ${type}`)
        const getContext = {
          ...context,
          id: undefined,
          minimalRecord: undefined,
          schemaInfo: relatedScope.vars.schemaInfo,
          scopeName: type,
          queryParams: {},
          method: 'get',
          isUpdate: false
        }
        const lookup = {
          scopeName: type,
          context: getContext,
          applyQueryFilters: filterParams => relatedScope.applyQueryFilters({
            ...filterParams, schemaInfo: getContext.schemaInfo
          }, getContext),
          filters: {},
          queryPurpose: 'relationship-validation'
        }
        const records = await helpers.dataGetMinimal({ ...lookup, ids: items.map(item => item.id) })
        lookups.set(type, { relatedScope, lookup, records: new Map(records.map(record => [String(record.id), record])) })
      }
      for (const item of batch) {
        const { relatedScope, lookup, records } = lookups.get(item.type)
        // A database collation can equate IDs with different spellings.
        const record = records.get(String(item.id)) || await helpers.dataGetMinimal({
          ...lookup, context: { ...lookup.context, id: item.id }
        })
        if (!record) {
          throw new RestApiResourceError(
            `Cannot create relationship to non-existent ${item.type} with id ${item.id}`,
            { subtype: 'not_found', resourceType: item.type, resourceId: item.id }
          )
        }
        await relatedScope.checkPermissions({
          method: 'get',
          originalContext: { ...lookup.context, id: item.id, minimalRecord: record }
        })
      }
    }
  }
}

export const getVisibleRelationshipParent = async ({
  context,
  helpers,
  scopeName,
  runHooks
}) => {
  // Related-route filters belong to the target resource, not its parent.
  return helpers.dataGetMinimal({
    scopeName,
    context,
    runHooks,
    filters: {},
    queryPurpose: 'relationship-parent'
  })
}

/**
 * Replaces validated write attributes with setter results in dependency order.
 * Assigns results only after every setter succeeds; does not complete transactions.
 * @param {object} context - Write context with inputRecord and schemaInfo
 * @param {object} api - The API instance
 * @param {object} helpers - Helper functions
 * @returns {Promise<void>}
 */
export const applyFieldSetters = async (context, api, helpers) => {
  const attributes = context.inputRecord?.data?.attributes
  if (!attributes) return
  const schemaInfo = context.schemaInfo
  const fieldSetters = schemaInfo.fieldSetters || {}
  const sortedSetterFields = schemaInfo.sortedSetterFields || []

  // No setters to apply
  if (sortedSetterFields.length === 0) {
    return
  }

  const transformedAttributes = { ...attributes }

  for (const fieldName of sortedSetterFields) {
    const setterInfo = fieldSetters[fieldName]
    const fieldPresent = Object.hasOwn(transformedAttributes, fieldName)
    const hasDependencies = Array.isArray(setterInfo.runSetterAfter) && setterInfo.runSetterAfter.length > 0

    if (!fieldPresent && !hasDependencies) continue

    try {
      const setterContext = {
        attributes: transformedAttributes, // Current state with previous setters applied
        fieldName,
        originalValue: Object.hasOwn(attributes, fieldName) ? attributes[fieldName] : undefined,
        originalAttributes: attributes,
        scopeName: context.scopeName,
        method: context.method,
        api,
        helpers,
        auth: context.auth
      }
      transformedAttributes[fieldName] = await setterInfo.setter(
        fieldPresent ? transformedAttributes[fieldName] : undefined,
        setterContext
      )
    } catch (error) {
      throw wrapUnexpectedError(error, {
        message: `Setter for field '${fieldName}' failed`,
        context: { scopeName: context.scopeName, fieldName, phase: 'setter' }
      })
    }
  }

  context.inputRecord.data.attributes = transformedAttributes
}

/**
 * Refreshes post-write state and prepares POST/PATCH/PUT responses before commit.
 * Runs finish hooks once and normalizes their result; borrows the write transaction.
 */
export async function handleRecordReturnAfterWrite ({ context, scopeName, api, scopes, runHooks, helpers }) {
  const methodSpecificHookSuffix = getMethodHookSuffix(context.method)
  if (context.minimalRecord) context.originalMinimalRecord = context.minimalRecord

  try {
    context.minimalRecord = await helpers.dataGetMinimal({ scopeName, context, runHooks })
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to refresh record after ${context.method}`,
      context: { scopeName, phase: 'postWriteRead' }
    })
  }

  const returnMode = context.returning
  if (returnMode === 'none') {
    context.responseRecord = undefined
  } else if (returnMode === 'minimal') {
    const identifier = { type: scopeName, id: String(context.id) }
    context.responseRecord = context.simplified ? identifier : { data: identifier }
  } else if (returnMode === 'full') {
    const fullRecord = await api.resources[scopeName].get({
      id: context.id,
      queryParams: context.queryParams,
      transaction: context.transaction,
      format: context.format
    }, {
      ...context,
      inputRecord: {
        ...context.inputRecord,
        data: { ...context.inputRecord.data, id: String(context.id) }
      }
    })
    context.responseRecord = fullRecord || undefined
  } else {
    throw new Error(`Invalid returnMode: ${returnMode}`)
  }

  await runHooks('finish')
  await runHooks(`finish${methodSpecificHookSuffix}`)
  if (returnMode === 'none') return undefined

  context.responseRecord = normalizeRecordAttributes(context.responseRecord, scopes, {
    source: 'response',
    simplified: context.simplified,
    resourceType: scopeName,
    fields: returnMode === 'full' ? context.queryParams?.fields : undefined
  })
  // After-commit observers must not mutate the prepared response.
  return structuredClone(context.responseRecord)
}

export const filterToOneResponseLinkage = async (context, scopes) => {
  const document = context.record
  const resources = [document?.data, document?.included].flat().filter(Boolean)
  const linkages = []
  for (const resource of resources) {
    const schemaInfo = scopes[resource.type]?.vars?.schemaInfo
    if (!schemaInfo) continue
    const requestedFields = parseFieldset(getResourceFieldset(context.queryParams?.fields, resource.type))
    for (const [name, relationship] of Object.entries(resource.relationships || {})) {
      if (requestedFields !== null && !requestedFields.includes(name)) continue
      const definition = findRelationshipDefinition(schemaInfo, name)
      if ((definition?.belongsTo || definition?.belongsToPolymorphic) && relationship.data) linkages.push(relationship)
    }
  }
  if (linkages.length === 0) return
  const visible = new Set(await filterVisibleIdentifiers({
    identifiers: linkages.map(relationship => relationship.data), scopes, knex: context.db, context
  }))
  for (const relationship of linkages) {
    if (!visible.has(relationship.data)) relationship.data = null
  }
}

export const validateRequestedIncludes = (context, scopes, resourceTypes = [context.scopeName]) => {
  const paths = context.queryParams?.include || []
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) {
    throw new RestApiValidationError('Include must be an array of relationship paths')
  }
  for (const path of paths) {
    let candidates = new Set(resourceTypes)
    for (const name of path.split('.')) {
      const targets = new Set()
      for (const resourceType of candidates) {
        const schemaInfo = Object.hasOwn(scopes, resourceType) && scopes[resourceType]?.vars?.schemaInfo
        if (!schemaInfo) continue
        const relationship = findRelationshipDefinition(schemaInfo, name)
        if (!relationship) continue
        const types = relationship.belongsToPolymorphic?.types ||
          [relationship.belongsTo || relationship.target || (relationship.type === 'manyToMany' ? name : undefined)]
        for (const type of types) {
          if (Object.hasOwn(scopes, type) && scopes[type]?.vars?.schemaInfo) targets.add(type)
        }
      }
      if (targets.size === 0) throw new RestApiIncludeError({ path, resourceType: context.scopeName })
      // A polymorphic path may apply to a subset of the declared target types.
      candidates = targets
    }
  }
}
