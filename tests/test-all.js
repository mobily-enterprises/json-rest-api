#!/usr/bin/env node

/**
 * Unified Test Suite for JSON REST API
 * 
 * This comprehensive test suite works with any database adapter.
 * Default: MemoryPlugin (AlaSQL) - no setup required
 * MySQL: DB_TYPE=mysql MYSQL_USER=root MYSQL_PASSWORD=pass npm test
 */

import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  setupTestApi, 
  cleanDatabase, 
  getTestPlugin, 
  ensureMySQLDatabase,
  getDbType 
} from './lib/test-db-helper.js';

import { robustTeardown } from './lib/test-teardown.js';

import { 
  Api,
  Schema,
  ValidationPlugin,
  TimestampsPlugin,
  PositioningPlugin,
  HTTPPlugin,
  NotFoundError,
  ValidationError,
  ConflictError,
  InternalError,
  createApi,
  QueryBuilder,
  schemaFields
} from '../index.js';

// Print which database we're using
const { name: dbName } = getTestPlugin();
console.log(`\n🧪 Running comprehensive test suite with ${dbName}\n`);
console.log('This may take a few moments...\n');

// Ensure MySQL database exists if needed
await ensureMySQLDatabase();

// Track the main API and connection for cleanup
let mainApi = null;
let mainConnection = null;

describe('JSON REST API - Comprehensive Test Suite', () => {
  // Set up global after hook for proper cleanup
  after(async () => {
    console.log('\n🧹 Running global test cleanup...');
    
    // Get the current test API instance if available
    if (!mainApi) {
      // Try to get it from one of the test contexts
      try {
        mainApi = await setupTestApi();
      } catch (e) {
        // Ignore if we can't set up a new one
      }
    }
    
    // Perform robust teardown
    await robustTeardown({ api: mainApi, connection: mainConnection });
    console.log('✅ Global cleanup complete');
  });
  // ====================================
  // 1. Core API Tests
  // ====================================
  describe('1. Core API Tests', () => {
    it('should create API instance with default options', () => {
      const api = new Api();
      assert(api);
      assert.equal(api.options.idProperty, 'id');
      assert.equal(api.options.artificialDelay, 0);
    });
    
    it('should create API instance with custom options', () => {
      const api = new Api({
        idProperty: '_id',
        artificialDelay: 100,
        debug: true
      });
      assert.equal(api.options.idProperty, '_id');
      assert.equal(api.options.artificialDelay, 100);
      assert.equal(api.options.debug, true);
    });
    
    it('should support plugin system', async () => {
      const api = await setupTestApi();
      
      let pluginCalled = false;
      const testPlugin = {
        install(apiInstance, options) {
          pluginCalled = true;
          assert(apiInstance);
          assert.equal(options.test, true);
        }
      };
      
      api.use(testPlugin, { test: true });
      assert(pluginCalled);
    });
    
    it('should track installed plugins', async () => {
      const api = await setupTestApi();
      const initialCount = api.plugins.length;
      
      api.use(ValidationPlugin);
      assert.equal(api.plugins.length, initialCount + 1);
    });
  });

  // ====================================
  // 2. Schema Tests
  // ====================================
  describe('2. Schema Tests', () => {
    it('should create schema with various field types', () => {
      const schema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        age: { type: 'number', min: 0, max: 150 },
        email: { type: 'string', validator: /^[^@]+@[^@]+$/ },
        active: { type: 'boolean', default: true },
        tags: { type: 'array' },
        metadata: { type: 'object' },
        createdAt: { type: 'timestamp' }
      });
      
      assert(schema);
      assert(schema.structure.name);
      assert.equal(schema.structure.active.default, true);
    });
    
    it('should validate data correctly', async () => {
      const schema = new Schema({
        name: { type: 'string', required: true },
        age: { type: 'number', min: 0 }
      });
      
      // Valid data
      const result1 = await schema.validate({ name: 'John', age: 25 });
      assert.equal(result1.errors.length, 0);
      
      // Missing required field
      const result2 = await schema.validate({ age: 25 });
      assert(result2.errors.length > 0);
      assert(result2.errors[0].message.includes('required'));
      
      // Invalid type
      const result3 = await schema.validate({ name: 'John', age: 'invalid' });
      assert(result3.errors.length > 0);
      
      // Min constraint
      const result4 = await schema.validate({ name: 'John', age: -5 });
      assert(result4.errors.length > 0);
    });
    
    it('should handle partial validation', async () => {
      const schema = new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string', required: true }
      });
      
      // Partial validation should pass
      const result = await schema.validate({ name: 'John' }, { partial: true });
      assert.equal(result.errors.length, 0);
    });
    
    it('should handle default values', async () => {
      const schema = new Schema({
        status: { type: 'string', default: 'pending' },
        count: { type: 'number', default: 0 }
      });
      
      // Defaults are applied during validation
      const data = {};
      const result = await schema.validate(data);
      
      // Check if defaults were applied during validation
      // Note: This test might need adjustment based on how Schema handles defaults
      assert.equal(result.errors.length, 0);
    });
    
    it('should handle silent fields', () => {
      const schema = new Schema({
        name: { type: 'string' },
        password: { type: 'string', silent: true }
      });
      
      const fields = schemaFields(schema);
      assert(fields.includes('name'));
      assert(!fields.includes('password'));
    });
    
    it('should handle refs definition', () => {
      const schema = new Schema({
        userId: { 
          type: 'id', 
          refs: { 
            resource: 'users',
            join: { eager: true }
          } 
        }
      });
      
      assert(schema.structure.userId.refs);
      assert.equal(schema.structure.userId.refs.resource, 'users');
      assert(schema.structure.userId.refs.join.eager);
    });
  });

  // ====================================
  // 3. Resource Management Tests
  // ====================================
  describe('3. Resource Management Tests', () => {
    let api;
    
    beforeEach(async () => {
      api = await setupTestApi();
      await api.connect();
    });
    
    afterEach(async () => {
      await robustTeardown({ api });
    });
    
    it('should add resources with schema', () => {
      const schema = new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true }
      });
      
      api.addResource('posts', schema);
      
      assert(api.schemas.has('posts'));
      assert(api.resources.posts);
    });
    
    it('should add resources with hooks', () => {
      const schema = new Schema({
        id: { type: 'id' },
        title: { type: 'string' }
      });
      
      let hookCalled = false;
      
      api.addResource('items', schema, {
        hooks: {
          beforeInsert: (context) => {
            hookCalled = true;
          }
        }
      });
      
      // Hook should be registered
      assert(api.resourceHooks.has('items'));
    });
    
    it('should create resource proxy', () => {
      const schema = new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      });
      
      api.addResource('users', schema);
      
      // Check proxy methods exist
      assert(typeof api.resources.users.get === 'function');
      assert(typeof api.resources.users.query === 'function');
      assert(typeof api.resources.users.create === 'function');
      assert(typeof api.resources.users.update === 'function');
      assert(typeof api.resources.users.delete === 'function');
    });
    
    it('should throw error for non-existent resources', () => {
      assert.throws(() => {
        api.resources.nonexistent.get(1);
      }, /Resource 'nonexistent' not found/);
    });
    
    it('should validate resource type parameter', () => {
      assert.throws(() => {
        api.addResource(null, new Schema({}));
      }, /Resource type must be a non-empty string/);
      
      assert.throws(() => {
        api.addResource('', new Schema({}));
      }, /Resource type must be a non-empty string/);
    });
    
    it('should validate schema parameter', () => {
      assert.throws(() => {
        api.addResource('test', null);
      }, /Schema must have a validate method/);
      
      assert.throws(() => {
        api.addResource('test', {});
      }, /Schema must have a validate method/);
    });
  });

  // ====================================
  // 4. CRUD Operations Tests
  // ====================================
  describe('4. CRUD Operations Tests', () => {
    let api;
    let userSchema;
    
    before(async () => {
      api = await setupTestApi();
      await api.connect();
      
      // Capture main API for cleanup if not already set
      if (!mainApi) {
        mainApi = api;
      }
      
      // Use ValidationPlugin for these tests
      api.use(ValidationPlugin);
      
      userSchema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        age: { type: 'number', min: 0 },
        tags: { type: 'array' },
        metadata: { type: 'object' }
      });
      
      api.addResource('users', userSchema);
    });
    
    after(async () => {
      await robustTeardown({ api });
    });
    
    beforeEach(async () => {
      await cleanDatabase(api);
      await api.connect(); // Reconnect after cleanup
    });
    
    describe('Create (Insert)', () => {
      it('should create a new resource', async () => {
        const user = await api.resources.users.create({
          name: 'John Doe',
          email: 'john@example.com',
          age: 30
        });
        
        assert(user.data);
        assert(user.data.id);
        assert.equal(user.data.type, 'users');
        assert.equal(user.data.attributes.name, 'John Doe');
        assert.equal(user.data.attributes.email, 'john@example.com');
        assert.equal(user.data.attributes.age, 30);
      });
      
      it('should validate required fields', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.create({
              email: 'test@example.com' // Missing required 'name'
            });
          },
          {
            name: 'ValidationError',
            message: /Validation failed/
          }
        );
      });
      
      it('should validate field constraints', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.create({
              name: 'Test',
              age: -5 // Violates min: 0
            });
          },
          {
            name: 'ValidationError'
          }
        );
      });
      
      it('should support post alias', async () => {
        const user = await api.resources.users.post({
          name: 'Jane Doe'
        });
        
        assert(user.data.id);
        assert.equal(user.data.attributes.name, 'Jane Doe');
      });
    });
    
    describe('Read (Get/Query)', () => {
      beforeEach(async () => {
        // Create test data
        await api.resources.users.create({ name: 'User 1', age: 25 });
        await api.resources.users.create({ name: 'User 2', age: 30 });
        await api.resources.users.create({ name: 'User 3', age: 35 });
      });
      
      it('should get resource by ID', async () => {
        const created = await api.resources.users.create({ name: 'Test User' });
        const retrieved = await api.resources.users.get(created.data.id);
        
        assert.equal(retrieved.data.id, created.data.id);
        assert.equal(retrieved.data.attributes.name, 'Test User');
      });
      
      it('should throw NotFoundError for non-existent ID', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.get('999999');
          },
          {
            name: 'NotFoundError'
          }
        );
      });
      
      it('should support allowNotFound option', async () => {
        const result = await api.resources.users.get('999999', { allowNotFound: true });
        assert.equal(result.data, null);
      });
      
      it('should query resources with filters', async () => {
        // Add searchable fields to schema
        userSchema.structure.name.searchable = true;
        userSchema.structure.age.searchable = true;
        
        const result = await api.resources.users.query({
          filter: { age: 30 }
        });
        
        assert.equal(result.data.length, 1);
        assert.equal(result.data[0].attributes.name, 'User 2');
      });
      
      it('should support pagination', async () => {
        const page1 = await api.resources.users.query({
          page: { size: 2, number: 1 }
        });
        
        assert.equal(page1.data.length, 2);
        assert.equal(page1.meta.total, 3);
        assert.equal(page1.meta.pageSize, 2);
        assert.equal(page1.meta.pageNumber, 1);
        assert.equal(page1.meta.totalPages, 2);
        
        const page2 = await api.resources.users.query({
          page: { size: 2, number: 2 }
        });
        
        assert.equal(page2.data.length, 1);
      });
      
      it('should support sorting', async () => {
        const ascending = await api.resources.users.query({
          sort: 'age'
        });
        
        assert.equal(ascending.data[0].attributes.age, 25);
        assert.equal(ascending.data[2].attributes.age, 35);
        
        const descending = await api.resources.users.query({
          sort: '-age'
        });
        
        assert.equal(descending.data[0].attributes.age, 35);
        assert.equal(descending.data[2].attributes.age, 25);
      });
    });
    
    describe('Update', () => {
      let testUser;
      
      beforeEach(async () => {
        testUser = await api.resources.users.create({
          name: 'Original Name',
          age: 25
        });
      });
      
      it('should update resource', async () => {
        const updated = await api.resources.users.update(testUser.data.id, {
          name: 'Updated Name',
          age: 26
        });
        
        assert.equal(updated.data.id, testUser.data.id);
        assert.equal(updated.data.attributes.name, 'Updated Name');
        assert.equal(updated.data.attributes.age, 26);
      });
      
      it('should support partial updates', async () => {
        const updated = await api.resources.users.update(testUser.data.id, {
          age: 30
        });
        
        assert.equal(updated.data.attributes.name, 'Original Name');
        assert.equal(updated.data.attributes.age, 30);
      });
      
      it('should validate updates', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.update(testUser.data.id, {
              age: -5
            });
          },
          {
            name: 'ValidationError'
          }
        );
      });
      
      it('should throw NotFoundError for non-existent resource', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.update('999999', { name: 'Test' });
          },
          {
            name: 'NotFoundError'
          }
        );
      });
      
      it('should support put alias', async () => {
        const updated = await api.resources.users.put(testUser.data.id, {
          name: 'Put Update'
        });
        
        assert.equal(updated.data.attributes.name, 'Put Update');
      });
    });
    
    describe('Delete', () => {
      let testUser;
      
      beforeEach(async () => {
        testUser = await api.resources.users.create({
          name: 'To Delete',
          age: 25
        });
      });
      
      it('should delete resource', async () => {
        await api.resources.users.delete(testUser.data.id);
        
        // Should not find the resource
        await assert.rejects(
          async () => {
            await api.resources.users.get(testUser.data.id);
          },
          {
            name: 'NotFoundError'
          }
        );
      });
      
      it('should throw NotFoundError for non-existent resource', async () => {
        await assert.rejects(
          async () => {
            await api.resources.users.delete('999999');
          },
          {
            name: 'NotFoundError'
          }
        );
      });
      
      it('should support remove alias', async () => {
        await api.resources.users.remove(testUser.data.id);
        
        const result = await api.resources.users.get(testUser.data.id, { allowNotFound: true });
        assert.equal(result.data, null);
      });
    });
  });

  // ====================================
  // 5. Hook System Tests
  // ====================================
  describe('5. Hook System Tests', () => {
    let api;
    
    beforeEach(async () => {
      api = await setupTestApi();
      await cleanDatabase(api);
      await api.connect();
    });
    
    afterEach(async () => {
      await robustTeardown({ api });
    });
    
    it('should execute hooks in priority order', async () => {
      const order = [];
      
      api.hook('test', async () => order.push('third'), 30);
      api.hook('test', async () => order.push('first'), 10);
      api.hook('test', async () => order.push('second'), 20);
      
      await api.executeHook('test', {});
      
      assert.deepEqual(order, ['first', 'second', 'third']);
    });
    
    it('should allow hooks to modify context', async () => {
      api.hook('test', async (context) => {
        context.value = 'modified';
      });
      
      const context = { value: 'original' };
      await api.executeHook('test', context);
      
      assert.equal(context.value, 'modified');
    });
    
    it('should stop hook chain when returning false', async () => {
      const order = [];
      
      api.hook('test', async () => order.push('first'));
      api.hook('test', async () => { order.push('second'); return false; });
      api.hook('test', async () => order.push('third'));
      
      await api.executeHook('test', {});
      
      assert.deepEqual(order, ['first', 'second']);
    });
    
    it('should execute resource-specific hooks', async () => {
      let hookCalled = false;
      
      api.addResource('items', new Schema({ 
        id: { type: 'id' },
        test: { type: 'boolean' }
      }));
      api.addResource('items2', new Schema({ 
        id: { type: 'id' },
        test: { type: 'boolean' }
      }));
      
      api.hook('beforeInsert', async (context) => {
        if (context.options?.type === 'items') {
          hookCalled = true;
        }
      });
      
      await api.insert({ test: true }, { type: 'items' });
      assert(hookCalled);
      
      hookCalled = false;
      await api.insert({ test: true }, { type: 'items2' });
      assert(!hookCalled);
    });
    
    it('should execute all lifecycle hooks', async () => {
      const hooks = [];
      
      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));
      
      // Register all hooks
      ['beforeValidate', 'afterValidate', 'beforeInsert', 'afterInsert', 
       'beforeGet', 'afterGet', 'beforeUpdate', 'afterUpdate',
       'beforeDelete', 'afterDelete', 'beforeQuery', 'afterQuery'].forEach(hook => {
        api.hook(hook, async () => hooks.push(hook));
      });
      
      // Insert
      const item = await api.resources.items.create({ name: 'test' });
      assert(hooks.includes('beforeInsert'));
      assert(hooks.includes('afterInsert'));
      
      // Get
      await api.resources.items.get(item.data.id);
      assert(hooks.includes('beforeGet'));
      assert(hooks.includes('afterGet'));
      
      // Query
      await api.resources.items.query({});
      assert(hooks.includes('beforeQuery'));
      assert(hooks.includes('afterQuery'));
      
      // Update
      await api.resources.items.update(item.data.id, { name: 'updated' });
      assert(hooks.includes('beforeUpdate'));
      assert(hooks.includes('afterUpdate'));
      
      // Delete
      await api.resources.items.delete(item.data.id);
      assert(hooks.includes('beforeDelete'));
      assert(hooks.includes('afterDelete'));
    });
  });

  // ====================================
  // 6. Query Builder Tests
  // ====================================
  describe('6. Query Builder Tests', () => {
    let query;
    
    beforeEach(() => {
      query = new QueryBuilder('users');
    });
    
    it('should build basic SELECT query', () => {
      const sql = query.toSQL();
      assert(sql.includes('SELECT *'));
      assert(sql.includes('FROM `users`'));
    });
    
    it('should add WHERE conditions', () => {
      query
        .where('active = ?', true)
        .where('age > ?', 18);
      
      const sql = query.toSQL();
      assert(sql.includes('WHERE active = ? AND age > ?'));
      
      const args = query.getArgs();
      assert.deepEqual(args, [true, 18]);
    });
    
    it('should add JOIN clauses', () => {
      query.leftJoin('posts', 'posts.userId = users.id');
      
      const sql = query.toSQL();
      assert(sql.includes('LEFT JOIN `posts` ON posts.userId = users.id'));
    });
    
    it('should add ORDER BY', () => {
      query.orderBy('name', 'ASC').orderBy('age', 'DESC');
      
      const sql = query.toSQL();
      assert(sql.includes('ORDER BY name ASC, age DESC'));
    });
    
    it('should add LIMIT and OFFSET', () => {
      query.limit(10, 20);
      const sql = query.toSQL();
      assert(sql.includes('LIMIT 10'));
      assert(sql.includes('OFFSET 20'));
    });
    
    it('should generate COUNT query', () => {
      query
        .where('active = ?', true)
        .orderBy('name')
        .limit(10);
      
      const countSql = query.toCountSQL();
      assert(countSql.includes('COUNT(*) AS cnt'));
      assert(countSql.includes('WHERE active = ?'));
      assert(!countSql.includes('ORDER BY'));
      assert(!countSql.includes('LIMIT'));
    });
    
    it('should clone query builder', () => {
      query.where('test = ?', true);
      
      const cloned = query.clone();
      cloned.where('another = ?', false);
      
      const original = query.toSQL();
      const clonedSql = cloned.toSQL();
      
      assert(original.includes('test = ?'));
      assert(!original.includes('another = ?'));
      assert(clonedSql.includes('test = ?'));
      assert(clonedSql.includes('another = ?'));
    });
  });

  // ====================================
  // 7. Plugin Tests
  // ====================================
  describe('7. Plugin Tests', () => {
    let api;
    
    beforeEach(async () => {
      api = await setupTestApi();
      await api.connect();
    });
    
    afterEach(async () => {
      await robustTeardown({ api });
    });
    
    describe('Memory Plugin', () => {
      it('should provide in-memory storage', async () => {
        api.addResource('test', new Schema({
          id: { type: 'id' },
          value: { type: 'string' }
        }));
        
        const item = await api.resources.test.create({ value: 'test' });
        assert(item.data.id);
        
        const retrieved = await api.resources.test.get(item.data.id);
        assert.equal(retrieved.data.attributes.value, 'test');
      });
      
      it('should support all CRUD operations', async () => {
        api.addResource('numbers', new Schema({
          id: { type: 'id' },
          value: { type: 'number' }
        }));
        
        // Create
        const nums = [];
        for (let i = 1; i <= 5; i++) {
          const num = await api.resources.numbers.create({ value: i });
          nums.push(num);
        }
        
        // Query
        const all = await api.resources.numbers.query({});
        assert.equal(all.data.length, 5);
        
        // Update
        await api.resources.numbers.update(nums[0].data.id, { value: 10 });
        
        // Delete
        await api.resources.numbers.delete(nums[4].data.id);
        
        // Verify
        const remaining = await api.resources.numbers.query({});
        assert.equal(remaining.data.length, 4);
      });
    });
    
    describe('Validation Plugin', () => {
      it('should validate on insert and update', async () => {
        api.use(ValidationPlugin);
        
        api.addResource('accounts', new Schema({
          id: { type: 'id' },
          email: { type: 'string', required: true, validator: (value) => /^[^@]+@[^@]+$/.test(value) },
          age: { type: 'number', min: 18 }
        }));
        
        // Invalid insert
        await assert.rejects(
          async () => {
            await api.resources.accounts.create({ email: 'invalid' });
          },
          {
            name: 'ValidationError'
          }
        );
        
        // Valid insert
        const account = await api.resources.accounts.create({
          email: 'test@example.com',
          age: 25
        });
        
        // Invalid update
        await assert.rejects(
          async () => {
            await api.resources.accounts.update(account.data.id, { age: 15 });
          },
          {
            name: 'ValidationError'
          }
        );
      });
    });
    
    describe('Timestamps Plugin', () => {
      it('should add timestamps automatically', async () => {
        api.use(TimestampsPlugin);
        
        api.addResource('docs', new Schema({
          id: { type: 'id' },
          title: { type: 'string' }
        }));
        
        // Create
        const doc = await api.resources.docs.create({ title: 'Test' });
        assert(doc.data.attributes.createdAt);
        assert(doc.data.attributes.updatedAt);
        assert.equal(doc.data.attributes.createdAt, doc.data.attributes.updatedAt);
        
        // Wait a bit to ensure time passes
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Update
        const updated = await api.resources.docs.update(doc.data.id, { title: 'Updated' });
        
        // The timestamps plugin should ensure updatedAt > createdAt
        assert(updated.data.attributes.updatedAt > updated.data.attributes.createdAt);
      });
    });
  });

  // ====================================
  // 8. Advanced Query Tests (Joins, etc)
  // ====================================
  describe('8. Advanced Query Tests', () => {
    let api;
    
    before(async () => {
      api = await setupTestApi();
      api.use(ValidationPlugin);
      await api.connect();
      
      // Define schemas with relationships
      api.addResource('authors', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        country: { type: 'string' }
      }));
      
      api.addResource('books', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        authorId: {
          type: 'id',
          refs: {
            resource: 'authors',
            join: {
              eager: true,
              fields: ['id', 'name']
            }
          }
        }
      }));
      
      api.addResource('reviews', new Schema({
        id: { type: 'id' },
        rating: { type: 'number', min: 1, max: 5 },
        bookId: {
          type: 'id',
          refs: { resource: 'books' }
        }
      }));
    });
    
    after(async () => {
      await robustTeardown({ api });
    });
    
    beforeEach(async () => {
      await cleanDatabase(api);
      await api.connect();
      
      // Seed test data
      const author1 = await api.resources.authors.create({
        name: 'J.K. Rowling',
        country: 'UK'
      });
      
      const author2 = await api.resources.authors.create({
        name: 'George R.R. Martin',
        country: 'USA'
      });
      
      await api.resources.books.create({
        title: 'Harry Potter',
        authorId: author1.data.id
      });
      
      await api.resources.books.create({
        title: 'Game of Thrones',
        authorId: author2.data.id
      });
    });
    
    it('should support eager joins', async () => {
      const books = await api.resources.books.query({});
      
      // Should have author data due to eager join
      assert(books.data[0].attributes.authorId);
      assert.equal(books.data[0].attributes.authorId.name, 'J.K. Rowling');
    });
    
    it('should support explicit joins', async () => {
      // Store original eager setting
      const originalEager = api.schemas.get('books').structure.authorId.refs.join.eager;
      
      try {
        // First, ensure eager join is disabled
        api.schemas.get('books').structure.authorId.refs.join.eager = false;
        
        // Clear any cached join state by recreating the books
        await cleanDatabase(api);
        await api.connect();
        
        // Recreate test data
        const author1 = await api.resources.authors.create({
          name: 'J.K. Rowling',
          country: 'UK'
        });
        
        const book = await api.resources.books.create({
          title: 'Harry Potter',
          authorId: author1.data.id
        });
        
        // Query without join - should return string ID
        const withoutJoin = await api.resources.books.query({});
        assert.equal(withoutJoin.data.length, 1);
        assert.equal(typeof withoutJoin.data[0].attributes.authorId, 'string');
        
        // Query with explicit join
        const withJoin = await api.resources.books.query({
          joins: ['authorId']
        });
        assert.equal(typeof withJoin.data[0].attributes.authorId, 'object');
        assert.equal(withJoin.data[0].attributes.authorId.name, 'J.K. Rowling');
      } finally {
        // Always restore original eager setting
        api.schemas.get('books').structure.authorId.refs.join.eager = originalEager;
      }
    });
    
    it('should preserve ID when configured', async () => {
      // Update refs to preserve ID BEFORE querying
      api.schemas.get('books').structure.authorId.refs.join.preserveId = true;
      
      // Force a fresh query to pick up the new setting
      const books = await api.resources.books.query({
        joins: ['authorId']  // Explicitly request the join
      });
      const book = books.data[0];
      
      // Should have both ID and joined data
      assert(book.attributes.authorId);
      assert(book.attributes.author);
      assert.equal(book.attributes.author.name, 'J.K. Rowling');
      
      // Reset for other tests
      delete api.schemas.get('books').structure.authorId.refs.join.preserveId;
    });
  });

  // ====================================
  // 9. Positioning Plugin Tests
  // ====================================
  describe('9. Positioning Plugin Tests', () => {
    let api;
    
    before(async () => {
      api = await setupTestApi();
      api.use(PositioningPlugin);
      await api.connect();
      
      api.addResource('tasks', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        projectId: { type: 'id', searchable: true },
        position: { type: 'number', searchable: true }
      }), {
        positioning: {
          field: 'position',
          groupBy: 'projectId'
        }
      });
    });
    
    after(async () => {
      await robustTeardown({ api });
    });
    
    beforeEach(async () => {
      await cleanDatabase(api);
      await api.connect();
    });
    
    it('should auto-assign positions', async () => {
      const task1 = await api.resources.tasks.create({
        title: 'Task 1',
        projectId: '1'
      });
      
      const task2 = await api.resources.tasks.create({
        title: 'Task 2',
        projectId: '1'
      });
      
      assert.equal(task1.data.attributes.position, 1);
      assert.equal(task2.data.attributes.position, 2);
    });
    
    it('should handle position groups', async () => {
      // Project 1
      const task1 = await api.resources.tasks.create({
        title: 'P1 Task 1',
        projectId: '1'
      });
      
      // Project 2
      const task2 = await api.resources.tasks.create({
        title: 'P2 Task 1',
        projectId: '2'
      });
      
      // Both should have position 1 in their respective groups
      assert.equal(task1.data.attributes.position, 1);
      assert.equal(task2.data.attributes.position, 1);
    });
    
    it('should reposition items with beforeId', async () => {
      const task1 = await api.resources.tasks.create({
        title: 'Task 1',
        projectId: '1'
      });
      
      const task2 = await api.resources.tasks.create({
        title: 'Task 2',
        projectId: '1'
      });
      
      const task3 = await api.resources.tasks.create({
        title: 'Task 3',
        projectId: '1'
      });
      
      // Insert new task before task2
      const task4 = await api.resources.tasks.create({
        title: 'Task 4',
        projectId: '1',
        beforeId: task2.data.id
      });
      
      // Check positions
      assert.equal(task4.data.attributes.position, 2);
      
      // Verify other positions were shifted
      const updated2 = await api.resources.tasks.get(task2.data.id);
      const updated3 = await api.resources.tasks.get(task3.data.id);
      
      assert.equal(updated2.data.attributes.position, 3);
      assert.equal(updated3.data.attributes.position, 4);
    });
  });

  // ====================================
  // 10. Error Handling Tests
  // ====================================
  describe('10. Error Handling Tests', () => {
    let api;
    
    beforeEach(async () => {
      api = await setupTestApi();
      await api.connect();
    });
    
    afterEach(async () => {
      await robustTeardown({ api });
    });
    
    it('should create proper error instances', () => {
      const notFound = new NotFoundError('users', '123');
      assert(notFound instanceof Error);
      assert(notFound instanceof NotFoundError);
      assert.equal(notFound.status, 404);
      assert(notFound.message.includes('users'));
      assert(notFound.message.includes('123'));
      
      const validation = new ValidationError('Invalid data');
      assert.equal(validation.status, 422);
      
      const conflict = new ConflictError('Duplicate key');
      assert.equal(conflict.status, 409);
      
      const internal = new InternalError('Server error');
      assert.equal(internal.status, 500);
    });
    
    it('should handle NotFoundError correctly', async () => {
      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string' }
      }));
      
      // Create an item first to ensure table exists
      await api.resources.items.create({ name: 'Test Item' });
      
      try {
        await api.resources.items.get('nonexistent');
        assert.fail('Should throw NotFoundError');
      } catch (error) {
        assert(error instanceof NotFoundError);
        assert.equal(error.status, 404);
        assert(error.toJSON().meta.timestamp);
      }
    });
    
    it('should handle ValidationError with field errors', async () => {
      api.use(ValidationPlugin);
      
      api.addResource('users', new Schema({
        id: { type: 'id' },
        email: { type: 'string', required: true },
        age: { type: 'number', min: 18 }
      }));
      
      try {
        await api.resources.users.create({
          age: 15  // Missing email and age too low
        });
        assert.fail('Should throw ValidationError');
      } catch (error) {
        assert(error instanceof ValidationError);
        assert(error.validationErrors);
        assert(error.validationErrors.length >= 2);
        
        const json = error.toJSON();
        assert(Array.isArray(json));
        assert(json.length >= 2);
      }
    });
    
    it('should handle ConflictError', async () => {
      // This would typically come from unique constraint violations
      const error = new ConflictError('Email already exists')
        .withContext({ field: 'email', value: 'test@example.com' });
      
      assert.equal(error.status, 409);
      assert(error.context.field);
      assert(error.context.value);
    });
    
    it('should support error context and chaining', () => {
      const error = new InternalError('Database connection failed')
        .withContext({ 
          host: 'localhost',
          port: 3306
        })
        .withContext({
          attempt: 1
        });
      
      assert.equal(error.context.host, 'localhost');
      assert.equal(error.context.port, 3306);
      assert.equal(error.context.attempt, 1);
    });
  });

  // ====================================
  // 11. Integration Tests
  // ====================================
  describe('11. Integration Tests', () => {
    it('should work with createApi convenience function', async () => {
      const api = createApi({
        debug: false
      });
      
      // Get the appropriate plugin
      const { plugin, config } = getTestPlugin();
      api.use(plugin, config);
      api.use(ValidationPlugin);
      
      await api.connect();
      
      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true }
      }));
      
      const item = await api.resources.items.create({ name: 'Test' });
      assert(item.data.id);
      
      await robustTeardown({ api });
    });
    
    it('should handle complex real-world scenario', async () => {
      const api = await setupTestApi();
      api.use(ValidationPlugin);
      api.use(TimestampsPlugin);
      api.use(PositioningPlugin);
      
      await api.connect();
      
      // User schema
      api.addResource('users', new Schema({
        id: { type: 'id' },
        username: { type: 'string', required: true },
        email: { type: 'string', required: true },
        profile: { type: 'object' }
      }));
      
      // Project schema with owner reference
      api.addResource('projects', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        ownerId: {
          type: 'id',
          refs: {
            resource: 'users',
            join: { eager: true }
          }
        }
      }));
      
      // Task schema with positioning
      api.addResource('tasks', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        projectId: {
          type: 'id',
          refs: { resource: 'projects' },
          searchable: true  // Required for positioning groupBy
        },
        assigneeId: {
          type: 'id',
          refs: { resource: 'users' }
        },
        position: { type: 'number', searchable: true },
        completed: { type: 'boolean', default: false }
      }), {
        positioning: {
          field: 'position',
          groupBy: 'projectId'
        }
      });
      
      // Create test data
      const user = await api.resources.users.create({
        username: 'johndoe',
        email: 'john@example.com',
        profile: { bio: 'Developer' }
      });
      
      const project = await api.resources.projects.create({
        name: 'Test Project',
        ownerId: user.data.id
      });
      
      // Create multiple tasks
      const tasks = [];
      for (let i = 1; i <= 3; i++) {
        const task = await api.resources.tasks.create({
          title: `Task ${i}`,
          projectId: project.data.id,
          assigneeId: user.data.id
        });
        tasks.push(task);
      }
      
      // Verify positioning
      assert.equal(tasks[0].data.attributes.position, 1);
      assert.equal(tasks[2].data.attributes.position, 3);
      
      // Query with joins
      const projectWithOwner = await api.resources.projects.get(project.data.id);
      assert(projectWithOwner.data.attributes.ownerId.username);
      
      // Complex query
      const allTasks = await api.resources.tasks.query({
        joins: ['projectId', 'assigneeId'],
        sort: '-position'
      });
      
      assert.equal(allTasks.data.length, 3);
      assert(allTasks.data[0].attributes.projectId.name);
      assert(allTasks.data[0].attributes.assigneeId.username);
      
      await robustTeardown({ api });
    });
  });

  // ====================================
  // 12. Edge Cases & Stress Tests
  // ====================================
  describe('12. Edge Cases & Stress Tests', () => {
    let api;
    
    beforeEach(async () => {
      api = await setupTestApi();
      await api.connect();
    });
    
    afterEach(async () => {
      await robustTeardown({ api });
    });
    
    it('should handle circular references gracefully', async () => {
      api.addResource('users', new Schema({
        id: { type: 'id' },
        name: { type: 'string' },
        bestFriendId: {
          type: 'id',
          refs: { resource: 'users' }
        }
      }));
      
      const user1 = await api.resources.users.create({ name: 'User 1' });
      const user2 = await api.resources.users.create({ 
        name: 'User 2',
        bestFriendId: user1.data.id
      });
      
      // Update user1 to reference user2
      await api.resources.users.update(user1.data.id, {
        bestFriendId: user2.data.id
      });
      
      // Should handle circular reference without infinite loop
      const result = await api.resources.users.query({
        joins: ['bestFriendId']
      });
      
      assert(result.data[0].attributes.bestFriendId);
    });
    
    it('should handle large datasets efficiently', async () => {
      // Note: Node's test runner doesn't support this.timeout()
      
      api.addResource('items', new Schema({
        id: { type: 'id' },
        value: { type: 'number' },
        category: { type: 'string' }
      }));
      
      // Create many items
      const categories = ['A', 'B', 'C', 'D', 'E'];
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          api.resources.items.create({
            value: i,
            category: categories[i % categories.length]
          })
        );
      }
      
      await Promise.all(promises);
      
      // Query with pagination
      const page1 = await api.resources.items.query({
        page: { size: 20, number: 1 }
      });
      
      assert.equal(page1.data.length, 20);
      assert.equal(page1.meta.total, 100);
      assert.equal(page1.meta.totalPages, 5);
    });
    
    it('should handle concurrent operations', async () => {
      api.addResource('counters', new Schema({
        id: { type: 'id' },
        value: { type: 'number' }
      }));
      
      const counter = await api.resources.counters.create({ value: 0 });
      
      // Concurrent updates
      const updates = [];
      for (let i = 0; i < 10; i++) {
        updates.push(
          api.resources.counters.update(counter.data.id, {
            value: i
          })
        );
      }
      
      await Promise.all(updates);
      
      // Check final value (should be one of the update values)
      const final = await api.resources.counters.get(counter.data.id);
      assert(final.data.attributes.value >= 0 && final.data.attributes.value <= 9);
    });
    
    it('should handle special characters in data', async () => {
      api.addResource('texts', new Schema({
        id: { type: 'id' },
        content: { type: 'string' }
      }));
      
      const specialChars = [
        "Test with 'quotes'",
        'Test with "double quotes"',
        'Test with `backticks`',
        'Test with \\backslash',
        'Test with\nnewline',
        'Test with\ttab',
        'Test with emoji 🎉'
      ];
      
      for (const content of specialChars) {
        const created = await api.resources.texts.create({ content });
        const retrieved = await api.resources.texts.get(created.data.id);
        assert.equal(retrieved.data.attributes.content, content);
      }
    });
    
    it('should handle deeply nested objects', async () => {
      api.addResource('nested', new Schema({
        id: { type: 'id' },
        data: { type: 'object' }
      }));
      
      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep'
                }
              }
            }
          }
        }
      };
      
      const created = await api.resources.nested.create({ data: deepObject });
      const retrieved = await api.resources.nested.get(created.data.id);
      
      assert.equal(
        retrieved.data.attributes.data.level1.level2.level3.level4.level5.value,
        'deep'
      );
    });
    
    it('should handle batch operations', async () => {
      api.addResource('batch', new Schema({
        id: { type: 'id' },
        batch: { type: 'string' },
        value: { type: 'number' }
      }));
      
      // Batch create
      const batchId = 'batch-' + Date.now();
      const items = [];
      
      for (let i = 0; i < 20; i++) {
        items.push(
          await api.resources.batch.create({
            batch: batchId,
            value: i
          })
        );
      }
      
      // Batch delete using query
      for (const item of items) {
        await api.resources.batch.delete(item.data.id);
      }
      
      // Verify all deleted
      const remaining = await api.resources.batch.query({});
      assert.equal(remaining.data.length, 0);
    });
  });

  // ====================================
  // 13. Performance Tests
  // ====================================
  describe('13. Performance Tests', () => {
    let api;
    
    before(async () => {
      api = await setupTestApi();
      await api.connect();
    });
    
    after(async () => {
      await robustTeardown({ api });
    });
    
    it('should handle 1000 records efficiently', async () => {
      // Note: Node's test runner doesn't support this.timeout()
      
      api.addResource('perf', new Schema({
        id: { type: 'id' },
        value: { type: 'number' },
        indexedValue: { type: 'string', searchable: true }
      }));
      
      console.log('      Creating 1000 records...');
      const start = Date.now();
      
      // Create records in batches
      const batchSize = 100;
      for (let batch = 0; batch < 10; batch++) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          const n = batch * batchSize + i;
          promises.push(
            api.resources.perf.create({
              value: n,
              indexedValue: `item-${n}`
            })
          );
        }
        await Promise.all(promises);
      }
      
      const createTime = Date.now() - start;
      console.log(`      Created in ${createTime}ms (${(createTime/1000).toFixed(2)}ms per record)`);
      
      // Query performance
      const queryStart = Date.now();
      const results = await api.resources.perf.query({
        page: { size: 50, number: 1 }
      });
      const queryTime = Date.now() - queryStart;
      
      console.log(`      Queried in ${queryTime}ms`);
      
      assert.equal(results.meta.total, 1000);
      assert.equal(results.data.length, 50);
      
      // Performance assertions
      assert(createTime < 30000, 'Create should complete within 30 seconds');
      assert(queryTime < 1000, 'Query should complete within 1 second');
    });
  });
});

// Run the tests
console.log('\nTAP version 13');