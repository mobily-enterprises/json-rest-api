import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { interceptTransactionCompletion } from './helpers/transaction-completion.js'

for (const phase of ['commit', 'rollback']) {
  for (const afterExecution of [false, true]) {
    test(`${phase} failure ${afterExecution ? 'after' : 'before'} execution isolates the connection from a waiting borrower`, async () => {
      const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
      let completion, borrowing, borrowed
      const primary = new Error('Reject callback')
      try {
        await assert.rejects(fixture.api.transaction(async transaction => {
          await fixture.api.resources.items.post({ transaction, document: { data: { type: 'items', attributes: { name: 'First write' } } } })
          completion = interceptTransactionCompletion(transaction, fixture.knex, { phase, afterExecution })
          borrowing = fixture.knex.client.acquireConnection()
          borrowing.catch(() => {})
          assert.equal(fixture.knex.client.pool.numPendingAcquires(), 1)
          if (phase === 'rollback') throw primary
        }), error => error.transactionOutcome === 'unknown')
        borrowed = await borrowing
        borrowing = null
        assert.notEqual(borrowed, completion.connection, 'uncertain completion must not recycle the connection to a queued request')
        await fixture.knex.client.releaseConnection(borrowed)
        borrowed = null
        const committed = phase === 'commit' && afterExecution ? 1 : 0
        assert.equal(await fixture.count('items'), committed)
        await fixture.api.transaction(transaction => fixture.api.resources.items.post({ transaction, document: { data: { type: 'items', attributes: { name: 'Second request' } } } }))
        assert.equal(await fixture.count('items'), committed + 1)
      } finally {
        if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
        if (borrowed) await fixture.knex.client.releaseConnection(borrowed)
        try { await completion?.close() } finally { await fixture.close() }
      }
    })
  }
}

for (const phase of ['commit', 'rollback']) {
  test(`acknowledged ${phase} keeps its connection reusable`, async () => {
    const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
    let connection, borrowed, borrowing
    const primary = new Error('Reject callback')
    try {
      const operation = fixture.api.transaction(async transaction => {
        connection = await transaction.client.acquireConnection()
        await fixture.api.resources.items.post({ transaction, document: { data: { type: 'items', attributes: { name: 'First write' } } } })
        borrowing = fixture.knex.client.acquireConnection()
        borrowing.catch(() => {})
        assert.equal(fixture.knex.client.pool.numPendingAcquires(), 1)
        if (phase === 'rollback') throw primary
      })
      if (phase === 'rollback') await assert.rejects(operation, error => error.cause === primary && error.transactionOutcome === 'rolledBack')
      else await operation
      borrowed = await borrowing
      borrowing = null
      assert.equal(borrowed, connection)
      await fixture.knex.client.releaseConnection(borrowed)
      borrowed = null
      assert.equal(await fixture.count('items'), phase === 'commit' ? 1 : 0)
    } finally {
      if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
      if (borrowed) await fixture.knex.client.releaseConnection(borrowed)
      await fixture.close()
    }
  })
}

test('failed BEGIN releases its connection lease without lending the failed connection', async () => {
  const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
  const connection = await fixture.knex.client.acquireConnection()
  await fixture.knex.client.releaseConnection(connection)
  const primary = new Error('BEGIN failed')
  let borrowing, borrowed
  const rejectBegin = statement => {
    if (!/^BEGIN\b/i.test(statement.sql)) return
    borrowing = fixture.knex.client.acquireConnection()
    borrowing.catch(() => {})
    assert.equal(fixture.knex.client.pool.numPendingAcquires(), 1)
    throw primary
  }
  fixture.knex.client.on('query', rejectBegin)
  try {
    await assert.rejects(fixture.api.transaction(() => assert.fail('callback must not run after failed BEGIN')), error => error.cause === primary)
    assert.ok(connection)
    borrowed = await borrowing
    borrowing = null
    assert.notEqual(borrowed, connection)
    await fixture.knex.client.releaseConnection(borrowed)
    borrowed = null
    fixture.knex.client.removeListener('query', rejectBegin)
    await fixture.api.transaction(transaction => fixture.api.resources.items.post({ transaction, document: { data: { type: 'items', attributes: { name: 'Next request' } } } }))
    assert.equal(await fixture.count('items'), 1)
  } finally {
    fixture.knex.client.removeListener('query', rejectBegin)
    if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
    if (borrowed) await fixture.knex.client.releaseConnection(borrowed)
    await fixture.close()
  }
})

test('a rollback rejection without completion settlement releases an unusable connection', async t => {
  const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
  const primary = new Error('Callback failed')
  const secondary = new Error('Rollback rejected before completion')
  const context = {}
  let transaction, connection, rollback, borrowing, borrowed
  try {
    await assert.rejects(fixture.api.transaction(async trx => {
      transaction = trx
      connection = await trx.client.acquireConnection()
      rollback = trx.rollback.bind(trx)
      await fixture.api.resources.items.post({ transaction: trx, document: { data: { type: 'items', attributes: { name: 'Unfinished write' } } } })
      t.mock.method(trx, 'rollback', async () => { throw secondary })
      borrowing = fixture.knex.client.acquireConnection()
      borrowing.catch(() => {})
      assert.equal(fixture.knex.client.pool.numPendingAcquires(), 1)
      throw primary
    }, context), error => error.cause === primary && error.transactionOutcome === 'unknown')
    assert.deepEqual(context.cleanupErrors, [{ phase: 'rollback', error: secondary }])
    borrowed = await borrowing
    borrowing = null
    assert.notEqual(borrowed, connection)
    await fixture.knex.client.releaseConnection(borrowed)
    borrowed = null
    assert.equal(await fixture.count('items'), 0)
    await assert.rejects(fixture.api.resources.items.post({ transaction, document: { data: { type: 'items', attributes: { name: 'Rejected old owner' } } } }), /active transaction from api.transaction/)
    await fixture.api.resources.items.post({ document: { data: { type: 'items', attributes: { name: 'Next request' } } } })
    assert.equal(await fixture.count('items'), 1)
  } finally {
    if (!borrowed && borrowing) borrowed = await borrowing.catch(() => null)
    if (borrowed) await fixture.knex.client.releaseConnection(borrowed)
    t.mock.restoreAll()
    if (rollback && !connection.__knex__disposed && !transaction.isCompleted()) await rollback()
    await fixture.close()
  }
})
