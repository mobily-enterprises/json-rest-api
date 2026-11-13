// Delete many records by id: one scoped read of the ids the caller may delete
// per chunk (or, with missing: 'skip', the scope inside the DELETE), then one
// DELETE per chunk and the pivot rows of the deleted records. deleteWhere
// deletes the rows its selection finds and answers with those it deleted.
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { RestApiRecordsNotFoundError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { chunk } from '../lib/storage/many-row-data-helpers.js'
import { databaseFamily } from '../lib/querying-writing/database-capabilities.js'
import { commitOwnedTransaction, handleWriteMethodError } from './common.js'
import {
  keepVisible,
  refuseDuplicateIds,
  refuseUnsupportedResource,
  rejectBulkOptions,
  requireWhereScope,
  resolveChunkSize,
  resolveManyRowReturning,
  resolveMissing,
  unsupported,
  validateFilters
} from './many-row-common.js'
import { VISIBLE_READ_CHUNK, visibleIdsByFilters } from './patch-many.js'

function setup ({ params, context, scopes, scopeName }, method) {
  context.method = method
  rejectRemovedOptions(params)
  rejectBulkOptions(params)
  context.scopeName = scopeName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  // Deletes return no records; a format is still checked like a single delete's.
  if (params.format !== undefined) resolveFormat(params.format)
  context.returning = resolveManyRowReturning(params.returning, { deletes: true })
  context.params = params
}

/**
 * @param {any} args
 * @param {{ operation: string, ids: unknown[], started?: boolean, selection?: { filters?: Record<string, unknown> } }} batch
 */
async function runDeleteMany (args, { operation, ids, started = false, selection }) {
  const { params, context, helpers, scope, runHooks, hasHooks, perRecordHooks, scopeName, api } = args
  const storageAdapter = helpers.getStorageAdapter(scopeName)
  const chunkSize = resolveChunkSize(params.chunkSize)
  const missing = selection ? 'skip' : resolveMissing(params.missing)
  refuseUnsupportedResource({ api, helpers, perRecordHooks, scopeName, schemaInfo: context.schemaInfo, operation, kind: 'delete', storageHelper: 'dataDeleteByIds' })
  refuseDuplicateIds(ids, storageAdapter, 'ids')

  if (!started) await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
  context.db = context.transaction

  // With missing: 'skip' and no hook that needs the rows first, the DELETE
  // decides which rows the caller may delete, carrying the scope (see patchMany,
  // also for MySQL and selections).
  const readFirst = !(missing === 'skip' && !hasHooks('checkPermissions') && !hasHooks('beforeDataCallDeleteMany') &&
    (selection || databaseFamily(context.db) !== 'mysql'))
  const scoped = Boolean(selection) || !readFirst
  let kept = ids
  if (readFirst) {
    const visible = new Map()
    for (const part of chunk(ids, VISIBLE_READ_CHUNK)) {
      const records = await helpers.dataGetMinimal({ scopeName, context, runHooks, ids: part, filters: {}, queryPurpose: 'bulk-write' })
      for (const record of records) visible.set(String(storageAdapter.translateFilterValue('id', record.id)), record)
    }
    kept = keepVisible({ requested: ids, visible, missing, scopeName, storageAdapter })
    // bulkIndex is the id's position in the request.
    const positions = new Map(ids.map((id, index) => [String(storageAdapter.translateFilterValue('id', id)), index]))
    for (const id of kept) {
      const key = String(storageAdapter.translateFilterValue('id', id))
      const minimalRecord = visible.get(key)
      const bulkIndex = positions.get(key)
      await scope.checkPermissions({ method: 'delete', originalContext: { ...context, method: 'delete', id, minimalRecord, originalMinimalRecord: minimalRecord, bulkIndex } })
    }
  }

  context.ids = kept.map(String)
  await runHooks('beforeDataCallDeleteMany')
  const deleted = new Set((kept.length
    ? await helpers.dataDeleteByIds({ scopeName, context, runHooks, ids: kept, chunkSize, scoped, filters: selection?.filters })
    : []).map(String))
  // A row that left the caller's scope after the visibility read is not deleted.
  if (deleted.size < kept.length && missing === 'throw') throw new RestApiRecordsNotFoundError({ resourceType: scopeName, missing: kept.length - deleted.size })
  context.ids = kept.map(id => String(storageAdapter.translateFilterValue('id', id))).filter(id => deleted.has(id))
  await runHooks('afterDataCallDeleteMany')

  await commitOwnedTransaction(context)
  return deleteResponse(context, scopeName, context.ids)
}

/** @param {any} context @param {string} scopeName @param {string[]} ids */
function deleteResponse (context, scopeName, ids) {
  if (context.returning === 'count') return { meta: { count: ids.length } }
  return context.returning === 'none' ? undefined : { data: ids.map(id => ({ type: scopeName, id })) }
}

/** @param {any} args */
export async function deleteManyMethod (args) {
  const { params, context, scopeName, scopeOptions, vars, log } = args
  try {
    setup(args, 'deleteMany')
    if (!Array.isArray(params.ids) || !params.ids.length) {
      throw new RestApiValidationError('ids must be a non-empty array', { fields: ['ids'] })
    }
    const ids = params.ids.map(id => requireExistingResourceId(id, { scopeOptions, vars, scopeName }))
    return await runDeleteMany(args, { operation: 'deleteMany', ids })
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE_MANY', scopeName, log)
  }
}

/** @param {any} args */
export async function deleteWhereMethod (args) {
  const { params, context, scopeName, vars, helpers, log } = args
  try {
    setup(args, 'deleteWhere')
    if (typeof helpers.dataVisibleIds !== 'function') {
      throw unsupported(scopeName, 'deleteWhere', 'its storage plugin has no many-row support')
    }
    const filters = validateFilters({ filters: params.filters, scopeName, schemaInfo: context.schemaInfo, vars })
    requireWhereScope({ filters, all: params.all, missing: params.missing, operation: 'deleteWhere' })
    await beginWriteTransaction(context, params.transaction, helpers.newTransaction, args.runHooks)
    context.db = context.transaction
    const ids = await visibleIdsByFilters(args, filters, 'update')
    if (!ids.length) {
      await commitOwnedTransaction(context)
      return deleteResponse(context, scopeName, [])
    }
    return await runDeleteMany(args, { operation: 'deleteWhere', ids, started: true, selection: { filters } })
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE_WHERE', scopeName, log)
  }
}
