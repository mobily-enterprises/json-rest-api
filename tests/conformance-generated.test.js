import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fc from 'fast-check'
import { createConformanceFixture } from './fixtures/conformance.js'
import { generatedCaseOptions, itemValues } from './helpers/generated-cases.js'
import { storageMode } from './helpers/storage-mode.js'
import { createCursor } from '../plugins/core/lib/querying/knex-pagination-helpers.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

function compareRows (sort, idOrder) {
  return (left, right) => {
    for (const token of [...sort, 'id']) {
      const field = token.replace(/^-/, '')
      const a = field === 'id' && idOrder === 'numeric' ? Number(left.id) : left[field]
      const b = field === 'id' && idOrder === 'numeric' ? Number(right.id) : right[field]
      if (a === b) continue
      if (a === null) return 1
      if (b === null) return -1
      return (a < b ? -1 : 1) * (token.startsWith('-') ? -1 : 1)
    }
    return 0
  }
}

function queryFromLink (link) {
  return parseJsonApiQuery(new URL(link, 'http://localhost').search.slice(1))
}

describe(`Generated public conformance (${storageMode.mode})`, () => {
  let fixture
  let items
  before(async () => {
    fixture = await createConformanceFixture({ storage: storageMode.mode })
    items = fixture.api.resources.items
  })
  beforeEach(async () => { await fixture.reset() })
  after(async () => { await fixture?.close() })

  it('round-trips generated field values in strict and simplified responses', async () => {
    await fc.assert(fc.asyncProperty(itemValues, async attributes => {
      await fixture.reset()
      const created = await fixture.seed('items', attributes)
      const strict = await items.get({ id: created.id, format: 'jsonapi' })
      const simplified = await items.get({ id: created.id, format: 'plain' })
      for (const [field, expected] of Object.entries(attributes)) {
        assert.equal(created.attributes[field], expected)
        assert.equal(strict.data.attributes[field], expected)
        assert.equal(simplified[field], expected)
      }
      assert.equal(typeof strict.data.id, 'string')
      assert.equal(simplified.id, strict.data.id)
      assert.equal(await fixture.count('items'), 1)
    }), generatedCaseOptions(20260908))
  })

  it('traverses generated sorts, ties, nulls and page sizes exactly once in both directions', async () => {
    const row = fc.record({ name: fc.constantFrom('a', 'b', 'c'), rank: fc.option(fc.integer({ min: -1, max: 1 }), { nil: null }), active: fc.boolean() })
    const sorts = fc.constantFrom(['rank'], ['-rank'], ['name', '-rank'], ['-name', 'rank'], ['active', 'rank'])
    await fc.assert(fc.asyncProperty(fc.array(row, { maxLength: 12 }), sorts, fc.integer({ min: 1, max: 5 }), async (rows, sort, size) => {
      await fixture.reset()
      const expectedRows = []
      for (const attributes of rows) {
        const created = await fixture.seed('items', attributes)
        expectedRows.push({ ...attributes, id: created.id })
      }
      expectedRows.sort(compareRows(sort, fixture.idOrder))
      const expectedIds = expectedRows.map(row => row.id)
      const visitedLinks = new Set()
      const actualIds = []
      let queryParams = { sort, fields: { items: 'name' }, page: { size } }
      for (let page = 0; page <= rows.length; page++) {
        const response = await items.query({ queryParams, format: 'jsonapi' })
        for (const record of response.data) {
          assert.deepEqual(Object.keys(record.attributes), ['name'])
          actualIds.push(record.id)
        }
        assert.equal(response.meta.pagination.hasMore, Boolean(response.links.next))
        if (!response.links.next) break
        assert.equal(visitedLinks.has(response.links.next), false, 'Pagination must advance')
        visitedLinks.add(response.links.next)
        queryParams = queryFromLink(response.links.next)
        assert(page < rows.length, 'Traversal must terminate')
      }
      assert.deepEqual(actualIds, expectedIds)
      assert.equal(new Set(actualIds).size, rows.length)

      if (!expectedRows.length) return
      const tail = expectedRows.at(-1)
      const backwards = [tail.id]
      const cursorFields = [...sort.map(field => field.replace(/^-/, '')), 'id']
      queryParams = { sort, fields: { items: 'name' }, page: { size, before: createCursor(tail, cursorFields) } }
      for (let page = 0; page <= rows.length; page++) {
        const response = await items.query({ queryParams, format: 'jsonapi' })
        backwards.unshift(...response.data.map(record => record.id))
        if (!response.links.next) break
        queryParams = queryFromLink(response.links.next)
        assert(queryParams.page.before, 'Backward links must preserve direction')
        assert(page < rows.length, 'Backward traversal must terminate')
      }
      assert.deepEqual(backwards, expectedIds)
    }), generatedCaseOptions(20260909))
  })

  it('preserves generated relationship fan-out, empty groups and repeated references', async () => {
    const assignments = fc.array(fc.option(fc.integer({ min: 0, max: 2 }), { nil: null }), { maxLength: 10 })
    await fc.assert(fc.asyncProperty(assignments, async memberships => {
      await fixture.reset()
      const groups = []
      for (const name of ['Left', 'Middle', 'Right']) groups.push(await fixture.seed('groups', { name }))
      const expected = new Map(groups.map(group => [group.id, []]))
      for (const [index, member] of memberships.entries()) {
        const group = member === null ? null : { type: 'groups', id: groups[member].id }
        const item = await fixture.seed('items', { name: `Item ${index}` }, { group: { data: group } })
        if (group) expected.get(group.id).push(item.id)
      }
      const response = await fixture.api.resources.groups.query({
        format: 'jsonapi', queryParams: { sort: ['id'], include: ['items.group.items'] }
      })
      assert.equal(response.data.length, 3)
      for (const group of response.data) {
        assert.deepEqual(group.relationships.items.data.map(item => item.id).sort(), expected.get(group.id).sort())
      }
      const included = response.included || []
      assert.equal(new Set(included.map(record => `${record.type}:${record.id}`)).size, included.length)
      const includedItems = included.filter(record => record.type === 'items')
      assert.equal(includedItems.length, memberships.filter(member => member !== null).length)
      for (const record of includedItems) assert(expected.get(record.relationships.group.data.id).includes(record.id))
      assert.equal(await fixture.count('items'), memberships.length)
    }), generatedCaseOptions(20260910))
  })
})
