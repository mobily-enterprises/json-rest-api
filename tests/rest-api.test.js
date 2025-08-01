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

describe('REST API Tests', () => {
  before(async () => {
    // Initialize APIs once
    basicApi = await createBasicApi(knex);
    extendedApi = await createExtendedApi(knex);
  });

  after(async () => {
    // Close database connection to allow tests to exit
    await knex.destroy();
  });

  describe('Basic CRUD Operations', () => {
    beforeEach(async () => {
      // Clean all tables before each test
      await cleanTables(knex, [
        'basic_countries', 'basic_publishers', 'basic_authors', 'basic_books', 'basic_book_authors'
      ]);
    });

    describe('POST - Create Resources', () => {
      it('should create a country', async () => {
        const countryDoc = createJsonApiDocument('countries', {
          name: 'United States',
          code: 'US'
        });

        const result = await basicApi.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Verify response structure
        validateJsonApiStructure(result, false);
        assert.equal(result.data.type, 'countries');
        assert(result.data.id, 'Should have an ID');
        assertResourceAttributes(result.data, {
          name: 'United States',
          code: 'US'
        });

        // Verify record was created in database
        const count = await countRecords(knex, 'basic_countries');
        assert.equal(count, 1, 'Should have created one country');

        // Verify data through API GET
        const getResult = await basicApi.resources.countries.get({
          id: result.data.id,
          simplified: false
        });

        validateJsonApiStructure(getResult, false);
        assert.equal(getResult.data.type, 'countries');
        assert.equal(getResult.data.id, result.data.id);
        assertResourceAttributes(getResult.data, {
          name: 'United States',
          code: 'US'
        });
      });

      it('should create a publisher with country relationship', async () => {
        // First create a country
        const countryDoc = createJsonApiDocument('countries', {
          name: 'United Kingdom',
          code: 'UK'
        });

        const countryResult = await basicApi.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Create publisher with country relationship
        const publisherDoc = createJsonApiDocument('publishers', 
          {
            name: 'Penguin Random House'
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
        assert(publisherResult.data.id, 'Should have an ID');

        // Verify records in database
        const publisherCount = await countRecords(knex, 'basic_publishers');
        assert.equal(publisherCount, 1, 'Should have created one publisher');

        // Verify data and relationship through API
        const getResult = await basicApi.resources.publishers.get({
          id: publisherResult.data.id,
          queryParams: {
            include: ['country']
          },
          simplified: false
        });

        validateJsonApiStructure(getResult, false);
        assertResourceAttributes(getResult.data, {
          name: 'Penguin Random House'
        });
        assertResourceRelationship(getResult.data, 'country', 
          resourceIdentifier('countries', countryResult.data.id));

        // Verify included data
        assert(getResult.included, 'Should have included data');
        assert.equal(getResult.included.length, 1, 'Should include one resource');
        assert.equal(getResult.included[0].type, 'countries');
        assert.equal(getResult.included[0].attributes.name, 'United Kingdom');
      });

      it('should fail to create resource with missing required field', async () => {
        const invalidDoc = createJsonApiDocument('countries', {
          code: 'FR'
          // Missing required 'name' field
        });

        await assert.rejects(
          async () => {
            await basicApi.resources.countries.post({
              inputRecord: invalidDoc,
              simplified: false,
              returnFullRecord: false
            });
          },
          (err) => {
            return err.code === 'REST_API_VALIDATION';
          },
          'Should throw validation error for missing required field'
        );

        // Verify no record was created
        const count = await countRecords(knex, 'basic_countries');
        assert.equal(count, 0, 'Should not have created any countries');
      });
    });

    describe('GET - Retrieve Resources', () => {
      it('should retrieve a single resource', async () => {
        // Create test data
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Canada',
          code: 'CA'
        });

        const createResult = await basicApi.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Get the resource
        const getResult = await basicApi.resources.countries.get({
          id: createResult.data.id,
          simplified: false
        });

        validateJsonApiStructure(getResult, false);
        assert.equal(getResult.data.type, 'countries');
        assert.equal(getResult.data.id, createResult.data.id);
        assertResourceAttributes(getResult.data, {
          name: 'Canada',
          code: 'CA'
        });
      });

      it('should fail to retrieve non-existent resource', async () => {
        await assert.rejects(
          async () => {
            await basicApi.resources.countries.get({
              id: 99999,
              simplified: false
            });
          },
          (err) => {
            return err.code === 'REST_API_RESOURCE' && err.subtype === 'not_found';
          },
          'Should throw not found error'
        );
      });

      it('should retrieve collection of resources', async () => {
        // Create multiple countries
        const countries = [
          { name: 'France', code: 'FR' },
          { name: 'Germany', code: 'DE' },
          { name: 'Italy', code: 'IT' }
        ];

        for (const country of countries) {
          const doc = createJsonApiDocument('countries', country);
          await basicApi.resources.countries.post({
            inputRecord: doc,
            simplified: false
          });
        }

        // Query all countries
        const queryResult = await basicApi.resources.countries.query({
          simplified: false
        });

        validateJsonApiStructure(queryResult, true);
        assert.equal(queryResult.data.length, 3, 'Should return 3 countries');
        
        // Verify all countries are present
        const names = queryResult.data.map(c => c.attributes.name).sort();
        assert.deepEqual(names, ['France', 'Germany', 'Italy']);
      });
    });

    describe('PATCH - Update Resources', () => {
      it('should partially update a resource', async () => {
        // Create a country
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Spain',
          code: 'ES'
        });

        const createResult = await basicApi.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Update only the name
        const updateDoc = {
          data: {
            type: 'countries',
            id: String(createResult.data.id),
            attributes: {
              name: 'España'
            }
          }
        };

        await basicApi.resources.countries.patch({
          id: createResult.data.id,
          inputRecord: updateDoc,
          simplified: false
        });

        // Verify the update
        const getResult = await basicApi.resources.countries.get({
          id: createResult.data.id,
          simplified: false
        });

        assertResourceAttributes(getResult.data, {
          name: 'España',
          code: 'ES' // Should remain unchanged
        });
      });
    });

    describe('DELETE - Remove Resources', () => {
      it('should delete an existing resource', async () => {
        // Create a country
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Portugal',
          code: 'PT'
        });

        const createResult = await basicApi.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Verify it exists
        let count = await countRecords(knex, 'basic_countries');
        assert.equal(count, 1, 'Should have one country before delete');

        // Delete the resource
        const deleteResult = await basicApi.resources.countries.delete({
          id: createResult.data.id,
          simplified: false
        });

        // DELETE returns undefined (204 No Content)
        assert.equal(deleteResult, undefined, 'Delete should return undefined');

        // Verify it's gone
        count = await countRecords(knex, 'basic_countries');
        assert.equal(count, 0, 'Should have no countries after delete');

        // Verify GET fails
        await assert.rejects(
          async () => {
            await basicApi.resources.countries.get({
              id: createResult.data.id,
              simplified: false
            });
          },
          (err) => {
            return err.code === 'REST_API_RESOURCE' && err.subtype === 'not_found';
          },
          'Should throw not found error after delete'
        );
      });
    });
  });
});