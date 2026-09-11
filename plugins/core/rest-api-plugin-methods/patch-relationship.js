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
 */
export default async function patchRelationshipMethod ({ params, context, vars, helpers, scope, scopes, runHooks, scopeOptions, scopeName, api, log }) {
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  context.method = 'patchRelationship'
  context.scopeName = scopeName
  context.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  context.relationshipName = params.relationshipName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo

  // Transaction handling
  await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
  context.db = context.transaction || api.knex.instance

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
      inputRecord: {
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

    // 204 No Content
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_RELATIONSHIP', scopeName, log)
  }
}
