// @ts-check
// MariaDB rewrites an IN list of in_predicate_conversion_threshold values or
// more (1,000 by default; 0 turns it off) as a join with a table of its values
// when their type is the column's (integers against an integer column). A
// locking read rewritten so is planned as that join: it can look rows up
// through the leading columns of a key and examine, and lock, every row they
// match, as a lock of the current revisions of 1,000 records, by record and
// revision number, then holds every revision of those records. A shorter list
// stays a list, which the range optimizer reads as ranges on the whole key.
//
// So a locking read on MariaDB sends a longer list as an OR of lists below the
// server's threshold: the same rows, in one statement, read as one set of
// ranges. getDatabaseInfo reads the threshold as the API starts, or at the first
// call that reaches a database the start could not.

/** @type {WeakMap<object, number>} each MariaDB connection configuration's longest IN list kept as a list */
const longestLists = new WeakMap()

/** @typedef {{ client: { config: object } }} Connected a Knex instance, a transaction or a query builder */

/**
 * Records the server's in_predicate_conversion_threshold for `db` and its
 * transactions, which share its connection configuration.
 * @param {Connected} db
 * @param {number} threshold
 */
export function rememberInPredicateConversionThreshold (db, threshold) {
  if (Number.isSafeInteger(threshold) && threshold > 0) longestLists.set(db.client.config, Math.max(1, threshold - 1))
}

/**
 * The most values one IN list of a locking read on `db` holds: one fewer than
 * MariaDB's threshold, and no limit elsewhere (MySQL keeps every IN list a list).
 * @param {Connected} db
 */
export const inListLimit = db => longestLists.get(db.client.config) ?? Infinity

/**
 * Sends each IN list of `query`'s own conditions longer than inListLimit(db),
 * a list of rows of values (a tuple IN) by its values, as an OR of shorter
 * lists, in parenthesised groups too; a NOT IN as the matching AND. A list in a
 * SELECT nested in the conditions stays as it is. Returns `query`.
 * @param {any} query
 * @param {Connected} db
 */
export function splitLongInLists (query, db) {
  const limit = inListLimit(db)
  if (limit !== Infinity) splitStatements(query, limit)
  return query
}

/** @param {any} builder @param {number} limit */
function splitStatements (builder, limit) {
  const statements = builder._statements
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.grouping !== 'where') continue
    if (statement.type === 'whereIn' && Array.isArray(statement.value)) {
      const width = Array.isArray(statement.column) ? statement.column.length : 1
      if (statement.value.length * width > limit) statements[index] = splitList(statement, Math.max(1, Math.floor(limit / width)))
    } else if (statement.type === 'whereWrapped' && typeof statement.value === 'function') {
      // Knex calls a group on a builder of its own as it compiles the query.
      const group = statement.value
      statements[index] = {
        ...statement,
        /** @this {any} */
        value: function splitGroup (/** @type {unknown[]} */ ...args) {
          const result = group.apply(this, args)
          splitStatements(this, limit)
          return result
        }
      }
    }
  }
}

/**
 * One IN statement as a group of lists of at most `size` values each.
 * @param {any} statement @param {number} size
 */
function splitList (statement, size) {
  const { column, value } = statement
  /** @type {unknown[][]} */
  const parts = []
  for (let start = 0; start < value.length; start += size) parts.push(value.slice(start, start + size))
  return {
    grouping: 'where',
    type: 'whereWrapped',
    bool: statement.bool,
    not: statement.not,
    /** @this {any} */
    value () {
      for (const part of parts) this.orWhereIn(column, part)
    }
  }
}
