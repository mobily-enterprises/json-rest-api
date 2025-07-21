import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument,
  assertResourceAttributes
} from './helpers/test-utils.js';
import { createBasicApi } from './fixtures/api-configs.js';

/**
 * TEST TEMPLATE - BEST PRACTICES LEARNED
 * 
 * CRITICAL RULES:
 * 1. Create API instance ONLY ONCE in before() - NOT in beforeEach()
 * 2. Use cleanTables() in beforeEach() to reset data between tests
 * 3. Always pass context as SECOND parameter to resource methods
 * 4. Clean up any intervals/timers in after() hook
 * 5. SQLite returns numeric IDs - JSON:API expects string IDs
 * 6. For auth tests, context.auth must be set via JWT token or passed manually
 * 
 * NOTICE TO CLAUDE/AI ASSISTANTS:
 * 
 * API CONFIGURATION RULES - EXTREMELY IMPORTANT:
 * 1. NEVER add resources with api.addResource() in test files!
 * 2. ALL resources MUST be defined in api-configs.js
 * 3. NEVER create resources in test files - this is a CRITICAL RULE!
 * 4. If createBasicApi doesn't have the resources you need:
 *    - DO NOT modify createBasicApi
 *    - Create a NEW function in api-configs.js like:
 *      export async function createExtendedApi(knex, pluginOptions) {
 *        const api = await createApi();
 *        // Install plugins
 *        // Add YOUR resources here with api.addResource()
 *        // Create tables
 *        return api;
 *      }
 * 5. Example structure in api-configs.js:
 *    - createBasicApi() - has countries, publishers, authors, books
 *    - createAuthApi() - might have users, roles, permissions  
 *    - createYourCustomApi() - whatever resources you need
 * 
 * RESOURCE CREATION RULE (REPEAT FOR EMPHASIS):
 * Resources are ONLY created in api-configs.js, NEVER in test files!
 * If you need new resources, create a new function in api-configs.js!
 * 
 * DATA ACCESS RULES - EXTREMELY IMPORTANT:
 * 1. NEVER query the database directly with knex('table').select()
 * 2. ALWAYS use API methods to check data:
 *    - Use api.resources.[resource].get() to fetch a single item
 *    - Use api.resources.[resource].query() to fetch multiple items
 *    - Use api.resources.[resource].post() to create items
 * 3. Why? The API methods:
 *    - Apply proper schema transformations
 *    - Handle relationships correctly
 *    - Return data in the expected JSON:API format
 *    - Include computed fields and enriched attributes
 * 4. Direct DB queries will give you raw data that doesn't match what the API returns!
 * 
 * BAD EXAMPLE:
 *   const record = await knex('basic_countries').where('id', 1).first();  // NO!
 * 
 * GOOD EXAMPLE:
 *   const result = await api.resources.countries.get({ id: 1 });
 *   const record = result.data;  // YES!
 */

// Create Knex instance for tests - always use SQLite in-memory
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across ALL tests
let api;

describe('Your Feature Name (Template Example)', () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Create API instance ONCE - this is reused for all tests
    // NOTE: If you need different resources than what createBasicApi provides,
    // create a new function in api-configs.js!
    api = await createBasicApi(knex);
    
    // Install your plugin if testing a specific plugin
    // await api.use(YourPlugin, {
    //   option1: 'value1',
    //   option2: 'value2'
    // });
    
    // NO api.addResource() HERE! Resources are defined in api-configs.js!
    // createBasicApi already created tables for: countries, publishers, authors, books
  });
  
  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Clean up any intervals/timers your plugin might have created
    // Example from JWT plugin:
    // if (api.vars.yourPluginCleanupJob) {
    //   clearInterval(api.vars.yourPluginCleanupJob);
    // }
    
    // Always destroy knex connection to allow tests to exit
    await knex.destroy();
  });
  
  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables - list ALL tables your tests use
    await cleanTables(knex, [
      'basic_countries',      // From createBasicApi
      'basic_publishers',     // From createBasicApi
      'basic_authors',        // From createBasicApi  
      'basic_books',          // From createBasicApi
      'basic_book_authors'    // From createBasicApi (junction table)
      // Add any additional tables used by your tests here
    ]);
  });
  
  // ONE SIMPLE EXAMPLE TEST
  it('should create and retrieve a country', async () => {
    // Create a country using the API
    const doc = createJsonApiDocument('countries', {
      name: 'Test Country',
      code: 'TC'
    });
    
    // Create the country
    // IMPORTANT: Context is SECOND parameter, not inside first parameter!
    const createResult = await api.resources.countries.post({
      inputRecord: doc,
      simplified: false
    }, { /* optional context goes here */ });
    
    // Validate the creation response
    validateJsonApiStructure(createResult);
    assert.equal(createResult.data.type, 'countries');
    assertResourceAttributes(createResult.data, {
      name: 'Test Country',
      code: 'TC'
    });
    
    // Retrieve the country we just created
    const getResult = await api.resources.countries.get({
      id: createResult.data.id,
      simplified: false
    });
    
    // Validate the retrieved country
    validateJsonApiStructure(getResult);
    assert.equal(getResult.data.id, createResult.data.id);
    assert.equal(getResult.data.attributes.name, 'Test Country');
    assert.equal(getResult.data.attributes.code, 'TC');
  });
});

/**
 * COMMON PITFALLS TO AVOID:
 * 
 * 1. DON'T create API in beforeEach - it's expensive and unnecessary
 * 2. DON'T forget to clean tables between tests
 * 3. DON'T pass context inside params object - it's a separate parameter
 * 4. DON'T assume IDs are strings - SQLite returns numbers
 * 5. DON'T forget to clean up intervals/timers
 * 6. DON'T skip error cases - test both success and failure paths
 * 
 * DEBUGGING TIPS:
 * 
 * 1. Use console.log liberally when debugging, but remove before committing
 * 2. Check if your auth context is properly structured
 * 3. Validate that required fields are present in your test data
 * 4. Remember that HTTP routes have /api/ prefix by default
 * 5. Use debugger statements to pause execution and inspect state
 */