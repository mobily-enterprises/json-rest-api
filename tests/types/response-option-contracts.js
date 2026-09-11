// @ts-check
import { rejectRemovedOptions, resolveFormat, resolveReturning } from '../../plugins/core/lib/querying-writing/response-options.js'

/** @import { ResourceFormat, WriteReturning } from '../../types/representations.js' */

// Unknown input and fallback configuration are validated at runtime.
/** @param {unknown} input @param {unknown} fallback */
export function checkResponseOptions (input, fallback) {
  /** @type {ResourceFormat} */
  const format = resolveFormat(input, fallback)
  /** @type {WriteReturning} */
  const returning = resolveReturning(input, fallback)
  rejectRemovedOptions({ format, returning })
  rejectRemovedOptions({ format: resolveFormat(), returning: resolveReturning() })
  if (input && typeof input === 'object') rejectRemovedOptions(input)

  /** @type {'plain'} */
  // @ts-expect-error An unvalidated input may select either supported format.
  const assumedPlain = resolveFormat(input)
  /** @type {WriteReturning} */
  // @ts-expect-error Formats and returning modes are separate contracts.
  const swapped = format
  /** @type {boolean} */
  // @ts-expect-error Resolving a returning mode does not produce a boolean.
  const oldReturning = returning
  // @ts-expect-error Unknown input must be narrowed to an options object first.
  rejectRemovedOptions(input)
  // @ts-expect-error Options are not nullable.
  rejectRemovedOptions(null)
  // @ts-expect-error Validation does not return replacement options.
  rejectRemovedOptions({ format }).format.toString()
  return { assumedPlain, swapped, oldReturning }
}
