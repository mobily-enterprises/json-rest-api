import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('REST API Plugin - Query and Cross-Table Search', () => {
  let api;
  let db;
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    // Create in-memory SQLite database for testing
    db = knex({
      client: 'sqlite3',
      connection: {
        filename: ':memory:'
      },
      useNullAsDefault: true
    });
    
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      pageSize: 10,
      maxPageSize: 50
    });
    
    await api.use(RestApiKnexPlugin, { knex: db });
    
    // Create database tables
    await db.schema.createTable('companies', (table) => {
      table.increments('id');
      table.string('name');
      table.string('industry');
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('people', (table) => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.integer('company_id').unsigned().references('companies.id');
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('articles', (table) => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.integer('author_id').unsigned().references('people.id');
      table.timestamps(true, true);
    });
    
    await db.schema.createTable('comments', (table) => {
      table.increments('id');
      table.text('body');
      table.integer('article_id').unsigned().references('articles.id');
      table.integer('user_id').unsigned().references('people.id');
      table.timestamps(true, true);
    });
    
    // Insert test data
    const companyResult = await db('companies').insert({
      name: 'Tech Corp',
      industry: 'Technology'
    }).returning('id');
    const companyId = companyResult[0].id || companyResult[0];
    
    const company2Result = await db('companies').insert({
      name: 'Media Inc',
      industry: 'Media'
    }).returning('id');
    const company2Id = company2Result[0].id || company2Result[0];
    
    const authorResult = await db('people').insert({
      name: 'John Doe',
      email: 'john@techcorp.com',
      company_id: companyId
    }).returning('id');
    const authorId = authorResult[0].id || authorResult[0];
    
    const author2Result = await db('people').insert({
      name: 'Jane Smith',
      email: 'jane@mediainc.com',
      company_id: company2Id
    }).returning('id');
    const author2Id = author2Result[0].id || author2Result[0];
    
    const commenterResults = await db('people').insert([
      {
        name: 'Bob Reader',
        email: 'bob@reader.com',
        company_id: null
      },
      {
        name: 'Alice Commenter',
        email: 'alice@reader.com', 
        company_id: companyId
      }
    ]).returning('id');
    
    const articleResults = await db('articles').insert([
      {
        title: 'JavaScript Best Practices',
        body: 'Here are some JavaScript best practices...',
        author_id: authorId
      },
      {
        title: 'Node.js Performance Tips',
        body: 'Optimizing Node.js applications...',
        author_id: authorId
      },
      {
        title: 'React Hooks Guide',
        body: 'A comprehensive guide to React hooks...',
        author_id: author2Id
      }
    ]).returning('id');
    
    await db('comments').insert([
      {
        body: 'Great article!',
        article_id: articleResults[0].id || articleResults[0],
        user_id: commenterResults[0].id || commenterResults[0]
      },
      {
        body: 'Very helpful tips',
        article_id: articleResults[1].id || articleResults[1],
        user_id: commenterResults[1].id || commenterResults[1]
      },
      {
        body: 'I love React hooks',
        article_id: articleResults[2].id || articleResults[2],
        user_id: commenterResults[0].id || commenterResults[0]
      }
    ]);
    
    // Define schemas with cross-table search support
    const companiesSchema = {
      id: { type: 'id' },
      name: { type: 'string', indexed: true },
      industry: { type: 'string', indexed: true }
    };
    
    const peopleSchema = {
      id: { type: 'id' },
      name: { type: 'string', indexed: true },
      email: { type: 'string', indexed: true },
      company_id: { 
        belongsTo: 'companies', 
        as: 'company',
        sideLoad: true,
        sideSearch: true
      }
    };
    
    const articlesSchema = {
      id: { type: 'id' },
      title: { type: 'string', indexed: true },
      body: { type: 'string', indexed: true },
      author_id: { 
        belongsTo: 'people', 
        as: 'author',
        sideLoad: true,
        sideSearch: true
      }
    };
    
    const commentsSchema = {
      id: { type: 'id' },
      body: { type: 'string', indexed: true },
      article_id: { 
        belongsTo: 'articles', 
        as: 'article',
        sideLoad: true,
        sideSearch: true
      },
      user_id: { 
        belongsTo: 'people', 
        as: 'user',
        sideLoad: true,
        sideSearch: true
      }
    };
    
    // Define search schemas with cross-table search
    const articlesSearchSchema = {
      // Many-to-one: search articles by author name
      authorName: {
        type: 'string',
        actualField: 'people.name',
        filterUsing: 'like'
      },
      
      // Multi-field search including cross-table
      search: {
        type: 'string',
        likeOneOf: [
          'title',
          'body',
          'people.name',
          'people.email'
        ]
      },
      
      // Multi-level cross-table search (3 levels deep)
      companyName: {
        type: 'string',
        actualField: 'companies.name',
        filterUsing: 'like'
      }
    };
    
    const peopleSearchSchema = {
      // One-to-many: search people by their article titles
      articleTitle: {
        type: 'string',
        actualField: 'articles.title',
        filterUsing: 'like'
      },
      
      // Many-to-one: search people by company name
      companyName: {
        type: 'string',
        actualField: 'companies.name',
        filterUsing: 'like'
      },
      
      // Multi-field search
      search: {
        type: 'string',
        likeOneOf: [
          'name',
          'email',
          'companies.name',
          'articles.title'
        ]
      }
    };
    
    // Add resources to API
    api.addResource('companies', {
      schema: companiesSchema
    });
    
    api.addResource('people', {
      schema: peopleSchema,
      searchSchema: peopleSearchSchema,
      relationships: {
        articles: { 
          hasMany: 'articles', 
          foreignKey: 'author_id',
          sideLoad: true,
          sideSearch: true
        },
        comments: {
          hasMany: 'comments',
          foreignKey: 'user_id',
          sideLoad: true,
          sideSearch: true
        }
      }
    });
    
    api.addResource('articles', {
      schema: articlesSchema,
      searchSchema: articlesSearchSchema,
      relationships: {
        comments: {
          hasMany: 'comments',
          foreignKey: 'article_id',
          sideLoad: true,
          sideSearch: true
        }
      }
    });
    
    api.addResource('comments', {
      schema: commentsSchema
    });
  });
  
  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('Basic Query Functionality', () => {
    test('should retrieve all articles', async () => {
      const result = await api.resources.articles.query({});
      
      assert.ok(result.data, 'Should have data property');
      assert.ok(Array.isArray(result.data), 'Data should be an array');
      assert.strictEqual(result.data.length, 3, 'Should return all 3 articles');
      
      const firstArticle = result.data[0];
      assert.strictEqual(firstArticle.type, 'articles', 'Should have correct type');
      assert.ok(firstArticle.id, 'Should have id');
      assert.ok(firstArticle.attributes, 'Should have attributes');
      assert.ok(firstArticle.attributes.title, 'Should have title in attributes');
    });
    
    test('should retrieve all people', async () => {
      const result = await api.resources.people.query({});
      
      assert.strictEqual(result.data.length, 4, 'Should return all 4 people');
      const names = result.data.map(p => p.attributes.name).sort();
      assert.deepStrictEqual(names, ['Alice Commenter', 'Bob Reader', 'Jane Smith', 'John Doe']);
    });
  });

  describe('Many-to-One Cross-Table Search (belongsTo)', () => {
    test('should search articles by author name', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { authorName: 'John' }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should find 2 articles by John');
      const titles = result.data.map(a => a.attributes.title).sort();
      assert.deepStrictEqual(titles, ['JavaScript Best Practices', 'Node.js Performance Tips']);
    });
    
    test('should search people by company name', async () => {
      const result = await api.resources.people.query({
        queryParams: {
          filters: { companyName: 'Tech' }
        }
      });
      
      // Log results at trace level for debugging
      if (process.env.LOG_LEVEL === 'trace' || process.env.DEBUG) {
        console.log('[TRACE] [TEST] Company name search results:', { count: result.data.length, people: result.data.map(p => ({ name: p.attributes.name, company_id: p.attributes.company_id })) });
      }
      
      assert.strictEqual(result.data.length, 2, 'Should find 2 people at Tech Corp');
      const names = result.data.map(p => p.attributes.name).sort();
      assert.deepStrictEqual(names, ['Alice Commenter', 'John Doe']);
    });
  });

  describe('One-to-Many Cross-Table Search (hasMany)', () => {
    test('should search people by their article titles', async () => {
      const result = await api.resources.people.query({
        queryParams: {
          filters: { articleTitle: 'JavaScript' }
        }
      });
      
      assert.strictEqual(result.data.length, 1, 'Should find 1 person who wrote about JavaScript');
      assert.strictEqual(result.data[0].attributes.name, 'John Doe');
    });
    
    test('should search people by article title (React)', async () => {
      const result = await api.resources.people.query({
        queryParams: {
          filters: { articleTitle: 'React' }
        }
      });
      
      assert.strictEqual(result.data.length, 1, 'Should find 1 person who wrote about React');
      assert.strictEqual(result.data[0].attributes.name, 'Jane Smith');
    });
  });

  describe('Multi-Field Cross-Table Search (likeOneOf)', () => {
    test('should search articles across multiple fields including cross-table', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { search: 'john' }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should find articles matching author name "john"');
    });
    
    test('should search people across multiple fields', async () => {
      const result = await api.resources.people.query({
        queryParams: {
          filters: { search: 'Tech' }
        }
      });
      
      // Should find people by company name "Tech Corp"
      assert.ok(result.data.length >= 2, 'Should find people associated with Tech Corp');
    });
  });

  describe('Multi-Level Cross-Table Search (3+ levels)', () => {
    test('should search articles by company name (articles -> people -> companies)', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { companyName: 'Tech' }
        }
      });
      
      assert.strictEqual(result.data.length, 2, 'Should find articles by authors from Tech Corp');
      const titles = result.data.map(a => a.attributes.title).sort();
      assert.deepStrictEqual(titles, ['JavaScript Best Practices', 'Node.js Performance Tips']);
    });
  });

  describe('Helper Function Validation', () => {
    test('should validate cross-table field successfully', async () => {
      // Should not throw for valid indexed field
      await assert.doesNotReject(async () => {
        await api.crossTableSearch.validateCrossTableField('people', 'name');
      });
    });
    
    test('should build join chain for many-to-one relationship', async () => {
      const joinInfo = await api.crossTableSearch.buildJoinChain('articles', 'people.name');
      
      assert.ok(joinInfo.joinAlias, 'Should have join alias');
      assert.ok(joinInfo.targetTableName, 'Should have target table name');
      assert.ok(joinInfo.joinCondition, 'Should have join condition');
      assert.strictEqual(joinInfo.isOneToMany, false, 'Should not be one-to-many');
    });
    
    test('should build join chain for one-to-many relationship', async () => {
      const joinInfo = await api.crossTableSearch.buildJoinChain('people', 'articles.title');
      
      assert.ok(joinInfo.joinAlias, 'Should have join alias');
      assert.ok(joinInfo.targetTableName, 'Should have target table name');
      assert.ok(joinInfo.joinCondition, 'Should have join condition');
      assert.strictEqual(joinInfo.isOneToMany, true, 'Should be one-to-many');
    });
  });

  describe('Index Analysis', () => {
    test('should analyze required indexes for cross-table search', async () => {
      const requiredIndexes = api.crossTableSearch.analyzeRequiredIndexes('articles', {
        authorName: {
          type: 'string',
          actualField: 'people.name',
          filterUsing: 'like'
        }
      });
      
      assert.ok(Array.isArray(requiredIndexes), 'Should return array of required indexes');
      assert.ok(requiredIndexes.length >= 1, 'Should identify required indexes');
    });
  });

  describe('Performance and Edge Cases', () => {
    test('should handle empty filter values gracefully', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          filters: { authorName: '' }
        }
      });
      
      // Empty string should still perform search
      assert.ok(Array.isArray(result.data), 'Should return array even with empty filter');
    });
  });
});