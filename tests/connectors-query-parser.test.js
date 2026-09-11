import { it } from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonApiQuery, serializeJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { extractQueryString } from '../plugins/core/connectors/lib/connector-core.js'

it('distinguishes an omitted include from an explicitly empty include', () => {
  for (const query of ['', 'sort=name', 'fields[items]=name']) assert.equal(Object.hasOwn(parseJsonApiQuery(query), 'include'), false)
  for (const query of ['include=', 'include', 'include=items&include=']) assert.deepEqual(parseJsonApiQuery(query).include, [])
  assert.deepEqual(parseJsonApiQuery('include=&include=items').include, ['items'])
})

it('round-trips explicit empty includes without serializing absent includes or empty sort arrays', () => {
  for (const include of [[], '']) {
    const query = serializeJsonApiQuery({ include, sort: [] })
    assert.equal(query, 'include=')
    assert.deepEqual(parseJsonApiQuery(query).include, [])
  }
  for (const query of [{}, { include: undefined }, { sort: [] }]) assert.equal(serializeJsonApiQuery(query), '')
})

it('splits a URL at its first question mark and preserves the complete query', () => {
  assert.equal(extractQueryString('/api/countries?filter[name]=Who?%20Why'), 'filter[name]=Who?%20Why')
  assert.equal(extractQueryString('/api/countries'), '')
})

it('preserves fractional pagination for the integer validator', () => {
  assert.deepEqual(parseJsonApiQuery('page[size]=1.5&page[number]=2.5').page, { size: 1.5, number: 2.5 })
})

it('keeps numeric-looking opaque cursors unchanged through a link round trip', () => {
  const page = { after: '000123', before: '9007199254740993', cursor: '001.50' }
  assert.deepEqual(parseJsonApiQuery(serializeJsonApiQuery({ page })).page, page)
})

it('preserves literal map keys without changing object prototypes', () => {
  for (const [parameter, member] of [['filter', 'filters'], ['fields', 'fields'], ['page', 'page']]) {
    const result = parseJsonApiQuery(`${parameter}[__proto__]=name&${parameter}[constructor]=value`)[member]
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
    assert.equal(Object.hasOwn(result, '__proto__'), true)
    assert.equal(Object.getOwnPropertyDescriptor(result, '__proto__').value, 'name')
    assert.equal(result.constructor, 'value')
    assert.deepEqual(parseJsonApiQuery(serializeJsonApiQuery({ [member]: result }))[member], result)
  }
})

it('rejects retired controls while preserving the same names in filter data', () => {
  for (const name of ['simplified', 'simplifiedApi', 'simplifiedTransport', 'returnFullRecord', 'returnRecordApi', 'returnRecordTransport', 'isTransport']) {
    assert.throws(() => parseJsonApiQuery(`${name}=true`), { code: 'REST_API_VALIDATION' })
    assert.deepEqual(parseJsonApiQuery(`filter[${name}]=value`).filters, { [name]: 'value' })
  }
})

it('uses the final occurrence for repeated map keys and preserves empty values', () => {
  const query = parseJsonApiQuery('filter[name]=first&filter[name]=&fields[countries]=name&fields[countries]=')
  assert.deepEqual(query.filters, { name: '' })
  assert.deepEqual(query.fields, { countries: '' })
})

it('round-trips explicit nulls, empty lists, embedded commas and typed filter values', () => {
  const filters = { absent: null, empty: [], members: ['one,two', 'null', 0, false, null], object: { nested: [1, null] }, literal: 'null', quoted: '[1,2]' }
  const query = serializeJsonApiQuery({ filters })
  assert.equal(new URLSearchParams(query).get('filter[absent][json]'), 'null')
  assert.deepEqual(parseJsonApiQuery(query).filters, filters)
  assert.deepEqual(parseJsonApiQuery('filter[value][json]=false&filter[number][json]=0').filters, { value: false, number: 0 })
})

it('rejects malformed typed filters and retains final-occurrence/prototype rules', () => {
  for (const value of ['', 'undefined', '[1,', 'NaN']) assert.throws(() => parseJsonApiQuery(new URLSearchParams({ 'filter[value][json]': value }).toString()), { code: 'REST_API_PAYLOAD', statusCode: 400 })
  assert.deepEqual(parseJsonApiQuery('filter[name]=first&filter[name][json]=null').filters, { name: null })
  assert.deepEqual(parseJsonApiQuery('filter[name][json]=null&filter[name]=null').filters, { name: 'null' })
  const filters = parseJsonApiQuery('filter[__proto__][json]=null').filters
  assert.equal(Object.getPrototypeOf(filters), Object.prototype)
  assert.equal(Object.hasOwn(filters, '__proto__'), true)
  assert.equal(Object.getOwnPropertyDescriptor(filters, '__proto__').value, null)
})
