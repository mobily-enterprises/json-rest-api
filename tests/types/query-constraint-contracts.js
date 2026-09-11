// @ts-check
import { applyQueryConstraint, queryConstraint } from '../../plugins/core/lib/querying/query-constraint.js'
/** @import { StorageAdapter, StorageQuery } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageAdapter} storageAdapter @param {StorageQuery} query */
export function checkQueryConstraintContracts (storageAdapter, query) {
  const options = { query, storageAdapter, scopeName: 'items', tableName: 'items' }
  applyQueryConstraint({ ...options, context: {} })
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { scopeName: 'items', values: { ownerId: '1', discriminator: null } } } })
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { scopeName: 'items', idsQuery: query.clone().select('id') } } })
  // @ts-expect-error Membership targets must identify their resource.
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { values: { id: '1' } } } })
  // @ts-expect-error Subqueries must remain builders, not executed rows.
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { scopeName: 'items', idsQuery: [{ id: '1' }] } } })
  // @ts-expect-error A promise is not an unexecuted membership builder.
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { scopeName: 'items', idsQuery: Promise.resolve([]) } } })
  // @ts-expect-error Mandatory values are a logical field/value map.
  applyQueryConstraint({ ...options, context: { [queryConstraint]: { scopeName: 'items', values: ['1'] } } })
  // @ts-expect-error Scope identifiers are strings.
  applyQueryConstraint({ ...options, scopeName: 1, context: {} })
  // @ts-expect-error Translation requires the existing storage adapter contract.
  applyQueryConstraint({ ...options, storageAdapter: {}, context: {} })
}
