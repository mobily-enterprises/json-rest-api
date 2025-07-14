import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createBasicApi, createLimitedDepthApi } from './fixtures/api-configs.js';
import { cleanTables } from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Include Depth Validation', () => {
  let api;

  before(async () => {
    // Initialize API with custom includeDepthLimit
    api = await createBasicApi(knex, {
      'rest-api': {
        includeDepthLimit: 3 // Default is 3, but being explicit
      }
    });

    // Set up test data with nested relationships
    // Country -> Publisher -> Author -> Book
    await cleanTables(knex, [
      'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books'
    ]);

    const country = await api.resources.countries.post({
      inputRecord: {
        data: {
          type: 'countries',
          attributes: { name: 'USA', code: 'US' }
        }
      }
    });

    const publisher = await api.resources.publishers.post({
      inputRecord: {
        data: {
          type: 'publishers',
          attributes: { name: 'Test Publisher' },
          relationships: {
            country: { data: { type: 'countries', id: country.data.id } }
          }
        }
      }
    });

    const author = await api.resources.authors.post({
      inputRecord: {
        data: {
          type: 'authors',
          attributes: { name: 'Test Author' },
          relationships: {
            publisher: { data: { type: 'publishers', id: publisher.data.id } }
          }
        }
      }
    });

    await api.resources.books.post({
      inputRecord: {
        data: {
          type: 'books',
          attributes: { title: 'Test Book' },
          relationships: {
            country: { data: { type: 'countries', id: country.data.id } },
            publisher: { data: { type: 'publishers', id: publisher.data.id } }
          }
        }
      }
    });
  });

  after(async () => {
    await knex.destroy();
  });

  describe('Query endpoint validation', () => {
    it('should allow includes within depth limit', async () => {
      // Depth 1
      const depth1 = await api.resources.publishers.query({
        queryParams: { include: ['country'] }
      });
      assert(depth1.data.length > 0, 'Should return publishers');
      assert(depth1.included, 'Should have included resources');

      // Depth 2
      const depth2 = await api.resources.authors.query({
        queryParams: { include: ['publisher.country'] }
      });
      assert(depth2.data.length > 0, 'Should return authors');
      // The included array may or may not be present depending on whether relationships exist

      // Depth 3 (at limit)
      const depth3 = await api.resources.books.query({
        queryParams: { include: ['publisher.country.publishers'] }
      });
      assert(depth3.data.length > 0, 'Should return books');
      // Note: The included array might be present even if some relationships don't have data
    });

    it('should reject includes exceeding depth limit', async () => {
      await assert.rejects(
        async () => {
          await api.resources.books.query({
            queryParams: { include: ['publisher.country.publishers.books'] }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /Include path.*exceeds maximum depth of 3/
        },
        'Should reject depth 4'
      );

      await assert.rejects(
        async () => {
          await api.resources.books.query({
            queryParams: { include: ['publisher.country.publishers.books.authors'] }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /Include path.*exceeds maximum depth of 3/
        },
        'Should reject depth 5'
      );
    });

    it('should validate each include path independently', async () => {
      await assert.rejects(
        async () => {
          await api.resources.books.query({
            queryParams: { 
              include: [
                'publisher',  // Valid (depth 1)
                'publisher.country',  // Valid (depth 2)
                'publisher.country.publishers.books'  // Invalid (depth 4)
              ] 
            }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /publisher\.country\.publishers\.books.*exceeds maximum depth of 3/
        },
        'Should reject when any path exceeds limit'
      );
    });
  });

  describe('Get endpoint validation', () => {
    it('should allow includes within depth limit', async () => {
      const books = await api.resources.books.query();
      const bookId = books.data[0].id;

      // Depth 1
      const depth1 = await api.resources.books.get({
        id: bookId,
        queryParams: { include: ['publisher'] }
      });
      assert(depth1.data.id === bookId, 'Should return correct book');
      assert(depth1.included, 'Should have included resources');

      // Depth 3 (at limit)
      const depth3 = await api.resources.books.get({
        id: bookId,
        queryParams: { include: ['publisher.country.publishers'] }
      });
      assert(depth3.data.id === bookId, 'Should return correct book');
    });

    it('should reject includes exceeding depth limit', async () => {
      const books = await api.resources.books.query();
      const bookId = books.data[0].id;

      await assert.rejects(
        async () => {
          await api.resources.books.get({
            id: bookId,
            queryParams: { include: ['publisher.country.publishers.books'] }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /Include path.*exceeds maximum depth of 3/
        },
        'Should reject depth 4 on GET'
      );
    });
  });

  describe('Custom depth limits', () => {
    it('should respect custom includeDepthLimit configuration', async () => {
      // Create API with depth limit of 2 and different table names
      const limitedApi = await createLimitedDepthApi(knex);

      // Set up test data for limited API
      await cleanTables(knex, [
        'limited_countries', 'limited_publishers', 'limited_authors', 'limited_books', 'limited_book_authors'
      ]);

      const country = await limitedApi.resources.countries.post({
        inputRecord: {
          data: {
            type: 'countries',
            attributes: { name: 'Limited Country', code: 'LC' }
          }
        }
      });

      const publisher = await limitedApi.resources.publishers.post({
        inputRecord: {
          data: {
            type: 'publishers',
            attributes: { name: 'Limited Publisher' },
            relationships: {
              country: { data: { type: 'countries', id: country.data.id } }
            }
          }
        }
      });

      const author = await limitedApi.resources.authors.post({
        inputRecord: {
          data: {
            type: 'authors',
            attributes: { name: 'Limited Author' },
            relationships: {
              publisher: { data: { type: 'publishers', id: publisher.data.id } }
            }
          }
        }
      });

      // Depth 2 should work
      const depth2 = await limitedApi.resources.authors.query({
        queryParams: { include: ['publisher.country'] }
      });
      assert(depth2.data.length > 0, 'Should return authors');

      // Depth 3 should fail
      await assert.rejects(
        async () => {
          await limitedApi.resources.books.query({
            queryParams: { include: ['publisher.country.publishers'] }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /Include path.*exceeds maximum depth of 2/
        },
        'Should reject depth 3 with custom limit of 2'
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle empty include arrays', async () => {
      const result = await api.resources.books.query({
        queryParams: { include: [] }
      });
      assert(result.data.length > 0, 'Should return books');
      assert(!result.included, 'Should not have included resources');
    });

    it('should handle single-level paths correctly', async () => {
      const result = await api.resources.books.query({
        queryParams: { include: ['publisher'] }
      });
      assert(result.data.length > 0, 'Should return books');
      assert(result.included, 'Should have included resources');
    });

    it('should count depth correctly with dots in path', async () => {
      // "a.b.c" = depth 3
      await assert.rejects(
        async () => {
          await api.resources.books.query({
            queryParams: { include: ['a.b.c.d'] }
          });
        },
        {
          name: 'RestApiValidationError',
          message: /Include path 'a\.b\.c\.d' exceeds maximum depth of 3/
        },
        'Should count dots correctly'
      );
    });
  });
});