// @ts-check
/** @import {
 * CompletedWriteContext, LifecycleArguments
 * } from './lifecycle-types.js' */
import { applyResourceVersion, captureInverseVersions, inverseVersionTypes, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { lockRelationshipParent, processRelationships } from '../lib/writing/relationship-processor.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { updateManyToManyRelationship } from '../lib/writing/many-to-many-manipulations.js'
import { ERROR_SUBTYPES } from '../lib/querying-writing/knex-constants.js'
import { validateUpdateRequest } from '../lib/querying-writing/request-contracts.js'
import {
  setupCommonRequest,
  writePrecondition,
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError,
  commitOwnedTransaction,
  keepHiddenLinks,
  recordScope,
  storedRowRead
} from './common.js'

/**
 * Update only supplied attributes and relationships on an existing resource.
 * Input normalization, selected write response and transaction ownership use
 * the same contracts as POST/PUT; omitted fields remain unchanged.
 * @param {LifecycleArguments} args
 */
export default async function patchMethod ({
  params,
  context: callerContext,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  hasHooks,
  hookNames,
  scopeOptions,
  scopeName,
  api,
  log
}) {
  callerContext.method = 'patch'

  try {
    const { schema, versionState, context: preparedContext } = await setupCommonRequest({
      params,
      context: callerContext,
      vars,
      scopes,
      scopeName,
      api,
      helpers,
      runHooks
    })
    await runHooks('beforeProcessing')
    await runHooks('beforeProcessingPatch')

    validateUpdateRequest({ method: 'patch', params, context: preparedContext, vars, scopeOptions, scopeName })
    const context = /** @type {CompletedWriteContext} */ (preparedContext)

    // Checks and locks the targets; a parent whose revision this write advances
    // is updated, not just referenced.
    await validateRelationshipAccess(context, context.inputRecord, helpers, api, {
      hasHooks, hookNames, lock: { exclusive: inverseVersionTypes(api, scopeName, context.schemaInfo) }
    })

    const { belongsToUpdates, manyToManyRelationships, reverseRelationships } = processRelationships(
      scope,
      { context }
    )

    await validateResourceAttributesBeforeWrite({
      context,
      schema,
      belongsToUpdates,
      runHooks,
      isPartialValidation: true
    })

    const notFound = () => new RestApiResourceError(
      `Resource not found: ${scopeName}/${context.id}`,
      { subtype: ERROR_SUBTYPES.NOT_FOUND }
    )
    // The stored row serves the permission check and the hooks, and keeps a
    // cleared link to a hidden target. A field setter runs before the UPDATE, so
    // it would answer before a missing row does, and a full response's get runs
    // with this context, whose minimal record its hooks see: both read too.
    // Otherwise the UPDATE carries the caller's scope (see storedRowRead).
    const usesRow = context.returning === 'full' || manyToManyRelationships.length > 0 || reverseRelationships.length > 0 ||
      Object.values(belongsToUpdates).includes(null) || (context.schemaInfo.sortedSetterFields || []).length > 0
    const reads = storedRowRead({ context, params, api, scopeName, helpers, hookNames, usesRow })
    const callerScope = reads === 'none' ? (await recordScope({ context, helpers, scopeName, runHooks })).query : undefined
    if (reads !== 'none') {
      // Fetch minimal record for authorization checks
      const minimalRecord = await helpers.dataGetMinimal({
        scopeName,
        context,
        runHooks,
        idsOnly: reads === 'id'
      })
      if (!minimalRecord) throw notFound()
      if (reads === 'row') {
        context.minimalRecord = minimalRecord
        await keepHiddenLinks({ context, scopes, schemaInfo: context.schemaInfo, rows: [{ updates: belongsToUpdates, stored: minimalRecord, inputRecord: context.inputRecord }] })
      }
    }

    await scope.checkPermissions({
      method: 'patch',
      originalContext: context,
    })

    await params[writePrecondition]?.()

    // Merge belongsTo updates into attributes before patching the record
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      }
    }

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallPatch')

    if (manyToManyRelationships.length || reverseRelationships.length) {
      await lockRelationshipParent({ context, helpers, scopeName })
    }

    await applyFieldSetters(context, api, helpers)
    const inverseVersions = await captureInverseVersions({ api, helpers, context, scopeName })
    await applyResourceVersion({ state: versionState, context, helpers, scopeName })

    await helpers.dataPatch({
      scopeName,
      context,
      // Without a read first, a row the UPDATE does not find is missing as the read
      // would have answered; after one, it went or moved since, as before.
      ...(callerScope ? { scope: callerScope, notFound } : {})
    })

    await invalidateInverseVersions({ state: inverseVersions, context, helpers, api })

    await runHooks('afterDataCallPatch')
    await runHooks('afterDataCall')

    // Process many-to-many relationships after main record update
    // For PATCH, we only update the relationships that were explicitly provided
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      if (relDef?.through && api.anyapi?.links?.syncMany) {
        await api.anyapi.links.syncMany({
          context,
          scopeName,
          relName,
          relDef,
          relData,
          isUpdate: true,
        })
        continue
      }

      validatePivotResource(scopes, relDef, relName)

      await updateManyToManyRelationship(null, {
        api,
        context: {
          ...context,
          resourceId: context.id,
          relDef,
          relData,
          transaction: context.transaction
        }
      })
    }

    for (const { relDef, relData } of reverseRelationships) {
      await updateReverseRelationship({ api, helpers, context, scopeName, relDef, relData })
    }

    const response = await handleRecordReturnAfterWrite({
      context,
      scopeName,
      api,
      scopes,
      runHooks,
      hasHooks,
      helpers
    })

    await commitOwnedTransaction(context)

    return response
  } catch (error) {
    await handleWriteMethodError(error, callerContext, 'PATCH', scopeName, log)
  }
}
