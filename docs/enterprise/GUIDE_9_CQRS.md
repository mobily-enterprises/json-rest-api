# CQRS with JSON-REST-API: A Practical Guide

## Table of Contents

1. [Introduction](#introduction)
2. [When to Use CQRS](#when-to-use-cqrs)
3. [Basic CQRS Implementation](#basic-cqrs-implementation)
4. [Event Sourcing](#event-sourcing)
5. [Projections](#projections)
6. [Sagas](#sagas)
7. [Separate Databases](#separate-databases)
8. [Real-World Examples](#real-world-examples)
9. [Testing CQRS](#testing-cqrs)
10. [Migration Strategy](#migration-strategy)
11. [Common Pitfalls](#common-pitfalls)
12. [Performance Considerations](#performance-considerations)

## Introduction

CQRS (Command Query Responsibility Segregation) is an architectural pattern that separates read and write operations into different models. While JSON-REST-API is designed for simplicity, the CQRSPlugin allows you to adopt this pattern when your application truly needs it.

### What is CQRS?

In traditional applications:
```javascript
// Same model for reads and writes
await api.resources.products.get(123);        // Read
await api.resources.products.update(123, {}); // Write
```

With CQRS:
```javascript
// Commands for writes
await api.execute(new UpdateProductPriceCommand(123, 79.99));

// Queries for reads  
await api.execute(new GetProductDetailsQuery(123));
```

### Why CQRS in JSON-REST-API?

JSON-REST-API's philosophy is simplicity, but we recognize that some applications genuinely need CQRS:

- **High-traffic e-commerce**: Millions of product views, thousands of updates
- **Financial systems**: Audit requirements, event sourcing needs
- **Analytics platforms**: Complex aggregations, real-time dashboards
- **Multi-tenant SaaS**: Different read/write patterns per tenant

## When to Use CQRS

### ✅ Use CQRS When You Have:

1. **Dramatically Different Read/Write Patterns**
   ```javascript
   // Writes: Simple updates
   await updateProductPrice(id, newPrice);
   
   // Reads: Complex aggregations
   await getProductWithReviews(id, {
     includeStats: true,
     includeRelated: true,
     includePriceHistory: true
   });
   ```

2. **Performance Requirements**
   - Read-heavy system (100:1 read/write ratio)
   - Need different scaling strategies
   - Complex queries slowing down writes

3. **Business Requirements**
   - Audit trail requirements
   - Time-travel/undo functionality
   - Complex business workflows

4. **Team Structure**
   - Separate teams for different features
   - Need clear boundaries between domains

### ❌ Don't Use CQRS When:

1. **Simple CRUD Operations**
   ```javascript
   // If this works fine, you don't need CQRS
   await api.resources.users.update(id, { name: 'New Name' });
   ```

2. **Small Applications**
   - < 10k users
   - Simple business logic
   - No complex queries

3. **Rapid Prototyping**
   - MVPs
   - Proof of concepts
   - Early-stage startups

## Basic CQRS Implementation

### Step 1: Install the Plugin

```javascript
import { createApi } from 'json-rest-api';
import { CQRSPlugin, Command, Query } from 'json-rest-api';

const api = createApi();
api.use(CQRSPlugin);
```

### Step 2: Define Commands (Write Side)

Commands represent intentions to change the system state:

```javascript
// Task-oriented command
api.command('PlaceOrder', async (command) => {
  const { customerId, items, paymentMethod } = command.data;
  
  // Validate business rules
  const customer = await api.resources.customers.get(customerId);
  if (!customer.data.attributes.verified) {
    throw new Error('Customer must be verified to place orders');
  }
  
  // Calculate pricing
  const subtotal = items.reduce((sum, item) => 
    sum + (item.price * item.quantity), 0
  );
  const tax = subtotal * 0.08;
  const total = subtotal + tax;
  
  // Create order
  const order = await api.resources.orders.create({
    customerId,
    items,
    subtotal,
    tax,
    total,
    paymentMethod,
    status: 'pending'
  });
  
  // Side effects
  await chargePayment(order.data.id, total, paymentMethod);
  await reserveInventory(items);
  await sendOrderConfirmation(customer.data.attributes.email, order);
  
  return order;
});

// State transition command
api.command('CancelOrder', async (command) => {
  const { orderId, reason } = command.data;
  
  const order = await api.resources.orders.get(orderId);
  
  // Business rule: Can only cancel pending orders
  if (order.data.attributes.status !== 'pending') {
    throw new Error(`Cannot cancel order in ${order.data.attributes.status} status`);
  }
  
  // Update state
  await api.resources.orders.update(orderId, {
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: reason
  });
  
  // Compensating actions
  await refundPayment(order.data.id);
  await releaseInventory(order.data.attributes.items);
  
  return { success: true, orderId };
});
```

### Step 3: Define Queries (Read Side)

Queries retrieve data without side effects:

```javascript
// Simple query
api.query('GetOrderHistory', async (query) => {
  const { customerId, dateRange, status } = query.criteria;
  
  const filter = { customerId };
  if (status) filter.status = status;
  if (dateRange) {
    filter.createdAt = { between: dateRange };
  }
  
  return await api.resources.orders.query({
    filter,
    sort: [{ field: 'createdAt', direction: 'DESC' }],
    joins: ['items.product']
  });
});

// Complex aggregation query
api.query('GetCustomerDashboard', async (query) => {
  const { customerId } = query.criteria;
  
  // Multiple data sources
  const [customer, orders, wishlist, recommendations] = await Promise.all([
    api.resources.customers.get(customerId),
    api.resources.orders.query({ 
      filter: { customerId },
      page: { size: 5 },
      sort: [{ field: 'createdAt', direction: 'DESC' }]
    }),
    api.resources.wishlists.query({ filter: { customerId } }),
    getRecommendations(customerId)
  ]);
  
  // Calculate stats
  const totalSpent = orders.data.reduce((sum, order) => 
    sum + order.attributes.total, 0
  );
  
  return {
    customer: customer.data,
    recentOrders: orders.data,
    wishlistCount: wishlist.meta.total,
    recommendations,
    stats: {
      totalOrders: orders.meta.total,
      totalSpent,
      memberSince: customer.data.attributes.createdAt
    }
  };
});
```

### Step 4: Execute Commands and Queries

```javascript
// Execute command
const placeOrderCmd = new Command({
  customerId: '123',
  items: [
    { productId: 'abc', quantity: 2, price: 29.99 }
  ],
  paymentMethod: { type: 'card', token: 'tok_123' }
});
placeOrderCmd.constructor.name = 'PlaceOrder';

try {
  const result = await api.execute(placeOrderCmd);
  console.log('Order placed:', result.data.id);
} catch (error) {
  console.error('Failed to place order:', error.message);
}

// Execute query
const dashboardQuery = new Query({ customerId: '123' });
dashboardQuery.constructor.name = 'GetCustomerDashboard';

const dashboard = await api.execute(dashboardQuery);
```

## Event Sourcing

Event sourcing stores all changes as a sequence of events, allowing you to rebuild state at any point in time.

### Enable Event Sourcing

```javascript
api.use(CQRSPlugin, {
  eventStore: true
});
```

### Emit Domain Events

```javascript
api.command('UpdateProductPrice', async (command) => {
  const { productId, newPrice, reason } = command.data;
  
  // Get current state
  const product = await api.resources.products.get(productId);
  const oldPrice = product.data.attributes.price;
  
  // Validate
  if (newPrice === oldPrice) {
    return product; // No change needed
  }
  
  // Update state
  const updated = await api.resources.products.update(productId, {
    price: newPrice,
    lastPriceUpdate: new Date()
  });
  
  // Emit event with full context
  await api.emitDomainEvent(new Event(
    'ProductPriceChanged',
    {
      productId,
      oldPrice,
      newPrice,
      reason,
      percentageChange: ((newPrice - oldPrice) / oldPrice) * 100,
      updatedBy: command.userId
    },
    productId // Aggregate ID
  ));
  
  return updated;
});
```

### Subscribe to Events

```javascript
// React to price changes
api.onDomainEvent('ProductPriceChanged', async (event) => {
  const { productId, oldPrice, newPrice, percentageChange } = event.data;
  
  // Update search index
  await updateSearchIndex(productId, { price: newPrice });
  
  // Notify customers if price dropped
  if (newPrice < oldPrice) {
    await notifyWishlistCustomers(productId, {
      oldPrice,
      newPrice,
      discount: percentageChange
    });
  }
  
  // Track metrics
  await trackPriceChange({
    productId,
    change: percentageChange,
    timestamp: event.timestamp
  });
});

// Audit all events
api.onDomainEvent('*', async (event) => {
  await auditLog.record({
    eventType: event.type,
    aggregateId: event.aggregateId,
    data: event.data,
    timestamp: event.timestamp
  });
});
```

### Rebuild State from Events

```javascript
// Get all events for a product
const eventStore = api.getEventStore();
const events = await eventStore.getEvents(productId);

// Rebuild price history
const priceHistory = events
  .filter(e => e.type === 'ProductPriceChanged')
  .map(e => ({
    price: e.data.newPrice,
    date: new Date(e.timestamp),
    reason: e.data.reason
  }));

// Time travel - get state at specific time
async function getProductStateAt(productId, timestamp) {
  const events = await eventStore.getEvents(productId);
  const relevantEvents = events.filter(e => e.timestamp <= timestamp);
  
  // Replay events to rebuild state
  let state = { id: productId };
  for (const event of relevantEvents) {
    state = applyEvent(state, event);
  }
  
  return state;
}
```

## Projections

Projections build read-optimized views from events, perfect for complex queries and reporting.

### Enable Projections

```javascript
api.use(CQRSPlugin, {
  eventStore: true,
  projections: true
});
```

### Define a Projection

```javascript
// Customer order statistics projection
const customerStatsProjection = {
  // Events this projection processes
  handles: ['OrderCreated', 'OrderCancelled', 'OrderCompleted'],
  
  // Internal state
  stats: new Map(),
  
  // Initialize a customer's stats
  initCustomer(customerId) {
    return {
      customerId,
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      totalSpent: 0,
      averageOrderValue: 0,
      lastOrderDate: null,
      favoriteCategory: null,
      categoryPurchases: new Map()
    };
  },
  
  // Process events
  async handle(event) {
    switch (event.type) {
      case 'OrderCreated': {
        const order = event.data;
        const customerId = order.attributes.customerId;
        
        // Get or create customer stats
        let stats = this.stats.get(customerId) || this.initCustomer(customerId);
        
        // Update stats
        stats.totalOrders++;
        stats.lastOrderDate = event.timestamp;
        
        // Track category purchases
        for (const item of order.attributes.items) {
          const category = item.category || 'uncategorized';
          const count = stats.categoryPurchases.get(category) || 0;
          stats.categoryPurchases.set(category, count + item.quantity);
        }
        
        this.stats.set(customerId, stats);
        break;
      }
      
      case 'OrderCompleted': {
        const { customerId, orderId, total } = event.data;
        let stats = this.stats.get(customerId);
        
        if (stats) {
          stats.completedOrders++;
          stats.totalSpent += total;
          stats.averageOrderValue = stats.totalSpent / stats.completedOrders;
          
          // Update favorite category
          const favorite = Array.from(stats.categoryPurchases.entries())
            .sort((a, b) => b[1] - a[1])[0];
          if (favorite) {
            stats.favoriteCategory = favorite[0];
          }
          
          this.stats.set(customerId, stats);
        }
        break;
      }
      
      case 'OrderCancelled': {
        const { customerId } = event.data;
        let stats = this.stats.get(customerId);
        
        if (stats) {
          stats.cancelledOrders++;
          this.stats.set(customerId, stats);
        }
        break;
      }
    }
  },
  
  // Query methods
  getCustomerStats(customerId) {
    return this.stats.get(customerId) || this.initCustomer(customerId);
  },
  
  getTopCustomers(limit = 10) {
    return Array.from(this.stats.values())
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  },
  
  getCustomersByCategory(category) {
    return Array.from(this.stats.values())
      .filter(stats => stats.favoriteCategory === category)
      .map(stats => stats.customerId);
  },
  
  // Reset for rebuilding
  async reset() {
    this.stats.clear();
  }
};

// Register projection
api.projection('customerStats', customerStatsProjection);

// Use in queries
api.query('GetCustomerStats', async (query) => {
  const projection = api._cqrs.projectionManager.projections.get('customerStats');
  return projection.getCustomerStats(query.criteria.customerId);
});

api.query('GetTopCustomers', async (query) => {
  const projection = api._cqrs.projectionManager.projections.get('customerStats');
  return projection.getTopCustomers(query.criteria.limit);
});
```

### Product Catalog Projection

```javascript
// Denormalized product catalog for fast searches
const productCatalogProjection = {
  handles: [
    'ProductCreated', 
    'ProductUpdated', 
    'ProductPriceChanged',
    'ReviewAdded',
    'InventoryUpdated'
  ],
  
  catalog: new Map(),
  
  async handle(event) {
    const productId = event.aggregateId;
    let product = this.catalog.get(productId) || {
      id: productId,
      reviews: [],
      priceHistory: []
    };
    
    switch (event.type) {
      case 'ProductCreated':
      case 'ProductUpdated':
        Object.assign(product, event.data.attributes);
        break;
        
      case 'ProductPriceChanged':
        product.price = event.data.newPrice;
        product.priceHistory.push({
          price: event.data.newPrice,
          date: event.timestamp,
          reason: event.data.reason
        });
        
        // Calculate price trend
        if (product.priceHistory.length > 1) {
          const recent = product.priceHistory.slice(-5);
          const trend = recent[recent.length - 1].price - recent[0].price;
          product.priceTrend = trend > 0 ? 'increasing' : 'decreasing';
        }
        break;
        
      case 'ReviewAdded':
        product.reviews.push({
          rating: event.data.rating,
          comment: event.data.comment,
          userId: event.data.userId,
          date: event.timestamp
        });
        
        // Recalculate average rating
        const totalRating = product.reviews.reduce((sum, r) => sum + r.rating, 0);
        product.averageRating = totalRating / product.reviews.length;
        product.reviewCount = product.reviews.length;
        break;
        
      case 'InventoryUpdated':
        product.stock = event.data.newQuantity;
        product.inStock = event.data.newQuantity > 0;
        product.lowStock = event.data.newQuantity < 10;
        break;
    }
    
    // Update search keywords
    product.searchKeywords = [
      product.name,
      product.category,
      product.brand,
      ...(product.tags || [])
    ].filter(Boolean).join(' ').toLowerCase();
    
    this.catalog.set(productId, product);
  },
  
  // Rich query methods
  search(criteria) {
    const { 
      query, 
      category, 
      minPrice, 
      maxPrice, 
      inStock,
      minRating 
    } = criteria;
    
    let results = Array.from(this.catalog.values());
    
    if (query) {
      const searchTerm = query.toLowerCase();
      results = results.filter(p => 
        p.searchKeywords.includes(searchTerm)
      );
    }
    
    if (category) {
      results = results.filter(p => p.category === category);
    }
    
    if (minPrice !== undefined) {
      results = results.filter(p => p.price >= minPrice);
    }
    
    if (maxPrice !== undefined) {
      results = results.filter(p => p.price <= maxPrice);
    }
    
    if (inStock) {
      results = results.filter(p => p.inStock);
    }
    
    if (minRating !== undefined) {
      results = results.filter(p => p.averageRating >= minRating);
    }
    
    return results;
  },
  
  getByIds(ids) {
    return ids.map(id => this.catalog.get(id)).filter(Boolean);
  },
  
  getCategories() {
    const categories = new Map();
    
    for (const product of this.catalog.values()) {
      const count = categories.get(product.category) || 0;
      categories.set(product.category, count + 1);
    }
    
    return Array.from(categories.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }
};

api.projection('productCatalog', productCatalogProjection);
```

## Sagas

Sagas orchestrate complex business processes that span multiple aggregates or services.

### Enable Sagas

```javascript
api.use(CQRSPlugin, {
  eventStore: true,
  sagas: true
});
```

### Order Fulfillment Saga

```javascript
class OrderFulfillmentSaga {
  constructor() {
    this.state = {
      orderId: null,
      customerId: null,
      items: [],
      total: 0,
      paymentId: null,
      shipmentId: null,
      status: 'started',
      startedAt: Date.now(),
      completedAt: null,
      failureReason: null,
      compensations: []
    };
  }
  
  // Events that can start this saga
  get startsWith() {
    return ['OrderPlaced'];
  }
  
  // All events this saga handles
  get handles() {
    return [
      'OrderPlaced',
      'PaymentAuthorized',
      'PaymentFailed',
      'InventoryReserved',
      'InventoryReservationFailed',
      'ShipmentCreated',
      'ShipmentFailed',
      'OrderFulfilled'
    ];
  }
  
  async handle(event) {
    console.log(`[Saga ${this.state.orderId}] Handling: ${event.type}`);
    
    switch (event.type) {
      case 'OrderPlaced':
        await this.handleOrderPlaced(event);
        break;
        
      case 'PaymentAuthorized':
        await this.handlePaymentAuthorized(event);
        break;
        
      case 'PaymentFailed':
        await this.handlePaymentFailed(event);
        break;
        
      case 'InventoryReserved':
        await this.handleInventoryReserved(event);
        break;
        
      case 'InventoryReservationFailed':
        await this.handleInventoryFailed(event);
        break;
        
      case 'ShipmentCreated':
        await this.handleShipmentCreated(event);
        break;
        
      case 'ShipmentFailed':
        await this.handleShipmentFailed(event);
        break;
    }
  }
  
  async handleOrderPlaced(event) {
    // Initialize saga state
    this.state.orderId = event.aggregateId;
    this.state.customerId = event.data.customerId;
    this.state.items = event.data.items;
    this.state.total = event.data.total;
    
    // Step 1: Authorize payment
    try {
      const payment = await api.resources.payments.create({
        orderId: this.state.orderId,
        customerId: this.state.customerId,
        amount: this.state.total,
        status: 'pending'
      });
      
      this.state.paymentId = payment.data.id;
      
      // Simulate payment processing
      await processPaymentAuthorization(payment.data.id);
    } catch (error) {
      await this.fail('Payment authorization failed: ' + error.message);
    }
  }
  
  async handlePaymentAuthorized(event) {
    if (event.data.orderId !== this.state.orderId) return;
    
    // Step 2: Reserve inventory
    try {
      const reservation = await api.resources.inventory.reserve({
        orderId: this.state.orderId,
        items: this.state.items
      });
      
      this.state.compensations.push({
        action: 'releaseInventory',
        data: { reservationId: reservation.data.id }
      });
    } catch (error) {
      await this.fail('Inventory reservation failed: ' + error.message);
    }
  }
  
  async handleInventoryReserved(event) {
    if (event.data.orderId !== this.state.orderId) return;
    
    // Step 3: Create shipment
    try {
      const shipment = await api.resources.shipments.create({
        orderId: this.state.orderId,
        customerId: this.state.customerId,
        items: this.state.items,
        status: 'preparing'
      });
      
      this.state.shipmentId = shipment.data.id;
      
      // Mark order as fulfilled
      await api.resources.orders.update(this.state.orderId, {
        status: 'fulfilled',
        fulfilledAt: new Date()
      });
      
      await api.emitDomainEvent(new Event(
        'OrderFulfilled',
        {
          orderId: this.state.orderId,
          paymentId: this.state.paymentId,
          shipmentId: this.state.shipmentId
        },
        this.state.orderId
      ));
      
      this.state.status = 'completed';
      this.state.completedAt = Date.now();
    } catch (error) {
      await this.fail('Shipment creation failed: ' + error.message);
    }
  }
  
  async handlePaymentFailed(event) {
    if (event.data.orderId !== this.state.orderId) return;
    await this.fail('Payment failed: ' + event.data.reason);
  }
  
  async handleInventoryFailed(event) {
    if (event.data.orderId !== this.state.orderId) return;
    await this.fail('Inventory unavailable: ' + event.data.reason);
  }
  
  async handleShipmentFailed(event) {
    if (event.data.orderId !== this.state.orderId) return;
    await this.fail('Shipment failed: ' + event.data.reason);
  }
  
  async fail(reason) {
    console.error(`[Saga ${this.state.orderId}] Failed: ${reason}`);
    
    this.state.status = 'failed';
    this.state.failureReason = reason;
    
    // Execute compensations in reverse order
    for (const compensation of this.state.compensations.reverse()) {
      try {
        await this.executeCompensation(compensation);
      } catch (error) {
        console.error('Compensation failed:', error);
      }
    }
    
    // Update order status
    await api.resources.orders.update(this.state.orderId, {
      status: 'failed',
      failureReason: reason
    });
    
    // Notify customer
    await api.emitDomainEvent(new Event(
      'OrderFulfillmentFailed',
      {
        orderId: this.state.orderId,
        reason,
        refundInitiated: !!this.state.paymentId
      },
      this.state.orderId
    ));
  }
  
  async executeCompensation(compensation) {
    switch (compensation.action) {
      case 'releaseInventory':
        await api.resources.inventory.release(compensation.data.reservationId);
        break;
        
      case 'refundPayment':
        await api.resources.payments.refund(compensation.data.paymentId);
        break;
        
      case 'cancelShipment':
        await api.resources.shipments.cancel(compensation.data.shipmentId);
        break;
    }
  }
  
  isComplete() {
    return ['completed', 'failed'].includes(this.state.status);
  }
  
  // Timeout handling
  getTimeout() {
    // Timeout after 10 minutes
    return 10 * 60 * 1000;
  }
  
  async handleTimeout() {
    await this.fail('Saga timeout - process took too long');
  }
}

// Register the saga
api.saga('OrderFulfillment', OrderFulfillmentSaga);
```

### Subscription Renewal Saga

```javascript
class SubscriptionRenewalSaga {
  constructor() {
    this.state = {
      subscriptionId: null,
      customerId: null,
      attempts: 0,
      maxAttempts: 3,
      status: 'started'
    };
  }
  
  get startsWith() {
    return ['SubscriptionDue'];
  }
  
  get handles() {
    return [
      'SubscriptionDue',
      'PaymentSucceeded',
      'PaymentFailed',
      'CustomerNotified',
      'SubscriptionCancelled'
    ];
  }
  
  async handle(event) {
    switch (event.type) {
      case 'SubscriptionDue':
        this.state.subscriptionId = event.data.subscriptionId;
        this.state.customerId = event.data.customerId;
        await this.attemptPayment();
        break;
        
      case 'PaymentSucceeded':
        if (event.data.subscriptionId === this.state.subscriptionId) {
          await this.renewSubscription();
        }
        break;
        
      case 'PaymentFailed':
        if (event.data.subscriptionId === this.state.subscriptionId) {
          await this.handlePaymentFailure();
        }
        break;
    }
  }
  
  async attemptPayment() {
    this.state.attempts++;
    
    const subscription = await api.resources.subscriptions.get(this.state.subscriptionId);
    const paymentMethod = await api.resources.paymentMethods.get(
      subscription.data.attributes.paymentMethodId
    );
    
    try {
      await api.resources.payments.create({
        subscriptionId: this.state.subscriptionId,
        customerId: this.state.customerId,
        amount: subscription.data.attributes.price,
        paymentMethodId: paymentMethod.data.id,
        description: `Subscription renewal - ${subscription.data.attributes.plan}`
      });
    } catch (error) {
      // Payment service will emit PaymentFailed event
    }
  }
  
  async handlePaymentFailure() {
    if (this.state.attempts < this.state.maxAttempts) {
      // Retry with exponential backoff
      const delay = Math.pow(2, this.state.attempts) * 1000 * 60; // 2, 4, 8 minutes
      
      setTimeout(() => this.attemptPayment(), delay);
      
      // Notify customer of retry
      await api.emitDomainEvent(new Event(
        'SubscriptionPaymentRetrying',
        {
          subscriptionId: this.state.subscriptionId,
          attempt: this.state.attempts,
          nextRetry: new Date(Date.now() + delay)
        }
      ));
    } else {
      // Max attempts reached - cancel subscription
      await api.resources.subscriptions.update(this.state.subscriptionId, {
        status: 'cancelled',
        cancelReason: 'payment_failed',
        cancelledAt: new Date()
      });
      
      await api.emitDomainEvent(new Event(
        'SubscriptionCancelled',
        {
          subscriptionId: this.state.subscriptionId,
          reason: 'Payment failed after multiple attempts'
        }
      ));
      
      this.state.status = 'failed';
    }
  }
  
  async renewSubscription() {
    const subscription = await api.resources.subscriptions.get(this.state.subscriptionId);
    const plan = await api.resources.plans.get(subscription.data.attributes.planId);
    
    // Calculate next billing date
    const nextBillingDate = new Date();
    if (plan.data.attributes.interval === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (plan.data.attributes.interval === 'yearly') {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }
    
    // Update subscription
    await api.resources.subscriptions.update(this.state.subscriptionId, {
      nextBillingDate,
      lastPaymentDate: new Date(),
      status: 'active'
    });
    
    // Grant access
    await grantSubscriptionAccess(this.state.customerId, plan.data.attributes.features);
    
    this.state.status = 'completed';
  }
  
  isComplete() {
    return ['completed', 'failed'].includes(this.state.status);
  }
}

api.saga('SubscriptionRenewal', SubscriptionRenewalSaga);
```

## Separate Databases

For extreme scale, you can use different databases optimized for reads vs writes.

### Configuration

```javascript
api.use(CQRSPlugin, {
  separateDatabases: true,
  
  // Write database - optimized for consistency
  writeDatabase: {
    plugin: 'mysql',
    options: {
      host: 'write-master.db.com',
      database: 'app_write',
      // Single master for consistency
      connectionLimit: 50
    }
  },
  
  // Read database - optimized for queries
  readDatabase: {
    plugin: 'mysql',
    options: {
      host: 'read-replica.db.com',
      database: 'app_read',
      // Multiple replicas for scale
      connectionLimit: 200
    }
  },
  
  // Enable event sync
  eventStore: true
});
```

### How It Works

1. **Commands write to write database**
   ```javascript
   api.command('CreateProduct', async (command) => {
     // Automatically uses writeDatabase
     return await api._writeApi.resources.products.create(command.data);
   });
   ```

2. **Events sync changes to read database**
   ```javascript
   // Automatic sync happens via domain events
   // When product is created in write DB, event is emitted
   // Event handler updates read DB
   ```

3. **Queries read from read database**
   ```javascript
   api.query('SearchProducts', async (query) => {
     // Automatically uses readDatabase
     return await api._readApi.resources.products.query({
       filter: query.criteria
     });
   });
   ```

### Custom Sync Logic

```javascript
// Customize how data syncs between databases
api.onDomainEvent('ProductCreated', async (event) => {
  const product = event.data;
  
  // Transform for read model
  const readModel = {
    ...product.attributes,
    searchText: [
      product.attributes.name,
      product.attributes.description,
      product.attributes.category
    ].join(' ').toLowerCase(),
    
    // Denormalize for faster queries
    categoryName: await getCategoryName(product.attributes.categoryId),
    brandName: await getBrandName(product.attributes.brandId)
  };
  
  // Insert into read database
  await api._readApi.resources.products.create(readModel);
});

// Handle updates with transformations
api.onDomainEvent('ProductUpdated', async (event) => {
  const { productId, changes } = event.data;
  
  // Apply transformations
  if (changes.name || changes.description) {
    changes.searchText = [
      changes.name || '',
      changes.description || ''
    ].join(' ').toLowerCase();
  }
  
  await api._readApi.resources.products.update(productId, changes);
});
```

## Real-World Examples

### E-Commerce Platform

```javascript
// Command: Complex checkout process
api.command('Checkout', async (command) => {
  const { cartId, shippingAddress, paymentMethod } = command.data;
  
  // Load cart with items
  const cart = await api.resources.carts.get(cartId, {
    joins: ['items.product']
  });
  
  // Validate inventory
  for (const item of cart.data.attributes.items) {
    const available = await checkInventory(
      item.productId, 
      item.quantity
    );
    if (!available) {
      throw new Error(`${item.product.name} is out of stock`);
    }
  }
  
  // Calculate totals
  const subtotal = calculateSubtotal(cart.data.attributes.items);
  const shipping = calculateShipping(shippingAddress, cart.data.attributes.items);
  const tax = calculateTax(subtotal, shippingAddress);
  const total = subtotal + shipping + tax;
  
  // Create order
  const order = await api.resources.orders.create({
    customerId: cart.data.attributes.customerId,
    items: cart.data.attributes.items,
    subtotal,
    shipping,
    tax,
    total,
    shippingAddress,
    status: 'pending'
  });
  
  // Process payment
  const payment = await processPayment({
    orderId: order.data.id,
    amount: total,
    method: paymentMethod
  });
  
  // Clear cart
  await api.resources.carts.update(cartId, {
    items: [],
    checkedOut: true
  });
  
  // Emit event to trigger fulfillment saga
  await api.emitDomainEvent(new Event(
    'OrderPlaced',
    {
      orderId: order.data.id,
      customerId: cart.data.attributes.customerId,
      items: cart.data.attributes.items,
      total,
      paymentId: payment.id
    },
    order.data.id
  ));
  
  return order;
});

// Query: Product recommendations
api.query('GetProductRecommendations', async (query) => {
  const { customerId, productId, limit = 10 } = query.criteria;
  
  // Get customer purchase history from projection
  const statsProjection = api._cqrs.projectionManager
    .projections.get('customerStats');
  const customerStats = statsProjection.getCustomerStats(customerId);
  
  // Get product details from catalog projection  
  const catalogProjection = api._cqrs.projectionManager
    .projections.get('productCatalog');
  const product = catalogProjection.catalog.get(productId);
  
  // Find similar products
  const recommendations = catalogProjection.search({
    category: product.category,
    minRating: 4,
    inStock: true
  })
  .filter(p => p.id !== productId)
  .filter(p => {
    // Filter by customer preferences
    if (customerStats.favoriteCategory) {
      return p.category === customerStats.favoriteCategory;
    }
    return true;
  })
  .sort((a, b) => {
    // Sort by relevance
    let scoreA = a.averageRating || 0;
    let scoreB = b.averageRating || 0;
    
    // Boost if in price range
    if (Math.abs(a.price - product.price) < product.price * 0.2) {
      scoreA += 1;
    }
    if (Math.abs(b.price - product.price) < product.price * 0.2) {
      scoreB += 1;
    }
    
    return scoreB - scoreA;
  })
  .slice(0, limit);
  
  return recommendations;
});
```

### SaaS Billing System

```javascript
// Command: Upgrade subscription
api.command('UpgradeSubscription', async (command) => {
  const { subscriptionId, newPlanId, immediate = false } = command.data;
  
  const subscription = await api.resources.subscriptions.get(subscriptionId);
  const currentPlan = await api.resources.plans.get(
    subscription.data.attributes.planId
  );
  const newPlan = await api.resources.plans.get(newPlanId);
  
  // Validate upgrade path
  if (newPlan.data.attributes.price <= currentPlan.data.attributes.price) {
    throw new Error('Can only upgrade to a higher tier');
  }
  
  if (immediate) {
    // Prorate the difference
    const daysRemaining = calculateDaysUntilNextBilling(subscription);
    const dailyRate = currentPlan.data.attributes.price / 30;
    const credit = dailyRate * daysRemaining;
    const amountDue = newPlan.data.attributes.price - credit;
    
    // Charge immediately
    await api.resources.payments.create({
      subscriptionId,
      amount: amountDue,
      description: `Upgrade from ${currentPlan.data.attributes.name} to ${newPlan.data.attributes.name}`
    });
    
    // Update subscription
    await api.resources.subscriptions.update(subscriptionId, {
      planId: newPlanId,
      upgradedAt: new Date()
    });
    
    // Grant new features immediately
    await grantPlanFeatures(subscription.data.attributes.customerId, newPlan);
  } else {
    // Schedule upgrade for next billing cycle
    await api.resources.subscriptions.update(subscriptionId, {
      pendingPlanId: newPlanId,
      pendingChangeDate: subscription.data.attributes.nextBillingDate
    });
  }
  
  // Emit event
  await api.emitDomainEvent(new Event(
    'SubscriptionUpgraded',
    {
      subscriptionId,
      customerId: subscription.data.attributes.customerId,
      fromPlan: currentPlan.data.attributes.name,
      toPlan: newPlan.data.attributes.name,
      immediate
    },
    subscriptionId
  ));
});

// Projection: Revenue analytics
const revenueProjection = {
  handles: [
    'SubscriptionCreated',
    'SubscriptionUpgraded',
    'SubscriptionDowngraded',
    'SubscriptionCancelled',
    'PaymentSucceeded'
  ],
  
  metrics: {
    mrr: 0, // Monthly Recurring Revenue
    arr: 0, // Annual Recurring Revenue
    churnRate: 0,
    averageRevenuePerUser: 0,
    customerLifetimeValue: 0,
    
    // Time series data
    mrrHistory: [],
    churnHistory: [],
    
    // Breakdown by plan
    planMetrics: new Map()
  },
  
  async handle(event) {
    switch (event.type) {
      case 'SubscriptionCreated': {
        const { planId, price } = event.data;
        this.metrics.mrr += price;
        this.updatePlanMetrics(planId, 1, price);
        break;
      }
      
      case 'SubscriptionUpgraded': {
        const { fromPrice, toPrice, planId } = event.data;
        const difference = toPrice - fromPrice;
        this.metrics.mrr += difference;
        this.recordExpansion(difference);
        break;
      }
      
      case 'SubscriptionCancelled': {
        const { price, planId } = event.data;
        this.metrics.mrr -= price;
        this.recordChurn(price);
        this.updatePlanMetrics(planId, -1, -price);
        break;
      }
    }
    
    // Update derived metrics
    this.metrics.arr = this.metrics.mrr * 12;
    this.metrics.averageRevenuePerUser = this.metrics.mrr / this.getActiveCustomers();
    
    // Record history (daily snapshots)
    const today = new Date().toISOString().split('T')[0];
    this.metrics.mrrHistory.push({
      date: today,
      mrr: this.metrics.mrr,
      customers: this.getActiveCustomers()
    });
  },
  
  getMetrics() {
    return this.metrics;
  },
  
  getMRRGrowth(days = 30) {
    const history = this.metrics.mrrHistory.slice(-days);
    if (history.length < 2) return 0;
    
    const start = history[0].mrr;
    const end = history[history.length - 1].mrr;
    return ((end - start) / start) * 100;
  }
};

api.projection('revenue', revenueProjection);
```

## Testing CQRS

### Testing Commands

```javascript
describe('PlaceOrder command', () => {
  let api;
  let events;
  
  beforeEach(() => {
    api = createApi();
    api.use(CQRSPlugin, { eventStore: true });
    
    events = [];
    api.onDomainEvent('*', (event) => events.push(event));
    
    // Define command
    api.command('PlaceOrder', async (command) => {
      const order = await api.resources.orders.create(command.data);
      await api.emitDomainEvent(new Event(
        'OrderPlaced',
        order.data,
        order.data.id
      ));
      return order;
    });
  });
  
  it('should create order and emit event', async () => {
    const command = new Command({
      customerId: '123',
      items: [{ productId: 'abc', quantity: 2, price: 10 }],
      total: 20
    });
    command.constructor.name = 'PlaceOrder';
    
    const result = await api.execute(command);
    
    // Verify order created
    expect(result.data.attributes.customerId).toBe('123');
    expect(result.data.attributes.total).toBe(20);
    
    // Verify event emitted
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('OrderPlaced');
    expect(events[0].aggregateId).toBe(result.data.id);
  });
  
  it('should handle validation errors', async () => {
    const command = new Command({
      customerId: '123',
      items: [], // No items
      total: 0
    });
    command.constructor.name = 'PlaceOrder';
    
    await expect(api.execute(command))
      .rejects
      .toThrow('Order must have items');
    
    expect(events).toHaveLength(0);
  });
});
```

### Testing Projections

```javascript
describe('CustomerStats projection', () => {
  let projection;
  
  beforeEach(() => {
    projection = {
      handles: ['OrderCreated', 'OrderCompleted'],
      stats: new Map(),
      
      handle(event) {
        // Implementation
      },
      
      getCustomerStats(customerId) {
        return this.stats.get(customerId) || { totalOrders: 0 };
      }
    };
  });
  
  it('should track customer orders', async () => {
    // Process events
    await projection.handle(new Event('OrderCreated', {
      attributes: {
        customerId: '123',
        total: 100,
        items: [{ category: 'electronics' }]
      }
    }));
    
    await projection.handle(new Event('OrderCompleted', {
      customerId: '123',
      total: 100
    }));
    
    // Verify projection state
    const stats = projection.getCustomerStats('123');
    expect(stats.totalOrders).toBe(1);
    expect(stats.totalSpent).toBe(100);
  });
  
  it('should rebuild from events', async () => {
    const events = [
      new Event('OrderCreated', { customerId: '123' }),
      new Event('OrderCreated', { customerId: '123' }),
      new Event('OrderCompleted', { customerId: '123', total: 50 }),
      new Event('OrderCompleted', { customerId: '123', total: 75 })
    ];
    
    // Reset and rebuild
    projection.stats.clear();
    for (const event of events) {
      await projection.handle(event);
    }
    
    const stats = projection.getCustomerStats('123');
    expect(stats.totalOrders).toBe(2);
    expect(stats.totalSpent).toBe(125);
  });
});
```

### Testing Sagas

```javascript
describe('OrderFulfillmentSaga', () => {
  let saga;
  let api;
  
  beforeEach(() => {
    api = createApi();
    api.use(CQRSPlugin, { sagas: true });
    saga = new OrderFulfillmentSaga();
  });
  
  it('should complete happy path', async () => {
    // Start saga
    await saga.handle(new Event('OrderPlaced', {
      customerId: '123',
      items: [{ productId: 'abc', quantity: 1 }],
      total: 100
    }, 'order-1'));
    
    expect(saga.state.orderId).toBe('order-1');
    expect(saga.state.status).toBe('started');
    
    // Process payment
    await saga.handle(new Event('PaymentAuthorized', {
      orderId: 'order-1',
      paymentId: 'pay-1'
    }));
    
    // Process inventory
    await saga.handle(new Event('InventoryReserved', {
      orderId: 'order-1'
    }));
    
    expect(saga.isComplete()).toBe(true);
    expect(saga.state.status).toBe('completed');
  });
  
  it('should handle payment failure', async () => {
    await saga.handle(new Event('OrderPlaced', {
      customerId: '123',
      total: 100
    }, 'order-1'));
    
    await saga.handle(new Event('PaymentFailed', {
      orderId: 'order-1',
      reason: 'Insufficient funds'
    }));
    
    expect(saga.isComplete()).toBe(true);
    expect(saga.state.status).toBe('failed');
    expect(saga.state.failureReason).toContain('Insufficient funds');
  });
  
  it('should execute compensations on failure', async () => {
    const compensations = [];
    saga.executeCompensation = jest.fn(async (comp) => {
      compensations.push(comp);
    });
    
    saga.state.compensations = [
      { action: 'releaseInventory', data: { reservationId: '1' } },
      { action: 'refundPayment', data: { paymentId: '2' } }
    ];
    
    await saga.fail('Test failure');
    
    // Compensations executed in reverse order
    expect(compensations[0].action).toBe('refundPayment');
    expect(compensations[1].action).toBe('releaseInventory');
  });
});
```

### Integration Testing

```javascript
describe('CQRS Integration', () => {
  let api;
  
  beforeEach(async () => {
    api = createApi();
    api.use(CQRSPlugin, {
      eventStore: true,
      projections: true,
      separateDatabases: true,
      writeDatabase: { plugin: 'memory' },
      readDatabase: { plugin: 'memory' }
    });
    
    // Set up resources
    api.addResource('products', productSchema);
    api.addResource('orders', orderSchema);
    
    // Set up projections
    api.projection('orderStats', orderStatsProjection);
  });
  
  it('should sync between write and read databases', async () => {
    // Execute command (writes to write DB)
    const createCmd = new Command({
      name: 'Test Product',
      price: 99.99
    });
    createCmd.constructor.name = 'CreateProducts';
    
    const product = await api.execute(createCmd);
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Query should read from read DB
    const query = new Query({ id: product.data.id });
    query.constructor.name = 'GetProductsById';
    
    const retrieved = await api.execute(query);
    expect(retrieved.data.attributes.name).toBe('Test Product');
  });
  
  it('should update projections from events', async () => {
    // Create order via command
    const orderCmd = new Command({
      customerId: '123',
      items: [{ productId: 'abc', quantity: 2, price: 50 }],
      total: 100
    });
    orderCmd.constructor.name = 'CreateOrders';
    
    await api.execute(orderCmd);
    
    // Check projection was updated
    const projection = api._cqrs.projectionManager
      .projections.get('orderStats');
    const stats = projection.getCustomerStats('123');
    
    expect(stats.totalOrders).toBe(1);
    expect(stats.totalSpent).toBe(100);
  });
});
```

## Migration Strategy

### Phase 1: Identify Boundaries

```javascript
// Start by identifying areas that would benefit from CQRS
// Look for:
// - Complex queries with many joins
// - Different read/write patterns
// - Performance bottlenecks

// Example: Product catalog with complex search
const complexQuery = await api.resources.products.query({
  filter: { 
    category: 'electronics',
    price: { between: [100, 500] },
    inStock: true
  },
  joins: ['reviews', 'category', 'brand', 'variants'],
  include: 'reviews.user',
  sort: [{ field: 'averageRating', direction: 'DESC' }]
});

// This might benefit from a read-optimized projection
```

### Phase 2: Introduce Commands Gradually

```javascript
// Start with a single command alongside existing code
api.command('PublishProduct', async (command) => {
  const { productId } = command.data;
  
  // Add business logic that was scattered
  const product = await api.resources.products.get(productId);
  
  // Validation
  if (!product.data.attributes.images?.length) {
    throw new Error('Product must have images before publishing');
  }
  
  if (!product.data.attributes.description) {
    throw new Error('Product must have description before publishing');
  }
  
  // Update
  await api.resources.products.update(productId, {
    status: 'published',
    publishedAt: new Date()
  });
  
  // Notify
  await notifySubscribers(productId);
  await updateSearchIndex(productId);
  
  return { success: true };
});

// Gradually replace direct calls
// Old way:
await api.resources.products.update(id, { status: 'published' });

// New way:
await api.execute(new Command({ productId: id }));
```

### Phase 3: Add Event Sourcing

```javascript
// Enable event store
api.use(CQRSPlugin, {
  eventStore: true
});

// Start emitting events from commands
api.command('UpdateInventory', async (command) => {
  const { productId, quantity, reason } = command.data;
  
  const before = await api.resources.inventory.get(productId);
  const after = await api.resources.inventory.update(productId, { quantity });
  
  // Emit event with context
  await api.emitDomainEvent(new Event(
    'InventoryUpdated',
    {
      productId,
      before: before.data.attributes.quantity,
      after: quantity,
      change: quantity - before.data.attributes.quantity,
      reason
    },
    productId
  ));
  
  return after;
});
```

### Phase 4: Build Projections

```javascript
// Create projections for complex queries
const searchProjection = {
  handles: ['ProductCreated', 'ProductUpdated', 'ReviewAdded'],
  
  searchIndex: new Map(),
  
  async handle(event) {
    // Build denormalized search data
  }
};

api.projection('search', searchProjection);

// Replace complex queries with projection queries
api.query('SearchProducts', async (query) => {
  const projection = api._cqrs.projectionManager
    .projections.get('search');
  return projection.search(query.criteria);
});
```

### Phase 5: Separate Databases (Optional)

```javascript
// Only if you truly need it
api.use(CQRSPlugin, {
  separateDatabases: true,
  writeDatabase: {
    plugin: 'mysql',
    options: productionWriteDb
  },
  readDatabase: {
    plugin: 'mysql', 
    options: productionReadDb
  }
});
```

## Common Pitfalls

### 1. Over-Engineering

```javascript
// ❌ Bad: CQRS for simple CRUD
api.command('UpdateUserName', async (command) => {
  const { userId, name } = command.data;
  return await api.resources.users.update(userId, { name });
});

// ✅ Good: Just use the simple API
await api.resources.users.update(userId, { name });
```

### 2. Ignoring Eventual Consistency

```javascript
// ❌ Bad: Expecting immediate consistency
const command = new CreateProductCommand(data);
await api.execute(command);

// This might fail if using separate databases
const product = await api.execute(new GetProductQuery(command.productId));

// ✅ Good: Handle eventual consistency
const command = new CreateProductCommand(data);
const result = await api.execute(command);

// Option 1: Return created data from command
return result.data;

// Option 2: Add delay for sync
await new Promise(resolve => setTimeout(resolve, 100));
const product = await api.execute(new GetProductQuery(command.productId));

// Option 3: Query from write database when needed
api.query('GetProductImmediate', async (query) => {
  // Force read from write database
  return await api._writeApi.resources.products.get(query.criteria.id);
});
```

### 3. Anemic Events

```javascript
// ❌ Bad: Event with minimal data
await api.emitDomainEvent(new Event('OrderShipped', {
  orderId: '123'
}));

// ✅ Good: Event with full context
await api.emitDomainEvent(new Event('OrderShipped', {
  orderId: '123',
  customerId: '456',
  items: [...],
  shippingAddress: {...},
  carrier: 'FedEx',
  trackingNumber: 'TRACK123',
  estimatedDelivery: '2024-01-20',
  shippedAt: new Date()
}));
```

### 4. Synchronous Projections

```javascript
// ❌ Bad: Blocking event processing
api.onDomainEvent('OrderCreated', async (event) => {
  // This blocks other event handlers
  await updateElasticsearch(event);
  await sendToAnalytics(event);
  await notifyWarehouse(event);
});

// ✅ Good: Asynchronous processing
api.onDomainEvent('OrderCreated', async (event) => {
  // Queue for async processing
  await eventQueue.push('updateSearch', event);
  await eventQueue.push('analytics', event);
  await eventQueue.push('warehouse', event);
});
```

## Performance Considerations

### Event Store Optimization

```javascript
// Implement snapshots for long event streams
class OptimizedEventStore {
  async getEvents(aggregateId, fromVersion = 0) {
    // Check for snapshot
    const snapshot = await this.getSnapshot(aggregateId);
    
    if (snapshot && snapshot.version >= fromVersion) {
      // Start from snapshot
      const events = await this.store.getEvents(
        aggregateId,
        snapshot.version + 1
      );
      
      return {
        snapshot: snapshot.state,
        events
      };
    }
    
    // No snapshot, get all events
    return {
      snapshot: null,
      events: await this.store.getEvents(aggregateId, fromVersion)
    };
  }
  
  async saveSnapshot(aggregateId, state, version) {
    // Save snapshot every 100 events
    if (version % 100 === 0) {
      await this.snapshots.save({
        aggregateId,
        state,
        version,
        timestamp: Date.now()
      });
    }
  }
}
```

### Projection Performance

```javascript
// Use efficient data structures
const performantProjection = {
  handles: ['OrderCreated'],
  
  // Use Maps for O(1) lookup
  ordersByCustomer: new Map(),
  ordersByProduct: new Map(),
  
  // Use indexes for common queries
  indexes: {
    byDate: new Map(),      // Date -> Order IDs
    byStatus: new Map(),    // Status -> Order IDs
    byTotal: []             // Sorted array for range queries
  },
  
  async handle(event) {
    const order = event.data;
    
    // Update main storage
    this.ordersByCustomer.set(order.customerId, order);
    
    // Update indexes
    const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
    if (!this.indexes.byDate.has(dateKey)) {
      this.indexes.byDate.set(dateKey, new Set());
    }
    this.indexes.byDate.get(dateKey).add(order.id);
    
    // Maintain sorted array for range queries
    const pos = this.indexes.byTotal.findIndex(o => o.total > order.total);
    if (pos === -1) {
      this.indexes.byTotal.push(order);
    } else {
      this.indexes.byTotal.splice(pos, 0, order);
    }
  },
  
  // Efficient queries using indexes
  getOrdersByDateRange(startDate, endDate) {
    const results = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (const [dateStr, orderIds] of this.indexes.byDate) {
      const date = new Date(dateStr);
      if (date >= start && date <= end) {
        for (const orderId of orderIds) {
          results.push(this.orders.get(orderId));
        }
      }
    }
    
    return results;
  }
};
```

### Batch Processing

```javascript
// Process events in batches for efficiency
class BatchProjectionManager {
  constructor() {
    this.queue = [];
    this.batchSize = 100;
    this.flushInterval = 1000; // 1 second
    
    setInterval(() => this.flush(), this.flushInterval);
  }
  
  async processEvent(event) {
    this.queue.push(event);
    
    if (this.queue.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async flush() {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.batchSize);
    
    // Process batch in parallel by projection
    const projectionBatches = new Map();
    
    for (const event of batch) {
      for (const [name, projection] of this.projections) {
        if (projection.handles.includes(event.type)) {
          if (!projectionBatches.has(name)) {
            projectionBatches.set(name, []);
          }
          projectionBatches.get(name).push(event);
        }
      }
    }
    
    // Process each projection's batch
    await Promise.all(
      Array.from(projectionBatches.entries()).map(([name, events]) =>
        this.projections.get(name).handleBatch(events)
      )
    );
  }
}
```

## Conclusion

CQRS with JSON-REST-API provides a powerful architecture pattern when you truly need it. The key is to:

1. **Start simple** - Use basic JSON-REST-API until you hit limitations
2. **Adopt gradually** - Introduce CQRS concepts one at a time
3. **Measure impact** - Ensure the complexity is justified
4. **Keep it practical** - Don't over-engineer

Remember: CQRS is a solution to specific problems. If you don't have those problems, you don't need CQRS. JSON-REST-API's strength is its simplicity - preserve that whenever possible.