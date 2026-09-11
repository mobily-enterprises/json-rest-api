import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createAnyApiFieldEvolutionApi } from './fixtures/api-configs.js'
import { interceptTransactionCompletion } from './helpers/transaction-completion.js'

for (const operation of ['register', 'allocate']) {
  for (const afterExecution of [false, true]) {
    test(`${operation}: failed COMMIT isolates its metadata connection (${afterExecution})`, async () => {
      const fixture = await createConformanceFixture({ storage: 'anyapi', createApi: createAnyApiFieldEvolutionApi, databaseOptions: { concurrent: true, maxConnections: 1 } })
      const registry = fixture.api.anyapi.registry
      const originalTransaction = fixture.knex.transaction.bind(fixture.knex)
      let completion, borrowing, borrowed
      registry.knex = new Proxy(fixture.knex, {
        get (target, key) {
          if (key !== 'transaction') return Reflect.get(target, key)
          return async (...args) => {
            const transaction = await originalTransaction(...args)
            completion = interceptTransactionCompletion(transaction, fixture.knex, { phase: 'commit', afterExecution })
            const commit = transaction.commit
            transaction.commit = async (...values) => {
              borrowing = fixture.knex.client.acquireConnection()
              borrowing.catch(() => {})
              assert.equal(fixture.knex.client.pool.numPendingAcquires(), 1)
              return commit.apply(transaction, values)
            }
            return transaction
          }
        }
      })
      try {
        const result = operation === 'register'
          ? registry.registerResource({ tenant: 'field_evolution', resource: 'new_items', schema: { id: { type: 'id' }, name: { type: 'string' } } })
          : registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'nickname', definition: { type: 'string' } })
        await assert.rejects(result, error => error.transactionOutcome === 'unknown')
        borrowed = await borrowing
        borrowing = null
        assert.notEqual(borrowed, completion.connection, 'registry must not recycle unfinished metadata transactions')
        await fixture.knex.client.releaseConnection(borrowed)
        borrowed = null
        registry.knex = fixture.knex
        const descriptor = await registry.getDescriptor('field_evolution', operation === 'register' ? 'new_items' : 'items', { bypassCache: true })
        assert.equal(operation === 'register' ? !!descriptor : !!descriptor.schema.nickname, afterExecution)
        await registry.allocateField({ tenant: 'field_evolution', resource: 'items', fieldName: 'subsequent', definition: { type: 'string' } })
        assert.equal((await registry.getDescriptor('field_evolution', 'items', { bypassCache: true })).schema.subsequent.type, 'string')
      } finally {
        if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
        if (borrowed) await fixture.knex.client.releaseConnection(borrowed)
        registry.knex = fixture.knex
        try { await completion?.close() } finally { await fixture.close() }
      }
    })
  }
}
