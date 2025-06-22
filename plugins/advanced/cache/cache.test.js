import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api } from '../../../lib/api.js';
import { Schema } from '../../../lib/schema.js';
import { MemoryPlugin } from '../../memory.js';
import { CachePlugin } from './index.js';
import { HTTPPlugin } from '../../http.js';
import express from 'express';
import request from 'supertest';

describe('CachePlugin', () => {
  let api, app, server;

  beforeEach(async () => {
    api = new Api();
    app = express();
    
    // Basic setup
    api.use(MemoryPlugin);
    api.use(CachePlugin, {
      store: 'memory',
      ttl: 5,
      debugMode: false,
      maxItems: 100,
      permissionAware: true
    });
    api.use(HTTPPlugin, { app });

    // Add test schemas
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      role: { type: 'string', default: 'user' },
      secret: { type: 'string', silent: true },
      points: { type: 'number', default: 0 }
    }));

    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      authorId: {
        type: 'id',
        refs: {
          resource: 'users',
          join: { eager: false }
        }
      },
      published: { type: 'boolean', default: false },
      views: { type: 'number', default: 0 }
    }));

    server = app.listen(0);
  });

  afterEach(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('Basic Caching', () => {
    it('should cache GET requests', async () => {
      // Create a user
      const userResponse = await api.resources.users.insert({
        name: 'John Doe',
        email: 'john@example.com'
      });
      const userId = userResponse.data.id;

      // First request - cache miss
      const stats1 = api.cache.stats();
      const result1 = await api.resources.users.get(userId);
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
      assert.equal(stats2.sets - stats1.sets, 1);

      // Second request - cache hit
      const result2 = await api.resources.users.get(userId);
      const stats3 = api.cache.stats();
      
      assert.equal(stats3.hits - stats2.hits, 1);
      assert.deepEqual(result1, result2);
    });

    it('should cache query requests', async () => {
      // Create test data
      const userResponse = await api.resources.users.insert([
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' },
        { name: 'User 3', email: 'user3@example.com' }
      ]);

      // First query - cache miss
      const stats1 = api.cache.stats();
      const result1 = await api.resources.users.query({ sort: 'name' });
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
      assert.equal(stats2.sets - stats1.sets, 1);

      // Second query - cache hit
      const result2 = await api.resources.users.query({ sort: 'name' });
      const stats3 = api.cache.stats();
      
      assert.equal(stats3.hits - stats2.hits, 1);
      assert.equal(result1.length, result2.length);
    });

    it('should generate different cache keys for different queries', async () => {
      const userResponse = await api.resources.users.insert([
        { name: 'User 1', email: 'user1@example.com', role: 'admin' },
        { name: 'User 2', email: 'user2@example.com', role: 'user' }
      ]);

      // Different queries should have different cache entries
      const query1 = await api.resources.users.query({ filter: { role: 'admin' } });
      const query2 = await api.resources.users.query({ filter: { role: 'user' } });
      const query3 = await api.resources.users.query({ sort: '-name' });

      assert.equal(query1.length, 1);
      assert.equal(query2.length, 1);
      assert.equal(query3.length, 2);

      // All should be cache misses
      const stats = api.cache.stats();
      assert.equal(stats.misses, 3);
      assert.equal(stats.sets, 3);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache on insert', async () => {
      // Query to populate cache
      await api.resources.users.query();
      const stats1 = api.cache.stats();

      // Insert should invalidate
      const userResponse = await api.resources.users.insert({
        name: 'New User',
        email: 'new@example.com'
      });

      // Next query should be a miss
      await api.resources.users.query();
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });

    it('should invalidate cache on update', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Test User',
        email: 'test@example.com'
      });
      const userId = userResponse.data.id;

      // Cache the GET
      await api.resources.users.get(userId);
      const stats1 = api.cache.stats();

      // Update should invalidate
      await api.resources.users.update(userId, { name: 'Updated User' });

      // Next GET should be a miss
      await api.resources.users.get(userId);
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });

    it('should invalidate cache on delete', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Test User',
        email: 'test@example.com'
      });
      const userId = userResponse.data.id;

      // Cache the query
      await api.resources.users.query();
      const stats1 = api.cache.stats();

      // Delete should invalidate
      await api.resources.users.delete(userId);

      // Next query should be a miss
      await api.resources.users.query();
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });

    it('should invalidate related resource caches', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Author',
        email: 'author@example.com'
      });

      // Cache posts query
      await api.resources.posts.query();
      const stats1 = api.cache.stats();

      // Create a post (references users)
      await api.resources.posts.insert({
        title: 'Test Post',
        authorId: userResponse.data.id
      });

      // Both posts and users queries should be invalidated
      await api.resources.posts.query();
      await api.resources.users.query();
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 2);
    });
  });

  describe('Permission-Aware Caching', () => {
    beforeEach(() => {
      // Add permission-aware schema
      api.addResource('documents', new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string' },
        confidential: {
          type: 'boolean',
          default: false,
          permissions: { read: 'admin' }
        },
        ownerId: { type: 'id' }
      }));

      // Mock user context
      api.hook('beforeAll', (context) => {
        // Set user from header
        const role = context.request?.headers?.['x-user-role'] || 'user';
        const userId = context.request?.headers?.['x-user-id'] || '1';
        
        context.user = {
          id: userId,
          roles: [role],
          permissions: {
            admin: role === 'admin',
            read: true
          }
        };
      });
    });

    it('should create different cache entries for different users', async () => {
      // Create test document
      await api.resources.documents.insert({
        title: 'Test Doc',
        content: 'Content',
        confidential: true
      });

      const stats1 = api.cache.stats();

      // Query as regular user
      await request(app)
        .get('/api/documents')
        .set('x-user-role', 'user')
        .set('x-user-id', '1');

      // Query as admin
      await request(app)
        .get('/api/documents')
        .set('x-user-role', 'admin')
        .set('x-user-id', '2');

      const stats2 = api.cache.stats();
      
      // Should be two different cache entries
      assert.equal(stats2.misses - stats1.misses, 2);
      assert.equal(stats2.sets - stats1.sets, 2);
    });

    it('should serve different cached content based on permissions', async () => {
      const doc = await api.resources.documents.insert({
        title: 'Sensitive Doc',
        content: 'Public content',
        confidential: true
      });

      // Request as user
      const userRes = await request(app)
        .get(`/api/documents/${doc.id}`)
        .set('x-user-role', 'user')
        .set('x-user-id', '1');

      // Request as admin
      const adminRes = await request(app)
        .get(`/api/documents/${doc.id}`)
        .set('x-user-role', 'admin')
        .set('x-user-id', '2');

      // Admin should see confidential field, user should not
      assert.equal(adminRes.body.confidential, true);
      assert.equal(userRes.body.confidential, undefined);

      // Both should be cache hits on second request
      const stats1 = api.cache.stats();
      
      await request(app)
        .get(`/api/documents/${doc.id}`)
        .set('x-user-role', 'user')
        .set('x-user-id', '1');
        
      await request(app)
        .get(`/api/documents/${doc.id}`)
        .set('x-user-role', 'admin')
        .set('x-user-id', '2');

      const stats2 = api.cache.stats();
      assert.equal(stats2.hits - stats1.hits, 2);
    });
  });

  describe('Cache Options', () => {
    it('should respect cache: false option', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Test User',
        email: 'test@example.com'
      });

      // Query with cache disabled
      await api.resources.users.query({}, { cache: false });
      await api.resources.users.query({}, { cache: false });

      const stats = api.cache.stats();
      assert.equal(stats.hits, 0);
      assert.equal(stats.sets, 0);
    });

    it('should skip caching for time-based filters', async () => {
      // Add a schema with date field
      api.addResource('events', new Schema({
        name: { type: 'string' },
        date: { type: 'date' }
      }));

      // Query with time-based filter
      await api.resources.events.query({
        filter: { date: { gte: 'today' } }
      });

      const stats = api.cache.stats();
      assert.equal(stats.sets, 0); // Should not cache
    });

    it.skip('should handle cache TTL expiration', async () => {
      // Use short TTL
      api.cache.flush();
      
      const userResponse = await api.resources.users.insert({
        name: 'TTL Test',
        email: 'ttl@example.com'
      });
      const userId = userResponse.data.id;

      // First request - cache miss
      await api.resources.users.get(userId);
      const stats1 = api.cache.stats();

      // Wait for TTL to expire (5 seconds)
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Should be cache miss again
      await api.resources.users.get(userId);
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });
  });

  describe('Cache API', () => {
    it('should provide cache statistics', async () => {
      const stats = api.cache.stats();
      assert.ok(stats.hits >= 0);
      assert.ok(stats.misses >= 0);
      assert.ok(stats.sets >= 0);
      assert.ok(stats.deletes >= 0);
      assert.ok(stats.errors >= 0);
    });

    it('should allow manual cache invalidation', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Manual Test',
        email: 'manual@example.com'
      });

      // Cache it
      const userId = userResponse.data.id;
      await api.resources.users.get(userId);
      const stats1 = api.cache.stats();

      // Manually invalidate
      await api.cache.invalidate('users', userId);

      // Should be miss
      await api.resources.users.get(userId);
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });

    it('should allow cache inspection', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Inspect Test',
        email: 'inspect@example.com'
      });

      await api.resources.users.query();

      const entries = await api.cache.inspect('users');
      assert.ok(entries.length > 0);
      assert.ok(entries[0].key);
      assert.ok(entries[0].size > 0);
      assert.ok(entries[0].timestamp);
    });

    it('should flush entire cache', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Flush Test',
        email: 'flush@example.com'
      });

      await api.resources.users.query();
      const stats1 = api.cache.stats();

      await api.cache.flush();

      await api.resources.users.query();
      const stats2 = api.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });
  });

  describe('Memory Management', () => {
    it('should evict oldest entries when max items reached', async () => {
      // Create API with small cache
      const smallApi = new Api();
      smallApi.use(MemoryPlugin);
      smallApi.use(CachePlugin, {
        store: 'memory',
        maxItems: 3,
        ttl: 3600
      });

      smallApi.addResource('items', new Schema({
        name: { type: 'string' }
      }));

      // Create more items than cache can hold
      const items = [];
      for (let i = 0; i < 5; i++) {
        const itemResponse = await smallApi.resources.items.insert({
          name: `Item ${i}`
        });
        items.push(itemResponse);
        await smallApi.resources.items.get(itemResponse.data.id);
      }

      // First items should be evicted
      const stats1 = smallApi.cache.stats();
      await smallApi.resources.items.get(items[0].data.id); // Should be miss
      const stats2 = smallApi.cache.stats();
      
      assert.equal(stats2.misses - stats1.misses, 1);
    });

    it('should respect memory limits', async () => {
      // Create API with small memory limit
      const smallApi = new Api();
      smallApi.use(MemoryPlugin);
      smallApi.use(CachePlugin, {
        store: 'memory',
        maxMemory: 1024, // 1KB
        ttl: 3600
      });

      smallApi.addResource('large', new Schema({
        data: { type: 'string' }
      }));

      // Create large items
      for (let i = 0; i < 10; i++) {
        const itemResponse = await smallApi.resources.large.insert({
          data: 'x'.repeat(200) // ~400 bytes each
        });
        await smallApi.resources.large.get(itemResponse.data.id);
      }

      // Cache should have evicted items to stay under memory limit
      const entries = await smallApi.cache.inspect('large');
      assert.ok(entries.length < 10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle cache errors gracefully', async () => {
      // Create API with broken cache store
      const brokenApi = new Api();
      brokenApi.use(MemoryPlugin);
      brokenApi.use(CachePlugin, {
        store: 'memory',
        debugMode: true
      });

      brokenApi.addResource('test', new Schema({
        name: { type: 'string' }
      }));

      // Override cache get to throw error
      const originalGet = brokenApi.cache.get;
      brokenApi.cache.get = async () => {
        throw new Error('Cache error');
      };

      // Should still work despite cache error
      const itemResponse = await brokenApi.resources.test.insert({
        name: 'Error Test'
      });
      
      const result = await brokenApi.resources.test.get(itemResponse.data.id);
      assert.equal(result.name, 'Error Test');

      // Restore
      brokenApi.cache.get = originalGet;
    });

    it('should handle concurrent cache access', async () => {
      const promises = [];
      
      // Create test data
      const userResponse = await api.resources.users.insert({
        name: 'Concurrent Test',
        email: 'concurrent@example.com'
      });

      // Make many concurrent requests
      for (let i = 0; i < 50; i++) {
        promises.push(api.resources.users.get(userId));
      }

      const results = await Promise.all(promises);
      
      // All should return same result
      for (const result of results) {
        assert.equal(result.name, 'Concurrent Test');
      }

      // Should have cached effectively
      const stats = api.cache.stats();
      assert.ok(stats.hits > 0);
    });

    it('should handle complex include queries', async () => {
      const userResponse = await api.resources.users.insert({
        name: 'Author',
        email: 'author@example.com'
      });

      await api.resources.posts.insert({
        title: 'Post 1',
        authorId: userId
      });

      // Query with include
      const stats1 = api.cache.stats();
      await api.resources.posts.query({ include: 'authorId' });
      
      // Should cache the query
      const stats2 = api.cache.stats();
      assert.equal(stats2.sets - stats1.sets, 1);

      // Same query should hit cache
      await api.resources.posts.query({ include: 'authorId' });
      const stats3 = api.cache.stats();
      assert.equal(stats3.hits - stats2.hits, 1);

      // Different include should miss
      await api.resources.posts.query({ include: 'authorId.name' });
      const stats4 = api.cache.stats();
      assert.equal(stats4.misses - stats3.misses, 1);
    });
  });
});