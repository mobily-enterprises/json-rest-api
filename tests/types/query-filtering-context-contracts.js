// @ts-check
import { unwrapQueryBuilderState, withQueryFilteringContext } from '../../plugins/core/lib/querying/query-builder-utils.js'
import checkPermissionsMethod from '../../plugins/core/rest-api-plugin-methods/check-permissions.js'
/** @import { StorageDatabase, QueryFilteringState } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageDatabase} database */
export async function checkQueryFilteringContracts (database) {
  /** @type {{ knexQuery?: QueryFilteringState | null }} */
  const context = {}
  const result = await withQueryFilteringContext(context, {
    query: database('items'),
    scopeName: 'items',
    db: database,
    queryPurpose: 'collection'
  }, async () => {
    context.knexQuery = { query: database('items').where({ active: true }) }
  })
  result.query.clone().limit(10)
  // @ts-expect-error The helper returns a wrapper, not materialized rows.
  result.map(() => 0)
  // @ts-expect-error A query builder must not be replaced with its executed rows.
  context.knexQuery = { query: await database('items') }
  // @ts-expect-error Entering filtering requires a builder, even if hooks may clear it.
  await withQueryFilteringContext(context, {}, () => {})
  // @ts-expect-error The filter callback is deferred, not an already-started Promise.
  await withQueryFilteringContext(context, { query: database('items') }, Promise.resolve())
  // @ts-expect-error Hook unwrapping does not establish a trusted builder type.
  unwrapQueryBuilderState({ query: 42 }).where({ id: 1 })
  context.knexQuery = { query: null }
  delete context.knexQuery

  const originalContext = { method: 'query', scopeName: 'items', knexQuery: { query: database('items') } }
  const permissionRequest = { context: {}, runHooks: () => {} }
  await checkPermissionsMethod({ ...permissionRequest, params: { method: 'query', originalContext } })
  // @ts-expect-error Permission wrappers must identify their originating operation.
  await checkPermissionsMethod({ ...permissionRequest, params: { method: 'query' } })
  // @ts-expect-error Permission methods are operation names, not numeric identifiers.
  await checkPermissionsMethod({ ...permissionRequest, params: { method: 1, originalContext } })
  // @ts-expect-error The operation carries a filtering envelope, not a bare builder.
  await checkPermissionsMethod({ ...permissionRequest, params: { method: 'query', originalContext: { knexQuery: database('items') } } })
}
