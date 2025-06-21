#!/usr/bin/env node

/**
 * HTTP Tests for strict JSON:API compliance mode
 */

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupServer } from './setup-advanced.js';
import request from 'supertest';

describe('Strict JSON:API Compliance HTTP Tests', () => {
  describe('Content-Type Enforcement', () => {
    let api, app, server;
    
    before(async () => {
      const setup = await setupServer({ strictJsonApi: true });
      api = setup.api;
      app = setup.app;
      server = setup.server;
    });
    
    after(async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });
    
    it('should accept application/vnd.api+json for POST', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'users',
            attributes: {
              name: 'John Doe',
              email: 'john@example.com'
            }
          }
        });
      
      assert.equal(res.status, 201);
      assert.equal(res.body.data.attributes.name, 'John Doe');
    });
    
    it('should reject application/json in strict mode', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'users',
            attributes: {
              name: 'Jane Doe',
              email: 'jane@example.com'
            }
          }
        });
      
      assert.equal(res.status, 415);
      assert.equal(res.body.errors[0].status, '415');
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
      assert(res.body.errors[0].detail.includes('application/vnd.api+json'));
    });
    
    it('should reject missing Content-Type for POST', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({
          data: {
            type: 'users',
            attributes: {
              name: 'No Header',
              email: 'noheader@example.com'
            }
          }
        });
      
      assert.equal(res.status, 400);
      assert(res.body.errors[0].detail.includes('Content-Type header is required'));
    });
    
    it('should accept application/vnd.api+json for PATCH', async () => {
      // First create a user
      const createRes = await request(app)
        .post('/api/users')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'users',
            attributes: {
              name: 'Update Me',
              email: 'update@example.com'
            }
          }
        });
      
      const userId = createRes.body.data.id;
      
      const res = await request(app)
        .patch(`/api/users/${userId}`)
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'users',
            id: userId,
            attributes: {
              name: 'Updated Name'
            }
          }
        });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.data.attributes.name, 'Updated Name');
    });
    
    it('should not enforce Content-Type for GET requests', async () => {
      const res = await request(app)
        .get('/api/users');
      
      assert.equal(res.status, 200);
      assert(Array.isArray(res.body.data));
    });
  });
  
  describe('Unknown Query Parameters', () => {
    let api, app, server;
    
    before(async () => {
      const setup = await setupServer({ strictJsonApi: true });
      api = setup.api;
      app = setup.app;
      server = setup.server;
      
      // Create some test data
      await api.resources.posts.create({
        title: 'Test Post',
        content: 'Test content',
        published: true
      });
    });
    
    after(async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });
    
    it('should accept standard JSON:API parameters', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'include': 'authorId',
          'filter[title]': 'Test',
          'fields[posts]': 'title,content',
          'sort': '-title',
          'page[number]': '1',
          'page[size]': '10'
        });
      
      assert.equal(res.status, 200);
      assert(Array.isArray(res.body.data));
    });
    
    it('should reject unknown parameters in strict mode', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'unknownParam': 'value',
          'anotherUnknown': 'test'
        });
      
      assert.equal(res.status, 400);
      assert.equal(res.body.errors[0].code, 'BAD_REQUEST');
      assert(res.body.errors[0].detail.includes('Unknown query parameter'));
      assert(res.body.errors[0].detail.includes('unknownParam'));
      assert(res.body.errors[0].detail.includes('anotherUnknown'));
    });
    
    it('should reject legacy parameters in strict mode', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'pageSize': '10',
          'joins': 'author'
        });
      
      assert.equal(res.status, 400);
      assert(res.body.errors[0].detail.includes('pageSize'));
      assert(res.body.errors[0].detail.includes('joins'));
    });
    
    it('should reject direct filter parameters in strict mode', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'title': 'Test Post'
        });
      
      assert.equal(res.status, 400);
      assert(res.body.errors[0].detail.includes('title'));
    });
    
    it('should accept view parameter', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'view': 'summary'
        });
      
      assert.equal(res.status, 200);
    });
  });
  
  describe('Non-Strict Mode (Default Behavior)', () => {
    let api, app, server;
    
    before(async () => {
      // Set up without strict mode
      const setup = await setupServer({ strictJsonApi: false });
      api = setup.api;
      app = setup.app;
      server = setup.server;
      
      await api.resources.posts.create({
        title: 'Legacy Post',
        content: 'Legacy content',
        published: true
      });
    });
    
    after(async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });
    
    it('should accept application/json in non-strict mode', async () => {
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'posts',
            attributes: {
              title: 'JSON Post',
              content: 'JSON content'
            }
          }
        });
      
      assert.equal(res.status, 201);
    });
    
    it('should accept unknown parameters as filters in non-strict mode', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'title': 'Legacy Post'
        });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.title, 'Legacy Post');
    });
    
    it('should accept legacy pagination parameters in non-strict mode', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({
          'pageSize': '5',
          'page': '1'
        });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.pageSize, 5);
    });
  });
});