import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin, ValidationPlugin, BadRequestError } from '../index.js';
import { HTTPPlugin } from '../plugins/http.js';
import express from 'express';
import fetch from 'node-fetch';

const serverHosts = [];

describe('JSON:API Compliance Features', () => {
  
  test('should add JSON:API version declaration when configured', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      jsonApiVersion: '1.0' 
    });
    
    // Add test resource
    api.addResource('items', new Schema({
      name: { type: 'string', required: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create an item
    const createRes = await fetch(`http://localhost:${port}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'Test Item'
          }
        }
      })
    });
    
    const created = await createRes.json();
    
    // Check for JSON:API version
    assert.equal(created.jsonapi?.version, '1.0', 'Should have JSON:API version in response');
    
    // Get the item
    const getRes = await fetch(`http://localhost:${port}/api/items/${created.data.id}`);
    const retrieved = await getRes.json();
    
    assert.equal(retrieved.jsonapi?.version, '1.0', 'Should have JSON:API version in GET response');
  });
  
  test('should format meta fields in JSON:API style when configured', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      jsonApiMetaFormat: true 
    });
    
    // Add test resource
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number' }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create some products
    for (let i = 1; i <= 15; i++) {
      await fetch(`http://localhost:${port}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            attributes: {
              name: `Product ${i}`,
              price: i * 10
            }
          }
        })
      });
    }
    
    // Query with pagination
    const res = await fetch(`http://localhost:${port}/api/products?page[size]=5&page[number]=2`);
    const result = await res.json();
    
    // Check meta format
    assert.ok(result.meta, 'Should have meta');
    assert.ok(result.meta.page, 'Should have meta.page');
    assert.equal(result.meta.page.total, 15, 'Should have correct total');
    assert.equal(result.meta.page.size, 5, 'Should have correct page size');
    assert.equal(result.meta.page.number, 2, 'Should have correct page number');
    assert.equal(result.meta.page.totalPages, 3, 'Should have correct total pages');
  });
  
  test('should format errors with source field', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { app });
    
    // Add test resource with validation
    api.addResource('users', new Schema({
      name: { type: 'string', required: true, min: 3 },
      email: { type: 'string', required: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Try to create invalid user
    const res = await fetch(`http://localhost:${port}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'AB', // Too short
            email: 'test@example.com'
          }
        }
      })
    });
    
    assert.equal(res.status, 422, 'Should return 422 for validation error');
    const errorResponse = await res.json();
    
    // Check error format
    assert.ok(errorResponse.errors, 'Should have errors array');
    assert.ok(errorResponse.errors.length > 0, 'Should have at least one error');
    
    const error = errorResponse.errors[0];
    assert.equal(error.status, '422', 'Error should have status 422');
    assert.ok(error.source, 'Error should have source field');
    assert.equal(error.source.pointer, '/data/attributes/name', 'Error should have correct source pointer');
  });
  
  test('should enforce strict content-type when configured', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      strictJsonApi: true 
    });
    
    // Add test resource
    api.addResource('articles', new Schema({
      title: { type: 'string', required: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Try with wrong content type
    const res1 = await fetch(`http://localhost:${port}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // Wrong!
      body: JSON.stringify({
        data: {
          attributes: {
            title: 'Test Article'
          }
        }
      })
    });
    
    assert.equal(res1.status, 415, 'Should return 415 for wrong content type');
    
    // Try with correct content type
    const res2 = await fetch(`http://localhost:${port}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' }, // Correct!
      body: JSON.stringify({
        data: {
          attributes: {
            title: 'Test Article'
          }
        }
      })
    });
    
    assert.equal(res2.status, 201, 'Should accept correct content type');
  });
  
  test('should reject unknown query parameters in strict mode', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      strictJsonApi: true 
    });
    
    // Add test resource
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      status: { type: 'string', searchable: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Try with unknown parameter
    const res1 = await fetch(`http://localhost:${port}/api/posts?unknownParam=value`);
    assert.equal(res1.status, 400, 'Should reject unknown parameter');
    
    const error1 = await res1.json();
    assert.ok(error1.errors[0].detail.includes('Unknown query parameter'), 'Should have correct error message');
    assert.equal(error1.errors[0].source?.parameter, 'unknownParam', 'Should identify the unknown parameter');
    
    // Try with valid parameters
    const res2 = await fetch(`http://localhost:${port}/api/posts?filter[status]=published&sort=-title`);
    assert.equal(res2.status, 200, 'Should accept valid parameters');
  });
  
  test('should support sorting on relationship fields', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    // Create schemas
    api.addResource('categories', new Schema({
      name: { type: 'string', required: true }
    }));
    
    api.addResource('articles', new Schema({
      title: { type: 'string', required: true },
      categoryId: {
        type: 'id',
        refs: {
          resource: 'categories'
        }
      }
    }), {
      searchableFields: {
        'category.name': 'categoryId.name'  // Map for sorting
      }
    });
    
    // Create test data
    const cat1 = await api.resources.categories.create({ name: 'Zebra' });
    const cat2 = await api.resources.categories.create({ name: 'Alpha' });
    const cat3 = await api.resources.categories.create({ name: 'Beta' });
    
    await api.resources.articles.create({ title: 'Article 1', categoryId: cat1.data.id });
    await api.resources.articles.create({ title: 'Article 2', categoryId: cat2.data.id });
    await api.resources.articles.create({ title: 'Article 3', categoryId: cat3.data.id });
    
    // Test sorting by category name
    const result = await api.query({ 
      sort: [{ field: 'category.name', direction: 'ASC' }] 
    }, { type: 'articles' });
    
    // Check order - should be sorted by category name
    assert.equal(result.data.length, 3, 'Should have all articles');
    assert.equal(result.data[0].attributes.title, 'Article 2', 'First should be from Alpha category');
    assert.equal(result.data[1].attributes.title, 'Article 3', 'Second should be from Beta category');
    assert.equal(result.data[2].attributes.title, 'Article 1', 'Third should be from Zebra category');
  });
  
  test('should handle wrapResponse for all response types', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      jsonApiVersion: '1.0',
      jsonApiMetaFormat: true
    });
    
    // Add test resource
    api.addResource('resources', new Schema({
      name: { type: 'string', required: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Test batch operations
    const batchRes = await fetch(`http://localhost:${port}/api/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            method: 'insert',
            type: 'resources',
            data: { name: 'Resource 1' }
          },
          {
            method: 'insert',
            type: 'resources',
            data: { name: 'Resource 2' }
          }
        ]
      })
    });
    
    const batchResult = await batchRes.json();
    assert.equal(batchResult.jsonapi?.version, '1.0', 'Batch response should have JSON:API version');
  });
  
  // Clean up after all tests
  test.after(async () => {
    // Clean up all servers
    for (const server of serverHosts) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});