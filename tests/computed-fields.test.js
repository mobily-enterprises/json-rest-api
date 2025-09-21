import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { cleanTables } from './helpers/test-utils.js';
import { storageMode } from './helpers/storage-mode.js';
import { createComputedFieldsApi } from './fixtures/api-configs.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Computed Fields and Sparse Fieldsets', () => {
  let api;
  let testData = {};

  before(async () => {
    api = await createComputedFieldsApi(knex);
  });

  after(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    await cleanTables(knex, ['test_products', 'test_reviews']);
    
    // Create test data
    const product = await api.resources.products.post({
      name: 'Premium Widget',
      price: 99.99,
      cost: 45.00,
      internal_notes: 'Supplier: ABC Corp'
    });
    testData.product = product;

    const review1 = await api.resources.reviews.post({
      product: product.id,
      reviewer_name: 'Alice',
      rating: 5,
      comment: 'Excellent product!',
      helpful_votes: 45,
      total_votes: 50,
      spam_score: 0.1
    });
    testData.review1 = review1;

    const review2 = await api.resources.reviews.post({
      product: product.id,
      reviewer_name: 'Bob',
      rating: 4,
      comment: 'Good value',
      helpful_votes: 8,
      total_votes: 20,
      spam_score: 0.2
    });
    testData.review2 = review2;
  });

  describe('Basic Computed Fields', () => {
    it('should compute fields automatically when fetching', async () => {
      const product = await api.resources.products.get({ id: testData.product.id });
      
      assert.equal(product.name, 'Premium Widget');
      assert.equal(product.price, 99.99);
      assert.equal(product.profit_margin, 55.00);
      assert.equal(product.profit_amount, 54.99);
      
      // normallyHidden fields should not be included
      assert.equal(product.cost, undefined);
      assert.equal(product.internal_notes, undefined);
    });

    it('should handle division by zero in computed fields', async () => {
      const freeProduct = await api.resources.products.post({
        name: 'Free Sample',
        price: 0,
        cost: 0
      });

      const fetched = await api.resources.products.get({ id: freeProduct.id });
      assert.equal(fetched.profit_margin, 0);
      assert.equal(fetched.profit_amount, 0);
    });

    it('should handle null values in computed fields', async () => {
      const review = await api.resources.reviews.post({
        product: testData.product.id,
        reviewer_name: 'Charlie',
        rating: 3,
        comment: 'Average',
        helpful_votes: 0,
        total_votes: 0
      });

      const fetched = await api.resources.reviews.get({ id: review.id });
      assert.equal(fetched.helpfulness_score, null);
      assert.equal(fetched.is_helpful, null);
    });
  });

  describe('Sparse Fieldsets with Computed Fields', () => {
    it('should return only requested fields including computed', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      });

      assert.equal(product.id, testData.product.id);
      assert.equal(product.name, 'Premium Widget');
      assert.equal(product.profit_margin, 55.00);
      
      // Other fields should not be included
      assert.equal(product.price, undefined);
      assert.equal(product.profit_amount, undefined);
      assert.equal(product.cost, undefined);
    });

    it('should fetch dependencies but not include them in response', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'profit_margin' }
        }
      });

      assert.equal(product.id, testData.product.id);
      assert.equal(product.profit_margin, 55.00);
      
      // Dependencies should not be included
      assert.equal(product.price, undefined);
      assert.equal(product.cost, undefined);
    });

    it('should allow explicitly requesting normallyHidden dependencies', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,cost,profit_margin' }
        }
      });

      assert.equal(product.name, 'Premium Widget');
      assert.equal(product.cost, 45); // Explicitly requested
      assert.equal(product.profit_margin, 55.00);
      
      // Price was not requested
      assert.equal(product.price, undefined);
    });

    it('should handle multiple computed fields with overlapping dependencies', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'profit_margin,profit_amount' }
        }
      });

      assert.equal(product.profit_margin, 55.00);
      assert.equal(product.profit_amount, 54.99);
      
      // Shared dependencies should not be included
      assert.equal(product.price, undefined);
      assert.equal(product.cost, undefined);
    });
  });

  describe('Computed Fields in Included Resources', () => {
    it('should compute fields in hasMany included resources', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews']
        }
      });

      assert.equal(product.reviews.length, 2);
      
      const review1 = product.reviews.find(r => r.reviewer_name === 'Alice');
      assert.equal(review1.helpfulness_score, 90);
      assert.equal(review1.is_helpful, true);
      assert.equal(review1.spam_score, undefined); // normallyHidden
      
      const review2 = product.reviews.find(r => r.reviewer_name === 'Bob');
      assert.equal(review2.helpfulness_score, 40);
      assert.equal(review2.is_helpful, false); // Has enough votes but not helpful enough
    });

    it('should apply sparse fieldsets to included resources with computed fields', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name',
            reviews: 'reviewer_name,rating,helpfulness_score'
          }
        }
      });

      assert.equal(product.name, 'Premium Widget');
      assert.equal(product.price, undefined);
      assert.equal(product.profit_margin, undefined);

      const review = product.reviews[0];
      assert.ok(review.reviewer_name);
      assert.ok(review.rating);
      assert.ok(review.helpfulness_score !== undefined);
      
      // Other fields should not be included
      assert.equal(review.comment, undefined);
      assert.equal(review.helpful_votes, undefined);
      assert.equal(review.total_votes, undefined);
      assert.equal(review.is_helpful, undefined); // Not requested
    });

    it('should handle computed dependencies in included resources', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name',
            reviews: 'is_helpful' // Depends on helpful_votes, total_votes, spam_score
          }
        }
      });

      const review = product.reviews.find(r => r.id === testData.review1.id);
      assert.equal(review.is_helpful, true);
      
      // Dependencies should not be included
      assert.equal(review.helpful_votes, undefined);
      assert.equal(review.total_votes, undefined);
      assert.equal(review.spam_score, undefined);
    });
  });

  describe('Collection Queries with Computed Fields', () => {
    it('should compute fields for all records in collection', async () => {
      const products = await api.resources.products.query();
      
      assert.equal(products.data.length, 1);
      const product = products.data[0];
      assert.equal(product.profit_margin, 55.00);
      assert.equal(product.profit_amount, 54.99);
    });

    it('should apply sparse fieldsets to collections', async () => {
      const products = await api.resources.products.query({
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      });

      const product = products.data[0];
      assert.equal(product.name, 'Premium Widget');
      assert.equal(product.profit_margin, 55.00);
      assert.equal(product.price, undefined);
      assert.equal(product.cost, undefined);
    });

    it('should handle includes with computed fields in collections', async () => {
      const products = await api.resources.products.query({
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name',
            reviews: 'rating,helpfulness_score'
          }
        }
      });

      const product = products.data[0];
      assert.equal(product.reviews.length, 2);
      
      product.reviews.forEach(review => {
        assert.ok(review.rating);
        assert.ok(review.helpfulness_score !== undefined);
        assert.equal(review.reviewer_name, undefined);
        assert.equal(review.comment, undefined);
      });
    });
  });

  describe('Relationship Fields', () => {
    it('should always include minimal relationship objects regardless of sparse fieldsets', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name' }
        }
      });

      // Minimal relationship objects should still be included
      assert.ok(Array.isArray(product.reviews));
      assert.equal(product.reviews.length, 2);
      assert.equal(product.reviews[0].id, testData.review1.id);
      assert.equal(product.reviews[1].id, testData.review2.id);
      // Should only have id property (minimal object)
      assert.equal(Object.keys(product.reviews[0]).length, 1);
      assert.equal(Object.keys(product.reviews[1]).length, 1);
    });

    it('should include empty arrays for empty relationships', async () => {
      const newProduct = await api.resources.products.post({
        name: 'New Product',
        price: 50,
        cost: 25
      });

      const fetched = await api.resources.products.get({
        id: newProduct.id,
        queryParams: {
          fields: { products: 'name' }
        }
      });

      assert.ok(Array.isArray(fetched.reviews));
      assert.equal(fetched.reviews.length, 0);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in compute functions gracefully', async () => {
      // Add a product resource with a faulty computed field
      await api.addResource('faulty_products', {
        schema: {
          id: { type: 'id' },
          value: { type: 'number' },
          bad_compute: {
            type: 'string',
            computed: true,
            dependencies: ['value'],
            compute: ({ attributes }) => {
              throw new Error('Computation failed');
            }
          }
        },
        tableName: 'test_faulty_products'
      });
      await api.resources.faulty_products.createKnexTable();
      if (storageMode.isAnyApi()) {
        storageMode.registerTable('test_faulty_products', 'faulty_products');
      }

      const faulty = await api.resources.faulty_products.post({ value: 42 });
      const fetched = await api.resources.faulty_products.get({ id: faulty.id });

      assert.equal(fetched.value, 42);
      assert.equal(fetched.bad_compute, null); // Error results in null
    });

    it('should reject unknown fields in sparse fieldsets', async () => {
      await assert.rejects(
        api.resources.products.get({
          id: testData.product.id,
          queryParams: {
            fields: { products: 'name,unknown_field' }
          }
        }),
        /Unknown sparse field 'unknown_field'/
      );
    });

    it('should reject requests for _ids fields in sparse fieldsets', async () => {
      await assert.rejects(
        api.resources.products.get({
          id: testData.product.id,
          queryParams: {
            fields: { products: 'name,reviews_ids' }
          }
        }),
        /Unknown sparse field 'reviews_ids'/
      );
    });
  });

  describe('Async Computed Fields', () => {
    it('should support async compute functions', async () => {
      // Add a resource with async computed field
      await api.addResource('async_products', {
        schema: {
          id: { type: 'id' },
          name: { type: 'string', required: true },
          external_id: { type: 'string' },
          external_data: {
            type: 'string',
            computed: true,
            dependencies: ['external_id'],
            compute: async ({ attributes }) => {
              // Simulate async operation (e.g., external API call)
              await new Promise(resolve => setTimeout(resolve, 10));
              return `fetched-${attributes.external_id}`;
            }
          },
          computed_name: {
            type: 'string',
            computed: true,
            dependencies: ['name'],
            compute: async ({ attributes }) => {
              // Another async operation
              await new Promise(resolve => setTimeout(resolve, 5));
              return attributes.name.toUpperCase();
            }
          }
        },
        tableName: 'test_async_products'
      });
      await api.resources.async_products.createKnexTable();
      if (storageMode.isAnyApi()) {
        storageMode.registerTable('test_async_products', 'async_products');
      }

      const product = await api.resources.async_products.post({
        name: 'Async Product',
        external_id: 'ext-123'
      });

      const fetched = await api.resources.async_products.get({ id: product.id });
      assert.equal(fetched.external_data, 'fetched-ext-123');
      assert.equal(fetched.computed_name, 'ASYNC PRODUCT');
    });

    it('should handle errors in async compute functions', async () => {
      // Add a resource with failing async computed field
      await api.addResource('failing_async_products', {
        schema: {
          id: { type: 'id' },
          value: { type: 'number' },
          failing_async: {
            type: 'string',
            computed: true,
            dependencies: ['value'],
            compute: async ({ attributes }) => {
              await new Promise(resolve => setTimeout(resolve, 5));
              throw new Error('Async computation failed');
            }
          }
        },
        tableName: 'test_failing_async_products'
      });
      await api.resources.failing_async_products.createKnexTable();
      if (storageMode.isAnyApi()) {
        storageMode.registerTable('test_failing_async_products', 'failing_async_products');
      }

      const product = await api.resources.failing_async_products.post({ value: 42 });
      const fetched = await api.resources.failing_async_products.get({ id: product.id });

      assert.equal(fetched.value, 42);
      assert.equal(fetched.failing_async, null); // Error results in null
    });
  });

  describe('Performance Considerations', () => {
    it('should only compute requested computed fields', async () => {
      // Track compute calls
      let profitMarginCalls = 0;
      let profitAmountCalls = 0;

      // Override compute functions to track calls
      const originalProfitMargin = api.resources.products.vars.schemaInfo.computed.profit_margin.compute;
      const originalProfitAmount = api.resources.products.vars.schemaInfo.computed.profit_amount.compute;

      api.resources.products.vars.schemaInfo.computed.profit_margin.compute = (ctx) => {
        profitMarginCalls++;
        return originalProfitMargin(ctx);
      };

      api.resources.products.vars.schemaInfo.computed.profit_amount.compute = (ctx) => {
        profitAmountCalls++;
        return originalProfitAmount(ctx);
      };

      // Request only profit_margin
      await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      });

      assert.equal(profitMarginCalls, 1);
      assert.equal(profitAmountCalls, 0); // Should not be computed

      // Restore original functions
      api.resources.products.vars.schemaInfo.computed.profit_margin.compute = originalProfitMargin;
      api.resources.products.vars.schemaInfo.computed.profit_amount.compute = originalProfitAmount;
    });
  });
});
