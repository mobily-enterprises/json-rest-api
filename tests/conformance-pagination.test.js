import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

const fromLink = link => parseJsonApiQuery(new URL(link, 'http://test.invalid').search.slice(1))

for (const counts of [true, false]) {
  describe(`Shared pagination, counts=${counts} (${storageMode.mode})`, () => {
    let fixture, items
    const queries = []
    const capture = event => queries.push(event.sql)
    before(async () => {
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { resourceOptions: { queryDefaultLimit: 2, queryMaxLimit: 3, enablePaginationCounts: counts } }
      })
      items = fixture.api.resources.items
      fixture.knex.on('query', capture)
    })
    beforeEach(async () => {
      await fixture.reset()
      for (let index = 1; index <= 7; index++) await fixture.seed('items', { name: `Item ${index}` })
      queries.length = 0
    })
    after(async () => { fixture?.knex.off('query', capture); await fixture?.close() })
    const query = page => items.query({ queryParams: { sort: ['id'], fields: { items: 'name' }, ...(page ? { page } : {}) } })
    const countQueries = () => queries.filter(sql => /\bcount\s*\(/i.test(sql)).length

    it('uses the default limit without pagination metadata or a count', async () => {
      for (const page of [undefined, {}]) {
        const result = await query(page)
        assert.deepEqual(result.data.map(row => row.id), ['1', '2'])
        assert.equal(result.meta?.pagination, undefined)
        assert.equal(result.links?.next, undefined)
      }
      assert.equal(countQueries(), 0)
    })

    it('caps cursor pages and follows their links without issuing counts', async () => {
      let result = await query({ size: 100 })
      const seen = []
      for (let index = 0; index < 3; index++) {
        seen.push(...result.data.map(row => row.id))
        assert.equal(result.meta.pagination.pageSize, 3)
        assert.equal(result.meta.pagination.total, undefined)
        assert.equal(result.meta.pagination.hasMore, index < 2)
        if (!result.links.next) break
        const next = fromLink(result.links.next)
        assert.equal(next.page.size, 3)
        assert.equal(next.page.number, undefined)
        result = await items.query({ queryParams: next })
      }
      assert.deepEqual(seen, ['1', '2', '3', '4', '5', '6', '7'])
      assert.equal(countQueries(), 0)
    })

    for (const [page, expected] of [
      [{ number: 2 }, ['3', '4']],
      [{ number: 2, size: 100 }, ['4', '5', '6']],
      [{ number: 8, size: 1 }, []]
    ]) {
      it(`uses offset page ${JSON.stringify(page)} with the selected count policy`, async () => {
        const result = await query(page)
        const size = page.size === 100 ? 3 : page.size || 2
        assert.deepEqual(result.data.map(row => row.id), expected)
        assert.equal(result.meta.pagination.page, page.number)
        assert.equal(result.meta.pagination.pageSize, size)
        assert.equal(result.meta.pagination.total, counts ? 7 : undefined)
        assert.equal(result.meta.pagination.pageCount, counts ? Math.ceil(7 / size) : undefined)
        assert.equal(countQueries(), counts ? 1 : 0)
        assert.deepEqual(fromLink(result.links.self).page, { number: page.number, size })
      })
    }

    it('uses the default size for forward and backward cursor boundaries', async () => {
      const forward = await query({ after: 'id:3' })
      assert.deepEqual(forward.data.map(row => row.id), ['4', '5'])
      assert.deepEqual(fromLink(forward.links.next).page, { after: 'id:5', size: 2 })
      const backward = await query({ before: 'id:6' })
      assert.deepEqual(backward.data.map(row => row.id), ['4', '5'])
      assert.deepEqual(fromLink(backward.links.next).page, { before: 'id:4', size: 2 })
      const previous = await items.query({ queryParams: fromLink(backward.links.next) })
      assert.deepEqual(previous.data.map(row => row.id), ['2', '3'])
      assert.equal(countQueries(), 0)
    })

    it('returns empty cursor pages without a next link or count', async () => {
      for (const page of [{ after: 'id:7' }, { before: 'id:1' }]) {
        const result = await query(page)
        assert.deepEqual(result.data, [])
        assert.equal(result.meta.pagination.pageSize, 2)
        assert.equal(result.meta.pagination.hasMore, false)
        assert.equal(result.links?.next, undefined)
      }
      assert.equal(countQueries(), 0)
    })

    for (const direction of ['after', 'before']) {
      it(`rejects malformed ${direction} cursor syntax before SQL with a typed error`, async () => {
        for (const cursor of ['invalid', 'id:%invalid', 'id:1,id:2', ':1']) {
          await assert.rejects(query({ [direction]: cursor }), error => {
            assert.ok(error instanceof RestApiValidationError)
            assert.equal(error.message, `Invalid cursor format in page[${direction}] parameter`)
            assert.deepEqual(error.details.fields, [`page.${direction}`])
            assert.equal(error.details.violations[0].rule, 'invalid_cursor')
            return true
          })
        }
        assert.deepEqual(queries, [])
      })
    }

    it('rejects invalid sizes, page numbers and conflicting modes before SQL', async () => {
      for (const page of [
        { size: 0 }, { size: -1 }, { size: 1.5 }, { number: 0 }, { number: 1.5 },
        { number: 1, after: 'id:1' }, { number: 1, before: 'id:2' },
        { after: 'id:1', before: 'id:2' }, { after: '' }, { before: ' ' }
      ]) await assert.rejects(query(page), error => error instanceof RestApiValidationError)
      assert.deepEqual(queries, [])
    })
  })
}
