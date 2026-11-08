// Shared steps of the many-row operations: input selection, refusals, chunking,
// the in-memory per-row pipeline and the response shape.
import {
  RestApiBulkWriteUnsupportedError,
  RestApiLockOutsideTransactionError,
  RestApiRecordsNotFoundError,
  RestApiValidationError
} from '../../../lib/rest-api-errors.js'
import { transformSimplifiedToJsonApi } from '../lib/querying-writing/simplified-helpers.js'
import { inverseVersionTypes } from '../lib/writing/resource-version.js'
import { isRawValue } from '../lib/storage/many-row-data-helpers.js'
import { queryConstraint } from '../lib/querying/query-constraint.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'

export const DEFAULT_CHUNK_SIZE = 500
const READ_CHUNK_SIZE = 1000

// Per-record events whose handlers many-row operations would skip. A handler
// must be registered with { batch: true } (its work done by a batch hook or not
// applying to batches), or the operation refuses the resource.
const PER_RECORD_EVENTS = {
  post: ['beforeProcessing', 'beforeProcessingPost', 'beforeSchemaValidate', 'beforeSchemaValidatePost', 'afterSchemaValidate', 'afterSchemaValidatePost', 'beforeDataCall', 'beforeDataCallPost', 'afterDataCall', 'afterDataCallPost', 'finish', 'finishPost'],
  patch: ['beforeProcessing', 'beforeProcessingPatch', 'beforeSchemaValidate', 'beforeSchemaValidatePatch', 'afterSchemaValidate', 'afterSchemaValidatePatch', 'beforeDataCall', 'beforeDataCallPatch', 'afterDataCall', 'afterDataCallPatch', 'finish', 'finishPatch'],
  delete: ['beforeDataCall', 'beforeDataCallDelete', 'afterDataCall', 'afterDataCallDelete', 'finish', 'finishDelete']
}

export const noHooks = async () => {}

// Options of the 2.x bulk methods that many-row writes do not have.
const BULK_OPTIONS = {
  atomic: 'Many-row writes are all-or-nothing; remove atomic.',
  expectedVersion: 'Many-row writes refuse versioned resources; use a lockVersionField and onlyIf.',
  expectedVersions: 'Many-row writes refuse versioned resources; use a lockVersionField and onlyIf.',
  operations: 'Pass the rows as data: [{ id, ...attributes }] or document: { data: [...] }.'
}

/** @param {Record<string, unknown>} params */
export function rejectBulkOptions (params) {
  const fields = Object.keys(BULK_OPTIONS).filter(name => Object.hasOwn(params, name))
  if (fields.length) {
    throw new RestApiValidationError(`Unsupported options: ${fields.join(', ')}. ${[...new Set(fields.map(name => BULK_OPTIONS[name]))].join(' ')}`, { fields })
  }
}

/** @param {string} resourceType @param {string} operation @param {string} reason */
export const unsupported = (resourceType, operation, reason) => new RestApiBulkWriteUnsupportedError({ resourceType, operation, reason })

/**
 * Refuses what a many-row write cannot do in one statement per chunk.
 * @param {{ api: any, helpers: any, perRecordHooks: Function, scopeName: string, schemaInfo: any, operation: string, kind: 'post' | 'patch' | 'delete', storageHelper: string }} request
 */
export function refuseUnsupportedResource ({ api, helpers, perRecordHooks, scopeName, schemaInfo, operation, kind, storageHelper }) {
  if (typeof helpers[storageHelper] !== 'function') {
    throw unsupported(scopeName, operation, 'its storage plugin has no many-row support (AnyAPI storage takes single writes)')
  }
  if (schemaInfo.versionField) {
    throw unsupported(scopeName, operation, `the resource is versioned by '${schemaInfo.versionField}'; use single writes with expectedVersion`)
  }
  const parents = [...inverseVersionTypes(api, scopeName, schemaInfo)]
  if (parents.length) {
    throw unsupported(scopeName, operation, `writes advance the version of '${parents.join("', '")}'`)
  }
  if (kind === 'delete') {
    for (const [ownerType, owner] of Object.entries(api.resources)) {
      if (!owner.vars.schemaInfo?.versionField) continue
      const versioned = Object.values(owner.vars.schemaInfo.schemaRelationships || {})
        .some(relationship => relationship.type === 'manyToMany' && relationship.target === scopeName)
      if (versioned) throw unsupported(scopeName, operation, `deletes advance the version of '${ownerType}' through a many-to-many relationship`)
    }
  }
  const hooks = perRecordHooks(PER_RECORD_EVENTS[kind])
  if (hooks.length) {
    // The hook names stay in the error details, which HTTP responses leave out.
    throw new RestApiBulkWriteUnsupportedError({
      resourceType: scopeName,
      operation,
      reason: 'per-record hooks without a batch form run for it; register them with { batch: true } and a batch hook',
      hooks: hooks.map(hook => `${hook.event}:${hook.name}`)
    })
  }
}

/** @param {unknown} value */
export function resolveChunkSize (value) {
  if (value === undefined) return DEFAULT_CHUNK_SIZE
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 1) {
    throw new RestApiValidationError('chunkSize must be a positive integer', { fields: ['chunkSize'] })
  }
  return /** @type {number} */ (value)
}

/**
 * What a many-row write returns: nothing (the default), identifiers, the
 * records (not for deletes) or `{ meta: { count } }`, the number of rows it
 * wrote.
 * @param {unknown} value
 * @param {{ deletes?: boolean }} [options]
 * @returns {'none' | 'minimal' | 'full' | 'count'}
 */
export function resolveManyRowReturning (value, { deletes = false } = {}) {
  const returning = value === undefined ? 'none' : value
  if (returning === 'none' || returning === 'minimal' || returning === 'count' || (returning === 'full' && !deletes)) return returning
  throw new RestApiValidationError(deletes ? "A delete returns 'none', 'minimal' or 'count'" : "returning must be 'none', 'minimal', 'full' or 'count'", { fields: ['returning'] })
}

/** @param {unknown} value */
export function resolveMissing (value) {
  if (value === undefined) return 'throw'
  if (value !== 'throw' && value !== 'skip') {
    throw new RestApiValidationError("missing must be 'throw' or 'skip'", { fields: ['missing'] })
  }
  return value
}

/**
 * The records of a many-row write: `data: [...]` in the plain format, or
 * `document: { data: [...] }` in JSON:API.
 * @param {Record<string, any>} params
 * @returns {{ inputKey: 'data' | 'document', records: any[] }}
 */
export function selectManyInput (params) {
  const hasData = Object.hasOwn(params, 'data')
  if (hasData === Object.hasOwn(params, 'document')) {
    throw new RestApiValidationError('Supply exactly one of data or document', { fields: ['data', 'document'] })
  }
  const records = hasData ? params.data : params.document?.data
  if (!Array.isArray(records) || records.length === 0) {
    const field = hasData ? 'data' : 'document.data'
    throw new RestApiValidationError(`${field} must be a non-empty array of records`, {
      fields: [field], violations: [{ field, rule: 'required_array', message: 'Must be a non-empty array' }]
    })
  }
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new RestApiValidationError(`Record ${index} must be an object`, { fields: [`data.${index}`] })
    }
  })
  return { inputKey: hasData ? 'data' : 'document', records }
}

/**
 * One record as a JSON:API document, with knex.raw values set aside for the
 * operations that accept them.
 * @param {{ record: any, inputKey: 'data' | 'document', scopeName: string, schemaInfo: any, allowRaw?: boolean }} request
 */
export function toDocument ({ record, inputKey, scopeName, schemaInfo, allowRaw = false }) {
  const raw = {}
  let attributes = inputKey === 'data' ? record : record.attributes
  if (attributes && typeof attributes === 'object') {
    for (const [field, value] of Object.entries(attributes)) {
      if (!isRawValue(value)) {
        // Knex would run any object carrying the flag as SQL; JSON input can carry the flag.
        if (value && typeof value === 'object' && Object.hasOwn(value, 'isRawInstance')) {
          throw new RestApiValidationError(`Field '${field}' holds an object that is not a Knex raw value`, { fields: [field] })
        }
        continue
      }
      if (!allowRaw) throw new RestApiValidationError(`Field '${field}' cannot take a raw SQL value here`, { fields: [field] })
      raw[field] = value
    }
    if (Object.keys(raw).length) attributes = Object.fromEntries(Object.entries(attributes).filter(([field]) => !Object.hasOwn(raw, field)))
  }
  const document = inputKey === 'data'
    ? transformSimplifiedToJsonApi({ inputRecord: attributes }, {
      context: { scopeName, schemaStructure: schemaInfo.schemaInstance.structure, schemaRelationships: schemaInfo.schemaRelationships }
    })
    : { data: { ...record, ...(record.attributes ? { attributes } : {}) } }
  return { document, raw }
}

/**
 * Prefixes a row's validation paths with its position in the batch.
 * @param {unknown} error @param {number} index
 */
export function atIndex (error, index) {
  if (!(error instanceof RestApiValidationError)) return error
  const prefix = path => typeof path === 'string' ? path.replace(/^(data\.)?/, `data.${index}.`) : path
  const details = /** @type {any} */ (error.details || {})
  if (Array.isArray(details.fields)) details.fields = details.fields.map(prefix)
  if (Array.isArray(details.violations)) details.violations = details.violations.map(violation => ({ ...violation, field: prefix(violation.field) }))
  details.index = index
  error.details = details
  return error
}

/**
 * Throws when a requested identifier is missing or outside the caller's scope.
 * @param {{ requested: unknown[], visible: Map<string, unknown> | Set<string>, missing: 'throw' | 'skip', scopeName: string, storageAdapter: any }} request
 * @returns {unknown[]} requested identifiers that are visible
 */
export function keepVisible ({ requested, visible, missing, scopeName, storageAdapter }) {
  const kept = []
  let absent = 0
  for (const id of requested) {
    if (visible.has(String(storageAdapter.translateFilterValue('id', id)))) kept.push(id)
    else absent++
  }
  if (absent && missing === 'throw') throw new RestApiRecordsNotFoundError({ resourceType: scopeName, missing: absent })
  return kept
}

/** @param {unknown[]} ids */
export function refuseDuplicateIds (ids, storageAdapter, field = 'data') {
  const seen = new Set()
  for (const id of ids) {
    const key = String(storageAdapter.translateFilterValue('id', id))
    if (seen.has(key)) throw new RestApiValidationError(`Identifier ${id} appears twice in the batch`, { fields: [field] })
    seen.add(key)
  }
}

/** @param {{ transaction?: any, scopeName: string, operation: string }} request */
export function requireLockTransaction ({ transaction, scopeName, operation }) {
  if (!transaction || typeof transaction !== 'function' || !transaction.isTransaction || transaction.isCompleted?.()) {
    throw new RestApiLockOutsideTransactionError({ resourceType: scopeName, operation })
  }
}

/**
 * patchWhere and deleteWhere need filters, or `all: true` to act on every row
 * the caller can see (in a system context, the whole table).
 * @param {{ filters: Record<string, unknown> | undefined, all: unknown, missing?: unknown, operation: string }} request
 */
export function requireWhereScope ({ filters, all, missing, operation }) {
  // A selection writes the rows it finds and answers with those; no row is missing.
  if (missing !== undefined) throw new RestApiValidationError(`${operation} writes the rows its selection finds; missing applies to lists of ids`, { fields: ['missing'] })
  if (all !== undefined && all !== true) throw new RestApiValidationError('all must be true when given', { fields: ['all'] })
  const filtered = Boolean(filters && Object.keys(filters).length)
  if (all && filtered) throw new RestApiValidationError(`${operation} takes filters or all: true, not both`, { fields: ['all'] })
  if (!all && !filtered) {
    throw new RestApiValidationError(`${operation} needs filters, or all: true to act on every row the caller can see`, { fields: ['filters'] })
  }
}

/**
 * Validates filters as `query` would, so many-row operations accept the same
 * search fields and values.
 */
export function validateFilters ({ filters, scopeName, schemaInfo, vars }) {
  if (filters === undefined) return undefined
  const contracts = getRequestContracts({ scopeName, schemaInfo, includeDepthLimit: vars.includeDepthLimit, sortableFields: vars.sortableFields })
  return validateRequestContractOrThrow(contracts.query, { queryParams: { filters } }, 'Filters are invalid').queryParams?.filters
}

/**
 * The response of a many-row write: the count of written rows, identifiers,
 * full records read through `query` in the write's transaction, or nothing.
 * `locked`: the transaction holds row locks on the ids, so they are read as locked.
 * @param {{ api: any, scopeName: string, context: any, ids: unknown[], returning: string, format: string, queryParams?: any, locked?: boolean }} request
 */
export async function manyRowResponse ({ api, scopeName, context, ids, returning, format, queryParams = {}, locked = false }) {
  if (returning === 'none') return undefined
  const present = ids.filter(id => id !== undefined && id !== null).map(String)
  if (returning === 'count') return { meta: { count: present.length } }
  if (returning === 'minimal') return { data: present.map(id => ({ type: scopeName, id })) }

  const byId = new Map()
  /** @type {Map<string, any>} */
  const included = new Map()
  for (let offset = 0; offset < present.length; offset += READ_CHUNK_SIZE) {
    const part = present.slice(offset, offset + READ_CHUNK_SIZE)
    const page = await api.resources[scopeName].query({
      format,
      transaction: context.transaction,
      pageSizeLimit: part.length,
      queryParams: { fields: queryParams.fields, include: queryParams.include, sort: ['id'], page: { size: part.length } },
      [queryConstraint]: { scopeName, idsQuery: part, locked }
    }, { ...context, method: undefined, knexQuery: undefined })
    for (const record of page.data) byId.set(String(record.id), record)
    for (const resource of page.included || []) included.set(`${resource.type}:${resource.id}`, resource)
  }
  // Rows the caller's read scope hides are left out.
  const data = present.filter(id => byId.has(id)).map(id => byId.get(id))
  return format === 'jsonapi' && included.size ? { data, included: [...included.values()] } : { data }
}
