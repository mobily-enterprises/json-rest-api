import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Virtual Fields', () => {
  let api;
  
  beforeEach(() => {
    api = new Api({ debug: false });
    api.use(MemoryPlugin);
  });
  
  test('should exclude virtual fields from SQL queries', async () => {
    // Define schema with virtual fields
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number', required: true },
      discountedPrice: { 
        type: 'number', 
        virtual: true  // Computed field, not stored in DB
      },
      profitMargin: {
        type: 'number',
        virtual: true,
        permissions: { read: 'admin' }  // Virtual field with permissions
      }
    }));
    
    await api.connect();
    
    // Create a product (virtual fields should be ignored)
    const product = await api.insert({
      name: 'Widget',
      price: 100,
      discountedPrice: 80,  // Should be ignored
      profitMargin: 30      // Should be ignored
    }, { type: 'products' });
    
    // Check that virtual fields were not stored
    assert.equal(product.data.attributes.name, 'Widget');
    assert.equal(product.data.attributes.price, 100);
    assert.equal(product.data.attributes.discountedPrice, undefined);
    assert.equal(product.data.attributes.profitMargin, undefined);
  });
  
  test('should include virtual fields populated by hooks', async () => {
    // Define schema with virtual fields
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      cost: { type: 'number', required: true },
      price: { type: 'number', required: true },
      profit: { 
        type: 'number', 
        virtual: true
      },
      margin: {
        type: 'string',
        virtual: true
      }
    }));
    
    // Add afterGet hook to compute virtual fields
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'products') {
        const product = context.result;
        // Calculate profit
        product.profit = product.price - product.cost;
        // Calculate margin percentage
        product.margin = `${Math.round((product.profit / product.price) * 100)}%`;
      }
    });
    
    await api.connect();
    
    // Create a product
    const created = await api.insert({
      name: 'Premium Widget',
      cost: 60,
      price: 100
    }, { type: 'products' });
    
    // Get the product - hook should populate virtual fields
    const product = await api.get(created.data.id, { type: 'products' });
    
    // Virtual fields should be included in the response
    assert.equal(product.data.attributes.profit, 40);
    assert.equal(product.data.attributes.margin, '40%');
  });
  
  test('should respect permissions on virtual fields', async () => {
    // Define schema with virtual fields having different permissions
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      publicScore: {
        type: 'number',
        virtual: true
        // No permissions = public
      },
      privateScore: {
        type: 'number',
        virtual: true,
        permissions: { read: 'admin' }
      },
      teamScore: {
        type: 'number',
        virtual: true,
        permissions: { read: ['admin', 'manager'] }
      }
    }));
    
    // Add hook to populate virtual fields
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'users') {
        context.result.publicScore = 100;
        context.result.privateScore = 200;
        context.result.teamScore = 300;
      }
    });
    
    await api.connect();
    
    // Create a user
    const created = await api.insert({
      name: 'John Doe',
      email: 'john@example.com'
    }, { type: 'users' });
    
    // Get as anonymous user
    const anonResult = await api.get(created.data.id, { type: 'users' });
    assert.equal(anonResult.data.attributes.publicScore, 100);
    assert.equal(anonResult.data.attributes.privateScore, undefined);
    assert.equal(anonResult.data.attributes.teamScore, undefined);
    
    // Get as manager
    const managerResult = await api.get(created.data.id, { 
      type: 'users',
      user: { roles: ['manager'] }
    });
    assert.equal(managerResult.data.attributes.publicScore, 100);
    assert.equal(managerResult.data.attributes.privateScore, undefined);
    assert.equal(managerResult.data.attributes.teamScore, 300);
    
    // Get as admin
    const adminResult = await api.get(created.data.id, { 
      type: 'users',
      user: { roles: ['admin'] }
    });
    assert.equal(adminResult.data.attributes.publicScore, 100);
    assert.equal(adminResult.data.attributes.privateScore, 200);
    assert.equal(adminResult.data.attributes.teamScore, 300);
  });
  
  test('should work with virtual fields in query results', async () => {
    api.addResource('orders', new Schema({
      orderNumber: { type: 'string', required: true, searchable: true },
      subtotal: { type: 'number', required: true },
      tax: { type: 'number', required: true },
      total: {
        type: 'number',
        virtual: true  // Computed from subtotal + tax
      }
    }));
    
    // Add hook to compute total
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'orders') {
        context.result.total = context.result.subtotal + context.result.tax;
      }
    });
    
    await api.connect();
    
    // Create test orders
    await api.insert({
      orderNumber: 'ORD-001',
      subtotal: 100,
      tax: 10
    }, { type: 'orders' });
    
    await api.insert({
      orderNumber: 'ORD-002',
      subtotal: 200,
      tax: 20
    }, { type: 'orders' });
    
    // Query orders
    const result = await api.query({}, { type: 'orders' });
    
    // Virtual fields should be populated for each result
    assert.equal(result.data[0].attributes.total, 110);
    assert.equal(result.data[1].attributes.total, 220);
  });
  
  test('should work with virtual fields on included resources', async () => {
    // Define schemas
    api.addResource('authors', new Schema({
      name: { type: 'string', required: true },
      birthYear: { type: 'number' },
      age: {
        type: 'number',
        virtual: true  // Computed from birthYear
      }
    }));
    
    api.addResource('books', new Schema({
      title: { type: 'string', required: true },
      authorId: {
        type: 'id',
        refs: { resource: 'authors' }
      }
    }));
    
    // Add hook to compute age
    api.hook('afterGet', async (context) => {
      if (context.options.type === 'authors' && context.result.birthYear) {
        const currentYear = new Date().getFullYear();
        context.result.age = currentYear - context.result.birthYear;
      }
    });
    
    await api.connect();
    
    // Create test data
    const author = await api.insert({
      name: 'Jane Smith',
      birthYear: 1980
    }, { type: 'authors' });
    
    const book = await api.insert({
      title: 'Virtual Reality',
      authorId: author.data.id
    }, { type: 'books' });
    
    // Get book with author included
    const result = await api.get(book.data.id, {
      type: 'books',
      include: 'authorId'
    });
    
    // Find included author
    const includedAuthor = result.included.find(i => i.type === 'authors');
    assert(includedAuthor);
    
    // Virtual field should be populated
    const expectedAge = new Date().getFullYear() - 1980;
    assert.equal(includedAuthor.attributes.age, expectedAge);
  });
  
  test('should not allow virtual fields in queries', async () => {
    api.addResource('metrics', new Schema({
      name: { type: 'string', searchable: true },
      value: { type: 'number', searchable: true },
      computed: {
        type: 'number',
        virtual: true,
        searchable: true  // Should be ignored
      }
    }));
    
    await api.connect();
    
    // Create test data
    await api.insert({
      name: 'CPU Usage',
      value: 75
    }, { type: 'metrics' });
    
    // Try to filter by virtual field - should fail
    try {
      await api.query({
        filter: { computed: 50 }
      }, { type: 'metrics' });
      assert.fail('Should not allow filtering by virtual field');
    } catch (err) {
      assert(err.message.includes('computed'));
    }
  });
});