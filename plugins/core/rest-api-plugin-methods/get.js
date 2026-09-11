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
 */
export default async function getMethod ({
  params,
  context,
  vars,
  helpers,
  scope,
  scopes,
  runHooks,
  scopeOptions,
  scopeName,
  api
}) {
  context.method = 'get'

  rejectRemovedOptions(params)
  context.format = resolveFormat(params.format, vars.format)
  context.simplified = context.format === 'plain'

  // Assign common context properties
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  const rawQueryParams = params.queryParams || {}
  context.queryParams = {
    fields: rawQueryParams?.fields ?? {},
    ...(rawQueryParams.include == null ? {} : { include: rawQueryParams.include })
  }

  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  context.scopeName = scopeName

  // These are just shortcuts used in this function and will be returned
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

  // Fetch minimal record for authorization checks
  const minimalRecord = await helpers.dataGetMinimal({
    scopeName,
    context,
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

  // Centralised checkPermissions function
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
    context,
    runHooks
  })

  // Check if record was found - storage layer returns null/undefined for non-existent records.
  // This generates a proper 404 error with JSON:API error format instead of returning empty data.
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

  // Normalize database values (e.g., convert 1/0 to true/false for booleans)
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

  // Get schema info for transformation
  context.schemaInfo = scopes[scopeName].vars.schemaInfo

  if (context.simplified) {
    return transformJsonApiToSimplified(
      { record: context.record },
      { context: { schemaStructure, schemaRelationships, scopes } }
    )
  }

  return context.record
}
