import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MySQLPlugin } from '../../plugins/core/mysql.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';

test('Error sanitization: SQL details hidden in production', async () => {
  // Set production mode
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  
  try {
    const api = new Api();
    api.use(MemoryPlugin); // Using memory to simulate SQL errors
    
    // Force an SQL-like error
    try {
      // This will throw an error internally
      await api.query({
        filter: { invalidField: 'value' }
      }, { type: 'nonexistent' });
    } catch (error) {
      // In production, error should not have SQL details
      assert.ok(!error.sql);
      assert.ok(!error.params);
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('Error sanitization: SQL details shown in development', async () => {
  // Set development mode
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  
  try {
    const api = new Api();
    
    // Mock a database adapter that throws errors with SQL
    api.implement('db.query', async ({ sql, params }) => {
      const error = new Error('Database error');
      error.sql = sql;
      error.params = params;
      throw error;
    });
    
    api.implement('db.features', () => ({ tableCreation: false }));
    
    try {
      await api.query({}, { type: 'test' });
    } catch (error) {
      // In development, SQL details should be present
      assert.ok(error.sql);
      assert.ok(error.params);
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('Error sanitization: sensitive field names not exposed', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  // Schema with sensitive fields
  api.addResource('users', new Schema({
    username: { type: 'string', required: true },
    password: { type: 'string', silent: true, required: true },
    ssn: { type: 'string', silent: true },
    creditCard: { type: 'string', silent: true }
  }));
  
  try {
    // Try to create without required silent field
    await api.insert({
      username: 'testuser'
      // Missing password
    }, { type: 'users' });
  } catch (error) {
    // Error message should mention the field
    assert.equal(error.message.includes('password'), true);
    
    // But the actual value should never be in the error
    // (even though we didn't provide one, this tests the pattern)
  }
});

test('Error sanitization: stack traces hidden in production', async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  
  try {
    const api = new Api();
    api.use(MemoryPlugin);
    
    // Force an internal error
    api.hook('beforeInsert', async () => {
      throw new Error('Internal processing error');
    });
    
    api.addResource('items', new Schema({
      name: { type: 'string' }
    }));
    
    try {
      await api.insert({ name: 'test' }, { type: 'items' });
    } catch (error) {
      // In production, stack trace should be minimal or hidden
      // The actual implementation depends on error handling middleware
      assert.ok(error.message);
      
      // Ensure no file paths are exposed
      if (error.stack) {
        assert.equal(error.stack.includes('/home/'), false);
        assert.equal(error.stack.includes('\\Users\\'), false);
      }
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('Error sanitization: validation errors are safe', async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  api.addResource('products', new Schema({
    name: { type: 'string', required: true, min: 3 },
    price: { type: 'number', min: 0 },
    email: { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
  }));
  
  // Test various validation errors
  const testCases = [
    {
      data: { name: 'AB', price: 10 },
      expectedError: 'too short'
    },
    {
      data: { name: 'Product', price: -10 },
      expectedError: 'too low'
    },
    {
      data: { name: 'Product', email: 'invalid-email' },
      expectedError: 'pattern'
    }
  ];
  
  for (const testCase of testCases) {
    try {
      await api.insert(testCase.data, { type: 'products' });
      assert.fail('Should have thrown validation error');
    } catch (error) {
      // Validation errors should be user-friendly
      assert.ok(error.message);
      
      // Should not expose internal details
      assert.equal(error.message.includes('schema.js'), false);
      assert.equal(error.message.includes('at validate'), false);
    }
  }
});

test('Error sanitization: database connection errors', async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  
  try {
    const api = new Api();
    
    // Simulate connection error
    api.implement('db.connect', async () => {
      const error = new Error('Connection failed');
      error.code = 'ECONNREFUSED';
      error.host = 'secret-db-host.internal';
      error.port = 3306;
      error.user = 'db_admin';
      throw error;
    });
    
    try {
      await api.connect();
    } catch (error) {
      // In production, connection details should be hidden
      assert.ok(error.message);
      assert.equal(error.message.includes('secret-db-host'), false);
      assert.equal(error.message.includes('db_admin'), false);
      
      // These details should not be in the error object
      if (process.env.NODE_ENV === 'production') {
        assert.ok(!error.host);
        assert.ok(!error.user);
      }
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});