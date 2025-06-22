import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Api } from '../../lib/api.js';
import { Schema } from '../../lib/schema.js';
import { MemoryPlugin } from '../../plugins/memory.js';
import { AuthorizationPlugin } from '../../plugins/authorization.js';

test.beforeEach(async () => {
  const api = new Api();
  api.use(MemoryPlugin);
  
  // Configure authorization
  api.use(AuthorizationPlugin, {
    roles: {
      admin: ['*'],
      user: ['posts.read', 'posts.create']
    },
    resources: {
      posts: {
        owner: ['update', 'delete'],
        authenticated: ['create'],
        public: ['read']
      },
      secrets: {
        permissions: {
          read: 'admin',
          create: 'admin',
          update: 'admin',
          delete: 'admin'
        }
      }
    }
  });
  
  api.addResource('posts', new Schema({
    title: { type: 'string', required: true },
    content: { type: 'string' },
    userId: { type: 'id' }
  }));
  
  api.addResource('secrets', new Schema({
    data: { type: 'string', required: true }
  }));
  
  globalThis.api = api;
});

test('Auth bypass: _skipAuth without _internal flag is blocked', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create a secret as admin
  const adminUser = { id: 1, roles: ['admin'] };
  const secret = await api.insert(
    { data: 'Top secret' },
    { type: 'secrets', user: adminUser }
  );
  
  // Try to access with _skipAuth but no _internal
  const regularUser = { id: 2, roles: ['user'] };
  
  // Should still check auth and fail
  await assert.rejects(
    api.get(secret.id, { 
      type: 'secrets', 
      user: regularUser,
      _skipAuth: true  // No _internal flag
    }),
    { message: /Permission denied/ }
  );
});

test('Auth bypass: _internal flag requires genuine internal call', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create a post
  const user = { id: 1, roles: ['user'] };
  const post = await api.insert(
    { title: 'My post', userId: 1 },
    { type: 'posts', user }
  );
  
  // Simulate authorization check with internal flag
  // This should only work from within the authorization plugin itself
  const result = await api.get(post.id, {
    type: 'posts',
    _skipAuth: true,
    _internal: true
  });
  
  // Should succeed with both flags
  assert.equal(result.title, 'My post');
});

test('Auth bypass: suspicious attempts are logged', async () => {
  
  const logs = [];
  
  // Capture console.warn
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args);
  
  try {
    // Create a secret as admin
    const adminUser = { id: 1, roles: ['admin'] };
    const secret = await api.insert(
      { data: 'Top secret' },
      { type: 'secrets', user: adminUser }
    );
    
    // Try to bypass with _skipAuth
    const attackerUser = { id: 999, roles: [] };
    
    await assert.rejects(
      api.get(secret.id, {
        type: 'secrets',
        user: attackerUser,
        _skipAuth: true,
        request: { ip: '192.168.1.100' }
      })
    );
    
    // Check that warning was logged
    assert.equal(logs.length > 0, true);
    const warning = logs[0][0];
    assert.match(warning, /Suspicious auth bypass attempt/);
    assert.match(warning, /secrets\.read/);
    assert.match(warning, /999/); // user id
    assert.match(warning, /192\.168\.1\.100/); // IP
  } finally {
    console.warn = originalWarn;
  }
});

test('Auth bypass: cannot bypass field-level permissions', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Add resource with field permissions
  api.addResource('profiles', new Schema({
    name: { type: 'string' },
    email: { 
      type: 'string',
      permission: 'profiles.read.email'
    },
    ssn: {
      type: 'string',
      permission: 'admin'
    }
  }));
  
  // Create profile as admin
  const adminUser = { id: 1, roles: ['admin'] };
  const profile = await api.insert({
    name: 'John Doe',
    email: 'john@example.com',
    ssn: '123-45-6789'
  }, { type: 'profiles', user: adminUser });
  
  // Try to read with limited user and _skipAuth
  const limitedUser = { id: 2, roles: ['user'] };
  
  // Even with _skipAuth, field permissions should apply
  const result = await api.get(profile.id, {
    type: 'profiles',
    user: limitedUser,
    _skipAuth: true,
    _internal: true
  });
  
  // Should get the record but sensitive fields filtered
  assert.equal(result.name, 'John Doe');
  assert.equal(result.email, undefined); // No permission
  assert.equal(result.ssn, undefined); // Admin only
});

test('Auth bypass: ownership checks cannot be bypassed', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // User 1 creates a post
  const user1 = { id: 1, roles: ['user'], permissions: ['posts.update.own'] };
  const post = await api.insert({
    title: 'User 1 post',
    userId: 1
  }, { type: 'posts', user: user1 });
  
  // User 2 tries to update with _skipAuth
  const user2 = { 
    id: 2, 
    roles: ['user'], 
    permissions: ['posts.update.own'],
    can: (perm) => perm === 'posts.update.own'
  };
  
  // Should still check ownership
  await assert.rejects(
    api.update(post.id, 
      { title: 'Hacked!' },
      { 
        type: 'posts', 
        user: user2,
        _skipAuth: true  // No _internal
      }
    ),
    { message: /Permission denied/ }
  );
  
  // Verify post wasn't changed
  const unchanged = await api.get(post.id, { type: 'posts', user: user1 });
  assert.equal(unchanged.title, 'User 1 post');
});

test('Auth bypass: query operations check auth', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Create secrets as admin
  const adminUser = { id: 1, roles: ['admin'] };
  await api.insert({ data: 'Secret 1' }, { type: 'secrets', user: adminUser });
  await api.insert({ data: 'Secret 2' }, { type: 'secrets', user: adminUser });
  
  // Try to query with regular user
  const regularUser = { id: 2, roles: ['user'] };
  
  // Should fail even with _skipAuth (no _internal)
  await assert.rejects(
    api.query({}, { 
      type: 'secrets', 
      user: regularUser,
      _skipAuth: true
    }),
    { message: /Permission denied/ }
  );
});

test('Auth bypass: delete operations check auth', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // User 1 creates a post
  const user1 = { 
    id: 1, 
    roles: ['user'],
    permissions: ['posts.delete.own'],
    can: (perm) => perm === 'posts.delete.own'
  };
  const post = await api.insert({
    title: 'My post',
    userId: 1
  }, { type: 'posts', user: user1 });
  
  // User 2 tries to delete
  const user2 = { 
    id: 2, 
    roles: ['user'],
    permissions: ['posts.delete.own'],
    can: (perm) => perm === 'posts.delete.own'
  };
  
  // Should fail with _skipAuth but no ownership
  await assert.rejects(
    api.delete(post.id, {
      type: 'posts',
      user: user2,
      _skipAuth: true
    }),
    { message: /Permission denied/ }
  );
  
  // Post should still exist
  const exists = await api.get(post.id, { type: 'posts', user: user1 });
  assert.ok(exists);
});

test('Auth bypass: hooks still run with _internal flag', async () => {
  
  let hookRan = false;
  
  // Add a hook
  api.hook('beforeGet', async (context) => {
    if (context.options.type === 'posts') {
      hookRan = true;
    }
  });
  
  // Create a post
  const user = { id: 1, roles: ['user'] };
  const post = await api.insert({
    title: 'Test post'
  }, { type: 'posts', user });
  
  // Get with internal flags
  await api.get(post.id, {
    type: 'posts',
    _skipAuth: true,
    _internal: true
  });
  
  // Hook should have run
  assert.equal(hookRan, true);
});

test('Auth bypass: cannot bypass resource-level conditions', async () => {
  const api = globalThis.api;
  const logs = globalThis.logs;
  
  // Add conditional resource
  api.configureResourceAuth('conditional', {
    condition: async (context) => {
      // Only allow if special header is present
      return context.options.request?.headers?.['x-special'] === 'allowed';
    }
  });
  
  api.addResource('conditional', new Schema({
    data: { type: 'string' }
  }));
  
  // Try to access without meeting condition
  await assert.rejects(
    api.insert({ data: 'test' }, {
      type: 'conditional',
      _skipAuth: true,
      request: { headers: {} }
    })
  );
});