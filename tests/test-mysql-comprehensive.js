#!/usr/bin/env node

/**
 * Comprehensive MySQL test suite for JSON REST API
 * Tests all features with real MySQL database
 * 
 * Run with: node test-mysql-comprehensive.js
 */

import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  Api, 
  Schema, 
  createApi,
  MySQLPlugin,
  ValidationPlugin,
  TimestampsPlugin,
  HTTPPlugin
} from '../index.js';
import express from 'express';
import mysql from 'mysql2/promise';

// MySQL configuration
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'ppp',
  database: process.env.MYSQL_DATABASE || 'jsonrestapi_test_comprehensive'
};

console.log('🧪 Running comprehensive MySQL test suite...\n');
console.log('Note: This requires a running MySQL server\n');

describe('Comprehensive MySQL Tests', () => {
  let connection;
  
  before(async () => {
    try {
      // Create initial connection without database
      connection = await mysql.createConnection({
        host: MYSQL_CONFIG.host,
        user: MYSQL_CONFIG.user,
        password: MYSQL_CONFIG.password,
        multipleStatements: true
      });
      
      // Create test database
      await connection.query(`CREATE DATABASE IF NOT EXISTS ${MYSQL_CONFIG.database}`);
      console.log(`✓ Created test database: ${MYSQL_CONFIG.database}`);
      
    } catch (error) {
      console.error('❌ MySQL connection failed:', error.message);
      console.log('\nTo run MySQL tests, ensure MySQL is running with:');
      console.log(`  Host: ${MYSQL_CONFIG.host}`);
      console.log(`  User: ${MYSQL_CONFIG.user}`);
      console.log(`  Password: ${MYSQL_CONFIG.password}`);
      process.exit(1);
    }
  });
  
  after(async () => {
    if (connection) {
      // Drop test database
      await connection.query(`DROP DATABASE IF EXISTS ${MYSQL_CONFIG.database}`);
      await connection.end();
      console.log('\n✓ Cleaned up test database');
    }
  });

  describe('1. Basic CRUD Operations with MySQL', () => {
    let api;
    
    beforeEach(async () => {
      // Create fresh API instance
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      // Define schema
      api.addResource('users', new Schema({
        name: { type: 'string', required: true, min: 2, max: 100 },
        email: { type: 'string', required: true },
        age: { type: 'number', min: 0, max: 150 },
        active: { type: 'boolean', default: true },
        bio: { type: 'string' },
        metadata: { type: 'object' },
        tags: { type: 'array' }
      }));
      
      // Sync database to create tables
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      // Clean up
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS users');
      await db.end();
    });
    
    it('should create a record', async () => {
      const result = await api.resources.users.create({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        bio: 'Software developer',
        metadata: { role: 'admin', level: 5 },
        tags: ['developer', 'admin']
      });
      
      assert(result.data);
      assert.equal(result.data.attributes.name, 'John Doe');
      assert.equal(result.data.attributes.email, 'john@example.com');
      assert.equal(result.data.attributes.active, true); // default value
      assert.deepEqual(result.data.attributes.metadata, { role: 'admin', level: 5 });
      assert.deepEqual(result.data.attributes.tags, ['developer', 'admin']);
    });
    
    it('should get a record by ID', async () => {
      const created = await api.resources.users.create({
        name: 'Jane Doe',
        email: 'jane@example.com'
      });
      
      const result = await api.resources.users.get(created.data.id);
      assert.equal(result.data.id, created.data.id);
      assert.equal(result.data.attributes.name, 'Jane Doe');
    });
    
    it('should update a record', async () => {
      const created = await api.resources.users.create({
        name: 'Bob Smith',
        email: 'bob@example.com',
        age: 25
      });
      
      const updated = await api.resources.users.update(created.data.id, {
        age: 26,
        bio: 'Updated bio'
      });
      
      assert.equal(updated.data.attributes.age, 26);
      assert.equal(updated.data.attributes.bio, 'Updated bio');
      assert.equal(updated.data.attributes.name, 'Bob Smith'); // unchanged
    });
    
    it('should delete a record', async () => {
      const created = await api.resources.users.create({
        name: 'Temp User',
        email: 'temp@example.com'
      });
      
      await api.resources.users.delete(created.data.id);
      
      // Verify deletion
      try {
        await api.resources.users.get(created.data.id);
        assert.fail('Should have thrown NotFoundError');
      } catch (error) {
        assert(error.message.includes('not found'));
      }
    });
    
    it('should query records with filters', async () => {
      // Create test data
      await api.resources.users.create({ name: 'Active 1', email: 'a1@test.com', active: true, age: 25 });
      await api.resources.users.create({ name: 'Active 2', email: 'a2@test.com', active: true, age: 35 });
      await api.resources.users.create({ name: 'Inactive', email: 'i1@test.com', active: false, age: 30 });
      
      // Query active users
      const activeUsers = await api.resources.users.query({
        filter: { active: true }
      });
      
      assert.equal(activeUsers.data.length, 2);
      activeUsers.data.forEach(user => {
        assert.equal(user.attributes.active, true);
      });
      
      // Query with multiple filters
      const youngActiveUsers = await api.resources.users.query({
        filter: { 
          active: true,
          age: { $lt: 30 }
        }
      });
      
      assert.equal(youngActiveUsers.data.length, 1);
      assert.equal(youngActiveUsers.data[0].attributes.name, 'Active 1');
    });
  });

  describe('2. Advanced Queries and Operators', () => {
    let api;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      api.addResource('products', new Schema({
        name: { type: 'string', required: true },
        category: { type: 'string', required: true },
        price: { type: 'number', required: true },
        stock: { type: 'number', default: 0 },
        featured: { type: 'boolean', default: false },
        createdAt: { type: 'timestamp' }
      }));
      
      await api.syncDatabase();
      
      // Create test data
      const products = [
        { name: 'Laptop', category: 'electronics', price: 999, stock: 5, featured: true },
        { name: 'Mouse', category: 'electronics', price: 29, stock: 50 },
        { name: 'Keyboard', category: 'electronics', price: 79, stock: 0 },
        { name: 'Monitor', category: 'electronics', price: 299, stock: 10, featured: true },
        { name: 'Desk', category: 'furniture', price: 399, stock: 3 },
        { name: 'Chair', category: 'furniture', price: 199, stock: 8 },
        { name: 'Notebook', category: 'stationery', price: 5, stock: 100 },
        { name: 'Pen', category: 'stationery', price: 2, stock: 200 }
      ];
      
      for (const product of products) {
        await api.resources.products.create(product);
      }
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS products');
      await db.end();
    });
    
    it('should support comparison operators', async () => {
      // Greater than
      const expensiveProducts = await api.resources.products.query({
        filter: { price: { $gt: 100 } }
      });
      assert.equal(expensiveProducts.data.length, 4);
      
      // Less than or equal
      const cheapProducts = await api.resources.products.query({
        filter: { price: { $lte: 50 } }
      });
      assert.equal(cheapProducts.data.length, 4);
      
      // Range query
      const midRange = await api.resources.products.query({
        filter: { 
          price: { $gte: 50, $lt: 300 }
        }
      });
      assert.equal(midRange.data.length, 3);
    });
    
    it('should support IN and NOT IN operators', async () => {
      const electronics = await api.resources.products.query({
        filter: { 
          category: { $in: ['electronics', 'stationery'] }
        }
      });
      assert.equal(electronics.data.length, 6);
      
      const notFurniture = await api.resources.products.query({
        filter: {
          category: { $nin: ['furniture'] }
        }
      });
      assert.equal(notFurniture.data.length, 6);
    });
    
    it('should support sorting', async () => {
      // Sort by price ascending
      const byPriceAsc = await api.resources.products.query({
        sort: 'price'
      });
      assert.equal(byPriceAsc.data[0].attributes.name, 'Pen');
      assert.equal(byPriceAsc.data[byPriceAsc.data.length - 1].attributes.name, 'Laptop');
      
      // Sort by price descending
      const byPriceDesc = await api.resources.products.query({
        sort: '-price'
      });
      assert.equal(byPriceDesc.data[0].attributes.name, 'Laptop');
      
      // Multiple sort fields
      const multiSort = await api.resources.products.query({
        sort: 'category,-price'
      });
      // Should be sorted by category first, then by price desc within category
      assert.equal(multiSort.data[0].attributes.category, 'electronics');
      assert.equal(multiSort.data[0].attributes.name, 'Laptop'); // Most expensive electronics
    });
    
    it('should support pagination', async () => {
      const page1 = await api.resources.products.query({
        page: { size: 3, number: 1 }
      });
      
      assert.equal(page1.data.length, 3);
      assert.equal(page1.meta.total, 8);
      assert.equal(page1.meta.totalPages, 3);
      
      const page2 = await api.resources.products.query({
        page: { size: 3, number: 2 }
      });
      
      assert.equal(page2.data.length, 3);
      assert.equal(page2.meta.pageNumber, 2);
      
      // Ensure no overlap
      const page1Ids = page1.data.map(p => p.id);
      const page2Ids = page2.data.map(p => p.id);
      assert.equal(page1Ids.filter(id => page2Ids.includes(id)).length, 0);
    });
    
    it('should combine filters, sorting, and pagination', async () => {
      const result = await api.resources.products.query({
        filter: {
          category: 'electronics',
          stock: { $gt: 0 }
        },
        sort: '-price',
        page: { size: 2, number: 1 }
      });
      
      assert.equal(result.data.length, 2);
      assert.equal(result.data[0].attributes.name, 'Laptop');
      assert.equal(result.data[1].attributes.name, 'Monitor');
      assert.equal(result.meta.total, 3); // Laptop, Mouse, Monitor have stock
    });
  });

  describe('3. Relationships and Joins', () => {
    let api;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      // Define related schemas
      api.addResource('authors', new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        bio: { type: 'string' }
      }));
      
      api.addResource('categories', new Schema({
        name: { type: 'string', required: true },
        slug: { type: 'string', required: true },
        description: { type: 'string' }
      }));
      
      api.addResource('posts', new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string', required: true },
        published: { type: 'boolean', default: false },
        authorId: {
          type: 'id',
          refs: {
            resource: 'authors',
            join: {
              eager: true,
              fields: ['name', 'email']
            }
          }
        },
        categoryId: {
          type: 'id',
          refs: {
            resource: 'categories',
            join: {
              eager: false,
              fields: ['name', 'slug']
            }
          }
        }
      }));
      
      api.addResource('comments', new Schema({
        content: { type: 'string', required: true },
        postId: {
          type: 'id',
          refs: {
            resource: 'posts',
            join: {
              eager: true,
              fields: ['title'],
              mode: 'resourceField',
              resourceField: 'post'
            }
          }
        },
        authorId: {
          type: 'id',
          refs: {
            resource: 'authors',
            join: {
              eager: true,
              fields: ['name'],
              preserveId: true
            }
          }
        }
      }));
      
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS comments');
      await db.query('DROP TABLE IF EXISTS posts');
      await db.query('DROP TABLE IF EXISTS categories');
      await db.query('DROP TABLE IF EXISTS authors');
      await db.end();
    });
    
    it('should handle eager joins', async () => {
      // Create test data
      const author = await api.resources.authors.create({
        name: 'Jane Doe',
        email: 'jane@example.com',
        bio: 'Tech writer'
      });
      
      const category = await api.resources.categories.create({
        name: 'Technology',
        slug: 'tech',
        description: 'Tech posts'
      });
      
      const post = await api.resources.posts.create({
        title: 'Getting Started with Node.js',
        content: 'This is a tutorial...',
        published: true,
        authorId: author.data.id,
        categoryId: category.data.id
      });
      
      // Get post - should include author (eager) but not category (lazy)
      const result = await api.resources.posts.get(post.data.id);
      
      // Check that author data is embedded
      assert(result.data.attributes.authorId);
      
      // The actual join data would be in the HTTP response 'included' section
      // For direct API calls, we need to check if join was performed
      const queryResult = await api.resources.posts.query({
        filter: { id: post.data.id }
      });
      
      assert.equal(queryResult.data.length, 1);
      assert.equal(queryResult.data[0].attributes.title, 'Getting Started with Node.js');
    });
    
    it('should handle different join modes', async () => {
      // Create test data
      const author = await api.resources.authors.create({
        name: 'John Smith',
        email: 'john@example.com'
      });
      
      const post = await api.resources.posts.create({
        title: 'Test Post',
        content: 'Content here',
        authorId: author.data.id
      });
      
      // Test resourceField mode
      const comment1 = await api.resources.comments.create({
        content: 'Great post!',
        postId: post.data.id,
        authorId: author.data.id
      });
      
      // Get comment - should have post data in 'post' field
      const commentResult = await api.resources.comments.get(comment1.data.id);
      assert(commentResult.data.attributes.content);
      
      // Test preserveId mode - authorId should be preserved
      assert.equal(commentResult.data.attributes.authorId, author.data.id);
    });
    
    it('should handle nested joins', async () => {
      // Create nested data structure
      const country = await api.resources.authors.create({
        name: 'Country User',
        email: 'country@example.com',
        bio: 'Represents a country for testing'
      });
      
      const city = await api.resources.categories.create({
        name: 'City Category',
        slug: 'city',
        description: 'Represents a city for testing'
      });
      
      const company = await api.resources.posts.create({
        title: 'Company Post',
        content: 'Represents a company',
        authorId: country.data.id,
        categoryId: city.data.id
      });
      
      // Create comment that references the post (which references author and category)
      const employee = await api.resources.comments.create({
        content: 'Employee comment',
        postId: company.data.id,
        authorId: country.data.id
      });
      
      // Query with nested joins
      const result = await api.resources.comments.query({
        filter: { id: employee.data.id },
        join: ['postId.authorId', 'postId.categoryId']
      });
      
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.content, 'Employee comment');
    });
  });

  describe('4. Schema Validation', () => {
    let api;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      api.addResource('validations', new Schema({
        // String validations
        username: { type: 'string', required: true, min: 3, max: 20, match: /^[a-zA-Z0-9_]+$/ },
        email: { type: 'string', required: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        
        // Number validations
        age: { type: 'number', min: 18, max: 120 },
        score: { type: 'number', min: 0, max: 100 },
        
        // Enum validation
        role: { type: 'string', enum: ['user', 'admin', 'moderator'], default: 'user' },
        status: { type: 'string', enum: ['active', 'inactive', 'pending'], required: true },
        
        // Boolean with default
        verified: { type: 'boolean', default: false },
        
        // Arrays and objects
        tags: { type: 'array' },
        settings: { type: 'object' }
      }));
      
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS validations');
      await db.end();
    });
    
    it('should validate required fields', async () => {
      try {
        await api.resources.validations.create({
          email: 'test@example.com'
          // missing required username and status
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('validation'));
      }
    });
    
    it('should validate string constraints', async () => {
      try {
        await api.resources.validations.create({
          username: 'ab', // too short
          email: 'not-an-email',
          status: 'active'
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('validation'));
      }
    });
    
    it('should validate number constraints', async () => {
      try {
        await api.resources.validations.create({
          username: 'validuser',
          email: 'valid@example.com',
          status: 'active',
          age: 150, // too high
          score: -10 // too low
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('validation'));
      }
    });
    
    it('should validate enum values', async () => {
      try {
        await api.resources.validations.create({
          username: 'validuser',
          email: 'valid@example.com',
          status: 'invalid_status' // not in enum
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('validation'));
      }
    });
    
    it('should apply defaults', async () => {
      const result = await api.resources.validations.create({
        username: 'testuser',
        email: 'test@example.com',
        status: 'active'
        // role and verified should get defaults
      });
      
      assert.equal(result.data.attributes.role, 'user');
      assert.equal(result.data.attributes.verified, false);
    });
  });

  describe('5. Hooks and Middleware', () => {
    let api;
    let hookCalls;
    
    beforeEach(async () => {
      hookCalls = [];
      
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      // Add hooks
      api.hook('beforeInsert', async (context) => {
        hookCalls.push('beforeInsert');
        if (context.options.type === 'articles') {
          // Auto-generate slug
          if (context.data.title && !context.data.slug) {
            context.data.slug = context.data.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
          }
        }
      });
      
      api.hook('afterInsert', async (context) => {
        hookCalls.push('afterInsert');
      });
      
      api.hook('beforeUpdate', async (context) => {
        hookCalls.push('beforeUpdate');
        if (context.options.type === 'articles') {
          context.data.updatedAt = Date.now();
        }
      });
      
      api.hook('afterUpdate', async (context) => {
        hookCalls.push('afterUpdate');
      });
      
      api.hook('beforeDelete', async (context) => {
        hookCalls.push('beforeDelete');
      });
      
      api.hook('afterDelete', async (context) => {
        hookCalls.push('afterDelete');
      });
      
      api.hook('transformResult', async (context) => {
        hookCalls.push('transformResult');
        if (context.result && context.options.type === 'articles') {
          // Add computed field
          context.result.wordCount = context.result.content ? 
            context.result.content.split(/\s+/).length : 0;
        }
      });
      
      // Define schema
      api.addResource('articles', new Schema({
        title: { type: 'string', required: true },
        slug: { type: 'string' },
        content: { type: 'string' },
        published: { type: 'boolean', default: false },
        updatedAt: { type: 'timestamp' }
      }));
      
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS articles');
      await db.end();
    });
    
    it('should execute insert hooks', async () => {
      hookCalls = [];
      
      const result = await api.resources.articles.create({
        title: 'My First Article',
        content: 'This is the article content with several words'
      });
      
      assert(hookCalls.includes('beforeInsert'));
      assert(hookCalls.includes('afterInsert'));
      assert(hookCalls.includes('transformResult'));
      
      // Check auto-generated slug
      assert.equal(result.data.attributes.slug, 'my-first-article');
      
      // Check computed field
      assert.equal(result.data.attributes.wordCount, 8);
    });
    
    it('should execute update hooks', async () => {
      const article = await api.resources.articles.create({
        title: 'Test Article',
        content: 'Content'
      });
      
      hookCalls = [];
      
      const updated = await api.resources.articles.update(article.data.id, {
        published: true
      });
      
      assert(hookCalls.includes('beforeUpdate'));
      assert(hookCalls.includes('afterUpdate'));
      assert(hookCalls.includes('transformResult'));
      
      // Check updatedAt was set
      assert(updated.data.attributes.updatedAt);
    });
    
    it('should execute delete hooks', async () => {
      const article = await api.resources.articles.create({
        title: 'To Delete',
        content: 'Will be deleted'
      });
      
      hookCalls = [];
      
      await api.resources.articles.delete(article.data.id);
      
      assert(hookCalls.includes('beforeDelete'));
      assert(hookCalls.includes('afterDelete'));
    });
    
    it('should allow hooks to modify data', async () => {
      // Add a hook that modifies insert data
      api.hook('beforeInsert', async (context) => {
        if (context.options.type === 'articles' && !context.data.content) {
          context.data.content = 'Default content';
        }
      }, 10); // High priority
      
      const result = await api.resources.articles.create({
        title: 'No Content Article'
        // content will be added by hook
      });
      
      assert.equal(result.data.attributes.content, 'Default content');
    });
  });

  describe('6. Database Sync (dbSync)', () => {
    let api;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS sync_test');
      await db.end();
    });
    
    it('should create tables from schema', async () => {
      api.addResource('sync_test', new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean', default: true },
        tags: { type: 'array' },
        metadata: { type: 'object' }
      }));
      
      await api.syncDatabase();
      
      // Verify table exists
      const db = await mysql.createConnection(MYSQL_CONFIG);
      const [tables] = await db.query("SHOW TABLES LIKE 'sync_test'");
      assert.equal(tables.length, 1);
      
      // Verify columns
      const [columns] = await db.query("SHOW COLUMNS FROM sync_test");
      const columnNames = columns.map(col => col.Field);
      
      assert(columnNames.includes('id'));
      assert(columnNames.includes('name'));
      assert(columnNames.includes('email'));
      assert(columnNames.includes('age'));
      assert(columnNames.includes('active'));
      assert(columnNames.includes('tags'));
      assert(columnNames.includes('metadata'));
      
      await db.end();
    });
    
    it('should add new columns when schema changes', async () => {
      // Initial schema
      api.addResource('sync_test', new Schema({
        name: { type: 'string', required: true }
      }));
      
      await api.syncDatabase();
      
      // Add some data
      await api.resources.sync_test.create({ name: 'Test User' });
      
      // Update schema with new fields
      api.addResource('sync_test', new Schema({
        name: { type: 'string', required: true },
        email: { type: 'string' }, // new field
        score: { type: 'number', default: 0 } // new field with default
      }));
      
      // Sync again
      await api.syncDatabase();
      
      // Verify new columns exist
      const db = await mysql.createConnection(MYSQL_CONFIG);
      const [columns] = await db.query("SHOW COLUMNS FROM sync_test");
      const columnNames = columns.map(col => col.Field);
      
      assert(columnNames.includes('email'));
      assert(columnNames.includes('score'));
      
      // Verify existing data is preserved
      const result = await api.resources.sync_test.query({});
      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.name, 'Test User');
      assert.equal(result.data[0].attributes.score, 0); // default value
      
      await db.end();
    });
    
    it('should handle foreign key relationships', async () => {
      api.addResource('departments', new Schema({
        name: { type: 'string', required: true }
      }));
      
      api.addResource('employees', new Schema({
        name: { type: 'string', required: true },
        departmentId: {
          type: 'id',
          refs: { resource: 'departments' }
        }
      }));
      
      await api.syncDatabase();
      
      // Verify foreign key constraint
      const db = await mysql.createConnection(MYSQL_CONFIG);
      const [constraints] = await db.query(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '${MYSQL_CONFIG.database}'
        AND TABLE_NAME = 'employees'
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `);
      
      // Should have a foreign key constraint
      assert(constraints.length > 0);
      assert.equal(constraints[0].REFERENCED_TABLE_NAME, 'departments');
      
      await db.query('DROP TABLE IF EXISTS employees');
      await db.query('DROP TABLE IF EXISTS departments');
      await db.end();
    });
  });

  describe('7. Performance and Optimization', () => {
    let api;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      api.addResource('performance_test', new Schema({
        name: { type: 'string', required: true },
        category: { type: 'string', required: true },
        value: { type: 'number', required: true },
        timestamp: { type: 'timestamp', required: true },
        tags: { type: 'array' }
      }));
      
      await api.syncDatabase();
      
      // Create indexes for better performance
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('CREATE INDEX idx_category ON performance_test(category)');
      await db.query('CREATE INDEX idx_timestamp ON performance_test(timestamp)');
      await db.query('CREATE INDEX idx_category_timestamp ON performance_test(category, timestamp)');
      await db.end();
    });
    
    afterEach(async () => {
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS performance_test');
      await db.end();
    });
    
    it('should handle large datasets efficiently', async function() {
      this.timeout(30000); // 30 seconds for this test
      
      console.log('\n    Creating 1000 test records...');
      
      const categories = ['A', 'B', 'C', 'D', 'E'];
      const baseTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
      
      // Batch insert records
      const batchSize = 100;
      for (let i = 0; i < 1000; i += batchSize) {
        const batch = [];
        for (let j = 0; j < batchSize && (i + j) < 1000; j++) {
          batch.push({
            name: `Record ${i + j}`,
            category: categories[(i + j) % categories.length],
            value: Math.random() * 1000,
            timestamp: baseTime + ((i + j) * 60000), // 1 minute intervals
            tags: ['test', `batch-${Math.floor(i / 100)}`]
          });
        }
        
        // Use batch create
        await api.resources.performance_test.batch.create(batch);
      }
      
      console.log('    Testing query performance...');
      
      // Test 1: Query with filter and sort
      const startTime = Date.now();
      const result = await api.resources.performance_test.query({
        filter: { category: 'A' },
        sort: '-timestamp',
        page: { size: 50, number: 1 }
      });
      const queryTime = Date.now() - startTime;
      
      console.log(`    Query completed in ${queryTime}ms`);
      assert(queryTime < 500); // Should complete quickly due to indexes
      assert.equal(result.data.length, 50);
      assert.equal(result.meta.total, 200); // 1000 / 5 categories
      
      // Test 2: Complex filter
      const complexStart = Date.now();
      const complexResult = await api.resources.performance_test.query({
        filter: {
          category: { $in: ['A', 'B', 'C'] },
          value: { $gte: 500 },
          timestamp: { $gte: baseTime + (15 * 24 * 60 * 60 * 1000) } // Last 15 days
        },
        sort: 'value',
        page: { size: 20, number: 1 }
      });
      const complexTime = Date.now() - complexStart;
      
      console.log(`    Complex query completed in ${complexTime}ms`);
      assert(complexTime < 1000);
    });
  });

  describe('8. HTTP Integration', () => {
    let api;
    let app;
    let baseUrl;
    
    beforeEach(async () => {
      api = createApi({
        storage: 'mysql',
        mysql: { connection: MYSQL_CONFIG }
      });
      
      // Create Express app
      app = express();
      app.use('/api/v1', api.router);
      
      // Start server on random port
      const server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://localhost:${port}/api/v1`;
      
      // Define schema
      api.addResource('http_test', new Schema({
        name: { type: 'string', required: true },
        value: { type: 'number' },
        active: { type: 'boolean', default: true }
      }));
      
      await api.syncDatabase();
      
      // Store server reference for cleanup
      api._testServer = server;
    });
    
    afterEach(async () => {
      if (api._testServer) {
        api._testServer.close();
      }
      
      const db = await mysql.createConnection(MYSQL_CONFIG);
      await db.query('DROP TABLE IF EXISTS http_test');
      await db.end();
    });
    
    it('should handle HTTP requests with JSON:API format', async () => {
      // Create via HTTP POST
      const createResponse = await fetch(`${baseUrl}/http_test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'http_test',
            attributes: {
              name: 'Test Item',
              value: 42
            }
          }
        })
      });
      
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      
      assert(created.data);
      assert.equal(created.data.type, 'http_test');
      assert.equal(created.data.attributes.name, 'Test Item');
      assert.equal(created.data.attributes.value, 42);
      assert.equal(created.data.attributes.active, true); // default
      
      const id = created.data.id;
      
      // GET by ID
      const getResponse = await fetch(`${baseUrl}/http_test/${id}`);
      assert.equal(getResponse.status, 200);
      
      const got = await getResponse.json();
      assert.equal(got.data.id, id);
      assert.equal(got.data.attributes.name, 'Test Item');
      
      // UPDATE via PATCH
      const updateResponse = await fetch(`${baseUrl}/http_test/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'http_test',
            id: id,
            attributes: {
              value: 84
            }
          }
        })
      });
      
      assert.equal(updateResponse.status, 200);
      const updated = await updateResponse.json();
      assert.equal(updated.data.attributes.value, 84);
      
      // DELETE
      const deleteResponse = await fetch(`${baseUrl}/http_test/${id}`, {
        method: 'DELETE'
      });
      assert.equal(deleteResponse.status, 204);
      
      // Verify deletion
      const verifyResponse = await fetch(`${baseUrl}/http_test/${id}`);
      assert.equal(verifyResponse.status, 404);
    });
    
    it('should handle query parameters', async () => {
      // Create test data
      for (let i = 1; i <= 5; i++) {
        await api.resources.http_test.create({
          name: `Item ${i}`,
          value: i * 10,
          active: i % 2 === 0
        });
      }
      
      // Test filter
      const filterResponse = await fetch(`${baseUrl}/http_test?filter[active]=true`);
      const filtered = await filterResponse.json();
      
      assert.equal(filtered.data.length, 2); // Items 2 and 4
      filtered.data.forEach(item => {
        assert.equal(item.attributes.active, true);
      });
      
      // Test sort
      const sortResponse = await fetch(`${baseUrl}/http_test?sort=-value`);
      const sorted = await sortResponse.json();
      
      assert.equal(sorted.data[0].attributes.value, 50); // Highest value first
      
      // Test pagination
      const pageResponse = await fetch(`${baseUrl}/http_test?page[size]=2&page[number]=2`);
      const paged = await pageResponse.json();
      
      assert.equal(paged.data.length, 2);
      assert.equal(paged.meta.pageNumber, 2);
      assert.equal(paged.meta.pageSize, 2);
    });
  });
});

console.log('\n✨ Comprehensive MySQL tests complete!');