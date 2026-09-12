import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { handleWriteMethodError } from '../plugins/core/rest-api-plugin-methods/common.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { beginWriteTransaction } from '../lib/error-context.js'

describe('Write error cleanup', () => {
  for (const [method, label] of [['postRelationship', 'POST_RELATIONSHIP'], ['patchRelationship', 'PATCH_RELATIONSHIP'], ['deleteRelationship', 'DELETE_RELATIONSHIP'], [undefined, 'PATCH']]) {
    it(`reports the operation name for ${label}`, async () => {
      const primary = new Error('Write failed')
      const context = { method, scopeName: 'items' }
      const calls = []
      await beginWriteTransaction(context, null, async () => Object.assign(new EventEmitter(), { rollback: async () => {} }), async () => {})
      await assert.rejects(handleWriteMethodError(primary, context, label, 'items', { error: (...args) => calls.push(args) }), error => error === primary)
      assert.equal(calls.length, 1)
      assert.equal(calls[0][1].method, method ?? 'patch')
      assert.equal(calls[0][1].scopeName, 'items')
      assert.equal(calls[0][1].phase, 'writeFailure')
      assert.equal(calls[0][1].transactionOutcome, 'rolledBack')
    })
  }

  for (const primary of [new RestApiValidationError('Original validation failure'), Object.freeze(new Error('Frozen failure')), null, undefined, 'Thrown value']) {
    for (const failedPhase of ['rollback', 'afterRollback', 'logging']) {
      it(`preserves ${primary?.message || String(primary)} when ${failedPhase} fails`, async () => {
        const secondary = new Error(`Failed ${failedPhase}`)
        const events = []
        const context = { method: 'post', scopeName: 'items' }
        const transaction = Object.assign(new EventEmitter(), {
          rollback: async () => {
            events.push('rollback')
            if (failedPhase === 'rollback') throw secondary
          }
        })
        const log = { error: () => { events.push('logging'); if (failedPhase === 'logging') throw secondary } }
        const runHooks = async name => {
          events.push(name)
          if (failedPhase === name) throw secondary
        }
        await beginWriteTransaction(context, null, async () => transaction, runHooks)
        await assert.rejects(handleWriteMethodError(primary, context, 'POST', 'items', log), error => error === primary)
        assert.deepEqual(events, failedPhase === 'rollback' ? ['rollback', 'logging'] : ['rollback', 'afterRollback', 'logging'])
        assert.equal(context.error, primary)
        assert.deepEqual(context.cleanupErrors, [{ phase: failedPhase, error: secondary, ...(failedPhase === 'afterRollback' ? { operationIndex: 0, scopeName: 'items', method: 'post' } : {}) }])
      })
    }
  }

  for (const owned of [false, true]) {
    it(`keeps a logging rejection from replacing the primary ${owned ? 'post-commit' : 'borrowed-transaction'} failure`, async () => {
      const primary = new Error('Write failed')
      const secondary = new Error('Async logger failed')
      const context = { shouldCommit: owned, transactionCommitted: owned }
      const log = { error: async () => { throw secondary } }
      await assert.rejects(handleWriteMethodError(primary, context, 'PATCH', 'items', log), error => error === primary)
      assert.deepEqual(context.cleanupErrors, [{ phase: 'logging', error: secondary }])
    })
  }

  it('retains both cleanup-hook and logging failures in order', async () => {
    const primary = new Error('Write failed')
    const hookError = new Error('Cleanup failed')
    const logError = new Error('Logging failed')
    const context = { method: 'put', scopeName: 'items' }
    await beginWriteTransaction(context, null, async () => Object.assign(new EventEmitter(), { rollback: async () => {} }), async () => { throw hookError })
    await assert.rejects(handleWriteMethodError(primary, context, 'PUT', 'items', { error: () => { throw logError } }), error => error === primary)
    assert.deepEqual(context.cleanupErrors, [{ phase: 'afterRollback', error: hookError, operationIndex: 0, scopeName: 'items', method: 'put' }, { phase: 'logging', error: logError }])
  })
})

it('redacts hidden and normally-hidden field values in write diagnostics', async () => {
  const primary = Object.assign(new Error('Write failed'), {
    details: {
      violations: [
        { field: 'data.attributes.accessKey', rule: 'custom', message: 'Rejected PRIVATE_VIOLATION', value: 'PRIVATE_ACCESS' }
      ]
    }
  })
  const original = { data: { type: 'items', attributes: { accessKey: 'PRIVATE_ACCESS', internalNote: 'PRIVATE_NOTE', name: 'Visible name' } } }
  const context = {
    inputRecord: original,
    schemaInfo: { outputFields: { accessKey: { hidden: true }, internalNote: { normallyHidden: true }, name: {} } }
  }
  const calls = []
  await assert.rejects(handleWriteMethodError(primary, context, 'POST', 'items', { error: (...args) => calls.push(args) }), error => error === primary)
  const output = JSON.stringify(calls)
  assert.ok(!output.includes('PRIVATE_ACCESS'))
  assert.ok(!output.includes('PRIVATE_NOTE'))
  assert.ok(!output.includes('PRIVATE_VIOLATION'))
  assert.match(output, /Visible name/)
  assert.match(output, /Redacted/)
  assert.equal(context.inputRecord, original)
  assert.equal(original.data.attributes.accessKey, 'PRIVATE_ACCESS')
})
