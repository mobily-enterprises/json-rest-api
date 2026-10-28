import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { applyDatabaseReadOptions, normalizeStoredFieldValue } from '../querying-writing/database-value-normalizers.js'

const NUMERIC_TYPES = new Set(['number', 'integer', 'epochMilliseconds', 'epochSeconds'])
const ORDERED_TYPES = new Set([...NUMERIC_TYPES, 'string', 'email', 'uuid', 'date', 'dateTime', 'time'])
const SCALAR_TYPES = new Set([...ORDERED_TYPES, 'boolean', 'id'])
// Measure functions and the field types each accepts.
const MEASURES = {
  count: SCALAR_TYPES,
  countDistinct: SCALAR_TYPES,
  sum: NUMERIC_TYPES,
  avg: NUMERIC_TYPES,
  min: ORDERED_TYPES,
  max: ORDERED_TYPES,
}
const PARAMS = new Set(['groupBy', 'measures', 'queryParams', 'transaction'])
const QUERY_PARAMS = new Set(['filters', 'sort', 'page'])
const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const AGGREGATE_ALIAS = '__jra_aggregate'

const invalid = (field, message) => {
  throw new RestApiValidationError(message, { fields: [field], violations: [{ field, rule: 'aggregate', message }] })
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const isDecimal = definition => definition.type === 'number' && definition.precision !== undefined && definition.scale !== undefined

const positiveInteger = (value, field) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (!Number.isSafeInteger(number) || number < 1) invalid(field, `${field} must be a positive integer`)
  return number
}

/**
 * Validate an aggregate request against a resource's compiled schema.
 * Only stored scalar fields whose stored values are their public values qualify:
 * getters and storage serializers would make SQL group or sum other values than clients see.
 * @param {{ params: Record<string, any>, schemaInfo: Record<string, any>, scopeName: string, defaultLimit: number, maxLimit: number }} request
 */
export function compileAggregateRequest ({ params, schemaInfo, scopeName, defaultLimit, maxLimit }) {
  if (!isPlainObject(params)) invalid('params', 'aggregate requires a parameter object')
  for (const key of Object.keys(params)) {
    if (!PARAMS.has(key)) invalid(key, `Unknown aggregate parameter '${key}'`)
  }
  const { groupBy = [], measures, queryParams = {} } = params
  if (!isPlainObject(queryParams)) invalid('queryParams', 'queryParams must be an object')
  for (const key of Object.keys(queryParams)) {
    if (!QUERY_PARAMS.has(key)) invalid(`queryParams.${key}`, `aggregate does not support queryParams.${key}`)
  }

  const fields = schemaInfo.schemaStructure || {}
  const fieldDefinition = (name, parameter) => {
    const definition = typeof name === 'string' && Object.hasOwn(fields, name) ? fields[name] : null
    if (!definition || name === 'id' || name === schemaInfo.idProperty || definition.virtual === true || definition.hidden === true) {
      invalid(parameter, `'${name}' is not an attribute of '${scopeName}' that can be aggregated`)
    }
    if (typeof definition.getter === 'function' || definition.storage?.serialize) {
      invalid(parameter, `Field '${name}' transforms its stored values, so it cannot be aggregated`)
    }
    return definition
  }

  if (!Array.isArray(groupBy)) invalid('groupBy', 'groupBy must be an array of field names')
  const groups = groupBy.map((field, index) => {
    const definition = fieldDefinition(field, `groupBy.${index}`)
    if (!SCALAR_TYPES.has(definition.type)) invalid(`groupBy.${index}`, `Field '${field}' has type '${definition.type}' and cannot be grouped`)
    return { name: field, field, definition, alias: `g${index}` }
  })
  if (new Set(groupBy).size !== groupBy.length) invalid('groupBy', 'groupBy lists a field twice')

  if (!isPlainObject(measures) || !Object.keys(measures).length) invalid('measures', 'measures must name at least one measure')
  const names = new Set(groupBy)
  const measureList = Object.entries(measures).map(([name, spec], index) => {
    const parameter = `measures.${name}`
    if (!OUTPUT_NAME.test(name)) invalid(parameter, `Measure name '${name}' must be a letter or underscore followed by letters, digits or underscores`)
    if (names.has(name)) invalid(parameter, `Measure '${name}' has the name of a grouped field`)
    names.add(name)
    const entries = isPlainObject(spec) ? Object.entries(spec) : []
    if (entries.length !== 1 || !Object.hasOwn(MEASURES, entries[0][0])) {
      invalid(parameter, `Measure '${name}' must be one of { ${Object.keys(MEASURES).join(' | ')}: field }`)
    }
    const [fn, field] = entries[0]
    if (field === '*') {
      if (fn !== 'count') invalid(parameter, "Only count accepts '*'")
      return { name, fn, field, definition: null, alias: `m${index}` }
    }
    const definition = fieldDefinition(field, parameter)
    if (!MEASURES[fn].has(definition.type)) invalid(parameter, `${fn} cannot be applied to field '${field}' of type '${definition.type}'`)
    return { name, fn, field, definition, alias: `m${index}` }
  })

  const outputs = new Map([...groups, ...measureList].map(output => [output.name, output.alias]))
  const sortParam = queryParams.sort ?? []
  if (!Array.isArray(sortParam)) invalid('queryParams.sort', 'queryParams.sort must be an array')
  const sort = sortParam.map((entry, index) => {
    const name = typeof entry === 'string' ? entry.replace(/^-/, '') : null
    if (!outputs.has(name)) invalid(`queryParams.sort.${index}`, `Sort '${entry}' must name a grouped field or a measure`)
    return { alias: outputs.get(name), direction: entry.startsWith('-') ? 'desc' : 'asc' }
  })
  // Grouped fields break ties, so pages never overlap.
  for (const { alias } of groups) {
    if (!sort.some(entry => entry.alias === alias)) sort.push({ alias, direction: 'asc' })
  }

  let page = null
  if (groups.length) {
    const pageParam = queryParams.page ?? {}
    if (!isPlainObject(pageParam)) invalid('queryParams.page', 'queryParams.page must be an object')
    for (const key of Object.keys(pageParam)) {
      if (!['size', 'number'].includes(key)) invalid(`queryParams.page.${key}`, `aggregate pages support only size and number, not ${key}`)
    }
    const size = pageParam.size === undefined ? defaultLimit : positiveInteger(pageParam.size, 'queryParams.page.size')
    if (size > maxLimit) invalid('queryParams.page.size', `queryParams.page.size cannot exceed ${maxLimit}`)
    const number = pageParam.number === undefined ? 1 : positiveInteger(pageParam.number, 'queryParams.page.number')
    page = { size, number }
  } else if (queryParams.page !== undefined) {
    invalid('queryParams.page', 'An aggregate without groupBy returns one row and takes no page')
  }

  return { groups, measures: measureList, sort, page, scopeName }
}

const measureValue = (value, measure, resourceType) => {
  if (measure.fn === 'count' || measure.fn === 'countDistinct') return Number(value ?? 0)
  if (value == null) return null
  if (measure.fn === 'min' || measure.fn === 'max') return normalizeStoredFieldValue(value, measure.definition, { fieldName: measure.field, resourceType })
  // Drivers return numeric aggregates as strings; decimals keep theirs to avoid rounding.
  return isDecimal(measure.definition) ? value : Number(value)
}

/**
 * Run a compiled aggregate over the rows a filtered query selects.
 * The filtered query only supplies identifiers, so joins added by filters or
 * policies cannot repeat a row inside a group.
 * @param {{ source: import('knex').Knex.QueryBuilder, sourceTable: string, storageAdapter: Record<string, any>, db: import('knex').Knex | import('knex').Knex.Transaction, plan: ReturnType<typeof compileAggregateRequest> }} request
 */
export async function runAggregateQuery ({ source, sourceTable, storageAdapter, db, plan }) {
  const idColumn = storageAdapter.getIdColumn()
  const ids = source.clearSelect().clearOrder().select(`${sourceTable}.${idColumn}`)
  const query = storageAdapter.buildBaseQuery({ transaction: db, tableAlias: AGGREGATE_ALIAS })
    .whereIn(`${AGGREGATE_ALIAS}.${idColumn}`, ids)
  const column = field => `${AGGREGATE_ALIAS}.${storageAdapter.translateColumn(field)}`

  for (const group of plan.groups) {
    query.select({ [group.alias]: column(group.field) }).groupBy(column(group.field))
  }
  for (const measure of plan.measures) {
    query[measure.fn]({ [measure.alias]: measure.field === '*' ? '*' : column(measure.field) })
  }
  // NULL sorts as the lowest value, as MySQL and SQLite order it by default.
  const pg = ['pg', 'postgresql'].includes(db.client.config.client)
  for (const { alias, direction } of plan.sort) {
    if (pg) query.orderBy(alias, direction, direction === 'asc' ? 'first' : 'last')
    else query.orderBy(alias, direction)
  }
  if (plan.page) query.limit(plan.page.size + 1).offset((plan.page.number - 1) * plan.page.size)

  const rows = await applyDatabaseReadOptions(query)
  const hasMore = Boolean(plan.page && rows.length > plan.page.size)
  if (hasMore) rows.pop()

  const data = rows.map(row => {
    const result = {}
    for (const group of plan.groups) result[group.name] = normalizeStoredFieldValue(row[group.alias], group.definition, { fieldName: group.field, resourceType: plan.scopeName })
    for (const measure of plan.measures) result[measure.name] = measureValue(row[measure.alias], measure, plan.scopeName)
    return result
  })
  return plan.page ? { data, meta: { page: { ...plan.page, hasMore } } } : { data }
}
