import { createApi } from '../index.js';
import { ApiGatewayPlugin } from '../plugins/infrastructure/api-gateway.js';
import { HTTPPlugin } from '../plugins/core/http.js';
import express from 'express';

// Create API Gateway instance
const api = createApi();
api.use(ApiGatewayPlugin);

// Example 1: Basic API Gateway - Aggregate multiple services
// =========================================================

// User service
api.addApiResource('users', {
  baseUrl: 'https://jsonplaceholder.typicode.com',
  endpoints: {
    get: { path: '/users/:id' },
    list: { path: '/users' },
    create: { path: '/users', method: 'POST' },
    update: { path: '/users/:id', method: 'PUT' },
    delete: { path: '/users/:id', method: 'DELETE' }
  }
});

// Posts service
api.addApiResource('posts', {
  baseUrl: 'https://jsonplaceholder.typicode.com',
  endpoints: {
    get: { path: '/posts/:id' },
    list: { path: '/posts' },
    create: { path: '/posts', method: 'POST' },
    update: { path: '/posts/:id', method: 'PUT' },
    delete: { path: '/posts/:id', method: 'DELETE' },
    // Custom endpoint
    byUser: { path: '/users/:userId/posts', method: 'GET' }
  },
  methods: {
    byUser: { path: '/users/:userId/posts', method: 'GET' }
  }
});

// Example 2: E-commerce API Gateway with multiple services
// ========================================================

// Configure production APIs with auth and transformations
api.addApiResource('inventory', {
  baseUrl: process.env.INVENTORY_API || 'https://api.inventory.example.com',
  auth: { type: 'bearer', token: process.env.INVENTORY_TOKEN },
  timeout: 10000,
  retries: 3,
  endpoints: {
    get: { path: '/api/v1/products/:id' },
    list: { path: '/api/v1/products' },
    reserve: { path: '/api/v1/products/:id/reserve', method: 'POST' },
    confirm: { path: '/api/v1/reservations/:id/confirm', method: 'POST' },
    cancel: { path: '/api/v1/reservations/:id/cancel', method: 'POST' },
    checkStock: { path: '/api/v1/products/:id/stock', method: 'GET' }
  },
  transformers: {
    list: {
      response: (data) => {
        // Transform vendor format to our format
        return data.products.map(p => ({
          id: p.sku,
          name: p.productName,
          stock: p.availableQuantity,
          price: p.unitPrice
        }));
      }
    }
  }
});

api.addApiResource('payments', {
  baseUrl: process.env.STRIPE_API || 'https://api.stripe.com/v1',
  auth: { type: 'bearer', token: process.env.STRIPE_SECRET_KEY },
  timeout: 15000,
  endpoints: {
    charge: { path: '/charges', method: 'POST' },
    refund: { path: '/refunds', method: 'POST' },
    get: { path: '/charges/:id' },
    capture: { path: '/charges/:id/capture', method: 'POST' }
  },
  transformers: {
    charge: {
      request: (data) => ({
        amount: Math.round(data.amount * 100), // Convert to cents
        currency: data.currency || 'usd',
        source: data.token,
        description: data.description,
        metadata: data.metadata
      }),
      response: (data) => ({
        id: data.id,
        amount: data.amount / 100, // Convert back to dollars
        status: data.status,
        created: new Date(data.created * 1000)
      })
    }
  }
});

api.addApiResource('shipping', {
  baseUrl: process.env.SHIPPING_API || 'https://api.shipping.example.com',
  auth: { type: 'apiKey', header: 'X-API-Key', key: process.env.SHIPPING_KEY },
  endpoints: {
    create: { path: '/shipments', method: 'POST' },
    get: { path: '/shipments/:id' },
    cancel: { path: '/shipments/:id/cancel', method: 'POST' },
    track: { path: '/shipments/:id/tracking' },
    rates: { path: '/rates', method: 'POST' }
  }
});

// Example 3: Checkout Saga - Orchestrate the checkout process
// ===========================================================

api.saga('CheckoutSaga', {
  startsWith: 'CheckoutStarted',
  
  async handle(event, { executeStep, compensate, emit }) {
    const { orderId, customerId, items, paymentToken, shippingAddress } = event.data;
    
    try {
      // Step 1: Check inventory availability
      console.log(`[Saga ${orderId}] Checking inventory...`);
      const availability = await executeStep('checkInventory', async () => {
        const checks = await Promise.all(
          items.map(item => 
            api.resources.inventory.checkStock({ id: item.productId })
          )
        );
        
        const unavailable = items.filter((item, i) => 
          checks[i].available < item.quantity
        );
        
        if (unavailable.length > 0) {
          throw new Error(`Insufficient stock for items: ${unavailable.map(i => i.productId).join(', ')}`);
        }
        
        return checks;
      });
      
      // Step 2: Reserve inventory
      console.log(`[Saga ${orderId}] Reserving inventory...`);
      const reservations = await executeStep('reserveInventory', async () => {
        return await Promise.all(
          items.map(item =>
            api.resources.inventory.reserve({
              id: item.productId,
              quantity: item.quantity,
              orderId
            })
          )
        );
      }, async () => {
        // Compensation: Cancel all reservations
        await Promise.all(
          reservations.map(r => 
            api.resources.inventory.cancel({ id: r.id })
          )
        );
      });
      
      // Step 3: Calculate shipping
      console.log(`[Saga ${orderId}] Calculating shipping...`);
      const shippingRates = await executeStep('calculateShipping', async () => {
        return await api.resources.shipping.rates({
          origin: 'WAREHOUSE_1',
          destination: shippingAddress,
          items: items.map(i => ({
            weight: i.weight,
            dimensions: i.dimensions,
            quantity: i.quantity
          }))
        });
      });
      
      // Step 4: Process payment
      console.log(`[Saga ${orderId}] Processing payment...`);
      const payment = await executeStep('processPayment', async () => {
        const totalAmount = items.reduce((sum, item) => 
          sum + (item.price * item.quantity), 0
        ) + shippingRates.selectedRate.price;
        
        return await api.resources.payments.charge({
          amount: totalAmount,
          token: paymentToken,
          description: `Order ${orderId}`,
          metadata: { orderId, customerId }
        });
      }, async () => {
        // Compensation: Refund payment
        if (payment && payment.id) {
          await api.resources.payments.refund({
            charge: payment.id,
            reason: 'order_failed'
          });
        }
      });
      
      // Step 5: Create shipment
      console.log(`[Saga ${orderId}] Creating shipment...`);
      const shipment = await executeStep('createShipment', async () => {
        return await api.resources.shipping.create({
          orderId,
          address: shippingAddress,
          items,
          service: shippingRates.selectedRate.service
        });
      }, async () => {
        // Compensation: Cancel shipment
        if (shipment && shipment.id) {
          await api.resources.shipping.cancel({ id: shipment.id });
        }
      });
      
      // Step 6: Confirm inventory reservations
      console.log(`[Saga ${orderId}] Confirming inventory...`);
      await executeStep('confirmInventory', async () => {
        await Promise.all(
          reservations.map(r =>
            api.resources.inventory.confirm({ id: r.id })
          )
        );
      });
      
      // Success! Emit completion event
      await emit('CheckoutCompleted', {
        orderId,
        paymentId: payment.id,
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber
      });
      
      console.log(`[Saga ${orderId}] Checkout completed successfully!`);
      
    } catch (error) {
      console.error(`[Saga ${orderId}] Checkout failed:`, error.message);
      
      // Run compensations to rollback
      await compensate();
      
      // Emit failure event
      await emit('CheckoutFailed', {
        orderId,
        reason: error.message,
        timestamp: new Date()
      });
      
      throw error;
    }
  }
});

// Example 4: API with circuit breakers and health monitoring
// ==========================================================

// Configure a flaky API with circuit breaker
api.addApiResource('notifications', {
  baseUrl: 'https://flaky-notification-service.example.com',
  timeout: 5000,
  retries: 2,
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 30000,
    monitoringPeriod: 10000
  },
  endpoints: {
    send: { path: '/notifications', method: 'POST' },
    get: { path: '/notifications/:id' },
    list: { path: '/notifications' }
  }
});

// Example 5: HTTP API to expose the gateway
// =========================================

const app = express();
api.use(HTTPPlugin, { app, basePath: '/api' });

// Add health check endpoint
app.get('/health', (req, res) => {
  const health = api.getApiHealth();
  
  // Determine overall health
  const isHealthy = Object.values(health).every(service => 
    !service.circuit || service.circuit.state !== 'OPEN'
  );
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    services: health,
    timestamp: new Date()
  });
});

// Example usage functions
// =======================

async function demonstrateBasicGateway() {
  console.log('\n=== Basic API Gateway Demo ===\n');
  
  // Get user and their posts
  const user = await api.resources.users.get(1);
  console.log('User:', user.data);
  
  const posts = await api.resources.posts.byUser({ userId: 1 });
  console.log(`User has ${posts.length} posts`);
}

async function demonstrateCheckout() {
  console.log('\n=== Checkout Saga Demo ===\n');
  
  // Trigger checkout saga
  await api.emitEvent('CheckoutStarted', {
    orderId: 'ORD-' + Date.now(),
    customerId: 'CUST-123',
    items: [
      { productId: 'PROD-1', quantity: 2, price: 29.99, weight: 0.5 },
      { productId: 'PROD-2', quantity: 1, price: 49.99, weight: 1.0 }
    ],
    paymentToken: 'tok_visa',
    shippingAddress: {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zip: '94105',
      country: 'US'
    }
  });
}

async function demonstrateBatchCalls() {
  console.log('\n=== Batch API Calls Demo ===\n');
  
  // Execute multiple API calls with transaction semantics
  const result = await api.batchApiCalls([
    { resource: 'users', method: 'create', data: { name: 'John Doe', email: 'john@example.com' } },
    { resource: 'posts', method: 'create', data: { userId: 1, title: 'Hello World' } },
    { resource: 'notifications', method: 'send', data: { to: 'john@example.com', message: 'Welcome!' } }
  ], { transactional: true });
  
  console.log('Batch result:', result);
}

async function demonstrateTransformations() {
  console.log('\n=== API Transformations Demo ===\n');
  
  // Configure custom transformations
  api.configureApi('payments', {
    transformers: {
      list: {
        request: (params) => ({
          ...params,
          limit: params.pageSize || 10,
          starting_after: params.cursor
        }),
        response: (data) => ({
          items: data.data,
          hasMore: data.has_more,
          nextCursor: data.data[data.data.length - 1]?.id
        })
      }
    }
  });
  
  // Use the configured API
  const payments = await api.resources.payments.list({ pageSize: 5 });
  console.log('Transformed payments:', payments);
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  
  app.listen(PORT, async () => {
    console.log(`API Gateway running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API endpoints: http://localhost:${PORT}/api/:resource`);
    
    try {
      await demonstrateBasicGateway();
      // await demonstrateCheckout(); // Commented out as it needs real APIs
      // await demonstrateBatchCalls();
      // await demonstrateTransformations();
    } catch (error) {
      console.error('Demo error:', error);
    }
  });
}