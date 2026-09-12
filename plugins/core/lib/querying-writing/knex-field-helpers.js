// @ts-check
/** @import { FieldSelection, SelectedQuery, SelectionContext, SelectionQueryRequest, SelectionScope } from './field-selection-types.js' */
/** @import { StorageFieldDefinition } from '../storage/storage-types.js' */
import { buildQuerySelection } from '../querying/knex-query-helpers-base.js'
import { createSelectTranslator } from '../storage/storage-adapter.js'
import { buildQueryFieldRuntimes, normalizeStructuredSelect } from './query-field-helpers.js'
import { RestApiFieldsetError } from '../../../../lib/rest-api-errors.js'
import { getResourceFieldset, parseFieldset } from './field-utils.js'
import { databaseIdentityExpression } from './database-value-normalizers.js'
import { findRelationshipDefinition } from './relationship-contracts.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { getFieldDependencyClosure } from './schema-helpers.js'
import { resolveSortField } from '../querying/query-field-sort-helpers.js'

/** @param {SelectionContext} context @param {Record<string, SelectionScope>} scopes */
export const validateRequestedFieldsets = async (context, scopes) => {
  for (const scopeName of Object.keys(context.queryParams?.fields || {})) {
    if (!Object.hasOwn(scopes, scopeName) || !scopes[scopeName]?.vars?.schemaInfo) {
      throw new RestApiFieldsetError({ resourceType: scopeName })
    }
    await buildFieldSelection(scopes[scopeName], {
      context: { scopeName, queryParams: { fields: context.queryParams?.fields } }
    })
  }
}

/**
 * Resolve public fieldsets to logical storage/projection names and read dependencies.
 * Always fetch the logical ID and visible relationship backing fields. Fetch sort
 * values needed by cursors and hidden dependencies needed by selected callbacks;
 * response formatting owns removal of values that were only read dependencies.
 * This prepares selection metadata without executing a query or completing a transaction.
 * @param {SelectionScope | null | undefined} scope
 * @param {{ context: SelectionContext }} deps
 * @returns {Promise<FieldSelection>}
 */
export const buildFieldSelection = async (scope, deps) => {
  /** @type {Set<string>} */
  const fieldsToSelect = new Set()
  /** @type {Set<string>} */
  const computedDependencies = new Set()

  // Extract values from scope
  const scopeSchemaInfo = scope?.vars?.schemaInfo || {}
  const {
    schemaStructure = {},
    computed: computedFields = {},
    idProperty = 'id'
  } = scopeSchemaInfo
  const queryFields = scope?.vars?.schemaInfo?.queryFields || {}

  // Extract values from deps
  const { context } = deps
  const scopeName = context.scopeName
  const requestedFields = getResourceFieldset(context.queryParams?.fields, scopeName)

  // Always include the logical ID field - the storage adapter translates it.
  fieldsToSelect.add('id')

  // Get computed fields and virtual fields from schema
  const computedFieldNames = new Set(Object.keys(computedFields))
  const queryFieldNames = new Set(Object.keys(queryFields))
  /** @type {Set<string>} */
  const queryFieldsToSelect = new Set()

  // Find fields marked as virtual in the schema
  /** @type {Map<string, StorageFieldDefinition>} */
  const virtualFields = new Map()
  Object.entries(schemaStructure).forEach(([fieldName, fieldDef]) => {
    if (fieldDef.virtual === true) {
      virtualFields.set(fieldName, fieldDef)
    }
  })

  const nonDatabaseFields = new Set([...computedFieldNames, ...virtualFields.keys()])

  // Parse requested fields
  const requested = parseFieldset(requestedFields)

  if (requested !== null) {
    // Sparse fieldsets requested - only select specified fields
    // Example: ?fields[products]=name,price,profit_margin
    requested.forEach(field => {
      if (field === 'id' || field === idProperty) return
      if (findRelationshipDefinition(scopeSchemaInfo, field)) return

      if (queryFieldNames.has(field)) {
        if (queryFields[field]?.hidden === true) return
        queryFieldsToSelect.add(field)
        return
      }

      // Skip computed and virtual fields - they don't exist in database
      // Computed fields will be calculated later in enrichAttributes
      // Virtual fields are handled separately (from request input)
      if (nonDatabaseFields.has(field)) return

      const fieldDef = schemaStructure[field]
      if (!Object.hasOwn(schemaStructure, field) || !fieldDef) {
        throw new RestApiFieldsetError({
          field,
          resourceType: scopeName
        })
      }

      if (fieldDef.belongsToPolymorphic) {
        return
      }

      // NEVER include hidden fields, even if explicitly requested
      // Example: password_hash with hidden:true is never returned
      if (fieldDef.hidden === true) return

      fieldsToSelect.add(field)
    })
  } else {
    // No sparse fieldsets - return all visible fields
    // This is the default behavior when no ?fields parameter is provided
    Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
      if (field === 'id' || field === idProperty) return

      // Skip virtual fields - they don't exist in database
      if (fieldDef.virtual === true) return

      // Skip hidden fields - these are NEVER returned
      // Example: password_hash with hidden:true
      if (fieldDef.hidden === true) return

      // Skip polymorphic placeholder fields - handled via type/id columns
      if (fieldDef.belongsToPolymorphic) return

      // Skip normallyHidden fields - these are hidden by default
      // Example: cost with normallyHidden:true (only returned when explicitly requested)
      if (fieldDef.normallyHidden === true) return

      fieldsToSelect.add(field)
    })

    for (const [fieldName, fieldDef] of Object.entries(queryFields)) {
      if (fieldDef.hidden === true || fieldDef.normallyHidden === true) continue
      queryFieldsToSelect.add(fieldName)
    }
  }

  const sortFields = Array.isArray(context.queryParams?.sort)
    ? context.queryParams.sort
    : []

  for (const sortField of sortFields) {
    if (typeof sortField !== 'string') continue
    const normalizedField = resolveSortField(sortField.startsWith('-') ? sortField.slice(1) : sortField, scopeSchemaInfo)

    if (queryFieldNames.has(normalizedField)) {
      queryFieldsToSelect.add(normalizedField)
    } else if (schemaStructure[normalizedField] &&
               schemaStructure[normalizedField].hidden !== true &&
               !nonDatabaseFields.has(normalizedField)) {
      // Cursor generation needs sort values even when the response omits them.
      fieldsToSelect.add(normalizedField)
    }
  }

  // Always include foreign keys for relationships (unless hidden)
  Object.entries(schemaStructure).forEach(([field, fieldDef]) => {
    if (fieldDef.belongsTo && fieldDef.hidden !== true) {
      fieldsToSelect.add(field)
    }
  })

  // Always include polymorphic type and id fields from relationships
  try {
    const relationships = scopeSchemaInfo.schemaRelationships
    Object.entries(relationships || {}).forEach(([relName, relDef]) => {
      if (relDef.belongsToPolymorphic) {
        fieldsToSelect.add(relDef.belongsToPolymorphic.typeField)
        fieldsToSelect.add(relDef.belongsToPolymorphic.idField)
      }
    })
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Failed to select relationship fields for '${scopeName}'`,
      context: { scopeName, phase: 'relationshipMetadata' }
    })
  }

  const selectedFields = new Set([
    ...fieldsToSelect,
    ...queryFieldsToSelect,
    ...getRequestedComputedFields(scopeName, requestedFields, computedFields)
  ])
  for (const [field, definition] of virtualFields) {
    if (definition.hidden !== true && (requested === null ? definition.normallyHidden !== true : requested.includes(field))) {
      selectedFields.add(field)
    }
  }
  for (const field of getFieldDependencyClosure(scopeSchemaInfo, selectedFields)) {
    if (field === 'id' || field === idProperty || nonDatabaseFields.has(field)) continue
    if (queryFieldNames.has(field)) queryFieldsToSelect.add(field)
    else if (Object.hasOwn(schemaStructure, field)) fieldsToSelect.add(field)
    if (!selectedFields.has(field)) computedDependencies.add(field)
  }

  // Return detailed information about field selection
  // This info is used by:
  // 1. SQL query builder to SELECT the right columns
  // 2. enrichAttributes to know which computed fields to calculate
  // 3. enrichAttributes to remove dependencies from final response
  return {
    fieldsToSelect: Array.from(fieldsToSelect),      // Fields to SELECT from database
    queryFieldsToSelect: Array.from(queryFieldsToSelect),
    requestedFields: requested,                       // Fields explicitly requested by user
    computedDependencies: Array.from(computedDependencies),  // Dependencies to remove from response
    idProperty: 'id'                                  // Logical field name reference
  }
}

/** @param {SelectionQueryRequest} options @returns {Promise<SelectedQuery>} */
export const applyFieldSelectionToQuery = async ({
  query,
  scope,
  fieldSelectionInfo,
  tableName,
  useTablePrefix = false,
  storageAdapter = null,
  db = null,
  context = null,
  scopeName = ''
}) => {
  const selectTranslator = createSelectTranslator(storageAdapter)
  const schemaInfo = scope?.vars?.schemaInfo || {}
  const foreignKeyFields = schemaInfo.foreignKeyFields
  /** @param {string} field @param {string | null} [alias] */
  const translateColumn = (field, alias) => {
    const translated = selectTranslator?.(field, alias) || (alias ? `${alias}.${field}` : field)
    if (db && !storageAdapter?.isCanonical() && (field === 'id' || foreignKeyFields?.has(field))) {
      const column = storageAdapter?.translateColumn(field) || field
      const outputName = field === 'id' ? 'id' : column
      const qualifiedColumn = alias ? `${alias}.${column}` : column
      return { [outputName]: databaseIdentityExpression(db, qualifiedColumn) }
    }
    const expression = normalizeStructuredSelect(translated, scope?.vars?.schemaInfo?.schemaStructure?.[field], db)
    if (expression === translated) return translated
    const outputName = storageAdapter?.translateColumn(field) || field
    return { [outputName]: expression }
  }

  const selectedQuery = buildQuerySelection(
    query,
    tableName,
    fieldSelectionInfo?.fieldsToSelect || [],
    useTablePrefix,
    { translateColumn }
  )

  const queryFieldRuntimeByField = await buildQueryFieldRuntimes({
    queryFieldNames: fieldSelectionInfo?.queryFieldsToSelect || [],
    queryFields: scope?.vars?.schemaInfo?.queryFields || {},
    schemaInfo: scope?.vars?.schemaInfo || {},
    tableName,
    storageAdapter,
    db,
    context,
    scopeName
  })

  for (const [fieldName, runtime] of queryFieldRuntimeByField.entries()) {
    selectedQuery.select({ [fieldName]: runtime.expression })
  }

  return {
    query: selectedQuery,
    queryFieldRuntimeByField
  }
}

/**
 * Select visible computed fields in request order, or declaration order when
 * no fieldset is supplied. Explicit selection includes normally-hidden fields.
 * @param {string} scopeName
 * @param {string | readonly string[] | null | undefined} requestedFields
 * @param {Record<string, { hidden?: boolean, normallyHidden?: boolean }> | undefined} computedFields
 * @returns {string[]}
 */
export const getRequestedComputedFields = (scopeName, requestedFields, computedFields) => {
  if (!computedFields) return []

  const requested = parseFieldset(requestedFields)
  if (requested === null) {
    return Object.entries(computedFields).filter(([, definition]) => {
      return definition.hidden !== true && definition.normallyHidden !== true
    }).map(([field]) => field)
  }

  return requested.filter(field => {
    if (!Object.hasOwn(computedFields, field)) return false
    const definition = computedFields[field]
    if (!definition) throw new Error(`Missing compiled computed definition '${scopeName}.${field}'`)
    return definition.hidden !== true
  })
}
