// @ts-check
/** @import { StorageDatabase, StorageFieldDefinition } from '../storage/storage-types.js' */
/** @import { CompiledQueryField, ProjectionExpression, ProjectionRequest, ProjectionRuntime, QueryFieldCompilation, QueryFieldDeclaration } from './query-field-types.js' */
import { getStorageColumn } from '../storage/storage-mapping.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'

// PostgreSQL json has no equality operator for DISTINCT parent selections.
/** @template {string | ProjectionExpression} T @param {T} expression @param {StorageFieldDefinition | undefined} definition @param {StorageDatabase | null} db @returns {T | import('knex').Knex.Raw<unknown>} */
export function normalizeStructuredSelect (expression, definition, db) {
  if (!db || !['pg', 'postgresql'].includes(db.client.config.client) || !['object', 'array'].includes(definition?.type || '')) return expression
  return typeof expression === 'string'
    ? db.raw('to_jsonb(??)', [expression])
    : db.raw('to_jsonb((?))', [expression])
}

/** Compile projection declarations against the final resource namespace.
 * @param {Record<string, QueryFieldDeclaration>} rawQueryFields
 * @param {QueryFieldCompilation} options
 * @returns {Record<string, CompiledQueryField>}
 */
export function compileQueryFields (rawQueryFields, { scopeName, schemaStructure, computed, schemaRelationships, idProperty }) {
  if (!rawQueryFields || typeof rawQueryFields !== 'object' || Array.isArray(rawQueryFields)) {
    throw new Error(`Invalid queryFields configuration for scope '${scopeName}'. Expected an object.`)
  }
  const reservedNames = new Set([
    'id', idProperty,
    ...Object.keys(schemaStructure),
    ...Object.keys(computed),
    ...Object.keys(schemaRelationships)
  ])
  for (const definition of Object.values(schemaStructure)) {
    if (definition.belongsTo && definition.as) reservedNames.add(definition.as)
  }
  /** @type {Array<[string, CompiledQueryField]>} */
  const normalized = []
  for (const [fieldName, fieldDef] of Object.entries(rawQueryFields)) {
    if (!fieldDef || typeof fieldDef !== 'object' || Array.isArray(fieldDef)) {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must be an object.`)
    }
    if (reservedNames.has(fieldName)) {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' conflicts with an existing schema, computed, or relationship name.`)
    }
    if (!fieldDef.type) {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must have a type.`)
    }
    if (fieldDef.storage !== undefined) {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' cannot declare storage. Projections select SQL values directly; put storage serializers on stored fields and use getters for public formatting.`)
    }
    const select = fieldDef.select || fieldDef.project
    if (typeof select !== 'function') {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' must define a select() function.`)
    }
    normalized.push([fieldName, {
      ...fieldDef,
      select,
      sortable: fieldDef.sortable === true,
      hidden: fieldDef.hidden === true,
      normallyHidden: fieldDef.normallyHidden === true
    }])
  }
  return Object.fromEntries(normalized)
}

/** @param {string} columnName @param {string} tableName */
function qualifyColumnReference (columnName, tableName) {
  if (!tableName || !columnName || columnName === '*' || String(columnName).includes('.')) {
    return columnName
  }

  return `${tableName}.${columnName}`
}

/** @param {ProjectionExpression} expression */
function normalizeQueryFieldSql (expression) {
  if (expression && typeof expression.toSQL === 'function') {
    const compiled = expression.toSQL()
    return {
      sql: compiled.sql,
      bindings: compiled.bindings || []
    }
  }

  throw new Error('Query field expressions must return knex raw, knex ref, or a knex query builder.')
}

/** @param {unknown} value @returns {value is ProjectionExpression} */
export function isImmediateExpression (value) {
  return value !== null && typeof value === 'object' && typeof Reflect.get(value, 'toSQL') === 'function'
}

/** @param {ProjectionRequest} [options] @returns {Promise<Map<string, ProjectionRuntime>>} */
export async function buildQueryFieldRuntimes ({
  queryFieldNames = [],
  queryFields = {},
  schemaInfo = {},
  tableName = '',
  storageAdapter = null,
  db = null,
  context = null,
  scopeName = ''
} = {}) {
  /** @type {Map<string, ProjectionRuntime>} */
  const runtimes = new Map()
  const seen = new Set()

  for (const fieldName of queryFieldNames) {
    if (!fieldName || seen.has(fieldName)) {
      continue
    }
    seen.add(fieldName)

    const fieldDef = queryFields[fieldName]
    if (!fieldDef) {
      throw new Error(`Unknown query field '${fieldName}' requested for '${scopeName}'.`)
    }

    /** @param {string} logicalField */
    const column = (logicalField) => {
      const translated = storageAdapter?.translateColumn?.(logicalField) || getStorageColumn(schemaInfo, logicalField)
      return qualifyColumnReference(translated, tableName)
    }

    try {
      const selectResult = fieldDef.select({
        knex: db,
        db,
        context,
        scopeName,
        tableName,
        fieldName,
        schemaInfo,
        adapter: storageAdapter,
        column,
        ref: (logicalField) => db?.ref ? db.ref(column(logicalField)) : column(logicalField)
      })

      const expression = isImmediateExpression(selectResult)
        ? selectResult
        : await selectResult

      if (expression === undefined || expression === null) {
        throw new Error(`Query field '${fieldName}' in scope '${scopeName}' returned an empty select expression.`)
      }

      const selectedExpression = normalizeStructuredSelect(expression, fieldDef, db)
      const { sql, bindings } = normalizeQueryFieldSql(selectedExpression)
      runtimes.set(fieldName, {
        fieldName,
        definition: fieldDef,
        schemaInfo,
        expression: selectedExpression,
        sql,
        bindings
      })
    } catch (error) {
      throw wrapUnexpectedError(error, {
        message: `Failed to select query field '${fieldName}' for scope '${scopeName}'`,
        context: { scopeName, fieldName, phase: 'projection' }
      })
    }
  }

  return runtimes
}
