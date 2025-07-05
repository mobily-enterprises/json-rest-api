import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { HttpPlugin } from '../plugins/core/connectors/http-plugin.js';
import { 
  RestApiValidationError, 
  RestApiResourceError, 
  RestApiPayloadError 
} from '../lib/rest-api-errors.js';

describe('HttpPlugin', () => {
  let api;
  let server;
  let baseUrl;
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    // Create API instance
    api = new Api({
      name: 'test-http-api',
      version: '1.0.0'
    });
    
    // Install REST API plugin first (dependency)
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      pageSize: 10,
      sortableFields: ['title', 'created_at', 'year', 'author'],
      returnFullRecord: {
        post: true,
        put: true,
        patch: true
      }
    });
  });
  
  // Helper function to set up resources and data after plugins are installed
  const setupResourcesAndData = () => {
    // Add test resources AFTER plugins are installed
    api.addResource('books', {
      schema: {
        title: { type: 'string', required: true, search: true },
        author: { type: 'string', required: true, search: true },
        year: { type: 'number', min: 1000, max: 3000, search: true },
        published: { type: 'boolean', default: false, search: true }
      }
    });
    
    api.addResource('authors', {
      schema: {
        name: { type: 'string', required: true, search: true },
        bio: { type: 'string', search: true }
      }
    });
    
    // Mock data storage
    const mockBooks = [
      { id: '1', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', year: 1925, published: true },
      { id: '2', title: '1984', author: 'George Orwell', year: 1949, published: true },
      { id: '3', title: 'Draft Book', author: 'Unknown Author', year: 2024, published: false }
    ];
    
    const mockAuthors = [
      { id: '1', name: 'F. Scott Fitzgerald', bio: 'American novelist' },
      { id: '2', name: 'George Orwell', bio: 'British author' }
    ];
    
    // Mock storage helpers
    api.customize({
      helpers: {
        dataExists: async ({ scopeName, id }) => {
          if (scopeName === 'books') {
            return mockBooks.some(book => book.id === id);
          }
          if (scopeName === 'authors') {
            return mockAuthors.some(author => author.id === id);
          }
          return false;
        },
        
        dataGet: async ({ scopeName, id }) => {
          let record;
          if (scopeName === 'books') {
            record = mockBooks.find(book => book.id === id);
          } else if (scopeName === 'authors') {
            record = mockAuthors.find(author => author.id === id);
          }
          
          if (!record) {
            throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
              subtype: 'not_found',
              resourceType: scopeName,
              resourceId: id
            });
          }
          
          return {
            data: {
              type: scopeName,
              id: record.id,
              attributes: { ...record, id: undefined }
            }
          };
        },
        
        dataQuery: async ({ scopeName, queryParams = {}, searchSchema }) => {
          let records = [];
          if (scopeName === 'books') {
            records = [...mockBooks];
          } else if (scopeName === 'authors') {
            records = [...mockAuthors];
          }
          
          // Apply filters (values already type-converted by REST API validation)
          if (queryParams.filters && Object.keys(queryParams.filters).length > 0) {
            Object.entries(queryParams.filters).forEach(([key, value]) => {
              records = records.filter(record => {
                return record[key] === value;
              });
            });
          }
          
          // Apply sorting
          if (queryParams.sort && queryParams.sort.length > 0) {
            records.sort((a, b) => {
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
          records = records.slice(start, end);
          
          return {
            data: records.map(record => ({
              type: scopeName,
              id: record.id,
              attributes: { ...record, id: undefined }
            }))
          };
        },
        
        dataPost: async ({ scopeName, inputRecord }) => {
          const newId = String(Date.now());
          const newRecord = {
            id: newId,
            ...inputRecord.data.attributes
          };
          
          if (scopeName === 'books') {
            mockBooks.push(newRecord);
          } else if (scopeName === 'authors') {
            mockAuthors.push(newRecord);
          }
          
          return {
            data: {
              type: scopeName,
              id: newId,
              attributes: inputRecord.data.attributes
            }
          };
        },
        
        dataPut: async ({ scopeName, id, inputRecord }) => {
          let records = scopeName === 'books' ? mockBooks : mockAuthors;
          const index = records.findIndex(record => record.id === id);
          
          if (index === -1) {
            // Create new record
            const newRecord = { id: id, ...inputRecord.data.attributes };
            records.push(newRecord);
          } else {
            // Update existing record
            records[index] = { id: id, ...inputRecord.data.attributes };
          }
          
          return {
            data: {
              type: scopeName,
              id: id,
              attributes: inputRecord.data.attributes
            }
          };
        },
        
        dataPatch: async ({ scopeName, id, inputRecord }) => {
          let records = scopeName === 'books' ? mockBooks : mockAuthors;
          const index = records.findIndex(record => record.id === id);
          
          if (index === -1) {
            throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
              subtype: 'not_found',
              resourceType: scopeName,
              resourceId: id
            });
          }
          
          // Merge attributes
          Object.assign(records[index], inputRecord.data.attributes);
          
          return {
            data: {
              type: scopeName,
              id: id,
              attributes: { ...records[index], id: undefined }
            }
          };
        },
        
        dataDelete: async ({ scopeName, id }) => {
          let records = scopeName === 'books' ? mockBooks : mockAuthors;
          const index = records.findIndex(record => record.id === id);
          
          if (index === -1) {
            throw new RestApiResourceError(`${scopeName} with id ${id} not found`, {
              subtype: 'not_found',
              resourceType: scopeName,
              resourceId: id
            });
          }
          
          records.splice(index, 1);
        }
      }
    });
  }; // End of setupResourcesAndData helper function
  
  afterEach(async () => {
    if (server) {
      await new Promise(resolve => {
        server.close(resolve);
      });
      server = null;
    }
  });

  describe('Plugin Installation', () => {
    test('should install successfully and create http namespace', async () => {
      await api.use(HttpPlugin, {
        port: 0, // Use random port
        basePath: '/api',
        strictContentType: true
      });
      
      setupResourcesAndData();
      
      assert.ok(api.http, 'Should create http namespace');
      assert.ok(api.http.server, 'Should create server');
      assert.ok(api.http.handler, 'Should create handler function');
      assert.ok(typeof api.http.startServer === 'function', 'Should create startServer function');
    });

    test('should require rest-api plugin as dependency', async () => {
      resetGlobalRegistryForTesting();
      
      const newApi = new Api({
        name: 'test-dependency-api', 
        version: '1.0.0'
      });
      
      // This should fail because rest-api plugin is not installed
      await assert.rejects(
        newApi.use(HttpPlugin),
        Error,
        'Should require rest-api plugin'
      );
    });

    test('should start server on configured port', async () => {
      await api.use(HttpPlugin, {
        port: 0, // Use random port
        basePath: '/api'
      });
      
      setupResourcesAndData();
      
      server = api.http.startServer();
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      
      assert.ok(port > 0, 'Should bind to a valid port');
      
      // Test basic connectivity
      const response = await fetch(`${baseUrl}/api/books`);
      assert.strictEqual(response.status, 200);
    });

    test('should use custom basePath', async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/v1/api'
      });
      
      setupResourcesAndData();
      
      server = api.http.startServer();
      const port = server.address().port;
      
      const response = await fetch(`http://localhost:${port}/v1/api/books`);
      assert.strictEqual(response.status, 200, 'Should respond on custom basePath');
    });
  });

  describe('HTTP Endpoints', () => {
    beforeEach(async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api',
        strictContentType: false // Disable for easier testing
      });
      
      setupResourcesAndData();
      
      // Start server for this test suite on random port
      server = api.http.startServer(0);
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    test('GET /api/{scope} - should query collection', async () => {
      const response = await fetch(`${baseUrl}/api/books`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'application/vnd.api+json');
      assert.ok(Array.isArray(data.data));
      assert.strictEqual(data.data.length, 3);
      assert.strictEqual(data.data[0].type, 'books');
    });

    test('GET /api/{scope}?filter[key]=value - should apply filters', async () => {
      const response = await fetch(`${baseUrl}/api/books?filter[published]=true`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data.length, 2);
      data.data.forEach(book => {
        assert.strictEqual(book.attributes.published, true);
      });
    });

    test('GET /api/{scope}?sort=field - should apply sorting', async () => {
      const response = await fetch(`${baseUrl}/api/books?sort=-title`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.ok(data.data.length >= 2);
      // Should be sorted by title descending
      assert.ok(data.data[0].attributes.title >= data.data[1].attributes.title);
    });

    test('GET /api/{scope}?page[size]=1 - should apply pagination', async () => {
      const response = await fetch(`${baseUrl}/api/books?page[size]=1`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data.length, 1);
    });

    test('GET /api/{scope}/{id} - should get single resource', async () => {
      const response = await fetch(`${baseUrl}/api/books/1`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data.type, 'books');
      assert.strictEqual(data.data.id, '1');
      assert.strictEqual(data.data.attributes.title, 'The Great Gatsby');
    });

    test('GET /api/{scope}/999 - should return 404 for non-existent resource', async () => {
      const response = await fetch(`${baseUrl}/api/books/999`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 404);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '404');
    });

    test('POST /api/{scope} - should create resource', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'New Book',
            author: 'New Author',
            year: 2024
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 201);
      assert.strictEqual(data.data.type, 'books');
      assert.ok(data.data.id);
      assert.strictEqual(data.data.attributes.title, 'New Book');
    });

    test('POST /api/{scope} - should validate required fields', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            // Missing required title and author
            year: 2024
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 422);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '422');
    });

    test('PUT /api/{scope}/{id} - should update resource', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Updated Title',
            author: 'Updated Author',
            year: 2024
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books/1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data.id, '1');
      assert.strictEqual(data.data.attributes.title, 'Updated Title');
    });

    test('PATCH /api/{scope}/{id} - should partially update resource', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          id: '1',
          attributes: {
            title: 'Partially Updated Title'
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books/1`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.data.id, '1');
      assert.strictEqual(data.data.attributes.title, 'Partially Updated Title');
    });

    test('DELETE /api/{scope}/{id} - should delete resource', async () => {
      const response = await fetch(`${baseUrl}/api/books/1`, {
        method: 'DELETE'
      });
      
      assert.strictEqual(response.status, 204);
      
      // Verify book is deleted
      const getResponse = await fetch(`${baseUrl}/api/books/1`);
      assert.strictEqual(getResponse.status, 404);
    });

    test('should return 404 for non-existent endpoints', async () => {
      const response = await fetch(`${baseUrl}/api/nonexistent`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 404);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '404');
    });

    test('should return 405 for invalid methods', async () => {
      // POST to single resource (not allowed)
      const response = await fetch(`${baseUrl}/api/books/1`, {
        method: 'POST'
      });
      
      assert.strictEqual(response.status, 405);
    });
  });

  describe('Content Type Validation', () => {
    beforeEach(async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api',
        strictContentType: true
      });
      
      setupResourcesAndData();
      
      // Start server for this test suite on random port
      server = api.http.startServer(0);
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    test('should accept application/vnd.api+json', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'Test Book',
            author: 'Test Author'
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      assert.strictEqual(response.status, 201);
    });

    test('should accept application/json', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'Test Book',
            author: 'Test Author'
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      assert.strictEqual(response.status, 201);
    });

    test('should reject invalid content types', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            title: 'Test Book',
            author: 'Test Author'
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 415);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '415');
      assert.strictEqual(data.errors[0].title, 'Unsupported Media Type');
    });

    test('should not validate content type for GET requests', async () => {
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain'
        }
      });
      
      assert.strictEqual(response.status, 200);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api',
        strictContentType: false
      });
      
      setupResourcesAndData();
      
      // Start server for this test suite on random port
      server = api.http.startServer(0);
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    test('should handle validation errors (422)', async () => {
      const inputRecord = {
        data: {
          type: 'books',
          attributes: {
            // Missing required fields
            year: 2024
          }
        }
      };
      
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inputRecord)
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 422);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '422');
      assert.strictEqual(data.errors[0].title, 'Validation Error');
    });

    test('should handle resource not found errors (404)', async () => {
      const response = await fetch(`${baseUrl}/api/books/999`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 404);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '404');
      assert.strictEqual(data.errors[0].title, 'Not Found');
    });

    test('should handle payload errors (400)', async () => {
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invalid: 'structure' })
      });
      
      const data = await response.json();
      
      assert.strictEqual(response.status, 400);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '400');
    });

    test('should handle unknown scope errors (404)', async () => {
      const response = await fetch(`${baseUrl}/api/nonexistent`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 404);
      assert.ok(data.errors);
      assert.strictEqual(data.errors[0].status, '404');
    });

    test('should handle malformed JSON (400)', async () => {
      const response = await fetch(`${baseUrl}/api/books`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: 'invalid json{'
      });
      
      // Should return 400 for malformed JSON
      assert.strictEqual(response.status, 400);
    });
  });

  describe('Query Parameter Parsing', () => {
    beforeEach(async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api'
      });
      
      setupResourcesAndData();
      
      // Start server for this test suite on random port
      server = api.http.startServer(0);
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
    });

    test('should parse include parameter', async () => {
      const response = await fetch(`${baseUrl}/api/books?include=author,publisher`);
      
      assert.strictEqual(response.status, 200);
      // The query parameters are parsed and passed to the API method
    });

    test('should parse fields parameter', async () => {
      const response = await fetch(`${baseUrl}/api/books?fields[books]=title,author&fields[authors]=name`);
      
      assert.strictEqual(response.status, 200);
    });

    test('should parse filter parameter', async () => {
      const response = await fetch(`${baseUrl}/api/books?filter[published]=true&filter[year]=1949`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      // Should filter by both published=true and year=1949
      data.data.forEach(book => {
        assert.strictEqual(book.attributes.published, true);
        assert.strictEqual(book.attributes.year, 1949);
      });
    });

    test('should parse sort parameter', async () => {
      const response = await fetch(`${baseUrl}/api/books?sort=title,-year`);
      
      assert.strictEqual(response.status, 200);
    });

    test('should parse page parameter', async () => {
      const response = await fetch(`${baseUrl}/api/books?page[size]=2&page[number]=1`);
      const data = await response.json();
      
      assert.strictEqual(response.status, 200);
      assert.ok(data.data.length <= 2);
    });
  });

  describe('Server Lifecycle', () => {
    test('should start server with custom port', async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api'
      });
      
      setupResourcesAndData();
      
      server = api.http.startServer(0); // Use random port
      const port = server.address().port;
      
      assert.ok(port > 0, 'Should bind to a valid port');
      
      const response = await fetch(`http://localhost:${port}/api/books`);
      assert.strictEqual(response.status, 200);
    });

    test('should provide access to raw HTTP server', async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api'
      });
      
      setupResourcesAndData();
      
      // Should be able to configure the raw server
      assert.ok(api.http.server);
      assert.ok(typeof api.http.server.listen === 'function');
    });

    test('should provide request handler for custom server usage', async () => {
      await api.use(HttpPlugin, {
        port: 0,
        basePath: '/api'
      });
      
      setupResourcesAndData();
      
      // Should be able to use the handler independently
      assert.ok(api.http.handler);
      assert.ok(typeof api.http.handler === 'function');
    });
  });
});