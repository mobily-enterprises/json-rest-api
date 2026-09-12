import { applyResourceVersion, captureInverseVersions, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { createPivotRecords } from '../lib/writing/many-to-many-manipulations.js'
import { requireDocumentResourceId } from '../lib/querying-writing/resource-id-normalization.js'
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
 */
export default async function postMethod ({
  params,
  context,
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
  context.method = 'post'

  try {
    const { schema, versionState } = await setupCommonRequest({
      params,
      context,
      vars,
      scopes,
      scopeName,
      api,
      helpers,
      runHooks
    })

    // Run early hooks for pre-processing (e.g., file handling)
    await runHooks('beforeProcessing')
    await runHooks('beforeProcessingPost')

    const requestContracts = getRequestContracts({
      scopeName,
      schemaInfo: context.schemaInfo,
      includeDepthLimit: vars.includeDepthLimit,
      sortableFields: vars.sortableFields
    })
    context.inputRecord = validateRequestContractOrThrow(
      requestContracts.post,
      context.inputRecord,
      'POST request body is invalid'
    )

    if (context.inputRecord?.data?.id !== undefined) {
      context.inputRecord.data.id = requireDocumentResourceId(context.inputRecord.data.id, {
        scopeOptions,
        vars
      })
    }

    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later
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

    // Centralised checkPermissions function
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
    context.id = await helpers.dataPost({
      scopeName,
      context
    })

    await invalidateInverseVersions({ state: inverseVersions, context, helpers, api })

    await runHooks('afterDataCallPost')
    await runHooks('afterDataCall')

    // Process many-to-many relationships after main record creation
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      if (api.anyapi?.links?.attachMany && relDef?.through) {
        await api.anyapi.links.attachMany({
          context,
          scopeName,
          relName,
          relDef,
          relData,
        })
        continue
      }

      // Validate pivot resource exists
      validatePivotResource(scopes, relDef, relName)
      await createPivotRecords(api, context.id, relDef, relData, context.transaction)
    }

    for (const { relDef, relData } of reverseRelationships) {
      await updateReverseRelationship({ api, helpers, context, scopeName, relDef, relData })
    }

    const ret = await handleRecordReturnAfterWrite({
      context,
      scopeName,
      api,
      scopes,
      runHooks,
      helpers
    })

    await commitOwnedTransaction(context)

    return ret
  } catch (error) {
    await handleWriteMethodError(error, context, 'POST', scopeName, log)
  }
}
