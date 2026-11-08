// @ts-check
/** @import { MandatoryQueryConstraint, StorageAdapter, StorageQuery } from '../storage/storage-types.js' */
import { databaseFamily } from '../querying-writing/database-capabilities.js'

// Mandatory selection is independent of public search fields and caller filters.
export const queryConstraint = Symbol('queryConstraint')

/**
 * Whether a read of `scopeName` is of rows the caller's transaction has locked
 * (the constraint's `locked`), on MySQL or MariaDB. Their plain reads keep a
 * REPEATABLE READ transaction's first snapshot, so such a read is a locking
 * read: it sees the rows as locked, including any committed after the snapshot.
 * PostgreSQL's plain and locking reads see the same rows; SQLite has one writer.
 * @param {{ [queryConstraint]?: MandatoryQueryConstraint }} context
 * @param {string} scopeName
 * @param {import('knex').Knex} db
 */
export const readsLockedRows = (context, scopeName, db) => {
  const constraint = context[queryConstraint]
  return Boolean(constraint?.locked) && constraint?.scopeName === scopeName && databaseFamily(db) === 'mysql'
}

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

// Ownership values a scope filter applied to a read, by resource and field: the
// owner a write of the rows read must still match. The by-id UPDATE, DELETE and
// lock statements, single or many-row, repeat them as plain column predicates,
// so a row that moved to another owner after the read is neither written nor
// locked.
export const writeConditions = Symbol('writeConditions')
// A condition value meaning "any owner but not the shared (NULL) rows".
export const ANY_OWNER = Symbol('anyOwner')

/**
 * @param {{ [writeConditions]?: Record<string, Record<string, unknown>> }} context
 * @param {string} scopeName
 * @param {string} field
 * @param {unknown} value
 */
export function recordWriteCondition (context, scopeName, field, value) {
  const byScope = context[writeConditions] ||= {}
  byScope[scopeName] ||= {}
  byScope[scopeName][field] = value
}

/**
 * @param {{ [writeConditions]?: Record<string, Record<string, unknown>> }} context
 * @param {string} scopeName
 */
export const hasWriteConditions = (context, scopeName) => Object.keys(context[writeConditions]?.[scopeName] || {}).length > 0

/**
 * @param {object} options
 * @param {StorageQuery} options.query
 * @param {{ [writeConditions]?: Record<string, Record<string, unknown>> }} options.context
 * @param {string} options.scopeName
 * @param {StorageAdapter} options.storageAdapter
 * @param {string} options.tableName
 */
export function applyWriteConditions ({ query, context, scopeName, storageAdapter, tableName }) {
  for (const [field, value] of Object.entries(context[writeConditions]?.[scopeName] || {})) {
    const column = `${tableName}.${storageAdapter.translateColumn(field)}`
    if (value === ANY_OWNER) query.whereNotNull(column)
    else if (value === null) query.whereNull(column)
    else query.where(column, value)
  }
  return query
}
