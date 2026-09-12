// @ts-check
/** @import {
 * IdentityContext, LifecycleArguments, ReadContext, Resource
 * } from './lifecycle-types.js' */
import { enrichIncludedAttributes } from './enrich-attributes.js'
import { rejectRemovedOptions, resolveFormat } from '../lib/querying-writing/response-options.js'
import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { filterResponseFields, getResourceFieldset } from '../lib/querying-writing/field-utils.js'
import { getRequestedComputedFields, validateRequestedFieldsets } from '../lib/querying-writing/knex-field-helpers.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { requireExistingResourceId } from '../lib/querying-writing/resource-id-normalization.js'
import { validateRequestedIncludes, filterToOneResponseLinkage } from './common.js'

/**
 * Read one resource using params.id and params.queryParams. Missing resources
 * reject; the final resource uses the selected plain or JSON:API representation.
 * @param {LifecycleArguments<Resource>} args
 */
export default async function getMethod ({
  params,
  context: callerContext,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  scopeOptions,
  scopeName,
  api
}) {
  callerContext.method = 'get'

  rejectRemovedOptions(params)
  callerContext.format = resolveFormat(params.format, vars.format)
  callerContext.simplified = callerContext.format === 'plain'

  callerContext.schemaInfo = scope.vars.schemaInfo
  const rawQueryParams = params.queryParams || {}
  callerContext.queryParams = {
    fields: rawQueryParams?.fields ?? {},
    ...(rawQueryParams.include == null ? {} : { include: rawQueryParams.include })
  }

  callerContext.transaction = params.transaction
  callerContext.db = callerContext.transaction || api.knex.instance

  callerContext.scopeName = scopeName
  const context = /** @type {ReadContext<Resource>} */ (callerContext)

  const schemaStructure = context.schemaInfo.schemaInstance.structure
  const schemaRelationships = context.schemaInfo.schemaRelationships

  const requestContracts = getRequestContracts({
    scopeName,
    schemaInfo: context.schemaInfo,
    includeDepthLimit: vars.includeDepthLimit,
    sortableFields: vars.sortableFields
  })
  const normalizedId = requireExistingResourceId(params.id, {
    scopeOptions,
    vars,
    scopeName
  })
  const validatedRequest = validateRequestContractOrThrow(
    requestContracts.get,
    {
      id: normalizedId,
      queryParams: context.queryParams
    },
    'GET request parameters are invalid'
  )

  context.id = validatedRequest.id
  context.queryParams = validatedRequest.queryParams || {}

  const identityContext = /** @type {IdentityContext} */ (context)

  // Fetch minimal record for authorization checks
  const minimalRecord = await helpers.dataGetMinimal({
    scopeName,
    context: identityContext,
    runHooks
  })

  if (!minimalRecord) {
    throw new RestApiResourceError(
      'Resource not found',
      {
        subtype: 'not_found',
        resourceType: scopeName,
        resourceId: context.id
      }
    )
  }

  context.minimalRecord = minimalRecord

  await scope.checkPermissions({
    method: 'get',
    originalContext: context,
  })

  await validateRequestedFieldsets(context, scopes)
  validateRequestedIncludes(context, scopes)
  await runHooks('beforeData')
  await runHooks('beforeDataGet')

  context.record = await helpers.dataGet({
    scopeName,
    context: identityContext,
    runHooks
  })

  if (!context.record || !context.record.data) {
    throw new RestApiResourceError(
      'Resource not found',
      {
        subtype: 'not_found',
        resourceType: scopeName,
        resourceId: context.id
      }
    )
  }

  context.record = normalizeRecordAttributes(context.record, scopes)

  await runHooks('checkDataPermissions')
  await runHooks('checkDataPermissionsGet')

  context.originalRecord = structuredClone(context.record)

  await runHooks('enrichRecord')

  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedFields = getResourceFieldset(context.queryParams.fields, scopeName)
  const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields)

  context.record.data.attributes = await scope.enrichAttributes({
    id: context.record.data.id,
    attributes: context.record.data.attributes,
    parentContext: context,
    requestedComputedFields,
    isMainResource: true,
    computedDependencies: context.computedDependencies
  })

  await enrichIncludedAttributes(context, scopes)

  await runHooks('enrichRecordWithRelationships')

  await runHooks('finish')
  await runHooks('finishGet')
  await filterToOneResponseLinkage(context, scopes)

  // Enrichers and finish hooks run after the database pass and may introduce
  // native values. Reassert the public temporal contract at the return boundary.
  context.record = normalizeRecordAttributes(context.record, scopes, {
    source: 'response'
  })
  filterResponseFields(context.record, context.queryParams.fields)

  context.schemaInfo = scope.vars.schemaInfo

  if (context.simplified) {
    return transformJsonApiToSimplified(
      { record: context.record },
      { context: { schemaStructure, schemaRelationships, scopes } }
    )
  }

  return context.record
}
