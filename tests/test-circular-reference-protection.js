import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Api, Schema, MemoryPlugin } from '../index.js';

describe('Circular Reference Protection', () => {
  test('should reject circular references in data', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      title: { type: 'string' },
      metadata: { type: 'object' }
    });
    
    api.addResource('posts', schema);
    
    // Create circular reference
    const circularData = {
      title: 'Test',
      metadata: { nested: {} }
    };
    circularData.metadata.nested.circular = circularData;
    
    try {
      await api.insert(circularData, { type: 'posts' });
      assert.fail('Should have thrown error for circular reference');
    } catch (error) {
      assert.equal(error.message, 'Circular reference detected in request data');
      assert.equal(error.status, 400);
    }
  });
  
  test('should reject self-referencing objects', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      data: { type: 'object' }
    });
    
    api.addResource('items', schema);
    
    // Self-reference
    const selfRef = { name: 'test' };
    selfRef.self = selfRef;
    
    try {
      await api.insert({ data: selfRef }, { type: 'items' });
      assert.fail('Should have thrown error for self-reference');
    } catch (error) {
      assert.equal(error.message, 'Circular reference detected in request data');
    }
  });
  
  test('should reject deeply nested objects exceeding max depth', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      data: { type: 'object' }
    });
    
    api.addResource('items', schema);
    
    // Create deeply nested object (101 levels)
    let deepObject = {};
    let current = deepObject;
    for (let i = 0; i < 101; i++) {
      current.nested = {};
      current = current.nested;
    }
    current.value = 'deep';
    
    try {
      await api.insert({ data: deepObject }, { type: 'items' });
      assert.fail('Should have thrown error for deep nesting');
    } catch (error) {
      assert(error.message.includes('Object nesting exceeds maximum depth'));
      assert.equal(error.status, 400);
    }
  });
  
  test('should accept objects up to max depth', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      data: { type: 'object' }
    });
    
    api.addResource('items', schema);
    
    // Create nested object (99 levels - just under limit)
    let deepObject = {};
    let current = deepObject;
    for (let i = 0; i < 99; i++) {
      current.nested = {};
      current = current.nested;
    }
    current.value = 'not too deep';
    
    // Should not throw
    const result = await api.insert({ data: deepObject }, { type: 'items' });
    assert(result.data);
    assert(result.data.id);
  });
  
  test('should handle complex but non-circular structures', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      data: { type: 'object' }
    });
    
    api.addResource('items', schema);
    
    // Complex structure with shared references (not circular)
    const shared = { shared: true };
    const complexData = {
      a: shared,
      b: shared,
      c: {
        d: shared,
        e: {
          f: shared
        }
      }
    };
    
    // Should not throw - shared references are OK
    const result = await api.insert({ data: complexData }, { type: 'items' });
    assert(result.data);
    assert.equal(result.data.attributes.data.a.shared, true);
    assert.equal(result.data.attributes.data.b.shared, true);
  });
  
  test('should handle arrays with circular references', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      tags: { type: 'array' }
    });
    
    api.addResource('posts', schema);
    
    // Array with circular reference
    const arr = [{ name: 'tag1' }];
    arr[0].parent = arr;
    
    try {
      await api.insert({ tags: arr }, { type: 'posts' });
      assert.fail('Should have thrown error for circular reference in array');
    } catch (error) {
      assert.equal(error.message, 'Circular reference detected in request data');
    }
  });
  
  test('should remove prototype pollution attempts', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    
    const schema = new Schema({
      data: { type: 'object' }
    });
    
    api.addResource('items', schema);
    
    // Note: __proto__ as a string key is different from the actual __proto__ property
    const maliciousData = {
      data: {
        normal: 'value'
      }
    };
    // Try to add dangerous properties
    maliciousData.data['__proto__'] = { isAdmin: true };
    maliciousData.data['constructor'] = { prototype: { isAdmin: true } };
    maliciousData.data['prototype'] = { isAdmin: true };
    
    const result = await api.insert(maliciousData, { type: 'items' });
    
    // Check that data was saved correctly
    const saved = result.data.attributes.data;
    assert.equal(saved.normal, 'value');
    
    // Verify dangerous keys were not saved
    const savedKeys = Object.keys(saved);
    assert(!savedKeys.includes('__proto__'), '__proto__ should not be in keys');
    assert(!savedKeys.includes('constructor'), 'constructor should not be in keys');
    assert(!savedKeys.includes('prototype'), 'prototype should not be in keys');
    
    // Most importantly, verify prototype wasn't polluted
    assert.equal(({}).isAdmin, undefined, 'Prototype should not be polluted');
    assert.equal(Object.prototype.isAdmin, undefined, 'Object prototype should not be polluted');
  });
});