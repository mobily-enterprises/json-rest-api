import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { validatePutPayload } from '../lib/querying-writing/payload-validators.js'
import { processRelationships } from '../lib/writing/relationship-processor.js'
import { updateManyToManyRelationship, createPivotRecords } from '../lib/writing/many-to-many-manipulations.js'
import { ERROR_SUBTYPES } from '../lib/querying-writing/knex-constants.js'
import {
  setupCommonRequest,
  validateCompleteReplacePayload,
  validateResourceAttributesBeforeWrite,
  validateRelationshipAccess,
  applyFieldSetters,
  validatePivotResource,
  handleRecordReturnAfterWrite,
  handleWriteMethodError
} from './common.js'

/**
 * PUT
 * Updates an existing top-level resource by completely replacing it.
 * This method supports updating both attributes and relationships (1:1 and n:n).
 * Existing persisted values cannot be silently dropped: if a stored attribute or belongsTo
 * relationship already has a value, PUT must include it explicitly. Relationship collections
 * still follow replacement semantics when a relationships object is provided.
 * This method does NOT support creating new related resources via an `included` array.
 */
export default async function putMethod ({
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
  context.method = 'put'

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
    context.id = context.inputRecord.data.id

    // Run early hooks for pre-processing (e.g., file handling)
    await runHooks('beforeProcessing')
    await runHooks('beforeProcessingPut')

    // Validate PUT payload shape.
    // PUT requires the full resource target including ID, but field-level replacement
    // completeness is enforced later once we know the current stored record.
    validatePutPayload(context.inputRecord, scopes)

    // Validate that user has read access to all related resources
    // This ensures users can only create relationships to resources they can access
    await validateRelationshipAccess(context, context.inputRecord, helpers, runHooks, api)

    // Extract foreign keys from JSON:API relationships and prepare many-to-many operations
    // Example: relationships.author -> author_id: '123' for storage
    // Example: relationships.tags -> array of pivot records to create later
    const { belongsToUpdates, manyToManyRelationships } = processRelationships(
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
          ERROR_SUBTYPES.NOT_FOUND
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

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallPut')

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

    // Pass the operation type to the helper
    await helpers.dataPut({
      scopeName,
      context
    })
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
    await handleWriteMethodError(error, context, 'PUT', scopeName, log, runHooks)
  }
}
