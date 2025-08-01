/**
 * Builds the SELECT clause for a Knex query, handling field selection and table prefixing
 * 
 * @param {Object} query - The Knex query builder instance
 * @param {string} tableName - The table name
 * @param {Array<string>|string} fieldsToSelect - Fields to select or '*'
 * @param {boolean} useTablePrefix - Whether to prefix fields with table name
 * @returns {Object} The modified query builder
 * 
 * @example
 * // Input: Basic query without specific fields
 * const query = knex('articles');
 * buildQuerySelection(query, 'articles', '*', false);
 * 
 * // Effect on query: No modification, Knex defaults to SELECT *
 * // SQL generated: SELECT * FROM articles
 * 
 * @example
 * // Input: Query with sparse fieldset
 * const query = knex('articles');
 * const fields = ['id', 'title', 'author_id'];
 * buildQuerySelection(query, 'articles', fields, false);
 * 
 * // Effect on query: Adds select() with specific fields
 * // SQL generated: SELECT id, title, author_id FROM articles
 * // Response will only include these 3 fields, reducing payload size
 * 
 * @example
 * // Input: Query with joins needing table prefixes
 * const query = knex('articles')
 *   .join('users', 'articles.author_id', 'users.id');
 * const fields = ['id', 'title', 'created_at as published'];
 * buildQuerySelection(query, 'articles', fields, true);
 * 
 * // Effect on query: Prefixes all fields with table name
 * // SQL generated: SELECT articles.id, articles.title, articles.created_at as published
 * // Prevents "column 'id' is ambiguous" errors since both tables have id
 * 
 * @description
 * Used by:
 * - knex-query-helpers.js calls this when building queries with sparse fieldsets
 * - rest-api-knex-plugin uses this in dataQuery to optimize SELECT clauses
 * - Called whenever fields parameter limits which attributes to return
 * 
 * Purpose:
 * - Implements JSON:API sparse fieldsets by selecting only requested fields
 * - Prevents ambiguous column errors in queries with joins
 * - Reduces database transfer by not selecting unnecessary columns
 * - Handles field aliases (e.g., "created_at as published")
 * 
 * Data flow:
 * 1. Query parser extracts fields parameter (e.g., fields[articles]=title,author)
 * 2. This function adds appropriate SELECT clause to query
 * 3. Database returns only selected columns
 * 4. Smaller result sets improve query performance
 * 5. JSON:API response includes only requested attributes
 */
export const buildQuerySelection = (query, tableName, fieldsToSelect, useTablePrefix = false) => {
  if (fieldsToSelect === '*') {
    return useTablePrefix ? query.select(`${tableName}.*`) : query;
  } else {
    const fields = useTablePrefix 
      ? fieldsToSelect.map(field => {
          // Handle aliased fields (e.g., "user_id as id")
          if (field.includes(' as ')) {
            const [realField, alias] = field.split(' as ');
            return `${tableName}.${realField.trim()} as ${alias.trim()}`;
          }
          return `${tableName}.${field}`;
        })
      : fieldsToSelect;
    return query.select(fields);
  }
};