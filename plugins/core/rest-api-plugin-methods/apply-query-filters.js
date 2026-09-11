// @ts-check
/** @import { QueryFilteringState, StorageAdapter, StorageSchemaInfo } from '../lib/storage/storage-types.js' */

/**
 * @typedef {object} FilteringContext
 * @property {QueryFilteringState | null} [knexQuery]
 * @property {StorageAdapter} [storageAdapter]
 * @property {Record<string, unknown>} [queryParams]
 */

import { withQueryFilteringContext } from '../lib/querying/query-builder-utils.js'

/**
 * @param {object} request
 * @param {FilteringContext} request.context
 * @param {QueryFilteringState} [request.params]
 * @param {(name: 'knexQueryFiltering') => unknown | Promise<unknown>} request.runHooks
 * @param {{ vars: { schemaInfo: StorageSchemaInfo }, checkPermissions: (request: {
 *   method: 'query', originalContext: FilteringContext & {
 *     method: 'query', scopeName: string, schemaInfo: StorageSchemaInfo, id: undefined
 *   }
 * }) => unknown | Promise<unknown> }} request.scope
 * @param {string} request.scopeName
 */
export default async function applyQueryFiltersMethod ({ context, params = {}, runHooks, scope, scopeName }) {
  const { query, filters, storageAdapter, ...knexQuery } = params

  if (!query) {
    return query
  }

  const previousStorageAdapter = context.storageAdapter

  const queryState = {
    query,
    filters,
    storageAdapter,
    adapter: storageAdapter,
    ...knexQuery
  }

  if (storageAdapter) {
    context.storageAdapter = storageAdapter
  }

  try {
    return await withQueryFilteringContext(context, queryState, async () => {
      if (['include', 'relationship-identifiers', 'search-join'].includes(params.queryPurpose || '')) {
        await scope.checkPermissions({
          method: 'query',
          originalContext: {
            ...context,
            method: 'query',
            scopeName,
            schemaInfo: scope.vars.schemaInfo,
            id: undefined,
            queryParams: { ...context.queryParams, filters: filters || {} }
          }
        })
      }
      await runHooks('knexQueryFiltering')
    })
  } finally {
    if (previousStorageAdapter === undefined) {
      delete context.storageAdapter
    } else {
      context.storageAdapter = previousStorageAdapter
    }
  }
}
