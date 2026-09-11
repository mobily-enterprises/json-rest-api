import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

describe(`Related storage query boundary (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables: { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
    })
  })
  beforeEach(async () => {
    await fixture.reset()
    await fixture.seed('groups', { name: 'Included' })
    await fixture.seed('groups', { name: 'Unrelated' })
    await fixture.seed('items', { name: 'Parent' }, { groups: { data: [{ type: 'groups', id: '1' }] } })
  })
  after(async () => { await fixture?.close() })

  it('returns a deferred subquery that callers can constrain before executing', async () => {
    const statements = []
    const capture = query => statements.push(query.sql)
    fixture.knex.on('query', capture)
    try {
      const scope = fixture.api.resources.items
      const result = await fixture.api.helpers.dataRelatedIdsQuery({
        scopeName: 'items',
        relDef: scope.vars.schemaInfo.schemaRelationships.groups,
        context: { id: '1', relationshipName: 'groups', db: fixture.knex }
      })
      assert.deepEqual(statements, [], 'awaiting the helper must not execute its thenable builder')
      assert.equal(typeof result.query.clone, 'function')
      const empty = await result.query.clone().whereRaw('1 = 0')
      assert.deepEqual(empty, [])
      const ids = await result.query
      assert.equal(ids.length, 1)
      assert.deepEqual(Object.values(ids[0]).map(String), ['1'])
      assert.equal(statements.length, 2)
    } finally { fixture.knex.off('query', capture) }
  })
})
