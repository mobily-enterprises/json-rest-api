/**
 * @module knex-process-includes
 * @description Include processing orchestration for REST API Knex Plugin
 * 
 * This module handles the high-level orchestration of relationship includes,
 * coordinating with the relationship include helpers to load related resources
 * efficiently while respecting transactions and sparse fieldsets.
 */

import { buildIncludedResources } from './knex-relationship-includes.js';

/**
 * Processes the ?include= parameter to load related resources.
 * 
 * This function handles the JSON:API include parameter, which allows clients to
 * request related resources in a single request. It supports nested includes
 * (like 'comments.user') and uses efficient batch loading to avoid N+1 queries.
 * The function respects database transactions and sparse fieldsets for included
 * resources.
 * 
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {string} scopeName - The scope name of the primary records
 * @param {Object} queryParams - Query parameters containing include and fields
 * @param {Object} transaction - Optional database transaction
 * @param {Object} dependencies - Helper function dependencies
 * @returns {Promise<Array<Object>>} Array of included resources in JSON:API format
 * 
 * @example <caption>Basic relationship includes</caption>
 * const articles = [{ id: 1, author_id: 10 }, { id: 2, author_id: 11 }];
 * const included = await processIncludes(
 *   articles, 
 *   'articles', 
 *   { include: ['author'] }, 
 *   null, 
 *   dependencies
 * );
 * // Returns: [
 * //   { type: 'users', id: '10', attributes: {...} },
 * //   { type: 'users', id: '11', attributes: {...} }
 * // ]
 * 
 * @example <caption>Nested includes with dot notation</caption>
 * const included = await processIncludes(
 *   articles,
 *   'articles', 
 *   { include: ['author', 'comments.user'] },
 *   null,
 *   dependencies
 * );
 * // Loads authors, then comments for each article, 
 * // then users for each comment - all optimized to avoid N+1
 * 
 * @example <caption>With sparse fieldsets on included resources</caption>
 * const included = await processIncludes(
 *   articles,
 *   'articles',
 *   { 
 *     include: ['author'],
 *     fields: { users: 'name,email' }  // Only load name and email for users
 *   },
 *   trx,  // Within a transaction
 *   dependencies
 * );
 * 
 * @example <caption>Why this is useful upstream</caption>
 * // The REST API Knex plugin uses this to:
 * // 1. Implement JSON:API compound documents efficiently
 * // 2. Avoid N+1 query problems with batch loading
 * // 3. Support deep relationship includes (author.company.address)
 * // 4. Respect database transactions for consistency
 * // 5. Apply sparse fieldsets to included resources
 * // 6. Handle both belongsTo and hasMany relationships
 */
export const processIncludes = async (records, scopeName, queryParams, transaction, dependencies) => {
  const { log, scopes, knex } = dependencies;
  
  if (!queryParams.include) {
    return [];
  }
  
  log.debug('[PROCESS-INCLUDES] Processing includes:', queryParams.include);
  
  // Use transaction if provided, otherwise use base knex instance
  const db = transaction || knex;
  
  const includeResult = await buildIncludedResources(
    scopes,
    log,
    db,
    records,
    scopeName,
    queryParams.include,
    queryParams.fields || {}
  );
  
  log.debug('[PROCESS-INCLUDES] Include result:', {
    includedCount: includeResult.included.length,
    types: [...new Set(includeResult.included.map(r => r.type))]
  });
  
  return includeResult.included;
};