import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { storageMode } from './helpers/storage-mode.js'

const documentFor = (attributes, id, relationships) => ({
  data: { type: 'items', ...(id === undefined ? {} : { id }), attributes, ...(relationships ? { relationships } : {}) }
})

describe(`Independent input and output (${storageMode.mode})`, () => {
  let fixture, items, group, finishError
  before(async () => {
    fixture = await createConformanceFixture({ apiOptions: { format: undefined } })
    items = fixture.api.resources.items
    await fixture.api.customize({
      hooks: {
        finishPost: {
          functionName: 'input-selection-finish-failure',
          // Only single writes set finishError; many-row writes have nothing for it to do.
          batch: true,
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
      it(`many-row writes accept ${inputKey} with ${format} output`, async () => {
        const records = [{ name: 'First' }, { name: 'Second' }]
        const input = inputKey === 'data' ? records : { data: records.map(attributes => documentFor(attributes).data) }
        const created = await items.postMany({ [inputKey]: input, format, returning: 'full' })
        assert.equal(created.data.length, 2)
        assert.equal(format === 'plain' ? created.data[0].name : created.data[0].attributes.name, 'First')
        const changes = inputKey === 'data'
          ? created.data.map(record => ({ id: record.id, name: 'Changed' }))
          : { data: created.data.map(record => documentFor({ name: 'Changed' }, record.id).data) }
        const updated = await items.patchMany({ [inputKey]: changes, format, returning: 'full' })
        assert.equal(updated.data.length, 2)
        assert.equal(format === 'plain' ? updated.data[0].name : updated.data[0].attributes.name, 'Changed')
      })
    }
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

  for (const [method, params] of [
    ['postMany', {}], ['postMany', { data: undefined }], ['postMany', { data: [] }], ['postMany', { document: { data: [] } }],
    ['postMany', { data: [null] }], ['postMany', { data: [{ name: 'Bad' }], document: { data: [] } }],
    ['postMany', { inputRecords: [{ name: 'Old' }] }], ['postMany', { data: [{ name: 'Bad' }], atomic: false }],
    ['patchMany', { operations: [{ id: '1', data: { name: 'Old shape' } }] }], ['patchMany', { document: documentFor({ name: 'Bad' }, '1') }]
  ]) {
    it(`${method} rejects invalid selection ${JSON.stringify(params)} before SQL`, async () => {
      const statements = []
      const capture = query => statements.push(query.sql)
      fixture.knex.on('query', capture)
      try {
        await assert.rejects(items[method](params), error => (error?.cause ?? error).code === 'REST_API_VALIDATION')
        assert.deepEqual(statements, [])
      } finally { fixture.knex.off('query', capture) }
    })
  }
})
