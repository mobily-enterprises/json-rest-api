import { createApi, Schema } from '../index.js';
import { MicroservicesPlugin } from '../plugins/enterprise/microservices.js';

// Example: Building a microservices architecture with JSON-REST-API

// Service 1: User Service
const userService = createApi();
userService.use(MicroservicesPlugin, {
  serviceName: 'user-service',
  transport: 'memory', // Use 'redis' or 'tcp' in production
  options: {
    port: 3001
  }
});

const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, unique: true },
  role: { type: 'string', default: 'user' },
  createdAt: { type: 'timestamp' }
});

userService.addResource('users', userSchema);

// Custom message handlers
userService.messageHandler('user.authenticate', async (data) => {
  const { email, password } = data;
  // In real app, verify password
  const users = await userService.resources.users.query({
    filter: { email }
  });
  
  if (users.data.length > 0) {
    return { authenticated: true, user: users.data[0] };
  }
  return { authenticated: false };
});

// Service 2: Order Service
const orderService = createApi();
orderService.use(MicroservicesPlugin, {
  serviceName: 'order-service',
  transport: 'memory',
  options: {
    port: 3002
  },
  circuitBreaker: {
    failureThreshold: 3,
    resetTimeout: 30000
  }
});

const orderSchema = new Schema({
  id: { type: 'id' },
  userId: { type: 'id', required: true },
  items: { type: 'array', required: true },
  total: { type: 'number', required: true },
  status: { type: 'string', default: 'pending' },
  createdAt: { type: 'timestamp' }
});

orderService.addResource('orders', orderSchema);

// React to order events
orderService.eventHandler('order.created', async (data) => {
  console.log('Order created event received:', data);
  
  // Fetch user details from user service
  try {
    const user = await orderService.sendMessage(
      'user-service',
      'users.get',
      { id: data.data.userId }
    );
    
    console.log('Order created for user:', user.data.attributes.name);
    
    // Could send email, update inventory, etc.
  } catch (error) {
    console.error('Failed to fetch user:', error);
  }
});

// Hook to emit events
orderService.hook('afterInsert', async (context) => {
  if (context.options.type === 'orders') {
    // Emit order created event
    await orderService.emitEvent('order.created', {
      type: 'orders',
      data: context.result
    });
  }
});

// Service 3: Notification Service
const notificationService = createApi();
notificationService.use(MicroservicesPlugin, {
  serviceName: 'notification-service',
  transport: 'memory'
});

// Listen to multiple events
notificationService.eventHandler('order.created', async (data) => {
  console.log('📧 Sending order confirmation email...');
  
  // Fetch user details
  try {
    const userResponse = await notificationService.sendMessage(
      'user-service',
      'users.get',
      { id: data.data.userId }
    );
    
    const user = userResponse.data.attributes;
    console.log(`📧 Email sent to ${user.email} for order ${data.data.id}`);
  } catch (error) {
    console.error('Failed to send notification:', error);
  }
});

notificationService.eventHandler('user.created', async (data) => {
  console.log('📧 Sending welcome email to:', data.data.email);
});

// Example usage
async function demo() {
  console.log('🚀 Starting microservices demo...\n');
  
  // Create a user
  console.log('1. Creating a user...');
  const user = await userService.resources.users.create({
    name: 'John Doe',
    email: 'john@example.com',
    role: 'customer'
  });
  console.log('User created:', user.data);
  
  // Authenticate user (via message pattern)
  console.log('\n2. Authenticating user...');
  const authResult = await userService.sendMessage(
    'user-service',
    'user.authenticate',
    { email: 'john@example.com', password: 'secret' }
  );
  console.log('Authentication result:', authResult);
  
  // Create an order (will trigger events)
  console.log('\n3. Creating an order...');
  const order = await orderService.resources.orders.create({
    userId: user.data.id,
    items: [
      { productId: 1, quantity: 2, price: 29.99 },
      { productId: 2, quantity: 1, price: 49.99 }
    ],
    total: 109.97
  });
  console.log('Order created:', order.data);
  
  // Query orders from another service
  console.log('\n4. Querying orders from notification service...');
  try {
    const orders = await notificationService.sendMessage(
      'order-service',
      'orders.query',
      { filter: { userId: user.data.id } }
    );
    console.log('Orders found:', orders.data.length);
  } catch (error) {
    console.error('Failed to query orders:', error.message);
  }
  
  // Service discovery
  console.log('\n5. Service discovery...');
  const userServiceInfo = userService.discoverService('user-service');
  console.log('User service info:', userServiceInfo);
  
  // Health check example
  console.log('\n6. Setting up health checks...');
  userService.setHealthCheck('order-service', async () => {
    // Try to ping the order service
    await orderService.sendMessage('order-service', 'health', {});
  });
  
  // Register custom health check handler
  orderService.messageHandler('health', async () => {
    return { status: 'healthy', timestamp: Date.now() };
  });
}

// Run the demo
demo().catch(console.error);

// Example: Using with Redis transport (production)
function createProductionServices() {
  // User Service with Redis
  const userServiceProd = createApi();
  userServiceProd.use(MicroservicesPlugin, {
    serviceName: 'user-service',
    transport: 'redis',
    options: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 60000
    },
    healthCheck: {
      interval: 30000
    }
  });
  
  // Add resources and handlers...
  userServiceProd.addResource('users', userSchema);
  
  return userServiceProd;
}

// Example: Using with TCP transport
function createTcpServices() {
  const inventoryService = createApi();
  inventoryService.use(MicroservicesPlugin, {
    serviceName: 'inventory-service',
    transport: 'tcp',
    options: {
      host: '0.0.0.0',
      port: 3003
    }
  });
  
  const inventorySchema = new Schema({
    id: { type: 'id' },
    productId: { type: 'id', required: true },
    quantity: { type: 'number', required: true },
    warehouse: { type: 'string' }
  });
  
  inventoryService.addResource('inventory', inventorySchema);
  
  // React to order events to update inventory
  inventoryService.eventHandler('order.created', async (data) => {
    const { items } = data.data;
    
    for (const item of items) {
      const inventory = await inventoryService.resources.inventory.query({
        filter: { productId: item.productId }
      });
      
      if (inventory.data.length > 0) {
        const currentStock = inventory.data[0];
        await inventoryService.resources.inventory.update(
          currentStock.id,
          { quantity: currentStock.attributes.quantity - item.quantity }
        );
      }
    }
  });
  
  return inventoryService;
}

// Example: Gateway pattern
function createApiGateway() {
  const gateway = createApi();
  gateway.use(MicroservicesPlugin, {
    serviceName: 'api-gateway',
    transport: 'memory' // or 'redis' for production
  });
  
  // Aggregate data from multiple services
  gateway.messageHandler('order.getWithDetails', async (data) => {
    const { orderId } = data;
    
    // Fetch order
    const orderResponse = await gateway.sendMessage(
      'order-service',
      'orders.get',
      { id: orderId }
    );
    
    const order = orderResponse.data;
    
    // Fetch user details
    const userResponse = await gateway.sendMessage(
      'user-service', 
      'users.get',
      { id: order.attributes.userId }
    );
    
    // Combine and return
    return {
      order: order,
      user: userResponse.data,
      _aggregatedAt: Date.now()
    };
  });
  
  return gateway;
}