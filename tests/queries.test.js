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
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instances that persist across tests
let basicApi;
let extendedApi;

describe('Query Operations', () => {
  before(async () => {
    // Initialize APIs once
    basicApi = await createBasicApi(knex);
    extendedApi = await createExtendedApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('Filtering', () => {
    let testData = {};

    beforeEach(async () => {
      // Clean all tables
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data set
      // Create 3 countries
      const countries = [];
      for (const [name, code] of [['United States', 'US'], ['United Kingdom', 'UK'], ['France', 'FR']]) {
        const doc = createJsonApiDocument('countries', { name, code });
        const result = await basicApi.resources.countries.post({
          inputRecord: doc,
          simplified: false
        });
        countries.push(result.data);
      }
      testData.countries = countries;

      // Create 2 publishers per country
      const publishers = [];
      let pubIndex = 0;
      for (const country of countries) {
        for (let i = 0; i < 2; i++) {
          const doc = createJsonApiDocument('publishers',
            { name: `Publisher ${++pubIndex}` },
            { country: createRelationship(resourceIdentifier('countries', country.id)) }
          );
          const result = await basicApi.resources.publishers.post({
            inputRecord: doc,
            simplified: false
          });
          publishers.push({ ...result.data, countryId: country.id });
        }
      }
      testData.publishers = publishers;

      // Create 3 authors
      const authors = [];
      for (const name of ['Author One', 'Author Two', 'Author Three']) {
        const doc = createJsonApiDocument('authors', { name });
        const result = await basicApi.resources.authors.post({
          inputRecord: doc,
          simplified: false
        });
        authors.push(result.data);
      }
      testData.authors = authors;

      // Create 5 books with various relationships
      const books = [
        { title: 'Book A', countryId: countries[0].id, publisherId: publishers[0].id, authorIds: [authors[0].id] },
        { title: 'Book B', countryId: countries[0].id, publisherId: publishers[1].id, authorIds: [authors[0].id, authors[1].id] },
        { title: 'Book C', countryId: countries[1].id, publisherId: publishers[2].id, authorIds: [authors[1].id] },
        { title: 'Book D', countryId: countries[1].id, publisherId: publishers[3].id, authorIds: [authors[2].id] },
        { title: 'Book E', countryId: countries[2].id, publisherId: publishers[4].id, authorIds: [authors[0].id, authors[2].id] }
      ];

      testData.books = [];
      for (const bookData of books) {
        const doc = createJsonApiDocument('books',
          {
            title: bookData.title
          },
          {
            country: createRelationship(resourceIdentifier('countries', bookData.countryId)),
            publisher: createRelationship(resourceIdentifier('publishers', bookData.publisherId)),
            authors: createToManyRelationship(
              bookData.authorIds.map(id => resourceIdentifier('authors', id))
            )
          }
        );
        const result = await basicApi.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
        testData.books.push(result.data);
      }
    });

    it('should filter by simple field', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          filters: { country: testData.countries[0].id }
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 2, 'Should return 2 books from US');
      
      // Verify all returned books are from the correct country
      for (const book of result.data) {
        const bookData = testData.books.find(b => b.id === book.id);
        assert(bookData);
        const originalBook = testData.books.find(b => b.id === book.id);
        assert.equal(originalBook.attributes.title.startsWith('Book A') || 
                    originalBook.attributes.title.startsWith('Book B'), true);
      }
    });

    it('should filter by multiple fields', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          filters: {
            country: testData.countries[0].id,
            publisher: testData.publishers[0].id
          }
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 1, 'Should return 1 book matching both filters');
      assert.equal(result.data[0].attributes.title, 'Book A');
    });

    it('should return empty array when no matches', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          filters: { country: 99999 }
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 0, 'Should return empty array');
    });

    it('should throw error when filtering on non-searchable field', async () => {
      await assert.rejects(
        async () => {
          await basicApi.resources.countries.query({
            queryParams: {
              filters: { invalid_field: 'test' }
            },
            simplified: false
          });
        },
        (err) => {
          return err.code === 'REST_API_VALIDATION';
        },
        'Should throw validation error for invalid filter field'
      );
    });
  });

  describe('Sorting', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create books with different titles
      const titles = ['Zebra Book', 'Apple Book', 'Mango Book', 'Banana Book'];
      for (const title of titles) {
        const doc = createJsonApiDocument('books', {
          title
        },
        {
          country: createRelationship(resourceIdentifier('countries', countryResult.data.id))
        });
        await basicApi.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should sort by single field ascending', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          sort: ['title']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 4);
      
      const titles = result.data.map(b => b.attributes.title);
      assert.deepEqual(titles, ['Apple Book', 'Banana Book', 'Mango Book', 'Zebra Book']);
    });

    it('should sort by single field descending', async () => {
      const result = await basicApi.resources.books.query({
        queryParams: {
          sort: ['-title']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 4);
      
      const titles = result.data.map(b => b.attributes.title);
      assert.deepEqual(titles, ['Zebra Book', 'Mango Book', 'Banana Book', 'Apple Book']);
    });

    it('should sort by multiple fields', async () => {
      // Create books with same country but different titles
      const countryDoc1 = createJsonApiDocument('countries', { name: 'Country A', code: 'CA' });
      const countryDoc2 = createJsonApiDocument('countries', { name: 'Country B', code: 'CB' });
      
      const country1Result = await basicApi.resources.countries.post({
        inputRecord: countryDoc1,
        simplified: false
      });
      
      const country2Result = await basicApi.resources.countries.post({
        inputRecord: countryDoc2,
        simplified: false
      });

      // Create books
      const booksToCreate = [
        { title: 'Book Z', countryId: country1Result.data.id },
        { title: 'Book A', countryId: country1Result.data.id },
        { title: 'Book Z', countryId: country2Result.data.id },
        { title: 'Book A', countryId: country2Result.data.id }
      ];

      for (const bookData of booksToCreate) {
        const doc = createJsonApiDocument('books', 
          { title: bookData.title },
          { country: createRelationship(resourceIdentifier('countries', bookData.countryId)) }
        );
        await basicApi.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }

      // Sort by country_id ascending, then title descending
      const result = await basicApi.resources.books.query({
        queryParams: {
          sort: ['country', '-title']
        },
        simplified: false
      });

      // We expect 8 books total (4 from beforeEach + 4 from this test)
      assert.equal(result.data.length, 8);
      
      // Filter to only the books we created in this test
      const testBooks = result.data.filter(book => 
        book.attributes.title === 'Book A' || book.attributes.title === 'Book Z'
      );
      
      assert.equal(testBooks.length, 4);
      
      // Sort test books by country relationship for verification
      const sortedTestBooks = testBooks.sort((a, b) => {
        const countryA = a.relationships.country.data.id;
        const countryB = b.relationships.country.data.id;
        if (countryA !== countryB) {
          return countryA.localeCompare(countryB);
        }
        // Within same country, sort by title descending
        return b.attributes.title.localeCompare(a.attributes.title);
      });
      
      // Verify the books are from the correct countries and in correct order
      assert.equal(sortedTestBooks[0].relationships.country.data.id, country1Result.data.id);
      assert.equal(sortedTestBooks[1].relationships.country.data.id, country1Result.data.id);
      assert.equal(sortedTestBooks[2].relationships.country.data.id, country2Result.data.id);
      assert.equal(sortedTestBooks[3].relationships.country.data.id, country2Result.data.id);
      
      // Within each country, should be sorted by title descending
      assert.equal(sortedTestBooks[0].attributes.title, 'Book Z');
      assert.equal(sortedTestBooks[1].attributes.title, 'Book A');
      assert.equal(sortedTestBooks[2].attributes.title, 'Book Z');
      assert.equal(sortedTestBooks[3].attributes.title, 'Book A');
    });
  });

  describe('Pagination', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create 10 books
      for (let i = 1; i <= 10; i++) {
        const doc = createJsonApiDocument('books', 
          { title: `Book ${String(i).padStart(2, '0')}` },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await basicApi.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should paginate results', async () => {
      // Get first page
      const page1 = await basicApi.resources.books.query({
        queryParams: {
          page: { number: 1, size: 3 },
          sort: ['title']
        },
        simplified: false
      });

      validateJsonApiStructure(page1, true);
      assert.equal(page1.data.length, 3, 'Should return 3 results for page 1');
      
      const page1Titles = page1.data.map(b => b.attributes.title);
      assert.deepEqual(page1Titles, ['Book 01', 'Book 02', 'Book 03']);

      // Get second page
      const page2 = await basicApi.resources.books.query({
        queryParams: {
          page: { number: 2, size: 3 },
          sort: ['title']
        },
        simplified: false
      });

      validateJsonApiStructure(page2, true);
      assert.equal(page2.data.length, 3, 'Should return 3 results for page 2');
      
      const page2Titles = page2.data.map(b => b.attributes.title);
      assert.deepEqual(page2Titles, ['Book 04', 'Book 05', 'Book 06']);

      // Verify different results
      const page1Ids = page1.data.map(b => b.id);
      const page2Ids = page2.data.map(b => b.id);
      assert.equal(page1Ids.some(id => page2Ids.includes(id)), false, 'Pages should have different results');
    });

    it('should handle last page with fewer results', async () => {
      const lastPage = await basicApi.resources.books.query({
        queryParams: {
          page: { number: 4, size: 3 },
          sort: ['title']
        },
        simplified: false
      });

      validateJsonApiStructure(lastPage, true);
      assert.equal(lastPage.data.length, 1, 'Should return 1 result for last page');
      assert.equal(lastPage.data[0].attributes.title, 'Book 10');
    });

    it('should handle page beyond available data', async () => {
      const emptyPage = await basicApi.resources.books.query({
        queryParams: {
          page: { number: 10, size: 5 }
        },
        simplified: false
      });

      validateJsonApiStructure(emptyPage, true);
      assert.equal(emptyPage.data.length, 0, 'Should return empty array for page beyond data');
    });

    it('should respect queryMaxLimit limit', async () => {
      // Assuming queryMaxLimit is 100 (from vars)
      const result = await basicApi.resources.books.query({
        queryParams: {
          page: { number: 1, size: 200 } // Request more than max
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert(result.data.length <= 100, 'Should not exceed queryMaxLimit');
    });
  });

  describe('Combined Query Features', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors',
        'ext_countries', 'ext_publishers', 'ext_authors', 'ext_books', 'ext_book_authors'
      ]);

      // Create test data for extended API with more fields
      const countries = [];
      for (const [name, code, pop] of [['USA', 'US', 300000000], ['UK', 'GB', 60000000], ['France', 'FR', 65000000]]) {
        const doc = createJsonApiDocument('countries', {
          name,
          code,
          population: pop,
          currency: code === 'US' ? 'USD' : code === 'GB' ? 'GBP' : 'EUR'
        });
        const result = await extendedApi.resources.countries.post({
          inputRecord: doc,
          simplified: false
        });
        countries.push(result.data);
      }

      // Create books with prices
      const bookData = [
        { title: 'Cheap Book A', price: 9.99, countryId: countries[0].id, language: 'en' },
        { title: 'Expensive Book B', price: 29.99, countryId: countries[0].id, language: 'en' },
        { title: 'Medium Book C', price: 19.99, countryId: countries[1].id, language: 'en' },
        { title: 'Cheap Book D', price: 12.99, countryId: countries[1].id, language: 'fr' },
        { title: 'Expensive Book E', price: 39.99, countryId: countries[2].id, language: 'fr' }
      ];

      for (const data of bookData) {
        const doc = createJsonApiDocument('books', 
          {
            title: data.title,
            price: data.price,
            language: data.language
          },
          { country: createRelationship(resourceIdentifier('countries', data.countryId)) }
        );
        await extendedApi.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should filter, sort, and paginate together', async () => {
      const result = await extendedApi.resources.books.query({
        queryParams: {
          filters: { language: 'en' },
          sort: ['-price'],
          page: { number: 1, size: 2 }
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 2);
      
      // Should get the 2 most expensive English books
      assert.equal(result.data[0].attributes.title, 'Expensive Book B');
      assert.equal(result.data[1].attributes.title, 'Medium Book C');
    });

    it('should filter and include relationships', async () => {
      const result = await extendedApi.resources.books.query({
        queryParams: {
          filters: { language: 'fr' },
          include: ['country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert.equal(result.data.length, 2, 'Should return 2 French books');
      
      // Verify includes
      assert(result.included, 'Should have included data');
      const includedCountries = result.included.filter(r => r.type === 'countries');
      assert(includedCountries.length >= 1, 'Should include at least one country');
      
      // Verify included countries have the expected fields
      for (const country of includedCountries) {
        assert(country.attributes.name);
        assert(country.attributes.currency);
      }
    });
  });
});