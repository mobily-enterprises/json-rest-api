import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { addType, createSchema, createSchemaFactory } from 'json-rest-schema'
import { validateCursorValues } from '../plugins/core/lib/querying/query-field-sort-helpers.js'
import { normalizeAttributes } from '../plugins/core/lib/querying-writing/database-value-normalizers.js'

const schema = createSchema({})
const validate = (definition, value, { field = 'sortValue', isRelationship = false, owner = schema, parameter = 'after' } = {}) =>
  validateCursorValues([{ field, definition, isRelationship }], { [field]: value }, parameter, owner)[field]

describe('Cursor scalar validation contracts', () => {
  it('keeps each validation result independent after successful and rejected calls', () => {
    const descriptors = [{ field: 'rank', definition: { type: 'number' } }, { field: 'id', definition: { type: 'id' } }]
    for (let index = 0; index < 3; index++) {
      const input = { rank: '12.5', id: 'opaque:id' }
      const first = validateCursorValues(descriptors, input, 'after', schema)
      assert.deepEqual({ ...first }, { rank: 12.5, id: 'opaque:id' })
      first.rank = 999
      assert.throws(() => validateCursorValues(descriptors, { rank: 'invalid', id: 'other' }, 'before', schema), error => {
        assert.equal(error.code, 'REST_API_VALIDATION')
        assert.deepEqual(error.details.fields, ['page.before'])
        assert.equal(error.details.violations[0].rule, 'invalid_cursor_value')
        return true
      })
      const second = validateCursorValues(descriptors, { rank: null, id: 'another' }, 'after', schema)
      assert.deepEqual({ ...second }, { rank: null, id: 'another' })
      assert.deepEqual(input, { rank: '12.5', id: 'opaque:id' })
    }
  })

  it('distinguishes nullable sort values from required logical IDs and preserves spaces', () => {
    for (let index = 0; index < 2; index++) {
      assert.equal(validate({ type: 'string' }, '  key  '), '  key  ')
      assert.equal(validate({ type: 'id' }, 'opaque:id', { isRelationship: true }), 'opaque:id')
      assert.equal(validate({ type: 'id' }, null, { isRelationship: true }), null)
      for (const value of [null, '', '   ', undefined]) {
        assert.throws(() => validate({ type: 'id' }, value, { field: 'id' }), { code: 'REST_API_VALIDATION' })
      }
      assert.equal(validate({ type: 'id' }, '  opaque  ', { field: 'id' }), '  opaque  ')
    }
  })

  it('uses current descriptor types and precision without sharing incompatible contracts', () => {
    for (let index = 0; index < 2; index++) {
      assert.equal(validate({ type: 'number' }, '42'), 42)
      assert.equal(validate({ type: 'string' }, '42'), '42')
      assert.equal(validate({ type: 'boolean' }, 'false'), false)
      assert.equal(validate({ type: 'dateTime', temporalPrecision: 6 }, '2024-02-29T12:34:56.123456Z'), '2024-02-29T12:34:56.123456Z')
      assert.throws(() => validate({ type: 'dateTime', temporalPrecision: 3 }, '2024-02-29T12:34:56.123456Z'), { code: 'REST_API_VALIDATION' })
      assert.equal(validate({ type: 'time' }, '12:34:56.1234567'), '12:34:56.1234567')
      assert.throws(() => validate({ type: 'time', temporalPrecision: 0 }, '12:34:56.1'), { code: 'REST_API_VALIDATION' })
      assert.equal(validate({ type: 'time', temporalPrecision: 0 }, '12:34:56'), '12:34:56')
      assert.equal(validate({ type: 'date' }, '2024-02-29'), '2024-02-29')
      assert.throws(() => validate({ type: 'date' }, '2023-02-29'), { code: 'REST_API_VALIDATION' })
    }
  })

  it('ignores absent and inherited cursor entries without reusing previous values', () => {
    const descriptors = [{ field: 'rank', definition: { type: 'number' } }]
    validateCursorValues(descriptors, { rank: 1 }, 'after', schema)
    assert.deepEqual({ ...validateCursorValues(descriptors, {}, 'after', schema) }, {})
    assert.deepEqual({ ...validateCursorValues(descriptors, Object.create({ rank: 'invalid' }), 'after', schema) }, {})
  })

  it('keeps captured type handlers consistent with the owning compiled schema', () => {
    const type = 'cursorContractWord'
    addType(type, ({ value }) => `first:${value}`)
    const first = createSchema({ field: { type } })
    assert.equal(validate({ type }, 'one', { owner: first }), 'first:one')
    addType(type, ({ value }) => `second:${value}`)
    const second = createSchema({ field: { type } })
    for (let index = 0; index < 3; index++) {
      assert.equal(validate({ type }, 'two', { owner: first }), 'first:two')
      assert.equal(validate({ type }, 'two', { owner: second }), 'second:two')
    }
  })

  it('uses captured handlers even when the first cursor follows a registry change', () => {
    const type = 'cursorContractColdWord'
    addType(type, ({ value }) => `before:${value}`)
    const before = createSchema({ field: { type } })
    addType(type, ({ value }) => `after:${value}`)
    const after = createSchema({ field: { type } })
    assert.equal(validate({ type }, 'word', { owner: before }), 'before:word')
    assert.equal(validate({ type }, 'word', { owner: after }), 'after:word')
  })

  it('retains each compiled schema’s validators as well as its type handlers', () => {
    const factory = createSchemaFactory()
    factory.addValidator('nullable', context => {
      if (context.value === 'first') context.throwParamError('REJECTED', 'First rule')
    })
    const first = factory({})
    factory.addValidator('nullable', context => {
      if (context.value === 'second') context.throwParamError('REJECTED', 'Second rule')
    })
    const second = factory({})
    for (let index = 0; index < 2; index++) {
      assert.throws(() => validate({ type: 'string' }, 'first', { owner: first }), { code: 'REST_API_VALIDATION' })
      assert.equal(validate({ type: 'string' }, 'second', { owner: first }), 'second')
      assert.throws(() => validate({ type: 'string' }, 'second', { owner: second }), { code: 'REST_API_VALIDATION' })
      assert.equal(validate({ type: 'string' }, 'first', { owner: second }), 'first')
    }
  })

  it('allows nested validation without retaining another call’s working values', () => {
    const type = 'cursorContractNested'
    addType(type, ({ value }) => value === 'outer' ? `outer:${validate({ type }, 'inner', { owner })}` : value)
    const owner = createSchema({ field: { type } })
    for (let index = 0; index < 2; index++) {
      assert.equal(validate({ type }, 'outer', { owner }), 'outer:inner')
      assert.equal(validate({ type }, 'standalone', { owner }), 'standalone')
    }
  })

  it('does not confuse omitted temporal precision with invalid null or noninteger declarations', () => {
    for (let index = 0; index < 2; index++) {
      assert.equal(validate({ type: 'time' }, '12:34:56.123'), '12:34:56.123')
      for (const temporalPrecision of [null, NaN, Infinity, 1.5]) {
        assert.throws(() => validate({ type: 'time', temporalPrecision }, '12:34:56'), /non-negative integer/)
      }
      assert.equal(validate({ type: 'time' }, '12:34:56.123'), '12:34:56.123')
    }
  })

  it('keeps cursor validation distinct from temporal output conversion', () => {
    const value = '2024-02-29T12:34:56.123456Z'
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(normalizeAttributes({ at: value }, { at: { type: 'dateTime', temporalPrecision: 3 } }), { at: '2024-02-29T12:34:56.123Z' })
      assert.throws(() => validate({ type: 'dateTime', temporalPrecision: 3 }, value), { code: 'REST_API_VALIDATION' })
      assert.equal(validate({ type: 'dateTime', temporalPrecision: 6 }, value), value)
      assert.deepEqual(normalizeAttributes({ at: value }, { at: { type: 'dateTime', temporalPrecision: 6 } }), { at: value })
    }
  })
})
