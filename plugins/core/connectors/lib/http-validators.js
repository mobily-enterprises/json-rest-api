// @ts-check
/** @typedef {{ readonly weak: boolean, readonly value: string }} EntityTag */
/** @typedef {{ readonly wildcard: true, readonly tags: readonly [] } | { readonly wildcard: false, readonly tags: readonly EntityTag[] }} IfMatchCondition */
import { RestApiValidationError } from '../../../../lib/rest-api-errors.js'
import { createHash } from 'node:crypto'

const MAX_HEADER_LENGTH = 8192
const MAX_LIST_ITEMS = 128
const invalidIfMatch = () => new RestApiValidationError('Invalid or oversized If-Match header', { fields: ['headers.if-match'] })

// Hash serialized bytes only; callers must send these same bytes without reserialization.
/**
 * @param {string | Buffer} body
 * @param {{ contentType?: string, contentEncoding?: string }} [options]
 * @returns {string}
 */
export function createStrongEntityTag (body, { contentType = 'application/vnd.api+json', contentEncoding = 'identity' } = {}) {
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new TypeError('Entity tags require a serialized string or Buffer')
  if (typeof contentType !== 'string' || typeof contentEncoding !== 'string') throw new TypeError('Entity tag representation metadata must be strings')
  const digest = createHash('sha256').update(JSON.stringify([contentType, contentEncoding])).update('\0').update(body).digest('base64url')
  return `"jra1-${digest}"`
}

// Entity tags are opaque octets, not JSON strings: backslashes do not escape quotes.
/** @param {unknown} input @returns {IfMatchCondition | undefined} */
export function parseIfMatch (input) {
  if (input === undefined) return undefined
  /** @type {readonly unknown[]} */
  const lines = Array.isArray(input) ? input : [input]
  if (lines.length > MAX_LIST_ITEMS) throw invalidIfMatch()
  let length = Math.max(0, lines.length - 1)
  for (const line of lines) {
    if (typeof line !== 'string' || (length += line.length) > MAX_HEADER_LENGTH) throw invalidIfMatch()
  }
  const text = lines.join(',')
  if (text.replace(/^[ \t]+|[ \t]+$/g, '') === '*') return { wildcard: true, tags: [] }
  const tags = []
  let position = 0
  let separators = 0
  const whitespace = () => { while (text[position] === ' ' || text[position] === '\t') position++ }
  while (position < text.length) {
    whitespace()
    if (position === text.length) break
    if (text[position] === ',') {
      if (++separators > MAX_LIST_ITEMS) throw invalidIfMatch()
      position++
      continue
    }
    const weak = text.startsWith('W/', position)
    if (weak) position += 2
    if (text[position++] !== '"') throw invalidIfMatch()
    const start = position
    while (position < text.length && text[position] !== '"') {
      const code = text.charCodeAt(position++)
      if (!(code === 0x21 || (code >= 0x23 && code <= 0x7e) || (code >= 0x80 && code <= 0xff))) throw invalidIfMatch()
    }
    if (position === text.length) throw invalidIfMatch()
    tags.push({ weak, value: text.slice(start, position++) })
    if (tags.length > MAX_LIST_ITEMS) throw invalidIfMatch()
    whitespace()
    if (position < text.length && text[position] !== ',') throw invalidIfMatch()
  }
  return { wildcard: false, tags }
}

/**
 * @param {IfMatchCondition | undefined} condition
 * @param {{ exists: boolean, tag?: EntityTag }} representation
 * @returns {boolean}
 */
export function matchesIfMatch (condition, { exists, tag }) {
  if (condition === undefined) return true
  if (!exists) return false
  if (condition.wildcard) return true
  if (!tag || tag.weak) return false
  return condition.tags.some(candidate => !candidate.weak && candidate.value === tag.value)
}
