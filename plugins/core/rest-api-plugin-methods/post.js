// @ts-check
/** @import {
 * CompletedWriteContext, LifecycleArguments, WriteContext
 * } from './lifecycle-types.js' */
import { applyResourceVersion, captureInverseVersions, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { createPivotRecords } from '../lib/writing/many-to-many-manipulations.js'
import { defaultNormalizeResourceId, requireDocumentResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import {
  setupCommonRequest,
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError,
  commitOwnedTransaction
} from './common.js'

/**
 * Create a resource from plain data or a JSON:API document.
 * Supplied IDs and existing-resource linkage are validated before writing.
 * Prepare the selected returning result before completing an owned transaction.
 * @param {LifecycleArguments} args
 */
export default async function postMethod ({
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
  callerContext.method = 'post'

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
    await runHooks('beforeProcessingPost')

    const requestContracts = getRequestContracts({
      scopeName,
      schemaInfo: preparedContext.schemaInfo,
      includeDepthLimit: vars.includeDepthLimit,
      sortableFields: vars.sortableFields
    })
    preparedContext.inputRecord = validateRequestContractOrThrow(
      requestContracts.post,
      preparedContext.inputRecord,
      'POST request body is invalid'
    )
    const context = /** @type {WriteContext} */ (preparedContext)

    if (context.inputRecord?.data?.id !== undefined) {
      context.inputRecord.data.id = requireDocumentResourceId(context.inputRecord.data.id, {
        scopeOptions,
        vars
      })
    }

    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = await processRelationships(
      scope,
      { context }
    )

    // Merge belongsTo updates into attributes before validation (like PUT/PATCH do)
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      }
    }

    await validateResourceAttributesBeforeWrite({
      context,
      schema,
      belongsToUpdates,
      runHooks
    })

    if (context.inputRecord?.data) {
      const inputData = context.inputRecord.data
      context.minimalRecord = {
        type: scopeName,
        ...(inputData.id !== undefined && inputData.id !== null ? { id: String(inputData.id) } : {}),
        attributes: structuredClone(inputData.attributes || {}),
        relationships: structuredClone(inputData.relationships || {})
      }
    }

    await scope.checkPermissions({
      method: 'post',
      originalContext: context,
    })

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallPost')

    await lockRelationshipTargets(api, context.transaction, belongsToTargets)

    await applyFieldSetters(context, api, helpers)
    const inverseVersions = await captureInverseVersions({ api, helpers, context, scopeName, isCreate: true })
    await applyResourceVersion({ state: versionState, context, helpers, scopeName, isCreate: true })

    // Create the main record and retain the logical ID returned by storage.
    const storedId = await helpers.dataPost({
      scopeName,
      context
    })

    const resourceId = typeof storedId === 'bigint' ? String(storedId) : storedId
    if ((typeof resourceId !== 'string' && typeof resourceId !== 'number') || !defaultNormalizeResourceId(resourceId)) {
      throw new Error('Storage POST did not return a valid resource ID')
    }
    context.id = resourceId
    const completedContext = /** @type {CompletedWriteContext} */ (context)

    await invalidateInverseVersions({ state: inverseVersions, context, helpers, api })

    await runHooks('afterDataCallPost')
    await runHooks('afterDataCall')

    // Process many-to-many relationships after main record creation
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      if (api.anyapi?.links?.attachMany && relDef?.through) {
        await api.anyapi.links.attachMany({
          context: completedContext,
          scopeName,
          relName,
          relDef,
          relData,
        })
        continue
      }

      validatePivotResource(scopes, relDef, relName)
      await createPivotRecords(api, context.id, relDef, relData, context.transaction)
    }

    for (const { relDef, relData } of reverseRelationships) {
      await updateReverseRelationship({ api, helpers, context, scopeName, relDef, relData })
    }

    const response = await handleRecordReturnAfterWrite({
      context: completedContext,
      scopeName,
      api,
      scopes,
      runHooks,
      helpers
    })

    await commitOwnedTransaction(context)

    return response
  } catch (error) {
    await handleWriteMethodError(error, callerContext, 'POST', scopeName, log)
  }
}
