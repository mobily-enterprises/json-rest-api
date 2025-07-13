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
  validateJsonApiStructure
} from './helpers/test-utils.js';

// Create Knex instance for tests
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

describe('Window Function Includes', () => {
  let api;

  before(async () => {
    // Create API instance with plugins
    api = new Api({
      name: 'window-test-api'
    });

    await api.use(RestApiPlugin, {
      pageSize: 20,
      maxPageSize: 100,
      simplified: false
    });

    await api.use(RestApiKnexPlugin, {
      knex: knex
    });
  });

  after(async () => {
    // Close database connection
    await knex.destroy();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await cleanTables(knex, [
      'articles', 'comments', 'tags', 'article_tags'
    ]);
  });

  describe('Per-parent include limits', () => {
    it('should limit includes per parent with window functions', async () => {
      // Set up resources with window function includes
      await api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true },
          content: { type: 'string' }
        },
        relationships: {
          comments: {
            hasMany: 'comments',
            foreignKey: 'article_id',
            include: {
              limit: 3,
              orderBy: ['-created_at'],
              strategy: 'window'
            }
          }
        }
      });

      await api.addResource('comments', {
        schema: {
          content: { type: 'string', required: true },
          article_id: { type: 'integer', required: true },
          created_at: { type: 'datetime', required: true }
        }
      });

      // Create tables
      await api.resources.articles.createKnexTable();
      await api.resources.comments.createKnexTable();

      // Create test data: 3 articles, each with 10 comments
      const articles = [];
      for (let i = 1; i <= 3; i++) {
        const articleDoc = createJsonApiDocument('articles', {
          title: `Article ${i}`,
          content: `Content for article ${i}`
        });

        const article = await api.resources.articles.post({
          inputRecord: articleDoc,
          simplified: false
        });
        articles.push(article.data);

        // Create 10 comments for each article
        for (let j = 1; j <= 10; j++) {
          const commentDoc = createJsonApiDocument('comments', {
            content: `Comment ${j} for article ${i}`,
            article_id: article.data.id,
            created_at: new Date(2024, 0, j).toISOString()
          });

          await api.resources.comments.post({
            inputRecord: commentDoc,
            simplified: false
          });
        }
      }

      // Query with include
      const result = await api.resources.articles.query({
        include: ['comments'],
        simplified: false
      });

      // Each article should have exactly 3 comments (the configured limit)
      assert.equal(result.data.length, 3);
      
      result.data.forEach((article, idx) => {
        const articleComments = result.included.filter(
          i => i.type === 'comments' && 
          article.relationships.comments.data.some(c => c.id === i.id)
        );
        
        assert.equal(articleComments.length, 3, 
          `Article ${idx + 1} should have exactly 3 comments`);
        
        // Verify they are the most recent comments (descending order)
        const dates = articleComments.map(c => new Date(c.attributes.created_at));
        for (let i = 0; i < dates.length - 1; i++) {
          assert(dates[i].getTime() > dates[i + 1].getTime(),
            'Comments should be in descending order by created_at');
        }
      });
    });

    it('should handle many-to-many relationships with window functions', async () => {
      // Set up resources
      await api.addResource('articles', {
        schema: {
          title: { type: 'string', required: true }
        },
        relationships: {
          tags: {
            hasMany: 'tags',
            through: 'article_tags',
            foreignKey: 'article_id',
            otherKey: 'tag_id',
            include: {
              limit: 2,
              orderBy: ['name'],
              strategy: 'window'
            }
          }
        }
      });

      await api.addResource('tags', {
        schema: {
          name: { type: 'string', required: true }
        }
      });

      await api.addResource('article_tags', {
        schema: {
          article_id: { type: 'integer', required: true },
          tag_id: { type: 'integer', required: true }
        }
      });

      // Create tables
      await api.resources.articles.createKnexTable();
      await api.resources.tags.createKnexTable();
      await api.resources.article_tags.createKnexTable();

      // Create test data
      const tags = [];
      for (let i = 1; i <= 6; i++) {
        const tagDoc = createJsonApiDocument('tags', {
          name: `Tag ${String.fromCharCode(64 + i)}` // Tag A, B, C, D, E, F
        });

        const tag = await api.resources.tags.post({
          inputRecord: tagDoc,
          simplified: false
        });
        tags.push(tag.data);
      }

      // Create 2 articles, each with 4 tags
      for (let i = 1; i <= 2; i++) {
        const articleDoc = createJsonApiDocument('articles', {
          title: `Article ${i}`
        });

        const article = await api.resources.articles.post({
          inputRecord: articleDoc,
          simplified: false
        });

        // Associate 4 tags with each article
        for (let j = 0; j < 4; j++) {
          const pivotDoc = createJsonApiDocument('article_tags', {
            article_id: article.data.id,
            tag_id: tags[j + (i - 1) * 2].id // Different tags for each article
          });

          await api.resources.article_tags.post({
            inputRecord: pivotDoc,
            simplified: false
          });
        }
      }

      // Query with include
      const result = await api.resources.articles.query({
        include: ['tags'],
        simplified: false
      });

      // Each article should have exactly 2 tags (the configured limit)
      assert.equal(result.data.length, 2);
      
      result.data.forEach((article, idx) => {
        const articleTags = result.included.filter(
          i => i.type === 'tags' && 
          article.relationships.tags.data.some(t => t.id === i.id)
        );
        
        assert.equal(articleTags.length, 2, 
          `Article ${idx + 1} should have exactly 2 tags`);
        
        // Verify they are in alphabetical order
        const names = articleTags.map(t => t.attributes.name);
        const sortedNames = [...names].sort();
        assert.deepEqual(names, sortedNames, 
          'Tags should be in alphabetical order');
      });
    });
  });

  describe('Error handling', () => {
    it('should throw clear error for unsupported databases', async () => {
      // Mock old MySQL version
      api.knex.capabilities = {
        windowFunctions: false,
        dbInfo: { client: 'MySQL', version: '5.7.38' }
      };

      await api.addResource('test_articles', {
        schema: {
          title: { type: 'string', required: true }
        },
        relationships: {
          comments: {
            hasMany: 'test_comments',
            include: {
              limit: 10,
              strategy: 'window'
            }
          }
        }
      });

      await api.addResource('test_comments', {
        schema: {
          content: { type: 'string', required: true },
          article_id: { type: 'integer' }
        }
      });

      // Create tables
      await api.resources.test_articles.createKnexTable();
      await api.resources.test_comments.createKnexTable();

      // Create test article
      const articleDoc = createJsonApiDocument('test_articles', {
        title: 'Test Article'
      });

      const article = await api.resources.test_articles.post({
        inputRecord: articleDoc,
        simplified: false
      });

      // Attempt to query with includes should throw error
      try {
        await api.resources.test_articles.query({ 
          include: ['comments'],
          simplified: false 
        });
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert(error.message.includes('Include limits require window function support'));
        assert(error.message.includes('MySQL 5.7.38'));
        assert(error.message.includes('does not support'));
        assert.equal(error.details.subtype, 'unsupported_operation');
        assert.equal(error.details.database, 'MySQL');
        assert.equal(error.details.version, '5.7.38');
        assert.equal(error.details.requiredFeature, 'window_functions');
      }
    });

    it('should validate include configuration at resource creation', async () => {
      // Invalid limit type
      try {
        await api.addResource('posts', {
          schema: { title: { type: 'string' } },
          relationships: {
            comments: {
              hasMany: 'comments',
              include: {
                limit: '10' // Should be a number
              }
            }
          }
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('Invalid include limit'));
        assert(error.message.includes('limit must be a number'));
      }

      // Invalid orderBy type
      try {
        await api.addResource('blog_posts', {
          schema: { title: { type: 'string' } },
          relationships: {
            comments: {
              hasMany: 'comments',
              include: {
                orderBy: 'created_at' // Should be an array
              }
            }
          }
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert(error.message.includes('Invalid include orderBy'));
        assert(error.message.includes('orderBy must be an array'));
      }
    });
  });

  describe('Fallback behavior', () => {
    it('should use global limits when window strategy not specified', async () => {
      await api.addResource('global_articles', {
        schema: {
          title: { type: 'string', required: true }
        },
        relationships: {
          comments: {
            hasMany: 'global_comments',
            foreignKey: 'article_id',
            include: {
              limit: 5,
              orderBy: ['-id']
              // No strategy specified - will use global limit
            }
          }
        }
      });

      await api.addResource('global_comments', {
        schema: {
          content: { type: 'string', required: true },
          article_id: { type: 'integer', required: true }
        }
      });

      // Create tables
      await api.resources.global_articles.createKnexTable();
      await api.resources.global_comments.createKnexTable();

      // Create 2 articles with 5 comments each
      for (let i = 1; i <= 2; i++) {
        const articleDoc = createJsonApiDocument('global_articles', {
          title: `Article ${i}`
        });

        const article = await api.resources.global_articles.post({
          inputRecord: articleDoc,
          simplified: false
        });

        for (let j = 1; j <= 5; j++) {
          const commentDoc = createJsonApiDocument('global_comments', {
            content: `Comment ${j} for article ${i}`,
            article_id: article.data.id
          });

          await api.resources.global_comments.post({
            inputRecord: commentDoc,
            simplified: false
          });
        }
      }

      // Query with include
      const result = await api.resources.global_articles.query({
        include: ['comments'],
        simplified: false
      });

      // Should have 2 articles
      assert.equal(result.data.length, 2);
      
      // Total comments should be limited to 5 (global limit)
      const allComments = result.included.filter(i => i.type === 'global_comments');
      assert(allComments.length <= 5,
        'Global limit should restrict total comments to 5');
    });
  });
});