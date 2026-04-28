import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { Api } from 'hooked-api'
import knexLib from 'knex'
import { LabelPlugin, QueryProjectionsPlugin, RestApiKnexPlugin, RestApiPlugin } from '../index.js'
import {
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
  validateJsonApiStructure,
} from './helpers/test-utils.js'
import { createProjectedFieldsApi } from './fixtures/api-configs.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

describe('Query Projections', () => {
  let api
  const testData = {}

  before(async () => {
    api = await createProjectedFieldsApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['projected_books', 'projected_authors'])

    const authorPayloads = [
      { first_name: 'Alex', last_name: 'Carter' },
      { first_name: 'Alex', last_name: 'Carter' },
      { first_name: 'Bella', last_name: 'Stone' },
      { first_name: 'Aaron', last_name: 'Zephyr' }
    ]

    testData.authors = []
    for (const payload of authorPayloads) {
      const result = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', payload),
        simplified: false
      })
      testData.authors.push(result.data)
    }

    testData.expectedAuthorOrder = [
      testData.authors[3].id,
      testData.authors[0].id,
      testData.authors[1].id,
      testData.authors[2].id
    ]

    const bookOne = await api.resources.books.post({
      inputRecord: createJsonApiDocument(
        'books',
        { title: 'Derived Fields Handbook' },
        { author: createRelationship(resourceIdentifier('authors', testData.authors[0].id)) }
      ),
      simplified: false
    })

    const bookTwo = await api.resources.books.post({
      inputRecord: createJsonApiDocument(
        'books',
        { title: 'Cursor Patterns' },
        { author: createRelationship(resourceIdentifier('authors', testData.authors[2].id)) }
      ),
      simplified: false
    })

    testData.books = [bookOne.data, bookTwo.data]
  })

  async function createEphemeralProjectionApi (resourceName, resourceOptions) {
    const api = new Api({
      name: `${resourceName}-projection-test-api`,
      log: { level: process.env.LOG_LEVEL || 'info' }
    })

    await api.use(RestApiPlugin, {
      simplifiedApi: true,
      simplifiedTransport: true,
      returnRecordApi: {
        post: true,
        put: true,
        patch: true
      }
    })
    await api.use(QueryProjectionsPlugin)
    await api.use(RestApiKnexPlugin, { knex })
    await api.addResource(resourceName, resourceOptions)

    return api
  }

  it('should return query projection fields by default and ignore query projection input on writes', async () => {
    const created = await api.resources.authors.post({
      inputRecord: createJsonApiDocument('authors', {
        first_name: 'Nina',
        last_name: 'Simone',
        full_name: 'Injected Value'
      }),
      simplified: false
    })

    validateJsonApiStructure(created)
    assert.equal(created.data.attributes.first_name, 'Nina')
    assert.equal(created.data.attributes.last_name, 'Simone')
    assert.equal(created.data.attributes.full_name, 'Nina Simone')

    const fetched = await api.resources.authors.get({
      id: created.data.id,
      simplified: false
    })

    validateJsonApiStructure(fetched)
    assert.equal(fetched.data.attributes.full_name, 'Nina Simone')
  })

  it('should allow query projection fields in sparse fieldsets', async () => {
    const result = await api.resources.authors.get({
      id: testData.authors[0].id,
      queryParams: {
        fields: {
          authors: 'first_name,full_name'
        }
      },
      simplified: false
    })

    validateJsonApiStructure(result)
    assert.equal(result.data.attributes.first_name, 'Alex')
    assert.equal(result.data.attributes.full_name, 'Alex Carter')
    assert.equal(result.data.attributes.last_name, undefined)
  })

  it('should expose query projection fields on included resources', async () => {
    const result = await api.resources.books.get({
      id: testData.books[0].id,
      queryParams: {
        include: ['author'],
        fields: {
          books: 'title',
          authors: 'full_name'
        }
      },
      simplified: false
    })

    validateJsonApiStructure(result)
    assert.ok(Array.isArray(result.included))

    const includedAuthor = result.included.find((resource) => resource.type === 'authors')
    assert.ok(includedAuthor, 'expected included author resource')
    assert.equal(includedAuthor.attributes.full_name, 'Alex Carter')
    assert.equal(includedAuthor.attributes.first_name, undefined)
    assert.equal(includedAuthor.attributes.last_name, undefined)
  })

  it('should support stable cursor pagination when sorting by a query projection field', async () => {
    const seenIds = []
    const seenFirstNames = []
    let nextCursor = null
    let iterations = 0
    let firstCursor = null

    while (iterations < 10) {
      const result = await api.resources.authors.query({
        queryParams: {
          sort: ['full_name'],
          fields: {
            authors: 'first_name'
          },
          page: {
            size: 1,
            ...(nextCursor ? { after: nextCursor } : {})
          }
        },
        simplified: false
      })

      validateJsonApiStructure(result, true)
      assert.equal(result.data.length, 1)

      const resource = result.data[0]
      seenIds.push(resource.id)
      seenFirstNames.push(resource.attributes.first_name)
      assert.equal(resource.attributes.full_name, undefined)

      if (!firstCursor && result.meta?.pagination?.cursor?.next) {
        firstCursor = result.meta.pagination.cursor.next
      }

      if (!result.meta?.pagination?.hasMore) {
        break
      }

      nextCursor = result.meta.pagination.cursor.next
      iterations += 1
    }

    assert.deepEqual(seenIds, testData.expectedAuthorOrder)
    assert.equal(new Set(seenIds).size, seenIds.length, 'cursor pagination should not duplicate records')
    assert.ok(firstCursor?.includes('full_name:'), 'cursor should encode query projection sort field')
    assert.ok(firstCursor?.includes('id:'), 'cursor should append id as deterministic tie-breaker')
    assert.deepEqual(seenFirstNames, ['Aaron', 'Alex', 'Alex', 'Bella'])
  })

  it('should allow sorting by a normallyHidden query projection field without returning it by default', async () => {
    const result = await api.resources.authors.query({
      queryParams: {
        sort: ['sort_name']
      },
      simplified: false
    })

    validateJsonApiStructure(result, true)
    assert.deepEqual(
      result.data.map((resource) => resource.id),
      testData.expectedAuthorOrder
    )
    result.data.forEach((resource) => {
      assert.equal(resource.attributes.sort_name, undefined)
    })
  })

  it('should reject query projection expressions that return plain SQL strings', async () => {
    const stringApi = await createEphemeralProjectionApi('string_projection_authors', {
      schema: {
        id: { type: 'id' },
        first_name: { type: 'string', required: true },
        last_name: { type: 'string', required: true }
      },
      queryFields: {
        full_name: {
          type: 'string',
          select: () => "trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))"
        }
      },
      tableName: 'projected_authors_string_expr'
    })

    await stringApi.resources.string_projection_authors.createKnexTable()
    await knex('projected_authors_string_expr').insert({
      first_name: 'Nina',
      last_name: 'Simone'
    })

    await assert.rejects(
      () => stringApi.resources.string_projection_authors.query({
        queryParams: {},
        simplified: false
      }),
      /Query field expressions must return knex raw, knex ref, or a knex query builder/
    )
  })

  it('should reject query projection names that conflict with relationship names', async () => {
    await assert.rejects(
      () => createEphemeralProjectionApi('conflicting_projection_authors', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true }
        },
        queryFields: {
          books: {
            type: 'string',
            select: ({ knex }) => knex.raw("'X'")
          }
        },
        relationships: {
          books: { type: 'hasMany', target: 'books', foreignKey: 'author_id' }
        },
        tableName: 'projected_authors_conflict'
      }),
      /conflicts with an existing schema/
    )
  })

  it('should reject query projection names that conflict with computed fields injected by plugins', async () => {
    const labeledApi = new Api({
      name: 'label-projection-conflict-api',
      log: { level: process.env.LOG_LEVEL || 'info' }
    })

    await labeledApi.use(RestApiPlugin, {
      simplifiedApi: true,
      simplifiedTransport: true
    })
    await labeledApi.use(LabelPlugin)
    await labeledApi.use(QueryProjectionsPlugin)
    await labeledApi.use(RestApiKnexPlugin, { knex })

    await assert.rejects(
      () => labeledApi.addResource('labeled_projection_authors', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true }
        },
        queryFields: {
          label: {
            type: 'string',
            select: ({ knex }) => knex.raw("'X'")
          }
        },
        tableName: 'projected_authors_label_conflict'
      }),
      /conflicts with an existing schema, computed, or relationship name/
    )
  })
})
