import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { createBulkOperationsApi } from './fixtures/api-configs.js'
import {
  validateJsonApiStructure,
  resourceIdentifier,
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  createToManyRelationship
} from './helpers/test-utils.js'

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

describe('Bulk Operations', () => {
  before(async () => {
    // Initialize API once
    api = await createBulkOperationsApi(knex)
  })

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy()
  })

  describe('Bulk Create (bulkPost)', () => {
    beforeEach(async () => {
      // Clean all tables before each test
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ])
    })

    it('should create multiple records atomically', async () => {
      const records = [
        createJsonApiDocument('authors', { name: 'Author One' }),
        createJsonApiDocument('authors', { name: 'Author Two' }),
        createJsonApiDocument('authors', { name: 'Author Three' })
      ]

      const result = await api.scopes.authors.bulkPost({
        inputRecords: records,
        atomic: true
      })

      // Validate response structure
      assert(result.data, 'Should have data array')
      assert(Array.isArray(result.data), 'Data should be an array')
      assert.equal(result.data.length, 3, 'Should return 3 created records')

      // Validate meta
      assert.equal(result.meta.total, 3)
      assert.equal(result.meta.succeeded, 3)
      assert.equal(result.meta.failed, 0)
      assert.equal(result.meta.atomic, true)

      // Validate each created record
      result.data.forEach((record, index) => {
        validateJsonApiStructure({ data: record }, false)
        assert.equal(record.type, 'authors')
        assert(record.id, 'Should have generated ID')
        assert.equal(record.attributes.name, `Author ${['One', 'Two', 'Three'][index]}`)
      })

      // Verify via API query
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 3, 'Should have 3 records via query')
    })

    it('should rollback all records on error in atomic mode', async () => {
      const records = [
        createJsonApiDocument('authors', { name: 'Valid Author' }),
        createJsonApiDocument('authors', {}), // Invalid - missing required name
        createJsonApiDocument('authors', { name: 'Another Valid' })
      ]

      try {
        await api.scopes.authors.bulkPost({
          inputRecords: records,
          atomic: true
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert(error.message.includes('validation failed') || error.message.includes('required'), 'Error should mention validation or required field')
      }

      // Verify no records were created via API
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 0, 'Should have no records due to rollback')
    })

    it('should allow partial success in non-atomic mode', async () => {
      const records = [
        createJsonApiDocument('authors', { name: 'Valid Author 1' }),
        createJsonApiDocument('authors', {}), // Invalid
        createJsonApiDocument('authors', { name: 'Valid Author 2' }),
        createJsonApiDocument('authors', { name: 'Valid Author 3' })
      ]

      const result = await api.scopes.authors.bulkPost({
        inputRecords: records,
        atomic: false
      })

      // Check succeeded records
      assert.equal(result.data.length, 3, 'Should have 3 successful records')
      assert.equal(result.meta.succeeded, 3)
      assert.equal(result.meta.failed, 1)

      // Check errors
      assert(result.errors, 'Should have errors array')
      assert.equal(result.errors.length, 1)

      // Error should be for missing name
      assert.equal(result.errors[0].index, 1)
      assert(result.errors[0].error.message.includes('validation failed') || result.errors[0].error.message.includes('required'))

      // Verify via API
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 3)
    })

    it('should create records with relationships', async () => {
      // First create a country
      const countryResult = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' }),
        simplified: false
      })

      const records = [
        createJsonApiDocument('publishers',
          { name: 'Publisher One' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        ),
        createJsonApiDocument('publishers',
          { name: 'Publisher Two' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
      ]

      const result = await api.scopes.publishers.bulkPost({
        inputRecords: records
      })

      assert.equal(result.data.length, 2)
      result.data.forEach(publisher => {
        assert.equal(publisher.relationships.country.data.id, countryResult.data.id)
      })
    })

    it('should enforce max bulk operations limit', async () => {
      const tooManyRecords = Array.from({ length: 101 }, (_, i) =>
        createJsonApiDocument('authors', { name: `Author ${i}` })
      )

      try {
        await api.scopes.authors.bulkPost({
          inputRecords: tooManyRecords
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert(error.message.includes('limited to 100'))
      }
    })

    it('should respect atomic query parameter override', async () => {
      const records = [
        createJsonApiDocument('authors', { name: 'Valid' }),
        createJsonApiDocument('authors', {}) // Invalid
      ]

      // Override default atomic mode
      const result = await api.scopes.authors.bulkPost({
        inputRecords: records,
        atomic: false // Override to non-atomic
      })

      assert.equal(result.meta.succeeded, 1)
      assert.equal(result.meta.failed, 1)
      assert.equal(result.meta.atomic, false)
    })
  })

  describe('Bulk Update (bulkPatch)', () => {
    const testData = {}

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ])

      // Create test data via API
      const authors = await Promise.all([
        api.resources.authors.post({
          inputRecord: createJsonApiDocument('authors', { name: 'Author One' }),
          simplified: false
        }),
        api.resources.authors.post({
          inputRecord: createJsonApiDocument('authors', { name: 'Author Two' }),
          simplified: false
        }),
        api.resources.authors.post({
          inputRecord: createJsonApiDocument('authors', { name: 'Author Three' }),
          simplified: false
        })
      ])

      testData.authorIds = authors.map(a => a.data.id)
    })

    it('should update multiple records atomically', async () => {
      const operations = [
        {
          id: testData.authorIds[0],
          data: {
            type: 'authors',
            id: testData.authorIds[0],
            attributes: { name: 'Updated Author One' }
          }
        },
        {
          id: testData.authorIds[1],
          data: {
            type: 'authors',
            id: testData.authorIds[1],
            attributes: { name: 'Updated Author Two' }
          }
        }
      ]

      const result = await api.scopes.authors.bulkPatch({
        operations,
        atomic: true
      })

      assert.equal(result.data.length, 2)
      assert.equal(result.meta.succeeded, 2)
      assert.equal(result.meta.failed, 0)

      // Verify updates in response
      assert.equal(result.data[0].attributes.name, 'Updated Author One')
      assert.equal(result.data[1].attributes.name, 'Updated Author Two')

      // Verify via API
      const author1 = await api.resources.authors.get({
        id: testData.authorIds[0],
        simplified: false
      })
      assert.equal(author1.data.attributes.name, 'Updated Author One')
    })

    it('should handle non-existent IDs in non-atomic mode', async () => {
      const operations = [
        {
          id: testData.authorIds[0],
          data: {
            type: 'authors',
            id: testData.authorIds[0],
            attributes: { name: 'Updated' }
          }
        },
        {
          id: '999999', // Non-existent
          data: {
            type: 'authors',
            id: '999999',
            attributes: { name: 'Should Fail' }
          }
        },
        {
          id: testData.authorIds[2],
          data: {
            type: 'authors',
            id: testData.authorIds[2],
            attributes: { name: 'Also Updated' }
          }
        }
      ]

      const result = await api.scopes.authors.bulkPatch({
        operations,
        atomic: false
      })

      assert.equal(result.meta.succeeded, 2)
      assert.equal(result.meta.failed, 1)
      assert.equal(result.errors.length, 1)
      assert.equal(result.errors[0].id, '999999')
    })

    it('should validate operation structure', async () => {
      const invalidOperations = [
        { id: testData.authorIds[0] }, // Missing data
        { data: { type: 'authors', attributes: { name: 'Test' } } }, // Missing id
        {
          id: testData.authorIds[1],
          data: {
            type: 'authors',
            id: testData.authorIds[1],
            attributes: { name: 'Valid' }
          }
        }
      ]

      const result = await api.scopes.authors.bulkPatch({
        operations: invalidOperations,
        atomic: false
      })

      assert.equal(result.meta.succeeded, 1)
      assert.equal(result.meta.failed, 2)
      assert.equal(result.errors[0].error.code, 'INVALID_OPERATION')
      assert.equal(result.errors[1].error.code, 'INVALID_OPERATION')
    })

    it('should rollback all updates on error in atomic mode', async () => {
      // Get original name via API
      const originalAuthor = await api.resources.authors.get({
        id: testData.authorIds[0],
        simplified: false
      })

      const operations = [
        {
          id: testData.authorIds[0],
          data: {
            type: 'authors',
            id: testData.authorIds[0],
            attributes: { name: 'Should Be Rolled Back' }
          }
        },
        {
          id: '999999', // Will fail
          data: {
            type: 'authors',
            id: '999999',
            attributes: { name: 'Non-existent' }
          }
        }
      ]

      try {
        await api.scopes.authors.bulkPatch({
          operations,
          atomic: true
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        // Expected error
      }

      // Verify no changes were made via API
      const author = await api.resources.authors.get({
        id: testData.authorIds[0],
        simplified: false
      })
      assert.equal(author.data.attributes.name, originalAuthor.data.attributes.name, 'Name should not have changed')
    })
  })

  describe('Bulk Delete (bulkDelete)', () => {
    const testData = {}

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ])

      // Create test data via API
      const authors = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          api.resources.authors.post({
            inputRecord: createJsonApiDocument('authors', { name: `Author ${i + 1}` }),
            simplified: false
          })
        )
      )

      testData.authorIds = authors.map(a => a.data.id)
    })

    it('should delete multiple records atomically', async () => {
      const idsToDelete = [testData.authorIds[0], testData.authorIds[2], testData.authorIds[4]]

      const result = await api.scopes.authors.bulkDelete({
        ids: idsToDelete,
        atomic: true
      })

      assert.equal(result.meta.total, 3)
      assert.equal(result.meta.succeeded, 3)
      assert.equal(result.meta.failed, 0)
      assert.deepEqual(result.meta.deleted, idsToDelete)

      // Verify via API query
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 2, 'Should have 2 remaining records')

      // Verify specific records were deleted
      const remainingIds = queryResult.data.map(r => r.id)
      assert(!remainingIds.includes(testData.authorIds[0]))
      assert(remainingIds.includes(testData.authorIds[1]))
      assert(!remainingIds.includes(testData.authorIds[2]))
    })

    it('should handle mixed valid/invalid IDs in non-atomic mode', async () => {
      const idsToDelete = [
        testData.authorIds[0],
        '999999', // Non-existent
        testData.authorIds[2],
        '888888', // Non-existent
        testData.authorIds[4]
      ]

      const result = await api.scopes.authors.bulkDelete({
        ids: idsToDelete,
        atomic: false
      })

      assert.equal(result.meta.total, 5)
      assert.equal(result.meta.succeeded, 3)
      assert.equal(result.meta.failed, 2)
      assert.equal(result.meta.deleted.length, 3)

      assert.equal(result.errors.length, 2)
      assert.equal(result.errors[0].id, '999999')
      assert.equal(result.errors[1].id, '888888')

      // Verify correct records were deleted via API
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 2)
    })

    it('should rollback all deletes on error in atomic mode', async () => {
      const idsToDelete = [
        testData.authorIds[0],
        testData.authorIds[1],
        '999999' // Will fail
      ]

      try {
        await api.scopes.authors.bulkDelete({
          ids: idsToDelete,
          atomic: true
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        // Expected error
      }

      // Verify no records were deleted via API
      const queryResult = await api.resources.authors.query({ simplified: false })
      assert.equal(queryResult.data.length, 5, 'Should still have all 5 records')
    })

    it('should handle empty ID array', async () => {
      try {
        await api.scopes.authors.bulkDelete({
          ids: []
        })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert(error.message.includes('array'))
      }
    })

    it('should respect relationships when deleting', async () => {
      // Create country and publishers with relationship
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' }),
        simplified: false
      })

      const publishers = await Promise.all([
        api.resources.publishers.post({
          inputRecord: createJsonApiDocument('publishers',
            { name: 'Publisher 1' },
            { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
          ),
          simplified: false
        }),
        api.resources.publishers.post({
          inputRecord: createJsonApiDocument('publishers',
            { name: 'Publisher 2' },
            { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
          ),
          simplified: false
        })
      ])

      // Create books referencing publishers
      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publishers[0].data.id))
          }
        ),
        simplified: false
      })

      // Try to delete publisher that has books
      const publisherIds = publishers.map(p => p.data.id)

      const result = await api.scopes.publishers.bulkDelete({
        ids: publisherIds,
        atomic: false
      })

      // At least one should succeed (the one without books)
      assert(result.meta.succeeded >= 1)
    })
  })

  describe('Batch Processing', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ])
    })

    it('should process large batches correctly', async () => {
      // Create 50 records to test batching (batch size is 10 in config)
      const records = Array.from({ length: 50 }, (_, i) =>
        createJsonApiDocument('authors', { name: `Batch Author ${i + 1}` })
      )

      const result = await api.scopes.authors.bulkPost({
        inputRecords: records,
        atomic: true
      })

      assert.equal(result.meta.total, 50)
      assert.equal(result.meta.succeeded, 50)
      assert.equal(result.data.length, 50)

      // Verify via API with increased page size
      const queryResult = await api.resources.authors.query({
        simplified: false,
        queryParams: { page: { size: 100 } }
      })
      assert.equal(queryResult.data.length, 50)
    })
  })

  describe('Complex Scenarios', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ])
    })

    it('should handle mixed operations workflow', async () => {
      // Step 1: Bulk create authors
      const authorRecords = Array.from({ length: 5 }, (_, i) =>
        createJsonApiDocument('authors', { name: `Author ${i + 1}` })
      )

      const createResult = await api.scopes.authors.bulkPost({
        inputRecords: authorRecords
      })

      const authorIds = createResult.data.map(a => a.id)

      // Step 2: Bulk update some of them
      const updateOperations = [
        {
          id: authorIds[0],
          data: {
            type: 'authors',
            id: authorIds[0],
            attributes: { name: 'Senior Author 1' }
          }
        },
        {
          id: authorIds[2],
          data: {
            type: 'authors',
            id: authorIds[2],
            attributes: { name: 'Senior Author 3' }
          }
        }
      ]

      const updateResult = await api.scopes.authors.bulkPatch({
        operations: updateOperations
      })

      assert.equal(updateResult.meta.succeeded, 2)

      // Step 3: Bulk delete some others
      const deleteResult = await api.scopes.authors.bulkDelete({
        ids: [authorIds[3], authorIds[4]]
      })

      assert.equal(deleteResult.meta.succeeded, 2)

      // Verify final state via API
      const finalQuery = await api.resources.authors.query({ simplified: false })
      assert.equal(finalQuery.data.length, 3)

      // Check for senior authors
      const seniorAuthors = finalQuery.data.filter(a => a.attributes.name.includes('Senior'))
      assert.equal(seniorAuthors.length, 2)
    })

    it('should maintain data integrity with relationships', async () => {
      // Create countries
      const countryResult = await api.scopes.countries.bulkPost({
        inputRecords: [
          createJsonApiDocument('countries', { name: 'USA', code: 'US' }),
          createJsonApiDocument('countries', { name: 'UK', code: 'GB' })
        ]
      })

      const countryIds = countryResult.data.map(c => c.id)

      // Create publishers with country relationships
      const publisherRecords = [
        createJsonApiDocument('publishers',
          { name: 'US Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryIds[0])) }
        ),
        createJsonApiDocument('publishers',
          { name: 'UK Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryIds[1])) }
        )
      ]

      const publisherResult = await api.scopes.publishers.bulkPost({
        inputRecords: publisherRecords
      })

      assert.equal(publisherResult.data.length, 2)

      // Verify relationships were set correctly via API
      const allPublishers = await api.resources.publishers.query({
        simplified: false
      })
      const usPublisher = allPublishers.data.find(p => p.attributes.name === 'US Publisher')
      assert(usPublisher, 'Should find US Publisher')
      assert.equal(usPublisher.relationships.country.data.id, countryIds[0])
    })
  })
})
