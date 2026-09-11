// @ts-check
import { buildQuerySelection } from '../../plugins/core/lib/querying/knex-query-helpers-base.js'
/** @import { StorageDatabase } from '../../plugins/core/lib/storage/storage-types.js' */

/** @param {StorageDatabase} db */
export function checkQuerySelectionContracts (db) {
  const query = db('items')
  buildQuerySelection(query, 'items', Object.freeze(['name']), false, { translateColumn: () => null }).where('id', '1')
  buildQuerySelection(query, 'items', '*', false, { translateColumn: () => undefined })
  buildQuerySelection(query, 'items', ['name'], true, { translateColumn: () => ({ name: db.raw('?', ['value']) }) })
  // @ts-expect-error A result array is not an unexecuted query builder.
  buildQuerySelection([], 'items', ['name'])
  // @ts-expect-error Logical fields are strings.
  buildQuerySelection(query, 'items', [1])
  // @ts-expect-error Selection translators cannot return promises.
  buildQuerySelection(query, 'items', ['name'], false, { translateColumn: async () => 'name' })
  // @ts-expect-error The alias is null when table prefixing is disabled.
  buildQuerySelection(query, 'items', ['name'], false, { translateColumn: (field, alias) => alias.toUpperCase() })
  // @ts-expect-error Mapping values are SQL expressions or column references, not data values.
  buildQuerySelection(query, 'items', ['name'], false, { translateColumn: () => ({ name: 1 }) })
}
