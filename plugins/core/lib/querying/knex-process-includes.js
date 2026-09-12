import { buildIncludedResources } from './knex-relationship-includes.js'
import { wrapUnexpectedError } from '../../../../lib/error-context.js'

/**
 * Processes the ?include= parameter to load related resources efficiently
 *
 * @param {Object} scope - The scope object for the primary resource
 * @param {Array<Object>} records - The primary records to load includes for
 * @param {Object} deps - Dependencies object containing log, scopes, knex, and context
 * @returns {Promise<import('../storage/storage-types.js').DataResource[]>} Array of included resources in JSON:API format
 */
export const processIncludes = async (scope, records, deps) => {
  try {
    const { log, scopes, knex, context, api } = deps

    const scopeName = context.scopeName

    if (!scopeName) {
      throw new Error('scopeName is undefined in context')
    }

    const db = context.transaction || knex
    const queryParams = context.queryParams

    if (!queryParams.include) {
      return []
    }

    log.debug('[PROCESS-INCLUDES] Processing includes:', { scopeName, recordCount: records.length })

    const includeResult = await buildIncludedResources(
      {
        records,
        scopeName,
        includeParam: queryParams.include,
        fields: queryParams.fields || {}
      },
      {
        context: {
          scopes,
          log,
          knex: db,
          capabilities: api?.knex?.capabilities,
          requestContext: context
        }
      }
    )

    log.debug('[PROCESS-INCLUDES] Include result:', {
      includedCount: includeResult.included.length,
      types: [...new Set(includeResult.included.map(r => r.type))]
    })

    return includeResult.included
  } catch (error) {
    const { context } = deps || {}
    throw wrapUnexpectedError(error, {
      message: `Failed to process includes${context?.scopeName ? ` for scope '${context.scopeName}'` : ''}`,
      context: {
        phase: 'include',
        scopeName: context?.scopeName,
        includeParam: context?.queryParams?.include,
        recordCount: records?.length || 0
      }
    })
  }
}
