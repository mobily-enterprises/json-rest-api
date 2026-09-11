import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, seedCanonicalLinkRows, seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { databaseClient } from './helpers/test-database.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

// Physical canonical-edge behavior is the same in either outer runner mode.
for (const direction of ['unpaired', 'forward', 'inverse']) {
  describe(`Canonical attachment pages, ${direction}`, () => {
    let fixture, template, targetColumn
    const ownerType = direction === 'forward' ? 'groups' : 'items'
    const targetType = direction === 'forward' ? 'items' : 'groups'
    const relationshipName = direction === 'forward' ? 'members' : 'groups'
    const identifier = id => ({ type: targetType, id: String(id) })
    const isRead = sql => /^select ["`]id["`], ["`]left_id["`]/.test(sql) && sql.includes('any_links')
    before(async () => {
      fixture = await createConformanceFixture({
        storage: 'anyapi',
        createApi: createIdConformanceApi,
        apiOptions: { inverseMembership: direction !== 'unpaired', idType: 'string' },
        databaseOptions: { concurrent: true },
        tables: { links: 'any_links', records: 'any_records' }
      })
      await fixture.api.customize({
        hooks: {
          beforeDataCall: {
            functionName: 'attachment-page-transaction',
            handler: ({ context }) => context.captureAttachmentTransaction?.(context.transaction)
          }
        }
      })
    })
    const seed = async (type, records) => {
      for (let offset = 0; offset < records.length; offset += 100) await seedStorageAdapterRecords(fixture.knex, fixture.api.resources[type].vars.schemaInfo, records.slice(offset, offset + 100))
    }
    const copy = (id, reverse = false) => {
      const row = { ...template, [targetColumn]: String(id) }
      return reverse && direction !== 'unpaired'
        ? { ...row, relationship: row.inverse_relationship, inverse_relationship: row.relationship, left_resource: row.right_resource, left_id: row.right_id, right_resource: row.left_resource, right_id: row.left_id }
        : row
    }
    const add = (ids, transaction, context) => fixture.api.resources[ownerType].postRelationship({
      id: '100000', relationshipName, relationshipData: ids.map(identifier), transaction
    }, context)
    const rows = (transaction = fixture.knex) => transaction('any_links').orderBy('id')
    beforeEach(async () => {
      await fixture.reset()
      await seed(ownerType, [{ id: '100000', name: 'Owner' }, { id: '100001', name: 'Other owner' }])
      await seed(targetType, Array.from({ length: 206 }, (_, i) => ({ id: String(i + 1), name: `Target ${i + 1}` })))
      await add(['1'])
      const { id, ...row } = await fixture.knex('any_links').first()
      template = row
      targetColumn = row.left_resource === targetType ? 'left_id' : 'right_id'
      await seedCanonicalLinkRows(fixture.knex, Array.from({ length: 500 }, (_, i) => ({ ...copy('1', i % 2 === 0), payload: JSON.stringify({ retained: i }) })))
    })
    after(async () => { await fixture?.close() })
    const measure = async operation => {
      const reads = []
      const capture = (result, query) => { if (Array.isArray(result) && isRead(query.sql)) reads.push({ rows: result.length, bindings: query.bindings.length }) }
      fixture.knex.on('query-response', capture)
      try { await operation() } finally { fixture.knex.off('query-response', capture) }
      assert.ok(reads.length)
      assert.ok(reads.every(read => read.rows <= 101 && read.bindings <= 216), JSON.stringify(reads))
      return reads
    }

    it('bounds duplicate-edge reads for 33,000 repeated IDs and keeps borrowed locks', async () => {
      const before = await rows()
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await measure(() => add(Array.from({ length: 33000 }, () => '1'), transaction))
        assert.deepEqual(await rows(transaction), before)
        assert.equal(transaction.isCompleted(), false)
        if (databaseClient !== 'better-sqlite3') {
          const contender = await fixture.knex.transaction()
          try {
            await assert.rejects(contender('any_links').where('id', before.at(-1).id).forUpdate().noWait().first(), {
              code: databaseClient === 'pg' ? '55P03' : 'ER_LOCK_NOWAIT'
            })
          } finally { await contender.rollback() }
        }
      } finally { await unit.rollback() }
      assert.deepEqual(await rows(), before)
    })

    it('finds a retained target after duplicate pages and inserts only the missing target', async () => {
      const other = { ...copy('1'), [targetColumn === 'left_id' ? 'right_id' : 'left_id']: '100001' }
      await seedCanonicalLinkRows(fixture.knex, [{ ...copy('206', true), payload: '{"last":true}' }, other])
      const before = await rows()
      await measure(() => add(['1', '206', '205']))
      const after = await rows()
      assert.equal(after.length, before.length + 1)
      assert.deepEqual(after.slice(0, before.length), before)
      assert.equal(after.at(-1)[targetColumn], '205')
    })

    it('handles physical pages inside several requested-ID batches', async () => {
      await seedCanonicalLinkRows(fixture.knex, Array.from({ length: 204 }, (_, i) => copy(String(i + 2), i % 2 === 0)))
      const before = await rows()
      await measure(() => add([...Array.from({ length: 205 }, (_, i) => String(i + 1)), '1', '205']))
      assert.deepEqual(await rows(), before)
    })

    if (direction !== 'unpaired') {
      it('repairs the first retained inverse marker without changing duplicate payloads', async () => {
        const first = await fixture.knex('any_links').first()
        await fixture.knex('any_links').where('id', first.id).update({ inverse_relationship: null })
        const before = await rows()
        await measure(() => add(['1']))
        const after = await rows()
        assert.equal(after[0].inverse_relationship, first.inverse_relationship)
        assert.deepEqual({ ...after[0], inverse_relationship: null, updated_at: before[0].updated_at }, before[0])
        assert.deepEqual(after.slice(1), before.slice(1))
      })
    }

    for (const borrowed of [false, true]) {
      it(`rejects a later read page after successful inserts with ${borrowed ? 'borrowed' : 'owned'} ownership`, async t => {
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        let observed
        const failure = new RestApiValidationError('Attachment page failed')
        const captureAttachmentTransaction = value => {
          if (!value || observed) return
          observed = value
          const original = value.client.query
          t.mock.method(value.client, 'query', function (connection, statement) {
            const sql = typeof statement === 'string' ? statement : statement.sql
            if (isRead(sql) && /["`]id["`] > /.test(sql)) throw failure
            return original.call(this, connection, statement)
          })
        }
        try {
          await assert.rejects(add([...Array.from({ length: 100 }, (_, i) => String(i + 2)), '1', '102'], transaction, {
            captureAttachmentTransaction
          }), { code: 'REST_API_VALIDATION', message: 'Attachment page failed' })
          assert.ok(observed)
          assert.equal(observed.isCompleted(), !borrowed)
          assert.equal((await rows(transaction)).length, borrowed ? 601 : 501)
        } finally {
          t.mock.restoreAll()
          await unit?.rollback()
          if (observed && !observed.isCompleted()) await observed.rollback()
        }
        assert.equal((await rows()).length, 501)
      })
    }

    if (databaseClient === 'mysql2') {
      it('resolves different stored spellings through database equality after paging', async () => {
        // Native fixtures use binary equality unless a case explicitly changes its columns.
        await fixture.knex.raw('ALTER TABLE ?? MODIFY ?? VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL', ['any_records', 'logical_id'])
        for (const column of ['left_id', 'right_id']) {
          await fixture.knex.raw('ALTER TABLE ?? MODIFY ?? VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL', ['any_links', column])
        }
        await seed(targetType, [{ id: 'Alpha', name: 'Alphabetic target' }])
        assert.ok(await fixture.knex('any_records').where({ resource: targetType, logical_id: 'alpha' }).first())
        await seedCanonicalLinkRows(fixture.knex, Array.from({ length: 205 }, (_, i) => copy(i % 2 ? 'ALPHA' : 'Alpha', i % 2 === 0)))
        const before = await rows()
        await measure(() => add(['alpha', 'aLpHa']))
        assert.deepEqual(await rows(), before)
      })
    }
  })
}
