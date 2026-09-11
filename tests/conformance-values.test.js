import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createJsonApiDocument, validateJsonApiStructure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Shared value and write conformance (${storageMode.mode})`, () => {
  let fixture
  let items
  before(async () => {
    fixture = await createConformanceFixture({ storage: storageMode.mode })
    items = fixture.api.resources.items
    assert.equal(fixture.storage, storageMode.mode)
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('persists explicit numeric POST IDs as the same public IDs for every return mode', async () => {
    for (const [index, returning] of ['none', 'minimal', 'full'].entries()) {
      const id = 901 + index
      const inputRecord = createJsonApiDocument('items', { name: `Explicit ${id}` })
      inputRecord.data.id = index % 2 ? String(id) : id
      const result = await items.post({ inputRecord, format: 'jsonapi', returning })
      if (returning !== 'none') assert.equal(result.data.id, String(id))
      const fetched = await items.get({ id: String(id), format: 'jsonapi' })
      assert.equal(fetched.data.id, String(id))
      assert.equal(fetched.data.attributes.name, `Explicit ${id}`)
    }
    assert.equal(await fixture.count('items'), 3)
  })

  it('enforces the positive-only id schema equally in both input formats', async () => {
    for (const format of ['plain', 'jsonapi']) {
      for (const id of [0, '0', -1]) {
        const inputRecord = format === 'plain'
          ? { id, name: 'Rejected' }
          : { data: { type: 'items', id, attributes: { name: 'Rejected' } } }
        await assert.rejects(items.post({ format, inputRecord }), { code: 'REST_API_VALIDATION' })
        assert.equal(await fixture.count('items'), 0)
      }
    }
  })

  it('uses the chosen format for related records, empty relationships, and sparse fields', async () => {
    const group = await fixture.seed('groups', { name: 'Group' })
    const item = await fixture.seed('items', { name: 'Child' }, { group: { data: { type: 'groups', id: group.id } } })
    for (const format of ['plain', 'jsonapi']) {
      const related = await items.getRelated({ id: item.id, relationshipName: 'group', format })
      assert.equal(format === 'plain' ? related.name : related.data.attributes.name, 'Group')
      const children = await fixture.api.resources.groups.getRelated({
        id: group.id, relationshipName: 'items', format, queryParams: { fields: { items: 'name' } }
      })
      assert.equal(children.data.length, 1)
      assert.equal(format === 'plain' ? children.data[0].name : children.data[0].attributes.name, 'Child')
      assert.ok(children.links.self)
      const emptyGroup = await fixture.seed('groups', { name: 'Empty' })
      const empty = await fixture.api.resources.groups.getRelated({ id: emptyGroup.id, relationshipName: 'items', format })
      assert.deepEqual(empty.data, [])
      const orphan = await fixture.seed('items', { name: 'Orphan' })
      const absent = await items.getRelated({ id: orphan.id, relationshipName: 'group', format })
      if (format === 'plain') assert.equal(absent, null)
      else assert.equal(absent.data, null)
    }
  })

  it('uses the declared ID storage order across a digit boundary', async () => {
    for (let index = 0; index < 12; index++) await fixture.seed('items', { name: 'Tied' })
    const response = await items.query({ format: 'jsonapi', queryParams: { sort: ['name'], page: { size: 20 } } })
    const expected = fixture.idOrder === 'numeric'
      ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
      : ['1', '10', '11', '12', '2', '3', '4', '5', '6', '7', '8', '9']
    assert.deepEqual(response.data.map(record => record.id), expected)
  })

  it('preserves false, zero and empty strings while excluding hidden fields', async () => {
    const values = { name: 'Boundary', note: '', rank: 0, active: false, score: 0 }
    const created = await fixture.seed('items', {
      ...values, secret: 'secret', internal: 'internal', transient: 'one request'
    })
    for (const [key, value] of Object.entries(values)) assert.equal(created.attributes[key], value)
    assert.equal(created.attributes.secret, undefined)
    assert.equal(created.attributes.internal, undefined)
    assert.equal(created.attributes.transient, 'one request')

    const fetched = await items.get({ id: created.id, format: 'jsonapi' })
    validateJsonApiStructure(fetched)
    for (const [key, value] of Object.entries(values)) assert.equal(fetched.data.attributes[key], value)
    assert.equal(fetched.data.attributes.transient, undefined)
    assert.equal(fetched.data.attributes.secret, undefined)
    assert.equal(fetched.data.attributes.internal, undefined)
    const selected = await items.get({
      id: created.id, format: 'jsonapi', queryParams: { fields: { items: 'name,internal' } }
    })
    assert.deepEqual(selected.data.attributes, { name: 'Boundary', internal: 'internal' })
    assert.equal(await fixture.count('items'), 1)
  })

  it('applies missing defaults and distinguishes omitted, undefined and null PATCH fields', async () => {
    const created = await fixture.seed('items', { name: 'Defaults', note: 'keep', rank: 5 })
    assert.equal(created.attributes.active, true)
    assert.equal(created.attributes.score, 0)
    const result = await items.patch({
      id: created.id, format: 'jsonapi', inputRecord: createJsonApiDocument('items', { name: 'Changed' })
    })
    assert.equal(result.data.attributes.note, 'keep')
    assert.equal(result.data.attributes.rank, 5)
    await assert.rejects(items.patch({
      id: created.id, format: 'jsonapi', inputRecord: createJsonApiDocument('items', { note: undefined })
    }), { code: 'REST_API_VALIDATION' })
    assert.equal((await items.get({ id: created.id, format: 'jsonapi' })).data.attributes.note, 'keep')
    const cleared = await items.patch({
      id: created.id,
      format: 'jsonapi',
      inputRecord: createJsonApiDocument('items', { note: null, rank: null })
    })
    assert.equal(cleared.data.attributes.note, null)
    assert.equal(cleared.data.attributes.rank, null)
    assert.equal(cleared.data.attributes.name, 'Changed')
  })

  it('rejects missing, undefined and null required values without changing stored records', async () => {
    for (const attributes of [{}, { name: undefined }, { name: null }]) {
      await assert.rejects(items.post({
        format: 'jsonapi', inputRecord: createJsonApiDocument('items', attributes)
      }), { code: 'REST_API_VALIDATION' })
      assert.equal(await fixture.count('items'), 0)
    }
    const created = await fixture.seed('items', { name: 'Unchanged', note: 'keep' })
    await assert.rejects(items.patch({
      id: created.id, format: 'jsonapi', inputRecord: createJsonApiDocument('items', { name: null })
    }), { code: 'REST_API_VALIDATION' })
    const fetched = await items.get({ id: created.id, format: 'jsonapi' })
    assert.equal(fetched.data.attributes.name, 'Unchanged')
    assert.equal(fetched.data.attributes.note, 'keep')
    assert.equal(await fixture.count('items'), 1)
  })

  for (const simplified of [false, true]) {
    for (const returning of ['none', 'minimal', 'full']) {
      it(`preserves ${returning} write returns with simplified=${simplified}`, async () => {
        const inputRecord = simplified ? { name: 'Created' } : createJsonApiDocument('items', { name: 'Created' })
        const result = await items.post({ inputRecord, format: (simplified) ? 'plain' : 'jsonapi', returning })
        const stored = (await items.query({ format: 'jsonapi' })).data
        assert.equal(stored.length, 1)
        const id = stored[0].id
        if (returning === 'none') assert.equal(result, undefined)
        else if (returning === 'minimal') {
          assert.deepEqual(result, simplified ? { type: 'items', id } : { data: { type: 'items', id } })
        } else {
          assert.equal(simplified ? result.name : result.data.attributes.name, 'Created')
          assert.equal(simplified ? result.id : result.data.id, id)
        }
      })
    }
  }

  it('creates through PUT, replaces attributes and deletes the resulting record', async () => {
    const id = '701'
    const group = await fixture.seed('groups', { name: 'Group' })
    const inputRecord = createJsonApiDocument('items', { name: 'Created', note: 'old', active: false }, {
      group: { data: { type: 'groups', id: group.id } }
    })
    inputRecord.data.id = id
    const created = await items.put({ id, format: 'jsonapi', inputRecord })
    assert.equal(created.data.id, id)
    await assert.rejects(items.put({
      id, format: 'jsonapi', inputRecord: createJsonApiDocument('items', { name: 'Incomplete' })
    }), { code: 'REST_API_VALIDATION' })
    const unchanged = await items.get({ id, format: 'jsonapi' })
    assert.equal(unchanged.data.attributes.name, 'Created')
    assert.equal(unchanged.data.relationships.group.data.id, group.id)
    const replaced = await items.put({
      id,
      format: 'jsonapi',
      inputRecord: createJsonApiDocument('items', { name: 'Replacement', note: null, active: true, score: 0 }, {
        group: { data: null }
      })
    })
    assert.equal(replaced.data.attributes.name, 'Replacement')
    assert.equal(replaced.data.attributes.note, null)
    assert.equal(replaced.data.attributes.active, true)
    assert.equal(replaced.data.relationships.group.data, null)
    assert.equal(await fixture.count('items'), 1)
    await items.delete({ id, format: 'jsonapi' })
    assert.equal(await fixture.count('items'), 0)
    await assert.rejects(items.get({ id, format: 'jsonapi' }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
  })
})
