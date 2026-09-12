import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createPositioningApi } from './fixtures/api-configs.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'
import { databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'
import { PositioningPlugin } from '../plugins/core/rest-api-positioning-plugin.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { assertWriteFailure } from './helpers/test-utils.js'

describe(`Positioning transaction coordination (${databaseClient}, ${storageMode.mode})`, { timeout: 30000 }, () => {
  let fixture, entering, calculated, permission, readTarget, finish, nextTransactionOptions
  const sqlite = databaseClient === 'better-sqlite3'
  const post = (data, transaction, context) => fixture.api.resources.tasks.post({ data, transaction, format: 'jsonapi' }, context)
  const patch = (id, data, transaction, context) => fixture.api.resources.tasks.patch({ id, data, transaction, format: 'jsonapi' }, context)
  const list = async category => (await fixture.api.resources.tasks.query({
    format: 'jsonapi', queryParams: { filters: { category }, sort: ['position'] }
  })).data
  const assertUnique = records => assert.equal(new Set(records.map(record => record.attributes.position)).size, records.length)

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createPositioningApi,
      databaseOptions: { concurrent: true, maxConnections: 4 },
      tables: { tasks: 'positioning_tasks', categories: 'positioning_categories', projects: 'positioning_projects', items: 'positioning_items' }
    })
    await fixture.api.use(PositioningPlugin, {
      filters: ['category'], excludeResources: ['categories', 'projects', 'items'], autoIndex: false
    })
    await fixture.api.customize({
      helpers: {
        newTransaction: () => {
          const options = nextTransactionOptions
          nextTransactionOptions = undefined
          return fixture.knex.transaction(options)
        }
      },
      hooks: {
        beforeProcessing: { functionName: 'positioning-race-entry', beforeFunction: 'lock-position-resource', handler: ({ context }) => entering?.(context) },
        beforeDataCallPost: { functionName: 'positioning-post-observer', afterFunction: 'calculate-position-post', handler: ({ context }) => calculated?.(context) },
        beforeDataCallPatch: { functionName: 'positioning-patch-observer', afterFunction: 'calculate-position-patch', handler: ({ context }) => calculated?.(context) },
        checkPermissions: ({ context }) => permission?.(context.originalContext ?? context),
        beforeDataGet: ({ context }) => readTarget?.(context),
        finishPost: ({ context }) => finish?.(context)
      }
    })
  })
  beforeEach(async () => {
    entering = calculated = permission = readTarget = finish = nextTransactionOptions = undefined
    await fixture.reset()
  })
  after(async () => { await fixture?.close() })

  it('assigns a new destination position when a group changes without beforeId', async () => {
    const source = await fixture.seed('categories', { name: 'Source' })
    const destination = await fixture.seed('categories', { name: 'Destination' })
    const moved = (await post({ title: 'Moved', category: source.id })).data
    const resident = (await post({ title: 'Resident', category: destination.id })).data
    assert.equal(moved.attributes.position, resident.attributes.position)
    await patch(moved.id, { category: destination.id })
    const records = await list(destination.id)
    assert.deepEqual(records.map(record => record.id), [resident.id, moved.id])
    assertUnique(records)
    assert.equal((await list(source.id)).length, 0)
  })

  it('positions PUT creates and preserves a replacement position within the same group', async () => {
    const first = (await post({ title: 'First', category: null })).data
    const created = await fixture.api.resources.tasks.put({
      id: '200', data: { title: 'Created by PUT', category: null }, format: 'jsonapi'
    })
    assert.ok(created.data.attributes.position > first.attributes.position)
    const replaced = await fixture.api.resources.tasks.put({
      id: created.data.id, data: { title: 'Replaced', category: null, version: 1 }, format: 'jsonapi'
    })
    assert.equal(replaced.data.attributes.position, created.data.attributes.position)
  })

  it('appends missing and cross-group targets without reusing the initial position', async () => {
    const other = await fixture.seed('categories', { name: 'Other' })
    const first = (await post({ title: 'First', category: null })).data
    const elsewhere = (await post({ title: 'Elsewhere', category: other.id })).data
    const missing = (await post({ title: 'Missing target', category: null, beforeId: '99999' })).data
    const crossGroup = (await post({ title: 'Other group target', category: null, beforeId: elsewhere.id })).data
    assert.ok(first.attributes.position < missing.attributes.position)
    assert.ok(missing.attributes.position < crossGroup.attributes.position)
    assertUnique(await list(null))
  })

  it('keeps a self-targeted move stable and applies position sorting to default queries', async () => {
    const first = (await post({ title: 'First', category: null })).data
    const second = (await post({ title: 'Second', category: null })).data
    await patch(second.id, { beforeId: 'FIRST' })
    const before = (await list(null))[0]
    const unchanged = (await patch(second.id, { beforeId: second.id })).data
    assert.equal(unchanged.attributes.position, before.attributes.position)
    const result = await fixture.api.resources.tasks.query({ format: 'jsonapi' })
    assert.deepEqual(result.data.map(record => record.id), [second.id, first.id])
  })

  it('retains normal target read permissions and rolls back a denied placement', async () => {
    const target = (await post({ title: 'Target', category: null })).data
    permission = context => {
      if (context.denyTarget && context.method === 'get' && String(context.id) === target.id) throw new Error('Target read denied')
    }
    await assert.rejects(post({ title: 'Denied', category: null, beforeId: target.id }, undefined, { denyTarget: true }), error => {
      assert.equal(error.message, 'Target read denied')
      assert.equal(error.transactionOutcome, 'rolledBack')
      return true
    })
    assert.deepEqual((await list(null)).map(record => record.id), [target.id])
    permission = undefined
    const next = (await post({ title: 'Allowed', category: null, beforeId: target.id })).data
    assert.ok(next.attributes.position < target.attributes.position)
  })

  for (const phase of ['permission', 'beforeDataGet']) {
    for (const [name, failure] of [
      ['null', null],
      ['undefined', undefined],
      ['typed error', Object.freeze(new RestApiValidationError('Target read failed'))],
      ['untyped not-found object', Object.freeze({ subtype: 'not_found' })]
    ]) {
      it(`retains placement-target ${phase} failures: ${name}`, async () => {
        const target = (await post({ title: 'Target', category: null })).data
        let calls = 0
        const rejectTarget = context => {
          if (context.method === 'get' && String(context.id) === target.id) {
            calls++
            throw failure
          }
        }
        if (phase === 'permission') permission = rejectTarget
        else readTarget = rejectTarget
        await assert.rejects(post({ title: 'Rejected', category: null, beforeId: target.id }), error => {
          return assertWriteFailure(error, { cause: failure, outcome: 'rolledBack' })
        })
        assert.equal(calls, 1)
        assert.deepEqual((await list(null)).map(record => record.id), [target.id])
        permission = readTarget = undefined
        const next = (await post({ title: 'Allowed', category: null, beforeId: target.id })).data
        assert.ok(next.attributes.position < target.attributes.position)
      })
    }
  }

  it('rolls back a failed response and releases its allocated position and database lock', async () => {
    finish = context => { if (context.rejectResponse) throw new Error('Response rejected') }
    await assert.rejects(post({ title: 'Not committed', category: null }, undefined, { rejectResponse: true }), /Response rejected/)
    const next = (await post({ title: 'Committed', category: null })).data
    assert.equal(next.attributes.position, 'a0')
    assert.equal((await list(null)).length, 1)
  })

  async function compete (firstOperation, secondOperation, { rollback = false, snapshot = false } = {}) {
    const first = await holdManagedTransaction(fixture.api)
    if (snapshot && !sqlite) nextTransactionOptions = { isolationLevel: 'repeatable read' }
    const second = await holdManagedTransaction(fixture.api)
    let pending
    try {
      assert.notEqual(await first.transaction.client.acquireConnection(), await second.transaction.client.acquireConnection())
      if (snapshot) await fixture.api.resources.tasks.query({ transaction: second.transaction, format: 'jsonapi' })
      await firstOperation(first.transaction)
      const started = Promise.withResolvers()
      let secondCalculated = false
      entering = context => { if (context.racer === 'second') started.resolve() }
      calculated = context => { if (context.racer === 'second') secondCalculated = true }
      pending = secondOperation(second.transaction, { racer: 'second' }).then(value => ({ value }), error => ({ error }))
      await started.promise
      await delay(30)
      assert.equal(secondCalculated, false, 'The second connection must not allocate before the first transaction finishes')
      if (rollback) await first.rollback()
      else await first.commit()
      const outcome = await pending
      if (sqlite || (snapshot && databaseClient === 'pg')) {
        assert.ok(outcome.error, 'A stale/locked snapshot must reject instead of allocating a duplicate')
        assert.ok(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', '40001'].includes(outcome.error.code), outcome.error.stack)
        await second.rollback()
        await secondOperation()
      } else {
        assert.ifError(outcome.error)
        await second.commit()
      }
    } finally {
      entering = calculated = undefined
      if (!first.transaction.isCompleted()) await first.rollback()
      if (pending) await pending
      if (!second.transaction.isCompleted()) await second.rollback()
    }
  }

  it('coordinates separate connections inserting into an empty group', async () => {
    await compete(
      transaction => post({ title: 'First', category: null }, transaction),
      (transaction, context) => post({ title: 'Second', category: null }, transaction, context)
    )
    const records = await list(null)
    assert.deepEqual(records.map(record => record.attributes.title), ['First', 'Second'])
    assertUnique(records)
  })

  it('coordinates separate connections moving different records before the same target', async () => {
    const target = (await post({ title: 'Target', category: null })).data
    const first = (await post({ title: 'First moved', category: null })).data
    const second = (await post({ title: 'Second moved', category: null })).data
    await compete(
      transaction => patch(first.id, { beforeId: target.id }, transaction),
      (transaction, context) => patch(second.id, { beforeId: target.id }, transaction, context)
    )
    const records = await list(null)
    assert.deepEqual(records.map(record => record.id), [first.id, second.id, target.id])
    assertUnique(records)
  })

  it('coordinates opposite group moves without acquiring group locks in conflicting order', async () => {
    const left = await fixture.seed('categories', { name: 'Left' })
    const right = await fixture.seed('categories', { name: 'Right' })
    const first = (await post({ title: 'To right', category: left.id })).data
    const second = (await post({ title: 'To left', category: right.id })).data
    await compete(
      transaction => patch(first.id, { category: right.id }, transaction),
      (transaction, context) => patch(second.id, { category: left.id }, transaction, context)
    )
    assert.deepEqual((await list(left.id)).map(record => record.id), [second.id])
    assert.deepEqual((await list(right.id)).map(record => record.id), [first.id])
  })

  it('lets a waiting writer reuse a position released by rollback', async () => {
    await compete(
      transaction => post({ title: 'Rolled back', category: null }, transaction),
      (transaction, context) => post({ title: 'Committed', category: null }, transaction, context),
      { rollback: true }
    )
    const records = await list(null)
    assert.equal(records.length, 1)
    assert.equal(records[0].attributes.position, 'a0')
  })

  it('handles a borrowed transaction with an earlier snapshot without creating duplicate positions', async () => {
    await compete(
      transaction => post({ title: 'First', category: null }, transaction),
      (transaction, context) => post({ title: 'Second', category: null }, transaction, context),
      { snapshot: true }
    )
    assertUnique(await list(null))
    assert.equal((await list(null)).length, 2)
  })
})
