/**
 * Pagination helper utilities for JSON:API compliant pagination
 */

/**
 * Calculate pagination metadata
 */
export const calculatePaginationMeta = (total, page, pageSize) => {
  // Validate inputs
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
 * Generate pagination links for offset-based pagination
 */
export const generatePaginationLinks = (urlPrefix, scopeName, queryParams, paginationMeta) => {
  if (!urlPrefix) return null;
  
  const { page, pageCount, pageSize } = paginationMeta;
  const links = {};
  
  // Build query string without page params
  const otherParams = Object.entries(queryParams)
    .filter(([key]) => key !== 'page')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        // Handle arrays (like sort)
        return value.map(v => `${key}=${encodeURIComponent(v)}`).join('&');
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects (like filter)
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
  
  // Self link
  links.self = `${baseUrl}${queryPrefix}page[number]=${page}&page[size]=${pageSize}`;
  
  // Only add navigation links if we have page count (counts enabled)
  if (pageCount !== undefined) {
    // First and last are always available
    links.first = `${baseUrl}${queryPrefix}page[number]=1&page[size]=${pageSize}`;
    links.last = `${baseUrl}${queryPrefix}page[number]=${pageCount}&page[size]=${pageSize}`;
    
    // Prev link (if not on first page)
    if (page > 1) {
      links.prev = `${baseUrl}${queryPrefix}page[number]=${page - 1}&page[size]=${pageSize}`;
    }
    
    // Next link (if not on last page)
    if (page < pageCount) {
      links.next = `${baseUrl}${queryPrefix}page[number]=${page + 1}&page[size]=${pageSize}`;
    }
  }
  
  return links;
};

/**
 * Create a cursor from record data
 */
export const createCursor = (record, sortFields = ['id']) => {
  const cursorData = {};
  sortFields.forEach(field => {
    if (record[field] !== undefined) {
      cursorData[field] = record[field];
    }
  });
  return Buffer.from(JSON.stringify(cursorData)).toString('base64url');
};

/**
 * Parse a cursor back to data
 */
export const parseCursor = (cursor) => {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch (e) {
    throw new Error('Invalid cursor format');
  }
};

/**
 * Generate cursor-based pagination links
 */
export const generateCursorPaginationLinks = (urlPrefix, scopeName, queryParams, records, pageSize, hasMore, sortFields = ['id']) => {
  if (!urlPrefix || !records.length) return null;
  
  const links = {};
  const baseUrl = `${urlPrefix}/${scopeName}`;
  
  // Build query string without page params
  const otherParams = Object.entries(queryParams)
    .filter(([key]) => key !== 'page')
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        // Handle arrays (like sort)
        return value.map(v => `${key}=${encodeURIComponent(v)}`).join('&');
      } else if (typeof value === 'object' && value !== null) {
        // Handle nested objects (like filter)
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
  
  // Self link
  if (queryParams.page?.after) {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[after]=${queryParams.page.after}`;
  } else if (queryParams.page?.before) {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[before]=${queryParams.page.before}`;
  } else {
    links.self = `${baseUrl}${queryPrefix}page[size]=${pageSize}`;
  }
  
  // First link (no cursor)
  links.first = `${baseUrl}${queryPrefix}page[size]=${pageSize}`;
  
  // Next link (if hasMore)
  if (hasMore && records.length > 0) {
    const lastRecord = records[records.length - 1];
    const nextCursor = createCursor(lastRecord, sortFields);
    links.next = `${baseUrl}${queryPrefix}page[size]=${pageSize}&page[after]=${nextCursor}`;
  }
  
  return links;
};

/**
 * Build cursor-based meta information
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