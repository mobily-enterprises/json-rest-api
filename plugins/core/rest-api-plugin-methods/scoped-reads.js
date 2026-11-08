// Reads that keep the resource's scope: the read-only scoped builder, every-row
// reads in cursor pages, and row locks inside a transaction.
import { RestApiBulkWriteUnsupportedError, RestApiRecordsNotFoundError, RestApiRowLimitError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { readOnlyQueryBuilder } from '../lib/querying/read-only-query.js'
import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { filterResponseFields, getResourceFieldset } from '../lib/querying-writing/field-utils.js'
import { getRequestedComputedFields, validateRequestedFieldsets } from '../lib/querying-writing/knex-field-helpers.js'
import { resolveFormat } from '../lib/querying-writing/response-options.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { chunk } from '../lib/storage/many-row-data-helpers.js'
import { filterToOneResponseLinkage, snapshotReadRecord } from './common.js'
import { refuseDuplicateIds, requireLockTransaction, resolveLockMode, resolveMissing, validateFilters } from './many-row-common.js'

export const SCOPED_QUERY_PURPOSES = new Set(['report', 'bulk-write', 'lock', 'claim'])
const DEFAULT_QUERY_ALL_PAGE = 1000
const MAX_CLAIM = 1000
const MAX_LOCK_WHERE = 1000

const invalid = (field, message) => new RestApiValidationError(message, { fields: [field], violations: [{ field, rule: 'scoped_read', message }] })

/**
 * The resource's table with ownership and row policy applied, as a read-only
 * Knex builder over a derived table named after the alias (or the table), so
 * nothing a caller adds, `orWhere` included, can widen the scope. Resolves to
 * `{ query }`: a builder is thenable, so returning it from an async method would run it.
 * @param {any} args
 */
export async function scopedQueryMethod ({ params, context, vars, helpers, scope, scopes, runHooks, scopeName, api }) {
  const { transaction, alias, purpose = 'report', filters, ...unknown } = params
  if (Object.keys(unknown).length) throw invalid(Object.keys(unknown)[0], `Unknown scopedQuery options: ${Object.keys(unknown).join(', ')}`)
  if (!SCOPED_QUERY_PURPOSES.has(purpose)) throw invalid('purpose', `purpose must be one of ${[...SCOPED_QUERY_PURPOSES].join(', ')}`)
  if (alias !== undefined && (typeof alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))) {
    throw invalid('alias', 'alias must be an identifier')
  }
  if (typeof helpers.dataScopedQuery !== 'function') {
    throw new RestApiBulkWriteUnsupportedError({ resourceType: scopeName, operation: 'scopedQuery', reason: 'its storage plugin provides no scoped builder' })
  }
  context.method = 'scopedQuery'
  context.scopeName = scopeName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  context.transaction = transaction
  context.db = transaction
  context.queryParams = { filters: validateFilters({ filters, scopeName, schemaInfo: context.schemaInfo, vars }) || {} }
  // A caller who may not query the resource may not build reports on it either.
  await scope.checkPermissions({ method: 'query', originalContext: { ...context, method: 'query', scopedQuery: true } })
  const { query, alias: name } = await helpers.dataScopedQuery({ scopeName, context, runHooks, alias, purpose, filters: context.queryParams.filters })
  const derived = (transaction || api.knex.instance).from(query.select(`${name}.*`).as(name))
  return { query: readOnlyQueryBuilder(derived, { resourceType: scopeName }) }
}

/**
 * Every row the filters select, read in cursor pages of `pageSize` rows.
 * @param {any} args
 */
export async function queryAllMethod ({ params, context, vars, scopeName, api }) {
  const { queryParams = {}, transaction, pageSize = DEFAULT_QUERY_ALL_PAGE, rowLimit, format, ...unknown } = params
  if (Object.keys(unknown).length) throw invalid(Object.keys(unknown)[0], `Unknown queryAll options: ${Object.keys(unknown).join(', ')}`)
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw invalid('pageSize', 'pageSize must be a positive integer')
  if (rowLimit !== undefined && (!Number.isSafeInteger(rowLimit) || rowLimit < 1)) throw invalid('rowLimit', 'rowLimit must be a positive integer')
  if (queryParams.page !== undefined) throw invalid('queryParams.page', 'queryAll pages by itself; leave out queryParams.page')
  const resolvedFormat = resolveFormat(format, vars.format)
  const sort = queryParams.sort?.length ? queryParams.sort : ['id']

  const data = []
  const included = new Map()
  let cursor
  do {
    const page = await api.resources[scopeName].query({
      format: resolvedFormat,
      transaction,
      pageSizeLimit: pageSize,
      queryParams: { ...queryParams, sort, page: cursor ? { size: pageSize, after: cursor } : { size: pageSize } }
    }, { ...context })
    data.push(...page.data)
    for (const resource of page.included || []) included.set(`${resource.type}:${resource.id}`, resource)
    if (rowLimit !== undefined && data.length > rowLimit) throw new RestApiRowLimitError({ resourceType: scopeName, rowLimit })
    cursor = page.meta?.pagination?.hasMore ? page.meta.pagination.cursor?.next : undefined
  } while (cursor)
  return resolvedFormat === 'jsonapi' && included.size ? { data, included: [...included.values()] } : { data }
}

// The rows a lock read leave through the read pipeline `query` runs after its
// data call, so masking and denials apply to them too: checkDataPermissions for
// each row as `get` runs it, enrichRecord, computed fields, the finish hooks,
// sparse fieldsets and the plain format. Hooks see method 'query' and lock: true.
async function finishLockedRead ({ document, context, scope, scopes, scopeName, runHooks, hasHooks }) {
  context.method = 'query'
  context.lock = true
  context.record = normalizeRecordAttributes(document, scopes)
  if (hasHooks('checkDataPermissions') || hasHooks('checkDataPermissionsGet')) {
    for (const entry of context.record.data) {
      const recordContext = { ...context, method: 'get', id: entry.id, record: { data: entry } }
      await runHooks('checkDataPermissions', recordContext)
      await runHooks('checkDataPermissionsGet', recordContext)
    }
  }
  snapshotReadRecord(context, scopes, hasHooks, 'query')
  await runHooks('enrichRecord')
  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedComputedFields = getRequestedComputedFields(scopeName, getResourceFieldset(context.queryParams.fields, scopeName), computedFields)
  for (const entry of context.record.data) {
    entry.attributes = await scope.enrichAttributes({
      id: entry.id,
      attributes: entry.attributes,
      parentContext: context,
      requestedComputedFields,
      isMainResource: true,
      computedDependencies: context.computedDependencies
    })
  }
  await runHooks('finish')
  await runHooks('finishQuery')
  await filterToOneResponseLinkage(context, scopes)
  const record = normalizeRecordAttributes(context.record, scopes, { source: 'response' })
  filterResponseFields(record, context.queryParams.fields)
  if (context.format !== 'plain') return { data: record.data }
  const schemaInfo = scope.vars.schemaInfo
  return transformJsonApiToSimplified({ record }, {
    context: { schemaStructure: schemaInfo.schemaInstance.structure, schemaRelationships: schemaInfo.schemaRelationships, scopes }
  })
}

// Returns the lock mode, validated with the rest before any statement.
async function setupLockRead ({ params, context, vars, helpers, scopes, scopeName }, operation, storageHelper) {
  requireLockTransaction({ transaction: params.transaction, scopeName, operation })
  const lockMode = resolveLockMode(params.lockMode)
  if (typeof helpers[storageHelper] !== 'function') {
    throw new RestApiBulkWriteUnsupportedError({ resourceType: scopeName, operation, reason: 'its storage plugin has no row locks (AnyAPI storage has none)' })
  }
  context.method = operation
  context.scopeName = scopeName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  context.transaction = params.transaction
  context.db = params.transaction
  context.format = resolveFormat(params.format, vars.format)
  context.simplified = context.format === 'plain'
  const fields = params.queryParams?.fields
  if (params.queryParams !== undefined && Object.keys(params.queryParams).some(key => key !== 'fields')) {
    throw invalid('queryParams', `${operation} takes only queryParams.fields`)
  }
  context.queryParams = { fields: fields ?? {} }
  await validateRequestedFieldsets(context, scopes)
  return lockMode
}

/**
 * Locks the visible rows among `ids` until the transaction ends, in id order,
 * and returns them as the locking read saw them. That read is the first
 * statement on the rows and decides visibility itself, so the transaction's
 * snapshot starts after any lock wait. On MySQL it locks every listed row,
 * hidden ones too, before it checks the scope (see guide 34).
 * @param {any} args
 */
export async function lockByIdsMethod (args) {
  const { params, context, helpers, scope, scopes, runHooks, hasHooks, scopeName, scopeOptions, vars } = args
  const lockMode = await setupLockRead(args, 'lockByIds', 'dataLockByIds')
  if (!Array.isArray(params.ids) || !params.ids.length) throw invalid('ids', 'ids must be a non-empty array')
  const ids = params.ids.map(id => requireExistingResourceId(id, { scopeOptions, vars, scopeName }))
  const storageAdapter = helpers.getStorageAdapter(scopeName)
  refuseDuplicateIds(ids, storageAdapter, 'ids')
  const missing = resolveMissing(params.missing)
  await scope.checkPermissions({ method: 'query', originalContext: { ...context, method: 'query', lock: true } })
  // Sorted before chunking, so lists longer than a chunk still lock in one
  // order across transactions: a list of integers numerically, any other list
  // by code unit (the database's order for a binary collation).
  const keys = ids.map(id => String(storageAdapter.translateFilterValue('id', id)))
  const numeric = keys.every(key => /^-?\d+$/.test(key))
  const sorted = ids
    .map((id, index) => ({ id, key: numeric ? BigInt(keys[index]) : keys[index] }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(entry => entry.id)
  const document = { data: [] }
  for (const part of chunk(sorted, 1000)) {
    document.data.push(...(await helpers.dataLockByIds({ scopeName, context, runHooks, ids: part, lockMode })).data)
  }
  if (document.data.length < ids.length && missing === 'throw') {
    throw new RestApiRecordsNotFoundError({ resourceType: scopeName, missing: ids.length - document.data.length })
  }
  if (!document.data.length) return { data: [] }
  return finishLockedRead({ document, context, scope, scopes, scopeName, runHooks, hasHooks })
}

/**
 * Locks the visible rows the filters select until the transaction ends, in id
 * order, waiting for transactions that hold them, so a row that starts to match
 * while the lock waits is locked and returned too. At most 1,000 rows.
 * @param {any} args
 */
export async function lockWhereMethod (args) {
  const { params, context, vars, helpers, scope, scopes, runHooks, hasHooks, scopeName } = args
  const lockMode = await setupLockRead(args, 'lockWhere', 'dataLockWhere')
  const filters = validateFilters({ filters: params.filters, scopeName, schemaInfo: context.schemaInfo, vars })
  await scope.checkPermissions({ method: 'query', originalContext: { ...context, method: 'query', lock: true } })
  const document = await helpers.dataLockWhere({ scopeName, context, runHooks, filters, limit: MAX_LOCK_WHERE + 1, lockMode })
  if (document.data.length > MAX_LOCK_WHERE) throw new RestApiRowLimitError({ resourceType: scopeName, rowLimit: MAX_LOCK_WHERE, operation: 'lockWhere' })
  return finishLockedRead({ document, context, scope, scopes, scopeName, runHooks, hasHooks })
}

/**
 * Takes up to `limit` rows the filters select that no other transaction holds
 * (SELECT … FOR UPDATE SKIP LOCKED), for job queues.
 * @param {any} args
 */
export async function claimMethod (args) {
  const { params, context, vars, helpers, scope, scopes, runHooks, hasHooks, scopeName } = args
  const lockMode = await setupLockRead(args, 'claim', 'dataClaim')
  const limit = params.limit ?? 1
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CLAIM) throw invalid('limit', `limit must be an integer from 1 to ${MAX_CLAIM}`)
  const filters = validateFilters({ filters: params.filters, scopeName, schemaInfo: context.schemaInfo, vars })
  const sortParam = params.sort ?? ['id']
  if (!Array.isArray(sortParam)) throw invalid('sort', 'sort must be an array of fields')
  const schema = context.schemaInfo.schemaStructure
  const sort = sortParam.map((entry, index) => {
    const field = typeof entry === 'string' ? entry.replace(/^-/, '') : null
    if (!field || (field !== 'id' && (!schema[field] || schema[field].virtual || schema[field].computed))) {
      throw invalid(`sort.${index}`, `'${entry}' is not a stored field`)
    }
    return { field, direction: entry.startsWith('-') ? 'desc' : 'asc' }
  })
  await scope.checkPermissions({ method: 'query', originalContext: { ...context, method: 'query', lock: true } })
  const document = await helpers.dataClaim({ scopeName, context, runHooks, filters, sort, limit, lockMode })
  return finishLockedRead({ document, context, scope, scopes, scopeName, runHooks, hasHooks })
}
