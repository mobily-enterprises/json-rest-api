// Delete many records by id: one scoped read of the ids the caller may delete
// per chunk, then one DELETE per chunk and the pivot rows of the deleted records.
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { rejectRemovedOptions, resolveFormat, resolveReturning } from '../lib/querying-writing/response-options.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { chunk } from '../lib/storage/many-row-data-helpers.js'
import { commitOwnedTransaction, handleWriteMethodError } from './common.js'
import {
  keepVisible,
  refuseDuplicateIds,
  refuseUnsupportedResource,
  rejectBulkOptions,
  resolveChunkSize,
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
  context.returning = resolveReturning(params.returning, 'none')
  if (context.returning === 'full') {
    throw new RestApiValidationError("A delete returns 'none' or 'minimal'", { fields: ['returning'] })
  }
  context.params = params
}

async function runDeleteMany (args, { operation, ids, started = false }) {
  const { params, context, helpers, scope, runHooks, perRecordHooks, scopeName, api } = args
  const storageAdapter = helpers.getStorageAdapter(scopeName)
  const chunkSize = resolveChunkSize(params.chunkSize)
  const missing = resolveMissing(params.missing)
  refuseUnsupportedResource({ api, helpers, perRecordHooks, scopeName, schemaInfo: context.schemaInfo, operation, kind: 'delete', storageHelper: 'dataDeleteByIds' })
  refuseDuplicateIds(ids, storageAdapter, 'ids')

  if (!started) await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
  context.db = context.transaction

  const visible = new Map()
  for (const part of chunk(ids, VISIBLE_READ_CHUNK)) {
    const records = await helpers.dataGetMinimal({ scopeName, context, runHooks, ids: part, filters: {}, queryPurpose: 'bulk-write' })
    for (const record of records) visible.set(String(storageAdapter.translateFilterValue('id', record.id)), record)
  }
  const kept = keepVisible({ requested: ids, visible, missing, scopeName, storageAdapter })
  // bulkIndex is the id's position in the request.
  const positions = new Map(ids.map((id, index) => [String(storageAdapter.translateFilterValue('id', id)), index]))
  for (const id of kept) {
    const key = String(storageAdapter.translateFilterValue('id', id))
    const minimalRecord = visible.get(key)
    const bulkIndex = positions.get(key)
    await scope.checkPermissions({ method: 'delete', originalContext: { ...context, method: 'delete', id, minimalRecord, originalMinimalRecord: minimalRecord, bulkIndex } })
  }

  context.ids = kept.map(String)
  await runHooks('beforeDataCallDeleteMany')
  if (kept.length) await helpers.dataDeleteByIds({ scopeName, context, ids: kept, chunkSize })
  await runHooks('afterDataCallDeleteMany')

  await commitOwnedTransaction(context)
  return context.returning === 'none' ? undefined : { data: context.ids.map(id => ({ type: scopeName, id })) }
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
      throw unsupported(scopeName, 'deleteWhere', 'its storage plugin has no many-row support (AnyAPI storage takes single writes)')
    }
    const filters = validateFilters({ filters: params.filters, scopeName, schemaInfo: context.schemaInfo, vars })
    await beginWriteTransaction(context, params.transaction, helpers.newTransaction, args.runHooks)
    context.db = context.transaction
    const ids = await visibleIdsByFilters(args, filters)
    if (!ids.length) {
      await commitOwnedTransaction(context)
      return context.returning === 'none' ? undefined : { data: [] }
    }
    return await runDeleteMany(args, { operation: 'deleteWhere', ids, started: true })
  } catch (error) {
    await handleWriteMethodError(error, context, 'DELETE_WHERE', scopeName, log)
  }
}
