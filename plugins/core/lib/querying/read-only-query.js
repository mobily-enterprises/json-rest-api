// @ts-check
import { RestApiScopedQueryReadOnlyError } from '../../../../lib/rest-api-errors.js'

// Calls that write, lock, change the source table, clear its predicates, or
// add rows from outside the scope (common table expressions and set operations).
const FORBIDDEN_METHODS = new Set([
  'insert', 'update', 'del', 'delete', 'truncate', 'upsert', 'increment', 'decrement',
  'onConflict', 'merge', 'ignore', 'returning',
  'forUpdate', 'forShare', 'forNoKeyUpdate', 'forKeyShare', 'skipLocked', 'noWait',
  'from', 'fromRaw', 'table', 'into', 'withSchema', 'clear', 'clearWhere',
  'with', 'withRecursive', 'withMaterialized', 'withNotMaterialized', 'withWrapped',
  'union', 'unionAll', 'intersect', 'except'
])
// The statement kinds a SELECT-only builder may run.
const READ_METHODS = new Set(['select', 'first', 'pluck'])

/** @param {unknown} value */
const isQueryBuilder = value => value !== null && typeof value === 'object' &&
  typeof /** @type {{ toSQL?: unknown }} */ (value).toSQL === 'function' &&
  typeof /** @type {{ where?: unknown }} */ (value).where === 'function'

// Knex's own methods reach the client and replace the statement lists through
// `this`; code outside them may not. One counter serves every builder because a
// method of one builder can compile another (a subquery) through its client.
let insideBuilderMethod = 0
// The compiled query's state, which only Knex's own methods may replace.
const BUILDER_STATE = new Set(['client', '_single', '_statements'])

// Outside Knex's methods the statement lists read as frozen copies, so code
// cannot push, splice or edit a predicate in place. Each copied statement keeps
// its prototype: a join is a JoinClause, whose `grouping: 'join'` lives on the
// prototype, and a plain builder compiling this one as a subquery (whereExists,
// whereIn, a joined or from-subquery) reads the copies, so a plain-object copy
// dropped every join from the SQL. The single values (table, limit, offset and
// the like) read as a plain copy: Knex's SQLite compiler rewrites the copy's
// limit when it compiles the builder as a subquery, and a change to the copy
// reaches no query.
/** @param {object} entry */
const statementCopy = entry => Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(entry)), entry))
/** @param {unknown} value */
const stateCopy = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(entry => entry && typeof entry === 'object' ? statementCopy(entry) : entry))
  return value && typeof value === 'object' ? { ...value } : value
}

/**
 * A SELECT-only view of a Knex query builder. Reads, joins, subqueries and
 * execution work as usual; writes, row locks, set operations, common table
 * expressions, calls that change the source table or clear its predicates, and
 * access to the Knex client throw RestApiScopedQueryReadOnlyError. Builders it
 * returns, including clones, are read-only too. It guards against mistakes, not
 * hostile code: code that means to bypass it can use Knex directly.
 * @template {object} Builder
 * @param {Builder} builder
 * @param {{ resourceType?: string }} [options]
 * @returns {Builder}
 */
export function readOnlyQueryBuilder (builder, { resourceType = 'query' } = {}) {
  if (!isQueryBuilder(builder)) throw new TypeError('readOnlyQueryBuilder needs a Knex query builder')
  /** @param {string} method @returns {never} */
  const refuse = method => { throw new RestApiScopedQueryReadOnlyError({ resourceType, method }) }
  /** @type {Builder} */
  const proxy = new Proxy(builder, {
    get (target, property, receiver) {
      if (typeof property === 'string' && FORBIDDEN_METHODS.has(property)) return () => refuse(property)
      if (property === 'client' && !insideBuilderMethod) refuse('client')
      const value = Reflect.get(target, property, receiver)
      if ((property === '_single' || property === '_statements') && !insideBuilderMethod) return stateCopy(value)
      if (typeof value !== 'function' || property === 'constructor') return value
      return /** @this {unknown} */ function (/** @type {unknown[]} */ ...args) {
        insideBuilderMethod++
        let result
        try {
          // Knex methods return `this`, which is the proxy; new builders get wrapped.
          result = value.apply(this === undefined ? receiver : this, args)
        } finally {
          insideBuilderMethod--
        }
        return result !== receiver && result !== target && isQueryBuilder(result)
          ? readOnlyQueryBuilder(result, { resourceType })
          : result
      }
    },
    set (target, property, value) {
      if (property === '_method' && !READ_METHODS.has(value)) refuse(String(value))
      if (property === 'client' || (BUILDER_STATE.has(String(property)) && !insideBuilderMethod)) refuse(`set ${String(property)}`)
      return Reflect.set(target, property, value)
    },
    defineProperty (_target, property) { return refuse(`defineProperty ${String(property)}`) },
    // Deletes follow the rules of set: lodash's isPlainObject, which Knex's MySQL
    // compiler runs on a subquery value, sets and then deletes Symbol.toStringTag.
    deleteProperty (target, property) {
      if (property === 'client' || property === '_method' || (BUILDER_STATE.has(String(property)) && !insideBuilderMethod)) refuse(`delete ${String(property)}`)
      return Reflect.deleteProperty(target, property)
    }
  })
  return proxy
}
