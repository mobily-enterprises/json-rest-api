import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { assertWriteFailure, cleanTables } from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createComputedFieldsApi } from './fixtures/api-configs.js'
import {
  REST_API_FIELDSET_ERROR_CODE,
  RestApiFieldsetError
} from '../index.js'
import { mapRestApiErrorToHttp } from '../plugins/core/connectors/lib/transport-http-helpers.js'

function assertFieldsetError (error, { field, resourceType }) {
  assert(error instanceof RestApiFieldsetError)
  assert.equal(error.code, REST_API_FIELDSET_ERROR_CODE)
  assert.equal(error.statusCode, 400)
  assert.deepEqual(error.details, { field, resourceType })
  assert.equal(
    error.message,
    `Unknown sparse field '${field}' requested for '${resourceType}'`
  )
  return true
}

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

describe('Computed Fields and Sparse Fieldsets', () => {
  let api
  const testData = {}

  before(async () => {
    api = await createComputedFieldsApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['test_products', 'test_reviews', 'test_faulty_products', 'test_failing_async_products'])

    // Create test data
    const product = await api.resources.products.post({ format: 'plain', data: { name: 'Premium Widget', price: 99.99, cost: 45.00, internal_notes: 'Supplier: ABC Corp' } })
    testData.product = product

    const review1 = await api.resources.reviews.post({ format: 'plain', data: { product: product.id, reviewer_name: 'Alice', rating: 5, comment: 'Excellent product!', helpful_votes: 45, total_votes: 50, spam_score: 0.1 } })
    testData.review1 = review1

    const review2 = await api.resources.reviews.post({ format: 'plain', data: { product: product.id, reviewer_name: 'Bob', rating: 4, comment: 'Good value', helpful_votes: 8, total_votes: 20, spam_score: 0.2 } })
    testData.review2 = review2
  })

  for (const method of ['post', 'put', 'patch']) {
    it(`rejects computed-field ${method} input without changing stored records`, async () => {
      const before = await api.resources.products.query({})
      await assert.rejects(api.resources.products[method]({
        ...(method === 'post' ? {} : { id: testData.product.id }),
        format: 'jsonapi',
        document: {
          data: {
            type: 'products',
            attributes: {
              name: 'Rejected change', price: 100, cost: 50, internal_notes: 'Unchanged', profit_margin: 987654321
            }
          }
        }
      }), error => {
        assert.equal(error.transactionOutcome, 'rolledBack')
        assert.equal(error.code, 'REST_API_VALIDATION')
        assert.deepEqual(error.details.fields, ['data.attributes.profit_margin'])
        assert.equal(error.details.violations[0].rule, 'FIELD_NOT_ALLOWED')
        return true
      })
      assert.deepEqual(await api.resources.products.query({}), before)
    })
  }

  describe('Basic Computed Fields', () => {
    it('should compute fields automatically when fetching', async () => {
      const product = await api.resources.products.get({ id: testData.product.id })

      assert.equal(product.name, 'Premium Widget')
      assert.equal(product.price, 99.99)
      assert.equal(product.profit_margin, 55.00)
      assert.equal(product.profit_amount, 54.99)
      assert.equal(product.calculated_at, '2026-08-25T23:45:01Z')
      assert.equal(product.calculated_time, '23:45:01.987')

      // normallyHidden fields should not be included
      assert.equal(product.cost, undefined)
      assert.equal(product.internal_notes, undefined)
    })

    it('should normalize computed temporal values at the final return boundary', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: { include: ['reviews'] }
      })
      assert.equal(product.calculated_at, '2026-08-25T23:45:01Z')
      assert.equal(product.calculated_time, '23:45:01.987')
      assert.equal(product.reviews.length, 2)
      for (const review of product.reviews) {
        assert.equal(review.calculated_at, '2026-08-25T23:46:02Z')
      }

      const products = await api.resources.products.query()
      assert.equal(products.data[0].calculated_at, '2026-08-25T23:45:01Z')
      assert.equal(products.data[0].calculated_time, '23:45:01.987')
    })

    it('should handle division by zero in computed fields', async () => {
      const freeProduct = await api.resources.products.post({ format: 'plain', data: { name: 'Free Sample', price: 0, cost: 0 } })

      const fetched = await api.resources.products.get({ id: freeProduct.id })
      assert.equal(fetched.profit_margin, 0)
      assert.equal(fetched.profit_amount, 0)
    })

    it('should handle null values in computed fields', async () => {
      const review = await api.resources.reviews.post({ format: 'plain', data: { product: testData.product.id, reviewer_name: 'Charlie', rating: 3, comment: 'Average', helpful_votes: 0, total_votes: 0 } })

      const fetched = await api.resources.reviews.get({ id: review.id })
      assert.equal(fetched.helpfulness_score, null)
      assert.equal(fetched.is_helpful, null)
    })
  })

  describe('Sparse Fieldsets with Computed Fields', () => {
    it('should return only requested fields including computed', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      })

      assert.equal(product.id, testData.product.id)
      assert.equal(product.name, 'Premium Widget')
      assert.equal(product.profit_margin, 55.00)
      assert.equal(product.calculated_at, undefined)
      assert.equal(product.calculated_time, undefined)

      // Other fields should not be included
      assert.equal(product.price, undefined)
      assert.equal(product.profit_amount, undefined)
      assert.equal(product.cost, undefined)
    })

    it('should fetch dependencies but not include them in response', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'profit_margin' }
        }
      })

      assert.equal(product.id, testData.product.id)
      assert.equal(product.profit_margin, 55.00)

      // Dependencies should not be included
      assert.equal(product.price, undefined)
      assert.equal(product.cost, undefined)
    })

    it('should allow explicitly requesting normallyHidden dependencies', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,cost,profit_margin' }
        }
      })

      assert.equal(product.name, 'Premium Widget')
      assert.equal(product.cost, 45) // Explicitly requested
      assert.equal(product.profit_margin, 55.00)

      // Price was not requested
      assert.equal(product.price, undefined)
    })

    it('should handle multiple computed fields with overlapping dependencies', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'profit_margin,profit_amount' }
        }
      })

      assert.equal(product.profit_margin, 55.00)
      assert.equal(product.profit_amount, 54.99)

      // Shared dependencies should not be included
      assert.equal(product.price, undefined)
      assert.equal(product.cost, undefined)
    })
  })

  describe('Computed Fields in Included Resources', () => {
    it('should compute fields in hasMany included resources', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews']
        }
      })

      assert.equal(product.reviews.length, 2)

      const review1 = product.reviews.find(r => r.reviewer_name === 'Alice')
      assert.equal(review1.helpfulness_score, 90)
      assert.equal(review1.is_helpful, true)
      assert.equal(review1.spam_score, undefined) // normallyHidden

      const review2 = product.reviews.find(r => r.reviewer_name === 'Bob')
      assert.equal(review2.helpfulness_score, 40)
      assert.equal(review2.is_helpful, false) // Has enough votes but not helpful enough
    })

    it('should apply sparse fieldsets to included resources with computed fields', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name,reviews',
            reviews: 'reviewer_name,rating,helpfulness_score'
          }
        }
      })

      assert.equal(product.name, 'Premium Widget')
      assert.equal(product.price, undefined)
      assert.equal(product.profit_margin, undefined)

      const review = product.reviews[0]
      assert.ok(review.reviewer_name)
      assert.ok(review.rating)
      assert.ok(review.helpfulness_score !== undefined)

      // Other fields should not be included
      assert.equal(review.comment, undefined)
      assert.equal(review.helpful_votes, undefined)
      assert.equal(review.total_votes, undefined)
      assert.equal(review.is_helpful, undefined) // Not requested
    })

    it('should handle computed dependencies in included resources', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name,reviews',
            reviews: 'is_helpful' // Depends on helpful_votes, total_votes, spam_score
          }
        }
      })

      const review = product.reviews.find(r => r.id === testData.review1.id)
      assert.equal(review.is_helpful, true)

      // Dependencies should not be included
      assert.equal(review.helpful_votes, undefined)
      assert.equal(review.total_votes, undefined)
      assert.equal(review.spam_score, undefined)
    })
  })

  describe('Collection Queries with Computed Fields', () => {
    it('should compute fields for all records in collection', async () => {
      const products = await api.resources.products.query()

      assert.equal(products.data.length, 1)
      const product = products.data[0]
      assert.equal(product.profit_margin, 55.00)
      assert.equal(product.profit_amount, 54.99)
    })

    it('should apply sparse fieldsets to collections', async () => {
      const products = await api.resources.products.query({
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      })

      const product = products.data[0]
      assert.equal(product.name, 'Premium Widget')
      assert.equal(product.profit_margin, 55.00)
      assert.equal(product.price, undefined)
      assert.equal(product.cost, undefined)
    })

    it('should handle includes with computed fields in collections', async () => {
      const products = await api.resources.products.query({
        queryParams: {
          include: ['reviews'],
          fields: {
            products: 'name,reviews',
            reviews: 'rating,helpfulness_score'
          }
        }
      })

      const product = products.data[0]
      assert.equal(product.reviews.length, 2)

      product.reviews.forEach(review => {
        assert.ok(review.rating)
        assert.ok(review.helpfulness_score !== undefined)
        assert.equal(review.reviewer_name, undefined)
        assert.equal(review.comment, undefined)
      })
    })
  })

  describe('Relationship Fields', () => {
    it('should include minimal relationship objects when selected in sparse fieldsets', async () => {
      const product = await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,reviews' }
        }
      })

      // Minimal relationship objects should still be included
      assert.ok(Array.isArray(product.reviews))
      assert.equal(product.reviews.length, 2)
      assert.equal(product.reviews[0].id, testData.review1.id)
      assert.equal(product.reviews[1].id, testData.review2.id)
      // Should only have id property (minimal object)
      assert.equal(Object.keys(product.reviews[0]).length, 1)
      assert.equal(Object.keys(product.reviews[1]).length, 1)
    })

    it('should include empty arrays for empty relationships', async () => {
      const newProduct = await api.resources.products.post({ format: 'plain', data: { name: 'New Product', price: 50, cost: 25 } })

      const fetched = await api.resources.products.get({
        id: newProduct.id,
        queryParams: {
          fields: { products: 'name,reviews' }
        }
      })

      assert.ok(Array.isArray(fetched.reviews))
      assert.equal(fetched.reviews.length, 0)
    })
  })

  describe('Error Handling', () => {
    it('should reject compute errors and roll back full-response writes', async () => {
      const resource = api.resources.faulty_products
      const inputRecord = { data: { type: 'faulty_products', attributes: { value: 42 } } }
      const rejectsCompute = error => {
        assert.equal(error.cause.message, 'Computation failed')
        assert.deepEqual(error.context, { scopeName: 'faulty_products', fieldName: 'bad_compute', phase: 'computed' })
        return true
      }
      await assert.rejects(resource.post({ format: 'jsonapi', document: inputRecord }), error => {
        assertWriteFailure(error, { outcome: 'rolledBack' })
        return rejectsCompute(error.cause)
      })
      assert.equal((await resource.query({ format: 'jsonapi' })).data.length, 0)

      const record = await resource.post({ format: 'jsonapi', returning: 'minimal', document: inputRecord })
      await assert.rejects(resource.get({ id: record.data.id, format: 'jsonapi' }), rejectsCompute)
    })

    it('should reject unknown fields in sparse fieldsets', async () => {
      await assert.rejects(
        api.resources.products.get({
          id: testData.product.id,
          queryParams: {
            fields: { products: 'name,unknown_field' }
          }
        }),
        (error) => assertFieldsetError(error, {
          field: 'unknown_field',
          resourceType: 'products'
        })
      )
    })

    it('should reject requests for _ids fields in sparse fieldsets', async () => {
      await assert.rejects(
        api.resources.products.get({
          id: testData.product.id,
          queryParams: {
            fields: { products: 'name,reviews_ids' }
          }
        }),
        (error) => assertFieldsetError(error, {
          field: 'reviews_ids',
          resourceType: 'products'
        })
      )
    })

    it('should preserve fieldset errors from empty included relationships', async () => {
      const productWithoutReviews = await api.resources.products.post({ format: 'plain', data: { name: 'No Reviews', price: 25, cost: 10 } })

      await assert.rejects(
        api.resources.products.get({
          id: productWithoutReviews.id,
          queryParams: {
            include: ['reviews'],
            fields: {
              products: 'name',
              reviews: 'definitelyHidden'
            }
          }
        }),
        (error) => assertFieldsetError(error, {
          field: 'definitelyHidden',
          resourceType: 'reviews'
        })
      )
    })

    it('should map fieldset errors to an HTTP 400 response', () => {
      const error = new RestApiFieldsetError({
        field: 'definitelyHidden',
        resourceType: 'reviews'
      })

      assert.deepEqual(mapRestApiErrorToHttp(error), {
        status: 400,
        body: {
          errors: [{
            status: '400',
            code: REST_API_FIELDSET_ERROR_CODE,
            title: 'Invalid Sparse Fieldset',
            detail: "Unknown sparse field 'definitelyHidden' requested for 'reviews'"
          }]
        }
      })
    })
  })

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
              await new Promise(resolve => setTimeout(resolve, 10))
              return `fetched-${attributes.external_id}`
            }
          },
          computed_name: {
            type: 'string',
            computed: true,
            dependencies: ['name'],
            compute: async ({ attributes }) => {
              // Another async operation
              await new Promise(resolve => setTimeout(resolve, 5))
              return attributes.name.toUpperCase()
            }
          }
        },
        tableName: 'test_async_products'
      })
      await api.resources.async_products.createKnexTable()
      if (storageMode.isAnyApi()) {
        storageMode.registerTable(knex, 'test_async_products', 'async_products', api.anyapi.tenantId)
      }

      const product = await api.resources.async_products.post({ format: 'plain', data: { name: 'Async Product', external_id: 'ext-123' } })

      const fetched = await api.resources.async_products.get({ id: product.id })
      assert.equal(fetched.external_data, 'fetched-ext-123')
      assert.equal(fetched.computed_name, 'ASYNC PRODUCT')
    })

    it('should reject async compute errors and roll back full-response writes', async () => {
      const resource = api.resources.failing_async_products
      const inputRecord = { data: { type: 'failing_async_products', attributes: { value: 42 } } }
      const rejectsCompute = error => {
        assert.equal(error.cause.message, 'Async computation failed')
        assert.deepEqual(error.context, { scopeName: 'failing_async_products', fieldName: 'failing_async', phase: 'computed' })
        return true
      }
      await assert.rejects(resource.post({ format: 'jsonapi', document: inputRecord }), error => {
        assertWriteFailure(error, { outcome: 'rolledBack' })
        return rejectsCompute(error.cause)
      })
      assert.equal((await resource.query({ format: 'jsonapi' })).data.length, 0)

      const record = await resource.post({ format: 'jsonapi', returning: 'minimal', document: inputRecord })
      await assert.rejects(resource.get({ id: record.data.id, format: 'jsonapi' }), rejectsCompute)
    })
  })

  describe('Performance Considerations', () => {
    it('should only compute requested computed fields', async () => {
      // Track compute calls
      let profitMarginCalls = 0
      let profitAmountCalls = 0

      // Override compute functions to track calls
      const originalProfitMargin = api.resources.products.vars.schemaInfo.computed.profit_margin.compute
      const originalProfitAmount = api.resources.products.vars.schemaInfo.computed.profit_amount.compute

      api.resources.products.vars.schemaInfo.computed.profit_margin.compute = (ctx) => {
        profitMarginCalls++
        return originalProfitMargin(ctx)
      }

      api.resources.products.vars.schemaInfo.computed.profit_amount.compute = (ctx) => {
        profitAmountCalls++
        return originalProfitAmount(ctx)
      }

      // Request only profit_margin
      await api.resources.products.get({
        id: testData.product.id,
        queryParams: {
          fields: { products: 'name,profit_margin' }
        }
      })

      assert.equal(profitMarginCalls, 1)
      assert.equal(profitAmountCalls, 0) // Should not be computed

      // Restore original functions
      api.resources.products.vars.schemaInfo.computed.profit_margin.compute = originalProfitMargin
      api.resources.products.vars.schemaInfo.computed.profit_amount.compute = originalProfitAmount
    })
  })
})
