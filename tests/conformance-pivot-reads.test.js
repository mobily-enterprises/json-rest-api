import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { updateManyToManyRelationship } from '../plugins/core/lib/writing/many-to-many-manipulations.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// Ordinary pivot tables; canonical link reads have their own bounded-read cases.
describe('Ordinary pivot membership reads', () => {
  let fixture
  const size = 1001
  const table = 'conformance_memberships'
  const targets = Array.from({ length: size + 1 }, (_, i) => ({ type: 'groups', id: String(i + 1) }))
  const seed = async (type, records) => {
    for (let offset = 0; offset < records.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
  }
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, databaseOptions: { concurrent: true }, tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: table } })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seed('items', [{ id: '100000', name: 'Owner' }, { id: '100001', name: 'Other' }])
    await seed('groups', targets.map(({ id }) => ({ id, name: `Group ${id}` })))
    await seed('memberships', targets.slice(0, size).map(({ id }) => ({ itemId: '100000', groupId: id })))
    await seed('memberships', [{ itemId: '100001', groupId: '1' }])
  })
  after(async () => { await fixture?.close() })
  const mutate = (method, ids, transaction, context) => fixture.api.resources.items[method]({ id: '100000', relationshipName: 'groups', relationshipData: ids, transaction }, context)
  const rows = transaction => (transaction || fixture.knex)(table).where('item_key', '100000').orderBy('id')
  const measured = async operation => {
    const reads = []; const deletes = []
    const captureRows = (records, query) => {
      if (/^select .* from ["`]conformance_memberships["`] where .*?["`]group_key["`] in /.test(query.sql) && Array.isArray(records)) reads.push({ rows: records.length, bindings: query.bindings.length })
    }
    const captureQuery = query => { if (/^delete from ["`]conformance_memberships["`]/.test(query.sql)) deletes.push(query) }
    fixture.knex.on('query-response', captureRows)
    fixture.knex.on('query', captureQuery)
    try { await operation() } finally {
      fixture.knex.off('query-response', captureRows)
      fixture.knex.off('query', captureQuery)
    }
    return { reads, deletes }
  }

  for (const method of ['postRelationship', 'patchRelationship']) {
    it(`${method} reads only requested existing targets and preserves pivot rows`, async () => {
      const before = await rows()
      const wanted = [targets[0], targets.at(-2), targets.at(-1)]
      const { reads } = await measured(() => mutate(method, [...wanted, ...wanted]))
      assert.ok(reads.length > 0)
      assert.ok(reads.every(read => read.rows <= wanted.length && read.bindings <= wanted.length + 2), JSON.stringify(reads))
      const after = await rows()
      const kept = method === 'postRelationship' ? before : [before[0], before.at(-1)]
      for (const row of kept) assert.deepEqual(after.find(record => record.id === row.id), row)
      assert.equal(after.length, kept.length + 1)
      assert.equal(String(after.at(-1).group_key), targets.at(-1).id)
      assert.equal(Number((await fixture.knex(table).where('item_key', '100001').count('* as count'))[0].count), 1)
      assert.equal(await fixture.count('groups'), size + 1)
    })

    it(`${method} bounds each lookup beyond two batches without losing a retained target`, async () => {
      const wanted = targets.slice(0, 205)
      const { reads } = await measured(() => mutate(method, wanted))
      assert.equal(reads.length, 3)
      assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 102), JSON.stringify(reads))
      assert.equal((await rows()).length, method === 'postRelationship' ? size : wanted.length)
    })

    it(`${method} keeps pending membership until the borrower rolls back`, async () => {
      const before = await rows()
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await mutate(method, [targets[0], targets.at(-1)], transaction)
        assert.equal(transaction.isCompleted(), false)
        assert.equal((await rows(transaction)).length, method === 'postRelationship' ? size + 1 : 2)
      } finally { await unit.rollback() }
      assert.deepEqual(await rows(), before)
    })
  }

  it('deduplicates a large repeated request before reading existing rows', async () => {
    const { reads } = await measured(() => mutate('postRelationship', Array.from({ length: 33000 }, () => targets[0])))
    assert.deepEqual(reads, [{ rows: 1, bindings: 3 }])
    assert.equal((await rows()).length, size)
  })

  it('does no pivot read for empty addition or replacement', async () => {
    assert.deepEqual(await measured(() => mutate('postRelationship', [])), { reads: [], deletes: [] })
    const { reads, deletes } = await measured(() => mutate('patchRelationship', []))
    assert.deepEqual(reads, [])
    assert.equal(deletes.length, 1)
    assert.equal((await rows()).length, 0)
    assert.equal(await fixture.count('memberships'), 1)
  })

  it('retains the complete 33,000-ID keep-list in one replacement predicate', async () => {
    const more = Array.from({ length: 33000 - size - 1 }, (_, i) => ({ id: String(size + 2 + i), name: `Group ${size + 2 + i}` }))
    await seed('groups', more)
    await seed('memberships', [...targets.slice(size), ...more].map(({ id }) => ({ itemId: '100000', groupId: id })))
    const before = await rows()
    const transaction = await fixture.knex.transaction()
    try {
      const ids = Array.from({ length: 33000 }, (_, i) => ({ type: 'groups', id: String(i + 1) }))
      const { reads, deletes } = await measured(() => updateManyToManyRelationship(null, {
        api: fixture.api,
        context: {
          resourceId: '100000', relDef: { through: 'memberships', foreignKey: 'itemId', otherKey: 'groupId' }, relData: [...ids, ids[0]], transaction
        }
      }))
      assert.equal(deletes.length, 1)
      if (databaseClient !== 'mysql2') assert.ok(deletes[0].bindings.length <= 2)
      assert.equal(reads.length, 330)
      assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 102))
      assert.deepEqual(await rows(transaction), before)
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
    assert.deepEqual(await rows(), before)
  })

  for (const borrowed of [false, true]) {
    it(`preserves a later pivot read failure after deletion in an ${borrowed ? 'borrowed' : 'owned'} transaction`, async t => {
      const before = await rows()
      const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
      const transaction = unit?.transaction
      const failure = new RestApiValidationError('Second pivot read failed')
      let attempts = 0; let injected = false; let observed
      await fixture.api.customize({
        hooks: {
          beforeDataCall: {
            functionName: 'pivot-read-failure',
            handler: ({ context }) => {
              if (!context.injectPivotReadFailure || injected) return
              injected = true
              observed = context.transaction
              const query = observed.client.query
              t.mock.method(observed.client, 'query', function (connection, statement) {
                if (/^select .* from ["`]conformance_memberships["`] where .*?["`]group_key["`] in /.test(statement.sql) && ++attempts === 2) throw failure
                return query.call(this, connection, statement)
              })
            }
          }
        }
      })
      try {
        await assert.rejects(mutate('patchRelationship', targets.slice(0, 205), transaction, { injectPivotReadFailure: true }), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
        assert.equal(attempts, 2)
        assert.equal(observed.isCompleted(), !borrowed)
        if (borrowed) assert.deepEqual(await rows(transaction), before.slice(0, 205))
      } finally {
        t.mock.restoreAll()
        await unit?.rollback()
      }
      assert.deepEqual(await rows(), before)
    })

    it(`preserves the insert failure after replacement deletion and ${borrowed ? 'borrows' : 'rolls back'} the transaction`, async t => {
      const extra = Array.from({ length: 204 }, (_, i) => ({ id: String(size + 2 + i), name: `New ${i}` }))
      await seed('groups', extra)
      const before = await rows()
      const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
      const transaction = unit?.transaction
      const failure = new RestApiValidationError('Second pivot insert failed')
      let attempts = 0; let injected = false; let observed
      await fixture.api.customize({
        hooks: {
          beforeDataCall: {
            functionName: 'pivot-read-failure',
            handler: ({ context }) => {
              if (!context.injectPivotReadFailure || injected) return
              injected = true
              observed = context.transaction
              const query = observed.client.query
              t.mock.method(observed.client, 'query', function (connection, statement) {
                if (/^insert into ["`]conformance_memberships["`]/.test(statement.sql) && ++attempts === 2) throw failure
                return query.call(this, connection, statement)
              })
            }
          }
        }
      })
      try {
        await assert.rejects(mutate('patchRelationship', [targets[0], targets.at(-1), ...extra.map(({ id }) => ({ type: 'groups', id }))], transaction, { injectPivotReadFailure: true }), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
        assert.equal(attempts, 2)
        assert.equal(observed.isCompleted(), !borrowed)
        if (borrowed) {
          assert.equal(observed, transaction)
          assert.equal((await rows(transaction)).length, 100)
        }
      } finally {
        t.mock.restoreAll()
        await unit?.rollback()
      }
      assert.deepEqual(await rows(), before)
      assert.equal(Number((await fixture.knex(table).where('item_key', '100001').count('* as count'))[0].count), 1)
    })
  }

  it('keeps retained and deleted pivot rows locked until the borrower finishes', async () => {
    const before = await rows()
    const unit = await holdManagedTransaction(fixture.api)
    const transaction = unit.transaction
    try {
      await mutate('patchRelationship', [targets[0]], transaction)
      assert.equal((await rows(transaction)).length, 1)
      if (databaseClient !== 'better-sqlite3') {
        for (const row of [before[0], before.at(-1)]) {
          const contender = await fixture.knex.transaction()
          try {
            await assert.rejects(contender(table).where('id', row.id).forUpdate().noWait().first(), {
              code: databaseClient === 'pg' ? '55P03' : 'ER_LOCK_NOWAIT'
            })
          } finally { await contender.rollback() }
        }
      }
      assert.equal(transaction.isCompleted(), false)
    } finally { await unit.rollback() }
    assert.deepEqual(await rows(), before)
  })

  it('bounds returned rows even when a pivot resource contains duplicate edges', async () => {
    await seed('memberships', Array.from({ length: 250 }, () => ({ itemId: '100000', groupId: '1' })))
    const before = await rows()
    const { reads } = await measured(() => mutate('postRelationship', [targets[0], targets[1]]))
    assert.equal(reads.length, 3)
    assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 5), JSON.stringify(reads))
    assert.equal(reads.reduce((sum, read) => sum + read.rows, 0), 252)
    assert.deepEqual(await rows(), before)
  })
})

// Both the target ID and actual pivot column use database case-insensitive equality.
describe('Ordinary pivot ID comparison', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ storage: 'knex', createApi: createIdConformanceApi, apiOptions: { idType: 'string', idCaseInsensitive: true, pivotCaseInsensitive: true }, tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' } })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, [{ id: 'owner', name: 'Owner' }])
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }])
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.memberships.vars.schemaInfo, [{ itemId: 'owner', groupId: 'alpha' }])
  })
  after(async () => { await fixture?.close() })

  it('deduplicates equivalent new targets across target-lock batches', async () => {
    const filler = Array.from({ length: 101 }, (_, i) => ({ id: `target${i}`, name: `Target ${i}` }))
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, filler)
    await fixture.api.resources.items.postRelationship({
      id: 'owner',
      relationshipName: 'groups',
      relationshipData: [
        { type: 'groups', id: 'BETA' }, ...filler.map(({ id }) => ({ type: 'groups', id })), { type: 'groups', id: 'beta' }
      ]
    })
    const rows = await fixture.knex('conformance_memberships').orderBy('id')
    assert.equal(rows.length, 103)
    assert.equal(rows.filter(row => row.group_key.toLowerCase() === 'beta').length, 1)
    assert.equal(rows.find(row => row.group_key.toLowerCase() === 'beta').group_key, 'BETA')
  })
  for (const method of ['postRelationship', 'patchRelationship']) {
    it(`${method} inserts a new database identity once using the first submitted spelling`, async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await fixture.api.resources.items[method]({
          id: 'owner',
          relationshipName: 'groups',
          relationshipData: [
            { type: 'groups', id: 'BETA' }, { type: 'groups', id: 'beta' }
          ],
          transaction
        })
        const rows = await transaction('conformance_memberships').orderBy('id')
        assert.equal(rows.length, method === 'postRelationship' ? 2 : 1)
        assert.equal(rows.at(-1).group_key, 'BETA')
      } finally { await unit.rollback() }
      assert.equal(await fixture.count('memberships'), 1)
    })

    it(`${method} keeps the existing pivot row for an equivalent target spelling`, async () => {
      const before = await fixture.knex('conformance_memberships').first()
      await fixture.api.resources.items[method]({ id: 'owner', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: 'ALPHA' }, { type: 'groups', id: 'alpha' }, { type: 'groups', id: 'beta' }] })
      const after = await fixture.knex('conformance_memberships').orderBy('id')
      assert.equal(after.length, 2)
      assert.deepEqual(after[0], before)
      assert.equal(after[1].group_key, 'beta')
    })
  }
})
