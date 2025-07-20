import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import express from 'express';
import request from 'supertest';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument,
  assertResourceAttributes
} from './helpers/test-utils.js';
import { createBasicApi } from './fixtures/api-configs.js';
import { CorsPlugin } from '../plugins/core/rest-api-cors-plugin.js';

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance and Express app that persist across tests
let api;
let app;

describe('CORS Plugin Tests', { timeout: 30000 }, () => {
  describe('CORS with baseUrl', () => {
    let baseUrlApi;
    let baseUrlApp;
    
    before(async () => {
      // Create a new API instance with Express configured with a baseUrl
      baseUrlApp = express();
      // Create API with different name to avoid registry conflict
      const Api = (await import('hooked-api')).Api;
      baseUrlApi = new Api({ 
        name: 'cors-baseurl-test-api',
        version: '1.0.0',
        log: { level: 'info' }
      });
      
      // Install plugins
      await baseUrlApi.use((await import('../plugins/core/rest-api-plugin.js')).RestApiPlugin, {
        simplifiedApi: false
      });
      await baseUrlApi.use((await import('../plugins/core/rest-api-knex-plugin.js')).RestApiKnexPlugin, { knex });
      await baseUrlApi.use((await import('../plugins/core/connectors/express-plugin.js')).ExpressPlugin, {
        app: baseUrlApp,
        basePath: '/v1'  // Set a base path
      });
      
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
      });
      
      // Install CORS plugin
      console.log('[TEST] vars.transport before CORS install:', baseUrlApi.vars.transport);
      
      try {
        await baseUrlApi.use(CorsPlugin, {
          origin: '*',
          credentials: true
        });
      } catch (error) {
        console.log('[TEST] CORS installation error:', error.message);
        console.log('[TEST] vars.transport.matchAll:', baseUrlApi.vars.transport?.matchAll);
        console.log('[TEST] basePath from Express:', '/v1');
        console.log('[TEST] Full wildcard path would be:', '/v1' + (baseUrlApi.vars.transport?.matchAll || '*'));
        throw error;
      }
      
      // Mount the routes
      baseUrlApi.http.express.mount(baseUrlApp);
    });
    
    it('should handle OPTIONS preflight with baseUrl', async () => {
      const response = await request(baseUrlApp)
        .options('/v1/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');
      
      console.log('[TEST] BaseUrl OPTIONS response:', {
        status: response.status,
        headers: response.headers,
        body: response.body
      });
      
      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
    });
    
    it('should handle GET requests with baseUrl', async () => {
      // Just test the GET endpoint without creating data first
      // This tests CORS headers on the response regardless of data
      const response = await request(baseUrlApp)
        .get('/v1/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json');
      
      console.log('[TEST] BaseUrl GET response:', {
        status: response.status,
        headers: response.headers
      });
      
      // We might get 500 due to missing table, but CORS headers should still be present
      assert(response.status === 200 || response.status === 500, `Expected 200 or 500, got ${response.status}`);
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.equal(response.headers['vary'], 'Origin');
    });
    
    it('should handle wildcard OPTIONS route with baseUrl', async () => {
      // Test a non-existent endpoint to check if wildcard OPTIONS still works
      const response = await request(baseUrlApp)
        .options('/v1/api/non-existent-endpoint')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST');
      
      console.log('[TEST] BaseUrl wildcard OPTIONS response:', {
        status: response.status,
        headers: response.headers
      });
      
      // This will tell us if the wildcard '*' route is working with baseUrl
      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
    });
  });


  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Initialize API once with Express
    app = express();
    api = await createBasicApi(knex, {
      includeExpress: true,
      express: { app }
    });
    
    // Install CORS plugin
    await api.use(CorsPlugin, {
      
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],
        exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'Link'],
        maxAge: 86400
      }
    );
    
    // Mount the routes on the Express app
    api.http.express.mount(app);
  });
  
  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Always destroy knex connection to allow tests to exit
    await knex.destroy();
  });
  
  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables - list ALL tables your tests use
    await cleanTables(knex, [
      'basic_countries',
      'basic_publishers',
      'basic_authors',
      'basic_books',
      'basic_book_authors'
    ]);
  });

  describe('CORS Headers for Regular Requests', () => {
     it('should add CORS headers for GET requests', async () => {
      // Create test data
      const doc = createJsonApiDocument('countries', {
        name: 'Test Country',
        code: 'TC'
      });
      
      const createResult = await api.resources.countries.post({
        inputRecord: doc,
        simplified: false
      });
      
      // Make HTTP request with origin header
      const response = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 200);
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.equal(response.headers['access-control-expose-headers'], 'X-Total-Count, X-Page-Count, Link');
      // Vary header should be set when specific origin is returned
      assert.equal(response.headers['vary'], 'Origin');
    });
    
     it('should add CORS headers for POST requests', async () => {
      const doc = createJsonApiDocument('countries', {
        name: 'New Country',
        code: 'NC'
      });
      
      const response = await request(app)
        .post('/api/countries')
        .send(doc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 201);
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.equal(response.headers['access-control-expose-headers'], 'X-Total-Count, X-Page-Count, Link');
      // Vary header should be set when specific origin is returned
      assert.equal(response.headers['vary'], 'Origin');
    });
    
     it('should handle requests without Origin header', async () => {
      // Same-origin request (no Origin header)
      const response = await request(app)
        .get('/api/countries')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 200);
      // Should not set CORS headers for same-origin requests
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    });
  });

  describe('CORS Preflight Requests', () => {
     it('should handle OPTIONS preflight requests', async () => {
      const response = await request(app)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type');
      
      assert.equal(response.status, 204);
      // When credentials are true, the origin must be specific, not wildcard
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.equal(response.headers['access-control-allow-methods'], 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      assert.equal(response.headers['vary'], 'Origin');
      assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, Authorization, X-Custom-Header');
      assert.equal(response.headers['access-control-max-age'], '86400');
      assert.equal(response.text, ''); // Empty body
    });
    
     it('should handle preflight for custom headers', async () => {
      const response = await request(app)
        .options('/api/countries/1')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'X-Custom-Header');
      
      assert.equal(response.status, 204);
      assert(response.headers['access-control-allow-headers'].includes('X-Custom-Header'));
    });
  });

  describe('CORS with Specific Origins', () => {
     it('should work with wildcard origin', async () => {
      // Current configuration uses wildcard
      const response = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://any-origin.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 200);
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://any-origin.com');
      assert.equal(response.headers['vary'], 'Origin');
    });
  });

  describe('CORS Runtime Configuration', () => {
    // Tests for dynamic configuration have been removed
    // The dynamic configuration API is still available for other tests to use
  });

  describe('CORS with Different HTTP Methods', () => {
    let testCountryId;
    
    beforeEach(async () => {
      // Create test data for update/delete operations
      const doc = createJsonApiDocument('countries', {
        name: 'Update Test Country',
        code: 'UT'
      });
      
      const result = await api.resources.countries.post({
        inputRecord: doc,
        simplified: false
      });
      
      testCountryId = result.data.id;
    });
    
     it('should handle PATCH requests with CORS', async () => {
      const patchDoc = {
        data: {
          type: 'countries',
          id: String(testCountryId),
          attributes: {
            name: 'Updated Country Name'
          }
        }
      };
      
      const response = await request(app)
        .patch(`/api/countries/${testCountryId}`)
        .send(patchDoc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 200);
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['vary'], 'Origin');
    });
    
     it('should handle DELETE requests with CORS', async () => {
      const response = await request(app)
        .delete(`/api/countries/${testCountryId}`)
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 204);
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['vary'], 'Origin');
    });
  });

  describe('CORS with Array and Regex Origins', () => {
    let originalOrigin;
    
    before(async () => {
      // Save current config
      originalOrigin = api.cors.getConfig().origin;
    });
    
    after(async () => {
      // Restore original config
      api.cors.updateOrigin(originalOrigin);
    });
    
     it('should support array of allowed origins', async () => {
      api.cors.updateOrigin(['https://app1.com', 'https://app2.com', 'https://app3.com']);
      
      // Test allowed origin
      const response1 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://app2.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response1.status, 200);
      assert.equal(response1.headers['access-control-allow-origin'], 'https://app2.com');
      
      // Test disallowed origin
      const response2 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://app4.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response2.status, 200);
      assert.equal(response2.headers['access-control-allow-origin'], undefined);
    });
    
     it('should support regex origin matching', async () => {
      api.cors.updateOrigin(/^https:\/\/.*\.example\.com$/);
      
      // Test matching subdomain
      const response1 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://app.example.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response1.status, 200);
      assert.equal(response1.headers['access-control-allow-origin'], 'https://app.example.com');
      
      // Test another matching subdomain
      const response2 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://api.example.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response2.status, 200);
      assert.equal(response2.headers['access-control-allow-origin'], 'https://api.example.com');
      
      // Test non-matching domain
      const response3 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://example.org')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response3.status, 200);
      assert.equal(response3.headers['access-control-allow-origin'], undefined);
    });
    
     it('should support function-based origin validation', async () => {
      const allowedOrigins = new Set(['https://dynamic1.com', 'https://dynamic2.com']);
      api.cors.updateOrigin((origin) => allowedOrigins.has(origin));
      
      // Test allowed origin
      const response1 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://dynamic1.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response1.status, 200);
      assert.equal(response1.headers['access-control-allow-origin'], 'https://dynamic1.com');
      
      // Test disallowed origin
      const response2 = await request(app)
        .get('/api/countries')
        .set('Origin', 'https://notallowed.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response2.status, 200);
      assert.equal(response2.headers['access-control-allow-origin'], undefined);
    });
  });

  describe('CORS Error Handling', () => {
     it('should reject preflight from disallowed origin', async () => {
      // Temporarily set specific origin
      api.cors.updateOrigin('https://allowed-only.com');
      
      const response = await request(app)
        .options('/api/countries')
        .set('Origin', 'https://not-allowed.com')
        .set('Access-Control-Request-Method', 'POST');
      
      assert.equal(response.status, 403);
      assert(response.body.error.includes('CORS origin not allowed'));
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      
      // Reset to wildcard
      api.cors.updateOrigin('*');
    });
    
     it('should handle lowercase HTTP methods', async () => {
      // Some clients might send lowercase methods
      const response = await request(app)
        .options('/api/countries')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'post'); // lowercase
      
      assert.equal(response.status, 204);
      // When credentials are true and origin is sent, specific origin is returned
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['vary'], 'Origin');
    });
  });

  describe('CORS Integration with REST API', () => {
     it('should handle CORS for error responses', async () => {
      // Try to get non-existent resource
      const response = await request(app)
        .get('/api/countries/999999')
        .set('Origin', 'https://example.com')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 404);
      // CORS headers should still be set for error responses
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['access-control-allow-credentials'], 'true');
      assert.equal(response.headers['vary'], 'Origin');
    });
    
     it('should handle CORS for validation errors', async () => {
      // Send invalid data
      const invalidDoc = createJsonApiDocument('countries', {
        // Missing required 'name' field
        code: 'XX'
      });
      
      const response = await request(app)
        .post('/api/countries')
        .send(invalidDoc)
        .set('Origin', 'https://example.com')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Accept', 'application/vnd.api+json');
      
      assert.equal(response.status, 422);
      // CORS headers should be set for validation errors
      assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
      assert.equal(response.headers['vary'], 'Origin');
    });
  });
});