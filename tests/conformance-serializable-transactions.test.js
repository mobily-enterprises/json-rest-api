import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serializableTransaction } from '../lib/knex-transaction.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'

describe(`Serializable connector transaction foundation (${storageMode.mode})`, () => {
  let fixture, first, second
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      databaseOptions: { concurrent: true, maxConnections: 2 }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    first = await fixture.seed('items', { name: 'Available' })
    second = await fixture.seed('items', { name: 'Available' })
  })
  after(async () => { await fixture?.close() })

  it('prevents two transactions from consuming different rows based on the same earlier representation', async () => {
    const barrier = Promise.withResolvers()
    let arrivals = 0
    const consume = id => fixture.api.transaction(async transaction => {
      const observed = await fixture.api.resources.items.query({ transaction, format: 'jsonapi' })
      assert.equal(observed.data.filter(record => record.attributes.name === 'Available').length, 2)
      if (++arrivals === 2) barrier.resolve()
      await barrier.promise
      await fixture.api.resources.items.patch({
        id, transaction, format: 'plain', returning: 'none', inputRecord: { name: 'Consumed' }
      })
    }, { [serializableTransaction]: true }).catch(error => {
      barrier.resolve()
      throw error
    })
    const outcomes = await Promise.allSettled([consume(first.id), consume(second.id)])
    assert.equal(arrivals, 2)
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1)
    const failure = outcomes.find(outcome => outcome.status === 'rejected').reason
    assert.equal(failure.code, { 'better-sqlite3': 'SQLITE_BUSY', pg: '40001', mysql2: 'ER_LOCK_DEADLOCK' }[databaseClient])
    const final = await fixture.api.resources.items.query({ format: 'jsonapi' })
    assert.equal(final.data.filter(record => record.attributes.name === 'Available').length, 1)
    assert.equal(final.data.filter(record => record.attributes.name === 'Consumed').length, 1)
  })
})
