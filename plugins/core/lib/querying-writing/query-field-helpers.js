import { getStorageColumn } from '../storage/storage-mapping.js'

function qualifyColumnReference (columnName, tableName) {
  if (!tableName || !columnName || columnName === '*' || String(columnName).includes('.')) {
    return columnName
  }

  return `${tableName}.${columnName}`
}

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

    const column = (logicalField) => {
      const translated = storageAdapter?.translateColumn?.(logicalField) || getStorageColumn(schemaInfo, logicalField)
      return qualifyColumnReference(translated, tableName)
    }

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

    const expression = (
      selectResult &&
      typeof selectResult === 'object' &&
      typeof selectResult.toSQL === 'function'
    )
      ? selectResult
      : await selectResult

    if (expression === undefined || expression === null) {
      throw new Error(`Query field '${fieldName}' in scope '${scopeName}' returned an empty select expression.`)
    }

    const { sql, bindings } = normalizeQueryFieldSql(expression)
    runtimes.set(fieldName, {
      fieldName,
      definition: fieldDef,
      expression,
      sql,
      bindings
    })
  }

  return runtimes
}
