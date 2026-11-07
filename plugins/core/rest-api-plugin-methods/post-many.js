// Create many records: each row goes through validation, relationship access,
// ownership stamping, setters and permissions in memory; then one INSERT runs
// per chunk. Statement counts stay flat as the batch grows.
import { lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { requireDocumentResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { RestApiResourceError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { chunk } from '../lib/storage/many-row-data-helpers.js'
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
  rejectBulkOptions,
  resolveChunkSize,
  resolveManyRowReturning,
  selectManyInput,
  toDocument,
  unsupported
} from './many-row-common.js'
import { VISIBLE_READ_CHUNK } from './patch-many.js'

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
  const mergeFields = supplied => (merge ?? [...new Set(supplied.flatMap(fields => [...fields]))])
    .filter(field => stored(field) && !protectedFields.has(field))
  return { keys, action, mergeFields }
}

/**
 * The fields a row supplies: those the caller sent (with belongs-to links),
 * and those a setter added. Schema defaults are not supplied, even when a
 * setter rewrites them, so a merge never resets a stored value to a default.
 * @param {any} row
 * @param {Record<string, unknown>} beforeSetters
 * @param {Record<string, unknown>} afterSetters
 */
function suppliedFields (row, beforeSetters, afterSetters) {
  const fields = new Set(Object.keys(row.originalInputAttributes || {}))
  for (const field of Object.keys(afterSetters)) if (!Object.hasOwn(beforeSetters, field)) fields.add(field)
  return fields
}

/**
 * Upsert merge: lock the rows the conflict keys match, check that the caller
 * may patch each of them, insert the other rows with a plain INSERT (a clash on
 * any other unique index fails the batch), then update the matched rows by id
 * with the merge fields each row supplies.
 * Returns the identifier of every row, merged or inserted.
 * @param {any} args
 * @param {{ rows: any[], attributes: Record<string, unknown>[], supplied: Set<string>[], onConflict: { keys: string[], merge: string[] }, chunkSize: number, needIds: boolean }} batch
 */
async function mergeRows ({ context, helpers, scope, runHooks, scopeName }, { rows, attributes, supplied, onConflict, chunkSize, needIds }) {
  const existing = await helpers.dataIdsByKeys({ scopeName, context, rows: attributes, keys: onConflict.keys, chunkSize })
  const matched = attributes.flatMap((_row, index) => existing[index] === undefined ? [] : [index])
  const missing = attributes.flatMap((_row, index) => existing[index] === undefined ? [index] : [])

  const visible = new Map()
  for (const part of chunk(matched.map(index => existing[index]), VISIBLE_READ_CHUNK)) {
    const records = await helpers.dataGetMinimal({ scopeName, context, runHooks, ids: part, filters: {}, queryPurpose: 'bulk-write' })
    for (const record of records) visible.set(String(record.id), record)
  }
  for (const index of matched) {
    const id = String(existing[index])
    const minimalRecord = visible.get(id)
    try {
      if (!minimalRecord) {
        throw new RestApiResourceError(`The ${scopeName} record these conflict keys match cannot be changed by the caller`, { subtype: 'forbidden', resourceType: scopeName })
      }
      await scope.checkPermissions({ method: 'patch', originalContext: { ...rows[index], method: 'patch', id, minimalRecord, originalMinimalRecord: minimalRecord } })
    } catch (error) { throw atIndex(error, index) }
  }

  const ids = [...existing]
  if (missing.length) {
    const inserted = await helpers.dataInsertMany({ scopeName, context, rows: missing.map(index => attributes[index]), chunkSize, needIds })
    missing.forEach((index, position) => { ids[index] = inserted?.[position] })
  }
  if (matched.length) {
    const storageAdapter = helpers.getStorageAdapter(scopeName)
    // Only the merge fields a row supplies change; the lock version advances.
    const updates = matched.map(index => ({
      id: existing[index],
      row: storageAdapter.toStorageRow(Object.fromEntries(onConflict.merge
        .filter(field => supplied[index].has(field))
        .map(field => [field, attributes[index][field]])), { context: rows[index], operation: 'patch' })
    }))
    await helpers.dataUpdateByIds({ scopeName, context, updates, chunkSize })
  }
  return ids
}

/** @param {any} args */
export default async function postManyMethod ({
  params, context, vars, helpers, scope, scopes, runHooks, hasHooks, perRecordHooks, scopeOptions, scopeName, api, log
}) {
  context.method = 'postMany'
  try {
    rejectRemovedOptions(params)
    rejectBulkOptions(params)
    context.scopeName = scopeName
    context.schemaInfo = scopes[scopeName].vars.schemaInfo
    context.format = resolveFormat(params.format, vars.format)
    context.simplified = context.format === 'plain'
    context.returning = resolveManyRowReturning(params.returning)
    context.params = params
    const chunkSize = resolveChunkSize(params.chunkSize)
    const { inputKey, records } = selectManyInput(params)
    refuseUnsupportedResource({
      api, helpers, perRecordHooks, scopeName, schemaInfo: context.schemaInfo, operation: 'postMany', kind: 'post', storageHelper: 'dataInsertMany'
    })
    const conflict = resolveOnConflict(params.onConflict, { scopeName, schemaInfo: context.schemaInfo, scopes })
    if (conflict?.action === 'merge') {
      // Merged rows are updates: the resource must take patches as a batch too.
      refuseUnsupportedResource({
        api, helpers, perRecordHooks, scopeName, schemaInfo: context.schemaInfo, operation: 'postMany', kind: 'patch', storageHelper: 'dataUpdateByIds'
      })
    }

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

    if (conflict) {
      rows.forEach((row, index) => {
        if (row.inputRecord.data.id === undefined || row.inputRecord.data.id === null) return
        throw atIndex(new RestApiValidationError('An upsert row cannot carry an id: its conflict keys identify it', { fields: ['data.id'] }), index)
      })
      rows.forEach((row, index) => {
        const attributes = row.inputRecord.data.attributes || {}
        const empty = conflict.keys.filter(field => attributes[field] === undefined || attributes[field] === null)
        if (empty.length) throw atIndex(new RestApiValidationError(`Conflict keys need values: ${empty.join(', ')}`, { fields: empty.map(field => `data.attributes.${field}`) }), index)
      })
    }

    await runHooks('beforeDataCallPostMany')
    // Parents are locked once for the batch, in the transaction.
    await lockRelationshipTargets(api, context.transaction, parents)

    const attributes = []
    const supplied = []
    for (const [index, row] of rows.entries()) {
      const beforeSetters = { ...(row.inputRecord.data.attributes || {}) }
      try {
        await applyFieldSetters(row, api, helpers)
      } catch (error) { throw atIndex(error, index) }
      const data = row.inputRecord.data
      supplied.push(suppliedFields(row, beforeSetters, data.attributes || {}))
      attributes.push({ ...(data.attributes || {}), ...(data.id !== undefined ? { id: data.id } : {}) })
    }

    let onConflict
    if (conflict) {
      onConflict = { keys: conflict.keys, action: conflict.action, merge: conflict.action === 'merge' ? conflict.mergeFields(supplied) : [] }
      if (conflict.action === 'merge' && !onConflict.merge.length) {
        throw new RestApiValidationError('onConflict merge has no fields to update; use ignore', { fields: ['onConflict'] })
      }
      const seen = new Map()
      attributes.forEach((row, index) => {
        const key = JSON.stringify(onConflict.keys.map(field => row[field]))
        if (seen.has(key)) {
          throw atIndex(new RestApiValidationError(`Rows ${seen.get(key)} and ${index} have the same conflict keys`, {
            fields: onConflict.keys.map(field => `data.attributes.${field}`)
          }), index)
        }
        seen.set(key, index)
      })
    }

    // Without a conflict every row is inserted or the batch fails, so a count needs no ids.
    const countsRows = context.returning === 'count' && !onConflict
    const needIds = (context.returning !== 'none' && !countsRows) || hasHooks('afterDataCallPostMany')
    const ids = onConflict?.action === 'merge'
      ? await mergeRows({ context, helpers, scope, runHooks, scopeName }, { rows, attributes, supplied, onConflict, chunkSize, needIds })
      : await helpers.dataInsertMany({ scopeName, context, rows: attributes, chunkSize, needIds, onConflict })
    context.ids = ids?.map(id => id === undefined || id === null ? undefined : String(id))
    await runHooks('afterDataCallPostMany')

    const response = countsRows
      ? { meta: { count: rows.length } }
      : await manyRowResponse({
        api, scopeName, context, ids: context.ids || [], returning: context.returning, format: context.format, queryParams: params.queryParams
      })
    await commitOwnedTransaction(context)
    return response
  } catch (error) {
    await handleWriteMethodError(error, context, 'POST_MANY', scopeName, log)
  }
}
