import { it } from 'node:test'
import assert from 'node:assert/strict'
import { filterResponseFields } from '../plugins/core/lib/querying-writing/field-utils.js'

it('selects plain user fields named data and attributes without interpreting them as document members', () => {
  const record = { id: '1', _type: 'items', data: 'User data', attributes: 42, omitted: 'Not selected' }
  filterResponseFields(record, { items: 'data,attributes' }, { simplified: true, resourceType: 'items' })
  assert.deepEqual(record, { id: '1', _type: 'items', data: 'User data', attributes: 42 })
})

it('preserves null JSON:API primary data when a fieldset uses the literal resource name undefined', () => {
  const record = { data: null }
  filterResponseFields(record, { undefined: 'name' })
  assert.deepEqual(record, { data: null })
})

it('retains relationship values by identity while replacing only the selected member map', () => {
  const relationship = { data: { type: 'groups', id: '2' }, meta: { note: 'Retained' } }
  const relationships = { group: relationship, omitted: { data: null } }
  const record = { data: { type: 'items', id: '1', attributes: { name: 'Item', omitted: 'No' }, relationships } }
  filterResponseFields(record, { items: 'name,group' })
  assert.deepEqual(record.data.attributes, { name: 'Item' })
  assert.deepEqual(Object.keys(record.data.relationships), ['group'])
  assert.equal(record.data.relationships.group, relationship)
  assert.notEqual(record.data.relationships, relationships)
  assert.equal(Object.hasOwn(relationships, 'omitted'), true)
})
