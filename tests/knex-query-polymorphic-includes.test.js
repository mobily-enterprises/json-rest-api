import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Api, resetGlobalRegistryForTesting } from 'hooked-api';
import { RestApiPlugin } from '../plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from '../plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

describe('Polymorphic Relationships - Include Support', () => {
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
    await db.schema.createTable('users', table => {
      table.increments('id');
      table.string('name');
      table.string('email');
    });
    
    await db.schema.createTable('articles', table => {
      table.increments('id');
      table.string('title');
      table.text('body');
      table.integer('author_id');
      table.timestamp('published_at');
    });
    
    await db.schema.createTable('videos', table => {
      table.increments('id');
      table.string('title');
      table.string('url');
      table.integer('creator_id');
      table.integer('duration');
    });
    
    await db.schema.createTable('products', table => {
      table.increments('id');
      table.string('name');
      table.decimal('price');
      table.integer('vendor_id');
    });
    
    await db.schema.createTable('comments', table => {
      table.increments('id');
      table.text('content');
      table.string('commentable_type');
      table.integer('commentable_id');
      table.integer('user_id');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    
    await db.schema.createTable('reviews', table => {
      table.increments('id');
      table.text('content');
      table.integer('rating');
      table.string('reviewable_type');
      table.integer('reviewable_id');
      table.integer('author_id');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
    
    // Insert test data
    await db('users').insert([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' }
    ]);
    
    await db('articles').insert([
      { id: 1, title: 'JavaScript Tips', body: 'Some tips...', author_id: 1, published_at: '2024-01-01' },
      { id: 2, title: 'REST API Design', body: 'API design...', author_id: 2, published_at: '2024-01-02' }
    ]);
    
    await db('videos').insert([
      { id: 1, title: 'Learn Node.js', url: 'https://example.com/node', creator_id: 2, duration: 1200 },
      { id: 2, title: 'Advanced React', url: 'https://example.com/react', creator_id: 3, duration: 1800 }
    ]);
    
    await db('products').insert([
      { id: 1, name: 'Laptop', price: 999.99, vendor_id: 3 },
      { id: 2, name: 'Mouse', price: 29.99, vendor_id: 3 }
    ]);
    
    await db('comments').insert([
      { id: 1, content: 'Great article!', commentable_type: 'articles', commentable_id: 1, user_id: 2, created_at: new Date('2024-01-01') },
      { id: 2, content: 'Thanks for sharing', commentable_type: 'articles', commentable_id: 1, user_id: 3, created_at: new Date('2024-01-02') },
      { id: 3, content: 'Love this video', commentable_type: 'videos', commentable_id: 1, user_id: 1, created_at: new Date('2024-01-03') },
      { id: 4, content: 'Very helpful', commentable_type: 'articles', commentable_id: 2, user_id: 1, created_at: new Date('2024-01-04') },
      { id: 5, content: 'Nice tutorial', commentable_type: 'videos', commentable_id: 2, user_id: 2, created_at: new Date('2024-01-05') }
    ]);
    
    await db('reviews').insert([
      { id: 1, content: 'Excellent product', rating: 5, reviewable_type: 'products', reviewable_id: 1, author_id: 1 },
      { id: 2, content: 'Good value', rating: 4, reviewable_type: 'products', reviewable_id: 2, author_id: 2 },
      { id: 3, content: 'Well written', rating: 5, reviewable_type: 'articles', reviewable_id: 1, author_id: 3 }
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
        as: 'author'
      },
      published_at: { type: 'string' }
    };
    
    const videosSchema = {
      id: { type: 'id' },
      title: { type: 'string', required: true },
      url: { type: 'string', required: true },
      creator_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'creator'
      },
      duration: { type: 'number' }
    };
    
    const productsSchema = {
      id: { type: 'id' },
      name: { type: 'string', required: true },
      price: { type: 'decimal', required: true },
      vendor_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'vendor'
      }
    };
    
    const commentsSchema = {
      id: { type: 'id' },
      content: { type: 'string', required: true },
      commentable_type: { type: 'string' },
      commentable_id: { type: 'number' },
      user_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'author'
      },
      created_at: { type: 'string' }
    };
    
    const reviewsSchema = {
      id: { type: 'id' },
      content: { type: 'string', required: true },
      rating: { type: 'number', min: 1, max: 5 },
      reviewable_type: { type: 'string' },
      reviewable_id: { type: 'number' },
      author_id: {
        type: 'number',
        belongsTo: 'users',
        as: 'author'
      },
      created_at: { type: 'string' }
    };
    
    // Register scopes
    api.addResource('users', { schema: usersSchema });
    
    api.addResource('articles', {
      schema: articlesSchema,
      relationships: {
        comments: {
          hasMany: 'comments',
          via: 'commentable',
          as: 'comments',
          sideLoadMany: true
        }
      }
    });
    
    api.addResource('videos', {
      schema: videosSchema,
      relationships: {
        comments: {
          hasMany: 'comments',
          via: 'commentable',
          as: 'comments',
          sideLoadMany: true
        }
      }
    });
    
    api.addResource('products', {
      schema: productsSchema,
      relationships: {
        reviews: {
          hasMany: 'reviews',
          via: 'reviewable',
          as: 'reviews',
          sideLoadMany: true
        }
      }
    });
    
    api.addResource('comments', {
      schema: commentsSchema,
      relationships: {
        commentable: {
          belongsToPolymorphic: {
            types: ['articles', 'videos'],
            typeField: 'commentable_type',
            idField: 'commentable_id'
          },
          as: 'commentable'
        }
      }
    });
    
    api.addResource('reviews', {
      schema: reviewsSchema,
      relationships: {
        reviewable: {
          belongsToPolymorphic: {
            types: ['articles', 'products'],
            typeField: 'reviewable_type',
            idField: 'reviewable_id'
          },
          as: 'reviewable'
        }
      }
    });
  });
  
  afterEach(async () => {
    // Clean up
    await db.schema.dropTableIfExists('reviews');
    await db.schema.dropTableIfExists('comments');
    await db.schema.dropTableIfExists('products');
    await db.schema.dropTableIfExists('videos');
    await db.schema.dropTableIfExists('articles');
    await db.schema.dropTableIfExists('users');
    await db.destroy();
  });
  
  // Test 1: Include polymorphic belongsTo (article)
  test('should include polymorphic commentable (article)', async () => {
    const result = await api.resources.comments.get({
      id: '1',
      queryParams: {
        include: ['commentable']
      }
    });
    
    assert.strictEqual(result.data.type, 'comments');
    assert.strictEqual(result.data.id, '1');
    assert.strictEqual(result.data.attributes.content, 'Great article!');
    
    // Check relationship
    assert.ok(result.data.relationships);
    assert.deepStrictEqual(result.data.relationships.commentable, {
      data: { type: 'articles', id: '1' }
    });
    
    // Check included
    assert.ok(result.included);
    assert.strictEqual(result.included.length, 1);
    assert.strictEqual(result.included[0].type, 'articles');
    assert.strictEqual(result.included[0].id, '1');
    assert.strictEqual(result.included[0].attributes.title, 'JavaScript Tips');
  });
  
  // Test 2: Include polymorphic belongsTo (video)
  test('should include polymorphic commentable (video)', async () => {
    const result = await api.resources.comments.get({
      id: '3',
      queryParams: {
        include: ['commentable']
      }
    });
    
    assert.strictEqual(result.data.type, 'comments');
    assert.strictEqual(result.data.id, '3');
    
    // Check relationship
    assert.deepStrictEqual(result.data.relationships.commentable, {
      data: { type: 'videos', id: '1' }
    });
    
    // Check included
    assert.strictEqual(result.included.length, 1);
    assert.strictEqual(result.included[0].type, 'videos');
    assert.strictEqual(result.included[0].id, '1');
    assert.strictEqual(result.included[0].attributes.title, 'Learn Node.js');
  });
  
  // Test 3: Include multiple polymorphic in list query
  test('should include polymorphic relationships in query results', async () => {
    const result = await api.resources.comments.query({
      queryParams: {
        include: ['commentable', 'author'],
        sort: ['id']
      }
    });
    
    assert.ok(result.data);
    assert.strictEqual(result.data.length, 5);
    
    // Should have included both articles and videos
    assert.ok(result.included);
    
    const includedArticles = result.included.filter(r => r.type === 'articles');
    const includedVideos = result.included.filter(r => r.type === 'videos');
    const includedUsers = result.included.filter(r => r.type === 'users');
    
    assert.strictEqual(includedArticles.length, 2);
    assert.strictEqual(includedVideos.length, 2);
    assert.strictEqual(includedUsers.length, 3);
    
    // Verify relationships point to correct types
    const articleComment = result.data.find(c => c.id === '1');
    assert.deepStrictEqual(articleComment.relationships.commentable, {
      data: { type: 'articles', id: '1' }
    });
    
    const videoComment = result.data.find(c => c.id === '3');
    assert.deepStrictEqual(videoComment.relationships.commentable, {
      data: { type: 'videos', id: '1' }
    });
  });
  
  // Test 4: Include reverse polymorphic (hasMany via)
  test('should include comments on article via polymorphic', async () => {
    const result = await api.resources.articles.get({
      id: '1',
      queryParams: {
        include: ['comments']
      }
    });
    
    assert.strictEqual(result.data.type, 'articles');
    assert.strictEqual(result.data.id, '1');
    
    // Check relationship
    assert.ok(result.data.relationships);
    assert.ok(result.data.relationships.comments);
    assert.strictEqual(result.data.relationships.comments.data.length, 2);
    
    // Check included comments
    assert.ok(result.included);
    const comments = result.included.filter(r => r.type === 'comments');
    assert.strictEqual(comments.length, 2);
    
    // Verify the comments are for this article
    const commentIds = comments.map(c => c.id).sort();
    assert.deepStrictEqual(commentIds, ['1', '2']);
  });
  
  // Test 5: Include reverse polymorphic for different type
  test('should include reviews on product via polymorphic', async () => {
    const result = await api.resources.products.get({
      id: '1',
      queryParams: {
        include: ['reviews']
      }
    });
    
    assert.strictEqual(result.data.type, 'products');
    assert.strictEqual(result.data.id, '1');
    
    // Check relationship
    assert.ok(result.data.relationships);
    assert.ok(result.data.relationships.reviews);
    assert.strictEqual(result.data.relationships.reviews.data.length, 1);
    assert.deepStrictEqual(result.data.relationships.reviews.data[0], {
      type: 'reviews',
      id: '1'
    });
    
    // Check included
    assert.ok(result.included);
    assert.strictEqual(result.included.length, 1);
    assert.strictEqual(result.included[0].type, 'reviews');
    assert.strictEqual(result.included[0].attributes.rating, 5);
  });
  
  // Test 6: Nested includes through polymorphic
  test('should support nested includes through polymorphic relationships', async () => {
    const result = await api.resources.comments.get({
      id: '1',
      queryParams: {
        include: ['commentable.author', 'author']
      }
    });
    
    assert.strictEqual(result.data.type, 'comments');
    
    // Should include the article and its author, plus comment author
    assert.ok(result.included);
    
    const article = result.included.find(r => r.type === 'articles');
    assert.ok(article);
    assert.strictEqual(article.id, '1');
    
    const authors = result.included.filter(r => r.type === 'users');
    assert.strictEqual(authors.length, 2); // Article author + comment author
    
    // Find Alice (article author) and Bob (comment author)
    const alice = authors.find(a => a.attributes.name === 'Alice');
    const bob = authors.find(a => a.attributes.name === 'Bob');
    
    assert.ok(alice);
    assert.ok(bob);
  });
  
  // Test 7: Query with mixed polymorphic types
  test('should handle query with mixed polymorphic types', async () => {
    const result = await api.resources.reviews.query({
      queryParams: {
        include: ['reviewable', 'author']
      }
    });
    
    assert.ok(result.data);
    assert.strictEqual(result.data.length, 3);
    
    // Should have products and articles in included
    const products = result.included.filter(r => r.type === 'products');
    const articles = result.included.filter(r => r.type === 'articles');
    const users = result.included.filter(r => r.type === 'users');
    
    assert.strictEqual(products.length, 2);
    assert.strictEqual(articles.length, 1);
    assert.strictEqual(users.length, 3);
    
    // Verify each review points to correct type
    const productReview = result.data.find(r => r.id === '1');
    assert.deepStrictEqual(productReview.relationships.reviewable, {
      data: { type: 'products', id: '1' }
    });
    
    const articleReview = result.data.find(r => r.id === '3');
    assert.deepStrictEqual(articleReview.relationships.reviewable, {
      data: { type: 'articles', id: '1' }
    });
  });
  
  // Test 8: Sparse fieldsets with polymorphic includes
  test('should apply sparse fieldsets to polymorphic includes', async () => {
    const result = await api.resources.comments.query({
      queryParams: {
        include: ['commentable'],
        fields: {
          comments: 'content',
          articles: 'title',
          videos: 'title,url'
        }
      }
    });
    
    assert.ok(result.data);
    assert.ok(result.included);
    
    // Check articles only have title
    const articles = result.included.filter(r => r.type === 'articles');
    articles.forEach(article => {
      assert.ok(article.attributes.title);
      assert.strictEqual(article.attributes.body, undefined);
      assert.strictEqual(article.attributes.published_at, undefined);
    });
    
    // Check videos have title and url
    const videos = result.included.filter(r => r.type === 'videos');
    videos.forEach(video => {
      assert.ok(video.attributes.title);
      assert.ok(video.attributes.url);
      assert.strictEqual(video.attributes.duration, undefined);
    });
    
    // Check comments only have content
    result.data.forEach(comment => {
      assert.ok(comment.attributes.content);
      assert.strictEqual(comment.attributes.created_at, undefined);
    });
  });
});