import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument,
  assertResourceAttributes
} from './helpers/test-utils.js';
import { Api } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across ALL tests
let api;

describe('Virtual Fields Tests', () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Create a custom API with virtual fields
    api = new Api({
      name: 'virtual-fields-test',
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      simplifiedApi: false,
      simplifiedTransport: false,
      returnRecordApi: {
        post: 'full',
        put: 'full',
        patch: 'full'
      }
    });
    await api.use(RestApiKnexPlugin, { knex });
    
    // Add a resource with virtual fields
    await api.addResource('users', {
      schema: {
        id: { type: 'id' },
        username: { type: 'string', required: true },
        email: { type: 'string', required: true },
        password: { type: 'string', required: true, hidden: true },
        passwordConfirmation: { type: 'string', virtual: true },
        termsAccepted: { type: 'boolean', virtual: true }
      }
    });
    
    // Create table
    await api.resources.users.createKnexTable();
  });
  
  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Always destroy knex connection to allow tests to exit
    await knex.destroy();
  });
  
  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables - list ALL tables your tests use
    await cleanTables(knex, ['users']);
  });

  describe('Virtual field validation', () => {
    it('should accept virtual fields in POST request', async () => {
      const doc = createJsonApiDocument('users', {
        username: 'testuser',
        email: 'test@example.com',
        password: 'secret123',
        passwordConfirmation: 'secret123',
        termsAccepted: true
      });
      
      const result = await api.resources.users.post({
        inputRecord: doc,
        simplified: false
      });
      
      // Validate response structure - POST returns single resource, not array
      validateJsonApiStructure(result);
      assert.equal(result.data.type, 'users');
      assert.ok(result.data.id);
      
      // Virtual fields should be returned in response
      assertResourceAttributes(result.data, {
        username: 'testuser',
        email: 'test@example.com',
        passwordConfirmation: 'secret123',
        termsAccepted: true
      });
      
      // Password should NOT be in response (security)
      assert.ok(!('password' in result.data.attributes));
    });
    
    it('should not store virtual fields in database', async () => {
      const doc = createJsonApiDocument('users', {
        username: 'testuser2',
        email: 'test2@example.com',
        password: 'secret456',
        passwordConfirmation: 'secret456',
        termsAccepted: false
      });
      
      const createResult = await api.resources.users.post({
        inputRecord: doc,
        simplified: false
      });
      
      // Verify data was created
      const userId = createResult.data.id;
      
      // Check database directly - virtual fields should not be stored
      const dbRecord = await knex('users').where('id', userId).first();
      assert.ok(dbRecord);
      assert.equal(dbRecord.username, 'testuser2');
      assert.equal(dbRecord.email, 'test2@example.com');
      assert.ok(dbRecord.password); // Password is stored
      
      // Virtual fields should NOT exist in database
      assert.ok(!('passwordConfirmation' in dbRecord));
      assert.ok(!('termsAccepted' in dbRecord));
    });
    
    it('should handle virtual fields in PATCH request', async () => {
      // Create a user first
      const createDoc = createJsonApiDocument('users', {
        username: 'patchuser',
        email: 'patch@example.com',
        password: 'oldpassword'
      });
      
      const createResult = await api.resources.users.post({
        inputRecord: createDoc,
        simplified: false
      });
      
      const userId = createResult.data.id;
      
      // Update with virtual field
      const patchDoc = {
        data: {
          type: 'users',
          id: userId,
          attributes: {
            password: 'newpassword',
            passwordConfirmation: 'newpassword'
          }
        }
      };
      
      const patchResult = await api.resources.users.patch({
        id: userId,
        inputRecord: patchDoc,
        simplified: false
      });
      
      // Virtual field should be in response
      assert.equal(patchResult.data.attributes.passwordConfirmation, 'newpassword');
      
      // Check database - passwordConfirmation should not be stored
      const dbRecord = await knex('users').where('id', userId).first();
      assert.ok(!('passwordConfirmation' in dbRecord));
    });
    
    it('should respect sparse fieldsets with virtual fields on PATCH', async () => {
      // Create a user first
      const createDoc = createJsonApiDocument('users', {
        username: 'sparseuser',
        email: 'sparse@example.com',
        password: 'password123'
      });
      
      const createResult = await api.resources.users.post({
        inputRecord: createDoc,
        simplified: false
      });
      
      const userId = createResult.data.id;
      
      // Update with virtual field and request specific fields in response
      const patchDoc = {
        data: {
          type: 'users',
          id: userId,
          attributes: {
            email: 'newemail@example.com',
            passwordConfirmation: 'password123'
          }
        }
      };
      
      const patchResult = await api.resources.users.patch({
        id: userId,
        inputRecord: patchDoc,
        queryParams: {
          fields: {
            users: 'email,passwordConfirmation'
          }
        },
        simplified: false
      });
      
      // Should only have requested fields
      assert.equal(Object.keys(patchResult.data.attributes).length, 2);
      assert.equal(patchResult.data.attributes.email, 'newemail@example.com');
      assert.equal(patchResult.data.attributes.passwordConfirmation, 'password123');
      
      // Other fields should not be present
      assert.ok(!('username' in patchResult.data.attributes));
    });
    
    it('should exclude virtual fields when not requested in sparse fieldsets', async () => {
      // Create a user
      const doc = createJsonApiDocument('users', {
        username: 'excludeuser',
        email: 'exclude@example.com',
        password: 'password123',
        passwordConfirmation: 'password123',
        termsAccepted: true
      });
      
      const createResult = await api.resources.users.post({
        inputRecord: doc,
        simplified: false
      });
      
      const userId = createResult.data.id;
      
      // Fetch with sparse fieldsets NOT including virtual fields
      const getResult = await api.resources.users.get({
        id: userId,
        queryParams: {
          fields: {
            users: 'username,email'
          }
        },
        simplified: false
      });
      
      // Should only have requested fields
      assert.equal(Object.keys(getResult.data.attributes).length, 2);
      assert.equal(getResult.data.attributes.username, 'excludeuser');
      assert.equal(getResult.data.attributes.email, 'exclude@example.com');
      
      // Virtual fields should not be present
      assert.ok(!('passwordConfirmation' in getResult.data.attributes));
      assert.ok(!('termsAccepted' in getResult.data.attributes));
    });
    
    it('should handle PUT requests with virtual fields', async () => {
      // Create initial record
      const createDoc = createJsonApiDocument('users', {
        username: 'putuser',
        email: 'put@example.com',
        password: 'initialpass'
      });
      
      const createResult = await api.resources.users.post({
        inputRecord: createDoc,
        simplified: false
      });
      
      const userId = createResult.data.id;
      
      // Replace entire record with PUT, including virtual fields
      const putDoc = {
        data: {
          type: 'users',
          id: userId,
          attributes: {
            username: 'updateduser',
            email: 'updated@example.com',
            password: 'newpass',
            passwordConfirmation: 'newpass',
            termsAccepted: false
          }
        }
      };
      
      const putResult = await api.resources.users.put({
        id: userId,
        inputRecord: putDoc,
        simplified: false
      });
      
      // Virtual fields should be in response
      assertResourceAttributes(putResult.data, {
        username: 'updateduser',
        email: 'updated@example.com',
        passwordConfirmation: 'newpass',
        termsAccepted: false
      });
      
      // Check database - virtual fields should not be stored
      const dbRecord = await knex('users').where('id', userId).first();
      assert.equal(dbRecord.username, 'updateduser');
      assert.equal(dbRecord.email, 'updated@example.com');
      assert.ok(!('passwordConfirmation' in dbRecord));
      assert.ok(!('termsAccepted' in dbRecord));
    });
  });
  
  describe('Virtual fields vs computed fields', () => {
    before(async () => {
      // Add a resource with both virtual and computed fields
      await api.addResource('products', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true },
          price: { type: 'number', required: true },
          cost: { type: 'number', required: true, normallyHidden: true },
          priceInCents: { type: 'number', virtual: true },
          discountCode: { type: 'string', virtual: true },
          profitMargin: {
            type: 'number',
            computed: true,
            dependencies: ['price', 'cost'],
            compute: ({ attributes }) => {
              if (!attributes.price || !attributes.cost) return null;
              return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
            }
          }
        }
      });
      
      await api.resources.products.createKnexTable();
    });
    
    beforeEach(async () => {
      await cleanTables(knex, ['products']);
    });
    
    it('should handle both virtual and computed fields correctly', async () => {
      // Create product with virtual fields
      const doc = createJsonApiDocument('products', {
        name: 'Test Product',
        price: 100,
        cost: 60,
        priceInCents: 10000,
        discountCode: 'SAVE20'
      });
      
      const result = await api.resources.products.post({
        inputRecord: doc,
        simplified: false
      });
      
      // Check response
      assertResourceAttributes(result.data, {
        name: 'Test Product',
        price: 100,
        profitMargin: '40.00', // Computed field
        priceInCents: 10000,   // Virtual field
        discountCode: 'SAVE20' // Virtual field
      });
      
      // Cost should not be in response (normallyHidden)
      assert.ok(!('cost' in result.data.attributes));
      
      // Check database
      const dbRecord = await knex('products').where('id', result.data.id).first();
      assert.equal(dbRecord.name, 'Test Product');
      assert.equal(dbRecord.price, 100);
      assert.equal(dbRecord.cost, 60); // Cost is stored in DB
      
      // Neither virtual nor computed fields should be in DB
      assert.ok(!('profitMargin' in dbRecord));
      assert.ok(!('priceInCents' in dbRecord));
      assert.ok(!('discountCode' in dbRecord));
    });
    
    it('should calculate computed fields regardless of input', async () => {
      // Create product without trying to set computed field
      const doc = createJsonApiDocument('products', {
        name: 'Test Product 2',
        price: 200,
        cost: 50
      });
      
      const result = await api.resources.products.post({
        inputRecord: doc,
        simplified: false
      });
      
      // Computed field should have calculated value
      assert.equal(result.data.attributes.profitMargin, '75.00');
      
      // Virtual fields were not provided, so they shouldn't be in response
      assert.ok(!('priceInCents' in result.data.attributes));
      assert.ok(!('discountCode' in result.data.attributes));
    });
  });
});