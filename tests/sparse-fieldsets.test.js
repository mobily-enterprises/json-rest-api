import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Sparse Fieldsets and Foreign Key Filtering', () => {
  let api;
  let knex;
  
  beforeEach(async () => {
    // Reset the global registry
    resetGlobalRegistryForTesting();
    
    // Create in-memory SQLite database
    knex = knexConfig({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });
    
    // Create tables
    await knex.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.integer('author_id');
      table.string('status');
      table.string('secret_field');
      table.integer('view_count');
      table.timestamps(true, true);
    });
    
    await knex.schema.createTable('people', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.text('bio');
    });
    
    // Insert test data
    await knex('people').insert([
      { id: 1, name: 'Alice Author', email: 'alice@example.com', bio: 'Writer' },
      { id: 2, name: 'Bob Writer', email: 'bob@example.com', bio: 'Journalist' }
    ]);
    
    await knex('articles').insert([
      { 
        id: 1, 
        title: 'First Article', 
        body: 'This is the first article body', 
        author_id: 1,
        status: 'published',
        secret_field: 'secret1',
        view_count: 100
      },
      { 
        id: 2, 
        title: 'Second Article', 
        body: 'This is the second article body', 
        author_id: 2,
        status: 'draft',
        secret_field: 'secret2',
        view_count: 50
      }
    ]);
    
    // Create API instance
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      pageSize: 10,
      maxPageSize: 50
    });
    
    await api.use(RestApiKnexPlugin, {
      knex
    });
    
    // Add articles scope
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        body: { type: 'text' },
        author_id: { 
          belongsTo: 'people', 
          as: 'author',
          sideLoad: true
        },
        status: { type: 'string' },
        secret_field: { type: 'string' },
        view_count: { 
          type: 'number',
          alwaysSelect: true  // This field should always be included
        },
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      sortableFields: ['title', 'created_at']
    });
    
    // Add people scope
    api.addResource('people', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        bio: { type: 'text' }
      },
      relationships: {
        articles: {
          hasMany: 'articles',
          foreignKey: 'author_id',
          sideLoad: true
        }
      }
    });
  });
  
  afterEach(async () => {
    await knex.destroy();
  });
  
  describe('Foreign Key Filtering', () => {
    test('should not include foreign keys in attributes', async () => {
      const result = await api.resources.articles.get({ id: '1' });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.type, 'articles');
      assert.strictEqual(result.data.id, '1');
      
      // Check that foreign key is NOT in attributes
      assert.strictEqual(result.data.attributes.author_id, undefined, 'author_id should not be in attributes');
      
      // But other fields should be present
      assert.strictEqual(result.data.attributes.title, 'First Article');
      assert.strictEqual(result.data.attributes.body, 'This is the first article body');
      assert.strictEqual(result.data.attributes.status, 'published');
    });
    
    test('should work with query results too', async () => {
      const result = await api.resources.articles.query({});
      
      assert.ok(result.data, 'Should have data');
      assert.ok(Array.isArray(result.data), 'Data should be array');
      
      result.data.forEach(article => {
        assert.strictEqual(article.attributes.author_id, undefined, 'author_id should not be in attributes');
      });
    });
  });
  
  describe('Sparse Fieldsets', () => {
    test('should return only requested fields plus id and alwaysSelect fields', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: 'title,status'  // Only request title and status
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.id, '1', 'Should have id');
      
      // Should have requested fields
      assert.strictEqual(result.data.attributes.title, 'First Article');
      assert.strictEqual(result.data.attributes.status, 'published');
      
      // Should have alwaysSelect field
      assert.strictEqual(result.data.attributes.view_count, 100, 'Should include alwaysSelect field');
      
      // Should NOT have non-requested fields
      assert.strictEqual(result.data.attributes.body, undefined, 'Should not have body');
      assert.strictEqual(result.data.attributes.secret_field, undefined, 'Should not have secret_field');
      
      // Should NOT have foreign keys
      assert.strictEqual(result.data.attributes.author_id, undefined, 'Should not have author_id');
    });
    
    test('should work with query results', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          fields: {
            articles: 'title'  // Only request title
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(Array.isArray(result.data), 'Data should be array');
      
      result.data.forEach(article => {
        assert.ok(article.id, 'Should have id');
        assert.ok(article.attributes.title, 'Should have title');
        assert.strictEqual(typeof article.attributes.view_count, 'number', 'Should have alwaysSelect field');
        
        // Should NOT have other fields
        assert.strictEqual(article.attributes.body, undefined, 'Should not have body');
        assert.strictEqual(article.attributes.status, undefined, 'Should not have status');
        assert.strictEqual(article.attributes.author_id, undefined, 'Should not have author_id');
      });
    });
    
    test('should handle empty sparse fieldset (return no attributes except alwaysSelect)', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: ''  // Empty field list
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.id, '1', 'Should have id');
      
      // Should only have alwaysSelect field
      assert.strictEqual(result.data.attributes.view_count, 100, 'Should include alwaysSelect field');
      
      // Should NOT have any other fields
      assert.strictEqual(result.data.attributes.title, undefined, 'Should not have title');
      assert.strictEqual(result.data.attributes.body, undefined, 'Should not have body');
      assert.strictEqual(result.data.attributes.status, undefined, 'Should not have status');
    });
  });
  
  describe('Sparse Fieldsets with Includes', () => {
    test('should apply sparse fieldsets to included resources', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          include: ['author'],
          fields: {
            articles: 'title',
            people: 'name'  // Only request name for included authors
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      assert.strictEqual(result.included.length, 1, 'Should have one included resource');
      
      // Check main resource has only requested fields
      assert.strictEqual(result.data.attributes.title, 'First Article');
      assert.strictEqual(result.data.attributes.body, undefined, 'Should not have body');
      
      // Check included author has only requested fields
      const author = result.included[0];
      assert.strictEqual(author.type, 'people');
      assert.strictEqual(author.attributes.name, 'Alice Author');
      assert.strictEqual(author.attributes.email, undefined, 'Should not have email');
      assert.strictEqual(author.attributes.bio, undefined, 'Should not have bio');
    });
    
    test('should handle nested includes with sparse fieldsets', async () => {
      // First add an article by Alice
      await knex('articles').insert({ 
        id: 3, 
        title: 'Alice Second Article', 
        body: 'Another article by Alice', 
        author_id: 1,
        status: 'published',
        view_count: 200
      });
      
      const result = await api.resources.people.get({ 
        id: '1',
        queryParams: {
          include: ['articles'],
          fields: {
            people: 'name',
            articles: 'title,status'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Check main resource
      assert.strictEqual(result.data.attributes.name, 'Alice Author');
      assert.strictEqual(result.data.attributes.email, undefined, 'Should not have email');
      
      // Check included articles
      result.included.forEach(article => {
        assert.strictEqual(article.type, 'articles');
        assert.ok(article.attributes.title, 'Should have title');
        assert.ok(article.attributes.status, 'Should have status');
        assert.strictEqual(typeof article.attributes.view_count, 'number', 'Should have alwaysSelect field');
        assert.strictEqual(article.attributes.body, undefined, 'Should not have body');
        assert.strictEqual(article.attributes.author_id, undefined, 'Should not have author_id');
      });
    });
  });
  
  describe('Database Query Verification', () => {
    test('should only select requested fields at database level', async () => {
      // Spy on database queries
      const queries = [];
      const originalMethod = knex.client.query;
      knex.client.query = function(connection, obj) {
        queries.push(obj.sql);
        return originalMethod.apply(this, arguments);
      };
      
      await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: 'title,status'
          }
        }
      });
      
      // Restore original method
      knex.client.query = originalMethod;
      
      // Check that the SELECT query only requested specific fields
      const selectQuery = queries.find(q => q.includes('select') && q.includes('from'));
      assert.ok(selectQuery, 'Should have a SELECT query');
      
      // The query should include id, requested fields, foreign keys, and alwaysSelect fields
      assert.ok(selectQuery.includes('`id`'), 'Should select id');
      assert.ok(selectQuery.includes('`title`'), 'Should select title');
      assert.ok(selectQuery.includes('`status`'), 'Should select status');
      assert.ok(selectQuery.includes('`author_id`'), 'Should select foreign key for relationships');
      assert.ok(selectQuery.includes('`view_count`'), 'Should select alwaysSelect field');
      
      // Should NOT select non-requested fields
      assert.ok(!selectQuery.includes('`body`'), 'Should not select body');
      assert.ok(!selectQuery.includes('`secret_field`'), 'Should not select secret_field');
    });
  });
});