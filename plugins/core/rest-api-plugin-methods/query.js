// @ts-check
/** @import {
 * LifecycleArguments, QueryContext, Resource
 * } from './lifecycle-types.js' */
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
 * @param {LifecycleArguments<Resource[]>} args
 */
export default async function queryMethod ({
  params,
  context: callerContext,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  scopeName,
  api
}) {
  callerContext.method = 'query'
  // Nested queries only inherit membership when it is explicitly supplied again.
  callerContext[queryConstraint] = params[queryConstraint]

  rejectRemovedOptions(params)
  callerContext.format = resolveFormat(params.format, vars.format)
  callerContext.simplified = callerContext.format === 'plain'

  callerContext.schemaInfo = scope.vars.schemaInfo // This is the object variable created by compileSchemas
  callerContext.queryParams = params.queryParams || {}

  callerContext.queryParams.fields = params.queryParams?.fields ?? {}
  if (callerContext.queryParams.include == null) delete callerContext.queryParams.include
  callerContext.queryParams.sort = params.queryParams?.sort ?? []
  callerContext.queryParams.page = params.queryParams?.page ?? {}

  callerContext.transaction = params.transaction
  callerContext.db = callerContext.transaction || api.knex.instance

  callerContext.scopeName = scopeName
  const context = /** @type {QueryContext} */ (callerContext)

  const schemaStructure = context.schemaInfo.schemaInstance.structure
  const schemaRelationships = context.schemaInfo.schemaRelationships

  context.sortableFields = getEffectiveSortableFields(vars)
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

  context.record = normalizeRecordAttributes(context.record, scopes)

  context.originalRecord = structuredClone(context.record)

  await runHooks('enrichRecord')

  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedFields = getResourceFieldset(context.queryParams.fields, scopeName)
  const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields)

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
