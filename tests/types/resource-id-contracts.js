// @ts-check
import {
  defaultNormalizeResourceId,
  normalizeResourceId,
  normalizeRelationshipIdentifiers,
  requireDocumentResourceId,
  requireExistingResourceId,
  requireReferencedResourceId,
  resolveResourceIdNormalizer
} from '../../plugins/core/lib/querying-writing/resource-id-normalization.js'

// Compiled by tsc; these assertions are never executed.
/** @param {unknown} input */
export function checkResourceIdContracts (input) {
  const optionalId = defaultNormalizeResourceId(input)
  if (optionalId !== null) optionalId.toUpperCase()
  requireExistingResourceId(input, { scopeName: 'books' }).toUpperCase()
  requireDocumentResourceId(input).toUpperCase()
  normalizeResourceId(42n, { scopeOptions: { normalizeId: value => typeof value === 'bigint' ? value : null } })
  const api = { resources: { books: { scopeOptions: { normalizeId: defaultNormalizeResourceId } } } }
  requireReferencedResourceId('books', input, { api }).toUpperCase()
  normalizeRelationshipIdentifiers([{ type: 'books', id: input }], { api })
  resolveResourceIdNormalizer({ vars: { normalizeId: () => undefined } })(input)

  // @ts-expect-error An optional normalized ID must be narrowed before use.
  defaultNormalizeResourceId(input).toUpperCase()
  // @ts-expect-error Normalizers are synchronous.
  normalizeResourceId(input, { scopeOptions: { normalizeId: async () => '42' } })
  // @ts-expect-error A normalizer must return an ID scalar or absence, not an object.
  resolveResourceIdNormalizer({ vars: { normalizeId: () => ({ id: '42' }) } })
  // @ts-expect-error A callback must accept unvalidated input, not only strings.
  normalizeResourceId(input, { vars: { normalizeId: (/** @type {string} */ value) => value.trim() } })
  // @ts-expect-error Resource lookup names must be strings.
  requireReferencedResourceId(42, input, { api })
  // @ts-expect-error Scope metadata cannot supply a non-callable normalizer.
  requireExistingResourceId(input, { scopeOptions: { normalizeId: true } })
  // @ts-expect-error Relationship normalization does not validate the document shape.
  normalizeRelationshipIdentifiers(input, { api }).id.toString()
  // @ts-expect-error Referenced resource configuration uses the same normalizer contract.
  requireReferencedResourceId('books', input, { api: { resources: { books: { vars: { normalizeId: () => false } } } } })
}
