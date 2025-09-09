import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument, 
  createRelationship,
  createToManyRelationship,
  resourceIdentifier,
  countRecords
} from './helpers/test-utils.js';
import { createBasicApi } from './fixtures/api-configs.js';

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

describe('Relationship Endpoints Plugin', () => {
  before(async () => {
    // Initialize API with the relationships plugin
    api = await createBasicApi(knex, {
      express: {
        mountPath: ''  // No mount path for this test
      },
      includeExpress: true
    });
  });

  after(async () => {
    // Close database connection
    await knex.destroy();
  });

  describe('Many-to-Many Relationship Endpoints', () => {
    let countryId;
    let book1Id;
    let author1Id;
    let author2Id;
    let author3Id;

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      countryId = countryResult.data.id;

      // Create a book
      const bookDoc = createJsonApiDocument('books',
        { title: 'Test Book' },
        { country: createRelationship(resourceIdentifier('countries', countryId)) }
      );
      const bookResult = await api.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });
      book1Id = bookResult.data.id;

      // Create authors
      const author1Doc = createJsonApiDocument('authors', { name: 'Author One' });
      const author1Result = await api.resources.authors.post({
        inputRecord: author1Doc,
        simplified: false
      });
      author1Id = author1Result.data.id;

      const author2Doc = createJsonApiDocument('authors', { name: 'Author Two' });
      const author2Result = await api.resources.authors.post({
        inputRecord: author2Doc,
        simplified: false
      });
      author2Id = author2Result.data.id;

      const author3Doc = createJsonApiDocument('authors', { name: 'Author Three' });
      const author3Result = await api.resources.authors.post({
        inputRecord: author3Doc,
        simplified: false
      });
      author3Id = author3Result.data.id;
    });

    it('should get empty relationship data for new book', async () => {
      const result = await api.resources.books.getRelationship({
        id: book1Id,
        relationshipName: 'authors'
      });

      assert(result.links, 'Should have links');
      assert.equal(result.links.self, `/books/${book1Id}/relationships/authors`);
      assert.equal(result.links.related, `/books/${book1Id}/authors`);
      assert(Array.isArray(result.data), 'Data should be an array');
      assert.equal(result.data.length, 0, 'Should have no authors');
    });

    it('should add authors to book via POST relationship endpoint', async () => {
      // Add authors via relationship endpoint
      await api.resources.books.postRelationship({
        id: book1Id,
        relationshipName: 'authors',
        relationshipData: [
          resourceIdentifier('authors', author1Id),
          resourceIdentifier('authors', author2Id)
        ]
      });

      // Verify authors were added via getRelationship
      const relResult = await api.resources.books.getRelationship({
        id: book1Id,
        relationshipName: 'authors'
      });

      assert.equal(relResult.data.length, 2, 'Should have 2 authors');
      assert.deepEqual(relResult.data[0], resourceIdentifier('authors', author1Id));
      assert.deepEqual(relResult.data[1], resourceIdentifier('authors', author2Id));

      // Verify pivot table records
      const pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2, 'Should have 2 pivot records');

      // Verify through GET with include
      const getResult = await api.resources.books.get({
        id: book1Id,
        queryParams: {
          include: ['authors']
        },
        simplified: false
      });

      assert(getResult.included, 'Should have included data');
      assert.equal(getResult.included.length, 2, 'Should include 2 authors');
      assert(getResult.data.relationships.authors, 'Should have authors relationship');
      assert.equal(getResult.data.relationships.authors.data.length, 2);
    });

    it('should get related resources via GET related endpoint', async () => {
      // Add authors first
      await api.resources.books.postRelationship({
        id: book1Id,
        relationshipName: 'authors',
        relationshipData: [
          resourceIdentifier('authors', author1Id),
          resourceIdentifier('authors', author2Id)
        ]
      });

      // Get related resources
      const result = await api.resources.books.getRelated({
        id: book1Id,
        relationshipName: 'authors'
      });

      // Verify response
      validateJsonApiStructure(result, true); // true for collection
      assert.equal(result.data.length, 2, 'Should have 2 authors');
      assert.equal(result.data[0].type, 'authors');
      assert.equal(result.data[1].type, 'authors');
      
      const authorNames = result.data.map(a => a.attributes.name).sort();
      assert.deepEqual(authorNames, ['Author One', 'Author Two']);
    });

    it('should remove specific authors via DELETE relationship endpoint', async () => {
      // Add all authors first
      await api.resources.books.postRelationship({
        id: book1Id,
        relationshipName: 'authors',
        relationshipData: [
          resourceIdentifier('authors', author1Id),
          resourceIdentifier('authors', author2Id),
          resourceIdentifier('authors', author3Id)
        ]
      });

      // Verify all were added
      let pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 3, 'Should have 3 pivot records');

      // Remove one author
      await api.resources.books.deleteRelationship({
        id: book1Id,
        relationshipName: 'authors',
        relationshipData: [
          resourceIdentifier('authors', author2Id)
        ]
      });

      // Verify only two authors remain
      const relResult = await api.resources.books.getRelationship({
        id: book1Id,
        relationshipName: 'authors'
      });

      assert.equal(relResult.data.length, 2, 'Should have 2 authors remaining');
      assert.deepEqual(relResult.data[0], resourceIdentifier('authors', author1Id));
      assert.deepEqual(relResult.data[1], resourceIdentifier('authors', author3Id));

      // Verify pivot table
      pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2, 'Should have 2 pivot records');
    });

    it('should handle errors when relationship does not exist', async () => {
      await assert.rejects(
        api.resources.books.getRelationship({
          id: book1Id,
          relationshipName: 'nonexistent'
        }),
        {
          message: /Relationship 'nonexistent' not found/
        }
      );
    });

    it('should handle errors when posting to belongsTo relationship', async () => {
      await assert.rejects(
        api.resources.books.postRelationship({
          id: book1Id,
          relationshipName: 'country',
          relationshipData: [
            resourceIdentifier('countries', countryId)
          ]
        }),
        {
          message: /Cannot POST to to-one relationship/
        }
      );
    });

    it('should work with inverse relationship (authors to books)', async () => {
      // First add the relationship from book side
      await api.resources.books.postRelationship({
        id: book1Id,
        relationshipName: 'authors',
        relationshipData: [
          resourceIdentifier('authors', author1Id)
        ]
      });

      // Now check from author side
      const relResult = await api.resources.authors.getRelationship({
        id: author1Id,
        relationshipName: 'books'
      });

      assert.equal(relResult.data.length, 1, 'Author should have 1 book');
      assert.deepEqual(relResult.data[0], resourceIdentifier('books', book1Id));

      // Get related books
      const booksResult = await api.resources.authors.getRelated({
        id: author1Id,
        relationshipName: 'books'
      });

      validateJsonApiStructure(booksResult, true);
      assert.equal(booksResult.data.length, 1);
      assert.equal(booksResult.data[0].attributes.title, 'Test Book');
    });
  });

  describe('One-to-Many Relationship Endpoints', () => {
    let countryId;
    let publisherId;
    let book1Id;
    let book2Id;

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      countryId = countryResult.data.id;

      // Create a publisher
      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Test Publisher' },
        { country: createRelationship(resourceIdentifier('countries', countryId)) }
      );
      const publisherResult = await api.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });
      publisherId = publisherResult.data.id;

      // Create books
      const book1Doc = createJsonApiDocument('books',
        { title: 'Book One' },
        { 
          country: createRelationship(resourceIdentifier('countries', countryId)),
          publisher: createRelationship(resourceIdentifier('publishers', publisherId))
        }
      );
      const book1Result = await api.resources.books.post({
        inputRecord: book1Doc,
        simplified: false
      });
      book1Id = book1Result.data.id;

      const book2Doc = createJsonApiDocument('books',
        { title: 'Book Two' },
        { 
          country: createRelationship(resourceIdentifier('countries', countryId)),
          publisher: createRelationship(resourceIdentifier('publishers', publisherId))
        }
      );
      const book2Result = await api.resources.books.post({
        inputRecord: book2Doc,
        simplified: false
      });
      book2Id = book2Result.data.id;
    });

    it('should get one-to-many relationship data', async () => {
      const result = await api.resources.publishers.getRelationship({
        id: publisherId,
        relationshipName: 'books'
      });

      assert(result.links, 'Should have links');
      assert.equal(result.links.self, `/publishers/${publisherId}/relationships/books`);
      assert.equal(result.links.related, `/publishers/${publisherId}/books`);
      assert(Array.isArray(result.data), 'Data should be an array');
      assert.equal(result.data.length, 2, 'Should have 2 books');
    });

    it('should get related resources for one-to-many', async () => {
      const result = await api.resources.publishers.getRelated({
        id: publisherId,
        relationshipName: 'books'
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 2);
      const titles = result.data.map(b => b.attributes.title).sort();
      assert.deepEqual(titles, ['Book One', 'Book Two']);
    });

    // Note: belongsTo relationships (like 'publisher') are not accessible via relationship endpoints
    // They are foreign key fields, not true JSON:API relationships
  });
});