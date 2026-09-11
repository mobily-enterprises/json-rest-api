import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { executeConnectorRoute } from '../plugins/core/connectors/lib/connector-core.js'
import { createStrongEntityTag, parseIfMatch, matchesIfMatch } from '../plugins/core/connectors/lib/http-validators.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

describe('Methods without representation preconditions', () => {
  for (const method of ['OPTIONS', 'CONNECT', 'TRACE']) {
    it(`ignores even malformed If-Match on ${method}`, async () => {
      let calls = 0
      const body = { meta: { method } }
      const outcome = await executeConnectorRoute({
        httpValidators: true,
        method,
        headers: { 'if-match': 'not-an-entity-tag' },
        context: {},
        handler: async () => { calls++; return body }
      })
      assert.equal(calls, 1)
      assert.equal(outcome.status, 200)
      assert.deepEqual(outcome.body, body)
    })
  }
})

describe('Serialized representation entity tags', () => {
  it('produces the same strong tag for identical UTF-8 bytes', () => {
    const body = '{"name":"café"}'
    const etag = createStrongEntityTag(body)
    assert.equal(etag, createStrongEntityTag(Buffer.from(body)))
    const condition = parseIfMatch(etag)
    assert.equal(condition.tags.length, 1)
    assert.equal(condition.tags[0].weak, false)
    assert.equal(matchesIfMatch(condition, { exists: true, tag: condition.tags[0] }), true)
  })
  it('changes when serialized included or computed output changes without a row revision change', () => {
    const body = { data: { id: '1', attributes: { revision: 'same', label: 'Original' } }, included: [{ id: '2', attributes: { name: 'Child' } }] }
    const original = createStrongEntityTag(JSON.stringify(body))
    body.included[0].attributes.name = 'Changed child'
    assert.notEqual(createStrongEntityTag(JSON.stringify(body)), original)
    body.included[0].attributes.name = 'Child'
    body.data.attributes.label = 'Computed change'
    assert.notEqual(createStrongEntityTag(JSON.stringify(body)), original)
  })
  it('distinguishes byte layout, response format and representation metadata', () => {
    const body = { data: { id: '1' } }
    const text = JSON.stringify(body)
    const tags = [
      createStrongEntityTag(text),
      createStrongEntityTag(JSON.stringify(body, null, 2)),
      createStrongEntityTag(JSON.stringify({ id: '1' })),
      createStrongEntityTag(text, { contentType: 'application/json' }),
      createStrongEntityTag(text, { contentEncoding: 'gzip' })
    ]
    assert.equal(new Set(tags).size, tags.length)
  })
  it('does not serialize an object or invoke its toJSON method implicitly', () => {
    let invoked = false
    assert.throws(() => createStrongEntityTag({ toJSON () { invoked = true; return {} } }), TypeError)
    assert.equal(invoked, false)
    assert.throws(() => createStrongEntityTag('{}', { contentType: null }), TypeError)
    assert.throws(() => createStrongEntityTag('{}', { contentEncoding: {} }), TypeError)
  })
})

describe('If-Match syntax and strong comparison', () => {
  it('distinguishes absent, empty-list and wildcard conditions', () => {
    assert.equal(parseIfMatch(undefined), undefined)
    assert.equal(matchesIfMatch(undefined, { exists: false }), true)
    for (const header of ['', ' \t', ', ,']) {
      assert.deepEqual(parseIfMatch(header), { wildcard: false, tags: [] })
      assert.equal(matchesIfMatch(parseIfMatch(header), { exists: true, tag: { value: '' } }), false)
    }
    assert.equal(matchesIfMatch(parseIfMatch(' \t*\t '), { exists: true }), true)
    assert.equal(matchesIfMatch(parseIfMatch('*'), { exists: false }), false)
  })
  it('combines field lines and ignores bounded empty list entries', () => {
    assert.deepEqual(parseIfMatch([', "first",', ' W/"second", , "" ']), {
      wildcard: false,
      tags: [{ weak: false, value: 'first' }, { weak: true, value: 'second' }, { weak: false, value: '' }]
    })
  })
  it('preserves commas, backslashes and Latin-1 octets inside opaque tags', () => {
    assert.deepEqual(parseIfMatch('"a,b\\cÿ"').tags, [{ weak: false, value: 'a,b\\cÿ' }])
  })
  it('requires an existing representation and a byte-exact strong match', () => {
    const condition = parseIfMatch('W/"weak", "Exact", ""')
    const matches = (value, weak = false, exists = true) => matchesIfMatch(condition, { exists, tag: { value, weak } })
    assert.equal(matches('Exact'), true)
    assert.equal(matches(''), true)
    assert.equal(matches('Exact', true), false)
    assert.equal(matches('Exact', false, false), false)
    assert.equal(matches('exact'), false)
    assert.equal(matches('Exact '), false)
    assert.equal(matches('weak'), false)
    assert.equal(matchesIfMatch(condition, { exists: true }), false)
  })
  for (const header of ['* , "tag"', '*,*', ',*', 'w/"tag"', 'W/ "tag"', 'tag', '"unclosed', '"a" "b"', '"a b"', '"a\tb"', '"a\nb"', '"a\rb"', '"\u007f"', '"Ā"', '"a\\"b"', null, 1, {}, ['"ok"', null]]) {
    it(`rejects malformed syntax ${JSON.stringify(header)}`, () => {
      assert.throws(() => parseIfMatch(header), error => error instanceof RestApiValidationError && !error.message.includes('unclosed'))
    })
  }
  it('bounds header size, field lines, tags and empty elements', () => {
    assert.equal(parseIfMatch('"' + 'x'.repeat(8190) + '"').tags[0].value.length, 8190)
    for (const header of ['"' + 'x'.repeat(8191) + '"', Array(129).fill(''), Array(129).fill('"x"').join(','), ','.repeat(129)]) {
      assert.throws(() => parseIfMatch(header), RestApiValidationError)
    }
    assert.equal(parseIfMatch(Array(128).fill('"x"').join(',')).tags.length, 128)
  })
})
