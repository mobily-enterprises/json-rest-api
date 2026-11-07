import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { applyDatabaseReadOptions, normalizeStoredFieldValue } from '../querying-writing/database-value-normalizers.js'
import { databaseFamily } from '../storage/many-row-data-helpers.js'

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
const TEMPORAL_TYPES = new Set(['date', 'dateTime'])
const BUCKETS = new Set(['day', 'week', 'month', 'year'])
const UTC_NAMES = new Set(['UTC', 'Etc/UTC', '+00:00', '-00:00'])
const OFFSET = /^([+-])(\d{2}):(\d{2})$/
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]*$/
// Comparison operators of a measure's where, by SQL operator.
const WHERE_OPERATORS = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

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
  // A storage serializer changes what SQL sees; date and dateTime fields may still be
  // bucketed and take min/max, as SQL orders and truncates their stored temporal values.
  const fieldDefinition = (name, parameter, { serializedTemporal = false } = {}) => {
    const definition = typeof name === 'string' && Object.hasOwn(fields, name) ? fields[name] : null
    if (!definition || name === 'id' || name === schemaInfo.idProperty || definition.virtual === true || definition.hidden === true) {
      invalid(parameter, `'${name}' is not an attribute of '${scopeName}' that can be aggregated`)
    }
    const serialized = Boolean(definition.storage?.serialize) && !(serializedTemporal && TEMPORAL_TYPES.has(definition.type))
    if (typeof definition.getter === 'function' || serialized) {
      invalid(parameter, `Field '${name}' transforms its stored values, so it cannot be aggregated`)
    }
    return definition
  }

  if (!Array.isArray(groupBy)) invalid('groupBy', 'groupBy must be an array of field names or buckets')
  const names = new Set()
  const groups = groupBy.map((entry, index) => {
    const parameter = `groupBy.${index}`
    if (isPlainObject(entry)) return compileBucket(entry, { parameter, alias: `g${index}`, fieldDefinition, names })
    const definition = fieldDefinition(entry, parameter)
    if (!SCALAR_TYPES.has(definition.type)) invalid(parameter, `Field '${entry}' has type '${definition.type}' and cannot be grouped`)
    if (names.has(entry)) invalid('groupBy', 'groupBy lists a field twice')
    names.add(entry)
    return { name: entry, field: entry, definition, alias: `g${index}` }
  })

  if (!isPlainObject(measures) || !Object.keys(measures).length) invalid('measures', 'measures must name at least one measure')
  const measureList = Object.entries(measures).map(([name, spec], index) => {
    const parameter = `measures.${name}`
    if (!OUTPUT_NAME.test(name)) invalid(parameter, `Measure name '${name}' must be a letter or underscore followed by letters, digits or underscores`)
    if (names.has(name)) invalid(parameter, `Measure '${name}' has the name of a grouped field`)
    names.add(name)
    const { where, ...functions } = isPlainObject(spec) ? spec : {}
    const entries = Object.entries(functions)
    if (entries.length !== 1 || !Object.hasOwn(MEASURES, entries[0][0])) {
      invalid(parameter, `Measure '${name}' must be one of { ${Object.keys(MEASURES).join(' | ')}: field, where? }`)
    }
    const [fn, field] = entries[0]
    const condition = where === undefined ? null : compileWhere(where, { parameter: `${parameter}.where`, fieldDefinition })
    if (field === '*') {
      if (fn !== 'count') invalid(parameter, "Only count accepts '*'")
      return { name, fn, field, definition: null, alias: `m${index}`, where: condition }
    }
    const definition = fieldDefinition(field, parameter, { serializedTemporal: fn === 'min' || fn === 'max' })
    if (!MEASURES[fn].has(definition.type)) invalid(parameter, `${fn} cannot be applied to field '${field}' of type '${definition.type}'`)
    return { name, fn, field, definition, alias: `m${index}`, where: condition }
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

/**
 * A time bucket: { field, bucket: day | week | month | year, timezone?, as? }.
 * Buckets come out as the 'YYYY-MM-DD' of their first day (weeks start on Monday).
 */
function compileBucket (entry, { parameter, alias, fieldDefinition, names }) {
  const { field, bucket, timezone, as, ...unknown } = entry
  if (Object.keys(unknown).length) invalid(parameter, `Unknown bucket options: ${Object.keys(unknown).join(', ')}`)
  if (!BUCKETS.has(bucket)) invalid(`${parameter}.bucket`, `bucket must be one of ${[...BUCKETS].join(', ')}`)
  const definition = fieldDefinition(field, `${parameter}.field`, { serializedTemporal: true })
  if (!TEMPORAL_TYPES.has(definition.type)) invalid(`${parameter}.field`, `Field '${field}' has type '${definition.type}'; buckets need a date or dateTime field`)
  const zone = compileTimezone(timezone, `${parameter}.timezone`)
  if (definition.type === 'date' && zone.kind !== 'utc') invalid(`${parameter}.timezone`, 'A date field has no time of day, so it takes no timezone')
  const name = as ?? field
  if (typeof name !== 'string' || !OUTPUT_NAME.test(name)) invalid(`${parameter}.as`, 'as must be a letter or underscore followed by letters, digits or underscores')
  if (names.has(name)) invalid(parameter, `groupBy names '${name}' twice; give the bucket another name with as`)
  names.add(name)
  return { name, field, definition, alias, bucket, timezone: zone }
}

// 'UTC' (default), a fixed offset '±HH:MM', or an IANA zone name.
function compileTimezone (timezone, parameter) {
  if (timezone === undefined || UTC_NAMES.has(timezone)) return { kind: 'utc' }
  if (typeof timezone !== 'string') invalid(parameter, 'timezone must be a string')
  const offset = OFFSET.exec(timezone)
  if (offset) {
    const [, sign, hours, minutes] = offset
    if (Number(hours) > 14 || Number(minutes) > 59) invalid(parameter, `'${timezone}' is not a UTC offset`)
    return { kind: 'offset', minutes: (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) }
  }
  let known = ZONE_NAME.test(timezone)
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    known = false
  }
  if (!known) invalid(parameter, `'${timezone}' is not a time zone: use 'UTC', an offset such as '+10:00', or an IANA name`)
  return { kind: 'named', name: timezone }
}

/**
 * A measure's where: { field: value | [values] | null | { eq, ne, gt, gte, lt, lte, in, notIn } },
 * every entry required. Compiled to the condition of a CASE, so one query computes
 * conditional and unconditional measures together.
 */
function compileWhere (where, { parameter, fieldDefinition }) {
  if (!isPlainObject(where) || !Object.keys(where).length) invalid(parameter, 'where must map fields to conditions')
  const conditions = []
  for (const [field, condition] of Object.entries(where)) {
    const definition = fieldDefinition(field, `${parameter}.${field}`)
    if (!SCALAR_TYPES.has(definition.type)) invalid(`${parameter}.${field}`, `Field '${field}' has type '${definition.type}' and cannot be compared`)
    const add = (operator, value) => {
      if (operator === 'in' || operator === 'notIn') {
        if (!Array.isArray(value) || !value.length || value.some(item => item === null || typeof item === 'object')) {
          invalid(`${parameter}.${field}.${operator}`, `${operator} takes a non-empty array of scalar values`)
        }
      } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        invalid(`${parameter}.${field}`, 'Conditions compare scalar values')
      } else if (value === null && operator !== 'eq' && operator !== 'ne') {
        invalid(`${parameter}.${field}.${operator}`, `${operator} cannot compare with null`)
      }
      conditions.push({ field, definition, operator, value })
    }
    if (Array.isArray(condition)) add('in', condition)
    else if (isPlainObject(condition)) {
      const entries = Object.entries(condition)
      if (!entries.length) invalid(`${parameter}.${field}`, 'A condition needs an operator')
      for (const [operator, value] of entries) {
        if (!Object.hasOwn(WHERE_OPERATORS, operator) && operator !== 'in' && operator !== 'notIn') {
          invalid(`${parameter}.${field}.${operator}`, `Unknown operator '${operator}': use ${[...Object.keys(WHERE_OPERATORS), 'in', 'notIn'].join(', ')}`)
        }
        add(operator, value)
      }
    } else add('eq', condition)
  }
  return conditions
}

/** SQL and bindings for a compiled where, against qualified columns. */
function whereSql (conditions, { column, storageAdapter }) {
  const parts = []
  const bindings = []
  for (const { field, operator, value } of conditions) {
    const target = column(field)
    if (value === null) {
      parts.push(operator === 'eq' ? '?? is null' : '?? is not null')
      bindings.push(target)
    } else if (operator === 'in' || operator === 'notIn') {
      const values = storageAdapter.translateFilterValue(field, value)
      parts.push(`?? ${operator === 'in' ? 'in' : 'not in'} (${values.map(() => '?').join(', ')})`)
      bindings.push(target, ...values)
    } else {
      parts.push(`?? ${WHERE_OPERATORS[operator]} ?`)
      bindings.push(target, storageAdapter.translateFilterValue(field, value))
    }
  }
  return { sql: parts.join(' and '), bindings }
}

/**
 * The bucket of a stored date or dateTime, as 'YYYY-MM-DD' text. Values are
 * stored in UTC: SQLite holds epoch milliseconds (or ISO text), MySQL DATETIME
 * and PostgreSQL timestamptz or date. Offsets and zone names are validated and
 * written into the SQL, so GROUP BY repeats the selected expression exactly
 * (PostgreSQL cannot match two expressions that differ in bound parameters).
 * The only bindings are the column identifier.
 */
function bucketSql ({ family, column, bucket, timezone, type }) {
  const minutes = timezone.kind === 'offset' ? timezone.minutes : 0
  if (family === 'pg') {
    let local = type === 'date' ? 'cast(?? as timestamp)' : "(?? at time zone 'UTC')"
    if (timezone.kind === 'offset') local = `(${local} + interval '${minutes} minutes')`
    if (timezone.kind === 'named') local = `(?? at time zone '${timezone.name}')`
    return { sql: `to_char(date_trunc('${bucket}', ${local}), 'YYYY-MM-DD')`, bindings: [column] }
  }
  if (family === 'mysql') {
    let local = '??'
    if (timezone.kind === 'offset') local = `(?? + interval ${minutes} minute)`
    if (timezone.kind === 'named') local = `convert_tz(??, '+00:00', '${timezone.name}')`
    if (bucket === 'week') return { sql: `date_format(${local} - interval weekday(${local}) day, '%Y-%m-%d')`, bindings: [column, column] }
    const format = { day: '%Y-%m-%d', month: '%Y-%m-01', year: '%Y-01-01' }[bucket]
    return { sql: `date_format(${local}, '${format}')`, bindings: [column] }
  }
  // SQLite: epoch milliseconds (the drivers bind dates as numbers) or ISO text.
  let local = "(case when typeof(??) in ('integer', 'real') then datetime(?? / 1000.0, 'unixepoch') else datetime(??) end)"
  if (timezone.kind === 'offset') local = `datetime(${local}, '${minutes >= 0 ? '+' : ''}${minutes} minutes')`
  const bindings = [column, column, column]
  if (bucket === 'week') return { sql: `date(${local}, '-6 days', 'weekday 1')`, bindings }
  const format = { day: '%Y-%m-%d', month: '%Y-%m-01', year: '%Y-01-01' }[bucket]
  return { sql: `strftime('${format}', ${local})`, bindings }
}

// Zone names need the server's zone data: PostgreSQL has it; MySQL only with
// loaded time zone tables (checked once per name); SQLite has none.
async function checkNamedZones ({ db, family, plan }) {
  const names = [...new Set(plan.groups.filter(group => group.timezone?.kind === 'named').map(group => group.timezone.name))]
  for (const name of names) {
    if (family === 'sqlite') {
      invalid('groupBy', `SQLite has no time zone data: use 'UTC' or a fixed offset instead of '${name}'`)
    }
    if (family === 'mysql') {
      const [rows] = await db.raw("select convert_tz('2000-01-01 00:00:00', '+00:00', ?) as converted", [name])
      if (rows?.[0]?.converted == null) {
        invalid('groupBy', `The MySQL server has no time zone data for '${name}': load its time zone tables or use a fixed offset`)
      }
    }
  }
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
 * @param {{ source: import('knex').Knex.QueryBuilder, sourceTable: string, storageAdapter: Record<string, any>, db: import('knex').Knex | import('knex').Knex.Transaction, plan: import('../storage/storage-types.js').AggregatePlan }} request
 */
export async function runAggregateQuery ({ source, sourceTable, storageAdapter, db, plan }) {
  const family = databaseFamily(db)
  if (plan.groups.some(group => group.bucket) && storageAdapter.isCanonical()) {
    invalid('groupBy', 'Date buckets need table storage; AnyAPI resources group by stored values only')
  }
  await checkNamedZones({ db, family, plan })
  const idColumn = storageAdapter.getIdColumn()
  const ids = source.clearSelect().clearOrder().select(`${sourceTable}.${idColumn}`)
  const query = storageAdapter.buildBaseQuery({ transaction: db, tableAlias: AGGREGATE_ALIAS })
    .whereIn(`${AGGREGATE_ALIAS}.${idColumn}`, ids)
  const column = field => `${AGGREGATE_ALIAS}.${storageAdapter.translateColumn(field)}`

  for (const group of plan.groups) {
    if (group.bucket) {
      const { sql, bindings } = bucketSql({ family, column: column(group.field), bucket: group.bucket, timezone: group.timezone, type: group.definition.type })
      query.select(db.raw(`${sql} as ??`, [...bindings, group.alias])).groupByRaw(sql, bindings)
    } else {
      query.select({ [group.alias]: column(group.field) }).groupBy(column(group.field))
    }
  }
  for (const measure of plan.measures) {
    if (!measure.where) {
      query[measure.fn]({ [measure.alias]: measure.field === '*' ? '*' : column(measure.field) })
      continue
    }
    // Conditional measures aggregate a CASE that is NULL outside the condition.
    const condition = whereSql(measure.where, { column, storageAdapter })
    const value = measure.field === '*' ? { sql: '1', bindings: [] } : { sql: '??', bindings: [column(measure.field)] }
    const fn = { countDistinct: 'count(distinct ', count: 'count(', sum: 'sum(', avg: 'avg(', min: 'min(', max: 'max(' }[measure.fn]
    query.select(db.raw(`${fn}case when ${condition.sql} then ${value.sql} end) as ??`, [...condition.bindings, ...value.bindings, measure.alias]))
  }
  // NULL sorts as the lowest value, as MySQL and SQLite order it by default.
  const pg = family === 'pg'
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
    for (const group of plan.groups) {
      result[group.name] = group.bucket
        ? (row[group.alias] == null ? null : String(row[group.alias]))
        : normalizeStoredFieldValue(row[group.alias], group.definition, { fieldName: group.field, resourceType: plan.scopeName })
    }
    for (const measure of plan.measures) result[measure.name] = measureValue(row[measure.alias], measure, plan.scopeName)
    return result
  })
  return plan.page ? { data, meta: { page: { ...plan.page, hasMore } } } : { data }
}
