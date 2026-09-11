import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { ROW_NUMBER_KEY, DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_MAX_INCLUDE_LIMIT } from '../querying-writing/knex-constants.js'
import { prepareReferenceSortColumns } from './knex-query-helpers.js'
import { buildEffectiveSortList, parseSortEntry, resolveSortField } from './query-field-sort-helpers.js'
import { applyDatabaseReadOptions, databaseIdentityExpression } from '../querying-writing/database-value-normalizers.js'

// Apply ordering and limits after target/pivot visibility has constrained the query.
export async function applyIncludeQueryConfig ({ query, scopeName, tableName, parentColumn, includeConfig = {}, context = {}, capabilities, queryFieldRuntimeByField = new Map() }, dependencies) {
  const { scopes, knex, getStorageAdapter } = dependencies
  const db = context.db || context.transaction || knex
  const vars = scopes[scopeName].vars
  const storageAdapter = getStorageAdapter(scopeName)
  const fields = buildEffectiveSortList(includeConfig.orderBy, { defaultSort: vars.defaultSort, schemaInfo: vars.schemaInfo }).map(parseSortEntry)
  const references = await prepareReferenceSortColumns({
    query,
    fields: fields.map(({ field }) => field).filter(field => !queryFieldRuntimeByField.has(field)),
    scopeName,
    tableAlias: tableName,
    context
  }, dependencies)
  const names = new Set([
    ...Object.keys(vars.schemaInfo?.queryFields || {}),
    ...Object.keys(vars.schemaInfo.schemaStructure).flatMap(field => [field, storageAdapter.translateColumn(field)]),
    ...[...references.values()].map(reference => reference.resultColumn)
  ])
  const uniqueName = base => {
    let name = base
    while (names.has(name)) name += '_'
    names.add(name)
    return name
  }
  const parentResultColumn = uniqueName('__jra_include_parent')
  const rowNumberColumn = uniqueName(ROW_NUMBER_KEY)
  query.select({ [parentResultColumn]: typeof parentColumn === 'string' ? databaseIdentityExpression(db, parentColumn) : parentColumn })
  const ordering = fields.map(({ field, sqlDirection }) => {
    const runtime = queryFieldRuntimeByField.get(field)
    if (runtime) {
      return {
        sql: `(${runtime.sql}) IS NULL ASC, (${runtime.sql}) ${sqlDirection}`,
        bindings: [...runtime.bindings, ...runtime.bindings]
      }
    }
    const actualField = resolveSortField(field, vars.schemaInfo)
    const column = references.get(field)?.column || `${tableName}.${storageAdapter.translateColumn(actualField)}`
    return { sql: `?? IS NULL ASC, ?? ${sqlDirection}`, bindings: [column, column] }
  })
  const orderSql = ordering.map(order => order.sql).join(', ')
  const orderBindings = ordering.flatMap(order => order.bindings)
  const requested = includeConfig.limit
  const limit = requested === null || requested === false
    ? null
    : Math.min(requested ?? vars.queryDefaultLimit ?? DEFAULT_QUERY_LIMIT,
      vars.queryMaxLimit ?? DEFAULT_MAX_QUERY_LIMIT, vars.maxIncludeLimit ?? DEFAULT_MAX_INCLUDE_LIMIT)
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error(`Invalid include limit for ${scopeName}: expected a non-negative integer or null`)

  if (includeConfig.strategy === 'window' && limit !== null) {
    if (capabilities?.windowFunctions === false) throw new RestApiResourceError('Per-parent include limits require window function support', { subtype: 'unsupported_operation' })
    query.select(db.raw(`ROW_NUMBER() OVER (PARTITION BY ?? ORDER BY ${orderSql}) as ??`, [parentColumn, ...orderBindings, rowNumberColumn]))
    query = db.select('*').from(query.as('_windowed')).where(rowNumberColumn, '<=', limit)
      .orderBy(parentResultColumn).orderBy(rowNumberColumn)
  } else {
    query.orderByRaw(orderSql, orderBindings)
    if (limit !== null) query.limit(limit)
  }
  return {
    query: applyDatabaseReadOptions(query),
    parentColumn: parentResultColumn,
    temporaryFields: [parentResultColumn, rowNumberColumn, ...[...references.values()].map(reference => reference.resultColumn)]
  }
}
