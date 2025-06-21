import { test, describe } from 'node:test';
import assert from 'node:assert';
import { 
  ApiError, 
  InternalError, 
  ValidationError, 
  NotFoundError,
  formatErrorResponse,
  sanitizeError 
} from '../lib/errors.js';

describe('Error Sanitization', () => {
  const originalEnv = process.env.NODE_ENV;
  
  // Helper to temporarily set NODE_ENV
  const withEnv = (env, fn) => {
    process.env.NODE_ENV = env;
    try {
      return fn();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  };
  
  describe('Production Environment', () => {
    test('should sanitize 500 errors in production', () => {
      withEnv('production', () => {
        const error = new InternalError('Database connection failed: ECONNREFUSED 127.0.0.1:3306');
        const response = formatErrorResponse(error);
        
        assert.equal(response.errors[0].detail, 'Service temporarily unavailable');
        assert.equal(response.errors[0].status, '500');
        assert.equal(response.errors[0].code, 'INTERNAL_ERROR');
        
        // Should not include stack trace
        assert.equal(response.errors[0].meta.stack, undefined);
      });
    });
    
    test('should keep 4xx error messages in production', () => {
      withEnv('production', () => {
        const error = new NotFoundError('User', '123');
        const response = formatErrorResponse(error);
        
        assert.equal(response.errors[0].detail, "User with id '123' not found");
        assert.equal(response.errors[0].status, '404');
      });
    });
    
    test('should sanitize validation error values in production', () => {
      withEnv('production', () => {
        const error = new ValidationError();
        error.addFieldError('password', 'Password too short', 'INVALID_VALUE');
        error.validationErrors[0].value = 'abc123'; // Sensitive value
        
        const response = formatErrorResponse(error);
        
        assert.equal(response.errors[0].detail, 'Password too short');
        assert.equal(response.errors[0].meta.field, 'password');
        assert.equal(response.errors[0].meta.value, undefined); // Value should be removed
      });
    });
    
    test('should sanitize common programming errors', () => {
      withEnv('production', () => {
        const testCases = [
          {
            message: "Cannot read property 'name' of undefined",
            expected: 'Invalid request data'
          },
          {
            message: "TypeError: obj.method is not a function",
            expected: 'Internal processing error'
          },
          {
            message: "Invalid Date value",
            expected: 'Invalid date format'
          },
          {
            message: "ER_DUP_ENTRY: Duplicate entry 'test@example.com' for key 'email'",
            expected: 'Resource already exists'
          }
        ];
        
        for (const { message, expected } of testCases) {
          const error = new InternalError(message);
          const response = formatErrorResponse(error);
          assert.equal(response.errors[0].detail, expected);
        }
      });
    });
    
    test('should only include safe context fields in production', () => {
      withEnv('production', () => {
        const error = new InternalError('Database error')
          .withContext({
            resourceType: 'User',
            field: 'email',
            value: 'test@example.com',
            limit: 100,
            internalPath: '/app/src/db.js', // Should be removed
            databaseHost: 'db.internal', // Should be removed
            sensitiveData: 'secret123' // Should be removed
          });
          
        const response = formatErrorResponse(error);
        const meta = response.errors[0].meta;
        
        // Safe fields should be included
        assert.equal(meta.resourceType, 'User');
        assert.equal(meta.field, 'email');
        assert.equal(meta.value, 'test@example.com');
        assert.equal(meta.limit, 100);
        
        // Unsafe fields should be removed
        assert.equal(meta.internalPath, undefined);
        assert.equal(meta.databaseHost, undefined);
        assert.equal(meta.sensitiveData, undefined);
      });
    });
  });
  
  describe('Development Environment', () => {
    test('should include full error details in development', () => {
      withEnv('development', () => {
        const error = new InternalError('Database connection failed: ECONNREFUSED 127.0.0.1:3306')
          .withContext({ query: 'SELECT * FROM users' });
          
        const response = formatErrorResponse(error);
        
        // Should keep original message
        assert.equal(response.errors[0].detail, 'Database connection failed: ECONNREFUSED 127.0.0.1:3306');
        
        // Should include context
        assert.equal(response.errors[0].meta.query, 'SELECT * FROM users');
        
        // Should include stack trace
        assert(Array.isArray(response.errors[0].meta.stack));
        assert(response.errors[0].meta.stack.length > 0);
      });
    });
    
    test('should include validation error values in development', () => {
      withEnv('development', () => {
        const error = new ValidationError();
        error.addFieldError('email', 'Invalid email format', 'INVALID_FORMAT');
        error.validationErrors[0].value = 'not-an-email';
        
        const response = formatErrorResponse(error);
        
        assert.equal(response.errors[0].meta.value, 'not-an-email');
      });
    });
  });
  
  describe('Force Options', () => {
    test('should force production mode with forceProduction option', () => {
      withEnv('development', () => {
        const error = new InternalError('Sensitive database error');
        const response = formatErrorResponse(error, { forceProduction: true });
        
        assert.equal(response.errors[0].detail, 'An error occurred processing your request');
        assert.equal(response.errors[0].meta.stack, undefined);
      });
    });
    
    test('should force development mode with forceDevelopment option', () => {
      withEnv('production', () => {
        const error = new InternalError('Database error');
        const response = formatErrorResponse(error, { forceDevelopment: true });
        
        assert.equal(response.errors[0].detail, 'Database error');
        assert(Array.isArray(response.errors[0].meta.stack));
      });
    });
  });
  
  describe('Error Logging', () => {
    test('should log 500 errors in production', () => {
      withEnv('production', () => {
        const logs = [];
        const originalError = console.error;
        console.error = (...args) => logs.push(args);
        
        try {
          const error = new InternalError('Critical database failure')
            .withContext({ table: 'users', operation: 'INSERT' });
            
          sanitizeError(error);
          
          assert.equal(logs.length, 1);
          assert.equal(logs[0][0], '[ERROR]');
          
          const logData = logs[0][1];
          assert(logData.timestamp);
          assert.equal(logData.code, 'INTERNAL_ERROR');
          assert.equal(logData.message, 'Critical database failure');
          assert.equal(logData.context.table, 'users');
          assert(logData.stack);
        } finally {
          console.error = originalError;
        }
      });
    });
    
    test('should not log 4xx errors in production', () => {
      withEnv('production', () => {
        const logs = [];
        const originalError = console.error;
        console.error = (...args) => logs.push(args);
        
        try {
          const error = new NotFoundError('User', '123');
          sanitizeError(error);
          
          assert.equal(logs.length, 0);
        } finally {
          console.error = originalError;
        }
      });
    });
  });
});