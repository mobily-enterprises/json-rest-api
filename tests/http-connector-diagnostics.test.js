import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import { createConformanceFixture } from './fixtures/conformance.js'
import { createConnectorParityApi, createSchemaEnrichmentApi } from './fixtures/api-configs.js'
import { storageMode } from './helpers/storage-mode.js'
import { databaseClient } from './helpers/test-database.js'
import { RestApiValidationError } from '../lib/rest-api-errors.js'

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
  describe(`HTTP diagnostic sink failures ${connector} (${storageMode.mode})`, () => {
    let fixture, app, sinkMode, responseContext, rejectWrite, rejectRead, readFailure
    const sinkFailure = new Error('Diagnostic sink failed')
    const writeFailure = new RestApiValidationError('Original write rejection', {
      violations: [{ field: 'data.attributes.name', message: 'Original name rejection' }]
    })
    const httpDiagnostics = []
    before(async () => {
      app = connector === 'express' ? express() : fastify()
      const capture = (...args) => {
        if (!/HTTP request error|Fastify request error/.test(args[0])) return
        httpDiagnostics.push(args)
        if (sinkMode === 'throw') throw sinkFailure
        if (sinkMode === 'reject') return Promise.reject(sinkFailure)
      }
      fixture = await createConformanceFixture({
        createApi: createSchemaEnrichmentApi,
        tables: { items: 'schema_enrichment_items' },
        apiOptions: {
          app,
          connector,
          logging: { logger: { error: capture } },
          hooks: {
            beforeDataCall: { handler: () => { if (rejectWrite) throw writeFailure } },
            beforeDataGet: { handler: () => { if (rejectRead) throw readFailure } },
            'transport:response': { handler: ({ context }) => { responseContext = context } }
          }
        }
      })
    })
    beforeEach(async () => {
      await fixture.reset()
      sinkMode = undefined
      responseContext = undefined
      rejectWrite = true
      rejectRead = false
      readFailure = undefined
      httpDiagnostics.length = 0
    })
    after(async () => { if (connector === 'fastify') await app?.close(); await fixture?.close() })

    for (const failureMode of ['throw', 'reject']) {
      for (const method of ['GET', 'POST']) {
        it(`preserves the original ${method} response when the diagnostic writer can ${failureMode}`, async () => {
          sinkMode = failureMode
          const url = method === 'GET' ? '/api/items/987654321' : '/api/items'
          const headers = { accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' }
          const body = { data: { type: 'items', attributes: { name: 'Attempted write' } } }
          let response
          if (connector === 'express') {
            const operation = request(app)[method.toLowerCase()](url).set(headers).timeout({ response: 1500, deadline: 3000 })
            response = await (method === 'POST' ? operation.send(body) : operation)
          } else {
            response = await app.inject({ method, url, headers, ...(method === 'POST' ? { payload: body } : {}) })
          }
          const payload = connector === 'express' ? response.body : response.json()
          assert.equal(response.statusCode, method === 'GET' ? 404 : 422, JSON.stringify(payload))
          assert.equal(response.headers['content-type'], 'application/vnd.api+json')
          assert.equal(httpDiagnostics.length, 1)
          assert.deepEqual(responseContext.cleanupErrors.filter(entry => entry.during === 'httpError'), [
            { phase: 'logging', during: 'httpError', error: sinkFailure }
          ])
          if (method === 'POST') {
            assert.equal(payload.errors[0].detail, 'Original name rejection')
            assert.equal(payload.errors[0].meta.transactionOutcome, 'rolledBack')
            assert.equal(responseContext.error, writeFailure)
            assert.equal(await fixture.count('items'), 0)
          } else {
            assert.equal(payload.errors[0].title, 'Not Found')
          }
        })
      }
    }

    for (const failure of [null, undefined]) {
      it(`returns JSON:API 500 for a ${failure} GET rejection when diagnostics also reject`, async () => {
        rejectWrite = false
        const item = await fixture.seed('items', { name: 'Existing' })
        rejectRead = true
        readFailure = failure
        sinkMode = 'reject'
        const url = `/api/items/${item.id}`
        const response = connector === 'express'
          ? await request(app).get(url).set('Accept', 'application/vnd.api+json').timeout({ response: 1500, deadline: 3000 })
          : await app.inject({ method: 'GET', url, headers: { accept: 'application/vnd.api+json' } })
        const payload = connector === 'express' ? response.body : response.json()
        assert.equal(response.statusCode, 500)
        assert.equal(response.headers['content-type'], 'application/vnd.api+json')
        assert.equal(payload.errors[0].title, 'Internal Server Error')
        assert.ok(!JSON.stringify(payload).includes('Cannot read properties'))
        assert.equal(httpDiagnostics.length, 1)
        assert.deepEqual(responseContext.cleanupErrors, [{ phase: 'logging', during: 'httpError', error: sinkFailure }])
        assert.equal(await fixture.count('items'), 1)
      })
    }
  })
}

describe(`Express route registration diagnostics (${storageMode.mode})`, () => {
  const unreadable = new Error('Original registration failure')
  Object.defineProperty(unreadable, 'message', { get () { throw new Error('Message inspection failed') } })
  Object.defineProperty(unreadable, 'stack', { get () { throw new Error('Stack inspection failed') } })
  for (const [label, routeFailure] of [['null', null], ['undefined', undefined], ['unreadable error', unreadable]]) {
    for (const sinkMode of ['working', 'throw', 'reject']) {
      it(`retains ${label} when the route-registration diagnostic writer is ${sinkMode}`, async () => {
        const router = express.Router()
        router.get = () => { throw routeFailure }
        let writes = 0
        let diagnostic
        await assert.rejects(createConformanceFixture({
          createApi: createSchemaEnrichmentApi,
          tables: { items: 'schema_enrichment_items' },
          apiOptions: {
            app: express(),
            connector: 'express',
            connectorOptions: { router },
            logging: {
              logger: {
                error: (message, metadata) => {
                  writes++
                  diagnostic = metadata
                  if (sinkMode === 'throw') throw new Error('Registration diagnostic failed')
                  if (sinkMode === 'reject') return Promise.reject(new Error('Registration diagnostic failed'))
                }
              }
            }
          }
        }), failure => failure === routeFailure)
        assert.equal(writes, 1)
        assert.equal(diagnostic.phase, 'routeRegistration')
        assert.equal(diagnostic.method.toUpperCase(), 'GET')
        assert.equal(diagnostic.scopeName, 'items')
        assert.equal(diagnostic.backend, databaseClient)
        assert.equal(diagnostic.transactionOutcome, 'none')
      })
    }
  }
})

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
