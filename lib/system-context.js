// @ts-check

// Module-private: only createSystemContext can attach the marker. Object spread
// copies it, so contexts the library derives from a system context stay system.
const systemMarker = Symbol('jsonRestApiSystemContext')
const marker = Object.freeze({})

/**
 * A context for population-wide work, such as background jobs. Ownership
 * predicates (autofilter) are skipped for it, row policies receive
 * `system: true`, and creates must name their ownership values explicitly.
 * Request input cannot produce one: the marker is a private symbol.
 * @param {string} reason Why this work may see every owner's rows; shown in diagnostics
 * @param {Record<string, unknown>} [values] Extra context fields for hooks and policies
 */
export function createSystemContext (reason, values = {}) {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new TypeError('createSystemContext needs a reason: a non-empty string naming the work')
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('createSystemContext values must be an object')
  }
  return { ...values, system: true, systemReason: reason, [systemMarker]: marker }
}

/** @param {unknown} context */
export function isSystemContext (context) {
  return context !== null && typeof context === 'object' && /** @type {Record<symbol, unknown>} */ (context)[systemMarker] === marker
}

/**
 * A context claiming `system: true` without the marker was not made by
 * createSystemContext; trusting it would let a copied flag skip ownership.
 * @param {unknown} context
 */
export function assertGenuineSystemFlag (context) {
  if (context !== null && typeof context === 'object' && /** @type {{ system?: unknown }} */ (context).system === true && !isSystemContext(context)) {
    const error = new Error('context.system is set, but the context was not created by createSystemContext')
    Object.assign(error, { code: 'REST_API_SYSTEM_CONTEXT_FORGED' })
    throw error
  }
}
