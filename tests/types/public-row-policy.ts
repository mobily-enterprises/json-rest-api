import type { ResourceRowPolicy, RowPolicy, RowPolicyPluginOptions, RowPolicyRegistry } from '../../types/row-policy.js'
import { createStorageAdapterUtilities } from '../../plugins/core/lib/querying/storage-adapter-utils.js'

interface Context { userId: string }
const policy: RowPolicy<Context> = ({ query, context, column, value }) => {
  const ownerId = value('owner_id', context.userId)
  if (typeof ownerId !== 'string') throw new TypeError('Expected a serialized string ID')
  query.where(column('owner_id'), ownerId)
  query.whereNotNull(column('id', { scopeName: 'users', alias: null }))
  return true
}
const options: RowPolicyPluginOptions<Context> = { policies: { owner: policy, denied: async () => false } }
const inline: ResourceRowPolicy<Context> = policy
const named: ResourceRowPolicy = 'owner'
const disabled: ResourceRowPolicy = false
declare const registry: RowPolicyRegistry
const config = registry.getScopeConfig('users')
if (config) { const source: 'inline' | 'registry' = config.source; void source }
const utils = createStorageAdapterUtilities({})
const unqualified: string = utils.translateColumn('users', 'id', null)
void [options, inline, named, disabled, unqualified]

// @ts-expect-error A policy must explicitly allow or deny after applying its predicate.
const missingDecision: RowPolicy = () => {}
// @ts-expect-error A query builder is not an allow/deny decision.
const returnedQuery: RowPolicy = ({ query }) => query
// @ts-expect-error Registry entries must be policies, not policy names.
const invalidRegistry: RowPolicyPluginOptions = { policies: { owner: 'owner' } }
// @ts-expect-error True is a policy result, not resource policy configuration.
const enabled: ResourceRowPolicy = true
const invalidAlias: RowPolicy = ({ column }) => {
  // @ts-expect-error Alias is a string or null for deliberately unqualified columns.
  column('id', { alias: false })
  return true
}
void [missingDecision, returnedQuery, invalidRegistry, enabled, invalidAlias]
