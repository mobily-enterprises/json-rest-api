import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { HTTPPlugin } from '../../plugins/core/http.js';
import { CsrfPlugin } from '../../plugins/csrf.js';

test('CSRF: blocks requests without token', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Try POST without CSRF token
  const res = await request(app)
    .post('/api/items')
    .send({ name: 'Test item' })
    .expect(403);
  
  assert.equal(res.body.errors[0].status, '403');
  assert.equal(res.body.errors[0].detail, 'Invalid CSRF token');
});

test('CSRF: allows requests with valid token', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Get CSRF token
  const tokenRes = await request(app)
    .get('/api/csrf-token')
    .expect(200);
  
  const { token, headerName } = tokenRes.body;
  const csrfCookie = tokenRes.headers['set-cookie']
    .find(c => c.startsWith('_csrf='))
    ?.split(';')[0]
    .split('=')[1];
  
  // POST with CSRF token
  const res = await request(app)
    .post('/api/items')
    .set(headerName, token)
    .set('Cookie', `_csrf=${csrfCookie}`)
    .send({ name: 'Test item' })
    .expect(201);
  
  assert.equal(res.body.data.attributes.name, 'Test item');
});

test('CSRF: double-submit cookie validation', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin, { mode: 'double-submit' });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Get token
  const tokenRes = await request(app)
    .get('/api/csrf-token')
    .expect(200);
  
  const token = tokenRes.body.token;
  const cookie = tokenRes.headers['set-cookie'][0];
  
  // Try with mismatched token
  await request(app)
    .post('/api/items')
    .set('x-csrf-token', 'wrong-token')
    .set('Cookie', cookie)
    .send({ name: 'Test' })
    .expect(403);
  
  // Try with correct token
  await request(app)
    .post('/api/items')
    .set('x-csrf-token', token)
    .set('Cookie', cookie)
    .send({ name: 'Test' })
    .expect(201);
});

test('CSRF: token in body parameter', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Get token
  const tokenRes = await request(app)
    .get('/api/csrf-token')
    .expect(200);
  
  const token = tokenRes.body.token;
  const cookie = tokenRes.headers['set-cookie'][0];
  
  // Send token in body
  await request(app)
    .post('/api/items')
    .set('Cookie', cookie)
    .send({ 
      name: 'Test item',
      _csrf: token 
    })
    .expect(201);
});

test('CSRF: GET requests are not protected', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Create an item first
  const tokenRes = await request(app)
    .get('/api/csrf-token')
    .expect(200);
  
  const token = tokenRes.body.token;
  const cookie = tokenRes.headers['set-cookie'][0];
  
  const createRes = await request(app)
    .post('/api/items')
    .set('x-csrf-token', token)
    .set('Cookie', cookie)
    .send({ name: 'Test item' })
    .expect(201);
  
  const itemId = createRes.body.data.id;
  
  // GET should work without CSRF token
  await request(app)
    .get(`/api/items/${itemId}`)
    .expect(200);
  
  // Query should work without CSRF token
  await request(app)
    .get('/api/items')
    .expect(200);
});

test('CSRF: API token authentication bypasses CSRF', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // POST with Bearer token should bypass CSRF
  await request(app)
    .post('/api/items')
    .set('Authorization', 'Bearer test-api-token')
    .send({ name: 'Test item' })
    .expect(201);
});

test('CSRF: custom ignored paths', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin, {
    ignorePaths: ['/api/public', /^\/api\/webhook/]
  });
  api.use(HTTPPlugin, { app });
  
  // Add public endpoint
  app.post('/api/public', (req, res) => {
    res.json({ success: true });
  });
  
  app.post('/api/webhook/github', (req, res) => {
    res.json({ success: true });
  });
  
  // Public path should work without CSRF
  await request(app)
    .post('/api/public')
    .expect(200);
  
  // Webhook path should work without CSRF
  await request(app)
    .post('/api/webhook/github')
    .expect(200);
  
  // Regular API path should require CSRF
  await request(app)
    .post('/api/items')
    .expect(403);
});

test('CSRF: resource-specific configuration', async () => {
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  api.addResource('public-items', new Schema({
    name: { type: 'string' }
  }));
  
  api.addResource('protected-items', new Schema({
    name: { type: 'string' }
  }));
  
  // Disable CSRF for public-items
  api.configureCsrfForResource('public-items', { enabled: false });
  
  // Public items should work without CSRF
  await request(app)
    .post('/api/public-items')
    .send({ name: 'Public' })
    .expect(201);
  
  // Protected items should require CSRF
  await request(app)
    .post('/api/protected-items')
    .send({ name: 'Protected' })
    .expect(403);
});

test('CSRF: security violation is logged', async () => {
  const logs = [];
  
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  api.use(HTTPPlugin, { app });
  
  // Capture security violations
  api.hook('securityViolation', async (context) => {
    logs.push(context);
  });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Trigger CSRF violation
  await request(app)
    .post('/api/items')
    .send({ name: 'Test' })
    .expect(403);
  
  // Check security event was logged
  assert.equal(logs.length, 1);
  assert.equal(logs[0].violationType, 'CSRF_TOKEN_INVALID');
  assert.equal(logs[0].severity, 'WARNING');
  assert.equal(logs[0].details.method, 'POST');
  assert.equal(logs[0].details.hasRequestToken);
});

test('CSRF: synchronizer token pattern', async () => {
  const sessionStore = new Map();
  
  const api = new Api();
  const app = express();
  
  app.use(cookieParser());
  
  // Simulate session
  app.use((req, res, next) => {
    req.session = { id: 'test-session-123' };
    res.cookie('sessionId', 'test-session-123');
    next();
  });
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin, {
    mode: 'synchronizer',
    sessionStore
  });
  api.use(HTTPPlugin, { app });
  
  api.addResource('items', new Schema({
    name: { type: 'string' }
  }));
  
  // Get CSRF token
  const tokenRes = await request(app)
    .get('/api/csrf-token')
    .expect(200);
  
  const { token } = tokenRes.body;
  
  // Verify token is in session store
  assert.equal(sessionStore.get('test-session-123'), token);
  
  // Use token
  await request(app)
    .post('/api/items')
    .set('x-csrf-token', token)
    .set('Cookie', 'sessionId=test-session-123')
    .send({ name: 'Test' })
    .expect(201);
});

test('CSRF: constant-time token comparison', async () => {
  const { api } = t.context = { api: new Api() };
  
  api.use(MemoryPlugin);
  api.use(CsrfPlugin);
  
  const token1 = 'a'.repeat(64);
  const token2 = 'a'.repeat(64);
  const token3 = 'b'.repeat(64);
  
  // Same tokens should validate
  assert.equal(api.validateCsrfToken(token1, token2, true));
  
  // Different tokens should not validate
  assert.equal(api.validateCsrfToken(token1, token3));
  
  // Different lengths should not validate
  assert.equal(api.validateCsrfToken('short', 'longer-token'));
  
  // Null/undefined should not validate
  assert.equal(api.validateCsrfToken(null, token1));
  assert.equal(api.validateCsrfToken(token1, undefined));
});