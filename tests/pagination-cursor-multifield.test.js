import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import {
  validateJsonApiStructure,
  cleanTables,
  createJsonApiDocument
} from './helpers/test-utils.js'
import { createCursorPaginationApi } from './fixtures/api-configs.js'

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// API instance that persists across tests
let api

describe('Multi-field Cursor Pagination', () => {
  before(async () => {
    // Initialize API once with cursor pagination configuration
    api = await createCursorPaginationApi(knex)
  })

  after(async () => {
    // Close database connection
    await knex.destroy()
  })

  describe('Basic Multi-field Cursor Pagination', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['cursor_products'])

      // Create test data with some duplicate categories and brands
      const products = [
        { name: 'Apple', category: 'Fruit', brand: 'Fresh Farm', price: 2.50, sku: 'FF-001' },
        { name: 'Banana', category: 'Fruit', brand: 'Fresh Farm', price: 1.50, sku: 'FF-002' },
        { name: 'Cherry', category: 'Fruit', brand: 'Fresh Farm', price: 3.00, sku: 'FF-003' },
        { name: 'Date', category: 'Fruit', brand: 'Desert Delights', price: 4.00, sku: 'DD-001' },
        { name: 'Elderberry', category: 'Fruit', brand: 'Wild Harvest', price: 5.00, sku: 'WH-001' },
        { name: 'Asparagus', category: 'Vegetable', brand: 'Green Gardens', price: 3.50, sku: 'GG-001' },
        { name: 'Broccoli', category: 'Vegetable', brand: 'Green Gardens', price: 2.00, sku: 'GG-002' },
        { name: 'Carrot', category: 'Vegetable', brand: 'Root Ranch', price: 1.00, sku: 'RR-001' }
      ]

      for (const product of products) {
        await api.resources.products.post({
          inputRecord: createJsonApiDocument('products', product),
          simplified: false
        })
      }
    })

    it.skip('should handle cursor pagination with multi-field sorting without skipping records', async () => {
      // Sort by category first (which has duplicates), then by name
      const pageSize = 3
      const allProducts = []
      let cursor = null
      let pageCount = 0

      // Collect all products through cursor pagination
      while (pageCount < 10) { // Safety limit
        const result = await api.resources.products.query({
          queryParams: {
            page: {
              size: pageSize,
              ...(cursor && { after: cursor })
            },
            sort: ['category', 'name']
          },
          simplified: false
        })

        validateJsonApiStructure(result, true)
        allProducts.push(...result.data)
        pageCount++

        if (!result.meta.pagination.hasMore) {
          break
        }
        cursor = result.meta.pagination.cursor.next
      }

      // Verify we got all 8 products
      assert.equal(allProducts.length, 8, 'Should retrieve all 8 products')

      // Verify the order is correct
      const productNames = allProducts.map(p => p.attributes.name)
      const expectedOrder = [
        'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', // All Fruits in alphabetical order
        'Asparagus', 'Broccoli', 'Carrot' // All Vegetables in alphabetical order
      ]
      assert.deepEqual(productNames, expectedOrder, 'Products should be in correct order')

      // Verify no duplicates
      const ids = allProducts.map(p => p.id)
      const uniqueIds = [...new Set(ids)]
      assert.equal(ids.length, uniqueIds.length, 'Should have no duplicate products')
    })

    it.skip('should handle DESC sorting with duplicates correctly', async () => {
      // Sort by category DESC, then name ASC
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 3 },
          sort: ['-category', 'name']
        },
        simplified: false
      })

      const secondPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 3,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['-category', 'name']
        },
        simplified: false
      })

      // First page should have vegetables (category DESC)
      const firstPageCategories = firstPage.data.map(p => p.attributes.category)
      assert(firstPageCategories.every(c => c === 'Vegetable'), 'First page should only have Vegetables')

      // Second page should start with remaining vegetables or fruits
      const secondPageNames = secondPage.data.map(p => p.attributes.name)
      assert(secondPageNames.includes('Apple') || secondPageNames.includes('Banana'),
        'Second page should include fruits that come after vegetables')
    })

    it('should handle three-field sorting with multiple duplicate values', async () => {
      // Add more products with duplicate category AND brand
      await api.resources.products.post({
        inputRecord: createJsonApiDocument('products', {
          name: 'Zucchini',
          category: 'Vegetable',
          brand: 'Green Gardens',
          price: 2.50,
          sku: 'GG-003'
        }),
        simplified: false
      })

      const pageSize = 2
      const allProducts = []
      let cursor = null
      let iterations = 0

      // Sort by category, brand, then name
      while (iterations < 20) {
        const result = await api.resources.products.query({
          queryParams: {
            page: {
              size: pageSize,
              ...(cursor && { after: cursor })
            },
            sort: ['category', 'brand', 'name']
          },
          simplified: false
        })

        allProducts.push(...result.data)

        if (!result.meta.pagination.hasMore) {
          break
        }
        cursor = result.meta.pagination.cursor.next
        iterations += 1
      }

      assert(iterations < 20, 'Cursor pagination should converge within expected page count')

      // Find all Green Gardens vegetables
      const greenGardensVeggies = allProducts.filter(p =>
        p.attributes.category === 'Vegetable' &&
        p.attributes.brand === 'Green Gardens'
      )

      assert.equal(greenGardensVeggies.length, 3, 'Should have all 3 Green Gardens vegetables')

      // Verify they're in name order
      const ggNames = greenGardensVeggies.map(p => p.attributes.name)
      assert.deepEqual(ggNames, ['Asparagus', 'Broccoli', 'Zucchini'],
        'Green Gardens vegetables should be in alphabetical order by name')
    })

    it.skip('should handle cursor pagination with numeric and text fields', async () => {
      // Sort by price (numeric), then category (text), then name (text)
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 3 },
          sort: ['price', 'category', 'name']
        },
        simplified: false
      })

      // The cheapest item is Carrot at 1.00
      assert.equal(firstPage.data[0].attributes.name, 'Carrot')
      assert.equal(firstPage.data[0].attributes.price, 1.00)

      // Get second page
      const secondPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 3,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['price', 'category', 'name']
        },
        simplified: false
      })

      // Verify prices are non-decreasing across pages
      const lastPriceFirstPage = firstPage.data[firstPage.data.length - 1].attributes.price
      const firstPriceSecondPage = secondPage.data[0].attributes.price
      assert(firstPriceSecondPage >= lastPriceFirstPage,
        'Prices should be non-decreasing across pages')
    })

    it.skip('should generate correct cursor values for multi-field sorting', async () => {
      const result = await api.resources.products.query({
        queryParams: {
          page: { size: 3 },
          sort: ['category', 'name']
        },
        simplified: false
      })

      // Check that cursor is present
      assert(result.meta.pagination.cursor?.next, 'Should have next cursor')

      // The cursor should be parseable (not throwing an error)
      const cursor = result.meta.pagination.cursor.next
      assert(typeof cursor === 'string', 'Cursor should be a string')

      // Cursor should encode multiple field values
      // Since we're using the simplified format, it should contain field:value pairs
      assert(cursor.includes('category:'), 'Cursor should include category field')
      assert(cursor.includes('name:'), 'Cursor should include name field')
    })

    it.skip('should handle page[before] with multi-field sorting', async () => {
      // First, get to the middle of the dataset
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 4 },
          sort: ['category', 'name']
        },
        simplified: false
      })

      const secondPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 4,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['category', 'name']
        },
        simplified: false
      })

      // Now go backwards from the second page
      const previousPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 4,
            before: secondPage.meta.pagination.cursor?.next ||
                    // If no next cursor, create one from the last record
                    `category:${encodeURIComponent(secondPage.data[0].attributes.category)},name:${encodeURIComponent(secondPage.data[0].attributes.name)}`
          },
          sort: ['category', 'name']
        },
        simplified: false
      })

      // Verify we got different records going backwards
      const secondPageIds = secondPage.data.map(p => p.id)
      const previousPageIds = previousPage.data.map(p => p.id)
      assert(!secondPageIds.some(id => previousPageIds.includes(id)),
        'Previous page should have different records than second page')
    })
  })

  describe('Edge Cases and Special Scenarios', () => {
    beforeEach(async () => {
      await cleanTables(knex, ['cursor_products', 'cursor_items'])
    })

    it.skip('should handle all records having the same value in first sort field', async () => {
      // Create products all in the same category
      const products = [
        { name: 'Alpha', category: 'Electronics', brand: 'TechCo', price: 100, sku: 'TC-001' },
        { name: 'Beta', category: 'Electronics', brand: 'TechCo', price: 200, sku: 'TC-002' },
        { name: 'Gamma', category: 'Electronics', brand: 'GadgetInc', price: 150, sku: 'GI-001' },
        { name: 'Delta', category: 'Electronics', brand: 'GadgetInc', price: 250, sku: 'GI-002' },
        { name: 'Epsilon', category: 'Electronics', brand: 'TechCo', price: 300, sku: 'TC-003' }
      ]

      for (const product of products) {
        await api.resources.products.post({
          inputRecord: createJsonApiDocument('products', product),
          simplified: false
        })
      }

      // Sort by category (all same), then brand, then name
      const pageSize = 2
      const allProducts = []
      let cursor = null

      while (true) {
        const result = await api.resources.products.query({
          queryParams: {
            page: {
              size: pageSize,
              ...(cursor && { after: cursor })
            },
            sort: ['category', 'brand', 'name']
          },
          simplified: false
        })

        allProducts.push(...result.data)

        if (!result.meta.pagination.hasMore) {
          break
        }
        cursor = result.meta.pagination.cursor.next
      }

      assert.equal(allProducts.length, 5, 'Should get all 5 products')

      // Check order: should be grouped by brand, then by name
      const productInfo = allProducts.map(p => ({
        brand: p.attributes.brand,
        name: p.attributes.name
      }))

      // GadgetInc should come before TechCo
      const gadgetIncIndex = productInfo.findIndex(p => p.brand === 'GadgetInc')
      const firstTechCoIndex = productInfo.findIndex(p => p.brand === 'TechCo')
      assert(gadgetIncIndex < firstTechCoIndex, 'GadgetInc products should come before TechCo')
    })

    it.skip('should handle empty results with multi-field cursor', async () => {
      // Create one product
      await api.resources.products.post({
        inputRecord: createJsonApiDocument('products', {
          name: 'Single Product',
          category: 'Misc',
          brand: 'Generic',
          price: 10,
          sku: 'GEN-001'
        }),
        simplified: false
      })

      // Get the first (and only) page
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 5 },
          sort: ['category', 'name']
        },
        simplified: false
      })

      assert.equal(firstPage.data.length, 1)
      assert.equal(firstPage.meta.pagination.hasMore, false)
      assert(!firstPage.meta.pagination.cursor?.next, 'Should not have next cursor on last page')
    })

    it.skip('should handle special characters in multi-field cursors', async () => {
      // Create products with special characters
      const products = [
        { name: 'Product: Special', category: 'Cat:1', brand: 'Brand,A', price: 10, sku: 'SP-001' },
        { name: 'Product: Extra', category: 'Cat:1', brand: 'Brand,B', price: 20, sku: 'SP-002' },
        { name: 'Product: Normal', category: 'Cat:2', brand: 'Brand,A', price: 15, sku: 'SP-003' }
      ]

      for (const product of products) {
        await api.resources.products.post({
          inputRecord: createJsonApiDocument('products', product),
          simplified: false
        })
      }

      // Navigate through pages
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 1 },
          sort: ['category', 'brand', 'name']
        },
        simplified: false
      })

      assert(firstPage.meta.pagination.cursor?.next, 'Should have cursor')

      // Use the cursor to get next page - should not throw
      const secondPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 1,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['category', 'brand', 'name']
        },
        simplified: false
      })

      assert.equal(secondPage.data.length, 1)
      assert.notEqual(secondPage.data[0].id, firstPage.data[0].id,
        'Should get different record on second page')
    })

    it.skip('should maintain stable sorting with custom id property', async () => {
      // Create items using the resource with custom ID property
      const items = [
        { code: 'A001', name: 'Apple', category: 'Fruit', type: 'Fresh' },
        { code: 'A002', name: 'Apricot', category: 'Fruit', type: 'Fresh' },
        { code: 'B001', name: 'Banana', category: 'Fruit', type: 'Fresh' },
        { code: 'C001', name: 'Carrot', category: 'Vegetable', type: 'Root' }
      ]

      for (const item of items) {
        await api.resources.items.post({
          inputRecord: createJsonApiDocument('items', item),
          simplified: false
        })
      }

      // Query with multi-field sort
      const result = await api.resources.items.query({
        queryParams: {
          page: { size: 2 },
          sort: ['category', 'name']
        },
        simplified: false
      })

      // Should use 'item_id' as the ID field in responses
      assert(result.data[0].id, 'Should have id field')
      assert(typeof result.data[0].id === 'string', 'ID should be a string')

      // Cursor should work with custom ID
      if (result.meta.pagination.cursor?.next) {
        const secondPage = await api.resources.items.query({
          queryParams: {
            page: {
              size: 2,
              after: result.meta.pagination.cursor.next
            },
            sort: ['category', 'name']
          },
          simplified: false
        })

        assert(secondPage.data.length > 0, 'Should get results on second page')
      }
    })

    it.skip('should handle the exact bug scenario - multiple fruits with same category', async () => {
      // This is the exact scenario from the bug report
      await cleanTables(knex, ['cursor_products'])

      const products = [
        { name: 'Apple', category: 'Fruit', brand: 'Farm Fresh', price: 2.00, sku: 'FRUIT-001' },
        { name: 'Banana', category: 'Fruit', brand: 'Farm Fresh', price: 1.50, sku: 'FRUIT-002' },
        { name: 'Cherry', category: 'Fruit', brand: 'Farm Fresh', price: 3.00, sku: 'FRUIT-003' },
        { name: 'Date', category: 'Fruit', brand: 'Desert Farm', price: 4.00, sku: 'FRUIT-004' },
        { name: 'Asparagus', category: 'Vegetable', brand: 'Green Farm', price: 2.50, sku: 'VEG-001' }
      ]

      for (const product of products) {
        await api.resources.products.post({
          inputRecord: createJsonApiDocument('products', product),
          simplified: false
        })
      }

      // Get first page with size 3 (should get Apple, Banana, Cherry)
      const firstPage = await api.resources.products.query({
        queryParams: {
          page: { size: 3 },
          sort: ['category', 'name']
        },
        simplified: false
      })

      assert.equal(firstPage.data.length, 3)
      const firstPageNames = firstPage.data.map(p => p.attributes.name)
      assert.deepEqual(firstPageNames, ['Apple', 'Banana', 'Cherry'])

      // Get second page - MUST include Date (the bug would skip it)
      const secondPage = await api.resources.products.query({
        queryParams: {
          page: {
            size: 3,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['category', 'name']
        },
        simplified: false
      })

      const secondPageNames = secondPage.data.map(p => p.attributes.name)
      assert(secondPageNames.includes('Date'),
        'Second page MUST include Date - this was the bug where it would be skipped')
      assert.deepEqual(secondPageNames, ['Date', 'Asparagus'],
        'Second page should have Date and Asparagus in that order')
    })
  })
})
