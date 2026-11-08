// Change many records by id: validate every row in memory, read which of the
// ids the caller may change (one scoped read per chunk), then run one UPDATE per
// chunk with CASE expressions. patchWhereIds and patchWhere reuse the same path.
import { lockRelationshipTargets, processRelationships } from '../lib/writing/relationship-processor.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { validateUpdateRequest } from '../lib/querying-writing/request-contracts.js'
import { beginWriteTransaction } from '../../../lib/error-context.js'
import { RestApiRecordsNotFoundError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { chunk } from '../lib/storage/many-row-data-helpers.js'
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
  keepVisible,
  manyRowResponse,
  noHooks,
  refuseDuplicateIds,
  refuseUnsupportedResource,
  rejectBulkOptions,
  requireWhereScope,
  resolveChunkSize,
  resolveManyRowReturning,
  resolveMissing,
  selectManyInput,
  toDocument,
  unsupported,
  validateFilters
} from './many-row-common.js'

// Ids read per visibility statement; the write chunks are sized separately.
export const VISIBLE_READ_CHUNK = 1000
export const VISIBLE_PAGE_SIZE = 10000

const invalid = (field, message) => new RestApiValidationError(message, { fields: [field], violations: [{ field, rule: 'many_row_input', message }] })

// Fields a many-row patch may never change: identity, ownership and the lock version.
function protectedFields (schemaInfo) {
  const fields = new Set(['id', ...(schemaInfo.ownershipFields || [])])
  if (schemaInfo.lockVersionField) fields.add(schemaInfo.lockVersionField)
  const relationships = new Set()
  for (const field of schemaInfo.ownershipFields || []) {
    const alias = schemaInfo.schemaStructure[field]?.as
    if (alias) relationships.add(alias)
  }
  return { fields, relationships }
}

function refuseProtectedFields (names, schemaInfo, index) {
  const { fields } = protectedFields(schemaInfo)
  for (const field of names) {
    if (fields.has(field)) throw atIndex(invalid(`data.attributes.${field}`, `'${field}' cannot be changed by a many-row patch`), index)
  }
}

function refuseProtectedInput ({ document, raw, schemaInfo, index }) {
  const { relationships } = protectedFields(schemaInfo)
  refuseProtectedFields([...Object.keys(document.data.attributes || {}), ...Object.keys(raw)], schemaInfo, index)
  for (const name of Object.keys(document.data.relationships || {})) {
    if (relationships.has(name)) throw atIndex(invalid(`data.relationships.${name}`, `'${name}' sets ownership and cannot be changed by a many-row patch`), index)
  }
  for (const field of Object.keys(raw)) {
    const definition = schemaInfo.schemaStructure[field]
    if (!definition || definition.virtual || definition.computed || definition.belongsTo || definition.belongsToPolymorphic) {
      throw atIndex(invalid(`data.attributes.${field}`, `'${field}' cannot take a raw SQL value: it must be a stored, non-relationship field`), index)
    }
  }
}

function resolveOnlyIf (onlyIf, { schemaInfo, storageAdapter }) {
  if (onlyIf === undefined) return undefined
  if (!onlyIf || typeof onlyIf !== 'object' || Array.isArray(onlyIf) || !Object.keys(onlyIf).length) {
    throw invalid('onlyIf', 'onlyIf must be an object of field values')
  }
  const conditions = {}
  for (const [field, value] of Object.entries(onlyIf)) {
    const definition = schemaInfo.schemaStructure[field]
    if (!definition || definition.virtual || definition.computed || field === 'id') throw invalid(`onlyIf.${field}`, `'${field}' is not a stored field`)
    if (value !== null && (typeof value === 'object' && !(value instanceof Date))) throw invalid(`onlyIf.${field}`, 'onlyIf values must be scalars or null')
    conditions[storageAdapter.translateColumn(field)] = value === null ? null : storageAdapter.translateFilterValue(field, value)
  }
  return conditions
}

/**
 * The shared path: `entries` are { id, document, raw } in input order. A
 * `selection` (patchWhere) gives the filters that found the ids: its rows are
 * never missing, and the write answers with the rows it changed.
 * @param {any} args
 * @param {{ operation: string, entries: Array<{ id: unknown, document: any, raw: Record<string, unknown> }>, started?: boolean, selection?: { filters?: Record<string, unknown> } }} batch
 */
async function runPatchMany (args, { operation, entries, started = false, selection }) {
  const { params, context, vars, helpers, scope, runHooks, hasHooks, perRecordHooks, scopeOptions, scopeName, api } = args
  const schemaInfo = context.schemaInfo
  const storageAdapter = helpers.getStorageAdapter(scopeName)
  const chunkSize = resolveChunkSize(params.chunkSize)
  const missing = selection ? 'skip' : resolveMissing(params.missing)
  refuseUnsupportedResource({ api, helpers, perRecordHooks, scopeName, schemaInfo, operation, kind: 'patch', storageHelper: 'dataUpdateByIds' })
  const onlyIf = resolveOnlyIf(params.onlyIf, { schemaInfo, storageAdapter })
  entries.forEach((entry, index) => refuseProtectedInput({ ...entry, schemaInfo, index }))

  if (!started) await beginWriteTransaction(context, params.transaction, helpers.newTransaction, runHooks)
  context.db = context.transaction
  context.inputRecords = entries.map(entry => entry.document)
  // Fields set by raw SQL values, which plugins that refuse fields check too.
  context.rawFields = [...new Set(entries.flatMap(entry => Object.keys(entry.raw)))]
  await runHooks('beforeProcessingPatchMany')

  const targets = new Map()
  const rows = entries.map((entry, index) => {
    const rowContext = { ...context, method: 'patch', inputRecord: entry.document, originalInputAttributes: undefined, bulkIndex: index }
    // A row of raw values alone, or one that only advances a lock version,
    // still carries an (empty) attributes object.
    if (Object.keys(entry.raw).length || schemaInfo.lockVersionField) entry.document.data.attributes ||= {}
    try {
      validateUpdateRequest({ method: 'patch', params: {}, context: rowContext, vars, scopeOptions, scopeName })
    } catch (error) { throw atIndex(error, index) }
    collectRelationshipTargets(rowContext.inputRecord, api, targets)
    return { rowContext, raw: entry.raw, index, clearsLink: false }
  })
  refuseDuplicateIds(rows.map(row => row.rowContext.id), storageAdapter)
  await validateRelationshipTargets(context, [...targets.values()], helpers, api)

  const parents = []
  for (const row of rows) {
    const { rowContext, index } = row
    try {
      const { belongsToUpdates, belongsToTargets, manyToManyRelationships, reverseRelationships } = processRelationships(scope, { context: rowContext })
      if (manyToManyRelationships.length || reverseRelationships.length) {
        throw unsupported(scopeName, operation, 'rows set many-to-many or reverse relationships; change those links with single writes')
      }
      await validateResourceAttributesBeforeWrite({ context: rowContext, schema: schemaInfo.schemaInstance, belongsToUpdates, runHooks: noHooks, isPartialValidation: true })
      rowContext.inputRecord.data.attributes = { ...rowContext.inputRecord.data.attributes, ...belongsToUpdates }
      row.clearsLink = Object.values(belongsToUpdates).includes(null)
      // A polymorphic relationship writes its own type and id columns, which may be ownership fields.
      refuseProtectedFields(Object.keys(rowContext.inputRecord.data.attributes), schemaInfo, index)
      // A row with no fields still advances a lock version.
      if (!Object.keys(rowContext.inputRecord.data.attributes).length && !Object.keys(row.raw).length && !schemaInfo.lockVersionField) {
        throw invalid('data', 'A patch row must change at least one field')
      }
      parents.push(...belongsToTargets)
    } catch (error) { throw atIndex(error, index) }
  }

  // Which of the requested rows the caller may change. With missing: 'skip' and
  // no hook that needs the rows first, the UPDATE decides it, carrying the
  // scope, and its changed rows answer. Otherwise one scoped read per chunk
  // gives each row's minimal record to the permission check. On MySQL a
  // locking read locks every listed row before it checks the scope, so ids
  // from the caller always get that read first; a selection's ids come from
  // its own scoped read. A selection's UPDATE carries the scope and its filters
  // either way, so it changes only rows that still match.
  // A row that clears a link reads first too, to keep a link to a hidden target.
  const readFirst = rows.some(row => row.clearsLink) || !(missing === 'skip' && !hasHooks('checkPermissions') && !hasHooks('beforeDataCallPatchMany') &&
    (selection || databaseFamily(context.db) !== 'mysql'))
  const scoped = Boolean(selection) || !readFirst
  let keptRows = rows
  if (readFirst) {
    const visible = new Map()
    for (const part of chunk(rows.map(row => row.rowContext.id), VISIBLE_READ_CHUNK)) {
      const records = await helpers.dataGetMinimal({ scopeName, context, runHooks, ids: part, filters: {}, queryPurpose: 'bulk-write' })
      for (const record of records) visible.set(String(storageAdapter.translateFilterValue('id', record.id)), record)
    }
    const kept = keepVisible({ requested: rows.map(row => row.rowContext.id), visible, missing, scopeName, storageAdapter })
    keptRows = rows.filter(row => kept.includes(row.rowContext.id))
    for (const { rowContext } of keptRows) {
      rowContext.minimalRecord = visible.get(String(storageAdapter.translateFilterValue('id', rowContext.id)))
    }
    await keepHiddenLinks({
      context,
      scopes: api.resources,
      schemaInfo,
      rows: keptRows.filter(row => row.clearsLink).map(({ rowContext }) => ({ updates: rowContext.inputRecord.data.attributes, stored: rowContext.minimalRecord, inputRecord: rowContext.inputRecord }))
    })
    for (const { rowContext, index } of keptRows) {
      try {
        await scope.checkPermissions({ method: 'patch', originalContext: rowContext })
      } catch (error) { throw atIndex(error, index) }
    }
  }

  context.ids = keptRows.map(row => String(row.rowContext.id))
  context.inputRecords = keptRows.map(row => row.rowContext.inputRecord)
  await runHooks('beforeDataCallPatchMany')
  await lockRelationshipTargets(api, context.transaction, parents)

  const updates = []
  for (const { rowContext, raw, index } of keptRows) {
    try {
      await applyFieldSetters(rowContext, api, helpers)
    } catch (error) { throw atIndex(error, index) }
    const row = storageAdapter.toStorageRow(rowContext.inputRecord.data.attributes || {}, { context: rowContext, operation: 'patch' })
    delete row[storageAdapter.getIdColumn()]
    for (const [field, value] of Object.entries(raw)) row[storageAdapter.translateColumn(field)] = value
    updates.push({ id: rowContext.id, row })
  }

  const changed = new Set((updates.length
    ? await helpers.dataUpdateByIds({ scopeName, context, runHooks, updates, onlyIf, chunkSize, scoped, filters: selection?.filters })
    : []).map(String))
  // A row that left the caller's scope after the visibility read is not written.
  const unchanged = updates.length - changed.size
  if (unchanged && !onlyIf && missing === 'throw') throw new RestApiRecordsNotFoundError({ resourceType: scopeName, missing: unchanged })
  // After-hooks see the changed rows' ids and inputs, paired by position.
  const written = keptRows.filter(row => changed.has(String(storageAdapter.translateFilterValue('id', row.rowContext.id))))
  context.ids = written.map(row => String(storageAdapter.translateFilterValue('id', row.rowContext.id)))
  context.inputRecords = written.map(row => row.rowContext.inputRecord)
  await runHooks('afterDataCallPatchMany')

  const response = await manyRowResponse({
    api, scopeName, context, ids: context.ids, returning: context.returning, format: context.format, queryParams: params.queryParams
  })
  await commitOwnedTransaction(context)
  return response
}

function setupManyWrite ({ params, context, vars, scopes, scopeName }, method) {
  context.method = method
  rejectRemovedOptions(params)
  rejectBulkOptions(params)
  context.scopeName = scopeName
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  context.format = resolveFormat(params.format, vars.format)
  context.simplified = context.format === 'plain'
  context.returning = resolveManyRowReturning(params.returning)
  context.params = params
}

// One record of attributes for every id: `data: {…}` or `document: { data: {…} }`.
function selectSharedRecord (params, { scopeName, schemaInfo }) {
  const hasData = Object.hasOwn(params, 'data')
  if (hasData === Object.hasOwn(params, 'document')) throw invalid('data', 'Supply exactly one of data or document')
  const record = hasData ? params.data : params.document?.data
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw invalid(hasData ? 'data' : 'document.data', 'The patch must be one record object')
  if (record.id !== undefined) throw invalid(hasData ? 'data.id' : 'document.data.id', 'The patch applies to the listed ids; it cannot carry an id')
  return { inputKey: hasData ? 'data' : 'document', record }
}

function entriesFor (ids, shared, { scopeName, schemaInfo }) {
  return ids.map(id => {
    const record = shared.inputKey === 'data'
      ? { ...shared.record, id }
      : { ...shared.record, type: shared.record.type ?? scopeName, id: String(id) }
    const { document, raw } = toDocument({ record, inputKey: shared.inputKey, scopeName, schemaInfo, allowRaw: true })
    return { id, document, raw }
  })
}

function requireIds (ids, { scopeOptions, vars, scopeName }) {
  if (!Array.isArray(ids) || !ids.length) throw invalid('ids', 'ids must be a non-empty array')
  return ids.map(id => requireExistingResourceId(id, { scopeOptions, vars, scopeName }))
}

/**
 * Reads every visible identifier the filters select, in keyset pages.
 * @param {any} args
 * @param {Record<string, unknown> | undefined} filters
 */
export async function visibleIdsByFilters ({ helpers, context, runHooks, scopeName }, filters) {
  const ids = []
  let after
  for (;;) {
    const page = await helpers.dataVisibleIds({ scopeName, context, runHooks, filters, queryPurpose: 'bulk-write', after, limit: VISIBLE_PAGE_SIZE })
    ids.push(...page)
    if (page.length < VISIBLE_PAGE_SIZE) return ids
    after = page[page.length - 1]
  }
}

/** @param {any} args */
export async function patchManyMethod (args) {
  const { params, context, scopeName, log } = args
  try {
    setupManyWrite(args, 'patchMany')
    const { inputKey, records } = selectManyInput(params)
    const entries = records.map((record, index) => {
      if (record.id === undefined || record.id === null) throw atIndex(invalid('data.id', 'Every patch row needs an id'), index)
      try {
        return { id: record.id, ...toDocument({ record, inputKey, scopeName, schemaInfo: context.schemaInfo, allowRaw: true }) }
      } catch (error) { throw atIndex(error, index) }
    })
    return await runPatchMany(args, { operation: 'patchMany', entries })
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_MANY', scopeName, log)
  }
}

/** @param {any} args */
export async function patchWhereIdsMethod (args) {
  const { params, context, scopeName, log } = args
  try {
    setupManyWrite(args, 'patchWhereIds')
    const shared = selectSharedRecord(params, { scopeName, schemaInfo: context.schemaInfo })
    const ids = requireIds(params.ids, args)
    return await runPatchMany(args, { operation: 'patchWhereIds', entries: entriesFor(ids, shared, { scopeName, schemaInfo: context.schemaInfo }) })
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_WHERE_IDS', scopeName, log)
  }
}

/** @param {any} args */
export async function patchWhereMethod (args) {
  const { params, context, scopeName, vars, helpers, log } = args
  try {
    setupManyWrite(args, 'patchWhere')
    const shared = selectSharedRecord(params, { scopeName, schemaInfo: context.schemaInfo })
    if (typeof helpers.dataVisibleIds !== 'function') {
      throw unsupported(scopeName, 'patchWhere', 'its storage plugin has no many-row support')
    }
    const filters = validateFilters({ filters: params.filters, scopeName, schemaInfo: context.schemaInfo, vars })
    requireWhereScope({ filters, all: params.all, missing: params.missing, operation: 'patchWhere' })
    // The visible ids are read in the write's transaction, so open it first.
    await beginWriteTransaction(context, params.transaction, helpers.newTransaction, args.runHooks)
    context.db = context.transaction
    const ids = await visibleIdsByFilters(args, filters)
    if (!ids.length) {
      await commitOwnedTransaction(context)
      return context.returning === 'count' ? { meta: { count: 0 } } : context.returning === 'none' ? undefined : { data: [] }
    }
    return await runPatchMany(args, {
      operation: 'patchWhere', entries: entriesFor(ids, shared, { scopeName, schemaInfo: context.schemaInfo }), started: true, selection: { filters }
    })
  } catch (error) {
    await handleWriteMethodError(error, context, 'PATCH_WHERE', scopeName, log)
  }
}
