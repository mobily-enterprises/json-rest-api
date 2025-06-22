import { createApi, Schema } from '../index.js';
import { CQRSPlugin, Command, Query, Event } from '../plugins/enterprise/cqrs.js';

// Example: Implementing CQRS with JSON-REST-API

// 1. Basic CQRS - Separate command and query handlers
async function basicCQRSExample() {
  console.log('=== Basic CQRS Example ===\n');
  
  const api = createApi();
  api.use(CQRSPlugin);
  
  // Define schema
  const userSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    status: { type: 'string', default: 'active' }
  });
  
  api.addResource('users', userSchema);
  
  // Custom command handlers
  api.command('ActivateUser', async (command) => {
    const { userId } = command.data;
    
    // Business logic for activation
    const user = await api.resources.users.get(userId);
    if (user.data.attributes.status === 'active') {
      throw new Error('User is already active');
    }
    
    const result = await api.resources.users.update(userId, {
      status: 'active',
      activatedAt: new Date().toISOString()
    });
    
    console.log(`✅ User ${userId} activated`);
    return result;
  });
  
  // Custom query handlers
  api.query('GetActiveUsers', async (query) => {
    const { limit = 10 } = query.criteria;
    
    const result = await api.resources.users.query({
      filter: { status: 'active' },
      page: { size: limit },
      sort: [{ field: 'name', direction: 'ASC' }]
    });
    
    console.log(`📊 Found ${result.data.length} active users`);
    return result;
  });
  
  // Usage
  // Create user (auto-generated command)
  const createCommand = new Command({
    name: 'John Doe',
    email: 'john@example.com',
    status: 'pending'
  });
  
  // Using class name for auto-generated commands
  createCommand.constructor.name = 'CreateUsers';
  const createResult = await api.execute(createCommand);
  console.log('Created user:', createResult.data.id);
  
  // Activate user (custom command)
  const activateCommand = new Command({ userId: createResult.data.id });
  activateCommand.constructor.name = 'ActivateUser';
  await api.execute(activateCommand);
  
  // Query active users (custom query)
  const activeQuery = new Query({ limit: 5 });
  activeQuery.constructor.name = 'GetActiveUsers';
  const activeUsers = await api.execute(activeQuery);
  console.log('Active users:', activeUsers.data.length);
}

// 2. Event Sourcing Example
async function eventSourcingExample() {
  console.log('\n=== Event Sourcing Example ===\n');
  
  const api = createApi();
  api.use(CQRSPlugin, {
    eventStore: true,
    projections: true
  });
  
  // Order schema
  const orderSchema = new Schema({
    id: { type: 'id' },
    customerId: { type: 'id', required: true },
    items: { type: 'array', required: true },
    status: { type: 'string', default: 'pending' },
    total: { type: 'number', default: 0 }
  });
  
  api.addResource('orders', orderSchema);
  
  // Domain event handlers
  api.onDomainEvent('OrderCreated', (event) => {
    console.log(`📦 Order created: ${event.aggregateId}`);
  });
  
  api.onDomainEvent('OrderShipped', (event) => {
    console.log(`🚚 Order shipped: ${event.aggregateId} - Tracking: ${event.data.trackingNumber}`);
  });
  
  // Custom command with events
  api.command('ShipOrder', async (command) => {
    const { orderId, trackingNumber } = command.data;
    
    // Update order
    const result = await api.resources.orders.update(orderId, {
      status: 'shipped',
      shippedAt: new Date().toISOString(),
      trackingNumber
    });
    
    // Emit custom domain event
    const event = new Event('OrderShipped', {
      orderId,
      trackingNumber,
      shippedAt: new Date().toISOString()
    }, orderId);
    
    await api.emitDomainEvent(event);
    
    return result;
  });
  
  // Create order
  const order = await api.resources.orders.create({
    customerId: '123',
    items: [
      { productId: '1', quantity: 2, price: 29.99 },
      { productId: '2', quantity: 1, price: 49.99 }
    ],
    total: 109.97
  });
  
  // Ship order
  const shipCommand = new Command({
    orderId: order.data.id,
    trackingNumber: 'TRACK123456'
  });
  shipCommand.constructor.name = 'ShipOrder';
  await api.execute(shipCommand);
  
  // View event store
  const eventStore = api.getEventStore();
  const events = await eventStore.getEvents(order.data.id);
  console.log('\n📚 Event history for order:', events.length, 'events');
  events.forEach(e => console.log(`  - ${e.type} at ${new Date(e.timestamp).toISOString()}`));
}

// 3. Projections Example - Building read models from events
async function projectionsExample() {
  console.log('\n=== Projections Example ===\n');
  
  const api = createApi();
  api.use(CQRSPlugin, {
    eventStore: true,
    projections: true
  });
  
  // Product schema
  const productSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    stock: { type: 'number', default: 0 }
  });
  
  api.addResource('products', productSchema);
  api.addResource('orders', new Schema({
    id: { type: 'id' },
    items: { type: 'array' }
  }));
  
  // Sales statistics projection
  const salesStats = {
    handles: ['OrderCreated'],
    stats: new Map(),
    
    async handle(event) {
      const order = event.data;
      
      for (const item of order.attributes.items) {
        const productId = item.productId;
        const current = this.stats.get(productId) || {
          productId,
          totalSold: 0,
          revenue: 0
        };
        
        current.totalSold += item.quantity;
        current.revenue += item.quantity * item.price;
        
        this.stats.set(productId, current);
      }
    },
    
    async reset() {
      this.stats.clear();
    },
    
    getStats() {
      return Array.from(this.stats.values());
    }
  };
  
  api.projection('salesStatistics', salesStats);
  
  // Create some products
  const product1 = await api.resources.products.create({
    name: 'Widget',
    price: 29.99,
    stock: 100
  });
  
  const product2 = await api.resources.products.create({
    name: 'Gadget',
    price: 49.99,
    stock: 50
  });
  
  // Create orders (will update projection)
  await api.resources.orders.create({
    items: [
      { productId: product1.data.id, quantity: 5, price: 29.99 },
      { productId: product2.data.id, quantity: 2, price: 49.99 }
    ]
  });
  
  await api.resources.orders.create({
    items: [
      { productId: product1.data.id, quantity: 3, price: 29.99 }
    ]
  });
  
  // Get sales statistics from projection
  console.log('📊 Sales Statistics:');
  const stats = salesStats.getStats();
  stats.forEach(stat => {
    console.log(`  Product ${stat.productId}: ${stat.totalSold} sold, $${stat.revenue.toFixed(2)} revenue`);
  });
}

// 4. Separate Read/Write Databases
async function separateDatabasesExample() {
  console.log('\n=== Separate Read/Write Databases Example ===\n');
  
  const api = createApi();
  
  // Configure with separate databases
  api.use(CQRSPlugin, {
    separateDatabases: true,
    writeDatabase: {
      plugin: 'memory',  // Could be 'mysql' in production
      options: {}
    },
    readDatabase: {
      plugin: 'memory',  // Could be different, optimized for reads
      options: {}
    },
    eventStore: true
  });
  
  // Product catalog schema
  const catalogSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    price: { type: 'number', required: true },
    category: { type: 'string' },
    tags: { type: 'array' }
  });
  
  api.addResource('products', catalogSchema);
  
  // Commands go to write database
  api.command('UpdateProductPrice', async (command) => {
    const { productId, newPrice, reason } = command.data;
    
    // Complex business logic here
    if (newPrice < 0) {
      throw new Error('Price cannot be negative');
    }
    
    const result = await api._writeApi.resources.products.update(productId, {
      price: newPrice,
      lastPriceChange: new Date().toISOString(),
      priceChangeReason: reason
    });
    
    // Emit event for synchronization
    await api.emitDomainEvent(new Event('ProductPriceChanged', {
      productId,
      oldPrice: result.data.attributes.price,
      newPrice,
      reason
    }, productId));
    
    console.log(`💰 Product ${productId} price updated to $${newPrice}`);
    return result;
  });
  
  // Queries go to read database (eventually consistent)
  api.query('SearchProducts', async (query) => {
    const { category, maxPrice } = query.criteria;
    
    const filters = {};
    if (category) filters.category = category;
    if (maxPrice) filters.price = { lte: maxPrice };
    
    const results = await api._readApi.resources.products.query({
      filter: filters,
      sort: [{ field: 'price', direction: 'ASC' }]
    });
    
    console.log(`🔍 Found ${results.data.length} products matching criteria`);
    return results;
  });
  
  // Create products in write DB
  const product = await api._writeApi.resources.products.create({
    name: 'Premium Widget',
    description: 'High-quality widget',
    price: 99.99,
    category: 'widgets',
    tags: ['premium', 'bestseller']
  });
  
  // Wait a moment for sync (in real system this would be eventual consistency)
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Query from read DB
  const searchQuery = new Query({ category: 'widgets', maxPrice: 150 });
  searchQuery.constructor.name = 'SearchProducts';
  const results = await api.execute(searchQuery);
  
  console.log('Products in read database:', results.data.length);
  
  // Update price through command
  const priceCommand = new Command({
    productId: product.data.id,
    newPrice: 79.99,
    reason: 'Holiday sale'
  });
  priceCommand.constructor.name = 'UpdateProductPrice';
  await api.execute(priceCommand);
}

// 5. Complex Saga Example
async function sagaExample() {
  console.log('\n=== Saga Example ===\n');
  
  const api = createApi();
  api.use(CQRSPlugin, {
    eventStore: true,
    sagas: true
  });
  
  // Resources
  api.addResource('orders', new Schema({
    id: { type: 'id' },
    status: { type: 'string' },
    total: { type: 'number' }
  }));
  
  api.addResource('payments', new Schema({
    id: { type: 'id' },
    orderId: { type: 'id' },
    status: { type: 'string' },
    amount: { type: 'number' }
  }));
  
  api.addResource('shipments', new Schema({
    id: { type: 'id' },
    orderId: { type: 'id' },
    status: { type: 'string' }
  }));
  
  // Order fulfillment saga
  class OrderFulfillmentSaga {
    constructor() {
      this.state = {};
    }
    
    get startsWith() {
      return ['OrderCreated'];
    }
    
    get handles() {
      return ['OrderCreated', 'PaymentProcessed', 'PaymentFailed', 'ShipmentCreated'];
    }
    
    async handle(event) {
      console.log(`🔄 Saga handling: ${event.type}`);
      
      switch (event.type) {
        case 'OrderCreated':
          this.state.orderId = event.aggregateId;
          this.state.amount = event.data.attributes.total;
          
          // Start payment process
          const payment = await api.resources.payments.create({
            orderId: this.state.orderId,
            amount: this.state.amount,
            status: 'processing'
          });
          
          // Simulate payment processing
          setTimeout(async () => {
            await api.emitDomainEvent(new Event('PaymentProcessed', {
              paymentId: payment.data.id,
              orderId: this.state.orderId
            }, payment.data.id));
          }, 1000);
          break;
          
        case 'PaymentProcessed':
          // Create shipment
          const shipment = await api.resources.shipments.create({
            orderId: this.state.orderId,
            status: 'preparing'
          });
          
          await api.emitDomainEvent(new Event('ShipmentCreated', {
            shipmentId: shipment.data.id,
            orderId: this.state.orderId
          }, shipment.data.id));
          break;
          
        case 'ShipmentCreated':
          // Complete order
          await api.resources.orders.update(this.state.orderId, {
            status: 'completed'
          });
          
          console.log(`✅ Order ${this.state.orderId} fulfilled!`);
          this.state.completed = true;
          break;
          
        case 'PaymentFailed':
          // Compensate - cancel order
          await api.resources.orders.update(this.state.orderId, {
            status: 'cancelled'
          });
          
          console.log(`❌ Order ${this.state.orderId} cancelled due to payment failure`);
          this.state.completed = true;
          break;
      }
    }
    
    isComplete() {
      return this.state.completed;
    }
  }
  
  // Register saga
  api.saga('OrderFulfillment', OrderFulfillmentSaga);
  
  // Create an order - saga will handle the rest
  console.log('Creating order...');
  const order = await api.resources.orders.create({
    status: 'pending',
    total: 99.99
  });
  
  // Wait for saga to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
}

// Run all examples
async function runExamples() {
  try {
    await basicCQRSExample();
    await eventSourcingExample();
    await projectionsExample();
    await separateDatabasesExample();
    await sagaExample();
    
    console.log('\n✅ All CQRS examples completed!');
  } catch (error) {
    console.error('Error:', error);
  }
}

runExamples();