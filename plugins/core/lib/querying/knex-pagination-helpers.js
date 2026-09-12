import { getFieldValue } from '../storage/storage-mapping.js'
import { buildJsonApiLink } from './url-helpers.js'
import { normalizeDateValue } from '../querying-writing/database-value-normalizers.js'
import { DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT } from '../querying-writing/knex-constants.js'
import { applyCursorPredicate, validateCursorValues } from './query-field-sort-helpers.js'
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'

// Page parameters have passed the shared request contract. Physical sort
// columns and built-in value conversion remain with descriptors and adapters.
export const applyPaginationToQuery = ({ query, page = {}, vars, sortDescriptors, storageAdapter }) => {
  const pageSize = Math.min(page.size ?? (vars.queryDefaultLimit || DEFAULT_QUERY_LIMIT), vars.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT)
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RestApiValidationError('Page size must be a positive integer', {
      fields: ['page.size'],
      violations: [{ field: 'page.size', rule: 'min_value', message: 'Page size must be a positive integer' }]
    })
  }
  const parameter = page.before !== undefined ? 'before' : page.after !== undefined ? 'after' : null
  const mode = page.number !== undefined ? 'offset' : parameter || page.size !== undefined ? 'cursor' : 'default'
  const before = parameter === 'before'
  const pageNumber = page.number ?? 1

  if (parameter) {
    let values
    try {
      values = parseCursor(page[parameter])
    } catch (error) {
      const field = `page.${parameter}`
      throw new RestApiValidationError(`Invalid cursor format in page[${parameter}] parameter`, {
        fields: [field],
        violations: [{ field, rule: 'invalid_cursor', message: error.message }]
      })
    }
    values = validateCursorValues(sortDescriptors, values, parameter, vars.schemaInfo.schemaInstance)
    applyCursorPredicate(query, sortDescriptors, values, direction => {
      const descending = direction.toUpperCase() === 'DESC'
      return before ? (descending ? '>' : '<') : (descending ? '<' : '>')
    }, (builder, descriptor, operator, value) => builder.where(
      descriptor.column, operator, storageAdapter.translateCursorValue(descriptor.actualField, value)
    ))
  }

  query.limit(pageSize + (mode === 'cursor' ? 1 : 0))
  if (mode === 'offset') query.offset((pageNumber - 1) * pageSize)
  return { mode, page: pageNumber, pageSize, before }
}

/**
 * Calculates pagination metadata from query results
 *
 * @param {number} total - Total number of records in the dataset
 * @param {number} page - Current page number (1-based)
 * @param {number} pageSize - Number of records per page
 * @returns {Object} Pagination metadata including page count and hasMore flag
 * @throws {Error} If pageSize <= 0 or page < 1
 */
export const calculatePaginationMeta = (total, page, pageSize) => {
  if (pageSize <= 0) {
    throw new Error('Page size must be greater than 0')
  }
  if (page < 1) {
    throw new Error('Page number must be greater than 0')
  }

  const pageCount = Math.ceil(total / pageSize)
  const currentPage = page || 1
  const hasMore = currentPage < pageCount

  return {
    page: currentPage,
    pageSize,
    pageCount,
    total,
    hasMore
  }
}

/**
 * Generates JSON:API compliant pagination links for offset-based pagination
 *
 * @param {string} urlPrefix - Base URL prefix for the API
 * @param {string} scopeName - Resource type name
 * @param {Object} queryParams - Current query parameters
 * @param {Object} paginationMeta - Pagination metadata from calculatePaginationMeta
 * @returns {import('../../../../types/representations.js').JsonApiLinks | null} Links object with self, first, last, prev, next
 */
export const generatePaginationLinks = (urlPrefix, scopeName, queryParams, paginationMeta) => {
  // Allow empty urlPrefix to generate relative links
  // if (!urlPrefix) return null;

  const { page, pageCount, pageSize } = paginationMeta
  const links = {}

  const baseUrl = `${urlPrefix}/${scopeName}`

  links.self = buildJsonApiLink(baseUrl, queryParams, { number: page, size: pageSize })

  if (pageCount !== undefined) {
    links.first = buildJsonApiLink(baseUrl, queryParams, { number: 1, size: pageSize })
    links.last = buildJsonApiLink(baseUrl, queryParams, { number: Math.max(1, pageCount), size: pageSize })

    if (page > 1) {
      links.prev = buildJsonApiLink(baseUrl, queryParams, { number: page - 1, size: pageSize })
    }

    if (page < pageCount) {
      links.next = buildJsonApiLink(baseUrl, queryParams, { number: page + 1, size: pageSize })
    }
  }

  return links
}

/**
 * Creates an opaque cursor string from record data for cursor-based pagination
 *
 * @param {Object} record - Database record to create cursor from
 * @param {Array<string>} sortFields - Fields to include in cursor (default: ['id'])
 * @param {import('../storage/storage-types.js').DataCursorOptions} [options]
 * @returns {string} URL-safe cursor string
 */
export const createCursor = (record, sortFields = ['id'], { schemaInfo = null, definitions = {} } = {}) => {
  const parts = []
  sortFields.forEach(field => {
    let value = schemaInfo
      ? getFieldValue(record, schemaInfo, field)
      : record[field]
    const definition = definitions[field] || schemaInfo?.schemaStructure?.[field]
    if (value === null) {
      parts.push(`${field}:~null`)
      return
    }
    if (!definition?.storage?.serialize && !definition?.select && ['date', 'dateTime', 'time'].includes(definition?.type) && value != null) {
      value = normalizeDateValue(value, definition.type, {
        temporalPrecision: definition.temporalPrecision,
        fieldName: field,
        resourceType: schemaInfo?.scopeName || schemaInfo?.tableName,
        source: 'cursor'
      })
    }
    if (value !== undefined) {
      const stringValue = value instanceof Date ? value.toISOString() : String(value)
      parts.push(`${field}:${encodeURIComponent(stringValue).replace(/^~/, '%7E')}`)
    }
  })
  return parts.join(',')
}

/**
 * Parses a cursor string back into field/value pairs
 *
 * @param {string} cursor - Cursor string to parse
 * @returns {Object} Object with field names as keys and decoded values
 * @throws {Error} If cursor format is invalid
 */
export const parseCursor = (cursor) => {
  try {
    const data = Object.create(null)
    if (!cursor || cursor.trim() === '') {
      throw new Error('Empty cursor')
    }

    const pairs = cursor.split(',')

    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':')
      if (colonIndex === -1) {
        throw new Error('Invalid cursor format: missing colon separator')
      }

      const field = pair.substring(0, colonIndex)
      const encodedValue = pair.substring(colonIndex + 1)

      if (!field) {
        throw new Error('Invalid cursor format: empty field name')
      }

      if (Object.hasOwn(data, field)) throw new Error(`Duplicate cursor field '${field}'`)
      data[field] = encodedValue === '~null' ? null : decodeURIComponent(encodedValue)
    }

    return data
  } catch (e) {
    throw new Error(`Invalid cursor format: ${e.message}`)
  }
}

/**
 * Generates pagination links for cursor-based pagination
 *
 * @param {string} urlPrefix - Base URL prefix
 * @param {string} scopeName - Resource type name
 * @param {Object} queryParams - Current query parameters
 * @param {Array<Object>} records - Current page records
 * @param {number} pageSize - Records per page
 * @param {boolean} hasMore - Whether more records exist
 * @param {Array<string>} sortFields - Fields used for cursor
 * @param {import('../storage/storage-types.js').DataCursorOptions} [options]
 * @returns {import('../../../../types/representations.js').JsonApiLinks | null} Links object with self, first, next
 */
export const generateCursorPaginationLinks = (
  urlPrefix,
  scopeName,
  queryParams,
  records,
  pageSize,
  hasMore,
  sortFields = ['id'],
  { schemaInfo = null, definitions = {} } = {}
) => {
  // Allow empty urlPrefix to generate relative links
  if (!records.length) return null

  const links = {}
  const baseUrl = `${urlPrefix}/${scopeName}`
  const selfPage = { size: pageSize }

  if (queryParams.page?.after) {
    selfPage.after = queryParams.page.after
  } else if (queryParams.page?.before) {
    selfPage.before = queryParams.page.before
  }

  links.self = buildJsonApiLink(baseUrl, queryParams, selfPage)
  links.first = buildJsonApiLink(baseUrl, queryParams, { size: pageSize })

  if (hasMore && records.length > 0) {
    const direction = queryParams.page?.before ? 'before' : 'after'
    const boundary = direction === 'before' ? records[0] : records[records.length - 1]
    const nextCursor = createCursor(boundary, sortFields, { schemaInfo, definitions })
    links.next = buildJsonApiLink(baseUrl, queryParams, { size: pageSize, [direction]: nextCursor })
  }

  return links
}

/**
 * Builds cursor pagination metadata for the response
 *
 * @param {Array<Object>} records - Current page records
 * @param {number} pageSize - Records per page
 * @param {boolean} hasMore - Whether more records exist
 * @param {Array<string>} sortFields - Fields used for cursor
 * @param {import('../storage/storage-types.js').DataCursorOptions} [options]
 * @returns {Object} Metadata with pageSize, hasMore, and optional cursor
 */
export const buildCursorMeta = (records, pageSize, hasMore, sortFields = ['id'], { schemaInfo = null, definitions = {}, before = false } = {}) => {
  const meta = {
    pageSize,
    hasMore
  }

  if (hasMore && records.length > 0) {
    const lastRecord = before ? records[0] : records[records.length - 1]
    meta.cursor = {
      next: createCursor(lastRecord, sortFields, { schemaInfo, definitions })
    }
  }

  return meta
}
