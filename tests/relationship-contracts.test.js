import { it } from 'node:test'
import assert from 'node:assert/strict'
import { findRelationshipDefinition, getPolymorphicLinkage } from '../plugins/core/lib/querying-writing/relationship-contracts.js'

it('keeps absent polymorphic linkage distinct from a stored zero ID', () => {
  const options = { types: ['groups'], scopeName: 'items', relationshipName: 'subject' }
  for (const value of [null, undefined]) {
    assert.equal(getPolymorphicLinkage({ ...options, type: value, id: 0 }), null)
    assert.equal(getPolymorphicLinkage({ ...options, type: 'groups', id: value }), null)
  }
  assert.deepEqual(getPolymorphicLinkage({ ...options, type: 'groups', id: 0 }), { type: 'groups', id: '0' })
  assert.deepEqual(getPolymorphicLinkage({ ...options, type: 'groups', id: 9007199254740993n }), { type: 'groups', id: '9007199254740993' })
})

it('rejects non-string resource types even if malformed metadata lists that value', () => {
  assert.throws(() => getPolymorphicLinkage({ type: 42, id: '1', types: [42], scopeName: 'items', relationshipName: 'subject' }), error => {
    assert.match(error.message, /Invalid stored relationship 'items.subject'/)
    assert.match(error.cause.message, /Undeclared target type '42'/)
    assert.deepEqual(error.context, { scopeName: 'items', relationshipName: 'subject', phase: 'relationshipData' })
    return true
  })
})

it('supports missing diagnostic resource names without dropping a valid linkage', () => {
  assert.deepEqual(getPolymorphicLinkage({ type: 'groups', id: 1, types: ['groups'], relationshipName: 'subject' }), { type: 'groups', id: '1' })
})

it('returns only owned relationship definitions, preserving their identity', () => {
  const definition = { type: 'manyToMany', target: 'groups', through: 'memberships' }
  const schemaInfo = { outputRelationships: { groups: definition } }
  assert.equal(findRelationshipDefinition(schemaInfo, 'groups'), definition)
  assert.equal(findRelationshipDefinition(schemaInfo, 'constructor'), null)
  assert.equal(findRelationshipDefinition({}, 'groups'), null)
})
