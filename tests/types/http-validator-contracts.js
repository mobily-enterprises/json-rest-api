// @ts-check
import { createStrongEntityTag, matchesIfMatch, parseIfMatch } from '../../plugins/core/connectors/lib/http-validators.js'
/** @import { EntityTag, IfMatchCondition } from '../../plugins/core/connectors/lib/http-validators.js' */

/** @param {unknown} header */
export function checkHttpValidatorContracts (header) {
  const parsed = parseIfMatch(header)
  const text = createStrongEntityTag('{"data":null}')
  createStrongEntityTag(Buffer.from(text), { contentType: 'application/vnd.api+json', contentEncoding: 'identity' })
  /** @type {EntityTag} */
  const tag = { weak: false, value: 'opaque' }
  /** @type {IfMatchCondition} */
  const list = { wildcard: false, tags: [tag] }
  matchesIfMatch(parsed, { exists: true, tag })
  matchesIfMatch(list, { exists: false })
  matchesIfMatch({ wildcard: true, tags: [] }, { exists: true })

  // @ts-expect-error Hashing requires already serialized representation bytes.
  createStrongEntityTag({ data: null })
  // @ts-expect-error Representation metadata is textual.
  createStrongEntityTag(text, { contentEncoding: ['gzip'] })
  // @ts-expect-error A representation must state whether it exists.
  matchesIfMatch(parsed, { tag })
  // @ts-expect-error Wildcards cannot be combined with entity tags.
  matchesIfMatch({ wildcard: true, tags: [tag] }, { exists: true })
  // @ts-expect-error Tags contain an explicit boolean weakness marker.
  matchesIfMatch(list, { exists: true, tag: { weak: 'W/', value: 'opaque' } })
  // @ts-expect-error Parsed conditions must be narrowed before accessing their members.
  parsed.tags.at(0)
  // @ts-expect-error Consumers cannot mutate a parsed tag through its contract.
  tag.value = 'changed'
}
