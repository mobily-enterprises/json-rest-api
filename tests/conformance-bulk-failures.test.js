import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Atomic bulk failure cleanup (${storageMode.mode})`, () => {
  let fixture, group, item, other, probe
  const primary = new RestApiValidationError('Original bulk failure')
  const secondary = new Error('Bulk rollback failed')
  const identifier = ({ type, id }) => ({ type, id })

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
          functionName: 'bulk-failure-probe',
          handler: ({ context }) => {
            if (!probe || !context.bulkOperation || context.method !== probe.method) return
            if (context.bulkIndex === 0) {
              probe.transaction = context.transaction
              probe.rollback = context.transaction.rollback.bind(context.transaction)
              const commit = context.transaction.commit.bind(context.transaction)
              context.transaction.rollback = async () => {
                probe.rollbackAttempts++
                if (probe.failRollback) throw secondary
                return probe.rollback()
              }
              context.transaction.commit = async () => {
                probe.commitAttempts++
                if (probe.failure === 'commit') throw primary
                const result = await commit()
                if (probe.failure === 'commit-after-acknowledgment') throw primary
                return result
              }
            }
            if (context.bulkIndex === 1 && probe.failure === 'child') throw primary
          }
        }
      }
    })
  })
  beforeEach(async () => {
    probe = undefined
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' }, { groups: { data: [identifier(group)] } })
    other = await fixture.seed('items', { name: 'Other' })
  })
  after(async () => { await fixture?.close() })

  const paramsFor = method => {
    const record = (id, name) => ({
      type: 'items', id, attributes: { name }, relationships: { groups: { data: [identifier(group)] } }
    })
    if (method === 'post') return { document: { data: [record('91', 'Created first'), record('92', 'Created second')] } }
    if (method === 'patch') {
      return {
        operations: [
          { id: item.id, document: { data: record(item.id, 'Changed first') } },
          { id: other.id, document: { data: record(other.id, 'Changed second') } }
        ]
      }
    }
    return { ids: [item.id, other.id] }
  }
  const inspect = async (method, committed) => {
    const records = (await fixture.api.resources.items.query({ format: 'plain', queryParams: { sort: ['id'] } })).data
    const expected = !committed
      ? ['Original', 'Other']
      : method === 'post'
        ? ['Original', 'Other', 'Created first', 'Created second']
        : method === 'patch' ? ['Changed first', 'Changed second'] : []
    assert.deepEqual(records.map(record => record.name), expected)
    const members = (await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data
    const expectedIds = !committed ? [item.id] : method === 'post' ? [item.id, '91', '92'] : method === 'patch' ? [item.id, other.id] : []
    assert.deepEqual(members.map(record => record.id).sort(), expectedIds.sort())
  }

  for (const method of ['post', 'patch', 'delete']) {
    const bulkMethod = `bulk${method[0].toUpperCase()}${method.slice(1)}`
    for (const failure of ['child', 'commit', 'commit-after-acknowledgment', ...(method === 'patch' ? ['invalid-operation'] : [])]) {
      for (const failRollback of [false, true]) {
        it(`${bulkMethod} preserves ${failure} failure with ${failRollback ? 'rejected' : 'successful'} rollback`, async () => {
          const params = paramsFor(method)
          if (failure === 'invalid-operation') params.operations[1] = { id: other.id }
          const context = { error: new Error('Stale failure'), cleanupErrors: [{ phase: 'rollback', error: secondary }] }
          probe = { method, failure, failRollback, rollbackAttempts: 0, commitAttempts: 0 }
          const observed = probe
          const committed = failure === 'commit-after-acknowledgment'
          try {
            await assert.rejects(fixture.api.resources.items[bulkMethod]({ ...params, atomic: true }, context), error => {
              if (failure === 'invalid-operation') {
                assertWriteFailure(error, { type: RestApiValidationError, outcome: failRollback ? 'unknown' : 'rolledBack' })
                assert.equal(error.message, 'Supply exactly one of data or document')
                assert.deepEqual(error.details.fields, ['data', 'document'])
              } else assertWriteFailure(error, { cause: primary, outcome: committed || failRollback ? 'unknown' : 'rolledBack' })
              assert.equal(context.error, error.cause)
              return true
            })
            assert.equal(observed.rollbackAttempts, committed ? 0 : 1)
            assert.equal(observed.commitAttempts, failure.startsWith('commit') ? 1 : 0)
            assert.equal(observed.transaction.isCompleted(), committed || !failRollback)
            assert.deepEqual(context.cleanupErrors, !committed && failRollback ? [{ phase: 'rollback', error: secondary }] : [])
          } finally {
            probe = undefined
            if (observed.transaction && !observed.transaction.isCompleted()) await observed.rollback()
          }
          await inspect(method, committed)

          // Reuse the failed operation's context after cleanup, including its validation path.
          await assert.rejects(fixture.api.resources.items[bulkMethod]({}, context), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
          assert.ok(context.error instanceof RestApiValidationError)
          assert.equal(context.cleanupErrors, undefined)
          if (!committed) {
            await fixture.api.resources.items[bulkMethod]({ ...paramsFor(method), atomic: true }, context)
            assert.equal(context.error, undefined)
            assert.equal(context.cleanupErrors, undefined)
            await inspect(method, true)
          }
        })
      }
    }
  }
})

describe(`Bulk child cleanup diagnostics (${storageMode.mode})`, () => {
  let fixture, group, records, enabled, postCommitFailure, rollbackRejection, children
  const primary = [new RestApiValidationError('First entry failed'), new RestApiValidationError('Third entry failed')]
  const secondary = [new Error('First cleanup failed'), new Error('Third cleanup failed')]
  const identifier = ({ type, id }) => ({ type, id })
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { bulk: true, inverseMembership: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: {
        finish: {
          functionName: 'bulk-child-failure',
          handler: ({ context, scopeName }) => {
            if (!enabled || scopeName !== 'items' || !context.bulkOperation || !['post', 'patch', 'delete'].includes(context.method)) return
            children.set(context.bulkIndex, context)
            if (context.bulkIndex === 0 || (context.bulkIndex === 2 && !postCommitFailure)) {
              if (rollbackRejection) {
                const rollback = context.transaction.rollback.bind(context.transaction)
                context.transaction.rollback = async () => { await rollback(); throw secondary[context.bulkIndex / 2] }
              }
              throw primary[context.bulkIndex / 2]
            }
          }
        },
        afterRollback: {
          functionName: 'bulk-child-cleanup-failure',
          handler: ({ context }) => {
            if (enabled && children.get(context.bulkIndex) === context) throw secondary[context.bulkIndex / 2]
          }
        },
        afterCommit: {
          functionName: 'bulk-child-post-commit-failure',
          handler: ({ context }) => {
            if (enabled && postCommitFailure && children.get(2) === context) throw primary[1]
          }
        }
      }
    })
  })
  beforeEach(async () => {
    enabled = false
    children = new Map()
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    records = []
    for (let index = 0; index < 4; index++) records.push(await fixture.seed('items', { name: `Original ${index}` }, { groups: { data: [identifier(group)] } }))
  })
  after(async () => { await fixture?.close() })

  for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
    for (const failure of ['beforeCommit', 'afterCommit', 'rollback']) {
      it(`${method} preserves indexed cleanup errors and later writes after ${failure} failure`, async () => {
        const afterCommit = failure === 'afterCommit'
        postCommitFailure = afterCommit
        rollbackRejection = failure === 'rollback'
        const ids = method === 'bulkPost' ? ['91', '92', '93', '94'] : records.map(record => record.id)
        const input = ids.map((id, index) => ({ type: 'items', id, attributes: { name: `Changed ${index}` }, relationships: { groups: { data: [identifier(group)] } } }))
        const params = method === 'bulkPost'
          ? { document: { data: input } }
          : method === 'bulkPatch' ? { operations: input.map(data => ({ id: data.id, document: { data } })) } : { ids }
        const context = { error: primary[0], cleanupErrors: [{ phase: 'stale' }] }
        enabled = true
        const result = await fixture.api.resources.items[method]({ ...params, atomic: false }, context)
        enabled = false
        assert.deepEqual(result.meta, { total: 4, succeeded: 2, failed: 2, ...(method === 'bulkDelete' ? { deleted: [ids[1], ids[3]] } : {}), atomic: false })
        assert.deepEqual(result.errors.map(entry => [entry.index, entry.error.code, entry.error.message]), [[0, primary[0].code, primary[0].message], [2, primary[1].code, primary[1].message]])
        assert.deepEqual(result.errors.map(entry => entry.error.transactionOutcome), [
          rollbackRejection ? 'unknown' : 'rolledBack',
          afterCommit ? 'committed' : rollbackRejection ? 'unknown' : 'rolledBack'
        ])
        if (method !== 'bulkDelete') assert.deepEqual(result.data.map(record => record.id), [ids[1], ids[3]])
        assert.equal(context.error, undefined)
        const completionDetails = rollbackRejection ? {} : { operationIndex: 0, scopeName: 'items', method: method.slice(4).toLowerCase() }
        assert.deepEqual(context.cleanupErrors, [
          { phase: rollbackRejection ? 'rollback' : 'afterRollback', error: secondary[0], bulkIndex: 0, ...completionDetails },
          ...(!afterCommit ? [{ phase: rollbackRejection ? 'rollback' : 'afterRollback', error: secondary[1], bulkIndex: 2, ...completionDetails }] : [])
        ])
        assert.equal(children.size, 4)
        for (const [index, child] of children) {
          assert.equal(child.transaction.isCompleted(), true)
          assert.equal(child.transactionCommitted, index % 2 === 1 || (index === 2 && afterCommit))
          if (child.cleanupErrors?.length) {
            assert.equal(Object.hasOwn(child.cleanupErrors[0], 'bulkIndex'), false)
            assert.notEqual(context.cleanupErrors.find(entry => entry.bulkIndex === index), child.cleanupErrors[0])
          }
        }
        const stored = (await fixture.api.resources.items.query({ format: 'plain' })).data
        const committed = new Set([ids[1], ids[3], ...(afterCommit ? [ids[2]] : [])])
        for (const [index, id] of ids.entries()) {
          const row = stored.find(record => record.id === id)
          if (method === 'bulkDelete' ? committed.has(id) : method === 'bulkPost' && !committed.has(id)) assert.equal(row, undefined)
          else assert.equal(row.name, committed.has(id) ? `Changed ${index}` : `Original ${index}`)
        }
        const members = (await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members' })).data.map(record => record.id).sort()
        const expected = method === 'bulkPost' ? [...records.map(record => record.id), ...committed] : method === 'bulkDelete' ? ids.filter(id => !committed.has(id)) : ids
        assert.deepEqual(members, expected.sort())
        assert.equal(JSON.stringify(result).includes('cleanup failed'), false)

        await assert.rejects(fixture.api.resources.items[method]({}, context), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
        assert.ok(context.error instanceof RestApiValidationError)
        assert.equal(context.cleanupErrors, undefined)
        await fixture.api.resources.items.bulkPost({ document: { data: [{ type: 'items', id: '999', attributes: { name: 'Recovered' } }] }, atomic: false }, context)
        assert.equal(context.cleanupErrors, undefined)
      })
    }
  }
})

describe(`Managed bulk transactions (${storageMode.mode})`, () => {
  let fixture, group, item, other, initial, failureIndex, trace
  const transactions = []
  const auth = { userId: 'bulk-owner' }
  const primary = new RestApiValidationError('Managed bulk child failed')
  const rollbackRequested = new Error('Callback requested rollback')
  const identifier = ({ type, id }) => ({ type, id })

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      apiOptions: { bulk: true, inverseMembership: true },
      databaseOptions: { concurrent: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: Object.fromEntries(['afterDataCall', 'finish', 'afterCommit', 'afterRollback'].map(phase => [phase, {
        functionName: `observe-managed-bulk-${phase}`,
        handler: async ({ context, scopeName }) => {
          if (scopeName !== 'items' || !context.bulkOperation || !['post', 'patch', 'delete'].includes(context.method)) return
          await Promise.resolve()
          trace.push({ phase, index: context.bulkIndex, transaction: context.transaction, shouldCommit: context.shouldCommit, auth: context.auth })
          if (phase === 'finish' && context.bulkIndex === failureIndex) throw primary
        }
      }]))
    })
  })
  const snapshot = async transaction => ({
    rows: (await fixture.api.resources.items.query({ format: 'plain', transaction, queryParams: { sort: ['id'] } })).data.map(({ id, name }) => ({ id, name })),
    members: (await fixture.api.resources.groups.getRelationship({ id: group.id, relationshipName: 'members', transaction })).data.map(({ id }) => id).sort(),
    groupName: (await fixture.api.resources.groups.get({ id: group.id, format: 'plain', transaction })).name
  })
  beforeEach(async () => {
    failureIndex = undefined
    trace = []
    await fixture.reset()
    group = await fixture.seed('groups', { name: 'Group' })
    item = await fixture.seed('items', { name: 'Original' }, { groups: { data: [identifier(group)] } })
    other = await fixture.seed('items', { name: 'Other' })
    initial = await snapshot()
  })
  afterEach(async () => {
    failureIndex = undefined
    for (const { transaction, rollback } of transactions) if (!transaction.isCompleted()) await rollback()
    transactions.length = 0
  })
  after(async () => { await fixture?.close() })

  const observe = transaction => {
    const observed = { transaction, commits: 0, rollbacks: 0, rollback: transaction.rollback.bind(transaction) }
    const commit = transaction.commit.bind(transaction)
    transaction.commit = async () => { observed.commits++; return commit() }
    transaction.rollback = async () => { observed.rollbacks++; return observed.rollback() }
    transactions.push(observed)
    return observed
  }
  const paramsFor = (method, format = 'jsonapi') => {
    const record = (id, name) => format === 'plain'
      ? { id, name, groups: [group.id] }
      : { type: 'items', id, attributes: { name }, relationships: { groups: { data: [identifier(group)] } } }
    if (method === 'bulkPost') {
      const records = [record('91', 'First'), record('92', 'Second')]
      return format === 'plain' ? { format, data: records } : { format, document: { data: records } }
    }
    if (method === 'bulkPatch') {
      const operations = [[item.id, 'First'], [other.id, 'Second']].map(([id, name]) => format === 'plain'
        ? { id, data: record(id, name) }
        : { id, document: { data: record(id, name) } })
      return { format, operations }
    }
    return { ids: [item.id, other.id] }
  }
  const expected = (method, count = 2) => ({
    rows: method === 'bulkPost'
      ? [...initial.rows, ...[{ id: '91', name: 'First' }, { id: '92', name: 'Second' }].slice(0, count)]
      : method === 'bulkPatch'
        ? [{ id: item.id, name: 'First' }, { id: other.id, name: count === 2 ? 'Second' : 'Other' }]
        : initial.rows.slice(count),
    members: method === 'bulkPost'
      ? [item.id, ...['91', '92'].slice(0, count)].sort()
      : method === 'bulkPatch' ? [item.id, ...(count === 2 ? [other.id] : [])].sort() : [],
    groupName: 'Group'
  })
  const assertPending = observed => {
    assert.equal(observed.commits, 0)
    assert.equal(observed.rollbacks, 0)
    assert.equal(observed.transaction.isCompleted(), false)
    assert.ok(trace.length > 0)
    for (const event of trace) {
      assert.equal(event.transaction, observed.transaction)
      assert.equal(event.shouldCommit, false)
      assert.equal(event.auth, auth)
      assert.ok(['afterDataCall', 'finish'].includes(event.phase))
    }
  }

  for (const method of ['bulkPost', 'bulkPatch', 'bulkDelete']) {
    for (const format of ['jsonapi', 'plain']) {
      for (const outcome of ['commit', 'rollback']) {
        it(`${method} keeps ${format} writes and links pending until the helper's ${outcome}`, async () => {
          let observed
          const context = { auth, error: primary, cleanupErrors: [{ phase: 'old' }] }
          const pending = fixture.api.transaction(async transaction => {
            observed = observe(transaction)
            const result = await fixture.api.resources.items[method]({ ...paramsFor(method, format), transaction: observed.transaction }, context)
            assert.deepEqual(result.meta, { total: 2, succeeded: 2, failed: 0, ...(method === 'bulkDelete' ? { deleted: [item.id, other.id] } : {}), atomic: true })
            assert.equal(context.error, undefined)
            assert.equal(context.cleanupErrors, undefined)
            assertPending(observed)
            assert.deepEqual(trace.map(({ phase, index }) => `${phase}:${index}`), ['afterDataCall:0', 'finish:0', 'afterDataCall:1', 'finish:1'])
            assert.deepEqual(await snapshot(observed.transaction), expected(method))
            assert.deepEqual(await snapshot(), initial)
            await fixture.api.resources.groups.patch({ id: group.id, format: 'plain', data: { name: 'Same outer transaction' }, transaction: observed.transaction })
            if (outcome === 'rollback') throw rollbackRequested
          })
          if (outcome === 'rollback') await assert.rejects(pending, error => assertWriteFailure(error, { cause: rollbackRequested, outcome: 'rolledBack' }))
          else await pending
          assert.equal(observed.commits, outcome === 'commit' ? 1 : 0)
          assert.equal(observed.rollbacks, outcome === 'rollback' ? 1 : 0)
          assert.equal(context.transactionOutcome, outcome === 'commit' ? 'committed' : 'rolledBack')
          assert.deepEqual(trace.filter(event => ['afterCommit', 'afterRollback'].includes(event.phase)).map(({ phase, index }) => `${phase}:${index}`),
            outcome === 'commit' ? ['afterCommit:0', 'afterCommit:1'] : ['afterRollback:1', 'afterRollback:0'])
          assert.deepEqual(await snapshot(), outcome === 'commit' ? { ...expected(method), groupName: 'Same outer transaction' } : initial)
        })
      }
    }

    for (const index of [0, 1]) {
      it(`${method} leaves the failed ${index + 1}-record prefix for its owner to roll back`, async () => {
        let observed
        const context = { auth }
        failureIndex = index
        await assert.rejects(fixture.api.transaction(async transaction => {
          observed = observe(transaction)
          await assert.rejects(fixture.api.resources.items[method]({ ...paramsFor(method), atomic: true, transaction: observed.transaction }, context), error => assertWriteFailure(error, { cause: primary, outcome: 'pending' }))
          assertPending(observed)
          assertWriteFailure(context.error, { cause: primary, outcome: 'pending' })
          assert.deepEqual(context.cleanupErrors, [])
          assert.deepEqual(trace.map(({ phase, index }) => `${phase}:${index}`), ['afterDataCall:0', 'finish:0', ...(index ? ['afterDataCall:1', 'finish:1'] : [])])
          assert.deepEqual(await snapshot(observed.transaction), expected(method, index + 1))
          assert.deepEqual(await snapshot(), initial)
          failureIndex = undefined
        }), error => assertWriteFailure(error, { cause: primary, outcome: 'rolledBack' }))
        assert.equal(observed.commits, 0)
        assert.equal(observed.rollbacks, 1)
        assert.equal(context.transactionOutcome, 'rolledBack')
        assert.deepEqual(trace.filter(event => event.phase === 'afterRollback').map(event => event.index), index ? [1, 0] : [0])
        assert.deepEqual(await snapshot(), initial)
      })
    }

    it(`${method} rejects non-atomic participation before running a child`, async () => {
      const observed = observe(await fixture.knex.transaction())
      const queries = []
      const capture = query => queries.push(query.sql)
      fixture.knex.on('query', capture)
      try {
        await assert.rejects(fixture.api.resources.items[method]({ ...paramsFor(method), atomic: false, transaction: observed.transaction }, { auth }), error => {
          assert.equal(error.code, 'REST_API_VALIDATION')
          assert.deepEqual(error.details.fields, ['transaction'])
          assert.match(error.message, /atomic/)
          return true
        })
      } finally { fixture.knex.off('query', capture) }
      assert.deepEqual(queries, [])
      assert.deepEqual(trace, [])
      assert.equal(observed.transaction.isCompleted(), false)
      assert.equal(observed.commits + observed.rollbacks, 0)
      assert.deepEqual(await snapshot(), initial)
    })

    it(`${method} cannot replace an already completed caller transaction with a new one`, async () => {
      const observed = observe(await fixture.knex.transaction())
      await observed.transaction.rollback()
      await assert.rejects(fixture.api.resources.items[method]({ ...paramsFor(method), transaction: observed.transaction }, { auth }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      assert.equal(observed.commits, 0)
      assert.equal(observed.rollbacks, 1)
      assert.deepEqual(await snapshot(), initial)
    })
  }
})
