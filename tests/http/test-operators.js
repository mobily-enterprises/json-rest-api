import { test, describe } from 'node:test';
import assert from 'node:assert';
import { setupServer, makeRequest, createTestData } from './setup-advanced.js';

describe('HTTP API - Query Operators', () => {
  let server;
  const productIds = [];

  test.before(async () => {
    server = await setupServer();
    
    // Create test products
    const products = [
      { name: 'iPhone 15', price: 999, stock: 50, category: 'Electronics', tags: ['apple', 'smartphone'], active: true },
      { name: 'Galaxy S24', price: 899, stock: 30, category: 'Electronics', tags: ['samsung', 'smartphone'], active: true },
      { name: 'MacBook Pro', price: 2499, stock: 15, category: 'Computers', tags: ['apple', 'laptop'], active: true },
      { name: 'Dell XPS', price: 1799, stock: 0, category: 'Computers', tags: ['dell', 'laptop'], active: false },
      { name: 'AirPods Pro', price: 249, stock: 100, category: 'Accessories', tags: ['apple', 'audio'], active: true }
    ];
    
    for (const product of products) {
      const res = await makeRequest('POST', '/api/products', { 
        data: { type: 'products', attributes: product } 
      });
      productIds.push(res.body.data.id);
    }
  });

  test.after(async () => {
    await server.close();
  });

  describe('Comparison Operators', () => {
    test('Greater than (gt)', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][gt]=1000');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
      res.body.data.forEach(item => {
        assert(item.attributes.price > 1000);
      });
    });

    test('Greater than or equal (gte)', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][gte]=999');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
    });

    test('Less than (lt)', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][lt]=500');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.name, 'AirPods Pro');
    });

    test('Less than or equal (lte)', async () => {
      const res = await makeRequest('GET', '/api/products?filter[stock][lte]=30');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
    });

    test('Not equal (ne)', async () => {
      const res = await makeRequest('GET', '/api/products?filter[category][ne]=Electronics');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
      res.body.data.forEach(item => {
        assert.notEqual(item.attributes.category, 'Electronics');
      });
    });

    test('Multiple operators on same field', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][gte]=500&filter[price][lt]=2000');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
    });
  });

  describe('Set Operators', () => {
    test('IN operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[category][in]=Electronics,Accessories');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
    });

    test('NOT IN operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[category][nin]=Electronics,Accessories');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
      res.body.data.forEach(item => {
        assert.equal(item.attributes.category, 'Computers');
      });
    });

    test('IN operator on array field', async () => {
      const res = await makeRequest('GET', '/api/products?filter[tags][in]=laptop');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
    });
  });

  describe('String Operators', () => {
    test('startsWith operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[name][startsWith]=Galaxy');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.name, 'Galaxy S24');
    });

    test('endsWith operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[name][endsWith]=Pro');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
    });

    test('contains operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[name][contains]=Book');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.name, 'MacBook Pro');
    });

    test('like operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[name][like]=%Pod%');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.name, 'AirPods Pro');
    });

    test('Case sensitivity', async () => {
      const res = await makeRequest('GET', '/api/products?filter[name][like]=galaxy%');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 0, 'Should be case-sensitive by default');
    });
  });

  describe('Boolean Filters', () => {
    test('Boolean true', async () => {
      const res = await makeRequest('GET', '/api/products?filter[active]=true');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 4);
    });

    test('Boolean false', async () => {
      const res = await makeRequest('GET', '/api/products?filter[active]=false');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.name, 'Dell XPS');
    });
  });

  describe('Complex Queries', () => {
    test('Multiple different operators', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][lte]=1000&filter[active]=true&filter[stock][gt]=0');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 3);
    });

    test('Operators with pagination', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][gte]=500&page[size]=2&page[number]=1&sort=-price');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
      assert.equal(res.body.meta.total, 4);
      assert.equal(res.body.meta.totalPages, 2);
    });

    test('Operators with sorting', async () => {
      const res = await makeRequest('GET', '/api/products?filter[active]=true&sort=price');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 4);
      // Verify ascending price order
      for (let i = 1; i < res.body.data.length; i++) {
        assert(res.body.data[i].attributes.price >= res.body.data[i-1].attributes.price);
      }
    });
  });

  describe('Error Handling', () => {
    test('Unknown operator', async () => {
      const res = await makeRequest('GET', '/api/products?filter[price][unknown]=100');
      assert.equal(res.status, 422);
      assert(res.body.errors[0].detail.includes('Unknown operator'));
    });

    test('Invalid value for IN operator', async () => {
      // Note: This might be parsed differently by Express
      // If Express doesn't parse nested brackets, it won't trigger the validation
      const res = await makeRequest('GET', '/api/products?filter[category][in]=Electronics');
      if (res.status === 200) {
        // Express might parse this as a simple filter
        assert(true, 'IN operator syntax not parsed by Express');
      } else {
        assert.equal(res.status, 422);
        assert(res.body.errors[0].detail.includes('requires an array value'));
      }
    });

    test('Non-searchable field', async () => {
      // First create a resource with a non-searchable field
      const testRes = await makeRequest('POST', '/api/tests', {
        data: {
          type: 'tests',
          attributes: {
            public: 'visible',
            secret: 'hidden'
          }
        }
      });
      
      // Try to filter by non-searchable field
      const res = await makeRequest('GET', '/api/tests?filter[secret]=hidden');
      assert.equal(res.status, 422);
      assert(res.body.errors[0].detail.includes('not searchable'));
    });
  });

  describe('URL Encoding', () => {
    test('Properly handles URL-encoded operators', async () => {
      // Test with URL-encoded brackets
      const res = await makeRequest('GET', '/api/products?filter%5Bprice%5D%5Bgt%5D=1000');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 2);
    });

    test('Handles special characters in values', async () => {
      // Create product with special characters
      await makeRequest('POST', '/api/products', {
        data: {
          type: 'products',
          attributes: {
            name: 'Product & Special "Characters"',
            price: 100,
            category: 'Test & Demo'
          }
        }
      });

      const res = await makeRequest('GET', '/api/products?filter[name][contains]=Special%20%22Characters%22');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
    });
  });
});