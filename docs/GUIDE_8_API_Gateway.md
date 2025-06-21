# API Gateway with JSON-REST-API: A Practical Guide

## Table of Contents

1. [Introduction](#introduction)
2. [When to Use API Gateway](#when-to-use-api-gateway)
3. [Basic Setup](#basic-setup)
4. [Configuring External APIs](#configuring-external-apis)
5. [Saga Orchestration](#saga-orchestration)
6. [Circuit Breakers & Resilience](#circuit-breakers--resilience)
7. [Real-World Examples](#real-world-examples)
8. [Testing Strategies](#testing-strategies)
9. [Performance & Monitoring](#performance--monitoring)
10. [Security Considerations](#security-considerations)
11. [Migration Guide](#migration-guide)
12. [Best Practices](#best-practices)

## Introduction

The ApiGatewayPlugin transforms JSON-REST-API from a database-backed REST framework into a powerful API gateway and orchestration platform. Instead of querying databases, your resources call external APIs with built-in resilience, transformation, and saga orchestration capabilities.

### What is an API Gateway?

An API gateway acts as a single entry point for clients to access multiple backend services:

```javascript
// Without API Gateway: Clients call multiple services
client -> userService
client -> orderService  
client -> inventoryService

// With API Gateway: Single entry point
client -> API Gateway -> userService
                     -> orderService
                     -> inventoryService
```

### Why Use JSON-REST-API as an API Gateway?

1. **Familiar API**: Use the same resource-based API you know
2. **Built-in Orchestration**: Saga support for complex workflows
3. **Resilience**: Circuit breakers, retries, timeouts
4. **Transformations**: Adapt any external API to your format
5. **Unified Interface**: Consistent JSON:API responses

## When to Use API Gateway

### ✅ Use API Gateway When You Have:

1. **Multiple Backend Services**
   ```javascript
   // Aggregate data from multiple sources
   const order = await api.resources.orders.get(123);
   // Internally calls: OrderService, UserService, InventoryService
   ```

2. **Complex Orchestration Needs**
   - Multi-step checkout processes
   - Distributed transactions
   - Workflow automation

3. **Third-Party API Integration**
   - Stripe for payments
   - SendGrid for emails
   - Twilio for SMS

4. **Microservices Architecture**
   - Service discovery
   - Load balancing
   - Request routing

### ❌ Don't Use API Gateway When:

1. **Simple CRUD Application**
   - Direct database access is simpler
   - No external services

2. **Single Backend Service**
   - Adds unnecessary complexity
   - No orchestration needed

3. **Latency-Critical Applications**
   - Extra network hop
   - Processing overhead

## Basic Setup

### Installation

```javascript
import { createApi } from 'json-rest-api';
import { ApiGatewayPlugin } from 'json-rest-api/plugins/api-gateway';

const api = createApi();
api.use(ApiGatewayPlugin, {
  enableSagas: true,      // Enable saga orchestration
  enableMetrics: true,    // Track API performance
  defaultTimeout: 30000,  // 30 second timeout
  defaultRetries: 3       // Retry failed requests
});
```

### Adding Your First API Resource

```javascript
// Simple external API
api.addApiResource('users', {
  baseUrl: 'https://api.userservice.com',
  endpoints: {
    get: { path: '/users/:id' },
    list: { path: '/users' },
    create: { path: '/users', method: 'POST' },
    update: { path: '/users/:id', method: 'PUT' },
    delete: { path: '/users/:id', method: 'DELETE' }
  }
});

// Use it like a normal resource
const user = await api.resources.users.get(123);
const users = await api.resources.users.query({ active: true });
```

## Configuring External APIs

### Authentication

```javascript
// Bearer token
api.addApiResource('github', {
  baseUrl: 'https://api.github.com',
  auth: { type: 'bearer', token: process.env.GITHUB_TOKEN },
  endpoints: {
    get: { path: '/users/:username' },
    repos: { path: '/users/:username/repos' }
  }
});

// API Key
api.addApiResource('sendgrid', {
  baseUrl: 'https://api.sendgrid.com/v3',
  auth: { 
    type: 'apiKey', 
    header: 'Authorization',
    key: `Bearer ${process.env.SENDGRID_KEY}`
  },
  endpoints: {
    send: { path: '/mail/send', method: 'POST' }
  }
});

// Basic Auth
api.addApiResource('legacy', {
  baseUrl: 'https://legacy.system.com',
  auth: {
    type: 'basic',
    username: process.env.LEGACY_USER,
    password: process.env.LEGACY_PASS
  }
});
```

### Transformations

Transform requests and responses to match your API format:

```javascript
api.addApiResource('stripe', {
  baseUrl: 'https://api.stripe.com/v1',
  auth: { type: 'bearer', token: process.env.STRIPE_SECRET },
  transformers: {
    charge: {
      // Transform outgoing request
      request: (data) => ({
        amount: Math.round(data.amount * 100), // Convert to cents
        currency: data.currency || 'usd',
        source: data.cardToken,
        description: `Order ${data.orderId}`,
        metadata: {
          orderId: data.orderId,
          customerId: data.customerId
        }
      }),
      
      // Transform incoming response
      response: (stripeCharge) => ({
        id: stripeCharge.id,
        amount: stripeCharge.amount / 100, // Convert to dollars
        status: stripeCharge.status,
        last4: stripeCharge.source.last4,
        created: new Date(stripeCharge.created * 1000)
      })
    }
  },
  endpoints: {
    charge: { path: '/charges', method: 'POST' },
    refund: { path: '/refunds', method: 'POST' }
  }
});

// Use transformed API
const payment = await api.resources.stripe.charge({
  amount: 99.99,      // Dollars
  cardToken: 'tok_visa',
  orderId: 'ORD-123'
});
// Returns: { id: 'ch_...', amount: 99.99, status: 'succeeded', ... }
```

### Custom Methods

Add domain-specific methods to your resources:

```javascript
api.addApiResource('orders', {
  baseUrl: 'https://api.orders.com',
  endpoints: {
    get: { path: '/orders/:id' },
    list: { path: '/orders' },
    create: { path: '/orders', method: 'POST' },
    
    // Custom endpoints
    ship: { path: '/orders/:id/ship', method: 'POST' },
    cancel: { path: '/orders/:id/cancel', method: 'POST' },
    invoice: { path: '/orders/:id/invoice' }
  },
  methods: {
    ship: { path: '/orders/:id/ship', method: 'POST' },
    cancel: { path: '/orders/:id/cancel', method: 'POST' },
    getInvoice: { path: '/orders/:id/invoice' }
  }
});

// Use custom methods
await api.resources.orders.ship({ id: 'ORD-123', carrier: 'fedex' });
await api.resources.orders.cancel({ id: 'ORD-123', reason: 'customer_request' });
const invoice = await api.resources.orders.getInvoice({ id: 'ORD-123' });
```

## Saga Orchestration

Sagas handle complex, multi-step processes with automatic rollback on failure:

### Basic Saga Structure

```javascript
api.saga('OrderFulfillmentSaga', {
  startsWith: 'OrderCreated',  // Triggering event
  
  async handle(event, { executeStep, compensate, emit }) {
    const { orderId } = event.data;
    
    try {
      // Step 1: Do something
      const result1 = await executeStep('step1', async () => {
        return await api.resources.service1.action(data);
      }, async () => {
        // Compensation function (rollback)
        await api.resources.service1.undo(result1.id);
      });
      
      // Step 2: Do something else
      const result2 = await executeStep('step2', async () => {
        return await api.resources.service2.action(result1);
      }, async () => {
        await api.resources.service2.undo(result2.id);
      });
      
      // Success
      await emit('OrderFulfilled', { orderId });
      
    } catch (error) {
      // Automatic rollback
      await compensate();
      await emit('OrderFulfillmentFailed', { orderId, error: error.message });
    }
  }
});
```

### Real-World Example: Payment Processing

```javascript
api.saga('PaymentProcessingSaga', {
  startsWith: 'PaymentRequested',
  
  async handle(event, { executeStep, compensate, emit }) {
    const { orderId, customerId, amount, paymentMethod } = event.data;
    let authorization, capture;
    
    try {
      // Step 1: Fraud check
      await executeStep('fraudCheck', async () => {
        const risk = await api.resources.fraud.analyze({
          customerId,
          amount,
          ipAddress: event.data.ipAddress
        });
        
        if (risk.score > 80) {
          throw new Error('High fraud risk detected');
        }
      });
      
      // Step 2: Authorize payment
      authorization = await executeStep('authorize', async () => {
        return await api.resources.payments.authorize({
          amount,
          paymentMethod,
          capture: false // Don't capture yet
        });
      }, async () => {
        // Compensation: Void authorization
        if (authorization) {
          await api.resources.payments.void(authorization.id);
        }
      });
      
      // Step 3: Update inventory
      await executeStep('updateInventory', async () => {
        await api.resources.inventory.reserve({
          orderId,
          items: event.data.items
        });
      }, async () => {
        // Compensation: Release inventory
        await api.resources.inventory.release({ orderId });
      });
      
      // Step 4: Capture payment
      capture = await executeStep('capture', async () => {
        return await api.resources.payments.capture({
          authorizationId: authorization.id
        });
      });
      
      // Success
      await emit('PaymentCompleted', {
        orderId,
        paymentId: capture.id,
        amount: capture.amount
      });
      
    } catch (error) {
      await compensate();
      await emit('PaymentFailed', {
        orderId,
        reason: error.message
      });
    }
  }
});

// Trigger the saga
await api.emitEvent('PaymentRequested', {
  orderId: 'ORD-123',
  customerId: 'CUST-456',
  amount: 299.99,
  paymentMethod: 'card_xyz',
  items: [{ sku: 'WIDGET-1', quantity: 2 }]
});
```

## Circuit Breakers & Resilience

### Circuit Breaker Pattern

Protects against cascading failures:

```javascript
api.addApiResource('flaky-service', {
  baseUrl: 'https://unreliable.api.com',
  circuitBreaker: {
    failureThreshold: 5,      // Open after 5 failures
    resetTimeout: 60000,      // Try again after 1 minute
    monitoringPeriod: 10000   // Within 10 second window
  },
  timeout: 5000,              // 5 second timeout
  retries: 2,                 // Retry twice
  retryDelay: 1000           // 1 second between retries
});

// Circuit breaker states:
// CLOSED: Normal operation
// OPEN: Rejecting all requests
// HALF_OPEN: Testing if service recovered
```

### Retry Strategies

```javascript
api.addApiResource('important-service', {
  baseUrl: 'https://critical.api.com',
  retries: 3,
  retryDelay: 1000,  // Exponential backoff: 1s, 2s, 4s
  
  // Custom retry logic
  shouldRetry: (error, attempt) => {
    // Don't retry client errors
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    // Retry server errors and network issues
    return attempt < 3;
  }
});
```

### Timeouts and Fallbacks

```javascript
// Configure timeouts
api.addApiResource('search', {
  baseUrl: 'https://search.api.com',
  timeout: 3000,  // 3 second timeout
  
  endpoints: {
    search: { path: '/search', method: 'GET' }
  }
});

// Implement fallback logic
async function searchWithFallback(query) {
  try {
    return await api.resources.search.search({ q: query });
  } catch (error) {
    if (error.code === 'ETIMEDOUT' || error.status === 503) {
      // Fallback to cache or default results
      return getCachedResults(query);
    }
    throw error;
  }
}
```

## Real-World Examples

### Example 1: Multi-Service User Profile

```javascript
// Aggregate data from multiple services
api.addApiResource('users', {
  baseUrl: 'https://user.service.com',
  endpoints: { get: { path: '/users/:id' } }
});

api.addApiResource('orders', {
  baseUrl: 'https://order.service.com',
  endpoints: { byUser: { path: '/users/:userId/orders' } }
});

api.addApiResource('reviews', {
  baseUrl: 'https://review.service.com',
  endpoints: { byUser: { path: '/users/:userId/reviews' } }
});

// Create aggregated endpoint
async function getUserProfile(userId) {
  const [user, orders, reviews] = await Promise.all([
    api.resources.users.get(userId),
    api.resources.orders.byUser({ userId }),
    api.resources.reviews.byUser({ userId })
  ]);
  
  return {
    ...user.data,
    orderCount: orders.data.length,
    reviewCount: reviews.data.length,
    recentOrders: orders.data.slice(0, 5),
    recentReviews: reviews.data.slice(0, 3)
  };
}
```

### Example 2: E-commerce Checkout

```javascript
// Complete checkout flow with saga
api.saga('CheckoutSaga', {
  startsWith: 'CheckoutInitiated',
  
  async handle(event, helpers) {
    const { cartId, customerId, paymentToken } = event.data;
    
    // 1. Validate cart
    const cart = await helpers.executeStep('validateCart', 
      () => api.resources.carts.validate({ id: cartId })
    );
    
    // 2. Check inventory for all items
    await helpers.executeStep('checkInventory',
      () => Promise.all(cart.items.map(item => 
        api.resources.inventory.check({
          sku: item.sku,
          quantity: item.quantity
        })
      ))
    );
    
    // 3. Calculate taxes and shipping
    const pricing = await helpers.executeStep('calculatePricing',
      () => api.resources.pricing.calculate({
        items: cart.items,
        destination: event.data.shippingAddress
      })
    );
    
    // 4. Process payment
    const payment = await helpers.executeStep('processPayment',
      () => api.resources.payments.charge({
        amount: pricing.total,
        token: paymentToken,
        customerId
      }),
      () => api.resources.payments.refund({ chargeId: payment.id })
    );
    
    // 5. Create order
    const order = await helpers.executeStep('createOrder',
      () => api.resources.orders.create({
        customerId,
        items: cart.items,
        payment: payment.id,
        total: pricing.total
      }),
      () => api.resources.orders.cancel({ id: order.id })
    );
    
    // 6. Send confirmation
    await helpers.executeStep('sendConfirmation',
      () => api.resources.notifications.send({
        type: 'order_confirmation',
        to: event.data.email,
        orderId: order.id
      })
    );
    
    await helpers.emit('CheckoutCompleted', { orderId: order.id });
  }
});
```

### Example 3: API Rate Limit Management

```javascript
// Configure rate-limited API
api.addApiResource('twitter', {
  baseUrl: 'https://api.twitter.com/2',
  auth: { type: 'bearer', token: process.env.TWITTER_BEARER },
  
  // Rate limit handling
  rateLimits: {
    tweets: { requests: 300, window: 900000 }, // 300 per 15 min
    users: { requests: 900, window: 900000 }   // 900 per 15 min
  },
  
  endpoints: {
    tweet: { path: '/tweets/:id' },
    user: { path: '/users/:id' },
    search: { path: '/tweets/search/recent' }
  }
});

// Implement rate limit aware batching
class RateLimitBatcher {
  constructor(resource, endpoint, limit) {
    this.resource = resource;
    this.endpoint = endpoint;
    this.limit = limit;
    this.queue = [];
    this.processing = false;
  }
  
  async add(params) {
    return new Promise((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
      this.process();
    });
  }
  
  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const batch = this.queue.splice(0, this.limit.requests);
    
    try {
      const results = await Promise.all(
        batch.map(({ params }) => 
          this.resource[this.endpoint](params)
        )
      );
      
      batch.forEach(({ resolve }, i) => resolve(results[i]));
    } catch (error) {
      batch.forEach(({ reject }) => reject(error));
    }
    
    this.processing = false;
    
    // Schedule next batch
    if (this.queue.length > 0) {
      setTimeout(() => this.process(), this.limit.window / this.limit.requests);
    }
  }
}
```

## Testing Strategies

### Mock External APIs

```javascript
// Test configuration
const testApi = createApi();
testApi.use(ApiGatewayPlugin);

// Add mock API
testApi.addApiResource('users', {
  baseUrl: 'http://localhost:4000/mock',
  endpoints: {
    get: { path: '/users/:id' },
    create: { path: '/users', method: 'POST' }
  }
});

// Test saga
describe('CheckoutSaga', () => {
  it('should complete checkout successfully', async () => {
    const mockServer = createMockServer();
    
    mockServer.post('/mock/payments/charge', (req, res) => {
      res.json({ id: 'ch_123', status: 'succeeded' });
    });
    
    await testApi.emitEvent('CheckoutInitiated', {
      cartId: 'cart_123',
      paymentToken: 'tok_visa'
    });
    
    // Assert saga completed
    const events = await getEmittedEvents();
    expect(events).toContain('CheckoutCompleted');
  });
  
  it('should rollback on payment failure', async () => {
    mockServer.post('/mock/payments/charge', (req, res) => {
      res.status(402).json({ error: 'Card declined' });
    });
    
    await testApi.emitEvent('CheckoutInitiated', {
      cartId: 'cart_123',
      paymentToken: 'tok_declined'
    });
    
    // Assert rollback occurred
    expect(mockServer.requests).toContain('POST /mock/inventory/release');
  });
});
```

### Integration Testing

```javascript
// Test with real APIs in staging
const stagingApi = createApi();
stagingApi.use(ApiGatewayPlugin);

stagingApi.addApiResource('payments', {
  baseUrl: process.env.STRIPE_TEST_URL,
  auth: { type: 'bearer', token: process.env.STRIPE_TEST_KEY }
});

// Test transaction
const payment = await stagingApi.resources.payments.charge({
  amount: 100,
  token: 'tok_visa_test'
});

expect(payment.data.status).toBe('succeeded');
```

## Performance & Monitoring

### Metrics Collection

```javascript
// Get API health and metrics
const health = api.getApiHealth();

console.log(health);
// {
//   users: {
//     url: 'https://api.users.com',
//     circuit: { state: 'CLOSED', failures: 0 },
//     metrics: {
//       requests: 1543,
//       errors: 12,
//       avgResponseTime: 234
//     }
//   },
//   payments: {
//     url: 'https://api.stripe.com',
//     circuit: { state: 'CLOSED', failures: 0 },
//     metrics: {
//       requests: 89,
//       errors: 2,
//       avgResponseTime: 567
//     }
//   }
// }
```

### Monitoring Integration

```javascript
// Export metrics to monitoring service
setInterval(async () => {
  const health = api.getApiHealth();
  
  for (const [service, data] of Object.entries(health)) {
    await prometheus.gauge('api_gateway_requests_total', data.metrics.requests, {
      service
    });
    
    await prometheus.gauge('api_gateway_errors_total', data.metrics.errors, {
      service
    });
    
    await prometheus.gauge('api_gateway_response_time_avg', data.metrics.avgResponseTime, {
      service
    });
    
    await prometheus.gauge('api_gateway_circuit_state', 
      data.circuit.state === 'OPEN' ? 1 : 0, 
      { service }
    );
  }
}, 10000); // Every 10 seconds
```

## Security Considerations

### API Key Management

```javascript
// Use environment variables
api.addApiResource('secure-api', {
  baseUrl: process.env.SECURE_API_URL,
  auth: {
    type: 'bearer',
    token: process.env.SECURE_API_TOKEN
  }
});

// Rotate keys programmatically
async function rotateApiKeys() {
  const newToken = await getNewTokenFromVault();
  
  api.configureApi('secure-api', {
    auth: { type: 'bearer', token: newToken }
  });
}
```

### Request Signing

```javascript
// Implement request signing
api.addApiResource('aws-service', {
  baseUrl: 'https://service.amazonaws.com',
  
  // Custom headers for each request
  beforeRequest: async (config, endpoint, data) => {
    const signature = await signRequest({
      method: endpoint.method,
      path: endpoint.path,
      data,
      secretKey: process.env.AWS_SECRET
    });
    
    config.headers['X-Signature'] = signature;
    config.headers['X-Timestamp'] = Date.now();
    
    return config;
  }
});
```

### Rate Limiting Your Gateway

```javascript
import rateLimit from 'express-rate-limit';

const app = express();

// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));

// Per-resource rate limits
const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10 // 10 expensive operations per minute
});

app.use('/api/reports', expensiveLimiter);

api.use(HTTPPlugin, { app });
```

## Migration Guide

### From Direct API Calls

Before:
```javascript
// Scattered API calls
const userResponse = await fetch('https://api.users.com/users/123');
const user = await userResponse.json();

const ordersResponse = await fetch('https://api.orders.com/users/123/orders');
const orders = await ordersResponse.json();
```

After:
```javascript
// Centralized API gateway
api.addApiResource('users', {
  baseUrl: 'https://api.users.com',
  endpoints: { get: { path: '/users/:id' } }
});

api.addApiResource('orders', {
  baseUrl: 'https://api.orders.com',
  endpoints: { byUser: { path: '/users/:userId/orders' } }
});

const user = await api.resources.users.get(123);
const orders = await api.resources.orders.byUser({ userId: 123 });
```

### From Database Resources

Before:
```javascript
// Database-backed resource
api.use(MySQLPlugin);
api.addResource('products', productSchema);

const product = await api.resources.products.get(123);
```

After:
```javascript
// API-backed resource
api.use(ApiGatewayPlugin);
api.addApiResource('products', {
  baseUrl: 'https://api.products.com',
  endpoints: { get: { path: '/products/:id' } }
});

const product = await api.resources.products.get(123);
```

## Best Practices

### 1. Use Environment Variables

```javascript
// Good
api.addApiResource('service', {
  baseUrl: process.env.SERVICE_URL,
  auth: { type: 'bearer', token: process.env.SERVICE_TOKEN }
});

// Bad
api.addApiResource('service', {
  baseUrl: 'https://api.service.com',
  auth: { type: 'bearer', token: 'sk_live_abc123' }
});
```

### 2. Implement Proper Error Handling

```javascript
// Good: Specific error handling
try {
  const result = await api.resources.payments.charge(data);
} catch (error) {
  if (error.status === 402) {
    // Payment failed - specific handling
    await notifyCustomer('payment_failed', error.details);
  } else if (error.code === 'ETIMEDOUT') {
    // Timeout - maybe retry
    await queueForRetry(data);
  } else {
    // Unknown error
    await alertOps(error);
  }
}

// Bad: Generic error handling
try {
  const result = await api.resources.payments.charge(data);
} catch (error) {
  console.error('Error:', error);
}
```

### 3. Use Sagas for Complex Workflows

```javascript
// Good: Saga with proper compensation
api.saga('ComplexWorkflow', {
  async handle(event, { executeStep, compensate }) {
    const step1Result = await executeStep('step1', 
      () => doStep1(),
      () => undoStep1()  // Compensation
    );
    
    const step2Result = await executeStep('step2',
      () => doStep2(step1Result),
      () => undoStep2(step2Result)  // Compensation
    );
  }
});

// Bad: Manual orchestration without rollback
async function complexWorkflow(data) {
  const step1Result = await doStep1();
  const step2Result = await doStep2(step1Result); // What if this fails?
}
```

### 4. Monitor Circuit Breaker State

```javascript
// Set up alerts for circuit breaker state changes
setInterval(() => {
  const health = api.getApiHealth();
  
  for (const [service, status] of Object.entries(health)) {
    if (status.circuit.state === 'OPEN') {
      alertOps(`Circuit breaker OPEN for ${service}`);
    }
  }
}, 30000); // Check every 30 seconds
```

### 5. Batch When Possible

```javascript
// Good: Batch multiple calls
const results = await api.batchApiCalls([
  { resource: 'users', method: 'get', data: 1 },
  { resource: 'users', method: 'get', data: 2 },
  { resource: 'users', method: 'get', data: 3 }
]);

// Better: Use service that supports batch operations
api.addApiResource('users', {
  baseUrl: 'https://api.users.com',
  endpoints: {
    batchGet: { path: '/users/batch', method: 'POST' }
  }
});

const users = await api.resources.users.batchGet({ ids: [1, 2, 3] });
```

## Conclusion

The ApiGatewayPlugin transforms JSON-REST-API into a powerful API orchestration platform. By combining familiar resource-based APIs with advanced features like sagas, circuit breakers, and transformations, you can build robust microservices architectures while maintaining simplicity.

Key takeaways:
- Use for aggregating multiple services
- Implement sagas for complex workflows
- Add resilience with circuit breakers
- Transform external APIs to your format
- Monitor health and performance

Remember: Start simple, add complexity only when needed. The gateway pattern is powerful but comes with operational overhead. Use it when the benefits outweigh the costs.