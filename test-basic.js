#!/usr/bin/env node

import { createApi, Schema } from './index.js';

console.log('Testing basic json-rest-api functionality...\n');

// Test 1: Create simple API with memory storage
console.log('1. Creating API with memory storage...');
const api = createApi({
  storage: 'memory',
  http: {
    basePath: '/api/v1'
  }
});
console.log('✓ API created successfully');

// Test 2: Define and register schema
console.log('\n2. Creating and registering user schema...');
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', min: 0, max: 150 }
});

// Define hooks for users
const userHooks = {
  async transformResult(context) {
    // Add a test field to verify hooks work
    if (context.result) {
      context.result.testField = 'hooks-working';
    }
  }
};

api.addResource('users', userSchema, userHooks);
console.log('✓ Schema registered successfully with hooks');

// Test 3: Insert data
console.log('\n3. Testing insert operation...');
try {
  const newUser = await api.insert({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30
  }, {
    type: 'users'
  });
  
  console.log('✓ User created:', newUser.data);
} catch (error) {
  console.error('✗ Insert failed:', error.message);
}

// Test 4: Query data
console.log('\n4. Testing query operation...');
try {
  const result = await api.query({
    filter: { age: 30 }
  }, {
    type: 'users'
  });
  
  console.log('✓ Query successful. Found', result.meta.total, 'users');
} catch (error) {
  console.error('✗ Query failed:', error.message);
}

// Test 5: Get by ID
console.log('\n5. Testing get operation...');
try {
  const user = await api.get(1, {
    type: 'users'
  });
  
  console.log('✓ User retrieved:', user.data);
} catch (error) {
  console.error('✗ Get failed:', error.message);
}

// Test 6: Update
console.log('\n6. Testing update operation...');
try {
  const updated = await api.update(1, {
    age: 31
  }, {
    type: 'users'
  });
  
  console.log('✓ User updated:', updated.data);
} catch (error) {
  console.error('✗ Update failed:', error.message);
}

// Test 7: Delete
console.log('\n7. Testing delete operation...');
try {
  await api.delete(1, {
    type: 'users'
  });
  
  console.log('✓ User deleted successfully');
} catch (error) {
  console.error('✗ Delete failed:', error.message);
}

console.log('\n✓ All basic tests completed!');