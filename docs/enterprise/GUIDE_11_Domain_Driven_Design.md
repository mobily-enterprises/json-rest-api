# Domain-Driven Design with JSON-REST-API: A Practical Guide

## Table of Contents

1. [Introduction](#introduction)
2. [When to Use DDD](#when-to-use-ddd)
3. [Core DDD Concepts](#core-ddd-concepts)
4. [Building Blocks](#building-blocks)
5. [Implementing DDD](#implementing-ddd)
6. [Bounded Contexts](#bounded-contexts)
7. [Domain Events](#domain-events)
8. [Specifications](#specifications)
9. [Real-World Example](#real-world-example)
10. [Testing DDD Code](#testing-ddd-code)
11. [Best Practices](#best-practices)
12. [Common Pitfalls](#common-pitfalls)

## Introduction

Domain-Driven Design (DDD) is a software design approach that focuses on modeling software to match the business domain. The DDDPlugin for JSON-REST-API provides rails and structure to implement DDD correctly, guiding you toward best practices.

### What is DDD?

DDD is about:
- Speaking the language of the business
- Protecting business rules in the domain layer
- Creating clear boundaries between different parts of the system
- Making complex business logic maintainable

### Why DDD with JSON-REST-API?

JSON-REST-API + DDD gives you:
- **Structure**: Clear separation of concerns
- **Rails**: Base classes guide correct implementation
- **Integration**: Aggregates map naturally to resources
- **Events**: Built-in domain event support
- **Flexibility**: Works with any storage backend

## When to Use DDD

### ✅ Use DDD When You Have:

1. **Complex Business Rules**
   ```javascript
   // Multiple interacting rules
   order.canBeCancelled() // Depends on status, payment, shipping
   customer.canPlaceOrder(amount) // Credit limits, order history
   ```

2. **Domain Experts**
   - Business people who understand the rules
   - Need to capture their knowledge in code
   - Requirements change as understanding deepens

3. **Multiple Bounded Contexts**
   - Sales sees "Product" differently than Warehouse
   - Need clear boundaries between contexts

4. **Long-Lived Projects**
   - Business logic will evolve
   - Multiple teams will work on it
   - Knowledge needs to be preserved

### ❌ Don't Use DDD For:

1. **Simple CRUD Applications**
   - No complex business rules
   - Just storing and retrieving data

2. **Technical Tools**
   - No business domain to model
   - Purely technical concerns

3. **Prototypes/MVPs**
   - Still discovering the domain
   - Need to move fast

## Core DDD Concepts

### Ubiquitous Language

Everyone uses the same terms:

```javascript
// Bad: Technical jargon
class UserAccount {
  accountStatus: number; // What does 1, 2, 3 mean?
  flaggedForReview: boolean;
}

// Good: Business language
class Customer {
  membershipLevel: 'bronze' | 'silver' | 'gold';
  riskProfile: 'low' | 'medium' | 'high';
}
```

### Bounded Contexts

Different meanings in different contexts:

```javascript
// Sales Context
class Product {
  name: string;
  price: Money;
  category: string;
  marketingDescription: string;
}

// Inventory Context
class Product {
  sku: string;
  weight: Weight;
  dimensions: Dimensions;
  warehouseLocation: string;
  quantityOnHand: number;
}
```

### Aggregates

Groups of objects with consistency boundaries:

```javascript
// Order aggregate ensures consistency
class Order extends Aggregate {
  addItem(product, quantity) {
    this.enforceInvariant(
      this.status !== 'shipped',
      'Cannot modify shipped orders'
    );
    
    this.items.push(new OrderItem(product, quantity));
    this.recalculateTotal();
  }
}
```

## Building Blocks

### Value Objects

Immutable objects defined by their values:

```javascript
// Money is a value object
class Money extends api.ValueObject {
  constructor({ amount, currency }) {
    if (amount < 0) {
      throw new Error('Money cannot be negative');
    }
    super({ amount, currency });
  }
  
  add(other) {
    if (this.currency !== other.currency) {
      throw new Error('Cannot add different currencies');
    }
    return new Money({
      amount: this.amount + other.amount,
      currency: this.currency
    });
  }
}

// Value objects are immutable
const price = new Money({ amount: 100, currency: 'USD' });
const newPrice = price.add(new Money({ amount: 20, currency: 'USD' }));
// price is unchanged, newPrice is a new object
```

### Entities

Objects with identity that persists over time:

```javascript
class Product extends api.Entity {
  constructor(id, { name, sku, price }) {
    super(id, { name, sku, price });
  }
  
  changePrice(newPrice) {
    const oldPrice = this.price;
    this.price = newPrice;
    
    this.recordEvent('PriceChanged', {
      productId: this.id,
      oldPrice,
      newPrice
    });
  }
}

// Same product even if attributes change
const product1 = new Product('123', { name: 'Laptop' });
const product2 = new Product('123', { name: 'Gaming Laptop' });
product1.equals(product2); // true - same ID
```

### Aggregates

Entities that enforce consistency rules:

```javascript
class ShoppingCart extends api.Aggregate {
  static get schema() {
    return {
      customerId: { type: 'id', required: true },
      items: { type: 'array', default: [] },
      status: { type: 'string', default: 'active' }
    };
  }
  
  addItem(productId, quantity) {
    // Enforce business rules
    this.enforceInvariant(
      quantity > 0,
      'Quantity must be positive'
    );
    
    this.enforceInvariant(
      this.items.length < 50,
      'Cart cannot have more than 50 items'
    );
    
    const existing = this.items.find(i => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push({ productId, quantity });
    }
    
    this.recordEvent('ItemAddedToCart', { productId, quantity });
  }
  
  checkout() {
    this.enforceInvariant(
      this.items.length > 0,
      'Cannot checkout empty cart'
    );
    
    this.status = 'checkedOut';
    this.recordEvent('CartCheckedOut', { 
      customerId: this.customerId,
      itemCount: this.items.length
    });
  }
}
```

### Repositories

Abstract data access:

```javascript
class CustomerRepository extends api.Repository {
  constructor() {
    super('customers', Customer); // resource name, aggregate class
  }
  
  async findByEmail(email) {
    const results = await this.query({ email });
    return results[0] || null;
  }
  
  async findPremiumCustomers() {
    return await this.query({ 
      creditLimit: { gte: 10000 },
      status: 'active'
    });
  }
}

// Usage
const customerRepo = api.getRepository('CustomerRepository');
const customer = await customerRepo.findByEmail('john@example.com');
```

### Domain Services

Cross-aggregate business logic:

```javascript
class PricingService extends api.DomainService {
  calculateDiscount(customer, order) {
    let discount = 0;
    
    // Premium customers get 10% off
    if (customer.isPremium()) {
      discount += 0.10;
    }
    
    // Bulk orders get 5% off
    if (order.items.length > 10) {
      discount += 0.05;
    }
    
    // Maximum 15% discount
    return Math.min(discount, 0.15);
  }
  
  applyPromoCode(order, promoCode) {
    // Complex promo code logic
    // Might need to check with external service
  }
}
```

## Implementing DDD

### Step 1: Install the Plugin

```javascript
import { createApi } from 'json-rest-api';
import { DDDPlugin } from 'json-rest-api/plugins/ddd';

const api = createApi({ storage: 'memory' });
api.use(DDDPlugin, {
  logEvents: true  // Log domain events for debugging
});
```

### Step 2: Define Your Domain Model

```javascript
// Value Objects
class Email extends api.ValueObject {
  constructor(value) {
    if (!value || !value.includes('@')) {
      throw new Error('Invalid email');
    }
    super({ value });
  }
}

// Aggregates
class User extends api.Aggregate {
  static get schema() {
    return {
      email: { type: 'value', valueObject: Email },
      name: { type: 'string', required: true },
      status: { type: 'string', default: 'active' }
    };
  }
  
  register(email, name) {
    this.email = new Email(email);
    this.name = name;
    this.status = 'active';
    
    this.recordEvent('UserRegistered', { email, name });
  }
  
  deactivate() {
    this.enforceInvariant(
      this.status === 'active',
      'User is already inactive'
    );
    
    this.status = 'inactive';
    this.recordEvent('UserDeactivated', { userId: this.id });
  }
}
```

### Step 3: Create Repositories

```javascript
class UserRepository extends api.Repository {
  constructor() {
    super('users', User);
  }
  
  async findActive() {
    return await this.query({ status: 'active' });
  }
}
```

### Step 4: Define Bounded Context

```javascript
api.boundedContext('identity', {
  aggregates: [User],
  repositories: [UserRepository],
  services: [AuthenticationService]
});
```

### Step 5: Use It

```javascript
// Get repository
const userRepo = api.getRepository('UserRepository');

// Create and save aggregate
const user = new User();
user.register('john@example.com', 'John Doe');
await userRepo.save(user);

// Domain events are automatically published
api.onDomainEvent('UserRegistered', async (event) => {
  console.log('New user:', event.data);
  // Send welcome email, etc.
});
```

## Bounded Contexts

### Defining Contexts

```javascript
// Sales context
api.boundedContext('sales', {
  aggregates: [Customer, Order, Product],
  repositories: [CustomerRepository, OrderRepository],
  services: [PricingService, DiscountService]
});

// Inventory context
api.boundedContext('inventory', {
  aggregates: [InventoryItem, Warehouse],
  repositories: [InventoryRepository],
  services: [StockService]
});

// Shipping context
api.boundedContext('shipping', {
  aggregates: [Shipment, Carrier],
  repositories: [ShipmentRepository],
  services: [ShippingCalculator]
});
```

### Context Mapping

```javascript
// Sales places order
api.onDomainEvent('OrderPlaced', async (event) => {
  if (event.context === 'sales') {
    // Notify inventory context
    const inventoryApi = api.getContext('inventory');
    await inventoryApi.handleEvent({
      name: 'ReserveInventory',
      orderId: event.data.orderId,
      items: event.data.items
    });
  }
});

// Inventory confirms reservation
api.onDomainEvent('InventoryReserved', async (event) => {
  if (event.context === 'inventory') {
    // Notify shipping context
    const shippingApi = api.getContext('shipping');
    await shippingApi.handleEvent({
      name: 'PrepareShipment',
      orderId: event.data.orderId
    });
  }
});
```

## Domain Events

### Defining Events

```javascript
// Simple event
class OrderPlaced {
  constructor(orderId, customerId, total) {
    this.name = 'OrderPlaced';
    this.data = { orderId, customerId, total };
    this.timestamp = Date.now();
  }
}

// Event with validation
const OrderShipped = api.domainEvent('OrderShipped', {
  orderId: true,      // required
  trackingNumber: true,
  carrier: true
});
```

### Publishing Events

```javascript
// From aggregates
class Order extends api.Aggregate {
  ship(trackingNumber, carrier) {
    this.status = 'shipped';
    this.shippedAt = new Date();
    
    // Automatically published when aggregate is saved
    this.recordEvent('OrderShipped', {
      orderId: this.id,
      trackingNumber,
      carrier
    });
  }
}

// Manually
await api.emitDomainEvent('SystemMaintenance', {
  scheduledFor: '2024-01-15T02:00:00Z',
  estimatedDuration: '2 hours'
});
```

### Handling Events

```javascript
// Global handler
api.onDomainEvent('OrderPlaced', async (event) => {
  console.log('Order placed:', event.data.orderId);
  // Send confirmation email
  // Update inventory
  // Notify warehouse
});

// Context-specific handler
const salesContext = api.getContext('sales');
salesContext.onEvent('PaymentReceived', async (event) => {
  // Update order status
  const order = await orderRepo.findById(event.data.orderId);
  order.markAsPaid();
  await orderRepo.save(order);
});

// Handle all events
api.onDomainEvent('*', async (event) => {
  // Log to event store
  await eventStore.append(event);
});
```

## Specifications

### Basic Specifications

```javascript
// Define business rules as specifications
class PremiumCustomerSpec extends api.Specification {
  isSatisfiedBy(customer) {
    return customer.totalPurchases > 10000 || 
           customer.memberSince < Date.now() - (365 * 24 * 60 * 60 * 1000);
  }
  
  toQuery() {
    return {
      $or: [
        { totalPurchases: { gt: 10000 } },
        { memberSince: { lt: Date.now() - (365 * 24 * 60 * 60 * 1000) } }
      ]
    };
  }
}

// Use specifications
const spec = new PremiumCustomerSpec();
const isPremium = spec.isSatisfiedBy(customer);
const premiumCustomers = await customerRepo.findBySpec(spec);
```

### Composite Specifications

```javascript
// Combine specifications
const activeSpec = api.specification('Active',
  customer => customer.status === 'active',
  () => ({ status: 'active' })
);

const premiumSpec = new PremiumCustomerSpec();

// AND combination
const activePremium = activeSpec.and(premiumSpec);

// OR combination  
const specialCustomer = premiumSpec.or(vipSpec);

// NOT
const notPremium = premiumSpec.not();
```

## Real-World Example

### E-Commerce Order Processing

```javascript
// 1. Domain Layer
// ---------------

// Value Objects
class SKU extends api.ValueObject {
  constructor(value) {
    if (!/^[A-Z]{3}-\d{4}$/.test(value)) {
      throw new Error('Invalid SKU format');
    }
    super({ value });
  }
}

class Price extends api.ValueObject {
  constructor({ amount, currency = 'USD' }) {
    if (amount < 0) throw new Error('Price cannot be negative');
    super({ amount, currency });
  }
  
  withTax(rate) {
    return new Price({
      amount: this.amount * (1 + rate),
      currency: this.currency
    });
  }
}

// Aggregate
class Product extends api.Aggregate {
  static get schema() {
    return {
      sku: { type: 'value', valueObject: SKU },
      name: { type: 'string', required: true },
      price: { type: 'value', valueObject: Price },
      stock: { type: 'number', default: 0 }
    };
  }
  
  adjustPrice(newPrice) {
    const oldPrice = this.price;
    this.price = newPrice;
    
    this.recordEvent('PriceAdjusted', {
      sku: this.sku.value,
      oldPrice: oldPrice.amount,
      newPrice: newPrice.amount
    });
  }
  
  reserveStock(quantity) {
    this.enforceInvariant(
      this.stock >= quantity,
      'Insufficient stock'
    );
    
    this.stock -= quantity;
    this.recordEvent('StockReserved', {
      sku: this.sku.value,
      quantity,
      remaining: this.stock
    });
  }
}

// 2. Application Layer
// --------------------

class OrderProcessingService {
  constructor(repos, services) {
    this.orderRepo = repos.order;
    this.productRepo = repos.product;
    this.customerRepo = repos.customer;
    this.paymentService = services.payment;
    this.shippingService = services.shipping;
  }
  
  async processOrder(customerId, items) {
    // Start transaction/saga
    const orderId = generateId();
    
    try {
      // 1. Validate customer
      const customer = await this.customerRepo.findById(customerId);
      if (!customer || !customer.canOrder()) {
        throw new Error('Customer cannot place orders');
      }
      
      // 2. Reserve inventory
      const reservations = [];
      for (const item of items) {
        const product = await this.productRepo.findBySku(item.sku);
        product.reserveStock(item.quantity);
        await this.productRepo.save(product);
        reservations.push({ product, quantity: item.quantity });
      }
      
      // 3. Calculate pricing
      const total = this.calculateTotal(reservations);
      
      // 4. Process payment
      const payment = await this.paymentService.charge(
        customer,
        total
      );
      
      // 5. Create order
      const order = new Order();
      order.place(customerId, reservations, payment.id);
      await this.orderRepo.save(order);
      
      // 6. Arrange shipping
      const shipment = await this.shippingService.schedule(order);
      
      return { orderId: order.id, shipmentId: shipment.id };
      
    } catch (error) {
      // Compensate
      await this.compensateOrder(orderId, error);
      throw error;
    }
  }
}

// 3. Infrastructure Layer
// -----------------------

// Define bounded context
api.boundedContext('ecommerce', {
  aggregates: [Product, Order, Customer],
  repositories: [ProductRepository, OrderRepository, CustomerRepository],
  services: [PaymentService, ShippingService, OrderProcessingService]
});

// Wire up event handlers
api.onDomainEvent('OrderPlaced', async (event) => {
  // Send confirmation email
  await emailService.send({
    to: event.data.customerEmail,
    template: 'order-confirmation',
    data: event.data
  });
});

api.onDomainEvent('StockReserved', async (event) => {
  // Update inventory projections
  await updateInventoryDashboard(event.data);
});

// 4. API Layer
// ------------

app.post('/api/orders', async (req, res) => {
  try {
    const service = api.getService('OrderProcessingService');
    const result = await service.processOrder(
      req.body.customerId,
      req.body.items
    );
    
    res.json({
      success: true,
      orderId: result.orderId,
      shipmentId: result.shipmentId
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});
```

## Testing DDD Code

### Testing Value Objects

```javascript
describe('Money Value Object', () => {
  it('should be immutable', () => {
    const money = new Money({ amount: 100, currency: 'USD' });
    expect(() => money.amount = 200).toThrow();
  });
  
  it('should compare by value', () => {
    const money1 = new Money({ amount: 100, currency: 'USD' });
    const money2 = new Money({ amount: 100, currency: 'USD' });
    expect(money1.equals(money2)).toBe(true);
  });
  
  it('should prevent invalid operations', () => {
    const usd = new Money({ amount: 100, currency: 'USD' });
    const eur = new Money({ amount: 100, currency: 'EUR' });
    expect(() => usd.add(eur)).toThrow('Cannot add different currencies');
  });
});
```

### Testing Aggregates

```javascript
describe('Order Aggregate', () => {
  let order;
  
  beforeEach(() => {
    order = new Order();
    order.place('customer-123', shippingAddress);
  });
  
  it('should enforce business rules', () => {
    order.ship();
    
    expect(() => order.addItem(product, 1))
      .toThrow('Cannot modify shipped orders');
  });
  
  it('should record domain events', () => {
    order.addItem('PROD-1', 'Laptop', price, 2);
    
    const events = order.getEvents();
    expect(events).toHaveLength(2); // OrderPlaced + ItemAdded
    expect(events[1].name).toBe('ItemAddedToOrder');
  });
});
```

### Testing Domain Services

```javascript
describe('PricingService', () => {
  let service;
  
  beforeEach(() => {
    service = new PricingService();
  });
  
  it('should calculate bulk discount', () => {
    const items = Array(15).fill({ price: 10, quantity: 1 });
    const discount = service.calculateBulkDiscount(items);
    
    expect(discount).toBe(0.1); // 10% for 15+ items
  });
});
```

### Integration Testing

```javascript
describe('Order Processing', () => {
  let api;
  
  beforeEach(async () => {
    api = createApi({ storage: 'memory' });
    api.use(DDDPlugin);
    
    api.boundedContext('test', {
      aggregates: [Order, Customer, Product],
      repositories: [OrderRepository, CustomerRepository],
      services: [OrderService]
    });
  });
  
  it('should process order end-to-end', async () => {
    // Setup
    const customerRepo = api.getRepository('CustomerRepository');
    const customer = new Customer();
    customer.register('test@example.com', 'Test User');
    await customerRepo.save(customer);
    
    // Execute
    const orderService = api.getService('OrderService');
    const order = await orderService.placeOrder(
      customer.id,
      [{ productId: 'PROD-1', quantity: 2 }]
    );
    
    // Verify
    expect(order.status).toBe('submitted');
    expect(order.customerId).toBe(customer.id);
  });
});
```

## Best Practices

### 1. Keep Aggregates Small

```javascript
// Bad: Large aggregate
class Customer extends Aggregate {
  orders: Order[];        // Too much data
  reviews: Review[];      // Not cohesive
  wishlist: Product[];    // Separate concern
}

// Good: Focused aggregates
class Customer extends Aggregate {
  // Only customer data
}

class Order extends Aggregate {
  customerId: string;  // Reference, not embedded
}
```

### 2. Use Value Objects Liberally

```javascript
// Bad: Primitive obsession
class Product {
  price: number;
  currency: string;
  weight: number;
  weightUnit: string;
}

// Good: Rich value objects
class Product {
  price: Money;
  weight: Weight;
  dimensions: Dimensions;
}
```

### 3. Make the Implicit Explicit

```javascript
// Bad: Hidden business rule
if (order.total > 1000 && customer.joinedAt < lastYear) {
  discount = 0.1;
}

// Good: Named concept
class LoyaltyDiscount {
  calculate(customer, order) {
    if (this.isEligible(customer, order)) {
      return new Discount(0.1, 'Loyalty');
    }
    return Discount.none();
  }
  
  isEligible(customer, order) {
    return order.total.isGreaterThan(Money.dollars(1000)) &&
           customer.isLoyaltyMember();
  }
}
```

### 4. Use Repositories for Queries

```javascript
// Bad: Complex queries in application layer
const orders = await api.resources.orders.query({
  filter: {
    customerId: customerId,
    status: { in: ['pending', 'processing'] },
    createdAt: { gte: thirtyDaysAgo }
  }
});

// Good: Named query in repository
class OrderRepository extends Repository {
  async findRecentActiveOrdersForCustomer(customerId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    return this.query({
      customerId,
      status: { in: ['pending', 'processing'] },
      createdAt: { gte: thirtyDaysAgo }
    });
  }
}
```

### 5. Events Should Be Past Tense

```javascript
// Bad: Commands as events
'CreateOrder'
'UpdateCustomer'
'ProcessPayment'

// Good: Things that happened
'OrderCreated'
'CustomerUpdated'
'PaymentProcessed'
```

## Common Pitfalls

### 1. Anemic Domain Model

```javascript
// Bad: No behavior, just data
class Order {
  id: string;
  items: OrderItem[];
  status: string;
  total: number;
}

// Service has all the logic
class OrderService {
  addItem(order, item) {
    order.items.push(item);
    order.total += item.price;
  }
}

// Good: Rich domain model
class Order extends Aggregate {
  addItem(product, quantity, price) {
    this.enforceInvariant(
      this.status === 'pending',
      'Can only add items to pending orders'
    );
    
    const item = new OrderItem(product, quantity, price);
    this.items.push(item);
    this.total = this.calculateTotal();
    
    this.recordEvent('ItemAdded', { 
      orderId: this.id,
      product,
      quantity 
    });
  }
}
```

### 2. Wrong Aggregate Boundaries

```javascript
// Bad: Too fine-grained
class OrderItem extends Aggregate {
  // OrderItem shouldn't exist without Order
}

// Bad: Too coarse
class CustomerOrderAggregate extends Aggregate {
  customer: Customer;
  orders: Order[];  // Too much in one aggregate
}

// Good: Natural boundaries
class Order extends Aggregate {
  items: OrderItem[];  // OrderItem is part of Order
}

class Customer extends Aggregate {
  // Just customer data, orders referenced by ID
}
```

### 3. Leaking Domain Logic

```javascript
// Bad: Business logic in controller
app.post('/api/orders/:id/cancel', async (req, res) => {
  const order = await orderRepo.findById(req.params.id);
  
  // Business logic leaked!
  if (order.status === 'shipped') {
    return res.status(400).json({ error: 'Cannot cancel shipped orders' });
  }
  
  order.status = 'cancelled';
  await orderRepo.save(order);
});

// Good: Business logic in domain
app.post('/api/orders/:id/cancel', async (req, res) => {
  const order = await orderRepo.findById(req.params.id);
  
  try {
    order.cancel(req.body.reason); // Business logic inside
    await orderRepo.save(order);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

### 4. Over-Engineering

```javascript
// Bad: DDD for simple CRUD
class UserNameValueObject extends ValueObject { }
class UserEmailValueObject extends ValueObject { }
class UserAgeSpecification extends Specification { }
class UserFactory extends AbstractFactory { }
class UserRepository extends Repository { }
// ... 20 more classes for basic user management

// Good: Use DDD where it adds value
// Simple user management might just need:
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', format: 'email' }
}));
```

## Conclusion

DDD with JSON-REST-API provides structure and guidance for building complex business applications. The key is to:

1. **Start Simple**: Don't use all patterns at once
2. **Focus on the Domain**: Let business needs drive the design
3. **Use the Rails**: Let the plugin guide you to best practices
4. **Iterate**: Your understanding will deepen over time

Remember: DDD is about making your code speak the language of your business. The patterns and structures are just tools to help you achieve that goal.