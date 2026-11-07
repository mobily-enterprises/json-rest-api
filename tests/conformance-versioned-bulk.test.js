import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

const unsupported = error => (error?.cause ?? error).code === 'REST_API_BULK_WRITE_UNSUPPORTED'

// A version token changes per row on every write; one statement per chunk cannot
// check and advance tokens row by row, so many-row writes refuse versioned resources.
describe(`Many-row writes on versioned resources (${storageMode.mode})`, () => {
  let fixture, items, first, second
  before(async () => {
    fixture = await createConformanceFixture({
      createApi: createSchemaEnrichmentApi,
      tables: { items: 'schema_enrichment_items' },
      apiOptions: { fields: { revision: { type: 'string', required: true } }, resourceOptions: { versionField: 'revision' } }
    })
    items = fixture.api.resources.items
  })
  beforeEach(async () => {
    await fixture.reset()
    first = await fixture.seed('items', { name: 'First' })
    second = await fixture.seed('items', { name: 'Second' })
  })
  after(async () => { await fixture?.close() })

  it('refuses every many-row write before changing anything', async () => {
    const before = await items.query({ format: 'plain', queryParams: { sort: ['id'] } })
    for (const [method, params] of [
      ['postMany', { data: [{ name: 'Third' }] }],
      ['patchMany', { data: [{ id: first.id, name: 'Changed' }] }],
      ['patchWhereIds', { ids: [first.id, second.id], data: { name: 'Changed' } }],
      ['patchWhere', { filters: {}, data: { name: 'Changed' } }],
      ['deleteMany', { ids: [first.id] }],
      ['deleteWhere', { filters: {} }]
    ]) {
      await assert.rejects(items[method](params), unsupported, method)
    }
    assert.deepEqual(await items.query({ format: 'plain', queryParams: { sort: ['id'] } }), before)
  })

  it('rejects the 2.x bulk options with their replacements', async () => {
    for (const [option, message] of [['atomic', /all-or-nothing/], ['expectedVersions', /lockVersionField and onlyIf/], ['operations', /data: \[\{ id/]]) {
      await assert.rejects(items.deleteMany({ ids: [first.id], [option]: option === 'atomic' ? false : [] }),
        error => (error?.cause ?? error).code === 'REST_API_VALIDATION' && message.test((error?.cause ?? error).message), option)
    }
    assert.equal(await fixture.count('items'), 2)
  })
})

for (const connector of ['express', 'fastify']) {
  describe(`HTTP bulk version conditions ${connector} (${storageMode.mode})`, () => {
    let fixture, app, first, second
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { app, connector, bulk: true, connectorOptions: { httpValidators: true }, fields: { revision: { type: 'string', required: true } }, resourceOptions: { versionField: 'revision' } }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      first = await fixture.seed('items', { name: 'First' })
      second = await fixture.seed('items', { name: 'Second' })
    })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })
    const send = async (method, body, headers = {}) => {
      const url = '/api/items/bulk'
      const response = connector === 'express'
        ? await request(app)[method.toLowerCase()](url).set({ 'Content-Type': 'application/vnd.api+json', ...headers }).send(body)
        : await app.inject({ method, url, headers: { 'content-type': 'application/vnd.api+json', ...headers }, payload: body })
      return { status: response.statusCode, body: connector === 'express' ? response.body : response.json() }
    }
    const bodyFor = method => method === 'POST'
      ? { data: [{ type: 'items', attributes: { name: 'Third' } }] }
      : method === 'DELETE'
        ? { data: [first, second].map(({ id }) => ({ type: 'items', id })) }
        : { data: [first, second].map(({ id }) => ({ type: 'items', id, attributes: { name: 'Changed' } })) }
    const unchanged = async () => {
      assert.equal(await fixture.count('items'), 2)
      for (const record of [first, second]) {
        assert.equal((await fixture.api.resources.items.get({ id: record.id, format: 'plain' })).name, record.attributes.name)
      }
    }

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      it(`rejects ${method} If-Match on the bulk route`, async () => {
        for (const condition of ['*', '"stale"']) {
          const result = await send(method, bodyFor(method), { 'if-match': condition })
          assert.equal(result.status, 422)
          assert.match(result.body.errors[0].detail, /If-Match is not supported for this route/)
          await unchanged()
        }
      })

      it(`refuses ${method} on a versioned resource without writing`, async () => {
        const result = await send(method, bodyFor(method))
        assert.equal(result.status, 422, JSON.stringify(result.body))
        assert.equal(result.body.errors[0].code, 'REST_API_BULK_WRITE_UNSUPPORTED')
        await unchanged()
      })
    }
  })
}
