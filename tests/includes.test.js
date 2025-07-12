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

describe('Include/Sideloading Operations', () => {
  before(async () => {
    // Initialize APIs once
    basicApi = await createBasicApi(knex);
    extendedApi = await createExtendedApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('Single-Level Includes', () => {
    let testData = {};

    beforeEach(async () => {
      // Clean all tables
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      testData.country = countryResult.data;

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Test Publisher' },
        { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });
      testData.publisher = publisherResult.data;

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
      testData.authors = [author1Result.data, author2Result.data];

      const bookDoc = createJsonApiDocument('books',
        { title: 'Test Book' },
        {
          country: createRelationship(resourceIdentifier('countries', testData.country.id)),
          publisher: createRelationship(resourceIdentifier('publishers', testData.publisher.id)),
          authors: createToManyRelationship([
            resourceIdentifier('authors', testData.authors[0].id),
            resourceIdentifier('authors', testData.authors[1].id)
          ])
        }
      );
      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });
      testData.book = bookResult.data;
    });

    it('should include single belongsTo relationship', async () => {
      const result = await basicApi.resources.books.get({
        id: testData.book.id,
        queryParams: {
          include: ['publisher']
        },
        simplified: false
      });

      validateJsonApiStructure(result, false);
      
      // Verify included array exists
      assert(result.included, 'Should have included data');
      assert.equal(result.included.length, 1, 'Should include one resource');
      
      // Verify included publisher
      const includedPublisher = result.included[0];
      assert.equal(includedPublisher.type, 'publishers');
      assert.equal(includedPublisher.id, testData.publisher.id);
      assert.equal(includedPublisher.attributes.name, 'Test Publisher');
    });

    it('should include multiple relationships', async () => {
      const result = await basicApi.resources.books.get({
        id: testData.book.id,
        queryParams: {
          include: ['publisher', 'authors', 'country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, false);
      
      // Verify included array
      assert(result.included);
      assert.equal(result.included.length, 4, 'Should include 4 resources (1 publisher + 2 authors + 1 country)');
      
      // Verify each type is included
      const includedTypes = result.included.map(r => r.type);
      assert(includedTypes.includes('publishers'));
      assert(includedTypes.includes('authors'));
      assert(includedTypes.includes('countries'));
      
      // Verify specific resources
      const authors = result.included.filter(r => r.type === 'authors');
      assert.equal(authors.length, 2);
      const authorNames = authors.map(a => a.attributes.name).sort();
      assert.deepEqual(authorNames, ['Author One', 'Author Two']);
    });

    it('should include relationships in collection queries', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          include: ['publisher', 'country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      
      // Should have one book
      assert.equal(result.data.length, 1);
      
      // Should have included resources
      assert(result.included);
      const includedTypes = result.included.map(r => r.type);
      assert(includedTypes.includes('publishers'));
      assert(includedTypes.includes('countries'));
    });
  });

  describe('Nested Includes', () => {
    let testData = {};

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create hierarchy: Country -> Publisher -> Book
      const countryDoc = createJsonApiDocument('countries', { name: 'Nested Country', code: 'NC' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      testData.country = countryResult.data;

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Nested Publisher' },
        { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });
      testData.publisher = publisherResult.data;

      const bookDoc = createJsonApiDocument('books',
        { title: 'Nested Book' },
        {
          country: createRelationship(resourceIdentifier('countries', testData.country.id)),
          publisher: createRelationship(resourceIdentifier('publishers', testData.publisher.id))
        }
      );
      const bookResult = await basicApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });
      testData.book = bookResult.data;
    });

    it('should include nested relationships', async () => {
      const result = await basicApi.resources.books.get({
        id: testData.book.id,
        queryParams: {
          include: ['publisher.country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, false);
      
      // Should include both publisher and its country
      assert(result.included);
      assert.equal(result.included.length, 2);
      
      // Find the resources
      const publisher = result.included.find(r => r.type === 'publishers');
      const country = result.included.find(r => r.type === 'countries');
      
      assert(publisher, 'Should include publisher');
      assert(country, 'Should include country');
      
      // Verify the publisher has country relationship
      assert(publisher.relationships?.country, 'Publisher should have country relationship');
      assert.equal(publisher.relationships.country.data.id, country.id);
    });

    it('should handle multiple nested includes', async () => {
      // Create an author to have more relationships
      const authorDoc = createJsonApiDocument('authors', { name: 'Nested Author' });
      const authorResult = await basicApi.resources.authors.post({
        inputRecord: authorDoc,
        simplified: false
      });

      // Update book to have author
      const patchDoc = {
        data: {
          type: 'books',
          id: String(testData.book.id),
          relationships: {
            authors: createToManyRelationship([
              resourceIdentifier('authors', authorResult.data.id)
            ])
          }
        }
      };
      await basicApi.resources.books.patch({
        id: testData.book.id,
        inputRecord: patchDoc,
        simplified: false
      });

      // Query with multiple nested includes
      const result = await basicApi.resources.books.query({
        queryParams: {
          include: ['publisher.country', 'authors', 'country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      
      // Should have all included resources
      assert(result.included);
      const includedTypes = result.included.map(r => r.type);
      assert(includedTypes.includes('publishers'));
      assert(includedTypes.includes('countries'));
      assert(includedTypes.includes('authors'));
      
      // Verify no duplicates
      const countryResources = result.included.filter(r => r.type === 'countries');
      assert.equal(countryResources.length, 1, 'Should not duplicate country resource');
    });
  });

  describe('Include with Sparse Fieldsets', () => {
    let testData = {};

    beforeEach(async () => {
      await cleanTables(knex, [
        'ext_countries', 'ext_publishers', 'ext_authors', 'ext_books', 'ext_book_authors'
      ]);

      // Use extended API for more fields
      const countryDoc = createJsonApiDocument('countries', {
        name: 'Field Test Country',
        code: 'FT',
        capital: 'Capital City',
        population: 1000000,
        currency: 'FTC'
      });
      const countryResult = await extendedApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      testData.country = countryResult.data;

      const publisherDoc = createJsonApiDocument('publishers',
        {
          name: 'Field Test Publisher',
          founded_year: 2000,
          website: 'https://example.com',
          active: true
        },
        { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
      );
      const publisherResult = await extendedApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });
      testData.publisher = publisherResult.data;

      const bookDoc = createJsonApiDocument('books',
        {
          title: 'Field Test Book',
          isbn: '1234567890123',
          pages: 300,
          price: '29.99',
          language: 'en'
        },
        {
          country: createRelationship(resourceIdentifier('countries', testData.country.id)),
          publisher: createRelationship(resourceIdentifier('publishers', testData.publisher.id))
        }
      );
      const bookResult = await extendedApi.resources.books.post({
        inputRecord: bookDoc,
        simplified: false
      });
      testData.book = bookResult.data;
    });

    it('should include relationships with sparse fieldsets', async () => {
      const result = await extendedApi.resources.books.get({
        id: testData.book.id,
        queryParams: {
          include: ['publisher', 'country'],
          fields: {
            books: 'title,isbn',
            publishers: 'name',
            countries: 'name,code'
          }
        },
        simplified: false
      });

      validateJsonApiStructure(result, false);
      
      // Verify main resource has only requested fields
      assert(result.data.attributes.title);
      assert(result.data.attributes.isbn);
      assert(!result.data.attributes.pages, 'Should not include pages');
      assert(!result.data.attributes.price, 'Should not include price');
      
      // Verify included resources have only requested fields
      const publisher = result.included.find(r => r.type === 'publishers');
      assert(publisher.attributes.name);
      assert(!publisher.attributes.founded_year, 'Should not include founded_year');
      assert(!publisher.attributes.website, 'Should not include website');
      
      const country = result.included.find(r => r.type === 'countries');
      assert(country.attributes.name);
      assert(country.attributes.code);
      assert(!country.attributes.capital, 'Should not include capital');
      assert(!country.attributes.population, 'Should not include population');
    });
  });
});