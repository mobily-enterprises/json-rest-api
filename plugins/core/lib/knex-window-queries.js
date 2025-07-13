import { RestApiResourceError } from '../../../lib/rest-api-errors.js';

/**
 * Builds a window function query for limited includes
 * 
 * @param {Object} knex - Knex instance
 * @param {string} tableName - Target table name
 * @param {string} foreignKey - Foreign key field
 * @param {Array} parentIds - Parent record IDs
 * @param {Array} fieldsToSelect - Fields to select
 * @param {Object} includeConfig - Include configuration (limit, orderBy)
 * @param {Object} capabilities - Database capabilities
 * @returns {Object} Knex query
 */
export const buildWindowedIncludeQuery = (
  knex,
  tableName,
  foreignKey,
  parentIds,
  fieldsToSelect,
  includeConfig,
  capabilities
) => {
  const { limit, orderBy = [] } = includeConfig;
  
  // Check if window functions are supported
  if (!capabilities.windowFunctions) {
    const { dbInfo } = capabilities;
    throw new RestApiResourceError(
      `Include limits require window function support. Your database (${dbInfo.client} ${dbInfo.version}) does not support this feature. ` +
      `Window functions are supported in: PostgreSQL 8.4+, MySQL 8.0+, MariaDB 10.2+, SQLite 3.25+, SQL Server 2005+`,
      {
        subtype: 'unsupported_operation',
        database: dbInfo.client,
        version: dbInfo.version,
        requiredFeature: 'window_functions'
      }
    );
  }
  
  // Build the window function query
  // This creates a subquery that partitions by the foreign key and numbers rows
  const subquery = knex(tableName)
    .select('*')
    .select(
      knex.raw(
        'ROW_NUMBER() OVER (PARTITION BY ?? ORDER BY ' + 
        buildOrderByClause(orderBy) + 
        ') as _rn',
        [foreignKey]
      )
    )
    .whereIn(foreignKey, parentIds);
  
  // Apply field selection if specified
  if (fieldsToSelect !== '*' && Array.isArray(fieldsToSelect)) {
    // Include the foreign key and row number in selection
    const fieldsWithFK = [...new Set([...fieldsToSelect, foreignKey, '_rn'])];
    subquery.select(fieldsWithFK);
  }
  
  // Wrap in outer query to filter by row number
  const query = knex
    .select('*')
    .from(subquery.as('_windowed'))
    .where('_rn', '<=', limit);
  
  return query;
};

/**
 * Build ORDER BY clause from array of sort fields
 */
export const buildOrderByClause = (orderBy) => {
  if (!orderBy || orderBy.length === 0) {
    return 'id ASC'; // Default ordering
  }
  
  return orderBy.map(field => {
    if (field.startsWith('-')) {
      return `${field.substring(1)} DESC`;
    }
    return `${field} ASC`;
  }).join(', ');
};

/**
 * Apply standard (non-windowed) include configuration
 * Used for fallback or when window strategy not requested
 */
export const applyStandardIncludeConfig = (query, includeConfig, scopeVars, log) => {
  const { limit, orderBy = [] } = includeConfig;
  
  // Apply ordering
  orderBy.forEach(field => {
    const desc = field.startsWith('-');
    const column = desc ? field.substring(1) : field;
    query = query.orderBy(column, desc ? 'desc' : 'asc');
  });
  
  // Apply global limit (not per-parent)
  if (limit) {
    const effectiveLimit = Math.min(limit, scopeVars.maxIncludeLimit || 1000);
    query = query.limit(effectiveLimit);
    
    log.debug('Applied global include limit:', {
      requested: limit,
      effective: effectiveLimit,
      note: 'This is a global limit, not per-parent'
    });
  }
  
  return query;
};