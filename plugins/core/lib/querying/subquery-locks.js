// @ts-check
// A lock read's deciding rows. The locking read itself (lockByIds, lockWhere)
// reads its own table's latest committed rows, but a SELECT nested in its
// conditions (a row policy's whereExists or whereIn, a filter's, any filtering
// hook's) is a plain read unless it carries a lock clause too: on MySQL and
// MariaDB under REPEATABLE READ it answers from the transaction's snapshot,
// fixed at its first plain read, so the lock would decide visibility from
// membership or grant rows as they were then. So every such SELECT, at any
// depth (in a join's ON clause too), takes FOR SHARE (LOCK IN SHARE MODE on
// MySQL and MariaDB): a locking
// read of the rows the decision reads, which reads them as last committed,
// waits for a transaction that is changing them, and keeps them unchanged
// until the transaction ends. Shared, not exclusive: two lock reads that read
// the same membership row both go on, while a writer of the row waits.
//
// The lock is added to compile-time copies: a builder the conditions name (a
// read-only view's builder too) is cloned, and a callback is wrapped so the
// builder Knex builds for it at compile time takes the lock. Nothing the
// caller or a policy holds is changed. A subquery written as raw SQL text
// keeps its text. SQLite has no row locks: nothing changes there.
import { databaseFamily } from '../querying-writing/database-capabilities.js'
import { readOnlyViewTarget } from './read-only-query.js'

/** @param {unknown} value */
const isBuilder = value => value !== null && typeof value === 'object' &&
  typeof /** @type {any} */ (value).toSQL === 'function' && typeof /** @type {any} */ (value).where === 'function'

/** @param {unknown} value */
const isRaw = value => value !== null && typeof value === 'object' && /** @type {any} */ (value).isRawInstance === true

// PostgreSQL refuses a lock clause on a SELECT that groups or combines rows,
// and on the nullable side of an outer join; MySQL and MariaDB refuse one on a
// set operation's last SELECT.
const COMBINES = new Set(['union'])
const GROUPS = new Set(['group', 'having'])
const AGGREGATE_COLUMNS = new Set(['aggregate', 'aggregateRaw', 'analytic'])
/** @param {any} statement */
const outerJoin = statement => statement.grouping === 'join' && /left|right|full|outer/.test(String(statement.joinType))

/**
 * Whether `family` takes a lock clause on this SELECT. One it refuses stays a
 * plain read; the SELECTs nested in its conditions still take theirs.
 * @param {any} builder @param {string} family
 */
function lockable (builder, family) {
  return !builder._statements.some(/** @param {any} statement */ statement => COMBINES.has(statement.grouping) || (family === 'pg' && (
    GROUPS.has(statement.grouping) || outerJoin(statement) ||
    (statement.grouping === 'columns' && (statement.distinct || statement.distinctOn || AGGREGATE_COLUMNS.has(statement.type)))
  )))
}

/**
 * A plain copy of a builder the conditions name, with the lock: a read-only
 * view's builder is copied, never the view, which refuses lock calls.
 * @param {any} builder @param {string} family
 */
function lockedCopy (builder, family) {
  let plain = builder
  for (let viewed = readOnlyViewTarget(plain); viewed; viewed = readOnlyViewTarget(plain)) plain = viewed
  const copy = plain.clone()
  lockSelect(copy, family)
  return copy
}

/**
 * Locks a SELECT this module owns (a copy, or the builder Knex built for a
 * callback): its own lock clause unless it already has one, then every
 * SELECT nested in its conditions and its FROM and JOIN sources.
 * @param {any} builder @param {string} family
 */
function lockSelect (builder, family) {
  if (!builder._single.lock && lockable(builder, family)) builder.forShare()
  if (isBuilder(builder._single.table)) builder._single = { ...builder._single, table: lockedCopy(builder._single.table, family) }
  lockNested(builder, family)
}

/**
 * Replaces each condition statement of `builder` (owned by this module or the
 * lock read) that holds a SELECT with a copy that locks it; join sources, the
 * SELECTs in a join's ON clause and common table expressions likewise.
 * @param {any} builder @param {string} family
 */
function lockNested (builder, family) {
  const statements = builder._statements
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.grouping === 'where') {
      statements[index] = lockedCondition(statement, family)
    } else if (statement.grouping === 'join') {
      const table = isBuilder(statement.table) ? lockedCopy(statement.table, family) : statement.table
      const clauses = lockedClauses(statement.clauses, family)
      if (table !== statement.table || clauses !== statement.clauses) {
        statements[index] = Object.assign(Object.create(Object.getPrototypeOf(statement)), statement, { table, clauses })
      }
    } else if (statement.grouping === 'with') {
      statements[index] = { ...statement, value: lockedValue(statement.value, family) }
    }
  }
}

/**
 * A join's ON clauses with their SELECTs locked (onExists, a subquery in onIn
 * or a comparison, a raw clause's bound builders), at any depth of
 * parenthesised groups; the clauses themselves when they hold none.
 * @param {any[] | undefined} clauses @param {string} family
 * @returns {any[] | undefined}
 */
function lockedClauses (clauses, family) {
  if (!Array.isArray(clauses)) return clauses
  const locked = clauses.map(clause => lockedClause(clause, family))
  return locked.some((clause, index) => clause !== clauses[index]) ? locked : clauses
}

/** @param {any} clause @param {string} family */
function lockedClause (clause, family) {
  const { value } = clause
  if (clause.type === 'onWrapped' && typeof value === 'function') {
    // A parenthesised group: Knex calls it on a join clause of its own at
    // compile time, whose clauses then take the lock.
    return {
      ...clause,
      /** @this {any} */
      value: function lockedOnGroup (/** @type {unknown[]} */ ...args) {
        const result = value.apply(this, args)
        this.clauses = lockedClauses(this.clauses, family)
        return result
      }
    }
  }
  const locked = lockedValue(value, family)
  return locked === value ? clause : { ...clause, value: locked }
}

/**
 * A where statement whose SELECTs take the lock; the statement itself when it holds none.
 * @param {any} statement @param {string} family
 */
function lockedCondition (statement, family) {
  const { value } = statement
  if (statement.type === 'whereWrapped' && typeof value === 'function') {
    // A parenthesised group: Knex builds a builder for its predicates alone,
    // whose own lock clause it never compiles. Its nested SELECTs take theirs.
    return {
      ...statement,
      /** @this {any} */
      value: function lockedGroup (/** @type {unknown[]} */ ...args) {
        const result = value.apply(this, args)
        lockNested(this, family)
        return result
      }
    }
  }
  const locked = lockedValue(value, family)
  return locked === value ? statement : { ...statement, value: locked }
}

/**
 * A value Knex compiles as a SELECT (a builder, a callback, a raw expression's
 * bound builders), copied with the lock; any other value as it is.
 * @param {unknown} value @param {string} family
 * @returns {any}
 */
function lockedValue (value, family) {
  if (typeof value === 'function') {
    /** @this {any} */
    return function lockedSubquery (/** @type {unknown[]} */ ...args) {
      const result = value.apply(this, args)
      lockSelect(this, family)
      return result
    }
  }
  if (isBuilder(value)) return lockedCopy(value, family)
  if (isRaw(value)) {
    const raw = /** @type {any} */ (value)
    /** @type {unknown} */
    const bindings = raw.bindings
    if (Array.isArray(bindings)) {
      const locked = bindings.map(binding => lockedValue(binding, family))
      return locked.some((binding, index) => binding !== bindings[index]) ? rawWith(raw, locked) : value
    }
    if (bindings && typeof bindings === 'object') {
      const named = /** @type {Record<string, unknown>} */ (bindings)
      /** @type {Record<string, unknown>} */
      const locked = Object.fromEntries(Object.entries(named).map(([key, binding]) => [key, lockedValue(binding, family)]))
      return Object.keys(named).some(key => locked[key] !== named[key]) ? rawWith(raw, locked) : value
    }
  }
  return value
}

/**
 * A copy of a raw expression with other bindings.
 * @param {any} raw @param {unknown} bindings
 */
const rawWith = (raw, bindings) => Object.assign(Object.create(Object.getPrototypeOf(raw)), raw, { bindings })

/**
 * Makes every SELECT nested in a lock read's conditions take FOR SHARE (see
 * the top of this file). `query` is the lock read's own builder, built for
 * this read; its statements are replaced, never edited.
 * @param {any} query
 * @param {import('knex').Knex} db
 */
export function lockConditionSubqueries (query, db) {
  const family = databaseFamily(db)
  if (family === 'sqlite') return query
  lockNested(query, family)
  return query
}
