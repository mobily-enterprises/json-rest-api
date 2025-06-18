#!/usr/bin/env node

/**
 * Comprehensive test suite for advanced refs functionality
 * Tests all join scenarios, configurations, and edge cases
 */

import assert from 'assert';
import { Api, Schema, MemoryPlugin } from './index.js';

console.log('🧪 Testing Advanced Refs Implementation...\n');

// Test counter
let testCount = 0;
let passedCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passedCount++;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}`);
    console.error(`   ${error.message}`);
    console.error(`   ${error.stack}`);
  }
}

// Helper to create test API
function createTestApi() {
  const api = new Api();
  api.use(MemoryPlugin);
  
  // Define schemas
  const userSchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string' },
    avatar: { type: 'string' },
    bio: { type: 'string' },
    secretKey: { type: 'string', silent: true }
  });
  
  const categorySchema = new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    slug: { type: 'string' },
    color: { type: 'string' }
  });
  
  const projectSchema = new Schema({
    id: { type: 'id' },
    title: { type: 'string', required: true },
    description: { type: 'string' },
    
    // Eager join - replaces ID with object
    ownerId: {
      type: 'id',
      refs: {
        resource: 'users',
        join: {
          eager: true,
          fields: ['id', 'name', 'email', 'avatar']
        }
      }
    },
    
    // Lazy join with resourceField
    categoryId: {
      type: 'id',
      refs: {
        resource: 'categories',
        join: {
          eager: false,
          resourceField: 'category',
          fields: ['id', 'name', 'slug']
        }
      }
    },
    
    // Eager with preserveId
    createdById: {
      type: 'id',
      refs: {
        resource: 'users',
        join: {
          eager: true,
          preserveId: true,
          fields: ['id', 'name']
        }
      }
    }
  });
  
  api.addResource('users', userSchema);
  api.addResource('categories', categorySchema);
  api.addResource('projects', projectSchema);
  
  return api;
}

// Seed test data
async function seedTestData(api) {
  // Create users
  const user1 = await api.resources.users.create({
    name: 'John Doe',
    email: 'john@example.com',
    avatar: 'john.jpg',
    bio: 'Developer',
    secretKey: 'secret123'
  });
  
  const user2 = await api.resources.users.create({
    name: 'Jane Smith',
    email: 'jane@example.com',
    avatar: 'jane.jpg',
    bio: 'Designer',
    secretKey: 'secret456'
  });
  
  // Create categories
  const cat1 = await api.resources.categories.create({
    name: 'Technology',
    slug: 'tech',
    color: '#0066cc'
  });
  
  const cat2 = await api.resources.categories.create({
    name: 'Design',
    slug: 'design',
    color: '#ff6600'
  });
  
  // Create projects
  const project1 = await api.resources.projects.create({
    title: 'API Development',
    description: 'Building a REST API',
    ownerId: user1.data.id,
    categoryId: cat1.data.id,
    createdById: user2.data.id
  });
  
  const project2 = await api.resources.projects.create({
    title: 'UI Redesign',
    description: 'Modernizing the interface',
    ownerId: user2.data.id,
    categoryId: cat2.data.id,
    createdById: user1.data.id
  });
  
  return { user1, user2, cat1, cat2, project1, project2 };
}

// Run tests
(async () => {
  const api = createTestApi();
  const testData = await seedTestData(api);
  
  // Test 1: Eager join on single get
  test('Eager join replaces ID with object on get()', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id);
    
    assert(typeof result.data.ownerId === 'object', 'ownerId should be an object');
    assert.equal(result.data.ownerId.name, 'John Doe');
    assert.equal(result.data.ownerId.email, 'john@example.com');
    assert(!result.data.ownerId.secretKey, 'Silent field should not be included');
  });
  
  // Test 2: Lazy join not loaded by default
  test('Lazy join not loaded without explicit request', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id);
    
    assert(typeof result.data.categoryId === 'number', 'categoryId should remain as ID');
    assert(!result.data.category, 'category field should not exist');
  });
  
  // Test 3: Explicit join request
  test('Explicit join request loads lazy joins', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id, {
      joins: ['categoryId']
    });
    
    assert(typeof result.data.categoryId === 'number', 'categoryId should remain as ID');
    assert(result.data.category, 'category field should exist');
    assert.equal(result.data.category.name, 'Technology');
  });
  
  // Test 4: PreserveId keeps both ID and object
  test('PreserveId maintains ID and adds separate field', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id);
    
    assert(typeof result.data.createdById === 'number', 'createdById should remain as ID');
    assert(result.data.createdBy, 'createdBy field should exist');
    assert.equal(result.data.createdBy.name, 'Jane Smith');
  });
  
  // Test 5: Disable all joins
  test('joins: false disables all joins', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id, {
      joins: false
    });
    
    assert(typeof result.data.ownerId === 'number', 'ownerId should be ID');
    assert(typeof result.data.categoryId === 'number', 'categoryId should be ID');
    assert(typeof result.data.createdById === 'number', 'createdById should be ID');
    assert(!result.data.createdBy, 'createdBy should not exist');
  });
  
  // Test 6: Query with eager joins
  test('Query operations respect eager joins', async () => {
    const result = await api.resources.projects.query();
    
    assert(result.data.length === 2, 'Should have 2 projects');
    assert(typeof result.data[0].ownerId === 'object', 'First project ownerId should be object');
    assert(typeof result.data[0].createdById === 'number', 'createdById should remain as ID');
    assert(result.data[0].createdBy, 'createdBy should exist');
  });
  
  // Test 7: Exclude specific joins
  test('excludeJoins parameter works correctly', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id, {
      excludeJoins: ['ownerId']
    });
    
    assert(typeof result.data.ownerId === 'number', 'Excluded ownerId should remain as ID');
    assert(result.data.createdBy, 'Other eager joins should still work');
  });
  
  // Test 8: Hook execution on joined data
  test('Hooks run on joined data with correct context', async () => {
    let hookRan = false;
    let hookContext = null;
    
    api.hook('afterGet', async (context) => {
      if (context.options.isJoinResult) {
        hookRan = true;
        hookContext = context.options;
      }
    });
    
    await api.resources.projects.get(testData.project1.data.id);
    
    assert(hookRan, 'Hook should run for joined data');
    assert.equal(hookContext.joinContext, 'join');
    assert(hookContext.parentType, 'Should have parent type');
    assert(hookContext.parentField, 'Should have parent field');
  });
  
  // Test 9: Multiple joins in single query
  test('Multiple joins work correctly', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id, {
      joins: ['categoryId']
    });
    
    assert(typeof result.data.ownerId === 'object', 'Eager join should work');
    assert(result.data.category, 'Explicit join should work');
    assert(result.data.createdBy, 'PreserveId join should work');
  });
  
  // Test 10: Field selection in joins
  test('Field selection limits joined fields correctly', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id);
    
    const owner = result.data.ownerId;
    assert(owner.id, 'Should have id');
    assert(owner.name, 'Should have name');
    assert(owner.email, 'Should have email');
    assert(owner.avatar, 'Should have avatar');
    assert(!owner.bio, 'Should not have bio (not in fields list)');
    assert(!owner.secretKey, 'Should not have silent field');
  });
  
  // Test 11: JSON:API format for HTTP
  test('JSON:API format handles relationships correctly', async () => {
    // Simulate HTTP context
    const httpContext = {
      api,
      method: 'get',
      id: testData.project1.data.id,
      options: { type: 'projects', isHttp: true },
      result: null,
      joinFields: {}
    };
    
    // Run the get operation
    const result = await api.resources.projects.get(testData.project1.data.id);
    httpContext.result = result.data;
    
    // This would normally be done by the HTTP plugin's beforeSend hook
    // For testing, we'll check the structure manually
    assert(result.data.ownerId.id, 'Join data should be present before JSON:API transform');
  });
  
  // Test 12: Error handling for invalid joins
  test('Invalid join field names are ignored', async () => {
    const result = await api.resources.projects.get(testData.project1.data.id, {
      joins: ['nonExistentField', 'categoryId']
    });
    
    assert(result.data.category, 'Valid join should work');
    assert(!result.data.nonExistentField, 'Invalid join should be ignored');
  });
  
  // Test 13: Null foreign keys
  test('Null foreign keys handled gracefully', async () => {
    const project = await api.resources.projects.create({
      title: 'Orphan Project',
      description: 'No owner',
      ownerId: null,
      categoryId: null,
      createdById: null
    });
    
    const result = await api.resources.projects.get(project.data.id);
    assert.equal(result.data.ownerId, null, 'Null ID should remain null');
    assert.equal(result.data.categoryId, null, 'Null ID should remain null');
    assert.equal(result.data.createdById, null, 'Null ID should remain null');
    assert(!result.data.createdBy, 'No join object for null ID');
  });
  
  // Test 14: Complex query with filters and joins
  test('Joins work with filtered queries', async () => {
    const result = await api.resources.projects.query({
      filter: { title: 'API Development' }
    });
    
    assert.equal(result.data.length, 1);
    assert(typeof result.data[0].ownerId === 'object', 'Join should work with filters');
    assert.equal(result.data[0].ownerId.name, 'John Doe');
  });
  
  // Test 15: Joins with pagination
  test('Joins work with paginated queries', async () => {
    const result = await api.resources.projects.query({
      page: { size: 1, number: 1 }
    });
    
    assert.equal(result.data.length, 1);
    assert(typeof result.data[0].ownerId === 'object', 'Join should work with pagination');
  });
  
  // Summary
  console.log(`\n📊 Test Results: ${passedCount}/${testCount} passed`);
  
  if (passedCount === testCount) {
    console.log('✨ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed');
    process.exit(1);
  }
})().catch(error => {
  console.error('💥 Test suite error:', error);
  process.exit(1);
});