import { rejectRemovedOptions } from './response-options.js'
import { RestApiPayloadError } from '../../../../lib/rest-api-errors.js'

/**
 * Parse JSON:API query parameters independently of a framework's query parser.
 * Ordinary filters and sparse fields retain strings; filter[field][json] carries
 * an explicit JSON value. Only page size/number are otherwise
 * converted to numbers; opaque cursors keep their exact spelling. Retired
 * controls fail clearly. Repeated keys use the final value.
 *
 * @param {string} queryString - Query string without the leading question mark
 * @returns {object} Include/sort arrays and fields/filters/page maps
 */
export function parseJsonApiQuery (queryString) {
  if (!queryString) {
    return {
      fields: {},
      filters: {},
      sort: [],
      page: {}
    }
  }

  const params = new URLSearchParams(queryString)
  rejectRemovedOptions(Object.fromEntries(params))
  const result = {
    fields: {},
    filters: {},
    sort: [],
    page: {}
  }

  for (const [key, value] of params) {
    const jsonFilter = key.match(/^filter\[(.+)\]\[json\]$/)
    if (jsonFilter) {
      let parsed
      try { parsed = JSON.parse(value) } catch {
        throw new RestApiPayloadError(`Invalid JSON value for query parameter '${key}'`, { parameter: key, expected: 'valid JSON' })
      }
      Object.defineProperty(result.filters, jsonFilter[1], { value: parsed, enumerable: true, writable: true, configurable: true })
      continue
    }
    if (key === 'include') {
      // Parse include (comma-separated string to array)
      result.include = value.split(',').map(s => s.trim()).filter(s => s.length > 0)
    } else if (key === 'sort') {
      // Parse sort (comma-separated string to array)
      result.sort = value.split(',').map(s => s.trim()).filter(s => s.length > 0)
    } else if (key.startsWith('filter[') && key.endsWith(']')) {
      // Parse filter[key] = value into filters: { key: value }
      const filterKey = key.slice(7, -1) // Remove 'filter[' and ']'
      if (filterKey) {
        Object.defineProperty(result.filters, filterKey, { value, enumerable: true, writable: true, configurable: true })
      }
    } else if (key.startsWith('fields[') && key.endsWith(']')) {
      // Parse fields[type] = fields into fields: { type: "field1,field2" }
      // Keep as comma-separated string to match REST API validation expectations
      const fieldType = key.slice(7, -1) // Remove 'fields[' and ']'
      if (fieldType) {
        Object.defineProperty(result.fields, fieldType, { value, enumerable: true, writable: true, configurable: true })
      }
    } else if (key.startsWith('page[') && key.endsWith(']')) {
      // Parse page[size] = 10 into page: { size: 10 }
      const pageKey = key.slice(5, -1) // Remove 'page[' and ']'
      if (pageKey) {
        // Keep fractional values intact so the existing integer contract rejects them.
        const parsed = ['size', 'number'].includes(pageKey) && value.trim() !== '' && !isNaN(value) ? Number(value) : value
        Object.defineProperty(result.page, pageKey, { value: parsed, enumerable: true, writable: true, configurable: true })
      }
    }
    // Ignore other query parameters that don't match JSON:API patterns
  }

  return result
}

const hasSerializableValue = (value) => (
  value !== undefined &&
  value !== null &&
  !(Array.isArray(value) && value.length === 0)
)

const stringifyQueryValue = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stringifyQueryValue).join(',')
  return String(value)
}

const appendCommaList = (params, key, value) => {
  if (!hasSerializableValue(value) && !(key === 'include' && Array.isArray(value))) return
  const serialized = Array.isArray(value)
    ? value.map(stringifyQueryValue).filter((entry) => entry.length > 0).join(',')
    : stringifyQueryValue(value)

  if (serialized || key === 'include') {
    params.set(key, serialized)
  }
}

const appendScopedParams = (params, publicName, values) => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return

  for (const [key, value] of Object.entries(values)) {
    if (!key || value === undefined) continue
    if (publicName === 'filter' && (value === null || (typeof value === 'object' && !(value instanceof Date)))) {
      params.set(`${publicName}[${key}][json]`, JSON.stringify(value))
      continue
    }
    if (!hasSerializableValue(value)) continue
    params.set(`${publicName}[${key}]`, stringifyQueryValue(value))
  }
}

/**
 * Serializes internal REST API query parameters to public JSON:API query string form.
 *
 * This is intentionally the inverse of parseJsonApiQuery for the supported transport
 * contract: include, sort, filter[...], fields[...], and page[...].
 */
export function serializeJsonApiQuery (queryParams = {}, { page } = {}) {
  const params = new URLSearchParams()
  const effectivePage = page === undefined ? queryParams.page : page

  appendCommaList(params, 'include', queryParams.include)
  appendCommaList(params, 'sort', queryParams.sort)
  appendScopedParams(params, 'filter', queryParams.filters || queryParams.filter)
  appendScopedParams(params, 'fields', queryParams.fields)
  appendScopedParams(params, 'page', effectivePage)

  return params.toString()
}
