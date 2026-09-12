// @ts-check
/** @import {
 * Identifier, LifecycleResource, RelationshipWriteArguments, WriteRelationshipContext
 * } from './lifecycle-types.js' */
import { lockRelationshipParent } from '../lib/writing/relationship-processor.js'
import { advanceResourceVersion } from '../lib/writing/resource-version.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { findRelationshipDefinition } from '../lib/querying-writing/relationship-contracts.js'
import { RestApiResourceError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import {
  commitOwnedTransaction,
  getVisibleRelationshipParent,
  handleWriteMethodError,
  validateRelationshipRoutePayload
} from './common.js'
import {
  normalizeRelationshipIdentifiers,
  requireExistingResourceId
} from '../lib/querying-writing/resource-id-normalization.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { invalidateRemovedPivotVersions } from '../lib/writing/many-to-many-manipulations.js'
import { getStorageColumn } from '../lib/storage/storage-mapping.js'
import { RELATIONSHIP_WRITE_BATCH_SIZE } from '../lib/querying-writing/knex-constants.js'

/**
 * Remove the identifiers in params.relationshipData from a to-many relationship.
 * Authorization and parent/version locking precede mutation. The method
 * returns no resource and completes only an owned transaction.
 * @param {RelationshipWriteArguments<Identifier[]>} args
 */
export default async function deleteRelationshipMethod ({ params, context: callerContext, vars, helpers, scope, scopes, runHooks, scopeOptions, scopeName, api, log }) {
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  callerContext.method = 'deleteRelationship'
  callerContext.scopeName = scopeName
  callerContext.id = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  callerContext.relationshipName = params.relationshipName
  callerContext.schemaInfo = scope.vars.schemaInfo

  await beginWriteTransaction(callerContext, params.transaction, helpers.newTransaction, runHooks)
  callerContext.db = callerContext.transaction || api.knex.instance
  const context = /** @type {WriteRelationshipContext} */ (callerContext)

  try {
    // Validate
    const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName)
    if (!relDef) {
      throw new RestApiResourceError(
        `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
        { subtype: 'relationship_not_found' }
      )
    }

    if (relDef.type !== 'hasMany' && relDef.type !== 'manyToMany') {
      throw new RestApiValidationError(
        `Cannot DELETE from to-one relationship '${context.relationshipName}'`,
        { fields: ['data'] }
      )
    }

    params.relationshipData = validateRelationshipRoutePayload({
      context,
      vars,
      scopeName,
      operation: 'deleteRelationship',
      relationshipData: params.relationshipData
    })
    params.relationshipData = /** @type {Identifier[]} */ (normalizeRelationshipIdentifiers(params.relationshipData, { api }))

    // Check permissions
    await runHooks('checkPermissions')
    await runHooks('checkPermissionsDeleteRelationship')

    // Verify the parent exists in the caller's visible dataset.
    const parentRecord = await getVisibleRelationshipParent({
      context,
      helpers,
      scopeName,
      runHooks
    })

    if (!parentRecord) {
      throw new RestApiResourceError('Resource not found', { subtype: 'not_found' })
    }
    context.minimalRecord = parentRecord
    context.originalMinimalRecord = parentRecord

    await runHooks('beforeDataCall')
    await runHooks('beforeDataCallDeleteRelationship')

    const revision = await advanceResourceVersion({ scopeName, context, helpers, expectedVersion: params.expectedVersion })
    if (revision === undefined) await lockRelationshipParent({ context, helpers, scopeName })

    // Remove relationships
    if (relDef?.through) {
      if (api.anyapi?.links?.removeMany) {
        await api.anyapi.links.removeMany({
          context,
          scopeName,
          relName: context.relationshipName,
          relDef,
          relData: params.relationshipData,
        })
      } else {
        const knex = api.knex?.instance || helpers.db
        const pivotResource = relDef.through
        const pivotScope = /** @type {LifecycleResource} */ (api.resources[pivotResource])
        const pivotTable = pivotScope?.vars?.schemaInfo?.tableName || pivotResource
        const localKey = getStorageColumn(pivotScope.vars.schemaInfo, /** @type {string} */ (relDef.foreignKey))
        const foreignKey = getStorageColumn(pivotScope.vars.schemaInfo, /** @type {string} */ (relDef.otherKey))

        const ids = [...new Set(params.relationshipData.map(identifier => identifier.id))]
        for (let offset = 0; offset < ids.length; offset += RELATIONSHIP_WRITE_BATCH_SIZE) {
          const removals = knex(pivotTable)
            .where(localKey, context.id)
            .whereIn(foreignKey, ids.slice(offset, offset + RELATIONSHIP_WRITE_BATCH_SIZE))
            .transacting(context.transaction)
          await invalidateRemovedPivotVersions(api, relDef, removals, context.transaction)
          await removals.delete()
        }
      }
    } else {
      await updateReverseRelationship({ api, helpers, context, scopeName, relDef, relData: params.relationshipData, operation: 'remove' })
    }

    await runHooks('finish')
    await runHooks('finishDeleteRelationship')

    await commitOwnedTransaction(context)
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE_RELATIONSHIP', scopeName, log)
  }
}
