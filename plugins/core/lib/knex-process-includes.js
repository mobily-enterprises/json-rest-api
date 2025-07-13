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
 * @param {Object} scope - The scope object for the primary resource
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {Object} deps - Dependencies object containing log, scopes, knex, and context
 * @returns {Promise<Array<Object>>} Array of included resources in JSON:API format
 * 
 * @example <caption>Basic relationship includes</caption>
 * const scope = api.resources['articles'];
 * const articles = [{ id: 1, author_id: 10 }, { id: 2, author_id: 11 }];
 * const deps = {
 *   log, scopes, knex,
 *   context: { 
 *     scopeName: 'articles',
 *     queryParams: { include: ['author'] },
 *     schemaInfo: scope.vars.schemaInfo
 *   }
 * };
 * const included = await processIncludes(scope, articles, deps);
 * // Returns: [
 * //   { type: 'users', id: '10', attributes: {...} },
 * //   { type: 'users', id: '11', attributes: {...} }
 * // ]
 * 
 * @example <caption>Nested includes with dot notation</caption>
 * const deps = {
 *   log, scopes, knex,
 *   context: {
 *     scopeName: 'articles',
 *     queryParams: { include: ['author', 'comments.user'] },
 *     schemaInfo: scope.vars.schemaInfo
 *   }
 * };
 * const included = await processIncludes(scope, articles, deps);
 * // Loads authors, then comments for each article, 
 * // then users for each comment - all optimized to avoid N+1
 * 
 * @example <caption>With sparse fieldsets on included resources</caption>
 * const deps = {
 *   log, scopes, knex,
 *   context: {
 *     scopeName: 'articles',
 *     queryParams: { 
 *       include: ['author'],
 *       fields: { users: 'name,email' }  // Only load name and email for users
 *     },
 *     schemaInfo: scope.vars.schemaInfo,
 *     transaction: trx  // Within a transaction
 *   }
 * };
 * const included = await processIncludes(scope, articles, deps);
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
export const processIncludes = async (scope, records, deps) => {
  try {
    const { log, scopes, knex, context } = deps;
    
    // Get scopeName from context
    const scopeName = context.scopeName;
    
    if (!scopeName) {
      log.error('[PROCESS-INCLUDES] scopeName is undefined in context!', { 
        contextKeys: Object.keys(context || {})
      });
      throw new Error('scopeName is undefined in context');
    }
    
    // Get values from context
    const db = context.transaction || knex;
    const queryParams = context.queryParams;
    const idProperty = context.schemaInfo.idProperty;
    
    if (!queryParams.include) {
      return [];
    }
    
    log.debug('[PROCESS-INCLUDES] Processing includes:', queryParams.include);
    
    const includeResult = await buildIncludedResources(
      scopes,
      log,
      db,
      records,
      scopeName,
      queryParams.include,
      queryParams.fields || {},
      idProperty
    );
    
    log.debug('[PROCESS-INCLUDES] Include result:', {
      includedCount: includeResult.included.length,
      types: [...new Set(includeResult.included.map(r => r.type))]
    });
    
    return includeResult.included;
  } catch (error) {
    const { log, context } = deps || {};
    
    // Log error with context
    if (log) {
      log.error('[PROCESS-INCLUDES] Error processing includes:', {
        scopeName: context?.scopeName,
        recordCount: records?.length || 0,
        includeParam: context?.queryParams?.include,
        error: error.message,
        stack: error.stack
      });
    } else {
      console.error('[PROCESS-INCLUDES] Error processing includes:', error);
    }
    
    // Re-throw with enhanced error message
    const enhancedError = new Error(
      `Failed to process includes${context?.scopeName ? ` for scope '${context.scopeName}'` : ''}: ${error.message}`
    );
    enhancedError.originalError = error;
    throw enhancedError;
  }
};