import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Comprehensive POST Tests with Relationships', () => {
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
    
    // Create test tables
    await knex.schema.createTable('users', table => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
      table.string('role');
    });
    
    await knex.schema.createTable('categories', table => {
      table.increments('id');
      table.string('name');
      table.string('slug').unique();
    });
    
    await knex.schema.createTable('tags', table => {
      table.increments('id');
      table.string('name');
      table.string('color');
    });
    
    await knex.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('content');
      table.integer('author_id').references('id').inTable('users');
      table.integer('category_id').references('id').inTable('categories');
      table.string('status').defaultTo('draft');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    
    // Pivot table for many-to-many relationship
    await knex.schema.createTable('article_tags', table => {
      table.increments('id');
      table.integer('article_id').references('id').inTable('articles').onDelete('CASCADE');
      table.integer('tag_id').references('id').inTable('tags').onDelete('CASCADE');
      table.string('relevance'); // Extra pivot field
      table.unique(['article_id', 'tag_id']);
    });
    
    // Another many-to-many example
    await knex.schema.createTable('skills', table => {
      table.increments('id');
      table.string('name');
      table.string('category');
    });
    
    await knex.schema.createTable('user_skills', table => {
      table.increments('id');
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.integer('skill_id').references('id').inTable('skills').onDelete('CASCADE');
      table.integer('proficiency_level'); // 1-5
      table.date('acquired_date');
      table.unique(['user_id', 'skill_id']);
    });
    
    // Insert test data
    await knex('users').insert([
      { id: 1, name: 'John Doe', email: 'john@example.com', role: 'admin' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'editor' },
      { id: 3, name: 'Bob Wilson', email: 'bob@example.com', role: 'author' }
    ]);
    
    await knex('categories').insert([
      { id: 1, name: 'Technology', slug: 'tech' },
      { id: 2, name: 'Science', slug: 'science' },
      { id: 3, name: 'Business', slug: 'business' }
    ]);
    
    await knex('tags').insert([
      { id: 1, name: 'JavaScript', color: 'yellow' },
      { id: 2, name: 'Node.js', color: 'green' },
      { id: 3, name: 'API', color: 'blue' },
      { id: 4, name: 'Database', color: 'red' }
    ]);
    
    await knex('skills').insert([
      { id: 1, name: 'JavaScript', category: 'Programming' },
      { id: 2, name: 'TypeScript', category: 'Programming' },
      { id: 3, name: 'SQL', category: 'Database' },
      { id: 4, name: 'GraphQL', category: 'API' }
    ]);
    
    // Create API instance
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      idProperty: 'id',
      returnFullRecord: {
        post: true,
        put: true,
        patch: true
      }
    });
    
    await api.use(RestApiKnexPlugin, {
      knex: knex
    });
    
    // Define resources
    api.addResource('users', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true },
        role: { type: 'string' }
      },
      relationships: {
        skills: {
          hasMany: 'skills',
          through: 'user_skills',
          foreignKey: 'user_id',
          otherKey: 'skill_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('categories', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        slug: { type: 'string', required: true }
      }
    });
    
    api.addResource('tags', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        color: { type: 'string' }
      }
    });
    
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        content: { type: 'string' },
        author_id: { 
          type: 'number',
          belongsTo: 'users',
          as: 'author'
        },
        category_id: {
          type: 'number',
          belongsTo: 'categories',
          as: 'category'
        },
        status: { type: 'string' },
        created_at: { type: 'string' }
      },
      relationships: {
        tags: {
          hasMany: 'tags',
          through: 'article_tags',
          foreignKey: 'article_id',
          otherKey: 'tag_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('skills', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        category: { type: 'string' }
      }
    });
    
    // Define pivot resources
    api.addResource('article_tags', {
      schema: {
        id: { type: 'id' },
        article_id: { type: 'number', required: true },
        tag_id: { type: 'number', required: true },
        relevance: { type: 'string' }
      },
      searchSchema: {
        article_id: { type: 'number' },
        tag_id: { type: 'number' }
      }
    });
    
    api.addResource('user_skills', {
      schema: {
        id: { type: 'id' },
        user_id: { type: 'number', required: true },
        skill_id: { type: 'number', required: true },
        proficiency_level: { type: 'number' },
        acquired_date: { type: 'string' }
      },
      searchSchema: {
        user_id: { type: 'number' },
        skill_id: { type: 'number' }
      }
    });
  });
  
  afterEach(async () => {
    await knex.destroy();
  });
  
  describe('Basic POST Operations', () => {
    test('should create a simple resource without relationships', async () => {
      try {
        const result = await api.scopes.categories.post({
          inputRecord: {
            data: {
              type: 'categories',
              attributes: {
                name: 'Health',
                slug: 'health'
              }
            }
          }
        });
        
        assert.ok(result.data);
        assert.strictEqual(result.data.type, 'categories');
        assert.ok(result.data.id);
        assert.strictEqual(result.data.attributes.name, 'Health');
        assert.strictEqual(result.data.attributes.slug, 'health');
        
        // Verify in database
        const dbRecord = await knex('categories').where('slug', 'health').first();
        assert.ok(dbRecord);
        assert.strictEqual(dbRecord.name, 'Health');
      } catch (error) {
        console.error('POST error:', error);
        throw error;
      }
    });
    
    test('should validate required fields', async () => {
      try {
        await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                content: 'Missing title'
              }
            }
          }
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert.ok(error.message.includes('required'));
      }
    });
  });
  
  describe('POST with belongsTo Relationships', () => {
    test('should create article with author relationship', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'New Article with Author',
              content: 'Article content'
            },
            relationships: {
              author: {
                data: { type: 'users', id: '2' }
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.strictEqual(result.data.attributes.title, 'New Article with Author');
      assert.ok(result.data.relationships);
      assert.deepStrictEqual(result.data.relationships.author, {
        data: { type: 'users', id: '2' }
      });
      
      // Verify in database
      const dbRecord = await knex('articles').where('title', 'New Article with Author').first();
      assert.strictEqual(dbRecord.author_id, 2);
    });
    
    test('should create article with multiple belongsTo relationships', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Article with Author and Category',
              content: 'Full article'
            },
            relationships: {
              author: {
                data: { type: 'users', id: '3' }
              },
              category: {
                data: { type: 'categories', id: '1' }
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.deepStrictEqual(result.data.relationships.author, {
        data: { type: 'users', id: '3' }
      });
      assert.deepStrictEqual(result.data.relationships.category, {
        data: { type: 'categories', id: '1' }
      });
      
      // Verify in database
      const dbRecord = await knex('articles').where('title', 'Article with Author and Category').first();
      assert.strictEqual(dbRecord.author_id, 3);
      assert.strictEqual(dbRecord.category_id, 1);
    });
    
    test('should handle null belongsTo relationship', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Article without Author',
              content: 'Anonymous article'
            },
            relationships: {
              author: {
                data: null
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.deepStrictEqual(result.data.relationships.author, {
        data: null
      });
      
      // Verify in database
      const dbRecord = await knex('articles').where('title', 'Article without Author').first();
      assert.strictEqual(dbRecord.author_id, null);
    });
    
    test('should fail with invalid belongsTo reference', async () => {
      try {
        await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                title: 'Article with Invalid Author',
                content: 'Content'
              },
              relationships: {
                author: {
                  data: { type: 'users', id: '999' }
                }
              }
            }
          }
        });
        assert.fail('Should have thrown error for invalid reference');
      } catch (error) {
        // Foreign key constraint should fail
        assert.ok(error.message.includes('FOREIGN KEY') || error.message.includes('constraint'));
      }
    });
  });
  
  describe('POST with Many-to-Many Relationships', () => {
    test('should create article with tags', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Article with Tags',
              content: 'Tagged article'
            },
            relationships: {
              author: {
                data: { type: 'users', id: '1' }
              },
              tags: {
                data: [
                  { type: 'tags', id: '1' },
                  { type: 'tags', id: '3' }
                ]
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.ok(result.data.id);
      
      // Verify pivot records in database
      const pivotRecords = await knex('article_tags')
        .where('article_id', result.data.id)
        .orderBy('tag_id');
      
      assert.strictEqual(pivotRecords.length, 2);
      assert.strictEqual(pivotRecords[0].tag_id, 1);
      assert.strictEqual(pivotRecords[1].tag_id, 3);
    });
    
    test('should create user with skills and pivot data', async () => {
      const result = await api.scopes.users.post({
        inputRecord: {
          data: {
            type: 'users',
            attributes: {
              name: 'New Developer',
              email: 'newdev@example.com',
              role: 'developer'
            },
            relationships: {
              skills: {
                data: [
                  { type: 'skills', id: '1' },
                  { type: 'skills', id: '2' },
                  { type: 'skills', id: '3' }
                ]
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.ok(result.data.id);
      
      // Verify pivot records
      const pivotRecords = await knex('user_skills')
        .where('user_id', result.data.id)
        .orderBy('skill_id');
      
      assert.strictEqual(pivotRecords.length, 3);
      assert.deepStrictEqual(
        pivotRecords.map(r => r.skill_id),
        [1, 2, 3]
      );
    });
    
    test('should handle empty many-to-many relationship', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Article without Tags',
              content: 'Untagged article'
            },
            relationships: {
              tags: {
                data: []
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      
      // Verify no pivot records
      const pivotRecords = await knex('article_tags')
        .where('article_id', result.data.id);
      
      assert.strictEqual(pivotRecords.length, 0);
    });
    
    test('should fail with duplicate many-to-many entries', async () => {
      try {
        await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                title: 'Article with Duplicate Tags',
                content: 'Content'
              },
              relationships: {
                tags: {
                  data: [
                    { type: 'tags', id: '1' },
                    { type: 'tags', id: '1' } // Duplicate
                  ]
                }
              }
            }
          }
        });
        assert.fail('Should have thrown error for duplicate tags');
      } catch (error) {
        // Should fail due to unique constraint on pivot table
        assert.ok(error.message.includes('UNIQUE') || error.message.includes('duplicate'));
      }
    });
    
    test('should fail with invalid many-to-many reference', async () => {
      try {
        await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                title: 'Article with Invalid Tag',
                content: 'Content'
              },
              relationships: {
                tags: {
                  data: [
                    { type: 'tags', id: '999' } // Non-existent tag
                  ]
                }
              }
            }
          }
        });
        assert.fail('Should have thrown error for invalid tag reference');
      } catch (error) {
        assert.ok(error.message.includes('FOREIGN KEY') || error.message.includes('constraint'));
      }
    });
  });
  
  describe('Complex POST with Multiple Relationships', () => {
    test('should create article with all relationship types', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Full Featured Article',
              content: 'Article with everything',
              status: 'published'
            },
            relationships: {
              author: {
                data: { type: 'users', id: '2' }
              },
              category: {
                data: { type: 'categories', id: '3' }
              },
              tags: {
                data: [
                  { type: 'tags', id: '2' },
                  { type: 'tags', id: '3' },
                  { type: 'tags', id: '4' }
                ]
              }
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.strictEqual(result.data.attributes.title, 'Full Featured Article');
      assert.strictEqual(result.data.attributes.status, 'published');
      
      // Verify all relationships
      assert.deepStrictEqual(result.data.relationships.author, {
        data: { type: 'users', id: '2' }
      });
      assert.deepStrictEqual(result.data.relationships.category, {
        data: { type: 'categories', id: '3' }
      });
      
      // Verify in database
      const dbRecord = await knex('articles').where('title', 'Full Featured Article').first();
      assert.strictEqual(dbRecord.author_id, 2);
      assert.strictEqual(dbRecord.category_id, 3);
      
      // Verify pivot records
      const pivotRecords = await knex('article_tags')
        .where('article_id', result.data.id)
        .orderBy('tag_id');
      
      assert.strictEqual(pivotRecords.length, 3);
      assert.deepStrictEqual(
        pivotRecords.map(r => r.tag_id),
        [2, 3, 4]
      );
    });
  });
  
  describe('Transaction Support in POST', () => {
    test('should rollback on failure in many-to-many creation', async () => {
      // Count initial records
      const initialArticles = await knex('articles').count('* as count');
      const initialPivots = await knex('article_tags').count('* as count');
      
      try {
        await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                title: 'Article that will fail',
                content: 'Content'
              },
              relationships: {
                tags: {
                  data: [
                    { type: 'tags', id: '1' },
                    { type: 'tags', id: '999' } // This will fail
                  ]
                }
              }
            }
          }
        });
        assert.fail('Should have thrown error');
      } catch (error) {
        // Expected to fail
      }
      
      // Verify nothing was created
      const finalArticles = await knex('articles').count('* as count');
      const finalPivots = await knex('article_tags').count('* as count');
      
      assert.strictEqual(finalArticles[0].count, initialArticles[0].count);
      assert.strictEqual(finalPivots[0].count, initialPivots[0].count);
    });
    
    test('should support external transaction', async () => {
      // First check the article doesn't exist
      const beforeTrx = await knex('articles').where('title', 'Transactional Article').first();
      assert.ok(!beforeTrx);
      
      const trx = await knex.transaction();
      
      try {
        // Create article in transaction
        const result = await api.scopes.articles.post({
          inputRecord: {
            data: {
              type: 'articles',
              attributes: {
                title: 'Transactional Article',
                content: 'In transaction'
              },
              relationships: {
                tags: {
                  data: [{ type: 'tags', id: '1' }]
                }
              }
            }
          },
          transaction: trx
        });
        
        // Article should exist in transaction
        const inTrx = await trx('articles').where('title', 'Transactional Article').first();
        assert.ok(inTrx);
        
        // Also check the many-to-many was created in transaction
        const pivotInTrx = await trx('article_tags')
          .where('article_id', inTrx.id)
          .first();
        assert.ok(pivotInTrx);
        assert.strictEqual(pivotInTrx.tag_id, 1);

        // Rollback
        await trx.rollback();
      } catch (error) {
        await trx.rollback();
        throw error;
      }
      
      // After rollback, article should not exist
      const afterRollback = await knex('articles').where('title', 'Transactional Article').first();
      assert.ok(!afterRollback);
      
      // And pivot records should also not exist
      const pivotCount = await knex('article_tags').count('* as count');
      // Should still have the original 3 pivot records from setup
      assert.strictEqual(pivotCount[0].count, 3);
    });
  });
  
  describe('Edge Cases', () => {
    test('should handle resource with only relationships (no attributes)', async () => {
      // First ensure we have the basic article
      await knex('articles').insert({
        id: 100,
        title: 'Base Article',
        content: 'Base content'
      });
      
      // Create pivot record with only relationships
      const result = await api.scopes.article_tags.post({
        inputRecord: {
          data: {
            type: 'article_tags',
            attributes: {
              article_id: 100,
              tag_id: 1,
              relevance: 'high'
            }
          }
        }
      });
      
      assert.ok(result.data);
      assert.strictEqual(result.data.attributes.relevance, 'high');
    });
    
    test('should handle POST with sparse fieldsets in response', async () => {
      const result = await api.scopes.articles.post({
        inputRecord: {
          data: {
            type: 'articles',
            attributes: {
              title: 'Sparse Response Article',
              content: 'Full content',
              status: 'draft'
            }
          }
        },
        queryParams: {
          fields: {
            articles: 'title,status'
          }
        }
      });
      
      assert.ok(result.data);
      assert.strictEqual(result.data.attributes.title, 'Sparse Response Article');
      assert.strictEqual(result.data.attributes.status, 'draft');
      assert.strictEqual(result.data.attributes.content, undefined);
    });
  });
});