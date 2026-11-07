import { describe, it } from 'node:test'
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
    ['defaultAtomic', [true, false]],
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

  it('installs with a custom limit', async () => {
    const fixture = await create({ maxBulkOperations: 2 })
    try {
      assert.ok(fixture.api.resources.items)
    } finally { await fixture.close() }
  })
})
