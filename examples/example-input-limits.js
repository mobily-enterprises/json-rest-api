#!/usr/bin/env node

import { Api, Schema, createApi } from '../index.js';

// Example: Input Size Validation to Prevent DoS Attacks

const api = createApi({
  storage: 'memory'
});

// Define schema with input size limits
const postSchema = new Schema({
  title: { 
    type: 'string', 
    required: true,
    max: 200  // Max 200 characters
  },
  
  tags: { 
    type: 'array',
    maxItems: 50,  // Max 50 tags
    maxItemsErrorMessage: 'Posts cannot have more than 50 tags'
  },
  
  metadata: { 
    type: 'object',
    maxKeys: 20,   // Max 20 properties
    maxDepth: 3,   // Max 3 levels deep
    maxKeysErrorMessage: 'Metadata is too complex',
    maxDepthErrorMessage: 'Metadata nesting is too deep'
  },
  
  comments: {
    type: 'array',
    maxItems: 1000,  // Max 1000 comments per post
  },
  
  // This will trigger a warning because it has no limits
  dangerousField: {
    type: 'object'
  }
});

// Add the resource
api.addResource('posts', postSchema);

// Test the limits
async function testLimits() {
  console.log('Testing Input Size Limits\n');
  
  // 1. Valid post - should work
  console.log('1. Creating valid post...');
  try {
    const post = await api.resources.posts.create({
      title: 'Valid Post',
      tags: ['javascript', 'security', 'api'],
      metadata: {
        author: 'John',
        stats: {
          views: 100,
          likes: 50
        }
      }
    });
    console.log('✓ Success:', post.data.id);
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }
  
  // 2. Too many tags - should fail
  console.log('\n2. Testing maxItems limit (too many tags)...');
  try {
    const manyTags = Array(100).fill(0).map((_, i) => `tag${i}`);
    await api.resources.posts.create({
      title: 'Too Many Tags',
      tags: manyTags
    });
    console.log('✗ Should have failed!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.errors?.[0]?.message || error.message);
  }
  
  // 3. Too many object keys - should fail
  console.log('\n3. Testing maxKeys limit (too many metadata properties)...');
  try {
    const bigMetadata = {};
    for (let i = 0; i < 50; i++) {
      bigMetadata[`key${i}`] = i;
    }
    
    await api.resources.posts.create({
      title: 'Too Many Keys',
      metadata: bigMetadata
    });
    console.log('✗ Should have failed!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.errors?.[0]?.message || error.message);
  }
  
  // 4. Too deeply nested - should fail
  console.log('\n4. Testing maxDepth limit (deeply nested object)...');
  try {
    await api.resources.posts.create({
      title: 'Too Deep',
      metadata: {
        level1: {
          level2: {
            level3: {
              level4: 'This is too deep!'
            }
          }
        }
      }
    });
    console.log('✗ Should have failed!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.errors?.[0]?.message || error.message);
  }
  
  // 5. Multiple violations - should report first error
  console.log('\n5. Testing multiple violations...');
  try {
    const manyTags = Array(100).fill(0).map((_, i) => `tag${i}`);
    const bigMetadata = {};
    for (let i = 0; i < 50; i++) {
      bigMetadata[`key${i}`] = i;
    }
    
    await api.resources.posts.create({
      title: 'Multiple Problems',
      tags: manyTags,
      metadata: bigMetadata
    });
    console.log('✗ Should have failed!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.errors?.length, 'errors found');
    error.errors?.forEach(err => {
      console.log(`  - ${err.field}: ${err.message}`);
    });
  }
}

// Run tests
console.log('Note: You should see warnings above about unlimited fields\n');
testLimits().catch(console.error);