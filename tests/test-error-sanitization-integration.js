import { test, describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { Api, Schema, HTTPPlugin, MemoryPlugin, ValidationPlugin } from '../index.js';
import { InternalError } from '../lib/errors.js';

describe('Error Sanitization Integration Tests', () => {
  let app, api, server;
  
  const setupApi = (options = {}) => {
    app = express();
    api = new Api();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(HTTPPlugin, { 
      app,
      ...options
    });
    
    // Test schema
    const schema = new Schema({
      title: { type: 'string', required: true },
      status: { type: 'string', enum: ['draft', 'published'] },
      count: { type: 'number', min: 0, max: 100 }
    });
    
    api.addResource('posts', schema);
    
    // Add hooks that simulate various errors - high priority to run before validation
    api.hook('beforeInsert', async (context) => {
      if (context.data?.title === 'trigger-null-error') {
        const obj = null;
        return obj.property; // TypeError
      }
      
      if (context.data?.title === 'trigger-db-error') {
        throw new InternalError('Connection refused: ECONNREFUSED 127.0.0.1:3306')
          .withContext({
            host: 'localhost',
            port: 3306,
            query: 'INSERT INTO posts ...',
            credentials: 'user:password' // Sensitive!
          });
      }
      
      if (context.data?.title === 'trigger-stack-error') {
        throw new Error('Unhandled error at line 42 of /app/src/db/connection.js');
      }
    }, 1); // High priority to run before validation
    
    return { app, api };
  };
  
  describe('Production Mode Error Sanitization', () => {
    const withProductionEnv = (fn) => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        return fn();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    };
    
    test('should sanitize TypeError messages', async () => {
      await withProductionEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-null-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'Invalid request data');
      assert.equal(res.body.errors[0].status, '500');
      assert.equal(res.body.errors[0].meta.stack, undefined);
      assert.equal(res.body.errors[0].meta.query, undefined);
      });
    });
    
    test('should sanitize database connection errors', async () => {
      await withProductionEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-db-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'Service temporarily unavailable');
      assert.equal(res.body.errors[0].meta.credentials, undefined); // Sensitive data removed
      assert.equal(res.body.errors[0].meta.host, undefined);
      assert.equal(res.body.errors[0].meta.query, undefined);
      });
    });
    
    test('should remove file paths from error messages', async () => {
      await withProductionEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-stack-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'An error occurred processing your request');
      assert(!res.body.errors[0].detail.includes('/app/src/db/connection.js'));
      assert.equal(res.body.errors[0].meta.stack, undefined);
      });
    });
    
    test('should preserve validation error details', async () => {
      await withProductionEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              status: 'invalid'
            }
          }
        })
        .expect(422);
      
      // Validation errors should not be sanitized
      assert(res.body.errors[0].detail.includes('must be one of'));
      assert.equal(res.body.errors[0].source.pointer, '/data/attributes/status');
      assert.equal(res.body.errors[0].meta.field, 'status');
      assert.equal(res.body.errors[0].meta.value, undefined); // But value is removed in production
      });
    });
    
    test('should handle forced sanitization options', async () => {
      const originalEnv = process.env.NODE_ENV;
      const { app } = setupApi({ forceProductionErrors: true });
      
      // Even in dev mode, should sanitize
      process.env.NODE_ENV = 'development';
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-db-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'Service temporarily unavailable');
      process.env.NODE_ENV = originalEnv;
    });
  });
  
  describe('Development Mode Error Details', () => {
    const withDevelopmentEnv = (fn) => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        return fn();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    };
    
    test('should include full error details in development', async () => {
      await withDevelopmentEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-db-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'Connection refused: ECONNREFUSED 127.0.0.1:3306');
      assert(Array.isArray(res.body.errors[0].meta.stack));
      assert(res.body.errors[0].meta.stack.length > 0);
      assert.equal(res.body.errors[0].meta.host, 'localhost');
      assert.equal(res.body.errors[0].meta.port, 3306);
      });
    });
    
    test('should include validation error values in development', async () => {
      await withDevelopmentEnv(async () => {
        const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              status: 'invalid',
              count: 150
            }
          }
        })
        .expect(422);
      
      // Find the status error
      const statusError = res.body.errors.find(e => e.meta.field === 'status');
      assert.equal(statusError.meta.value, 'invalid');
      
      // Find the count error
      const countError = res.body.errors.find(e => e.meta.field === 'count');
      assert.equal(countError.meta.value, 150);
      });
    });
    
    test('should handle forced development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      const { app } = setupApi({ forceDevelopmentErrors: true });
      
      // Even in production, should show details
      process.env.NODE_ENV = 'production';
      
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'trigger-db-error'
            }
          }
        })
        .expect(500);
      
      assert.equal(res.body.errors[0].detail, 'Connection refused: ECONNREFUSED 127.0.0.1:3306');
      assert(Array.isArray(res.body.errors[0].meta.stack));
      process.env.NODE_ENV = originalEnv;
    });
  });
  
  describe('Error Logging in Production', () => {
    test('should log server errors to console in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const logs = [];
      const originalError = console.error;
      console.error = (...args) => logs.push(args);
      
      try {
        const { app } = setupApi();
        
        await request(app)
          .post('/api/posts')
          .send({
            data: {
              attributes: {
                title: 'trigger-db-error'
              }
            }
          })
          .expect(500);
        
        // Should have logged the error
        assert(logs.length > 0);
        const errorLog = logs.find(log => log[0] === '[ERROR]');
        assert(errorLog);
        assert.equal(errorLog[1].message, 'Connection refused: ECONNREFUSED 127.0.0.1:3306');
        assert(errorLog[1].stack);
        assert(errorLog[1].timestamp);
      } finally {
        console.error = originalError;
        process.env.NODE_ENV = originalEnv;
      }
    });
    
    test('should not log client errors in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const logs = [];
      const originalError = console.error;
      console.error = (...args) => logs.push(args);
      
      try {
        const { app } = setupApi();
        
        await request(app)
          .post('/api/posts')
          .send({
            data: {
              attributes: {
                status: 'invalid'
              }
            }
          })
          .expect(422);
        
        // Should not log validation errors
        const errorLogs = logs.filter(log => log[0] === '[ERROR]');
        assert.equal(errorLogs.length, 0);
      } finally {
        console.error = originalError;
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
  
  describe('Various Error Patterns', () => {
    const withProductionEnv = (fn) => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        return fn();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    };
    
    test('should sanitize various database error patterns', async () => {
      await withProductionEnv(async () => {
        const errorPatterns = [
        { 
          original: 'ER_DUP_ENTRY: Duplicate entry "test@example.com" for key "email"',
          expected: 'Resource already exists'
        },
        {
          original: 'ER_NO_REFERENCED_ROW: Cannot add or update a child row',
          expected: 'Invalid reference'
        },
        {
          original: 'ETIMEDOUT: Connection timed out',
          expected: 'Request timeout'
        },
        {
          original: 'TypeError: Cannot read properties of null',
          expected: 'Invalid request data'
        },
        {
          original: 'ReferenceError: someVariable is not defined',
          expected: 'An error occurred processing your request'
        }
      ];
      
      for (const { original, expected } of errorPatterns) {
        const { app, api } = setupApi();
        
        // Add a hook that throws this specific error
        api.hook('beforeQuery', async () => {
          throw new InternalError(original);
        });
        
        const res = await request(app)
          .get('/api/posts')
          .expect(500);
        
        assert.equal(res.body.errors[0].detail, expected, 
          `Expected "${original}" to be sanitized to "${expected}"`);
      }
      });
    });
  });
});