import { RestApiResourceError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { processRelationships } from '../lib/writing/relationship-processor.js'
import { updateManyToManyRelationship } from '../lib/writing/many-to-many-manipulations.js'
import { ERROR_SUBTYPES } from '../lib/querying-writing/knex-constants.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import {
  requireDocumentResourceId,
  requireExistingResourceId
} from '../lib/querying-writing/resource-id-normalization.js'
import {
  setupCommonRequest,
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError
} from './common.js'

/**
 * PATCH
 * Performs a partial update on an existing resource's attributes or relationships.
 * Unlike PUT, PATCH only updates the fields provided, leaving other fields unchanged.
 * This method supports updating both attributes and relationships (1:1 and n:n).
 * For relationships, only the ones explicitly provided will be updated.
 * Just like PUT, it CANNOT have the `included` array in data.
 */
export default async function patchMethod ({
  params,
  context,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  apiOptions,
  pluginOptions,
  scopeOptions,
  scopeName,
  api,
  log
}) {
  context.method = 'patch'

  try {
    const { schema, schemaStructure, schemaRelationships } = await setupCommonRequest({
      params,
      context,
      vars,
      scopes,
      scopeOptions,
      scopeName,
      api,
      helpers
    })
    // Run early hooks for pre-processing (e.g., file handling)
    await runHooks('beforeProcessing')
    await runHooks('beforeProcessingPatch')

    const requestContracts = getRequestContracts({
      scopeName,
      schemaInfo: context.schemaInfo,
      includeDepthLimit: vars.includeDepthLimit,
      sortableFields: vars.sortableFields
    })
    const normalizedPathId = params.id === undefined
      ? null
      : requireExistingResourceId(params.id, {
        scopeOptions,
        vars,
        scopeName
      })

    if (normalizedPathId && !context.inputRecord?.data?.id) {
      context.inputRecord = {
        ...context.inputRecord,
        data: {
          ...(context.inputRecord?.data || {}),
          id: normalizedPathId
        }
      }
    }

    context.inputRecord = validateRequestContractOrThrow(
      requestContracts.patch,
      context.inputRecord,
      'PATCH request body is invalid'
    )
    const normalizedBodyId = requireDocumentResourceId(context.inputRecord.data.id, {
      scopeOptions,
      vars
    })

    if (normalizedPathId && normalizedPathId !== normalizedBodyId) {
      throw new RestApiValidationError(
        `ID mismatch. URL path ID '${normalizedPathId}' does not match request body ID '${normalizedBodyId}'`,
        {
          fields: ['data.id'],
          violations: [{
            field: 'data.id',
            rule: 'id_consistency',
            message: 'Request body ID must match URL path ID when both are provided'
          }]
        }
      )
    }
    context.inputRecord.data.id = normalizedBodyId
    context.id = normalizedPathId || normalizedBodyId

    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later (only for provided relationships in PATCH)
    const { belongsToUpdates, manyToManyRelationships } = processRelationships(
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
        ERROR_SUBTYPES.NOT_FOUND
      )
    }

    context.minimalRecord = minimalRecord

    // Centralised checkPermissions function
    await scope.checkPermissions({
      method: 'patch',
      originalContext: context,
    })

    // Merge belongsTo updates into attributes before patching the record
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      }
    }

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallPatch')

    // Apply field setters after validation and before storage
    if (context.inputRecord?.data?.attributes) {
      context.inputRecord.data.attributes = await applyFieldSetters(
        context.inputRecord.data.attributes,
        context.schemaInfo,
        context,
        api,
        helpers
      )
    }

    // Call the storage helper - should return the patched record
    await helpers.dataPatch({
      scopeName,
      context
    })

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
          resourceId: context.id,
          relDef,
          relData,
          transaction: context.transaction
        }
      })
    }

    const ret = await handleRecordReturnAfterWrite({
      context,
      scopeName,
      api,
      scopes,
      schemaStructure,
      schemaRelationships,
      scopeOptions,
      vars,
      runHooks,
      helpers,
      log
    })

    // Commit transaction if we created it
    if (context.shouldCommit) {
      await context.transaction.commit()
      await runHooks('afterCommit')
    }

    return ret
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH', scopeName, log, runHooks)
  }
}
