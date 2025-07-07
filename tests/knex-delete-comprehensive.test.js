import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import knexConfig from 'knex';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';

describe('Comprehensive DELETE Tests', () => {
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
    
    // Enable foreign key constraints in SQLite
    await knex.raw('PRAGMA foreign_keys = ON');
    
    // Create test tables with relationships
    await knex.schema.createTable('authors', table => {
      table.increments('id');
      table.string('name');
      table.string('email').unique();
    });
    
    await knex.schema.createTable('categories', table => {
      table.increments('id');
      table.string('name');
      table.string('slug').unique();
    });
    
    await knex.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('content');
      table.integer('author_id').references('id').inTable('authors').onDelete('SET NULL');
      table.integer('category_id').references('id').inTable('categories').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    
    await knex.schema.createTable('comments', table => {
      table.increments('id');
      table.text('content');
      table.integer('article_id').references('id').inTable('articles').onDelete('CASCADE');
      table.integer('author_id').references('id').inTable('authors').onDelete('SET NULL');
      table.integer('parent_comment_id').references('id').inTable('comments').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    
    await knex.schema.createTable('tags', table => {
      table.increments('id');
      table.string('name');
    });
    
    await knex.schema.createTable('article_tags', table => {
      table.increments('id');
      table.integer('article_id').references('id').inTable('articles').onDelete('CASCADE');
      table.integer('tag_id').references('id').inTable('tags').onDelete('CASCADE');
      table.unique(['article_id', 'tag_id']);
    });
    
    // Insert test data
    await knex('authors').insert([
      { id: 1, name: 'John Doe', email: 'john@example.com' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      { id: 3, name: 'Bob Wilson', email: 'bob@example.com' }
    ]);
    
    await knex('categories').insert([
      { id: 1, name: 'Technology', slug: 'tech' },
      { id: 2, name: 'Science', slug: 'science' },
      { id: 3, name: 'Travel', slug: 'travel' }
    ]);
    
    await knex('articles').insert([
      { id: 1, title: 'First Article', content: 'Content 1', author_id: 1, category_id: 1 },
      { id: 2, title: 'Second Article', content: 'Content 2', author_id: 2, category_id: 1 },
      { id: 3, title: 'Third Article', content: 'Content 3', author_id: 1, category_id: 2 },
      { id: 4, title: 'Fourth Article', content: 'Content 4', author_id: 3, category_id: 3 }
    ]);
    
    await knex('comments').insert([
      { id: 1, content: 'Great article!', article_id: 1, author_id: 2, parent_comment_id: null },
      { id: 2, content: 'Thanks!', article_id: 1, author_id: 1, parent_comment_id: 1 },
      { id: 3, content: 'Another comment', article_id: 2, author_id: 3, parent_comment_id: null },
      { id: 4, content: 'Nested reply', article_id: 1, author_id: 3, parent_comment_id: 2 }
    ]);
    
    await knex('tags').insert([
      { id: 1, name: 'javascript' },
      { id: 2, name: 'nodejs' },
      { id: 3, name: 'api' }
    ]);
    
    await knex('article_tags').insert([
      { article_id: 1, tag_id: 1 },
      { article_id: 1, tag_id: 2 },
      { article_id: 2, tag_id: 3 },
      { article_id: 3, tag_id: 1 }
    ]);
    
    // Create API instance
    api = new Api({
      name: 'test-api',
      version: '1.0.0'
    });
    
    // Install plugins
    await api.use(RestApiPlugin, {
      idProperty: 'id'
    });
    
    await api.use(RestApiKnexPlugin, {
      knex: knex
    });
    
    // Define resources
    api.addResource('authors', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        email: { type: 'string', required: true }
      }
    });
    
    api.addResource('categories', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true },
        slug: { type: 'string', required: true }
      }
    });
    
    api.addResource('articles', {
      schema: {
        id: { type: 'id' },
        title: { type: 'string', required: true },
        content: { type: 'string' },
        author_id: { type: 'number' },
        category_id: { type: 'number' },
        created_at: { type: 'string' }
      }
    });
    
    api.addResource('comments', {
      schema: {
        id: { type: 'id' },
        content: { type: 'string', required: true },
        article_id: { type: 'number' },
        author_id: { type: 'number' },
        parent_comment_id: { type: 'number' },
        created_at: { type: 'string' }
      }
    });
    
    api.addResource('tags', {
      schema: {
        id: { type: 'id' },
        name: { type: 'string', required: true }
      }
    });
    
    api.addResource('article_tags', {
      schema: {
        id: { type: 'id' },
        article_id: { type: 'number', required: true },
        tag_id: { type: 'number', required: true }
      }
    });
  });
  
  afterEach(async () => {
    if (knex && !knex.client?.pool?.destroyed) {
      await knex.destroy();
    }
  });
  
  describe('Basic DELETE Operations', () => {
    test('should delete an existing resource', async () => {
      // Verify article exists
      const before = await knex('articles').where('id', 4).first();
      assert.ok(before);
      
      // Delete the article
      await api.scopes.articles.delete({
        id: '4'
      });
      
      // Verify it's gone
      const after = await knex('articles').where('id', 4).first();
      assert.ok(!after);
    });
    
    test('should return 404 for non-existent resource', async () => {
      try {
        await api.scopes.articles.delete({
          id: '999'
        });
        assert.fail('Should have thrown 404 error');
      } catch (error) {
        assert.ok(error.message.includes('not found') || error.status === 404);
      }
    });
    
    test('should handle string IDs', async () => {
      // Delete with string ID
      await api.scopes.comments.delete({
        id: '3'
      });
      
      // Verify deletion
      const deleted = await knex('comments').where('id', 3).first();
      assert.ok(!deleted);
    });
  });
  
  describe('CASCADE Behavior', () => {
    test('should cascade delete comments when article is deleted', async () => {
      // Article 1 has comments with IDs 1, 2, 4
      const commentsBefore = await knex('comments').where('article_id', 1).count('* as count');
      assert.strictEqual(commentsBefore[0].count, 3);
      
      // Delete article
      await api.scopes.articles.delete({
        id: '1'
      });
      
      // Verify article is gone
      const article = await knex('articles').where('id', 1).first();
      assert.ok(!article);
      
      // Verify comments are also gone
      const commentsAfter = await knex('comments').where('article_id', 1).count('* as count');
      assert.strictEqual(commentsAfter[0].count, 0);
    });
    
    test('should cascade delete nested comments', async () => {
      // Comment 1 has child comment 2, which has child comment 4
      const nestedBefore = await knex('comments').whereIn('id', [1, 2, 4]).count('* as count');
      assert.strictEqual(nestedBefore[0].count, 3);
      
      // Delete top-level comment
      await api.scopes.comments.delete({
        id: '1'
      });
      
      // Verify all nested comments are gone
      const nestedAfter = await knex('comments').whereIn('id', [1, 2, 4]).count('* as count');
      assert.strictEqual(nestedAfter[0].count, 0);
    });
    
    test('should cascade delete article_tags when article is deleted', async () => {
      // Article 1 has 2 tags
      const tagsBefore = await knex('article_tags').where('article_id', 1).count('* as count');
      assert.strictEqual(tagsBefore[0].count, 2);
      
      // Delete article
      await api.scopes.articles.delete({
        id: '1'
      });
      
      // Verify pivot records are gone
      const tagsAfter = await knex('article_tags').where('article_id', 1).count('* as count');
      assert.strictEqual(tagsAfter[0].count, 0);
      
      // But the tags themselves should still exist
      const tag1 = await knex('tags').where('id', 1).first();
      const tag2 = await knex('tags').where('id', 2).first();
      assert.ok(tag1);
      assert.ok(tag2);
    });
    
    test('should handle SET NULL on delete', async () => {
      // Articles have SET NULL for author_id
      const articleBefore = await knex('articles').where('id', 1).first();
      assert.strictEqual(articleBefore.author_id, 1);
      
      // Delete author
      await api.scopes.authors.delete({
        id: '1'
      });
      
      // Article should still exist but with null author_id
      const articleAfter = await knex('articles').where('id', 1).first();
      assert.ok(articleAfter);
      assert.strictEqual(articleAfter.author_id, null);
    });
  });
  
  describe('Transaction Support', () => {
    test('should support external transaction', async () => {
      // First check the article exists
      const exists = await knex('articles').where('id', 3).first();
      assert.ok(exists);
      
      // Create and use transaction
      const trx = await knex.transaction();
      
      try {
        // Delete in transaction
        await api.scopes.articles.delete({
          id: '3',
          transaction: trx
        });
        
        // Verify it's gone within the transaction
        const inTrx = await trx('articles').where('id', 3).first();
        assert.ok(!inTrx);
        
        // Rollback the transaction
        await trx.rollback();
      } catch (error) {
        await trx.rollback();
        throw error;
      }
      
      // After rollback, check from main connection
      const afterRollback = await knex('articles').where('id', 3).first();
      assert.ok(afterRollback, 'Article should still exist after rollback');
    });
    
    test('should rollback on error in transaction', async () => {
      const countBefore = await knex('articles').count('* as count');
      let trx;
      
      try {
        // Start transaction
        trx = await knex.transaction();
        
        await api.scopes.articles.delete({
          id: '2',
          transaction: trx
        });
        
        // Simulate error
        throw new Error('Simulated error');
      } catch (error) {
        // Rollback if transaction exists
        if (trx && !trx.isCompleted()) {
          await trx.rollback();
        }
      }
      
      // Verify nothing was deleted
      const countAfter = await knex('articles').count('* as count');
      assert.strictEqual(countAfter[0].count, countBefore[0].count);
    });
  });
  
  describe('Complex Scenarios', () => {
    test('should handle deletion of resource with multiple relationships', async () => {
      // Article 2 has author, category, comments, and tags
      const article = await knex('articles').where('id', 2).first();
      assert.ok(article);
      
      // Count related data
      const comments = await knex('comments').where('article_id', 2).count('* as count');
      const tags = await knex('article_tags').where('article_id', 2).count('* as count');
      assert.ok(comments[0].count > 0);
      assert.ok(tags[0].count > 0);
      
      // Delete article
      await api.scopes.articles.delete({
        id: '2'
      });
      
      // Verify cascades worked properly
      const deletedArticle = await knex('articles').where('id', 2).first();
      const deletedComments = await knex('comments').where('article_id', 2).count('* as count');
      const deletedTags = await knex('article_tags').where('article_id', 2).count('* as count');
      
      assert.ok(!deletedArticle);
      assert.strictEqual(deletedComments[0].count, 0);
      assert.strictEqual(deletedTags[0].count, 0);
      
      // Author and category should still exist
      const author = await knex('authors').where('id', 2).first();
      const category = await knex('categories').where('id', 1).first();
      assert.ok(author);
      assert.ok(category);
    });
    
    test('should handle deletion of category with CASCADE', async () => {
      // Category 1 has articles 1 and 2
      const articlesBefore = await knex('articles').where('category_id', 1).count('* as count');
      assert.strictEqual(articlesBefore[0].count, 2);
      
      // Delete category (CASCADE should delete articles)
      await api.scopes.categories.delete({
        id: '1'
      });
      
      // Verify category and its articles are gone
      const category = await knex('categories').where('id', 1).first();
      const articlesAfter = await knex('articles').where('category_id', 1).count('* as count');
      
      assert.ok(!category);
      assert.strictEqual(articlesAfter[0].count, 0);
    });
    
    test('should handle multiple deletes in sequence', async () => {
      // Delete multiple resources
      await api.scopes.comments.delete({ id: '4' });
      await api.scopes.comments.delete({ id: '3' });
      await api.scopes.tags.delete({ id: '3' });
      
      // Verify all are deleted
      const comment4 = await knex('comments').where('id', 4).first();
      const comment3 = await knex('comments').where('id', 3).first();
      const tag3 = await knex('tags').where('id', 3).first();
      
      assert.ok(!comment4);
      assert.ok(!comment3);
      assert.ok(!tag3);
    });
  });
  
  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      // Close database connection to simulate error
      await knex.destroy();
      
      try {
        await api.scopes.articles.delete({
          id: '1'
        });
        assert.fail('Should have thrown database error');
      } catch (error) {
        // Should get a database error
        assert.ok(error.message);
      }
    });
    
    test('should validate ID parameter', async () => {
      try {
        await api.scopes.articles.delete({
          // Missing ID
        });
        assert.fail('Should have thrown validation error');
      } catch (error) {
        assert.ok(error.message.includes('id') || error.message.includes('ID'));
      }
    });
  });
});