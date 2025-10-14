import { RestApiResourceError } from '../../../lib/rest-api-errors.js'
import { validateGetPayload } from '../lib/querying-writing/payload-validators.js'
import { normalizeRecordAttributes } from '../lib/querying-writing/database-value-normalizers.js'
import { getRequestedComputedFields } from '../lib/querying-writing/knex-field-helpers.js'
import { transformJsonApiToSimplified } from '../lib/querying-writing/simplified-helpers.js'
import { cascadeConfig } from './common.js'

/**
 * GET
 * Retrieves a single resource by its type and ID.
 * @param {(string|number)} id - The unique ID of the resource to fetch.
 * @param {object} [queryParams={}] - Optional. An object to customize the query.
 * @param {string} [queryParams.include] - A comma-separated string of relationship paths to sideload (e.g., "authors,publisher").
 * @param {object} [queryParams.fields] - An object to request only specific fields (sparse fieldsets). Keys are resource types, values are comma-separated field names.
 * @returns {Promise<object>} A Promise that resolves to the JSON:API response document.
 */
export default async function getMethod ({
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
  api
}) {
  context.method = 'get'

  // Determine which simplified setting to use based on transport
  const isTransport = params.isTransport === true

  // Use vars which automatically cascade from scope to global
  const defaultSimplified = isTransport ? vars.simplifiedTransport : vars.simplifiedApi

  // Get simplified setting - from params only (per-call override) or use default
  context.simplified = params.simplified !== undefined ? params.simplified : defaultSimplified

  // Assign common context properties
  context.schemaInfo = scopes[scopeName].vars.schemaInfo
  context.queryParams = params.queryParams || {}

  // These only make sense as parameter per query
  context.queryParams.fields = cascadeConfig('fields', [context.queryParams], {})
  context.queryParams.include = cascadeConfig('include', [context.queryParams], [])

  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  context.scopeName = scopeName

  // These are just shortcuts used in this function and will be returned
  const schemaStructure = context.schemaInfo.schemaInstance.structure
  const schemaRelationships = context.schemaInfo.schemaRelationships

  context.id = params.id

  // Validate GET request to ensure required parameters are present and properly formatted.
  // This checks that 'id' parameter exists and is not empty (you can't GET without an ID),
  // validates 'include' contains valid relationship names (not arbitrary fields), and ensures
  // 'fields' for sparse fieldsets follow the format fields[type]=comma,separated,list.
  // Example: validates id: '123' exists, include: ['author', 'tags'] are real relationships.
  validateGetPayload({ id: context.id, queryParams: context.queryParams }, vars.includeDepthLimit)

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

  // Make a backup
  context.originalRecord = structuredClone(context.record)

  // This will enhance record, which is the WHOLE JSON:API record
  await runHooks('enrichRecord')

  // Get computed field information for main resource
  const computedFields = scope.vars.schemaInfo?.computed || {}
  const requestedFields = context.queryParams.fields?.[scopeName]
  const requestedComputedFields = getRequestedComputedFields(scopeName, requestedFields, computedFields)

  // Enrich attributes for the main resource
  // Pass computedDependencies from context (set by dataGet in Knex plugin)
  // This tells enrichAttributes which fields to remove after computation
  context.record.data.attributes = await scope.enrichAttributes({
    attributes: context.record.data.attributes,
    parentContext: context,
    requestedComputedFields,
    isMainResource: true,
    computedDependencies: context.computedDependencies  // Fields to remove if not requested
  })

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

  await runHooks('enrichRecordWithRelationships')

  // The called hooks should NOT change context.record
  await runHooks('finish')
  await runHooks('finishGet')

  // Get schema info for transformation
  context.schemaInfo = scopes[scopeName].vars.schemaInfo

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
