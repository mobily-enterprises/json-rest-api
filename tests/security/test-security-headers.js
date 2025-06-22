import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { SecurityPlugin } from '../../plugins/security.js';
import { HTTPPlugin } from '../../plugins/core/http.js';

test('Security headers: all headers are set correctly', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  const res = await request(app)
    .get('/api/items')
    .expect(200);
  
  // Check security headers
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-xss-protection'], '1; mode=block');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['x-permitted-cross-domain-policies'], 'none');
  assert.equal(res.headers['x-download-options'], 'noopen');
  assert.ok(res.headers['permissions-policy']);
  assert.ok(res.headers['content-security-policy']);
});

test('Security headers: HSTS only on HTTPS', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // HTTP request - no HSTS
  const httpRes = await request(app)
    .get('/api/items')
    .expect(200);
  
  assert.ok(!httpRes.headers['strict-transport-security']);
  
  // HTTPS request (simulated) - includes HSTS
  const httpsRes = await request(app)
    .get('/api/items')
    .set('X-Forwarded-Proto', 'https')
    .expect(200);
  
  assert.equal(httpsRes.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains; preload');
});

test('Security headers: CSP directives', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:']
      }
    }
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  const res = await request(app)
    .get('/api/items')
    .expect(200);
  
  const csp = res.headers['content-security-policy'];
  assert.ok(csp);
  assert.equal(csp.includes("default-src 'self'", true), false);
  assert.equal(csp.includes("script-src 'self' 'unsafe-inline'", true), false);
  assert.equal(csp.includes("style-src 'self' 'unsafe-inline'", true), false);
  assert.equal(csp.includes("img-src 'self' data: https:", true), false);
});

test('Security headers: Permissions Policy', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  const res = await request(app)
    .get('/api/items')
    .expect(200);
  
  const policy = res.headers['permissions-policy'];
  assert.ok(policy);
  assert.equal(policy.includes('geolocation=(, true)'));
  assert.equal(policy.includes('microphone=(, true)'));
  assert.equal(policy.includes('camera=(, true)'));
});

test('Security headers: applied to all response types', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Create an item
  const createRes = await request(app)
    .post('/api/items')
    .send({ name: 'Test' })
    .expect(201);
  
  assert.equal(createRes.headers['x-content-type-options'], 'nosniff');
  
  const itemId = createRes.body.data.id;
  
  // Update
  const updateRes = await request(app)
    .patch(`/api/items/${itemId}`)
    .send({ name: 'Updated' })
    .expect(200);
  
  assert.equal(updateRes.headers['x-frame-options'], 'DENY');
  
  // Delete
  const deleteRes = await request(app)
    .delete(`/api/items/${itemId}`)
    .expect(204);
  
  assert.equal(deleteRes.headers['x-xss-protection'], '1; mode=block');
});

test('Security headers: error responses also have headers', async () => {
  const api = new Api();
  const app = express();
  
  api.use(MemoryPlugin);
  api.use(SecurityPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string', required: true }
  }));
  
  // Trigger validation error
  const res = await request(app)
    .post('/api/items')
    .send({}) // Missing required field
    .expect(400);
  
  // Security headers should still be present
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  
  // Trigger 404
  const notFoundRes = await request(app)
    .get('/api/items/99999')
    .expect(404);
  
  assert.equal(notFoundRes.headers['x-xss-protection'], '1; mode=block');
});