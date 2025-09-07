import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createFieldGettersApi } from './fixtures/api-configs.js';
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

describe('Field Getters', () => {
  before(async () => {
    // Initialize API once
    api = await createFieldGettersApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('Basic Field Transformations', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['getter_users']);
    });

    it('should apply simple getter transformations', async () => {
      // Create user with data that needs transformation
      const user = await api.resources.users.post({
        email: '  USER@EXAMPLE.COM  ',
        name: '  John Doe  ',
        phone: '1234567890',
        metadata_json: '{"key": "value", "num": 123}',
        tags_csv: 'tag1, tag2, tag3'
      });

      // Check transformations applied on create
      assert.equal(user.email, 'user@example.com');
      assert.equal(user.name, 'John Doe');
      assert.equal(user.phone, '(123) 456-7890');
      assert.deepEqual(user.metadata_json, { key: 'value', num: 123 });
      assert.deepEqual(user.tags_csv, ['tag1', 'tag2', 'tag3']);

      // Verify getters apply on fetch too
      const fetched = await api.resources.users.get({ id: user.id });
      assert.equal(fetched.email, 'user@example.com');
      assert.equal(fetched.name, 'John Doe');
      assert.equal(fetched.phone, '(123) 456-7890');
      assert.deepEqual(fetched.metadata_json, { key: 'value', num: 123 });
      assert.deepEqual(fetched.tags_csv, ['tag1', 'tag2', 'tag3']);
    });

    it('should handle null and undefined values', async () => {
      const user = await api.resources.users.post({
        email: null,
        name: undefined,
        phone: null,
        metadata_json: null,
        tags_csv: null
      });

      assert.equal(user.email, undefined); // null?.toLowerCase().trim() returns undefined
      assert.equal(user.name, undefined); // undefined is passed, getter returns undefined
      assert.equal(user.phone, null); // getter explicitly returns null for falsy values
      assert.deepEqual(user.metadata_json, {});
      assert.deepEqual(user.tags_csv, []);
    });

    it('should handle invalid data gracefully', async () => {
      const user = await api.resources.users.post({
        email: '  mixed@CASE.com  ',
        name: '   ',
        phone: '123', // Too short
        metadata_json: 'invalid json',
        tags_csv: ', , empty, , values, '
      });

      assert.equal(user.email, 'mixed@case.com');
      assert.equal(user.name, '');
      assert.equal(user.phone, '123'); // Unchanged when can't format
      assert.deepEqual(user.metadata_json, {}); // Empty object on parse error
      assert.deepEqual(user.tags_csv, ['empty', 'values']); // Filters empty values
    });
  });

  describe('Getters with Computed Fields', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['getter_products']);
    });

    it('should apply getters before computed fields', async () => {
      const product = await api.resources.products.post({
        name: 'widget',
        description: 'This is a very long product description that should be truncated',
        price_str: '100.00',
        tax_rate_str: '0.20'
      });

      // Getters should transform values
      assert.equal(product.name, 'WIDGET');
      assert.equal(product.description, 'This is a very long product description that sh...');
      assert.equal(typeof product.price_str, 'number');
      assert.equal(product.price_str, 100);
      assert.equal(product.tax_rate_str, 0.20);
      
      // Computed field should see getter-transformed values
      assert.equal(product.total_price, 120);
    });

    it('should work with sparse fieldsets', async () => {
      const product = await api.resources.products.post({
        name: 'another widget',
        description: 'Short desc',
        price_str: '50.00',
        tax_rate_str: '0.10'
      });

      // Fetch with sparse fieldsets
      const sparse = await api.resources.products.get({
        id: product.id,
        queryParams: {
          fields: { products: 'name,total_price' }
        }
      });

      assert.equal(sparse.name, 'ANOTHER WIDGET');
      assert.ok(Math.abs(sparse.total_price - 55) < 0.0001, `Expected total_price to be ~55, got ${sparse.total_price}`);
      assert.equal(sparse.description, undefined);
      assert.equal(sparse.price_str, undefined);
    });
  });

  describe('Getter Dependencies', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['getter_formatted']);
    });

    it('should apply getters in dependency order', async () => {
      const data = await api.resources.formatted_data.post({
        step1: '  hello  ',
        step2: 'world',
        step3: 'end'
      });

      // Check that getters ran in order
      assert.equal(data.step1, 'hello'); // Trimmed
      assert.equal(data.step2, 'world [step1: hello]'); // Sees trimmed step1
      assert.equal(data.step3, 'end [step2: world [step1: hello]]'); // Sees processed step2
    });

    it('should handle missing dependencies gracefully', async () => {
      const data = await api.resources.formatted_data.post({
        step3: 'only step3'
        // step1 and step2 are missing
      });

      assert.equal(data.step1, undefined);
      assert.equal(data.step2, null);
      assert.equal(data.step3, 'only step3 [step2: null]');
    });
  });

  describe('Async Getters', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['getter_encrypted']);
    });

    it('should support async getter functions', async () => {
      // Helper to simulate encryption
      const encrypt = (value) => Buffer.from(value).toString('base64');

      // Store encrypted data directly in DB
      const id = await knex('getter_encrypted').insert({
        secret: encrypt('my-secret-value'),
        data: encrypt('sensitive-info')
      }).returning('id').then(r => r[0].id);

      // Fetch should decrypt via async getters
      const record = await api.resources.encrypted_data.get({ id });
      assert.equal(record.secret, 'my-secret-value');
      assert.equal(record.data, '[encrypted_data] sensitive-info');
    });

    it('should handle null values in async getters', async () => {
      const record = await api.resources.encrypted_data.post({
        secret: null,
        data: null
      });

      assert.equal(record.secret, null);
      assert.equal(record.data, null);
    });
  });

  describe('Getters in Included Resources', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['getter_products', 'getter_reviews']);
    });

    it('should apply getters to included resources', async () => {
      const product = await api.resources.products.post({
        name: 'test product',
        description: 'A product',
        price_str: '99.99',
        tax_rate_str: '0'
      });

      // Add reviews
      await api.resources.reviews.post({
        product: product.id,
        content: 'Great product!',
        rating: 5
      });

      await api.resources.reviews.post({
        product: product.id,
        content: 'Not bad',
        rating: 3
      });

      // Fetch with includes
      const result = await api.resources.products.get({
        id: product.id,
        queryParams: {
          include: ['reviews']
        }
      });

      // Product getters should apply
      assert.equal(result.name, 'TEST PRODUCT');
      
      // Review getters should apply to included resources
      assert.equal(result.reviews.length, 2);
      assert.equal(result.reviews[0].content, '[REVIEW] Great product!');
      assert.equal(result.reviews[1].content, '[REVIEW] Not bad');
    });

    it('should work with sparse fieldsets on included resources', async () => {
      const product = await api.resources.products.post({
        name: 'another product',
        description: 'Description',
        price_str: '10',
        tax_rate_str: '0'
      });

      await api.resources.reviews.post({
        product: product.id,
        content: 'Review text',
        rating: 4
      });

      const result = await api.resources.products.get({
        id: product.id,
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name',
            reviews: 'content' // Only content, not rating
          }
        }
      });

      assert.equal(result.name, 'ANOTHER PRODUCT');
      assert.equal(result.description, undefined);
      
      assert.equal(result.reviews.length, 1);
      assert.equal(result.reviews[0].content, '[REVIEW] Review text');
      assert.equal(result.reviews[0].rating, undefined);
    });
  });

  describe('Getter Error Handling', () => {
    it('should handle getter errors gracefully', async () => {
      // Add a resource with a failing getter
      await api.addResource('error_test', {
        schema: {
          id: { type: 'id' },
          good_field: {
            type: 'string',
            getter: (value) => value?.toUpperCase()
          },
          bad_field: {
            type: 'string',
            getter: (value) => {
              throw new Error('Getter failed!');
            }
          }
        },
        tableName: 'getter_errors'
      });
      await api.resources.error_test.createKnexTable();

      const record = await api.resources.error_test.post({
        good_field: 'hello',
        bad_field: 'world'
      });

      // Good field should be transformed
      assert.equal(record.good_field, 'HELLO');
      // Bad field should keep original value (error logged but not thrown)
      assert.equal(record.bad_field, 'world');

      await cleanTables(knex, ['getter_errors']);
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect circular getter dependencies', async () => {
      await assert.rejects(
        api.addResource('circular_test', {
          schema: {
            fieldA: {
              type: 'string',
              getter: (v) => v,
              runGetterAfter: ['fieldB']
            },
            fieldB: {
              type: 'string',
              getter: (v) => v,
              runGetterAfter: ['fieldA']
            }
          },
          tableName: 'circular_test'
        }),
        /Circular dependency detected/
      );
    });

    it('should detect unknown getter dependencies', async () => {
      await assert.rejects(
        api.addResource('unknown_test', {
          schema: {
            field1: {
              type: 'string',
              getter: (v) => v,
              runGetterAfter: ['nonexistent']
            }
          },
          tableName: 'unknown_test'
        }),
        /getter dependency 'nonexistent' that does not exist/
      );
    });
  });
});