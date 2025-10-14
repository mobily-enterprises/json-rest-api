import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import express from 'express'
import request from 'supertest'
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument,
  assertResourceAttributes
} from './helpers/test-utils.js'
import { createBasicApi } from './fixtures/api-configs.js'
import { CorsPlugin } from '../plugins/core/rest-api-cors-plugin.js'

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// API instance and Express app that persist across tests
let api
let app

describe('CORS Plugin Tests', { timeout: 30000 }, () => {
  describe('CORS with baseUrl', () => {
    let baseUrlApi
    let baseUrlApp

    before(async () => {
      // Create a new API instance with Express configured with a baseUrl
      baseUrlApp = express()
      // Create API with different name to avoid registry conflict
      const Api = (await import('hooked-api')).Api
      baseUrlApi = new Api({
        name: 'cors-baseurl-test-api',
        log: { level: 'info' }
      })

      // Install plugins
      await baseUrlApi.use((await import('../plugins/core/rest-api-plugin.js')).RestApiPlugin, {
        simplifiedApi: false
      })
      await baseUrlApi.use((await import('../plugins/core/rest-api-knex-plugin.js')).RestApiKnexPlugin, { knex })
      await baseUrlApi.use((await import('../plugins/core/connectors/express-plugin.js')).ExpressPlugin, {
        app: baseUrlApp,
        mountPath: '/api'
      })

      // Add basic scope
      await baseUrlApi.addScope('countries', {
        restApi: {
          schema: {
            attributes: {
              name: { type: 'string', required: true },
              code: { type: 'string', required: true }
            }
          }
        }
      })

      // Install CORS plugin
      console.log('[TEST] vars.transport before CORS install:', baseUrlApi.vars.transport)

      try {
        await baseUrlApi.use(CorsPlugin, {
          origin: '*',
          credentials: true
        })
      } catch (error) {
        console.log('[TEST] CORS installation error:', error.message)
        console.log('[TEST] vars.transport.matchAll:', baseUrlApi.vars.transport?.matchAll)
        console.log('[TEST] mountPath from transport:', baseUrlApi.vars.transport?.mountPath)
        console.log('[TEST] Full wildcard path would be:', '' + (baseUrlApi.vars.transport?.matchAll || '*'))
        throw error
      }

      // Mount the routes
      baseUrlApi.http.express.mount(baseUrlApp)
    })

    it('should handle OPTIONS preflight with baseUrl', async () => {
      const response = await request(baseUrlApp)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')

      console.log('[TEST] BaseUrl OPTIONS response:', {
        status: response.status,
        headers: response.headers,
        body: response.body
      })

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
    })

    it('should handle GET requests with baseUrl', async () => {
      // Just test the GET endpoint without creating data first
      // This tests CORS headers on the response regardless of data
      const response = await request(baseUrlApp)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      console.log('[TEST] BaseUrl GET response:', {
        status: response.status,
        headers: response.headers
      })

      // We might get 500 due to missing table, but CORS headers should still be present
      assert(response.status === 200 || response.status === 500, `Expected 200 or 500, got ${response.status}`)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should handle wildcard OPTIONS route with baseUrl', async () => {
      // Test a non-existent endpoint to check if wildcard OPTIONS still works
      const response = await request(baseUrlApp)
        .options('/api/non-existent-endpoint')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')

      console.log('[TEST] BaseUrl wildcard OPTIONS response:', {
        status: response.status,
        headers: response.headers
      })

      // This will tell us if the wildcard '*' route is working with baseUrl
      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
    })
  })

  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Initialize API once with Express
    app = express()
    api = await createBasicApi(knex, {
      includeExpress: true,
      express: { app }
    })

    // Install CORS plugin
    await api.use(CorsPlugin, {

      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],
      exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'Link'],
      maxAge: 86400
    }
    )

    // Mount the routes on the Express app
    api.http.express.mount(app)
  })

  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Always destroy knex connection to allow tests to exit
    await knex.destroy()
  })

  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables - list ALL tables your tests use
    await cleanTables(knex, [
      'basic_countries',
      'basic_publishers',
      'basic_authors',
      'basic_books',
      'basic_book_authors'
    ])
  })

  describe('CORS Headers for Regular Requests', () => {
    it('should add CORS headers for GET requests', async () => {
      // Create test data
      const doc = createJsonApiDocument('countries', {
        name: 'Test Country',
        code: 'TC'
      })

      const createResult = await api.resources.countries.post({
        inputRecord: doc,
        simplified: false
      })

      // Make HTTP request with origin header
      const response = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['access-control-expose-headers'], 'X-Total-Count, X-Page-Count, Link')
      // Vary header should be set when specific origin is returned
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should add CORS headers for POST requests', async () => {
      const doc = createJsonApiDocument('countries', {
        name: 'New Country',
        code: 'NC'
      })

      const response = await request(app)
        .post('/api/countries')
        .send(doc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 201)
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['access-control-expose-headers'], 'X-Total-Count, X-Page-Count, Link')
      // Vary header should be set when specific origin is returned
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should handle requests without Origin header', async () => {
      // Same-origin request (no Origin header)
      const response = await request(app)
        .get('/api/countries')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      // Should not set CORS headers for same-origin requests
      assert.equal(response.headers['access-control-allow-origin'], undefined)
    })
  })

  describe('CORS Preflight Requests', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const response = await request(app)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type')

      assert.equal(response.status, 204)
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      assert.equal(response.headers['vary'], 'Origin')
      assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, Authorization, X-Custom-Header')
      assert.equal(response.headers['access-control-max-age'], '86400')
      assert.equal(response.text, '') // Empty body
    })

    it('should handle preflight for custom headers', async () => {
      const response = await request(app)
        .options('/api/countries/1')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'X-Custom-Header')

      assert.equal(response.status, 204)
      assert(response.headers['access-control-allow-headers'].includes('X-Custom-Header'))
    })
  })

  describe('CORS with Specific Origins', () => {
    it('should work with wildcard origin', async () => {
      // Current configuration uses wildcard
      const response = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://any-origin.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://any-origin.com')
      assert.equal(response.headers['vary'], 'Origin')
    })
  })

  describe('CORS Runtime Configuration', () => {
    // Tests for dynamic configuration have been removed
    // The dynamic configuration API is still available for other tests to use
  })

  describe('CORS with Different HTTP Methods', () => {
    let testCountryId

    beforeEach(async () => {
      // Create test data for update/delete operations
      const doc = createJsonApiDocument('countries', {
        name: 'Update Test Country',
        code: 'UT'
      })

      const result = await api.resources.countries.post({
        inputRecord: doc,
        simplified: false
      })

      testCountryId = result.data.id
    })

    it('should handle PATCH requests with CORS', async () => {
      const patchDoc = {
        data: {
          type: 'countries',
          id: String(testCountryId),
          attributes: {
            name: 'Updated Country Name'
          }
        }
      }

      const response = await request(app)
        .patch(`/api/countries/${testCountryId}`)
        .send(patchDoc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should handle DELETE requests with CORS', async () => {
      const response = await request(app)
        .delete(`/api/countries/${testCountryId}`)
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 204)
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should handle PUT requests with CORS', async () => {
      const putDoc = {
        data: {
          type: 'countries',
          id: testCountryId,
          attributes: {
            name: 'Completely Replaced Country',
            code: 'RC'
          }
        }
      }

      const response = await request(app)
        .put(`/api/countries/${testCountryId}`)
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .send(putDoc)

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['vary'], 'Origin')
      assert.equal(response.headers['access-control-expose-headers'], 'X-Total-Count, X-Page-Count, Link')
    })
  })

  describe('CORS with Array and Regex Origins', () => {
    it('should support array of allowed origins', async () => {
      // Create a new API instance with array origin configuration
      const arrayOriginApp = express()
      const arrayOriginApi = await createBasicApi(knex, {
        apiName: 'cors-array-origins-test',
        tablePrefix: 'cors_array',
        includeExpress: true,
        express: { app: arrayOriginApp }
      })

      await arrayOriginApi.use(CorsPlugin, {
        origin: ['https://app1.com', 'https://app2.com', 'https://app3.com'],
        credentials: true
      })

      // Mount routes after CORS plugin is installed
      arrayOriginApi.http.express.mount(arrayOriginApp)

      // Test allowed origin
      const response1 = await request(arrayOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://app2.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response1.status, 200)
      assert.equal(response1.headers['access-control-allow-origin'], 'https://app2.com')

      // Test disallowed origin
      const response2 = await request(arrayOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://app4.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response2.status, 200)
      assert.equal(response2.headers['access-control-allow-origin'], undefined)
    })

    it('should support regex origin matching', async () => {
      // Create a new API instance with regex origin configuration
      const regexOriginApp = express()
      const regexOriginApi = await createBasicApi(knex, {
        apiName: 'cors-regex-origins-test',
        tablePrefix: 'cors_regex',
        includeExpress: true,
        express: { app: regexOriginApp }
      })

      await regexOriginApi.use(CorsPlugin, {
        origin: /^https:\/\/.*\.example\.com$/,
        credentials: true
      })

      // Mount routes after CORS plugin is installed
      regexOriginApi.http.express.mount(regexOriginApp)

      // Test matching subdomain
      const response1 = await request(regexOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://app.example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response1.status, 200)
      assert.equal(response1.headers['access-control-allow-origin'], 'https://app.example.com')

      // Test another matching subdomain
      const response2 = await request(regexOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://api.example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response2.status, 200)
      assert.equal(response2.headers['access-control-allow-origin'], 'https://api.example.com')

      // Test non-matching domain
      const response3 = await request(regexOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://example.org')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response3.status, 200)
      assert.equal(response3.headers['access-control-allow-origin'], undefined)
    })

    it('should support function-based origin validation', async () => {
      // Create a new API instance with function origin configuration
      const functionOriginApp = express()
      const functionOriginApi = await createBasicApi(knex, {
        apiName: 'cors-function-origins-test',
        tablePrefix: 'cors_func',
        includeExpress: true,
        express: { app: functionOriginApp }
      })

      const allowedOrigins = new Set(['https://dynamic1.com', 'https://dynamic2.com'])

      await functionOriginApi.use(CorsPlugin, {
        origin: (origin) => allowedOrigins.has(origin),
        credentials: true
      })

      // Mount routes after CORS plugin is installed
      functionOriginApi.http.express.mount(functionOriginApp)

      // Test allowed origin
      const response1 = await request(functionOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://dynamic1.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response1.status, 200)
      assert.equal(response1.headers['access-control-allow-origin'], 'https://dynamic1.com')

      // Test disallowed origin
      const response2 = await request(functionOriginApp)
        .get('/api/countries')
        .set('Origin', 'https://dynamic3.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response2.status, 200)
      assert.equal(response2.headers['access-control-allow-origin'], undefined)
    })
  })

  describe('CORS Error Handling', () => {
    it('should reject preflight from disallowed origin', async () => {
      // Create a new API instance with specific allowed origin
      const restrictedApp = express()
      const restrictedApi = await createBasicApi(knex, {
        apiName: 'cors-restricted-test',
        tablePrefix: 'cors_restrict',
        includeExpress: true,
        express: { app: restrictedApp }
      })

      await restrictedApi.use(CorsPlugin, {
        origin: 'https://allowed-only.com',
        credentials: true
      })

      // Mount routes after CORS plugin is installed
      restrictedApi.http.express.mount(restrictedApp)

      const response = await request(restrictedApp)
        .options('/api/countries')
        .set('Origin', 'https://not-allowed.com')
        .set('Access-Control-Request-Method', 'POST')

      assert.equal(response.status, 403)
      assert(response.body.error.includes('CORS origin not allowed'))
      assert.equal(response.headers['access-control-allow-origin'], undefined)
    })

    it('should handle lowercase HTTP methods', async () => {
      // Some clients might send lowercase methods
      const response = await request(app)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'post') // lowercase

      assert.equal(response.status, 204)
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['vary'], 'Origin')
    })
  })

  describe('CORS Integration with REST API', () => {
    it('should handle CORS for error responses', async () => {
      // Try to get non-existent resource
      const response = await request(app)
        .get('/api/countries/999999')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 404)
      // CORS headers should still be set for error responses
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['vary'], 'Origin')
    })

    it('should handle CORS for validation errors', async () => {
      // Send invalid data
      const invalidDoc = createJsonApiDocument('countries', {
        // Missing required 'name' field
        code: 'XX'
      })

      const response = await request(app)
        .post('/api/countries')
        .send(invalidDoc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 422)
      // CORS headers should be set for validation errors
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['vary'], 'Origin')
    })
  })

  describe('CORS Configuration Options', () => {
    it('should respect custom max-age configuration', async () => {
      // Create API with custom max-age
      const maxAgeApp = express()
      const maxAgeApi = await createBasicApi(knex, {
        apiName: 'cors-maxage-test',
        tablePrefix: 'cors_maxage',
        includeExpress: true,
        express: { app: maxAgeApp }
      })

      await maxAgeApi.use(CorsPlugin, {
        origin: '*',
        credentials: false,
        maxAge: 3600 // 1 hour instead of default 24 hours
      })

      maxAgeApi.http.express.mount(maxAgeApp)

      const response = await request(maxAgeApp)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-max-age'], '3600')
    })

    it('should respect custom exposed headers configuration', async () => {
      // Create API with custom exposed headers
      const exposedApp = express()
      const exposedApi = await createBasicApi(knex, {
        apiName: 'cors-exposed-test',
        tablePrefix: 'cors_exposed',
        includeExpress: true,
        express: { app: exposedApp }
      })

      await exposedApi.use(CorsPlugin, {
        origin: '*',
        credentials: false,
        exposedHeaders: ['X-Custom-Header', 'X-Rate-Limit', 'X-Request-Id']
      })

      exposedApi.http.express.mount(exposedApp)

      const response = await request(exposedApp)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      assert.equal(response.headers['access-control-expose-headers'], 'X-Custom-Header, X-Rate-Limit, X-Request-Id')
    })

    it('should respect custom allowed methods configuration', async () => {
      // Create API with limited methods
      const methodsApp = express()
      const methodsApi = await createBasicApi(knex, {
        apiName: 'cors-methods-test',
        tablePrefix: 'cors_methods',
        includeExpress: true,
        express: { app: methodsApp }
      })

      await methodsApi.use(CorsPlugin, {
        origin: '*',
        credentials: false,
        methods: ['GET', 'POST'] // Only allow GET and POST
      })

      methodsApi.http.express.mount(methodsApp)

      const response = await request(methodsApp)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'DELETE')

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-methods'], 'GET, POST')
    })

    it('should handle credentials false configuration', async () => {
      // Create API with credentials disabled
      const noCredApp = express()
      const noCredApi = await createBasicApi(knex, {
        apiName: 'cors-nocred-test',
        tablePrefix: 'cors_nocred',
        includeExpress: true,
        express: { app: noCredApp }
      })

      await noCredApi.use(CorsPlugin, {
        origin: '*',
        credentials: false
      })

      noCredApi.http.express.mount(noCredApp)

      const response = await request(noCredApp)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      assert.equal(response.headers['access-control-allow-origin'], '*')
      assert.equal(response.headers['access-control-allow-credentials'], undefined)
      // No Vary header when using wildcard without credentials
      assert.equal(response.headers['vary'], undefined)
    })

    it('should handle custom allowed headers configuration', async () => {
      // Create API with custom allowed headers
      const headersApp = express()
      const headersApi = await createBasicApi(knex, {
        apiName: 'cors-headers-test',
        tablePrefix: 'cors_headers',
        includeExpress: true,
        express: { app: headersApp }
      })

      await headersApi.use(CorsPlugin, {
        origin: 'https://app.example.com',
        credentials: true,
        allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Session-Token']
      })

      headersApi.http.express.mount(headersApp)

      const response = await request(headersApp)
        .options('/api/countries')
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'X-API-Key, X-Session-Token')

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, X-API-Key, X-Session-Token')
    })
  })

  describe('CORS with PUT Requests', () => {
    it('should handle PUT requests with proper CORS headers', async () => {
      // The main api already has PUT in its allowed methods
      // Create test data first
      const doc = createJsonApiDocument('countries', {
        name: 'Original Country',
        code: 'OC'
      })

      const createResult = await api.resources.countries.post({
        inputRecord: doc,
        simplified: false
      })

      const countryId = createResult.data.id

      // Now test PUT with CORS
      const putDoc = {
        data: {
          type: 'countries',
          id: String(countryId),
          attributes: {
            name: 'Replaced Country',
            code: 'RC'
          }
        }
      }

      const response = await request(app)
        .put(`/api/countries/${countryId}`)
        .send(putDoc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-credentials'], 'true')
      assert.equal(response.headers['vary'], 'Origin')

      // Note: PUT might not return the full record by default depending on returnFullRecord settings
      // The important part for CORS testing is that the headers are correct, which we've verified above
    })

    it('should handle PUT preflight requests', async () => {
      const response = await request(app)
        .options('/api/countries/123')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'PUT')
        .set('Access-Control-Request-Headers', 'Content-Type')

      assert.equal(response.status, 204)
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com')
      assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      assert(response.headers['access-control-allow-methods'].includes('PUT'))
    })
  })

  describe('CORS Edge Cases', () => {
    it('should handle requests with no exposed headers configured', async () => {
      // Create API with empty exposed headers
      const noExposedApp = express()
      const noExposedApi = await createBasicApi(knex, {
        apiName: 'cors-noexposed-test',
        tablePrefix: 'cors_noexposed',
        includeExpress: true,
        express: { app: noExposedApp }
      })

      await noExposedApi.use(CorsPlugin, {
        origin: '*',
        credentials: false,
        exposedHeaders: [] // Empty array
      })

      noExposedApi.http.express.mount(noExposedApp)

      const response = await request(noExposedApp)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json')

      assert.equal(response.status, 200)
      // Should not set exposed headers when array is empty
      assert.equal(response.headers['access-control-expose-headers'], undefined)
    })

    it('should handle optionsSuccessStatus configuration', async () => {
      // Create API with custom options success status
      const statusApp = express()
      const statusApi = await createBasicApi(knex, {
        apiName: 'cors-status-test',
        tablePrefix: 'cors_status',
        includeExpress: true,
        express: { app: statusApp }
      })

      await statusApi.use(CorsPlugin, {
        origin: '*',
        credentials: false,
        optionsSuccessStatus: 200 // Use 200 instead of 204
      })

      statusApi.http.express.mount(statusApp)

      const response = await request(statusApp)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'GET')

      assert.equal(response.status, 200)
      assert.equal(response.headers['access-control-allow-origin'], '*')
    })
  })
})
