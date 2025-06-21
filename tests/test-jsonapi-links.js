import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';
import { HTTPPlugin } from '../plugins/http.js';
import express from 'express';
import fetch from 'node-fetch';

const serverHosts = [];

describe('JSON:API Links', () => {
  
  test('should include self links on single resources', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: true 
    });
    
    // Add test resource
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      authorId: { type: 'id' }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create a post
    const createRes = await fetch(`http://localhost:${port}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            title: 'Test Post',
            content: 'Test content'
          }
        }
      })
    });
    
    const created = await createRes.json();
    const postId = created.data.id;
    
    // Get the post
    const getRes = await fetch(`http://localhost:${port}/api/posts/${postId}`);
    const result = await getRes.json();
    
    // Check self link on resource
    if (!result.data.links || !result.data.links.self) {
      throw new Error('Missing self link on resource');
    }
    
    if (!result.data.links.self.includes(`/api/posts/${postId}`)) {
      throw new Error(`Invalid self link: ${result.data.links.self}`);
    }
    
    // Check top-level self link
    if (!result.links || !result.links.self) {
      throw new Error('Missing top-level self link');
    }
    
    if (!result.links.self.includes(`/api/posts/${postId}`)) {
      throw new Error(`Invalid top-level self link: ${result.links.self}`);
    }
  });
  
  test('should include self links on collection resources', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: true 
    });
    
    // Add test resource
    api.addResource('articles', new Schema({
      title: { type: 'string', required: true },
      body: { type: 'string' }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create some articles
    for (let i = 1; i <= 3; i++) {
      await fetch(`http://localhost:${port}/api/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            attributes: {
              title: `Article ${i}`,
              body: `Content ${i}`
            }
          }
        })
      });
    }
    
    // Get collection
    const res = await fetch(`http://localhost:${port}/api/articles`);
    const result = await res.json();
    
    // Check self links on each resource
    if (!result.data || !Array.isArray(result.data)) {
      throw new Error('Invalid response format');
    }
    
    for (const article of result.data) {
      if (!article.links || !article.links.self) {
        throw new Error(`Missing self link on article ${article.id}`);
      }
      
      if (!article.links.self.includes(`/api/articles/${article.id}`)) {
        throw new Error(`Invalid self link for article ${article.id}: ${article.links.self}`);
      }
    }
    
    // Check top-level self link
    if (!result.links || !result.links.self) {
      throw new Error('Missing top-level self link');
    }
    
    if (!result.links.self.includes('/api/articles')) {
      throw new Error(`Invalid top-level self link: ${result.links.self}`);
    }
  });
  
  test('should include relationship links', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: true 
    });
    
    // Add resources with relationships
    api.addResource('authors', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string' }
    }));
    
    api.addResource('books', new Schema({
      title: { type: 'string', required: true },
      authorId: {
        type: 'id',
        refs: {
          resource: 'authors',
          join: {
            eager: true,
            fields: ['id', 'name']
          }
        }
      }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create author
    const authorRes = await fetch(`http://localhost:${port}/api/authors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'Jane Doe',
            email: 'jane@example.com'
          }
        }
      })
    });
    
    const author = await authorRes.json();
    const authorId = author.data.id;
    
    // Create book
    const bookRes = await fetch(`http://localhost:${port}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            title: 'Test Book',
            authorId: authorId
          }
        }
      })
    });
    
    const created = await bookRes.json();
    const bookId = created.data.id;
    
    // Get the book
    const getRes = await fetch(`http://localhost:${port}/api/books/${bookId}`);
    const result = await getRes.json();
    
    // Check relationship exists
    if (!result.data.relationships || !result.data.relationships.author) {
      throw new Error('Missing author relationship');
    }
    
    const authorRel = result.data.relationships.author;
    
    // Check relationship links
    if (!authorRel.links) {
      throw new Error('Missing relationship links');
    }
    
    if (!authorRel.links.self || !authorRel.links.self.includes(`/api/books/${bookId}/relationships/author`)) {
      throw new Error(`Invalid relationship self link: ${authorRel.links.self}`);
    }
    
    if (!authorRel.links.related || !authorRel.links.related.includes(`/api/books/${bookId}/author`)) {
      throw new Error(`Invalid relationship related link: ${authorRel.links.related}`);
    }
  });
  
  test('should include links on included resources', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: true 
    });
    
    // Add resources
    api.addResource('categories', new Schema({
      name: { type: 'string', required: true }
    }));
    
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      categoryId: {
        type: 'id',
        refs: {
          resource: 'categories'
        }
      }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create category
    const catRes = await fetch(`http://localhost:${port}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'Electronics'
          }
        }
      })
    });
    
    const category = await catRes.json();
    const categoryId = category.data.id;
    
    // Create product
    const prodRes = await fetch(`http://localhost:${port}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'Laptop',
            categoryId: categoryId
          }
        }
      })
    });
    
    const product = await prodRes.json();
    
    // Get product with category included
    const getRes = await fetch(`http://localhost:${port}/api/products/${product.data.id}?include=categoryId`);
    const result = await getRes.json();
    
    // Check included section exists
    if (!result.included || !Array.isArray(result.included)) {
      throw new Error('Missing included section');
    }
    
    // Find category in included
    const includedCategory = result.included.find(
      item => item.type === 'categories' && item.id === categoryId
    );
    
    if (!includedCategory) {
      throw new Error('Category not found in included');
    }
    
    // Check self link on included resource
    if (!includedCategory.links || !includedCategory.links.self) {
      throw new Error('Missing self link on included category');
    }
    
    if (!includedCategory.links.self.includes(`/api/categories/${categoryId}`)) {
      throw new Error(`Invalid self link on included category: ${includedCategory.links.self}`);
    }
  });
  
  test('should preserve query parameters in collection self links', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: true 
    });
    
    // Add test resource
    api.addResource('items', new Schema({
      name: { type: 'string', required: true },
      status: { type: 'string', searchable: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create some items
    for (const status of ['active', 'inactive', 'active']) {
      await fetch(`http://localhost:${port}/api/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            attributes: {
              name: `Item ${status}`,
              status: status
            }
          }
        })
      });
    }
    
    // Get filtered collection
    const res = await fetch(`http://localhost:${port}/api/items?filter[status]=active&sort=-name`);
    const result = await res.json();
    
    // Check top-level self link preserves query params
    if (!result.links || !result.links.self) {
      throw new Error('Missing top-level self link');
    }
    
    if (!result.links.self.includes('filter[status]=active')) {
      throw new Error('Self link missing filter parameter');
    }
    
    if (!result.links.self.includes('sort=-name')) {
      throw new Error('Self link missing sort parameter');
    }
  });
  
  test('should not include links when disabled', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const app = express();
    api.use(HTTPPlugin, { 
      app, 
      includeLinks: false // Explicitly disabled
    });
    
    // Add test resource
    api.addResource('things', new Schema({
      name: { type: 'string', required: true }
    }));
    
    // Start server
    const port = 30000 + Math.floor(Math.random() * 10000);
    const server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });
    serverHosts.push(server);
    
    // Create a thing
    const createRes = await fetch(`http://localhost:${port}/api/things`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            name: 'Test Thing'
          }
        }
      })
    });
    
    const created = await createRes.json();
    
    // Get the thing
    const getRes = await fetch(`http://localhost:${port}/api/things/${created.data.id}`);
    const result = await getRes.json();
    
    // Check no links on resource
    if (result.data.links) {
      throw new Error('Should not have links when disabled');
    }
  });
  
  // Clean up after all tests
  test.after(async () => {
    // Clean up all servers
    for (const server of serverHosts) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});