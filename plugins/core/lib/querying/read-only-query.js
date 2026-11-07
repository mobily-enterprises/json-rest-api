// @ts-check
import { RestApiScopedQueryReadOnlyError } from '../../../../lib/rest-api-errors.js'

// Calls that write, lock, change the source table or drop the scope predicates.
const FORBIDDEN_METHODS = new Set([
  'insert', 'update', 'del', 'delete', 'truncate', 'upsert', 'increment', 'decrement',
  'onConflict', 'merge', 'ignore', 'returning',
  'forUpdate', 'forShare', 'forNoKeyUpdate', 'forKeyShare', 'skipLocked', 'noWait',
  'from', 'table', 'into', 'withSchema', 'clear', 'clearWhere'
])
// The statement kinds a SELECT-only builder may run.
const READ_METHODS = new Set(['select', 'first', 'pluck'])

/** @param {unknown} value */
const isQueryBuilder = value => value !== null && typeof value === 'object' &&
  typeof /** @type {{ toSQL?: unknown }} */ (value).toSQL === 'function' &&
  typeof /** @type {{ where?: unknown }} */ (value).where === 'function'

/**
 * A SELECT-only view of a Knex query builder. Reads, joins, subqueries and
 * execution work as usual; writes, row locks and calls that change the source
 * table or clear its predicates throw RestApiScopedQueryReadOnlyError. Builders
 * it returns, including clones, are read-only too.
 * @template {object} Builder
 * @param {Builder} builder
 * @param {{ resourceType?: string }} [options]
 * @returns {Builder}
 */
export function readOnlyQueryBuilder (builder, { resourceType = 'query' } = {}) {
  if (!isQueryBuilder(builder)) throw new TypeError('readOnlyQueryBuilder needs a Knex query builder')
  /** @type {Builder} */
  const proxy = new Proxy(builder, {
    get (target, property, receiver) {
      if (typeof property === 'string' && FORBIDDEN_METHODS.has(property)) {
        return () => { throw new RestApiScopedQueryReadOnlyError({ resourceType, method: property }) }
      }
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function' || property === 'constructor') return value
      return /** @this {unknown} */ function (/** @type {unknown[]} */ ...args) {
        // Knex methods return `this`, which is the proxy; new builders get wrapped.
        const result = value.apply(this === undefined ? receiver : this, args)
        return result !== receiver && result !== target && isQueryBuilder(result)
          ? readOnlyQueryBuilder(result, { resourceType })
          : result
      }
    },
    set (target, property, value) {
      if (property === '_method' && !READ_METHODS.has(value)) {
        throw new RestApiScopedQueryReadOnlyError({ resourceType, method: String(value) })
      }
      return Reflect.set(target, property, value)
    }
  })
  return proxy
}
