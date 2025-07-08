import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Advanced Sparse Fieldsets Tests', () => {
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
    
    // Create tables for 3-level relationship: companies -> people -> articles -> comments
    await knex.schema.createTable('companies', table => {
      table.increments('id');
      table.string('name');
      table.string('industry');
      table.string('website');
      table.string('internal_code');
      table.integer('employee_count');
    });
    
    await knex.schema.createTable('people', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.string('phone');
      table.integer('company_id');
      table.string('department');
      table.string('ssn'); // sensitive field
    });
    
    await knex.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.text('summary');
      table.integer('author_id');
      table.string('status');
      table.string('category');
      table.integer('word_count');
      table.timestamps(true, true);
    });
    
    await knex.schema.createTable('comments', table => {
      table.increments('id');
      table.text('content');
      table.integer('article_id');
      table.integer('author_id');
      table.string('sentiment');
      table.integer('likes');
      table.boolean('flagged');
      table.timestamps(true, true);
    });
    
    await knex.schema.createTable('tags', table => {
      table.increments('id');
      table.string('name');
      table.string('slug');
      table.string('color');
    });
    
    await knex.schema.createTable('article_tags', table => {
      table.integer('article_id');
      table.integer('tag_id');
      table.primary(['article_id', 'tag_id']);
    });
    
    // Insert test data
    await knex('companies').insert([
      { id: 1, name: 'TechCorp', industry: 'Technology', website: 'techcorp.com', internal_code: 'TC001', employee_count: 500 },
      { id: 2, name: 'MediaInc', industry: 'Media', website: 'mediainc.com', internal_code: 'MI001', employee_count: 200 }
    ]);
    
    await knex('people').insert([
      { id: 1, name: 'Alice Author', email: 'alice@techcorp.com', phone: '555-0001', company_id: 1, department: 'Engineering', ssn: '123-45-6789' },
      { id: 2, name: 'Bob Writer', email: 'bob@mediainc.com', phone: '555-0002', company_id: 2, department: 'Editorial', ssn: '987-65-4321' },
      { id: 3, name: 'Charlie Commenter', email: 'charlie@techcorp.com', phone: '555-0003', company_id: 1, department: 'Marketing', ssn: '456-78-9012' }
    ]);
    
    await knex('articles').insert([
      { 
        id: 1, 
        title: 'Understanding Sparse Fieldsets', 
        body: 'This article explains sparse fieldsets in detail...', 
        summary: 'A guide to sparse fieldsets',
        author_id: 1,
        status: 'published',
        category: 'technical',
        word_count: 1500
      },
      { 
        id: 2, 
        title: 'Advanced JSON:API Features', 
        body: 'Deep dive into JSON:API advanced features...', 
        summary: 'Advanced JSON:API guide',
        author_id: 1,
        status: 'published',
        category: 'technical',
        word_count: 2000
      },
      { 
        id: 3, 
        title: 'Media Industry Trends', 
        body: 'Latest trends in media industry...', 
        summary: 'Media trends analysis',
        author_id: 2,
        status: 'draft',
        category: 'business',
        word_count: 1200
      }
    ]);
    
    await knex('comments').insert([
      { id: 1, content: 'Great article!', article_id: 1, author_id: 2, sentiment: 'positive', likes: 10, flagged: false },
      { id: 2, content: 'Very helpful, thanks!', article_id: 1, author_id: 3, sentiment: 'positive', likes: 5, flagged: false },
      { id: 3, content: 'I disagree with some points', article_id: 2, author_id: 2, sentiment: 'neutral', likes: 2, flagged: false },
      { id: 4, content: 'Spam content', article_id: 1, author_id: 3, sentiment: 'negative', likes: 0, flagged: true }
    ]);
    
    await knex('tags').insert([
      { id: 1, name: 'API Design', slug: 'api-design', color: 'blue' },
      { id: 2, name: 'Performance', slug: 'performance', color: 'red' },
      { id: 3, name: 'Best Practices', slug: 'best-practices', color: 'green' }
    ]);
    
    await knex('article_tags').insert([
      { article_id: 1, tag_id: 1 },
      { article_id: 1, tag_id: 3 },
      { article_id: 2, tag_id: 1 },
      { article_id: 2, tag_id: 2 },
      { article_id: 2, tag_id: 3 }
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
    
    // Add scopes with complex relationships
    api.addResource('companies', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        industry: { type: 'string' },
        website: { type: 'string' },
        internal_code: { type: 'string', alwaysSelect: true }, // Always included
        employee_count: { type: 'number' }
      },
      relationships: {
        employees: {
          hasMany: 'people',
          foreignKey: 'company_id',
          sideLoadMany: true
        }
      }
    });
    
    api.addResource('people', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        phone: { type: 'string' },
        company_id: { 
          belongsTo: 'companies', 
          as: 'company'
        },
        department: { type: 'string' },
        ssn: { type: 'string' } // Sensitive, should not be selected unless requested
      },
      relationships: {
        articles: {
          hasMany: 'articles',
          foreignKey: 'author_id',
          sideLoadMany: true
        },
        comments: {
          hasMany: 'comments',
          foreignKey: 'author_id',
          sideLoadMany: true
        }
      }
    });
    
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        body: { type: 'text' },
        summary: { type: 'text' },
        author_id: { 
          belongsTo: 'people', 
          as: 'author'
        },
        status: { type: 'string' },
        category: { type: 'string' },
        word_count: { type: 'number', alwaysSelect: true }, // Always included
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      },
      searchSchema: {
        status: { type: 'string' }  // Allow filtering by status
      },
      relationships: {
        comments: {
          hasMany: 'comments',
          foreignKey: 'article_id',
          sideLoadMany: true
        },
        tags: {
          manyToMany: 'tags',
          through: 'article_tags'
          // sideLoad not supported for many-to-many
        }
      }
    });
    
    api.addResource('comments', {
      schema: {
        id: { type: 'id' },
        content: { type: 'text', required: true },
        article_id: { 
          belongsTo: 'articles', 
          as: 'article'
        },
        author_id: { 
          belongsTo: 'people', 
          as: 'author'
        },
        sentiment: { type: 'string' },
        likes: { type: 'number' },
        flagged: { type: 'boolean', alwaysSelect: true }, // Always included for moderation
        created_at: { type: 'datetime' },
        updated_at: { type: 'datetime' }
      }
    });
    
    api.addResource('tags', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        slug: { type: 'string' },
        color: { type: 'string' }
      }
    });
  });
  
  afterEach(async () => {
    await knex.destroy();
  });
  
  describe('Three-Level Relationship Tests', () => {
    test('should handle 3-level includes with sparse fieldsets', async () => {
      const result = await api.resources.companies.get({ 
        id: '1',
        queryParams: {
          include: ['employees.articles.comments'],
          fields: {
            companies: 'name',
            people: 'name,department',
            articles: 'title,category',
            comments: 'content,sentiment'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Check main company
      assert.strictEqual(result.data.attributes.name, 'TechCorp');
      assert.strictEqual(result.data.attributes.internal_code, 'TC001', 'Should have alwaysSelect field');
      assert.strictEqual(result.data.attributes.industry, undefined, 'Should not have non-requested fields');
      
      // Check included people
      const people = result.included.filter(r => r.type === 'people');
      assert.ok(people.length > 0, 'Should have people');
      people.forEach(person => {
        assert.ok(person.attributes.name, 'Should have name');
        assert.ok(person.attributes.department, 'Should have department');
        assert.strictEqual(person.attributes.email, undefined, 'Should not have email');
        assert.strictEqual(person.attributes.ssn, undefined, 'Should not have sensitive ssn field');
        assert.strictEqual(person.attributes.company_id, undefined, 'Should not have foreign key');
      });
      
      // Check included articles
      const articles = result.included.filter(r => r.type === 'articles');
      assert.ok(articles.length > 0, 'Should have articles');
      articles.forEach(article => {
        assert.ok(article.attributes.title, 'Should have title');
        assert.ok(article.attributes.category, 'Should have category');
        assert.strictEqual(typeof article.attributes.word_count, 'number', 'Should have alwaysSelect field');
        assert.strictEqual(article.attributes.body, undefined, 'Should not have body');
        assert.strictEqual(article.attributes.author_id, undefined, 'Should not have foreign key');
      });
      
      // Check included comments
      const comments = result.included.filter(r => r.type === 'comments');
      assert.ok(comments.length > 0, 'Should have comments');
      comments.forEach(comment => {
        assert.ok(comment.attributes.content, 'Should have content');
        assert.ok(comment.attributes.sentiment, 'Should have sentiment');
        assert.ok(comment.attributes.flagged !== undefined, 'Should have alwaysSelect field flagged');
        assert.strictEqual(comment.attributes.likes, undefined, 'Should not have likes');
        assert.strictEqual(comment.attributes.article_id, undefined, 'Should not have foreign key');
        assert.strictEqual(comment.attributes.author_id, undefined, 'Should not have foreign key');
      });
    });
    
    test('should handle partial sparse fieldsets in 3-level includes', async () => {
      // Only specify fields for some resource types
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          include: ['author.company', 'comments.author'],
          fields: {
            articles: 'title',
            // No fields specified for people - should get all fields
            companies: 'name,industry'
            // No fields specified for comments - should get all fields
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Check article has only requested field
      assert.strictEqual(result.data.attributes.title, 'Understanding Sparse Fieldsets');
      assert.strictEqual(result.data.attributes.body, undefined);
      
      // Check people have all fields (except foreign keys)
      const people = result.included.filter(r => r.type === 'people');
      people.forEach(person => {
        assert.ok(person.attributes.name);
        assert.ok(person.attributes.email);
        assert.ok(person.attributes.department);
        assert.strictEqual(person.attributes.company_id, undefined, 'Foreign key should be filtered');
      });
      
      // Check companies have only requested fields
      const companies = result.included.filter(r => r.type === 'companies');
      companies.forEach(company => {
        assert.ok(company.attributes.name);
        assert.ok(company.attributes.industry);
        assert.ok(company.attributes.internal_code, 'Should have alwaysSelect field');
        assert.strictEqual(company.attributes.website, undefined);
      });
      
      // Check comments have all fields (except foreign keys)
      const comments = result.included.filter(r => r.type === 'comments');
      comments.forEach(comment => {
        assert.ok(comment.attributes.content);
        assert.ok(comment.attributes.sentiment);
        assert.strictEqual(typeof comment.attributes.likes, 'number');
        assert.strictEqual(comment.attributes.article_id, undefined, 'Foreign key should be filtered');
        assert.strictEqual(comment.attributes.author_id, undefined, 'Foreign key should be filtered');
      });
    });
  });
  
  describe('Complex Query Tests', () => {
    test('should handle multiple includes with different sparse fieldsets', async () => {
      const result = await api.resources.articles.get({ 
        id: '2',
        queryParams: {
          include: ['author', 'comments', 'comments.author'],
          fields: {
            articles: 'title,status',
            people: 'name',
            comments: 'content'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Verify deduplication - author should appear only once
      const authors = result.included.filter(r => r.type === 'people' && r.id === '1');
      assert.strictEqual(authors.length, 1, 'Author should appear only once despite multiple paths');
      
      // Verify each resource has correct fields
      const alice = authors[0];
      assert.strictEqual(alice.attributes.name, 'Alice Author');
      assert.strictEqual(alice.attributes.email, undefined);
      
      const comments = result.included.filter(r => r.type === 'comments');
      comments.forEach(comment => {
        assert.ok(comment.attributes.content);
        assert.strictEqual(comment.attributes.sentiment, undefined);
        assert.ok(comment.attributes.flagged !== undefined, 'Should have alwaysSelect field flagged');
      });
    });
    
    test('should handle collection queries with sparse fieldsets and includes', async () => {
      const result = await api.resources.articles.query({
        queryParams: {
          include: ['author'],
          fields: {
            articles: 'title,category',
            people: 'name,department'
          },
          filters: { status: 'published' }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(Array.isArray(result.data), 'Data should be array');
      assert.strictEqual(result.data.length, 2, 'Should have 2 published articles');
      
      result.data.forEach(article => {
        assert.ok(article.attributes.title);
        assert.ok(article.attributes.category);
        assert.strictEqual(typeof article.attributes.word_count, 'number', 'Should have alwaysSelect field');
        assert.strictEqual(article.attributes.body, undefined);
        assert.strictEqual(article.attributes.status, undefined, 'Status not requested in fields');
      });
      
      // Check included authors
      const authors = result.included.filter(r => r.type === 'people');
      authors.forEach(author => {
        assert.ok(author.attributes.name);
        assert.ok(author.attributes.department);
        assert.strictEqual(author.attributes.email, undefined);
      });
    });
  });
  
  describe('Edge Cases', () => {
    test('should handle invalid field names gracefully', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: 'title,nonexistent_field,another_bad_field'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.title, 'Understanding Sparse Fieldsets');
      assert.strictEqual(result.data.attributes.nonexistent_field, undefined);
      assert.strictEqual(result.data.attributes.another_bad_field, undefined);
    });
    
    test('should handle whitespace in field lists', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: ' title , status , category '  // Extra spaces
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.data.attributes.title);
      assert.ok(result.data.attributes.status);
      assert.ok(result.data.attributes.category);
    });
    
    test('should handle duplicate fields in list', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: 'title,title,status,title,status'  // Duplicates
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.data.attributes.title);
      assert.ok(result.data.attributes.status);
    });
    
    test('should not expose foreign keys even if explicitly requested', async () => {
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          fields: {
            articles: 'title,author_id'  // Try to request foreign key
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.data.attributes.title);
      assert.strictEqual(result.data.attributes.author_id, undefined, 'Should not expose foreign key');
    });
    
    test('should handle deeply nested circular includes with sparse fieldsets', async () => {
      // Create a circular reference: article -> author -> articles -> author
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          include: ['author.articles.author'],
          fields: {
            articles: 'title',
            people: 'name'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Should handle circular reference without infinite loop
      const people = result.included.filter(r => r.type === 'people');
      const articles = result.included.filter(r => r.type === 'articles');
      
      assert.ok(people.length > 0, 'Should have people');
      assert.ok(articles.length > 0, 'Should have articles');
      
      // All should have only requested fields
      people.forEach(p => {
        assert.ok(p.attributes.name);
        assert.strictEqual(p.attributes.email, undefined);
      });
      
      articles.forEach(a => {
        assert.ok(a.attributes.title);
        assert.strictEqual(a.attributes.body, undefined);
      });
    });
  });
  
  describe('Performance Tests', () => {
    test('should execute minimal database queries with sparse fieldsets', async () => {
      // Track queries
      const queries = [];
      const originalMethod = knex.client.query;
      knex.client.query = function(connection, obj) {
        queries.push(obj.sql);
        return originalMethod.apply(this, arguments);
      };
      
      await api.resources.companies.get({ 
        id: '1',
        queryParams: {
          include: ['employees.articles'],
          fields: {
            companies: 'name',
            people: 'name',
            articles: 'title'
          }
        }
      });
      
      // Restore original method
      knex.client.query = originalMethod;
      
      // Should have exactly 3 SELECT queries (one for each level)
      const selectQueries = queries.filter(q => q.includes('select'));
      assert.strictEqual(selectQueries.length, 3, 'Should have 3 SELECT queries');
      
      // Each query should select minimal fields
      selectQueries.forEach(query => {
        // Should not select all fields (no SELECT *)
        assert.ok(!query.includes('select *'), 'Should not use SELECT *');
        
        // Should include specific field names
        assert.ok(query.includes('`id`'), 'Should always select id');
      });
    });
    
    test('should handle hasMany with large result sets efficiently', async () => {
      // Add many comments to test efficiency
      const manyComments = [];
      for (let i = 10; i < 110; i++) {
        manyComments.push({
          id: i,
          content: `Comment ${i}`,
          article_id: 1,
          author_id: 1 + (i % 3),
          sentiment: 'neutral',
          likes: i,
          flagged: false
        });
      }
      await knex('comments').insert(manyComments);
      
      const result = await api.resources.articles.get({ 
        id: '1',
        queryParams: {
          include: ['comments'],
          fields: {
            articles: 'title',
            comments: 'content'  // Only select content, not all fields
          }
        }
      });
      
      assert.ok(result.included, 'Should have included resources');
      const comments = result.included.filter(r => r.type === 'comments');
      assert.ok(comments.length > 100, 'Should have many comments');
      
      // All comments should have minimal fields
      comments.forEach(comment => {
        assert.ok(comment.attributes.content);
        assert.ok(comment.attributes.flagged !== undefined, 'Should have alwaysSelect field flagged');
        assert.strictEqual(comment.attributes.sentiment, undefined, 'Should not have non-requested fields');
        assert.strictEqual(comment.attributes.likes, undefined, 'Should not have non-requested fields');
      });
    });
  });
});