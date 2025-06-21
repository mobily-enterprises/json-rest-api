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
      
      assert.equal(result.data.length, 3); // iPhone 15, Galaxy S24, AirPods Pro all match
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
  
  describe('Null/NotNull Operators', () => {
    test.beforeEach(async () => {
      // Add some products with null values
      await api.insert({ name: 'Orphan Product', price: 100, stock: 10, category: null, active: true }, { type: 'products' });
      await api.insert({ name: 'No Tags Product', price: 50, stock: 5, tags: null, active: true }, { type: 'products' });
    });
    
    test('null operator', async () => {
      const result = await api.query({
        filter: { category: { null: true } }
      }, { type: 'products' });
      
      // In AlaSQL, both null and undefined match IS NULL
      // Orphan Product has category: null
      // No Tags Product has category: undefined (not specified)
      assert.equal(result.data.length, 2);
      
      const names = result.data.map(d => d.attributes.name).sort();
      assert.deepEqual(names, ['No Tags Product', 'Orphan Product']);
      
      // Verify one is null and one is undefined
      const orphan = result.data.find(d => d.attributes.name === 'Orphan Product');
      assert.equal(orphan.attributes.category, null);
      
      const noTags = result.data.find(d => d.attributes.name === 'No Tags Product');
      assert.equal(noTags.attributes.category, undefined);
    });
    
    test('notnull operator', async () => {
      const result = await api.query({
        filter: { category: { notnull: true } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 5); // Original 5 products have categories
      result.data.forEach(item => {
        assert.notEqual(item.attributes.category, null);
      });
    });
  });
  
  describe('Between Operator', () => {
    test('between operator with numbers', async () => {
      const result = await api.query({
        filter: { price: { between: [200, 1000] } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 3); // AirPods Pro (249), Galaxy S24 (899), iPhone 15 (999)
      result.data.forEach(item => {
        assert(item.attributes.price >= 200 && item.attributes.price <= 1000);
      });
    });
    
    test('between operator validates array input', async () => {
      await assert.rejects(
        api.query({
          filter: { price: { between: 500 } }
        }, { type: 'products' }),
        (err) => {
          assert.equal(err.name, 'ValidationError');
          assert(err.validationErrors[0].message.includes('requires an array with exactly 2 values'));
          return true;
        }
      );
    });
  });
  
  describe('Case-Insensitive Contains (icontains)', () => {
    test('icontains operator', async () => {
      // First add a product with mixed case
      await api.insert({ name: 'MACBOOK AIR', price: 1299, category: 'Computers', active: true }, { type: 'products' });
      
      const result = await api.query({
        filter: { name: { icontains: 'macbook' } }
      }, { type: 'products' });
      
      assert.equal(result.data.length, 2); // MacBook Pro and MACBOOK AIR
      const names = result.data.map(d => d.attributes.name).sort();
      assert.deepEqual(names, ['MACBOOK AIR', 'MacBook Pro']);
    });
    
    test('icontains with tags', async () => {
      const result = await api.query({
        filter: { tags: { icontains: 'APPLE' } }
      }, { type: 'products' });
      
      // Should find all Apple products even though tags are lowercase
      assert.equal(result.data.length, 3);
    });
  });
});