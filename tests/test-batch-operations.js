import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin, MySQLPlugin } from '../index.js';
import { setupMySQL, robustTeardown } from './utils/test-helpers.js';

describe('Batch Operations', () => {
  describe('Basic Batch Operations', () => {
    let api;
    
    test.beforeEach(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      const userSchema = new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        active: { type: 'boolean', default: true }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string' },
        authorId: { type: 'id', refs: { resource: 'users' } },
        published: { type: 'boolean', default: false }
      });
      
      api.addResource('users', userSchema);
      api.addResource('posts', postSchema);
    });
    
    test('should perform mixed batch operations', async () => {
      const results = await api.batch([
        { method: 'create', type: 'users', data: { name: 'Alice', email: 'alice@example.com' } },
        { method: 'create', type: 'users', data: { name: 'Bob', email: 'bob@example.com' } },
        { method: 'create', type: 'posts', data: { title: 'Post 1', authorId: 1 } },
        { method: 'update', type: 'posts', id: 1, data: { published: true } },
        { method: 'query', type: 'users', params: { filter: { active: true } } }
      ]);
      
      assert.equal(results.successful, 5);
      assert.equal(results.failed, 0);
      assert.equal(results.results.length, 5);
      
      // Verify query result
      const queryResult = results.results[4];
      assert(queryResult.success);
      assert.equal(queryResult.data.data.length, 2);
    });
    
    test('should handle batch operation failures', async () => {
      const results = await api.batch([
        { method: 'create', type: 'users', data: { name: 'Alice', email: 'alice@example.com' } },
        { method: 'create', type: 'users', data: { name: 'Bob' } }, // Missing email
        { method: 'update', type: 'users', id: 999, data: { name: 'Updated' } }, // Non-existent
      ], { stopOnError: false });
      
      assert.equal(results.successful, 1);
      assert.equal(results.failed, 2);
      
      // Check individual results
      assert(results.results[0].success);
      assert(!results.results[1].success);
      assert(results.results[1].error.includes('required'));
      assert(!results.results[2].success);
    });
    
    test('should stop on error when requested', async () => {
      try {
        await api.batch([
          { method: 'create', type: 'users', data: { name: 'Alice', email: 'alice@example.com' } },
          { method: 'create', type: 'users', data: { name: 'Bob' } }, // Missing email
          { method: 'create', type: 'users', data: { name: 'Charlie', email: 'charlie@example.com' } },
        ], { stopOnError: true });
        
        assert.fail('Should have thrown error');
      } catch (error) {
        // Expected
      }
      
      // Only first operation should have completed
      const users = await api.resources.users.query();
      assert.equal(users.data.length, 1);
    });
  });
  
  describe('Bulk Operations', () => {
    let api;
    
    test.beforeEach(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      const productSchema = new Schema({
        name: { type: 'string', required: true },
        price: { type: 'number', required: true },
        stock: { type: 'number', default: 0 },
        category: { type: 'string' }
      });
      
      api.addResource('products', productSchema);
    });
    
    test('should bulk create records', async () => {
      const products = [
        { name: 'Product 1', price: 10.99, stock: 100 },
        { name: 'Product 2', price: 20.99, stock: 50 },
        { name: 'Product 3', price: 30.99, stock: 25 }
      ];
      
      const results = await api.resources.products.bulk.create(products);
      
      assert.equal(results.length, 3);
      results.forEach((result, index) => {
        assert.equal(result.name, products[index].name);
        assert(result.id);
      });
      
      // Verify all created
      const allProducts = await api.resources.products.query();
      assert.equal(allProducts.data.length, 3);
    });
    
    test('should validate bulk create', async () => {
      const products = [
        { name: 'Valid Product', price: 10.99 },
        { name: 'Invalid Product' }, // Missing price
        { price: 20.99 } // Missing name
      ];
      
      try {
        await api.resources.products.bulk.create(products);
        assert.fail('Should have failed validation');
      } catch (error) {
        assert.equal(error.name, 'ValidationError');
        assert(error.context.errors);
        assert.equal(error.context.errors.length, 2);
      }
    });
    
    test('should bulk update records', async () => {
      // Create initial products
      const p1 = await api.resources.products.create({ name: 'Product 1', price: 10, category: 'A' });
      const p2 = await api.resources.products.create({ name: 'Product 2', price: 20, category: 'A' });
      const p3 = await api.resources.products.create({ name: 'Product 3', price: 30, category: 'B' });
      
      // Bulk update by individual IDs
      const updates = [
        { id: p1.id, data: { price: 15 } },
        { id: p2.id, data: { price: 25 } }
      ];
      
      const results = await api.resources.products.bulk.update(updates);
      assert.equal(results.length, 2);
      
      // Verify updates
      const updated1 = await api.resources.products.get(p1.id);
      assert.equal(updated1.price, 15);
      
      const updated2 = await api.resources.products.get(p2.id);
      assert.equal(updated2.price, 25);
    });
    
    test('should bulk delete records', async () => {
      // Create products
      const p1 = await api.resources.products.create({ name: 'Product 1', price: 10 });
      const p2 = await api.resources.products.create({ name: 'Product 2', price: 20 });
      const p3 = await api.resources.products.create({ name: 'Product 3', price: 30 });
      
      // Bulk delete
      const results = await api.resources.products.bulk.delete([p1.id, p3.id]);
      assert.equal(results.length, 2);
      
      // Verify only p2 remains
      const remaining = await api.resources.products.query();
      assert.equal(remaining.data.length, 1);
      assert.equal(remaining.data[0].id, p2.id);
    });
    
    test('should handle progress callback', async () => {
      const products = [];
      for (let i = 0; i < 100; i++) {
        products.push({ name: `Product ${i}`, price: i * 10 });
      }
      
      const progress = [];
      await api.resources.products.bulk.create(products, {
        chunk: 25,
        onProgress: (done, total) => {
          progress.push({ done, total });
        }
      });
      
      // Should have 4 progress updates (25, 50, 75, 100)
      assert.equal(progress.length, 4);
      assert.equal(progress[0].done, 25);
      assert.equal(progress[3].done, 100);
      assert.equal(progress[0].total, 100);
    });
  });
  
  describe('Batch Transactions', () => {
    describe('Memory Storage', () => {
      let api;
      
      test.beforeEach(async () => {
        api = new Api();
        api.use(MemoryPlugin);
        
        const accountSchema = new Schema({
          name: { type: 'string', required: true },
          balance: { type: 'number', required: true }
        });
        
        api.addResource('accounts', accountSchema);
      });
      
      test('should execute batch in simulated transaction', async () => {
        const result = await api.batch.transaction(async (batch) => {
          const accounts = await batch.resources.accounts.create([
            { name: 'Account 1', balance: 1000 },
            { name: 'Account 2', balance: 2000 }
          ]);
          
          assert.equal(accounts.length, 2);
          return accounts;
        });
        
        assert.equal(result.length, 2);
        
        // Verify created
        const all = await api.resources.accounts.query();
        assert.equal(all.data.length, 2);
      });
    });
    
    // MySQL batch transaction tests
    const mysqlTest = process.env.MYSQL_HOST || process.env.DB_TYPE === 'mysql' 
      ? describe 
      : describe.skip;
      
    mysqlTest('MySQL Storage', () => {
      let api, connection;
      
      test.beforeEach(async () => {
        const setup = await setupMySQL();
        api = setup.api;
        connection = setup.connection;
        
        const orderSchema = new Schema({
          orderNumber: { type: 'string', required: true },
          total: { type: 'number', required: true },
          status: { type: 'string', default: 'pending' }
        });
        
        const orderItemSchema = new Schema({
          orderId: { type: 'id', refs: { resource: 'orders' } },
          product: { type: 'string', required: true },
          quantity: { type: 'number', required: true },
          price: { type: 'number', required: true }
        });
        
        api.addResource('orders', orderSchema);
        api.addResource('orderItems', orderItemSchema);
      });
      
      test.afterEach(async () => {
        await robustTeardown({ api, connection });
      });
      
      test('should perform batch operations in transaction', async () => {
        await api.batch.transaction(async (batch) => {
          // Create order
          const order = await api.resources.orders.create({
            orderNumber: 'ORD-001',
            total: 150
          });
          
          // Create order items in bulk
          await batch.resources.orderItems.create([
            { orderId: order.id, product: 'Widget A', quantity: 2, price: 25 },
            { orderId: order.id, product: 'Widget B', quantity: 1, price: 100 }
          ]);
          
          // Update order status
          await api.resources.orders.update(order.id, { status: 'confirmed' });
        });
        
        // Verify all operations completed
        const orders = await api.resources.orders.query();
        assert.equal(orders.data.length, 1);
        assert.equal(orders.data[0].attributes.status, 'confirmed');
        
        const items = await api.resources.orderItems.query();
        assert.equal(items.data.length, 2);
      });
      
      test('should rollback batch on error', async () => {
        try {
          await api.batch.transaction(async (batch) => {
            // Create order
            const order = await api.resources.orders.create({
              orderNumber: 'ORD-002',
              total: 200
            });
            
            // Create valid items
            await batch.resources.orderItems.create([
              { orderId: order.id, product: 'Widget C', quantity: 1, price: 50 }
            ]);
            
            // This will fail - invalid order ID
            await batch.resources.orderItems.create([
              { orderId: 99999, product: 'Widget D', quantity: 1, price: 150 }
            ]);
          });
          
          assert.fail('Should have thrown error');
        } catch (error) {
          // Expected
        }
        
        // Verify nothing was created
        const orders = await api.resources.orders.query();
        assert.equal(orders.data.length, 0);
        
        const items = await api.resources.orderItems.query();
        assert.equal(items.data.length, 0);
      });
      
      test('should handle large batch inserts efficiently', async () => {
        const items = [];
        for (let i = 0; i < 1000; i++) {
          items.push({
            orderNumber: `TEST-${i}`,
            total: Math.random() * 1000,
            status: 'pending'
          });
        }
        
        const startTime = Date.now();
        
        await api.batch.transaction(async (batch) => {
          await batch.resources.orders.create(items, {
            chunk: 100 // Insert 100 at a time
          });
        });
        
        const duration = Date.now() - startTime;
        
        // Verify all created
        const orders = await api.resources.orders.query({ page: { size: 1 } });
        assert.equal(orders.meta.total, 1000);
        
        // Should be reasonably fast (under 5 seconds for 1000 records)
        assert(duration < 5000, `Took ${duration}ms to insert 1000 records`);
      });
    });
  });
  
  describe('Update/Delete by Filter', () => {
    let api;
    
    test.beforeEach(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      const taskSchema = new Schema({
        title: { type: 'string', required: true },
        status: { type: 'string', default: 'pending', searchable: true },
        priority: { type: 'number', default: 0, searchable: true },
        assignee: { type: 'string', searchable: true }
      });
      
      api.addResource('tasks', taskSchema);
      
      // Create test data
      await api.resources.tasks.create({ title: 'Task 1', status: 'pending', priority: 1, assignee: 'alice' });
      await api.resources.tasks.create({ title: 'Task 2', status: 'pending', priority: 2, assignee: 'bob' });
      await api.resources.tasks.create({ title: 'Task 3', status: 'done', priority: 1, assignee: 'alice' });
      await api.resources.tasks.create({ title: 'Task 4', status: 'pending', priority: 3, assignee: 'alice' });
    });
    
    test('should update by filter', async () => {
      const result = await api.resources.tasks.bulk.update({
        filter: { status: 'pending', assignee: 'alice' },
        data: { status: 'in-progress' }
      });
      
      assert.equal(result.updated, 2);
      
      // Verify updates
      const tasks = await api.resources.tasks.query({ filter: { status: 'in-progress' } });
      assert.equal(tasks.data.length, 2);
      assert(tasks.data.every(t => t.attributes.assignee === 'alice'));
    });
    
    test('should delete by filter', async () => {
      const result = await api.resources.tasks.bulk.delete({
        filter: { status: 'done' }
      });
      
      assert.equal(result.deleted, 1);
      
      // Verify remaining
      const tasks = await api.resources.tasks.query();
      assert.equal(tasks.data.length, 3);
      assert(tasks.data.every(t => t.attributes.status !== 'done'));
    });
  });
});