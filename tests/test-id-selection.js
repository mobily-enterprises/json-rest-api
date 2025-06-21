import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, Schema } from '../index.js';

describe('ID Field Selection', () => {
  it('should include ID field in query results', async () => {
    const api = createApi({ storage: 'memory' })
    
    api.addResource('users', new Schema({
      name: { type: 'string', required: true },
      email: { type: 'string' }
    }))
    
    // Insert a test user
    const insertResult = await api.insert({
      name: 'Test User',
      email: 'test@example.com'
    }, { type: 'users' })
    
    const insertedId = insertResult.data.id
    assert(insertedId, 'ID should be present in insert result')
    
    // Query for users
    const queryResult = await api.query({}, { type: 'users' })
    
    assert.equal(queryResult.data.length, 1)
    assert.equal(queryResult.data[0].id, insertedId)
    assert.equal(queryResult.data[0].type, 'users')
    assert.equal(queryResult.data[0].attributes.name, 'Test User')
  })
  
  it('should include ID field when using custom idProperty', async () => {
    const api = createApi({ 
      storage: 'memory',
      idProperty: 'uid'
    })
    
    api.addResource('products', new Schema({
      name: { type: 'string', required: true },
      price: { type: 'number' }
    }))
    
    // Insert a test product
    const insertResult = await api.insert({
      name: 'Test Product',
      price: 99.99
    }, { type: 'products' })
    
    const insertedId = insertResult.data.id
    assert(insertedId, 'ID should be present in insert result')
    
    // Query for products
    const queryResult = await api.query({}, { type: 'products' })
    
    assert.equal(queryResult.data.length, 1)
    assert.equal(queryResult.data[0].id, insertedId)
    assert.equal(queryResult.data[0].type, 'products')
    assert.equal(queryResult.data[0].attributes.name, 'Test Product')
  })
  
  it('should include ID field when schema has silent fields', async () => {
    const api = createApi({ storage: 'memory' })
    
    api.addResource('posts', new Schema({
      title: { type: 'string', required: true },
      content: { type: 'string' },
      password: { type: 'string', silent: true }
    }))
    
    // Insert a test post
    const insertResult = await api.insert({
      title: 'Test Post',
      content: 'Post content',
      password: 'secret123'
    }, { type: 'posts' })
    
    const insertedId = insertResult.data.id
    assert(insertedId, 'ID should be present in insert result')
    
    // Query for posts
    const queryResult = await api.query({}, { type: 'posts' })
    
    assert.equal(queryResult.data.length, 1)
    assert.equal(queryResult.data[0].id, insertedId)
    assert.equal(queryResult.data[0].attributes.password, undefined, 'Silent field should not be included')
    assert.equal(queryResult.data[0].attributes.title, 'Test Post')
  })
})