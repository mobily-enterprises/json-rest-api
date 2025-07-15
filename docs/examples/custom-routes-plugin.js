/**
 * Example: Custom Routes Plugin
 * 
 * This example shows how to create a plugin that adds custom routes
 * using the transport-agnostic api.addRoute method. These routes work
 * with any transport plugin (Express, Fastify, etc.)
 */

export const CustomRoutesPlugin = {
  name: 'custom-routes',
  dependencies: ['rest-api'],
  
  async install({ api, log }) {
    // Health check endpoint
    await api.addRoute({
      method: 'GET',
      path: '/api/health',
      handler: async ({ context }) => {
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: api.version || '1.0.0',
          uptime: process.uptime()
        };
      }
    });
    
    // System information endpoint
    await api.addRoute({
      method: 'GET',
      path: '/api/system/info',
      handler: async ({ context }) => {
        return {
          nodeVersion: process.version,
          platform: process.platform,
          memory: {
            used: process.memoryUsage().heapUsed,
            total: process.memoryUsage().heapTotal
          }
        };
      }
    });
    
    // Webhook endpoint with path parameter
    await api.addRoute({
      method: 'POST',
      path: '/webhooks/:provider/:event',
      handler: async ({ context, params, body }) => {
        // Access path parameters
        const { provider, event } = params;
        
        // Log webhook received
        log.info(`Webhook received from ${provider} for event ${event}`);
        
        // Process webhook (example)
        return {
          received: true,
          provider,
          event,
          timestamp: new Date().toISOString(),
          processed: true
        };
      }
    });
    
    // Admin endpoint to list all resources
    await api.addRoute({
      method: 'GET',
      path: '/api/admin/resources',
      handler: async ({ context }) => {
        // Access API scopes to list resources
        const resources = Object.keys(api.scopes || {});
        
        return {
          resources,
          count: resources.length
        };
      }
    });
    
    // Metrics endpoint
    await api.addRoute({
      method: 'GET',
      path: '/api/metrics',
      handler: async ({ context }) => {
        // In a real application, you'd track these metrics
        return {
          requests: {
            total: Math.floor(Math.random() * 10000),
            errors: Math.floor(Math.random() * 100),
            success: Math.floor(Math.random() * 9900)
          },
          latency: {
            avg: Math.floor(Math.random() * 100),
            p95: Math.floor(Math.random() * 200),
            p99: Math.floor(Math.random() * 500)
          }
        };
      }
    });
    
    // Custom data export endpoint
    await api.addRoute({
      method: 'POST',
      path: '/api/export/:format',
      handler: async ({ context, params, body }) => {
        const { format } = params;
        const { resource, filters } = body || {};
        
        // Validate format
        const supportedFormats = ['json', 'csv', 'xml'];
        if (!supportedFormats.includes(format)) {
          throw new Error(`Unsupported format: ${format}. Supported formats: ${supportedFormats.join(', ')}`);
        }
        
        // Here you would typically:
        // 1. Use api.scopes[resource].query() to get data
        // 2. Transform to requested format
        // 3. Return formatted data
        
        return {
          format,
          resource,
          filters,
          message: 'Export endpoint example - implement actual export logic here'
        };
      }
    });
    
    // Batch operations endpoint
    await api.addRoute({
      method: 'POST',
      path: '/api/batch',
      handler: async ({ context, body }) => {
        const { operations } = body || {};
        
        if (!Array.isArray(operations)) {
          throw new Error('Operations must be an array');
        }
        
        // Process batch operations
        const results = [];
        for (const op of operations) {
          // Here you would process each operation
          // using api.scopes[op.resource][op.method]()
          results.push({
            operation: op,
            status: 'example',
            message: 'Implement batch processing logic here'
          });
        }
        
        return {
          results,
          processed: operations.length
        };
      }
    });
    
    log.info('Custom routes plugin installed - added health, system, webhook, admin, metrics, export, and batch endpoints');
  }
};

// Usage example:
/*
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from '@hooked-api/json-rest-api';
import { ExpressPlugin } from '@hooked-api/json-rest-api/express';
import { CustomRoutesPlugin } from './custom-routes-plugin.js';

const api = new Api();

// Install core plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Install transport plugin (Express, Fastify, etc.)
await api.use(ExpressPlugin);

// Install custom routes plugin
await api.use(CustomRoutesPlugin);

// Add resources
await api.addResource('users', { ... });
await api.addResource('posts', { ... });

// Create Express app and mount
const app = express();
api.http.express.mount(app);

// Your custom routes are now available:
// GET  /api/health
// GET  /api/system/info
// POST /webhooks/:provider/:event
// GET  /api/admin/resources
// GET  /api/metrics
// POST /api/export/:format
// POST /api/batch
*/