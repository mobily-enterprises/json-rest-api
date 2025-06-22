import test from 'ava';
import express from 'express';
import request from 'supertest';
import { Api } from '../../lib/api.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { SecurityPlugin } from '../../plugins/security.js';
import { HTTPPlugin } from '../../plugins/http.js';

test('Rate limiting: blocks after limit exceeded', async t => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 60 * 1000, // 1 minute
      max: 5, // 5 requests per minute for testing
      message: 'Too many requests'
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // Make 5 requests (should succeed)
  for (let i = 0; i < 5; i++) {
    const res = await request(app)
      .get('/api/items')
      .expect(200);
    
    // Check rate limit headers
    t.is(res.headers['x-ratelimit-limit'], '5');
    t.is(res.headers['x-ratelimit-remaining'], String(4 - i));
    t.truthy(res.headers['x-ratelimit-reset']);
  }
  
  // 6th request should be rate limited
  const res = await request(app)
    .get('/api/items')
    .expect(429);
  
  t.is(res.body.errors[0].status, '429');
  t.is(res.body.errors[0].title, 'Too Many Requests');
  t.is(res.body.errors[0].detail, 'Too many requests');
  t.truthy(res.headers['retry-after']);
});

test('Rate limiting: different IPs have separate limits', async t => {
  const api = new Api();
  const app = express();
  
  // Override IP detection for testing
  app.use((req, res, next) => {
    req.ip = req.headers['x-test-ip'] || '127.0.0.1';
    next();
  });
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 3
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // Make 3 requests from IP1
  for (let i = 0; i < 3; i++) {
    await request(app)
      .get('/api/items')
      .set('X-Test-IP', '192.168.1.1')
      .expect(200);
  }
  
  // 4th request from IP1 should fail
  await request(app)
    .get('/api/items')
    .set('X-Test-IP', '192.168.1.1')
    .expect(429);
  
  // But IP2 should still work
  const res = await request(app)
    .get('/api/items')
    .set('X-Test-IP', '192.168.1.2')
    .expect(200);
  
  t.is(res.headers['x-ratelimit-remaining'], '2');
});

test('Rate limiting: custom key generator', async t => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 3,
      keyGenerator: (req) => {
        // Rate limit by API key instead of IP
        return req.headers['x-api-key'] || 'anonymous';
      }
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // Make 3 requests with API key 1
  for (let i = 0; i < 3; i++) {
    await request(app)
      .get('/api/items')
      .set('X-API-Key', 'key1')
      .expect(200);
  }
  
  // 4th request with key1 should fail
  await request(app)
    .get('/api/items')
    .set('X-API-Key', 'key1')
    .expect(429);
  
  // But key2 should work
  await request(app)
    .get('/api/items')
    .set('X-API-Key', 'key2')
    .expect(200);
});

test('Rate limiting: headers are set correctly', async t => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  const res = await request(app)
    .get('/api/items')
    .expect(200);
  
  t.is(res.headers['x-ratelimit-limit'], '100');
  t.is(res.headers['x-ratelimit-remaining'], '99');
  
  const resetTime = new Date(res.headers['x-ratelimit-reset']);
  const now = new Date();
  const diff = resetTime - now;
  
  // Reset time should be approximately 15 minutes in the future
  t.true(diff > 14 * 60 * 1000);
  t.true(diff < 16 * 60 * 1000);
});

test('Rate limiting: sliding window behavior', async t => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 1000, // 1 second window for testing
      max: 2
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // Make 2 requests
  await request(app).get('/api/items').expect(200);
  await request(app).get('/api/items').expect(200);
  
  // 3rd should fail
  await request(app).get('/api/items').expect(429);
  
  // Wait for window to slide
  await new Promise(resolve => setTimeout(resolve, 1100));
  
  // Should work again
  await request(app).get('/api/items').expect(200);
});

test('Rate limiting: distributed rate limiting with Redis simulation', async t => {
  const api1 = new Api();
  const api2 = new Api();
  const app1 = express();
  const app2 = express();
  
  // Simulate shared Redis store with a Map
  const sharedStore = new Map();
  
  const mockRedisStore = {
    get: async (key) => sharedStore.get(key),
    set: async (key, value) => sharedStore.set(key, value),
    delete: async (key) => sharedStore.delete(key)
  };
  
  // Configure both APIs with same store
  const securityConfig = {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 3,
      redis: { client: mockRedisStore }
    }
  };
  
  api1.use(MemoryPlugin);
  api1.use(SecurityPlugin, securityConfig);
  api1.use(HTTPPlugin, { app: app1 });
  api1.addResource('items', { name: { type: 'string' } });
  
  api2.use(MemoryPlugin);
  api2.use(SecurityPlugin, securityConfig);
  api2.use(HTTPPlugin, { app: app2 });
  api2.addResource('items', { name: { type: 'string' } });
  
  // Make 2 requests to api1
  await request(app1).get('/api/items').expect(200);
  await request(app1).get('/api/items').expect(200);
  
  // Make 1 request to api2 (should count against same limit)
  const res = await request(app2).get('/api/items').expect(200);
  t.is(res.headers['x-ratelimit-remaining'], '0');
  
  // Next request to either API should fail
  await request(app1).get('/api/items').expect(429);
  await request(app2).get('/api/items').expect(429);
});

test('Rate limiting: error meta information', async t => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 1
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // First request succeeds
  await request(app).get('/api/items').expect(200);
  
  // Second request fails with meta info
  const res = await request(app)
    .get('/api/items')
    .expect(429);
  
  t.is(res.body.errors[0].status, '429');
  t.truthy(res.body.errors[0].meta.retryAfter);
  t.truthy(res.body.errors[0].meta.resetAt);
  
  // Verify resetAt is a valid ISO date
  const resetAt = new Date(res.body.errors[0].meta.resetAt);
  t.false(isNaN(resetAt.getTime()));
});

test('Rate limiting: graceful degradation without Redis', async t => {
  const api = new Api();
  const app = express();
  
  // Configure with invalid Redis connection
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 3,
      redis: {
        host: 'invalid-host',
        port: 9999,
        retryStrategy: () => null // Don't retry
      }
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', {
    name: { type: 'string' }
  });
  
  // Should still work with in-memory fallback
  for (let i = 0; i < 3; i++) {
    await request(app).get('/api/items').expect(200);
  }
  
  // 4th request should be rate limited
  await request(app).get('/api/items').expect(429);
});