#!/usr/bin/env node

/**
 * Simple tests for strict JSON:API mode
 */

import { test, describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Api, Schema, HTTPPlugin, MemoryPlugin } from '../index.js';

describe('Strict JSON:API Mode Tests', () => {
  describe('Strict Mode Enabled', () => {
    let api, app;
    
    before(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      api.addResource('articles', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true, searchable: true },
        content: { type: 'string', searchable: true }
      }));
      
      await api.connect();
      
      app = express();
      api.use(HTTPPlugin, { 
        app,
        strictJsonApi: true
      });
      
      // Create test data
      await api.resources.articles.create({
        title: 'Test Article',
        content: 'Test content'
      });
    });
    
    after(async () => {
      await api.disconnect();
    });
    
    it('should accept application/vnd.api+json content type', async () => {
      const res = await request(app)
        .post('/api/articles')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'articles',
            attributes: {
              title: 'JSON:API Article',
              content: 'JSON:API content'
            }
          }
        });
      
      assert.equal(res.status, 201);
      assert.equal(res.body.data.attributes.title, 'JSON:API Article');
    });
    
    it('should reject application/json content type', async () => {
      const res = await request(app)
        .post('/api/articles')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'articles',
            attributes: {
              title: 'JSON Article',
              content: 'JSON content'
            }
          }
        });
      
      assert.equal(res.status, 415);
      assert.equal(res.body.errors[0].status, '415');
      assert.equal(res.body.errors[0].code, 'UNSUPPORTED_MEDIA_TYPE');
    });
    
    it('should reject unknown query parameters', async () => {
      const res = await request(app)
        .get('/api/articles')
        .query({ unknownParam: 'value' });
      
      assert.equal(res.status, 400);
      assert(res.body.errors[0].detail.includes('Unknown query parameter'));
      assert(res.body.errors[0].detail.includes('unknownParam'));
    });
    
    it('should reject legacy query parameters', async () => {
      const res = await request(app)
        .get('/api/articles')
        .query({ 
          pageSize: '10',
          joins: 'author'
        });
      
      assert.equal(res.status, 400);
      assert(res.body.errors[0].detail.includes('pageSize'));
      assert(res.body.errors[0].detail.includes('joins'));
    });
    
    it('should accept standard JSON:API parameters', async () => {
      const res = await request(app)
        .get('/api/articles')
        .query({
          'filter[title]': 'Test',
          'sort': '-title',
          'page[size]': '10',
          'fields[articles]': 'title,content'
        });
      
      assert.equal(res.status, 200);
      assert(Array.isArray(res.body.data));
    });
  });
  
  describe('Strict Mode Disabled (Default)', () => {
    let api, app;
    
    before(async () => {
      api = new Api();
      api.use(MemoryPlugin);
      
      api.addResource('posts', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true, searchable: true },
        content: { type: 'string' }
      }));
      
      await api.connect();
      
      app = express();
      api.use(HTTPPlugin, { 
        app,
        strictJsonApi: false  // Explicitly disabled
      });
      
      // Create test data
      await api.resources.posts.create({
        title: 'Legacy Post',
        content: 'Legacy content'
      });
    });
    
    after(async () => {
      await api.disconnect();
    });
    
    it('should accept application/json content type', async () => {
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
    
    it('should accept direct filter parameters', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({ title: 'Legacy Post' });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].attributes.title, 'Legacy Post');
    });
    
    it('should accept legacy pagination parameters', async () => {
      const res = await request(app)
        .get('/api/posts')
        .query({ 
          pageSize: '5',
          page: '1'
        });
      
      assert.equal(res.status, 200);
      assert.equal(res.body.meta.pageSize, 5);
    });
  });
});