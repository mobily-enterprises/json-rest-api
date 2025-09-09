import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { Api } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import {
  cleanTables,
  countRecords,
  createJsonApiDocument,
  createRelationship,
  validateJsonApiStructure
} from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Query Limits and Include Limits', () => {
  let api;

  before(async () => {
    // Create API with specific limits for testing
    api = new Api({
      name: 'test-api-limits'
    });

    await api.use(RestApiPlugin, {
      queryDefaultLimit: 10,
      queryMaxLimit: 50,
      simplified: false,
      returnFullRecord: {
        post: true
      }
    });

    await api.use(RestApiKnexPlugin, {
      knex: knex
    });

    // Countries
    await api.addResource('countries', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        code: { type: 'string', required: true }
      }
    });
    await api.resources.countries.createKnexTable();

    // Publishers
    await api.addResource('publishers', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { 
          type: 'hasMany',
          target: 'books', 
          foreignKey: 'publisher_id',
          // Relationships are always includable via ?include=
          include: {
            strategy: 'window'  // Use window strategy for per-publisher limits
          }
        }
      }
    });
    await api.resources.publishers.createKnexTable();

    // Authors
    await api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
      },
      relationships: {
        books: { 
          type: 'manyToMany',
          through: 'book_authors', 
          foreignKey: 'author_id', 
          otherKey: 'book_id',
          // Relationships are always includable via ?include=
          include: {
            limit: 3,  // Explicit limit for testing
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
          type: 'manyToMany',
          through: 'book_authors', 
          foreignKey: 'book_id', 
          otherKey: 'author_id'
          // Relationships are always includable via ?include=
        },
        reviews: { type: 'hasMany', target: 'reviews', via: 'reviewable' }
      }
    });
    await api.resources.books.createKnexTable();

    // Book Authors (pivot table)
    await api.addResource('book_authors', {
      schema: {
        id: { type: 'id' },
        book_id: { type: 'number', belongsTo: 'books', as: 'book' },
        author_id: { type: 'number', belongsTo: 'authors', as: 'author' }
      }
    });
    await api.resources.book_authors.createKnexTable();

    // Reviews (polymorphic)
    await api.addResource('reviews', {
      schema: {
        id: { type: 'id' },
        content: { type: 'string', required: true },
        rating: { type: 'number', required: true },
        reviewer_name: { type: 'string', required: true },
        reviewable_type: { type: 'string', required: true },
        reviewable_id: { type: 'number', required: true }
      },
      relationships: {
        reviewable: {
          belongsToPolymorphic: {
            types: ['books', 'authors', 'publishers'],
            typeField: 'reviewable_type',
            idField: 'reviewable_id'
          }
        }
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

  describe('Query Default Limits', () => {
    it('should apply queryDefaultLimit when no page size specified', async () => {
      // Create 30 countries
      for (let i = 1; i <= 30; i++) {
        await api.resources.countries.post({
          inputRecord: createJsonApiDocument('countries', {
            name: `Country ${i}`,
            code: `C${i}`
          })
        });
      }

      // Query without page size
      const result = await api.resources.countries.query({
        queryParams: {},
        simplified: false
      });

      // Should use queryDefaultLimit of 10
      assert.equal(result.data.length, 10, 'Should apply default limit of 10');
    });

    it('should respect queryMaxLimit when page size exceeds it', async () => {
      // Create 100 countries
      for (let i = 1; i <= 100; i++) {
        await api.resources.countries.post({
          inputRecord: createJsonApiDocument('countries', {
            name: `Country ${i}`,
            code: `C${i}`
          })
        });
      }

      // Query with page size exceeding max (use offset-based pagination)
      const result = await api.resources.countries.query({
        queryParams: {
          page: { size: 100, number: 1 }  // Exceeds queryMaxLimit of 50
        },
        simplified: false
      });

      // Should be capped at queryMaxLimit of 50
      assert.equal(result.data.length, 50, 'Should cap at queryMaxLimit of 50');
    });
  });

  describe('Include Limits - HasMany Relationships', () => {
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
          name: 'Test Publisher'
        }, {
            country: createRelationship({ type: 'countries', id: String(country.id) })
          })
      });

      // Create 25 books for the publisher
      for (let i = 1; i <= 25; i++) {
        await api.resources.books.post({
          inputRecord: createJsonApiDocument('books', {
              title: `Book ${i}`
            }, {
                publisher: createRelationship({ type: 'publishers', id: String(publisher.id) })
              })
        });
      }
    });

    it('should apply default limit to hasMany includes when not specified', async () => {
      // Query publishers with books (no explicit limit in include config)
      const result = await api.resources.publishers.query({
        queryParams: {
          include: ['books']
        },
        simplified: false
      });

      assert(result.data, 'Result should have data array');
      assert(result.data.length > 0, 'Should have at least one publisher');
      
      const publisher = result.data[0];
      const publisherBooks = (result.included || []).filter(r => r.type === 'books');

      // Should apply queryDefaultLimit of 10
      assert.equal(publisherBooks.length, 10, 'Should include only 10 books by default');
    });

    it('should respect explicit limit in relationship config', async () => {
      // Create a country first
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
      });
      
      // Create a publisher
      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Test Publisher'
        }, {
          country: createRelationship({ type: 'countries', id: String(country.id) })
        })
      });

      // Create authors with many books
      const author = await api.resources.authors.post({
        inputRecord: createJsonApiDocument('authors', {
          name: 'Test Author'
        }, {
            country: createRelationship({ type: 'countries', id: String(country.id) })
          })
      });

      // Create 10 books and associate with author
      for (let i = 1; i <= 10; i++) {
        const book = await api.resources.books.post({
          inputRecord: createJsonApiDocument('books', {
              title: `Book ${i}`
            }, {
                publisher: createRelationship({ type: 'publishers', id: String(publisher.id) })
              })
        });

        await api.resources.book_authors.post({
          inputRecord: createJsonApiDocument('book_authors', {}, {
              book: createRelationship({ type: 'books', id: String(book.id) }),
              author: createRelationship({ type: 'authors', id: String(author.id) })
            })
        });
      }

      // Query authors with books (has explicit limit of 3)
      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books']
        },
        simplified: false
      });

      const authorBooks = result.included.filter(r => r.type === 'books');
      assert.equal(authorBooks.length, 3, 'Should respect explicit limit of 3');
    });
  });

  describe('Include Limits - Polymorphic Relationships', () => {
    beforeEach(async () => {
      // Create a country first
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
      });

      // Create a publisher with country
      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Test Publisher'
        }, {
            country: createRelationship({ type: 'countries', id: String(country.id) })
          })
      });

      // Create books with reviews
      for (let bookNum = 1; bookNum <= 3; bookNum++) {
        const book = await api.resources.books.post({
          inputRecord: {
            data: {
              type: 'books',
              attributes: {
                title: `Book ${bookNum}`
              },
              relationships: {
                publisher: { data: { type: 'publishers', id: publisher.id } }
              }
            }
          }
        });

        // Create 15 reviews for each book
        for (let i = 1; i <= 15; i++) {
          await api.resources.reviews.post({
            inputRecord: {
              data: {
                type: 'reviews',
                attributes: {
                  content: `Review ${i} for Book ${bookNum}`,
                  rating: Math.floor(Math.random() * 5) + 1,
                  reviewer_name: `Reviewer ${i}`
                },
                relationships: {
                  reviewable: {
                    data: { type: 'books', id: book.id }
                  }
                }
              }
            },
            simplified: false
          });
        }
      }
    });

    it('should apply default limit to polymorphic hasMany includes', async () => {
      // Query books with reviews
      const result = await api.resources.books.query({
        queryParams: {
          include: ['reviews']
        },
        simplified: false
      });

      // Without window strategy, the default strategy will limit total reviews
      const totalReviews = result.included.filter(r => r.type === 'reviews');
      
      // Should apply queryDefaultLimit of 10 to total reviews
      assert.equal(totalReviews.length, 10, 'Should limit total reviews to default of 10');
    });
  });

  describe('Include Limit Validation', () => {
    it('should throw error when include limit exceeds queryMaxLimit at resource definition', async () => {
      // Create a new API instance with stricter limits
      const strictApi = new Api({ name: 'strict-api' });
      
      await strictApi.use(RestApiPlugin, {
        queryDefaultLimit: 5,
        queryMaxLimit: 20,
        simplified: false,
        returnFullRecord: {
          post: true
        }
      });
      
      await strictApi.use(RestApiKnexPlugin, { knex });

      // Try to create a resource with include limit exceeding max
      await assert.rejects(
        async () => {
          await strictApi.addResource('test_items', {
            schema: {
              id: { type: 'id' },
              name: { type: 'string' }
            },
            relationships: {
              subitems: {
                type: 'hasMany',
                target: 'subitems',
                foreignKey: 'test_item_id',
                include: {
                  limit: 25  // Exceeds queryMaxLimit of 20
                }
              }
            }
          });
        },
        (err) => {
          return err.message && err.message.includes('limit') && err.message.includes('exceeds queryMaxLimit');
        },
        'Should throw error for excessive include limit'
      );
    });
  });

  describe('Window Strategy with Defaults', () => {
    beforeEach(async () => {
      // Create a country first
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'USA',
          code: 'US'
        })
      });

      // Create multiple publishers with different numbers of books
      for (let pubNum = 1; pubNum <= 3; pubNum++) {
        const publisher = await api.resources.publishers.post({
          inputRecord: {
            data: createJsonApiDocument('publishers', {
              name: `Publisher ${pubNum}`
            }, {
                country: createRelationship({ type: 'countries', id: String(country.id) })
              }).data
          }
        })

        // Create different number of books for each publisher
        const bookCount = pubNum * 8; // 8, 16, 24 books
        for (let i = 1; i <= bookCount; i++) {
          await api.resources.books.post({
            inputRecord: {
              data: {
                type: 'books',
                attributes: {
                  title: `Publisher ${pubNum} Book ${i}`
                },
                relationships: {
                  publisher: { data: { type: 'publishers', id: publisher.id } }
                }
              }
            }
          });
        }
      }
    });

    it('should apply per-parent limits with window strategy', async () => {
      // Query all publishers with books (window strategy configured)
      const result = await api.resources.publishers.query({
        queryParams: {
          include: ['books']
        },
        simplified: false
      });

      // Each publisher should have its own limit applied
      for (const publisher of result.data) {
        const publisherBooks = result.included.filter(r => 
          r.type === 'books' && 
          r.relationships.publisher.data.id === publisher.id
        );
        
        // Each publisher gets up to queryDefaultLimit (10) books
        assert(publisherBooks.length <= 10, 
          `Publisher ${publisher.id} should have at most 10 books with window strategy`);
      }

      // Total books can exceed queryDefaultLimit since each parent gets its own limit
      const totalBooks = result.included.filter(r => r.type === 'books').length;
      assert(totalBooks > 10, 'Total books should exceed 10 with window strategy');
      // Publisher 1 has 8 books, Publishers 2 and 3 are limited to 10 each
      assert.equal(totalBooks, 28, 'Should have 28 total books (8 + 10 + 10)');
    });
  });

  describe('Many-to-Many with Window Strategy', () => {
    it('should apply window limits to many-to-many relationships', async () => {
      // Create test data
      const country = await api.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', {
          name: 'USA',
          code: 'US'
        })
      });

      const publisher = await api.resources.publishers.post({
        inputRecord: createJsonApiDocument('publishers', {
          name: 'Test Publisher'
        }, {
            country: createRelationship({ type: 'countries', id: String(country.id) })
          })
      });

      // Create 2 authors
      const authors = [];
      for (let i = 1; i <= 2; i++) {
        const author = await api.resources.authors.post({
          inputRecord: createJsonApiDocument('authors', {
            name: `Author ${i}`
          }, {
              country: createRelationship({ type: 'countries', id: String(country.id) })
            })
        });
        authors.push(author);
      }

      // Create 10 books and associate ALL with BOTH authors
      for (let i = 1; i <= 10; i++) {
        const book = await api.resources.books.post({
          inputRecord: createJsonApiDocument('books', {
              title: `Book ${i}`
            }, {
                publisher: createRelationship({ type: 'publishers', id: String(publisher.id) })
              })
        });

        // Associate with both authors
        for (const author of authors) {
          await api.resources.book_authors.post({
            inputRecord: createJsonApiDocument('book_authors', {}, {
              book: createRelationship({ type: 'books', id: String(book.id) }),
              author: createRelationship({ type: 'authors', id: String(author.id) })
            })
          });
        }
      }

      // Query authors with books (configured with limit: 3, strategy: window)
      const result = await api.resources.authors.query({
        queryParams: {
          include: ['books']
        },
        simplified: false
      });

      
      // Each author should get exactly 3 books (configured limit)
      for (const author of result.data) {
        // Check the author's relationships to see which books they have
        const authorBookIds = author.relationships?.books?.data?.map(b => b.id) || [];
        
        // Verify the books exist in the included array
        const authorBooks = result.included.filter(r => 
          r.type === 'books' && authorBookIds.includes(r.id)
        );
        
        assert.equal(authorBookIds.length, 3, 
          `Author ${author.id} should have exactly 3 book relationships (configured limit)`);
        assert.equal(authorBooks.length, 3, 
          `Author ${author.id} should have exactly 3 books in included array`);
      }
    });
  });
});