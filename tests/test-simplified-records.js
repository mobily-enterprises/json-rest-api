import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Api, Schema, MemoryPlugin, SimplifiedRecordsPlugin } from '../index.js';

describe('SimplifiedRecordsPlugin Tests', () => {
  describe('Basic functionality', () => {
    it('should transform JSON:API responses to simplified format', async () => {
      // Create API without SimplifiedRecordsPlugin
      const jsonApi = new Api();
      jsonApi.use(MemoryPlugin);
      
      jsonApi.addResource('users', new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string' }
      }));
      
      await jsonApi.connect();
      const jsonApiUser = await jsonApi.resources.users.create({
        name: 'John Doe',
        email: 'john@example.com'
      });
      
      // Verify JSON:API format
      assert(jsonApiUser.data);
      assert.equal(jsonApiUser.data.type, 'users');
      assert(jsonApiUser.data.attributes);
      assert.equal(jsonApiUser.data.attributes.name, 'John Doe');
      
      // Create API with SimplifiedRecordsPlugin
      const simpleApi = new Api();
      simpleApi.use(MemoryPlugin);
      simpleApi.use(SimplifiedRecordsPlugin);
      
      simpleApi.addResource('users', new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string' }
      }));
      
      await simpleApi.connect();
      const simpleUser = await simpleApi.resources.users.create({
        name: 'Jane Doe',
        email: 'jane@example.com'
      });
      
      // Verify simplified format (attributes merged into data)
      assert(simpleUser.data);
      assert.equal(simpleUser.data.type, 'users');
      assert.equal(simpleUser.data.name, 'Jane Doe');
      assert.equal(simpleUser.data.email, 'jane@example.com');
      assert(!simpleUser.data.attributes); // No attributes wrapper
    });
  });
  
  describe('Relationship embedding', () => {
    it('should embed relationships in attributes', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin);
      
      api.addResource('authors', new Schema({
        name: { type: 'string', required: true }
      }));
      
      api.addResource('books', new Schema({
        title: { type: 'string', required: true },
        authorId: { 
          type: 'id', 
          refs: { 
            resource: 'authors',
            join: { eager: true }
          }
        }
      }));
      
      await api.connect();
      
      const author = await api.resources.authors.create({
        name: 'J.K. Rowling'
      });
      
      const book = await api.resources.books.create({
        title: 'Harry Potter',
        authorId: author.data.id
      });
      
      const retrieved = await api.resources.books.get(book.data.id);
      
      // Should have author object embedded
      assert(retrieved.data.author);
      assert.equal(retrieved.data.author.name, 'J.K. Rowling');
      assert.equal(retrieved.data.authorId, String(author.data.id));
    });
  });
  
  describe('Response flattening', () => {
    it('should flatten responses when configured', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin, {
        flattenResponse: true
      });
      
      api.addResource('items', new Schema({
        name: { type: 'string', required: true }
      }));
      
      await api.connect();
      
      // Single item - should return object directly
      const item = await api.resources.items.create({
        name: 'Test Item'
      });
      
      assert.equal(item.id, '1');
      assert.equal(item.name, 'Test Item');
      assert(!item.data); // No data wrapper
      
      // Query - should return array with meta preserved
      await api.resources.items.create({ name: 'Item 2' });
      const query = await api.resources.items.query({
        pageSize: 1
      });
      
      // Should have records and meta
      assert(Array.isArray(query.records));
      assert.equal(query.records.length, 1);
      assert(query.meta);
      assert.equal(query.meta.totalCount, 2);
    });
  });
  
  describe('Type field exclusion', () => {
    it('should exclude type field when configured', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin, {
        includeType: false
      });
      
      api.addResource('products', new Schema({
        name: { type: 'string', required: true },
        price: { type: 'number' }
      }));
      
      await api.connect();
      
      const product = await api.resources.products.create({
        name: 'Widget',
        price: 19.99
      });
      
      assert(product.data.id);
      assert.equal(product.data.name, 'Widget');
      assert.equal(product.data.price, 19.99);
      assert(!product.data.type); // Type excluded
    });
  });
  
  describe('Complex scenarios', () => {
    it('should handle nested relationships', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin);
      
      api.addResource('countries', new Schema({
        name: { type: 'string', required: true }
      }));
      
      api.addResource('authors', new Schema({
        name: { type: 'string', required: true },
        countryId: {
          type: 'id',
          refs: {
            resource: 'countries',
            join: { eager: true }
          }
        }
      }));
      
      api.addResource('books', new Schema({
        title: { type: 'string', required: true },
        authorId: {
          type: 'id',
          refs: {
            resource: 'authors',
            join: {
              eager: true,
              fields: ['id', 'name', 'countryId']
            }
          }
        }
      }));
      
      await api.connect();
      
      const country = await api.resources.countries.create({ name: 'UK' });
      const author = await api.resources.authors.create({
        name: 'J.K. Rowling',
        countryId: country.data.id
      });
      const book = await api.resources.books.create({
        title: 'Harry Potter',
        authorId: author.data.id
      });
      
      const retrieved = await api.resources.books.get(book.data.id, {
        joins: ['authorId.countryId']
      });
      
      // Should have nested relationships embedded
      assert(retrieved.data.author);
      assert.equal(retrieved.data.author.name, 'J.K. Rowling');
      assert(retrieved.data.author.country);
      assert.equal(retrieved.data.author.country.name, 'UK');
    });
    
    it('should handle null relationships', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin);
      
      api.addResource('categories', new Schema({
        name: { type: 'string', required: true }
      }));
      
      api.addResource('items', new Schema({
        name: { type: 'string', required: true },
        categoryId: {
          type: 'id',
          refs: {
            resource: 'categories',
            join: { eager: true }
          }
        }
      }));
      
      await api.connect();
      
      const item = await api.resources.items.create({
        name: 'Uncategorized Item',
        categoryId: null
      });
      
      const retrieved = await api.resources.items.get(item.data.id);
      
      assert.equal(retrieved.data.name, 'Uncategorized Item');
      assert.equal(retrieved.data.categoryId, null);
      assert(!retrieved.data.category); // No category object for null ID
    });
  });
  
  describe('Error handling', () => {
    it('should handle missing included resources gracefully', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(SimplifiedRecordsPlugin);
      
      // Manually create a response with relationships but no included
      api.hook('beforeSend', async (context) => {
        if (context.isHttp && context.result?.data) {
          // Remove included section to simulate missing data
          delete context.result.included;
        }
      }, 5); // Run before SimplifiedRecordsPlugin
      
      api.addResource('posts', new Schema({
        title: { type: 'string', required: true },
        userId: { type: 'id' }
      }));
      
      await api.connect();
      
      const post = await api.resources.posts.create({
        title: 'Test Post',
        userId: '123'
      });
      
      // Should handle gracefully
      assert(post.data);
      assert.equal(post.data.title, 'Test Post');
      assert.equal(post.data.userId, '123');
    });
  });
});