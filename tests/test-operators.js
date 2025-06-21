import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin, ValidationError } from '../index.js';

describe('Query Operators', () => {
  let api;
  
  // Setup before each test
  test.beforeEach(async () => {
    api = new Api();
    api.use(MemoryPlugin);
    
    // Define test schema
    const productSchema = new Schema({
      name: { type: 'string', required: true, searchable: true },
      price: { type: 'number', required: true, searchable: true },
      stock: { type: 'number', default: 0, searchable: true },
      category: { type: 'string', searchable: true },
      tags: { type: 'array', searchable: true },
      active: { type: 'boolean', default: true, searchable: true },
      createdAt: { type: 'timestamp', default: Date.now, searchable: true }
    });
    
    api.addResource('products', productSchema);
    
    // Seed test data
    const products = [
      { name: 'iPhone 15', price: 999, stock: 50, category: 'Electronics', tags: ['apple', 'smartphone'], active: true },
      { name: 'Galaxy S24', price: 899, stock: 30, category: 'Electronics', tags: ['samsung', 'smartphone'], active: true },
      { name: 'MacBook Pro', price: 2499, stock: 15, category: 'Computers', tags: ['apple', 'laptop'], active: true },
      { name: 'Dell XPS', price: 1799, stock: 0, category: 'Computers', tags: ['dell', 'laptop'], active: false },
      { name: 'AirPods Pro', price: 249, stock: 100, category: 'Accessories', tags: ['apple', 'audio'], active: true }
    ];
    
    for (const product of products) {
      await api.insert(product, { type: 'products' });
    }
  });
  
  describe('Comparison Operators', () => {
    test('gt (greater than)', async () => {
      const result = await api.query({
        filter: { price: { gt: 1000 } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      result.data.forEach(item => {
        assert(item.attributes.price > 1000);
      });
    });
    
    test('gte (greater than or equal)', async () => {
      const result = await api.query({
        filter: { price: { gte: 999 } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3);
      result.data.forEach(item => {
        assert(item.attributes.price >= 999);
      });
    });
    
    test('lt (less than)', async () => {
      const result = await api.query({
        filter: { price: { lt: 500 } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'AirPods Pro');
      assert.equal(result.data[0].attributes.price, 249);
    });
    
    test('lte (less than or equal)', async () => {
      const result = await api.query({
        filter: { stock: { lte: 30 } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3);
      result.data.forEach(item => {
        assert(item.attributes.stock <= 30);
      });
    });
    
    test('ne (not equal)', async () => {
      const result = await api.query({
        filter: { category: { ne: 'Electronics' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3);
      result.data.forEach(item => {
        assert.notEqual(item.attributes.category, 'Electronics');
      });
    });
    
    test('multiple operators on same field', async () => {
      const result = await api.query({
        filter: { 
          price: { gte: 500, lt: 2000 }
        }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3); // Galaxy S24 ($899), iPhone 15 ($999), Dell XPS ($1799)
      result.data.forEach(item => {
        assert(item.attributes.price >= 500);
        assert(item.attributes.price < 2000);
      });
    });
  });
  
  describe('Set Operators', () => {
    test('in operator', async () => {
      const result = await api.query({
        filter: { 
          category: { in: ['Electronics', 'Accessories'] }
        }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3);
      result.data.forEach(item => {
        assert(['Electronics', 'Accessories'].includes(item.attributes.category));
      });
    });
    
    test('nin (not in) operator', async () => {
      const result = await api.query({
        filter: { 
          category: { nin: ['Electronics', 'Accessories'] }
        }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      result.data.forEach(item => {
        assert.equal(item.attributes.category, 'Computers');
      });
    });
    
    test('in operator with tags array', async () => {
      const result = await api.query({
        filter: { 
          tags: { in: ['laptop'] }
        }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      result.data.forEach(item => {
        assert(item.attributes.tags.includes('laptop'));
      });
    });
    
    test('in operator requires array value', async () => {
      await assert.rejects(
        api.query({
          filter: { category: { in: 'Electronics' } }
        }, { type: 'products' }),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert(err.validationErrors.some(e => e.message.includes("requires an array value")));
          return true;
        }
      );
    });
  });
  
  describe('String Operators', () => {
    test('startsWith operator', async () => {
      const result = await api.query({
        filter: { name: { startsWith: 'Galaxy' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'Galaxy S24');
    });
    
    test('endsWith operator', async () => {
      const result = await api.query({
        filter: { name: { endsWith: 'Pro' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      result.data.forEach(item => {
        assert(item.attributes.name.endsWith('Pro'));
      });
    });
    
    test('contains operator', async () => {
      const result = await api.query({
        filter: { name: { contains: 'Book' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'MacBook Pro');
    });
    
    test('like operator with SQL pattern', async () => {
      const result = await api.query({
        filter: { name: { like: '%Pod%' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'AirPods Pro');
    });
    
    test('case-insensitive search with ilike', async () => {
      // Note: This test assumes case-insensitive comparison via LOWER()
      // since most databases don't have native ILIKE
      const result = await api.query({
        filter: { name: { ilike: 'airpods%' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'AirPods Pro');
    });
  });
  
  describe('Boolean and Mixed Operators', () => {
    test('boolean equality', async () => {
      const active = await api.query({
        filter: { active: true }
      }, { type: 'products' });
      
      assert.equal(active.data.length, 4);
      
      const inactive = await api.query({
        filter: { active: false }
      }, { type: 'products' });
      
      assert.equal(inactive.data.length, 1);
      assert.equal(inactive.data[0].attributes.name, 'Dell XPS');
    });
    
    test('multiple different operators', async () => {
      const result = await api.query({
        filter: { 
          price: { lte: 1000 },
          active: true,
          stock: { gt: 0 }
        }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      result.data.forEach(item => {
        assert(item.attributes.price <= 1000);
        assert.equal(item.attributes.active, true);
        assert(item.attributes.stock > 0);
      });
    });
  });
  
  describe('Edge Cases and Validation', () => {
    test('unknown operator throws error', async () => {
      await assert.rejects(
        api.query({
          filter: { price: { unknown: 100 } }
        }, { type: 'products' }),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert(err.validationErrors.some(e => e.message.includes("Unknown operator 'unknown'")));
          return true;
        }
      );
    });
    
    test('empty operator object uses default equality', async () => {
      const result = await api.query({
        filter: { price: 999 }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'iPhone 15');
    });
    
    test('operators work with pagination', async () => {
      const result = await api.query({
        filter: { price: { gte: 500 } },
        page: { size: 2, number: 1 },
        sort: '-price'
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2);
      assert.equal(result.meta.total, 4);
      assert.equal(result.meta.totalPages, 2);
      assert(result.data[0].attributes.price >= result.data[1].attributes.price);
    });
    
    test('operators work with sorting', async () => {
      const result = await api.query({
        filter: { active: true },
        sort: 'price'
      }, { type: 'products' });
      
      assert.equal(result.data.length, 4);
      for (let i = 1; i < result.data.length; i++) {
        assert(result.data[i].attributes.price >= result.data[i-1].attributes.price);
      }
    });
  });
  
  describe('Non-searchable Fields', () => {
    test('filtering by non-searchable field throws error', async () => {
      // Add a non-searchable field
      const schema = new Schema({
        name: { type: 'string', required: true, searchable: true },
        secret: { type: 'string' } // NOT searchable
      });
      
      api.addResource('items', schema);
      await api.insert({ name: 'Test', secret: 'hidden' }, { type: 'items' });
      
      await assert.rejects(
        api.query({
          filter: { secret: 'hidden' }
        }, { type: 'items' }),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert(err.validationErrors.some(e => e.message.includes("Field 'secret' is not searchable")));
          return true;
        }
      );
    });
  });
});