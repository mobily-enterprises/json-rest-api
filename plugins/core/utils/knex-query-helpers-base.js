/**
 * @module knex-query-helpers-base
 * @description Basic query building helpers for Knex operations
 * 
 * This module contains fundamental query building functions that work directly
 * with Knex query builders. These are low-level helpers with no dependencies
 * on other modules.
 */

/**
 * Builds the SELECT clause for a Knex query.
 * 
 * This function adds the appropriate SELECT clause to a Knex query builder,
 * handling both wildcard selection and specific field lists. It also supports
 * table prefixing for fields, which is essential when doing joins to avoid
 * column name conflicts.
 * 
 * @param {Object} query - The Knex query builder instance
 * @param {string} tableName - The table name
 * @param {Array<string>|string} fieldsToSelect - Fields to select or '*'
 * @param {boolean} useTablePrefix - Whether to prefix fields with table name
 * @returns {Object} The modified query builder
 * 
 * @example <caption>Select all fields</caption>
 * const query = knex('articles');
 * buildQuerySelection(query, 'articles', '*', false);
 * // Generates: SELECT * FROM articles
 * 
 * @example <caption>Select specific fields</caption>
 * const query = knex('articles');
 * buildQuerySelection(query, 'articles', ['id', 'title', 'author_id'], false);
 * // Generates: SELECT id, title, author_id FROM articles
 * 
 * @example <caption>With table prefix for joins</caption>
 * const query = knex('articles').join('users', 'articles.author_id', 'users.id');
 * buildQuerySelection(query, 'articles', ['id', 'title'], true);
 * // Generates: SELECT articles.id, articles.title FROM articles JOIN users...
 * // Prevents ambiguous column errors when both tables have 'id' column
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Build efficient SELECT clauses based on sparse fieldsets
 * // 2. Avoid ambiguous column errors in JOIN queries
 * // 3. Support both wildcard and specific field selection
 * // 4. Keep query building logic consistent across the codebase
 */
export const buildQuerySelection = (query, tableName, fieldsToSelect, useTablePrefix = false) => {
  if (fieldsToSelect === '*') {
    return useTablePrefix ? query.select(`${tableName}.*`) : query;
  } else {
    const fields = useTablePrefix 
      ? fieldsToSelect.map(field => `${tableName}.${field}`)
      : fieldsToSelect;
    return query.select(fields);
  }
};