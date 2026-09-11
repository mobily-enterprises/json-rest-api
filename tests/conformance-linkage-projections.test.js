import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { seedStorageAdapterRecords } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createStorageAdapter } from '../plugins/core/lib/storage/storage-adapter.js'

describe(`Reverse linkage row width (${storageMode.mode})`, () => {
  let fixture, adapter
  const payload = { text: 'Large attribute '.repeat(600) }
  const rows = Array.from({ length: 20 }, (_, index) => ({
    id: String(index + 1),
    name: index === 2 ? 'Hidden' : `Item ${index + 1}`,
    payload,
    groupId: '1',
    singleGroupId: index === 0 ? '1' : null,
    subjectType: 'groups',
    subjectId: '1'
  }))
  const expectedIds = rows.filter(row => row.name !== 'Hidden').map(row => row.id).sort()
  before(async () => {
    fixture = await createConformanceFixture({
      apiOptions: {
        groupOptions: {
          relationships: {
            items: { type: 'hasMany', target: 'items', foreignKey: 'groupId' },
            mentions: { type: 'hasMany', target: 'items', via: 'subject' },
            firstItem: { type: 'hasOne', target: 'items', foreignKey: 'singleGroupId' }
          }
        },
        itemOptions: {
          schema: {
            id: { type: 'id' },
            name: { type: 'string', required: true },
            payload: { type: 'object' },
            groupId: { type: 'id', belongsTo: 'groups', as: 'group', nullable: true },
            singleGroupId: { type: 'id', belongsTo: 'groups', as: 'singleGroup', nullable: true },
            subjectType: { type: 'string', nullable: true },
            subjectId: { type: 'id', nullable: true }
          },
          relationships: { subject: { belongsToPolymorphic: { types: ['groups'], typeField: 'subjectType', idField: 'subjectId' } } }
        }
      }
    })
    adapter = createStorageAdapter({ knex: fixture.knex, schemaInfo: fixture.api.resources.items.vars.schemaInfo })
    await fixture.api.customize({
      hooks: {
        knexQueryFiltering: {
          functionName: 'linkage-projection-filter',
          handler: ({ context }) => {
            const state = context.knexQuery
            if (state?.scopeName !== 'items' || state.queryPurpose !== 'relationship-identifiers') return
            if (context.linkageFailure) throw context.linkageFailure
            state.query = state.query.clone().whereNot(`${state.tableName}.${adapter.translateColumn('name')}`, 'Hidden')
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.groups.vars.schemaInfo, [{ id: '1', name: 'Parent' }, { id: '2', name: 'Other' }])
    await seedStorageAdapterRecords(fixture.knex, fixture.api.resources.items.vars.schemaInfo, rows)
    if (storageMode.isAnyApi()) {
      await fixture.knex('any_records').where('tenant_id', 'other').orWhere('resource', 'other').delete()
      const { id, ...row } = await fixture.knex('any_records').where({ resource: 'items', logical_id: '1' }).first()
      await fixture.knex('any_records').insert([{ ...row, tenant_id: 'other' }, { ...row, resource: 'other' }])
    }
  })
  after(async () => { await fixture?.close() })

  const measured = async operation => {
    const results = []
    const capture = (rows, query) => {
      if (!Array.isArray(rows) || !/^select /i.test(query.sql)) return
      const target = storageMode.isAnyApi() ? query.bindings?.includes('items') : query.sql.includes('conformance_items')
      if (target) results.push({ rowCount: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows)), columns: [...new Set(rows.flatMap(Object.keys))] })
    }
    fixture.knex.on('query-response', capture)
    try { return { value: await operation(), results } } finally { fixture.knex.off('query-response', capture) }
  }
  const read = (method, format, transaction, context) => fixture.api.resources.groups[method]({ id: '1', format, transaction, queryParams: { sort: ['id'] } }, context)
  const check = (value, method, format, expected = expectedIds) => {
    const resource = method === 'query' ? value.data[0] : format === 'plain' ? value : value.data
    for (const name of ['items', 'mentions']) {
      const linkage = format === 'plain' ? resource[name] : resource.relationships[name].data
      assert.deepEqual(linkage.map(row => String(typeof row === 'object' ? row.id : row)).sort(), expected)
    }
    if (storageMode.isAnyApi()) {
      const first = format === 'plain' ? resource.firstItem : resource.relationships.firstItem.data
      assert.equal(String(typeof first === 'object' ? first.id : first), '1')
    }
  }

  for (const format of ['jsonapi', 'plain']) {
    for (const method of ['get', 'query']) {
      it(`${method} ${format} loads linkage without fetching large target attributes`, async t => {
        const { value, results } = await measured(() => read(method, format))
        if (method === 'get' && format === 'jsonapi') t.diagnostic(JSON.stringify(results.map(({ rowCount, bytes, columns }) => ({ rowCount, bytes, columns: columns.length }))))
        check(value, method, format)
        assert.equal(results.length, storageMode.isAnyApi() ? 3 : 2)
        assert.ok(results.every(result => result.rowCount > 0))
        assert.ok(results.every(result => result.columns.length <= (storageMode.isAnyApi() ? 3 : 2)), 'linkage reads must select only identity and reference columns')
        assert.ok(results.every(result => result.bytes < result.rowCount * 256), 'large attributes must not enter linkage result rows')
      })
    }
    it(`${format} uses pending references in a borrowed transaction and preserves rollback`, async () => {
      const transaction = await fixture.knex.transaction()
      try {
        await adapter.buildBaseQuery({ transaction }).where(adapter.getIdColumn(), '20').update(adapter.toStorageRow({ groupId: '2', subjectId: '2' }))
        check(await read('get', format, transaction), 'get', format, expectedIds.filter(id => id !== '20'))
        assert.equal(transaction.isCompleted(), false)
      } finally { await transaction.rollback() }
      check(await read('get', format), 'get', format)
    })
  }

  it('propagates a linkage filter failure without returning partial results', async () => {
    const failure = new Error('Linkage filter failed')
    await assert.rejects(read('get', 'jsonapi', undefined, { linkageFailure: failure }), error => {
      while (error && error !== failure) error = error.cause
      return error === failure
    })
    check(await read('get', 'jsonapi'), 'get', 'jsonapi')
  })
})
