import { RestApiResourceError } from '../../../../lib/rest-api-errors.js';
import { ROW_NUMBER_KEY, DEFAULT_QUERY_LIMIT, DEFAULT_MAX_QUERY_LIMIT, DEFAULT_MAX_INCLUDE_LIMIT } from '../querying-writing/knex-constants.js';

/**
 * Builds a window function query for limited includes per parent record
 * 
 * @param {Object} knex - Knex instance
 * @param {string} tableName - Target table name
 * @param {string} foreignKey - Foreign key field
 * @param {Array} parentIds - Parent record IDs
 * @param {Array} fieldsToSelect - Fields to select
 * @param {Object} includeConfig - Include configuration (limit, orderBy)
 * @param {Object} capabilities - Database capabilities
 * @param {Object} scopeVars - Scope variables for defaults and limits
 * @returns {Object} Knex query
 * 
 * @example
 * // Input: Load max 3 comments per article, ordered by newest first
 * const query = buildWindowedIncludeQuery(
 *   knex,
 *   'comments',
 *   'article_id',
 *   [1, 2, 3],  // Article IDs
 *   ['id', 'text', 'created_at'],
 *   { limit: 3, orderBy: ['-created_at'] },
 *   { windowFunctions: true },
 *   { queryDefaultLimit: 10 }
 * );
 * 
 * // Generated SQL:
 * // WITH _windowed AS (
 * //   SELECT id, text, created_at, article_id,
 * //          ROW_NUMBER() OVER (
 * //            PARTITION BY article_id 
 * //            ORDER BY created_at DESC
 * //          ) as __$jsonrestapi_rn$__
 * //   FROM comments
 * //   WHERE article_id IN (1, 2, 3)
 * // )
 * // SELECT * FROM _windowed 
 * // WHERE __$jsonrestapi_rn$__ <= 3
 * 
 * // Result: Each article gets max 3 comments, not 3 total
 * 
 * @example
 * // Input: Database doesn't support window functions
 * const query = buildWindowedIncludeQuery(
 *   knex,
 *   'comments',
 *   'article_id',
 *   [1, 2, 3],
 *   '*',
 *   { limit: 5 },
 *   { windowFunctions: false, dbInfo: { client: 'mysql', version: '5.7' } }
 * );
 * 
 * // Throws RestApiResourceError:
 * // "Include limits require window function support. Your database (mysql 5.7) 
 * //  does not support this feature. Window functions are supported in: 
 * //  PostgreSQL 8.4+, MySQL 8.0+, MariaDB 10.2+, SQLite 3.25+, SQL Server 2005+"
 * 
 * @description
 * Used by:
 * - loadHasMany when strategy: 'window' and database supports window functions
 * - Enables per-parent limits for one-to-many relationships
 * 
 * Purpose:
 * - Solves the "N+1 limit" problem where you want X records per parent
 * - Without window functions, LIMIT 10 gives 10 total across all parents
 * - With window functions, each parent gets up to 10 related records
 * - Critical for consistent API responses with includes
 * 
 * Data flow:
 * 1. Creates subquery with ROW_NUMBER() partitioned by foreign key
 * 2. Numbers rows within each partition based on orderBy
 * 3. Outer query filters to keep only rows within limit
 * 4. Returns query ready for execution
 * 5. Caller removes the ROW_NUMBER column from results
 */
export const buildWindowedIncludeQuery = (
  knex,
  tableName,
  foreignKey,
  parentIds,
  fieldsToSelect,
  includeConfig,
  capabilities,
  scopeVars = {}
) => {
  const { orderBy = [] } = includeConfig;
  
  // Apply defaults for limit
  const effectiveLimit = includeConfig.limit ?? scopeVars.queryDefaultLimit ?? DEFAULT_QUERY_LIMIT;
  
  // Validate against max
  if (scopeVars.queryMaxLimit && effectiveLimit > scopeVars.queryMaxLimit) {
    throw new RestApiResourceError({
      title: 'Include Limit Exceeds Maximum',
      detail: `Requested include limit (${effectiveLimit}) exceeds queryMaxLimit (${scopeVars.queryMaxLimit})`,
      status: 400
    });
  }
  
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
        ') as ' + ROW_NUMBER_KEY,
        [foreignKey]
      )
    )
    .whereIn(foreignKey, parentIds);
  
  // Apply field selection if specified
  if (fieldsToSelect !== '*' && Array.isArray(fieldsToSelect)) {
    // Include the foreign key and row number in selection
    const fieldsWithFK = [...new Set([...fieldsToSelect, foreignKey, ROW_NUMBER_KEY])];
    subquery.select(fieldsWithFK);
  }
  
  // Wrap in outer query to filter by row number
  const query = knex
    .select('*')
    .from(subquery.as('_windowed'))
    .where(ROW_NUMBER_KEY, '<=', effectiveLimit);
  
  return query;
};

/**
 * Builds ORDER BY clause from array of sort fields
 * 
 * @param {Array<string>} orderBy - Array of field names, prefix with '-' for DESC
 * @param {string} tablePrefix - Optional table name to prefix fields
 * @returns {string} SQL ORDER BY clause
 * 
 * @example
 * // Input: Simple ascending sort
 * const clause = buildOrderByClause(['name', 'created_at']);
 * // Output: "name ASC, created_at ASC"
 * 
 * @example
 * // Input: Mixed ascending/descending with '-' prefix
 * const clause = buildOrderByClause(['name', '-created_at', 'status']);
 * // Output: "name ASC, created_at DESC, status ASC"
 * 
 * @example
 * // Input: With table prefix for joins
 * const clause = buildOrderByClause(['-updated_at', 'title'], 'articles');
 * // Output: "articles.updated_at DESC, articles.title ASC"
 * 
 * @example
 * // Input: Empty array (default to id)
 * const clause = buildOrderByClause([]);
 * // Output: "id ASC"
 * 
 * @description
 * Used by:
 * - buildWindowedIncludeQuery for PARTITION BY ordering
 * - applyStandardIncludeConfig for regular ORDER BY
 * - Query builders that need consistent sort syntax
 * 
 * Purpose:
 * - Converts API sort syntax (with '-' prefix) to SQL ORDER BY
 * - Handles table prefixing for queries with joins
 * - Provides default ordering by id when none specified
 * - Ensures consistent sort behavior across the API
 * 
 * Data flow:
 * 1. Receives array of sort fields from API parameters
 * 2. Detects DESC sorts by '-' prefix
 * 3. Optionally prefixes with table name
 * 4. Joins into SQL-compatible ORDER BY clause
 */
export const buildOrderByClause = (orderBy, tablePrefix) => {
  if (!orderBy || orderBy.length === 0) {
    const defaultField = tablePrefix ? `${tablePrefix}.id` : 'id';
    return `${defaultField} ASC`; // Default ordering
  }
  
  return orderBy.map(field => {
    const isDesc = field.startsWith('-');
    const fieldName = isDesc ? field.substring(1) : field;
    const qualifiedField = tablePrefix ? `${tablePrefix}.${fieldName}` : fieldName;
    return `${qualifiedField} ${isDesc ? 'DESC' : 'ASC'}`;
  }).join(', ');
};

/**
 * Applies standard (non-windowed) include configuration to a query
 * 
 * @param {Object} query - Knex query builder instance
 * @param {Object} includeConfig - Include configuration object
 * @param {Object} scopeVars - Scope variables with defaults and limits
 * @param {Object} log - Logger instance
 * @returns {Object} Modified query builder
 * 
 * @example
 * // Input: Basic include with limit and ordering
 * let query = knex('comments').whereIn('article_id', [1, 2, 3]);
 * query = applyStandardIncludeConfig(
 *   query,
 *   { limit: 20, orderBy: ['-created_at', 'id'] },
 *   { queryDefaultLimit: 100, queryMaxLimit: 1000 },
 *   logger
 * );
 * 
 * // Result: Query modified with:
 * // ORDER BY created_at DESC, id ASC
 * // LIMIT 20
 * 
 * @example
 * // Input: No explicit limit, uses defaults
 * let query = knex('tags');
 * query = applyStandardIncludeConfig(
 *   query,
 *   { orderBy: ['name'] },  // No limit specified
 *   { queryDefaultLimit: 50, queryMaxLimit: 500 },
 *   logger
 * );
 * 
 * // Result: Uses default limit
 * // ORDER BY name ASC
 * // LIMIT 50
 * // Log: "Using default limit"
 * 
 * @example
 * // Input: Limit exceeds maximum
 * let query = knex('reviews');
 * query = applyStandardIncludeConfig(
 *   query,
 *   { limit: 5000 },  // Exceeds max
 *   { queryMaxLimit: 1000, maxIncludeLimit: 500 },
 *   logger  
 * );
 * 
 * // Result: Clamped to effective maximum
 * // LIMIT 500 (min of maxIncludeLimit and queryMaxLimit)
 * 
 * @example
 * // Input: Explicitly disable limit
 * let query = knex('categories');
 * query = applyStandardIncludeConfig(
 *   query,
 *   { limit: null },  // Explicitly no limit
 *   { queryDefaultLimit: 100 },
 *   logger
 * );
 * 
 * // Result: No LIMIT clause added
 * // Log: "No limit applied to include query (explicitly disabled)"
 * 
 * @description
 * Used by:
 * - loadHasMany when window functions not available or not requested
 * - loadReversePolymorphic for standard relationship queries
 * - Any include loader that needs consistent limit/order handling
 * 
 * Purpose:
 * - Provides fallback when window functions unavailable
 * - Applies consistent ordering based on API sort syntax
 * - Enforces limit hierarchy: explicit > default > max
 * - Respects both queryMaxLimit and maxIncludeLimit
 * - Logs decisions for debugging
 * 
 * Data flow:
 * 1. Applies ORDER BY for each field in orderBy array
 * 2. Determines effective limit from explicit/default/max values
 * 3. Clamps limit to maximum allowed values
 * 4. Adds LIMIT clause unless explicitly disabled
 * 5. Logs the reasoning for the applied limit
 */
export const applyStandardIncludeConfig = (query, includeConfig, scopeVars, log) => {
  const { orderBy = [] } = includeConfig;
  
  // Apply ordering
  orderBy.forEach(field => {
    const desc = field.startsWith('-');
    const column = desc ? field.substring(1) : field;
    query = query.orderBy(column, desc ? 'desc' : 'asc');
  });
  
  // Apply limit with defaults
  const requestedLimit = includeConfig.limit;
  const defaultLimit = scopeVars.queryDefaultLimit ?? DEFAULT_QUERY_LIMIT;
  const limit = requestedLimit ?? defaultLimit;
  
  // Allow explicit null/false to mean no limit
  if (limit !== null && limit !== false) {
    const maxInclude = scopeVars.maxIncludeLimit || DEFAULT_MAX_INCLUDE_LIMIT;
    const maxQuery = scopeVars.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT;
    const effectiveMax = Math.min(maxInclude, maxQuery);
    const effectiveLimit = Math.min(limit, effectiveMax);
    
    query = query.limit(effectiveLimit);
    
    log.debug('Applied include limit:', {
      requested: requestedLimit,
      default: defaultLimit,
      effective: effectiveLimit,
      maxAllowed: effectiveMax,
      note: requestedLimit !== undefined ? 'Using explicit limit' : 'Using default limit'
    });
  } else {
    log.debug('No limit applied to include query (explicitly disabled)');
  }
  
  return query;
};