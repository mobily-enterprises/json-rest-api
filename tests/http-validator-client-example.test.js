import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import { CorsPlugin } from '../index.js'
import { readForConditionalUpdate } from '../examples/conditional-http-client.js'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { createStrongEntityTag } from '../plugins/core/connectors/lib/http-validators.js'

const origin = 'https://app.example.com'
for (const connector of ['express', 'fastify']) {
  describe(`Conditional HTTP client example ${connector} (${storageMode.mode})`, () => {
    let fixture, app, server, baseUrl, item
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      if (connector === 'express') {
        app.set('json spaces', 4)
        app.set('json escape', true)
        app.set('json replacer', (key, value) => key === 'name' ? 'Framework replacement' : value)
      } else {
        app.setReplySerializer(payload => JSON.stringify({ ...payload, meta: { frameworkSerializer: true } }))
      }
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: { app, connector, connectorOptions: { httpValidators: true } }
      })
      await fixture.api.use(CorsPlugin, {
        origin,
        credentials: true,
        allowedHeaders: ['Content-Type', 'Accept', 'If-Match'],
        exposedHeaders: ['ETag']
      })
      if (connector === 'fastify') {
        baseUrl = await app.listen({ port: 0, host: '127.0.0.1' })
      } else {
        server = await new Promise(resolve => {
          const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        })
        baseUrl = `http://127.0.0.1:${server.address().port}`
      }
    })
    beforeEach(async () => {
      await fixture.reset()
      item = await fixture.seed('items', { name: 'Original' })
    })
    after(async () => {
      try {
        if (connector === 'fastify') await app?.close()
        else if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      } finally { await fixture?.close() }
    })
    it('allows the conditional request preflight and exposes the selected tag', async () => {
      const url = `${baseUrl}/api/items/${item.id}`
      const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: { origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type, if-match' }
      })
      assert.equal(preflight.status, 204)
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin)
      assert.match(preflight.headers.get('Access-Control-Allow-Methods'), /PATCH/)
      assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /If-Match/)
      const selected = await fetch(url, { headers: { origin } })
      assert.equal(selected.status, 200)
      assert.equal(selected.headers.get('Access-Control-Expose-Headers'), 'ETag')
      assert.equal(selected.headers.get('Access-Control-Allow-Credentials'), 'true')
      assert.ok(selected.headers.get('ETag')?.startsWith('"jra1-'))
      await selected.arrayBuffer()
    })
    it('hashes connector-owned bytes without framework JSON transformations', async () => {
      await fixture.api.resources.items.patch({
        id: item.id,
        format: 'plain',
        inputRecord: { name: '<Selected & original>' }
      })
      const selected = await fetch(`${baseUrl}/api/items/${item.id}`)
      assert.equal(selected.status, 200)
      const bytes = await selected.text()
      const body = JSON.parse(bytes)
      assert.equal(body.data.attributes.name, '<Selected & original>')
      assert.equal(body.meta?.frameworkSerializer, undefined)
      assert.equal(bytes, JSON.stringify(body))
      assert.ok(bytes.includes('<Selected & original>'))
      assert.equal(selected.headers.get('ETag'), createStrongEntityTag(bytes))
    })
    it('saves an edit and returns a readable stale failure without overwriting it', async () => {
      const url = `${baseUrl}/api/items/${item.id}?fields[items]=name`
      const selected = await readForConditionalUpdate(url, { headers: { origin }, credentials: 'include' })
      assert.equal(selected.document.data.attributes.name, 'Original')
      const body = name => ({ data: { type: 'items', id: item.id, attributes: { name } } })
      const accepted = await selected.save(body('Accepted'))
      const acceptedBody = await accepted.json()
      assert.equal(accepted.status, 200, JSON.stringify(acceptedBody))
      // The ordinary write response proves the framework serializer is active.
      if (connector === 'express') assert.equal(acceptedBody.data.attributes.name, 'Framework replacement')
      else assert.equal(acceptedBody.meta.frameworkSerializer, true)
      const stale = await selected.save(body('Stale overwrite'))
      assert.equal(stale.status, 412)
      assert.equal(stale.headers.get('Access-Control-Allow-Origin'), origin)
      assert.equal(stale.headers.get('Access-Control-Allow-Credentials'), 'true')
      assert.equal((await stale.json()).errors[0].code, 'REST_API_PRECONDITION_FAILED')
      assert.equal((await fixture.api.resources.items.get({ id: item.id })).data.attributes.name, 'Accepted')
    })
  })
}
