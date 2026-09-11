import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi, createConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

for (const type of ['object', 'array']) {
  for (const custom of [false, true]) {
    describe(`Structured query boundaries for ${type}, custom=${custom} (${storageMode.mode})`, () => {
      let fixture, items, adapter
      let serialized = 0
      const encode = value => value === null ? null : type === 'object' ? { value } : [value]
      const numericExpression = (knex, column) => {
        const segments = [...(custom ? ['wrapped'] : []), type === 'object' ? 'value' : '0']
        if (databaseClient === 'pg') return knex.raw('CAST(CAST(?? AS json) #>> ?::text[] AS integer)', [column, `{${segments.join(',')}}`])
        const jsonPath = `${custom ? '$.wrapped' : '$'}${type === 'object' ? '.value' : '[0]'}`
        return databaseClient === 'mysql2'
          ? knex.raw('CAST(JSON_UNQUOTE(JSON_EXTRACT(??, ?)) AS SIGNED)', [column, jsonPath])
          : knex.raw('CAST(json_extract(??, ?) AS INTEGER)', [column, jsonPath])
      }
      before(async () => {
        fixture = await createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables: { items: 'schema_enrichment_items' },
          apiOptions: {
            projections: true,
            fields: {
              payload: {
                type,
                nullable: true,
                ...(custom
                  ? {
                      storage: { serialize: value => { serialized++; return value === null ? null : JSON.stringify({ wrapped: value }) } },
                      getter: value => value === null ? null : (typeof value === 'string' ? JSON.parse(value) : value).wrapped
                    }
                  : {})
              }
            },
            searchSchema: {
              valueIs: {
                type: 'integer',
                applyFilter: (query, value) => {
                  const expression = numericExpression(fixture.knex, adapter.translateColumn('payload')).toSQL()
                  query.whereRaw(`(${expression.sql}) = ?`, [...expression.bindings, value])
                }
              }
            },
            resourceOptions: {
              queryFields: {
                payloadValue: { type: 'integer', sortable: true, normallyHidden: true, select: ({ knex, column }) => numericExpression(knex, column('payload')) }
              }
            }
          }
        })
        items = fixture.api.resources.items
        adapter = fixture.api.knex.helpers.getStorageAdapter('items')
      })
      beforeEach(async () => {
        await fixture.reset()
        for (const value of [2, 1, 2, null]) await fixture.seed('items', { name: String(value), payload: encode(value) })
        serialized = 0
      })
      after(async () => fixture?.close())

      it('rejects direct adapter whole-document comparisons before serialization', () => {
        for (const value of [encode(2), null, []]) {
          assert.throws(() => adapter.translateFilterValue('payload', value), error => {
            assert.ok(error instanceof RestApiValidationError)
            assert.match(error.message, /scalar|custom.*filter/i)
            return true
          })
        }
        assert.equal(serialized, 0)
      })

      it('rejects whole-document sorts before executing a query', async () => {
        const queries = []
        const onQuery = event => queries.push(event.sql)
        fixture.knex.on('query', onQuery)
        try {
          for (const sort of ['payload', '-payload']) {
            await assert.rejects(items.query({ queryParams: { sort: [sort], page: { size: 1 } } }), error => {
              assert.ok(error instanceof RestApiValidationError)
              return true
            })
          }
        } finally { fixture.knex.off('query', onQuery) }
        assert.deepEqual(queries, [])
      })

      for (const format of ['jsonapi', 'plain']) {
        it(`allows explicit SQL filters on extracted scalar values (${format})`, async () => {
          const result = await items.query({ format, queryParams: { filters: { valueIs: 2 }, page: { number: 1, size: 1 } } })
          assert.deepEqual(result.data.map(item => item.id), ['1'])
          assert.equal(result.meta.pagination.total, 2)
          assert.equal(serialized, 0)
        })

        for (const direction of ['', '-']) {
          it(`traverses extracted scalar projection cursors (${direction || 'ascending'}, ${format})`, async () => {
            const expected = direction ? ['1', '3', '2', '4'] : ['2', '1', '3', '4']
            const query = page => items.query({ format, queryParams: { sort: [`${direction}payloadValue`], fields: { items: 'name' }, page: { size: 1, ...page } } })
            const seen = []; const cursors = []
            let after, response
            for (let index = 0; index < expected.length; index++) {
              response = await query(after ? { after } : {})
              seen.push(...response.data.map(item => item.id))
              after = response.meta.pagination.cursor?.next
              if (after) cursors.push(after)
              assert.equal(Object.hasOwn(format === 'plain' ? response.data[0] : response.data[0].attributes, 'payloadValue'), false)
            }
            assert.deepEqual(seen, expected)
            assert.equal(after, undefined)
            const backwards = []
            let page = { before: cursors.at(-1) }
            for (let index = 0; index < expected.length - 2; index++) {
              response = await query(page)
              backwards.push(...response.data.map(item => item.id))
              if (response.links.next) page = parseJsonApiQuery(new URL(response.links.next, 'http://localhost').search.slice(1)).page
            }
            assert.deepEqual(backwards, expected.slice(0, -2).reverse())
            assert.equal(response.links.next, undefined)
            assert.equal(serialized, 0)
          })
        }
      }
    })
  }
}

describe(`Invalid structured query declarations (${storageMode.mode})`, () => {
  for (const type of ['object', 'array']) {
    for (const [label, options] of [
      ['automatic search', { fields: { payload: { type, search: true } } }],
      ['search alias', { fields: { payload: { type } }, searchSchema: { byPayload: { type, actualField: 'payload' } } }],
      ['oneOf', { fields: { payload: { type } }, searchSchema: { anywhere: { type: 'string', oneOf: ['name', 'payload'] } } }],
      ['explicit sortable fields', { fields: { payload: { type } }, resourceOptions: { sortableFields: ['payload'] } }],
      ['default sort', { fields: { payload: { type } }, resourceOptions: { defaultSort: ['-payload'] } }],
      ['sortable projection', { resourceOptions: { queryFields: { payload: { type, sortable: true, select: ({ knex }) => knex.raw('null') } } } }]
    ]) {
      it(`rejects ${type} ${label} during schema compilation`, async () => {
        let fixture
        try {
          await assert.rejects(async () => {
            fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables: { items: 'schema_enrichment_items' }, apiOptions: { ...options, projections: true } })
          }, error => {
            assert.match(error.message, /scalar|custom.*filter/i)
            return true
          })
        } finally { await fixture?.close() }
      })
    }
  }
})

for (const type of ['object', 'array']) {
  describe(`Structured ${type} output with joined filters (${storageMode.mode})`, () => {
    let fixture, groups
    const payload = type === 'object' ? { nested: [1, false, null] } : [{ nested: true }, 0, null]
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createConformanceApi,
        apiOptions: {
          queryProjections: true,
          itemNameOptions: { indexed: true },
          itemOptions: {
            searchSchema: {
              groupPayload: { type, actualField: 'groups.payload' },
              groupPayloads: { type: 'array', actualField: 'groups.payload', filterOperator: 'in' },
              eitherPayload: { type: 'string', oneOf: ['name', 'groups.payload'] }
            }
          },
          groupOptions: {
            schema: { id: { type: 'id' }, name: { type: 'string', required: true }, payload: { type } },
            searchSchema: { childName: { type: 'string', actualField: 'items.name' } },
            queryFields: { copy: { type, select: ({ knex, column }) => knex.raw('??', [column('payload')]) } }
          }
        }
      })
      groups = fixture.api.resources.groups
    })
    beforeEach(async () => {
      await fixture.reset()
      for (const name of ['First', 'Second']) {
        const group = await fixture.seed('groups', { name, payload: structuredClone(payload) })
        for (let index = 0; index < 2; index++) await fixture.seed('items', { name: 'Match' }, { group: { data: { type: 'groups', id: group.id } } })
      }
    })
    after(async () => fixture?.close())

    it('rejects structured relationship filters, including empty IN and mixed oneOf', async () => {
      for (const filters of [{ groupPayload: payload }, { groupPayloads: [] }, { eitherPayload: 'Match' }]) {
        await assert.rejects(fixture.api.resources.items.query({ queryParams: { filters } }), error => {
          assert.ok(error instanceof RestApiValidationError)
          assert.equal(error.details.violations[0].rule, 'structured_query')
          return true
        })
      }
    })

    for (const format of ['jsonapi', 'plain']) {
      it(`keeps complete JSON values in distinct parent pages (${format})`, async () => {
        const params = { filters: { childName: 'Match' }, fields: { groups: 'payload,copy' } }
        for (const page of [{ number: 1, size: 1 }, { size: 1 }]) {
          const first = await groups.query({ format, queryParams: { ...params, page } })
          assert.deepEqual(first.data.map(item => item.id), ['1'])
          if (page.number) assert.equal(first.meta.pagination.total, 2)
          const second = await groups.query({ format, queryParams: parseJsonApiQuery(new URL(first.links.next, 'http://localhost').search.slice(1)) })
          assert.deepEqual(second.data.map(item => item.id), ['2'])
          for (const result of [first, second]) {
            const attributes = format === 'plain' ? result.data[0] : result.data[0].attributes
            assert.deepEqual(attributes.payload, payload)
            assert.deepEqual(attributes.copy, payload)
          }
        }
      })
    }
  })
}
