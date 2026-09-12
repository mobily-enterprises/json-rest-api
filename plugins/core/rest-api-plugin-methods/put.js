// @ts-check
/** @import {
 * CompletedWriteContext, LifecycleArguments, PivotField
 * } from './lifecycle-types.js' */
import { applyResourceVersion, captureInverseVersions, invalidateInverseVersions } from '../lib/writing/resource-version.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { lockRelationshipParent, lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { updateManyToManyRelationship, createPivotRecords } from '../lib/writing/many-to-many-manipulations.js'
import { ERROR_SUBTYPES } from '../lib/querying-writing/knex-constants.js'
import { validateUpdateRequest } from '../lib/querying-writing/request-contracts.js'
import {
  setupCommonRequest,
  writePrecondition,
  validateCompleteReplacePayload,
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError,
  commitOwnedTransaction
} from './common.js'

/**
 * Create or replace a resource at the selected ID. Replacement requires existing
 * stored values to be explicitly represented; relationship collections follow
 * replacement semantics when a relationships object is supplied. This operation
 * links existing related resources rather than creating an included graph.
 * @param {LifecycleArguments} args
 */
export default async function putMethod ({
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
  callerContext.method = 'put'

  try {
    const { schema, schemaStructure, schemaRelationships, versionState, context: preparedContext } = await setupCommonRequest({
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
    await runHooks('beforeProcessingPut')

    validateUpdateRequest({ method: 'put', params, context: preparedContext, vars, scopeOptions, scopeName })
    const context = /** @type {CompletedWriteContext} */ (preparedContext)

    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = processRelationships(
      scope,
      { context }
    )

    context.exists = await helpers.dataExists({
      scopeName,
      context
    })

    context.isCreate = !context.exists
    context.isUpdate = context.exists

    // Fetch minimal record for authorization checks (only for updates)
    if (context.isUpdate) {
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
    }

    validateCompleteReplacePayload({
      context,
      belongsToUpdates
    })

    await validateResourceAttributesBeforeWrite({
      context,
      schema,
      belongsToUpdates,
      runHooks
    })

    // Supplying relationships makes PUT clear omitted linkage; omitting the object preserves it.
    if (context.inputRecord.data.relationships !== undefined) {
      const provided = new Set(Object.keys(context.inputRecord.data.relationships))
      for (const [relName, relDef] of Object.entries(schemaRelationships)) {
        if (provided.has(relName)) continue
        if (relDef.type === 'hasOne' || relDef.type === 'hasMany') {
          reverseRelationships.push({ relName, relDef, relData: relDef.type === 'hasOne' ? null : [] })
        } else if (relDef.type === 'manyToMany') {
          manyToManyRelationships.push({
            relName,
            relDef: /** @type {PivotField} */ ({
              through: relDef.through, foreignKey: relDef.foreignKey, otherKey: relDef.otherKey
            }),
            relData: []
          })
        }
      }
      for (const [field, definition] of Object.entries(schemaStructure)) {
        if (definition.belongsTo && definition.as && !provided.has(definition.as)) {
          belongsToUpdates[field] = null
        }
      }
    }

    // Merge belongsTo updates with attributes
    if (Object.keys(belongsToUpdates).length > 0) {
      context.inputRecord.data.attributes = {
        ...context.inputRecord.data.attributes,
        ...belongsToUpdates
      }
    }

    await scope.checkPermissions({
      method: 'put',
      originalContext: context,
    })

    await params[writePrecondition]?.()

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallPut')

    await lockRelationshipTargets(api, context.transaction, belongsToTargets)

    if (!context.isCreate && (manyToManyRelationships.length || reverseRelationships.length)) {
      await lockRelationshipParent({ context, helpers, scopeName })
    }

    await applyFieldSetters(context, api, helpers)
    const inverseVersions = await captureInverseVersions({ api, helpers, context, scopeName, isCreate: context.isCreate })
    await applyResourceVersion({ state: versionState, context, helpers, scopeName, isCreate: context.isCreate })

    const putContext = /** @type {CompletedWriteContext & { isCreate: boolean }} */ (context)

    await helpers.dataPut({
      scopeName,
      context: putContext
    })
    await invalidateInverseVersions({ state: inverseVersions, context, helpers, api })

    await runHooks('afterDataCallPut')
    await runHooks('afterDataCall')

    // Process many-to-many relationships after main record update/creation
    for (const { relName, relDef, relData } of manyToManyRelationships) {
      if (relDef?.through && api.anyapi?.links?.syncMany) {
        await api.anyapi.links.syncMany({
          context,
          scopeName,
          relName,
          relDef,
          relData,
          isUpdate: context.isUpdate,
        })
        continue
      }

      await validatePivotResource(scopes, relDef, relName)

      if (context.isUpdate) {
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
      } else if (relData.length > 0) {
        await createPivotRecords(api, context.id, relDef, relData, context.transaction)
      }
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
    await handleWriteMethodError(error, callerContext, 'PUT', scopeName, log)
  }
}
