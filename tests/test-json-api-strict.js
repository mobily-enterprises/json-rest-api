import { Api, Schema, MemoryPlugin, HTTPPlugin, JSONAPIStrictPlugin } from '../index.js';
import express from 'express';
import { assertType, assertEqual, assertNotEqual, runTests } from './lib/test-utils.js';
import axios from 'axios';

// Test schemas
const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number' },
  role: { type: 'string', default: 'user' }
});

const postSchema = new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string' },
  authorId: { 
    type: 'id', 
    required: true,
    refs: { 
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name', 'email']
      }
    }
  },
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories'
    }
  },
  status: { type: 'string', default: 'draft' },
  tags: { type: 'array' }
});

const categorySchema = new Schema({
  name: { type: 'string', required: true },
  description: { type: 'string' },
  parentId: {
    type: 'id',
    refs: {
      resource: 'categories'
    }
  }
});

const commentSchema = new Schema({
  content: { type: 'string', required: true },
  postId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'posts',
      join: {
        eager: true,
        fields: ['id', 'title']
      }
    }
  },
  authorId: {
    type: 'id',
    required: true,
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name']
      }
    }
  }
});

async function createTestServer(useStrictPlugin = true) {
  const app = express();
  const api = new Api();
  
  // Add plugins
  api.use(MemoryPlugin);
  if (useStrictPlugin) {
    api.use(JSONAPIStrictPlugin);
  }
  api.use(HTTPPlugin, { app });
  
  // Add resources
  api.addResource('users', userSchema);
  api.addResource('posts', postSchema);
  api.addResource('categories', categorySchema);
  api.addResource('comments', commentSchema);
  
  // Start server
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  
  const port = server.address().port;
  const baseURL = `http://localhost:${port}/api`;
  
  return { api, server, baseURL, port };
}

async function setupTestData(api) {
  // Create users
  const user1 = await api.resources.users.insert({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    role: 'admin'
  });
  
  const user2 = await api.resources.users.insert({
    name: 'Jane Smith',
    email: 'jane@example.com',
    age: 25,
    role: 'user'
  });
  
  // Create categories
  const category1 = await api.resources.categories.insert({
    name: 'Technology',
    description: 'Tech related posts'
  });
  
  const category2 = await api.resources.categories.insert({
    name: 'JavaScript',
    description: 'JS specific posts',
    parentId: category1.id
  });
  
  // Create posts
  const post1 = await api.resources.posts.insert({
    title: 'Getting Started with JSON:API',
    content: 'This post explains JSON:API basics',
    authorId: user1.id,
    categoryId: category1.id,
    status: 'published',
    tags: ['api', 'json', 'tutorial']
  });
  
  const post2 = await api.resources.posts.insert({
    title: 'Advanced JSON:API Patterns',
    content: 'Deep dive into JSON:API',
    authorId: user2.id,
    categoryId: category2.id,
    status: 'published',
    tags: ['api', 'advanced']
  });
  
  // Create comments
  const comment1 = await api.resources.comments.insert({
    content: 'Great article!',
    postId: post1.id,
    authorId: user2.id
  });
  
  return { user1, user2, category1, category2, post1, post2, comment1 };
}

async function runJsonApiStrictTests() {
  console.log('Testing JSONAPIStrictPlugin...\n');
  
  // Test 1: Basic response structure transformation
  await runTests('Basic Response Structure', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    const { user1 } = await setupTestData(api);
    
    try {
      // Test single resource
      const response = await axios.get(`${baseURL}/users/${user1.id}`);
      const data = response.data.data;
      
      // Check structure
      assertType(data.id, 'string', 'ID should be string');
      assertEqual(data.type, 'users', 'Type should be users');
      assertType(data.attributes, 'object', 'Should have attributes');
      assertNotEqual(data.attributes.id, user1.id, 'ID should not be in attributes');
      
      // Check that ID is not in attributes
      assertEqual(data.attributes.id, undefined, 'ID should not be in attributes');
      
      console.log('✓ Single resource structure correct');
      
      // Test collection
      const listResponse = await axios.get(`${baseURL}/users`);
      assertType(listResponse.data.data, 'array', 'Collection should be array');
      assertType(listResponse.data.data[0].attributes, 'object', 'Items should have attributes');
      
      console.log('✓ Collection structure correct');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 2: Relationship handling
  await runTests('Relationship Handling', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    const { post1 } = await setupTestData(api);
    
    try {
      const response = await axios.get(`${baseURL}/posts/${post1.id}`);
      const data = response.data.data;
      
      // Check relationships exist
      assertType(data.relationships, 'object', 'Should have relationships');
      assertType(data.relationships.author, 'object', 'Should have author relationship');
      assertType(data.relationships.category, 'object', 'Should have category relationship');
      
      // Check relationship structure
      const authorRel = data.relationships.author;
      assertType(authorRel.data, 'object', 'Relationship should have data');
      assertEqual(authorRel.data.type, 'users', 'Author type should be users');
      assertType(authorRel.data.id, 'string', 'Author ID should be string');
      
      // Check relationship links
      assertType(authorRel.links, 'object', 'Relationship should have links');
      assertType(authorRel.links.self, 'string', 'Should have self link');
      assertType(authorRel.links.related, 'string', 'Should have related link');
      
      // Check that authorId is NOT in attributes
      assertEqual(data.attributes.authorId, undefined, 'authorId should not be in attributes');
      assertEqual(data.attributes.categoryId, undefined, 'categoryId should not be in attributes');
      
      console.log('✓ Relationships structured correctly');
      console.log('✓ Foreign keys removed from attributes');
      console.log('✓ Relationship links included');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 3: Compound documents with included resources
  await runTests('Compound Documents', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    const { post1, user1, category1 } = await setupTestData(api);
    
    try {
      const response = await axios.get(`${baseURL}/posts/${post1.id}?include=author,category`);
      
      // Check included array exists
      assertType(response.data.included, 'array', 'Should have included array');
      
      // Find author in included
      const includedAuthor = response.data.included.find(
        item => item.type === 'users' && item.id === String(user1.id)
      );
      assertType(includedAuthor, 'object', 'Author should be in included');
      assertEqual(includedAuthor.attributes.name, 'John Doe', 'Author name should match');
      
      // Find category in included
      const includedCategory = response.data.included.find(
        item => item.type === 'categories' && item.id === String(category1.id)
      );
      assertType(includedCategory, 'object', 'Category should be in included');
      assertEqual(includedCategory.attributes.name, 'Technology', 'Category name should match');
      
      // Check no duplicates in included
      const ids = response.data.included.map(item => `${item.type}:${item.id}`);
      const uniqueIds = [...new Set(ids)];
      assertEqual(ids.length, uniqueIds.length, 'No duplicates in included');
      
      console.log('✓ Included array contains related resources');
      console.log('✓ No duplicates in included array');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 4: Nested relationships
  await runTests('Nested Relationships', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    const { comment1 } = await setupTestData(api);
    
    try {
      const response = await axios.get(`${baseURL}/comments/${comment1.id}?include=post,author`);
      
      // Check comment relationships
      const comment = response.data.data;
      assertType(comment.relationships.post, 'object', 'Should have post relationship');
      assertType(comment.relationships.author, 'object', 'Should have author relationship');
      
      // Check included has both post and author
      const includedTypes = response.data.included.map(item => item.type);
      assertEqual(includedTypes.includes('posts'), true, 'Should include post');
      assertEqual(includedTypes.includes('users'), true, 'Should include author');
      
      console.log('✓ Nested relationships handled correctly');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 5: Meta information
  await runTests('Meta Information', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    await setupTestData(api);
    
    try {
      const response = await axios.get(`${baseURL}/posts?page[size]=1`);
      
      // Check meta structure
      assertType(response.data.meta, 'object', 'Should have meta');
      assertType(response.data.meta.total, 'number', 'Should have total count');
      assertType(response.data.meta.totalCount, 'number', 'Should have totalCount');
      assertType(response.data.meta.currentPage, 'number', 'Should have currentPage');
      assertType(response.data.meta.pageSize, 'number', 'Should have pageSize');
      
      console.log('✓ Meta information follows JSON:API format');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 6: Error formatting
  await runTests('Error Formatting', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    
    try {
      // Try to get non-existent resource
      try {
        await axios.get(`${baseURL}/users/99999`);
      } catch (error) {
        const errors = error.response.data.errors;
        
        assertType(errors, 'array', 'Errors should be array');
        assertType(errors[0].status, 'string', 'Error should have status');
        assertType(errors[0].code, 'string', 'Error should have code');
        assertType(errors[0].title, 'string', 'Error should have title');
        assertType(errors[0].detail, 'string', 'Error should have detail');
        
        console.log('✓ Errors follow JSON:API format');
      }
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  // Test 7: Comparison with non-strict mode
  await runTests('Strict vs Non-Strict Comparison', async () => {
    // Create two servers - one with plugin, one without
    const { api: strictApi, server: strictServer, baseURL: strictURL } = await createTestServer(true);
    const { api: normalApi, server: normalServer, baseURL: normalURL } = await createTestServer(false);
    
    try {
      // Setup same data in both
      const strictData = await setupTestData(strictApi);
      const normalData = await setupTestData(normalApi);
      
      // Get same post from both
      const strictResponse = await axios.get(`${strictURL}/posts/${strictData.post1.id}`);
      const normalResponse = await axios.get(`${normalURL}/posts/${normalData.post1.id}`);
      
      // Compare structures
      const strictPost = strictResponse.data.data;
      const normalPost = normalResponse.data.data;
      
      // Normal mode has authorId in attributes
      assertType(normalPost.attributes.authorId, 'string', 'Normal mode has authorId in attributes');
      assertType(normalPost.attributes.author, 'object', 'Normal mode has author object in attributes');
      
      // Strict mode has relationships
      assertEqual(strictPost.attributes.authorId, undefined, 'Strict mode has no authorId in attributes');
      assertEqual(strictPost.attributes.author, undefined, 'Strict mode has no author in attributes');
      assertType(strictPost.relationships, 'object', 'Strict mode has relationships');
      
      console.log('✓ Strict mode transforms structure correctly');
      console.log('✓ Non-strict mode preserves simple structure');
      
    } finally {
      await Promise.all([
        new Promise(resolve => strictServer.close(resolve)),
        new Promise(resolve => normalServer.close(resolve))
      ]);
    }
  });
  
  // Test 8: Sparse fieldsets with relationships
  await runTests('Sparse Fieldsets with Relationships', async () => {
    const { api, server, baseURL } = await createTestServer(true);
    const { post1 } = await setupTestData(api);
    
    try {
      const response = await axios.get(`${baseURL}/posts/${post1.id}?fields[posts]=title`);
      const data = response.data.data;
      
      // Should only have title in attributes
      const attrKeys = Object.keys(data.attributes);
      assertEqual(attrKeys.length, 1, 'Should only have one attribute');
      assertEqual(attrKeys[0], 'title', 'Should only have title');
      
      // Should still have relationships
      assertType(data.relationships, 'object', 'Should still have relationships');
      
      console.log('✓ Sparse fieldsets work with relationships');
      
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  
  console.log('\n✅ All JSONAPIStrictPlugin tests passed!\n');
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runJsonApiStrictTests().catch(console.error);
}