import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertWriteFailure } from './helpers/test-utils.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// These tests always use canonical storage, including the ordinary-mode test job.
for (const direction of ['unpaired', 'inverse', 'forward']) {
  describe(`Canonical link deletion, ${direction}`, () => {
    let fixture, template, targetColumn
    const ownerType = direction === 'forward' ? 'groups' : 'items'
    const targetType = direction === 'forward' ? 'items' : 'groups'
    const relationshipName = direction === 'forward' ? 'members' : 'groups'
    const identifiers = size => Array.from({ length: size }, (_, index) => ({ type: targetType, id: String(index + 1) }))
    const isDelete = ({ sql }) => /^delete from ["`]any_links["`]/.test(sql)
    const isRead = ({ sql }) => /^select .* from ["`]any_links["`]/.test(sql)

    before(async () => {
      fixture = await createConformanceFixture({
        storage: 'anyapi',
        createApi: createIdConformanceApi,
        apiOptions: { inverseMembership: direction !== 'unpaired' },
        databaseOptions: { concurrent: true },
        tables: { links: 'any_links', records: 'any_records' }
      })
      await fixture.api.customize({
        hooks: {
          beforeDataCall: {
            functionName: 'canonical-delete-failure',
            handler: ({ context }) => { if (context.injectDeletion) context.injectDeletion(context.transaction) }
          }
        }
      })
    })
    const mutate = (method, data, { ownerId = '1', transaction } = {}, context = {}) => fixture.api.resources[ownerType][method]({
      id: ownerId, relationshipName, relationshipData: data, transaction
    }, context)
    const ownerRows = transaction => (transaction || fixture.knex)('any_links')
      .where({ tenant_id: 'conformance', [targetColumn === 'left_id' ? 'right_id' : 'left_id']: '1' })
      .orderBy('id')
    const fill = async size => {
      const records = identifiers(size).map(({ id }) => ({ id, name: `Target ${id}` }))
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[targetType].vars.schemaInfo, records)
    }
    const linkCopies = async ids => {
      await seedCanonicalLinkRows(fixture.knex, ids.map(id => ({ ...template, [targetColumn]: id })))
    }
    beforeEach(async () => {
      await fixture.reset()
      await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[ownerType].vars.schemaInfo, [
        { id: '1', name: 'Owner' }, { id: '2', name: 'Other owner' }
      ])
      await fill(206)
      await mutate('postRelationship', identifiers(1))
      const { id, ...row } = await fixture.knex('any_links').first()
      template = row
      targetColumn = row.left_resource === targetType ? 'left_id' : 'right_id'
      await linkCopies(identifiers(205).slice(1).map(row => row.id))
    })
    after(async () => { await fixture?.close() })
    const measured = async operation => {
      const queries = []; const rowCounts = []
      const query = entry => { if (isRead(entry) || isDelete(entry)) queries.push(entry) }
      const response = (rows, entry) => { if (isRead(entry) && Array.isArray(rows)) rowCounts.push(rows.length) }
      fixture.knex.on('query', query)
      fixture.knex.on('query-response', response)
      try { await operation() } finally {
        fixture.knex.off('query', query)
        fixture.knex.off('query-response', response)
      }
      return { queries, rowCounts }
    }

    it('removes 205 IDs in three bounded deletes without reading all membership', async () => {
      await mutate('postRelationship', identifiers(1), { ownerId: '2' })
      const { queries } = await measured(() => mutate('deleteRelationship', [...identifiers(205), ...identifiers(1), { type: targetType, id: '99999' }]))
      assert.equal(queries.filter(isRead).length, 0)
      assert.equal(queries.filter(isDelete).length, 3)
      assert.ok(queries.every(row => row.bindings.length <= 211))
      assert.deepEqual(await ownerRows(), [])
      assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 1)
      const target = fixture.api.knex.helpers.getStorageAdapter(targetType)
      assert.equal(Number((await target.buildBaseQuery().count('* as count'))[0].count), 206)
    })

    it('deduplicates a repeated removal and performs no work for an empty removal', async () => {
      const repeated = Array.from({ length: 33000 }, () => ({ type: targetType, id: '1' }))
      const { queries } = await measured(() => mutate('deleteRelationship', repeated))
      assert.equal(queries.filter(isDelete).length, 1)
      assert.equal(queries.filter(isRead).length, 0)
      assert.equal((await ownerRows()).length, 204)
      assert.deepEqual((await measured(() => mutate('deleteRelationship', []))).queries, [])
    })

    it('replaces membership with one delete and keeps retained row IDs and payloads', async () => {
      await fixture.knex('any_links').where(targetColumn, '205').update({ payload: '{"keep":true}' })
      const retained = await fixture.knex('any_links').where(targetColumn, '205').first()
      const desired = identifiers(206).slice(204)
      const { queries, rowCounts } = await measured(() => mutate('patchRelationship', desired))
      assert.equal(queries.filter(isDelete).length, 1)
      assert.ok(rowCounts.every(count => count <= 2), JSON.stringify(rowCounts))
      assert.deepEqual((await ownerRows()).map(row => row[targetColumn]).sort(), ['205', '206'])
      assert.deepEqual(await fixture.knex('any_links').where('id', retained.id).first(), retained)
    })

    it('clears an entire membership without materializing its old rows', async () => {
      const { queries } = await measured(() => mutate('patchRelationship', []))
      assert.equal(queries.filter(isRead).length, 0)
      assert.equal(queries.filter(isDelete).length, 1)
      assert.deepEqual(await ownerRows(), [])
    })

    it('keeps other tenants, relationships and target resource types outside deletion', async () => {
      const targetResource = targetColumn === 'left_id' ? 'left_resource' : 'right_resource'
      const sentinels = [
        { ...template, tenant_id: 'other-tenant' },
        { ...template, relationship: 'other-relationship', inverse_relationship: null },
        { ...template, [targetResource]: 'other-resource' }
      ]
      await seedCanonicalLinkRows(fixture.knex, sentinels)
      await mutate('deleteRelationship', identifiers(205))
      const remaining = await fixture.knex('any_links').orderBy('id')
      assert.equal(remaining.length, sentinels.length)
      assert.deepEqual(remaining.map(({ id, ...row }) => row), sentinels)
    })

    it('lists only the declared target resource when another type reuses an ID', async () => {
      const targetResource = targetColumn === 'left_id' ? 'left_resource' : 'right_resource'
      await seedCanonicalLinkRows(fixture.knex, [{ ...template, [targetResource]: 'other-resource' }])
      const result = await fixture.api.anyapi.links.listMany({
        scopeName: ownerType, relName: relationshipName, context: { id: '1', db: fixture.knex }
      })
      assert.deepEqual(result.map(row => row.id).sort(), identifiers(205).map(row => row.id).sort())
      assert.ok(result.every(row => row.type === targetType))
    })

    if (direction !== 'unpaired') {
      it('keeps a link created in the opposite orientation before its inverse was declared', async () => {
        const retained = await fixture.knex('any_links').where(targetColumn, '1').first()
        const opposite = {
          relationship: retained.inverse_relationship,
          inverse_relationship: null,
          left_resource: retained.right_resource,
          left_id: retained.right_id,
          right_resource: retained.left_resource,
          right_id: retained.left_id,
          payload: '{"old-orientation":true}'
        }
        await fixture.knex('any_links').where('id', retained.id).update(opposite)
        await mutate('patchRelationship', [identifiers(1)[0], { type: targetType, id: '206' }])
        const rows = await fixture.knex('any_links').orderBy('id')
        assert.equal(rows.length, 2)
        const kept = rows.find(row => row.id === retained.id)
        assert.ok(kept)
        assert.equal(kept.payload, opposite.payload)
        assert.equal(kept.relationship, opposite.relationship)
        assert.equal(kept.inverse_relationship, retained.relationship)
        const result = await fixture.api.anyapi.links.listMany({ scopeName: ownerType, relName: relationshipName, context: { id: '1', db: fixture.knex } })
        assert.deepEqual(result.map(row => row.id).sort(), ['1', '206'])
        await mutate('deleteRelationship', identifiers(1))
        assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 1)
      })

      for (const method of ['deleteRelationship', 'patchRelationship']) {
        it(`${method} removes omitted links whose inverse metadata is missing`, async () => {
          await fixture.knex('any_links').update({ inverse_relationship: null })
          await mutate(method, method === 'deleteRelationship' ? identifiers(205) : [])
          assert.deepEqual(await ownerRows(), [])
        })
      }
    }

    it('holds deleted rows until the borrower rolls back and preserves the other owner', async () => {
      await mutate('postRelationship', identifiers(1), { ownerId: '2' })
      const last = await fixture.knex('any_links').where(targetColumn, '205').first()
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await mutate('deleteRelationship', identifiers(205), { transaction })
        assert.equal(transaction.isCompleted(), false)
        assert.deepEqual(await ownerRows(transaction), [])
        if (databaseClient !== 'better-sqlite3') {
          const contender = await fixture.knex.transaction()
          try {
            await assert.rejects(contender('any_links').where('id', last.id).forUpdate().noWait().first(), {
              code: databaseClient === 'pg' ? '55P03' : 'ER_LOCK_NOWAIT'
            })
          } finally { await contender.rollback() }
        }
      } finally { await unit.rollback() }
      assert.equal((await ownerRows()).length, 205)
      assert.equal(Number((await fixture.knex('any_links').count('* as count'))[0].count), 206)
    })

    for (const borrowed of [false, true]) {
      it(`retains a second-batch deletion error with ${borrowed ? 'borrowed' : 'owned'} transaction`, async t => {
        const failure = new RestApiValidationError('Second canonical delete failed')
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        const context = {}; let attempts = 0
        context.injectDeletion = trx => {
          const original = trx.client.query
          t.mock.method(trx.client, 'query', function (connection, statement) {
            if (isDelete(statement) && ++attempts === 2) throw failure
            return original.call(this, connection, statement)
          })
        }
        try {
          await assert.rejects(mutate('deleteRelationship', identifiers(205), { transaction }, context), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          assert.equal(attempts, 2)
          assert.equal(context.transaction.isCompleted(), !borrowed)
          if (borrowed) assert.equal((await ownerRows(transaction)).length, 105)
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
        }
        assert.equal((await ownerRows()).length, 205)
      })

      it(`retains new links pending a replacement deletion failure (${borrowed ? 'borrowed' : 'owned'})`, async t => {
        const failure = new RestApiValidationError('Replacement delete failed')
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        const context = {
          injectDeletion: trx => {
            const original = trx.client.query
            t.mock.method(trx.client, 'query', function (connection, statement) {
              if (isDelete(statement)) throw failure
              return original.call(this, connection, statement)
            })
          }
        }
        try {
          await assert.rejects(mutate('patchRelationship', identifiers(206).slice(204), { transaction }, context), error => assertWriteFailure(error, { cause: failure, outcome: borrowed ? 'pending' : 'rolledBack' }))
          if (borrowed) {
            assert.equal(transaction.isCompleted(), false)
            assert.equal((await ownerRows(transaction)).length, 206)
          }
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
        }
        assert.equal((await ownerRows()).length, 205)
      })
    }

    if (direction === 'inverse') {
      it('retains a complete 33,000-ID replacement in one SQL predicate', async () => {
        for (let start = 207; start <= 33000; start += 200) {
          const records = Array.from({ length: Math.min(200, 33001 - start) }, (_, index) => ({ id: String(start + index), name: `Target ${start + index}` }))
          await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[targetType].vars.schemaInfo, records)
        }
        await linkCopies(Array.from({ length: 33000 - 205 }, (_, index) => String(index + 206)))
        const before = await fixture.knex('any_links').select('id', targetColumn).orderBy('id')
        const transaction = await fixture.knex.transaction()
        try {
          const { queries } = await measured(() => fixture.api.anyapi.links.syncMany({
            scopeName: ownerType,
            relName: relationshipName,
            isUpdate: true,
            relData: [...identifiers(33000), ...identifiers(1)],
            context: { id: '1', transaction }
          }))
          const deletes = queries.filter(isDelete)
          assert.equal(deletes.length, 1)
          if (databaseClient !== 'mysql2') assert.ok(deletes[0].bindings.length <= 12)
          assert.deepEqual(await transaction('any_links').select('id', targetColumn).orderBy('id'), before)
          assert.equal(transaction.isCompleted(), false)
        } finally { await transaction.rollback() }
      })
    }
  })
}
