import { test } from 'node:test';
import assert from 'node:assert';
import { Api, Schema } from '../index.js';
import { ValidationPlugin } from '../plugins/validation.js';

// Simple storage plugin for testing field security without SQL complications
const TestStoragePlugin = {
  install(api) {
    const storage = new Map();
    let nextId = 1;
    
    api.implement('insert', async (context) => {
      const id = nextId++;
      const record = { id, ...context.data };
      storage.set(`${context.options.type}:${id}`, record);
      return record;
    });
    
    api.implement('query', async (context) => {
      const results = [];
      const prefix = `${context.options.type}:`;
      
      for (const [key, value] of storage) {
        if (key.startsWith(prefix)) {
          results.push(value);
        }
      }
      
      return { results, meta: { total: results.length } };
    });
    
    api.implement('get', async (context) => {
      return storage.get(`${context.options.type}:${context.id}`);
    });
  }
};

test('Field Security Tests - Core Functionality', async (t) => {
  
  await t.test('prevents access to system fields starting with _ or $', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      name: { type: 'string' },
      _internal: { type: 'string' },
      $system: { type: 'string' }
    });
    
    api.addResource('items', schema);
    
    // Try to filter by system fields
    await assert.rejects(
      api.query({ filter: { _internal: 'secret' } }, { type: 'items' }),
      /Invalid or forbidden field in filter: _internal/
    );
    
    await assert.rejects(
      api.query({ filter: { $system: 'hidden' } }, { type: 'items' }),
      /Invalid or forbidden field in filter: \$system/
    );
    
    // Try to sort by system fields
    await assert.rejects(
      api.query({ sort: ['_internal'] }, { type: 'items' }),
      /Invalid or forbidden field in sort: _internal/
    );
    
    // Normal fields should work
    await assert.doesNotReject(
      api.query({ filter: { name: 'Test' } }, { type: 'items' })
    );
  });
  
  await t.test('prevents access to silent fields', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      username: { type: 'string' },
      password: { type: 'string', silent: true },
      apiKey: { type: 'string', silent: true }
    });
    
    api.addResource('users', schema);
    
    // Cannot filter by silent fields
    await assert.rejects(
      api.query({ filter: { password: 'secret123' } }, { type: 'users' }),
      /Invalid or forbidden field in filter: password/
    );
    
    await assert.rejects(
      api.query({ filter: { apiKey: 'key-123' } }, { type: 'users' }),
      /Invalid or forbidden field in filter: apiKey/
    );
    
    // Cannot sort by silent fields
    await assert.rejects(
      api.query({ sort: ['password'] }, { type: 'users' }),
      /Invalid or forbidden field in sort: password/
    );
    
    // Cannot select silent fields
    await assert.rejects(
      api.query({ fields: { users: ['username', 'password'] } }, { type: 'users' }),
      /Invalid or forbidden field in field selection: password/
    );
  });
  
  await t.test('prevents access to fields with permissions when user lacks them', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string' },
      publicNotes: { type: 'string' },
      internalNotes: { 
        type: 'string', 
        permission: 'posts.moderate' 
      }
    });
    
    api.addResource('posts', schema);
    
    // User without permissions
    const regularUser = {
      id: 1,
      can: (perm) => perm === 'posts.read'
    };
    
    // Cannot filter by permission-protected fields
    await assert.rejects(
      api.query({ filter: { internalNotes: 'Internal' } }, { type: 'posts', user: regularUser }),
      /Invalid or forbidden field in filter: internalNotes/
    );
    
    // User with moderate permission
    const moderator = {
      id: 2,
      can: (perm) => perm === 'posts.read' || perm === 'posts.moderate'
    };
    
    // Moderator can filter by internalNotes
    await assert.doesNotReject(
      api.query({ filter: { internalNotes: 'Internal only' } }, { type: 'posts', user: moderator })
    );
  });
  
  await t.test('validates fields that do not exist in schema', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string' },
      content: { type: 'string' }
    });
    
    api.addResource('articles', schema);
    
    // Try to filter by non-existent field
    await assert.rejects(
      api.query({ filter: { nonExistent: 'value' } }, { type: 'articles' }),
      /Invalid or forbidden field in filter: nonExistent/
    );
    
    // Try to sort by non-existent field
    await assert.rejects(
      api.query({ sort: ['nonExistent'] }, { type: 'articles' }),
      /Invalid or forbidden field in sort: nonExistent/
    );
    
    // Try to select non-existent field
    await assert.rejects(
      api.query({ fields: { articles: ['title', 'nonExistent'] } }, { type: 'articles' }),
      /Invalid or forbidden field in field selection: nonExistent/
    );
  });
  
  await t.test('allows virtual search fields marked with *', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string' },
      content: { type: 'string' }
    });
    
    api.addResource('posts', schema, {
      searchableFields: {
        title: 'title',
        search: '*',  // Virtual field
        smart: '*'    // Another virtual field
      }
    });
    
    // Virtual field 'search' should be allowed
    await assert.doesNotReject(
      api.query({ filter: { search: 'test' } }, { type: 'posts' })
    );
    
    // Virtual field 'smart' should be allowed
    await assert.doesNotReject(
      api.query({ filter: { smart: 'query' } }, { type: 'posts' })
    );
  });
  
  await t.test('validates sort field direction prefixes', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string' },
      priority: { type: 'integer' }
    });
    
    api.addResource('tasks', schema);
    
    // Valid sort with direction prefixes
    await assert.doesNotReject(
      api.query({ sort: ['+priority'] }, { type: 'tasks' })
    );
    
    await assert.doesNotReject(
      api.query({ sort: ['-priority'] }, { type: 'tasks' })
    );
    
    // Invalid field should still fail even with prefix
    await assert.rejects(
      api.query({ sort: ['-nonExistent'] }, { type: 'tasks' }),
      /Invalid or forbidden field in sort: nonExistent/
    );
  });
  
  await t.test('prevents prototype pollution attempts', async () => {
    const api = new Api();
    api.use(TestStoragePlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string' }
    });
    
    api.addResource('items', schema);
    
    // Try various prototype pollution attempts
    await assert.rejects(
      api.query({ filter: { '__proto__.isAdmin': true } }, { type: 'items' }),
      /Invalid or forbidden field in filter: __proto__.isAdmin/
    );
    
    await assert.rejects(
      api.query({ filter: { 'constructor.prototype.isAdmin': true } }, { type: 'items' }),
      /Invalid or forbidden field in filter: constructor.prototype.isAdmin/
    );
    
    await assert.rejects(
      api.query({ sort: ['__proto__'] }, { type: 'items' }),
      /Invalid or forbidden field in sort: __proto__/
    );
  });
  
});