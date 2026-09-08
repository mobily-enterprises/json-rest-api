import { createSchema } from 'json-rest-schema'
import { RestApiTemporalDataError, RestApiValidationError } from '../../../../lib/rest-api-errors.js'

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const RFC3339_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const SQL_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/
const INTEGER_VALUE_PATTERN = /^-?\d+$/
const temporalContractCache = new Map()

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
  if (!temporalContractCache.has(cacheKey)) {
    temporalContractCache.set(cacheKey, createSchema({
      value: {
        type,
        ...(Number.isInteger(temporalPrecision) ? { temporalPrecision } : {})
      }
    }))
  }
  return temporalContractCache.get(cacheKey)
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

  if (sqlMatch) {
    dateTimeValue = `${sqlMatch[1]}T${sqlMatch[2]}Z`
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
  const parsed = new Date(dateTimeValue)
  if (Number.isNaN(parsed.getTime())) {
    throwTemporalDataError({ fieldName, resourceType, type, source })
  }
  // Date handles the offset, but cannot retain digits beyond milliseconds.
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(dateTimeValue)?.[1]
  return fraction
    ? parsed.toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`)
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
    return validateTemporalJsonValue(timeValue, type, {
      temporalPrecision,
      fieldName,
      resourceType,
      source
    })
  }

  if (type === 'date' && typeof value === 'string' && DATE_VALUE_PATTERN.test(value.trim())) {
    return validateTemporalJsonValue(value.trim(), type, {
      fieldName,
      resourceType,
      source
    })
  }

  const isoValue = parseKnownDatabaseDate(value, { fieldName, resourceType, type, source })
  const normalized = type === 'date'
    ? isoValue.slice(0, 10)
    : limitFractionalSecondPrecision(isoValue, temporalPrecision)
  return validateTemporalJsonValue(normalized, type, {
    temporalPrecision,
    fieldName,
    resourceType,
    source
  })
}

/**
 * Converts validated JSON temporal values to the native values expected by
 * database drivers. JSON schema validation keeps date and dateTime values as
 * strings; database writes and comparisons must normalize them consistently.
 * Time values remain strings because database drivers accept their wire shape.
 */
export function normalizeValueForDatabaseStorage (value, type, {
  temporalPrecision,
  fieldName,
  resourceType,
  source = 'storage'
} = {}) {
  if (!['date', 'dateTime', 'time'].includes(type)) return value
  if (value === null || value === undefined) return null

  if (type === 'time') {
    if (typeof value !== 'string') {
      throwTemporalDataError({ fieldName, resourceType, type, source })
    }
    return validateTemporalJsonValue(value, type, {
      temporalPrecision,
      fieldName,
      resourceType,
      source
    })
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
  const fraction = type === 'dateTime'
    ? /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(validatedValue)?.[1]
    : null
  if (fraction && /[1-9]/.test(fraction.slice(3))) {
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
  return databaseValue
}

/**
 * Normalizes database values in an attributes object
 *
 * @param {Object} attributes - The attributes object to normalize
 * @param {Object} schemaStructure - The schema structure defining field types
 * @returns {Object} The normalized attributes object
 *
 * @example
 * // Input: Raw database values
 * const attributes = {
 *   id: 1,
 *   is_active: 1,              // Boolean as 0/1
 *   created_at: '2024-01-15 10:30:00',  // MySQL datetime
 *   birth_date: '1990-05-20',           // Date string
 *   shift_time: '09:00:00'              // Time string
 * };
 *
 * const schema = {
 *   is_active: { type: 'boolean' },
 *   created_at: { type: 'dateTime' },
 *   birth_date: { type: 'date' },
 *   shift_time: { type: 'time' }
 * };
 *
 * const normalized = normalizeAttributes(attributes, schema);
 *
 * // Output: JSON-safe values
 * // {
 * //   id: 1,
 * //   is_active: true,                    // 1 → true
 * //   created_at: '2024-01-15T10:30:00.000Z',
 * //   birth_date: '1990-05-20',
 * //   shift_time: '09:00:00'
 * // }
 *
 * @example
 * // Input: Boolean edge cases
 * const attributes = {
 *   flag1: 0,      // Number 0
 *   flag2: '1',    // String '1'
 *   flag3: true,   // Already boolean
 *   flag4: null    // Null value
 * };
 *
 * const normalized = normalizeAttributes(attributes, {
 *   flag1: { type: 'boolean' },
 *   flag2: { type: 'boolean' },
 *   flag3: { type: 'boolean' },
 *   flag4: { type: 'boolean' }
 * });
 *
 * // Output:
 * // {
 * //   flag1: false,  // 0 → false
 * //   flag2: true,   // '1' → true
 * //   flag3: true,   // unchanged
 * //   flag4: null    // null preserved
 * // }
 *
 * @description
 * Used by:
 * - normalizeRecordAttributes for each record's attributes
 * - Applied after fetching data from database
 *
 * Purpose:
 * - Handles databases without native boolean support (SQLite, older MySQL)
 * - Normalizes date formats from different databases
 * - Ensures consistent data types in API responses
 * - Preserves null values appropriately
 *
 * Data flow:
 * 1. Creates copy of attributes to avoid mutation
 * 2. Iterates through each field with schema definition
 * 3. Normalizes booleans: 1/0 or '1'/'0' to true/false
 * 4. Normalizes dates using normalizeDateValue
 * 5. Returns new object with normalized values
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
 * Normalizes all records in a JSON:API response
 *
 * @param {Object} record - The JSON:API response object
 * @param {Object} scopes - All available scopes for schema lookup
 * @returns {Object} The response with normalized values
 *
 * @example
 * // Input: JSON:API response with various data types
 * const response = {
 *   data: {
 *     type: 'articles',
 *     id: '1',
 *     attributes: {
 *       title: 'My Article',
 *       is_published: 1,                    // Boolean as number
 *       published_at: '2024-01-15 10:00:00' // MySQL datetime
 *     }
 *   },
 *   included: [{
 *     type: 'users',
 *     id: '10',
 *     attributes: {
 *       name: 'John',
 *       is_admin: 0,         // Boolean as number
 *       last_login: '2024-01-14 15:30:00'
 *     }
 *   }]
 * };
 *
 * const normalized = normalizeRecordAttributes(response, scopes);
 *
 * // Output: All booleans and dates normalized
 * // {
 * //   data: {
 * //     type: 'articles',
 * //     id: '1',
 * //     attributes: {
 * //       title: 'My Article',
 * //       is_published: true,
 * //       published_at: '2024-01-15T10:00:00.000Z'
 * //     }
 * //   },
 * //   included: [{
 * //     type: 'users',
 * //     id: '10',
 * //     attributes: {
 * //       name: 'John',
 * //       is_admin: false,
 * //       last_login: '2024-01-14T15:30:00.000Z'
 * //     }
 * //   }]
 * // }
 *
 * @example
 * // Input: Collection response (array of records)
 * const response = {
 *   data: [
 *     {
 *       type: 'comments',
 *       id: '1',
 *       attributes: { approved: 1, created_at: '2024-01-01 09:00:00' }
 *     },
 *     {
 *       type: 'comments',
 *       id: '2',
 *       attributes: { approved: 0, created_at: '2024-01-02 10:00:00' }
 *     }
 *   ]
 * };
 *
 * // Each record in the array is normalized
 *
 * @description
 * Used by:
 * - rest-api-knex-plugin after fetching data, before sending response
 * - Applied to both GET (single) and QUERY (collection) responses
 *
 * Purpose:
 * - Ensures consistent data types in API responses
 * - Handles both primary data and included resources
 * - Works with single records and collections
 * - Uses schema definitions to determine field types
 *
 * Data flow:
 * 1. Checks if data is array (collection) or object (single)
 * 2. For each record, looks up its schema by type
 * 3. Calls normalizeAttributes with schema structure
 * 4. Processes included array the same way
 * 5. Returns complete response with normalized values
 */
export function normalizeRecordAttributes (record, scopes, {
  source = 'database',
  simplified = false,
  resourceType
} = {}) {
  if (!record || !scopes) {
    return record
  }

  if (simplified) {
    return normalizeSimplifiedRecord(record, resourceType, scopes, { source })
  }

  const normalizeEntry = (entry) => {
    const schemaInfo = scopes[entry?.type]?.vars?.schemaInfo
    if (!schemaInfo || !entry?.attributes) return

    entry.attributes = normalizeAttributes(
      entry.attributes,
      {
        ...(schemaInfo.schemaStructure || {}),
        ...(schemaInfo.computed || {}),
        ...(scopes[entry.type]?.vars?.queryFields || {})
      },
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

  return record
}

function normalizeSimplifiedRecord (record, resourceType, scopes, options, visited = new WeakMap()) {
  if (!record || typeof record !== 'object') return record
  if (visited.has(record)) return visited.get(record)
  const schemaInfo = scopes[resourceType]?.vars?.schemaInfo
  if (!schemaInfo) return record

  const schema = { ...schemaInfo.schemaStructure, ...schemaInfo.computed, ...scopes[resourceType]?.vars?.queryFields }
  const normalized = normalizeAttributes(record, schema, { ...options, resourceType })
  visited.set(record, normalized)
  const relationships = { ...schemaInfo.schemaRelationships }
  for (const definition of Object.values(schema)) {
    if (definition.as && (definition.belongsTo || definition.belongsToPolymorphic)) {
      relationships[definition.as] = definition
    }
  }
  for (const [name, definition] of Object.entries(relationships)) {
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
  return normalized
}
