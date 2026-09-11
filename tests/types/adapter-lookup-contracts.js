// @ts-check
import { createStorageAdapterLookup } from '../../plugins/core/lib/storage/storage-adapter.js'
/** @import { StorageDatabase, StorageResource } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageDatabase} knex @param {StorageResource} resource */
export function checkAdapterLookup (knex, resource) {
  const lookup = createStorageAdapterLookup({ knex, getResource: () => resource })
  const adapter = lookup('items')
  if (adapter) adapter.translateColumn('name').toUpperCase()
  // @ts-expect-error Resource names are strings.
  lookup(1)
  // @ts-expect-error Lookup resolves a current resource synchronously.
  createStorageAdapterLookup({ knex, getResource: async () => resource })
  // @ts-expect-error Resource metadata must include a valid storage schema shape.
  createStorageAdapterLookup({ knex, getResource: () => ({ vars: { schemaInfo: { tableName: 'items' } } }) })
  // @ts-expect-error Missing resources return null, not an adapter.
  lookup('missing').getTableName()
}
