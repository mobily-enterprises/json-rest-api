import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createQueryConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

// LIKE reads %, _ and (on MySQL and PostgreSQL) a backslash as pattern syntax.
// Text operators search for the value as written, so each of them matches only
// itself, on its own column and through a joined table alike.
const names = ['50% off', '50 percent off', 'a_b', 'axb', 'back\\slash', 'backslash']
const sortedIds = result => result.data.map(record => record.id).sort()

describe(`Text search wildcards match literally (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createQueryConformanceApi,
      tables: { items: 'conformance_items', groups: 'conformance_groups', memberships: 'conformance_memberships' }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await fixture.seed('groups', { name: 'Team_1' })
    await fixture.seed('groups', { name: 'TeamX1' })
    for (const [index, name] of names.entries()) {
      await fixture.seed('items', { name, rank: index }, { group: { data: { type: 'groups', id: index < 3 ? '1' : '2' } } })
    }
  })
  after(async () => { await fixture?.close() })

  const query = (resource, filters) => fixture.api.resources[resource].query({
    queryParams: { filters, page: { number: 1, size: 3 } }
  })

  for (const [filters, expected] of [
    [{ nameContains: '50%' }, ['1']],
    [{ nameContains: '%' }, ['1']],
    [{ nameStarts: '50%' }, ['1']],
    [{ nameContains: 'a_b' }, ['3']],
    [{ nameContains: '_' }, ['3']],
    [{ nameEnds: '_b' }, ['3']],
    [{ nameContains: 'k\\s' }, ['5']],
    [{ nameContains: '\\' }, ['5']],
    [{ nameEnds: '\\slash' }, ['5']],
    [{ nameContains: '\\%' }, []],
    // A word list joins another table; the group named Team_1 holds items 1-3.
    [{ relatedWords: 'Team_' }, ['1', '2', '3']],
    [{ relatedWords: 'nothing,0%' }, ['1']]
  ]) {
    it(`items ${JSON.stringify(filters)} match ${JSON.stringify(expected)}`, async () => {
      const result = await query('items', filters)
      assert.deepEqual(sortedIds(result), expected)
      assert.equal(result.meta.pagination.total, expected.length)
    })
  }

  it('matches a child name literally across a has-many join', async () => {
    const result = await query('groups', { childName: 'a_b' })
    assert.deepEqual(sortedIds(result), ['1'])
    assert.equal(result.meta.pagination.total, 1)
    assert.deepEqual(sortedIds(await query('groups', { childName: '%' })), ['1'])
  })
})
