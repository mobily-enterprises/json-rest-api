import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'

describe('Unavailable include-window capability', () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createIdConformanceApi,
      tables: { groups: 'conformance_groups', items: 'conformance_items', memberships: 'conformance_memberships' },
      apiOptions: { collectionInclude: { strategy: 'window', limit: 1 } }
    })
  })
  beforeEach(async () => {
    fixture.api.knex.capabilities.windowFunctions = true
    await fixture.reset()
    await fixture.api.resources.groups.post({ document: { data: { type: 'groups', id: '100', attributes: { name: 'Original' } } } })
    await fixture.api.resources.items.post({ document: { data: { type: 'items', id: '101', attributes: { name: 'Child' }, relationships: { group: { data: { type: 'groups', id: '100' } } } } } })
    fixture.api.knex.capabilities.windowFunctions = false
  })
  after(async () => { await fixture?.close() })
  for (const returning of ['none', 'minimal']) {
    it(`allows ${returning} writes that do not execute an included response`, async () => {
      const result = await fixture.api.resources.groups.patch({
        id: '100',
        returning,
        queryParams: { include: ['items'] },
        document: { data: { type: 'groups', id: '100', attributes: { name: 'Changed' } } }
      })
      if (returning === 'none') assert.equal(result, undefined)
      else assert.equal(result.data.id, '100')
      fixture.api.knex.capabilities.windowFunctions = true
      assert.equal((await fixture.api.resources.groups.get({ id: '100' })).data.attributes.name, 'Changed')
    })
  }
  for (const method of ['get', 'query', 'patch']) {
    it(`rejects ${method} without executing a window query or retaining partial changes`, async () => {
      const queries = []
      const observe = query => queries.push(query.sql)
      fixture.knex.on('query', observe)
      let failure
      try {
        await assert.rejects(fixture.api.resources.groups[method]({
          id: '100',
          returning: 'full',
          queryParams: { include: ['items'] },
          ...(method === 'patch' ? { document: { data: { type: 'groups', id: '100', attributes: { name: 'Changed' } } } } : {})
        }), error => { failure = error; return /Per-parent include limits require window function support/.test(error.message) })
      } finally { fixture.knex.off('query', observe); fixture.api.knex.capabilities.windowFunctions = true }
      assert.equal(queries.some(sql => /row_number\s*\(/i.test(sql)), false)
      if (method === 'patch') assert.equal(failure.transactionOutcome, 'rolledBack')
      assert.equal((await fixture.api.resources.groups.get({ id: '100' })).data.attributes.name, 'Original')
    })
  }
})
