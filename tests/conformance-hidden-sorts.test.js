import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

const tables = { items: 'schema_enrichment_items' }
const projectSecret = { type: 'string', hidden: true, select: ({ knex, column }) => knex.raw('??', [column('secret')]) }
const fields = { secret: { type: 'string', hidden: true } }
const searchSchema = {
  secretAlias: { type: 'string', actualField: 'secret' },
  projectedAlias: { type: 'string', actualField: 'projected' }
}
const invalidHiddenSort = error => {
  assert.ok(error instanceof RestApiValidationError)
  assert.equal(error.details.violations[0].rule, 'hidden_sort')
  assert.match(error.message, /hidden.*sort|sort.*hidden/i)
  return true
}

describe(`Hidden sort declarations (${storageMode.mode})`, () => {
  const cases = [
    ['stored allowlist', { sortableFields: ['secret'] }],
    ['stored default', { defaultSort: ['secret'] }],
    ['alias allowlist', { sortableFields: ['secretAlias'] }],
    ['alias default', { defaultSort: ['-secretAlias'] }],
    ['projection flag', { queryFields: { projected: { ...projectSecret, sortable: true } } }],
    ['projection allowlist', { queryFields: { projected: projectSecret }, sortableFields: ['projected'] }],
    ['projection default', { queryFields: { projected: projectSecret }, defaultSort: '-projected' }],
    ['projection alias allowlist', { queryFields: { projected: projectSecret }, sortableFields: ['projectedAlias'] }],
    ['projection alias default', { queryFields: { projected: projectSecret }, defaultSort: '-projectedAlias' }]
  ]
  for (const [name, resourceOptions] of cases) {
    it(`rejects ${name} during compilation`, async () => {
      let fixture
      try {
        await assert.rejects(async () => {
          fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { projections: true, fields, searchSchema, resourceOptions } })
        }, invalidHiddenSort)
      } finally { await fixture?.close() }
    })
  }

  it('respects hidden relationship backing fields through their public alias', async () => {
    let fixture
    try {
      await assert.rejects(async () => {
        fixture = await createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables,
          apiOptions: {
            fields: { ownerId: { type: 'id', hidden: true, nullable: true, belongsTo: 'items', as: 'owner', search: true } },
            resourceOptions: { sortableFields: ['owner'] }
          }
        })
      }, invalidHiddenSort)
    } finally { await fixture?.close() }
  })
})

describe(`Hidden sort runtime boundaries (${storageMode.mode})`, () => {
  let fixture, items, originalSortableFields
  const statements = []
  const capture = event => statements.push(event.sql)
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        projections: true,
        fields: {
          ...fields,
          internal: { type: 'string', normallyHidden: true },
          secretLength: { type: 'integer', computed: true, dependencies: ['projected'], compute: ({ attributes }) => attributes.projected.length }
        },
        searchSchema: { ...searchSchema, internalAlias: { type: 'string', actualField: 'internal' } },
        resourceOptions: {
          sortableFields: ['id', 'name', 'internal', 'internalAlias'],
          queryFields: {
            projected: projectSecret,
            internalProjected: { type: 'string', normallyHidden: true, sortable: true, select: ({ knex, column }) => knex.raw('??', [column('internal')]) }
          }
        },
        hooks: {
          beforeDataQuery: {
            functionName: 'hidden-sort-hook-probe',
            handler: ({ context }) => { if (context.forcedSort) context.queryParams.sort = [context.forcedSort] }
          }
        }
      }
    })
    items = fixture.api.resources.items
    originalSortableFields = items.vars.sortableFields
    fixture.knex.on('query', capture)
  })
  beforeEach(async () => {
    items.vars.sortableFields = originalSortableFields
    items.vars.schemaInfo.queryFields.projected.sortable = false
    await fixture.reset()
    for (const [secret, internal] of [['sensitive-b', 'B'], ['sensitive-a', 'A'], ['sensitive-c', 'C']]) {
      await fixture.seed('items', { name: 'Visible', secret, internal })
    }
    statements.length = 0
  })
  after(async () => { fixture?.knex.off('query', capture); await fixture?.close() })

  for (const field of ['secret', 'secretAlias', 'projected', 'projectedAlias']) {
    it(`rejects a late ${field} allowlist/projection flag before SQL`, async () => {
      items.vars.sortableFields = ['id', field]
      items.vars.schemaInfo.queryFields.projected.sortable = true
      await assert.rejects(items.query({ queryParams: { sort: [field], page: { size: 1 } } }), RestApiValidationError)
      assert.deepEqual(statements, [])
    })

    it(`rejects a ${field} sort introduced by a query hook`, async () => {
      await assert.rejects(items.query({ queryParams: { page: { size: 1 } } }, { forcedSort: field }), invalidHiddenSort)
      assert.deepEqual(statements, [])
    })
  }

  for (const format of ['jsonapi', 'plain']) {
    it(`keeps hidden dependencies available without exposing their values (${format})`, async () => {
      const result = await items.query({ format, queryParams: { fields: { items: 'name,secretLength' } } })
      for (const row of result.data) {
        assert.equal((format === 'plain' ? row : row.attributes).secretLength, 11)
      }
      assert.equal(JSON.stringify(result).includes('sensitive-'), false)
      for (const field of ['secret', 'projected']) {
        const selected = await items.query({ format, queryParams: { fields: { items: `name,${field}` } } })
        assert.equal(JSON.stringify(selected).includes('sensitive-'), false)
      }
    })

    for (const field of ['internal', 'internalAlias', 'internalProjected']) {
      it(`retains normallyHidden ${field} cursor values with sparse output (${format})`, async () => {
        let queryParams = { sort: [field], fields: { items: 'name' }, page: { size: 1 } }
        const ids = []
        for (let index = 0; index < 3; index++) {
          const result = await items.query({ format, queryParams })
          ids.push(...result.data.map(row => row.id))
          assert.equal(JSON.stringify(result.data).includes('internal'), false)
          if (!result.links.next) break
          assert.match(result.meta.pagination.cursor.next, new RegExp(`^${field}:[AB],id:`))
          queryParams = parseJsonApiQuery(new URL(result.links.next, 'http://test.invalid').search.slice(1))
        }
        assert.deepEqual(ids, ['2', '1', '3'])
      })
    }
  }
})

for (const strategy of ['standard', 'window']) {
  describe(`Hidden include sort ${strategy} (${storageMode.mode})`, () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({
        apiOptions: { groupOptions: { relationships: { items: { type: 'hasMany', target: 'items', foreignKey: 'groupId', include: { strategy, orderBy: ['secret'], limit: 1 } } } } }
      })
      const group = await fixture.seed('groups', { name: 'Parent' })
      await fixture.seed('items', { name: 'Child', secret: 'sensitive' }, { group: { data: { type: 'groups', id: group.id } } })
    })
    after(async () => fixture?.close())
    it('rejects hidden orderBy when the forward-declared target is resolved', async () => {
      await assert.rejects(fixture.api.resources.groups.query({ queryParams: { include: ['items'] } }), invalidHiddenSort)
    })
  })
}
