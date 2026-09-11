import { it } from 'node:test'
import assert from 'node:assert/strict'
import { getRequestedComputedFields, isNonDatabaseField } from '../plugins/core/lib/querying-writing/knex-field-helpers.js'

it('selects computed fields with default and explicit visibility, preserving request order', () => {
  const fields = Object.assign(Object.create({ inherited: {} }), {
    visible: {}, optional: { normallyHidden: true }, secret: { hidden: true }
  })
  assert.deepEqual(getRequestedComputedFields('items', null, fields), ['visible'])
  assert.deepEqual(getRequestedComputedFields('items', 'optional,secret,visible,inherited,missing', fields), ['optional', 'visible'])
  assert.deepEqual(getRequestedComputedFields('items', ['visible', 'visible'], fields), ['visible', 'visible'])
  assert.deepEqual(getRequestedComputedFields('items', [], fields), [])
  assert.deepEqual(getRequestedComputedFields('items', null, undefined), [])
})

it('resolves a sparse computed selection without scanning unrelated definitions', () => {
  const definitions = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`field${index}`, {}]))
  let enumerations = 0
  let reads = 0
  const fields = new Proxy(definitions, {
    ownKeys (target) { enumerations++; return Reflect.ownKeys(target) },
    get (target, key, receiver) { reads++; return Reflect.get(target, key, receiver) }
  })
  assert.deepEqual(getRequestedComputedFields('items', ['field199', 'missing'], fields), ['field199'])
  assert.deepEqual({ enumerations, reads }, { enumerations: 0, reads: 1 })
})

it('rejects an absent compiled computed definition while retaining missing-field absence', () => {
  assert.throws(() => getRequestedComputedFields('items', ['broken'], { broken: undefined }), /Missing compiled computed definition 'items.broken'/)
  assert.equal(isNonDatabaseField('missing', {}), undefined)
  assert.equal(isNonDatabaseField('virtual', { schemaStructure: { virtual: { virtual: true } } }), true)
})
