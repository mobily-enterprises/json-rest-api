import { createApi } from '../index.js';
import { DDDPlugin, ValueObject, Aggregate, Repository, DomainService, Specification } from '../plugins/enterprise/ddd.js';
import { HTTPPlugin } from '../plugins/core/http.js';
import express from 'express';

// Create API with DDD support
const api = createApi({ storage: 'memory' });
api.use(DDDPlugin, { logEvents: true });

// =============================================================================
// DOMAIN LAYER - Pure business logic
// =============================================================================

// Value Objects - Immutable, no identity
// --------------------------------------

class Money extends ValueObject {
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
  
  subtract(other) {
    if (this.currency !== other.currency) {
      throw new Error('Cannot subtract different currencies');
    }
    return new Money({ 
      amount: this.amount - other.amount, 
      currency: this.currency 
    });
  }
  
  multiply(factor) {
    return new Money({ 
      amount: this.amount * factor, 
      currency: this.currency 
    });
  }
  
  isGreaterThan(other) {
    if (this.currency !== other.currency) {
      throw new Error('Cannot compare different currencies');
    }
    return this.amount > other.amount;
  }
}

class Address extends ValueObject {
  constructor({ street, city, state, zipCode, country }) {
    super({ street, city, state, zipCode, country });
  }
  
  validate() {
    if (!this.street || !this.city || !this.zipCode) {
      throw new Error('Invalid address');
    }
  }
}

class Email extends ValueObject {
  constructor(value) {
    if (!value || !value.includes('@')) {
      throw new Error('Invalid email');
    }
    super({ value });
  }
  
  toString() {
    return this.value;
  }
}

// Aggregates - Entities with consistency boundaries
// ------------------------------------------------

class Customer extends Aggregate {
  static get schema() {
    return {
      name: { type: 'string', required: true },
      email: { type: 'value', valueObject: Email },
      creditLimit: { type: 'value', valueObject: Money },
      status: { type: 'string', default: 'active' },
      shippingAddress: { type: 'value', valueObject: Address },
      billingAddress: { type: 'value', valueObject: Address }
    };
  }
  
  constructor(id, props) {
    super(id, props);
    
    // Ensure value objects
    if (props.email && !(props.email instanceof Email)) {
      this.email = new Email(props.email.value || props.email);
    }
    if (props.creditLimit && !(props.creditLimit instanceof Money)) {
      this.creditLimit = new Money(props.creditLimit);
    }
  }
  
  register(name, email, creditLimit = 1000) {
    this.name = name;
    this.email = new Email(email);
    this.creditLimit = new Money({ amount: creditLimit, currency: 'USD' });
    this.status = 'active';
    
    this.recordEvent('CustomerRegistered', { 
      customerId: this.id,
      name, 
      email: email.toString(),
      creditLimit 
    });
  }
  
  changeCreditLimit(newLimit) {
    const oldLimit = this.creditLimit;
    this.creditLimit = newLimit;
    
    this.recordEvent('CreditLimitChanged', {
      customerId: this.id,
      oldLimit: oldLimit.amount,
      newLimit: newLimit.amount,
      currency: newLimit.currency
    });
  }
  
  deactivate(reason) {
    this.enforceInvariant(
      this.status === 'active',
      'Customer is already inactive'
    );
    
    this.status = 'inactive';
    this.recordEvent('CustomerDeactivated', { 
      customerId: this.id,
      reason 
    });
  }
  
  canAfford(amount) {
    return !this.creditLimit.isGreaterThan(amount);
  }
  
  validate() {
    this.enforceInvariant(
      this.creditLimit.amount >= 0,
      'Credit limit cannot be negative'
    );
  }
}

class Order extends Aggregate {
  static get schema() {
    return {
      customerId: { type: 'id', required: true },
      items: { type: 'array', default: [] },
      status: { type: 'string', default: 'pending' },
      total: { type: 'value', valueObject: Money },
      placedAt: { type: 'timestamp' },
      shippedAt: { type: 'timestamp' },
      shippingAddress: { type: 'value', valueObject: Address }
    };
  }
  
  constructor(id, props) {
    super(id, props);
    
    // Ensure value objects
    if (props.total && !(props.total instanceof Money)) {
      this.total = new Money(props.total);
    }
  }
  
  place(customerId, shippingAddress) {
    this.customerId = customerId;
    this.shippingAddress = shippingAddress;
    this.status = 'pending';
    this.placedAt = Date.now();
    this.items = [];
    this.total = new Money({ amount: 0, currency: 'USD' });
    
    this.recordEvent('OrderPlaced', {
      orderId: this.id,
      customerId,
      placedAt: this.placedAt
    });
  }
  
  addItem(productId, productName, price, quantity) {
    this.enforceInvariant(
      this.status === 'pending',
      'Can only add items to pending orders'
    );
    
    this.enforceInvariant(
      quantity > 0,
      'Quantity must be positive'
    );
    
    const itemTotal = price.multiply(quantity);
    
    this.items.push({
      productId,
      productName,
      price: price.toJSON(),
      quantity,
      total: itemTotal.toJSON()
    });
    
    this.total = this.total.add(itemTotal);
    
    this.recordEvent('ItemAddedToOrder', {
      orderId: this.id,
      productId,
      quantity,
      price: price.amount
    });
  }
  
  removeItem(productId) {
    this.enforceInvariant(
      this.status === 'pending',
      'Can only remove items from pending orders'
    );
    
    const index = this.items.findIndex(i => i.productId === productId);
    this.enforceInvariant(
      index >= 0,
      'Item not found in order'
    );
    
    const item = this.items[index];
    this.items.splice(index, 1);
    
    this.total = this.total.subtract(new Money(item.total));
    
    this.recordEvent('ItemRemovedFromOrder', {
      orderId: this.id,
      productId
    });
  }
  
  submit() {
    this.enforceInvariant(
      this.status === 'pending',
      'Order already submitted'
    );
    
    this.enforceInvariant(
      this.items.length > 0,
      'Order must have at least one item'
    );
    
    this.status = 'submitted';
    
    this.recordEvent('OrderSubmitted', {
      orderId: this.id,
      total: this.total.amount,
      itemCount: this.items.length
    });
  }
  
  approve() {
    this.enforceInvariant(
      this.status === 'submitted',
      'Can only approve submitted orders'
    );
    
    this.status = 'approved';
    
    this.recordEvent('OrderApproved', {
      orderId: this.id
    });
  }
  
  ship(trackingNumber) {
    this.enforceInvariant(
      this.status === 'approved',
      'Can only ship approved orders'
    );
    
    this.status = 'shipped';
    this.shippedAt = Date.now();
    this.trackingNumber = trackingNumber;
    
    this.recordEvent('OrderShipped', {
      orderId: this.id,
      trackingNumber,
      shippedAt: this.shippedAt
    });
  }
  
  cancel(reason) {
    this.enforceInvariant(
      ['pending', 'submitted'].includes(this.status),
      'Cannot cancel order in current status'
    );
    
    this.status = 'cancelled';
    
    this.recordEvent('OrderCancelled', {
      orderId: this.id,
      reason
    });
  }
  
  validate() {
    this.enforceInvariant(
      this.total.amount >= 0,
      'Order total cannot be negative'
    );
  }
}

// Specifications - Encapsulate business rules
// ------------------------------------------

class PremiumCustomerSpecification extends Specification {
  isSatisfiedBy(customer) {
    return customer.creditLimit.amount >= 10000;
  }
  
  toQuery() {
    return { 'creditLimit.amount': { gte: 10000 } };
  }
}

class ActiveCustomerSpecification extends Specification {
  isSatisfiedBy(customer) {
    return customer.status === 'active';
  }
  
  toQuery() {
    return { status: 'active' };
  }
}

class HighValueOrderSpecification extends Specification {
  constructor(threshold = 1000) {
    super();
    this.threshold = threshold;
  }
  
  isSatisfiedBy(order) {
    return order.total.amount >= this.threshold;
  }
  
  toQuery() {
    return { 'total.amount': { gte: this.threshold } };
  }
}

// Domain Services - Cross-aggregate logic
// ---------------------------------------

class PricingService extends DomainService {
  calculateOrderTotal(items) {
    let total = new Money({ amount: 0, currency: 'USD' });
    
    for (const item of items) {
      const itemTotal = new Money(item.price).multiply(item.quantity);
      total = total.add(itemTotal);
    }
    
    return total;
  }
  
  applyDiscount(total, discountPercent) {
    const discount = total.multiply(discountPercent / 100);
    return total.subtract(discount);
  }
}

class CreditCheckService extends DomainService {
  async canPlaceOrder(customer, orderTotal) {
    // Get existing unpaid orders
    const orderRepo = this.api.getRepository('OrderRepository');
    const unpaidOrders = await orderRepo.findUnpaidByCustomer(customer.id);
    
    // Calculate total exposure
    let totalOwed = new Money({ amount: 0, currency: 'USD' });
    for (const order of unpaidOrders) {
      totalOwed = totalOwed.add(order.total);
    }
    
    const totalExposure = totalOwed.add(orderTotal);
    
    // Check against credit limit
    return !totalExposure.isGreaterThan(customer.creditLimit);
  }
}

// Repositories - Data access layer
// --------------------------------

class CustomerRepository extends Repository {
  constructor() {
    super('customers', Customer);
  }
  
  async findByEmail(email) {
    const results = await this.query({ 'email.value': email });
    return results[0] || null;
  }
  
  async findPremium() {
    const spec = new PremiumCustomerSpecification();
    return await this.query(spec.toQuery());
  }
}

class OrderRepository extends Repository {
  constructor() {
    super('orders', Order);
  }
  
  async findByCustomer(customerId) {
    return await this.query({ customerId });
  }
  
  async findUnpaidByCustomer(customerId) {
    return await this.query({ 
      customerId,
      status: { in: ['submitted', 'approved'] }
    });
  }
  
  async findHighValueOrders(threshold = 1000) {
    const spec = new HighValueOrderSpecification(threshold);
    return await this.query(spec.toQuery());
  }
}

// =============================================================================
// APPLICATION LAYER - Use cases / orchestration
// =============================================================================

class OrderService {
  constructor(customerRepo, orderRepo, creditCheck, pricing) {
    this.customerRepo = customerRepo;
    this.orderRepo = orderRepo;
    this.creditCheck = creditCheck;
    this.pricing = pricing;
  }
  
  async placeOrder(customerId, items, shippingAddress) {
    // Load customer
    const customer = await this.customerRepo.findById(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }
    
    // Check if customer is active
    const activeSpec = new ActiveCustomerSpecification();
    if (!activeSpec.isSatisfiedBy(customer)) {
      throw new Error('Customer is not active');
    }
    
    // Calculate total
    const total = this.pricing.calculateOrderTotal(items);
    
    // Check credit
    const canPlace = await this.creditCheck.canPlaceOrder(customer, total);
    if (!canPlace) {
      throw new Error('Credit limit exceeded');
    }
    
    // Create order
    const order = new Order();
    order.place(customerId, shippingAddress);
    
    // Add items
    for (const item of items) {
      const price = new Money({ amount: item.price, currency: 'USD' });
      order.addItem(item.productId, item.productName, price, item.quantity);
    }
    
    // Submit order
    order.submit();
    
    // Save
    await this.orderRepo.save(order);
    
    return order;
  }
}

// =============================================================================
// INFRASTRUCTURE LAYER - Bounded contexts, wiring
// =============================================================================

// Define the Sales bounded context
api.boundedContext('sales', {
  aggregates: [Customer, Order],
  repositories: [CustomerRepository, OrderRepository],
  services: [PricingService, CreditCheckService]
});

// Get instances
const customerRepo = api.getRepository('CustomerRepository');
const orderRepo = api.getRepository('OrderRepository');
const creditCheck = api.getService('CreditCheckService');
const pricing = api.getService('PricingService');

// Create application service
const orderService = new OrderService(customerRepo, orderRepo, creditCheck, pricing);

// Handle domain events
api.onDomainEvent('OrderSubmitted', async (event) => {
  console.log('Order submitted:', event.data.orderId);
  // Could trigger payment processing, inventory check, etc.
});

api.onDomainEvent('CreditLimitChanged', async (event) => {
  console.log('Credit limit changed for customer:', event.data.customerId);
  // Could notify sales team, update risk assessment, etc.
});

// =============================================================================
// PRESENTATION LAYER - HTTP API
// =============================================================================

const app = express();
api.use(HTTPPlugin, { app, basePath: '/api' });

// Additional application endpoints
app.post('/api/orders/place', express.json(), async (req, res) => {
  try {
    const { customerId, items, shippingAddress } = req.body;
    
    const order = await orderService.placeOrder(
      customerId,
      items,
      new Address(shippingAddress)
    );
    
    res.json({
      success: true,
      orderId: order.id,
      total: order.total
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Example usage / demo
async function demo() {
  console.log('\n=== DDD Example Demo ===\n');
  
  // 1. Register a customer
  console.log('1. Registering customer...');
  const customer = new Customer();
  customer.register(
    'Alice Johnson',
    'alice@example.com',
    5000 // $5000 credit limit
  );
  await customerRepo.save(customer);
  
  // 2. Create a product catalog (simplified)
  const products = [
    { id: 'LAPTOP-1', name: 'ThinkPad X1', price: 1299 },
    { id: 'MOUSE-1', name: 'MX Master 3', price: 99 },
    { id: 'KEYBOARD-1', name: 'Mechanical Keyboard', price: 149 }
  ];
  
  // 3. Place an order
  console.log('\n2. Placing order...');
  const order = await orderService.placeOrder(
    customer.id,
    [
      { productId: 'LAPTOP-1', productName: 'ThinkPad X1', price: 1299, quantity: 1 },
      { productId: 'MOUSE-1', productName: 'MX Master 3', price: 99, quantity: 2 }
    ],
    {
      street: '123 Main St',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94105',
      country: 'USA'
    }
  );
  
  console.log(`Order placed: ${order.id}, Total: $${order.total.amount}`);
  
  // 4. Find premium customers
  console.log('\n3. Finding premium customers...');
  const premiumCustomers = await customerRepo.findPremium();
  console.log(`Premium customers: ${premiumCustomers.length}`);
  
  // 5. Increase credit limit
  console.log('\n4. Increasing credit limit...');
  customer.changeCreditLimit(new Money({ amount: 10000, currency: 'USD' }));
  await customerRepo.save(customer);
  
  // 6. Find premium customers again
  const premiumCustomersAfter = await customerRepo.findPremium();
  console.log(`Premium customers after increase: ${premiumCustomersAfter.length}`);
  
  // 7. Check specifications
  console.log('\n5. Testing specifications...');
  const premiumSpec = new PremiumCustomerSpecification();
  const activeSpec = new ActiveCustomerSpecification();
  const combinedSpec = premiumSpec.and(activeSpec);
  
  console.log(`Is premium: ${premiumSpec.isSatisfiedBy(customer)}`);
  console.log(`Is active: ${activeSpec.isSatisfiedBy(customer)}`);
  console.log(`Is premium AND active: ${combinedSpec.isSatisfiedBy(customer)}`);
  
  // 8. High value orders
  console.log('\n6. Finding high value orders...');
  const highValueOrders = await orderRepo.findHighValueOrders(1000);
  console.log(`High value orders: ${highValueOrders.length}`);
}

// Run the demo and start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3000;
  
  app.listen(PORT, async () => {
    console.log(`DDD API running on http://localhost:${PORT}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /api/customers - Create customer`);
    console.log(`  GET  /api/customers - List customers`);
    console.log(`  POST /api/orders - Create order`);
    console.log(`  GET  /api/orders - List orders`);
    console.log(`  POST /api/orders/place - Place order (with credit check)`);
    
    await demo();
  });
}