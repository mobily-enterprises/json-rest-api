// @ts-check
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'

/** @import { ResourceFormat, WriteReturning } from '../../../../types/representations.js' */

/** @param {unknown} [value] @param {unknown} [fallback] @returns {ResourceFormat} */
export function resolveFormat (value, fallback = 'plain') {
  const format = value === undefined ? fallback : value
  if (format !== 'plain' && format !== 'jsonapi') {
    throw new RestApiValidationError("format must be 'plain' or 'jsonapi'", { fields: ['format'] })
  }
  return format
}

/** @param {unknown} [value] @param {unknown} [fallback] @returns {WriteReturning} */
export function resolveReturning (value, fallback = 'full') {
  const returning = value === undefined ? fallback : value
  if (returning !== 'none' && returning !== 'minimal' && returning !== 'full') {
    throw new RestApiValidationError("returning must be 'none', 'minimal', or 'full'", { fields: ['returning'] })
  }
  return returning
}

/** @param {object} options @returns {void} */
export function rejectRemovedOptions (options) {
  const fields = ['simplified', 'simplifiedApi', 'simplifiedTransport', 'returnFullRecord', 'returnRecordApi', 'returnRecordTransport', 'isTransport']
    .filter(name => Object.hasOwn(options, name))
  if (fields.length) {
    throw new RestApiValidationError(`Removed options: ${fields.join(', ')}. Use format and returning.`, { fields })
  }
}
