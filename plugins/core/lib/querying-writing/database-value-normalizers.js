import { createSchema } from 'json-rest-schema'
import { RestApiTemporalDataError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { filterResponseFields } from './field-utils.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'
import { COMPUTED_DEPENDENCIES_KEY } from './knex-constants.js'
import { getTemporalStorageCapabilities, SERIALIZATION_CAPABILITIES } from './database-capabilities.js'

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RFC3339_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const SQL_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)(?:([+-])([01]\d|2[0-3])(?::([0-5]\d))?(?::([0-5]\d))?)?( BC)?$/
const INTEGER_VALUE_PATTERN = /^-?\d+$/
const temporalContractCache = new Map()
const CACHED_TEMPORAL_TYPES = new Set(['date', 'dateTime', 'time', 'epochMilliseconds', 'epochSeconds'])

export function applyDatabaseReadOptions (query) {
  const client = query.client.config.client
  if (client === 'pg' || client === 'postgresql') {
    const types = query.client.config.connection?.types || query.client.driver.types
    query.options({
      types: {
        getTypeParser: (oid, format) => [1082, 1114, 1184].includes(oid) && format !== 'binary'
          ? value => value
          : types.getTypeParser(oid, format)
      }
    })
  } else if (client === 'mysql' || client === 'mysql2') {
    query.options({ dateStrings: true, supportBigNumbers: true })
  }
  return query
}

// SQLite's driver decodes INTEGER as Number. Preserve only values it cannot represent.
// Keep this in SELECT/RETURNING expressions; predicates and ordering use native columns.
export function databaseIdentityExpression (db, column) {
  if (!['better-sqlite3', 'sqlite3'].includes(db.client.config.client)) return column
  return db.raw("CASE WHEN typeof(??) = 'integer' AND (?? > 9007199254740991 OR ?? < -9007199254740991) THEN CAST(?? AS TEXT) ELSE ?? END", [column, column, column, column, column])
}

const limitFractionalSecondPrecision = (value, temporalPrecision) => {
  if (!Number.isInteger(temporalPrecision)) return value

  return value.replace(
    /(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z)?$/,
    (_match, wholeSeconds, fraction = '', utcSuffix = '') => {
      const limitedFraction = fraction.slice(0, temporalPrecision)
      return `${wholeSeconds}${limitedFraction ? `.${limitedFraction}` : ''}${utcSuffix}`
    }
  )
}

const getTemporalContract = (type, temporalPrecision) => {
  const cacheKey = `${type}:${Number.isInteger(temporalPrecision) ? temporalPrecision : 'default'}`
  // Cache common SQL precision; unusual declarations retain validation without permanent entries.
  const cacheable = CACHED_TEMPORAL_TYPES.has(type) &&
    (!Number.isInteger(temporalPrecision) || (temporalPrecision >= 0 && temporalPrecision <= 6))
  if (cacheable && temporalContractCache.has(cacheKey)) return temporalContractCache.get(cacheKey)
  const contract = createSchema({
    value: {
      type,
      ...(Number.isInteger(temporalPrecision) ? { temporalPrecision } : {})
    }
  })
  if (cacheable) temporalContractCache.set(cacheKey, contract)
  return contract
}

const throwTemporalDataError = ({ fieldName, resourceType, type, source }) => {
  throw new RestApiTemporalDataError({
    field: fieldName,
    resourceType,
    fieldType: type,
    source
  })
}

const validateTemporalJsonValue = (value, type, {
  temporalPrecision,
  fieldName,
  resourceType,
  source
} = {}) => {
  const { validatedObject, errors } = getTemporalContract(type, temporalPrecision).patch({ value })
  if (Object.keys(errors).length > 0) {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }
  return validatedObject.value
}

const parseEpochDatabaseValue = (value) => {
  let epochValue = null
  if (typeof value === 'number' && Number.isInteger(value)) {
    epochValue = value
  } else if (typeof value === 'bigint') {
    epochValue = Number(value)
  } else if (typeof value === 'string' && INTEGER_VALUE_PATTERN.test(value.trim())) {
    epochValue = Number(value.trim())
  }

  if (!Number.isSafeInteger(epochValue)) return null
  const parsed = new Date(epochValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const parseKnownDatabaseDate = (value, { fieldName, resourceType, type, source }) => {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value.toISOString()
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }

  const epochDate = parseEpochDatabaseValue(value)
  if (epochDate) return epochDate.toISOString()

  if (typeof value !== 'string') {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }

  const trimmed = value.trim()
  const sqlMatch = SQL_DATETIME_PATTERN.exec(trimmed)
  const rfc3339Match = RFC3339_DATETIME_PATTERN.exec(trimmed)
  let dateTimeValue = null
  let offsetSeconds = 0

  if (sqlMatch) {
    const date = sqlMatch[7] && sqlMatch[1].startsWith('0001-')
      ? sqlMatch[1].replace(/^0001/, '0000')
      : sqlMatch[1]
    if (sqlMatch[7] && !sqlMatch[1].startsWith('0001-')) {
      throwTemporalDataError({ fieldName, resourceType, type, source })
    }
    dateTimeValue = `${date}T${sqlMatch[2]}Z`
    offsetSeconds = (Number(sqlMatch[4] || 0) * 3600 + Number(sqlMatch[5] || 0) * 60 + Number(sqlMatch[6] || 0)) * (sqlMatch[3] === '-' ? -1 : 1)
  } else if (rfc3339Match) {
    dateTimeValue = trimmed
  }

  if (!dateTimeValue) {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }

  validateTemporalJsonValue(dateTimeValue, 'dateTime', {
    fieldName,
    resourceType,
    source
  })
  const parsed = new Date(new Date(dateTimeValue).getTime() - offsetSeconds * 1000)
  if (Number.isNaN(parsed.getTime())) {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }
  // Date handles the offset, but cannot retain digits beyond milliseconds.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(dateTimeValue)?.[1]
  return fraction
    ? parsed.toISOString().replace(/\.\d{3}Z$/, `.${fraction.padEnd(3, '0')}Z`)
    : parsed.toISOString()
}

/**
 * Converts a database temporal value to the public JSON representation used by
 * json-rest-schema: YYYY-MM-DD for date, RFC 3339 for dateTime, and an
 * offset-free string for time.
 */
export function normalizeDateValue (value, type, {
  temporalPrecision,
  fieldName,
  resourceType,
  source = 'database'
} = {}) {
  if (value === null || value === undefined) return null

  if (type === 'time') {
    let timeValue = null
    if (typeof value === 'string') {
      timeValue = limitFractionalSecondPrecision(value.trim(), temporalPrecision)
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      timeValue = limitFractionalSecondPrecision(value.toISOString().slice(11, -1), temporalPrecision)
    }
    const validated = validateTemporalJsonValue(timeValue, type, {
      temporalPrecision,
      fieldName,
      resourceType,
      source
    })
    const [whole, fraction = ''] = validated.split('.')
    const seconds = whole.length === 5 ? `${whole}:00` : whole
    const digits = Number.isInteger(temporalPrecision) ? fraction.padEnd(temporalPrecision, '0') : fraction.replace(/0+$/, '')
    return `${seconds}${digits ? `.${digits}` : ''}`
  }

  const dateValue = typeof value === 'string' ? value.trim().replace(/^0001-(\d{2}-\d{2}) BC$/, '0000-$1') : value
  if (type === 'date' && typeof dateValue === 'string' && DATE_VALUE_PATTERN.test(dateValue)) {
    return validateTemporalJsonValue(dateValue, type, {
      fieldName,
      resourceType,
      source
    })
  }

  const isoValue = parseKnownDatabaseDate(value, { fieldName, resourceType, type, source })
  const normalized = type === 'date'
    ? isoValue.slice(0, 10)
    : limitFractionalSecondPrecision(isoValue.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'), temporalPrecision)
  return validateTemporalJsonValue(normalized, type, {
    temporalPrecision,
    fieldName,
    resourceType,
    source
  })
}

/**
 * Converts structured JSON and temporal values to the values expected by
 * database drivers. JSON schema validation keeps date and dateTime values as
 * strings; database writes and comparisons must normalize them consistently.
 * Time values remain strings because database drivers accept their wire shape.
 * @param {unknown} value
 * @param {string | undefined} type
 * @param {{ databaseClient?: string, textStorage?: boolean, temporalPrecision?: number, fieldName?: string, resourceType?: string, source?: string }} [options]
 * @returns {unknown}
 */
export function normalizeValueForDatabaseStorage (value, type, {
  databaseClient,
  textStorage = false,
  temporalPrecision,
  fieldName,
  resourceType,
  source = 'storage'
} = {}) {
  if (SERIALIZATION_CAPABILITIES.structuredTypes.includes(type)) {
    const structured = normalizeStructuredValue(value, type, { fieldName, resourceType, source })
    try {
      return structured == null ? structured : JSON.stringify(structured)
    } catch (error) {
      throw wrapUnexpectedError(error, {
        message: `Cannot serialize ${type} field '${[resourceType, fieldName].filter(Boolean).join('.')}' as JSON`,
        context: { fieldName, resourceType, source, phase: 'serialization' }
      })
    }
  }
  if (!['date', 'dateTime', 'time'].includes(type)) return value
  if (value === null || value === undefined) return null
  const capabilities = getTemporalStorageCapabilities(databaseClient, { textStorage })

  if (type === 'time') {
    if (typeof value !== 'string') {
      throwTemporalDataError({ fieldName, resourceType, type, source })
    }
    const validated = validateTemporalJsonValue(value, type, {
      temporalPrecision,
      fieldName,
      resourceType,
      source
    })
    const normalized = normalizeDateValue(validated, type, { temporalPrecision, fieldName, resourceType, source })
    if (capabilities.timeFractionDigits !== null && (normalized.split('.')[1]?.length || 0) > capabilities.timeFractionDigits) {
      const field = fieldName ? `data.attributes.${fieldName}` : 'value'
      throw new RestApiValidationError('SQL time storage supports at most six fractional digits.', {
        fields: [field],
        violations: [{ field, rule: 'storage_precision', message: 'Use a text storage mapping for finer time precision.' }]
      })
    }
    return normalized
  }

  let publicValue = value
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throwTemporalDataError({ fieldName, resourceType, type, source })
    }
    publicValue = type === 'date'
      ? value.toISOString().slice(0, 10)
      : limitFractionalSecondPrecision(value.toISOString(), temporalPrecision)
  }

  const validatedValue = validateTemporalJsonValue(publicValue, type, {
    temporalPrecision,
    fieldName,
    resourceType,
    source
  })
  if (type === 'date' && textStorage) return validatedValue
  const fraction = type === 'dateTime'
    ? /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(validatedValue)?.[1]
    : null
  if (fraction && /[1-9]/.test(fraction.slice(capabilities.dateTimeFractionDigits))) {
    const field = fieldName ? `data.attributes.${fieldName}` : 'value'
    throw new RestApiValidationError('Built-in dateTime storage supports millisecond precision.', {
      fields: [field],
      violations: [{
        field,
        rule: 'storage_precision',
        message: 'Submillisecond values require a custom storage serializer.'
      }]
    })
  }
  const databaseValue = new Date(
    type === 'date' ? `${validatedValue}T00:00:00Z` : validatedValue
  )
  if (Number.isNaN(databaseValue.getTime())) {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }
  if (databaseValue.getUTCFullYear() < 0 || databaseValue.getUTCFullYear() > capabilities.maxYear) {
    const field = fieldName ? `data.attributes.${fieldName}` : 'value'
    throw new RestApiValidationError('UTC dateTime must remain within years 0000 through 9999.', {
      fields: [field],
      violations: [{ field, rule: 'storage_range', message: 'The timezone offset moves this value outside the public dateTime range.' }]
    })
  }
  if (databaseClient === 'pg' || databaseClient === 'postgresql') {
    const iso = databaseValue.toISOString()
    const sqlValue = type === 'date' ? iso.slice(0, 10) : iso.replace('T', ' ')
    return sqlValue.startsWith('0000-') ? `${sqlValue.replace(/^0000/, '0001')} BC` : sqlValue
  }
  if (databaseClient === 'mysql' || databaseClient === 'mysql2') {
    if (databaseValue.getUTCFullYear() < (type === 'date' ? capabilities.dateMinYear : capabilities.dateTimeMinYear)) {
      const field = fieldName ? `data.attributes.${fieldName}` : 'value'
      throw new RestApiValidationError('MySQL date storage supports years 1000 through 9999.', {
        fields: [field],
        violations: [{ field, rule: 'storage_range', message: 'Use a custom storage mapping for dates outside the MySQL date range.' }]
      })
    }
    const iso = databaseValue.toISOString()
    return type === 'date' ? iso.slice(0, 10) : iso.replace('T', ' ').replace(/Z$/, '')
  }
  return databaseValue
}

export function normalizeStructuredValue (value, type, { fieldName, resourceType, source = 'database' } = {}) {
  if (value === null || value === undefined) return value
  try {
    // Writes receive logical values; only reads decode a driver's JSON text.
    const parsed = source !== 'storage' && typeof value === 'string' ? JSON.parse(value) : value
    const valid = type === 'array'
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(parsed))
    if (!valid) throw new TypeError(`Expected a JSON ${type}`)
    return parsed
  } catch (error) {
    throw wrapUnexpectedError(error, {
      message: `Invalid ${source} value for ${type} field '${[resourceType, fieldName].filter(Boolean).join('.')}'`,
      context: { fieldName, resourceType, source, phase: 'normalization' }
    })
  }
}

/**
 * Normalizes database values in an attributes object
 *
 * @param {Object} attributes - The attributes object to normalize
 * @param {Object} schemaStructure - The schema structure defining field types
 * @returns {Object} The normalized attributes object
 */
export function normalizeAttributes (attributes, schemaStructure, {
  resourceType,
  source = 'database'
} = {}) {
  if (!attributes || !schemaStructure) {
    return attributes
  }

  const normalized = { ...attributes }

  // Iterate through each attribute
  for (const [fieldName, value] of Object.entries(attributes)) {
    const fieldDef = schemaStructure[fieldName]

    // Skip if no field definition found
    if (!fieldDef) continue

    if (['object', 'array'].includes(fieldDef.type)) {
      // A custom getter owns decoding its stored representation.
      if (source === 'database' && typeof fieldDef.getter === 'function') continue
      normalized[fieldName] = normalizeStructuredValue(value, fieldDef.type, { fieldName, resourceType, source })
      continue
    }

    if (fieldDef.type === 'file' && value instanceof Uint8Array) {
      if (source === 'database' && typeof fieldDef.getter === 'function') continue
      try {
        normalized[fieldName] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value)
      } catch (error) {
        throw wrapUnexpectedError(error, {
          message: `Invalid ${source} file handle '${[resourceType, fieldName].filter(Boolean).join('.')}'`,
          context: { fieldName, resourceType, source, phase: 'normalization' }
        })
      }
    }

    // Normalize boolean values
    if (fieldDef.type === 'boolean') {
      if (value === 1 || value === '1') {
        normalized[fieldName] = true
      } else if (value === 0 || value === '0') {
        normalized[fieldName] = false
      }
      // null/undefined remain as-is
    }

    // Normalize date/dateTime/time values
    if (fieldDef.type === 'date' || fieldDef.type === 'dateTime' || fieldDef.type === 'time') {
      normalized[fieldName] = normalizeDateValue(value, fieldDef.type, {
        temporalPrecision: fieldDef.temporalPrecision,
        fieldName,
        resourceType,
        source
      })
    } else if (['epochMilliseconds', 'epochSeconds'].includes(fieldDef.type) && value != null) {
      normalized[fieldName] = validateTemporalJsonValue(
        typeof value === 'bigint' ? String(value) : value,
        fieldDef.type,
        { fieldName, resourceType, source }
      )
    }
  }

  return normalized
}

/**
 * Normalize a JSON:API document or one plain resource using compiled output fields.
 * JSON:API primary/included attributes are replaced on the supplied document;
 * plain resources are copied recursively with shared/cyclic identities tracked.
 * The source distinguishes database conversion from final-response validation.
 * Final response normalization removes internal enrichment metadata and reapplies
 * the supplied fieldset so dependency-only values do not escape in output.
 *
 * @template T
 * @param {T} record - JSON:API document, or a plain resource in simplified mode
 * @param {Object} scopes - Resource registry for schema lookup
 * @param {Object} [options]
 * @param {string} [options.source='database'] - Value origin for normalization
 * @param {boolean} [options.simplified=false] - Internal plain-resource selector
 * @param {string} [options.resourceType] - Required for plain-resource schema lookup
 * @param {Object} [options.fields] - Selected fieldsets, if supplied
 * @returns {T} Normalized document or plain resource
 */
export function normalizeRecordAttributes (record, scopes, {
  source = 'database',
  simplified = false,
  resourceType,
  fields
} = {}) {
  if (!record || !scopes) {
    return record
  }

  if (simplified) {
    return normalizeSimplifiedRecord(record, resourceType, scopes, { source, fields })
  }

  const normalizeEntry = (entry) => {
    // Discard enrichment metadata after finish hooks have run.
    if (source === 'response' && entry && typeof entry === 'object') delete entry[COMPUTED_DEPENDENCIES_KEY]
    const schemaInfo = scopes[entry?.type]?.vars?.schemaInfo
    if (!schemaInfo || !entry?.attributes) return

    entry.attributes = normalizeAttributes(
      entry.attributes,
      schemaInfo.outputFields,
      {
        resourceType: entry.type,
        source
      }
    )
  }

  // Normalize main data records
  if (record.data) {
    if (Array.isArray(record.data)) {
      // Handle array of records (query result)
      for (const entry of record.data) {
        normalizeEntry(entry)
      }
    } else {
      // Handle single record (get result)
      normalizeEntry(record.data)
    }
  }

  // Normalize included records
  if (record.included && Array.isArray(record.included)) {
    for (const entry of record.included) {
      normalizeEntry(entry)
    }
  }

  if (fields) filterResponseFields(record, fields)
  return record
}

function normalizeSimplifiedRecord (record, resourceType, scopes, options, visited = new WeakMap()) {
  if (!record || typeof record !== 'object') return record
  if (visited.has(record)) return visited.get(record)
  const schemaInfo = scopes[resourceType]?.vars?.schemaInfo
  if (!schemaInfo) return record

  const normalized = normalizeAttributes(record, schemaInfo.outputFields, { ...options, resourceType })
  visited.set(record, normalized)
  for (const [name, definition] of Object.entries(schemaInfo.outputRelationships || {})) {
    const normalizeRelated = (entry) => normalizeSimplifiedRecord(
      entry,
      definition.belongsToPolymorphic
        ? entry?._type
        : definition.belongsTo || definition.target || name,
      scopes,
      options,
      visited
    )
    if (Object.hasOwn(normalized, name)) {
      normalized[name] = Array.isArray(normalized[name])
        ? normalized[name].map(normalizeRelated)
        : normalizeRelated(normalized[name])
    }
  }
  if (options.fields) filterResponseFields(normalized, options.fields, { simplified: true, resourceType })
  return normalized
}
