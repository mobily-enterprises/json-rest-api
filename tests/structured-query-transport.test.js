import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

for (const connector of ['express', 'fastify']) {
  describe(`Structured JSON HTTP ${connector} (${storageMode.mode})`, () => {
    let fixture, app, server, origin
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { app, connector, fields: { payload: { type: 'object', nullable: true }, list: { type: 'array', nullable: true } } }
      })
      if (connector === 'fastify') origin = await app.listen({ host: '127.0.0.1', port: 0 })
      else {
        server = await new Promise((resolve, reject) => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
          listening.once('error', reject)
        })
        origin = `http://127.0.0.1:${server.address().port}`
      }
    })
    beforeEach(async () => fixture.reset())
    after(async () => {
      try {
        if (connector === 'fastify') await app?.close()
        else if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      } finally { await fixture?.close() }
    })

    it('preserves nested JSON values through actual HTTP writes and reads', async () => {
      const attributes = { payload: { nested: [0, false, null, {}], text: 'value' }, list: [{ nested: true }, [], 0, false, null] }
      const response = await fetch(`${origin}/api/items`, {
        method: 'POST', headers: { 'content-type': 'application/vnd.api+json' }, body: JSON.stringify(createJsonApiDocument('items', attributes))
      })
      const created = await response.json()
      assert.equal(response.status, 201, JSON.stringify(created))
      for (const document of [created, await (await fetch(`${origin}/api/items/${created.data.id}`)).json()]) {
        assert.deepEqual(document.data.attributes.payload, attributes.payload)
        assert.deepEqual(document.data.attributes.list, attributes.list)
      }
      const result = await (await fetch(`${origin}/api/items`)).json()
      assert.deepEqual(result.data[0].attributes.payload, attributes.payload)
      assert.deepEqual(result.data[0].attributes.list, attributes.list)
    })

    it('returns a typed 422 for whole-document sorting without executing SQL', async () => {
      const queries = []
      const onQuery = event => queries.push(event.sql)
      fixture.knex.on('query', onQuery)
      try {
        for (const sort of ['payload', '-list']) {
          const response = await fetch(`${origin}/api/items?sort=${sort}`)
          const document = await response.json()
          assert.equal(response.status, 422, JSON.stringify(document))
          assert.ok(document.errors.length > 0)
          assert.match(JSON.stringify(document.errors), /sort/i)
        }
      } finally { fixture.knex.off('query', onQuery) }
      assert.deepEqual(queries, [])
    })
  })
}
