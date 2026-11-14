// Create many records: each row goes through validation, relationship access,
// ownership stamping, setters and permissions in memory; then one INSERT runs
// per chunk. Statement counts stay flat as the batch grows.
import { processRelationships } from '../lib/writing/relationship-processor.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { requireDocumentResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { beginWriteTransaction, handledQueryError } from '../../../lib/error-context.js'
import { RestApiResourceError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { chunk, isDuplicateKeyError } from '../lib/storage/many-row-data-helpers.js'
import { databaseFamily } from '../lib/querying-writing/database-capabilities.js'
import {
  applyFieldSetters,
  collectRelationshipTargets,
  commitOwnedTransaction,
  handleWriteMethodError,
  keepHiddenLinks,
  validateRelationshipTargets,
  validateResourceAttributesBeforeWrite
} from './common.js'
import {
  atIndex,
  manyRowResponse,
  assertManyRowBlobReads,
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
 * The id (by its own name or the idProperty's) may be the only key on a
 * resource with neither, where no other owner's row can match.
 */
function resolveOnConflict (onConflict, { scopeName, schemaInfo, scopes }) {
  if (onConflict === undefined) return undefined
  const fail = message => { throw new RestApiValidationError(message, { fields: ['onConflict'] }) }
  if (!onConflict || typeof onConflict !== 'object' || Array.isArray(onConflict)) fail('onConflict must be an object')
  const { keys: requestedKeys, action, merge, ...unknown } = onConflict
  let keys = requestedKeys
  if (Object.keys(unknown).length) fail(`Unknown onConflict options: ${Object.keys(unknown).join(', ')}`)
  if (action !== 'ignore' && action !== 'merge') fail("onConflict.action must be 'ignore' or 'merge'")
  const fields = schemaInfo.schemaStructure
  const stored = field => typeof field === 'string' && Object.hasOwn(fields, field) && !fields[field].virtual && !fields[field].computed
  const ownership = schemaInfo.ownershipFields || []
  const rowPolicy = scopes[scopeName]?.vars?.rowPolicy
  const idKey = Array.isArray(keys) && keys.some(field => field === 'id' || field === schemaInfo.idProperty)
  if (idKey) {
    if (keys.length !== 1) fail('onConflict on the id takes the id as its only key')
    if (ownership.length || rowPolicy) {
      throw unsupported(scopeName, 'postMany', 'onConflict on the id needs a resource without ownership fields or a row policy, or a conflict could match a row the caller cannot see; use keys that include the ownership field(s)')
    }
    keys = ['id']
  } else if (!Array.isArray(keys) || !keys.length || !keys.every(stored)) fail('onConflict.keys must list stored fields of the resource')

  const missingOwners = ownership.filter(field => !keys.includes(field))
  if (missingOwners.length) {
    throw unsupported(scopeName, 'postMany', `onConflict.keys must include the ownership field(s) ${missingOwners.join(', ')}, or a conflict could match another owner's row`)
  }
  if (action === 'merge' && rowPolicy) {
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
 * The stored record each row's conflict keys match, locked, for a merge.
 * On MySQL and MariaDB a locking read of a key no row holds would lock the gap
 * where it would go, and two transactions that each did so for a new key in
 * one gap would deadlock on each other's gap lock when they insert it. There
 * the keys are first read plainly, which locks nothing, and only the rows that
 * read finds are locked by their keys, which as stored keys lock those rows
 * alone. A row the plain read misses because it was committed since the
 * transaction's snapshot fails the merge's INSERT as a duplicate key, and is
 * merged after all (see mergeRows).
 * @param {any} helpers
 * @param {{ scopeName: string, context: any, attributes: Record<string, unknown>[], keys: string[], chunkSize: number }} request
 * @returns {Promise<Array<string | number | undefined>>}
 */
async function lockedMatches (helpers, { scopeName, context, attributes, keys, chunkSize }) {
  if (databaseFamily(context.transaction) !== 'mysql') return helpers.dataIdsByKeys({ scopeName, context, rows: attributes, keys, chunkSize })
  const seen = await helpers.dataIdsByKeys({ scopeName, context, rows: attributes, keys, chunkSize, lock: false })
  const stored = attributes.flatMap((_row, index) => seen[index] === undefined ? [] : [index])
  const locked = stored.length ? await helpers.dataIdsByKeys({ scopeName, context, rows: stored.map(index => attributes[index]), keys, chunkSize }) : []
  const existing = new Array(attributes.length)
  stored.forEach((index, position) => { existing[index] = locked[position] })
  return existing
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
async function mergeRows ({ context, helpers, scope, scopes, runHooks, scopeName }, { rows, attributes, supplied, onConflict, chunkSize, needIds }) {
  const existing = await lockedMatches(helpers, { scopeName, context, attributes, keys: onConflict.keys, chunkSize })
  const matched = attributes.flatMap((_row, index) => existing[index] === undefined ? [] : [index])
  const missing = attributes.flatMap((_row, index) => existing[index] === undefined ? [index] : [])

  const visible = new Map()
  /** @param {number[]} indexes */
  const checkMatched = async indexes => {
    // dataIdsByKeys locked these rows, and may have found one that another
    // transaction committed after this one's snapshot: read them as locked.
    for (const part of chunk(indexes.map(index => existing[index]), VISIBLE_READ_CHUNK)) {
      const records = await helpers.dataGetMinimal({ scopeName, context, runHooks, ids: part, filters: {}, queryPurpose: 'bulk-write', locked: true })
      for (const record of records) visible.set(String(record.id), record)
    }
    for (const index of indexes) {
      const id = String(existing[index])
      const minimalRecord = visible.get(id)
      try {
        if (!minimalRecord) {
          throw new RestApiResourceError(`The ${scopeName} record these conflict keys match cannot be changed by the caller`, { subtype: 'forbidden', resourceType: scopeName })
        }
        await scope.checkPermissions({ method: 'patch', originalContext: { ...rows[index], method: 'patch', id, minimalRecord, originalMinimalRecord: minimalRecord } })
      } catch (error) { throw atIndex(error, index) }
    }
  }
  await checkMatched(matched)

  const ids = [...existing]
  if (missing.length) {
    // On PostgreSQL the key lookup does not see a row another transaction has
    // inserted but not committed, and a plain INSERT would wait for it, then
    // fail as a duplicate. The INSERT skips a clash on the keys instead (a clash
    // on any other unique index still fails), and the rows it skipped, by then
    // committed, are locked, checked and merged like the others.
    // On MySQL and MariaDB the keys were looked up plainly (see lockedMatches):
    // a row committed since the snapshot, or committed while the INSERT waits
    // for it, fails the INSERT's statement as a duplicate key, which undoes
    // that statement only. Its rows, and those of the statements after it, are
    // then locked by their keys: those found are merged like the others, and
    // the rest inserted with a plain INSERT.
    const family = databaseFamily(context.transaction)
    const skipsClashes = family === 'pg'
    const insertRows = missing.map(index => attributes[index])
    let late = []
    if (skipsClashes) {
      const inserted = await helpers.dataInsertMany({ scopeName, context, rows: insertRows, chunkSize, needIds: true, onConflict: { keys: onConflict.keys, action: 'ignore' } })
      missing.forEach((index, position) => { ids[index] = inserted?.[position] })
      late = missing.filter(index => ids[index] === undefined)
    } else {
      const written = new Map()
      try {
        await helpers.dataInsertMany({ scopeName, context, rows: insertRows, chunkSize, needIds, written })
      } catch (error) {
        if (family !== 'mysql' || !isDuplicateKeyError(error)) throw error
        handledQueryError(context.transaction, error)
      }
      missing.forEach((index, position) => { if (written.has(position)) ids[index] = written.get(position) })
      late = missing.filter((_index, position) => !written.has(position))
    }
    if (late.length) {
      const found = await helpers.dataIdsByKeys({ scopeName, context, rows: late.map(index => attributes[index]), keys: onConflict.keys, chunkSize })
      const absent = late.filter((_index, position) => found[position] === undefined)
      if (skipsClashes && absent.length) {
        // Committed, then deleted before the lock: neither inserted nor merged.
        throw atIndex(new RestApiResourceError(`The ${scopeName} record these conflict keys match changed during the upsert; retry it`, { subtype: 'conflict', resourceType: scopeName }), absent[0])
      }
      if (absent.length) {
        // No stored row holds their keys: they clashed on another unique index, which fails the batch here, or the row
        // they met is gone again.
        const inserted = await helpers.dataInsertMany({ scopeName, context, rows: absent.map(index => attributes[index]), chunkSize, needIds })
        absent.forEach((index, position) => { ids[index] = inserted?.[position] })
      }
      const merged = late.filter((_index, position) => found[position] !== undefined)
      late.forEach((index, position) => {
        if (found[position] === undefined) return
        existing[index] = found[position]
        ids[index] = found[position]
      })
      await checkMatched(merged)
      matched.push(...merged)
    }
  }
  if (matched.length) {
    const storageAdapter = helpers.getStorageAdapter(scopeName)
    // Only the merge fields a row supplies change; the lock version advances.
    const merges = matched.map(index => Object.fromEntries(onConflict.merge
      .filter(field => supplied[index].has(field))
      .map(field => [field, attributes[index][field]])))
    // A merge clears a link the way a patch does, so it keeps one to a hidden target.
    await keepHiddenLinks({
      context,
      scopes,
      schemaInfo: context.schemaInfo,
      rows: matched.map((index, position) => ({ updates: merges[position], stored: visible.get(String(existing[index])) })),
      locked: true
    })
    const updates = matched.map((index, position) => ({
      id: existing[index],
      row: storageAdapter.toStorageRow(merges[position], { context: rows[index], operation: 'patch' })
    }))
    await helpers.dataUpdateByIds({ scopeName, context, updates, chunkSize })
  }
  return ids
}

/** @param {any} args */
export default async function postManyMethod ({
  params, context, vars, helpers, scope, scopes, runHooks, hasHooks, hookNames, perRecordHooks, scopeOptions, scopeName, api, log
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
    assertManyRowBlobReads({ api, scopeName, context, returning: context.returning, queryParams: params.queryParams, rows: records.length })
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
    // One scoped read per related type for the whole batch, which also locks the targets.
    await validateRelationshipTargets(context, [...targets.values()], helpers, api, { hasHooks, hookNames, lock: {} })

    const rows = []
    for (const [index, document] of context.inputRecords.entries()) {
      const rowContext = { ...context, method: 'post', inputRecord: document, originalInputAttributes: undefined, bulkIndex: index }
      try {
        const { belongsToUpdates, manyToManyRelationships, reverseRelationships } = processRelationships(scope, { context: rowContext })
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
        rows.push(rowContext)
      } catch (error) { throw atIndex(error, index) }
    }

    if (conflict) {
      const byId = conflict.keys[0] === 'id'
      rows.forEach((row, index) => {
        const id = row.inputRecord.data.id
        if (byId && (id === undefined || id === null)) throw atIndex(new RestApiValidationError('An upsert on the id needs an id in every row', { fields: ['data.id'] }), index)
        // An ignore inserts a row with the id it carries, or skips it when its keys match a stored row, which keeps
        // its own id; an id another row has, under other keys, still fails as a duplicate. A merge's keys name the
        // row it updates, so an id there would be a second, conflicting identity.
        if (byId || id === undefined || id === null || conflict.action === 'ignore') return
        throw atIndex(new RestApiValidationError('An onConflict merge row cannot carry an id: its conflict keys identify the row it updates', { fields: ['data.id'] }), index)
      })
      if (!byId) {
        rows.forEach((row, index) => {
          const attributes = row.inputRecord.data.attributes || {}
          const empty = conflict.keys.filter(field => attributes[field] === undefined || attributes[field] === null)
          if (empty.length) throw atIndex(new RestApiValidationError(`Conflict keys need values: ${empty.join(', ')}`, { fields: empty.map(field => `data.attributes.${field}`) }), index)
        })
      }
    }

    await runHooks('beforeDataCallPostMany')

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
      ? await mergeRows({ context, helpers, scope, scopes, runHooks, scopeName }, { rows, attributes, supplied, onConflict, chunkSize, needIds })
      : await helpers.dataInsertMany({ scopeName, context, rows: attributes, chunkSize, needIds, onConflict })
    context.ids = ids?.map(id => id === undefined || id === null ? undefined : String(id))
    await runHooks('afterDataCallPostMany')

    const response = countsRows
      ? { meta: { count: rows.length } }
      : await manyRowResponse({
        api,
        scopeName,
        context,
        ids: context.ids || [],
        returning: context.returning,
        format: context.format,
        queryParams: params.queryParams,
        // A merge may match a row committed after this transaction's snapshot and leave it unchanged.
        locked: onConflict?.action === 'merge'
      })
    await commitOwnedTransaction(context)
    return response
  } catch (error) {
    await handleWriteMethodError(error, context, 'POST_MANY', scopeName, log)
  }
}
