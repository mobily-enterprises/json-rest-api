// @ts-check
import { RestApiScopedQueryReadOnlyError } from '../../../../lib/rest-api-errors.js'
import { databaseFamily } from '../querying-writing/database-capabilities.js'

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

// Each read-only view's builder, for the library's own compile-time copies (a
// lock read's subqueries take a lock: see subquery-locks.js).
/** @type {WeakMap<object, object>} */
const viewedBuilders = new WeakMap()

/**
 * The builder behind a read-only view from readOnlyQueryBuilder, or undefined
 * for any other value. Library-internal: the package does not export it.
 * @param {unknown} value
 * @returns {any}
 */
export const readOnlyViewTarget = value => value !== null && typeof value === 'object' ? viewedBuilders.get(value) : undefined

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

// An index name forceIndex takes: a plain identifier, so a name adds no SQL and
// names no table.
const INDEX_NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/

/** @param {unknown} value */
const isTableName = value => typeof value === 'string' ||
  (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)

/**
 * The plain builder behind a view, through views of views; any other builder as it is.
 * @param {any} builder
 */
const plainOf = builder => {
  let plain = builder
  for (let viewed = viewedBuilders.get(plain); viewed; viewed = viewedBuilders.get(plain)) plain = viewed
  return plain
}

/**
 * A FROM source with FORCE INDEX on the table it reads: a table name's own,
 * or, for a derived table (a scoped query or a join source reads its
 * resource's rows as one), that table's FROM at any depth. A builder it
 * reaches is copied, never changed: a clone of a view shares its derived
 * table. Undefined when the source reads no table by name (raw SQL, or an
 * index hint already set).
 * @param {any} source @param {string[]} names @param {any} client @param {string} resourceType
 * @returns {unknown}
 */
function forcedSource (source, names, client, resourceType) {
  if (isTableName(source)) return client.raw(`?? force index (${names.map(() => '??').join(', ')})`, [source, ...names])
  if (!isQueryBuilder(source)) return undefined
  const plain = plainOf(source)
  const table = forcedSource(plain._single.table, names, client, resourceType)
  if (table === undefined) return undefined
  const copy = plain.clone()
  copy._single = { ...copy._single, table }
  return plain === source ? copy : readOnlyQueryBuilder(copy, { resourceType })
}

/**
 * Sets FORCE INDEX on the table a view's builder reads (see forcedSource), so
 * a locking read that nests the view examines only that index's rows.
 * @param {any} builder the view's own builder @param {unknown[]} names @param {string} resourceType
 */
function forceIndex (builder, names, resourceType) {
  const family = databaseFamily(builder)
  if (family !== 'mysql') {
    throw new TypeError(`forceIndex is MySQL and MariaDB only: ${family === 'pg' ? 'PostgreSQL' : 'SQLite'} has no index hints, and its planner picks the index`)
  }
  if (!names.length || !names.every(name => typeof name === 'string' && INDEX_NAME.test(name))) {
    throw new TypeError('forceIndex takes one or more index names, each a plain identifier: letters, digits, _ and $, at most 64, starting with a letter or _')
  }
  const table = forcedSource(builder._single.table, /** @type {string[]} */ (names), builder.client, resourceType)
  if (table === undefined) {
    throw new TypeError(`forceIndex on '${resourceType}' needs a view that reads a table by name, or a derived table that does, and takes every index in one call`)
  }
  builder._single = { ...builder._single, table }
}

/**
 * A SELECT-only view of a Knex query builder. Reads, joins, subqueries and
 * execution work as usual; writes, row locks, set operations, common table
 * expressions, calls that change the source table or clear its predicates, and
 * access to the Knex client throw RestApiScopedQueryReadOnlyError. Builders it
 * returns, including clones, are read-only too. It guards against mistakes, not
 * hostile code: code that means to bypass it can use Knex directly.
 *
 * On MySQL and MariaDB, `forceIndex(...names)` makes the table the view reads
 * use those indexes (FORCE INDEX), so a locking read that nests the view locks
 * only the rows that index reaches; on a view over a derived table, it hints
 * the table inside. It takes plain index names only, sets the hint once, and
 * throws a TypeError elsewhere.
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
      if (property === 'forceIndex') {
        return (/** @type {unknown[]} */ ...names) => {
          forceIndex(plainOf(target), names, resourceType)
          return receiver
        }
      }
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
  viewedBuilders.set(proxy, builder)
  return proxy
}
