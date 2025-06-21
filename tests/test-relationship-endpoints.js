import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { Api, Schema, MemoryPlugin, HTTPPlugin } from '../index.js';

describe('JSON:API Relationship Endpoints', () => {
  let api, app, server;
  
  beforeEach(async () => {
    api = new Api({ debug: false });
    api.use(MemoryPlugin);
    
    app = express();
    api.use(HTTPPlugin, { 
      app, 
      basePath: '/api',
      getUserFromRequest: (req) => {
        if (req.headers['x-user']) {
          try {
            return JSON.parse(req.headers['x-user']);
          } catch (e) {
            return null;
          }
        }
        return null;
      }
    });
    
    // Define schemas with relationships
    api.addResource('articles', new Schema({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      authorId: { 
        type: 'id', 
        refs: { 
          resource: 'users',
          provideUrl: true  // Enable relationship endpoints
        },
        searchable: true
      },
      tags: {
        type: 'list',
        virtual: true,
        foreignResource: 'tags',
        foreignKey: 'articleId',
        provideUrl: true  // Enable relationship endpoints
      }
    }));
    
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      articles: {
        type: 'list',
        virtual: true,
        foreignResource: 'articles',
        foreignKey: 'authorId',
        provideUrl: true
      }
    }));
    
    api.addResource('tags', new Schema({
      name: { type: 'string', required: true },
      articleId: { 
        type: 'id', 
        refs: { resource: 'articles' },
        searchable: true
      }
    }));
    
    await api.connect();
    
    // Create test data
    const author = await api.insert({
      name: 'John Doe',
      email: 'john@example.com'
    }, { type: 'users' });
    
    const article = await api.insert({
      title: 'Test Article',
      content: 'This is a test article',
      authorId: author.data.id
    }, { type: 'articles' });
    
    const tag1 = await api.insert({
      name: 'javascript',
      articleId: article.data.id
    }, { type: 'tags' });
    
    const tag2 = await api.insert({
      name: 'testing',
      articleId: article.data.id
    }, { type: 'tags' });
    
    // Store IDs for tests in the test context
    global.testData = {
      authorId: author.data.id,
      articleId: article.data.id,
      tag1Id: tag1.data.id,
      tag2Id: tag2.data.id
    };
    
    server = app.listen(0);
  });
  
  afterEach(async () => {
    server?.close();
  });
  
  test('GET /articles/:id/relationships/authorId - to-one relationship linkage', async () => {
    const res = await request(app)
      .get(`/api/articles/${global.testData.articleId}/relationships/authorId`)
      .expect(200);
    
    assert.equal(res.body.data.type, 'users');
    assert.equal(res.body.data.id, global.testData.authorId);
    
    // Should have links
    assert(res.body.links);
    assert(res.body.links.self);
    assert(res.body.links.related);
  });
  
  test('GET /articles/:id/authorId - to-one related resource', async () => {
    const res = await request(app)
      .get(`/api/articles/${global.testData.articleId}/authorId`)
      .expect(200);
    
    assert.equal(res.body.data.type, 'users');
    assert.equal(res.body.data.id, global.testData.authorId);
    assert.equal(res.body.data.attributes.name, 'John Doe');
    assert.equal(res.body.data.attributes.email, 'john@example.com');
  });
  
  test('GET /articles/:id/relationships/tags - to-many relationship linkage', async () => {
    const res = await request(app)
      .get(`/api/articles/${global.testData.articleId}/relationships/tags`)
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.data[0].type, 'tags');
    assert.equal(res.body.data[1].type, 'tags');
    
    const tagIds = res.body.data.map(d => d.id).sort();
    assert.deepEqual(tagIds, [global.testData.tag1Id, global.testData.tag2Id].sort());
  });
  
  test('GET /articles/:id/tags - to-many related resources', async () => {
    const res = await request(app)
      .get(`/api/articles/${global.testData.articleId}/tags`)
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 2);
    
    const tagNames = res.body.data.map(d => d.attributes.name).sort();
    assert.deepEqual(tagNames, ['javascript', 'testing']);
  });
  
  test('PATCH /articles/:id/relationships/authorId - update to-one', async () => {
    // Create a new author
    const newAuthor = await api.insert({
      name: 'Jane Smith',
      email: 'jane@example.com'
    }, { type: 'users' });
    
    const res = await request(app)
      .patch(`/api/articles/${global.testData.articleId}/relationships/authorId`)
      .send({
        data: { type: 'users', id: newAuthor.data.id }
      })
      .expect(200);
    
    assert.equal(res.body.data.type, 'users');
    assert.equal(res.body.data.id, newAuthor.data.id);
    
    // Verify the article was updated
    const article = await api.get(global.testData.articleId, { type: 'articles' });
    assert.equal(article.data.attributes.authorId, newAuthor.data.id);
  });
  
  test('PATCH /articles/:id/relationships/authorId - clear to-one with null', async () => {
    const res = await request(app)
      .patch(`/api/articles/${global.testData.articleId}/relationships/authorId`)
      .send({
        data: null
      })
      .expect(200);
    
    assert.equal(res.body.data, null);
    
    // Verify the article was updated
    const article = await api.get(global.testData.articleId, { type: 'articles' });
    assert.equal(article.data.attributes.authorId, null);
  });
  
  test('POST /articles/:id/relationships/tags - add to to-many', async () => {
    // Create new tags
    const tag3 = await api.insert({
      name: 'nodejs',
      articleId: null  // Not yet associated
    }, { type: 'tags' });
    
    const tag4 = await api.insert({
      name: 'api',
      articleId: null
    }, { type: 'tags' });
    
    const res = await request(app)
      .post(`/api/articles/${global.testData.articleId}/relationships/tags`)
      .send({
        data: [
          { type: 'tags', id: tag3.data.id },
          { type: 'tags', id: tag4.data.id }
        ]
      })
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 4); // Original 2 + new 2
    
    // Verify tags were updated
    const updatedTag3 = await api.get(tag3.data.id, { type: 'tags' });
    assert.equal(updatedTag3.data.attributes.articleId, global.testData.articleId);
  });
  
  test('DELETE /articles/:id/relationships/tags - remove from to-many', async () => {
    const res = await request(app)
      .delete(`/api/articles/${global.testData.articleId}/relationships/tags`)
      .send({
        data: [
          { type: 'tags', id: global.testData.tag1Id }
        ]
      })
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 1); // Only tag2 remains
    assert.equal(res.body.data[0].id, global.testData.tag2Id);
    
    // Verify tag was updated
    const tag1 = await api.get(global.testData.tag1Id, { type: 'tags' });
    assert.equal(tag1.data.attributes.articleId, null);
  });
  
  test('should return 404 for non-existent resource', async () => {
    await request(app)
      .get('/api/articles/99999/relationships/authorId')
      .expect(404);
    
    await request(app)
      .get('/api/articles/99999/authorId')
      .expect(404);
  });
  
  test('should return 404 for non-existent field', async () => {
    await request(app)
      .get(`/api/articles/${global.testData.articleId}/relationships/nonexistent`)
      .expect(404);
    
    await request(app)
      .get(`/api/articles/${global.testData.articleId}/nonexistent`)
      .expect(404);
  });
  
  test('should return 400 for field without provideUrl', async () => {
    // Create a resource without provideUrl
    api.addResource('comments', new Schema({
      text: { type: 'string', required: true },
      articleId: { 
        type: 'id', 
        refs: { 
          resource: 'articles'
          // No provideUrl flag
        }
      }
    }));
    
    const comment = await api.insert({
      text: 'Test comment',
      articleId: global.testData.articleId
    }, { type: 'comments' });
    
    await request(app)
      .get(`/api/comments/${comment.data.id}/relationships/articleId`)
      .expect(400);
  });
  
  test('should return 400 for invalid PATCH data', async () => {
    // Missing type
    await request(app)
      .patch(`/api/articles/${global.testData.articleId}/relationships/authorId`)
      .send({
        data: { id: global.testData.authorId }
      })
      .expect(400);
    
    // Wrong type
    await request(app)
      .patch(`/api/articles/${global.testData.articleId}/relationships/authorId`)
      .send({
        data: { type: 'wrong-type', id: global.testData.authorId }
      })
      .expect(400);
  });
  
  test('should handle empty to-many relationships', async () => {
    // Create article with no tags
    const emptyArticle = await api.insert({
      title: 'Empty Article',
      content: 'No tags',
      authorId: global.testData.authorId
    }, { type: 'articles' });
    
    const res = await request(app)
      .get(`/api/articles/${emptyArticle.data.id}/relationships/tags`)
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 0);
  });
  
  test('should support query parameters on related resource endpoint', async () => {
    // Create more tags
    await api.insert({
      name: 'advanced',
      articleId: global.testData.articleId
    }, { type: 'tags' });
    
    // Get tags with sorting
    const res = await request(app)
      .get(`/api/articles/${global.testData.articleId}/tags?sort=name`)
      .expect(200);
    
    assert(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 3);
    assert.equal(res.body.data[0].attributes.name, 'advanced');
    assert.equal(res.body.data[1].attributes.name, 'javascript');
    assert.equal(res.body.data[2].attributes.name, 'testing');
  });
  
  test('should handle concurrent modifications', async () => {
    // Create multiple tags to add
    const newTags = await Promise.all([
      api.insert({ name: 'tag1', articleId: null }, { type: 'tags' }),
      api.insert({ name: 'tag2', articleId: null }, { type: 'tags' }),
      api.insert({ name: 'tag3', articleId: null }, { type: 'tags' })
    ]);
    
    // Send multiple concurrent POST requests
    const requests = newTags.map(tag => 
      request(app)
        .post(`/api/articles/${global.testData.articleId}/relationships/tags`)
        .send({
          data: [{ type: 'tags', id: tag.data.id }]
        })
    );
    
    const responses = await Promise.all(requests);
    
    // All should succeed
    responses.forEach(res => {
      assert.equal(res.status, 200);
    });
    
    // Final check - should have all tags
    const finalRes = await request(app)
      .get(`/api/articles/${global.testData.articleId}/relationships/tags`)
      .expect(200);
    
    assert.equal(finalRes.body.data.length, 5); // Original 2 + new 3
  });
  
  test('should respect permissions on relationship endpoints', async () => {
    // Add schema with permissions
    api.addResource('private-docs', new Schema({
      title: { type: 'string', required: true },
      ownerId: { 
        type: 'id', 
        refs: { 
          resource: 'users',
          provideUrl: true
        },
        permissions: { read: 'admin' }  // Only admins can see owner
      }
    }));
    
    const doc = await api.insert({
      title: 'Private Document',
      ownerId: global.testData.authorId
    }, { type: 'private-docs' });
    
    // Try without permissions - should get 404 (field not visible)
    await request(app)
      .get(`/api/private-docs/${doc.data.id}/relationships/ownerId`)
      .expect(404);
    
    // With admin permissions - should work
    const adminReq = await request(app)
      .get(`/api/private-docs/${doc.data.id}/relationships/ownerId`)
      .set('X-User', JSON.stringify({ roles: ['admin'] }))
      .expect(200);
    
    assert.equal(adminReq.body.data.type, 'users');
    assert.equal(adminReq.body.data.id, global.testData.authorId);
  });
});