import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { storageMode } from './helpers/storage-mode.js'
import { assertWriteFailure } from './helpers/test-utils.js'
import { lockRelationshipTargets } from '../plugins/core/lib/writing/relationship-processor.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

describe(`Relationship target lock batches (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      databaseOptions: { concurrent: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  const seed = async size => {
    const records = []
    for (let index = 0; index < size; index++) records.push(await fixture.seed('items', { name: `Item ${index}` }))
    return records.map(({ id, type }) => ({ id, type }))
  }
  const measured = async (targets, check) => {
    const transaction = await fixture.knex.transaction()
    const queries = []
    const capture = ({ sql, bindings }) => queries.push({ sql, bindings })
    fixture.knex.on('query', capture)
    try {
      await lockRelationshipTargets(fixture.api, transaction, targets)
      fixture.knex.off('query', capture)
      assert.equal(transaction.isCompleted(), false)
      await check(queries, transaction)
    } finally {
      fixture.knex.off('query', capture)
      await transaction.rollback()
    }
  }

  it('bounds round trips and bindings while locking every target beyond two batches', async () => {
    const targets = await seed(205)
    await measured(targets, async (queries, transaction) => {
      assert.equal(queries.length, 3)
      assert.ok(queries.every(query => query.bindings.length <= 102))
      if (databaseClient !== 'better-sqlite3') {
        const contender = await fixture.knex.transaction()
        const adapter = fixture.api.knex.helpers.getStorageAdapter('items')
        try {
          await assert.rejects(adapter.buildBaseQuery({ transaction: contender })
            .where(adapter.getIdColumn(), targets.at(-1).id).forUpdate().noWait().first(adapter.getIdColumn()), {
            code: databaseClient === 'pg' ? '55P03' : 'ER_LOCK_NOWAIT'
          })
          assert.equal(transaction.isCompleted(), false)
        } finally { await contender.rollback() }
      }
    })
  })

  it('locks repeated IDs once even when the input spans several batches', async () => {
    const [target] = await seed(1)
    await measured(Array.from({ length: 205 }, () => ({ ...target })), queries => {
      assert.equal(queries.length, 1)
    })
  })

  it('keeps overlapping IDs separate by resource and reports the first missing input', async () => {
    const items = await seed(2)
    const group = await fixture.seed('groups', { name: 'Group' })
    const target = { type: 'groups', id: group.id }
    await measured([items[0], target, items[1]], queries => { assert.equal(queries.length, 2) })
    const transaction = await fixture.knex.transaction()
    try {
      await assert.rejects(lockRelationshipTargets(fixture.api, transaction, [
        items[0], { type: 'groups', id: items[1].id }, { type: 'items', id: '999' }
      ]), { code: 'REST_API_RESOURCE', subtype: 'not_found', details: { resourceType: 'groups', resourceId: items[1].id } })
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
  })

  it('rejects a missing target beyond the first batch without completing the caller transaction', async () => {
    const targets = await seed(101)
    const transaction = await fixture.knex.transaction()
    try {
      await assert.rejects(lockRelationshipTargets(fixture.api, transaction, [...targets, { type: 'items', id: '999' }]), {
        code: 'REST_API_RESOURCE', subtype: 'not_found', details: { resourceType: 'items', resourceId: '999' }
      })
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    assert.equal(await fixture.count('items'), 101)
  })
})

describe('Relationship locks with database ID equality', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      storage: 'knex',
      createApi: createIdConformanceApi,
      apiOptions: { idType: 'string', idCaseInsensitive: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('accepts differently spelled IDs that match the actual column collation', async () => {
    await fixture.api.resources.items.post({ document: { data: { type: 'items', id: 'alpha', attributes: { name: 'Item' } } } })
    const transaction = await fixture.knex.transaction()
    try {
      const targets = await lockRelationshipTargets(fixture.api, transaction, [
        { type: 'items', id: 'ALPHA' }, { type: 'items', id: 'alpha' }
      ])
      assert.deepEqual(targets, [{ type: 'items', id: 'ALPHA' }])
      await assert.rejects(lockRelationshipTargets(fixture.api, transaction, [
        { type: 'items', id: 'ALPHA' }, { type: 'items', id: 'absent' }
      ]), { code: 'REST_API_RESOURCE', subtype: 'not_found', details: { resourceType: 'items', resourceId: 'absent' } })
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
  })
})

if (storageMode.isAnyApi()) {
  describe('Canonical link batches', () => {
    let fixture, owner, trace
    const failure = new Error('Finish after batched links failed')
    const identifier = ({ type, id }) => ({ type, id })
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        apiOptions: { inverseMembership: true },
        tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
      })
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'batched-link-target-hooks',
            handler: ({ context, scopeName }) => {
              if (scopeName === 'groups' && context.method === 'get' && context.originalContext?.batchProbe) trace.push(context.originalContext.id)
            }
          },
          finishPostRelationship: {
            functionName: 'batched-link-finish-failure',
            handler: ({ context }) => { if (context.batchFailure) throw failure }
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
      const groups = []
      for (let index = 0; index < size; index++) groups.push(await fixture.seed('groups', { name: `Group ${index}` }))
      return groups.map(identifier)
    }
    const add = (relationshipData, params = {}, context = {}) => fixture.api.resources.items.postRelationship({
      id: owner.id, relationshipName: 'groups', relationshipData, ...params
    }, context)
    const linked = async (id = owner.id, transaction) => (await fixture.api.resources.items.getRelationship({
      id, relationshipName: 'groups', transaction
    })).data.map(row => row.id).sort()

    it('reads existing links in bounded batches while checking every target permission', async () => {
      const groups = await seed(205)
      await add(groups)
      const queries = []
      const capture = query => queries.push(query)
      fixture.knex.on('query', capture)
      try { await add(groups, {}, { batchProbe: true }) } finally { fixture.knex.off('query', capture) }
      const edgeReads = queries.filter(({ sql }) => /^select .* from ["`]any_links["`]/.test(sql))
      assert.equal(edgeReads.length, 3)
      assert.ok(edgeReads.every(query => query.bindings.length <= 214))
      assert.deepEqual(trace, groups.map(row => row.id))
      assert.deepEqual(await linked(), groups.map(row => row.id).sort())
      assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 205)
    })

    it('keeps mixed new/existing links, duplicate inputs and another owner separate', async () => {
      const groups = await seed(2)
      const other = await fixture.seed('items', { name: 'Other owner' })
      await add([groups[0]])
      await add([groups[1]], { id: other.id })
      await add([groups[0], groups[1], groups[1]], {}, { batchProbe: true })
      assert.deepEqual(trace, [groups[0].id, groups[1].id])
      assert.deepEqual(await linked(), groups.map(row => row.id).sort())
      assert.deepEqual(await linked(other.id), [groups[1].id])
      assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 3)
    })

    it('repairs missing inverse metadata without replacing existing link payloads', async () => {
      const groups = await seed(101)
      await add(groups)
      const rows = await fixture.knex('any_links').select('id', 'inverse_relationship')
      assert.ok(rows.every(row => row.inverse_relationship))
      await fixture.knex('any_links').update({ inverse_relationship: null, payload: '{"keep":true}' })
      await add(groups)
      const repaired = await fixture.knex('any_links').select('id', 'inverse_relationship', 'payload').orderBy('id')
      assert.deepEqual(repaired.map(({ payload, ...row }) => row), rows.sort((a, b) => a.id - b.id))
      assert.ok(repaired.every(row => row.payload === '{"keep":true}'))
      const inverse = await fixture.api.resources.groups.getRelationship({ id: groups.at(-1).id, relationshipName: 'members' })
      assert.deepEqual(inverse.data, [identifier(owner)])
    })

    for (const borrowed of [false, true]) {
      it(`rolls back all link batches with ${borrowed ? 'caller rollback' : 'owned finish failure'}`, async () => {
        const groups = await seed(101)
        if (borrowed) {
          const unit = await holdManagedTransaction(fixture.api)
          const transaction = unit.transaction
          try {
            await add(groups, { transaction })
            assert.equal(transaction.isCompleted(), false)
            assert.deepEqual(await linked(owner.id, transaction), groups.map(row => row.id).sort())
          } finally { await unit.rollback() }
        } else await assert.rejects(add(groups, {}, { batchFailure: true }), error => assertWriteFailure(error, { cause: failure, outcome: 'rolledBack' }))
        assert.deepEqual(await linked(), [])
        assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 0)
      })
    }
  })
}
