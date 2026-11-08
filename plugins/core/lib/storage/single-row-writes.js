// @ts-check
// Single patch, put and delete find their row with a scoped read first, on
// table and AnyAPI storage alike. Their UPDATE or DELETE repeats the owner that
// read recorded, and its own row count tells whether the row has gone or moved
// to another owner since.
import { RestApiResourceError } from '../../../../lib/rest-api-errors.js'
import { ERROR_SUBTYPES } from '../querying-writing/knex-constants.js'
import { applyWriteConditions } from '../querying/query-constraint.js'
import { countsMatchedRows } from './many-row-data-helpers.js'

/**
 * @param {string} scopeName
 * @param {string | number} id
 */
const resourceNotFound = (scopeName, id) => new RestApiResourceError('Resource not found', {
  subtype: ERROR_SUBTYPES.NOT_FOUND,
  resourceType: scopeName,
  resourceId: id
})

/**
 * The row a single write found with its scoped read: `byId` looks it up, and
 * the owner that read recorded is added, so a row that has gone or moved to
 * another owner since is not matched.
 * @param {{ byId: () => any, context: any, scopeName: string, storageAdapter: import('./storage-types.js').StorageAdapter, tableName: string }} target
 * @returns {() => any}
 */
export const foundRow = ({ byId, context, scopeName, storageAdapter, tableName }) => () =>
  applyWriteConditions({ query: byId(), context, scopeName, storageAdapter, tableName })

/**
 * Locks the row a single write found; not found when it has gone or moved.
 * @param {() => any} row
 * @param {{ scopeName: string, id: string | number, idColumn: string }} target
 */
export async function lockFoundRow (row, { scopeName, id, idColumn }) {
  if (!await row().select(idColumn).forUpdate().first()) throw resourceNotFound(scopeName, id)
}

/**
 * Updates the row a single write found, or, with nothing stored to change,
 * locks it. Not found when it has gone or moved.
 * @param {() => any} row
 * @param {{ db: any, scopeName: string, id: string | number, idColumn: string, values: Record<string, unknown> }} update
 * @returns {Promise<number>} The rows the UPDATE counted
 */
export async function updateFoundRow (row, { db, scopeName, id, idColumn, values }) {
  if (!Object.keys(values).length) {
    await lockFoundRow(row, { scopeName, id, idColumn })
    return 0
  }
  const counted = await row().update(values)
  if (counted) return counted
  // MySQL without FOUND_ROWS counts the rows an UPDATE changed: an unchanged row counts zero.
  if (await countsMatchedRows(db)) throw resourceNotFound(scopeName, id)
  await lockFoundRow(row, { scopeName, id, idColumn })
  return 0
}

/**
 * Deletes the row a single write found. A DELETE counts the rows it removed,
 * FOUND_ROWS or not; not found when it is gone.
 * @param {() => any} row
 * @param {{ scopeName: string, id: string | number }} target
 * @returns {Promise<number>}
 */
export async function deleteFoundRow (row, { scopeName, id }) {
  const deleted = await row().delete()
  if (!deleted) throw resourceNotFound(scopeName, id)
  return deleted
}
