import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createFieldSettersApi } from './fixtures/api-configs.js';
import { cleanTables } from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across tests
let api;

describe('Field Setters', () => {
  before(async () => {
    // Initialize API once
    api = await createFieldSettersApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('Basic Field Transformations', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_users']);
    });

    it('should apply simple setter transformations on create', async () => {
      // Create user with data that needs transformation
      const user = await api.resources.users.post({
        email: '  USER@EXAMPLE.COM  ',
        username: '  JohnDoe  ',
        tags: 'tag1,tag2,tag3',  // Pass as string
        preferences: '{"theme":"dark","notifications":true}'  // Pass as JSON string
      });

      // Get the user to verify setters were applied
      const fetchedUser = await api.resources.users.get({ id: user.id });
      
      // The setters transformed the data before storage
      assert.equal(fetchedUser.email, 'user@example.com');
      assert.equal(fetchedUser.username, 'johndoe');
      assert.equal(fetchedUser.tags, 'tag1,tag2,tag3');
      assert.equal(fetchedUser.preferences, '{"theme":"dark","notifications":true}');
    });

    it('should apply setter transformations on update (PUT)', async () => {
      // Create initial user
      const user = await api.resources.users.post({
        email: 'original@example.com',
        username: 'originaluser',
        tags: 'old',
        preferences: '{"theme":"light"}'
      });

      // Update with PUT
      await api.resources.users.put({
        id: user.id,
        email: '  UPDATED@EXAMPLE.COM  ',
        username: '  UpdatedUser  ',
        tags: 'new1,new2',
        preferences: '{"theme":"dark","lang":"en"}'
      });

      // Get the user to verify setters were applied
      const updatedUser = await api.resources.users.get({ id: user.id });
      assert.equal(updatedUser.email, 'updated@example.com');
      assert.equal(updatedUser.username, 'updateduser');
      assert.equal(updatedUser.tags, 'new1,new2');
      assert.equal(updatedUser.preferences, '{"theme":"dark","lang":"en"}');
    });

    it('should apply setter transformations on partial update (PATCH)', async () => {
      // Create initial user
      const user = await api.resources.users.post({
        email: 'original@example.com',
        username: 'originaluser',
        tags: 'old',
        preferences: '{"theme":"light"}'
      });

      // Update only email with PATCH
      await api.resources.users.patch({
        id: user.id,
        email: '  PATCHED@EXAMPLE.COM  '
      });

      // Get the user to verify setter was applied only to patched field
      const patchedUser = await api.resources.users.get({ id: user.id });
      assert.equal(patchedUser.email, 'patched@example.com');
      assert.equal(patchedUser.username, 'originaluser'); // Unchanged
    });
  });

  describe('Type Conversion Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_products']);
    });

    it('should apply type conversion setters after validation', async () => {
      const product = await api.resources.products.post({
        name: 'Test Product',
        price: 99.999,  // Will be rounded to cents
        discount_percent: 15.678,  // Will be rounded to integer
        metadata: { key: 'value' }  // Will be stringified
      });

      // Get the product to verify setters were applied
      const fetchedProduct = await api.resources.products.get({ id: product.id });
      assert.equal(fetchedProduct.price, 10000); // 99.999 * 100 rounded = 10000 cents
      assert.equal(fetchedProduct.discount_percent, 16); // 15.678 rounded
      assert.equal(fetchedProduct.metadata, '{"key":"value"}');
    });
  });

  describe('Async Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_secure']);
    });

    it('should support async setter functions', async () => {
      const record = await api.resources.secure_data.post({
        password: 'mysecretpassword',
        api_key: 'test-key-123',
        data: 'sensitive information'
      });

      console.log('**********************************************')
      console.log(record)
      // Check if record has id
      assert.ok(record.id, 'Record should have an id');

      // Get the record to verify async setters were applied
      const fetchedRecord = await api.resources.secure_data.get({ id: record.id });
      
      // Password should be hashed (mock hash)
      assert.equal(fetchedRecord.password, 'hashed:mysecretpassword');
      
      // API key should be encrypted (base64)
      assert.equal(fetchedRecord.api_key, Buffer.from('test-key-123').toString('base64'));
      
      // Data should be encrypted
      assert.equal(fetchedRecord.data, Buffer.from('sensitive information').toString('base64'));
    });
  });

  describe('Setter Dependencies', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_computed']);
    });

    it('should apply setters in dependency order', async () => {
      const data = await api.resources.computed_data.post({
        base_value: 100,
        multiplier: 2,
        adjustment: 10
        // calculated_value depends on base_value and multiplier
        // final_value depends on calculated_value and adjustment
      });

      const fetchedData = await api.resources.computed_data.get({ id: data.id });
      assert.equal(fetchedData.base_value, 100);
      assert.equal(fetchedData.multiplier, 2);
      assert.equal(fetchedData.adjustment, 10);
      assert.equal(fetchedData.calculated_value, 200); // 100 * 2
      assert.equal(fetchedData.final_value, 210); // 200 + 10
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_users']);
    });

    it('should handle setter errors gracefully', async () => {
      // Create a resource with a failing setter
      await api.addResource('error_test', {
        schema: {
          id: { type: 'id' },
          good_field: {
            type: 'string',
            setter: (value) => value?.toLowerCase()
          },
          bad_field: {
            type: 'string',
            setter: (value) => {
              throw new Error('Setter failed!');
            }
          }
        },
        tableName: 'setter_errors'
      });
      await api.resources.error_test.createKnexTable();

      const record = await api.resources.error_test.post({
        good_field: 'HELLO',
        bad_field: 'world'
      });

      const fetchedRecord = await api.resources.error_test.get({ id: record.id });
      // Good field should be transformed
      assert.equal(fetchedRecord.good_field, 'hello');
      // Bad field should keep validated value (error logged but not thrown)
      assert.equal(fetchedRecord.bad_field, 'world');

      await cleanTables(knex, ['setter_errors']);
    });
  });

  describe('Null and Undefined Handling', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_nullable']);
    });

    it('should handle null and undefined values in setters', async () => {
      const data = await api.resources.nullable_data.post({
        field1: null,
        field2: undefined,
        field3: '',
        field4: 0
      });

      const fetchedData = await api.resources.nullable_data.get({ id: data.id });
      assert.equal(fetchedData.field1, null);
      assert.equal(fetchedData.field2, null);
      assert.equal(fetchedData.field3, 'empty'); // Empty string transformed
      assert.equal(fetchedData.field4, -1); // Zero transformed
    });
  });

  describe('Validation Before Setters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['setter_validated']);
    });

    it('should run setters only after successful validation', async () => {
      // Try to create with invalid data
      await assert.rejects(
        api.resources.validated_data.post({
          email: 'not-an-email',  // Should fail validation
          age: 150  // Should fail max validation
        }),
        /Schema validation failed/
      );

      // No records should be created - verify with query
      const records = await api.resources.validated_data.query();
      assert.equal(records?.length || 0, 0);
    });

    it('should apply setters to validated type-cast data', async () => {
      const data = await api.resources.validated_data.post({
        email: '  VALID@EXAMPLE.COM  ',
        age: '25',  // String will be cast to number
        score: '98.7'  // String will be cast to number
      });

      const fetchedData = await api.resources.validated_data.get({ id: data.id });
      assert.equal(fetchedData.email, 'valid@example.com');
      assert.equal(fetchedData.age, 25); // Setter sees number, not string
      assert.equal(fetchedData.score, 99); // Rounded up by setter
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect circular setter dependencies', async () => {
      await assert.rejects(
        api.addResource('circular_setters', {
          schema: {
            fieldA: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['fieldB']
            },
            fieldB: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['fieldA']
            }
          },
          tableName: 'circular_setters'
        }),
        /Circular dependency detected/
      );
    });

    it('should detect unknown setter dependencies', async () => {
      await assert.rejects(
        api.addResource('unknown_deps', {
          schema: {
            field1: {
              type: 'string',
              setter: (v) => v,
              runSetterAfter: ['nonexistent']
            }
          },
          tableName: 'unknown_deps'
        }),
        /setter dependency 'nonexistent' that does not exist/
      );
    });
  });
});