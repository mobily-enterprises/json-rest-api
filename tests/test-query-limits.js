import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, createApi } from '../index.js';
import { QueryLimitsPlugin } from '../plugins/query-limits.js';

describe('Query Limits Plugin', () => {
  let api;
  
  beforeEach(async () => {
    api = createApi({
      storage: 'memory',
      artificialDelay: 0
    });
    
    // Add QueryLimitsPlugin with test configuration
    api.use(QueryLimitsPlugin, {
      maxJoins: 3,
      maxJoinDepth: 2,
      maxPageSize: 50,
      defaultPageSize: 10,
      maxFilterFields: 5,
      maxSortFields: 2,
      maxQueryCost: 50
    });
    
    // Define test schemas
    const userSchema = new Schema({
      name: { type: 'string', required: true, searchable: true },
      email: { type: 'string', searchable: true },
      age: { type: 'number', searchable: true },
      active: { type: 'boolean', searchable: true },
      departmentId: { type: 'id', refs: { resource: 'departments' } }
    });
    
    const departmentSchema = new Schema({
      name: { type: 'string', required: true, searchable: true },
      companyId: { type: 'id', refs: { resource: 'companies' } }
    });
    
    const companySchema = new Schema({
      name: { type: 'string', required: true },
      countryId: { type: 'id', refs: { resource: 'countries' } }
    });
    
    const postSchema = new Schema({
      title: { type: 'string', required: true, searchable: true },
      content: { type: 'string', searchable: true },
      authorId: { type: 'id', refs: { resource: 'users' } },
      categoryId: { type: 'id', refs: { resource: 'categories' } },
      status: { type: 'string', searchable: true }
    });
    
    // Register resources
    api.addResource('users', userSchema);
    api.addResource('departments', departmentSchema);
    api.addResource('companies', companySchema);
    api.addResource('countries', new Schema({ name: { type: 'string' } }));
    api.addResource('posts', postSchema);
    api.addResource('categories', new Schema({ name: { type: 'string' } }));
    
    // Add test data
    await api.resources.users.create({ name: 'John', email: 'john@test.com', age: 30 });
    await api.resources.posts.create({ title: 'Test Post', content: 'Content' });
  });
  
  describe('Join Limits', () => {
    test('should allow joins within limit', async () => {
      const result = await api.resources.posts.query({
        joins: ['authorId', 'categoryId']
      });
      
      assert.ok(result);
      assert.ok(Array.isArray(result.data));
    });
    
    test('should reject too many joins', async () => {
      await assert.rejects(
        api.resources.posts.query({
          joins: ['authorId', 'categoryId', 'authorId.departmentId', 'extraJoin']
        }),
        {
          message: /Maximum number of joins/
        }
      );
    });
    
    test('should reject joins that are too deep', async () => {
      await assert.rejects(
        api.resources.users.query({
          joins: ['departmentId.companyId.countryId'] // 3 levels deep
        }),
        {
          message: /Maximum join depth/
        }
      );
    });
    
    test('should count nested joins correctly', async () => {
      // This should count as 3 joins total (departmentId + companyId = 2, plus authorId = 3)
      const result = await api.resources.posts.query({
        joins: ['departmentId.companyId', 'authorId']
      });
      
      assert.ok(result);
    });
    
    test('should handle joins=false', async () => {
      const result = await api.resources.posts.query({
        joins: false
      });
      
      assert.ok(result);
    });
  });
  
  describe('Page Size Limits', () => {
    test('should allow page size within limit', async () => {
      const result = await api.resources.users.query({
        page: { size: 30 }
      });
      
      assert.ok(result);
      assert.ok(result.meta.page.size <= 30);
    });
    
    test('should reject page size over limit', async () => {
      await assert.rejects(
        api.resources.users.query({
          page: { size: 100 }
        }),
        {
          message: /Maximum page size/
        }
      );
    });
    
    test('should apply default page size when not specified', async () => {
      const result = await api.resources.users.query({});
      
      assert.equal(result.meta.page.size, 10);
    });
  });
  
  describe('Filter Limits', () => {
    test('should allow filters within limit', async () => {
      const result = await api.resources.users.query({
        filter: {
          name: 'John',
          age: 30,
          active: true
        }
      });
      
      assert.ok(result);
    });
    
    test('should reject too many filter fields', async () => {
      await assert.rejects(
        api.resources.users.query({
          filter: {
            name: 'John',
            email: 'test@test.com',
            age: 30,
            active: true,
            extra1: 'value',
            extra2: 'value'
          }
        }),
        {
          message: /Maximum number of filter fields/
        }
      );
    });
  });
  
  describe('Sort Limits', () => {
    test('should allow sorts within limit', async () => {
      const result = await api.resources.users.query({
        sort: 'name,-age'
      });
      
      assert.ok(result);
    });
    
    test('should reject too many sort fields', async () => {
      await assert.rejects(
        api.resources.users.query({
          sort: 'name,age,email'
        }),
        {
          message: /Maximum number of sort fields/
        }
      );
    });
  });
  
  describe('Query Cost Calculation', () => {
    test('should calculate query cost correctly', async () => {
      const validation = api.validateQueryComplexity({
        joins: ['authorId', 'categoryId'],
        filter: { status: 'published' },
        sort: 'createdAt',
        page: { size: 20 }
      }, 'posts');
      
      assert.ok(validation.valid);
      assert.ok(validation.cost > 0);
      assert.ok(validation.cost <= validation.maxCost);
    });
    
    test('should reject queries exceeding cost limit', async () => {
      await assert.rejects(
        api.resources.posts.query({
          joins: ['authorId.departmentId', 'categoryId'],
          filter: { 
            status: 'published',
            title: 'test',
            content: 'search' 
          },
          sort: 'title,-createdAt',
          page: { size: 50 }
        }),
        {
          message: /Query too complex/
        }
      );
    });
  });
  
  describe('Resource-Specific Limits', () => {
    test('should apply resource-specific overrides', async () => {
      // Reconfigure with resource-specific limits
      api = createApi({ storage: 'memory' });
      
      api.use(QueryLimitsPlugin, {
        maxPageSize: 20,
        resources: {
          posts: {
            maxPageSize: 100  // Higher limit for posts
          }
        }
      });
      
      api.addResource('users', new Schema({ name: { type: 'string' } }));
      api.addResource('posts', new Schema({ title: { type: 'string' } }));
      
      // Users should be limited to 20
      await assert.rejects(
        api.resources.users.query({ page: { size: 50 } }),
        { message: /Maximum page size/ }
      );
      
      // Posts should allow up to 100
      const result = await api.resources.posts.query({ page: { size: 50 } });
      assert.ok(result);
    });
  });
  
  describe('Admin Bypass', () => {
    test('should bypass limits for admin users', async () => {
      const adminUser = { id: 1, roles: ['admin'] };
      
      // This would normally exceed limits
      const result = await api.resources.posts.query({
        joins: ['authorId', 'categoryId', 'authorId.departmentId', 'extraJoin'],
        page: { size: 200 }
      }, {
        user: adminUser
      });
      
      assert.ok(result);
    });
    
    test('should bypass with custom function', async () => {
      api = createApi({ storage: 'memory' });
      
      api.use(QueryLimitsPlugin, {
        maxPageSize: 10,
        bypassCheck: (user) => user?.isPremium === true
      });
      
      api.addResource('posts', new Schema({ title: { type: 'string' } }));
      
      const premiumUser = { id: 1, isPremium: true };
      
      const result = await api.resources.posts.query({
        page: { size: 100 }
      }, {
        user: premiumUser
      });
      
      assert.ok(result);
    });
  });
  
  describe('Edge Cases', () => {
    test('should handle empty queries', async () => {
      const result = await api.resources.users.query({});
      assert.ok(result);
    });
    
    test('should handle string joins parameter', async () => {
      const result = await api.resources.posts.query({
        joins: 'authorId'
      });
      assert.ok(result);
    });
    
    test('should provide helpful error context', async () => {
      try {
        await api.resources.posts.query({
          joins: ['a', 'b', 'c', 'd']
        });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.context);
        assert.equal(error.context.joinCount, 4);
        assert.equal(error.context.maxJoins, 3);
        assert.deepEqual(error.context.joins, ['a', 'b', 'c', 'd']);
      }
    });
  });
});

// Run the tests
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  if (process.argv[1] === modulePath) {
    // Run tests
    console.log('Running Query Limits tests...');
  }
}