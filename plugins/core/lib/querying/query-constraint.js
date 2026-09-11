// @ts-check
/** @import { StorageAdapter, StorageQuery, StorageRow } from '../storage/storage-types.js' */

/**
 * @typedef {object} MandatoryQueryConstraint
 * @property {string} scopeName
 * @property {StorageRow} [values]
 * @property {StorageQuery} [idsQuery]
 */

// Mandatory selection is independent of public search fields and caller filters.
export const queryConstraint = Symbol('queryConstraint')

/**
 * @param {object} options
 * @param {StorageQuery} options.query
 * @param {{ [queryConstraint]?: MandatoryQueryConstraint }} options.context
 * @param {string} options.scopeName
 * @param {StorageAdapter} options.storageAdapter
 * @param {string} options.tableName
 */
export function applyQueryConstraint ({ query, context, scopeName, storageAdapter, tableName }) {
  const constraint = context[queryConstraint]
  if (!constraint || constraint.scopeName !== scopeName) return

  if (constraint.idsQuery) {
    query.whereIn(`${tableName}.${storageAdapter.getIdColumn()}`, constraint.idsQuery)
  }
  for (const [field, value] of Object.entries(constraint.values || {})) {
    query.where({
      [`${tableName}.${storageAdapter.translateColumn(field)}`]: storageAdapter.translateFilterValue(field, value)
    })
  }
}
