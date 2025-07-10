/**
 * @module connectors-query-parser
 * @description Shared JSON:API query parameter parser for connector plugins
 * 
 * This module provides utilities for parsing URL query strings into JSON:API
 * compliant parameter objects. It handles the standard JSON:API query parameter
 * patterns including bracket notation for filters, fields, and pagination.
 * This parser is shared between HTTP, Express, and WebSocket connectors to
 * ensure consistent query parameter handling across all transport layers.
 * 
 * Why this is useful upstream:
 * - Ensures consistent JSON:API query parsing across all connectors
 * - Handles bracket notation parsing (e.g., filter[status]=published)
 * - Converts comma-separated values to arrays for include/sort
 * - Maintains fields as strings for REST API validation
 * - Automatically converts numeric page values
 * - Ignores non-JSON:API parameters safely
 */

/**
 * Parses URL query strings into JSON:API compliant parameter objects.
 * 
 * This function takes a raw query string and converts it into a structured
 * object following JSON:API conventions. It handles all standard JSON:API
 * query parameter patterns including filters with bracket notation, sparse
 * fieldsets, sorting, pagination, and relationship inclusion.
 * 
 * @param {string} queryString - The query string part of URL (without ?)
 * @returns {object} Parsed query parameters in JSON:API format
 * 
 * @example <caption>Basic query parsing</caption>
 * const query = parseJsonApiQuery('include=author&sort=-created_at');
 * // Returns:
 * // {
 * //   include: ['author'],
 * //   fields: {},
 * //   filters: {},
 * //   sort: ['-created_at'],
 * //   page: {}
 * // }
 * 
 * @example <caption>Filter parameters with bracket notation</caption>
 * const query = parseJsonApiQuery('filter[status]=published&filter[author_id]=123');
 * // Returns:
 * // {
 * //   include: [],
 * //   fields: {},
 * //   filters: {
 * //     status: 'published',
 * //     author_id: '123'
 * //   },
 * //   sort: [],
 * //   page: {}
 * // }
 * 
 * @example <caption>Sparse fieldsets</caption>
 * const query = parseJsonApiQuery('fields[articles]=title,body&fields[users]=name');
 * // Returns:
 * // {
 * //   include: [],
 * //   fields: {
 * //     articles: 'title,body',  // Kept as string for validation
 * //     users: 'name'
 * //   },
 * //   filters: {},
 * //   sort: [],
 * //   page: {}
 * // }
 * 
 * @example <caption>Pagination parameters</caption>
 * const query = parseJsonApiQuery('page[size]=20&page[number]=3');
 * // Returns:
 * // {
 * //   include: [],
 * //   fields: {},
 * //   filters: {},
 * //   sort: [],
 * //   page: {
 * //     size: 20,     // Converted to number
 * //     number: 3     // Converted to number
 * //   }
 * // }
 * 
 * @example <caption>Complex query with all parameter types</caption>
 * const query = parseJsonApiQuery(
 *   'include=author,comments.user&' +
 *   'filter[status]=published&' +
 *   'filter[created_after]=2024-01-01&' +
 *   'fields[articles]=title,summary&' +
 *   'sort=-created_at,title&' +
 *   'page[size]=10&page[number]=1'
 * );
 * // Returns complete parsed structure with all parameters
 * 
 * @example <caption>Empty or invalid input</caption>
 * parseJsonApiQuery('');        // Returns default structure with empty values
 * parseJsonApiQuery(null);      // Returns default structure with empty values
 * parseJsonApiQuery('foo=bar'); // Ignores non-JSON:API parameters
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // Connector plugins use this to:
 * // 1. Convert raw URL queries to structured JSON:API format
 * // 2. Handle bracket notation without custom regex parsing
 * // 3. Ensure consistent behavior across HTTP/Express/WebSocket
 * // 4. Prepare query parameters for REST API validation
 * // 5. Support all JSON:API query features uniformly
 */
export function parseJsonApiQuery(queryString) {
  if (!queryString) {
    return {
      include: [],
      fields: {},
      filters: {},
      sort: [],
      page: {}
    };
  }

  const params = new URLSearchParams(queryString);
  const result = {
    include: [],
    fields: {},
    filters: {},
    sort: [],
    page: {}
  };

  for (const [key, value] of params) {
    if (key === 'include') {
      // Parse include (comma-separated string to array)
      result.include = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
    } else if (key === 'sort') {
      // Parse sort (comma-separated string to array)
      result.sort = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
    } else if (key.startsWith('filter[') && key.endsWith(']')) {
      // Parse filter[key] = value into filters: { key: value }
      const filterKey = key.slice(7, -1); // Remove 'filter[' and ']'
      if (filterKey) {
        result.filters[filterKey] = value;
      }
    } else if (key.startsWith('fields[') && key.endsWith(']')) {
      // Parse fields[type] = fields into fields: { type: "field1,field2" }
      // Keep as comma-separated string to match REST API validation expectations
      const fieldType = key.slice(7, -1); // Remove 'fields[' and ']'
      if (fieldType) {
        result.fields[fieldType] = value;
      }
    } else if (key.startsWith('page[') && key.endsWith(']')) {
      // Parse page[size] = 10 into page: { size: 10 }
      const pageKey = key.slice(5, -1); // Remove 'page[' and ']'
      if (pageKey) {
        // Convert to number if it's a valid number, otherwise keep as string
        result.page[pageKey] = isNaN(value) ? value : parseInt(value, 10);
      }
    }
    // Ignore other query parameters that don't match JSON:API patterns
  }

  return result;
}