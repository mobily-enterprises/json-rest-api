import test from 'ava';
import { createApi } from '../index.js';
import { DDDPlugin, ValueObject, Aggregate, Repository, DomainService, Specification } from '../plugins/enterprise/ddd.js';

// Test Value Objects
test('ValueObject: should be immutable', t => {
  class Money extends ValueObject {
    constructor({ amount, currency }) {
      super({ amount, currency });
    }
  }
  
  const money = new Money({ amount: 100, currency: 'USD' });
  t.throws(() => {
    money.amount = 200;
  });
});

test('ValueObject: should compare by value', t => {
  class Money extends ValueObject {
    constructor({ amount, currency }) {
      super({ amount, currency });
    }
  }
  
  const money1 = new Money({ amount: 100, currency: 'USD' });
  const money2 = new Money({ amount: 100, currency: 'USD' });
  const money3 = new Money({ amount: 200, currency: 'USD' });
  
  t.true(money1.equals(money2));
  t.false(money1.equals(money3));
});

test('ValueObject: should create new instance with changes', t => {
  class Address extends ValueObject {
    constructor({ street, city, zipCode }) {
      super({ street, city, zipCode });
    }
  }
  
  const addr1 = new Address({ street: '123 Main', city: 'Boston', zipCode: '02101' });
  const addr2 = addr1.with({ city: 'Cambridge' });
  
  t.is(addr1.city, 'Boston');
  t.is(addr2.city, 'Cambridge');
  t.is(addr2.street, '123 Main'); // Other properties preserved
});

// Test Entities
test('Entity: should compare by ID', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Product extends api.Entity {
    constructor(id, props) {
      super(id, props);
    }
  }
  
  const product1 = new Product('123', { name: 'Laptop' });
  const product2 = new Product('123', { name: 'Gaming Laptop' });
  const product3 = new Product('456', { name: 'Laptop' });
  
  t.true(product1.equals(product2)); // Same ID
  t.false(product1.equals(product3)); // Different ID
});

test('Entity: should record domain events', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Product extends api.Entity {
    changePrice(newPrice) {
      this.price = newPrice;
      this.recordEvent('PriceChanged', { 
        productId: this.id,
        newPrice 
      });
    }
  }
  
  const product = new Product('123', { price: 100 });
  product.changePrice(150);
  
  const events = product.getEvents();
  t.is(events.length, 1);
  t.is(events[0].name, 'PriceChanged');
  t.is(events[0].data.newPrice, 150);
});

// Test Aggregates
test('Aggregate: should enforce invariants', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Order extends api.Aggregate {
    static get schema() {
      return {
        status: { type: 'string', default: 'pending' },
        items: { type: 'array', default: [] }
      };
    }
    
    addItem(item) {
      this.enforceInvariant(
        this.status === 'pending',
        'Cannot add items to non-pending orders'
      );
      
      this.items.push(item);
    }
  }
  
  const order = new Order('123', { status: 'shipped' });
  
  const error = t.throws(() => {
    order.addItem({ product: 'Widget', quantity: 1 });
  });
  
  t.is(error.message, 'Cannot add items to non-pending orders');
});

// Test Repositories
test('Repository: should save and retrieve aggregates', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Customer extends api.Aggregate {
    static get schema() {
      return {
        name: { type: 'string', required: true },
        email: { type: 'string' }
      };
    }
  }
  
  class CustomerRepository extends api.Repository {
    constructor() {
      super('customers', Customer);
    }
  }
  
  // Set up context
  api.boundedContext('test', {
    aggregates: [Customer],
    repositories: [CustomerRepository]
  });
  
  const repo = api.getRepository('CustomerRepository');
  
  // Create and save
  const customer = new Customer(null, { name: 'John Doe', email: 'john@example.com' });
  await repo.save(customer);
  
  t.truthy(customer.id); // ID assigned
  
  // Retrieve
  const retrieved = await repo.findById(customer.id);
  t.is(retrieved.name, 'John Doe');
  t.true(retrieved instanceof Customer);
});

test('Repository: should handle value objects', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Money extends api.ValueObject {
    constructor({ amount, currency }) {
      super({ amount, currency });
    }
  }
  
  class Product extends api.Aggregate {
    static get schema() {
      return {
        name: { type: 'string', required: true },
        price: { type: 'value', valueObject: Money }
      };
    }
  }
  
  class ProductRepository extends api.Repository {
    constructor() {
      super('products', Product);
    }
  }
  
  api.boundedContext('test', {
    aggregates: [Product],
    repositories: [ProductRepository]
  });
  
  const repo = api.getRepository('ProductRepository');
  
  // Save with value object
  const product = new Product(null, {
    name: 'Widget',
    price: new Money({ amount: 99.99, currency: 'USD' })
  });
  await repo.save(product);
  
  // Retrieve and check value object
  const retrieved = await repo.findById(product.id);
  t.true(retrieved.price instanceof Money);
  t.is(retrieved.price.amount, 99.99);
});

// Test Domain Services
test('DomainService: should have access to API', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class PricingService extends api.DomainService {
    calculateTax(amount, rate) {
      return amount * rate;
    }
  }
  
  api.boundedContext('test', {
    services: [PricingService]
  });
  
  const service = api.getService('PricingService');
  t.truthy(service.api);
  t.is(service.calculateTax(100, 0.08), 8);
});

// Test Specifications
test('Specification: should filter entities', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class PremiumCustomerSpec extends api.Specification {
    isSatisfiedBy(customer) {
      return customer.totalPurchases > 1000;
    }
    
    toQuery() {
      return { totalPurchases: { gt: 1000 } };
    }
  }
  
  const spec = new PremiumCustomerSpec();
  const customer1 = { totalPurchases: 500 };
  const customer2 = { totalPurchases: 1500 };
  
  t.false(spec.isSatisfiedBy(customer1));
  t.true(spec.isSatisfiedBy(customer2));
});

test('Specification: should support composition', t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  const activeSpec = api.specification('Active',
    customer => customer.status === 'active',
    () => ({ status: 'active' })
  );
  
  const premiumSpec = api.specification('Premium',
    customer => customer.creditLimit >= 10000,
    () => ({ creditLimit: { gte: 10000 } })
  );
  
  const active = new activeSpec();
  const premium = new premiumSpec();
  const combined = active.and(premium);
  
  const customer1 = { status: 'active', creditLimit: 5000 };
  const customer2 = { status: 'active', creditLimit: 15000 };
  const customer3 = { status: 'inactive', creditLimit: 15000 };
  
  t.false(combined.isSatisfiedBy(customer1)); // Active but not premium
  t.true(combined.isSatisfiedBy(customer2));  // Active and premium
  t.false(combined.isSatisfiedBy(customer3)); // Premium but not active
});

// Test Bounded Contexts
test('BoundedContext: should organize domain components', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Order extends api.Aggregate {
    static get schema() {
      return { status: { type: 'string' } };
    }
  }
  
  class OrderRepository extends api.Repository {
    constructor() {
      super('orders', Order);
    }
  }
  
  class OrderService extends api.DomainService {
    process() {
      return 'processed';
    }
  }
  
  api.boundedContext('sales', {
    aggregates: [Order],
    repositories: [OrderRepository],
    services: [OrderService]
  });
  
  const context = api.getContext('sales');
  t.truthy(context);
  
  const repo = api.getRepository('OrderRepository');
  t.truthy(repo);
  
  const service = api.getService('OrderService');
  t.is(service.process(), 'processed');
});

// Test Domain Events
test('DomainEvent: should be emitted and handled', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  let eventReceived = null;
  
  api.onDomainEvent('OrderPlaced', (event) => {
    eventReceived = event;
  });
  
  await api.emitDomainEvent({
    name: 'OrderPlaced',
    data: { orderId: '123', total: 100 }
  });
  
  t.truthy(eventReceived);
  t.is(eventReceived.name, 'OrderPlaced');
  t.is(eventReceived.data.orderId, '123');
});

test('DomainEvent: should be published when aggregate is saved', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  class Order extends api.Aggregate {
    static get schema() {
      return {
        status: { type: 'string', default: 'pending' }
      };
    }
    
    place() {
      this.status = 'placed';
      this.recordEvent('OrderPlaced', { orderId: this.id });
    }
  }
  
  class OrderRepository extends api.Repository {
    constructor() {
      super('orders', Order);
    }
  }
  
  api.boundedContext('test', {
    aggregates: [Order],
    repositories: [OrderRepository]
  });
  
  let eventReceived = false;
  api.onDomainEvent('OrderPlaced', () => {
    eventReceived = true;
  });
  
  const repo = api.getRepository('OrderRepository');
  const order = new Order();
  order.place();
  
  await repo.save(order);
  
  t.true(eventReceived);
});

// Integration test
test('DDD Integration: complete order processing flow', async t => {
  const api = createApi({ storage: 'memory' });
  api.use(DDDPlugin);
  
  // Value Objects
  class Money extends api.ValueObject {
    constructor({ amount, currency = 'USD' }) {
      if (amount < 0) throw new Error('Invalid amount');
      super({ amount, currency });
    }
    
    add(other) {
      if (this.currency !== other.currency) {
        throw new Error('Currency mismatch');
      }
      return new Money({
        amount: this.amount + other.amount,
        currency: this.currency
      });
    }
  }
  
  // Aggregates
  class Customer extends api.Aggregate {
    static get schema() {
      return {
        name: { type: 'string', required: true },
        creditLimit: { type: 'value', valueObject: Money }
      };
    }
    
    canAfford(amount) {
      return amount.amount <= this.creditLimit.amount;
    }
  }
  
  class Order extends api.Aggregate {
    static get schema() {
      return {
        customerId: { type: 'id', required: true },
        total: { type: 'value', valueObject: Money },
        status: { type: 'string', default: 'pending' }
      };
    }
    
    place(customerId, total) {
      this.customerId = customerId;
      this.total = total;
      this.status = 'placed';
      
      this.recordEvent('OrderPlaced', {
        orderId: this.id,
        customerId,
        total: total.amount
      });
    }
  }
  
  // Repositories
  class CustomerRepository extends api.Repository {
    constructor() {
      super('customers', Customer);
    }
  }
  
  class OrderRepository extends api.Repository {
    constructor() {
      super('orders', Order);
    }
  }
  
  // Domain Service
  class OrderService extends api.DomainService {
    async placeOrder(customerId, amount) {
      const customerRepo = this.api.getRepository('CustomerRepository');
      const orderRepo = this.api.getRepository('OrderRepository');
      
      const customer = await customerRepo.findById(customerId);
      if (!customer) throw new Error('Customer not found');
      
      if (!customer.canAfford(amount)) {
        throw new Error('Insufficient credit');
      }
      
      const order = new Order();
      order.place(customerId, amount);
      
      await orderRepo.save(order);
      return order;
    }
  }
  
  // Set up bounded context
  api.boundedContext('sales', {
    aggregates: [Customer, Order],
    repositories: [CustomerRepository, OrderRepository],
    services: [OrderService]
  });
  
  // Test the flow
  const customerRepo = api.getRepository('CustomerRepository');
  const orderService = api.getService('OrderService');
  
  // Create customer
  const customer = new Customer(null, {
    name: 'John Doe',
    creditLimit: new Money({ amount: 1000 })
  });
  await customerRepo.save(customer);
  
  // Place order within credit limit
  const order1 = await orderService.placeOrder(
    customer.id,
    new Money({ amount: 500 })
  );
  t.is(order1.status, 'placed');
  
  // Try to place order exceeding credit limit
  await t.throwsAsync(
    orderService.placeOrder(customer.id, new Money({ amount: 2000 })),
    { message: 'Insufficient credit' }
  );
});