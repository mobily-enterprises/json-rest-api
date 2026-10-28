import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { getEffectiveSortableFields } from '../lib/querying/query-field-sort-helpers.js'
import { compileAggregateRequest } from '../lib/querying/aggregate-query.js'

/**
 * Group a filtered collection and compute measures for each group.
 * Filters are validated like query filters; permissions are checked as a
 * query, and row policies and autofilters see queryPurpose 'aggregate'.
 * Returns plain rows in either format; grouped results are paged.
 */
export default async function aggregateMethod ({ params, context, vars, helpers, scope, runHooks, scopeName, api }) {
  context.method = 'aggregate'
  context.scopeName = scopeName
  context.schemaInfo = scope.vars.schemaInfo

  const plan = compileAggregateRequest({
    params,
    schemaInfo: context.schemaInfo,
    scopeName,
    defaultLimit: vars.queryDefaultLimit,
    maxLimit: vars.queryMaxLimit
  })
  const requestContracts = getRequestContracts({
    scopeName,
    schemaInfo: context.schemaInfo,
    includeDepthLimit: vars.includeDepthLimit,
    sortableFields: getEffectiveSortableFields(vars)
  })
  const validated = validateRequestContractOrThrow(
    requestContracts.query,
    { queryParams: { filters: params.queryParams?.filters ?? {} } },
    'Aggregate filters are invalid'
  )
  context.queryParams = { filters: validated.queryParams?.filters || {} }

  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  await scope.checkPermissions({ method: 'query', originalContext: context })
  return helpers.dataAggregate({ scopeName, context, runHooks, plan })
}
