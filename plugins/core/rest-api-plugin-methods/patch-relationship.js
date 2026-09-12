// @ts-check
/** @import {
 * RelationshipWriteArguments, WriteRelationshipContext
 * } from './lifecycle-types.js' */
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import {
  commitOwnedTransaction,
  handleWriteMethodError,
  validateRelationshipRoutePayload
} from './common.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'

/**
 * Replace the selected relationship with params.relationshipData.
 * Validate relationship permission/cardinality, then delegate the data mutation
 * and version handling to PATCH using the same transaction. This outer method
 * runs its own finish hooks and completes the transaction only when it owns it.
 * @param {RelationshipWriteArguments} args
 */
export default async function patchRelationshipMethod ({ params, context: callerContext, vars, helpers, scope, scopes, runHooks, scopeOptions, scopeName, api, log }) {
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  callerContext.method = 'patchRelationship'
  callerContext.scopeName = scopeName
  callerContext.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  callerContext.relationshipName = params.relationshipName
  callerContext.schemaInfo = scope.vars.schemaInfo

  await beginWriteTransaction(callerContext, params.transaction, helpers.newTransaction, runHooks)
  callerContext.db = callerContext.transaction || api.knex.instance
  const context = /** @type {WriteRelationshipContext} */ (callerContext)

  try {
    // Check permissions
    await runHooks('checkPermissions')
    await runHooks('checkPermissionsPatchRelationship')

    const relationshipData = validateRelationshipRoutePayload({
      context,
      vars,
      scopeName,
      operation: 'patchRelationship',
      relationshipData: params.relationshipData
    })

    // Reuse existing patch with relationship data
    await scope.patch({
      id: context.id,
      document: {
        data: {
          type: scopeName,
          id: context.id,
          relationships: {
            [params.relationshipName]: { data: relationshipData }
          }
        }
      },
      transaction: context.transaction,
      expectedVersion: params.expectedVersion,
      format: 'jsonapi',
      returning: 'none',
    }, { ...context })

    await runHooks('finish')
    await runHooks('finishPatchRelationship')

    await commitOwnedTransaction(context)
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_RELATIONSHIP', scopeName, log)
  }
}
