import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { onTransactionFinished } from '../lib/error-context.js'
import { createManagedTransactionApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { interceptTransactionCompletion } from './helpers/transaction-completion.js'

describe(`Managed transactions (${storageMode.mode})`, () => {
  let fixture, item, group, trace, failure, pause
  const primary = Object.freeze(new RestApiValidationError('Managed work failed'))
  const secondary = new Error('Completion hook failed')
  const input = (id, name) => ({ data: { type: 'items', id, attributes: { name } } })
  const post = (transaction, id, marker = id, context = { marker }) => fixture.api.resources.items.post({
    inputRecord: input(id, `Item ${id}`), transaction, format: 'jsonapi'
  }, context)
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createManagedTransactionApi,
      databaseOptions: { concurrent: true, maxConnections: 1 },
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
    })
    await fixture.api.customize({
      hooks: {
        beforeDataCallPost: {
          functionName: 'pause-managed-write',
          handler: async ({ context }) => {
            for (const finalize of context.finalizers || []) onTransactionFinished(context.transaction, finalize)
            if (context.suppressOwnership) {
              context.shouldCommit = false
              if (context.failOwned) throw primary
            }
            if (context.claimOwnership) {
              context.shouldCommit = true
              if (context.claimOwnership === 'rollback') throw primary
            }
            if (context.pause) await pause?.()
          }
        },
        ...Object.fromEntries(['afterCommit', 'afterRollback'].map(hook => [hook, {
          functionName: `observe-managed-${hook}`,
          handler: async ({ context, scopeName }) => {
            if (scopeName !== 'items' || !context.marker) return
            await Promise.resolve()
            trace.push({ hook, marker: context.marker, method: context.method, outcome: context.transactionOutcome, error: context.error })
            if (failure?.hook === hook && failure.marker === context.marker) throw failure.error
          }
        }]))
      }
    })
  })
  beforeEach(async () => {
    trace = []
    failure = undefined
    pause = undefined
    await fixture.reset()
    await cleanTables(fixture.knex, ['managed_transaction_audit'], { storage: 'knex' })
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' })
  })
  after(async () => { await fixture?.close() })

  for (const callback of [undefined, null, 12, {}]) {
    it(`rejects a ${String(callback)} callback before acquiring a transaction`, async () => {
      const queries = []
      const capture = query => queries.push(query.sql)
      fixture.knex.on('query', capture)
      try {
        await assert.rejects(fixture.api.transaction(callback), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      } finally { fixture.knex.off('query', capture) }
      assert.deepEqual(queries, [])
    })
  }

  for (const asynchronous of [false, true]) {
    it(`returns the ${asynchronous ? 'awaited' : 'synchronous'} callback value unchanged after commit`, async () => {
      const result = { value: Symbol('unchanged') }
      const context = {}
      let handle
      assert.equal(await fixture.api.transaction(transaction => {
        handle = transaction
        assert.equal(transaction.isTransaction, true)
        return asynchronous ? Promise.resolve(result) : result
      }, context), result)
      assert.equal(handle.isCompleted(), true)
      assert.equal(context.transactionOutcome, 'committed')
      assert.equal(await fixture.api.transaction(() => undefined), undefined)
    })
  }

  it('commits mixed resource, relationship, bulk and raw SQL work before ordered completion hooks', async () => {
    const result = await fixture.api.transaction(async transaction => {
      const created = await post(transaction, '99', 'create')
      await fixture.api.resources.items.patch({ id: item.id, inputRecord: input(item.id, 'Patched'), transaction }, { marker: 'patch' })
      await fixture.api.resources.items.postRelationship({
        id: '99', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: group.id }], transaction
      }, { marker: 'link' })
      await fixture.api.resources.items.bulkPost({
        inputRecords: ['100', '101'].map(id => input(id, `Bulk ${id}`).data), transaction
      }, { marker: 'bulk' })
      await transaction('managed_transaction_audit').insert({ message: 'Created and linked' })
      assert.equal(transaction.isCompleted(), false)
      assert.deepEqual(trace, [])
      return created
    })
    assert.equal(result.data.id, '99')
    assert.deepEqual(trace.map(entry => entry.marker), ['create', 'patch', 'link', 'bulk', 'bulk'])
    assert.ok(trace.every(entry => entry.hook === 'afterCommit' && entry.outcome === 'committed'))
    assert.equal(await fixture.count('items'), 4)
    assert.equal((await fixture.api.resources.items.get({ id: item.id, format: 'plain' })).name, 'Patched')
    assert.deepEqual((await fixture.api.resources.items.getRelationship({ id: '99', relationshipName: 'groups' })).data, [{ type: 'groups', id: group.id }])
    assert.deepEqual((await fixture.knex('managed_transaction_audit').select('message')), [{ message: 'Created and linked' }])
  })

  for (const cause of [primary, null, undefined]) {
    it(`rolls back callback rejection ${String(cause)} and runs completion hooks in reverse order`, async () => {
      await assert.rejects(fixture.api.transaction(async transaction => {
        await post(transaction, '99', 'first')
        await post(transaction, '100', 'second')
        await transaction('managed_transaction_audit').insert({ message: 'Pending' })
        throw cause
      }), error => assertWriteFailure(error, { cause, outcome: 'rolledBack' }))
      assert.equal(await fixture.count('items'), 1)
      assert.deepEqual(await fixture.knex('managed_transaction_audit').select(), [])
      assert.deepEqual(trace.map(entry => entry.marker), ['second', 'first'])
      assert.ok(trace.every(entry => entry.hook === 'afterRollback' && entry.outcome === 'rolledBack' && entry.error === cause))
    })
  }

  it('rolls back when the callback catches a rejected participating write', async () => {
    let child
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(transaction, '99')
      await assert.rejects(fixture.api.resources.items.post({ inputRecord: { data: { type: 'items', id: '100', attributes: {} } }, transaction }), error => {
        child = error
        return assertWriteFailure(error, { outcome: 'pending' })
      })
      return 'Caught the failure'
    }), error => {
      assert.equal(error.cause, child)
      return assertWriteFailure(error, { outcome: 'rolledBack' })
    })
    assert.equal(child.transactionOutcome, 'pending')
    assert.equal(await fixture.count('items'), 1)
  })

  it('rolls back after a caught raw SQL error instead of committing an aborted unit', async () => {
    let cause
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(transaction, '99')
      try { await transaction.raw('BROKEN MANAGED STATEMENT;') } catch (error) { cause = error }
      assert.ok(cause)
    }), error => assertWriteFailure(error, { cause, outcome: 'rolledBack' }))
    assert.equal(await fixture.count('items'), 1)
    assert.ok(trace.every(entry => entry.hook === 'afterRollback'))
  })

  for (const read of [false, true]) {
    it(`rejects context reuse by a ${read ? 'read' : 'write'} until its owner completes`, async () => {
      const context = { marker: 'first' }
      await assert.rejects(fixture.api.transaction(async transaction => {
        await post(transaction, '99', 'first', context)
        if (read) await fixture.api.resources.items.get({ id: item.id, transaction }, context)
        else await post(transaction, '100', 'second', context)
      }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
      assert.deepEqual(trace.map(entry => entry.marker), ['first'])
      assert.equal(await fixture.count('items'), 1)
      trace = []
      await post(undefined, '100', 'second', context)
      assert.equal(await fixture.count('items'), 2)
    })
  }

  it('keeps committed rows and attempts later operation hooks after an afterCommit failure', async t => {
    let rollbacks = 0
    failure = { hook: 'afterCommit', marker: 'first', error: primary }
    await assert.rejects(fixture.api.transaction(async transaction => {
      const rollback = transaction.rollback.bind(transaction)
      t.mock.method(transaction, 'rollback', (...args) => { rollbacks++; return rollback(...args) })
      await post(transaction, '99', 'first')
      await post(transaction, '100', 'second')
    }), error => assertWriteFailure(error, { cause: primary, outcome: 'committed' }))
    assert.equal(rollbacks, 0, 'post-commit errors must not attempt rollback')
    assert.equal(await fixture.count('items'), 3)
    assert.deepEqual(trace.map(entry => entry.marker), ['first', 'second'])
    assert.ok(trace.every(entry => entry.hook === 'afterCommit'))
  })

  it('keeps the callback failure when a rollback hook fails and attempts remaining hooks', async () => {
    const context = {}
    failure = { hook: 'afterRollback', marker: 'second', error: secondary }
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(transaction, '99', 'first')
      await post(transaction, '100', 'second')
      throw primary
    }, context), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
    assert.equal(await fixture.count('items'), 1)
    assert.deepEqual(trace.map(entry => entry.marker), ['second', 'first'])
    assert.deepEqual(context.cleanupErrors, [{ phase: 'afterRollback', error: secondary, operationIndex: 1, scopeName: 'items', method: 'post' }])
  })

  for (const committed of [false, true]) {
    it(`orders ${committed ? 'commit' : 'rollback'} hooks by enlistment when overlapping writes finish in reverse order`, async () => {
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      pause = async () => { started.resolve(); await release.promise }
      const finished = []
      const work = fixture.api.transaction(async transaction => {
        const first = post(transaction, '99', 'first', { marker: 'first', pause: true }).then(() => { finished.push('first') })
        first.catch(() => {})
        try {
          await started.promise
          await post(transaction, '100', 'second')
          finished.push('second')
          assert.deepEqual(trace, [])
        } finally { release.resolve() }
        await first
        assert.deepEqual(finished, ['second', 'first'])
        assert.deepEqual(trace, [])
        if (!committed) throw primary
      })
      if (committed) await work
      else await assert.rejects(work, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
      assert.deepEqual(trace.map(entry => entry.marker), committed ? ['first', 'second'] : ['second', 'first'])
      assert.equal(await fixture.count('items'), committed ? 3 : 1)
    })

    for (const hookFailure of [false, true]) {
      it(`attempts all finalizers after ${committed ? 'commit' : 'rollback'} without replacing ${hookFailure ? 'a hook failure' : 'the original outcome'}`, async () => {
        const later = new Error('Later finalizer failed')
        const finalized = []
        const context = {}
        const hook = committed ? 'afterCommit' : 'afterRollback'
        if (hookFailure) failure = { hook, marker: 'first', error: primary }
        await assert.rejects(fixture.api.transaction(async transaction => {
          await post(transaction, '99', 'first', {
            marker: 'first',
            finalizers: [
              async () => { finalized.push('first'); throw secondary },
              async () => { await Promise.resolve(); finalized.push('second') },
              async () => { finalized.push('third'); throw later }
            ]
          })
          await post(transaction, '100', 'second')
          if (!committed) throw primary
        }, context), error => assertWriteFailure(error, {
          cause: committed && !hookFailure ? secondary : primary,
          outcome: committed ? 'committed' : 'rolledBack'
        }))
        assert.deepEqual(finalized, ['first', 'second', 'third'])
        assert.deepEqual(trace.map(entry => entry.marker), committed ? ['first', 'second'] : ['second', 'first'])
        assert.deepEqual(context.cleanupErrors, [
          ...(!committed && hookFailure ? [{ phase: hook, error: primary, operationIndex: 0, scopeName: 'items', method: 'post' }] : []),
          ...(!committed || hookFailure ? [{ phase: 'finalization', error: secondary, finalizerIndex: 0 }] : []),
          { phase: 'finalization', error: later, finalizerIndex: 2 }
        ])
        assert.equal(await fixture.count('items'), committed ? 3 : 1)
      })
    }
  }

  for (const cause of [null, undefined]) {
    it(`retains ${String(cause)} as the first finalization failure after commit`, async () => {
      const owner = {}
      await assert.rejects(fixture.api.transaction(async transaction => {
        await post(transaction, '99', 'first', {
          marker: 'first',
          finalizers: [async () => { throw cause }, async () => { throw secondary }]
        })
      }, owner), error => assertWriteFailure(error, { cause, outcome: 'committed' }))
      assert.deepEqual(owner.cleanupErrors, [{ phase: 'finalization', error: secondary, finalizerIndex: 1 }])
      assert.equal(await fixture.count('items'), 2)
    })
  }

  it('attempts final diagnostic collection after unknown completion without running outcome hooks', async () => {
    const finalized = []
    const owner = {}
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(transaction, '99', 'first', {
        marker: 'first',
        finalizers: [
          // eslint-disable-next-line no-throw-literal -- Verify non-Error finalizer failures.
          async () => { finalized.push('first'); throw null },
          async () => { finalized.push('second') },
          // eslint-disable-next-line no-throw-literal -- Verify non-Error finalizer failures.
          async () => { finalized.push('third'); throw undefined }
        ]
      })
      await transaction.commit()
    }, owner), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'unknown' }))
    assert.deepEqual(finalized, ['first', 'second', 'third'])
    assert.deepEqual(trace, [])
    assert.deepEqual(owner.cleanupErrors, [
      { phase: 'finalization', error: null, finalizerIndex: 0 },
      { phase: 'finalization', error: undefined, finalizerIndex: 2 }
    ])
    assert.equal(await fixture.count('items'), 2)
  })

  for (const phase of ['commit', 'rollback']) {
    for (const afterExecution of [false, true]) {
      it(`reports unknown when ${phase} fails ${afterExecution ? 'after' : 'before'} execution and releases enlisted contexts`, async () => {
        const owner = {}
        const context = { marker: 'first' }
        let completion
        try {
          await assert.rejects(fixture.api.transaction(async transaction => {
            await post(transaction, '99', 'first', context)
            completion = interceptTransactionCompletion(transaction, fixture.knex, { phase, afterExecution })
            if (phase === 'rollback') throw primary
          }, owner), error => assertWriteFailure(error, { cause: phase === 'commit' ? completion.error : primary, outcome: 'unknown' }))
          assert.equal(completion.calls, 1)
          assert.equal(completion.executed, afterExecution)
          assert.equal(completion.transaction.isCompleted(), true)
          assert.equal(context.transactionOutcome, 'unknown')
          assert.equal(context.transactionCommitted, false)
          assert.equal(completion.transaction.listenerCount('query-error'), 0)
          assert.deepEqual(owner.cleanupErrors, phase === 'rollback' ? [{ phase, error: completion.error }] : [])
          assert.deepEqual(trace, [])
        } finally { await completion?.close() }
        assert.equal(await fixture.count('items'), phase === 'commit' && afterExecution ? 2 : 1)
        await post(undefined, '100', 'first', context)
        assert.equal(context.transactionOutcome, 'committed')
        assert.deepEqual(trace.map(entry => entry.hook), ['afterCommit'])
      })
    }
  }

  it('rejects raw transaction participation without completing or writing to it', async () => {
    const transaction = await fixture.knex.transaction()
    try {
      await assert.rejects(post(transaction, '99'), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      assert.equal(transaction.isCompleted(), false)
      assert.deepEqual(trace, [])
    } finally { await transaction.rollback() }
    assert.equal(await fixture.count('items'), 1)
  })

  for (const completion of ['commit', 'rollback']) {
    it(`does not transfer ${completion} ownership when a participant hook changes its mutable context flag`, async () => {
      const pending = fixture.api.transaction(async transaction => {
        const write = post(transaction, '99', 'first', { marker: 'first', claimOwnership: completion })
        if (completion === 'rollback') await assert.rejects(write, error => assertWriteFailure(error, { cause: primary, outcome: 'pending' }))
        else await write
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual(trace, [])
        const pending = (await fixture.api.resources.items.query({ transaction })).data
        assert.equal(pending.some(row => row.id === '99'), completion === 'commit')
      })
      if (completion === 'rollback') await assert.rejects(pending, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
      else await pending
      assert.equal(await fixture.count('items'), completion === 'rollback' ? 1 : 2)
      assert.deepEqual(trace.map(entry => entry.hook), [completion === 'rollback' ? 'afterRollback' : 'afterCommit'])
    })
  }

  for (const failOwned of [false, true]) {
    it(`still ${failOwned ? 'rolls back' : 'commits'} an implicit owner when a hook clears its mutable context flag`, async () => {
      const context = { marker: 'owned', suppressOwnership: true, failOwned }
      const pending = post(undefined, '99', 'owned', context)
      if (failOwned) await assert.rejects(pending, error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
      else await pending
      assert.equal(context.transaction.isCompleted(), true)
      assert.equal(context.transactionOutcome, failOwned ? 'rolledBack' : 'committed')
      assert.equal(await fixture.count('items'), failOwned ? 1 : 2)
      assert.deepEqual(trace.map(entry => entry.hook), [failOwned ? 'afterRollback' : 'afterCommit'])
    })
  }

  it('rejects child savepoints and leaves the managed owner to roll back its unit', async () => {
    await assert.rejects(fixture.api.transaction(async transaction => {
      await post(transaction, '99')
      const child = await transaction.transaction()
      try {
        await assert.rejects(post(child, '100'), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
        assert.equal(child.isCompleted(), false)
      } finally { await child.rollback() }
    }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' }))
    assert.equal(await fixture.count('items'), 1)
  })

  for (const reject of [false, true]) {
    it(`waits for in-flight library work before rolling back an ${reject ? 'already rejected' : 'early-returned'} callback`, async () => {
      const started = Promise.withResolvers()
      const release = Promise.withResolvers()
      pause = async () => { started.resolve(); await release.promise }
      let pending; let finished = false
      const owner = fixture.api.transaction(async transaction => {
        pending = post(transaction, '99', 'pending', { marker: 'pending', pause: true })
        pending.catch(() => {})
        await started.promise
        if (reject) throw primary
        return 'Returned too early'
      })
      const outcome = owner.then(value => ({ value }), error => ({ error })).finally(() => { finished = true })
      try {
        await started.promise
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(finished, false)
        assert.deepEqual(trace, [])
      } finally { release.resolve() }
      const { error } = await outcome
      await pending.catch(() => {})
      assertWriteFailure(error, { ...(reject ? { cause: primary } : { type: RestApiValidationError }), outcome: 'rolledBack' })
      assert.equal(await fixture.count('items'), 1)
      assert.deepEqual(trace.map(entry => entry.hook), ['afterRollback'])
    })
  }

  for (const completion of ['commit', 'rollback']) {
    it(`reports unknown after unsupported callback-owned ${completion} and runs no completion hooks`, async () => {
      await assert.rejects(fixture.api.transaction(async transaction => {
        await post(transaction, '99')
        await transaction[completion]()
      }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'unknown' }))
      assert.equal(await fixture.count('items'), completion === 'commit' ? 2 : 1)
      assert.deepEqual(trace, [])
    })
  }
})
