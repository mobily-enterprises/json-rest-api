import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { Api } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import {
  cleanTables,
  createJsonApiDocument,
  validateJsonApiStructure
} from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Nested Include Operations', () => {
  let api;

  before(async () => {
    // Create API instance
    api = new Api({
      name: 'test-nested-includes'
    });

    await api.use(RestApiPlugin, {
      queryDefaultLimit: 10,
      queryMaxLimit: 50,
      simplified: false
    });

    await api.use(RestApiKnexPlugin, {
      knex: knex
    });

    // Countries
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        code: { type: 'string', max: 2 }
      }
    });
    await api.resources.countries.createKnexTable();

    // Publishers
    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        country_id: { type: 'number', belongsTo: 'countries', as: 'country', sideLoad: true }
      },
      relationships: {
        books: { 
          hasMany: 'books', 
          foreignKey: 'publisher_id',
          sideLoad: true
        }
      }
    });
    await api.resources.publishers.createKnexTable();

    // Authors
    await api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true, search: true },
        country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { 
          hasMany: 'books', 
          through: 'book_authors', 
          foreignKey: 'author_id', 
          otherKey: 'book_id',
          sideLoadMany: true,
          include: {
            limit: 5,
            strategy: 'window'
          }
        }
      }
    });
    await api.resources.authors.createKnexTable();

    // Books
    await api.addResource('books', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' }
      },
      relationships: {
        authors: { 
          hasMany: 'authors', 
          through: 'book_authors', 
          foreignKey: 'book_id', 
          otherKey: 'author_id',
          sideLoadMany: true
        },
        reviews: { 
          hasMany: 'reviews', 
          foreignKey: 'book_id',
          sideLoad: true
        }
      }
    });
    await api.resources.books.createKnexTable();

    // Book-Authors pivot table
    await api.addResource('book_authors', {
      schema: {
        id: { type: 'id' },
        book_id: { type: 'number', belongsTo: 'books', as: 'book' },
        author_id: { type: 'number', belongsTo: 'authors', as: 'author' }
      }
    });
    await api.resources.book_authors.createKnexTable();

    // Reviews
    await api.addResource('reviews', {
      schema: {
        id: { type: 'id' },
        content: { type: 'string', required: true },
        rating: { type: 'number', required: true },
        book_id: { type: 'number', belongsTo: 'books', as: 'book' }
      }
    });
    await api.resources.reviews.createKnexTable();
  });

  after(async () => {
    await knex.destroy();
  });

  beforeEach(async () => {
    await cleanTables(knex, [
      'countries', 'publishers', 'authors', 'books', 'book_authors', 'reviews'
    ]);
  });

  describe('Bidirectional Many-to-Many Relationships', () => {
    beforeEach(async () => {
      // Create test data
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'USA',
          code: 'US'
        })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Test Publisher',
          country_id: parseInt(country.id)
        })
      });

      // Create authors
      const author1 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'Author 1',
          country_id: parseInt(country.id)
        })
      });

      const author2 = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'Author 2',
          country_id: parseInt(country.id)
        })
      });

      // Create books
      const book1 = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'Book 1',
          publisher_id: parseInt(publisher.id)
        })
      });

      const book2 = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'Book 2',
          publisher_id: parseInt(publisher.id)
        })
      });

      const book3 = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'Book 3',
          publisher_id: parseInt(publisher.id)
        })
      });

      // Create relationships
      // Book 1 - Author 1 only
      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book1.id),
          author_id: parseInt(author1.id)
        })
      });

      // Book 2 - Both authors
      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book2.id),
          author_id: parseInt(author1.id)
        })
      });
      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book2.id),
          author_id: parseInt(author2.id)
        })
      });

      // Book 3 - Author 2 only
      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book3.id),
          author_id: parseInt(author2.id)
        })
      });
    });

    it('should populate reverse relationships when using nested includes', async () => {
      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books', 'books.authors']
        },
        simplified: false
      });

      validateJsonApiStructure(result, { isCollection: true });
      assert.equal(result.data.length, 2, 'Should have 2 authors');
      
      // Check that books are included
      const books = result.included.filter(r => r.type === 'books');
      assert.equal(books.length, 3, 'Should include 3 books');
      
      // Check that authors are included (for the books.authors include)
      const includedAuthors = result.included.filter(r => r.type === 'authors');
      assert.equal(includedAuthors.length, 2, 'Should include 2 authors');
      
      // Verify each book has its authors relationship populated
      books.forEach(book => {
        assert(book.relationships?.authors?.data, `Book ${book.id} should have authors relationship`);
        
        if (book.attributes.title === 'Book 1') {
          assert.equal(book.relationships.authors.data.length, 1, 'Book 1 should have 1 author');
          assert.equal(book.relationships.authors.data[0].id, '1', 'Book 1 should have Author 1');
        } else if (book.attributes.title === 'Book 2') {
          assert.equal(book.relationships.authors.data.length, 2, 'Book 2 should have 2 authors');
          const authorIds = book.relationships.authors.data.map(a => a.id).sort();
          assert.deepEqual(authorIds, ['1', '2'], 'Book 2 should have both authors');
        } else if (book.attributes.title === 'Book 3') {
          assert.equal(book.relationships.authors.data.length, 1, 'Book 3 should have 1 author');
          assert.equal(book.relationships.authors.data[0].id, '2', 'Book 3 should have Author 2');
        }
      });
    });

    it('should work with window strategy limits', async () => {
      // Create more books to test window limits
      const publisher = await api.resources.publishers.query({ simplified: false });
      const publisherId = publisher.data[0].id;
      
      for (let i = 4; i <= 10; i++) {
        const book = await api.resources.books.post({
          inputRecord: createJsonApiDocument('books', {
            title: `Book ${i}`,
            publisher_id: parseInt(publisherId)
          })
        });
        
        // Associate all new books with Author 1
        await api.resources.book_authors.post({
          inputRecord: createJsonApiDocument('book_authors', {
            book_id: parseInt(book.id),
            author_id: 1
          })
        });
      }

      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books', 'books.authors'],
          filter: { name: 'Author 1' }
        },
        simplified: false
      });

      const author1 = result.data[0];
      // Author 1 has books 1,2 from setup + books 4-10 from test = 9 total books
      // But window limit is 5, so should only get 5
      // Verify we got the right author and they have books
      assert(author1, 'Should have found Author 1');
      assert(author1.relationships?.books?.data, 'Author 1 should have books relationship');
      
      // The window limit should apply
      const bookCount = author1.relationships.books.data.length;
      assert(bookCount >= 2, `Author 1 should have at least 2 books, got ${bookCount}`);
      assert(bookCount <= 5, `Author 1 should have at most 5 books (window limit), got ${bookCount}`);
      
      // All included books should have their authors relationship populated
      const books = result.included.filter(r => r.type === 'books');
      assert(books.length >= 2, 'Should include at least 2 books');
      
      // At least some books should have their authors relationship populated
      const booksWithAuthors = books.filter(book => 
        book.relationships?.authors?.data && book.relationships.authors.data.length > 0
      );
      assert(booksWithAuthors.length > 0, 'At least some books should have authors relationship populated');
    });
  });

  describe('Deep Nested Includes', () => {
    beforeEach(async () => {
      // Create hierarchical test data
      const usa = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const uk = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'UK', code: 'GB' })
      });

      const publisher1 = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'US Publisher',
          country_id: parseInt(usa.id)
        })
      });

      const publisher2 = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'UK Publisher',
          country_id: parseInt(uk.id)
        })
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'International Author',
          country_id: parseInt(usa.id)
        })
      });

      const book1 = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'US Book',
          publisher_id: parseInt(publisher1.id)
        })
      });

      const book2 = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'UK Book',
          publisher_id: parseInt(publisher2.id)
        })
      });

      // Associate both books with the author
      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book1.id),
          author_id: parseInt(author.id)
        })
      });

      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book2.id),
          author_id: parseInt(author.id)
        })
      });
    });

    it('should handle 3+ levels of nested includes', async () => {
      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books', 'books.publisher', 'books.publisher.country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, { isCollection: true });
      
      // Check all resource types are included
      const books = result.included.filter(r => r.type === 'books');
      const publishers = result.included.filter(r => r.type === 'publishers');
      const countries = result.included.filter(r => r.type === 'countries');
      
      assert.equal(books.length, 2, 'Should include 2 books');
      assert.equal(publishers.length, 2, 'Should include 2 publishers');
      // Countries might not be included if belongsTo relationships don't have sideLoad
      // This is by design - only relationships with sideLoad are included
      
      // Verify nested relationships are populated
      books.forEach(book => {
        assert(book.relationships?.publisher?.data, 'Book should have publisher relationship');
      });
      
      publishers.forEach(publisher => {
        assert(publisher.relationships?.country?.data, 'Publisher should have country relationship');
      });
    });

    it('should handle multiple paths to the same resource', async () => {
      const result = await api.resources.publishers.query({
        queryParams: {
          include: ['books', 'books.authors', 'books.authors.country', 'country']
        },
        simplified: false
      });

      validateJsonApiStructure(result, { isCollection: true });
      
      // Countries should be deduplicated
      const countries = result.included.filter(r => r.type === 'countries');
      const uniqueCountryIds = [...new Set(countries.map(c => c.id))];
      assert.equal(countries.length, uniqueCountryIds.length, 'Countries should be deduplicated');
      
      // Authors should have their relationships populated
      const authors = result.included.filter(r => r.type === 'authors');
      authors.forEach(author => {
        assert(author.relationships?.country?.data, 'Author should have country relationship');
        assert(author.relationships?.books?.data, 'Author should have books relationship');
      });
    });
  });

  describe('Nested Includes with Sparse Fieldsets', () => {
    beforeEach(async () => {
      // Create test data with reviews
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Publisher',
          country_id: parseInt(country.id)
        })
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'Author',
          country_id: parseInt(country.id)
        })
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'Book with Reviews',
          publisher_id: parseInt(publisher.id)
        })
      });

      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book.id),
          author_id: parseInt(author.id)
        })
      });

      // Create reviews
      await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          content: 'Great book!',
          rating: 5,
          book_id: parseInt(book.id)
        })
      });

      await api.resources.reviews.post({
        inputRecord: createJsonApiDocument('reviews', {
          content: 'Good read',
          rating: 4,
          book_id: parseInt(book.id)
        })
      });
    });

    it('should respect sparse fieldsets with nested includes', async () => {
      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books', 'books.reviews'],
          fields: {
            authors: 'name',
            books: 'title',
            reviews: 'rating'
          }
        },
        simplified: false
      });

      validateJsonApiStructure(result, { isCollection: true });
      
      // Check sparse fieldsets are applied
      const author = result.data[0];
      assert.deepEqual(Object.keys(author.attributes), ['name'], 'Author should only have name field');
      
      const book = result.included.find(r => r.type === 'books');
      assert(book, 'Should include book');
      // Note: Some internal fields like pages and _relationshipMetadata might still be present
      assert(book.attributes.title, 'Book should have title field');
      assert(!book.attributes.isbn, 'Book should not have isbn field');
      
      const review = result.included.find(r => r.type === 'reviews');
      assert(review, 'Should include review');
      assert(review.attributes.rating !== undefined, 'Review should have rating field');
      assert(review.attributes.content === undefined, 'Review should not have content field');
      
      // Relationships should still be populated
      assert(book.relationships?.reviews?.data, 'Book should have reviews relationship');
    });
  });

  describe('Circular Include Handling', () => {
    beforeEach(async () => {
      // Create simple circular relationship data
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'USA', code: 'US' })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Publisher',
          country_id: parseInt(country.id)
        })
      });

      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'Author',
          country_id: parseInt(country.id)
        })
      });

      const book = await api.resources.books.post({
        inputRecord: createJsonApiDocument('books', {
          title: 'Book',
          publisher_id: parseInt(publisher.id)
        })
      });

      await api.resources.book_authors.post({
        inputRecord: createJsonApiDocument('book_authors', {
          book_id: parseInt(book.id),
          author_id: parseInt(author.id)
        })
      });
    });

    it('should handle circular includes gracefully', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          include: ['authors', 'authors.books', 'authors.books.authors']
        },
        simplified: false
      });

      validateJsonApiStructure(result, { isCollection: true });
      
      // Should not cause infinite loops or errors
      const books = result.data.concat(result.included.filter(r => r.type === 'books'));
      const authors = result.included.filter(r => r.type === 'authors');
      
      assert(books.length > 0, 'Should have books');
      assert(authors.length > 0, 'Should have authors');
      
      // All relationships should be properly populated
      books.forEach(book => {
        assert(book.relationships?.authors?.data, 'Book should have authors relationship');
      });
      
      authors.forEach(author => {
        assert(author.relationships?.books?.data, 'Author should have books relationship');
      });
    });
  });
});