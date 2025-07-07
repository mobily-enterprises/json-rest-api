import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('Polymorphic Relationships - Basic Operations', () => {
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
    
    // Create API instance
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
    
    await api.use(RestApiKnexPlugin, {
      knex: db
    });
    
    // Create test tables
    await db.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.integer('author_id');
    });
    
    await db.schema.createTable('videos', table => {
      table.increments('id');
      table.string('title');
      table.string('url');
      table.integer('creator_id');
    });
    
    await db.schema.createTable('products', table => {
      table.increments('id');
      table.string('name');
      table.decimal('price');
      table.integer('vendor_id');
    });
    
    await db.schema.createTable('users', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
    });
    
    await db.schema.createTable('comments', table => {
      table.increments('id');
      table.text('content');
      table.string('commentable_type');
      table.integer('commentable_id');
      table.integer('user_id');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    
    await db.schema.createTable('reactions', table => {
      table.increments('id');
      table.string('type'); // like, love, etc
      table.string('reactable_type');
      table.integer('reactable_id');
      table.integer('user_id');
    });
    
    // Insert test data
    await db('users').insert([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' }
    ]);
    
    await db('articles').insert([
      { id: 1, title: 'JavaScript Tips', body: 'Some tips...', author_id: 1 },
      { id: 2, title: 'REST API Design', body: 'API design...', author_id: 2 }
    ]);
    
    await db('videos').insert([
      { id: 1, title: 'Learn Node.js', url: 'https://example.com/node', creator_id: 2 },
      { id: 2, title: 'Advanced React', url: 'https://example.com/react', creator_id: 3 }
    ]);
    
    await db('products').insert([
      { id: 1, name: 'Laptop', price: 999.99, vendor_id: 3 },
      { id: 2, name: 'Mouse', price: 29.99, vendor_id: 3 }
    ]);
    
    // Insert polymorphic data
    await db('comments').insert([
      { id: 1, content: 'Great article!', commentable_type: 'articles', commentable_id: 1, user_id: 2 },
      { id: 2, content: 'Thanks for sharing', commentable_type: 'articles', commentable_id: 1, user_id: 3 },
      { id: 3, content: 'Excellent video', commentable_type: 'videos', commentable_id: 1, user_id: 1 },
      { id: 4, content: 'Very helpful', commentable_type: 'articles', commentable_id: 2, user_id: 1 },
      { id: 5, content: 'Good quality', commentable_type: 'products', commentable_id: 1, user_id: 2 },
      { id: 6, content: null, commentable_type: null, commentable_id: null, user_id: 1 } // orphaned comment
    ]);
    
    await db('reactions').insert([
      { id: 1, type: 'like', reactable_type: 'articles', reactable_id: 1, user_id: 2 },
      { id: 2, type: 'love', reactable_type: 'videos', reactable_id: 1, user_id: 3 },
      { id: 3, type: 'like', reactable_type: 'comments', reactable_id: 1, user_id: 1 }
    ]);
    
    // Define schemas
    const usersSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      email: { type: 'string', required: true }
    };
    
    const articlesSchema = {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      body: { type: 'string' },
      author_id: { 
        type: 'number',
        belongsTo: 'users',
        as: 'author',
        sideLoad: true
      }
    };
    
    const videosSchema = {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      url: { type: 'string', required: true },
      creator_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'creator',
        sideLoad: true
      }
    };
    
    const productsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      price: { type: 'decimal', required: true },
      vendor_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'vendor',
        sideLoad: true
      }
    };
    
    const commentsSchema = {
      id: { type: 'id' },
      content: { type: 'string' },
      commentable_type: { type: 'string' },
      commentable_id: { type: 'number' },
      user_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'author',
        sideLoad: true
      },
      created_at: { type: 'string' }
    };
    
    const reactionsSchema = {
      id: { type: 'id' },
      type: { type: 'string', required: true },
      reactable_type: { type: 'string' },
      reactable_id: { type: 'number' },
      user_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'user',
        sideLoad: true
      }
    };
    
    // Register scopes
    api.addResource('users', { schema: usersSchema });
    api.addResource('articles', { schema: articlesSchema });
    api.addResource('videos', { schema: videosSchema });
    api.addResource('products', { schema: productsSchema });
    
    api.addResource('comments', {
      schema: commentsSchema,
      searchSchema: {
        content: { type: 'string' },
        commentable_type: { type: 'string' },
        commentable_id: { type: 'number' },
        user_id: { type: 'number' }
      },
      relationships: {
        commentable: {
          belongsToPolymorphic: {
            types: ['articles', 'videos', 'products'],
            typeField: 'commentable_type',
            idField: 'commentable_id'
          },
          as: 'commentable',
          sideLoad: true
        }
      }
    });
    
    api.addResource('reactions', {
      schema: reactionsSchema,
      relationships: {
        reactable: {
          belongsToPolymorphic: {
            types: ['articles', 'videos', 'comments'],
            typeField: 'reactable_type',
            idField: 'reactable_id'
          },
          as: 'reactable',
          sideLoad: true
        }
      }
    });
  });
  
  afterEach(async () => {
    // Clean up
    await db.schema.dropTableIfExists('reactions');
    await db.schema.dropTableIfExists('comments');
    await db.schema.dropTableIfExists('products');
    await db.schema.dropTableIfExists('videos');
    await db.schema.dropTableIfExists('articles');
    await db.schema.dropTableIfExists('users');
    await db.destroy();
  });
  
  test('should return polymorphic relationships in GET response', async () => {
    const result = await api.resources.comments.get({ id: '1' });
    
    assert.strictEqual(result.data.type, 'comments');
    assert.strictEqual(result.data.id, '1');
    assert.strictEqual(result.data.attributes.content, 'Great article!');
    
    // Check polymorphic relationship
    assert.ok(result.data.relationships);
    assert.deepStrictEqual(result.data.relationships.commentable, {
      data: { type: 'articles', id: '1' }
    });
    
    // Also check regular belongsTo
    assert.deepStrictEqual(result.data.relationships.author, {
      data: { type: 'users', id: '2' }
    });
  });
  
  test('should handle different polymorphic types', async () => {
    // Comment on article
    const articleComment = await api.resources.comments.get({ id: '1' });
    assert.deepStrictEqual(articleComment.data.relationships.commentable, {
      data: { type: 'articles', id: '1' }
    });
    
    // Comment on video
    const videoComment = await api.resources.comments.get({ id: '3' });
    assert.deepStrictEqual(videoComment.data.relationships.commentable, {
      data: { type: 'videos', id: '1' }
    });
    
    // Comment on product
    const productComment = await api.resources.comments.get({ id: '5' });
    assert.deepStrictEqual(productComment.data.relationships.commentable, {
      data: { type: 'products', id: '1' }
    });
  });
  
  test('should handle null polymorphic relationships', async () => {
    const result = await api.resources.comments.get({ id: '6' });
    
    assert.strictEqual(result.data.type, 'comments');
    assert.strictEqual(result.data.id, '6');
    assert.strictEqual(result.data.attributes.content, null);
    
    // Polymorphic relationship should be null
    assert.deepStrictEqual(result.data.relationships.commentable, {
      data: null
    });
  });
  
  test('should handle nested polymorphic relationships', async () => {
    // Reaction on a comment (which itself has polymorphic relationship)
    const result = await api.resources.reactions.get({ id: '3' });
    
    assert.strictEqual(result.data.type, 'reactions');
    assert.strictEqual(result.data.attributes.type, 'like');
    
    // Check polymorphic relationship points to comment
    assert.deepStrictEqual(result.data.relationships.reactable, {
      data: { type: 'comments', id: '1' }
    });
  });
  
  test('should list resources with polymorphic relationships', async () => {
    const result = await api.resources.comments.query({
      queryParams: {
        sort: ['id']
      }
    });
    
    assert.ok(result.data);
    assert.strictEqual(result.data.length, 6);
    
    // Check various polymorphic relationships
    const articleComment = result.data.find(c => c.id === '1');
    assert.deepStrictEqual(articleComment.relationships.commentable, {
      data: { type: 'articles', id: '1' }
    });
    
    const videoComment = result.data.find(c => c.id === '3');
    assert.deepStrictEqual(videoComment.relationships.commentable, {
      data: { type: 'videos', id: '1' }
    });
    
    const nullComment = result.data.find(c => c.id === '6');
    assert.deepStrictEqual(nullComment.relationships.commentable, {
      data: null
    });
  });
  
  test('should filter by polymorphic type and id fields', async () => {
    // Filter comments by type
    const articleComments = await api.resources.comments.query({
      queryParams: {
        filters: { commentable_type: 'articles' }
      }
    });
    
    assert.strictEqual(articleComments.data.length, 3);
    articleComments.data.forEach(comment => {
      assert.ok(comment.relationships.commentable.data);
      assert.strictEqual(comment.relationships.commentable.data.type, 'articles');
    });
    
    // Filter by specific polymorphic id
    const specificComments = await api.resources.comments.query({
      queryParams: {
        filters: { 
          commentable_type: 'articles',
          commentable_id: 1
        }
      }
    });
    
    assert.strictEqual(specificComments.data.length, 2);
    specificComments.data.forEach(comment => {
      assert.deepStrictEqual(comment.relationships.commentable, {
        data: { type: 'articles', id: '1' }
      });
    });
  });
  
  test('should handle pagination with polymorphic relationships', async () => {
    const page1 = await api.resources.comments.query({
      queryParams: {
        page: { size: 3, number: 1 },
        sort: ['id']
      }
    });
    
    assert.strictEqual(page1.data.length, 3);
    assert.strictEqual(page1.data[0].id, '1');
    assert.ok(page1.data[0].relationships.commentable);
    
    const page2 = await api.resources.comments.query({
      queryParams: {
        page: { size: 3, number: 2 },
        sort: ['id']
      }
    });
    
    assert.strictEqual(page2.data.length, 3);
    assert.strictEqual(page2.data[0].id, '4');
  });
  
  test('should handle sparse fieldsets with polymorphic relationships', async () => {
    const result = await api.resources.comments.query({
      queryParams: {
        fields: { comments: 'content,commentable_type' }
      }
    });
    
    assert.ok(result.data);
    result.data.forEach(comment => {
      // Should have requested fields
      assert.ok('content' in comment.attributes);
      
      // Should not have non-requested fields
      assert.strictEqual(comment.attributes.created_at, undefined);
      
      // Relationships should still be included
      assert.ok(comment.relationships);
    });
  });
});