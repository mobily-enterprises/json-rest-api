import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  cleanTables,
  createJsonApiDocument,
} from './helpers/test-utils.js'
import { storageMode } from './helpers/storage-mode.js'
import { createSearchSchemaMergeApi } from './fixtures/api-configs.js'

const maybeDescribe = storageMode.isAnyApi() ? describe.skip : describe

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

maybeDescribe('SearchSchema Merge Behavior (Knex execution)', () => {
  let api

  before(async () => {
    api = await createSearchSchemaMergeApi(knex)
  })

  after(async () => {
    await knex.destroy()
  })

  beforeEach(async () => {
    await cleanTables(knex, ['searchmerge_products', 'searchmerge_users', 'searchmerge_orders'])
  })

  it('should use exact matching for search:true strings unless filterOperator is explicit', async () => {
    const context = {}

    await api.resources.users.post({
      inputRecord: createJsonApiDocument('users', {
        username: 'ann',
        email: 'ann@example.com',
        bio: 'Writes API guides'
      })
    }, context)

    await api.resources.users.post({
      inputRecord: createJsonApiDocument('users', {
        username: 'anna',
        email: 'anna@example.com',
        bio: 'Writing API tutorials'
      })
    }, context)

    const usernameResults = await api.resources.users.query({
      queryParams: {
        filters: {
          username: 'ann'
        }
      }
    }, context)

    assert.equal(usernameResults.data.length, 1, 'search:true username should use exact matching')
    assert.equal(usernameResults.data[0].attributes.username, 'ann')

    const bioResults = await api.resources.users.query({
      queryParams: {
        filters: {
          bio: 'Writ'
        }
      }
    }, context)

    assert.equal(bioResults.data.length, 2, 'explicit like operator should still support partial matching')
  })

  it('should allow filtering with merged searchSchema fields', async () => {
    const context = {}

    await api.resources.products.post({
      inputRecord: createJsonApiDocument('products', {
        name: 'Widget A',
        description: 'A great widget',
        price: 50,
        sku: 'WGT-001',
        status: 'active'
      })
    }, context)

    await api.resources.products.post({
      inputRecord: createJsonApiDocument('products', {
        name: 'Widget B',
        description: 'Another widget',
        price: 150,
        sku: 'WGT-002',
        status: 'inactive'
      })
    }, context)

    const nameResults = await api.resources.products.query({
      queryParams: {
        filters: {
          name: 'Widget A'
        }
      }
    }, context)
    assert.equal(nameResults.data.length, 1, 'Should find one product by name')
    assert.equal(nameResults.data[0].attributes.name, 'Widget A')

    const priceResults = await api.resources.products.query({
      queryParams: {
        filters: {
          price: [40, 60]
        }
      }
    }, context)
    assert.equal(priceResults.data.length, 1, 'Should find one product in price range')
    assert.equal(priceResults.data[0].attributes.price, 50)

    const statusResults = await api.resources.products.query({
      queryParams: {
        filters: {
          status: ['active']
        }
      }
    }, context)
    assert.equal(statusResults.data.length, 1, 'Should find one active product')
    assert.equal(statusResults.data[0].attributes.status, 'active')

    const skuResults = await api.resources.products.query({
      queryParams: {
        filters: {
          sku: 'WGT-002'
        }
      }
    }, context)
    assert.equal(skuResults.data.length, 1, 'Should find one product by SKU')
    assert.equal(skuResults.data[0].attributes.sku, 'WGT-002')
  })

  it('should support arbitrary public filter keys when searchSchema maps them intentionally', async () => {
    const context = {}

    await api.resources.products.post({
      inputRecord: createJsonApiDocument('products', {
        name: 'Widget Alpha',
        description: 'The great all-purpose widget',
        price: 50,
        sku: 'WGT-101',
        status: 'active'
      })
    }, context)

    await api.resources.products.post({
      inputRecord: createJsonApiDocument('products', {
        name: 'Widget Beta',
        description: 'A quiet replacement unit',
        price: 60,
        sku: 'WGT-102',
        status: 'inactive'
      })
    }, context)

    const aliasResults = await api.resources.products.query({
      queryParams: {
        filters: {
          term: 'great'
        }
      }
    }, context)

    assert.equal(aliasResults.data.length, 1, 'term should be resolved by backend search mapping')
    assert.equal(aliasResults.data[0].attributes.name, 'Widget Alpha')

    const customResults = await api.resources.products.query({
      queryParams: {
        filters: {
          availability: true
        }
      }
    }, context)

    assert.equal(customResults.data.length, 1, 'availability should be interpreted by backend custom filter logic')
    assert.equal(customResults.data[0].attributes.status, 'active')
  })
})
