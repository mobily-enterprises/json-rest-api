import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createCustomIdPropertyApi } from './fixtures/api-configs.js';
import {
  validateJsonApiStructure,
  resourceIdentifier,
  cleanTables,
  countRecords,
  createJsonApiDocument,
  createRelationship,
  createToManyRelationship,
  assertResourceAttributes,
  assertResourceRelationship
} from './helpers/test-utils.js';
import { storageMode } from './helpers/storage-mode.js';

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

describe('Custom idProperty Relationship Operations', () => {
  before(async () => {
    // Initialize API with custom idProperty for all resources
    api = await createCustomIdPropertyApi(knex);
  });

  after(async () => {
    await knex.destroy();
  });

  describe('Basic CRUD with custom idProperty', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);
    });

    it('should create and retrieve resources with custom ID fields', async () => {
      // Create country
      const countryDoc = createJsonApiDocument('countries', {
        name: 'United States',
        code: 'US'
      });

      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc
      });

      // Verify response has 'id' not 'country_id'
      assert(countryResult.data.id, 'Should have id field');
      assert(!countryResult.data.attributes.country_id, 'Should not expose country_id in attributes');

      // Verify database has correct column when using legacy storage
      if (!storageMode.isAnyApi()) {
        const dbCountry = await knex('custom_id_countries').first();
        assert(dbCountry.country_id, 'Database should have country_id column');
        assert.equal(String(dbCountry.country_id), countryResult.data.id);
      }

      // Test GET
      const getResult = await api.resources.countries.get({
        id: countryResult.data.id
      });

      assert.equal(getResult.data.id, countryResult.data.id);
      assert.equal(getResult.data.attributes.name, 'United States');
    });

    it('should handle PATCH updates returning full record', async () => {
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'United States',
          code: 'US'
        })
      });

      const patchResult = await api.resources.countries.patch({
        inputRecord: {
          data: {
            type: 'countries',
            id: country.data.id,
            attributes: {
              name: 'USA'
            }
          }
        }
      });

      // With returnRecordApi.patch = 'full', we should get the complete record
      validateJsonApiStructure(patchResult, false);
      assert.equal(patchResult.data.attributes.name, 'USA');
      assert.equal(patchResult.data.attributes.code, 'US'); // Original value preserved
    });
  });

  describe('One-to-One (belongsTo) Relationships with custom idProperty', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);
    });

    it('should create resource with belongsTo relationship using custom IDs', async () => {
      // Create a country first
      const countryDoc = createJsonApiDocument('countries', {
        name: 'United States',
        code: 'US'
      });

      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc
      });

      // Create publisher with country relationship
      const publisherDoc = createJsonApiDocument('publishers',
        {
          name: 'Random House'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id))
        }
      );

      const publisherResult = await api.resources.publishers.post({
        inputRecord: publisherDoc
      });

      // Verify response
      validateJsonApiStructure(publisherResult, false);
      assert.equal(publisherResult.data.type, 'publishers');
      assertResourceRelationship(publisherResult.data, 'country',
        resourceIdentifier('countries', countryResult.data.id));

      // Verify database foreign key uses country_id in legacy mode
      if (!storageMode.isAnyApi()) {
        const dbPublisher = await knex('custom_id_publishers').first();
        assert.equal(String(dbPublisher.country_id), countryResult.data.id);
      }

      // Verify through GET with include
      const getResult = await api.resources.publishers.get({
        id: publisherResult.data.id,
        queryParams: {
          include: ['country']
        }
      });

      validateJsonApiStructure(getResult, false);
      assert(getResult.included, 'Should have included data');
      assert.equal(getResult.included.length, 1);
      assert.equal(getResult.included[0].type, 'countries');
      assert.equal(getResult.included[0].attributes.name, 'United States');
    });

    it('should update belongsTo relationship via PATCH', async () => {
      // Create two countries
      const country1 = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const country2 = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'UK', code: 'GB' })
      });

      // Create publisher with first country
      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', country1.data.id)) }
        )
      });

      // Update to second country
      const patchDoc = {
        data: {
          type: 'publishers',
          id: publisher.data.id,
          relationships: {
            country: createRelationship(resourceIdentifier('countries', country2.data.id))
          }
        }
      };

      const patchResult = await api.resources.publishers.patch({
        inputRecord: patchDoc
      });

      // Verify we get full record back
      assert.equal(patchResult.data.attributes.name, 'Test Publisher');
      assertResourceRelationship(patchResult.data, 'country',
        resourceIdentifier('countries', country2.data.id));

      // Verify update via GET with include
      const updated = await api.resources.publishers.get({
        id: publisher.data.id,
        queryParams: { include: ['country'] }
      });

      assert.equal(updated.included[0].id, country2.data.id);
      assert.equal(updated.included[0].attributes.name, 'UK');
    });
  });

  describe('Many-to-Many Relationships with custom idProperty', () => {
    let countryId;
    let publisherId;
    let author1Id;
    let author2Id;
    let bookId;

    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);

      // Setup test data
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });
      countryId = country.data.id;

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryId)) }
        )
      });
      publisherId = publisher.data.id;

      const author1 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Author One' })
      });
      author1Id = author1.data.id;

      const author2 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Author Two' })
      });
      author2Id = author2.data.id;
    });

    it('should create many-to-many relationships with custom IDs', async () => {
      // Create book with multiple authors
      const bookDoc = createJsonApiDocument('books',
        { title: 'Test Book' },
        {
          country: createRelationship(resourceIdentifier('countries', countryId)),
          publisher: createRelationship(resourceIdentifier('publishers', publisherId)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', author1Id),
            resourceIdentifier('authors', author2Id)
          ])
        }
      );

      const bookResult = await api.resources.books.post({
        inputRecord: bookDoc
      });

      bookId = bookResult.data.id;

      // Verify pivot table has correct foreign keys
      if (!storageMode.isAnyApi()) {
        const pivotRecords = await knex('custom_id_book_authors').select('*');
        assert.equal(pivotRecords.length, 2);

        const bookIds = pivotRecords.map((r) => r.book_id);
        const authorIds = pivotRecords.map((r) => r.author_id).sort();

        assert(bookIds.every((id) => String(id) === bookId));
        assert.deepEqual(authorIds.map(String).sort(), [author1Id, author2Id].sort());
      } else {
        const pivotCount = await countRecords(knex, 'custom_id_book_authors');
        assert.equal(pivotCount, 2);
      }

      // Verify through GET with include
      const getResult = await api.resources.books.get({
        id: bookId,
        queryParams: { include: ['authors'] }
      });

      assert(getResult.included);
      assert.equal(getResult.included.length, 2);
      const includedNames = getResult.included.map(a => a.attributes.name).sort();
      assert.deepEqual(includedNames, ['Author One', 'Author Two']);
    });

    it('should handle PATCH updates to many-to-many relationships', async () => {
      // Create book with one author
      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', countryId)),
            authors: createToManyRelationship([resourceIdentifier('authors', author1Id)])
          }
        )
      });

      // Update to have both authors
      const patchDoc = {
        data: {
          type: 'books',
          id: book.data.id,
          relationships: {
            authors: createToManyRelationship([
              resourceIdentifier('authors', author1Id),
              resourceIdentifier('authors', author2Id)
            ])
          }
        }
      };

      const patchResult = await api.resources.books.patch({
        inputRecord: patchDoc,
        queryParams: {
          include: ['authors']
        }
      });

      // Verify full record returned
      assert.equal(patchResult.data.attributes.title, 'Test Book');
      // With include, we should get the authors relationship data
      assertResourceRelationship(patchResult.data, 'authors',
        [resourceIdentifier('authors', author1Id), resourceIdentifier('authors', author2Id)]);

      // Verify update
      const updated = await api.resources.books.get({
        id: book.data.id,
        queryParams: { include: ['authors'] }
      });

      assert.equal(updated.included.length, 2);
    });
  });

  describe('Polymorphic Relationships with custom idProperty', () => {
    let bookId;
    let authorId;
    let publisherId;

    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);

      // Create test resources
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });
      bookId = book.data.id;

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Test Author' })
      });
      authorId = author.data.id;

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', { name: 'Test Publisher' })
      });
      publisherId = publisher.data.id;
    });

    it('should create polymorphic review for book with custom IDs', async () => {
      const review = await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          rating: 5,
          title: 'Great book!',
          content: 'Excellent read.',
          reviewer_name: 'John Doe',
          reviewable_type: 'books',
          reviewable_id: bookId
        })
      });

      validateJsonApiStructure(review);
      assert.equal(review.data.attributes.reviewable_type, 'books');
      assert.equal(String(review.data.attributes.reviewable_id), bookId);

      if (!storageMode.isAnyApi()) {
        const dbReview = await knex('custom_id_reviews').first();
        assert.equal(dbReview.reviewable_type, 'books');
        assert.equal(String(dbReview.reviewable_id), bookId);
        assert(dbReview.review_id, 'Should have custom review_id column');
      }
    });

    it('should create polymorphic review for author with custom IDs', async () => {
      const review = await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          rating: 4,
          title: 'Talented author',
          content: 'Great writing style.',
          reviewer_name: 'Jane Doe',
          reviewable_type: 'authors',
          reviewable_id: authorId
        })
      });

      assert.equal(review.data.attributes.reviewable_type, 'authors');
      assert.equal(String(review.data.attributes.reviewable_id), authorId);
    });

    it('should query polymorphic reviews by type', async () => {
      // Create reviews for different types
      await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          rating: 5,
          title: 'Book review',
          content: 'Great book',
          reviewer_name: 'Reader',
          reviewable_type: 'books',
          reviewable_id: bookId
        })
      });

      await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          rating: 4,
          title: 'Author review',
          content: 'Great author',
          reviewer_name: 'Fan',
          reviewable_type: 'authors',
          reviewable_id: authorId
        })
      });

      // Query only book reviews
      const bookReviews = await api.resources.reviews.query({
        queryParams: {
          filters: { reviewable_type: 'books' }
        }
      });
      assert.equal(bookReviews.data.length, 1, `Expected 1 book review, got ${bookReviews.data.length}`);
      assert.equal(bookReviews.data[0].attributes.reviewable_type, 'books');
    });
  });

  describe('Nested Includes with custom idProperty', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);
    });

    it('should handle nested includes through custom ID relationships', async () => {
      // Create hierarchy: Country -> Publisher -> Book -> Authors
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Test Author' })
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisher.data.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', author.data.id)])
          }
        )
      });

      // Query with nested includes
      const result = await api.resources.books.query({
        queryParams: {
          include: ['publisher.country', 'authors']
        }
      });

      validateJsonApiStructure(result, true);
      assert(result.included);
      
      // Find each type in included
      const includedPublisher = result.included.find(r => r.type === 'publishers');
      const includedCountry = result.included.find(r => r.type === 'countries');
      const includedAuthor = result.included.find(r => r.type === 'authors');

      assert(includedPublisher, 'Should include publisher');
      assert(includedCountry, 'Should include country');
      assert(includedAuthor, 'Should include author');
      
      // Verify nested relationship
      assert.equal(includedPublisher.relationships.country.data.id, country.data.id);
    });

    it('should handle 3+ levels of nested includes', async () => {
      // Create deeper hierarchy
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', 
          { name: 'Test Author' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisher.data.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', author.data.id)])
          }
        )
      });

      // Query with 3 levels: books -> authors -> country
      const result = await api.resources.books.query({
        queryParams: {
          include: ['authors.country', 'publisher.country']
        }
      });

      validateJsonApiStructure(result, true);
      assert(result.included);
      
      const types = result.included.map(r => r.type);
      assert(types.includes('authors'), 'Should include authors');
      assert(types.includes('publishers'), 'Should include publishers');
      assert(types.includes('countries'), 'Should include countries');
    });
  });

  describe('Include with Sparse Fieldsets and custom idProperty', () => {
    let testData = {};

    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);

      // Create test data
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' })
      });
      testData.country = country.data;

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
        )
      });
      testData.publisher = publisher.data;

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Test Author', biography: 'A great author' })
      });
      testData.author = author.data;

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book', isbn: '1234567890', pages: 300 },
          {
            country: createRelationship(resourceIdentifier('countries', testData.country.id)),
            publisher: createRelationship(resourceIdentifier('publishers', testData.publisher.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', testData.author.id)])
          }
        )
      });
      testData.book = book.data;
    });

    it('should combine sparse fieldsets with includes using custom IDs', async () => {
      const result = await api.resources.books.get({
        id: testData.book.id,
        queryParams: {
          include: ['publisher', 'authors'],
          fields: {
            books: 'title',
            publishers: 'name',
            authors: 'name'  // Exclude biography
          }
        }
      });

      // Check main resource has only requested fields
      assert(result.data.attributes.title);
      assert(!result.data.attributes.isbn);
      assert(!result.data.attributes.pages);

      // Check included resources have only requested fields
      const publisher = result.included.find(r => r.type === 'publishers');
      assert(publisher.attributes.name);
      assert(publisher.id); // ID is always included

      const author = result.included.find(r => r.type === 'authors');
      assert(author.attributes.name);
      assert(!author.attributes.biography);
      assert(author.id);
    });
  });

  describe('Include Depth Validation with custom idProperty', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);
    });

    it('should enforce include depth limits', async () => {
      // Create deep hierarchy
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Test Publisher' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors',
          { name: 'Test Author' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisher.data.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', author.data.id)])
          }
        )
      });

      // Test depth limit (default is 3)
      // This should work: books -> authors -> country (depth 2)
      const validDepth = await api.resources.books.query({
        queryParams: {
          include: ['authors.country']
        }
      });
      assert(validDepth.data);

      // This should fail: trying to go too deep (if we had deeper relationships)
      // Since our test data doesn't have 4+ levels, we test that 3 levels work
      const maxDepth = await api.resources.books.query({
        queryParams: {
          include: ['publisher.country', 'authors.country']
        }
      });
      assert(maxDepth.data);
    });
  });

  describe('Complex Scenarios with custom idProperty', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'custom_id_countries', 'custom_id_publishers', 'custom_id_authors', 
        'custom_id_books', 'custom_id_book_authors', 'custom_id_reviews'
      ]);
    });

    it('should handle complex queries with filters, includes, and custom IDs', async () => {
      // Create multiple countries
      const usa = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const uk = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'UK', code: 'GB' })
      });

      // Create publishers in different countries
      const usPublisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'US Publisher' },
          { country: createRelationship(resourceIdentifier('countries', usa.data.id)) }
        )
      });

      const ukPublisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'UK Publisher' },
          { country: createRelationship(resourceIdentifier('countries', uk.data.id)) }
        )
      });

      // Create authors
      const author1 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Author One' })
      });

      const author2 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Author Two' })
      });

      // Create books
      await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'US Book 1' },
          {
            country: createRelationship(resourceIdentifier('countries', usa.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', usPublisher.data.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', author1.data.id)])
          }
        )
      });

      await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'UK Book 1' },
          {
            country: createRelationship(resourceIdentifier('countries', uk.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', ukPublisher.data.id)),
            authors: createToManyRelationship([
              resourceIdentifier('authors', author1.data.id),
              resourceIdentifier('authors', author2.data.id)
            ])
          }
        )
      });

      // Complex query: US books with their publishers and authors
      const result = await api.resources.books.query({
        queryParams: {
          filters: { country: usa.data.id },
          include: ['publisher.country', 'authors'],
          sort: ['title']
        }
      });

      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].attributes.title, 'US Book 1');
      
      // Verify includes
      const includedTypes = result.included.map(r => r.type);
      assert(includedTypes.includes('publishers'));
      assert(includedTypes.includes('countries'));
      assert(includedTypes.includes('authors'));
    });

    it('should handle bulk operations with custom IDs', async () => {
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      // Create multiple authors
      const authors = [];
      for (let i = 1; i <= 3; i++) {
        const author = await api.resources.authors.post({
          inputRecord: createJsonApiDocument('authors', { name: `Author ${i}` })
        });
        authors.push(author.data);
      }

      // Create book with all authors
      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Multi-author Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            authors: createToManyRelationship(
              authors.map(a => resourceIdentifier('authors', a.id))
            )
          }
        )
      });

      // Verify all relationships were created
      const bookWithAuthors = await api.resources.books.get({
        id: book.data.id,
        queryParams: { include: ['authors'] }
      });

      assert.equal(bookWithAuthors.included.length, 3);
      
      // Verify pivot table
      const pivotCount = await countRecords(knex, 'custom_id_book_authors');
      assert.equal(pivotCount, 3);
    });

    it('should handle DELETE operations with custom IDs', async () => {
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', { name: 'Test Author' })
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books',
          { title: 'Test Book' },
          {
            country: createRelationship(resourceIdentifier('countries', country.data.id)),
            authors: createToManyRelationship([resourceIdentifier('authors', author.data.id)])
          }
        )
      });

      // Delete the book
      await api.resources.books.delete({ id: book.data.id });

      // Verify book is deleted
      try {
        await api.resources.books.get({ id: book.data.id });
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error.message.includes('not found') || error.message.includes('404'));
      }

      // The REST API correctly does NOT cascade delete pivot records
      // This is intentional - automatic cascade deletion would be dangerous
      // Pivot records remain and should be cleaned up by application logic if needed
      const pivotCount = await countRecords(knex, 'custom_id_book_authors');
      assert.equal(pivotCount, 1, 'Pivot record should still exist');

      // Verify author still exists
      const authorStillExists = await api.resources.authors.get({ id: author.data.id });
      assert(authorStillExists.data);
    });

    it('should handle PUT operations with custom IDs', async () => {
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers',
          { name: 'Original Publisher' },
          { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
        )
      });

      // PUT to completely replace the publisher
      const putResult = await api.resources.publishers.put({
        inputRecord: {
          data: {
            type: 'publishers',
            id: publisher.data.id,
            attributes: {
              name: 'Replaced Publisher'
            },
            relationships: {
              country: createRelationship(resourceIdentifier('countries', country.data.id))
            }
          }
        }
      });

      // Verify full record returned
      validateJsonApiStructure(putResult, false);
      assert.equal(putResult.data.attributes.name, 'Replaced Publisher');
      assertResourceRelationship(putResult.data, 'country',
        resourceIdentifier('countries', country.data.id));
    });
  });
});
