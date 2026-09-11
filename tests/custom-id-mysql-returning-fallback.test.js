import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { validateJsonApiStructure } from './helpers/test-utils.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

describe('Custom ID POST fallback when insert returning is unusable', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      storage: 'knex',
      createApi: createIdConformanceApi,
      apiOptions: { idType: 'string' },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  after(async () => { await fixture?.close() })
  beforeEach(async () => { await fixture.reset() })

  for (const format of ['plain', 'jsonapi']) {
    it(`returns the explicit ID when the insert result is zero (${format})`, async t => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      const original = transaction.client.processResponse
      let inserts = 0
      // Simulate an unusable driver result after a real insert on the borrowed connection.
      t.mock.method(transaction.client, 'processResponse', function (query, runner) {
        const result = original.call(this, query, runner)
        if (query.method === 'insert') { inserts++; return [0] }
        return result
      })
      try {
        const created = await fixture.api.resources.items.post({
          inputRecord: format === 'plain'
            ? { id: '8', name: 'Created' }
            : { data: { type: 'items', id: '8', attributes: { name: 'Created' } } },
          format,
          transaction
        })
        if (format === 'jsonapi') validateJsonApiStructure(created)
        assert.equal((format === 'plain' ? created : created.data).id, '8')
        assert.equal((format === 'plain' ? created : created.data.attributes).name, 'Created')
        assert.equal(inserts, 1)
        const row = await transaction('conformance_items').where('items_key', '8').first()
        assert.equal(row.items_key, '8')
        assert.equal(row.display_name, 'Created')
        assert.equal(transaction.isCompleted(), false)
      } finally {
        t.mock.restoreAll()
        await unit.rollback()
      }
      assert.equal(await fixture.count('items'), 0)
    })
  }
})
