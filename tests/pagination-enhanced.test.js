import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument, 
  createRelationship,
  resourceIdentifier 
} from './helpers/test-utils.js';
import { createPaginationApi } from './fixtures/api-configs.js';

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

describe('Enhanced Pagination Features', () => {
  before(async () => {
    // Initialize API once with pagination features
    api = await createPaginationApi(knex, {
      publicBaseUrl: 'https://api.example.com/v1'
    });
  });

  after(async () => {
    // Close database connection
    await knex.destroy();
  });

  describe('Self Links', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'pagination_countries', 'pagination_publishers', 'pagination_books'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create some books
      for (let i = 1; i <= 3; i++) {
        const doc = createJsonApiDocument('books', 
          { title: `Book ${i}` },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should add self links to individual resources', async () => {
      const result = await api.resources.books.get({
        id: '1',
        simplified: false
      });

      validateJsonApiStructure(result, false);
      assert(result.data.links, 'Resource should have links');
      assert.equal(result.data.links.self, 'https://api.example.com/v1/books/1');
      assert(result.links, 'Response should have top-level links');
      assert.equal(result.links.self, 'https://api.example.com/v1/books/1');
    });

    it('should add self links to collection resources', async () => {
      const result = await api.resources.books.query({
        queryParams: {},
        simplified: false
      });

      validateJsonApiStructure(result, true);
      
      // Check individual resource links
      result.data.forEach(book => {
        assert(book.links, 'Each resource should have links');
        assert(book.links.self, 'Each resource should have self link');
        assert(book.links.self.startsWith('https://api.example.com/v1/books/'));
      });

      // Check top-level links
      assert(result.links, 'Response should have top-level links');
      assert.equal(result.links.self, 'https://api.example.com/v1/books');
    });

    it('should add self links to included resources', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          include: ['country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert(result.included, 'Should have included resources');
      
      result.included.forEach(resource => {
        assert(resource.links, 'Included resource should have links');
        assert(resource.links.self, 'Included resource should have self link');
        assert(resource.links.self.startsWith('https://api.example.com/v1/'));
      });
    });

    it('should add relative self links when publicBaseUrl is not configured', async () => {
      // Temporarily clear the publicBaseUrl
      const originalPrefix = api.vars.publicBaseUrl;
      api.vars.publicBaseUrl = '';
      
      const result = await api.resources.books.query({
        queryParams: {},
        simplified: false
      });

      validateJsonApiStructure(result, true);
      
      // Links should be present but relative
      result.data.forEach(book => {
        assert(book.links, 'Resources should have links even without publicBaseUrl');
        assert(book.links.self, 'Resources should have self link');
        assert(book.links.self.startsWith('/books/'), 'Self link should be relative');
      });
      assert(result.links, 'Response should have top-level links even without publicBaseUrl');
      assert(result.links.self.startsWith('/books'), 'Top-level self link should be relative');
      
      // Restore the prefix
      api.vars.publicBaseUrl = originalPrefix;
    });
  });

  describe('Pagination Metadata', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'pagination_countries', 'pagination_publishers', 'pagination_books'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create 10 books for pagination testing
      for (let i = 1; i <= 10; i++) {
        const doc = createJsonApiDocument('books', 
          { title: `Book ${String(i).padStart(2, '0')}` },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should include pagination metadata in response', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 2, size: 3 }
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      assert(result.meta, 'Response should have meta');
      assert(result.meta.pagination, 'Meta should have pagination');
      
      const pagination = result.meta.pagination;
      assert.equal(pagination.page, 2);
      assert.equal(pagination.pageSize, 3);
      assert.equal(pagination.total, 10);
      assert.equal(pagination.pageCount, 4);
      assert.equal(pagination.hasMore, true);
    });

    it('should calculate hasMore correctly for last page', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 4, size: 3 }
        },
        simplified: false
      });

      assert.equal(result.meta.pagination.hasMore, false);
      assert.equal(result.meta.pagination.page, 4);
      assert.equal(result.meta.pagination.pageCount, 4);
    });

    it('should include pagination links', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 2, size: 3 }
        },
        simplified: false
      });

      assert(result.links, 'Response should have links');
      assert(result.links.self, 'Should have self link');
      assert(result.links.first, 'Should have first link');
      assert(result.links.last, 'Should have last link');
      assert(result.links.prev, 'Should have prev link');
      assert(result.links.next, 'Should have next link');

      // Verify link structure
      assert(result.links.self.includes('page[number]=2'));
      assert(result.links.self.includes('page[size]=3'));
      assert(result.links.first.includes('page[number]=1'));
      assert(result.links.last.includes('page[number]=4'));
      assert(result.links.prev.includes('page[number]=1'));
      assert(result.links.next.includes('page[number]=3'));
    });

    it('should not include prev link on first page', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 3 }
        },
        simplified: false
      });

      assert(result.links.first);
      assert(result.links.next);
      assert(!result.links.prev, 'First page should not have prev link');
    });

    it('should not include next link on last page', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 4, size: 3 }
        },
        simplified: false
      });

      assert(result.links.first);
      assert(result.links.prev);
      assert(!result.links.next, 'Last page should not have next link');
    });

    it('should preserve other query parameters in pagination links', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 2, size: 3 },
          sort: ['-title']
        },
        simplified: false
      });

      assert(result.links, 'Should have links');
      assert(result.links.next, 'Should have next link since page 2 of 4');
      assert(result.links.next.includes('sort=-title'));
      assert(result.links.next.includes('page[number]=3'));
      assert(result.links.next.includes('page[size]=3'));
    });
  });

  describe('Cursor-based Pagination', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'pagination_countries', 'pagination_publishers', 'pagination_books'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create books
      for (let i = 1; i <= 15; i++) {
        const doc = createJsonApiDocument('books', 
          { 
            title: `Book ${String(i).padStart(2, '0')}`
          },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should support cursor-based pagination with after parameter', async () => {
      // Get first page
      const firstPage = await api.resources.books.query({
        queryParams: {
          page: { size: 5 },
          sort: ['-id']
        },
        simplified: false
      });

      validateJsonApiStructure(firstPage, true);
      assert.equal(firstPage.data.length, 5);
      assert(firstPage.meta.pagination.hasMore);
      assert(firstPage.meta.pagination.cursor?.next);
      
      // Get next page using cursor
      const secondPage = await api.resources.books.query({
        queryParams: {
          page: { 
            size: 5,
            after: firstPage.meta.pagination.cursor.next
          },
          sort: ['-id']
        },
        simplified: false
      });

      validateJsonApiStructure(secondPage, true);
      assert.equal(secondPage.data.length, 5);
      
      // Verify different records
      const firstPageIds = firstPage.data.map(b => b.id);
      const secondPageIds = secondPage.data.map(b => b.id);
      assert(!firstPageIds.some(id => secondPageIds.includes(id)), 'Pages should have different records');
    });

    it('should include cursor pagination links', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { size: 5 }
        },
        simplified: false
      });

      assert(result.links);
      assert(result.links.self);
      assert(result.links.first);
      assert(result.links.next);
      assert(result.links.next.includes('page[after]='), 'Next link should include cursor parameter');
    });

    it('should handle last page with cursor pagination', async () => {
      // Get to last page
      let currentCursor = null;
      let result;
      
      // Navigate through pages
      for (let i = 0; i < 3; i++) {
        result = await api.resources.books.query({
          queryParams: {
            page: { 
              size: 5,
              ...(currentCursor && { after: currentCursor })
            }
          },
          simplified: false
        });
        
        if (result.meta.pagination.cursor?.next) {
          currentCursor = result.meta.pagination.cursor.next;
        }
      }

      // Last page should have no next cursor
      assert.equal(result.meta.pagination.hasMore, false);
      assert(!result.meta.pagination.cursor?.next);
      assert(!result.links.next);
    });
  });

  describe('Count Query Configuration', () => {
    beforeEach(async () => {
      await cleanTables(knex, [
        'pagination_countries', 'pagination_publishers', 'pagination_books'
      ]);

      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Test Country', code: 'TC' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });

      // Create books
      for (let i = 1; i <= 20; i++) {
        const doc = createJsonApiDocument('books', 
          { title: `Book ${i}` },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({
          inputRecord: doc,
          simplified: false
        });
      }
    });

    it('should include count by default', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 5 }
        },
        simplified: false
      });

      assert(result.meta.pagination.total !== undefined);
      assert.equal(result.meta.pagination.total, 20);
      assert.equal(result.meta.pagination.pageCount, 4);
    });

    it('should respect enablePaginationCounts when set to false', async () => {
      // Override the enablePaginationCounts setting for this scope
      const booksScope = api.resources.books;
      const originalSetting = booksScope.vars.enablePaginationCounts;
      booksScope.vars.enablePaginationCounts = false;
      
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 5 }
        },
        simplified: false
      });

      assert(result.meta.pagination);
      assert.equal(result.meta.pagination.page, 1);
      assert.equal(result.meta.pagination.pageSize, 5);
      assert(result.meta.pagination.total === undefined, 'Should not include total when counts disabled');
      assert(result.meta.pagination.pageCount === undefined, 'Should not include pageCount when counts disabled');
      assert(result.meta.pagination.hasMore === undefined, 'Should not include hasMore when counts disabled');
      
      // Restore the setting
      booksScope.vars.enablePaginationCounts = originalSetting;
    });
  });

  describe('Combined Features', () => {
    let usCountryId;
    
    beforeEach(async () => {
      await cleanTables(knex, [
        'pagination_countries', 'pagination_publishers', 'pagination_books'
      ]);

      // Create multiple countries
      const countries = [];
      for (const code of ['US', 'UK', 'FR']) {
        const doc = createJsonApiDocument('countries', { name: `Country ${code}`, code });
        const result = await api.resources.countries.post({
          inputRecord: doc,
          simplified: false
        });
        countries.push(result.data);
        if (code === 'US') {
          usCountryId = result.data.id;
        }
      }

      // Create books distributed across countries
      let bookIndex = 1;
      for (const country of countries) {
        for (let i = 0; i < 8; i++) {
          const doc = createJsonApiDocument('books', 
            { title: `Book ${String(bookIndex++).padStart(2, '0')}` },
            { country: createRelationship(resourceIdentifier('countries', country.id)) }
          );
          await api.resources.books.post({
            inputRecord: doc,
            simplified: false
          });
        }
      }
    });

    it('should combine pagination with filtering and includes', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 5 },
          filters: {
            country_id: parseInt(usCountryId)
          },
          include: ['country'],
          sort: ['title']
        },
        simplified: false
      });

      validateJsonApiStructure(result, true);
      
      // Check pagination worked
      assert.equal(result.data.length, 5);
      assert.equal(result.meta.pagination.total, 8);
      assert.equal(result.meta.pagination.pageCount, 2);
      
      // Check filtering worked
      const countryIds = result.data.map(b => b.relationships.country.data.id);
      assert(countryIds.every(id => id === countryIds[0]), 'All books should be from same country');
      
      // Check includes worked
      assert(result.included);
      const usCountry = result.included.find(r => r.type === 'countries' && r.attributes.code === 'US');
      assert(usCountry);
      
      // Check self links present
      result.data.forEach(book => {
        assert(book.links.self);
      });
      
      // Check pagination links include all parameters
      assert(result.links.next.includes(`filters[country_id]=${usCountryId}`));
      assert(result.links.next.includes('include=country'));
      assert(result.links.next.includes('sort=title'));
    });
  });
});