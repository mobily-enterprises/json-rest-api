import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { createBasicApi, createExtendedApi } from './fixtures/api-configs.js';
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

// Create Knex instance for tests
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instances that persist across tests
let basicApi;
let extendedApi;

describe('Relationship Operations', () => {
  before(async () => {
    // Initialize APIs once
    basicApi = await createBasicApi(knex);
    extendedApi = await createExtendedApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('One-to-One (belongsTo) Relationships', () => {
    beforeEach(async () => {
      // Clean all tables before each test
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);
    });

    it('should create resource with belongsTo relationship', async () => {
      // Create a country first
      const countryDoc = createJsonApiDocument('countries', {
        name: 'United States',
        code: 'US'
      });

      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
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

      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      // Verify response
      validateJsonApiStructure(publisherResult, false);
      assert.equal(publisherResult.data.type, 'publishers');
      assertResourceRelationship(publisherResult.data, 'country',
        resourceIdentifier('countries', countryResult.data.id));

      // Verify through GET with include
      const getResult = await basicApi.resources.publishers.get({
        id: publisherResult.data.id,
        queryParams: {
          include: ['country']
        },
        simplified: false
      });

      validateJsonApiStructure(getResult, false);
      assert(getResult.included, 'Should have included data');
      assert.equal(getResult.included.length, 1);
      assert.equal(getResult.included[0].type, 'countries');
      assert.equal(getResult.included[0].attributes.name, 'United States');
    });

    it('should update belongsTo relationship via PATCH', async () => {
      // Create two countries
      const usDoc = createJsonApiDocument('countries', { name: 'United States', code: 'US' });
      const ukDoc = createJsonApiDocument('countries', { name: 'United Kingdom', code: 'UK' });

      const usResult = await basicApi.resources.countries.post({
        inputRecord: usDoc,
        simplified: false
      });

      const ukResult = await basicApi.resources.countries.post({
        inputRecord: ukDoc,
        simplified: false
      });

      // Create publisher with US country
      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Test Publisher' },
        { country: createRelationship(resourceIdentifier('countries', usResult.data.id)) }
      );

      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      // Update publisher to UK country
      const patchDoc = {
        data: {
          type: 'publishers',
          id: String(publisherResult.data.id),
          relationships: {
            country: createRelationship(resourceIdentifier('countries', ukResult.data.id))
          }
        }
      };

      await basicApi.resources.publishers.patch({
        id: publisherResult.data.id,
        inputRecord: patchDoc,
        simplified: false
      });

      // Verify update
      const getResult = await basicApi.resources.publishers.get({
        id: publisherResult.data.id,
        queryParams: { include: ['country'] },
        simplified: false
      });

      assertResourceRelationship(getResult.data, 'country',
        resourceIdentifier('countries', ukResult.data.id));
      assert.equal(getResult.included[0].attributes.code, 'UK');
    });

    it('should clear belongsTo relationship with null', async () => {
      // Create country and publisher
      const countryDoc = createJsonApiDocument('countries', { name: 'France', code: 'FR' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'French Publisher' },
        { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
      );

      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      // Clear the relationship
      const patchDoc = {
        data: {
          type: 'publishers',
          id: String(publisherResult.data.id),
          relationships: {
            country: { data: null }
          }
        }
      };

      await basicApi.resources.publishers.patch({
        id: publisherResult.data.id,
        inputRecord: patchDoc,
        simplified: false
      });

      // Verify relationship cleared
      const getResult = await basicApi.resources.publishers.get({
        id: publisherResult.data.id,
        simplified: false
      });

      assert(getResult.data.relationships);
      assert.equal(getResult.data.relationships.country.data, null);
    });
  });

  describe('Many-to-Many Relationships', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);
    });

    it('should create book with multiple authors (many-to-many)', async () => {
      // Create country for book
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create authors
      const author1Doc = createJsonApiDocument('authors', { name: 'Stephen King' });
      const author2Doc = createJsonApiDocument('authors', { name: 'Peter Straub' });

      const author1Result = await basicApi.resources.authors.post({
        inputRecord: author1Doc,
        simplified: false
      });

      const author2Result = await basicApi.resources.authors.post({
        inputRecord: author2Doc,
        simplified: false
      });

      // Create book with authors
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'The Talisman'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', author1Result.data.id),
            resourceIdentifier('authors', author2Result.data.id)
          ])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // Verify response
      validateJsonApiStructure(bookResult, false);
      assert.equal(bookResult.data.type, 'books');

      // Verify pivot table records created
      const pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2, 'Should have created 2 pivot records');

      // GET book with authors included
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        queryParams: { include: ['authors'] },
        simplified: false
      });

      validateJsonApiStructure(getResult, false);
      assert(getResult.data.relationships.authors);
      assert.equal(getResult.data.relationships.authors.data.length, 2);
      
      // Verify included authors
      assert(getResult.included);
      assert.equal(getResult.included.length, 2);
      const authorNames = getResult.included.map(a => a.attributes.name).sort();
      assert.deepEqual(authorNames, ['Peter Straub', 'Stephen King']);
    });

    it('should update many-to-many relationships via PUT (complete replacement)', async () => {
      // Create country
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create 4 authors
      const authors = [];
      for (const name of ['Author 1', 'Author 2', 'Author 3', 'Author 4']) {
        const doc = createJsonApiDocument('authors', { name });
        const result = await basicApi.resources.authors.post({
          inputRecord: doc,
          simplified: false
        });
        authors.push(result.data);
      }

      // Create book with first 2 authors
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Test Book'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', authors[0].id),
            resourceIdentifier('authors', authors[1].id)
          ])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // Verify initial state
      let pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2);

      // PUT to replace with different 2 authors
      const putDoc = {
        data: {
          type: 'books',
          id: String(bookResult.data.id),
          attributes: {
            title: 'Test Book'
          },
          relationships: {
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            authors: createToManyRelationship([
              resourceIdentifier('authors', authors[2].id),
              resourceIdentifier('authors', authors[3].id)
            ])
          }
        }
      };

      await basicApi.resources.books.put({
        id: bookResult.data.id,
        inputRecord: putDoc,
        simplified: false,
        returnFullRecord: false
      });

      // Verify old pivot records removed, new ones created
      pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2);

      // GET to verify new relationships
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        queryParams: { include: ['authors'] },
        simplified: false
      });

      const authorIds = getResult.data.relationships.authors.data.map(a => a.id).sort();
      assert.deepEqual(authorIds, [authors[2].id, authors[3].id].sort());
    });

    it('should update many-to-many relationships via PATCH (partial update)', async () => {
      // Create country
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create 4 authors
      const authors = [];
      for (const name of ['Author A', 'Author B', 'Author C', 'Author D']) {
        const doc = createJsonApiDocument('authors', { name });
        const result = await basicApi.resources.authors.post({
          inputRecord: doc,
          simplified: false
        });
        authors.push(result.data);
      }

      // Create book with first 3 authors
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Multi-Author Book'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', authors[0].id),
            resourceIdentifier('authors', authors[1].id),
            resourceIdentifier('authors', authors[2].id)
          ])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // PATCH to change to [B, C, D] - should remove A, keep B&C, add D
      const patchDoc = {
        data: {
          type: 'books',
          id: String(bookResult.data.id),
          relationships: {
            authors: createToManyRelationship([
              resourceIdentifier('authors', authors[1].id),
              resourceIdentifier('authors', authors[2].id),
              resourceIdentifier('authors', authors[3].id)
            ])
          }
        }
      };

      await basicApi.resources.books.patch({
        id: bookResult.data.id,
        inputRecord: patchDoc,
        simplified: false
      });

      // Verify the update
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        queryParams: { include: ['authors'] },
        simplified: false
      });

      const authorIds = getResult.data.relationships.authors.data.map(a => a.id).sort();
      const expectedIds = [authors[1].id, authors[2].id, authors[3].id].sort();
      assert.deepEqual(authorIds, expectedIds);

      // Verify correct number of pivot records
      const pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 3);
    });

    it('should clear all many-to-many relationships with empty array', async () => {
      // Create country
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create authors
      const author1Doc = createJsonApiDocument('authors', { name: 'Author One' });
      const author2Doc = createJsonApiDocument('authors', { name: 'Author Two' });

      const author1Result = await basicApi.resources.authors.post({
        inputRecord: author1Doc,
        simplified: false
      });

      const author2Result = await basicApi.resources.authors.post({
        inputRecord: author2Doc,
        simplified: false
      });

      // Create book with authors
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Book to Clear'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', author1Result.data.id),
            resourceIdentifier('authors', author2Result.data.id)
          ])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // Verify initial state
      let pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 2);

      // Clear all relationships
      const patchDoc = {
        data: {
          type: 'books',
          id: String(bookResult.data.id),
          relationships: {
            authors: { data: [] }
          }
        }
      };

      await basicApi.resources.books.patch({
        id: bookResult.data.id,
        inputRecord: patchDoc,
        simplified: false
      });

      // Verify all pivot records removed
      pivotCount = await countRecords(knex, 'basic_book_authors');
      assert.equal(pivotCount, 0);

      // Verify through GET
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        simplified: false
      });

      assert(getResult.data.relationships.authors);
      assert.equal(getResult.data.relationships.authors.data.length, 0);
    });
  });

  describe('Complex Relationship Scenarios', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);
    });

    it('should create resource with multiple relationship types', async () => {
      // Create supporting resources
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Big Publisher' },
        { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      const author1Doc = createJsonApiDocument('authors', { name: 'Main Author' });
      const author2Doc = createJsonApiDocument('authors', { name: 'Co-Author' });
      const author1Result = await basicApi.resources.authors.post({
        inputRecord: author1Doc,
        simplified: false
      });
      const author2Result = await basicApi.resources.authors.post({
        inputRecord: author2Doc,
        simplified: false
      });

      // Create book with all relationships
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Complex Book'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          publisher: createRelationship(resourceIdentifier('publishers', publisherResult.data.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', author1Result.data.id),
            resourceIdentifier('authors', author2Result.data.id)
          ])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // Verify with full includes
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        queryParams: {
          include: ['publisher', 'publisher.country', 'authors', 'country']
        },
        simplified: false
      });

      validateJsonApiStructure(getResult, false);
      
      // Verify all relationships
      assert(getResult.data.relationships.publisher);
      assert(getResult.data.relationships.authors);
      assert(getResult.data.relationships.country);
      
      // Verify included resources
      assert(getResult.included);
      const includedTypes = getResult.included.map(r => r.type);
      assert(includedTypes.includes('publishers'));
      assert(includedTypes.includes('authors'));
      assert(includedTypes.includes('countries'));
      
      // Verify nested relationship (publisher.country)
      const publisher = getResult.included.find(r => r.type === 'publishers');
      assert(publisher.relationships.country);
    });

    it('should handle PUT with partial relationships object', async () => {
      // Create resources
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Original Publisher' },
        { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      const authorDoc = createJsonApiDocument('authors', { name: 'Original Author' });
      const authorResult = await basicApi.resources.authors.post({
        inputRecord: authorDoc,
        simplified: false
      });

      // Create book with all relationships
      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Book to Update'
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
          publisher: createRelationship(resourceIdentifier('publishers', publisherResult.data.id)),
          authors: createToManyRelationship([resourceIdentifier('authors', authorResult.data.id)])
        }
      );

      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });

      // Create new publisher for update
      const newPublisherDoc = createJsonApiDocument('publishers',
        { name: 'New Publisher' },
        { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
      );
      const newPublisherResult = await basicApi.resources.publishers.post({
        inputRecord: newPublisherDoc,
        simplified: false
      });

      // PUT with only publisher relationship (should preserve authors since relationships object is partial)
      const putDoc = {
        data: {
          type: 'books',
          id: String(bookResult.data.id),
          attributes: {
            title: 'Book to Update'
          },
          relationships: {
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', newPublisherResult.data.id))
            // Note: authors not mentioned, but relationships object is present
          }
        }
      };

      await basicApi.resources.books.put({
        id: bookResult.data.id,
        inputRecord: putDoc,
        simplified: false,
        returnFullRecord: false
      });

      // Verify update
      const getResult = await basicApi.resources.books.get({
        id: bookResult.data.id,
        queryParams: { include: ['publisher', 'authors'] },
        simplified: false
      });

      // Publisher should be updated
      assert.equal(getResult.data.relationships.publisher.data.id, newPublisherResult.data.id);
      
      // Authors should be cleared (PUT with relationships object clears unmentioned relationships)
      assert(getResult.data.relationships.authors);
      assert.equal(getResult.data.relationships.authors.data.length, 0);
    });
  });
});