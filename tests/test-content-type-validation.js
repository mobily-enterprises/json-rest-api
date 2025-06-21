import { test, describe } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { Api, Schema, HTTPPlugin, MemoryPlugin } from '../index.js';

describe('Content-Type Validation', () => {
  const setupApi = (httpOptions = {}) => {
    const app = express();
    const api = new Api();
    
    api.use(MemoryPlugin);
    api.use(HTTPPlugin, { 
      app,
      ...httpOptions
    });
    
    const schema = new Schema({
      title: { type: 'string', required: true }
    });
    
    api.addResource('posts', schema);
    
    return { app, api };
  };
  
  describe('Default Content-Type Validation', () => {
    test('should accept application/json', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            attributes: {
              title: 'Test Post'
            }
          }
        })
        .expect(201);
      
      assert(res.body.data);
      assert.equal(res.body.data.attributes.title, 'Test Post');
    });
    
    test('should accept application/vnd.api+json', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            attributes: {
              title: 'JSON:API Post'
            }
          }
        })
        .expect(201);
      
      assert(res.body.data);
      assert.equal(res.body.data.attributes.title, 'JSON:API Post');
    });
    
    test('should accept content-type with charset', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/json; charset=utf-8')
        .send({
          data: {
            attributes: {
              title: 'Post with charset'
            }
          }
        })
        .expect(201);
      
      assert(res.body.data);
    });
    
    test('should reject missing Content-Type header', async () => {
      const { app } = setupApi();
      
      // When we send a string, supertest sets application/x-www-form-urlencoded
      // This is actually correct behavior - we should accept the 415 response
      const res = await request(app)
        .post('/api/posts')
        .unset('Content-Type')
        .send(JSON.stringify({
          data: {
            attributes: {
              title: 'No Content-Type'
            }
          }
        }))
        .expect(415); // Unsupported Media Type is correct
      
      assert(res.body.errors);
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
    });
    
    test('should reject invalid Content-Type', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'text/plain')
        .send('plain text data')
        .expect(415);
      
      assert(res.body.errors);
      assert.equal(res.body.errors[0].status, '415');
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
      assert(res.body.errors[0].detail.includes('Content-Type must be one of'));
    });
    
    test('should reject application/xml', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/xml')
        .send('<post><title>XML Post</title></post>')
        .expect(415);
      
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
    });
    
    test('should reject multipart/form-data', async () => {
      const { app } = setupApi();
      
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'multipart/form-data; boundary=----boundary')
        .send('------boundary\r\nContent-Disposition: form-data; name="title"\r\n\r\nTest\r\n------boundary--')
        .expect(415);
      
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
    });
    
    test('should not validate GET requests', async () => {
      const { app } = setupApi();
      
      // GET without Content-Type should work
      const res = await request(app)
        .get('/api/posts')
        .expect(200);
      
      assert(res.body.data);
    });
    
    test('should not validate DELETE requests', async () => {
      const { app, api } = setupApi();
      
      // Create a post first
      const createResult = await api.insert({ title: 'To Delete' }, { type: 'posts' });
      const id = createResult.data.id;
      
      // DELETE without Content-Type should work
      await request(app)
        .delete(`/api/posts/${id}`)
        .expect(204);
    });
  });
  
  describe('Custom Content-Type Configuration', () => {
    test('should allow disabling validation', async () => {
      const { app } = setupApi({ validateContentType: false });
      
      // Should accept request without Content-Type
      const res = await request(app)
        .post('/api/posts')
        .send({
          data: {
            attributes: {
              title: 'No validation'
            }
          }
        })
        .expect(201);
      
      assert(res.body.data);
    });
    
    test('should support custom allowed content types', async () => {
      const { app } = setupApi({
        allowedContentTypes: ['application/json', 'application/custom+json']
      });
      
      // Custom type should work
      const res = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/custom+json')
        .send({
          data: {
            attributes: {
              title: 'Custom type'
            }
          }
        })
        .expect(201);
      
      assert(res.body.data);
      
      // Standard JSON:API should now fail
      const res2 = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            attributes: {
              title: 'Should fail'
            }
          }
        })
        .expect(415);
      
      assert(res2.body.errors);
    });
  });
  
  describe('Content-Type Case Sensitivity', () => {
    test('should handle case-insensitive content types', async () => {
      const { app } = setupApi();
      
      // Uppercase should work
      const res1 = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'APPLICATION/JSON')
        .send({
          data: {
            attributes: {
              title: 'Uppercase'
            }
          }
        })
        .expect(201);
      
      assert(res1.body.data);
      
      // Mixed case should work
      const res2 = await request(app)
        .post('/api/posts')
        .set('Content-Type', 'Application/Vnd.Api+Json')
        .send({
          data: {
            attributes: {
              title: 'Mixed case'
            }
          }
        })
        .expect(201);
      
      assert(res2.body.data);
    });
  });
});