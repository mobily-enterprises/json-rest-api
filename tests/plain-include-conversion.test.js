import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { transformJsonApiToSimplified, transformSingleJsonApiToSimplified } from '../plugins/core/lib/querying-writing/simplified-helpers.js'

const identifier = (type, id) => ({ type, id })
const resource = (type, id, attributes = {}, relationships = {}) => ({ type, id, attributes, relationships })
const link = data => ({ data })
const convert = (record, schemaRelationships = {}, scopes = {}) => transformJsonApiToSimplified({ record }, {
  context: { schemaRelationships, scopes }
})

describe('Plain include graph conversion', () => {
  it('expands repeated siblings fully and ends cycles with identifiers', () => {
    const a = resource('nodes', 'a', { name: 'A' }, { first: link(identifier('nodes', 'b')), second: link(identifier('nodes', 'b')) })
    const b = resource('nodes', 'b', { name: 'B' }, { parent: link(identifier('nodes', 'a')), child: link(identifier('nodes', 'c')) })
    const c = resource('nodes', 'c', { name: 'C' })
    const result = convert({ data: a, included: [b, c] })
    const expected = { id: 'b', name: 'B', parent: { id: 'a' }, child: { id: 'c', name: 'C' } }
    assert.deepEqual(result, { id: 'a', name: 'A', first: expected, second: expected })
    assert.notEqual(result.first, result.second)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  })

  it('preserves identifiers without included records in partially expanded collections', () => {
    const a = resource('groups', '1', {}, { items: link([identifier('items', '1'), identifier('items', '2')]) })
    const b = resource('items', '1', { name: 'Expanded' })
    assert.deepEqual(convert({ data: a, included: [b] }), { id: '1', items: [{ id: '1', name: 'Expanded' }, { id: '2' }] })
  })

  it('preserves to-one leaf identifiers and empty to-many relationships', () => {
    const a = resource('items', '0', {}, { parent: link(identifier('groups', '0')), children: link([]), missing: link(null) })
    assert.deepEqual(convert({ data: a }), { id: '0', parent: { id: '0' }, children: [] })
  })

  it('keeps polymorphic types on nested expansions and cycle references', () => {
    const a = resource('notes', '1', {}, { subject: link(identifier('groups', '1')) })
    const b = resource('groups', '1', { name: 'Group' }, { subject: link(identifier('notes', '1')) })
    const relationships = { subject: { belongsToPolymorphic: { types: ['notes', 'groups'] } } }
    const scopes = { groups: { vars: { schemaInfo: { schemaRelationships: relationships } } } }
    assert.deepEqual(convert({ data: a, included: [b] }, relationships, scopes), {
      id: '1', subject: { id: '1', _type: 'groups', name: 'Group', subject: { id: '1', _type: 'notes' } }
    })
  })

  it('starts a separate traversal for each primary collection record and preserves envelopes', () => {
    const a = resource('nodes', 'a', { name: 'A' }, { peer: link(identifier('nodes', 'b')) })
    const b = resource('nodes', 'b', { name: 'B' }, { peer: link(identifier('nodes', 'a')) })
    const document = { data: [a, b], meta: { total: 2 }, links: { self: '/nodes' } }
    assert.deepEqual(convert(document), {
      data: [
        { id: 'a', name: 'A', peer: { id: 'b', name: 'B', peer: { id: 'a' } } },
        { id: 'b', name: 'B', peer: { id: 'a', name: 'A', peer: { id: 'b' } } }
      ],
      meta: { total: 2 },
      links: { self: '/nodes' }
    })
    assert.deepEqual(document.data[0].relationships.peer.data, { type: 'nodes', id: 'b' })
  })

  it('keeps the first included record when an identity is repeated', () => {
    const parent = resource('groups', '1', {}, { item: link(identifier('items', '1')) })
    assert.deepEqual(convert({ data: parent, included: [resource('items', '1', { name: 'First' }), resource('items', '1', { name: 'Second' })] }), {
      id: '1', item: { id: '1', name: 'First' }
    })
  })

  it('keeps delimiter-containing types and IDs separate', () => {
    const parent = resource('groups', '1', {}, { first: link(identifier('a:b', 'c')), second: link(identifier('a', 'b:c')) })
    assert.deepEqual(convert({ data: parent, included: [resource('a:b', 'c', { name: 'First' }), resource('a', 'b:c', { name: 'Second' })] }), {
      id: '1', first: { id: 'c', name: 'First' }, second: { id: 'b:c', name: 'Second' }
    })
  })

  it('matches IDs without coercing numbers into strings or special object keys', () => {
    const ids = [1, '1', '__proto__', 'constructor']
    const parent = resource('groups', '1', {}, { items: link(ids.map(id => identifier('__proto__', id))) })
    assert.deepEqual(convert({ data: parent, included: ids.map((id, index) => resource('__proto__', id, { name: `Item ${index}` })) }).items,
      ids.map((id, index) => ({ id, name: `Item ${index}` })))
  })

  it('does not retain an index across conversions when the included array changes', () => {
    const parent = resource('groups', '1', {}, { item: link(identifier('items', '1')) })
    const included = [resource('items', '1', { name: 'First' })]
    assert.equal(convert({ data: parent, included }).item.name, 'First')
    included[0] = resource('items', '1', { name: 'Replacement' })
    assert.equal(convert({ data: parent, included }).item.name, 'Replacement')
    included.length = 0
    assert.deepEqual(convert({ data: parent, included }).item, { id: '1' })
  })

  it('preserves missing or null included data and empty primary envelopes', () => {
    const parent = resource('groups', '1', {}, { item: link(identifier('items', '1')) })
    for (const included of [undefined, null, []]) assert.deepEqual(convert({ data: parent, included }), { id: '1', item: { id: '1' } })
    const empty = { data: null, meta: { empty: true } }
    assert.equal(convert(empty), empty)
    assert.deepEqual(convert({ data: [], meta: { total: 0 } }), { data: [], meta: { total: 0 } })
  })

  it('keeps direct single-resource calls and caller-supplied ancestors independent', () => {
    const data = resource('groups', '1', {}, { item: link(identifier('items', '1')) })
    const included = [resource('items', '1', { name: 'Item' })]
    const ancestors = new Set([JSON.stringify(['items', '1'])])
    assert.deepEqual(transformSingleJsonApiToSimplified({ data, included }, { context: {} }, ancestors), { id: '1', item: { id: '1' } })
    assert.deepEqual([...ancestors], [JSON.stringify(['items', '1'])])
    assert.equal(transformSingleJsonApiToSimplified({ data, included }, { context: {} }).item.name, 'Item')
  })

  for (const collection of [false, true]) {
    it(`bounds identity lookup work for a large ${collection ? 'primary collection' : 'relationship collection'}`, () => {
      const size = 1000
      let identityReads = 0
      const included = Array.from({ length: size }, (_, index) => ({
        get type () { identityReads++; return 'items' }, id: String(index + 1), attributes: { name: `Item ${index + 1}` }
      }))
      const data = collection
        ? Array.from({ length: size }, (_, index) => resource('groups', String(index + 1), {}, { item: link(identifier('items', String(index + 1))) }))
        : resource('groups', '1', {}, { items: link(included.map(row => identifier('items', row.id))) })
      const result = convert({ data, included })
      const children = collection ? result.data.map(row => row.item) : result.items
      assert.deepEqual(children, Array.from({ length: size }, (_, index) => ({ id: String(index + 1), name: `Item ${index + 1}` })))
      assert.ok(identityReads <= size * 8, `identity reads (${identityReads}) must grow with input/output size, not their product`)
    })
  }
})
