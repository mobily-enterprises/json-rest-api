import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createConnectorParityApi, createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'

for (const connector of ['express', 'fastify']) {
  describe(`HTTP diagnostic route metadata ${connector} (${storageMode.mode})`, () => {
    let fixture, app
    const logs = []
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      const capture = (...args) => logs.push(args)
      fixture = await createConformanceFixture({
        createApi: createConnectorParityApi,
        tables: { countries: 'connector_countries', cities: 'connector_cities' },
        apiOptions: { app, connector, logging: { level: 'error', format: 'pretty', logger: { log: capture, warn: capture, error: capture } } }
      })
    })
    beforeEach(async () => { await fixture.reset(); logs.length = 0 })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })

    it('logs the route template without request IDs or query strings', async () => {
      const url = '/api/countries/987654321?note=PRIVATE_URL_VALUE'
      const response = connector === 'express'
        ? await request(app).get(url).set('Accept', 'application/vnd.api+json')
        : await app.inject({ method: 'GET', url, headers: { accept: 'application/vnd.api+json' } })
      assert.equal(response.statusCode, 404)
      const diagnostic = logs.find(args => /HTTP request error|Fastify request error/.test(args[0]))?.[1]
      assert.ok(diagnostic)
      assert.equal(diagnostic.url, undefined)
      assert.match(diagnostic.path, /countries\/:id$/)
      assert.ok(!diagnostic.path.includes('987654321'))
      assert.ok(!diagnostic.path.includes('PRIVATE_URL_VALUE'))
      assert.equal(diagnostic.method, 'GET')
      assert.equal(diagnostic.phase, 'httpError')
      assert.equal(diagnostic.scopeName, 'countries')
      assert.equal(diagnostic.backend, fixture.knex.client.config.client)
      assert.equal(diagnostic.transactionOutcome, 'none')
    })
  })
}

for (const connector of ['express', 'fastify']) {
  describe(`HTTP diagnostic route metadata ${connector}: field redaction (${storageMode.mode})`, () => {
    let fixture, app
    const logs = []
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      const capture = (...args) => logs.push(args)
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          app,
          connector,
          fields: { accessKey: { type: 'string', hidden: true } },
          logging: { level: 'error', format: 'pretty', logger: { log: capture, warn: capture, error: capture } },
          hooks: {
            beforeDataCall: {
              functionName: 'reject-sensitive-write',
              handler: () => {
                const error = new Error('Deliberate write rejection')
                error.details = { accessKey: 'PRIVATE_NESTED_DIAGNOSTIC' }
                throw error
              }
            }
          }
        }
      })
    })
    beforeEach(async () => { await fixture.reset(); logs.length = 0 })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })
    it('redacts structured hidden error details in the connector event', async () => {
      const body = { data: { type: 'items', attributes: { name: 'Visible', accessKey: 'PRIVATE_INPUT_DIAGNOSTIC' } } }
      const response = connector === 'express'
        ? await request(app).post('/api/items').set('Content-Type', 'application/vnd.api+json').send(body)
        : await app.inject({ method: 'POST', url: '/api/items', headers: { 'content-type': 'application/vnd.api+json' }, payload: body })
      assert.equal(response.statusCode, 500)
      const diagnostic = logs.find(args => /HTTP request error|Fastify request error/.test(args[0]))
      assert.ok(diagnostic)
      assert.equal(diagnostic[1].scopeName, 'items')
      assert.equal(diagnostic[1].phase, 'httpError')
      assert.equal(diagnostic[1].backend, fixture.knex.client.config.client)
      assert.equal(diagnostic[1].transactionOutcome, 'rolledBack')
      assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE_NESTED_DIAGNOSTIC'))
      assert.equal(await fixture.count('items'), 0)
    })
  })
}
