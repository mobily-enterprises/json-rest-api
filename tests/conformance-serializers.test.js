import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

const tables = { items: 'schema_enrichment_items' }

describe(`Custom scalar serialization (${storageMode.mode})`, () => {
  let fixture, items
  let asynchronous = null
  const calls = []
  const serializeCode = (value, details) => {
    calls.push({ value, ...details })
    if (asynchronous === 'resolve') return Promise.resolve(value)
    if (asynchronous === 'reject') return Promise.reject(new Error('Rejected asynchronous serializer'))
    if (asynchronous === 'proxy') return new Proxy({}, { get: (_target, property) => property === 'then' ? resolve => resolve(value) : undefined })
    if (asynchronous === 'function') return Object.assign(() => {}, { then: resolve => resolve(value) })
    return value == null ? null : `stored:${value}`
  }
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        projections: true,
        fields: {
          coded: { type: 'string', nullable: true, search: true, storage: { column: 'stored code', serialize: serializeCode }, getter: value => value?.replace(/^stored:/, '') ?? null },
          scaled: {
            type: 'number',
            nullable: true,
            search: true,
            storage: { serialize: (value, details) => { calls.push({ value, ...details }); return value == null ? null : value * 10 } },
            getter: value => value == null ? null : value / 10
          }
        },
        searchSchema: { codes: { type: 'array', actualField: 'coded', filterOperator: 'in' } },
        resourceOptions: {
          queryFields: {
            projectedCode: {
              type: 'string',
              nullable: true,
              sortable: true,
              getter: value => value?.replace(/^stored:/, '') ?? null,
              select: ({ knex, column }) => knex.raw('??', [column('coded')])
            },
            projectedEpoch: {
              type: 'dateTime',
              nullable: true,
              sortable: true,
              select: ({ knex, column }) => knex.raw('?? * 1000', [column('scaled')])
            }
          }
        }
      }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => { await fixture.reset(); calls.length = 0; asynchronous = null })
  after(async () => fixture?.close())

  for (const format of ['jsonapi', 'plain']) {
    it(`writes, filters and reads each scalar exactly once (${format})`, async () => {
      let id
      for (const [method, coded, scaled] of [['post', '', 0], ['put', 'second', -2], ['patch', 'third', 3], ['patch', null, null]]) {
        calls.length = 0
        const attributes = { name: method, coded, scaled }
        const response = await items[method]({
          ...(id ? { id } : {}),
          format,
          inputRecord: format === 'plain' ? attributes : createJsonApiDocument('items', attributes)
        })
        id = format === 'plain' ? response.id : response.data.id
        assert.equal((format === 'plain' ? response : response.data.attributes).coded, coded)
        assert.equal((format === 'plain' ? response : response.data.attributes).scaled, scaled)
        assert.deepEqual(calls.map(call => call.operation), [method, method])
        for (const call of calls) assert.equal(call.context.scopeName, 'items')
        for (const filters of [{ coded }, { codes: [coded] }, { scaled }]) {
          calls.length = 0
          const result = await items.query({ format, queryParams: { filters } })
          // SQL IN (NULL) is unknown; scalar equality uses IS NULL.
          assert.deepEqual(result.data.map(row => row.id), Object.hasOwn(filters, 'codes') && coded === null ? [] : [id])
          assert.equal(calls.length, 1)
          assert.equal(calls[0].operation, 'filter')
          assert.equal(calls[0].context, null)
        }
        calls.length = 0
        const read = await items.get({ id, format, queryParams: { fields: { items: 'coded,scaled,projectedCode' } } })
        assert.equal((format === 'plain' ? read : read.data.attributes).coded, coded)
        assert.equal((format === 'plain' ? read : read.data.attributes).projectedCode, coded)
        assert.equal(calls.length, 0)
      }
    })

    for (const field of ['coded', 'scaled', 'projectedCode', 'projectedEpoch']) {
      for (const descending of [false, true]) {
        it(`traverses stored ${field} values ${descending ? 'descending' : 'ascending'} with ties, nulls and sparse fields (${format})`, async () => {
          for (const [index, coded, scaled] of [[1, 'alpha', 1], [2, 'alpha', 1], [3, 'beta', 2], [4, null, null]]) {
            await fixture.seed('items', { name: `Row ${index}`, coded, scaled })
          }
          calls.length = 0
          const page = cursor => items.query({ format, queryParams: { fields: { items: 'name' }, sort: [`${descending ? '-' : ''}${field}`], page: { size: 1, ...cursor } } })
          const expected = descending ? ['3', '1', '2', '4'] : ['1', '2', '3', '4']
          const seen = []; const cursors = []
          let after, nextLink
          for (let index = 0; index < expected.length; index++) {
            const result = index % 2 && nextLink
              ? await items.query({ format, queryParams: parseJsonApiQuery(new URL(nextLink, 'http://test.invalid').search.slice(1)) })
              : await page(after ? { after } : {})
            assert.equal(result.data.length, 1)
            seen.push(result.data[0].id)
            const attributes = format === 'plain' ? result.data[0] : result.data[0].attributes
            assert.deepEqual(Object.keys(attributes).sort(), format === 'plain' ? ['id', 'name'] : ['name'])
            after = result.meta.pagination.cursor?.next
            nextLink = result.links?.next
            if (after) cursors.push(after)
          }
          assert.deepEqual(seen, expected)
          assert.equal(after, undefined)
          let before = cursors.at(-1)
          const reversed = []
          for (let index = 0; index < 2; index++) {
            const result = await page({ before })
            assert.equal(result.data.length, 1)
            reversed.unshift(result.data[0].id)
            before = result.meta.pagination.cursor?.next
          }
          assert.deepEqual(reversed, expected.slice(0, 2))
          assert.equal(before, undefined)
          assert.equal(calls.length, 0, 'stored cursor values must not run through a write serializer')
        })
      }
    }
  }

  it('rejects malformed custom scalar cursors without invoking serializers', async () => {
    for (const parameter of ['after', 'before']) {
      await assert.rejects(items.query({ queryParams: { sort: ['scaled'], page: { size: 1, [parameter]: 'scaled:not-a-number,id:1' } } }), RestApiValidationError)
    }
    assert.equal(calls.length, 0)
  })

  for (const behavior of ['resolve', 'reject', 'proxy', 'function']) {
    it(`rejects ${behavior} asynchronous serializer results before writes or filters execute`, async () => {
      const item = await fixture.seed('items', { coded: 'original' })
      asynchronous = behavior
      for (const method of ['post', 'put', 'patch']) {
        await assert.rejects(items[method]({
          ...(method === 'post' ? {} : { id: item.id }),
          returning: 'none',
          inputRecord: createJsonApiDocument('items', { coded: 'replacement' })
        }), /storage\.serialize.*synchronous/)
        assert.equal(await fixture.count('items'), 1)
        assert.equal((await items.get({ id: item.id })).data.attributes.coded, 'original')
      }
      for (const filters of [{ coded: 'original' }, { codes: ['original'] }]) {
        await assert.rejects(items.query({ queryParams: { filters } }), /storage\.serialize.*synchronous/)
      }
      await new Promise(resolve => setImmediate(resolve))
    })
  }

  if (storageMode.isAnyApi()) {
    it('preserves the compiled schema, descriptor and records after a rejected identity field addition', async () => {
      const item = await fixture.seed('items', { name: 'Existing', coded: 'original' })
      const schemaInfo = items.vars.schemaInfo
      const snapshot = async () => {
        const result = {}
        for (const table of ['any_records', 'any_resource_configs', 'any_field_configs', 'any_relationship_configs']) {
          result[table] = await fixture.knex(table).orderBy('id')
        }
        return result
      }
      const original = await snapshot()
      await assert.rejects(items.addKnexFields({
        fields: {
          invalidOwnerId: { type: 'id', belongsTo: 'items', as: 'invalidOwner', storage: { serialize: value => value } }
        }
      }), /storage\.serialize.*identity/)
      assert.equal(items.vars.schemaInfo, schemaInfo)
      assert.deepEqual(await snapshot(), original)
      assert.equal((await items.get({ id: item.id })).data.attributes.coded, 'original')
      assert.equal((await fixture.seed('items', { coded: 'new' })).attributes.coded, 'new')
    })
  }
})

for (const origin of ['authored', 'enriched']) {
  for (const field of ['id', 'recordId', 'ownerId', 'subjectId', 'subjectType']) {
    it(`rejects ${origin} serialization on identity field ${field} (${storageMode.mode})`, async () => {
      const fields = {
        id: { type: 'id' },
        recordId: { type: 'id', nullable: true },
        ownerId: { type: 'id', nullable: true, belongsTo: 'items', as: 'owner' },
        subjectId: { type: 'id', nullable: true },
        subjectType: { type: 'string', nullable: true }
      }
      const serializer = { serialize: value => value }
      if (origin === 'authored') fields[field].storage = serializer
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({
            createApi: createSchemaEnrichmentApi,
            tables,
            apiOptions: {
              fields,
              resourceOptions: {
                ...(field === 'recordId' ? { idProperty: 'recordId' } : {}),
                relationships: { subject: { belongsToPolymorphic: { types: ['items'], typeField: 'subjectType', idField: 'subjectId' } } }
              },
              ...(origin === 'enriched'
                ? {
                    hooks: { 'schema:enrich': { functionName: 'unsupported-identity-serializer', handler: ({ context }) => { context.fields[field].storage = serializer } } }
                  }
                : {})
            }
          })
        }, /storage\.serialize.*identity|identity.*storage\.serialize/)
      } finally { await fixture?.close() }
    })
  }
}
