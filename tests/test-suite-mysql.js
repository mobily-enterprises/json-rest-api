#!/usr/bin/env node

/**
 * MySQL-specific test suite for JSON REST API
 * Tests features that require MySQL plugin (joins, etc.)
 * 
 * Run with: node test-suite-mysql.js
 * 
 * Note: Requires MySQL server running with appropriate test database
 */

import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';

import assert from 'node:assert/strict';
import { 
  Api, 
  Schema, 
  MySQLPlugin,
  ValidationPlugin,
  TimestampsPlugin
} from '../index.js';

import { robustTeardown } from './lib/test-teardown.js';


// MySQL credentials must be provided via environment variables
if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
  console.error('❌ MySQL credentials not provided!');
  console.error('   Please set environment variables:');
  console.error('   MYSQL_USER=<username> MYSQL_PASSWORD=<password>');
  console.error('   Optional: MYSQL_HOST=<host> MYSQL_DATABASE=<database>');
  console.error('');
  console.error('   Example: MYSQL_USER=root MYSQL_PASSWORD=mypass npm run test:mysql');
  process.exit(1);
}

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'jsonrestapi_test'
};

describe('MySQL Plugin Tests', () => {
  let api;
  let connection;
  
  before(async () => {
    // Try to connect to MySQL
    try {
      const mysql = await import('mysql2/promise');
      connection = await mysql.createConnection({
        host: MYSQL_CONFIG.host,
        user: MYSQL_CONFIG.user,
        password: MYSQL_CONFIG.password
      });
      
      // Create test database
      await connection.query(`DROP DATABASE IF EXISTS ${MYSQL_CONFIG.database}`);
      await connection.query(`CREATE DATABASE ${MYSQL_CONFIG.database}`);
      await connection.query(`USE ${MYSQL_CONFIG.database}`);
      
      console.log(`✓ Connected to MySQL as ${MYSQL_CONFIG.user}@${MYSQL_CONFIG.host}`);
      console.log(`✓ Created test database: ${MYSQL_CONFIG.database}`);
      
    } catch (error) {
      console.error('❌ MySQL connection failed:', error.message);
      console.error('   Please check your credentials and ensure MySQL is running.');
      process.exit(1);
    }
  });
  
  after(async () => {
    await robustTeardown({ api, connection });
  });
  
  describe('Advanced Refs (Joins) with MySQL', () => {
    beforeEach(async () => {
      // Clean up any existing tables
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query('DROP TABLE IF EXISTS projects');
      await connection.query('DROP TABLE IF EXISTS categories');
      await connection.query('DROP TABLE IF EXISTS users');
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      
      // Create fresh API instance
      api = new Api();
      api.use(MySQLPlugin, { connection: MYSQL_CONFIG });
      api.use(ValidationPlugin);
      
      // Define schemas
      const userSchema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        avatar: { type: 'string' },
        bio: { type: 'string', text: true },
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
        description: { type: 'string', text: true },
        
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
      
      // Use syncDatabase to create tables with proper schema
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      // Clean up data after each test
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query('DELETE FROM projects');
      await connection.query('DELETE FROM categories');
      await connection.query('DELETE FROM users');
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    });
    
    async function seedTestData() {
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
        avatar: 'jane.jpg'
      });
      
      // Create categories
      const cat1 = await api.resources.categories.create({
        name: 'Technology',
        slug: 'tech',
        color: 'blue'
      });
      
      // Create project
      const project = await api.resources.projects.create({
        title: 'Test Project',
        description: 'A test project',
        ownerId: user1.data.id,
        categoryId: cat1.data.id,
        createdById: user2.data.id
      });
      
      return { user1, user2, cat1, project };
    }
    
    it('should handle eager joins automatically', async () => {
      const { project } = await seedTestData();
      
      const result = await api.resources.projects.get(project.data.id);
      
      // ownerId should be replaced with object
      assert(typeof result.data.attributes.ownerId === 'object');
      assert.equal(result.data.attributes.ownerId.name, 'John Doe');
      assert.equal(result.data.attributes.ownerId.email, 'john@example.com');
      assert(!result.data.attributes.ownerId.secretKey); // Silent field excluded
    });
    
    it('should handle lazy joins with explicit request', async () => {
      const { project } = await seedTestData();
      
      // Without join
      const result1 = await api.resources.projects.get(project.data.id);
      assert(typeof result1.data.attributes.categoryId === 'number');
      assert(!result1.data.attributes.category);
      
      // With join
      const result2 = await api.resources.projects.get(project.data.id, {
        joins: ['categoryId']
      });
      assert(typeof result2.data.attributes.categoryId === 'number'); // ID preserved
      assert(result2.data.attributes.category); // Data in resourceField
      assert.equal(result2.data.attributes.category.name, 'Technology');
    });
    
    it('should handle preserveId option', async () => {
      const { project } = await seedTestData();
      
      const result = await api.resources.projects.get(project.data.id);
      
      // createdById should remain as ID
      assert(typeof result.data.attributes.createdById === 'number');
      // Data should be in derived field
      assert(result.data.attributes.createdBy);
      assert.equal(result.data.attributes.createdBy.name, 'Jane Smith');
    });
    
    it('should work with query operations', async () => {
      await seedTestData();
      
      const results = await api.resources.projects.query({
        joins: ['categoryId']
      });
      
      assert(results.data.length > 0);
      const project = results.data[0];
      
      // Eager joins should work
      assert(typeof project.attributes.ownerId === 'object');
      // Requested lazy join should work
      assert(project.attributes.category);
    });
  });
  
  describe('Nested Joins with MySQL', () => {
    beforeEach(async () => {
      // Clean up any existing tables
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query('DROP TABLE IF EXISTS people');
      await connection.query('DROP TABLE IF EXISTS puppies');
      await connection.query('DROP TABLE IF EXISTS countries');
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      
      // Create fresh API instance
      api = new Api();
      api.use(MySQLPlugin, { connection: MYSQL_CONFIG });
      api.use(ValidationPlugin);
      
      // Define schemas
      const countrySchema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        code: { type: 'string', required: true },
        continent: { type: 'string' }
      });
      
      const puppySchema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        breed: { type: 'string' },
        age: { type: 'number' },
        
        countryId: {
          type: 'id',
          refs: {
            resource: 'countries',
            join: {
              eager: false,
              fields: ['id', 'name', 'code']
            }
          }
        }
      });
      
      const personSchema = new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        
        puppyId: {
          type: 'id',
          refs: {
            resource: 'puppies',
            join: {
              eager: true,
              fields: ['id', 'name', 'breed', 'age']
            }
          }
        },
        
        workCountryId: {
          type: 'id',
          refs: {
            resource: 'countries',
            join: {
              eager: false,
              resourceField: 'workCountry',
              fields: ['id', 'name']
            }
          }
        }
      });
      
      api.addResource('countries', countrySchema);
      api.addResource('puppies', puppySchema);
      api.addResource('people', personSchema);
      
      // Use syncDatabase to create tables with proper schema
      await api.syncDatabase();
    });
    
    afterEach(async () => {
      // Clean up data after each test
      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      await connection.query('DELETE FROM people');
      await connection.query('DELETE FROM puppies');
      await connection.query('DELETE FROM countries');
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    });
    
    async function seedNestedData() {
      const usa = await api.resources.countries.create({
        name: 'United States',
        code: 'US',
        continent: 'North America'
      });
      
      const uk = await api.resources.countries.create({
        name: 'United Kingdom',
        code: 'UK',
        continent: 'Europe'
      });
      
      const buddy = await api.resources.puppies.create({
        name: 'Buddy',
        breed: 'Golden Retriever',
        age: 3,
        countryId: usa.data.id
      });
      
      const john = await api.resources.people.create({
        name: 'John Doe',
        email: 'john@example.com',
        puppyId: buddy.data.id,
        workCountryId: uk.data.id
      });
      
      return { usa, uk, buddy, john };
    }
    
    it('should handle nested join paths', async () => {
      const { john } = await seedNestedData();
      
      const result = await api.resources.people.get(john.data.id, {
        joins: ['puppyId.countryId']
      });
      
      // Check structure
      assert(typeof result.data.attributes.puppyId === 'object');
      assert.equal(result.data.attributes.puppyId.name, 'Buddy');
      assert(typeof result.data.attributes.puppyId.countryId === 'object');
      assert.equal(result.data.attributes.puppyId.countryId.name, 'United States');
      assert.equal(result.data.attributes.puppyId.countryId.code, 'US');
    });
    
    it('should handle multiple nested paths', async () => {
      const { john } = await seedNestedData();
      
      const result = await api.resources.people.get(john.data.id, {
        joins: ['puppyId.countryId', 'workCountryId']
      });
      
      assert(result.data.attributes.puppyId.countryId);
      assert(result.data.attributes.workCountry);
      assert.equal(result.data.attributes.workCountry.name, 'United Kingdom');
    });
  });
});

console.log('🧪 Running MySQL-specific test suite...\n');
console.log('Note: This requires a running MySQL server\n');
