/**
 * Shared JSON:API Query Parameter Parser
 * 
 * Parses URL query strings into JSON:API compliant parameter objects.
 * Handles bracket notation for filters, fields, and page parameters.
 * 
 * @param {string} queryString - The query string part of URL (without ?)
 * @returns {object} Parsed query parameters in JSON:API format
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