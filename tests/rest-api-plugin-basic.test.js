import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { 
  RestApiValidationError, 
  RestApiResourceError, 
  RestApiPayloadError 
} from '../lib/rest-api-errors.js';

describe('RestApiPlugin', () => {
  let api;
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      pageSize: 10,
      maxPageSize: 50,
      sortableFields: ['title', 'created_at'],
      defaultSort: ['title'],
      returnFullRecord: {
        post: true,
        put: true,
        patch: true
      }
    });
    
    // Add a test scope
    api.addResource('books', {
      schema: {
        title: { type: 'string', required: true, max: 200 },
        author: { type: 'string', required: true },
        year: { type: 'number', min: 1000, max: 3000 },
        isbn: { type: 'string' },
        published: { type: 'boolean', default: false }
      }
    });
    
    // Mock data storage
    const mockBooks = [
      { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925, published: true },
      { id: '2', title: '1984', author: 'George Orwell', year: 1949, published: true },
      { id: '3', title: 'Draft Book', author: 'Unknown Author', year: 2024, published: false }
    ];
    
    // Mock storage helpers
    api.customize({
      helpers: {
        dataExists: async ({ scopeName, id }) => {
          if (scopeName === 'books') {
            return mockBooks.some(book => book.id === id);
          }
          return false;
        },
        
        dataGet: async ({ scopeName, id, queryParams = {} }) => {
          if (scopeName === 'books') {
            const book = mockBooks.find(book => book.id === id);
            if (!book) {
              throw new RestApiResourceError(`Book with id ${id} not found`, {
                subtype: 'not_found',
                resourceType: 'books',
                resourceId: id
              });
            }
            
            return {
              data: {
                type: 'books',
                id: book.id,
                attributes: { ...book, id: undefined }
              }
            };
          }
          return null;
        },
        
        dataQuery: async ({ scopeName, queryParams = {} }) => {
          if (scopeName === 'books') {
            let books = [...mockBooks];
            
            // Apply filters
            if (queryParams.filters) {
              Object.entries(queryParams.filters).forEach(([key, value]) => {
                books = books.filter(book => book[key] === value);
              });
            }
            
            // Apply sorting
            if (queryParams.sort && queryParams.sort.length > 0) {
              books.sort((a, b) => {
                for (const sortField of queryParams.sort) {
                  const desc = sortField.startsWith('-');
                  const field = desc ? sortField.substring(1) : sortField;
                  const aVal = a[field];
                  const bVal = b[field];
                  if (aVal < bVal) return desc ? 1 : -1;
                  if (aVal > bVal) return desc ? -1 : 1;
                }
                return 0;
              });
            }
            
            // Apply pagination
            const pageSize = queryParams.page?.size || 10;
            const pageNumber = queryParams.page?.number || 1;
            const start = (pageNumber - 1) * pageSize;
            const end = start + pageSize;
            books = books.slice(start, end);
            
            return {
              data: books.map(book => ({
                type: 'books',
                id: book.id,
                attributes: { ...book, id: undefined }
              }))
            };
          }
          return { data: [] };
        },
        
        dataPost: async ({ scopeName, inputRecord }) => {
          if (scopeName === 'books') {
            const newId = String(Date.now());
            const newBook = {
              id: newId,
              ...inputRecord.data.attributes
            };
            mockBooks.push(newBook);
            
            return {
              data: {
                type: 'books',
                id: newId,
                attributes: inputRecord.data.attributes
              }
            };
          }
          return null;
        },
        
        dataPut: async ({ scopeName, id, inputRecord, isCreate }) => {
          if (scopeName === 'books') {
            if (isCreate) {
              // Create new record
              const newBook = {
                id: id,
                ...inputRecord.data.attributes
              };
              mockBooks.push(newBook);
            } else {
              // Update existing record
              const index = mockBooks.findIndex(book => book.id === id);
              if (index !== -1) {
                mockBooks[index] = {
                  id: id,
                  ...inputRecord.data.attributes
                };
              }
            }
            
            return {
              data: {
                type: 'books',
                id: id,
                attributes: inputRecord.data.attributes
              }
            };
          }
          return null;
        },
        
        dataPatch: async ({ scopeName, id, inputRecord }) => {
          if (scopeName === 'books') {
            const index = mockBooks.findIndex(book => book.id === id);
            if (index === -1) {
              throw new RestApiResourceError(`Book with id ${id} not found`, {
                subtype: 'not_found',
                resourceType: 'books',
                resourceId: id
              });
            }
            
            // Merge attributes
            Object.assign(mockBooks[index], inputRecord.data.attributes);
            
            return {
              data: {
                type: 'books',
                id: id,
                attributes: { ...mockBooks[index], id: undefined }
              }
            };
          }
          return null;
        },
        
        dataDelete: async ({ scopeName, id }) => {
          if (scopeName === 'books') {
            const index = mockBooks.findIndex(book => book.id === id);
            if (index === -1) {
              throw new RestApiResourceError(`Book with id ${id} not found`, {
                subtype: 'not_found',
                resourceType: 'books',
                resourceId: id
              });
            }
            mockBooks.splice(index, 1);
          }
        }
      }
    });
  });

  describe('Plugin Installation', () => {
    test('should install successfully and add rest namespace', async () => {
      assert.ok(api.rest, 'Should add rest namespace to API');
    });

    test('should set scope alias for resources', async () => {
      // The plugin should have set up the resources alias
      assert.ok(api.resources, 'Should have resources alias');
      assert.ok(api.resources.books, 'Should have books resource');
    });

    test('should add all required scope methods', async () => {
      const books = api.resources.books;
      assert.ok(typeof books.query === 'function', 'Should add query method');
      assert.ok(typeof books.get === 'function', 'Should add get method');
      assert.ok(typeof books.post === 'function', 'Should add post method');
      assert.ok(typeof books.put === 'function', 'Should add put method');
      assert.ok(typeof books.patch === 'function', 'Should add patch method');
      assert.ok(typeof books.delete === 'function', 'Should add delete method');
      assert.ok(typeof books.enrichAttributes === 'function', 'Should add enrichAttributes method');
    });
  });

  describe('Query Method (GET Collection)', () => {
    test('should retrieve all books', async () => {
      const result = await api.resources.books.query({});
      
      assert.ok(result.data, 'Should have data property');
      assert.ok(Array.isArray(result.data), 'Data should be an array');
      assert.strictEqual(result.data.length, 3, 'Should return all 3 books');
      
      const firstBook = result.data[0];
      assert.strictEqual(firstBook.type, 'books', 'Should have correct type');
      assert.ok(firstBook.id, 'Should have id');
      assert.ok(firstBook.attributes, 'Should have attributes');
      assert.ok(firstBook.attributes.title, 'Should have title in attributes');
    });

    test('should apply filters', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          filters: { published: true }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should return only published books');
      result.data.forEach(book => {
        assert.strictEqual(book.attributes.published, true, 'All returned books should be published');
      });
    });

    test('should apply sorting', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          sort: ['-title'] // Descending by title (which is sortable)
        }
      });
      
      // Should be sorted by title in descending order
      assert.ok(result.data.length >= 2, 'Should have at least 2 books');
      const firstTitle = result.data[0].attributes.title;
      const secondTitle = result.data[1].attributes.title;
      assert.ok(firstTitle >= secondTitle, 'Should be sorted in descending order by title');
    });

    test('should apply pagination', async () => {
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 2 }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should return only 2 books per page');
    });

    test('should validate invalid sort fields', async () => {
      await assert.rejects(
        api.resources.books.query({
          queryParams: {
            sort: ['invalid_field']
          }
        }),
        RestApiValidationError,
        'Should reject invalid sort field'
      );
    });
  });

  describe('Get Method (GET Single)', () => {
    test('should retrieve a single book by ID', async () => {
      const result = await api.resources.books.get({ id: '1' });
      
      assert.ok(result.data, 'Should have data property');
      assert.strictEqual(result.data.type, 'books', 'Should have correct type');
      assert.strictEqual(result.data.id, '1', 'Should have correct ID');
      assert.strictEqual(result.data.attributes.title, 'The Great Gatsby', 'Should have correct title');
    });

    test('should throw error for non-existent book', async () => {
      await assert.rejects(
        api.resources.books.get({ id: '999' }),
        RestApiResourceError,
        'Should throw ResourceError for non-existent book'
      );
    });

    test('should validate missing ID parameter', async () => {
      await assert.rejects(
        api.resources.books.get({}),
        RestApiValidationError,
        'Should reject missing ID parameter'
      );
    });

    test('should validate empty ID parameter', async () => {
      await assert.rejects(
        api.resources.books.get({ id: '' }),
        RestApiValidationError,
        'Should reject empty ID parameter'
      );
    });
  });

  describe('Post Method (CREATE)', () => {
    test('should create a new book', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'New Book',
            author: 'New Author',
            year: 2024,
            published: false
          }
        }
      };

      const result = await api.resources.books.post({ inputRecord });
      
      assert.ok(result.data, 'Should have data property');
      assert.strictEqual(result.data.type, 'books', 'Should have correct type');
      assert.ok(result.data.id, 'Should have generated ID');
      assert.strictEqual(result.data.attributes.title, 'New Book', 'Should have correct title');
      assert.strictEqual(result.data.attributes.author, 'New Author', 'Should have correct author');
    });

    test('should validate required fields', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            // Missing required title and author
            year: 2024
          }
        }
      };

      await assert.rejects(
        api.resources.books.post({ inputRecord }),
        RestApiValidationError,
        'Should reject missing required fields'
      );
    });

    test('should validate field constraints', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'Valid Title',
            author: 'Valid Author',
            year: 999 // Invalid year (too low)
          }
        }
      };

      await assert.rejects(
        api.resources.books.post({ inputRecord }),
        RestApiValidationError,
        'Should reject invalid field values'
      );
    });

    test('should validate JSON:API document structure', async () => {
      await assert.rejects(
        api.resources.books.post({ inputRecord: { invalid: 'structure' } }),
        RestApiPayloadError,
        'Should reject invalid JSON:API document'
      );
    });

    test('should validate resource type match', async () => {
      const inputRecord = {
        data: {
          type: 'articles', // Wrong type
          attributes: {
            title: 'Valid Title',
            author: 'Valid Author'
          }
        }
      };

      await assert.rejects(
        api.resources.books.post({ inputRecord }),
        RestApiValidationError,
        'Should reject type mismatch'
      );
    });
  });

  describe('Put Method (UPDATE/REPLACE)', () => {
    test('should update an existing book', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Updated Title',
            author: 'Updated Author',
            year: 2024,
            published: true
          }
        }
      };

      const result = await api.resources.books.put({ inputRecord });
      
      assert.ok(result.data, 'Should have data property');
      assert.strictEqual(result.data.id, '1', 'Should have correct ID');
      assert.strictEqual(result.data.attributes.title, 'Updated Title', 'Should have updated title');
      assert.strictEqual(result.data.attributes.author, 'Updated Author', 'Should have updated author');
    });

    test('should extract ID from request body (JSON:API compliance)', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '2', // ID in request body
          attributes: {
            title: 'Updated via Body ID',
            author: 'Test Author',
            year: 2024
          }
        }
      };

      const result = await api.resources.books.put({ inputRecord });
      assert.strictEqual(result.data.id, '2', 'Should use ID from request body');
    });

    test('should validate ID consistency when both URL and body IDs provided', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1', // Body ID
          attributes: {
            title: 'Test',
            author: 'Test'
          }
        }
      };

      await assert.rejects(
        api.resources.books.put({ 
          id: '2', // URL ID (different from body)
          inputRecord 
        }),
        RestApiValidationError,
        'Should reject ID mismatch'
      );
    });

    test('should allow URL and body IDs when they match', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1', // Body ID
          attributes: {
            title: 'Matching IDs',
            author: 'Test Author',
            year: 2024
          }
        }
      };

      const result = await api.resources.books.put({ 
        id: '1', // URL ID (same as body)
        inputRecord 
      });
      
      assert.strictEqual(result.data.id, '1', 'Should work with matching IDs');
      assert.strictEqual(result.data.attributes.title, 'Matching IDs', 'Should update correctly');
    });

    test('should reject PUT with included array', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Test'
          }
        },
        included: [
          { type: 'authors', id: '1', attributes: { name: 'Test' } }
        ]
      };

      await assert.rejects(
        api.resources.books.put({ inputRecord }),
        RestApiPayloadError,
        'Should reject included array in PUT'
      );
    });

    test('should validate required ID in request body', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          // Missing ID
          attributes: {
            title: 'Test',
            author: 'Test'
          }
        }
      };

      await assert.rejects(
        api.resources.books.put({ inputRecord }),
        RestApiPayloadError,
        'Should reject missing ID in request body'
      );
    });
  });

  describe('Patch Method (PARTIAL UPDATE)', () => {
    test('should partially update a book', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Partially Updated Title'
            // Only updating title, other fields should remain
          }
        }
      };

      const result = await api.resources.books.patch({ inputRecord });
      
      assert.strictEqual(result.data.id, '1', 'Should have correct ID');
      assert.strictEqual(result.data.attributes.title, 'Partially Updated Title', 'Should have updated title');
      // Other attributes should be preserved by the mock
    });

    test('should extract ID from request body (JSON:API compliance)', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '2',
          attributes: {
            title: 'Patched via Body ID'
          }
        }
      };

      const result = await api.resources.books.patch({ inputRecord });
      assert.strictEqual(result.data.id, '2', 'Should use ID from request body');
    });

    test('should validate ID consistency', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Test'
          }
        }
      };

      await assert.rejects(
        api.resources.books.patch({ 
          id: '2', // Different from body ID
          inputRecord 
        }),
        RestApiValidationError,
        'Should reject ID mismatch'
      );
    });

    test('should require at least one of attributes or relationships', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1'
          // Missing both attributes and relationships
        }
      };

      await assert.rejects(
        api.resources.books.patch({ inputRecord }),
        RestApiValidationError,
        'Should reject patch with no attributes or relationships'
      );
    });

    test('should reject PATCH with included array', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Test'
          }
        },
        included: [
          { type: 'authors', id: '1', attributes: { name: 'Test' } }
        ]
      };

      await assert.rejects(
        api.resources.books.patch({ inputRecord }),
        RestApiPayloadError,
        'Should reject included array in PATCH'
      );
    });

    test('should handle non-existent resource', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '999',
          attributes: {
            title: 'Non-existent'
          }
        }
      };

      await assert.rejects(
        api.resources.books.patch({ inputRecord }),
        RestApiResourceError,
        'Should reject patch of non-existent resource'
      );
    });
  });

  describe('Delete Method', () => {
    test('should delete a book', async () => {
      const result = await api.resources.books.delete({ id: '1' });
      
      // Delete typically returns nothing or empty response
      assert.strictEqual(result, undefined, 'Delete should return undefined');
      
      // Verify book is actually deleted
      await assert.rejects(
        api.resources.books.get({ id: '1' }),
        RestApiResourceError,
        'Deleted book should not be found'
      );
    });

    test('should handle non-existent resource', async () => {
      await assert.rejects(
        api.resources.books.delete({ id: '999' }),
        RestApiResourceError,
        'Should reject delete of non-existent resource'
      );
    });

    test('should validate missing ID parameter', async () => {
      await assert.rejects(
        api.resources.books.delete({}),
        Error, // Could be any error type
        'Should reject missing ID parameter'
      );
    });
  });

  describe('EnrichAttributes Method', () => {
    test('should enrich attributes through scope method', async () => {
      const attributes = {
        title: 'Test Book',
        author: 'Test Author',
        year: 2024
      };

      const result = await api.resources.books.enrichAttributes({
        attributes,
        parentContext: {}
      });

      assert.deepStrictEqual(result, attributes, 'Should return enriched attributes');
    });
  });

  describe('Plugin Configuration', () => {
    test('should use plugin options for configuration', async () => {
      // Test pagination with configured page size
      const result = await api.resources.books.query({
        queryParams: {
          page: { number: 1, size: 2 }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should respect configured page size');
    });

    test('should use default sort when no sort specified', async () => {
      const result = await api.resources.books.query({});
      
      // Should be sorted by title (default sort configured in beforeEach)
      assert.strictEqual(result.data[0].attributes.title, '1984', 'Should apply default sort');
    });
  });

  describe('Error Handling', () => {
    test('should handle validation errors properly', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            // Missing required fields
            year: 2024
          }
        }
      };

      try {
        await api.resources.books.post({ inputRecord });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert.ok(error instanceof RestApiValidationError, 'Should be RestApiValidationError');
        assert.ok(error.violations, 'Should have violations array');
        assert.ok(error.details?.fields || error.fields, 'Should have fields array');
      }
    });

    test('should handle payload errors properly', async () => {
      try {
        await api.resources.books.post({ inputRecord: { invalid: 'structure' } });
        assert.fail('Should have thrown payload error');
      } catch (error) {
        assert.ok(error instanceof RestApiPayloadError, 'Should be RestApiPayloadError');
        assert.ok(error.path || error.details?.path, 'Should have path property');
        assert.ok(error.expected || error.details?.expected, 'Should have expected property');
      }
    });

    test('should handle resource errors properly', async () => {
      try {
        await api.resources.books.get({ id: '999' });
        assert.fail('Should have thrown resource error');
      } catch (error) {
        assert.ok(error instanceof RestApiResourceError, 'Should be RestApiResourceError');
        assert.strictEqual(error.subtype, 'not_found', 'Should have correct subtype');
        assert.strictEqual(error.details.resourceType, 'books', 'Should have resource type');
        assert.strictEqual(error.details.resourceId, '999', 'Should have resource ID');
      }
    });
  });
});