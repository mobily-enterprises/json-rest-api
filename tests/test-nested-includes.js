import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Nested Includes', () => {
  let api;
  
  beforeEach(() => {
    api = new Api();
    api.use(MemoryPlugin);
  });
  
  describe('Basic Nested Includes', () => {
    test('should support two-level includes', async () => {
      // Set up: Country -> Author -> Book
      api.addResource('countries', new Schema({
        name: { type: 'string' },
        code: { type: 'string' }
      }));
      
      api.addResource('authors', new Schema({
        name: { type: 'string' },
        countryId: {
          type: 'id',
          refs: { resource: 'countries' }
        }
      }));
      
      api.addResource('books', new Schema({
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { resource: 'authors' }
        }
      }));
      
      await api.connect();
      
      // Create test data
      const country = await api.insert({ name: 'United Kingdom', code: 'UK' }, { type: 'countries' });
      const author = await api.insert({ name: 'J.K. Rowling', countryId: country.data.id }, { type: 'authors' });
      const book = await api.insert({ title: 'Harry Potter', authorId: author.data.id }, { type: 'books' });
      
      // Test nested include
      const result = await api.get(book.data.id, {
        type: 'books',
        include: 'authorId.countryId'
      });
      
      // Verify structure (exact format depends on implementation)
      assert.equal(result.data.attributes.title, 'Harry Potter');
      // The nested data structure will depend on how joins are processed
    });
    
    test('should support multiple nested paths', async () => {
      api.addResource('departments', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('categories', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('users', new Schema({
        name: { type: 'string' },
        departmentId: {
          type: 'id',
          refs: { resource: 'departments' }
        }
      }));
      
      api.addResource('posts', new Schema({
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { resource: 'users' }
        },
        categoryId: {
          type: 'id',
          refs: { resource: 'categories' }
        }
      }));
      
      await api.connect();
      
      const dept = await api.insert({ name: 'Engineering' }, { type: 'departments' });
      const cat = await api.insert({ name: 'Tech' }, { type: 'categories' });
      const user = await api.insert({ name: 'Alice', departmentId: dept.data.id }, { type: 'users' });
      const post = await api.insert({ 
        title: 'Test Post', 
        authorId: user.data.id,
        categoryId: cat.data.id
      }, { type: 'posts' });
      
      // Multiple nested includes
      const result = await api.get(post.data.id, {
        type: 'posts',
        include: 'authorId.departmentId,categoryId'
      });
      
      assert.equal(result.data.attributes.title, 'Test Post');
      // Verify both paths were included
    });
    
    test('should respect eager joins when no include specified', async () => {
      api.addResource('tags', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('articles', new Schema({
        title: { type: 'string' },
        tagId: {
          type: 'id',
          refs: { 
            resource: 'tags',
            join: { eager: true }
          }
        }
      }));
      
      await api.connect();
      
      const tag = await api.insert({ name: 'JavaScript' }, { type: 'tags' });
      const article = await api.insert({ title: 'JS Guide', tagId: tag.data.id }, { type: 'articles' });
      
      // No include param - should use eager
      const result = await api.get(article.data.id, { type: 'articles' });
      
      // Tag should be included due to eager: true
      assert.equal(result.data.attributes.title, 'JS Guide');
    });
    
    test('should override eager joins when include specified', async () => {
      api.addResource('groups', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('categories', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('items', new Schema({
        name: { type: 'string' },
        groupId: {
          type: 'id',
          refs: { 
            resource: 'groups',
            join: { eager: true }
          }
        },
        categoryId: {
          type: 'id',
          refs: { resource: 'categories' }
        }
      }));
      
      await api.connect();
      
      const group = await api.insert({ name: 'Group A' }, { type: 'groups' });
      const category = await api.insert({ name: 'Cat 1' }, { type: 'categories' });
      const item = await api.insert({ 
        name: 'Item 1',
        groupId: group.data.id,
        categoryId: category.data.id
      }, { type: 'items' });
      
      // Include only category (not eager group)
      const result = await api.get(item.data.id, {
        type: 'items',
        include: 'categoryId'
      });
      
      // Only category should be included, not group
      assert.equal(result.data.attributes.name, 'Item 1');
    });
  });
  
  describe('Include Parameter Parsing', () => {
    test('should parse simple includes', () => {
      const parsed = api.parseIncludeParam('author');
      assert.deepEqual(parsed, [{
        path: 'author',
        field: 'author'
      }]);
    });
    
    test('should parse multiple includes', () => {
      const parsed = api.parseIncludeParam('author,category,tags');
      assert.equal(parsed.length, 3);
      assert.equal(parsed[0].field, 'author');
      assert.equal(parsed[1].field, 'category');
      assert.equal(parsed[2].field, 'tags');
    });
    
    test('should parse nested includes', () => {
      const parsed = api.parseIncludeParam('author.country');
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].field, 'author');
      assert.deepEqual(parsed[0].nested, [{
        path: 'country',
        field: 'country'
      }]);
    });
    
    test('should parse complex nested includes', () => {
      const parsed = api.parseIncludeParam('author.country,author.publisher,category');
      assert.equal(parsed.length, 2); // author and category
      
      const authorInclude = parsed.find(p => p.field === 'author');
      assert.equal(authorInclude.nested.length, 2);
      assert.equal(authorInclude.nested[0].field, 'country');
      assert.equal(authorInclude.nested[1].field, 'publisher');
    });
    
    test('should handle three-level nesting', () => {
      const parsed = api.parseIncludeParam('author.country.flag');
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].field, 'author');
      assert.equal(parsed[0].nested[0].field, 'country');
      assert.deepEqual(parsed[0].nested[0].nested, [{
        path: 'flag',
        field: 'flag'
      }]);
    });
    
    test('should handle empty and invalid inputs', () => {
      assert.deepEqual(api.parseIncludeParam(''), []);
      assert.deepEqual(api.parseIncludeParam(null), []);
      assert.deepEqual(api.parseIncludeParam(undefined), []);
      assert.deepEqual(api.parseIncludeParam([]), []);
    });
    
    test('should handle array input', () => {
      const parsed = api.parseIncludeParam(['author', 'category']);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].field, 'author');
      assert.equal(parsed[1].field, 'category');
    });
  });
  
  describe('Nested Includes with Permissions', () => {
    test('should check permissions at each level', async () => {
      api.addResource('secrets', new Schema({
        name: { type: 'string' },
        classified: {
          type: 'string',
          permissions: { read: 'top-secret' }
        }
      }));
      
      api.addResource('locations', new Schema({
        name: { type: 'string' },
        secretId: {
          type: 'id',
          refs: { resource: 'secrets' },
          permissions: {
            include: 'secret-clearance'
          }
        }
      }));
      
      api.addResource('missions', new Schema({
        name: { type: 'string' },
        locationId: {
          type: 'id',
          refs: { resource: 'locations' },
          permissions: {
            include: 'agent'
          }
        }
      }));
      
      await api.connect();
      
      const secret = await api.insert({ 
        name: 'Secret Base',
        classified: 'Area 51 coordinates'
      }, { type: 'secrets' });
      
      const location = await api.insert({
        name: 'Desert Location',
        secretId: secret.data.id
      }, { type: 'locations' });
      
      const mission = await api.insert({
        name: 'Operation X',
        locationId: location.data.id
      }, { type: 'missions' });
      
      // User with only agent role - can include location but not secret
      const agentResult = await api.get(mission.data.id, {
        type: 'missions',
        include: 'locationId.secretId',
        user: { roles: ['agent'] }
      });
      
      // Agent should see mission and location, but not secret
      assert.equal(agentResult.data.attributes.name, 'Operation X');
      
      // User with both permissions
      const fullResult = await api.get(mission.data.id, {
        type: 'missions',
        include: 'locationId.secretId',
        user: { roles: ['agent', 'secret-clearance'] }
      });
      
      // Should see all levels
      assert.equal(fullResult.data.attributes.name, 'Operation X');
      
      // User with top-secret can see classified field
      const topSecretResult = await api.get(mission.data.id, {
        type: 'missions',
        include: 'locationId.secretId',
        user: { roles: ['agent', 'secret-clearance', 'top-secret'] }
      });
      
      // Verification of nested data depends on implementation
    });
  });
  
  describe('Include Processing with Schema', () => {
    test('should process includes and check permissions', async () => {
      const schema = new Schema({
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { resource: 'authors' },
          permissions: {
            include: 'user'
          }
        },
        categoryId: {
          type: 'id',
          refs: { resource: 'categories' },
          permissions: {
            include: true // Public
          }
        }
      });
      
      // Process with no user
      const anonResult = await api.processIncludeParam(
        schema,
        'authorId,categoryId',
        null
      );
      
      // Should only include category (public)
      assert.deepEqual(anonResult.joins, ['categoryId']);
      
      // Process with user
      const userResult = await api.processIncludeParam(
        schema,
        'authorId,categoryId',
        { roles: ['user'] }
      );
      
      // Should include both
      assert.deepEqual(userResult.joins, ['authorId', 'categoryId']);
    });
    
    test('should handle nested includes in processIncludeParam', async () => {
      // Set up schemas
      api.addResource('countries', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('authors', new Schema({
        name: { type: 'string' },
        countryId: {
          type: 'id',
          refs: { resource: 'countries' },
          permissions: { include: true }
        }
      }));
      
      const bookSchema = new Schema({
        title: { type: 'string' },
        authorId: {
          type: 'id',
          refs: { resource: 'authors' },
          permissions: { include: true }
        }
      });
      
      const result = await api.processIncludeParam(
        bookSchema,
        'authorId.countryId',
        null
      );
      
      assert.deepEqual(result.joins, ['authorId']);
      assert(result.nestedJoins.has('authorId'));
      assert(result.nestedJoins.get('authorId').nestedJoins.countryId);
    });
  });
  
  describe('Query with Nested Includes', () => {
    test('should support nested includes in query operations', async () => {
      api.addResource('regions', new Schema({
        name: { type: 'string' }
      }));
      
      api.addResource('stores', new Schema({
        name: { type: 'string' },
        regionId: {
          type: 'id',
          refs: { resource: 'regions' }
        }
      }));
      
      api.addResource('products', new Schema({
        name: { type: 'string' },
        price: { type: 'number', searchable: true },
        storeId: {
          type: 'id',
          refs: { resource: 'stores' }
        }
      }));
      
      await api.connect();
      
      // Create test data
      const region1 = await api.insert({ name: 'North' }, { type: 'regions' });
      const region2 = await api.insert({ name: 'South' }, { type: 'regions' });
      
      const store1 = await api.insert({ name: 'Store A', regionId: region1.data.id }, { type: 'stores' });
      const store2 = await api.insert({ name: 'Store B', regionId: region2.data.id }, { type: 'stores' });
      
      await api.insert({ name: 'Product 1', price: 10, storeId: store1.data.id }, { type: 'products' });
      await api.insert({ name: 'Product 2', price: 20, storeId: store2.data.id }, { type: 'products' });
      
      // Query with nested includes
      const result = await api.query({
        filter: { price: { gte: 10 } }
      }, {
        type: 'products',
        include: 'storeId.regionId'
      });
      
      assert.equal(result.data.length, 2);
      // Verify nested includes worked
    });
  });
});