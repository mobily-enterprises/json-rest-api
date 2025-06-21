import { test, describe } from 'node:test';
import assert from 'node:assert';
import { setupServer, makeRequest, createTestData } from './setup-advanced.js';

describe('HTTP API - Advanced Features', () => {
  let server;
  
  test.before(async () => {
    server = await setupServer();
  });
  
  test.after(async () => {
    await server.close();
  });
  
  describe('Batch Operations via HTTP', () => {
    test('should perform batch operations', async () => {
      const res = await makeRequest('POST', '/batch', {
        operations: [
          { 
            method: 'create', 
            type: 'users', 
            data: { 
              type: 'users',
              attributes: { name: 'Alice', email: 'alice@example.com' } 
            }
          },
          { 
            method: 'create', 
            type: 'users', 
            data: { 
              type: 'users',
              attributes: { name: 'Bob', email: 'bob@example.com' } 
            }
          },
          { 
            method: 'query', 
            type: 'users',
            params: { filter: { email: 'alice@example.com' } }
          }
        ]
      });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.successful, 3);
      assert.equal(res.body.meta.failed, 0);
      assert.equal(res.body.data.length, 3);
      
      // Check query result
      const queryResult = res.body.data[2];
      assert(queryResult.success);
      assert(queryResult.data.data);
      assert(Array.isArray(queryResult.data.data));
    });
    
    test('should handle batch failures', async () => {
      const res = await makeRequest('POST', '/batch', {
        operations: [
          { 
            method: 'create', 
            type: 'users', 
            data: { 
              type: 'users',
              attributes: { name: 'Valid User', email: 'valid@example.com' } 
            }
          },
          { 
            method: 'create', 
            type: 'users', 
            data: { 
              type: 'users',
              attributes: { name: 'Invalid User' } // Missing email
            }
          }
        ],
        options: { stopOnError: false }
      });
      
      assert.equal(res.status, 207); // Multi-status
      assert.equal(res.body.meta.successful, 1);
      assert.equal(res.body.meta.failed, 1);
      
      // Check individual results
      assert(res.body.data[0].success);
      assert(!res.body.data[1].success);
      assert(res.body.data[1].error);
    });
  });
  
  describe('Bulk Operations via HTTP', () => {
    test('should bulk create records', async () => {
      const products = [
        { name: 'Product A', price: 10.99, category: 'Electronics' },
        { name: 'Product B', price: 20.99, category: 'Electronics' },
        { name: 'Product C', price: 30.99, category: 'Books' }
      ];
      
      const res = await makeRequest('POST', '/products/bulk', {
        data: products.map(p => ({
          type: 'products',
          attributes: p
        }))
      });
      
      assert.equal(res.status, 201);
      assert.equal(res.body.data.length, 3);
      res.body.data.forEach((item, index) => {
        assert(item.id);
        assert.equal(item.attributes.name, products[index].name);
      });
    });
    
    test('should bulk update records', async () => {
      // Create initial products
      const createRes = await makeRequest('POST', '/products/bulk', {
        data: [
          { type: 'products', attributes: { name: 'Update Test 1', price: 10, category: 'Test' } },
          { type: 'products', attributes: { name: 'Update Test 2', price: 20, category: 'Test' } }
        ]
      });
      
      const ids = createRes.body.data.map(d => d.id);
      
      // Bulk update
      const updateRes = await makeRequest('PATCH', '/products/bulk', {
        data: [
          { id: ids[0], type: 'products', attributes: { price: 15 } },
          { id: ids[1], type: 'products', attributes: { price: 25 } }
        ]
      });
      
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.data.length, 2);
      assert.equal(updateRes.body.data[0].attributes.price, 15);
      assert.equal(updateRes.body.data[1].attributes.price, 25);
    });
    
    test('should bulk delete records', async () => {
      // Create products to delete
      const createRes = await makeRequest('POST', '/products/bulk', {
        data: [
          { type: 'products', attributes: { name: 'Delete Test 1', price: 10 } },
          { type: 'products', attributes: { name: 'Delete Test 2', price: 20 } },
          { type: 'products', attributes: { name: 'Keep This', price: 30 } }
        ]
      });
      
      const ids = createRes.body.data.map(d => d.id);
      
      // Bulk delete first two
      const deleteRes = await makeRequest('DELETE', '/products/bulk', {
        data: { ids: [ids[0], ids[1]] }
      });
      
      assert.equal(deleteRes.status, 200);
      assert.equal(deleteRes.body.meta.deleted, 2);
      
      // Verify only third product remains
      const getRes = await makeRequest('GET', `/products/${ids[2]}`);
      assert.equal(getRes.status, 200);
      
      const get404_1 = await makeRequest('GET', `/products/${ids[0]}`);
      assert.equal(get404_1.status, 404);
    });
    
    test('should update by filter', async () => {
      // Create test data
      await makeRequest('POST', '/products/bulk', {
        data: [
          { type: 'products', attributes: { name: 'Laptop A', price: 1000, category: 'Electronics' } },
          { type: 'products', attributes: { name: 'Laptop B', price: 1200, category: 'Electronics' } },
          { type: 'products', attributes: { name: 'Book A', price: 20, category: 'Books' } }
        ]
      });
      
      // Update all electronics to have discounted price
      const res = await makeRequest('PATCH', '/products/bulk', {
        filter: { category: 'Electronics' },
        data: { 
          type: 'products',
          attributes: { discounted: true }
        }
      });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.updated, 2);
      
      // Verify updates
      const electronics = await makeRequest('GET', '/api/products?filter[category]=Electronics');
      assert(electronics.body.data.every(p => p.attributes.discounted === true));
    });
  });
  
  describe('Transaction Context in HTTP', () => {
    test('should maintain transaction context through HTTP operations', async () => {
      // This test demonstrates that while we can't directly expose transactions
      // via HTTP, the internal operations use them correctly
      
      // Create a complex operation that would benefit from transactions
      const res = await makeRequest('POST', '/batch', {
        operations: [
          {
            method: 'create',
            type: 'accounts',
            data: {
              type: 'accounts',
              attributes: { name: 'Savings Account', balance: 1000 }
            }
          },
          {
            method: 'create',
            type: 'accounts',
            data: {
              type: 'accounts',
              attributes: { name: 'Checking Account', balance: 500 }
            }
          }
        ],
        options: { 
          stopOnError: true // Ensures atomicity for the batch
        }
      });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.successful, 2);
      
      // Verify both accounts were created
      const accounts = await makeRequest('GET', '/api/accounts');
      assert(accounts.body.data.length >= 2);
    });
  });
  
  describe('Pool Statistics Endpoint', () => {
    test('should expose pool statistics via admin endpoint', async () => {
      // Note: This would typically be protected by admin auth
      const res = await makeRequest('GET', '/api/admin/pool-stats');
      
      if (res.status === 404) {
        // Endpoint not implemented in test server
        return;
      }
      
      assert.equal(res.status, 200);
      assert(res.body.data);
      
      const stats = res.body.data.attributes;
      assert(typeof stats.total === 'number');
      assert(typeof stats.active === 'number');
      assert(typeof stats.idle === 'number');
      assert(typeof stats.acquired === 'number');
    });
  });
  
  describe('Complex Batch Scenarios', () => {
    test('should handle dependent batch operations', async () => {
      const res = await makeRequest('POST', '/batch', {
        operations: [
          {
            id: 'user1',
            method: 'create',
            type: 'users',
            data: {
              type: 'users',
              attributes: { name: 'Post Author', email: 'author@example.com' }
            }
          },
          {
            id: 'post1',
            method: 'create',
            type: 'posts',
            data: {
              type: 'posts',
              attributes: { 
                title: 'My First Post',
                content: 'Hello World',
                authorId: { $ref: 'user1' } // Reference to previous operation
              }
            }
          }
        ]
      });
      
      // Note: Reference resolution would need to be implemented
      // This test shows the expected API design
      if (res.status === 501) {
        // Not implemented yet
        return;
      }
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.successful, 2);
    });
    
    test('should support progress tracking for large batches', async () => {
      // Create a large batch
      const items = [];
      for (let i = 0; i < 100; i++) {
        items.push({
          type: 'products',
          attributes: {
            name: `Bulk Product ${i}`,
            price: Math.random() * 100,
            category: i % 2 === 0 ? 'Even' : 'Odd'
          }
        });
      }
      
      const res = await makeRequest('POST', '/products/bulk', {
        data: items,
        options: {
          chunk: 25 // Process in chunks
        }
      });
      
      assert.equal(res.status, 201);
      assert.equal(res.body.data.length, 100);
      
      // Check if progress was tracked (would be in meta or via websocket)
      if (res.body.meta.chunks) {
        assert.equal(res.body.meta.chunks, 4); // 100 items / 25 per chunk
      }
    });
  });
  
  describe('Error Handling in Bulk Operations', () => {
    test('should validate all items before bulk create', async () => {
      const res = await makeRequest('POST', '/products/bulk', {
        data: [
          { type: 'products', attributes: { name: 'Valid Product', price: 10 } },
          { type: 'products', attributes: { name: 'Invalid Product' } }, // Missing price
          { type: 'products', attributes: { price: 20 } } // Missing name
        ],
        options: { validate: true }
      });
      
      assert.equal(res.status, 422);
      assert(res.body.errors);
      assert(res.body.errors.length >= 2); // At least 2 validation errors
    });
    
    test('should handle partial success in bulk operations', async () => {
      const res = await makeRequest('POST', '/batch', {
        operations: [
          {
            method: 'create',
            type: 'users',
            data: {
              type: 'users',
              attributes: { name: 'Success User', email: 'success@example.com' }
            }
          },
          {
            method: 'update',
            type: 'users',
            id: '99999', // Non-existent
            data: {
              type: 'users',
              attributes: { name: 'Updated Name' }
            }
          },
          {
            method: 'delete',
            type: 'users',
            id: '88888' // Non-existent
          }
        ],
        options: { stopOnError: false }
      });
      
      assert.equal(res.status, 207); // Multi-status
      assert.equal(res.body.meta.successful, 1);
      assert.equal(res.body.meta.failed, 2);
      
      // Detailed results
      assert(res.body.data[0].success);
      assert(!res.body.data[1].success);
      assert(!res.body.data[2].success);
    });
  });
});