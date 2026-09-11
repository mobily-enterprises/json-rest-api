import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// These paths write ordinary pivot tables; canonical links have separate regressions.
describe('Ordinary pivot write batches', () => {
  let fixture, owner, trace
  const table = 'conformance_memberships'
  const isPivotWrite = ({ sql }) => /^(insert into|delete from) ["`]conformance_memberships["`]/.test(sql)
  before(async () => {
    fixture = await createConformanceFixture({
      storage: 'knex',
      createApi: createIdConformanceApi,
      tables: { memberships: table, items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: {
        checkPermissions: {
          functionName: 'pivot-batch-target-trace',
          handler: ({ context, scopeName }) => {
            if (scopeName === 'groups' && context.method === 'get' && context.originalContext?.traceTargets) trace.push(context.originalContext.id)
          }
        },
        beforeDataCall: {
          functionName: 'pivot-batch-failure-injection',
          handler: ({ context, scopeName }) => {
            if (scopeName === 'items' && context.method === context.failPivotMethod) context.inject(context.transaction)
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    owner = await fixture.seed('items', { name: 'Owner' })
    trace = []
  })
  after(async () => { await fixture?.close() })

  const seed = async size => {
    const targets = []
    for (let index = 0; index < size; index++) {
      const { type, id } = await fixture.seed('groups', { name: `Group ${index}` })
      targets.push({ type, id })
    }
    return targets
  }
  const mutate = (method, targets, params = {}, context = {}) => fixture.api.resources.items[method]({
    id: owner.id, relationshipName: 'groups', relationshipData: targets, ...params
  }, context)
  const seedLinks = async targets => {
    for (let offset = 0; offset < targets.length; offset += 100) await mutate('postRelationship', targets.slice(offset, offset + 100))
  }
  const linked = async (id = owner.id, transaction) => (await fixture.api.resources.items.getRelationship({
    id, relationshipName: 'groups', transaction
  })).data.map(row => row.id).sort()
  const measured = async operation => {
    const queries = []
    const capture = query => { if (isPivotWrite(query)) queries.push(query) }
    fixture.knex.on('query', capture)
    try { await operation() } finally { fixture.knex.off('query', capture) }
    return queries
  }

  for (const method of ['postRelationship', 'patchRelationship']) {
    it(`${method} writes more than SQLite's single-insert row limit in bounded batches`, async () => {
      const targets = await seed(501)
      const other = await fixture.seed('items', { name: 'Other owner' })
      await mutate('postRelationship', [targets.at(-1)], { id: other.id })
      const queries = await measured(() => mutate(method, [...targets, targets[0], targets.at(-1)], {}, { traceTargets: true }))
      const inserts = queries.filter(query => query.sql.startsWith('insert into'))
      assert.equal(inserts.length, 6)
      assert.ok(inserts.every(query => query.bindings.length <= 200))
      assert.equal(queries.length, method === 'patchRelationship' ? 7 : 6)
      assert.deepEqual(trace, targets.map(row => row.id))
      assert.deepEqual(await linked(), targets.map(row => row.id).sort())
      assert.deepEqual(await linked(other.id), [targets.at(-1).id])
      assert.equal(await fixture.count('memberships'), 502)
    })
  }

  it('deletes bounded unique ID batches without removing another owner or target rows', async () => {
    const targets = await seed(205)
    await seedLinks(targets)
    const other = await fixture.seed('items', { name: 'Other owner' })
    await mutate('postRelationship', [targets.at(-1)], { id: other.id })
    const queries = await measured(() => mutate('deleteRelationship', [...targets, targets[0], { type: 'groups', id: '99999' }]))
    assert.equal(queries.length, 3)
    assert.ok(queries.every(query => query.sql.startsWith('delete from') && query.bindings.length <= 101))
    assert.deepEqual(await linked(), [])
    assert.deepEqual(await linked(other.id), [targets.at(-1).id])
    assert.equal(await fixture.count('groups'), 205)
    assert.equal(await fixture.count('memberships'), 1)
  })

  it('replaces membership with one complete deletion while preserving retained pivot rows', async () => {
    const targets = await seed(207)
    await seedLinks(targets.slice(0, 206))
    const kept = await fixture.knex(table).where({ item_key: owner.id, group_key: targets[205].id }).first()
    const queries = await measured(() => mutate('patchRelationship', targets.slice(205)))
    const deletes = queries.filter(query => query.sql.startsWith('delete from'))
    assert.equal(deletes.length, 1)
    assert.ok(deletes.every(query => query.bindings.length <= 101))
    assert.equal(queries.filter(query => query.sql.startsWith('insert into')).length, 1)
    assert.deepEqual(await linked(), targets.slice(205).map(row => row.id).sort())
    assert.deepEqual(await fixture.knex(table).where('id', kept.id).first(), kept)
  })

  for (const method of ['postRelationship', 'deleteRelationship']) {
    it(`${method} leaves every successful batch in the borrowed transaction until its owner rolls back`, async () => {
      const targets = await seed(205)
      if (method === 'deleteRelationship') await seedLinks(targets)
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        const queries = await measured(() => mutate(method, targets, { transaction }))
        assert.equal(queries.length, 3)
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual(await linked(owner.id, transaction), method === 'postRelationship' ? targets.map(row => row.id).sort() : [])
      } finally { await unit.rollback() }
      assert.deepEqual(await linked(), method === 'deleteRelationship' ? targets.map(row => row.id).sort() : [])
    })

    for (const borrowed of [false, true]) {
      it(`${method} retains the second-batch error and ${borrowed ? 'borrows' : 'rolls back'} the transaction`, async t => {
        const targets = await seed(205)
        if (method === 'deleteRelationship') await seedLinks(targets)
        const failure = new RestApiValidationError('Injected second pivot batch failure')
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        let attempts = 0
        const context = {
          failPivotMethod: method,
          inject: trx => {
            const query = trx.client.query
            t.mock.method(trx.client, 'query', function (connection, statement) {
              if (isPivotWrite(statement) && ++attempts === 2) throw failure
              return query.call(this, connection, statement)
            })
          }
        }
        try {
          await assert.rejects(mutate(method, targets, { transaction }, context), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          assert.equal(attempts, 2)
          assert.equal(context.transaction.isCompleted(), !borrowed)
          if (borrowed) {
            assert.equal(context.transaction, transaction)
            const count = Number((await transaction(table).where('item_key', owner.id).count('* as count'))[0].count)
            assert.equal(count, method === 'postRelationship' ? 100 : 105)
          }
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
        }
        assert.deepEqual(await linked(), method === 'deleteRelationship' ? targets.map(row => row.id).sort() : [])
      })
    }
  }
})
