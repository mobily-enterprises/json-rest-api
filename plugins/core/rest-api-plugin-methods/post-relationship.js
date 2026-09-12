// @ts-check
/** @import {
 * Identifier, RelationshipWriteArguments, WriteRelationshipContext
 * } from './lifecycle-types.js' */
import { lockRelationshipParent } from '../lib/writing/relationship-processor.js'
import { advanceResourceVersion } from '../lib/writing/resource-version.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { RestApiResourceError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import {
  commitOwnedTransaction,
  getVisibleRelationshipParent,
  handleWriteMethodError,
  validateRelationshipAccess,
  validateRelationshipRoutePayload
} from './common.js'
import { createPivotRecords } from '../lib/writing/many-to-many-manipulations.js'
import { updateReverseRelationship } from '../lib/writing/reverse-relationship-manipulations.js'
import { findRelationshipDefinition } from '../lib/querying-writing/relationship-contracts.js'
import {
  normalizeRelationshipIdentifiers,
  requireExistingResourceId
} from '../lib/querying-writing/resource-id-normalization.js'

/**
 * Add the identifiers in params.relationshipData to a to-many relationship.
 * Authorization and parent/version locking precede mutation. The method
 * returns no resource and completes only an owned transaction.
 * @param {RelationshipWriteArguments<Identifier[]>} args
 */
export default async function postRelationshipMethod ({ params, context: callerContext, vars, helpers, scope, scopes, runHooks, scopeOptions, scopeName, api, log }) {
  rejectRemovedOptions(params)
  if (params.format !== undefined) resolveFormat(params.format)
  callerContext.method = 'postRelationship'
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
    const relDef = findRelationshipDefinition(context.schemaInfo, context.relationshipName)
    if (!relDef) {
      throw new RestApiResourceError(
        `Relationship '${context.relationshipName}' not found on resource '${scopeName}'`,
        { subtype: 'relationship_not_found' }
      )
    }

    if (relDef.type !== 'hasMany' && relDef.type !== 'manyToMany') {
      throw new RestApiValidationError(
        `Cannot POST to to-one relationship '${context.relationshipName}'. Use PATCH instead.`,
        { fields: ['data'] }
      )
    }

    params.relationshipData = validateRelationshipRoutePayload({
      context,
      vars,
      scopeName,
      operation: 'postRelationship',
      relationshipData: params.relationshipData
    })
    params.relationshipData = /** @type {Identifier[]} */ (normalizeRelationshipIdentifiers(params.relationshipData, { api }))

    // Check permissions
    await runHooks('checkPermissions')
    await runHooks('checkPermissionsPostRelationship')

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
    await runHooks('beforeDataCallPostRelationship')

    const revision = await advanceResourceVersion({ scopeName, context, helpers, expectedVersion: params.expectedVersion })
    if (revision === undefined) await lockRelationshipParent({ context, helpers, scopeName })

    await validateRelationshipAccess(context, {
      data: { relationships: { [context.relationshipName]: { data: params.relationshipData } } }
    }, helpers, api)

    // Add relationships
    if (relDef?.through) {
      if (api.anyapi?.links?.attachMany) {
        await api.anyapi.links.attachMany({
          context,
          scopeName,
          relName: context.relationshipName,
          relDef,
          relData: params.relationshipData,
        })
      } else {
        await createPivotRecords(api, context.id, relDef, params.relationshipData, context.transaction)
      }
    } else if (relDef.type === 'hasMany') {
      await updateReverseRelationship({ api, helpers, context, scopeName, relDef, relData: params.relationshipData, operation: 'add' })
    }

    await runHooks('finish')
    await runHooks('finishPostRelationship')

    await commitOwnedTransaction(context)
  } catch (error) {
    await handleWriteMethodError(error, context, 'POST_RELATIONSHIP', scopeName, log)
  }
}
