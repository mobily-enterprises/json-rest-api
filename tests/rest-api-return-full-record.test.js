import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import Knex from 'knex';

describe('RestApiPlugin - Return Full Record & Strict ID Handling', () => {
  let api;
  let knex;
  
  // Helper to generate a unique ID
  const generateId = (prefix = 'test') => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };
  
  beforeEach(async () => {
    // Reset the global registry to avoid conflicts between tests
    resetGlobalRegistryForTesting();
    
    // Create a new knex instance for each test
    knex = Knex({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });
  });
  
  afterEach(async () => {
    // Clean up
    if (knex) {
      await knex.destroy();
    }
  });
  
  describe('returnFullRecord Configuration', () => {
    test('should return full record by default (backward compatibility)', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      // Use default configuration
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          body: { type: 'string' },
          status: { type: 'string', default: 'draft' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('body');
        table.string('status');
      });
      
      // Test POST
      const postResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Test Article',
              body: 'Article content'
            }
          }
        }
      });
      
      assert.ok(postResult.data.id, 'Should have ID');
      assert.equal(postResult.data.type, 'articles');
      assert.equal(postResult.data.attributes.title, 'Test Article');
      assert.equal(postResult.data.attributes.status, 'draft', 'Should include default value');
    });
    
    test('should respect API-level returnFullRecord configuration', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      // Configure to NOT return full records
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          post: false,
          put: false,
          patch: false,
          allowRemoteOverride: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          body: { type: 'string' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('body');
      });
      
      // Test POST - should return minimal record
      const postResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Test Article',
              body: 'Article content'
            }
          }
        }
      });
      
      assert.ok(postResult.data.id, 'Should have ID');
      assert.equal(postResult.data.type, 'articles');
      assert.equal(postResult.data.attributes.title, 'Test Article');
      assert.equal(postResult.data.attributes.body, 'Article content');
    });
    
    test('should respect resource-level returnFullRecord override', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      // API default: don't return full records
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          post: false,
          put: false,
          patch: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      // Resource override: DO return full records for articles
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          status: { type: 'string', default: 'draft' }
        },
        returnFullRecord: {
          post: true,
          put: true,
          patch: true
        }
      });
      
      // Another resource using API defaults
      api.addResource('comments', {
        schema: {
          content: { type: 'string', required: true }
        }
      });
      
      // Create tables
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('status');
      });
      await knex.schema.createTable('comments', (table) => {
        table.increments('id');
        table.string('content');
      });
      
      // Test articles POST - should return full record (resource override)
      const articleResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Test Article'
            }
          }
        }
      });
      
      assert.equal(articleResult.data.attributes.status, 'draft', 'Articles should return full record with defaults');
      
      // Test comments POST - should return minimal record (API default)
      const commentResult = await api.resources.comments.post({
        inputRecord: {
          data: {
            type: 'comments',
            attributes: {
              content: 'Test comment'
            }
          }
        }
      });
      
      assert.equal(commentResult.data.attributes.content, 'Test comment');
      assert.equal(Object.keys(commentResult.data.attributes).length, 1, 'Comments should return minimal record');
    });
    
    test('should respect method parameter override', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      // Default configuration (returns full record)
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          status: { type: 'string', default: 'draft' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('status').defaultTo('draft');
      });
      
      // Test POST with returnFullRecord: false
      const minimalResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Test Article'
            }
          }
        },
        returnFullRecord: false
      });
      
      assert.equal(minimalResult.data.attributes.title, 'Test Article');
      assert.ok(!minimalResult.data.attributes.status, 'Should not include default when returnFullRecord is false');
      
      // Test POST with returnFullRecord: true (explicit)
      const fullResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Another Article'
            }
          }
        },
        returnFullRecord: true
      });
      
      assert.equal(fullResult.data.attributes.title, 'Another Article');
      assert.equal(fullResult.data.attributes.status, 'draft', 'Should include default when returnFullRecord is true');
    });
    
    test('should handle PUT with returnFullRecord variations', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          put: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          body: { type: 'string' },
          status: { type: 'string' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('body');
        table.string('status');
      });
      
      // Create an article first
      const createResult = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Original Title',
              body: 'Original body',
              status: 'draft'
            }
          }
        },
        returnFullRecord: false
      });
      
      const articleId = createResult.data.id;
      
      // Test PUT with minimal response (API default)
      const putResult = await api.resources.articles.put({
        id: articleId,
        inputRecord: {
          data: {
            type: 'articles',
            id: articleId,
            attributes: {
              title: 'Updated Title',
              body: 'Updated body',
              status: 'published'
            }
          }
        }
      });
      
      assert.equal(putResult.data.id, articleId);
      assert.equal(putResult.data.attributes.title, 'Updated Title');
      assert.equal(putResult.data.attributes.body, 'Updated body');
      assert.equal(putResult.data.attributes.status, 'published');
      
      // Test PUT with full response override
      const putFullResult = await api.resources.articles.put({
        id: articleId,
        inputRecord: {
          data: {
            type: 'articles',
            id: articleId,
            attributes: {
              title: 'Another Update',
              body: 'Another body'
            }
          }
        },
        returnFullRecord: true
      });
      
      assert.equal(putFullResult.data.attributes.title, 'Another Update');
      assert.equal(putFullResult.data.attributes.status, 'published', 'Full record should include unchanged fields');
    });
    
    test('should handle PATCH with returnFullRecord variations', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          patch: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          body: { type: 'string' },
          status: { type: 'string' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('body');
        table.string('status');
      });
      
      // Create an article
      const insertResult = await knex('articles').insert({
        title: 'Original Title',
        body: 'Original body',
        status: 'draft'
      }).returning('id');
      const articleId = insertResult[0]?.id || insertResult[0] || insertResult;
      
      // Test PATCH with minimal response
      const patchResult = await api.resources.articles.patch({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            id: String(articleId),
            attributes: {
              status: 'published'
            }
          }
        }
      });
      
      assert.equal(patchResult.data.id, String(articleId));
      assert.equal(patchResult.data.attributes.status, 'published');
      assert.equal(patchResult.data.attributes.title, 'Original Title', 'Minimal response should still merge original attributes');
      
      // Test PATCH with full response
      const patchFullResult = await api.resources.articles.patch({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            id: String(articleId),
            attributes: {
              title: 'Patched Title'
            }
          }
        },
        returnFullRecord: true
      });
      
      assert.equal(patchFullResult.data.attributes.title, 'Patched Title');
      assert.equal(patchFullResult.data.attributes.status, 'published', 'Full record includes all fields');
      assert.equal(patchFullResult.data.attributes.body, 'Original body', 'Full record includes unchanged fields');
    });
  });
  
  describe('strictIdHandling Configuration', () => {
    test('should enforce ID matching by default (backward compatibility)', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
      });
      
      // Test PUT with mismatched IDs - should throw error
      await assert.rejects(
        api.resources.articles.put({
          id: '123',
          inputRecord: {
            data: {
              type: 'articles',
              id: '456',
              attributes: {
                title: 'Test'
              }
            }
          }
        }),
        {
          name: 'RestApiValidationError',
          message: /ID mismatch/
        }
      );
      
      // Test PATCH with mismatched IDs - should throw error
      await assert.rejects(
        api.resources.articles.patch({
          id: '123',
          inputRecord: {
            data: {
              type: 'articles',
              id: '456',
              attributes: {
                title: 'Test'
              }
            }
          }
        }),
        {
          name: 'RestApiValidationError',
          message: /ID mismatch/
        }
      );
    });
    
    test('should allow missing ID in body with strictIdHandling: false', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
      });
      
      // Create an article first
      const insertResult = await knex('articles').insert({
        title: 'Original'
      }).returning('id');
      const articleId = insertResult[0]?.id || insertResult[0] || insertResult;
      
      // Test PUT without ID in body - should work with strictIdHandling: false
      const putResult = await api.resources.articles.put({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            // No ID in body
            attributes: {
              title: 'Updated via PUT'
            }
          }
        },
        strictIdHandling: false,
        returnFullRecord: false
      });
      
      assert.equal(putResult.data.id, String(articleId));
      assert.equal(putResult.data.attributes.title, 'Updated via PUT');
      
      // Test PATCH without ID in body
      const patchResult = await api.resources.articles.patch({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            // No ID in body
            attributes: {
              title: 'Updated via PATCH'
            }
          }
        },
        strictIdHandling: false,
        returnFullRecord: false
      });
      
      assert.equal(patchResult.data.id, String(articleId));
      assert.equal(patchResult.data.attributes.title, 'Updated via PATCH');
    });
    
    test('should use URL parameter ID when body ID differs with strictIdHandling: false', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
      });
      
      // Create an article
      const insertResult = await knex('articles').insert({
        title: 'Original'
      }).returning('id');
      const articleId = insertResult[0]?.id || insertResult[0] || insertResult;
      
      // Test PUT with different IDs - URL parameter should win
      const putResult = await api.resources.articles.put({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            id: 'wrong-id',  // This should be ignored
            attributes: {
              title: 'Updated'
            }
          }
        },
        strictIdHandling: false,
        returnFullRecord: false
      });
      
      assert.equal(putResult.data.id, String(articleId), 'Should use URL parameter ID');
      assert.equal(putResult.data.attributes.title, 'Updated');
      
      // Verify the record was updated with correct ID
      const record = await knex('articles').where('id', articleId).first();
      assert.equal(record.title, 'Updated');
    });
  });
  
  describe('Combined Features', () => {
    test('should handle both returnFullRecord and strictIdHandling together', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          put: false,
          patch: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          body: { type: 'string' },
          status: { type: 'string', default: 'draft' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('body');
        table.string('status');
      });
      
      // Create an article
      const insertResult = await knex('articles').insert({
        title: 'Original',
        body: 'Original body',
        status: 'draft'
      }).returning('id');
      const articleId = insertResult[0]?.id || insertResult[0] || insertResult;
      
      // Test PUT with both features
      const result = await api.resources.articles.put({
        id: String(articleId),
        inputRecord: {
          data: {
            type: 'articles',
            // No ID - using relaxed handling
            attributes: {
              title: 'Updated Title',
              status: 'published'
            }
          }
        },
        strictIdHandling: false,
        returnFullRecord: false
      });
      
      assert.equal(result.data.id, String(articleId));
      assert.equal(result.data.attributes.title, 'Updated Title');
      assert.equal(result.data.attributes.status, 'published');
      assert.ok(!result.data.attributes.body, 'Minimal response should not include unchanged body');
    });
    
    test('should work with relationships when returnFullRecord is true', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          authorId: { type: 'string', belongsTo: 'authors', as: 'author' }
        },
        relationships: {
          author: {
            belongsTo: 'authors',
            foreignKey: 'authorId'
          }
        }
      });
      
      api.addResource('authors', {
        schema: {
          name: { type: 'string', required: true }
        }
      });
      
      // Create tables
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
        table.string('authorId');
      });
      await knex.schema.createTable('authors', (table) => {
        table.increments('id');
        table.string('name');
      });
      
      // Create an author
      const insertResult = await knex('authors').insert({
        name: 'John Doe'
      }).returning('id');
      const authorId = insertResult[0]?.id || insertResult[0] || insertResult;
      
      // Create article with relationship
      const result = await api.resources.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Article with Author'
            },
            relationships: {
              author: {
                data: { type: 'authors', id: String(authorId) }
              }
            }
          }
        },
        queryParams: {
          include: ['author']
        },
        returnFullRecord: true
      });
      
      assert.equal(result.data.attributes.title, 'Article with Author');
      assert.equal(result.data.relationships.author.data.id, String(authorId));
      assert.ok(result.included, 'Should include related resources when returnFullRecord is true');
      assert.equal(result.included[0].type, 'authors');
      assert.equal(result.included[0].attributes.name, 'John Doe');
    });
  });
  
  describe('Error Cases', () => {
    test('should still validate required fields regardless of returnFullRecord', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin, {
        returnFullRecord: {
          post: false
        }
      });
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
      });
      
      // Test POST without required field
      await assert.rejects(
        api.resources.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                // Missing required title
              }
            }
          },
          returnFullRecord: false
        }),
        {
          name: 'RestApiValidationError'
        }
      );
    });
    
    test('should enforce type matching even with strictIdHandling: false', async () => {
      api = new Api({
        name: 'test-api',
        version: '1.0.0'
      });
      
      await api.use(RestApiPlugin);
      await api.use(RestApiKnexPlugin, { knex });
      
      api.addResource('articles', {
        schema: {
          title: { type: 'string' }
        }
      });
      
      // Create table
      await knex.schema.createTable('articles', (table) => {
        table.increments('id');
        table.string('title');
      });
      
      // Test PUT with wrong type
      await assert.rejects(
        api.resources.articles.put({
          id: '123',
          inputRecord: {
            data: {
              type: 'wrong-type',  // Wrong type
              attributes: {
                title: 'Test'
              }
            }
          },
          strictIdHandling: false
        }),
        {
          name: 'RestApiValidationError',
          message: /not a valid resource type/
        }
      );
    });
  });
});