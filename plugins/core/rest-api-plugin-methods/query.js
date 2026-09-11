import { enrichIncludedAttributes } from './enrich-attributes.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { filterResponseFields, getResourceFieldset } from '../lib/querying-writing/field-utils.js'
import { getRequestedComputedFields, validateRequestedFieldsets } from '../lib/querying-writing/knex-field-helpers.js'
import { getEffectiveSortableFields } from '../lib/querying/query-field-sort-helpers.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { validateRequestedIncludes, filterToOneResponseLinkage } from './common.js'
import { queryConstraint } from '../lib/querying/query-constraint.js'

/**
 * Read a filtered collection using params.queryParams and the selected format.
 * Preserve authorization and field selection through collection execution.
 * Pagination metadata belongs to the result; this method sends no HTTP request.
 */
export default async function queryMethod ({
  params,
  context,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  scopeName,
  api
}) {
  context.method = 'query'
  // Nested queries only inherit membership when it is explicitly supplied again.
  context[queryConstraint] = params[queryConstraint]

  rejectRemovedOptions(params)
  context.format = resolveFormat(params.format, vars.format)
  context.simplified = context.format === 'plain'

  // Assign common context properties
  context.schemaInfo = scopes[scopeName].vars.schemaInfo // This is the object variable created by compileSchemas
  context.queryParams = params.queryParams || {}

  // These only make sense as parameter per query
  context.queryParams.fields = params.queryParams?.fields ?? {}
  if (context.queryParams.include == null) delete context.queryParams.include
  context.queryParams.sort = params.queryParams?.sort ?? []
  context.queryParams.page = params.queryParams?.page ?? {}

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

  await validateRequestedFieldsets(context, scopes)
  validateRequestedIncludes(context, scopes)
  await runHooks('beforeData')
  await runHooks('beforeDataQuery')
  context.record = await helpers.dataQuery({
    scopeName,
    context,
    runHooks
  })

  // Normalize database values (e.g., convert 1/0 to true/false for booleans)
  context.record = normalizeRecordAttributes(context.record, scopes)

  context.originalRecord = structuredClone(context.record)

  await runHooks('enrichRecord')

  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedFields = getResourceFieldset(context.queryParams.fields, scopeName)
  const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields)

  // Run enrichAttributes for every single set of attribute, calling it from the right scope
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
  await enrichIncludedAttributes(context, scopes)

  await runHooks('finish')
  await runHooks('finishQuery')
  await filterToOneResponseLinkage(context, scopes)

  // Enrichers and finish hooks run after the database pass and may introduce
  // native values. Reassert the public temporal contract at the return boundary.
  context.record = normalizeRecordAttributes(context.record, scopes, {
    source: 'response'
  })
  filterResponseFields(context.record, context.queryParams.fields)

  if (context.simplified) {
    return transformJsonApiToSimplified(
      { record: context.record },
      { context: { schemaStructure, schemaRelationships, scopes } }
    )
  }

  return context.record
}
