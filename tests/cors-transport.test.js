import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fastify from 'fastify'
import request from 'supertest'
import knexLib from 'knex'
import { CorsPlugin } from '../plugins/core/rest-api-cors-plugin.js'
import { createConnectorParityApi } from './fixtures/api-configs.js'
import { cleanTables, createJsonApiDocument } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'

const jsonapi = 'application/vnd.api+json'
const allowedOrigin = 'https://app.example.com'
const deniedOrigin = 'https://denied.example.com'

for (const connector of ['express', 'fastify']) {
  describe(`Real ${connector} CORS boundaries (${storageMode.mode})`, { timeout: 15000 }, () => {
    let api, app, knex, defaults
    let requests, responses, responseFailure
    const send = async (method, url = '/api/countries', body, headers = {}) => {
      headers = { accept: jsonapi, origin: allowedOrigin, ...(body === undefined ? {} : { 'content-type': jsonapi }), ...headers }
      for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key]
      if (connector === 'fastify') {
        const result = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) })
        return { status: result.statusCode, headers: result.headers, body: result.body ? result.json() : undefined }
      }
      let req = request(app)[method.toLowerCase()](url).set(headers).timeout({ response: 3000, deadline: 5000 })
      if (body !== undefined) req = req.send(body)
      const result = await req
      return { status: result.status, headers: result.headers, body: result.text ? result.body : undefined }
    }
    const assertVary = (result, expected = ['Accept', 'Origin']) => {
      assert.deepEqual(result.headers.vary?.split(',').map(value => value.trim().toLowerCase()).sort(), expected.map(value => value.toLowerCase()).sort())
    }
    const assertCors = (result, status) => {
      assert.equal(result.status, status, JSON.stringify(result.body))
      assert.equal(result.headers['access-control-allow-origin'], allowedOrigin)
      assert.equal(result.headers['access-control-allow-credentials'], 'true')
      assert.equal(result.headers['access-control-expose-headers'], 'Location, Link')
      assertVary(result)
    }

    before(async () => {
      knex = knexLib({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })
      app = connector === 'fastify' ? fastify({ bodyLimit: 1024 }) : express()
      if (connector === 'express') {
        app.use((req, res, next) => {
          if (req.headers['x-host-vary']) res.set('Vary', req.headers['x-host-vary'])
          if (req.headers['x-host-context']) req.context = { host: true }
          next()
        })
      } else {
        app.addHook('onRequest', async (req, reply) => {
          if (req.headers['x-host-vary']) reply.header('Vary', req.headers['x-host-vary'])
        })
      }
      api = await createConnectorParityApi(knex, { app, connector, transportHooks: false })
      assert.equal(api.anyapi ? 'anyapi' : 'knex', storageMode.mode)
      await api.use(CorsPlugin, { origin: allowedOrigin, credentials: true, exposedHeaders: ['Location', 'Link'], maxAge: 0 })
      await api.addRoute({
        method: 'GET',
        path: '/api/custom-response',
        handler: async () => ({ statusCode: 200, headers: { Vary: 'X-Custom' }, body: { meta: { custom: true } } })
      })
      defaults = { ...api.vars.cors }
      await api.customize({
        hooks: {
          'transport:request': {
            functionName: 'cors-request-trace',
            handler: ({ context }) => {
              requests.push(context.transport.request.body)
              if (context.transport.request.headers['x-block-request']) context.reject(401, 'Authentication required')
              if (context.transport.request.headers['x-throw-request']) throw new Error('Request hook failed')
            }
          },
          'transport:response': {
            functionName: 'cors-response-trace',
            beforeFunction: 'cors-headers',
            handler: ({ context }) => {
              responses.push(context.transport.response.status)
              const vary = context.transport.request.headers['x-hook-vary']
              if (vary) context.transport.response.headers.vary = vary
            }
          }
        }
      })
      await api.customize({
        hooks: {
          'transport:response': {
            functionName: 'cors-response-failure',
            afterFunction: 'cors-headers',
            handler: () => {
              if (responseFailure) throw new Error('Response hook failed')
            }
          }
        }
      })
      if (connector === 'fastify') await app.ready()
    })
    beforeEach(async () => {
      await cleanTables(knex, ['connector_cities', 'connector_countries'])
      Object.assign(api.vars.cors, defaults)
      requests = []
      responses = []
      responseFailure = false
    })
    after(async () => {
      try { if (connector === 'fastify') await app?.close() } finally {
        try { await knex?.destroy() } finally { storageMode.clearRegistry(knex) }
      }
    })

    it('adds CORS headers to CRUD and relationship responses, including 204', async () => {
      const created = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Country' }))
      assertCors(created, 201)
      const id = created.body.data.id
      assertCors(await send('GET', `/api/countries/${id}/relationships/cities`), 200)
      assertCors(await send('DELETE', `/api/countries/${id}`), 204)
      assert.deepEqual(responses, [201, 200, 204])
    })

    const failures = [
      { name: 'malformed JSON', method: 'POST', body: '{', status: 400, requestHooks: 0 },
      { name: 'oversized JSON', method: 'POST', body: JSON.stringify({ data: { value: 'x'.repeat(2048) } }), status: 413, requestHooks: 0 },
      { name: 'unsupported content type', method: 'POST', body: '{', headers: { 'content-type': 'text/plain' }, status: 415, requestHooks: 0 },
      { name: 'unacceptable response type', method: 'GET', headers: { accept: 'text/html' }, status: 406, requestHooks: 1 },
      { name: 'explicit request rejection', method: 'GET', headers: { 'x-block-request': 'yes' }, status: 401, requestHooks: 1 },
      { name: 'thrown request hook', method: 'GET', headers: { 'x-throw-request': 'yes' }, status: 500, requestHooks: 1 },
      { name: 'resource validation', method: 'POST', body: createJsonApiDocument('countries', {}), status: 422, requestHooks: 1 },
      { name: 'missing resource record', method: 'GET', url: '/api/countries/999', status: 404, requestHooks: 1 },
      { name: 'unknown API route', method: 'GET', url: '/api/missing/nested', status: 404, requestHooks: 1 }
    ]
    for (const scenario of failures) {
      it(`preserves CORS and runs response hooks once for ${scenario.name}`, async () => {
        const result = await send(scenario.method, scenario.url, scenario.body, scenario.headers)
        assertCors(result, scenario.status)
        assert.equal(result.headers['content-type'], jsonapi)
        assert.ok(Array.isArray(result.body.errors))
        if (scenario.method === 'POST') {
          assert.ok(result.body.errors.every(error => error.meta.transactionOutcome === (scenario.name === 'resource validation' ? 'rolledBack' : 'none')))
        } else assert.ok(result.body.errors.every(error => !Object.hasOwn(error.meta || {}, 'transactionOutcome')))
        assert.deepEqual(responses, [scenario.status])
        assert.equal(requests.length, scenario.requestHooks)
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })
    }

    it('does not retry failing response hooks while mapping their error', async () => {
      responseFailure = true
      const result = await send('GET')
      assertCors(result, 500)
      assert.equal(result.headers['content-type'], jsonapi)
      assert.deepEqual(responses, [200])
      assert.equal(requests.length, 1)
    })

    for (const [name, headers, status] of [
      ['explicit rejection', { 'x-block-request': 'yes' }, 401],
      ['content negotiation', { accept: 'text/html' }, 406]
    ]) {
      it(`reports none for ${name} before accepting a write`, async () => {
        const result = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Unwritten' }), headers)
        assert.equal(result.status, status)
        assert.ok(result.body.errors.every(error => error.meta.transactionOutcome === 'none'))
        assert.deepEqual((await api.resources.countries.query()).data, [])
      })
    }

    it('keeps JSON:API errors and CORS when a response hook fails on an existing request error', async () => {
      responseFailure = true
      for (const body of ['{', createJsonApiDocument('countries', {})]) {
        const result = await send('POST', '/api/countries', body)
        assertCors(result, 500)
        assert.equal(result.headers['content-type'], jsonapi)
        assert.ok(Array.isArray(result.body.errors))
        assert.ok(result.body.errors.every(error => error.meta.transactionOutcome === (body === '{' ? 'none' : 'rolledBack')))
      }
      assert.deepEqual(responses, [400, 422])
    })

    it('retains committed outcome and the stored row when the response hook rejects a successful write', async () => {
      responseFailure = true
      const result = await send('POST', '/api/countries', createJsonApiDocument('countries', { name: 'Committed country' }))
      assertCors(result, 500)
      assert.ok(result.body.errors.every(error => error.meta.transactionOutcome === 'committed'))
      assert.deepEqual(responses, [201])
      responseFailure = false
      const stored = (await api.resources.countries.query({ format: 'jsonapi' })).data
      assert.equal(stored.length, 1)
      assert.equal(stored[0].attributes.name, 'Committed country')
    })

    it('keeps JSON:API error handling when an origin predicate fails on malformed input', async () => {
      let calls = 0
      api.vars.cors.origin = async () => { calls++; throw new Error('Origin lookup failed') }
      const result = await send('POST', '/api/countries', '{')
      assert.equal(result.status, 500)
      assert.equal(result.headers['content-type'], jsonapi)
      assert.ok(Array.isArray(result.body.errors))
      assert.equal(result.headers['access-control-allow-origin'], undefined)
      assert.equal(calls, 1)
      assert.deepEqual(responses, [400])
    })

    it('runs the CORS decision once and honors zero preflight cache age', async () => {
      let calls = 0
      api.vars.cors.origin = async origin => { calls++; return origin === allowedOrigin }
      const result = await send('OPTIONS', '/api/missing/nested', undefined, {
        'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type, authorization'
      })
      assertCors(result, 204)
      assert.equal(result.headers['access-control-max-age'], '0')
      assert.ok(result.headers['access-control-allow-methods'].includes('PATCH'))
      assert.ok(result.headers['access-control-allow-headers'].includes('Authorization'))
      assert.equal(result.body, undefined)
      assert.equal(calls, 1)
      assert.deepEqual(responses, [204])
    })

    it('returns a JSON:API denial for disallowed preflight and varies by Origin', async () => {
      const result = await send('OPTIONS', '/api/countries', undefined, { origin: deniedOrigin, 'access-control-request-method': 'POST' })
      assert.equal(result.status, 403)
      assert.equal(result.headers['access-control-allow-origin'], undefined)
      assert.equal(result.headers['access-control-allow-credentials'], undefined)
      assert.equal(result.headers['content-type'], jsonapi)
      assert.equal(result.body.errors[0].status, '403')
      assertVary(result)
    })

    it('preserves CORS on rejected preflight before its route executes', async () => {
      assertCors(await send('OPTIONS', '/api/countries', undefined, { 'x-block-request': 'yes', 'access-control-request-method': 'POST' }), 401)
      assert.deepEqual(responses, [401])
    })

    it('awaits false origin decisions for requests and preflights', async () => {
      let calls = 0
      api.vars.cors.origin = async () => { await Promise.resolve(); calls++; return false }
      for (const method of ['GET', 'OPTIONS']) {
        const result = await send(method)
        assert.equal(result.status, method === 'OPTIONS' ? 403 : 200)
        assert.equal(result.headers['access-control-allow-origin'], undefined)
        assert.equal(result.headers['access-control-allow-credentials'], undefined)
        assertVary(result)
      }
      assert.equal(calls, 2)
    })

    it('maps failed async origin decisions without retrying or allowing access', async () => {
      let calls = 0
      api.vars.cors.origin = async () => { calls++; throw new Error('Origin lookup failed') }
      for (const method of ['GET', 'OPTIONS']) {
        const result = await send(method)
        assert.equal(result.status, 500)
        assert.equal(result.headers['content-type'], jsonapi)
        assert.equal(result.headers['access-control-allow-origin'], undefined)
        assert.ok(Array.isArray(result.body.errors))
      }
      assert.equal(calls, 2)
    })

    it('awaits every candidate in origin arrays instead of accepting a Promise', async () => {
      api.vars.cors.origin = [async () => false, allowedOrigin]
      assertCors(await send('GET'), 200)
      const denied = await send('GET', undefined, undefined, { origin: deniedOrigin })
      assert.equal(denied.headers['access-control-allow-origin'], undefined)
    })

    it('matches stateful regular expressions consistently without mutating their position', async () => {
      const origin = /^https:\/\/app\.example\.com$/g
      origin.lastIndex = 3
      api.vars.cors.origin = origin
      for (let i = 0; i < 3; i++) assertCors(await send('GET'), 200)
      assert.equal(origin.lastIndex, 3)
    })

    it('varies reflected responses for denied and absent origins as well as allowed origins', async () => {
      for (const origin of [deniedOrigin, undefined]) {
        const result = await send('GET', undefined, undefined, { origin })
        assert.equal(result.status, 200)
        assert.equal(result.headers['access-control-allow-origin'], undefined)
        assert.equal(result.headers['access-control-allow-credentials'], undefined)
        assertVary(result)
      }
    })

    it('allows wildcard responses without credentials and supports disabled origins', async () => {
      api.vars.cors.origin = '*'
      api.vars.cors.credentials = false
      const wildcard = await send('GET')
      assert.equal(wildcard.headers['access-control-allow-origin'], '*')
      assert.equal(wildcard.headers['access-control-allow-credentials'], undefined)
      assertVary(wildcard, ['Accept'])
      api.vars.cors.origin = false
      assert.equal((await send('GET')).headers['access-control-allow-origin'], undefined)
    })

    it('merges Vary from host and response hooks without duplicates or overwritten fields', async () => {
      const result = await send('GET', undefined, undefined, { 'x-host-vary': 'Accept-Encoding, origin', 'x-hook-vary': 'X-Tenant, accept' })
      assert.equal(result.status, 200)
      assert.equal(result.headers['access-control-allow-origin'], allowedOrigin)
      assertVary(result, ['Accept-Encoding', 'Origin', 'X-Tenant', 'Accept'])
    })

    it('retains Vary wildcard from host or response hooks', async () => {
      for (const headers of [{ 'x-host-vary': '*' }, { 'x-hook-vary': '*' }]) {
        assertVary(await send('GET', undefined, undefined, headers), ['*'])
      }
    })

    it('combines a custom route response with host, CORS and response-hook Vary headers', async () => {
      const result = await send('GET', '/api/custom-response', undefined, { 'x-host-vary': 'Accept-Encoding', 'x-hook-vary': 'X-Tenant' })
      assert.equal(result.status, 200)
      assert.deepEqual(result.body, { meta: { custom: true } })
      assertVary(result, ['Accept-Encoding', 'X-Tenant', 'X-Custom', 'Origin', 'Accept'])
    })

    it('keeps malformed-URL handling at the actual framework boundary', async () => {
      const result = await send('GET', '/api/countries/%E0%A4%A')
      assert.equal(result.status, 400)
      if (connector === 'express') {
        assertCors(result, 400)
        assert.deepEqual(responses, [400])
      } else {
        assert.equal(result.headers['access-control-allow-origin'], undefined)
        assert.deepEqual(responses, [])
      }
    })

    it('leaves host routes outside the API prefix without connector CORS headers', async () => {
      const result = await send('GET', '/outside')
      assert.equal(result.status, 404)
      assert.equal(result.headers['access-control-allow-origin'], undefined)
      assert.deepEqual(requests, [])
      assert.deepEqual(responses, [])
    })

    if (connector === 'express') {
      it('creates connector context when a host supplied its own request context', async () => {
        assertCors(await send('GET', '/api/countries', undefined, { 'x-host-context': 'yes' }), 200)
        assert.deepEqual(responses, [200])
      })
    }
  })
}
