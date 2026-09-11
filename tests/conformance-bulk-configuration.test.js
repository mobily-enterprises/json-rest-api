import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const create = bulk => createConformanceFixture({
  createApi: createIdConformanceApi,
  apiOptions: { bulk },
  tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
})

describe(`Bulk configuration (${storageMode.mode})`, () => {
  for (const [name, values] of [
    ['maxBulkOperations', [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]],
    ['defaultAtomic', [0, 'false', null]],
    ['batchSize', [0, 10]],
    ['enableOptimizations', [true, false]],
    ['bulk-operations', [{ maxBulkOperations: 2 }]],
    ['maxBulkOperation', [2]]
  ]) {
    for (const value of values) {
      it(`rejects ${name}=${String(value)} during installation`, async () => {
        let fixture
        try {
          await assert.rejects(async () => { fixture = await create({ [name]: value }) }, error => {
            assert.equal(error.code, 'REST_API_VALIDATION')
            assert.deepEqual(error.details.fields, [name])
            assert.ok(error.message.includes(name), error.message)
            return true
          })
        } finally { await fixture?.close() }
      })
    }
  }
})

describe(`Bulk limits and write lifecycle (${storageMode.mode})`, () => {
  let fixture
  let writes
  before(async () => {
    fixture = await create({ maxBulkOperations: 2, defaultAtomic: false })
    await fixture.api.customize({
      hooks: {
        beforeSchemaValidatePost: {
          functionName: 'bulk-config-write-hook',
          handler: ({ context, scopeName }) => {
            if (scopeName !== 'items' || !context.bulkOperation) return
            writes.push(context.bulkIndex)
            if (context.bulkIndex === 0) context.inputRecord.data.attributes.name += ' from hook'
          }
        }
      }
    })
  })
  beforeEach(async () => { await fixture.reset(); writes = [] })
  after(async () => { await fixture?.close() })

  const record = (id, name) => ({ data: { type: 'items', id, attributes: name === undefined ? {} : { name } } })
  for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
    it(`enforces the configured limit before ${method} starts any record`, async () => {
      const ids = ['1', '2', '3']
      const params = method === 'bulkPost'
        ? { inputRecords: ids.map(id => record(id, 'Too many')) }
        : method === 'bulkPatch' ? { operations: ids.map(id => ({ id, data: record(id, 'Too many').data })) } : { ids }
      await assert.rejects(fixture.api.resources.items[method](params), { code: 'REST_API_VALIDATION' })
      assert.deepEqual(writes, [])
      assert.equal(await fixture.count('items'), 0)
    })
  }

  it('uses the configured non-atomic default and preserves validation, hooks and failure indexes', async () => {
    const result = await fixture.api.resources.items.bulkPost({ inputRecords: [record('1', 'First'), record('2')] })
    assert.deepEqual(result.meta, { total: 2, succeeded: 1, failed: 1, atomic: false })
    assert.deepEqual(writes, [0, 1])
    assert.equal(result.data[0].attributes.name, 'First from hook')
    assert.equal(result.errors[0].index, 1)
    assert.equal(result.errors[0].error.code, 'REST_API_VALIDATION')
    assert.equal(await fixture.count('items'), 1)
  })

  it('allows a call to select atomic rollback over the configured default', async () => {
    await assert.rejects(fixture.api.resources.items.bulkPost({
      atomic: true, inputRecords: [record('1', 'First'), record('2')]
    }), { code: 'REST_API_VALIDATION' })
    assert.deepEqual(writes, [0, 1])
    assert.equal(await fixture.count('items'), 0)
  })
})
