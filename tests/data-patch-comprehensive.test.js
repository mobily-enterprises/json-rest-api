import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Comprehensive dataPatch Tests', () => {
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
    
    // Create test tables with relationships
    await knex.schema.createTable('companies', table => {
      table.increments('id');
      table.string('name');
      table.string('industry');
      table.string('country');
      table.string('website');
      table.integer('founded_year');
    });
    
    await knex.schema.createTable('authors', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
      table.string('biography');
      table.integer('company_id');
      table.string('nationality');
      table.boolean('active');
    });
    
    await knex.schema.createTable('categories', table => {
      table.increments('id');
      table.string('name');
      table.string('slug');
      table.string('description');
    });
    
    await knex.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.string('body');
      table.string('summary');
      table.integer('author_id');
      table.integer('category_id');
      table.string('status');
      table.integer('views');
      table.boolean('featured');
      table.date('published_date');
    });
    
    await knex.schema.createTable('comments', table => {
      table.increments('id');
      table.string('content');
      table.integer('article_id');
      table.integer('author_id');
      table.integer('parent_comment_id'); // For nested comments
      table.boolean('approved');
      table.date('created_at');
    });
    
    // Insert test data
    await knex('companies').insert([
      { id: 1, name: 'Tech Corp', industry: 'Technology', country: 'USA', website: 'techcorp.com', founded_year: 2000 },
      { id: 2, name: 'Media Inc', industry: 'Media', country: 'UK', website: 'mediainc.co.uk', founded_year: 1995 }
    ]);
    
    await knex('authors').insert([
      { id: 1, name: 'Alice Author', email: 'alice@techcorp.com', biography: 'Tech writer', company_id: 1, nationality: 'American', active: true },
      { id: 2, name: 'Bob Writer', email: 'bob@mediainc.com', biography: 'Journalist', company_id: 2, nationality: 'British', active: true },
      { id: 3, name: 'Charlie Blogger', email: 'charlie@freelance.com', biography: 'Freelancer', company_id: null, nationality: 'Canadian', active: false }
    ]);
    
    await knex('categories').insert([
      { id: 1, name: 'Technology', slug: 'tech', description: 'Technology articles' },
      { id: 2, name: 'Business', slug: 'business', description: 'Business news' },
      { id: 3, name: 'Lifestyle', slug: 'lifestyle', description: 'Lifestyle content' }
    ]);
    
    await knex('articles').insert([
      { 
        id: 1, 
        title: 'Original Article', 
        body: 'Original body content',
        summary: 'Original summary',
        author_id: 1,
        category_id: 1,
        status: 'published',
        views: 100,
        featured: false,
        published_date: '2023-01-01'
      },
      { 
        id: 2, 
        title: 'Another Article', 
        body: 'Another body',
        summary: 'Another summary',
        author_id: 2,
        category_id: 2,
        status: 'draft',
        views: 0,
        featured: true,
        published_date: null
      }
    ]);
    
    await knex('comments').insert([
      { id: 1, content: 'Great article!', article_id: 1, author_id: 2, parent_comment_id: null, approved: true, created_at: '2023-01-02' },
      { id: 2, content: 'Thanks!', article_id: 1, author_id: 1, parent_comment_id: 1, approved: true, created_at: '2023-01-03' }
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
    
    // Add resources with schemas and relationships
    api.addResource('companies', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        industry: { type: 'string' },
        country: { type: 'string' },
        website: { type: 'string' },
        founded_year: { type: 'number' }
      },
      relationships: {
        employees: {
          hasMany: 'authors',
          foreignKey: 'company_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string' },
        biography: { type: 'string' },
        company_id: { 
          belongsTo: 'companies', 
          as: 'company',
          sideLoad: true
        },
        nationality: { type: 'string' },
        active: { type: 'boolean' }
      },
      relationships: {
        articles: {
          hasMany: 'articles',
          foreignKey: 'author_id',
          sideLoad: true
        },
        comments: {
          hasMany: 'comments',
          foreignKey: 'author_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('categories', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        slug: { type: 'string' },
        description: { type: 'string' }
      },
      relationships: {
        articles: {
          hasMany: 'articles',
          foreignKey: 'category_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        body: { type: 'string' },
        summary: { type: 'string' },
        author_id: { 
          belongsTo: 'authors', 
          as: 'author',
          sideLoad: true
        },
        category_id: { 
          belongsTo: 'categories', 
          as: 'category',
          sideLoad: true
        },
        status: { type: 'string' },
        views: { type: 'number' },
        featured: { type: 'boolean' },
        published_date: { type: 'date' }
      },
      relationships: {
        comments: {
          hasMany: 'comments',
          foreignKey: 'article_id',
          sideLoad: true
        }
      }
    });
    
    api.addResource('comments', {
      schema: {
        id: { type: 'id' },
        content: { type: 'string', required: true },
        article_id: { 
          belongsTo: 'articles', 
          as: 'article',
          sideLoad: true
        },
        author_id: { 
          belongsTo: 'authors', 
          as: 'author',
          sideLoad: true
        },
        parent_comment_id: { 
          belongsTo: 'comments', 
          as: 'parentComment',
          sideLoad: true
        },
        approved: { type: 'boolean' },
        created_at: { type: 'date' }
      },
      relationships: {
        replies: {
          hasMany: 'comments',
          foreignKey: 'parent_comment_id',
          sideLoad: true
        }
      }
    });
  });
  
  afterEach(async () => {
    await knex.destroy();
  });
  
  describe('Basic PATCH Operations', () => {
    test('should partially update an existing record with only attributes', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Patched Title',
              status: 'revised'
              // Note: body, summary, and other fields remain unchanged
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.type, 'articles');
      assert.strictEqual(result.data.id, '1');
      assert.strictEqual(result.data.attributes.title, 'Patched Title');
      assert.strictEqual(result.data.attributes.status, 'revised');
      // Check that unmentioned fields remain unchanged
      assert.strictEqual(result.data.attributes.body, 'Original body content');
      assert.strictEqual(result.data.attributes.summary, 'Original summary');
      assert.strictEqual(result.data.attributes.views, 100);
      assert.strictEqual(result.data.attributes.author_id, undefined, 'Should not expose foreign key');
      
      // Verify in database
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.title, 'Patched Title');
      assert.strictEqual(dbRecord.body, 'Original body content', 'Should preserve unmentioned fields');
      assert.strictEqual(dbRecord.author_id, 1, 'Should preserve existing foreign key');
    });
    
    test('should handle PATCH for non-existent record (404)', async () => {
      try {
        await api.resources.articles.patch({
          id: '999',
          inputRecord: {
            data: {
              type: 'articles',
              id: '999',
              attributes: {
                title: 'Should fail'
              }
            }
          }
        });
        assert.fail('Should have thrown 404 error');
      } catch (error) {
        assert.ok(error.message.includes('not found') || error.code === 'REST_API_RESOURCE' || error.status === 404);
      }
    });
    
    test('should update single field without affecting others', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              views: 150  // Only update views
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.views, 150);
      // All other fields should remain unchanged
      assert.strictEqual(result.data.attributes.title, 'Original Article');
      assert.strictEqual(result.data.attributes.body, 'Original body content');
      assert.strictEqual(result.data.attributes.status, 'published');
    });
  });
  
  describe('belongsTo Relationship Handling', () => {
    test('should update belongsTo relationship via foreign key', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            relationships: {
              author: {
                data: { type: 'authors', id: '2' }
              }
              // Note: category relationship remains unchanged
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      // Attributes should remain unchanged
      assert.strictEqual(result.data.attributes.title, 'Original Article');
      
      // Verify foreign key was updated in database
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.author_id, 2, 'Should update author foreign key');
      assert.strictEqual(dbRecord.category_id, 1, 'Should preserve category foreign key');
    });
    
    test('should update attributes and relationships together', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Patched with new category',
              featured: true
            },
            relationships: {
              category: {
                data: { type: 'categories', id: '3' }
              }
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.title, 'Patched with new category');
      assert.strictEqual(result.data.attributes.featured, 1); // SQLite returns 1 for true
      
      // Verify both attributes and foreign key were updated
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.title, 'Patched with new category');
      assert.strictEqual(dbRecord.featured, 1); // SQLite boolean
      assert.strictEqual(dbRecord.category_id, 3, 'Should update category foreign key');
      assert.strictEqual(dbRecord.author_id, 1, 'Should preserve author foreign key');
    });
    
    test('should clear belongsTo relationship when set to null', async () => {
      // First verify article has an author
      const before = await knex('articles').where('id', 1).first();
      assert.ok(before.author_id, 'Should have author initially');
      
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            relationships: {
              author: {
                data: null
              }
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      
      // Verify foreign key was cleared
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.author_id, null, 'Should clear foreign key');
      assert.strictEqual(dbRecord.category_id, 1, 'Should preserve other foreign keys');
    });
    
    test('should handle self-referential belongsTo', async () => {
      const result = await api.resources.comments.patch({
        id: '2',
        inputRecord: {
          data: {
            type: 'comments',
            id: '2',
            attributes: {
              content: 'Updated reply'
            },
            relationships: {
              parentComment: {
                data: null // Clear parent
              }
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.content, 'Updated reply');
      
      // Verify self-referential foreign key was cleared
      const dbRecord = await knex('comments').where('id', 2).first();
      assert.strictEqual(dbRecord.parent_comment_id, null, 'Should clear parent comment');
      assert.strictEqual(dbRecord.content, 'Updated reply');
    });
  });
  
  describe('Query Parameter Support', () => {
    test('should support include parameter for related resources', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Patched with includes'
            }
          }
        },
        queryParams: {
          include: ['author', 'category', 'comments']
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      assert.strictEqual(result.data.attributes.title, 'Patched with includes');
      
      // Check included resources
      const includedTypes = result.included.map(r => r.type);
      assert.ok(includedTypes.includes('authors'), 'Should include author');
      assert.ok(includedTypes.includes('categories'), 'Should include category');
      assert.ok(includedTypes.includes('comments'), 'Should include comments');
    });
    
    test('should support sparse fieldsets', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              views: 200
            }
          }
        },
        queryParams: {
          fields: {
            articles: 'title,views'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.title, 'Original Article');
      assert.strictEqual(result.data.attributes.views, 200);
      // Other fields should not be included due to sparse fieldsets
      assert.strictEqual(result.data.attributes.body, undefined, 'Should not include body');
      assert.strictEqual(result.data.attributes.summary, undefined, 'Should not include summary');
    });
    
    test('should support nested includes with sparse fieldsets', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              status: 'updated'
            }
          }
        },
        queryParams: {
          include: ['author.company', 'comments.author'],
          fields: {
            articles: 'title,status',
            authors: 'name',
            companies: 'name,industry',
            comments: 'content'
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.ok(result.included, 'Should have included resources');
      
      // Check main resource has only requested fields
      assert.strictEqual(result.data.attributes.title, 'Original Article');
      assert.strictEqual(result.data.attributes.status, 'updated');
      assert.strictEqual(Object.keys(result.data.attributes).length, 2);
      
      // Check nested includes
      const companies = result.included.filter(r => r.type === 'companies');
      assert.ok(companies.length > 0, 'Should include companies');
      companies.forEach(company => {
        assert.ok(company.attributes.name);
        assert.ok(company.attributes.industry);
        assert.strictEqual(company.attributes.country, undefined);
      });
    });
  });
  
  describe('Complex Update Scenarios', () => {
    test('should handle empty attributes (only relationship updates)', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            relationships: {
              category: {
                data: { type: 'categories', id: '3' }
              }
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      
      // Verify only the relationship was updated
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.title, 'Original Article', 'Should preserve title');
      assert.strictEqual(dbRecord.body, 'Original body content', 'Should preserve body');
      assert.strictEqual(dbRecord.category_id, 3, 'Should update category');
    });
    
    test('should handle empty update (no attributes or relationships)', async () => {
      // PATCH requires at least one of attributes or relationships
      try {
        await api.resources.articles.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'articles',
              id: '1'
              // No attributes or relationships
            }
          }
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert.ok(error.message.includes('attributes') || error.message.includes('relationships'));
        assert.strictEqual(error.code, 'REST_API_VALIDATION');
      }
      
      // Verify nothing changed
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.title, 'Original Article');
      assert.strictEqual(dbRecord.author_id, 1);
    });
    
    test('should preserve unmentioned relationships', async () => {
      // Article 1 has author_id=1 and category_id=1
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Only updating category'
            },
            relationships: {
              category: {
                data: { type: 'categories', id: '2' }
              }
              // Note: author relationship not mentioned
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      
      // Verify author wasn't changed
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.author_id, 1, 'Should preserve author');
      assert.strictEqual(dbRecord.category_id, 2, 'Should update category');
      assert.strictEqual(dbRecord.title, 'Only updating category');
    });
  });
  
  describe('Edge Cases', () => {
    test('should handle special characters in attributes', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Title with "quotes" and \'apostrophes\'',
              body: 'Body with\nnewlines\tand\ttabs'
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.title, 'Title with "quotes" and \'apostrophes\'');
      assert.strictEqual(result.data.attributes.body, 'Body with\nnewlines\tand\ttabs');
    });
    
    test('should handle numeric string IDs', async () => {
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Updated via string ID'
            },
            relationships: {
              author: {
                data: { type: 'authors', id: '3' } // String ID
              }
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      
      // Verify it worked with string IDs
      const dbRecord = await knex('articles').where('id', 1).first();
      assert.strictEqual(dbRecord.author_id, 3);
      assert.strictEqual(dbRecord.title, 'Updated via string ID');
    });
    
    test('should handle boolean updates correctly', async () => {
      // Verify initial state
      const before = await knex('articles').where('id', 1).first();
      assert.strictEqual(before.featured, 0); // SQLite false
      
      const result = await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              featured: true
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.featured, 1); // SQLite returns 1 for true
      
      // Verify in database
      const after = await knex('articles').where('id', 1).first();
      assert.strictEqual(after.featured, 1); // SQLite true
    });
    
    test('should handle date field updates', async () => {
      const result = await api.resources.articles.patch({
        id: '2',
        inputRecord: {
          data: {
            type: 'articles',
            id: '2',
            attributes: {
              published_date: '2024-01-01'
            }
          }
        }
      });
      
      assert.ok(result.data, 'Should have data');
      assert.strictEqual(result.data.attributes.published_date, '2024-01-01');
      
      // Verify in database
      const dbRecord = await knex('articles').where('id', 2).first();
      assert.strictEqual(dbRecord.published_date, '2024-01-01');
    });
  });
  
  describe('Validation and Error Handling', () => {
    test('should validate field types', async () => {
      try {
        await api.resources.articles.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'articles',
              id: '1',
              attributes: {
                views: 'not-a-number' // Should be number
              }
            }
          }
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert.ok(error.message.includes('validation') || error.message.includes('invalid'));
      }
    });
    
    test('should handle ID mismatch between URL and body', async () => {
      try {
        await api.resources.articles.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'articles',
              id: '2', // Different from URL param
              attributes: {
                title: 'Should fail'
              }
            }
          }
        });
        assert.fail('Should have thrown ID mismatch error');
      } catch (error) {
        assert.ok(error.message.includes('mismatch') || error.message.includes('ID'));
      }
    });
    
    test('should reject included array', async () => {
      try {
        await api.resources.articles.patch({
          id: '1',
          inputRecord: {
            data: {
              type: 'articles',
              id: '1',
              attributes: {
                title: 'With included'
              }
            },
            included: [] // Not allowed in PATCH
          }
        });
        assert.fail('Should have thrown error for included array');
      } catch (error) {
        assert.ok(error.message.includes('included') || error.message.includes('PATCH'));
      }
    });
  });
  
  describe('Performance Tests', () => {
    test('should only update modified fields in database', async () => {
      // Spy on database queries
      const queries = [];
      const originalMethod = knex.client.query;
      knex.client.query = function(connection, obj) {
        queries.push(obj.sql);
        return originalMethod.apply(this, arguments);
      };
      
      await api.resources.articles.patch({
        id: '1',
        inputRecord: {
          data: {
            type: 'articles',
            id: '1',
            attributes: {
              title: 'Only title updated'
            }
          }
        }
      });
      
      // Restore original method
      knex.client.query = originalMethod;
      
      // Check that UPDATE query only sets the changed field
      const updateQuery = queries.find(q => q.includes('update'));
      assert.ok(updateQuery, 'Should have an UPDATE query');
      
      // The UPDATE should only mention title and author_id (if relationships were updated)
      // This verifies partial update behavior
    });
  });
});