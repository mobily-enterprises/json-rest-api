# Microservices with JSON-REST-API

This guide shows how to build microservices architectures using the MicroservicesPlugin.

## Overview

The MicroservicesPlugin adds distributed system capabilities to JSON-REST-API:

- **Multiple Transport Layers**: TCP, Redis, NATS, RabbitMQ, Kafka, gRPC
- **Message Patterns**: Request-response communication
- **Event Patterns**: Pub-sub event streaming  
- **Service Discovery**: Register and discover services
- **Circuit Breakers**: Fault tolerance
- **Health Checks**: Service monitoring

## Basic Setup

```javascript
import { createApi } from 'json-rest-api';
import { MicroservicesPlugin } from 'json-rest-api/plugins/microservices.js';

const api = createApi();

// Use memory transport for development
api.use(MicroservicesPlugin, {
  serviceName: 'my-service',
  transport: 'memory'
});

// Use Redis for production
api.use(MicroservicesPlugin, {
  serviceName: 'my-service',
  transport: 'redis',
  options: {
    host: 'localhost',
    port: 6379
  }
});
```

## Message Patterns (Request-Response)

Message patterns allow services to call each other's methods:

```javascript
// Service A: Define message handlers
api.messageHandler('user.authenticate', async (data, context) => {
  const { email, password } = data;
  const user = await authenticateUser(email, password);
  return { authenticated: true, user };
});

// Service B: Call the message handler
const result = await api.sendMessage(
  'service-a',           // Target service
  'user.authenticate',   // Message pattern
  { email, password }    // Data
);
```

### Auto-Generated CRUD Patterns

Resources automatically expose CRUD operations as message patterns:

```javascript
// These patterns are auto-generated for each resource:
// - {resource}.query    - List/search
// - {resource}.get      - Get by ID
// - {resource}.create   - Create new
// - {resource}.update   - Update existing
// - {resource}.delete   - Delete

// Example: Query users from another service
const users = await api.sendMessage(
  'user-service',
  'users.query',
  { filter: { role: 'admin' } }
);
```

## Event Patterns (Pub-Sub)

Events allow services to react to changes asynchronously:

```javascript
// Service A: Emit events
api.hook('afterInsert', async (context) => {
  if (context.options.type === 'orders') {
    await api.emitEvent('order.created', {
      order: context.result,
      timestamp: Date.now()
    });
  }
});

// Service B: Listen to events
api.eventHandler('order.created', async (data, context) => {
  console.log('New order:', data.order);
  // Update inventory, send email, etc.
});

// Multiple handlers for same event
api.eventHandler('order.created', updateInventory);
api.eventHandler('order.created', sendNotification);
api.eventHandler('order.created', updateAnalytics);
```

### Auto-Generated Events

CRUD operations automatically emit events:

- `{resource}.created` - After insert
- `{resource}.updated` - After update  
- `{resource}.deleted` - After delete

```javascript
// These events are emitted automatically
api.eventHandler('users.created', async (data) => {
  console.log('New user:', data.data);
  console.log('Created by:', data.user);
});
```

## Transport Layers

### Memory Transport (Development)

In-process communication for development/testing:

```javascript
api.use(MicroservicesPlugin, {
  transport: 'memory'
});
```

### TCP Transport

Direct TCP connections between services:

```javascript
api.use(MicroservicesPlugin, {
  transport: 'tcp',
  options: {
    host: '0.0.0.0',  // Listen on all interfaces
    port: 3001        // Service port
  }
});

// Send to specific TCP service
await api.sendMessage('order-service', 'orders.get', 
  { id: 123 },
  { host: '192.168.1.10', port: 3002 }
);
```

### Redis Transport

Pub-sub messaging via Redis:

```javascript
api.use(MicroservicesPlugin, {
  transport: 'redis',
  options: {
    host: 'localhost',
    port: 6379,
    password: 'secret',
    db: 0
  }
});
```

### Production Transports (Stubs)

These require additional packages:

```javascript
// NATS - High-performance messaging
// npm install @nats-io/nats
api.use(MicroservicesPlugin, {
  transport: 'nats',
  options: { servers: 'nats://localhost:4222' }
});

// RabbitMQ - Enterprise messaging
// npm install amqplib
api.use(MicroservicesPlugin, {
  transport: 'rabbitmq',
  options: { url: 'amqp://localhost' }
});

// Kafka - Event streaming
// npm install kafkajs
api.use(MicroservicesPlugin, {
  transport: 'kafka',
  options: { brokers: ['localhost:9092'] }
});

// gRPC - High-performance RPC
// npm install @grpc/grpc-js
api.use(MicroservicesPlugin, {
  transport: 'grpc',
  options: { url: 'localhost:50051' }
});
```

## Service Discovery

Register and discover services dynamically:

```javascript
// Register a service
api.registerService('payment-service', {
  host: '192.168.1.20',
  port: 3003,
  version: '1.0.0',
  capabilities: ['stripe', 'paypal']
});

// Discover a service
const service = api.discoverService('payment-service');
console.log(service);
// {
//   host: '192.168.1.20',
//   port: 3003,
//   version: '1.0.0',
//   capabilities: ['stripe', 'paypal'],
//   status: 'healthy',
//   registeredAt: 1234567890
// }
```

## Circuit Breakers

Protect against cascading failures:

```javascript
api.use(MicroservicesPlugin, {
  circuitBreaker: {
    failureThreshold: 5,    // Open circuit after 5 failures
    resetTimeout: 60000     // Try again after 60 seconds
  }
});

// Circuit breaker states:
// - CLOSED: Normal operation
// - OPEN: Failing, reject requests
// - HALF_OPEN: Testing if service recovered
```

## Health Checks

Monitor service health:

```javascript
// Set up automatic health checks
api.use(MicroservicesPlugin, {
  healthCheck: {
    interval: 30000  // Check every 30 seconds
  }
});

// Define health check for a service
api.setHealthCheck('database-service', async () => {
  // Throws error if unhealthy
  await db.ping();
});

// Manual health check
const isHealthy = await api.checkHealth('database-service');
```

## Real-World Example: E-Commerce

```javascript
// 1. User Service
const userService = createApi();
userService.use(MicroservicesPlugin, {
  serviceName: 'user-service',
  transport: 'redis'
});

userService.addResource('users', userSchema);

// Custom authentication
userService.messageHandler('auth.login', async ({ email, password }) => {
  const user = await validateCredentials(email, password);
  const token = generateToken(user);
  return { user, token };
});

// 2. Product Service  
const productService = createApi();
productService.use(MicroservicesPlugin, {
  serviceName: 'product-service',
  transport: 'redis'
});

productService.addResource('products', productSchema);

// Stock check
productService.messageHandler('stock.check', async ({ productId, quantity }) => {
  const stock = await getStock(productId);
  return { available: stock >= quantity, stock };
});

// 3. Order Service
const orderService = createApi();
orderService.use(MicroservicesPlugin, {
  serviceName: 'order-service',
  transport: 'redis',
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 30000
  }
});

orderService.addResource('orders', orderSchema);

// Complex order creation
orderService.hook('beforeInsert', async (context) => {
  if (context.options.type !== 'orders') return;
  
  const { userId, items } = context.data;
  
  // Verify user exists
  const userResponse = await orderService.sendMessage(
    'user-service',
    'users.get',
    { id: userId }
  );
  
  if (!userResponse.data) {
    throw new Error('User not found');
  }
  
  // Check stock for all items
  for (const item of items) {
    const stockResponse = await orderService.sendMessage(
      'product-service',
      'stock.check',
      { productId: item.productId, quantity: item.quantity }
    );
    
    if (!stockResponse.available) {
      throw new Error(`Insufficient stock for product ${item.productId}`);
    }
  }
  
  // Calculate totals, apply discounts, etc.
  context.data.total = calculateTotal(items);
  context.data.status = 'pending';
});

// 4. Notification Service
const notificationService = createApi();
notificationService.use(MicroservicesPlugin, {
  serviceName: 'notification-service',
  transport: 'redis'
});

// React to events
notificationService.eventHandler('orders.created', async (event) => {
  const { data, user } = event;
  
  // Get full user details
  const userResponse = await notificationService.sendMessage(
    'user-service',
    'users.get', 
    { id: data.userId }
  );
  
  // Send email
  await sendEmail({
    to: userResponse.data.attributes.email,
    subject: 'Order Confirmation',
    template: 'order-confirmation',
    data: { order: data, user: userResponse.data }
  });
});

// 5. API Gateway
const gateway = createApi();
gateway.use(MicroservicesPlugin, {
  serviceName: 'api-gateway',
  transport: 'redis'
});
gateway.use(HTTPPlugin, { app: expressApp });

// Aggregate data from multiple services
gateway.messageHandler('checkout.process', async (data) => {
  const { userId, items, paymentMethod } = data;
  
  try {
    // Create order
    const orderResponse = await gateway.sendMessage(
      'order-service',
      'orders.create',
      { 
        data: { userId, items, paymentMethod }
      }
    );
    
    // Process payment
    const paymentResponse = await gateway.sendMessage(
      'payment-service',
      'payment.process',
      {
        orderId: orderResponse.data.id,
        amount: orderResponse.data.attributes.total,
        method: paymentMethod
      }
    );
    
    // Update order status
    await gateway.sendMessage(
      'order-service',
      'orders.update',
      {
        id: orderResponse.data.id,
        data: { 
          status: 'paid',
          paymentId: paymentResponse.transactionId
        }
      }
    );
    
    return {
      order: orderResponse.data,
      payment: paymentResponse
    };
  } catch (error) {
    // Rollback logic here
    throw error;
  }
});
```

## Best Practices

### 1. Service Boundaries

Keep services focused on a single domain:

```javascript
// Good: User service handles user-related operations
userService.addResource('users', userSchema);
userService.addResource('profiles', profileSchema);
userService.messageHandler('auth.login', loginHandler);

// Bad: Mixing unrelated domains
api.addResource('users', userSchema);
api.addResource('products', productSchema);  // Should be separate service
```

### 2. Error Handling

Always handle remote failures gracefully:

```javascript
try {
  const user = await api.sendMessage('user-service', 'users.get', { id });
} catch (error) {
  // Handle service unavailable
  if (error.message.includes('Circuit breaker is OPEN')) {
    return cachedUser || defaultUser;
  }
  throw error;
}
```

### 3. Event Design

Make events descriptive and include context:

```javascript
// Good: Include all relevant data
await api.emitEvent('order.shipped', {
  orderId: order.id,
  userId: order.userId,
  trackingNumber: shipment.tracking,
  carrier: shipment.carrier,
  estimatedDelivery: shipment.eta,
  timestamp: Date.now()
});

// Bad: Just ID
await api.emitEvent('order.shipped', { orderId: order.id });
```

### 4. Idempotency

Make operations idempotent where possible:

```javascript
api.messageHandler('payment.process', async (data) => {
  const { orderId, amount, idempotencyKey } = data;
  
  // Check if already processed
  const existing = await checkIdempotencyKey(idempotencyKey);
  if (existing) {
    return existing;
  }
  
  // Process payment
  const result = await processPayment(orderId, amount);
  await saveIdempotencyKey(idempotencyKey, result);
  
  return result;
});
```

### 5. Versioning

Version your message patterns:

```javascript
// Support multiple versions
api.messageHandler('user.get.v1', oldGetHandler);
api.messageHandler('user.get.v2', newGetHandler);

// Client specifies version
const user = await api.sendMessage(
  'user-service',
  'user.get.v2',
  { id: 123 }
);
```

## Monitoring & Debugging

### Enable Debug Logging

```javascript
api.use(MicroservicesPlugin, {
  debug: true,
  transport: 'redis'
});
```

### Track Message Flow

```javascript
// Add correlation IDs
api.hook('beforeSendMessage', (context) => {
  context.correlationId = context.correlationId || generateId();
  console.log(`[${context.correlationId}] Sending ${context.pattern}`);
});
```

### Monitor Health

```javascript
// Expose health endpoint
api.messageHandler('health', async () => {
  const services = api.getAllServices();
  const health = {};
  
  for (const service of services) {
    health[service] = await api.checkHealth(service);
  }
  
  return {
    status: 'healthy',
    services: health,
    uptime: process.uptime()
  };
});
```

## Comparison with NestJS Microservices

| Feature | JSON-REST-API | NestJS |
|---------|---------------|---------|
| **Setup Complexity** | Simple, schema-driven | Complex, decorator-heavy |
| **Learning Curve** | Low - just functions | High - decorators, DI, modules |
| **Type Safety** | Runtime validation | Compile-time + runtime |
| **Auto CRUD** | ✅ Built-in | ❌ Manual implementation |
| **Message Patterns** | ✅ Simple functions | ✅ Decorator-based |
| **Event Patterns** | ✅ Simple emitter | ✅ Observable streams |
| **Transports** | Growing (TCP, Redis) | Mature (all major ones) |
| **Circuit Breakers** | ✅ Built-in | Via external packages |
| **Service Discovery** | ✅ Simple registry | Via external packages |

### When to Use JSON-REST-API Microservices

- **Rapid Development**: Get microservices running in minutes
- **CRUD-Heavy**: Auto-generated patterns for resources  
- **Simple Architecture**: Function-based, not class-based
- **Small Teams**: Less boilerplate, faster iteration

### When to Use NestJS Microservices

- **Complex Business Logic**: Need advanced patterns (CQRS, Sagas)
- **Large Teams**: Benefit from strict structure
- **Existing NestJS**: Already using NestJS monolith
- **Advanced Streaming**: Need RxJS observables

## Summary

The MicroservicesPlugin brings distributed system capabilities to JSON-REST-API while maintaining its simplicity. You get:

- Multiple transport options
- Simple message and event patterns
- Automatic CRUD operations as services
- Built-in fault tolerance
- Easy service discovery

Perfect for building microservices that need REST APIs with minimal boilerplate.