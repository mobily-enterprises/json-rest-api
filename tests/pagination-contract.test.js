import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createCursorPaginationApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const recordCount = 205
let api

describe('Knex pagination contract', { skip: storageMode.isAnyApi() }, () => {
  before(async () => {
    api = await createCursorPaginationApi(knex)
    api.resources.products.vars.defaultSort = ['-createdAt']
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['cursor_products'])
    for (let index = 0; index < recordCount; index++) {
      await api.resources.products.post({
        document: createJsonApiDocument('products', {
          name: `Product ${index}`,
          category: 'Fixture',
          brand: 'Fixture',
          price: index,
          sku: `PAGE-${index}`,
          createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(index / 3))).toISOString()
        }),
        format: 'jsonapi'
      })
    }
  })

  it('traverses every record once when sparse fields omit the default sort field', async () => {
    const expected = await knex('cursor_products').orderBy('created_at', 'desc').orderBy('id', 'asc').pluck('id')
    const ids = []
    const cursors = new Set()
    let cursor

    for (let page = 0; page < 4; page++) {
      const result = await api.resources.products.query({
        queryParams: {
          fields: { products: 'name' },
          page: { size: 100, ...(cursor ? { after: cursor } : {}) }
        },
        format: 'jsonapi'
      })
      for (const record of result.data) {
        assert.deepEqual(Object.keys(record.attributes), ['name'])
        ids.push(record.id)
      }
      cursor = result.meta.pagination.cursor?.next
      assert.equal(result.meta.pagination.hasMore, Boolean(cursor))
      if (!cursor) break
      assert.equal(cursors.has(cursor), false, 'Each cursor must advance')
      cursors.add(cursor)
      assert.match(cursor, /createdAt:/)
    }

    assert.equal(cursor, undefined, 'Traversal must reach the end')
    assert.deepEqual(ids, expected.map(String))
    assert.equal(new Set(ids).size, recordCount)
  })

  for (const mode of ['cursor', 'offset']) {
    it(`uses the capped size for ${mode} pages, metadata, and links`, async () => {
      const expected = await knex('cursor_products').orderBy('id', 'asc').pluck('id')
      const ids = []
      let cursor

      for (let page = 1; page <= 3; page++) {
        const result = await api.resources.products.query({
          queryParams: {
            sort: ['id'],
            page: {
              size: 200,
              ...(mode === 'offset' ? { number: page } : cursor ? { after: cursor } : {})
            }
          },
          format: 'jsonapi'
        })
        ids.push(...result.data.map(record => record.id))
        assert.equal(result.data.length, page < 3 ? 100 : 5)
        assert.equal(result.meta.pagination.pageSize, 100)
        assert.equal(result.meta.pagination.hasMore, page < 3)
        assert.equal(Boolean(result.links.next), page < 3)
        if (result.links.next) {
          assert.equal(new URL(result.links.next, 'https://api.example.com').searchParams.get('page[size]'), '100')
        }
        cursor = result.meta.pagination.cursor?.next
        if (mode === 'cursor') assert.equal(Boolean(cursor), page < 3)
      }

      assert.deepEqual(ids, expected.map(String))
      assert.equal(new Set(ids).size, recordCount)
    })
  }

  it('rejects cursors missing any sort value in either direction', async () => {
    for (const direction of ['after', 'before']) {
      for (const cursor of ['id:1', 'createdAt:2026-09-01T00%3A00%3A00.000Z']) {
        await assert.rejects(api.resources.products.query({
          queryParams: { page: { size: 100, [direction]: cursor } },
          format: 'jsonapi'
        }), (error) => {
          assert.equal(error.code, 'REST_API_VALIDATION')
          assert.match(error.message, /Cursor.*missing.*sort field/i)
          return true
        })
      }
    }
  })
})
