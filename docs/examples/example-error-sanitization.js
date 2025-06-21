#!/usr/bin/env node

import express from 'express';
import { Api, Schema, HTTPPlugin, MemoryPlugin } from '../index.js';
import { InternalError } from '../lib/errors.js';

// Example: Error Sanitization in Production vs Development

const app = express();
const api = new Api();

// Configure plugins
api.use(MemoryPlugin);
api.use(HTTPPlugin, { 
  app,
  // Optional: Override error sanitization behavior
  // errorSanitization: true,     // Always sanitize
  // forceProductionErrors: true,  // Force production mode
  // forceDevelopmentErrors: true, // Force development mode
});

// Define a schema
const userSchema = new Schema({
  email: { 
    type: 'string', 
    required: true,
    validator: (value) => {
      if (!value.includes('@')) {
        return 'Invalid email format';
      }
    }
  },
  password: { 
    type: 'string', 
    required: true,
    min: 8,
    minErrorMessage: 'Password must be at least 8 characters'
  },
  role: {
    type: 'string',
    enum: ['user', 'admin'],
    enumErrorMessage: 'Role must be either user or admin'
  }
});

api.addResource('users', userSchema);

// Add hook that simulates different types of errors
api.hook('beforeInsert', async (context) => {
  if (context.options.type !== 'users') return;
  
  const { data } = context;
  
  // Simulate database connection error
  if (data.email === 'db-error@example.com') {
    throw new InternalError('Connection refused: ECONNREFUSED 127.0.0.1:3306')
      .withContext({
        host: 'localhost',
        port: 3306,
        database: 'myapp_db',
        operation: 'INSERT'
      });
  }
  
  // Simulate programming error
  if (data.email === 'null-error@example.com') {
    // This will cause a TypeError
    const user = null;
    console.log(user.name); // Will throw "Cannot read property 'name' of null"
  }
  
  // Simulate circular reference error
  if (data.email === 'circular@example.com') {
    const obj = { name: 'test' };
    obj.self = obj; // Circular reference
    JSON.stringify(obj); // Will throw
  }
});

// Error demonstration endpoint
app.get('/demo/errors/:type', (req, res) => {
  const errorType = req.params.type;
  
  try {
    switch (errorType) {
      case 'internal':
        throw new InternalError('Database query failed: ER_PARSE_ERROR')
          .withContext({
            query: 'SELECT * FROM users WHERE',
            file: '/src/db/queries.js',
            line: 42
          });
        
      case 'programming':
        const data = undefined;
        return data.toString(); // TypeError
        
      case 'type-error':
        const num = 'not a number';
        return num.toFixed(2); // TypeError
        
      default:
        res.json({ message: 'Use /demo/errors/internal, /demo/errors/programming, or /demo/errors/type-error' });
    }
  } catch (error) {
    // Simulate what the HTTP plugin does
    const { formatErrorResponse } = await import('../lib/errors.js');
    const response = formatErrorResponse(error);
    res.status(response.errors[0].status || 500).json(response);
  }
});

// Helper to test with different environments
function testWithEnvironment(env) {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  
  console.log(`\n=== Testing in ${env.toUpperCase()} mode ===\n`);
  
  // Return cleanup function
  return () => {
    process.env.NODE_ENV = originalEnv;
  };
}

// Start server
const PORT = 3000;
app.listen(PORT, async () => {
  console.log(`Error Sanitization Example - Server running on http://localhost:${PORT}`);
  console.log(`Current NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log('\nExample Requests:\n');
  
  console.log('1. Validation Error (always shows details):');
  console.log('   curl -X POST http://localhost:3000/api/users \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"email": "invalid-email", "password": "short"}\'');
  
  console.log('\n2. Internal Server Error (sanitized in production):');
  console.log('   curl -X POST http://localhost:3000/api/users \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"email": "db-error@example.com", "password": "password123"}\'');
  
  console.log('\n3. Programming Error (sanitized in production):');
  console.log('   curl -X POST http://localhost:3000/api/users \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"email": "null-error@example.com", "password": "password123"}\'');
  
  console.log('\n4. Direct Error Examples:');
  console.log('   curl http://localhost:3000/demo/errors/internal');
  console.log('   curl http://localhost:3000/demo/errors/programming');
  console.log('   curl http://localhost:3000/demo/errors/type-error');
  
  console.log('\n5. Test with different environments:');
  console.log('   NODE_ENV=production node examples/example-error-sanitization.js');
  console.log('   NODE_ENV=development node examples/example-error-sanitization.js');
  
  console.log('\n--- Example Outputs ---\n');
  
  // Show example of error in different environments
  const { InternalError, formatErrorResponse } = await import('../lib/errors.js');
  
  // Test development mode
  let cleanup = testWithEnvironment('development');
  const devError = new InternalError('Database connection failed: ECONNREFUSED');
  const devResponse = formatErrorResponse(devError);
  console.log('Development Error Response:');
  console.log(JSON.stringify(devResponse, null, 2));
  cleanup();
  
  // Test production mode
  cleanup = testWithEnvironment('production');
  const prodError = new InternalError('Database connection failed: ECONNREFUSED');
  const prodResponse = formatErrorResponse(prodError);
  console.log('\nProduction Error Response (sanitized):');
  console.log(JSON.stringify(prodResponse, null, 2));
  cleanup();
  
  console.log('\n--- Press Ctrl+C to stop ---');
});