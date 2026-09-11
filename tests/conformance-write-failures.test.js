import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi, createManagedTransactionApi, createQueryConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { abortTransactionBeforeCommit, interceptTransactionCompletion } from './helpers/transaction-completion.js'
import { databaseClient } from './helpers/test-database.js'

const operations = [
  { name: 'POST', method: 'post' },
  { name: 'PUT-create', method: 'put', creates: true },
  { name: 'PUT-update', method: 'put' },
  { name: 'PATCH', method: 'patch' },
  { name: 'DELETE', method: 'delete' },
  ...['postRelationship', 'patchRelationship', 'deleteRelationship'].map(method => ({ name: method, method, relationship: true }))
]

describe(`Write outcome snapshots (${storageMode.mode})`, () => {
  let fixture, phase, inspectFailure
  const primary = Object.freeze(new RestApiValidationError('Write outcome failure'))
  const inputRecord = { data: { type: 'items', id: '1', attributes: { name: 'Item' } } }
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { bulk: true } })
    await fixture.api.customize({
      hooks: Object.fromEntries(['finish', 'afterCommit'].map(name => [name, {
        functionName: `fail-outcome-${name}`,
        handler: ({ context }) => {
          if (phase === name) {
            inspectFailure?.(context)
            throw primary
          }
        }
      }]))
    })
  })
  beforeEach(async () => { phase = undefined; inspectFailure = undefined; await fixture.reset() })
  after(async () => { await fixture?.close() })

  for (const operation of operations) {
    it(`${operation.name} reports none for validation before accepting a transaction, even with reused context`, async () => {
      const context = {}
      await fixture.api.resources.items.post({ inputRecord: structuredClone(inputRecord) }, context)
      assert.equal(context.transactionCommitted, true)
      await assert.rejects(fixture.api.resources.items[operation.method]({ format: 'invalid' }, context), error =>
        assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      assert.equal(context.transaction, undefined)
      assert.equal(context.transactionCommitted, false)
      assert.equal(await fixture.count('items'), 1)
    })
  }

  it('retains a pending snapshot after the owner rolls back and the same failure is reused', async () => {
    phase = 'finish'
    let pending
    await assert.rejects(fixture.api.transaction(async transaction => {
      await assert.rejects(fixture.api.resources.items.post({ inputRecord: structuredClone(inputRecord), transaction }), error => {
        pending = error
        return assertWriteFailure(error, { cause: primary, outcome: 'pending' })
      })
      assert.equal(transaction.isCompleted(), false)
      assert.equal((await transaction(fixture.storage === 'anyapi' ? 'any_records' : 'conformance_items')).length, 1)
    }), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
    await assert.rejects(fixture.api.resources.items.post({ inputRecord: structuredClone(inputRecord) }), error => {
      assert.notEqual(error, pending)
      return assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' })
    })
    assert.equal(pending.transactionOutcome, 'pending')
    assert.equal(await fixture.count('items'), 0)
  })

  it('reports committed when the post-commit hook fails and retains the stored row', async t => {
    let rollbacks = 0
    inspectFailure = ({ transaction }) => {
      const rollback = transaction.rollback.bind(transaction)
      t.mock.method(transaction, 'rollback', (...args) => { rollbacks++; return rollback(...args) })
    }
    phase = 'afterCommit'
    await assert.rejects(fixture.api.resources.items.post({ inputRecord: structuredClone(inputRecord) }), error =>
      assertWriteFailure(error, { cause: primary, outcome: 'committed' }))
    assert.equal(rollbacks, 0, 'post-commit errors must not attempt rollback')
    assert.equal(await fixture.count('items'), 1)
  })

  it('keeps an atomic child pending snapshot below the outer rollback snapshot', async () => {
    phase = 'finish'
    await assert.rejects(fixture.api.resources.items.bulkPost({ inputRecords: [structuredClone(inputRecord.data)] }), error => {
      assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' })
      return assertWriteFailure(error.cause, { cause: primary, outcome: 'pending' })
    })
    assert.equal(await fixture.count('items'), 0)
  })

  it('rejects an already-completed raw handle before acceptance without completing it again', async () => {
    const transaction = await fixture.knex.transaction()
    await transaction.rollback()
    await assert.rejects(fixture.api.resources.items.post({ inputRecord: structuredClone(inputRecord), transaction }), error =>
      assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
    assert.equal(await fixture.count('items'), 0)
  })
})

if (databaseClient === 'pg') {
  describe(`Aborted PostgreSQL commits (${storageMode.mode})`, () => {
    let fixture, group, item, other, enabled, state, afterCommit, afterRollback, participants
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        apiOptions: { bulk: true, inverseMembership: true },
        tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
      })
      await fixture.api.customize({
        hooks: {
          finish: {
            functionName: 'abort-postgres-before-commit',
            handler: ({ context }) => {
              if (enabled && operations.some(operation => operation.method === context.method)) {
                participants.add(context)
                state ||= abortTransactionBeforeCommit(context.transaction)
              }
            }
          },
          afterCommit: { functionName: 'count-aborted-commit-hooks', handler: () => { if (enabled) afterCommit++ } },
          afterRollback: { functionName: 'count-confirmed-rollback-hooks', handler: () => { if (enabled) afterRollback++ } }
        }
      })
    })
    beforeEach(async () => {
      enabled = false
      state = undefined
      afterCommit = afterRollback = 0
      participants = new Set()
      await fixture.reset()
      group = await fixture.seed('groups', { name: 'Group' })
      item = await fixture.seed('items', { name: 'Original' })
      other = await fixture.seed('items', { name: 'Other' })
      await fixture.api.resources.groups.postRelationship({
        id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.id }]
      })
    })
    after(async () => { await fixture?.close() })

    for (const operation of [...operations, ...['bulkPost', 'bulkPatch', 'bulkDelete'].map(method => ({ name: method, method, bulk: true }))]) {
      it(`${operation.name} rejects a confirmed rollback without issuing a second rollback or a commit hook`, async () => {
        const record = (id, name) => ({ type: 'items', id, attributes: { name, ...(operation.method === 'put' ? { active: true, score: 0 } : {}) } })
        const id = operation.creates || operation.method === 'post' ? '99' : operation.method === 'delete' ? other.id : item.id
        const params = operation.relationship
          ? { id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: operation.method === 'deleteRelationship' ? item.id : other.id }] }
          : operation.method === 'bulkPost'
            ? { inputRecords: [record('99', 'Changed'), record('100', 'Changed')] }
            : operation.method === 'bulkPatch'
              ? { operations: [item.id, other.id].map(id => ({ id, data: record(id, 'Changed') })) }
              : operation.method === 'bulkDelete'
                ? { ids: [item.id, other.id] }
                : { id, inputRecord: { data: record(id, 'Changed') }, format: 'jsonapi', returning: 'full' }
        const resource = fixture.api.resources[operation.relationship ? 'groups' : 'items']
        const context = {}
        enabled = true
        let error
        try {
          try { await resource[operation.method](params, context) } catch (caught) { error = caught }
          assert.equal(state.command, 'ROLLBACK')
          assert.equal(state.resolved, true)
          assert.equal(state.transaction.isCompleted(), true)
          assert.equal(state.commits, 1)
          assert.equal(state.rollbacks, 0)
        } finally {
          enabled = false
          await state?.close()
        }
        assert.equal(await fixture.count('items'), 2)
        assert.equal((await fixture.api.resources.items.get({ id: item.id, format: 'plain' })).name, 'Original')
        assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data, [{ type: 'items', id: item.id }])
        assert.ok(error instanceof Error, 'The API must reject a write that PostgreSQL rolled back')
        assert.match(error.message, /rolled back instead of committed/i)
        assert.equal(context.error, error.cause)
        assert.equal(afterCommit, 0)
        assert.equal(afterRollback, participants.size)
        if (!operation.bulk) assert.equal(context.transactionCommitted, false)
        assert.deepEqual(context.cleanupErrors, [])
      })
    }
  })
}

describe(`Driver completion failures (${storageMode.mode})`, () => {
  let fixture, group, item, other, enabled, state, failure, afterCommit, afterRollback
  const primary = new RestApiValidationError('Write failed before rollback')
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { bulk: true, inverseMembership: true },
      databaseOptions: { concurrent: true, maxConnections: 1 },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: {
        finish: {
          functionName: 'intercept-driver-completion',
          handler: ({ context }) => {
            if (!enabled || !operations.some(operation => operation.method === context.method)) return
            state ||= interceptTransactionCompletion(context.transaction, fixture.knex, failure)
            if (failure.phase === 'rollback' && (!context.bulkOperation || context.bulkIndex === 1)) throw primary
          }
        },
        afterCommit: { functionName: 'count-driver-commit-hooks', handler: () => { if (enabled) afterCommit++ } },
        afterRollback: { functionName: 'count-driver-rollback-hooks', handler: () => { if (enabled) afterRollback++ } }
      }
    })
  })
  beforeEach(async () => {
    enabled = false
    state = undefined
    afterCommit = afterRollback = 0
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' })
    other = await fixture.seed('items', { name: 'Other' })
    await fixture.api.resources.groups.postRelationship({
      id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.id }]
    })
  })
  after(async () => { await fixture?.close() })

  for (const operation of [...operations, ...['bulkPost', 'bulkPatch', 'bulkDelete'].map(method => ({ name: method, method, bulk: true }))]) {
    for (const phase of ['commit', 'rollback']) {
      for (const afterExecution of [false, true]) {
        it(`${operation.name} observes ${phase} failure ${afterExecution ? 'after execution' : 'from SQL'} even when the method resolves`, async () => {
          failure = { phase, afterExecution }
          const id = operation.creates || operation.method === 'post' ? '99' : operation.method === 'delete' ? other.id : item.id
          const record = (id, name) => ({ type: 'items', id, attributes: { name, ...(operation.method === 'put' ? { active: true, score: 0 } : {}) } })
          const params = operation.relationship
            ? { id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: operation.method === 'deleteRelationship' ? item.id : other.id }] }
            : operation.method === 'bulkPost'
              ? { inputRecords: [record('99', 'Changed'), record('100', 'Changed')] }
              : operation.method === 'bulkPatch'
                ? { operations: [item.id, other.id].map(id => ({ id, data: record(id, 'Changed') })) }
                : operation.method === 'bulkDelete'
                  ? { ids: [item.id, other.id] }
                  : { id, inputRecord: { data: record(id, 'Changed') }, format: 'jsonapi', returning: 'full' }
          const resource = fixture.api.resources[operation.relationship ? 'groups' : 'items']
          const context = {}
          enabled = true
          try {
            await assert.rejects(resource[operation.method](params, context), error => {
              assertWriteFailure(error, { cause: phase === 'commit' ? state.error : primary, outcome: 'unknown' })
              return true
            })
            assert.equal(state.calls, 1)
            assert.equal(state.methodResolved, true)
            assert.equal(state.executionError, state.error)
            assert.equal(state.transaction.isCompleted(), true)
            assert.equal(afterCommit, 0)
            assert.equal(afterRollback, 0)
            if (!operation.bulk) assert.equal(context.transactionCommitted, false)
            assert.deepEqual(context.cleanupErrors, phase === 'rollback' ? [{ phase, error: state.error }] : [])
          } finally {
            enabled = false
            await state?.close()
          }

          const committed = phase === 'commit' && afterExecution
          const created = operation.method === 'bulkPost' ? 2 : operation.method === 'post' || operation.creates ? 1 : 0
          const deleted = operation.method === 'bulkDelete' ? 2 : operation.method === 'delete' ? 1 : 0
          assert.equal(await fixture.count('items'), 2 + (committed ? created - deleted : 0))
          if (!(committed && operation.method === 'bulkDelete')) {
            const changed = committed && !operation.creates && ['put', 'patch', 'bulkPatch'].includes(operation.method)
            assert.equal((await fixture.api.resources.items.get({ id: item.id, format: 'plain' })).name, changed ? 'Changed' : 'Original')
          }
          const members = !committed
            ? [item.id]
            : operation.method === 'postRelationship'
              ? [item.id, other.id]
              : operation.method === 'patchRelationship'
                ? [other.id]
                : ['deleteRelationship', 'bulkDelete'].includes(operation.method) ? [] : [item.id]
          assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data, members.map(id => ({ type: 'items', id })))
        })
      }
    }
  }
})

describe(`Owned savepoint rejection (${storageMode.mode})`, () => {
  let fixture, outer, child, group, item, other, enabled, commits, rollbacks
  const record = (id, name) => ({ type: 'items', id, attributes: { name, active: true, score: 0 } })
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createManagedTransactionApi,
      apiOptions: { bulk: true, inverseMembership: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      helpers: { newTransaction: async () => outer ? (child = await outer.transaction()) : fixture.knex.transaction() },
      hooks: {
        afterCommit: { functionName: 'observe-savepoint-commit', handler: () => { if (enabled) commits++ } },
        afterRollback: { functionName: 'observe-savepoint-rollback', handler: () => { if (enabled) rollbacks++ } }
      }
    })
  })
  beforeEach(async () => {
    enabled = false
    outer = child = undefined
    commits = rollbacks = 0
    await fixture.reset()
    await cleanTables(fixture.knex, ['managed_transaction_audit'], { storage: 'knex' })
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' })
    other = await fixture.seed('items', { name: 'Other' })
    await fixture.api.resources.groups.postRelationship({
      id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.id }]
    })
  })
  after(async () => { await fixture?.close() })

  for (const operation of [...operations, ...['bulkPost', 'bulkPatch', 'bulkDelete'].map(method => ({ name: method, method, bulk: true }))]) {
    it(`${operation.name} rejects owned savepoint completion and preserves unrelated outer work`, async () => {
      outer = await fixture.knex.transaction()
      const context = {}
      try {
        await outer('managed_transaction_audit').insert({ message: 'Outer work' })
        const id = operation.creates || operation.method === 'post' ? '99' : operation.method === 'delete' ? other.id : item.id
        const params = operation.relationship
          ? { id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: operation.method === 'deleteRelationship' ? item.id : other.id }] }
          : operation.method === 'bulkPost'
            ? { inputRecords: [record('99', 'Changed'), record('100', 'Changed')] }
            : operation.method === 'bulkPatch'
              ? { operations: [item.id, other.id].map(id => ({ id, data: record(id, 'Changed') })) }
              : operation.method === 'bulkDelete'
                ? { ids: [item.id, other.id] }
                : { id, inputRecord: { data: record(id, 'Changed') }, format: 'jsonapi', returning: 'full' }
        const resource = fixture.api.resources[operation.relationship ? 'groups' : 'items']
        enabled = true
        await assert.rejects(resource[operation.method](params, context), error => {
          assertWriteFailure(error, { type: RestApiValidationError, outcome: 'rolledBack' })
          assert.match(error.message, /owned transactions must be top-level/i)
          return true
        })
        assert.equal(commits, 0)
        assert.equal(rollbacks, 0)
        assert.equal(child.parentTransaction, outer)
        assert.equal(child.isCompleted(), true)
        assert.equal(outer.isCompleted(), false)
        assert.equal(context.transactionCommitted, false)
        await outer.commit()
      } finally {
        enabled = false
        if (child && !child.isCompleted()) await child.rollback()
        if (!outer.isCompleted()) await outer.rollback()
        outer = undefined
      }
      assert.equal(await fixture.count('items'), 2)
      assert.deepEqual(await fixture.knex('managed_transaction_audit').select('message'), [{ message: 'Outer work' }])
      assert.equal((await fixture.api.resources.items.get({ id: item.id, format: 'plain' })).name, 'Original')
      assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data, [{ type: 'items', id: item.id }])
    })
  }

  for (const commit of [false, true]) {
    it(`rejects savepoint library writes while leaving raw SQL and outer ${commit ? 'commit' : 'rollback'} with the caller`, async () => {
      outer = await fixture.knex.transaction()
      child = await outer.transaction()
      enabled = true
      try {
        await child('managed_transaction_audit').insert({ message: 'Raw savepoint work' })
        await assert.rejects(fixture.api.resources.items.post({ inputRecord: { data: record('99', 'Rejected work') }, transaction: child }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
        assert.equal(child.isCompleted(), false)
        assert.equal(commits, 0)
        assert.equal(rollbacks, 0)
        await child.commit()
        assert.equal(outer.isCompleted(), false)
        assert.deepEqual(await outer('managed_transaction_audit').select('message'), [{ message: 'Raw savepoint work' }])
        if (commit) await outer.commit()
        else await outer.rollback()
      } finally {
        enabled = false
        if (!child.isCompleted()) await child.rollback()
        if (!outer.isCompleted()) await outer.rollback()
        outer = undefined
      }
      assert.equal(await fixture.count('items'), 2)
      assert.deepEqual(await fixture.knex('managed_transaction_audit').select('message'), commit ? [{ message: 'Raw savepoint work' }] : [])
      assert.equal(commits, 0)
      assert.equal(rollbacks, 0)
    })
  }
})

describe(`Secondary write failures (${storageMode.mode})`, () => {
  let fixture, group, item, other, enabled, rollbackOriginal, rollbackAttempts, cleanupCalls, accepted, completionContext
  const primary = new RestApiValidationError('Original write failure')
  const secondary = new Error('Secondary cleanup failure')

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      databaseOptions: { concurrent: true, maxConnections: 1 },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'observe-write-failure-participation',
          handler: ({ context, scopeName }) => {
            const original = context.originalContext || context
            if (enabled && operations.some(operation => operation.method === original.method) && !accepted.some(entry => entry.context === original)) {
              accepted.push({ context: original, scopeName, method: original.method })
            }
          }
        },
        finish: {
          functionName: 'fail-write-before-completion',
          handler: ({ context }) => {
            if (!enabled || context.method !== context.failMethod) return
            rollbackOriginal = context.transaction.rollback.bind(context.transaction)
            context.transaction.rollback = async () => {
              rollbackAttempts++
              if (context.failedCleanup === 'rollback') throw secondary
              return rollbackOriginal()
            }
            if (context.failedCleanup === 'commitAfterCompletion') {
              const commit = context.transaction.commit.bind(context.transaction)
              context.transaction.commit = async () => { await commit(); throw primary }
              return
            }
            throw primary
          }
        },
        afterRollback: {
          functionName: 'fail-cleanup-after-rollback',
          handler: ({ context }) => {
            if (!enabled) return
            cleanupCalls++
            assert.equal(context.error, context.method === context.failMethod ? primary : completionContext.error)
            assert.equal(context.transaction.isCompleted(), true)
            if (context.failedCleanup === 'afterRollback') throw secondary
          }
        }
      }
    })
  })
  beforeEach(async () => {
    enabled = false
    rollbackOriginal = undefined
    rollbackAttempts = cleanupCalls = 0
    accepted = []
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' })
    other = await fixture.seed('items', { name: 'Other' })
    await fixture.api.resources.groups.postRelationship({
      id: group.id, relationshipName: 'members', relationshipData: [{ type: 'items', id: item.id }]
    })
  })
  after(async () => { await fixture?.close() })

  for (const operation of operations) {
    for (const managed of [false, true]) {
      for (const failedCleanup of ['none', 'rollback', 'afterRollback', ...(!managed ? ['commitAfterCompletion'] : [])]) {
        it(`${operation.name} preserves the original error with ${failedCleanup} cleanup failure and ${managed ? 'managed' : 'owned'} transaction`, async () => {
          const context = { failMethod: operation.method, failedCleanup }
          const owner = {}
          completionContext = managed ? owner : context
          const committed = failedCleanup === 'commitAfterCompletion'
          const id = operation.creates || operation.method === 'post' ? '99' : operation.method === 'delete' ? other.id : item.id
          const params = operation.relationship
            ? {
                id: group.id,
                relationshipName: 'members',
                relationshipData: [{ type: 'items', id: operation.method === 'deleteRelationship' ? item.id : other.id }]
              }
            : {
                id,
                inputRecord: { data: { type: 'items', id, attributes: { name: 'Changed', ...(operation.method === 'put' ? { active: true, score: 0 } : {}) } } },
                format: 'jsonapi',
                returning: 'full'
              }
          const resource = fixture.api.resources[operation.relationship ? 'groups' : 'items']
          enabled = true
          try {
            const outcome = committed || failedCleanup === 'rollback' ? 'unknown' : 'rolledBack'
            const check = async transaction => {
              await assert.rejects(resource[operation.method]({ ...params, transaction }, context), error => assertWriteFailure(error, { cause: primary, outcome: managed ? 'pending' : outcome }))
              if (managed) {
                assert.equal(context.transaction, transaction)
                assert.equal(transaction.isCompleted(), false)
                assert.equal(rollbackAttempts, 0)
                assert.equal(cleanupCalls, 0)
                assert.deepEqual(context.cleanupErrors, [])
              }
            }
            if (managed) await assert.rejects(fixture.api.transaction(check, owner), error => assertWriteFailure(error, { cause: primary, outcome }))
            else await check()
            assert.equal(context.error, primary)
            assert.equal(context.transactionCommitted, false)
            assert.equal(context.transactionOutcome, outcome)
            assert.equal(rollbackAttempts, committed ? 0 : 1)
            assert.equal(cleanupCalls, committed || failedCleanup === 'rollback' ? 0 : accepted.length)
            assert.equal(context.transaction.isCompleted(), failedCleanup !== 'rollback')
            const cleanup = failedCleanup === 'rollback'
              ? [{ phase: 'rollback', error: secondary }]
              : failedCleanup === 'afterRollback'
                ? accepted.map(({ scopeName, method }, operationIndex) => ({ phase: 'afterRollback', error: secondary, operationIndex, scopeName, method })).reverse()
                : []
            assert.deepEqual((managed ? owner : context).cleanupErrors, cleanup)
          } finally {
            enabled = false
            if (context.transaction && !context.transaction.isCompleted()) await (rollbackOriginal || context.transaction.rollback.bind(context.transaction))()
          }
          assert.equal(await fixture.count('items'), committed && (operation.creates || operation.method === 'post') ? 3 : committed && operation.method === 'delete' ? 1 : 2)
          assert.equal((await fixture.api.resources.items.get({ id: item.id, format: 'plain' })).name, committed && !operation.creates && ['put', 'patch'].includes(operation.method) ? 'Changed' : 'Original')
          const expectedMembers = !committed || !operation.relationship
            ? [item.id]
            : operation.method === 'postRelationship'
              ? [item.id, other.id]
              : operation.method === 'patchRelationship' ? [other.id] : []
          assert.deepEqual((await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data, expectedMembers.map(id => ({ type: 'items', id })))

          if (!committed) {
            await resource[operation.method](params, context)
            assert.equal(context.error, undefined)
            assert.equal(context.cleanupErrors, undefined)
          }
        })
      }
    }
  }
})
