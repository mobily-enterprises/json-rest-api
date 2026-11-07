// Create many records: each row goes through validation, relationship access,
// ownership stamping, setters and permissions in memory; then one INSERT runs
// per chunk. Statement counts stay flat as the batch grows.
import { lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { requireDocumentResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from '../lib/querying-writing/response-options.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { RestApiValidationError } from '../../../lib/rest-api-errors.js'
import {
  applyFieldSetters,
  collectRelationshipTargets,
  commitOwnedTransaction,
  handleWriteMethodError,
  validateRelationshipTargets,
  validateResourceAttributesBeforeWrite
} from './common.js'
import {
  atIndex,
  manyRowResponse,
  noHooks,
  refuseUnsupportedResource,
  resolveChunkSize,
  selectManyInput,
  toDocument,
  unsupported
} from './many-row-common.js'

/**
 * Upserts may only match the caller's own rows: the conflict keys must hold
 * every ownership field, and merge cannot run under a row policy it cannot see.
 */
function resolveOnConflict (onConflict, { scopeName, schemaInfo, scopes }) {
  if (onConflict === undefined) return undefined
  const fail = message => { throw new RestApiValidationError(message, { fields: ['onConflict'] }) }
  if (!onConflict || typeof onConflict !== 'object' || Array.isArray(onConflict)) fail('onConflict must be an object')
  const { keys, action, merge, ...unknown } = onConflict
  if (Object.keys(unknown).length) fail(`Unknown onConflict options: ${Object.keys(unknown).join(', ')}`)
  if (action !== 'ignore' && action !== 'merge') fail("onConflict.action must be 'ignore' or 'merge'")
  const fields = schemaInfo.schemaStructure
  const stored = field => typeof field === 'string' && Object.hasOwn(fields, field) && !fields[field].virtual && !fields[field].computed
  if (!Array.isArray(keys) || !keys.length || !keys.every(stored)) fail('onConflict.keys must list stored fields of the resource')

  const ownership = schemaInfo.ownershipFields || []
  const missingOwners = ownership.filter(field => !keys.includes(field))
  if (missingOwners.length) {
    throw unsupported(scopeName, 'postMany', `onConflict.keys must include the ownership field(s) ${missingOwners.join(', ')}, or a conflict could match another owner's row`)
  }
  if (action === 'merge' && scopes[scopeName]?.vars?.rowPolicy) {
    throw unsupported(scopeName, 'postMany', 'onConflict merge cannot see the row policy; insert with ignore, then patchMany the rows you may change')
  }
  const protectedFields = new Set(['id', ...keys, ...ownership, schemaInfo.lockVersionField].filter(Boolean))
  if (action === 'merge' && merge !== undefined) {
    if (!Array.isArray(merge) || !merge.length || !merge.every(stored)) fail('onConflict.merge must list stored fields of the resource')
    const forbidden = merge.filter(field => protectedFields.has(field))
    if (forbidden.length) fail(`onConflict.merge cannot change ${forbidden.join(', ')}`)
  } else if (merge !== undefined) {
    fail('onConflict.merge applies only to the merge action')
  }
  // Without a list, merge updates every stored field the rows supply.
  const mergeFields = rows => merge ?? [...new Set(rows.flatMap(row => Object.keys(row)))]
    .filter(field => stored(field) && !protectedFields.has(field))
  return { keys, action, mergeFields }
}

/** @param {any} args */
export default async function postManyMethod ({
  params, context, vars, helpers, scope, scopes, runHooks, hasHooks, perRecordHooks, scopeOptions, scopeName, api, log
}) {
  context.method = 'postMany'
  try {
    rejectRemovedOptions(params)
    context.scopeName = scopeName
    context.schemaInfo = scopes[scopeName].vars.schemaInfo
    context.format = resolveFormat(params.format, vars.format)
    context.simplified = context.format === 'plain'
    context.returning = resolveReturning(params.returning, 'none')
    context.params = params
    const chunkSize = resolveChunkSize(params.chunkSize)
    const { inputKey, records } = selectManyInput(params)
    refuseUnsupportedResource({
      api, helpers, perRecordHooks, scopeName, schemaInfo: context.schemaInfo, operation: 'postMany', kind: 'post', storageHelper: 'dataInsertMany'
    })
    const conflict = resolveOnConflict(params.onConflict, { scopeName, schemaInfo: context.schemaInfo, scopes })

    await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
    context.db = context.transaction

    const schemaInfo = context.schemaInfo
    context.inputRecords = records.map((record, index) => {
      try {
        return toDocument({ record, inputKey, scopeName, schemaInfo }).document
      } catch (error) { throw atIndex(error, index) }
    })
    // Batch hooks: ownership stamping and the refusals of plugins that cannot batch.
    await runHooks('beforeProcessingPostMany')

    const contracts = getRequestContracts({ scopeName, schemaInfo, includeDepthLimit: vars.includeDepthLimit, sortableFields: vars.sortableFields })
    const targets = new Map()
    context.inputRecords = context.inputRecords.map((document, index) => {
      try {
        const validated = validateRequestContractOrThrow(contracts.post, document, 'POST request body is invalid')
        if (validated.data.id !== undefined) validated.data.id = requireDocumentResourceId(validated.data.id, { scopeOptions, vars })
        collectRelationshipTargets(validated, api, targets)
        return validated
      } catch (error) { throw atIndex(error, index) }
    })
    // One scoped read per related type for the whole batch.
    await validateRelationshipTargets(context, [...targets.values()], helpers, api)

    const parents = []
    const rows = []
    for (const [index, document] of context.inputRecords.entries()) {
      const rowContext = { ...context, method: 'post', inputRecord: document, originalInputAttributes: undefined, bulkIndex: index }
      try {
        const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = processRelationships(scope, { context: rowContext })
        if (manyToManyRelationships.length || reverseRelationships.length) {
          throw unsupported(scopeName, 'postMany', 'rows set many-to-many or reverse relationships; create those links with single writes')
        }
        if (Object.keys(belongsToUpdates).length) {
          document.data.attributes = { ...document.data.attributes, ...belongsToUpdates }
        }
        await validateResourceAttributesBeforeWrite({ context: rowContext, schema: schemaInfo.schemaInstance, belongsToUpdates, runHooks: noHooks })
        rowContext.minimalRecord = {
          type: scopeName,
          ...(document.data.id !== undefined && document.data.id !== null ? { id: String(document.data.id) } : {}),
          attributes: structuredClone(document.data.attributes || {}),
          relationships: structuredClone(document.data.relationships || {})
        }
        await scope.checkPermissions({ method: 'post', originalContext: rowContext })
        parents.push(...belongsToTargets)
        rows.push(rowContext)
      } catch (error) { throw atIndex(error, index) }
    }

    let onConflict
    if (conflict) {
      const rowAttributes = rows.map(row => row.inputRecord.data.attributes || {})
      rowAttributes.forEach((attributes, index) => {
        const empty = conflict.keys.filter(field => attributes[field] === undefined || attributes[field] === null)
        if (empty.length) throw atIndex(new RestApiValidationError(`Conflict keys need values: ${empty.join(', ')}`, { fields: empty.map(field => `data.attributes.${field}`) }), index)
      })
      onConflict = { keys: conflict.keys, action: conflict.action, merge: conflict.action === 'merge' ? conflict.mergeFields(rowAttributes) : [] }
      if (conflict.action === 'merge' && !onConflict.merge.length) {
        throw new RestApiValidationError('onConflict merge has no fields to update; use ignore', { fields: ['onConflict'] })
      }
    }

    await runHooks('beforeDataCallPostMany')
    // Parents are locked once for the batch, in the transaction.
    await lockRelationshipTargets(api, context.transaction, parents)

    const attributes = []
    for (const [index, row] of rows.entries()) {
      try {
        await applyFieldSetters(row, api, helpers)
      } catch (error) { throw atIndex(error, index) }
      const data = row.inputRecord.data
      attributes.push({ ...(data.attributes || {}), ...(data.id !== undefined ? { id: data.id } : {}) })
    }

    const needIds = context.returning !== 'none' || hasHooks('afterDataCallPostMany')
    const ids = await helpers.dataInsertMany({ scopeName, context, rows: attributes, chunkSize, needIds, onConflict })
    context.ids = ids?.map(id => id === undefined || id === null ? undefined : String(id))
    await runHooks('afterDataCallPostMany')

    const response = await manyRowResponse({
      api, scopeName, context, ids: context.ids || [], returning: context.returning, format: context.format, queryParams: params.queryParams
    })
    await commitOwnedTransaction(context)
    return response
  } catch (error) {
    await handleWriteMethodError(error, context, 'POST_MANY', scopeName, log)
  }
}
