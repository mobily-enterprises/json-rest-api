import { test } from 'node:test';
import assert from 'node:assert';
import { Api, Schema } from '../../index.js';
import { MemoryPlugin } from '../../plugins/core/memory.js';
import { ValidationPlugin } from '../../plugins/core/validation.js';
import { AuthorizationPlugin } from '../../plugins/core-extra/authorization.js';

test('Field Security Tests', async (t) => {
  
  await t.test('prevents access to system fields starting with _ or $', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      name: { type: 'string', searchable: true },
      _internal: { type: 'string', searchable: true },
      systemField: { type: 'string', searchable: true } // Use systemField instead of $system for AlaSQL compatibility
    });
    
    api.addResource('items', schema);
    
    // Create test data
    await api.insert({ name: 'Test' }, { type: 'items' });
    
    // Try to filter by system fields
    await assert.rejects(
      api.query({ filter: { _internal: 'secret' } }, { type: 'items' }),
      /Invalid or forbidden field in filter: _internal/
    );
    
    // Test $ prefix validation at the query level (not schema level due to AlaSQL)
    await assert.rejects(
      api.query({ filter: { '$system': 'hidden' } }, { type: 'items' }),
      /Invalid or forbidden field in filter: \$system/
    );
    
    // Try to sort by system fields
    await assert.rejects(
      api.query({ sort: ['_internal'] }, { type: 'items' }),
      /Invalid or forbidden field in sort: _internal/
    );
    
    // Normal fields should work
    const result = await api.query({ filter: { name: 'Test' } }, { type: 'items' });
    assert.strictEqual(result.data.length, 1);
  });
  
  await t.test('prevents access to silent fields', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      username: { type: 'string', searchable: true },
      password: { type: 'string', silent: true, searchable: true },
      apiKey: { type: 'string', silent: true, searchable: true }
    });
    
    api.addResource('users', schema);
    
    await api.insert({ 
      username: 'john', 
      password: 'secret123',
      apiKey: 'key-123'
    }, { type: 'users' });
    
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
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    api.use(AuthorizationPlugin);
    
    const schema = new Schema({
      title: { type: 'string', searchable: true },
      publicNotes: { type: 'string', searchable: true },
      internalNotes: { 
        type: 'string', 
        permission: 'posts.moderate',
        searchable: true 
      },
      adminNotes: {
        type: 'string',
        permission: 'posts.admin',
        searchable: true
      }
    });
    
    api.addResource('posts', schema);
    
    // Insert with admin user to bypass auth
    const adminUser = { id: 999, can: () => true };
    await api.insert({ 
      title: 'Test Post',
      publicNotes: 'Public info',
      internalNotes: 'Internal only',
      adminNotes: 'Admin only'
    }, { type: 'posts', user: adminUser });
    
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
    
    // Moderator can filter by internalNotes but not adminNotes
    const result = await api.query({ 
      filter: { internalNotes: 'Internal only' } 
    }, { type: 'posts', user: moderator });
    assert.strictEqual(result.data.length, 1);
    
    await assert.rejects(
      api.query({ filter: { adminNotes: 'Admin' } }, { type: 'posts', user: moderator }),
      /Invalid or forbidden field in filter: adminNotes/
    );
  });
  
  await t.test('prevents path traversal through nested fields', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      profile: {
        type: 'object',
        searchable: true,
        structure: {
          name: { type: 'string', searchable: true },
          email: { type: 'string', searchable: true },
          password: { type: 'string', silent: true, searchable: true },
          _internal: { type: 'string', searchable: true }
        }
      }
    });
    
    api.addResource('accounts', schema, {
      searchableFields: {
        'profile.name': 'profile',
        'profile.email': 'profile',
        'profile.password': 'profile',
        'profile._internal': 'profile'
      }
    });
    
    await api.insert({ 
      profile: {
        name: 'John',
        email: 'john@example.com',
        password: 'secret',
        _internal: 'hidden'
      }
    }, { type: 'accounts' });
    
    // Valid nested field access
    const result = await api.query({ 
      filter: { 'profile.name': 'John' } 
    }, { type: 'accounts' });
    assert.strictEqual(result.data.length, 1);
    
    // Cannot access nested silent fields
    await assert.rejects(
      api.query({ filter: { 'profile.password': 'secret' } }, { type: 'accounts' }),
      /Invalid or forbidden field in filter: profile.password/
    );
    
    // Cannot access nested system fields
    await assert.rejects(
      api.query({ filter: { 'profile._internal': 'hidden' } }, { type: 'accounts' }),
      /Invalid or forbidden field in filter: profile._internal/
    );
  });
  
  await t.test('validates fields that do not exist in schema', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string', searchable: true },
      content: { type: 'string', searchable: true }
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
    api.use(MemoryPlugin);
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
    
    // Hook to handle virtual fields
    api.hook('beforeQuery', async (context) => {
      if (context.params.filter?.search) {
        // Transform virtual field to real fields
        const value = context.params.filter.search;
        delete context.params.filter.search;
        context.params.filter.or = [
          { title: { like: `%${value}%` } },
          { content: { like: `%${value}%` } }
        ];
      }
    });
    
    await api.insert({ 
      title: 'Test Post',
      content: 'This is test content'
    }, { type: 'posts' });
    
    // Virtual field 'search' should be allowed
    const result = await api.query({ 
      filter: { search: 'test' } 
    }, { type: 'posts' });
    
    assert.strictEqual(result.data.length, 1);
  });
  
  await t.test('handles complex nested paths safely', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      data: {
        type: 'object',
        structure: {
          level1: {
            type: 'object',
            structure: {
              level2: {
                type: 'object',
                structure: {
                  value: { type: 'string', searchable: true },
                  secret: { type: 'string', silent: true, searchable: true }
                }
              }
            }
          }
        }
      }
    });
    
    api.addResource('nested', schema, {
      searchableFields: {
        'data.level1.level2.value': 'data',
        'data.level1.level2.secret': 'data'
      }
    });
    
    await api.insert({
      data: {
        level1: {
          level2: {
            value: 'visible',
            secret: 'hidden'
          }
        }
      }
    }, { type: 'nested' });
    
    // Valid deep nested access
    const result = await api.query({
      filter: { 'data.level1.level2.value': 'visible' }
    }, { type: 'nested' });
    assert.strictEqual(result.data.length, 1);
    
    // Cannot access deep nested silent field
    await assert.rejects(
      api.query({ filter: { 'data.level1.level2.secret': 'hidden' } }, { type: 'nested' }),
      /Invalid or forbidden field in filter: data.level1.level2.secret/
    );
  });
  
  await t.test('validates sort field direction prefixes', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string', searchable: true },
      created: { type: 'datetime', searchable: true },
      priority: { type: 'integer', searchable: true }
    });
    
    api.addResource('tasks', schema);
    
    await api.insert({ title: 'Task 1', priority: 1 }, { type: 'tasks' });
    await api.insert({ title: 'Task 2', priority: 2 }, { type: 'tasks' });
    
    // Valid sort with direction prefixes
    const asc = await api.query({ sort: ['+priority'] }, { type: 'tasks' });
    assert.strictEqual(asc.data[0].attributes.priority, 1);
    
    const desc = await api.query({ sort: ['-priority'] }, { type: 'tasks' });
    assert.strictEqual(desc.data[0].attributes.priority, 2);
    
    // Invalid field should still fail even with prefix
    await assert.rejects(
      api.query({ sort: ['-nonExistent'] }, { type: 'tasks' }),
      /Invalid or forbidden field in sort: nonExistent/
    );
  });
  
  await t.test('prevents prototype pollution attempts', async () => {
    const api = new Api();
    api.use(MemoryPlugin);
    api.use(ValidationPlugin);
    
    const schema = new Schema({
      title: { type: 'string', searchable: true }
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