import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'

for (const phase of ['commit', 'rollback', 'unsettled rollback']) {
  test(`release failure preserves the outcome of ${phase}`, async t => {
    const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
    const primary = new Error('Callback failed')
    const secondary = new Error('Connection release failed after returning lease')
    const rollbackError = new Error('Rollback rejected before completion')
    const release = fixture.knex.client.releaseConnection.bind(fixture.knex.client)
    const context = {}
    let connection, caught
    let releases = 0
    t.mock.method(fixture.knex.client, 'releaseConnection', async candidate => {
      await release(candidate)
      if (candidate === connection && ++releases === 1) throw secondary
    })
    try {
      try {
        await fixture.api.transaction(async transaction => {
          connection = await transaction.client.acquireConnection()
          await fixture.api.resources.items.post({ transaction, inputRecord: { data: { type: 'items', attributes: { name: 'Written row' } } } })
          if (phase === 'unsettled rollback') t.mock.method(transaction, 'rollback', async () => { throw rollbackError })
          if (phase !== 'commit') throw primary
        }, context)
      } catch (error) { caught = error }
      t.mock.restoreAll()
      assert.equal(await fixture.count('items'), phase === 'commit' ? 1 : 0)
      assert.equal(caught.cause, phase === 'commit' ? secondary : primary)
      assert.equal(caught.transactionOutcome, phase === 'commit' ? 'committed' : phase === 'rollback' ? 'rolledBack' : 'unknown')
      assert.equal(releases, 1)
      if (phase !== 'commit') {
        assert.deepEqual(context.cleanupErrors, [
          ...(phase === 'unsettled rollback' ? [{ phase: 'rollback', error: rollbackError }] : []),
          { phase: 'connectionRelease', error: secondary }
        ])
      }
    } finally {
      t.mock.restoreAll()
      await fixture.close()
    }
  })
}

test('BEGIN failure retains its cause when connection release also fails', async t => {
  const fixture = await createConformanceFixture({ databaseOptions: { concurrent: true, maxConnections: 1 } })
  const primary = new Error('BEGIN failed')
  const secondary = new Error('Connection release failed')
  const context = {}
  const release = fixture.knex.client.releaseConnection.bind(fixture.knex.client)
  let began = false
  const rejectBegin = ({ sql }) => {
    if (/^BEGIN\b/i.test(sql)) { began = true; throw primary }
  }
  fixture.knex.client.on('query', rejectBegin)
  t.mock.method(fixture.knex.client, 'releaseConnection', async connection => {
    await release(connection)
    if (began) throw secondary
  })
  try {
    await assert.rejects(fixture.api.transaction(() => assert.fail('callback must not run'), context), error => error.cause === primary && error.transactionOutcome === 'none')
    assert.deepEqual(context.cleanupErrors, [{ phase: 'connectionRelease', error: secondary }])
    fixture.knex.client.removeListener('query', rejectBegin)
    t.mock.restoreAll()
    assert.equal(await fixture.count('items'), 0)
    await fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', attributes: { name: 'Next request' } } } })
    assert.equal(await fixture.count('items'), 1)
  } finally {
    fixture.knex.client.removeListener('query', rejectBegin)
    t.mock.restoreAll()
    await fixture.close()
  }
})
