/**
 * Example: Return Full Record Configuration
 * 
 * This example demonstrates the new returnFullRecord feature that allows
 * you to control whether POST, PUT, and PATCH operations return the full
 * record with relationships or just the minimal response.
 */

import { Api } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { ExpressPlugin } from '../plugins/core/connectors/express-plugin.js';
import express from 'express';

// Create API instance
const api = new Api({
  name: 'example-api',
  version: '1.0.0',
  log: { level: 'info' }
});

// Configure REST API with custom returnFullRecord settings
await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: false,   // Don't return full record for POST by default
    put: false,    // Don't return full record for PUT by default
    patch: false,  // Don't return full record for PATCH by default
    allowRemoteOverride: true  // Allow clients to override via query param
  }
});

// Add Express plugin
await api.use(ExpressPlugin, {
  basePath: '/api'
});

// Define resources
api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    body: { type: 'string' },
    status: { type: 'string', default: 'draft' }
  },
  returnFullRecord: {
    post: true,  // Override: always return full record for articles POST
    allowRemoteOverride: false  // Don't allow client override for articles
  }
});

api.addResource('comments', {
  schema: {
    content: { type: 'string', required: true },
    author: { type: 'string' },
    articleId: { type: 'string' }
  }
  // Uses API defaults: no full record, but allows client override
});

// Mock data storage
const dataStore = {
  articles: new Map(),
  comments: new Map()
};

// Override data methods with mock implementation
api.on('scope:articles:ready', ({ scope }) => {
  const mockDataMethods = createMockDataMethods('articles', dataStore);
  Object.assign(api.helpers, mockDataMethods);
});

api.on('scope:comments:ready', ({ scope }) => {
  const mockDataMethods = createMockDataMethods('comments', dataStore);
  Object.assign(api.helpers, mockDataMethods);
});

// Helper to create mock data methods
function createMockDataMethods(resourceType, store) {
  const generateId = () => Math.random().toString(36).substr(2, 9);
  
  return {
    [`data${resourceType.charAt(0).toUpperCase()}${resourceType.slice(1)}Get`]: async ({ id }) => {
      const record = store[resourceType].get(id);
      if (!record) return null;
      return { data: record };
    },
    
    [`data${resourceType.charAt(0).toUpperCase()}${resourceType.slice(1)}Post`]: async ({ inputRecord }) => {
      const id = generateId();
      const record = {
        type: resourceType,
        id,
        attributes: inputRecord.data.attributes
      };
      store[resourceType].set(id, record);
      return { data: record };
    },
    
    [`data${resourceType.charAt(0).toUpperCase()}${resourceType.slice(1)}Put`]: async ({ id, inputRecord }) => {
      const record = {
        type: resourceType,
        id,
        attributes: inputRecord.data.attributes
      };
      store[resourceType].set(id, record);
      return { data: record };
    },
    
    [`data${resourceType.charAt(0).toUpperCase()}${resourceType.slice(1)}Patch`]: async ({ id, inputRecord }) => {
      const existing = store[resourceType].get(id);
      if (!existing) return null;
      const record = {
        ...existing,
        attributes: { ...existing.attributes, ...inputRecord.data.attributes }
      };
      store[resourceType].set(id, record);
      return { data: record };
    }
  };
}

// Create Express app
const app = express();
app.use(express.json());
app.use(api.express.router);

// Start server
const port = 3000;
app.listen(port, () => {
  console.log(`\nServer running on http://localhost:${port}`);
  console.log('\nTry these examples:');
  console.log('\n1. POST article (resource override - always returns full record):');
  console.log('   curl -X POST http://localhost:3000/api/articles \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"data":{"type":"articles","attributes":{"title":"Test Article","body":"Content"}}}\'');
  
  console.log('\n2. POST comment (API default - minimal response):');
  console.log('   curl -X POST http://localhost:3000/api/comments \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"data":{"type":"comments","attributes":{"content":"Great article!","author":"John"}}}\'');
  
  console.log('\n3. POST comment with query override (returns full record):');
  console.log('   curl -X POST "http://localhost:3000/api/comments?returnFullRecord=true" \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"data":{"type":"comments","attributes":{"content":"Another comment","author":"Jane"}}}\'');
  
  console.log('\n4. PUT with relaxed ID handling (programmatic usage):');
  console.log('   // In your code:');
  console.log('   await api.resources.articles.put({');
  console.log('     id: "123",');
  console.log('     inputRecord: {');
  console.log('       data: {');
  console.log('         type: "articles",');
  console.log('         // No ID required with strictIdHandling: false');
  console.log('         attributes: { title: "Updated" }');
  console.log('       }');
  console.log('     },');
  console.log('     strictIdHandling: false,');
  console.log('     returnFullRecord: false');
  console.log('   });');
  
  console.log('\nPress Ctrl+C to stop the server');
});