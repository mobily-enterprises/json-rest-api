import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { RestApiResourceError } from '../lib/rest-api-errors.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createIdConformanceApi, createBasicApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const relationships = [
  { parent: 'items', name: 'group', target: 'groups' },
  { parent: 'items', name: 'subject', target: 'groups' },
  { parent: 'groups', name: 'firstItem', target: 'items' },
  { parent: 'groups', name: 'items', target: 'items' },
  { parent: 'groups', name: 'mentions', target: 'items' },
  { parent: 'items', name: 'groups', target: 'groups' }
]
const tables = { memberships: 'conformance_memberships', items: 'conformance_items', groups: 'conformance_groups' }
const denied = { code: 'REST_API_RESOURCE', subtype: 'forbidden' }

async function seed (fixture) {
  await fixture.reset()
  await fixture.api.resources.groups.post({ inputRecord: { data: { type: 'groups', id: '0', attributes: { name: 'Group' } } } })
  await fixture.api.resources.items.post({
    inputRecord: {
      data: {
        type: 'items',
        id: '0',
        attributes: { name: 'Item' },
        relationships: { group: { data: { type: 'groups', id: '0' } }, subject: { data: { type: 'groups', id: '0' } } }
      }
    }
  })
  await fixture.api.resources.items.postRelationship({ id: '0', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: '0' }] })
}

async function installPermissions (api) {
  await api.customize({
    hooks: {
      checkPermissions: {
        functionName: 'included-target-query-permission',
        handler: ({ context, scopeName }) => {
          const original = context.originalContext
          if (context.method === 'query' && original?.traceQueryScope === scopeName) {
            original.trace.push({
              method: original.method,
              id: original.id,
              scopeName: original.scopeName,
              schemaInfo: original.schemaInfo,
              filters: original.queryParams.filters,
              auth: original.auth,
              transaction: original.transaction,
              purpose: original.knexQuery?.queryPurpose
            })
          }
          if (context.method !== 'query' || original?.denyQueryScope !== scopeName) return
          if (original.denyPurpose && original.knexQuery?.queryPurpose !== original.denyPurpose) return
          throw new RestApiResourceError(`Query denied for ${scopeName}`, { subtype: 'forbidden' })
        }
      }
    }
  })
}

describe(`Included resource query permissions (${storageMode.mode})`, () => {
  let fixture
  before(async () => {
    fixture = await createConformanceFixture({ createApi: createIdConformanceApi, tables })
    await installPermissions(fixture.api)
  })
  beforeEach(async () => { await seed(fixture) })
  after(async () => { await fixture?.close() })

  for (const { parent, name, target } of relationships) {
    for (const method of ['get', 'query']) {
      for (const format of ['jsonapi', 'plain']) {
        it(`enforces include query permission for ${method} ${parent}.${name} (${format})`, async () => {
          await assert.rejects(fixture.api.resources[parent][method]({
            id: '0', format, queryParams: { include: [name] }
          }, { denyQueryScope: target, denyPurpose: 'include' }), denied)
        })
      }
    }
    it(`enforces target query permission on ${parent}.${name} linkage`, async () => {
      await assert.rejects(fixture.api.resources[target].query({}, { denyQueryScope: target }), denied)
      await assert.rejects(fixture.api.resources[parent].getRelationship({
        id: '0', relationshipName: name
      }, { denyQueryScope: target }), denied)
    })
    it(`enforces target query permission on ${parent}.${name} related data`, async () => {
      await assert.rejects(fixture.api.resources[parent].getRelated({
        id: '0', relationshipName: name
      }, { denyQueryScope: target }), denied)
    })
  }

  for (const method of ['get', 'query']) {
    for (const format of ['jsonapi', 'plain']) {
      it(`does not disclose default relationship IDs through ${method} (${format})`, async () => {
        await assert.rejects(fixture.api.resources.items[method]({ id: '0', format }, { denyQueryScope: 'groups' }), denied)
      })
    }
  }

  it('uses target query metadata with caller auth and transaction, withholding parent filters and ID', async () => {
    const transaction = await fixture.knex.transaction()
    const auth = { userId: 'reader' }
    const trace = []
    try {
      await fixture.api.resources.items.query({
        transaction, queryParams: { include: ['group'], filters: { name: 'Item' } }
      }, { auth, trace, traceQueryScope: 'groups' })
      assert.ok(trace.length > 0)
      assert.ok(trace.some(entry => entry.purpose === 'include'))
      for (const entry of trace) {
        assert.equal(entry.method, 'query')
        assert.equal(entry.id, undefined)
        assert.equal(entry.scopeName, 'groups')
        assert.equal(entry.schemaInfo, fixture.api.resources.groups.vars.schemaInfo)
        assert.deepEqual(entry.filters, {})
        assert.equal(entry.auth, auth)
        assert.equal(entry.transaction, transaction)
      }
      assert.equal(transaction.isCompleted(), false)
    } finally { await transaction.rollback() }
  })

  for (const returning of ['full', 'minimal', 'none']) {
    it(`enforces permissions for the selected ${returning} write response`, async () => {
      const operation = fixture.api.resources.items.patch({
        id: '0', returning, inputRecord: { data: { type: 'items', attributes: { name: 'Changed' } } }
      }, { denyQueryScope: 'groups' })
      if (returning === 'full') await assert.rejects(operation, denied)
      else await operation
      const stored = await fixture.api.resources.items.get({ id: '0' })
      assert.equal(stored.data.attributes.name, returning === 'full' ? 'Item' : 'Changed')
    })
  }
})

for (const connector of ['express', 'fastify']) {
  describe(`Include HTTP authorization through ${connector} (${storageMode.mode})`, () => {
    let fixture, app
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({ createApi: createIdConformanceApi, apiOptions: { app, connector }, tables })
      await installPermissions(fixture.api)
      await fixture.api.customize({
        hooks: {
          'transport:request': {
            functionName: 'include-http-denial-context',
            handler: ({ context }) => { context.denyQueryScope = context.transport.request.headers['x-target'] }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => { await seed(fixture) })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally { await fixture?.close() }
    })

    for (const { parent, name, target } of relationships) {
      for (const url of [`/api/${parent}/0?include=${name}`, `/api/${parent}/0/relationships/${name}`]) {
        it(`rejects ${url} without returning denied identifiers or attributes`, async () => {
          const headers = { 'x-target': target }
          const response = connector === 'express'
            ? await request(app).get(url).set(headers)
            : await app.inject({ method: 'GET', url, headers })
          assert.equal(response.statusCode, 403)
          const body = connector === 'express' ? response.body : response.json()
          assert.equal(Object.hasOwn(body, 'data'), false)
          assert.equal(Object.hasOwn(body, 'included'), false)
          assert.equal(body.errors[0].detail, `Query denied for ${target}`)
        })
      }
    }
  })
}

// Regular storage uses declared pivot resources; AnyAPI uses canonical tenant links.
for (const strategy of ['standard', 'window']) {
  describe(`Regular pivot permissions and policies (${strategy})`, () => {
    let fixture
    before(async () => {
      fixture = await createConformanceFixture({
        storage: 'knex',
        createApi: createIdConformanceApi,
        tables,
        apiOptions: {
          manyToManyInclude: { strategy, limit: 1 },
          membershipPolicy: ({ query, context, column, value }) => {
            if (context.visibleGroup !== undefined) query.where(column('groupId'), value('groupId', context.visibleGroup))
            return true
          }
        }
      })
      await installPermissions(fixture.api)
    })
    beforeEach(async () => {
      await seed(fixture)
      await fixture.api.resources.groups.post({ inputRecord: { data: { type: 'groups', id: '1', attributes: { name: 'Visible membership' } } } })
      await fixture.api.resources.items.postRelationship({ id: '0', relationshipName: 'groups', relationshipData: [{ type: 'groups', id: '1' }] })
    })
    after(async () => { await fixture?.close() })

    for (const method of ['get', 'query']) {
      it(`applies pivot row policy before ${method} include limits`, async () => {
        const result = await fixture.api.resources.items[method]({ id: '0', queryParams: { include: ['groups'] } }, { visibleGroup: '1' })
        const row = method === 'get' ? result.data : result.data[0]
        assert.deepEqual(row.relationships.groups.data, [{ type: 'groups', id: '1' }])
        assert.deepEqual(result.included.map(item => item.id), ['1'])
      })
      it(`enforces pivot query permission during ${method} includes`, async () => {
        await assert.rejects(fixture.api.resources.items[method]({ id: '0', queryParams: { include: ['groups'] } }, {
          denyQueryScope: 'memberships', denyPurpose: 'include'
        }), denied)
      })
    }
    it('applies the same pivot policy to full linkage and related pagination counts', async () => {
      const params = { id: '0', relationshipName: 'groups' }
      assert.deepEqual((await fixture.api.resources.items.getRelationship(params, { visibleGroup: '1' })).data, [{ type: 'groups', id: '1' }])
      const related = await fixture.api.resources.items.getRelated({ ...params, queryParams: { page: { number: 1, size: 1 } } }, { visibleGroup: '1' })
      assert.deepEqual(related.data.map(row => row.id), ['1'])
      assert.equal(related.meta.pagination.total, 1)
    })
    it('enforces pivot query permission on default linkage', async () => {
      await assert.rejects(fixture.api.resources.items.get({ id: '0' }, { denyQueryScope: 'memberships' }), denied)
    })
  })
}

describe(`Nested include query permissions (${storageMode.mode})`, () => {
  let fixture, book
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createBasicApi,
      tables: { pivots: 'basic_book_authors', books: 'basic_books', authors: 'basic_authors', publishers: 'basic_publishers', countries: 'basic_countries' }
    })
    await installPermissions(fixture.api)
  })
  beforeEach(async () => {
    await fixture.reset()
    const country = await fixture.seed('countries', { name: 'Country', code: 'AA' })
    const countryLink = { country: { data: { type: 'countries', id: country.id } } }
    const publisher = await fixture.seed('publishers', { name: 'Publisher' }, countryLink)
    const author = await fixture.seed('authors', { name: 'Author' }, { publisher: { data: { type: 'publishers', id: publisher.id } } })
    book = await fixture.seed('books', { title: 'Book' }, countryLink)
    await fixture.api.resources.books.postRelationship({ id: book.id, relationshipName: 'authors', relationshipData: [{ type: 'authors', id: author.id }] })
  })
  after(async () => { await fixture?.close() })

  for (const method of ['get', 'query']) {
    for (const format of ['jsonapi', 'plain']) {
      it(`enforces a third-level include permission through ${method} (${format})`, async () => {
        const params = { id: book.id, format, queryParams: { include: ['authors.publisher.country'] } }
        const allowed = await fixture.api.resources.books[method](params)
        const countries = format === 'jsonapi'
          ? allowed.included.filter(row => row.type === 'countries')
          : (method === 'get' ? [allowed] : allowed.data).flatMap(row => row.authors.map(author => author.publisher.country))
        assert.deepEqual(countries.map(row => row.id), ['1'])
        await assert.rejects(fixture.api.resources.books[method](params, { denyQueryScope: 'countries', denyPurpose: 'include' }), denied)
      })
    }
  }
})
