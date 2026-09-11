// @ts-check
/** @import { StorageQuery, QueryFilteringState } from '../storage/storage-types.js' */

/**
 * @param {unknown} value
 * @param {unknown} [fallback]
 * @returns {unknown} Hook values are untrusted until the caller validates them.
 */
export const unwrapQueryBuilderState = (value, fallback = null) => {
  let current = value
  const seen = new Set()

  while (
    current &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    Object.hasOwn(current, 'query') &&
    /** @type {{ query?: unknown }} */ (current).query &&
    /** @type {{ query?: unknown }} */ (current).query !== current &&
    !seen.has(current)
  ) {
    seen.add(current)
    current = /** @type {{ query?: unknown }} */ (current).query
  }

  return current || fallback
}

/**
 * @param {{ knexQuery?: QueryFilteringState | null }} context
 * @param {QueryFilteringState & { query: StorageQuery }} state
 * @param {() => unknown | Promise<unknown>} applyFilters
 * @returns {Promise<{ query: StorageQuery }>}
 */
// Return a wrapper: resolving an async function with a Knex builder executes it.
export async function withQueryFilteringContext (context, state, applyFilters) {
  const query = state.query
  const previousKnexQuery = context.knexQuery
  context.knexQuery = state
  try {
    await applyFilters()
    return { query: context.knexQuery?.query || query }
  } finally {
    if (previousKnexQuery === undefined) delete context.knexQuery
    else context.knexQuery = previousKnexQuery
  }
}
