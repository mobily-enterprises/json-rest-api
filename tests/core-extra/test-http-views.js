import { test, describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { Api, Schema } from '../../index.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { ValidationPlugin } from '../../plugins/core/validation.js';
import { HTTPPlugin } from '../../plugins/core/http.js';
import { ViewsPlugin } from '../../plugins/core-extra/views.js';

describe('HTTP Plugin with Views', () => {
  test('basic query should work without views plugin', async () => {
    const api = new Api();
    const app = express();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(HTTPPlugin, { app });
    
    api.addResource('posts', new Schema({
      title: { type: 'string' }
    }));
    
    await api.resources.posts.create({ title: 'Test' });
    
    const res = await request(app)
      .get('/api/posts');
    
    if (res.status !== 200) {
      console.log('Error:', JSON.stringify(res.body, null, 2));
    }
    assert.equal(res.status, 200);
    
    assert.equal(res.body.data[0].attributes.title, 'Test');
  });
  
  test('should not accept joins parameter in query string', async () => {
    const api = new Api();
    const app = express();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(ViewsPlugin);
    api.use(HTTPPlugin, { app });
    
    api.addResource('posts', new Schema({
      title: { type: 'string' },
      authorId: { type: 'id', refs: { resource: 'users' } }
    }));
    
    api.addResource('users', new Schema({
      name: { type: 'string' }
    }));
    
    await api.resources.users.create({ name: 'John' });
    await api.resources.posts.create({ title: 'Test', authorId: 1 });
    
    // Try to use joins parameter (should be ignored)
    const res = await request(app)
      .get('/api/posts?joins=authorId');
    
    if (res.status !== 200) {
      console.log('Error response:', JSON.stringify(res.body, null, 2));
    }
    
    // Should not have joined data since joins parameter is removed
    assert.equal(res.body.data[0].attributes.authorId, 1);
    assert.ok(!res.body.included);
  });
  
  test('should accept view parameter instead', async () => {
    const api = new Api();
    const app = express();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(ViewsPlugin);
    api.use(HTTPPlugin, { app });
    
    api.addResource('posts', new Schema({
      title: { type: 'string' },
      authorId: { type: 'id', refs: { resource: 'users', join: { eager: true } } }
    }), {
      views: {
        withAuthor: {
          query: { joins: ['authorId'] }
        }
      }
    });
    
    api.addResource('users', new Schema({
      name: { type: 'string' }
    }));
    
    await api.resources.users.create({ name: 'John' });
    await api.resources.posts.create({ title: 'Test', authorId: 1 });
    
    // Use view parameter
    const res = await request(app)
      .get('/api/posts?view=withAuthor')
      .expect(200);
    
    // Should have joined data via view
    assert.equal(typeof res.body.data[0].attributes.authorId, 'object');
    assert.equal(res.body.data[0].attributes.authorId.name, 'John');
  });
  
  test('should support view parameter for GET single resource', async () => {
    const api = new Api();
    const app = express();
    
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(ViewsPlugin);
    api.use(HTTPPlugin, { app });
    
    api.addResource('posts', new Schema({
      title: { type: 'string' },
      content: { type: 'string' },
      secret: { type: 'string' }
    }), {
      views: {
        public: {
          get: {
            fields: ['id', 'title', 'content']
          }
        }
      }
    });
    
    const post = await api.resources.posts.create({
      title: 'Test Post',
      content: 'Public content',
      secret: 'Hidden data'
    });
    
    // Use view parameter for GET
    const res = await request(app)
      .get(`/api/posts/${post.data.id}?view=public`)
      .expect(200);
    
    // Should only have public fields
    assert.ok(res.body.data.attributes.title);
    assert.ok(res.body.data.attributes.content);
    assert.ok(!res.body.data.attributes.secret);
  });
});