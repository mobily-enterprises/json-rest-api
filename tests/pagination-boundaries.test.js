import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createTemporalBoundaryApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { createCursor, parseCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'

const knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
let api
let ids

describe('Pagination boundary audit', () => {
  before(async () => { api = await createTemporalBoundaryApi(knex) })
  after(async () => { await knex.destroy() })
  beforeEach(async () => {
    await cleanTables(knex, ['temporal_events', 'temporal_people'])
    ids = []
    for (let index = 0; index < 8; index++) {
      const result = await api.resources.events.post({
        document: createJsonApiDocument('events', {
          name: `Event ${index}`, occurredAt: `2026-09-01T10:20:3${index}.000Z`
        }),
        format: 'jsonapi'
      })
      ids.push(result.data.id)
    }
  })

  it('rejects zero, negative, fractional and conflicting page parameters', async () => {
    for (const page of [
      { size: 0 }, { size: -1 }, { size: 0.5 }, { number: 0 }, { number: -1 }, { number: 1.5 },
      { after: '' }, { after: 'id:1', before: 'id:8' }, { number: 1, after: 'id:1' }
    ]) {
      await assert.rejects(api.resources.events.query({ queryParams: { page }, format: 'jsonapi' }), {
        code: 'REST_API_VALIDATION'
      }, JSON.stringify(page))
    }
  })

  it('returns the adjacent page before a cursor rather than restarting at the beginning', async () => {
    const result = await api.resources.events.query({
      queryParams: {
        sort: ['id'], page: { size: 2, before: `id:${ids[6]}` }
      },
      format: 'jsonapi'
    })
    assert.deepEqual(result.data.map(entry => entry.id), ids.slice(4, 6))
    assert.equal(result.meta.pagination.hasMore, true)
    const next = await api.resources.events.query({
      queryParams: {
        sort: ['id'], page: { size: 2, before: result.meta.pagination.cursor.next }
      },
      format: 'jsonapi'
    })
    assert.deepEqual(next.data.map(entry => entry.id), ids.slice(2, 4))
    assert.equal(new URL(result.links.next, 'https://api.test').searchParams.get('page[before]'), result.meta.pagination.cursor.next)
  })

  it('caps default limits even without explicit page parameters', async () => {
    const original = api.resources.events.vars.queryDefaultLimit
    api.resources.events.vars.queryDefaultLimit = 20
    try {
      assert.equal((await api.resources.events.query({ format: 'jsonapi' })).data.length, 3)
    } finally {
      api.resources.events.vars.queryDefaultLimit = original
    }
  })

  it('distinguishes null values from literal strings in cursors and rejects duplicate fields', () => {
    for (const value of [null, '~null', 'null', '', 'colon:comma,']) {
      const cursor = createCursor({ id: 'opaque:id', name: value }, ['name', 'id'])
      assert.equal(parseCursor(cursor).name, value)
      assert.equal(parseCursor(cursor).id, 'opaque:id')
    }
    assert.throws(() => parseCursor('id:1,id:2'), /Duplicate/)
  })

  it('generates usable cursors when a sort field is repeated', async () => {
    const sort = ['name', 'name', 'id', 'id']
    const first = await api.resources.events.query({ queryParams: { sort, page: { size: 2 } } })
    const second = await api.resources.events.query({
      queryParams: {
        sort, page: { size: 2, after: first.meta.pagination.cursor.next }
      }
    })
    assert.deepEqual(second.data.map(entry => entry.id), ids.slice(2, 4))
  })

  it('validates schema sorts without an explicit allowlist, alongside query projections', async () => {
    const original = api.resources.events.vars.sortableFields
    api.resources.events.vars.sortableFields = []
    try {
      for (const field of ['name', 'occurredAt', 'projectedAt']) {
        const result = await api.resources.events.query({ queryParams: { sort: [field], page: { size: 2 } } })
        assert.deepEqual(result.data.map(entry => entry.id), ids.slice(0, 2))
      }
      for (const field of ['missingField', 'constructor', 'producedAt']) {
        await assert.rejects(api.resources.events.query({ queryParams: { sort: [field] } }), {
          code: 'REST_API_VALIDATION'
        })
      }
      await assert.rejects(api.resources.people.query({ queryParams: { sort: ['missingField'] } }), {
        code: 'REST_API_VALIDATION'
      })
    } finally {
      api.resources.events.vars.sortableFields = original
    }
  })

  it('generates valid last-page links for an empty collection', async () => {
    await cleanTables(knex, ['temporal_events', 'temporal_people'])
    const original = api.resources.events.vars.enablePaginationCounts
    api.resources.events.vars.enablePaginationCounts = true
    try {
      const result = await api.resources.events.query({ queryParams: { page: { number: 1, size: 2 } } })
      const last = new URL(result.links.last, 'https://api.test')
      const finalPage = await api.resources.events.query({
        queryParams: {
          page: { number: last.searchParams.get('page[number]'), size: last.searchParams.get('page[size]') }
        }
      })
      assert.deepEqual(finalPage.data, [])
    } finally {
      api.resources.events.vars.enablePaginationCounts = original
    }
  })

  for (const sort of [['occurredAt'], ['-occurredAt']]) {
    it(`traverses null sort values exactly once in both directions with sort=${sort}`, async () => {
      for (const id of [ids[1], ids[4], ids[6]]) {
        await api.resources.events.patch({
          id,
          document: {
            data: {
              type: 'events', id, attributes: { occurredAt: null }
            }
          },
          format: 'jsonapi'
        })
      }
      const seen = []
      let after
      const pages = []
      for (let index = 0; index < 6; index++) {
        const page = await api.resources.events.query({
          queryParams: {
            sort, page: { size: 2, ...(after ? { after } : {}) }
          },
          format: 'jsonapi'
        })
        pages.push(page)
        seen.push(...page.data.map(entry => entry.id))
        after = page.meta.pagination.cursor?.next
        if (!after) break
      }
      assert.equal(after, undefined)
      assert.equal(seen.length, ids.length)
      assert.equal(new Set(seen).size, ids.length)
      const nonNull = ids.filter(id => ![ids[1], ids[4], ids[6]].includes(id))
      if (sort[0].startsWith('-')) nonNull.reverse()
      assert.deepEqual(seen.slice(0, nonNull.length), nonNull)

      const firstOfLast = pages.at(-1).data[0]
      let before = createCursor({ id: firstOfLast.id, ...firstOfLast.attributes }, ['occurredAt', 'id'])
      const reversed = [...pages.at(-1).data.map(entry => entry.id)]
      for (let index = 0; index < 6; index++) {
        const page = await api.resources.events.query({ queryParams: { sort, page: { size: 2, before } }, format: 'jsonapi' })
        reversed.unshift(...page.data.map(entry => entry.id))
        before = page.meta.pagination.cursor?.next
        if (!before) break
      }
      assert.equal(before, undefined)
      assert.deepEqual(reversed, seen)
    })
  }
})
