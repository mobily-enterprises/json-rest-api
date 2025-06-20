import { test } from 'node:test';
import assert from 'node:assert';
import { Api } from '../lib/api.js';
import { Schema } from '../lib/schema.js';
import { MemoryPlugin } from '../plugins/memory.js';
import { AuthorizationPlugin } from '../plugins/authorization.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

test('AuthorizationPlugin', async (t) => {
  
  await t.test('Basic Setup and Role Definition', async (t) => {
    await t.test('should install plugin and define roles', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          admin: {
            permissions: '*',
            description: 'Full access'
          },
          editor: {
            permissions: ['posts.*', 'users.read'],
            description: 'Content editor'
          },
          user: {
            permissions: ['posts.read', 'posts.create', 'posts.update.own'],
            description: 'Basic user'
          }
        }
      });
      
      // Check roles are defined
      assert(api._auth.roles.has('admin'));
      assert(api._auth.roles.has('editor'));
      assert(api._auth.roles.has('user'));
      
      const adminRole = api._auth.roles.get('admin');
      assert.deepStrictEqual(adminRole.permissions, ['*']);
    });
    
    await t.test('should define roles programmatically', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin);
      
      api.defineRole('moderator', {
        permissions: ['posts.read', 'posts.update', 'comments.*'],
        description: 'Content moderator'
      });
      
      assert(api._auth.roles.has('moderator'));
      const role = api._auth.roles.get('moderator');
      assert(role.permissions.includes('comments.*'));
    });
  });
  
  await t.test('User Enhancement', async (t) => {
    await t.test('should enhance user with roles from enhancer function', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        enhanceUser: async (user) => {
          // Simulate loading roles from database
          return {
            ...user,
            roles: ['editor'],
            permissions: ['special.permission']
          };
        },
        roles: {
          editor: { permissions: ['posts.*'] }
        }
      });
      
      const enhanced = await api.enhanceUserForAuth({ id: 1, name: 'John' });
      
      assert.deepStrictEqual(enhanced.roles, ['editor']);
      assert.deepStrictEqual(enhanced.permissions, ['special.permission']);
      assert(enhanced.can('posts.create'));
      assert(enhanced.can('special.permission'));
      assert(enhanced.hasRole('editor'));
      assert(!enhanced.hasRole('admin'));
    });
    
    await t.test('should add default role if user has no roles', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        defaultRole: 'guest',
        roles: {
          guest: { permissions: ['posts.read'] }
        }
      });
      
      const enhanced = await api.enhanceUserForAuth({ id: 1 });
      assert.deepStrictEqual(enhanced.roles, ['guest']);
      assert(enhanced.can('posts.read'));
      assert(!enhanced.can('posts.create'));
    });
  });
  
  await t.test('Permission Checking', async (t) => {
    await t.test('should check exact permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          user: { permissions: ['posts.read', 'posts.create'] }
        }
      });
      
      const user = await api.enhanceUserForAuth({
        id: 1,
        roles: ['user']
      });
      
      assert(user.can('posts.read'));
      assert(user.can('posts.create'));
      assert(!user.can('posts.delete'));
    });
    
    await t.test('should handle wildcard permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          editor: { permissions: ['posts.*', 'media.upload'] }
        }
      });
      
      const user = await api.enhanceUserForAuth({
        id: 1,
        roles: ['editor']
      });
      
      assert(user.can('posts.read'));
      assert(user.can('posts.create'));
      assert(user.can('posts.update'));
      assert(user.can('posts.delete'));
      assert(user.can('media.upload'));
      assert(!user.can('media.delete'));
      assert(!user.can('users.read'));
    });
    
    await t.test('should handle super admin with * permission', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        superAdminRole: 'admin',
        roles: {
          admin: { permissions: '*' }
        }
      });
      
      const user = await api.enhanceUserForAuth({
        id: 1,
        roles: ['admin']
      });
      
      assert(user.can('anything.at.all'));
      assert(user.can('posts.read'));
      assert(user.can('nuclear.launch.codes'));
    });
  });
  
  await t.test('Resource Authorization', async (t) => {
    await t.test('should enforce basic CRUD permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          reader: { permissions: ['posts.read'] },
          writer: { permissions: ['posts.read', 'posts.create', 'posts.update'] }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true },
        content: { type: 'string' }
      });
      
      api.addResource('posts', postSchema);
      
      // Reader can read
      const reader = { id: 1, roles: ['reader'] };
      const result = await api.query({}, { type: 'posts', user: reader });
      assert(Array.isArray(result.data));
      
      // Reader cannot create
      await assert.rejects(
        api.insert({ title: 'Test' }, { type: 'posts', user: reader }),
        ForbiddenError
      );
      
      // Writer can create
      const writer = { id: 2, roles: ['writer'] };
      const created = await api.insert(
        { title: 'Test' }, 
        { type: 'posts', user: writer }
      );
      assert(created.data.attributes.title === 'Test');
    });
    
    await t.test('should handle public operations', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        resources: {
          posts: {
            public: ['read']
          }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true }
      });
      
      api.addResource('posts', postSchema);
      
      // Create a post (will fail without auth)
      await assert.rejects(
        api.insert({ title: 'Test' }, { type: 'posts' }),
        UnauthorizedError
      );
      
      // Create with auth
      const admin = { id: 1, permissions: ['posts.create'] };
      await api.insert({ title: 'Test' }, { type: 'posts', user: admin });
      
      // Anyone can read (no user required)
      const posts = await api.query({}, { type: 'posts' });
      assert(posts.data.length === 1);
    });
    
    await t.test('should handle ownership-based permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          user: { permissions: ['posts.create', 'posts.read', 'posts.update.own'] }
        },
        resources: {
          posts: {
            ownerField: 'authorId',
            owner: ['update']
          }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true },
        authorId: { type: 'integer' }
      });
      
      api.addResource('posts', postSchema);
      
      const user1 = { id: 1, roles: ['user'] };
      const user2 = { id: 2, roles: ['user'] };
      
      // User 1 creates a post
      const post = await api.insert(
        { title: 'My Post', authorId: 1 },
        { type: 'posts', user: user1 }
      );
      
      // User 1 can update their own post
      const updated = await api.update(
        post.data.id,
        { title: 'Updated' },
        { type: 'posts', user: user1 }
      );
      assert(updated.data.attributes.title === 'Updated');
      
      // User 2 cannot update user 1's post
      await assert.rejects(
        api.update(
          post.data.id,
          { title: 'Hacked' },
          { type: 'posts', user: user2 }
        ),
        ForbiddenError
      );
    });
    
    await t.test('should handle authenticated-only operations', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        resources: {
          comments: {
            public: ['read'],
            authenticated: ['create']
          }
        }
      });
      
      const commentSchema = new Schema({
        text: { type: 'string', required: true }
      });
      
      api.addResource('comments', commentSchema);
      
      // Anyone can read
      const comments = await api.query({}, { type: 'comments' });
      assert(Array.isArray(comments.data));
      
      // Cannot create without auth
      await assert.rejects(
        api.insert({ text: 'Hello' }, { type: 'comments' }),
        UnauthorizedError
      );
      
      // Any authenticated user can create
      const user = { id: 1, roles: [] }; // No specific permissions needed
      const created = await api.insert(
        { text: 'Hello' },
        { type: 'comments', user }
      );
      assert(created.data.attributes.text === 'Hello');
    });
  });
  
  await t.test('Field-Level Permissions', async (t) => {
    await t.test('should hide fields based on permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          user: { permissions: ['posts.read'] },
          admin: { permissions: ['posts.read', 'posts.sensitive'] }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true },
        public: { type: 'string' },
        internalNotes: { type: 'string', permission: 'posts.sensitive' }
      });
      
      api.addResource('posts', postSchema);
      
      // Admin creates post with sensitive data
      const admin = { id: 1, roles: ['admin'] };
      const post = await api.insert(
        { title: 'Test', public: 'Public info', internalNotes: 'Secret!' },
        { type: 'posts', user: admin }
      );
      
      // Admin can see everything
      const adminView = await api.get(post.data.id, { type: 'posts', user: admin });
      assert(adminView.data.attributes.internalNotes === 'Secret!');
      
      // Regular user cannot see sensitive fields
      const user = { id: 2, roles: ['user'] };
      const userView = await api.get(post.data.id, { type: 'posts', user });
      assert(userView.data.attributes.title === 'Test');
      assert(userView.data.attributes.public === 'Public info');
      assert(!('internalNotes' in userView.data.attributes));
    });
  });
  
  await t.test('Complex Scenarios', async (t) => {
    await t.test('should handle multiple roles with overlapping permissions', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        roles: {
          author: { permissions: ['posts.create', 'posts.read', 'posts.update.own'] },
          moderator: { permissions: ['posts.read', 'posts.update', 'posts.delete'] }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true },
        userId: { type: 'integer' }
      });
      
      api.addResource('posts', postSchema);
      
      // User with both roles
      const user = { id: 1, roles: ['author', 'moderator'] };
      
      // Can create (from author role)
      const post = await api.insert(
        { title: 'Test', userId: 1 },
        { type: 'posts', user }
      );
      
      // Can update any post (from moderator role)
      const otherPost = await api.insert(
        { title: 'Other', userId: 2 },
        { type: 'posts', user: { id: 2, permissions: ['posts.create'] } }
      );
      
      const updated = await api.update(
        otherPost.data.id,
        { title: 'Moderated' },
        { type: 'posts', user }
      );
      assert(updated.data.attributes.title === 'Moderated');
      
      // Can delete (from moderator role)
      await api.delete(otherPost.data.id, { type: 'posts', user });
    });
    
    await t.test('should integrate with HTTP requests', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin, {
        enhanceUser: async (user) => ({
          ...user,
          roles: user.isAdmin ? ['admin'] : ['user']
        }),
        roles: {
          admin: { permissions: '*' },
          user: { permissions: ['posts.read'] }
        }
      });
      
      const postSchema = new Schema({
        title: { type: 'string', required: true }
      });
      
      api.addResource('posts', postSchema);
      
      // Simulate HTTP context
      const adminContext = {
        options: {
          type: 'posts',
          user: { id: 1, isAdmin: true }
        },
        data: { title: 'Admin Post' }
      };
      
      // Run through hooks manually (simulating what HTTP plugin would do)
      await api.executeHook('beforeOperation', adminContext);
      
      // User should be enhanced
      assert(adminContext.options.user._enhanced);
      assert(adminContext.options.user.can('posts.create'));
    });
  });
  
  await t.test('Role Helper Methods', async (t) => {
    await t.test('should provide convenient role checking methods', async () => {
      const api = new Api();
      api.use(MemoryPlugin);
      api.use(AuthorizationPlugin);
      
      const user = await api.enhanceUserForAuth({
        id: 1,
        roles: ['editor', 'reviewer']
      });
      
      assert(user.hasRole('editor'));
      assert(!user.hasRole('admin'));
      assert(user.hasAnyRole('admin', 'editor', 'user'));
      assert(!user.hasAnyRole('admin', 'user'));
      assert(user.hasAllRoles('editor', 'reviewer'));
      assert(!user.hasAllRoles('editor', 'admin'));
    });
  });
});

// Run tests
if (import.meta.url.startsWith('file:')) {
  const modulePath = new URL(import.meta.url).pathname;
  if (process.argv[1] === modulePath) {
    test.run();
  }
}