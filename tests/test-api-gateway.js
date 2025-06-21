import test from 'ava';
import express from 'express';
import { createApi } from '../index.js';
import { ApiGatewayPlugin } from '../plugins/api-gateway.js';
import { HTTPPlugin } from '../plugins/http.js';

// Mock server for testing
function createMockServer() {
  const app = express();
  app.use(express.json());
  
  const calls = [];
  
  // Mock user service
  app.get('/users/:id', (req, res) => {
    calls.push({ method: 'GET', path: req.path });
    res.json({
      id: req.params.id,
      name: 'John Doe',
      email: 'john@example.com'
    });
  });
  
  app.get('/users', (req, res) => {
    calls.push({ method: 'GET', path: req.path, query: req.query });
    res.json([
      { id: '1', name: 'John Doe' },
      { id: '2', name: 'Jane Smith' }
    ]);
  });
  
  app.post('/users', (req, res) => {
    calls.push({ method: 'POST', path: req.path, body: req.body });
    res.status(201).json({
      id: '3',
      ...req.body
    });
  });
  
  // Mock payment service
  app.post('/charges', (req, res) => {
    calls.push({ method: 'POST', path: req.path, body: req.body });
    
    if (req.body.amount > 10000) {
      res.status(402).json({ error: 'Payment declined' });
    } else {
      res.json({
        id: 'ch_' + Date.now(),
        amount: req.body.amount,
        status: 'succeeded'
      });
    }
  });
  
  // Flaky service for circuit breaker testing
  let failCount = 0;
  app.get('/flaky', (req, res) => {
    failCount++;
    if (failCount <= 3) {
      res.status(500).json({ error: 'Server error' });
    } else {
      res.json({ status: 'ok' });
    }
  });
  
  const server = app.listen(0);
  const port = server.address().port;
  
  return {
    url: `http://localhost:${port}`,
    calls,
    close: () => server.close()
  };
}

test('Basic API resource operations', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  api.addApiResource('users', {
    baseUrl: mockServer.url,
    endpoints: {
      get: { path: '/users/:id' },
      list: { path: '/users' },
      create: { path: '/users', method: 'POST' }
    }
  });
  
  // Test get
  const user = await api.resources.users.get(1);
  t.is(user.data.type, 'users');
  t.is(user.data.id, '1');
  t.is(user.data.attributes.name, 'John Doe');
  
  // Test list
  const users = await api.resources.users.query();
  t.is(users.data.length, 2);
  t.is(users.data[0].type, 'users');
  
  // Test create
  const newUser = await api.resources.users.create({
    name: 'New User',
    email: 'new@example.com'
  });
  t.is(newUser.data.type, 'users');
  t.is(newUser.data.attributes.name, 'New User');
  
  mockServer.close();
});

test('Request/response transformations', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  api.addApiResource('payments', {
    baseUrl: mockServer.url,
    transformers: {
      charge: {
        request: (data) => ({
          amount: Math.round(data.amount * 100), // Convert to cents
          currency: 'usd'
        }),
        response: (data) => ({
          id: data.id,
          amount: data.amount / 100, // Convert back to dollars
          status: data.status
        })
      }
    },
    endpoints: {
      charge: { path: '/charges', method: 'POST' }
    }
  });
  
  const payment = await api.resources.payments.execute('charge', {
    amount: 99.99  // Dollars
  });
  
  t.is(payment.amount, 99.99); // Transformed back to dollars
  t.is(payment.status, 'succeeded');
  
  // Check that the request was transformed
  const sentAmount = mockServer.calls[0].body.amount;
  t.is(sentAmount, 9999); // Was sent as cents
  
  mockServer.close();
});

test('Circuit breaker functionality', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  api.addApiResource('flaky', {
    baseUrl: mockServer.url,
    circuitBreaker: {
      failureThreshold: 2,
      resetTimeout: 100
    },
    timeout: 1000,
    retries: 0, // No retries for this test
    endpoints: {
      status: { path: '/flaky' }
    }
  });
  
  // First two calls fail
  await t.throwsAsync(api.resources.flaky.execute('status'), {
    message: /Server error/
  });
  
  await t.throwsAsync(api.resources.flaky.execute('status'), {
    message: /Server error/
  });
  
  // Circuit should now be open
  await t.throwsAsync(api.resources.flaky.execute('status'), {
    message: /Circuit breaker is OPEN/
  });
  
  // Wait for reset timeout
  await new Promise(resolve => setTimeout(resolve, 150));
  
  // Should work now (server returns success after 3 failures)
  const result = await api.resources.flaky.execute('status');
  t.is(result.status, 'ok');
  
  mockServer.close();
});

test('Saga orchestration', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  // Add resources
  api.addApiResource('payments', {
    baseUrl: mockServer.url,
    endpoints: {
      charge: { path: '/charges', method: 'POST' }
    }
  });
  
  const events = [];
  
  // Define a simple saga
  api.saga('PaymentSaga', {
    startsWith: 'PaymentRequested',
    
    async handle(event, { executeStep, compensate, emit }) {
      try {
        const payment = await executeStep('charge', async () => {
          return await api.resources.payments.execute('charge', {
            amount: event.data.amount
          });
        });
        
        await emit('PaymentCompleted', { paymentId: payment.id });
        events.push({ type: 'PaymentCompleted', paymentId: payment.id });
        
      } catch (error) {
        await compensate();
        await emit('PaymentFailed', { error: error.message });
        events.push({ type: 'PaymentFailed', error: error.message });
      }
    }
  });
  
  // Trigger successful payment
  await api.emitEvent('PaymentRequested', { amount: 50 });
  
  // Wait for saga to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  t.is(events.length, 1);
  t.is(events[0].type, 'PaymentCompleted');
  
  // Reset events
  events.length = 0;
  
  // Trigger failed payment (amount too high)
  await api.emitEvent('PaymentRequested', { amount: 200 });
  
  // Wait for saga to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  t.is(events.length, 1);
  t.is(events[0].type, 'PaymentFailed');
  t.regex(events[0].error, /Payment declined/);
  
  mockServer.close();
});

test('Health monitoring', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin, { enableMetrics: true });
  
  api.addApiResource('users', {
    baseUrl: mockServer.url,
    endpoints: {
      get: { path: '/users/:id' }
    }
  });
  
  // Make some calls
  await api.resources.users.get(1);
  await api.resources.users.get(2);
  
  const health = api.getApiHealth();
  
  t.truthy(health.users);
  t.is(health.users.url, mockServer.url);
  t.is(health.users.circuit.state, 'CLOSED');
  t.is(health.users.metrics.requests, 2);
  t.is(health.users.metrics.errors, 0);
  t.truthy(health.users.metrics.avgResponseTime);
  
  mockServer.close();
});

test('Batch API calls', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  api.addApiResource('users', {
    baseUrl: mockServer.url,
    endpoints: {
      get: { path: '/users/:id' },
      create: { path: '/users', method: 'POST' }
    }
  });
  
  const results = await api.batchApiCalls([
    { resource: 'users', method: 'get', data: 1 },
    { resource: 'users', method: 'get', data: 2 },
    { resource: 'users', method: 'create', data: { name: 'Test User' } }
  ]);
  
  t.true(results.success);
  t.is(results.results.length, 3);
  t.true(results.results[0].success);
  t.is(results.results[0].data.data.attributes.name, 'John Doe');
  t.true(results.results[2].success);
  t.is(results.results[2].data.data.attributes.name, 'Test User');
  
  mockServer.close();
});

test('Custom methods', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  // Add custom endpoint
  const app = express();
  app.use(express.json());
  app.post('/users/:id/activate', (req, res) => {
    res.json({ id: req.params.id, status: 'active' });
  });
  
  const server = app.listen(0);
  const port = server.address().port;
  
  api.addApiResource('users', {
    baseUrl: `http://localhost:${port}`,
    endpoints: {
      get: { path: '/users/:id' },
      activate: { path: '/users/:id/activate', method: 'POST' }
    },
    methods: {
      activate: { path: '/users/:id/activate', method: 'POST' }
    }
  });
  
  const result = await api.resources.users.activate({ id: '123' });
  t.is(result.id, '123');
  t.is(result.status, 'active');
  
  server.close();
  mockServer.close();
});

test('HTTP integration', async t => {
  const mockServer = createMockServer();
  
  const api = createApi();
  api.use(ApiGatewayPlugin);
  
  api.addApiResource('backend', {
    baseUrl: mockServer.url,
    endpoints: {
      get: { path: '/users/:id' },
      list: { path: '/users' }
    }
  });
  
  // Add HTTP plugin to expose the gateway
  const app = express();
  api.use(HTTPPlugin, { app, basePath: '/api' });
  
  const server = app.listen(0);
  const gatewayPort = server.address().port;
  
  // Make request through the gateway
  const response = await fetch(`http://localhost:${gatewayPort}/api/backend/1`);
  const data = await response.json();
  
  t.is(response.status, 200);
  t.is(data.data.type, 'backend');
  t.is(data.data.id, '1');
  t.is(data.data.attributes.name, 'John Doe');
  
  server.close();
  mockServer.close();
});