import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { spawn } from 'child_process';
import { createBasicApi } from './fixtures/api-configs.js';
import {
  validateJsonApiStructure,
  resourceIdentifier,
  cleanTables,
  createJsonApiDocument,
  createRelationship,
  createToManyRelationship
} from './helpers/test-utils.js';
import express from 'express';
import http from 'http';

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
let app;
let server;
const TEST_PORT = 3456;

/**
 * Execute a CURL command and return the response
 * @param {string[]} args - The curl command arguments
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function executeCurl(args) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', args, {
      shell: false
    });
    
    let stdout = '';
    let stderr = '';
    
    curl.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    curl.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    curl.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code
      });
    });
    
    curl.on('error', (error) => {
      reject(error);
    });
  });
}

describe('CURL HTTP Abstraction Layer Tests', () => {
  before(async () => {
    // Initialize API with Express plugin
    basicApi = await createBasicApi(knex, { includeExpress: true });
    
    // Create Express app
    app = express();
    
    // Mount the API routes
    basicApi.http.express.mount(app, '');
    
    // Start server
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(TEST_PORT, () => {
        console.log(`Test server started on port ${TEST_PORT}`);
        resolve();
      });
    });
    
  });

  after(async () => {
    // Close server
    await new Promise((resolve) => {
      server.close(() => {
        console.log('Test server closed');
        resolve();
      });
    });
    
    // Close database connection
    await knex.destroy();
  });

  describe('Basic CURL Operations', () => {
    let testData = {};

    beforeEach(async () => {
      // Clean all tables
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create test data using API methods
      const countryDoc = createJsonApiDocument('countries', { name: 'CURL Test Country', code: 'CT' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      testData.country = countryResult.data;
    });

    it('should GET a resource using CURL', async () => {
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/countries/${testData.country.id}`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, false);
      
      assert.equal(response.data.type, 'countries');
      assert.equal(response.data.id, testData.country.id);
      assert.equal(response.data.attributes.name, 'CURL Test Country');
      assert.equal(response.data.attributes.code, 'CT');
    });

    it('should GET collection using CURL', async () => {
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/countries`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, true);
      
      assert(Array.isArray(response.data), 'Response data should be an array');
      assert.equal(response.data.length, 1, 'Should have one country');
      assert.equal(response.data[0].type, 'countries');
      assert.equal(response.data[0].attributes.name, 'CURL Test Country');
    });

    it('should POST a new resource using CURL', async () => {
      const newCountryDoc = createJsonApiDocument('countries', { name: 'New CURL Country', code: 'NC' });
      const jsonPayload = JSON.stringify(newCountryDoc);
      
      const result = await executeCurl(['-s', '-X', 'POST', '-H', 'Content-Type: application/vnd.api+json', '-H', 'Accept: application/vnd.api+json', '-d', jsonPayload, `http://localhost:${TEST_PORT}/api/countries`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, false);
      
      assert.equal(response.data.type, 'countries');
      assert(response.data.id, 'Should have an ID');
      assert.equal(response.data.attributes.name, 'New CURL Country');
      assert.equal(response.data.attributes.code, 'NC');
    });

    it('should PATCH a resource using CURL', async () => {
      const patchDoc = {
        data: {
          type: 'countries',
          id: String(testData.country.id),
          attributes: {
            name: 'Updated CURL Country'
          }
        }
      };
      const jsonPayload = JSON.stringify(patchDoc);
      
      const result = await executeCurl(['-s', '-X', 'PATCH', '-H', 'Content-Type: application/vnd.api+json', '-H', 'Accept: application/vnd.api+json', '-d', jsonPayload, `http://localhost:${TEST_PORT}/api/countries/${testData.country.id}`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      
      // PATCH is configured to return minimal JSON:API response
      assert(response.data, 'Should have data');
      assert.equal(response.data.type, 'countries', 'Should have correct type');
      assert.equal(response.data.id, String(testData.country.id), 'Should return correct ID');
      
      // Verify the update by fetching the record
      const verifyResult = await basicApi.resources.countries.get({
        id: testData.country.id,
        simplified: false
      });
      assert.equal(verifyResult.data.attributes.name, 'Updated CURL Country');
      assert.equal(verifyResult.data.attributes.code, 'CT', 'Code should remain unchanged');
    });

    it('should DELETE a resource using CURL', async () => {
      const result = await executeCurl(['-s', '-X', 'DELETE', '-w', '%{http_code}', '-o', '/dev/null', `http://localhost:${TEST_PORT}/api/countries/${testData.country.id}`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      assert.equal(result.stdout.trim(), '204', 'Should return 204 No Content');
      
      // Verify deletion
      try {
        await basicApi.resources.countries.get({
          id: testData.country.id,
          simplified: false
        });
        assert.fail('Should have thrown not found error');
      } catch (error) {
        assert.equal(error.code, 'REST_API_RESOURCE');
        assert.equal(error.subtype, 'not_found');
      }
    });

    it('should handle query parameters using CURL', async () => {
      // Create additional countries
      await basicApi.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'Another Country', code: 'AC' }),
        simplified: false
      });
      await basicApi.resources.countries.post({
        inputRecord: createJsonApiDocument('countries', { name: 'Third Country', code: 'TC2' }),
        simplified: false
      });

      // Test with filter (URL encode the space and square brackets)
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/countries?filter%5Bname%5D=Another%20Country`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, true);
      
      assert.equal(response.data.length, 1, 'Should filter to one country');
      assert.equal(response.data[0].attributes.name, 'Another Country');
    });

    it('should handle includes using CURL', async () => {
      // Create publisher with country relationship
      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'CURL Test Publisher' },
        { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });

      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/publishers/${publisherResult.data.id}?include=country`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, false);
      
      assert.equal(response.data.type, 'publishers');
      assert(response.included, 'Should have included data');
      assert.equal(response.included.length, 1, 'Should include one resource');
      assert.equal(response.included[0].type, 'countries');
      assert.equal(response.included[0].id, testData.country.id);
    });

    it('should handle errors using CURL', async () => {
      // Test 404 error
      const result404 = await executeCurl(['-s', '-w', '\\n%{http_code}', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/countries/999999`]);
      
      assert.equal(result404.exitCode, 0, 'CURL should exit successfully');
      
      const lines = result404.stdout.trim().split('\n');
      const httpCode = lines[lines.length - 1];
      const responseBody = lines.slice(0, -1).join('\n');
      
      assert.equal(httpCode, '404', 'Should return 404 status');
      
      const response = JSON.parse(responseBody);
      assert(response.errors, 'Should have errors array');
      assert.equal(response.errors[0].status, '404');
      assert.equal(response.errors[0].title, 'Not Found');

      // Test validation error - omit required name field
      const invalidDoc = createJsonApiDocument('countries', { code: 'XX' }); // Missing required name
      const jsonPayload = JSON.stringify(invalidDoc);
      
      const resultValidation = await executeCurl(['-s', '-w', '\n%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/vnd.api+json', '-H', 'Accept: application/vnd.api+json', '-d', jsonPayload, `http://localhost:${TEST_PORT}/api/countries`]);
      
      const validationLines = resultValidation.stdout.trim().split('\n');
      const validationCode = validationLines[validationLines.length - 1];
      const validationBody = validationLines.slice(0, -1).join('\n');
      
      assert.equal(validationCode, '422', 'Should return 422 for validation error');
      
      const validationResponse = JSON.parse(validationBody);
      assert(validationResponse.errors, 'Should have errors array');
      assert.equal(validationResponse.errors[0].status, '422');
    });

    it('should handle different content types using CURL', async () => {
      // Test with application/json content type
      const newCountryDoc = createJsonApiDocument('countries', { name: 'JSON Country', code: 'JC' });
      const jsonPayload = JSON.stringify(newCountryDoc);
      
      const resultJson = await executeCurl(['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/vnd.api+json', '-d', jsonPayload, `http://localhost:${TEST_PORT}/api/countries`]);
      
      assert.equal(resultJson.exitCode, 0, 'CURL should exit successfully with application/json');
      
      const responseJson = JSON.parse(resultJson.stdout);
      validateJsonApiStructure(responseJson, false);
      assert.equal(responseJson.data.attributes.name, 'JSON Country');

      // Test with unsupported content type (should fail if strictContentType is enabled)
      const resultXml = await executeCurl(['-s', '-w', '\n%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/xml', '-H', 'Accept: application/vnd.api+json', '-d', jsonPayload, `http://localhost:${TEST_PORT}/api/countries`]);
      
      const xmlLines = resultXml.stdout.trim().split('\n');
      const xmlCode = xmlLines[xmlLines.length - 1];
      
      assert.equal(xmlCode, '415', 'Should return 415 Unsupported Media Type');
    });

    it('should handle headers correctly using CURL', async () => {
      // Test with custom headers (-v outputs to stderr)
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', '-H', 'X-Custom-Header: test-value', '-H', 'User-Agent: CURL-Test/1.0', '-v', `http://localhost:${TEST_PORT}/api/countries/${testData.country.id}`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      // Check that headers were sent (visible in verbose output on stderr)
      assert(result.stderr.includes('X-Custom-Header: test-value'), 'Should send custom header');
      assert(result.stderr.includes('User-Agent: CURL-Test/1.0'), 'Should send custom user agent');
    });
  });

  describe('Complex CURL Operations', () => {
    let testData = {};

    beforeEach(async () => {
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);

      // Create complex test data
      const countryDoc = createJsonApiDocument('countries', { name: 'Complex Country', code: 'CC' });
      const countryResult = await basicApi.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      testData.country = countryResult.data;

      const publisherDoc = createJsonApiDocument('publishers',
        { name: 'Complex Publisher' },
        { country: createRelationship(resourceIdentifier('countries', testData.country.id)) }
      );
      const publisherResult = await basicApi.resources.publishers.post({
        inputRecord: publisherDoc,
        simplified: false
      });
      testData.publisher = publisherResult.data;

      const author1Doc = createJsonApiDocument('authors', { name: 'Complex Author One' });
      const author2Doc = createJsonApiDocument('authors', { name: 'Complex Author Two' });
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
        { title: 'Complex Book' },
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

    it('should handle nested includes using CURL', async () => {
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/books/${testData.book.id}?include=publisher.country,authors`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, false);
      
      assert.equal(response.data.type, 'books');
      assert(response.included, 'Should have included data');
      
      // Should include publisher, country, and 2 authors
      assert.equal(response.included.length, 4, 'Should include 4 resources');
      
      const includedTypes = response.included.map(r => r.type);
      assert(includedTypes.includes('publishers'), 'Should include publisher');
      assert(includedTypes.includes('countries'), 'Should include country');
      assert.equal(includedTypes.filter(t => t === 'authors').length, 2, 'Should include 2 authors');
    });

    it('should handle pagination using CURL', async () => {
      // Create multiple books
      for (let i = 0; i < 5; i++) {
        await basicApi.resources.books.post({
          inputRecord: createJsonApiDocument('books',
            { title: `Book ${i}` },
            {
              country: createRelationship(resourceIdentifier('countries', testData.country.id)),
              publisher: createRelationship(resourceIdentifier('publishers', testData.publisher.id))
            }
          ),
          simplified: false
        });
      }

      // Test pagination (URL encode square brackets)
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/books?page%5Bsize%5D=3&page%5Bnumber%5D=1`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, true);
      
      assert.equal(response.data.length, 3, 'Should return 3 books per page');
      // Note: Links are now always included, using relative URLs whenreturnBasePath isn't configured
    });

    it('should handle sorting using CURL', async () => {
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/books?sort=-title`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, true);
      
      // Books should be sorted by title descending
      const titles = response.data.map(book => book.attributes.title);
      const sortedTitles = [...titles].sort().reverse();
      assert.deepEqual(titles, sortedTitles, 'Books should be sorted by title descending');
    });

    it('should handle sparse fieldsets using CURL', async () => {
      const result = await executeCurl(['-s', '-H', 'Accept: application/vnd.api+json', `http://localhost:${TEST_PORT}/api/books/${testData.book.id}?fields%5Bbooks%5D=title&fields%5Bpublishers%5D=name&include=publisher`]);
      
      assert.equal(result.exitCode, 0, 'CURL should exit successfully');
      
      const response = JSON.parse(result.stdout);
      validateJsonApiStructure(response, false);
      
      // Main resource should only have title attribute
      assert.equal(Object.keys(response.data.attributes).length, 1, 'Should only have title attribute');
      assert(response.data.attributes.title, 'Should have title');
      
      // Included publisher should only have name attribute
      const publisher = response.included.find(r => r.type === 'publishers');
      assert.equal(Object.keys(publisher.attributes).length, 1, 'Publisher should only have name attribute');
      assert(publisher.attributes.name, 'Publisher should have name');
    });
  });
});