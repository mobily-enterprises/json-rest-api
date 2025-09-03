#!/usr/bin/env node

/**
 * Example: Custom URL Override Using Hooks
 * 
 * This example demonstrates how to override URL generation using the
 * hooked-api hooks system. This is the recommended approach for custom
 * URL scenarios like API gateways, CDNs, or multi-tenant applications.
 */

import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import knexLib from 'knex';
import express from 'express';

// Create in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Create API with URL override hook
const api = new Api({ 
  name: 'url-override-demo',
  
  // Define hooks at API creation time
  hooks: {
    // This hook runs at the start of each request
    'transport:request': [
      async (payload) => {
        const { context, req } = payload;
        
        // Example 1: Override based on custom header
        // Useful for CDN or API gateway scenarios
        if (req?.headers?.['x-public-url']) {
          context.urlPrefixOverride = req.headers['x-public-url'];
          console.log(`✓ URL overridden via X-Public-URL header: ${context.urlPrefixOverride}`);
        }
        
        // Example 2: API versioning via header
        // Route different API versions while maintaining same backend
        else if (req?.headers?.['x-api-version'] === 'v2') {
          context.urlPrefixOverride = 'https://api.example.com/v2';
          console.log(`✓ URL overridden for API v2: ${context.urlPrefixOverride}`);
        }
        
        // Example 3: Multi-tenant based on host
        // Each tenant gets their own domain in responses
        else if (req?.hostname?.includes('tenant-a')) {
          context.urlPrefixOverride = `https://tenant-a.api.com${req.baseUrl || ''}`;
          console.log(`✓ URL overridden for tenant-a: ${context.urlPrefixOverride}`);
        }
        
        // Example 4: Environment-based override
        // Force production URLs in staging environment
        else if (process.env.FORCE_PRODUCTION_URLS === 'true') {
          context.urlPrefixOverride = 'https://api.production.com/api';
          console.log(`✓ URL overridden via environment: ${context.urlPrefixOverride}`);
        }
        
        return payload;
      }
    ]
  }
});

// Install plugins
await api.use(RestApiPlugin, {
  returnRecordTransport: { post: 'full' }  // Return full JSON:API response
});
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' });

// Define a simple resource
await api.addResource('items', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    description: { type: 'string', max: 500 }
  }
});
await api.resources.items.createKnexTable();

// Create some test data
console.log('\n📝 Creating test data...');
await api.resources.items.post({
  inputRecord: {
    data: {
      type: 'items',
      attributes: {
        name: 'Test Item 1',
        description: 'This is a test item'
      }
    }
  },
  simplified: false
});

// Create Express app
const app = express();
app.use(api.http.express.router);

// Start server
const PORT = process.env.PORT || 3333;
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log('\n📚 Try these examples:\n');
  
  console.log('1. Default URL (auto-detected):');
  console.log(`   curl http://localhost:${PORT}/api/items`);
  console.log('   → URLs will be: http://localhost:${PORT}/api/items/1\n');
  
  console.log('2. Custom CDN URL:');
  console.log(`   curl -H "X-Public-URL: https://cdn.example.com/api" http://localhost:${PORT}/api/items`);
  console.log('   → URLs will be: https://cdn.example.com/api/items/1\n');
  
  console.log('3. API Version Header:');
  console.log(`   curl -H "X-API-Version: v2" http://localhost:${PORT}/api/items`);
  console.log('   → URLs will be: https://api.example.com/v2/items/1\n');
  
  console.log('4. Create with custom URL:');
  console.log(`   curl -X POST -H "Content-Type: application/vnd.api+json" \\`);
  console.log(`        -H "X-Public-URL: https://public.api.com/api" \\`);
  console.log(`        -d '{"data":{"type":"items","attributes":{"name":"New Item"}}}' \\`);
  console.log(`        http://localhost:${PORT}/api/items`);
  console.log('   → Response URLs will use: https://public.api.com/api/items/2\n');
  
  console.log('Press Ctrl+C to stop the server\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down gracefully...');
  server.close();
  await knex.destroy();
  process.exit(0);
});