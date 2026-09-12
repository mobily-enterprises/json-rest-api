import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'
import { storageMode } from './helpers/storage-mode.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

for (const searchable of [false, true]) {
  describe(`Related collection conformance, searchable=${searchable} (${storageMode.mode})`, () => {
    let fixture
    let groups
    let first
    let second
    let empty
    let expected
    let nestedIds
    before(async () => {
      fixture = await createConformanceFixture({
        apiOptions: {
          groupFieldOptions: { search: searchable, storage: { column: 'parent_key' } }
        }
      })
      groups = fixture.api.resources.groups
      await fixture.api.customize({
        hooks: {
          finishQuery: {
            functionName: 'probe-nested-relationship-query',
            handler: async ({ context, scopeName }) => {
              if (scopeName === 'items' && context.nestedQueryProbe) {
                const nested = await fixture.api.resources.items.query({ format: 'jsonapi' }, {
                  ...context, nestedQueryProbe: false
                })
                nestedIds = nested.data.map(item => item.id)
              }
            }
          }
        }
      })
    })
    after(async () => { await fixture?.close() })
    beforeEach(async () => {
      await fixture.reset()
      first = await fixture.seed('groups', { name: 'First' })
      second = await fixture.seed('groups', { name: 'Second' })
      empty = await fixture.seed('groups', { name: 'Empty' })
      expected = []
      nestedIds = undefined
      for (let rank = 1; rank <= 4; rank++) {
        expected.push(await fixture.seed('items', { name: `Owned ${rank}`, rank }, {
          group: { data: { type: 'groups', id: first.id } }
        }))
      }
      await fixture.seed('items', { name: 'Other parent', rank: 0 }, {
        group: { data: { type: 'groups', id: second.id } }
      })
      await fixture.seed('items', { name: 'Unrelated', rank: 0 })
    })

    const related = (queryParams = {}, options = {}, context = {}) => groups.getRelated({
      id: first.id, relationshipName: 'items', format: 'jsonapi', queryParams, ...options
    }, context)
    const fromLink = (link) => {
      const url = new URL(link, 'https://api.example.test')
      assert.equal(url.pathname, `/groups/${first.id}/items`)
      assert.equal(url.searchParams.has('filters[group]'), false)
      assert.equal(url.searchParams.has('filters[groupId]'), false)
      return parseJsonApiQuery(url.search.slice(1))
    }

    for (const format of ['plain', 'jsonapi']) {
      it(`reads mapped children with fields and includes in ${format} format`, async () => {
        const result = await related({ sort: ['rank'], fields: { items: 'name,group' }, include: ['group'] }, { format })
        assert.deepEqual(result.data.map(item => item.id), expected.map(item => item.id))
        for (const item of result.data) {
          if (format === 'plain') {
            assert.equal(item.group.id, first.id)
            assert.equal(item.group.name, 'First')
            assert.equal(item.rank, undefined)
          } else {
            assert.deepEqual(Object.keys(item.attributes), ['name'])
            assert.deepEqual(item.relationships.group.data, { type: 'groups', id: first.id })
          }
        }
        if (format === 'jsonapi') assert.deepEqual(result.included.map(item => item.id), [first.id])
      })
    }

    it('counts only related rows and follows offset links within the relationship', async () => {
      const queryParams = { sort: ['rank'], page: { number: 1, size: 2 } }
      const result = await related(queryParams)
      assert.equal(result.meta.pagination.total, 4)
      assert.deepEqual(result.data.map(item => item.id), expected.slice(0, 2).map(item => item.id))
      const next = await related(fromLink(result.links.next))
      assert.deepEqual(next.data.map(item => item.id), expected.slice(2).map(item => item.id))
      assert.equal(next.meta.pagination.total, 4)
      assert.equal(next.links.next, undefined)
      const previous = await related(fromLink(next.links.prev))
      assert.deepEqual(previous.data.map(item => item.id), result.data.map(item => item.id))
      assert.equal(queryParams.filters, undefined)
      fromLink(result.links.self)
    })

    it('preserves child filters and sparse fields through cursor link round trips', async () => {
      let queryParams = { filters: { active: true }, sort: ['rank'], fields: { items: 'name' }, page: { size: 1 } }
      const ids = []
      for (let page = 0; page < 5; page++) {
        const result = await related(queryParams)
        ids.push(...result.data.map(item => item.id))
        for (const item of result.data) assert.deepEqual(Object.keys(item.attributes), ['name'])
        if (!result.links.next) break
        queryParams = fromLink(result.links.next)
        assert.equal(String(queryParams.filters.active), 'true')
        assert(page < 4, 'Cursor traversal must terminate')
      }
      assert.deepEqual(ids, expected.map(item => item.id))
    })

    it('keeps caller filters independent from the mandatory parent constraint', async () => {
      if (searchable) {
        const filters = { group: second.id }
        const result = await related({ filters, page: { number: 1, size: 2 } })
        assert.deepEqual(result.data, [])
        assert.equal(result.meta.pagination.total, 0)
        assert.deepEqual(filters, { group: second.id })
      } else {
        await assert.rejects(fixture.api.resources.items.query({ queryParams: { filters: { group: first.id } } }), {
          code: 'REST_API_VALIDATION'
        })
        await assert.rejects(related({ filters: { group: second.id } }), { code: 'REST_API_VALIDATION' })
      }
    })

    it('keeps backwards cursor links within the relationship', async () => {
      const tail = expected.at(-1)
      const cursor = createCursor({ id: tail.id, rank: tail.attributes.rank }, ['rank', 'id'])
      const page = await related({ sort: ['rank'], page: { size: 2, before: cursor } })
      assert.deepEqual(page.data.map(item => item.id), expected.slice(1, 3).map(item => item.id))
      const earlier = await related(fromLink(page.links.next))
      assert.deepEqual(earlier.data.map(item => item.id), [expected[0].id])
      assert.equal(earlier.links.next, undefined)
    })

    it('keeps membership out of an independent query made by a finish hook', async () => {
      const result = await related({}, {}, { nestedQueryProbe: true })
      assert.equal(result.data.length, 4)
      assert.equal(nestedIds.length, 6)
      assert.equal(new Set(nestedIds).size, 6)
    })

    it('preserves the configured public prefix on related pagination links', async () => {
      const result = await related({ page: { number: 1, size: 1 } }, {}, {
        urlPrefixOverride: 'https://api.example.test/v2'
      })
      for (const link of Object.values(result.links)) {
        assert.equal(new URL(link).origin, 'https://api.example.test')
        assert.equal(new URL(link).pathname, `/v2/groups/${first.id}/items`)
      }
    })

    it('returns an empty collection for an empty parent and rejects a missing parent', async () => {
      assert.deepEqual((await related({}, { id: empty.id })).data, [])
      await assert.rejects(related({}, { id: '999' }), { code: 'REST_API_RESOURCE', subtype: 'not_found' })
    })

    it('uses the caller transaction for membership and leaves its outcome to the caller', async () => {
      const unit = await holdManagedTransaction(fixture.api)
      const transaction = unit.transaction
      try {
        await fixture.api.resources.items.patch({
          id: expected[0].id, data: { group: second.id }, format: 'plain', returning: 'none', transaction
        })
        const result = await related({ sort: ['rank'] }, { transaction })
        assert.deepEqual(result.data.map(item => item.id), expected.slice(1).map(item => item.id))
        assert.equal(transaction.isCompleted(), false)
      } finally {
        await unit.rollback()
      }
      assert.deepEqual((await related({ sort: ['rank'] })).data.map(item => item.id), expected.map(item => item.id))
    })
  })
}
