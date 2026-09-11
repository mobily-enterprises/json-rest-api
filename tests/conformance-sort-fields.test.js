import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'

const tables = { items: 'schema_enrichment_items' }
const fromLink = link => parseJsonApiQuery(new URL(link, 'http://test.invalid').search.slice(1))

describe(`Logical sort fields (${storageMode.mode})`, () => {
  let fixture, items
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables,
      apiOptions: {
        fields: {
          name: { type: 'string', storage: { column: 'display "name' } },
          amount: { type: 'string' },
          score: { type: 'integer', nullable: true },
          occurredAt: { type: 'dateTime', nullable: true }
        },
        searchSchema: {
          id: { type: 'string', actualField: 'amount' },
          name: { type: 'string', actualField: 'amount' },
          displayName: { type: 'string', actualField: 'name' },
          score: { type: 'boolean', actualField: 'amount' },
          occurredAt: { type: 'boolean', actualField: 'amount' }
        },
        resourceOptions: { sortableFields: ['id', 'name', 'displayName', 'score', 'occurredAt'], enablePaginationCounts: true }
      }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => {
    await fixture.reset()
    for (const [name, amount, score] of [['Bravo', 'Zulu', 2], ['Alpha', 'Alpha', null], ['Charlie', 'Mike', 1], ['Bravo', 'Delta', 2]]) {
      const occurredAt = score === null ? null : `2026-09-0${score}T01:02:03.000Z`
      await fixture.seed('items', { name, amount, score, occurredAt, obsolete: 'selected' })
    }
  })
  after(async () => fixture?.close())

  for (const filter of ['id', 'name']) {
    it(`keeps the explicit ${filter} filter alias`, async () => {
      const result = await items.query({ queryParams: { filters: { [filter]: 'Zulu' } } })
      assert.deepEqual(result.data.map(row => row.id), ['1'])
    })
  }

  for (const [sort, expected] of [
    [['id'], ['1', '2', '3', '4']],
    [['-id'], ['4', '3', '2', '1']],
    [['name'], ['2', '1', '4', '3']],
    [['-name'], ['3', '1', '4', '2']],
    [['displayName'], ['2', '1', '4', '3']],
    [['-displayName'], ['3', '1', '4', '2']],
    [['score'], ['3', '1', '4', '2']],
    [['-score'], ['1', '4', '3', '2']],
    [['occurredAt'], ['3', '1', '4', '2']],
    [['-occurredAt'], ['1', '4', '3', '2']]
  ]) {
    for (const format of ['jsonapi', 'plain']) {
      it(`uses logical ${sort} for sparse offset and cursor pages (${format})`, async () => {
        const params = { sort, fields: { items: 'obsolete' } }
        for (const mode of ['offset', 'cursor']) {
          const seen = []; const cursors = []
          let queryParams = { ...params, page: { size: 1, ...(mode === 'offset' ? { number: 1 } : {}) } }
          for (let index = 0; index < 5; index++) {
            const result = await items.query({ format, queryParams })
            seen.push(...result.data.map(row => row.id))
            for (const row of result.data) {
              assert.deepEqual(format === 'plain' ? Object.keys(row).sort() : Object.keys(row.attributes), format === 'plain' ? ['id', 'obsolete'] : ['obsolete'])
            }
            if (mode === 'offset') assert.equal(result.meta.pagination.total, 4)
            if (!result.links.next) break
            if (mode === 'cursor') {
              assert.ok(result.meta.pagination.cursor.next.startsWith(`${sort[0].replace(/^-/, '')}:`))
              cursors.push(result.meta.pagination.cursor.next)
            }
            queryParams = fromLink(result.links.next)
            assert.ok(index < 4, 'Traversal must terminate')
          }
          assert.deepEqual(seen, expected)
          if (mode === 'cursor') {
            const backwards = []
            queryParams = { ...params, page: { size: 1, before: cursors.at(-1) } }
            for (let index = 0; index < 4; index++) {
              const result = await items.query({ format, queryParams })
              backwards.unshift(...result.data.map(row => row.id))
              if (!result.links.next) break
              queryParams = fromLink(result.links.next)
              assert.ok(queryParams.page.before)
              assert.ok(index < 3, 'Backward traversal must terminate')
            }
            assert.deepEqual(backwards, expected.slice(0, -2))
          }
        }
      })
    }
  }
})

for (const strategy of ['standard', 'window']) {
  for (const field of ['name', 'displayName']) {
    describe(`Include ${strategy} ordering by ${field} (${storageMode.mode})`, () => {
      let fixture
      before(async () => {
        fixture = await createConformanceFixture({
          apiOptions: {
            groupOptions: { relationships: { items: { type: 'hasMany', target: 'items', foreignKey: 'groupId', include: { strategy, orderBy: [field], limit: 2 } } } },
            itemOptions: {
              sortableFields: ['id', 'name', 'displayName'],
              searchSchema: {
                id: { type: 'number', actualField: 'rank' },
                name: { type: 'number', actualField: 'rank' },
                displayName: { type: 'string', actualField: 'name' }
              }
            }
          }
        })
        for (const name of ['First', 'Second']) await fixture.seed('groups', { name })
        for (const [name, rank, group] of [['Bravo', 1, '1'], ['Alpha', 2, '1'], ['Bravo', 0, '1'], ['Bravo', 1, '2'], ['Alpha', 2, '2']]) {
          await fixture.seed('items', { name, rank }, { group: { data: { type: 'groups', id: group } } })
        }
      })
      after(async () => fixture?.close())
      it('uses logical fields and the resource ID tie-breaker with sparse child output', async () => {
        const result = await fixture.api.resources.groups.query({ queryParams: { include: ['items'], fields: { items: 'note' } } })
        assert.deepEqual(result.data.map(row => row.relationships.items.data.map(item => item.id)), strategy === 'window' ? [['2', '1'], ['5', '4']] : [['2'], ['5']])
        for (const row of result.included) assert.deepEqual(Object.keys(row.attributes), ['note'])
      })
    })
  }
}

for (const defaultSort of ['-name', ['-name'], [], null]) {
  describe(`Default sort ${JSON.stringify(defaultSort)} (${storageMode.mode})`, () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { resourceOptions: { defaultSort } } })
      await fixture.seed('items', { name: 'Alpha' })
      await fixture.seed('items', { name: 'Bravo' })
    })
    after(async () => fixture?.close())
    it('applies the default while allowing explicit query ordering', async () => {
      const query = sort => fixture.api.resources.items.query({ queryParams: { ...(sort ? { sort } : {}), fields: { items: 'amount' }, page: { size: 1 } } })
      const first = await query()
      const descending = defaultSort && defaultSort.length > 0
      assert.equal(first.data[0].id, descending ? '2' : '1')
      const next = await fixture.api.resources.items.query({ queryParams: fromLink(first.links.next) })
      assert.equal(next.data[0].id, descending ? '1' : '2')
      assert.equal((await query(['id'])).data[0].id, '1')
    })
  })
}

describe(`Invalid default sorts (${storageMode.mode})`, () => {
  for (const defaultSort of [{ field: 'name', direction: 'desc' }, { column: 'name' }, true, 1, ['name', {}]]) {
    it(`rejects ${JSON.stringify(defaultSort)} during initialization`, async () => {
      await assert.rejects(async () => {
        const fixture = await createConformanceFixture({ createApi: createSchemaEnrichmentApi, tables, apiOptions: { resourceOptions: { defaultSort } } })
        await fixture.close()
      }, /defaultSort.*string/i)
    })
  }
})
