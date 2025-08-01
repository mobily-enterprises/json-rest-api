/**
 * Calculates pagination metadata from query results
 * 
 * @param {number} total - Total number of records in the dataset
 * @param {number} page - Current page number (1-based)
 * @param {number} pageSize - Number of records per page
 * @returns {Object} Pagination metadata including page count and hasMore flag
 * @throws {Error} If pageSize <= 0 or page < 1
 * 
 * @example
 * // Input: 100 total records, viewing page 2 of 20 records each
 * const meta = calculatePaginationMeta(100, 2, 20);
 * // Output:
 * // {
 * //   page: 2,         // current page
 * //   pageSize: 20,    // records per page  
 * //   pageCount: 5,    // total pages (100/20)
 * //   total: 100,      // total records
 * //   hasMore: true    // page 2 < 5, so more pages exist
 * // }
 * 
 * @example
 * // Input: Last page scenario
 * const meta = calculatePaginationMeta(45, 5, 10);
 * // Output:
 * // {
 * //   page: 5,
 * //   pageSize: 10,
 * //   pageCount: 5,    // 45/10 = 4.5, rounds up to 5
 * //   total: 45,
 * //   hasMore: false   // on last page
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataQuery method after counting total records
 * - generatePaginationLinks to build navigation links
 * - Applied when offset-based pagination is enabled
 * 
 * Purpose:
 * - Provides consistent pagination metadata across all collection responses
 * - Calculates derived values like pageCount and hasMore flag
 * - Validates pagination parameters to prevent invalid states
 * 
 * Data flow:
 * 1. Query method counts total records when pagination.counts is enabled
 * 2. calculatePaginationMeta processes the count with current page/size
 * 3. Returns metadata that goes into response.meta.pagination
 * 4. Used by generatePaginationLinks to determine which links to include
 */
export const calculatePaginationMeta = (total, page, pageSize) => {
  if (pageSize <= 0) {
    throw new Error('Page size must be greater than 0');
  }
  if (page < 1) {
    throw new Error('Page number must be greater than 0');
  }
  
  const pageCount = Math.ceil(total / pageSize);
  const currentPage = page || 1;
  const hasMore = currentPage < pageCount;
  
  return {
    page: currentPage,
    pageSize,
    pageCount,
    total,
    hasMore
  };
};

/**
 * Generates JSON:API compliant pagination links for offset-based pagination
 * 
 * @param {string} urlPrefix - Base URL prefix for the API
 * @param {string} scopeName - Resource type name
 * @param {Object} queryParams - Current query parameters
 * @param {Object} paginationMeta - Pagination metadata from calculatePaginationMeta
 * @returns {Object|null} Links object with self, first, last, prev, next
 * 
 * @example
 * // Input data:
 * const urlPrefix = '/api/v1';
 * const scopeName = 'articles';
 * const queryParams = {
 *   filter: { status: 'published' },
 *   sort: ['-created_at'],
 *   page: { number: 2, size: 20 }
 * };
 * const paginationMeta = {
 *   page: 2,
 *   pageSize: 20,
 *   pageCount: 5,
 *   total: 100,
 *   hasMore: true
 * };
 * 
 * const links = generatePaginationLinks(urlPrefix, scopeName, queryParams, paginationMeta);
 * 
 * // Output - complete URLs with all parameters preserved:
 * // {
 * //   self: '/api/v1/articles?filter[status]=published&sort=-created_at&page[number]=2&page[size]=20',
 * //   first: '/api/v1/articles?filter[status]=published&sort=-created_at&page[number]=1&page[size]=20',
 * //   last: '/api/v1/articles?filter[status]=published&sort=-created_at&page[number]=5&page[size]=20',
 * //   prev: '/api/v1/articles?filter[status]=published&sort=-created_at&page[number]=1&page[size]=20',
 * //   next: '/api/v1/articles?filter[status]=published&sort=-created_at&page[number]=3&page[size]=20'
 * // }
 * 
 * @example
 * // Input: First page (no prev link)
 * const paginationMeta = { page: 1, pageSize: 10, pageCount: 3 };
 * const links = generatePaginationLinks('/api', 'users', {}, paginationMeta);
 * 
 * // Output - notice no 'prev' property:
 * // {
 * //   self: '/api/users?page[number]=1&page[size]=10',
 * //   first: '/api/users?page[number]=1&page[size]=10',
 * //   last: '/api/users?page[number]=3&page[size]=10',
 * //   next: '/api/users?page[number]=2&page[size]=10'
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataQuery adds these links to response.links
 * - Called when offset-based pagination is used (not cursor-based)
 * 
 * Purpose:
 * - JSON:API spec requires pagination links for easy navigation
 * - Preserves all other query parameters (filters, sorts, includes)
 * - Handles complex nested parameters like filter[author][name]=John
 * - Only includes prev/next when applicable
 * 
 * Data flow:
 * 1. After records are fetched and pagination calculated
 * 2. Builds complete URLs preserving all query parameters
 * 3. Conditionally includes prev (not on page 1) and next (not on last page)
 * 4. Added to response.links for client navigation
 */
export const generatePaginationLinks = (urlPrefix, scopeName, queryParams, paginationMeta) => {
  if (!urlPrefix) return null;
  
  const { page, pageCount, pageSize } = paginationMeta;
  const links = {};
  
  const otherParams = Object.entries(queryParams)
    .filter(([key]) => key !== 'page')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map(v => `${key}=${encodeURIComponent(v)}`).join('&');
      } else if (typeof value === 'object' && value !== null) {
        const parts = [];
        const processObject = (obj, prefix) => {
          Object.entries(obj).forEach(([k, v]) => {
            const newKey = prefix ? `${prefix}[${k}]` : `${key}[${k}]`;
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              processObject(v, newKey);
            } else {
              parts.push(`${newKey}=${encodeURIComponent(v)}`);
            }
          });
        };
        processObject(value, key);
        return parts.join('&');
      }
      return `${key}=${encodeURIComponent(value)}`;
    })
    .join('&');
  
  const baseUrl = `${urlPrefix}/${scopeName}`;
  const queryPrefix = otherParams ? `?${otherParams}&` : '?';
  
  links.self = `${baseUrl}${queryPrefix}page[number]=${page}&page[size]=${pageSize}`;
  
  if (pageCount !== undefined) {
    links.first = `${baseUrl}${queryPrefix}page[number]=1&page[size]=${pageSize}`;
    links.last = `${baseUrl}${queryPrefix}page[number]=${pageCount}&page[size]=${pageSize}`;
    
    if (page > 1) {
      links.prev = `${baseUrl}${queryPrefix}page[number]=${page - 1}&page[size]=${pageSize}`;
    }
    
    if (page < pageCount) {
      links.next = `${baseUrl}${queryPrefix}page[number]=${page + 1}&page[size]=${pageSize}`;
    }
  }
  
  return links;
};

/**
 * Creates an opaque cursor string from record data for cursor-based pagination
 * 
 * @param {Object} record - Database record to create cursor from
 * @param {Array<string>} sortFields - Fields to include in cursor (default: ['id'])
 * @returns {string} URL-safe cursor string
 * 
 * @example
 * // Input: Simple ID-based cursor
 * const record = { 
 *   id: 123, 
 *   title: 'My Article', 
 *   created_at: '2024-01-01T10:00:00Z' 
 * };
 * const cursor = createCursor(record, ['id']);
 * 
 * // Output: "id:123"
 * // This cursor marks position at record with id=123
 * 
 * @example
 * // Input: Multi-field cursor for complex sorting
 * const record = {
 *   id: 5,
 *   created_at: new Date('2024-01-15T08:30:00Z'),
 *   title: 'Article: Part 2'
 * };
 * const cursor = createCursor(record, ['created_at', 'id']);
 * 
 * // Output: "created_at:2024-01-15T08%3A30%3A00.000Z,id:5"
 * // URL-encoded to handle the colons in timestamp
 * // Used for queries like: WHERE (created_at, id) > ('2024-01-15T08:30:00.000Z', 5)
 * 
 * @example  
 * // Input: Handling special characters
 * const record = {
 *   category: 'Tech & Science',
 *   title: 'AI: The Future?',
 *   id: 42
 * };
 * const cursor = createCursor(record, ['category', 'title', 'id']);
 * 
 * // Output: "category:Tech%20%26%20Science,title:AI%3A%20The%20Future%3F,id:42"
 * // Spaces encoded as %20, & as %26, : as %3A, ? as %3F
 * 
 * @description
 * Used by:
 * - generateCursorPaginationLinks to create next/prev cursors
 * - buildCursorMeta to provide cursor in response metadata
 * 
 * Purpose:
 * - Cursor-based pagination is more stable than offset for changing data
 * - Encodes multiple sort fields to maintain stable ordering
 * - URL-encodes values to handle special characters safely
 * - Simple format that's easy to parse back
 * 
 * Data flow:
 * 1. After fetching records, takes the last record
 * 2. Extracts values for all sort fields
 * 3. Creates cursor encoding those values
 * 4. Cursor used in 'next' link for fetching subsequent pages
 * 5. Enables efficient "WHERE (field1, field2) > (val1, val2)" queries
 */
export const createCursor = (record, sortFields = ['id']) => {
  const parts = [];
  sortFields.forEach(field => {
    if (record[field] !== undefined) {
      const value = record[field];
      const stringValue = value instanceof Date ? value.toISOString() : String(value);
      parts.push(`${field}:${encodeURIComponent(stringValue)}`);
    }
  });
  return parts.join(',');
};

/**
 * Parses a cursor string back into field/value pairs
 * 
 * @param {string} cursor - Cursor string to parse
 * @returns {Object} Object with field names as keys and decoded values
 * @throws {Error} If cursor format is invalid
 * 
 * @example
 * // Input: Simple cursor
 * const cursor = "id:123";
 * const data = parseCursor(cursor);
 * 
 * // Output: { id: "123" }
 * // Ready to use in SQL: WHERE id > '123'
 * 
 * @example
 * // Input: Multi-field cursor with URL-encoded values
 * const cursor = "created_at:2024-01-15T08%3A30%3A00.000Z,id:5";
 * const data = parseCursor(cursor);
 * 
 * // Output: 
 * // {
 * //   created_at: "2024-01-15T08:30:00.000Z",  // Decoded
 * //   id: "5"
 * // }
 * // Used for: WHERE (created_at, id) > ('2024-01-15T08:30:00.000Z', '5')
 * 
 * @example
 * // Input: Invalid cursor (throws error)
 * try {
 *   const data = parseCursor("invalid-no-colon");
 * } catch (e) {
 *   console.log(e.message);
 *   // "Invalid cursor format: Invalid cursor format: missing colon separator"
 * }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataQuery when processing page[after] parameter
 * - Used to build WHERE clause for cursor-based queries
 * 
 * Purpose:
 * - Decodes cursor back to usable values for SQL queries
 * - Handles URL-encoded special characters
 * - Validates cursor format to prevent injection attacks
 * 
 * Data flow:
 * 1. Client sends page[after]=cursor parameter
 * 2. parseCursor extracts field values from cursor
 * 3. Values used to build WHERE clause like "WHERE id > 123"
 * 4. Ensures pagination continues from exact position
 */
export const parseCursor = (cursor) => {
  try {
    const data = {};
    if (!cursor || cursor.trim() === '') {
      throw new Error('Empty cursor');
    }
    
    const pairs = cursor.split(',');
    
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex === -1) {
        throw new Error('Invalid cursor format: missing colon separator');
      }
      
      const field = pair.substring(0, colonIndex);
      const encodedValue = pair.substring(colonIndex + 1);
      
      if (!field) {
        throw new Error('Invalid cursor format: empty field name');
      }
      
      data[field] = decodeURIComponent(encodedValue);
    }
    
    return data;
  } catch (e) {
    throw new Error(`Invalid cursor format: ${e.message}`);
  }
};

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
 * @returns {Object|null} Links object with self, first, next
 * 
 * @example
 * // Input: First page of results
 * const urlPrefix = '/api/v1';
 * const scopeName = 'articles';
 * const queryParams = { 
 *   filter: { status: 'published' },
 *   page: { size: 20 }
 * };
 * const records = [
 *   { id: 1, created_at: '2024-01-01', title: 'First' },
 *   { id: 2, created_at: '2024-01-02', title: 'Second' },
 *   { id: 3, created_at: '2024-01-03', title: 'Third' }
 * ];
 * const hasMore = true;  // More records exist
 * 
 * const links = generateCursorPaginationLinks(
 *   urlPrefix, scopeName, queryParams, records, 20, hasMore, ['created_at', 'id']
 * );
 * 
 * // Output:
 * // {
 * //   self: '/api/v1/articles?filter[status]=published&page[size]=20',
 * //   first: '/api/v1/articles?filter[status]=published&page[size]=20',
 * //   next: '/api/v1/articles?filter[status]=published&page[size]=20&page[after]=created_at:2024-01-03,id:3'
 * // }
 * // The 'next' cursor points after the last record (id:3)
 * 
 * @example
 * // Input: Last page (no more records)
 * const records = [
 *   { id: 98, created_at: '2024-03-01' },
 *   { id: 99, created_at: '2024-03-02' }
 * ];
 * const hasMore = false;  // No more records
 * 
 * const links = generateCursorPaginationLinks(
 *   '/api', 'articles', {}, records, 20, hasMore, ['id']
 * );
 * 
 * // Output - no 'next' link:
 * // {
 * //   self: '/api/articles?page[size]=20',
 * //   first: '/api/articles?page[size]=20'
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin when cursor pagination is enabled
 * - Called after fetching records with cursor-based query
 * 
 * Purpose:
 * - Cursor pagination is more efficient for large datasets
 * - Stable pagination when data is being added/removed
 * - Only includes 'next' link when more data exists
 * - Preserves all other query parameters
 * 
 * Data flow:
 * 1. After cursor-based query fetches records
 * 2. If hasMore is true, creates cursor from last record
 * 3. Builds next link with page[after] parameter
 * 4. Added to response.links for navigation
 * 5. Client uses next link to fetch subsequent pages
 */
export const generateCursorPaginationLinks = (urlPrefix, scopeName, queryParams, records, pageSize, hasMore, sortFields = ['id']) => {
  if (!urlPrefix || !records.length) return null;
  
  const links = {};
  const baseUrl = `${urlPrefix}/${scopeName}`;
  
  const otherParams = Object.entries(queryParams)
    .filter(([key]) => key !== 'page')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map(v => `${key}=${encodeURIComponent(v)}`).join('&');
      } else if (typeof value === 'object' && value !== null) {
        const parts = [];
        const processObject = (obj, prefix) => {
          Object.entries(obj).forEach(([k, v]) => {
            const newKey = prefix ? `${prefix}[${k}]` : `${key}[${k}]`;
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              processObject(v, newKey);
            } else {
              parts.push(`${newKey}=${encodeURIComponent(v)}`);
            }
          });
        };
        processObject(value, key);
        return parts.join('&');
      }
      return `${key}=${encodeURIComponent(value)}`;
    })
    .join('&');
  
  const queryPrefix = otherParams ? `?${otherParams}&` : '?';
  
  if (queryParams.page?.after) {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[after]=${queryParams.page.after}`;
  } else if (queryParams.page?.before) {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[before]=${queryParams.page.before}`;
  } else {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}`;
  }
  
  links.first = `${baseUrl}${queryPrefix}page[size]=${pageSize}`;
  
  if (hasMore && records.length > 0) {
    const lastRecord = records[records.length - 1];
    const nextCursor = createCursor(lastRecord, sortFields);
    links.next = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[after]=${nextCursor}`;
  }
  
  return links;
};

/**
 * Builds cursor pagination metadata for the response
 * 
 * @param {Array<Object>} records - Current page records
 * @param {number} pageSize - Records per page
 * @param {boolean} hasMore - Whether more records exist
 * @param {Array<string>} sortFields - Fields used for cursor
 * @returns {Object} Metadata with pageSize, hasMore, and optional cursor
 * 
 * @example
 * // Input: Page with more records available
 * const records = [
 *   { id: 10, created_at: '2024-01-10', title: 'Article 10' },
 *   { id: 11, created_at: '2024-01-11', title: 'Article 11' },
 *   { id: 12, created_at: '2024-01-12', title: 'Article 12' }
 * ];
 * const meta = buildCursorMeta(records, 20, true, ['created_at', 'id']);
 * 
 * // Output:
 * // {
 * //   pageSize: 20,
 * //   hasMore: true,
 * //   cursor: {
 * //     next: 'created_at:2024-01-12,id:12'  // Cursor from last record
 * //   }
 * // }
 * 
 * @example
 * // Input: Last page (no more records)
 * const records = [
 *   { id: 98, name: 'Last Item' }
 * ];
 * const meta = buildCursorMeta(records, 20, false, ['id']);
 * 
 * // Output:
 * // {
 * //   pageSize: 20,
 * //   hasMore: false
 * //   // No cursor property since hasMore is false
 * // }
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin adds this to response.meta for cursor pagination
 * - Provides cursor that client can use directly if needed
 * 
 * Purpose:
 * - Gives clients direct access to cursor for custom pagination
 * - Indicates whether more pages exist without counting
 * - Simpler than offset pagination metadata (no total count)
 * 
 * Data flow:
 * 1. Called after fetching records with cursor query
 * 2. Creates cursor from last record if more exist
 * 3. Added to response.meta.pagination
 * 4. Clients can use cursor directly or use the next link
 */
export const buildCursorMeta = (records, pageSize, hasMore, sortFields = ['id']) => {
  const meta = {
    pageSize,
    hasMore
  };
  
  if (hasMore && records.length > 0) {
    const lastRecord = records[records.length - 1];
    meta.cursor = {
      next: createCursor(lastRecord, sortFields)
    };
  }
  
  return meta;
};