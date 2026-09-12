import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { RestApiResourceError, RestApiValidationError } from '../lib/rest-api-errors.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

for (const relationshipName of ['items', 'mentions']) {
  describe(`Reverse membership allocation, ${relationshipName}`, () => {
    let fixture, adapter
    const size = 205
    const parent = '100000'
    const other = '100001'
    const targets = Array.from({ length: size + 1 }, (_, index) => ({ type: 'items', id: String(index + 1) }))
    const writes = []
    const seed = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
    }
    const parentFields = relationshipName === 'items' ? { groupId: parent } : { subjectType: 'groups', subjectId: parent }
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createIdConformanceApi,
        tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' },
        apiOptions: { polymorphicTargets: ['groups', 'items'] }
      })
      adapter = fixture.api.knex.helpers.getStorageAdapter('items')
      await fixture.api.customize({
        hooks: {
          checkPermissions: {
            functionName: 'reverse-membership-denial',
            handler: ({ context, scopeName }) => {
              const request = context.originalContext
              if (scopeName === 'items' && context.method === 'patch' && request?.denyChildId === request?.id) throw new RestApiResourceError('Child denied', { subtype: 'forbidden' })
            }
          },
          afterDataCallPatch: {
            functionName: 'reverse-membership-writes',
            handler: ({ context, scopeName }) => {
              if (scopeName === 'items') writes.push({ id: context.id, transaction: context.transaction, marker: context.marker })
            }
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      await seed('groups', [{ id: parent, name: 'Parent' }, { id: other, name: 'Other parent' }])
      await seed('items', [
        ...targets.map(({ id }, index) => ({ id, name: `Child ${id}`, ...(index < size ? parentFields : {}) })),
        { id: parent, name: 'Other owner', groupId: other, subjectType: 'groups', subjectId: other },
        { id: other, name: 'Other type', groupId: other, subjectType: 'items', subjectId: parent }
      ])
      writes.length = 0
    })
    after(async () => { await fixture?.close() })
    const mutate = (method, relationshipData, transaction, context) => fixture.api.resources.groups[method]({ id: parent, relationshipName, relationshipData, transaction }, context)
    const membership = async transaction => {
      const query = adapter.buildBaseQuery({ transaction })
      for (const [field, value] of Object.entries(parentFields)) query.where(adapter.translateColumn(field), adapter.translateFilterValue(field, value))
      return (await query).map(row => String(adapter.getFieldValue(row, 'id'))).sort()
    }
    const measured = async operation => {
      const reads = []
      const column = adapter.translateColumn(relationshipName === 'items' ? 'groupId' : 'subjectId').split('.').at(-1)
      const capture = (rows, query) => {
        const sql = query.sql.replace(/["`]/g, '').replace(/\$\d+/g, '?')
        if (Array.isArray(rows) && /^select /.test(sql) && sql.includes(`${column} = ?`) && rows.every(row => Object.keys(row).length === 1)) reads.push({ rows: rows.length, bindings: query.bindings.length, sql })
      }
      fixture.knex.on('query-response', capture)
      try { await operation() } finally { fixture.knex.off('query-response', capture) }
      assert.ok(reads.length > 0, 'membership reads observed')
      assert.ok(reads.every(read => read.rows <= 101), JSON.stringify(reads))
      // MySQL's text protocol retains the complete replacement keep-list.
      assert.ok(reads.every(read => read.bindings <= (databaseClient === 'mysql2' && read.sql.includes(' and not (') ? targets.length + 6 : 106)), JSON.stringify(reads))
      return reads
    }
    const original = targets.slice(0, size).map(row => row.id).sort()

    it('adds one child without reading unrelated existing membership or rewriting retained children', async () => {
      const wanted = [targets[0], targets.at(-1), targets.at(-1)]
      const reads = await measured(() => mutate('postRelationship', wanted, undefined, { marker: 'caller' }))
      assert.ok(reads.every(read => read.rows <= 2))
      assert.deepEqual(await membership(), targets.map(row => row.id).sort())
      assert.deepEqual(writes.map(({ id, marker }) => ({ id, marker })), [{ id: targets.at(-1).id, marker: 'caller' }])
    })

    it('removes only requested members in input order and ignores other owners and missing IDs', async () => {
      const wanted = [targets[150], targets[0], targets[150], { type: 'items', id: parent }, { type: 'items', id: '999999' }]
      const reads = await measured(() => mutate('deleteRelationship', wanted))
      assert.ok(reads.every(read => read.rows <= 2))
      assert.deepEqual(writes.map(row => row.id), [targets[150].id, targets[0].id])
      assert.deepEqual(await membership(), original.filter(id => ![targets[150].id, targets[0].id].includes(id)))
      assert.equal(await fixture.count('items'), size + 3)
    })

    it('deduplicates 33,000 repeated additions before reading membership', async () => {
      const reads = await measured(() => mutate('postRelationship', Array(33000).fill(targets[0])))
      assert.ok(reads.every(read => read.rows <= 1))
      assert.deepEqual(await membership(), original)
      assert.deepEqual(writes, [])
    })

    it('deduplicates 33,000 repeated removals before reading membership', async () => {
      const reads = await measured(() => mutate('deleteRelationship', Array(33000).fill(targets[0])))
      assert.ok(reads.every(read => read.rows <= 1))
      assert.deepEqual(await membership(), original.filter(id => id !== targets[0].id))
      assert.deepEqual(writes.map(row => row.id), [targets[0].id])
    })

    it('removes more than two requested batches in input order', async () => {
      const wanted = targets.slice(0, size).reverse()
      const reads = await measured(() => mutate('deleteRelationship', wanted))
      assert.equal(reads.length, 3)
      assert.deepEqual(await membership(), [])
      assert.deepEqual(writes.map(row => row.id), wanted.map(row => row.id))
    })

    it('replaces a collection using the complete keep-list without rewriting retained children', async () => {
      const wanted = [...targets.slice(2), targets[3]]
      await measured(() => mutate('patchRelationship', wanted))
      assert.deepEqual(await membership(), targets.slice(2).map(row => row.id).sort())
      assert.deepEqual(writes.slice(0, 2).map(row => row.id).sort(), ['1', '2'])
      assert.deepEqual(writes.slice(2).map(row => row.id), [targets.at(-1).id])
    })

    it('clears every child across multiple read pages without skipping rows after writes', async () => {
      const reads = await measured(() => mutate('patchRelationship', []))
      assert.ok(reads.length >= 3)
      assert.deepEqual(await membership(), [])
      assert.deepEqual(writes.map(row => row.id).sort(), original)
      assert.equal(await fixture.count('items'), size + 3)
    })

    for (const borrowed of [false, true]) {
      it(`propagates a second-page read failure in a ${borrowed ? 'borrowed' : 'owned'} transaction`, async t => {
        const failure = new RestApiValidationError('Reverse membership read failed')
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        const column = adapter.translateColumn(relationshipName === 'items' ? 'groupId' : 'subjectId').split('.').at(-1)
        let observed; let attempts = 0
        await fixture.api.customize({
          hooks: {
            beforeDataCall: {
              functionName: 'reverse-membership-query-failure',
              handler: ({ context, scopeName }) => {
                if (!context.failMembershipRead || observed || scopeName !== 'groups') return
                observed = context.transaction
                const query = observed.client.query
                t.mock.method(observed.client, 'query', function (connection, statement) {
                  const sql = statement?.sql?.replace(/["`]/g, '') || ''
                  if (/^select /.test(sql) && sql.includes(`${column} = ?`) && sql.includes(' order by ') && sql.includes(' limit ') && ++attempts === 2) throw failure
                  return query.call(this, connection, statement)
                })
              }
            }
          }
        })
        try {
          await assert.rejects(mutate('patchRelationship', [], transaction, { failMembershipRead: true }), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          assert.equal(attempts, 2)
          assert.equal(writes.length, 101)
          assert.equal(observed.isCompleted(), !borrowed)
          if (borrowed) assert.equal((await membership(transaction)).length, size - 101)
          else assert.deepEqual(await membership(), original)
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
        }
        assert.deepEqual(await membership(), original)
      })

      it(`preserves child failure after a page and ${borrowed ? 'leaves rollback to its owner' : 'rolls back all changes'}`, async () => {
        const ids = (await adapter.buildBaseQuery().whereIn(adapter.getIdColumn(), original).orderBy(adapter.getIdColumn()))
          .map(row => String(adapter.getFieldValue(row, 'id')))
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        try {
          await assert.rejects(mutate('patchRelationship', [], transaction, { denyChildId: ids[105] }), { code: 'REST_API_RESOURCE', subtype: 'forbidden' })
          assert.ok(writes.length >= 101)
          if (borrowed) {
            assert.equal(transaction.isCompleted(), false)
            assert.equal((await membership(transaction)).length, size - writes.length)
          } else assert.deepEqual(await membership(), original)
        } finally { await unit?.rollback() }
        assert.deepEqual(await membership(), original)
      })
    }

    it('keeps a successful replacement pending in the borrowed transaction', async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      const wanted = targets.slice(2)
      try {
        await measured(() => mutate('patchRelationship', wanted, transaction))
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual(await membership(transaction), wanted.map(row => row.id).sort())
        assert.ok(writes.every(row => row.transaction === transaction))
      } finally { await unit.rollback() }
      assert.deepEqual(await membership(), original)
    })

    for (const method of relationshipName === 'items' ? ['patch'] : ['patch', 'put']) {
      it(`bounds membership reads for resource ${method.toUpperCase()} payloads`, async () => {
        const wanted = targets.slice(2)
        await measured(() => fixture.api.resources.groups[method]({
          id: parent, format: 'jsonapi', returning: 'none', document: { data: { type: 'groups', id: parent, attributes: { name: 'Changed' }, relationships: { [relationshipName]: { data: wanted } } } }
        }))
        assert.deepEqual(await membership(), wanted.map(row => row.id).sort())
      })
    }
  })
}

describe('Reverse membership database identity equality', () => {
  let fixture
  const writes = []
  before(async () => {
    fixture = await createConformanceFixture({
      storage: 'knex',
      createApi: createIdConformanceApi,
      apiOptions: { idType: 'string', idCaseInsensitive: true },
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
    await fixture.api.customize({
      hooks: {
        afterDataCallPatch: { functionName: 'reverse-identity-writes', handler: ({ context, scopeName }) => { if (scopeName === 'items') writes.push(context.id) } }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, [{ id: 'owner', name: 'Owner' }])
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, [{ id: 'alpha', name: 'Alpha', groupId: 'owner' }, { id: 'beta', name: 'Beta' }])
    writes.length = 0
  })
  after(async () => { await fixture?.close() })
  const mutate = (method, ids) => fixture.api.resources.groups[method]({ id: 'owner', relationshipName: 'items', relationshipData: ids.map(id => ({ type: 'items', id })) })
  const membership = async () => (await fixture.api.resources.groups.getRelationship({ id: 'owner', relationshipName: 'items' })).data.map(row => row.id).sort()

  for (const method of ['postRelationship', 'patchRelationship']) {
    it(`${method} retains equivalent existing IDs and writes a new database identity once`, async () => {
      await mutate(method, ['ALPHA', 'BETA', 'beta'])
      assert.deepEqual(await membership(), ['alpha', 'beta'])
      assert.deepEqual(writes, ['BETA'])
    })
  }
  it('removes an equivalent ID once without requiring missing targets to exist', async () => {
    await mutate('deleteRelationship', ['ALPHA', 'ALPHA', 'absent'])
    assert.deepEqual(await membership(), [])
    assert.deepEqual(writes, ['ALPHA'])
  })
})
