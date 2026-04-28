import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  cleanTables,
} from './helpers/test-utils.js'
import { createSearchSchemaMergeApi } from './fixtures/api-configs.js'

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

describe('SearchSchema Merge Behavior', () => {
  let api

  before(async () => {
    // Create API instance once - NEVER in beforeEach
    api = await createSearchSchemaMergeApi(knex)
  })

  after(async () => {
    // Clean up - destroy connection
    await knex.destroy()
  })

  beforeEach(async () => {
    // Clean tables between tests
    await cleanTables(knex, ['searchmerge_products', 'searchmerge_users', 'searchmerge_orders'])
  })

  it('should merge search:true fields with explicit searchSchema', async () => {
    // First do a query to trigger schema compilation
    await api.resources.products.query({
      queryParams: {}
    })

    // Get the compiled searchSchema for products (has both search:true and searchSchema)
    const scope = api.resources.products
    const searchSchema = scope.vars.schemaInfo.searchSchemaInstance

    // Verify searchSchema exists
    assert.ok(searchSchema, 'searchSchema should exist')
    assert.ok(searchSchema.structure, 'searchSchema should have structure')

    // Check that search:true fields were added
    assert.ok(searchSchema.structure.name, 'name field should be searchable')
    assert.equal(searchSchema.structure.name.filterOperator || '=', '=', 'name should use default = operator')

    assert.ok(searchSchema.structure.description, 'description field should be searchable')
    assert.equal(searchSchema.structure.description.filterOperator || '=', '=', 'description should use default = operator')

    assert.ok(searchSchema.structure.sku, 'sku field should be searchable')
    assert.equal(searchSchema.structure.sku.filterOperator || '=', '=', 'sku should use default = operator')

    // Check that explicit searchSchema fields override search:true
    assert.ok(searchSchema.structure.price, 'price field should be searchable')
    assert.equal(searchSchema.structure.price.filterOperator, 'between', 'price should use between operator from searchSchema')

    // Check that arbitrary public filter keys are allowed when defined intentionally
    assert.ok(searchSchema.structure.term, 'term alias should be searchable')
    assert.deepEqual(searchSchema.structure.term.oneOf, ['name', 'description'], 'term should map to multiple fields')

    // Check that virtual fields from searchSchema are present
    assert.ok(searchSchema.structure.category_name, 'category_name virtual field should be searchable')
    assert.equal(searchSchema.structure.category_name.filterOperator, 'like', 'category_name should use like operator')
    assert.equal(searchSchema.structure.category_name.actualField, 'category.name', 'category_name should map to category.name')

    assert.ok(searchSchema.structure.availability, 'availability custom filter should be searchable')
    assert.equal(typeof searchSchema.structure.availability.applyFilter, 'function', 'availability should use custom backend logic')

    // Check explicit searchSchema field not marked with search:true
    assert.ok(searchSchema.structure.status, 'status field should be searchable from searchSchema')
    assert.equal(searchSchema.structure.status.filterOperator, 'in', 'status should use in operator')

    // Check that non-searchable fields are not included
    assert.ok(!searchSchema.structure.category_id, 'category_id should not be searchable')
  })

  it('should work with only search:true fields (no explicit searchSchema)', async () => {
    // First do a query to trigger schema compilation
    await api.resources.users.query({
      queryParams: {}
    })

    // Get the compiled searchSchema for users (only search:true fields)
    const scope = api.resources.users
    const searchSchema = scope.vars.schemaInfo.searchSchemaInstance

    assert.ok(searchSchema, 'searchSchema should exist')
    assert.ok(searchSchema.structure.username, 'username should be searchable')
    assert.ok(searchSchema.structure.email, 'email should be searchable')
    assert.ok(searchSchema.structure.bio, 'bio should be searchable')
    assert.equal(searchSchema.structure.bio.filterOperator, 'like', 'bio should use like operator')
    assert.ok(!searchSchema.structure.age, 'age should not be searchable')
  })

  it('should work with only explicit searchSchema (no search:true)', async () => {
    // First do a query to trigger schema compilation
    await api.resources.orders.query({
      queryParams: {}
    })

    // Get the compiled searchSchema for orders (only explicit searchSchema)
    const scope = api.resources.orders
    const searchSchema = scope.vars.schemaInfo.searchSchemaInstance

    assert.ok(searchSchema, 'searchSchema should exist')
    assert.ok(searchSchema.structure.order_number, 'order_number should be searchable')
    assert.ok(searchSchema.structure.status, 'status should be searchable')
    assert.equal(searchSchema.structure.status.filterOperator, 'in', 'status should use in operator')
    assert.ok(!searchSchema.structure.total, 'total should not be searchable')
  })

  it('should reject invalid filter keys that are not part of the public searchSchema contract', async () => {
    await assert.rejects(
      async () => {
        await api.resources.products.query({
          queryParams: {
            filters: {
              invalid_field: 'nope'
            }
          }
        })
      },
      (error) => error?.code === 'REST_API_VALIDATION',
      'Should reject fields that are not defined in searchSchema'
    )
  })
})
