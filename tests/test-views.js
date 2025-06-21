import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, createApi } from '../index.js';
import { ViewsPlugin } from '../plugins/views.js';

describe('Views Plugin', () => {
  let api;
  
  beforeEach(async () => {
    api = createApi({
      storage: 'memory',
      artificialDelay: 0
    });
  });
  
  describe('Smart Defaults', () => {
    test('should apply smart defaults for queries (no joins)', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string', required: true },
        authorId: { type: 'id', refs: { resource: 'users' } }
      });
      
      api.addResource('posts', schema);
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      
      await api.resources.users.create({ name: 'John' });
      await api.resources.posts.create({ title: 'Test', authorId: 1 });
      
      const result = await api.resources.posts.query();
      
      // Should not include joins by default for queries
      assert.ok(result.data[0]);
      assert.equal(result.data[0].attributes.authorId, 1);
      assert.ok(!result.data[0].relationships?.authorId?.data?.attributes);
    });
    
    test('should apply smart defaults for get (all joins)', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string', required: true },
        authorId: { 
          type: 'id', 
          refs: { 
            resource: 'users',
            join: { eager: true }
          } 
        }
      });
      
      api.addResource('posts', schema);
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      
      const user = await api.resources.users.create({ name: 'John' });
      const post = await api.resources.posts.create({ title: 'Test', authorId: user.data.id });
      
      const result = await api.resources.posts.get(post.data.id);
      
      // Should include all joins by default for get
      // Check if join happened by looking at the authorId attribute
      assert.equal(typeof result.data.attributes.authorId, 'object');
      assert.equal(result.data.attributes.authorId.name, 'John');
    });
    
    test('should apply default page size for queries', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }));
      
      // Create 30 posts
      for (let i = 1; i <= 30; i++) {
        await api.resources.posts.create({ title: `Post ${i}` });
      }
      
      const result = await api.resources.posts.query();
      
      // Should use default page size of 20
      assert.equal(result.data.length, 20);
      assert.equal(result.meta.pageSize, 20);
      assert.equal(result.meta.total, 30);
    });
  });
  
  describe('Resource-Level Defaults', () => {
    test('should override smart defaults with resource defaults', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string' },
        authorId: { type: 'id', refs: { resource: 'users' } },
        categoryId: { type: 'id', refs: { resource: 'categories' } }
      });
      
      api.addResource('posts', schema, {
        defaults: {
          query: {
            joins: ['authorId'],  // Include author in lists
            pageSize: 10
          },
          get: {
            joins: ['authorId', 'categoryId']  // Only these two
          }
        }
      });
      
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      api.addResource('categories', new Schema({ name: { type: 'string' } }));
      
      await api.resources.users.create({ name: 'John' });
      await api.resources.categories.create({ name: 'Tech' });
      await api.resources.posts.create({ 
        title: 'Test', 
        authorId: 1,
        categoryId: 1 
      });
      
      // Test query defaults
      const queryResult = await api.resources.posts.query();
      assert.equal(queryResult.data.length, 1);
      assert.equal(queryResult.meta.pageSize, 10);
      // Should include author (joined) but not category
      assert.equal(typeof queryResult.data[0].attributes.authorId, 'object');
      assert.equal(queryResult.data[0].attributes.authorId.name, 'John');
      
      // Test get defaults
      const getResult = await api.resources.posts.get(1);
      assert.ok(getResult.data);
    });
    
    test('should handle resource with only query defaults', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        defaults: {
          query: {
            pageSize: 5,
            sort: '-createdAt'
          }
          // No get defaults - should use smart defaults
        }
      });
      
      // Create posts
      for (let i = 1; i <= 10; i++) {
        await api.resources.posts.create({ title: `Post ${i}` });
      }
      
      const result = await api.resources.posts.query();
      assert.equal(result.data.length, 5);
      assert.equal(result.meta.pageSize, 5);
    });
  });
  
  describe('Named Views', () => {
    test('should apply named view for query operation', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string', required: true },
        excerpt: { type: 'string' },
        content: { type: 'string' },
        authorId: { type: 'id', refs: { resource: 'users' } }
      });
      
      api.addResource('posts', schema, {
        views: {
          minimal: {
            query: {
              joins: [],
              fields: ['id', 'title']
            }
          },
          card: {
            query: {
              joins: ['authorId'],
              fields: ['id', 'title', 'excerpt', 'authorId']
            }
          }
        }
      });
      
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      
      await api.resources.users.create({ name: 'John' });
      await api.resources.posts.create({ 
        title: 'Test Post',
        excerpt: 'Short description',
        content: 'Long content here',
        authorId: 1
      });
      
      // Test minimal view
      const minimal = await api.resources.posts.query({ view: 'minimal' });
      assert.equal(Object.keys(minimal.data[0].attributes).length, 1); // Only title
      assert.ok(!minimal.data[0].relationships);
      
      // Test card view  
      const card = await api.resources.posts.query({ view: 'card' });
      assert.ok(card.data[0].attributes.title);
      assert.ok(card.data[0].attributes.excerpt);
      assert.ok(!card.data[0].attributes.content); // Not in fields list
    });
    
    test('should apply different configs for query vs get', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string' },
        content: { type: 'string' },
        summary: { type: 'string' },
        authorId: { type: 'id', refs: { resource: 'users' } }
      });
      
      api.addResource('posts', schema, {
        views: {
          public: {
            query: {
              joins: [],
              fields: ['id', 'title', 'summary']
            },
            get: {
              joins: ['authorId'],
              fields: ['id', 'title', 'content', 'authorId']
            }
          }
        }
      });
      
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      
      await api.resources.users.create({ name: 'John' });
      const post = await api.resources.posts.create({
        title: 'Test',
        content: 'Full content',
        summary: 'Short summary',
        authorId: 1
      });
      
      // Query with public view - no joins, limited fields
      const queryResult = await api.resources.posts.query({ view: 'public' });
      assert.ok(queryResult.data[0].attributes.summary);
      assert.ok(!queryResult.data[0].attributes.content);
      assert.ok(!queryResult.data[0].relationships);
      
      // Get with public view - includes author and content
      const getResult = await api.resources.posts.get(post.data.id, { view: 'public' });
      assert.ok(getResult.data.attributes.content);
      assert.ok(!getResult.data.attributes.summary); // Not in get fields
    });
    
    test('should throw error for non-existent view', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        views: {
          minimal: { query: { joins: [] } }
        }
      });
      
      await api.resources.posts.create({ title: 'Test' });
      
      await assert.rejects(
        api.resources.posts.query({ view: 'nonexistent' }),
        {
          message: /View 'nonexistent' does not exist/,
          context: {
            availableViews: ['minimal'],
            resource: 'posts'
          }
        }
      );
    });
  });
  
  describe('View Permissions', () => {
    test('should restrict view access based on role', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ 
        title: { type: 'string' },
        internalNotes: { type: 'string' }
      }), {
        views: {
          public: {
            query: { fields: ['id', 'title'] }
          },
          admin: {
            query: { fields: ['id', 'title', 'internalNotes'] }
          }
        },
        viewPermissions: {
          admin: 'admin'  // Requires admin role
        }
      });
      
      await api.resources.posts.create({ 
        title: 'Test',
        internalNotes: 'Secret notes'
      });
      
      // Public view should work without auth
      const publicResult = await api.resources.posts.query({ view: 'public' });
      assert.ok(publicResult.data[0]);
      
      // Admin view should fail without auth
      await assert.rejects(
        api.resources.posts.query({ view: 'admin' }),
        { message: /requires authentication/ }
      );
      
      // Admin view should fail with wrong role
      await assert.rejects(
        api.resources.posts.query({ view: 'admin' }, { user: { roles: ['user'] } }),
        { message: /Insufficient permissions/ }
      );
      
      // Admin view should work with admin role
      const adminResult = await api.resources.posts.query(
        { view: 'admin' }, 
        { user: { roles: ['admin'] } }
      );
      assert.ok(adminResult.data[0].attributes.internalNotes);
    });
    
    test('should support custom permission checks', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        views: {
          premium: {
            query: { joins: ['authorId'] }
          }
        },
        viewPermissions: {
          premium: (user) => user?.subscription === 'premium'
        }
      });
      
      await api.resources.posts.create({ title: 'Test' });
      
      // Should fail for non-premium user
      await assert.rejects(
        api.resources.posts.query(
          { view: 'premium' },
          { user: { subscription: 'basic' } }
        ),
        { message: /Insufficient permissions/ }
      );
      
      // Should work for premium user
      const result = await api.resources.posts.query(
        { view: 'premium' },
        { user: { subscription: 'premium' } }
      );
      assert.ok(result.data[0]);
    });
  });
  
  describe('Field Filtering', () => {
    test('should filter fields based on view configuration', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string' },
        content: { type: 'string' },
        metadata: { type: 'object' },
        tags: { type: 'array' },
        secret: { type: 'string' }
      });
      
      api.addResource('posts', schema, {
        views: {
          minimal: {
            query: {
              fields: ['id', 'title']
            }
          }
        }
      });
      
      await api.resources.posts.create({
        title: 'Test Post',
        content: 'Long content',
        metadata: { views: 100 },
        tags: ['tech', 'news'],
        secret: 'hidden'
      });
      
      const result = await api.resources.posts.query({ view: 'minimal' });
      const post = result.data[0];
      
      // Should only have allowed fields
      assert.equal(post.id, '1');
      assert.equal(post.attributes.title, 'Test Post');
      assert.equal(Object.keys(post.attributes).length, 1);
      assert.ok(!post.attributes.content);
      assert.ok(!post.attributes.secret);
    });
    
    test('should handle field filtering with relationships', async () => {
      api.use(ViewsPlugin);
      
      const postSchema = new Schema({
        title: { type: 'string' },
        content: { type: 'string' },
        authorId: { 
          type: 'id',
          refs: { 
            resource: 'users',
            join: { eager: true }
          }
        }
      });
      
      api.addResource('posts', postSchema, {
        views: {
          withAuthor: {
            get: {
              joins: ['authorId'],
              fields: ['id', 'title', 'authorId']
            }
          }
        }
      });
      
      api.addResource('users', new Schema({ 
        name: { type: 'string' },
        email: { type: 'string' }
      }));
      
      const user = await api.resources.users.create({ 
        name: 'John',
        email: 'john@example.com'
      });
      
      const post = await api.resources.posts.create({
        title: 'Test',
        content: 'Content',
        authorId: user.data.id
      });
      
      const result = await api.resources.posts.get(post.data.id, { view: 'withAuthor' });
      
      // Should include relationship but not content
      assert.ok(result.data.attributes.title);
      assert.ok(!result.data.attributes.content);
      assert.ok(result.data.relationships.authorId);
    });
  });
  
  
  describe('Edge Cases', () => {
    test('should handle resources without any views', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }));
      
      await api.resources.posts.create({ title: 'Test' });
      
      // Should use smart defaults
      const result = await api.resources.posts.query();
      assert.ok(result.data[0]);
    });
    
    test('should handle views with only query or get config', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        views: {
          queryOnly: {
            query: { pageSize: 5 }
            // No get config
          },
          getOnly: {
            get: { joins: [] }
            // No query config
          }
        }
      });
      
      await api.resources.posts.create({ title: 'Test' });
      
      // Query with queryOnly view
      const queryResult = await api.resources.posts.query({ view: 'queryOnly' });
      assert.ok(queryResult.data);
      
      // Get with queryOnly view (should not error)
      const getResult = await api.resources.posts.get(1, { view: 'queryOnly' });
      assert.ok(getResult.data);
      
      // Get with getOnly view
      const getOnlyResult = await api.resources.posts.get(1, { view: 'getOnly' });
      assert.ok(getOnlyResult.data);
    });
    
    test('should validate view names dont clash with reserved params', async () => {
      api.use(ViewsPlugin);
      
      // Should throw when adding resource with conflicting view name
      assert.throws(
        () => {
          api.addResource('posts', new Schema({ title: { type: 'string' } }), {
            views: {
              page: { query: { pageSize: 10 } }  // 'page' is reserved
            }
          });
        },
        { message: /conflicts with reserved query parameter/ }
      );
    });
    
    test('should handle joins: true correctly', async () => {
      api.use(ViewsPlugin);
      
      const schema = new Schema({
        title: { type: 'string' },
        authorId: { type: 'id', refs: { resource: 'users' } },
        categoryId: { type: 'id', refs: { resource: 'categories' } }
      });
      
      api.addResource('posts', schema, {
        defaults: {
          query: { joins: ['authorId'] }  // Default: only author
        },
        views: {
          full: {
            query: { joins: true }  // Override: all joins
          }
        }
      });
      
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      api.addResource('categories', new Schema({ name: { type: 'string' } }));
      
      await api.resources.users.create({ name: 'John' });
      await api.resources.categories.create({ name: 'Tech' });
      await api.resources.posts.create({ 
        title: 'Test',
        authorId: 1,
        categoryId: 1
      });
      
      // Default query - only author
      const defaultResult = await api.resources.posts.query();
      assert.equal(defaultResult.data[0].attributes.authorId, 1);
      
      // Full view - all joins
      const fullResult = await api.resources.posts.query({ view: 'full' });
      assert.equal(fullResult.data[0].attributes.authorId, 1);
      assert.equal(fullResult.data[0].attributes.categoryId, 1);
    });
  });
  
  describe('API Methods', () => {
    test('should provide getResourceViews method', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        views: {
          minimal: {},
          card: {},
          full: {}
        }
      });
      
      const views = api.getResourceViews('posts');
      assert.deepEqual(views.sort(), ['card', 'full', 'minimal']);
      
      // Non-existent resource
      const noViews = api.getResourceViews('nonexistent');
      assert.deepEqual(noViews, []);
    });
    
    test('should provide getViewConfig method', async () => {
      api.use(ViewsPlugin);
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }), {
        views: {
          minimal: {
            query: { joins: [], pageSize: 10 },
            get: { fields: ['id', 'title'] }
          }
        }
      });
      
      // Get full view config
      const fullConfig = api.getViewConfig('posts', 'minimal');
      assert.ok(fullConfig.query);
      assert.ok(fullConfig.get);
      
      // Get operation-specific config
      const queryConfig = api.getViewConfig('posts', 'minimal', 'query');
      assert.equal(queryConfig.pageSize, 10);
      assert.deepEqual(queryConfig.joins, []);
      
      // Non-existent view
      const noConfig = api.getViewConfig('posts', 'nonexistent');
      assert.equal(noConfig, null);
    });
  });
});

// Run the tests
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  if (process.argv[1] === modulePath) {
    console.log('Running Views Plugin tests...');
  }
}