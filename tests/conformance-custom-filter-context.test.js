import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Explicit custom-filter translation (${storageMode.mode})`, () => {
  let fixture
  const calls = []
  const filter = field => function (query, input, details) {
    assert.equal(this, query)
    const column = details.column(field)
    const value = details.value(field, input)
    calls.push({ column, value, scopeName: details.scopeName, marker: details.context.marker })
    query.where(column, value)
  }
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createConformanceApi,
      apiOptions: {
        groupOptions: {
          schema: { id: { type: 'id' }, name: { type: 'string', required: true }, code: { type: 'string', indexed: true, storage: { column: 'stored code', serialize: value => `stored:${value}` } } }
        },
        itemOptions: {
          schema: {
            id: { type: 'id' },
            name: { type: 'string', required: true },
            code: { type: 'string', storage: { column: 'stored code', serialize: value => `stored:${value}` } },
            groupId: { type: 'id', nullable: true, belongsTo: 'groups', as: 'group' }
          },
          searchSchema: {
            codeMatches: { type: 'string', applyFilter: filter('code') },
            ownerCodeMatches: { type: 'string', actualField: 'groups.code', applyFilter: filter('groups.code') }
          }
        }
      }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    const owner = await fixture.seed('groups', { name: 'Group', code: 'needle' })
    await fixture.seed('items', { name: 'Owner', code: 'needle' })
    await fixture.seed('items', { name: 'Child', code: 'different' }, { group: { data: { type: 'groups', id: owner.id } } })
    calls.length = 0
  })
  after(async () => { await fixture?.close() })

  for (const format of ['jsonapi', 'plain']) {
    for (const [field, expected] of [['codeMatches', 'Owner'], ['ownerCodeMatches', 'Child']]) {
      it(`translates ${field} columns and serialized values with a borrowed transaction (${format})`, async () => {
        const transaction = await fixture.knex.transaction()
        try {
          const result = await fixture.api.resources.items.query({
            transaction,
            format,
            queryParams: { filters: { [field]: 'needle' }, page: { number: 1, size: 10 } }
          }, { marker: 'custom filter context' })
          assert.deepEqual(result.data.map(row => format === 'plain' ? row.name : row.attributes.name), [expected])
          assert.equal(result.meta.pagination.total, 1)
          assert.ok(calls.length > 0)
          for (const call of calls) {
            assert.equal(call.value, 'stored:needle')
            assert.equal(call.scopeName, 'items')
            assert.equal(call.marker, 'custom filter context')
            assert.ok(call.column.includes('.'))
          }
          assert.equal(transaction.isCompleted(), false)
        } finally { await transaction.rollback() }
      })
    }
  }
})
