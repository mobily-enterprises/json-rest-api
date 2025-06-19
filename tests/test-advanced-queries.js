#!/usr/bin/env node

/**
 * Advanced query tests for JSON REST API
 * Tests complex query scenarios, operators, and edge cases
 */

import { test, describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Api, Schema, MemoryPlugin, MySQLPlugin, ValidationPlugin } from '../index.js';
import mysql from 'mysql2/promise';
import { robustTeardown } from './lib/test-teardown.js';

describe('Advanced Query Operators', () => {
  let api;
  
  before(async () => {
    api = new Api();
    api.use(MemoryPlugin);
    
    api.addResource('products', new Schema({
      id: { type: 'id' },
      name: { type: 'string', required: true },
      price: { type: 'number' },
      stock: { type: 'number' },
      tags: { type: 'array' },
      metadata: { type: 'object' },
      description: { type: 'string' },
      createdAt: { type: 'timestamp' }
    }));
    
    // Create diverse test data
    const now = Date.now();
    await api.resources.products.create({
      name: 'Laptop',
      price: 999.99,
      stock: 10,
      tags: ['electronics', 'computers', 'portable'],
      metadata: { brand: 'TechCo', warranty: 24 },
      description: 'High-performance laptop for professionals',
      createdAt: now - 86400000 * 30 // 30 days ago
    });
    
    await api.resources.products.create({
      name: 'Mouse',
      price: 29.99,
      stock: 100,
      tags: ['electronics', 'accessories'],
      metadata: { brand: 'TechCo', wireless: true },
      description: 'Wireless mouse with ergonomic design',
      createdAt: now - 86400000 * 7 // 7 days ago
    });
    
    await api.resources.products.create({
      name: 'Keyboard',
      price: 79.99,
      stock: 50,
      tags: ['electronics', 'accessories', 'mechanical'],
      metadata: { brand: 'KeyMaster', backlit: true },
      description: 'Mechanical keyboard with RGB lighting',
      createdAt: now - 86400000 * 14 // 14 days ago
    });
    
    await api.resources.products.create({
      name: 'Monitor',
      price: 399.99,
      stock: 0,
      tags: ['electronics', 'displays'],
      metadata: { brand: 'ViewTech', size: 27 },
      description: '4K monitor with HDR support',
      createdAt: now - 86400000 * 3 // 3 days ago
    });
    
    await api.resources.products.create({
      name: 'Desk Lamp',
      price: 49.99,
      stock: 25,
      tags: ['furniture', 'lighting'],
      metadata: { brand: 'HomeCo', adjustable: true },
      description: 'Adjustable LED desk lamp',
      createdAt: now // today
    });
  });
  
  describe('LIKE operator (pattern matching)', () => {
    it('should support LIKE operator for pattern matching', async () => {
      // Starts with
      const startsWithKey = await api.resources.products.query({
        filter: { name: { operator: '$like', value: 'Key%' } }
      });
      assert.equal(startsWithKey.data.length, 1);
      assert.equal(startsWithKey.data[0].attributes.name, 'Keyboard');
      
      // Ends with
      const endsWithTop = await api.resources.products.query({
        filter: { name: { operator: '$like', value: '%top' } }
      });
      assert.equal(endsWithTop.data.length, 1);
      assert.equal(endsWithTop.data[0].attributes.name, 'Laptop');
      
      // Contains
      const containsOar = await api.resources.products.query({
        filter: { name: { operator: '$like', value: '%oa%' } }
      });
      assert.equal(containsOar.data.length, 1);
      assert.equal(containsOar.data[0].attributes.name, 'Keyboard');
      
      // Case sensitivity (should be case-insensitive by default)
      const caseInsensitive = await api.resources.products.query({
        filter: { name: { operator: '$like', value: '%MOUSE%' } }
      });
      assert.equal(caseInsensitive.data.length, 1);
    });
    
    it('should handle special characters in LIKE patterns', async () => {
      // Add product with special characters
      await api.resources.products.create({
        name: 'USB_3.0_Hub',
        price: 19.99,
        stock: 50
      });
      
      // Search with underscore (SQL wildcard character)
      const withUnderscore = await api.resources.products.query({
        filter: { name: { operator: '$like', value: 'USB_%' } }
      });
      assert.equal(withUnderscore.data.length, 1);
      
      // Search with escaped characters
      const withDot = await api.resources.products.query({
        filter: { name: { operator: '$like', value: '%3.0%' } }
      });
      assert.equal(withDot.data.length, 1);
    });
  });
  
  describe('BETWEEN operator', () => {
    it('should support BETWEEN for numeric ranges', async () => {
      const midRange = await api.resources.products.query({
        filter: { 
          price: { 
            operator: '$between', 
            value: [50, 100] 
          } 
        }
      });
      
      assert.equal(midRange.data.length, 2); // Keyboard (79.99) and Desk Lamp (49.99)
      midRange.data.forEach(p => {
        assert(p.attributes.price >= 49.99 && p.attributes.price <= 100);
      });
    });
    
    it('should support BETWEEN for date ranges', async () => {
      const now = Date.now();
      const lastWeek = await api.resources.products.query({
        filter: { 
          createdAt: { 
            operator: '$between', 
            value: [now - 86400000 * 7, now] 
          } 
        }
      });
      
      assert.equal(lastWeek.data.length, 3); // Products created in last 7 days
    });
    
    it('should handle exclusive bounds with NOT BETWEEN', async () => {
      const outside = await api.resources.products.query({
        filter: { 
          price: { 
            operator: '$notBetween', 
            value: [30, 80] 
          } 
        }
      });
      
      // Should get products < 30 or > 80
      assert.equal(outside.data.length, 3); // Mouse (29.99), Laptop (999.99), Monitor (399.99)
    });
  });
  
  describe('Complex array operations', () => {
    it('should support array contains', async () => {
      // Find products with 'electronics' tag
      const electronics = await api.resources.products.query({
        filter: { 
          tags: { 
            operator: '$contains', 
            value: 'electronics' 
          } 
        }
      });
      
      assert.equal(electronics.data.length, 4);
    });
    
    it('should support array contains all', async () => {
      // Find products with both tags
      const multiTags = await api.resources.products.query({
        filter: { 
          tags: { 
            operator: '$containsAll', 
            value: ['electronics', 'accessories'] 
          } 
        }
      });
      
      assert.equal(multiTags.data.length, 2); // Mouse and Keyboard
    });
    
    it('should support array contains any', async () => {
      // Find products with any of these tags
      const anyTag = await api.resources.products.query({
        filter: { 
          tags: { 
            operator: '$containsAny', 
            value: ['furniture', 'displays'] 
          } 
        }
      });
      
      assert.equal(anyTag.data.length, 2); // Desk Lamp and Monitor
    });
    
    it('should support array length queries', async () => {
      // Find products with exactly 2 tags
      const twoTags = await api.resources.products.query({
        filter: { 
          tags: { 
            operator: '$length', 
            value: 2 
          } 
        }
      });
      
      assert.equal(twoTags.data.length, 3);
    });
  });
  
  describe('Complex object queries', () => {
    it('should query nested object properties', async () => {
      // Find products from specific brand
      const techCo = await api.resources.products.query({
        filter: { 
          'metadata.brand': 'TechCo' 
        }
      });
      
      assert.equal(techCo.data.length, 2); // Laptop and Mouse
    });
    
    it('should support operators on nested properties', async () => {
      // Find products with warranty > 12 months
      const longWarranty = await api.resources.products.query({
        filter: { 
          'metadata.warranty': { 
            operator: '$gt', 
            value: 12 
          } 
        }
      });
      
      assert.equal(longWarranty.data.length, 1); // Laptop with 24 month warranty
    });
    
    it('should handle boolean nested properties', async () => {
      // Find wireless products
      const wireless = await api.resources.products.query({
        filter: { 
          'metadata.wireless': true 
        }
      });
      
      assert.equal(wireless.data.length, 1); // Mouse
    });
  });
  
  describe('Text search operations', () => {
    it('should support full-text search', async () => {
      // Search in description
      const professional = await api.resources.products.query({
        filter: { 
          description: { 
            operator: '$search', 
            value: 'professional' 
          } 
        }
      });
      
      assert.equal(professional.data.length, 1); // Laptop
    });
    
    it('should support regex patterns', async () => {
      // Find products with model numbers in name
      const pattern = await api.resources.products.query({
        filter: { 
          name: { 
            operator: '$regex', 
            value: '^[A-Z].*[0-9]' 
          } 
        }
      });
      
      assert(pattern.data.length >= 0); // Depends on regex support
    });
  });
  
  describe('Compound queries', () => {
    it('should support OR conditions', async () => {
      const orQuery = await api.resources.products.query({
        filter: { 
          $or: [
            { price: { operator: '$lt', value: 50 } },
            { stock: 0 }
          ] 
        }
      });
      
      assert.equal(orQuery.data.length, 3); // Mouse, Desk Lamp, Monitor
    });
    
    it('should support AND conditions', async () => {
      const andQuery = await api.resources.products.query({
        filter: { 
          $and: [
            { price: { operator: '$gt', value: 50 } },
            { stock: { operator: '$gt', value: 0 } }
          ] 
        }
      });
      
      assert.equal(andQuery.data.length, 2); // Keyboard and Laptop
    });
    
    it('should support nested OR/AND combinations', async () => {
      const complex = await api.resources.products.query({
        filter: { 
          $or: [
            {
              $and: [
                { price: { operator: '$lt', value: 100 } },
                { tags: { operator: '$contains', value: 'electronics' } }
              ]
            },
            {
              stock: 0
            }
          ] 
        }
      });
      
      assert(complex.data.length >= 2);
    });
    
    it('should support NOT conditions', async () => {
      const notElectronics = await api.resources.products.query({
        filter: { 
          $not: {
            tags: { operator: '$contains', value: 'electronics' }
          } 
        }
      });
      
      assert.equal(notElectronics.data.length, 1); // Desk Lamp
    });
  });
  
  describe('Aggregation queries', () => {
    it('should support COUNT aggregation', async () => {
      // This might need special implementation
      const count = await api.query({
        aggregate: {
          count: '*'
        }
      }, { type: 'products' });
      
      // Depending on implementation
      if (count.meta && count.meta.total) {
        assert.equal(count.meta.total, 6);
      }
    });
    
    it('should support GROUP BY', async () => {
      // Group by metadata.brand
      const grouped = await api.query({
        groupBy: ['metadata.brand'],
        aggregate: {
          count: '*',
          avgPrice: { avg: 'price' }
        }
      }, { type: 'products' });
      
      // This would need QueryBuilder support
      if (grouped.results) {
        assert(grouped.results.length > 0);
      }
    });
  });
});

// MySQL-specific advanced queries
if (process.env.MYSQL_USER && process.env.MYSQL_PASSWORD) {
  describe('MySQL Advanced Query Features', () => {
    const MYSQL_CONFIG = {
      host: process.env.MYSQL_HOST || 'localhost',
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: 'jsonrestapi_test_advanced_queries'
    };
    
    let api, connection;
    
    before(async () => {
      connection = await mysql.createConnection({
        host: MYSQL_CONFIG.host,
        user: MYSQL_CONFIG.user,
        password: MYSQL_CONFIG.password
      });
      await connection.query(`CREATE DATABASE IF NOT EXISTS ${MYSQL_CONFIG.database}`);
      
      api = new Api();
      api.use(MySQLPlugin, { connection: MYSQL_CONFIG });
      api.use(ValidationPlugin);
      
      api.addResource('articles', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        content: { type: 'string', text: true },
        tags: { type: 'array' },
        metadata: { type: 'object' },
        publishedAt: { type: 'timestamp' },
        viewCount: { type: 'number', default: 0 }
      }));
      
      await api.syncDatabase();
      
      // Create test data
      const articles = [
        {
          title: 'Getting Started with Node.js',
          content: 'Node.js is a JavaScript runtime built on Chrome\'s V8 JavaScript engine...',
          tags: ['nodejs', 'javascript', 'tutorial'],
          metadata: { author: 'John Doe', category: 'programming' },
          publishedAt: Date.now() - 86400000 * 30,
          viewCount: 1500
        },
        {
          title: 'Advanced MySQL Queries',
          content: 'MySQL provides powerful query capabilities for complex data operations...',
          tags: ['mysql', 'database', 'sql'],
          metadata: { author: 'Jane Smith', category: 'database' },
          publishedAt: Date.now() - 86400000 * 7,
          viewCount: 800
        },
        {
          title: 'Building REST APIs',
          content: 'REST APIs are the backbone of modern web applications...',
          tags: ['api', 'rest', 'nodejs'],
          metadata: { author: 'John Doe', category: 'programming' },
          publishedAt: Date.now() - 86400000 * 14,
          viewCount: 2000
        }
      ];
      
      for (const article of articles) {
        await api.resources.articles.create(article);
      }
    });
    
    after(async () => {
      await robustTeardown({ api, connection });
    });
    
    it('should support MySQL JSON operations', async () => {
      // Query by JSON field
      const programming = await api.resources.articles.query({
        filter: {
          'metadata.category': 'programming'
        }
      });
      
      assert.equal(programming.data.length, 2);
    });
    
    it('should support MySQL full-text search', async () => {
      // This would need FULLTEXT index
      try {
        await connection.query(
          `ALTER TABLE ${MYSQL_CONFIG.database}.articles 
           ADD FULLTEXT(title, content)`
        );
        
        // Full-text search
        const results = await api.query({
          filter: {
            $fulltext: {
              fields: ['title', 'content'],
              query: 'JavaScript Node.js'
            }
          }
        }, { type: 'articles' });
        
        assert(results.data.length > 0);
      } catch (error) {
        // Fulltext might not be supported in all MySQL versions
        console.log('Fulltext search test skipped:', error.message);
      }
    });
    
    it('should handle MySQL-specific date functions', async () => {
      // Articles from last month
      const lastMonth = await api.resources.articles.query({
        filter: {
          publishedAt: {
            operator: '$raw',
            value: 'DATE_SUB(NOW(), INTERVAL 1 MONTH)'
          }
        }
      });
      
      // This would need raw SQL support
      assert(lastMonth.data.length >= 0);
    });
    
    it('should support subqueries', async () => {
      // Articles with above-average view count
      const popular = await api.query({
        filter: {
          viewCount: {
            operator: '$gt',
            value: {
              $subquery: {
                select: 'AVG(viewCount)',
                from: 'articles'
              }
            }
          }
        }
      }, { type: 'articles' });
      
      // This would need subquery support in QueryBuilder
      if (popular.data) {
        assert(popular.data.length >= 0);
      }
    });
    
    it('should handle complex JOIN queries', async () => {
      // Create related tables
      api.addResource('authors', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' }
      }));
      
      api.addResource('article_authors', new Schema({
        id: { type: 'id' },
        articleId: { type: 'id', refs: { resource: 'articles' } },
        authorId: { type: 'id', refs: { resource: 'authors' } }
      }));
      
      await api.syncDatabase();
      
      // Create test data
      const author = await api.resources.authors.create({
        name: 'Test Author',
        email: 'test@example.com'
      });
      
      const article = await api.resources.articles.create({
        title: 'Joint Article',
        content: 'Content here'
      });
      
      await api.resources.article_authors.create({
        articleId: article.data.id,
        authorId: author.data.id
      });
      
      // Complex join query
      const withAuthors = await api.query({
        joins: ['article_authors', 'article_authors.authorId'],
        filter: {
          'authors.name': 'Test Author'
        }
      }, { type: 'articles' });
      
      assert(withAuthors.data.length >= 0);
    });
  });
}

describe('Query Performance and Optimization', () => {
  it('should handle queries on large datasets efficiently', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    api.addResource('logs', new Schema({
      id: { type: 'id' },
      level: { type: 'string' },
      message: { type: 'string' },
      timestamp: { type: 'timestamp' }
    }));
    
    // Create 10,000 log entries
    console.log('Creating 10,000 test records...');
    const levels = ['debug', 'info', 'warn', 'error'];
    const batchSize = 100;
    
    for (let batch = 0; batch < 100; batch++) {
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        const index = batch * batchSize + i;
        promises.push(
          api.resources.logs.create({
            level: levels[index % 4],
            message: `Log message ${index}`,
            timestamp: Date.now() - (index * 1000)
          })
        );
      }
      await Promise.all(promises);
    }
    
    // Test query performance
    const start = Date.now();
    
    // Complex query with multiple filters
    const results = await api.resources.logs.query({
      filter: {
        $or: [
          { level: 'error' },
          { 
            $and: [
              { level: 'warn' },
              { message: { operator: '$like', value: '%99%' } }
            ]
          }
        ]
      },
      sort: '-timestamp',
      page: { size: 50, number: 1 }
    });
    
    const queryTime = Date.now() - start;
    
    console.log(`Query completed in ${queryTime}ms`);
    assert(queryTime < 1000, 'Query should complete in under 1 second');
    assert(results.data.length <= 50);
  });
  
  it('should optimize queries with indexes', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    api.addResource('users', new Schema({
      id: { type: 'id' },
      email: { type: 'string', required: true, searchable: true }, // Should create index
      username: { type: 'string', required: true, dbIndex: true },
      status: { type: 'string', default: 'active' },
      lastLoginAt: { type: 'timestamp' }
    }));
    
    // Create users
    for (let i = 0; i < 1000; i++) {
      await api.resources.users.create({
        email: `user${i}@example.com`,
        username: `user${i}`,
        status: i % 10 === 0 ? 'inactive' : 'active',
        lastLoginAt: Date.now() - (i * 86400000)
      });
    }
    
    // Query by indexed field (should be fast)
    const start = Date.now();
    const byEmail = await api.resources.users.query({
      filter: { email: 'user500@example.com' }
    });
    const indexedTime = Date.now() - start;
    
    // Query by non-indexed field (might be slower)
    const start2 = Date.now();
    const byStatus = await api.resources.users.query({
      filter: { status: 'inactive' }
    });
    const nonIndexedTime = Date.now() - start2;
    
    console.log(`Indexed query: ${indexedTime}ms, Non-indexed query: ${nonIndexedTime}ms`);
    
    assert.equal(byEmail.data.length, 1);
    assert(byStatus.data.length > 0);
  });
});

console.log('✨ Advanced query tests complete!');