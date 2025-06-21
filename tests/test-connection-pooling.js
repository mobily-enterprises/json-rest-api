import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MySQLPlugin } from '../index.js';
import { robustTeardown } from './utils/test-helpers.js';

// Only run these tests if MySQL is available
const mysqlTest = process.env.MYSQL_HOST || process.env.DB_TYPE === 'mysql' 
  ? describe 
  : describe.skip;

mysqlTest('Connection Pooling', () => {
  describe('Pool Configuration', () => {
    test('should accept basic pool configuration', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api',
          
          // Basic pool config
          connectionLimit: 5,
          waitForConnections: true,
          queueLimit: 10
        }
      });
      
      // Pool should be created
      assert(api._mysqlPools);
      assert(api._mysqlPools.has('default'));
      
      await robustTeardown({ api });
    });
    
    test('should accept advanced pool configuration', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api',
          
          // Advanced pool config
          pool: {
            max: 10,
            min: 2,
            acquireTimeout: 30000,
            queueLimit: 0,
            waitForConnections: true
          }
        }
      });
      
      const poolInfo = api._mysqlPools.get('default');
      assert(poolInfo);
      assert(poolInfo.config.pool);
      assert.equal(poolInfo.config.pool.max, 10);
      
      await robustTeardown({ api });
    });
    
    test('should support multiple named connections', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connections: [
          {
            name: 'primary',
            config: {
              host: process.env.MYSQL_HOST || 'localhost',
              user: process.env.MYSQL_USER || 'root',
              password: process.env.MYSQL_PASSWORD || '',
              database: process.env.MYSQL_DATABASE || 'test_json_api',
              pool: { max: 5 }
            }
          },
          {
            name: 'secondary',
            config: {
              host: process.env.MYSQL_HOST || 'localhost',
              user: process.env.MYSQL_USER || 'root',
              password: process.env.MYSQL_PASSWORD || '',
              database: process.env.MYSQL_DATABASE || 'test_json_api_2',
              pool: { max: 3 }
            }
          }
        ]
      });
      
      assert(api._mysqlPools.has('primary'));
      assert(api._mysqlPools.has('secondary'));
      assert.equal(api._mysqlPools.size, 2);
      
      await robustTeardown({ api });
    });
  });
  
  describe('Pool Statistics', () => {
    let api;
    
    test.beforeEach(async () => {
      api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api',
          pool: { max: 5, min: 1 }
        }
      });
      
      const userSchema = new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string', required: true }
      });
      
      api.addResource('users', userSchema);
    });
    
    test.afterEach(async () => {
      await robustTeardown({ api });
    });
    
    test('should track pool statistics', async () => {
      // Initial stats
      const stats1 = await api.getPoolStats();
      assert(stats1);
      assert.equal(typeof stats1.total, 'number');
      assert.equal(typeof stats1.active, 'number');
      assert.equal(typeof stats1.idle, 'number');
      assert.equal(stats1.acquired, 0);
      assert.equal(stats1.released, 0);
      assert.equal(stats1.errors, 0);
      
      // Perform some operations
      await api.resources.users.create({ name: 'Test', email: 'test@example.com' });
      await api.resources.users.query();
      
      // Check updated stats
      const stats2 = await api.getPoolStats();
      assert(stats2.acquired > 0);
      assert(stats2.released > 0);
      assert(stats2.averageAcquireTime >= 0);
    });
    
    test('should track errors in pool stats', async () => {
      // Force an error by using invalid SQL
      try {
        await api.execute('db.query', {
          sql: 'SELECT * FROM non_existent_table',
          params: []
        });
      } catch (error) {
        // Expected
      }
      
      const stats = await api.getPoolStats();
      assert(stats.errors > 0);
    });
    
    test('should get stats for all pools', async () => {
      // Add another connection
      api._mysqlPools.set('analytics', api._mysqlPools.get('default'));
      api._mysqlPoolStats.set('analytics', {
        acquired: 10,
        released: 10,
        errors: 1,
        timeouts: 0,
        totalAcquireTime: 100,
        maxUsed: 3
      });
      
      const allStats = await api.getAllPoolStats();
      assert(allStats.default);
      assert(allStats.analytics);
      assert.equal(allStats.analytics.acquired, 10);
    });
  });
  
  describe('Pool Behavior', () => {
    test('should reuse connections from pool', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api',
          pool: { max: 2 } // Small pool to test reuse
        }
      });
      
      const userSchema = new Schema({
        name: { type: 'string', required: true }
      });
      
      api.addResource('users', userSchema);
      
      // Run multiple operations in parallel
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          api.resources.users.create({ name: `User ${i}` })
        );
      }
      
      await Promise.all(promises);
      
      // Check that connections were reused
      const stats = await api.getPoolStats();
      assert(stats.acquired >= 10); // At least 10 acquisitions
      assert(stats.maxUsed <= 2); // Never more than 2 connections
      
      await robustTeardown({ api });
    });
    
    test('should handle pool exhaustion gracefully', async function() {
      // Skip this test in CI as it's timing-sensitive
      if (process.env.CI) {
        this.skip();
      }
      
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api',
          pool: {
            max: 1, // Only 1 connection
            acquireTimeout: 100, // Short timeout
            queueLimit: 1 // Only 1 waiting request
          }
        }
      });
      
      const userSchema = new Schema({
        name: { type: 'string', required: true }
      });
      
      api.addResource('users', userSchema);
      
      // Hold a connection with a transaction
      const trx = api.transaction(async (trx) => {
        // Hold connection for 200ms
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      
      // Try to use pool while connection is held
      try {
        await api.resources.users.create({ name: 'Test' });
        // Might succeed if transaction finished
      } catch (error) {
        // Expected timeout
        assert(error.code === 'ETIMEDOUT' || error.code === 'POOL_EXHAUSTED');
      }
      
      await trx; // Wait for transaction to complete
      await robustTeardown({ api });
    });
  });
  
  describe('Connection Health', () => {
    test('should test connections on connect', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api'
        }
      });
      
      // Connect should test all connections
      await api.execute('db.connect', {});
      
      // Should not throw
      assert(true);
      
      await robustTeardown({ api });
    });
    
    test('should handle connection failures', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: 'invalid-host-that-does-not-exist',
          user: 'root',
          password: '',
          database: 'test',
          connectTimeout: 1000 // Fast timeout
        }
      });
      
      try {
        await api.execute('db.connect', {});
        assert.fail('Should have failed to connect');
      } catch (error) {
        assert(error.message.includes('Failed to connect'));
      }
    });
  });
  
  describe('Graceful Shutdown', () => {
    test('should close all connections on disconnect', async () => {
      const api = new Api();
      
      api.use(MySQLPlugin, {
        connection: {
          host: process.env.MYSQL_HOST || 'localhost',
          user: process.env.MYSQL_USER || 'root',
          password: process.env.MYSQL_PASSWORD || '',
          database: process.env.MYSQL_DATABASE || 'test_json_api'
        }
      });
      
      // Use the pool
      await api.execute('db.query', {
        sql: 'SELECT 1',
        params: []
      });
      
      // Disconnect should close pool
      await api.execute('db.disconnect', {});
      
      // Pool should be closed
      try {
        await api.execute('db.query', {
          sql: 'SELECT 1',
          params: []
        });
        assert.fail('Should not be able to query after disconnect');
      } catch (error) {
        // Expected
      }
    });
  });
});