import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { getRequestedComputedFields } from '../lib/querying-writing/knex-field-helpers.js'
import { getEffectiveSortableFields } from '../lib/querying/query-field-sort-helpers.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { cascadeConfig } from './common.js'

/**
 * QUERY
 * Retrieves a collection of resources (e.g., a list of articles) based on provided criteria.
 * This function sends a GET request to /api/{resourceType}.
 *
 * @param {string} resourceType - The type of resource collection to fetch (e.g., "articles").
 * @param {object} [queryParams={}] - Optional. An object to customize the query for the collection.
 * @param {string[]} [queryParams.include=[]] - An optional array of relationship paths to sideload for each resource in the collection. These paths will be converted to a comma-separated string for the URL (e.g., `['author', 'comments.user']` becomes `author,comments.user`). Supports deep relationships (e.g., "publisher.country").
 * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets) for each resource in the collection and its included relationships. Keys are resource types, values are comma-separated field names.
 * @param {object} [queryParams.filters] - An object to filter the collection. Keys are filter parameters (specific to your API's implementation, e.g., 'status', 'title'), values are the filter criteria.
 * @param {string[]} [queryParams.sort=[]] - An optional array of fields to sort the collection by. Each string represents a field; prefix with '-' for descending order (e.g., `['title', '-published-date']` becomes `title,-published-date`).
 * @param {object} [queryParams.page] - An object for pagination. Typically includes `number` (page number) and `size` (items per page). E.g., `{ number: 1, size: 10 }`.
 * @returns {Promise<object>} A Promise that resolves to the JSON:API response document containing the resource collection.
 */
export default async function queryMethod ({
  params,
  context,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  apiOptions,
  pluginOptions,
  scopeOptions,
  scopeName,
  log,
  api
}) {
  context.method = 'query'

  // Determine which simplified setting to use based on transport
  const isTransport = params.isTransport === true

  // Use vars which automatically cascade from scope to global
  const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi

  // Get simplified setting - from params only (per-call override) or use default
  context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified

  // Assign common context properties
  context.schemaInfo = scopes[scopeName].vars.schemaInfo // This is the object variable created by compileSchemas
  context.queryParams = params.queryParams || {}

  // These only make sense as parameter per query
  context.queryParams.fields = cascadeConfig('fields', [params.queryParams], {})
  context.queryParams.include = cascadeConfig('include', [params.queryParams], [])
  context.queryParams.sort = cascadeConfig('sort', [params.queryParams], [])
  context.queryParams.page = cascadeConfig('page', [params.queryParams], {})

  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  context.scopeName = scopeName

  // These are just shortcuts used in this function and will be returned
  const schemaStructure = context.schemaInfo.schemaInstance.structure
  const schemaRelationships = context.schemaInfo.schemaRelationships

  // Sortable fields and sort (mab)
  context.sortableFields = getEffectiveSortableFields(vars)
  // Apply default sort if no sort specified
  if (context.queryParams.sort.length === 0 && vars.defaultSort) {
    context.queryParams.sort = Array.isArray(vars.defaultSort) ? vars.defaultSort : [vars.defaultSort]
  }

  const requestContracts = getRequestContracts({
    scopeName,
    schemaInfo: context.schemaInfo,
    includeDepthLimit: vars.includeDepthLimit,
    sortableFields: context.sortableFields
  })
  const validatedRequest = validateRequestContractOrThrow(
    requestContracts.query,
    { queryParams: context.queryParams },
    'Query parameters are invalid'
  )
  context.queryParams = validatedRequest.queryParams || {}

  // Centralised checkPermissions function
  await scope.checkPermissions({
    method: 'query',
    originalContext: context,
  })

  await runHooks('beforeData')
  await runHooks('beforeDataQuery')
  context.record = await helpers.dataQuery({
    scopeName,
    context,
    runHooks
  })

  // Normalize database values (e.g., convert 1/0 to true/false for booleans)
  context.record = normalizeRecordAttributes(context.record, scopes)

  // Make a backup
  try {
    context.originalRecord = structuredClone(context.record)
  } catch (e) {
    log.error('Failed to clone record:', {
      error: e.message,
      recordKeys: Object.keys(context.record || {}),
      hasHttpRequest: !!context.raw?.req
    })
    throw e
  }

  // This will enhance record, which is the WHOLE JSON:API record
  await runHooks('enrichRecord')

  // Get computed field information for main resource
  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedFields = context.queryParams.fields?.[scopeName]
  const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields)

  // Run enrichAttributes for every single set of attribute, calling it from the right scope
  for (const entry of context.record.data) {
    entry.attributes = await scope.enrichAttributes({
      attributes: entry.attributes,
      parentContext: context,
      requestedComputedFields,
      isMainResource: true,
      computedDependencies: context.computedDependencies
    })
  }
  for (const entry of (context.record.included || [])) {
    const entryScope = scopes[entry.type]
    const entryComputed = entryScope.vars.schemaInfo?.computed || {}
    const entryRequestedFields = context.queryParams.fields?.[entry.type]
    const entryRequestedComputed = getRequestedComputedFields(
      entry.type,
      entryRequestedFields,
      entryComputed
    )

    entry.attributes = await entryScope.enrichAttributes({
      attributes: entry.attributes,
      parentContext: context,
      requestedComputedFields: entryRequestedComputed,
      isMainResource: false,
      computedDependencies: entry.__$jsonrestapi_computed_deps$__
    })
  }

  // The called hooks should NOT change context.record
  await runHooks('finish')
  await runHooks('finishQuery')

  // Transform output if in simplified mode
  if (context.simplified) {
    // Convert JSON:API response back to simplified format
    // Example: {data: {type: 'posts', id: '1', attributes: {title: 'My Post'}, relationships: {author: {data: {type: 'users', id: '123'}}}}}
    // becomes: {id: '1', title: 'My Post', author_id: '123'} - flattens structure and restores foreign keys
    return transformJsonApiToSimplified(
      { record: context.record },
      { context: { schemaStructure, schemaRelationships, scopes } }
    )
  }

  return context.record
}
