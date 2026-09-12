// @ts-check
/** @import {
 * IdentityContext, LifecycleArguments
 * } from './lifecycle-types.js' */
import { initializeResourceVersion, applyResourceVersion, captureInverseVersions, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { commitOwnedTransaction, handleWriteMethodError, writePrecondition } from './common.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'

/**
 * Delete an existing resource and complete only an owned transaction.
 * The programmatic method returns no resource; connectors choose HTTP status.
 * @param {LifecycleArguments} args
 */
export default async function deleteMethod ({
  params,
  context: callerContext,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  scopeOptions,
  scopeName,
  api,
  log
}) {
  // Make the method available to all hooks
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  callerContext.method = 'delete'

  // Set the ID in context
  callerContext.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })

  // Set scopeName in context (needed for broadcasting)
  callerContext.scopeName = scopeName

  // Set schema info even for DELETE (needed by storage layer)
  callerContext.schemaInfo = scope.vars.schemaInfo

  await beginWriteTransaction(callerContext, params.transaction, helpers.newTransaction, runHooks)
  callerContext.db = callerContext.transaction || api.knex.instance
  const context = /** @type {IdentityContext} */ (callerContext)

  try {
    const versionState = initializeResourceVersion({ context, expectedVersion: params.expectedVersion })

    // Fetch minimal record for authorization and logging
    const minimalRecord = await helpers.dataGetMinimal({
      scopeName,
      context,
      runHooks
    })

    if (!minimalRecord) {
      throw new RestApiResourceError(
        'Resource not found',
        {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        }
      )
    }

    context.originalMinimalRecord = minimalRecord
    context.minimalRecord = minimalRecord

    await scope.checkPermissions({
      method: 'delete',
      originalContext: context,
    })

    await params[writePrecondition]?.()

    // Before data operations
    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallDelete')

    // Initialize record context for hooks
    context.record = {}

    const inverseVersions = await captureInverseVersions({ api, helpers, context, scopeName })
    await applyResourceVersion({ state: versionState, context, helpers, scopeName })

    // Call the storage helper
    await helpers.dataDelete({
      scopeName,
      context
    })

    await invalidateInverseVersions({ state: inverseVersions, context, helpers, api, isDelete: true })

    await runHooks('afterDataCallDelete')
    await runHooks('afterDataCall')

    await runHooks('finish')
    await runHooks('finishDelete')

    await commitOwnedTransaction(context)
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE', scopeName, log)
  }
}
