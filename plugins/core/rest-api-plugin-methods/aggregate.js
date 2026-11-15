import { getRequestContracts, validateRequestContractOrThrow } from '../lib/querying-writing/request-contracts.js'
import { getEffectiveSortableFields } from '../lib/querying/query-field-sort-helpers.js'
import { compileAggregateRequest } from '../lib/querying/aggregate-query.js'
import { isSystemContext } from '../../../lib/system-context.js'
import { RestApiBulkWriteUnsupportedError, RestApiValidationError } from '../../../lib/rest-api-errors.js'
import { requireLockTransaction, resolveLockMode } from './many-row-common.js'

/**
 * Group a filtered collection and compute measures for each group.
 * Filters are validated like query filters; permissions are checked as a
 * query, and row policies and autofilters see queryPurpose 'aggregate'.
 * Returns plain rows in either format; grouped results are paged.
 * With `lockMode` (inside a transaction, without groupBy) the totals are read
 * with that row lock on the rows they read, held until the transaction ends,
 * in the scope of a lock read (see dataLockAggregate): hooks see lock: true,
 * and row policies queryPurpose 'lock'.
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
    maxLimit: vars.queryMaxLimit,
    system: isSystemContext(context)
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
  const lockMode = params.lockMode === undefined ? null : lockedAggregate({ params, plan, helpers, scopeName })

  context.transaction = params.transaction
  context.db = context.transaction || api.knex.instance

  if (lockMode) {
    context.lock = true
    await scope.checkPermissions({ method: 'query', originalContext: context })
    return helpers.dataLockAggregate({ scopeName, context, runHooks, plan, lockMode })
  }
  await scope.checkPermissions({ method: 'query', originalContext: context })
  return helpers.dataAggregate({ scopeName, context, runHooks, plan })
}

/**
 * The lock mode of a locking aggregate, refused before any statement: outside
 * a transaction, with groupBy (a locking aggregate is one row of totals), or
 * on a storage without row locks.
 * @param {{ params: Record<string, any>, plan: { groups: unknown[] }, helpers: Record<string, any>, scopeName: string }} request
 */
function lockedAggregate ({ params, plan, helpers, scopeName }) {
  requireLockTransaction({ transaction: params.transaction, scopeName, operation: 'aggregate' })
  const lockMode = resolveLockMode(params.lockMode, 'aggregate')
  if (plan.groups.length) {
    const message = `aggregate on '${scopeName}' with lockMode reads one row of totals and takes no groupBy: total each group with a measure's where ` +
      "(for example { open: { count: '*', where: { status: 'open' } } }), or lock the rows themselves with lockWhere"
    throw new RestApiValidationError(message, { fields: ['groupBy'], violations: [{ field: 'groupBy', rule: 'lock_aggregate_group', message }] })
  }
  if (typeof helpers.dataLockAggregate !== 'function') {
    throw new RestApiBulkWriteUnsupportedError({ resourceType: scopeName, operation: 'aggregate with lockMode', reason: 'its storage plugin has no row locks (AnyAPI storage has none)' })
  }
  return lockMode
}
