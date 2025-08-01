import { buildIncludedResources } from './knex-relationship-includes.js';

/**
 * Processes the ?include= parameter to load related resources efficiently
 * 
 * @param {Object} scope - The scope object for the primary resource
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {Object} deps - Dependencies object containing log, scopes, knex, and context
 * @returns {Promise<Array<Object>>} Array of included resources in JSON:API format
 * 
 * @example
 * // Input: Articles with author relationship
 * const articles = [
 *   { id: 1, title: 'First Article', author_id: 10 },
 *   { id: 2, title: 'Second Article', author_id: 11 },
 *   { id: 3, title: 'Third Article', author_id: 10 }  // Same author as article 1
 * ];
 * 
 * const deps = {
 *   context: { 
 *     scopeName: 'articles',
 *     queryParams: { include: ['author'] },
 *     schemaInfo: { idProperty: 'id' }
 *   }
 * };
 * 
 * const included = await processIncludes(scope, articles, deps);
 * 
 * // Output: Deduplicated authors (only 2, not 3)
 * // [
 * //   { type: 'users', id: '10', attributes: { name: 'Alice', email: 'alice@example.com' } },
 * //   { type: 'users', id: '11', attributes: { name: 'Bob', email: 'bob@example.com' } }
 * // ]
 * 
 * @example
 * // Input: Nested includes with dot notation
 * const articles = [{ id: 1, title: 'Article', author_id: 10 }];
 * 
 * const deps = {
 *   context: {
 *     queryParams: { 
 *       include: ['author', 'comments.user'] // Load author AND comment users
 *     }
 *   }
 * };
 * 
 * const included = await processIncludes(scope, articles, deps);
 * 
 * // Output: All related resources in flat array
 * // [
 * //   { type: 'users', id: '10', attributes: { name: 'Author' } },
 * //   { type: 'comments', id: '1', attributes: { text: 'Great!' } },
 * //   { type: 'comments', id: '2', attributes: { text: 'Nice!' } },
 * //   { type: 'users', id: '20', attributes: { name: 'Commenter1' } },
 * //   { type: 'users', id: '21', attributes: { name: 'Commenter2' } }
 * // ]
 * 
 * @example
 * // Input: With sparse fieldsets limiting included data
 * const deps = {
 *   context: {
 *     queryParams: { 
 *       include: ['author'],
 *       fields: { 
 *         users: 'name'  // Only include name field for users
 *       }
 *     }
 *   }
 * };
 * 
 * const included = await processIncludes(scope, articles, deps);
 * 
 * // Output: Users with only requested fields
 * // [
 * //   { type: 'users', id: '10', attributes: { name: 'Alice' } }
 * //   // email field excluded due to sparse fieldset
 * // ]
 * 
 * @description
 * Used by:
 * - rest-api-knex-plugin's dataGet method when includes are requested
 * - rest-api-knex-plugin's dataQuery method for collection includes
 * - Called after primary records are fetched but before response assembly
 * 
 * Purpose:
 * - Implements JSON:API compound documents with primary data and includes
 * - Prevents N+1 queries by batch loading all related resources
 * - Handles complex nested includes like 'comments.author.company'
 * - Automatically deduplicates included resources
 * - Respects sparse fieldsets on included resources
 * 
 * Data flow:
 * 1. Receives primary records and include directives
 * 2. Parses include parameter (comma-separated, possibly nested with dots)
 * 3. Delegates to buildIncludedResources for actual loading
 * 4. Returns flat array of all included resources
 * 5. These resources go into the 'included' section of JSON:API response
 */
export const processIncludes = async (scope, records, deps) => {
  try {
    const { log, scopes, knex, context, api } = deps;
    
    const scopeName = context.scopeName;
    
    if (!scopeName) {
      log.error('[PROCESS-INCLUDES] scopeName is undefined in context!', { 
        contextKeys: Object.keys(context || {})
      });
      throw new Error('scopeName is undefined in context');
    }
    
    const db = context.transaction || knex;
    const queryParams = context.queryParams;
    const idProperty = context.schemaInfo.idProperty;
    
    if (!queryParams.include) {
      return [];
    }
    
    log.debug('[PROCESS-INCLUDES] Processing includes:', queryParams.include);
    
    const includeResult = await buildIncludedResources(
      {
        records,
        scopeName,
        includeParam: queryParams.include,
        fields: queryParams.fields || {},
        idProperty
      },
      {
        context: {
          scopes,
          log,
          knex: db,
          capabilities: api?.knex?.capabilities
        }
      }
    );
    
    log.debug('[PROCESS-INCLUDES] Include result:', {
      includedCount: includeResult.included.length,
      types: [...new Set(includeResult.included.map(r => r.type))]
    });
    
    return includeResult.included;
  } catch (error) {
    const { log, context } = deps || {};
    
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
    
    const enhancedError = new Error(
      `Failed to process includes${context?.scopeName ? ` for scope '${context.scopeName}'` : ''}: ${error.message}`
    );
    enhancedError.originalError = error;
    throw enhancedError;
  }
};