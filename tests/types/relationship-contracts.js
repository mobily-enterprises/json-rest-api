// @ts-check
import { findRelationshipDefinition, getPolymorphicLinkage, getRelationshipCardinality, validateRelationshipDataCardinality } from '../../plugins/core/lib/querying-writing/relationship-contracts.js'

/** @param {unknown} storedType @param {unknown} storedId */
export function checkRelationshipContracts (storedType, storedId) {
  const input = { type: storedType, id: storedId, types: ['groups'], relationshipName: 'subject' }
  const linkage = getPolymorphicLinkage(input)
  if (linkage) {
    linkage.type.toUpperCase()
    linkage.id.toUpperCase()
  }
  const found = findRelationshipDefinition({ outputRelationships: { groups: { type: 'manyToMany', target: 'groups', through: 'memberships' } } }, 'groups')
  if (found) found.through.toUpperCase()
  const cardinality = getRelationshipCardinality(found)
  /** @type {'one' | 'many' | null} */
  const selected = cardinality
  validateRelationshipDataCardinality({ relationshipName: 'groups', relDef: found, data: storedId })
  getRelationshipCardinality()
  getRelationshipCardinality(null)

  // @ts-expect-error Stored absence produces null linkage.
  getPolymorphicLinkage(input).id.toUpperCase()
  // @ts-expect-error Declared target resource names must be strings.
  getPolymorphicLinkage({ ...input, types: [42] })
  // @ts-expect-error Diagnostic resource names are optional strings.
  getPolymorphicLinkage({ ...input, scopeName: 42 })
  // @ts-expect-error Unknown metadata keys may have no relationship definition.
  findRelationshipDefinition({ outputRelationships: { groups: { type: 'hasMany' } } }, 'missing').type.toUpperCase()
  // @ts-expect-error Relationship lookup names are strings.
  findRelationshipDefinition({ outputRelationships: {} }, 42)
  /** @type {boolean} */
  // @ts-expect-error Cardinality is a nullable discriminator, not a boolean.
  const assumedBoolean = getRelationshipCardinality({ type: 'hasOne' })
  // @ts-expect-error Validation reports invalid shapes by throwing, not returning data.
  validateRelationshipDataCardinality({ relationshipName: 'groups', data: storedId }).id.toString()
  return { selected, assumedBoolean }
}
