import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createPaginationApi } from './fixtures/api-configs.js'
import {
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier,
} from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const isAnyApi = storageMode.isAnyApi()

const maybeDescribe = isAnyApi ? describe : describe.skip

maybeDescribe('AnyAPI Cursor Pagination', () => {
  const knex = knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })

  let api

  before(async () => {
    api = await createPaginationApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, [
      'pagination_countries',
      'pagination_publishers',
      'pagination_books',
    ])

    const country = await api.resources.countries.post({
      inputRecord: createJsonApiDocument('countries', { name: 'Cursorland', code: 'CL' }),
      simplified: false,
    })

    const publisher = await api.resources.publishers.post({
      inputRecord: createJsonApiDocument(
        'publishers',
        { name: 'Cursor Press' },
        { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
      ),
      simplified: false,
    })

    const titles = ['Book A', 'Book B', 'Book C', 'Book D', 'Book E', 'Book F']
    for (const title of titles) {
      await api.resources.books.post({
        inputRecord: createJsonApiDocument(
          'books',
          { title },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisher.data.id)),
          }
        ),
        simplified: false,
      })
    }
  })

  it('returns cursor metadata and links when requesting the first page', async () => {
    const result = await api.resources.books.query({
      queryParams: {
        page: { size: 2 },
      },
      simplified: false,
    })

    assert.equal(result.data.length, 2)
    assert(result.meta?.pagination?.cursor?.next, 'Should include next cursor')
    assert(result.links?.next?.includes('page[after]='), 'Next link should include cursor parameter')
  })

  it('paginates forward using page[after]', async () => {
    const firstPage = await api.resources.books.query({
      queryParams: {
        page: { size: 2 },
      },
      simplified: false,
    })

    const cursor = firstPage.meta.pagination.cursor.next
    const secondPage = await api.resources.books.query({
      queryParams: {
        page: { size: 2, after: cursor },
      },
      simplified: false,
    })

    assert.equal(secondPage.data.length, 2)
    const firstIds = firstPage.data.map((book) => book.id)
    const secondIds = secondPage.data.map((book) => book.id)
    assert(!secondIds.some((id) => firstIds.includes(id)), 'Second page should not repeat first page records')
  })

  it('paginates backward using page[before]', async () => {
    const firstPage = await api.resources.books.query({
      queryParams: {
        page: { size: 2 },
      },
      simplified: false,
    })

    const secondPage = await api.resources.books.query({
      queryParams: {
        page: {
          size: 2,
          after: firstPage.meta.pagination.cursor.next,
        },
      },
      simplified: false,
    })

    const beforeCursor =
      secondPage.meta.pagination.cursor?.next ||
      `id:${encodeURIComponent(secondPage.data[0].id)}`

    const previousPage = await api.resources.books.query({
      queryParams: {
        page: {
          size: 2,
          before: beforeCursor,
        },
      },
      simplified: false,
    })

    const secondIds = secondPage.data.map((book) => book.id)
    const previousIds = previousPage.data.map((book) => book.id)
    assert(!previousIds.some((id) => secondIds.includes(id)), 'Page[before] should return different records')
    const firstIds = firstPage.data.map((book) => book.id)
    assert(previousIds.every((id) => firstIds.includes(id)), 'Page[before] should return earlier records')
  })
})
