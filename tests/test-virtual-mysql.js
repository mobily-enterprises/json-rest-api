#!/usr/bin/env node

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api, Schema, MySQLPlugin } from '../index.js';

// MySQL connection config
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'ppp',
  database: 'jsonrestapi_test'
};

test('Virtual Search Fields with MySQL', async (t) => {
  
  await t.test('should work with MySQL storage', async () => {
    const api = new Api();
    
    // Install MySQL plugin
    api.use(MySQLPlugin, {
      connections: [{
        name: 'main',
        config: dbConfig
      }]
    });
    
    await api.connect();
    
    try {
      // Create posts table
      await api.execute('db.query', { 
        sql: 'DROP TABLE IF EXISTS posts',
        connection: 'main'
      });
      
      await api.execute('db.query', {
        sql: `CREATE TABLE posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255),
          content TEXT,
          tags TEXT
        )`,
        connection: 'main'
      });
      
      const schema = new Schema({
        id: { type: 'id' },
        title: { type: 'string', searchable: true },
        content: { type: 'string' },
        tags: { type: 'array' }
      });
      
      api.addResource('posts', schema, {
        searchableFields: {
          title: 'title',
          search: '*'  // Virtual multi-field search
        }
      });
      
      // Create test data
      await api.resources.posts.create({
        title: 'JavaScript Tutorial',
        content: 'Learn JavaScript programming',
        tags: ['javascript', 'tutorial']
      });
      
      await api.resources.posts.create({
        title: 'Python Guide',
        content: 'Introduction to Python',
        tags: ['python', 'guide']
      });
      
      await api.resources.posts.create({
        title: 'Ruby Basics',
        content: 'Getting started with JavaScript alternatives',
        tags: ['ruby', 'basics']
      });
      
      // Implement virtual search
      api.hook('modifyQuery', async (context) => {
        if (context.params.filter?.search && context.options.type === 'posts') {
          const value = context.params.filter.search;
          
          // For SQL, we can modify the query directly
          context.query.where(
            '(posts.title LIKE ? OR posts.content LIKE ?)',
            `%${value}%`, `%${value}%`
          );
          
          delete context.params.filter.search;
        }
      });
      
      // Test the search
      const results = await api.resources.posts.query({
        filter: { search: 'javascript' }
      });
      
      console.log('Found', results.data.length, 'posts');
      results.data.forEach(post => {
        console.log('-', post.attributes.title);
      });
      
      assert.strictEqual(results.data.length, 2, 'Should find 2 posts mentioning JavaScript');
      
      // Verify the correct posts were found
      const titles = results.data.map(p => p.attributes.title);
      assert.ok(titles.includes('JavaScript Tutorial'));
      assert.ok(titles.includes('Ruby Basics')); // Found because content mentions JavaScript
      
    } finally {
      // Cleanup
      await api.execute('db.query', { 
        sql: 'DROP TABLE IF EXISTS posts',
        connection: 'main'
      });
      
      if (api.connection) {
        await api.connection.end();
      }
    }
  });
});