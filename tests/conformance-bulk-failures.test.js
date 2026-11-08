import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

// Many-row writes are all-or-nothing: inside a caller's transaction their rows
// stay pending until the owner commits, and a failure leaves the owner to roll back.
describe(`Many-row write transactions (${storageMode.mode})`, () => {
  let fixture, items, first, second
  const rollbackRequested = new Error('Callback requested rollback')

  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      databaseOptions: { concurrent: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => {
    await fixture.reset()
    first = await fixture.seed('items', { name: 'First' })
    second = await fixture.seed('items', { name: 'Second' })
  })
  after(async () => { await fixture?.close() })

  const names = async transaction => (await items.query({ format: 'plain', transaction, queryParams: { sort: ['id'] } })).data.map(({ id, name }) => `${id}:${name}`)
  const initial = () => [`${first.id}:First`, `${second.id}:Second`]
  const writes = {
    postMany: { params: { data: [{ id: '91', name: 'Third' }, { id: '92', name: 'Fourth' }] }, after: () => [...initial(), '91:Third', '92:Fourth'] },
    patchMany: { params: () => ({ data: [{ id: first.id, name: 'One' }, { id: second.id, name: 'Two' }] }), after: () => [`${first.id}:One`, `${second.id}:Two`] },
    deleteMany: { params: () => ({ ids: [first.id, second.id] }), after: () => [] }
  }
  const paramsOf = method => typeof writes[method].params === 'function' ? writes[method].params() : writes[method].params

  for (const method of Object.keys(writes)) {
    for (const outcome of ['commit', 'rollback']) {
      it(`${method} keeps its rows pending until the caller's ${outcome}`, async () => {
        const pending = fixture.api.transaction(async transaction => {
          await items[method]({ ...paramsOf(method), transaction })
          assert.deepEqual(await names(transaction), writes[method].after())
          assert.deepEqual(await names(), initial(), 'other connections do not see uncommitted rows')
          if (outcome === 'rollback') throw rollbackRequested
        })
        if (outcome === 'rollback') await assert.rejects(pending, error => assertWriteFailure(error, { cause: rollbackRequested, outcome: 'rolledBack' }))
        else await pending
        assert.deepEqual(await names(), outcome === 'commit' ? writes[method].after() : initial())
      })
    }

    it(`${method} leaves a failed batch pending for its owner to roll back`, async () => {
      const bad = method === 'postMany'
        ? { data: [{ id: '91', name: 'Third' }, { id: '92' }] }
        : method === 'patchMany'
          ? { data: [{ id: first.id, name: 'One' }, { id: second.id, name: null }] }
          : { ids: [first.id, '999'] }
      await assert.rejects(fixture.api.transaction(async transaction => {
        await assert.rejects(items[method]({ ...bad, transaction }), error => assertWriteFailure(error, { outcome: 'pending' }))
        assert.equal(transaction.isCompleted(), false)
        throw rollbackRequested
      }), error => assertWriteFailure(error, { cause: rollbackRequested, outcome: 'rolledBack' }))
      assert.deepEqual(await names(), initial())
    })

    it(`${method} rolls back its own transaction on failure`, async () => {
      const bad = method === 'postMany'
        ? { data: [{ id: '91', name: 'Third' }, { id: '92' }] }
        : method === 'patchMany'
          ? { data: [{ id: first.id, name: 'One' }, { id: second.id, name: null }] }
          : { ids: [first.id, '999'] }
      await assert.rejects(items[method](bad), error => assertWriteFailure(error, { outcome: 'rolledBack' }))
      assert.deepEqual(await names(), initial())
    })

    it(`${method} refuses a completed or unmanaged transaction`, async () => {
      const completed = await fixture.knex.transaction()
      await completed.rollback()
      await assert.rejects(items[method]({ ...paramsOf(method), transaction: completed }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      const raw = await fixture.knex.transaction()
      try {
        await assert.rejects(items[method]({ ...paramsOf(method), transaction: raw }), error => assertWriteFailure(error, { type: RestApiValidationError, outcome: 'none' }))
      } finally { await raw.rollback() }
      assert.deepEqual(await names(), initial())
    })
  }
})
