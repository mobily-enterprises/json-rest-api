import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { BulkOperationsPlugin } from '../plugins/core/bulk-operations-plugin.js'
import { storageMode } from './helpers/storage-mode.js'

const documentFor = (attributes, id, relationships) => ({
  data: { type: 'items', ...(id === undefined ? {} : { id }), attributes, ...(relationships ? { relationships } : {}) }
})

describe(`Independent input and output (${storageMode.mode})`, () => {
  let fixture, items, group, finishError
  before(async () => {
    fixture = await createConformanceFixture({ apiOptions: { format: undefined } })
    await fixture.api.use(BulkOperationsPlugin)
    items = fixture.api.resources.items
    await fixture.api.customize({
      hooks: {
        finishPost: {
          functionName: 'input-selection-finish-failure',
          handler: () => { if (finishError) throw finishError }
        }
      }
    })
  })
  beforeEach(async () => {
    finishError = undefined
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
  })
  after(async () => { await fixture?.close() })

  for (const inputKey of ['data', 'document']) {
    for (const format of ['plain', 'jsonapi']) {
      for (const method of ['post', 'put', 'patch']) {
        for (const returning of ['full', 'minimal', 'none']) {
          it(`${method} accepts ${inputKey} with ${format}/${returning}`, async () => {
            const id = method === 'post' ? '99' : (await fixture.seed('items', { name: 'Before' })).id
            const attributes = { name: 'After', active: false, score: 4 }
            const input = inputKey === 'data'
              ? { id, ...attributes, group: group.id }
              : documentFor(attributes, id, { group: { data: { type: 'groups', id: group.id } } })
            const result = await items[method]({ id, [inputKey]: input, format, returning })
            if (returning === 'none') assert.equal(result, undefined)
            else if (returning === 'minimal') {
              const identifier = { type: 'items', id }
              assert.deepEqual(result, format === 'plain' ? identifier : { data: identifier })
            } else {
              assert.equal(format === 'plain' ? result.name : result.data.attributes.name, 'After')
              assert.equal(format === 'plain' ? result.group.id : result.data.relationships.group.data.id, group.id)
            }
            const stored = await items.get({ id })
            assert.equal(stored.name, 'After')
            assert.equal(stored.group.id, group.id)
          })
        }
      }
    }

    it(`${inputKey} defaults to plain output, including query collections`, async () => {
      const input = inputKey === 'data' ? { name: 'Default' } : documentFor({ name: 'Default' })
      const result = await items.post({ [inputKey]: input })
      assert.equal(result.name, 'Default')
      assert.equal(Object.hasOwn(result, 'attributes'), false)
      const collection = await items.query()
      assert.equal(collection.data[0].name, 'Default')
    })

    it(`${inputKey} response failure rolls back even with the other output format`, async () => {
      finishError = new Error('Cannot prepare successful response')
      const input = inputKey === 'data' ? { name: 'Rolled back' } : documentFor({ name: 'Rolled back' })
      await assert.rejects(items.post({ [inputKey]: input, format: inputKey === 'data' ? 'jsonapi' : 'plain' }), error => {
        assert.equal(error.cause, finishError)
        assert.equal(error.transactionOutcome, 'rolledBack')
        return true
      })
      assert.equal(await fixture.count('items'), 0)
    })
  }

  for (const format of ['plain', 'jsonapi']) {
    for (const inputKey of ['data', 'document']) {
      it(`bulk operations accept ${inputKey} with ${format} output`, async () => {
        const records = [{ name: 'First' }, { name: 'Second' }]
        const input = inputKey === 'data' ? records : { data: records.map(attributes => documentFor(attributes).data) }
        const created = await items.bulkPost({ [inputKey]: input, format })
        assert.equal(created.meta.succeeded, 2)
        assert.equal(format === 'plain' ? created.data[0].name : created.data[0].attributes.name, 'First')
        const operations = created.data.map(record => ({
          id: record.id,
          [inputKey]: inputKey === 'data' ? { name: 'Changed' } : documentFor({ name: 'Changed' }, record.id)
        }))
        const updated = await items.bulkPatch({ operations, format })
        assert.equal(updated.meta.succeeded, 2)
        assert.equal(format === 'plain' ? updated.data[0].name : updated.data[0].attributes.name, 'Changed')
      })
    }
    it(`bulk patch mixes explicit input forms with ${format} output`, async () => {
      const first = await fixture.seed('items', { name: 'First' })
      const second = await fixture.seed('items', { name: 'Second' })
      const result = await items.bulkPatch({
        format,
        operations: [
          { id: first.id, data: { name: 'Plain' } },
          { id: second.id, document: documentFor({ name: 'Document' }, second.id) }
        ]
      })
      assert.equal(result.meta.succeeded, 2)
      assert.equal((await items.get({ id: first.id })).name, 'Plain')
      assert.equal((await items.get({ id: second.id })).name, 'Document')
    })
  }

  for (const params of [
    {}, { data: undefined }, { document: undefined }, { data: null }, { document: null },
    { data: [] }, { document: [] },
    { data: { name: 'Bad' }, document: undefined },
    { data: undefined, document: documentFor({ name: 'Bad' }) },
    { data: { name: 'Bad' }, document: documentFor({ name: 'Bad' }) },
    { inputRecord: { name: 'Old' } },
    { data: { name: 'Bad' }, inputRecord: undefined },
    { document: { ...documentFor({ name: 'Bad' }), included: [] } },
    { document: { ...documentFor({ name: 'Bad' }), errors: [] } }
  ]) {
    it(`rejects invalid selection ${JSON.stringify(params)} before SQL`, async () => {
      const statements = []
      const capture = query => statements.push(query.sql)
      fixture.knex.on('query', capture)
      try {
        await assert.rejects(items.post(params), { code: 'REST_API_VALIDATION' })
        assert.deepEqual(statements, [])
      } finally { fixture.knex.off('query', capture) }
    })
  }

  it('does not infer input selection from inherited properties', async () => {
    await assert.rejects(items.post(Object.create({ data: { name: 'Inherited' } })), { code: 'REST_API_VALIDATION' })
  })

  it('reports no-write outcomes for invalid non-atomic bulk entries and continues valid work', async () => {
    const item = await fixture.seed('items', { name: 'Before' })
    const invalid = [
      {}, { data: { name: 'Bad' }, document: undefined },
      { document: null }, { inputRecord: { name: 'Old' } }
    ]
    const result = await items.bulkPatch({
      atomic: false,
      operations: [...invalid.map(input => ({ id: item.id, ...input })), { id: item.id, data: { name: 'Accepted' } }]
    })
    assert.equal(result.meta.failed, invalid.length)
    assert.equal(result.meta.succeeded, 1)
    for (const [index, failure] of result.errors.entries()) {
      assert.equal(failure.index, index)
      assert.equal(failure.error.code, 'REST_API_VALIDATION')
      assert.equal(failure.error.transactionOutcome, 'none')
    }
    assert.equal((await items.get({ id: item.id })).name, 'Accepted')
  })
})

describe(`Plain data field names (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        format: undefined,
        itemOptions: {
          schema: {
            id: { type: 'id' },
            data: { type: 'object' },
            document: { type: 'object' },
            format: { type: 'string' },
            returning: { type: 'string' }
          }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })
  it('stores protocol-looking fields as ordinary values', async () => {
    const data = { data: { type: 'ordinary', attributes: { name: 'Value' } }, document: { data: 'also ordinary' }, format: 'field', returning: 'field' }
    const created = await fixture.api.resources.items.post({ data })
    const result = await fixture.api.resources.items.get({ id: created.id })
    for (const key of Object.keys(data)) assert.deepEqual(result[key], data[key])
  })
})
