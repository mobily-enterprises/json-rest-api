// @ts-check
import { normalizeStableSort, parseSortEntry } from '../../plugins/core/lib/querying/sort-helpers.js'

// Compiled only; normalization deliberately accepts unknown input and narrows it.
/** @param {unknown} input */
export function checkSortContracts (input) {
  const fields = normalizeStableSort(input, { idField: 'recordId' })
  const descriptors = fields.map(parseSortEntry)
  for (const descriptor of descriptors) {
    descriptor.field.toUpperCase()
    /** @type {'asc' | 'desc'} */
    const direction = descriptor.direction
    /** @type {'ASC' | 'DESC'} */
    const sqlDirection = descriptor.sqlDirection
    if (direction === 'desc') sqlDirection.toLowerCase()
  }
  // @ts-expect-error Identifier fields must be names.
  normalizeStableSort(input, { idField: 1 })
  // @ts-expect-error The parser consumes a normalized string entry.
  parseSortEntry(1)
  // @ts-expect-error Normalized entries cannot include numeric fields.
  fields.push(1)
  /** @type {'asc' | 'desc'} */
  // @ts-expect-error SQL direction spelling is distinct from logical direction spelling.
  const invalidDirection = parseSortEntry('id').sqlDirection
  return { descriptors, invalidDirection }
}
