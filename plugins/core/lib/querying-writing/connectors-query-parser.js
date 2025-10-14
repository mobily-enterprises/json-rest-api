/**
 * Parses URL query strings into JSON:API compliant parameter objects
 *
 * @param {string} queryString - The query string part of URL (without ?)
 * @returns {object} Parsed query parameters in JSON:API format
 *
 * @example
 * // Input: Basic include and sort
 * const query = parseJsonApiQuery('include=author&sort=-created_at');
 *
 * // Output: Parsed into arrays
 * // {
 * //   include: ['author'],      // Split by comma
 * //   fields: {},
 * //   filters: {},
 * //   sort: ['-created_at'],    // Split by comma
 * //   page: {}
 * // }
 *
 * @example
 * // Input: Filters with bracket notation
 * const query = parseJsonApiQuery('filter[status]=published&filter[author_id]=123');
 *
 * // Output: Extracted filter keys
 * // {
 * //   include: [],
 * //   fields: {},
 * //   filters: {
 * //     status: 'published',   // filter[status] → filters.status
 * //     author_id: '123'       // Values kept as strings
 * //   },
 * //   sort: [],
 * //   page: {}
 * // }
 *
 * @example
 * // Input: Sparse fieldsets
 * const query = parseJsonApiQuery('fields[articles]=title,body&fields[users]=name');
 *
 * // Output: Fields kept as comma-separated strings
 * // {
 * //   include: [],
 * //   fields: {
 * //     articles: 'title,body',  // NOT split into array
 * //     users: 'name'            // Validation expects strings
 * //   },
 * //   filters: {},
 * //   sort: [],
 * //   page: {}
 * // }
 *
 * @example
 * // Input: Pagination with numeric conversion
 * const query = parseJsonApiQuery('page[size]=20&page[number]=3&page[cursor]=abc123');
 *
 * // Output: Numbers converted, strings preserved
 * // {
 * //   include: [],
 * //   fields: {},
 * //   filters: {},
 * //   sort: [],
 * //   page: {
 * //     size: 20,        // "20" → 20 (numeric)
 * //     number: 3,       // "3" → 3 (numeric)
 * //     cursor: 'abc123' // Non-numeric stays string
 * //   }
 * // }
 *
 * @example
 * // Input: Complex real-world query
 * const query = parseJsonApiQuery(
 *   'include=author,comments.user&' +
 *   'filter[status]=published&' +
 *   'filter[created_after]=2024-01-01&' +
 *   'fields[articles]=title,summary&' +
 *   'sort=-created_at,title&' +
 *   'page[size]=10'
 * );
 *
 * // Output: All parameters properly categorized
 * // {
 * //   include: ['author', 'comments.user'],
 * //   fields: { articles: 'title,summary' },
 * //   filters: {
 * //     status: 'published',
 * //     created_after: '2024-01-01'
 * //   },
 * //   sort: ['-created_at', 'title'],
 * //   page: { size: 10 }
 * // }
 *
 * @description
 * Used by:
 * - express-plugin parses req.query with this
 * - http-plugin parses URL query strings with this
 * - websocket-plugin parses message query parameters with this
 *
 * Purpose:
 * - Provides uniform JSON:API query parsing across all transports
 * - Handles bracket notation without regex complexity
 * - Converts data types appropriately (numbers for pagination)
 * - Ignores non-JSON:API parameters gracefully
 * - Returns consistent structure even for empty input
 *
 * Data flow:
 * 1. Uses URLSearchParams for reliable parsing
 * 2. Categorizes parameters by their prefix pattern
 * 3. Extracts bracketed keys (filter[x] → x)
 * 4. Splits comma-separated values for include/sort
 * 5. Converts numeric strings for pagination
 * 6. Returns normalized structure for REST API
 */
export function parseJsonApiQuery (queryString) {
  if (!queryString) {
    return {
      include: [],
      fields: {},
      filters: {},
      sort: [],
      page: {}
    }
  }

  const params = new URLSearchParams(queryString)
  const result = {
    include: [],
    fields: {},
    filters: {},
    sort: [],
    page: {}
  }

  for (const [key, value] of params) {
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
        result.filters[filterKey] = value
      }
    } else if (key.startsWith('fields[') && key.endsWith(']')) {
      // Parse fields[type] = fields into fields: { type: "field1,field2" }
      // Keep as comma-separated string to match REST API validation expectations
      const fieldType = key.slice(7, -1) // Remove 'fields[' and ']'
      if (fieldType) {
        result.fields[fieldType] = value
      }
    } else if (key.startsWith('page[') && key.endsWith(']')) {
      // Parse page[size] = 10 into page: { size: 10 }
      const pageKey = key.slice(5, -1) // Remove 'page[' and ']'
      if (pageKey) {
        // Convert to number if it's a valid number, otherwise keep as string
        result.page[pageKey] = isNaN(value) ? value : parseInt(value, 10)
      }
    }
    // Ignore other query parameters that don't match JSON:API patterns
  }

  return result
}
