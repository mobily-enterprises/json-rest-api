import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { ExpressPlugin } from '../plugins/core/connectors/express-plugin.js';
import express from 'express';

describe('Express Debug', () => {
  test('should create simple route and respond', async () => {
    resetGlobalRegistryForTesting();
    
    const api = new Api({
      name: 'debug-api',
      version: '1.0.0'
    });
    
    await api.use(RestApiPlugin);
    await api.use(ExpressPlugin, {
      basePath: '/api'
    });
    
    // Add resource AFTER plugins are installed
    api.addResource('books', {
      schema: {
        title: { type: 'string', required: true }
      }
    });
    
    // Add simple helper that returns data
    api.customize({
      helpers: {
        dataQuery: async () => ({
          data: [
            { type: 'books', id: '1', attributes: { title: 'Test Book' } }
          ]
        })
      }
    });
    
    console.log('Routes created, router stack length:', api.http.express.router.stack.length);
    
    const app = express();
    app.use(api.http.express.router);
    
    const server = app.listen(0);
    const port = server.address().port;
    
    try {
      const response = await fetch(`http://localhost:${port}/api/books`);
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (response.status !== 200) {
        const text = await response.text();
        console.log('Response body:', text);
      } else {
        const data = await response.json();
        console.log('Response data:', data);
      }
      
      assert.strictEqual(response.status, 200);
    } finally {
      server.close();
    }
  });
});