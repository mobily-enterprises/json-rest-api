import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { validateJsonApiStructure } from './helpers/test-utils.js'
import { parseJsonApiQuery } from '../plugins/core/lib/querying-writing/connectors-query-parser.js'
import { holdManagedTransaction } from './helpers/transaction-completion.js'

const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const seed = async fixture => {
  await fixture.reset()
  await fixture.seed('groups', { name: 'Empty' })
  await fixture.seed('groups', { name: 'Populated' })
  await fixture.seed('items', { name: 'Linked' }, {
    group: { data: { type: 'groups', id: '2' } },
    subject: { data: { type: 'groups', id: '2' } },
    groups: { data: [{ type: 'groups', id: '2' }] }
  })
  await fixture.seed('items', { name: 'Empty' })
}
const cases = [
  ['groups', '1', 'items', 'group', false], ['groups', '1', 'firstItem', 'group', true],
  ['groups', '1', 'mentions', 'group', false], ['groups', '1', 'members', 'group', false],
  ['items', '2', 'group', 'items', true], ['items', '2', 'subject', 'items', true],
  ['items', '2', 'groups', 'items', false]
]
const assertIncluded = (document, expected) => {
  if (document.data !== null) validateJsonApiStructure(document, Array.isArray(document.data))
  if (expected) assert.deepEqual(document.included, [])
  else assert.equal(Object.hasOwn(document, 'included'), false)
}
const queryOf = link => parseJsonApiQuery(new URL(link, 'http://localhost').search.slice(1))

describe(`Empty include documents (${storageMode.mode})`, () => {
  let fixture
  before(async () => { fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { inverseMembership: true } }) })
  beforeEach(async () => { await seed(fixture) })
  after(async () => { await fixture?.close() })

  for (const [type, id, relationship, nested, singular] of cases) {
    for (const method of ['get', 'query']) {
      it(`${method} ${type}.${relationship} retains an empty included array`, async () => {
        const document = await fixture.api.resources[type][method]({ id, queryParams: { filters: { name: 'Empty' }, include: [relationship] } })
        assertIncluded(document, true)
        assert.deepEqual(queryOf(document.links.self).include, [relationship])
      })
    }
    it(`getRelated ${type}.${relationship} preserves include presence with ${singular ? 'null' : 'empty collection'} data`, async () => {
      for (const include of [undefined, [], [nested]]) {
        const document = await fixture.api.resources[type].getRelated({ id, relationshipName: relationship, queryParams: { include } })
        assert.deepEqual(document.data, singular ? null : [])
        assertIncluded(document, include !== undefined)
        assert.deepEqual(queryOf(document.links.self).include, include)
      }
    })
  }

  for (const method of ['get', 'query']) {
    it(`${method} keeps an omitted include absent across reused query objects and contexts`, async () => {
      const queryParams = { fields: { groups: 'name' } }
      const context = {}
      await fixture.api.resources.groups[method]({ id: '1', queryParams: { include: ['items'] } }, context)
      for (let count = 0; count < 2; count++) {
        const document = await fixture.api.resources.groups[method]({ id: '1', queryParams }, context)
        assertIncluded(document, false)
        assert.equal(queryOf(document.links.self).include, undefined)
        assert.equal(queryParams.include, undefined)
      }
    })

    it(`${method} preserves explicitly empty includes and selected fields in self links`, async () => {
      const document = await fixture.api.resources.groups[method]({ id: '1', queryParams: { include: [], fields: { groups: 'name' } } })
      assertIncluded(document, true)
      assert.deepEqual(queryOf(document.links.self).include, [])
      assert.deepEqual(queryOf(document.links.self).fields, { groups: 'name' })
    })
  }

  it('keeps included on empty primary pages and preserves empty includes in every pagination link', async () => {
    const empty = await fixture.api.resources.items.query({ queryParams: { include: ['group'], filters: { name: 'Absent' } } })
    assert.deepEqual(empty.data, [])
    assertIncluded(empty, true)
    const page = await fixture.api.resources.groups.query({ queryParams: { include: [], page: { size: 1, number: 1 } } })
    assertIncluded(page, true)
    assert.ok(page.links.next)
    for (const link of Object.values(page.links).filter(Boolean)) assert.deepEqual(queryOf(link).include, [])
    const next = await fixture.api.resources.groups.query({ queryParams: queryOf(page.links.next) })
    assertIncluded(next, true)
    assert.notEqual(page.data[0].id, next.data[0].id)
  })

  for (const method of ['post', 'patch', 'put']) {
    for (const borrowed of [false, true]) {
      it(`${method} full response retains empty includes (${borrowed ? 'borrowed' : 'owned'})`, async () => {
        const unit = borrowed ? await holdManagedTransaction(fixture.api) : undefined
        const transaction = unit?.transaction
        try {
          const id = method === 'post' ? '3' : '2'
          const document = await fixture.api.resources.items[method]({ id, transaction, returning: 'full', inputRecord: { data: { type: 'items', id, attributes: { name: 'Written', active: true, score: 0 } } }, queryParams: { include: ['groups'], fields: { items: 'name' } } })
          assertIncluded(document, true)
          assert.equal(document.data.attributes.name, 'Written')
          if (transaction) assert.equal(transaction.isCompleted(), false)
        } finally { await unit?.rollback() }
        if (borrowed) assert.equal((await fixture.api.resources.items.get({ id: '2' })).data.attributes.name, 'Empty')
      })
    }
  }

  it('keeps plain, minimal and none result contracts with an explicit empty include', async () => {
    const plain = await fixture.api.resources.groups.get({ id: '1', format: 'plain', queryParams: { include: [] } })
    assert.equal(plain.name, 'Empty')
    assert.equal(Object.hasOwn(plain, 'included'), false)
    const related = await fixture.api.resources.items.getRelated({ id: '2', relationshipName: 'group', format: 'plain', queryParams: { include: [] } })
    assert.equal(related, null)
    for (const returning of ['minimal', 'none']) {
      const document = await fixture.api.resources.groups.patch({ id: '1', returning, inputRecord: { data: { type: 'groups', id: '1', attributes: { name: 'Empty' } } }, queryParams: { include: [] } })
      assert.deepEqual(document, returning === 'none' ? undefined : { data: { type: 'groups', id: '1' } })
    }
  })
})

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} empty includes (${storageMode.mode})`, () => {
    let fixture; let app; let server; let baseUrl
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      if (connector === 'express') app.use(express.json({ type: 'application/vnd.api+json' }))
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables, apiOptions: { app, connector, inverseMembership: true } })
      if (connector === 'express') {
        server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      } else baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    })
    beforeEach(async () => { await seed(fixture) })
    after(async () => {
      try {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        if (connector === 'fastify') await app?.close()
      } finally { await fixture?.close() }
    })

    for (const path of ['/groups/1', '/groups', '/groups/1/items', '/items/2/group', '/items/2/subject', '/groups/1/firstItem']) {
      it(`preserves explicitly empty include and follows the self link for ${path}`, async () => {
        for (const query of ['', '?include=', '?include=items&include=']) {
          const response = await fetch(`${baseUrl}/api${path}${query}`)
          assert.equal(response.status, 200)
          const document = await response.json()
          assertIncluded(document, query !== '')
          const follow = await fetch(new URL(document.links.self, baseUrl))
          assert.equal(follow.status, 200)
          assert.deepEqual(await follow.json(), document)
        }
      })
    }

    for (const method of ['POST', 'PATCH', 'PUT']) {
      it(`${method} returns empty includes for an empty relationship`, async () => {
        const id = method === 'POST' ? '3' : '2'
        const response = await fetch(`${baseUrl}/api/items${method === 'POST' ? '' : '/2'}?include=groups`, { method, headers: { 'content-type': 'application/vnd.api+json' }, body: JSON.stringify({ data: { type: 'items', id, attributes: { name: 'Written', active: true, score: 0 } } }) })
        assert.equal(response.status, method === 'POST' ? 201 : 200)
        assertIncluded(await response.json(), true)
      })
    }

    it('does not add included or data to invalid-include and missing-resource errors', async () => {
      for (const path of ['/groups/1?include=missing', '/groups/999?include=items']) {
        const response = await fetch(`${baseUrl}/api${path}`)
        assert.equal(response.status, path.includes('999') ? 404 : 400)
        const document = await response.json()
        assert.ok(document.errors.length > 0)
        assert.equal(Object.hasOwn(document, 'included'), false)
        assert.equal(Object.hasOwn(document, 'data'), false)
      }
    })
  })
}
