// @ts-check
/** @import {
 * CompletedWriteContext, LifecycleArguments
 * } from './lifecycle-types.js' */
import { applyResourceVersion, captureInverseVersions, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { lockRelationshipParent, lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
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
  commitOwnedTransaction
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

    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = processRelationships(
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

    // Fetch minimal record for authorization checks
    const minimalRecord = await helpers.dataGetMinimal({
      scopeName,
      context,
      runHooks
    })

    if (!minimalRecord) {
      throw new RestApiResourceError(
        `Resource not found: ${scopeName}/${context.id}`,
        { subtype: ERROR_SUBTYPES.NOT_FOUND }
      )
    }

    context.minimalRecord = minimalRecord

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

    await lockRelationshipTargets(api, context.transaction, belongsToTargets)

    if (manyToManyRelationships.length || reverseRelationships.length) {
      await lockRelationshipParent({ context, helpers, scopeName })
    }

    await applyFieldSetters(context, api, helpers)
    const inverseVersions = await captureInverseVersions({ api, helpers, context, scopeName })
    await applyResourceVersion({ state: versionState, context, helpers, scopeName })

    await helpers.dataPatch({
      scopeName,
      context
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
      helpers
    })

    await commitOwnedTransaction(context)

    return response
  } catch (error) {
    await handleWriteMethodError(error, callerContext, 'PATCH', scopeName, log)
  }
}
