import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

for (const connector of ['express', 'fastify']) {
  describe(`Early HTTP diagnostics ${connector} (${storageMode.mode})`, () => {
    let fixture, app, rejectTransport
    const calls = []
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          app,
          connector,
          fields: { accessKey: { type: 'string', hidden: true } },
          logging: { logger: { error: (...args) => calls.push(args) } },
          hooks: {
            'transport:request': {
              functionName: 'early-diagnostic-failure',
              handler: () => {
                if (!rejectTransport) return
                throw Object.assign(new Error('Application request check failed'), {
                  body: { accessKey: 'PRIVATE_EARLY_BODY' },
                  headers: { authorization: 'Bearer PRIVATE_EARLY_HEADER' },
                  cause: new Error('Application-owned diagnostic text')
                })
              }
            }
          }
        }
      })
    })
    beforeEach(async () => { await fixture.reset(); calls.length = 0; rejectTransport = false })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })

    const post = payload => connector === 'express'
      ? request(app).post('/api/items?token=PRIVATE_QUERY_TOKEN').set('Content-Type', 'application/vnd.api+json').set('Authorization', 'Bearer PRIVATE_EARLY_HEADER').send(payload)
      : app.inject({
        method: 'POST',
        url: '/api/items?token=PRIVATE_QUERY_TOKEN',
        headers: { 'content-type': 'application/vnd.api+json', authorization: 'Bearer PRIVATE_EARLY_HEADER' },
        payload
      })

    for (const [description, body] of [['unexpected end', '{"accessKey":"PRIVATE_EARLY_BODY",'], ['parser snippet', 'PRIVATE_EARLY_BODY']]) {
      it(`omits the raw malformed body before resource processing: ${description}`, async () => {
        const response = await post(body)
        assert.equal(response.statusCode, 400)
        const diagnostic = calls.find(([message]) => /HTTP request error|Fastify request error/.test(message))?.[1]
        assert.ok(diagnostic)
        assert.equal(diagnostic.method, 'POST')
        assert.equal(diagnostic.phase, 'httpError')
        assert.equal(diagnostic.transactionOutcome, 'none')
        if (connector === 'express') assert.equal(diagnostic.scopeName, null)
        assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_EARLY_BODY|PRIVATE_EARLY_HEADER|PRIVATE_QUERY_TOKEN/)
        assert.equal(await fixture.count('items'), 0)
      })
    }

    it('omits known HTTP payload containers while retaining the application error cause', async () => {
      rejectTransport = true
      const response = await post({ data: { type: 'items', attributes: { name: 'Visible' } } })
      assert.equal(response.statusCode, 500)
      const diagnostic = calls.find(([message]) => /HTTP request error|Fastify request error/.test(message))?.[1]
      assert.ok(diagnostic)
      assert.equal(diagnostic.error.cause.message, 'Application-owned diagnostic text')
      assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_EARLY_BODY|PRIVATE_EARLY_HEADER|PRIVATE_QUERY_TOKEN/)
      assert.equal(await fixture.count('items'), 0)
    })
  })
}
