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
 */
export default async function putMethod ({
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
  context.method = 'put'

  try {
    const { schema, schemaStructure, schemaRelationships, versionState } = await setupCommonRequest({
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
    await runHooks('beforeProcessingPut')

    validateUpdateRequest({ method: 'put', params, context, vars, scopeOptions, scopeName })

    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, api)

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later
    const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = processRelationships(
      scope,
      { context }
    )

    // Check existence first
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

    // For PUT, we also need to handle relationships that are NOT provided
    // (they should be set to null/empty when a relationships object is provided)
    const allRelationships = {}

    // Collect all defined relationships for this resource
    for (const [relName, relDef] of Object.entries(schemaRelationships || {})) {
      if (relDef.type === 'manyToMany') {
        allRelationships[relName] = {
          type: 'manyToMany',
          relDef: {
            through: relDef.through,
            foreignKey: relDef.foreignKey,
            otherKey: relDef.otherKey
          }
        }
      }
    }

    // Also check schema fields for belongsTo relationships
    for (const [fieldName, fieldDef] of Object.entries(schemaStructure)) {
      if (fieldDef.as && fieldDef.belongsTo) {
        allRelationships[fieldDef.as] = {
          type: 'belongsTo',
          fieldName,
          fieldDef
        }
      }
    }

    // Process missing relationships (PUT should null them out only if relationships object exists)
    const hasRelationshipsObject = context.inputRecord.data.relationships !== undefined
    const providedRelationships = new Set(Object.keys(context.inputRecord.data.relationships || {}))

    // Only null out missing relationships if a relationships object was provided
    if (hasRelationshipsObject) {
      for (const [relName, relDef] of Object.entries(schemaRelationships || {})) {
        if (!providedRelationships.has(relName) && (relDef.type === 'hasOne' || relDef.type === 'hasMany')) {
          reverseRelationships.push({ relName, relDef, relData: relDef.type === 'hasOne' ? null : [] })
        }
      }
      for (const [relName, relInfo] of Object.entries(allRelationships)) {
        if (!providedRelationships.has(relName)) {
          if (relInfo.type === 'belongsTo') {
            belongsToUpdates[relInfo.fieldName] = null
          } else if (relInfo.type === 'manyToMany') {
            // Add to manyToManyRelationships with empty array
            manyToManyRelationships.push({
              relName,
              relDef: relInfo.relDef,
              relData: []  // Empty array means delete all
            })
          }
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

    // Centralised checkPermissions function
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

    // Pass the operation type to the helper
    await helpers.dataPut({
      scopeName,
      context
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
    await handleWriteMethodError(error, context, 'PUT', scopeName, log)
  }
}
