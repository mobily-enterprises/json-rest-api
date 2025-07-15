import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import knexLib from 'knex';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument, 
  createRelationship,
  resourceIdentifier,
  assertResourceAttributes
} from './helpers/test-utils.js';
import { createBasicApi } from './fixtures/api-configs.js';
import { JwtAuthPlugin } from '../plugins/core/jwt-auth-plugin.js';

const TEST_SECRET = 'test-secret-key';
const TEST_USER = {
  sub: '123',
  email: 'test@example.com',
  roles: ['user']
};

function createToken(payload, options = {}) {
  return jwt.sign(
    { 
      ...TEST_USER, 
      ...payload,
      jti: options.jti || `test-${Date.now()}`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (options.expiresIn || 3600)
    },
    TEST_SECRET,
    { algorithm: 'HS256' }
  );
}

describe('JWT Auth Plugin', () => {
  let knex;
  let api;
  
  before(async () => {
    knex = knexLib({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });
  });
  
  after(async () => {
    await knex.destroy();
  });
  
  describe('Basic JWT Authentication', () => {
    beforeEach(async () => {
      // Create fresh API instance
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET,
          revocation: {
            enabled: true,
            storage: 'database'
          },
          endpoints: {
            logout: '/auth/logout',
            session: '/auth/session'
          }
        }
      });
      
      // Install JWT auth plugin
      await api.use(JwtAuthPlugin);
      
      // Clean tables
      await cleanTables(knex, ['revoked_tokens']);
    });
    
    it('should populate context.auth for valid tokens', async () => {
      const token = createToken();
      
      // Create a mock context
      const context = {
        request: { token },
        auth: null
      };
      
      // Run hooks manually
      const hooks = api.getHooks('transport:request');
      const authHook = hooks.find(h => h.name === 'jwt-populate-auth');
      await authHook.handler({ context, runHooks: async () => {} });
      
      assert.equal(context.auth.userId, '123');
      assert.equal(context.auth.email, 'test@example.com');
      assert.deepEqual(context.auth.roles, ['user']);
    });
    
    it('should not populate context.auth for expired tokens', async () => {
      const token = createToken({}, { expiresIn: -1 }); // Already expired
      
      const context = {
        request: { token },
        auth: null
      };
      
      const hooks = api.getHooks('transport:request');
      const authHook = hooks.find(h => h.name === 'jwt-populate-auth');
      await authHook.handler({ context, runHooks: async () => {} });
      
      assert.equal(context.auth, null);
    });
    
    it('should not populate context.auth for invalid signatures', async () => {
      const token = jwt.sign(TEST_USER, 'wrong-secret');
      
      const context = {
        request: { token },
        auth: null
      };
      
      const hooks = api.getHooks('transport:request');
      const authHook = hooks.find(h => h.name === 'jwt-populate-auth');
      await authHook.handler({ context, runHooks: async () => {} });
      
      assert.equal(context.auth, null);
    });
    
    it('should allow requests without tokens', async () => {
      const context = {
        request: { token: null },
        auth: null
      };
      
      const hooks = api.getHooks('transport:request');
      const authHook = hooks.find(h => h.name === 'jwt-populate-auth');
      const result = await authHook.handler({ context, runHooks: async () => {} });
      
      assert.equal(result, true);
      assert.equal(context.auth, null);
    });
  });
  
  describe('Token Revocation', () => {
    beforeEach(async () => {
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET,
          revocation: {
            enabled: true,
            storage: 'database'
          }
        }
      });
      
      await api.use(JwtAuthPlugin);
      await cleanTables(knex, ['revoked_tokens']);
    });
    
    it('should revoke tokens on logout', async () => {
      const jti = 'test-token-123';
      const token = createToken({}, { jti });
      
      const context = {
        auth: {
          userId: '123',
          token: jwt.decode(token)
        }
      };
      
      // Logout using helper
      const result = await api.vars.helpers.auth.logout(context);
      assert.equal(result.success, true);
      
      // Check token is in revocation table
      const revokedTokens = await api.resources.revoked_tokens.query({ simplified: true });
      assert.equal(revokedTokens.length, 1);
      assert.equal(revokedTokens[0].jti, jti);
      assert.equal(revokedTokens[0].user_id, '123');
    });
    
    it('should not populate auth for revoked tokens', async () => {
      const jti = 'test-token-456';
      const token = createToken({}, { jti });
      
      // Revoke the token
      await api.vars.helpers.auth.revokeToken(jti, '123', Math.floor(Date.now() / 1000) + 3600);
      
      // Try to use it
      const context = {
        request: { token },
        auth: null
      };
      
      const hooks = api.getHooks('transport:request');
      const authHook = hooks.find(h => h.name === 'jwt-populate-auth');
      await authHook.handler({ context, runHooks: async () => {} });
      
      assert.equal(context.auth, null);
    });
  });
  
  describe('Declarative Auth System', () => {
    let countryId;
    let userId = '123';
    let adminId = '456';
    
    beforeEach(async () => {
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET,
          ownershipField: 'user_id'
        }
      });
      
      await api.use(JwtAuthPlugin);
      
      // Add resource with declarative auth
      await api.addResource('posts', {
        schema: {
          id: { type: 'id' },
          title: { type: 'string', required: true },
          content: { type: 'text' },
          user_id: { type: 'string' },
          published: { type: 'boolean', default: false }
        },
        auth: {
          query: ['public'],
          get: ['public'],
          post: ['authenticated'],
          patch: ['is_owner', 'has_role:editor', 'admin'],
          delete: ['is_owner', 'admin']
        }
      });
      
      await api.resources.posts.createKnexTable();
      
      await cleanTables(knex, ['basic_countries', 'posts']);
      
      // Create test data
      const countryDoc = createJsonApiDocument('countries', { name: 'USA', code: 'US' });
      const countryResult = await api.resources.countries.post({
        inputRecord: countryDoc,
        simplified: false
      });
      countryId = countryResult.data.id;
    });
    
    it('should allow public access to query', async () => {
      // Create a post first
      const postDoc = createJsonApiDocument('posts', {
        title: 'Test Post',
        content: 'Test content',
        user_id: userId,
        published: true
      });
      
      // Need auth to create
      const authContext = {
        auth: { userId }
      };
      
      await assert.doesNotReject(async () => {
        await api.resources.posts.post({
          inputRecord: postDoc,
          context: authContext,
          simplified: false
        });
      });
      
      // But can query without auth
      const publicContext = { auth: null };
      
      await assert.doesNotReject(async () => {
        const posts = await api.resources.posts.query({
          context: publicContext,
          simplified: false
        });
        validateJsonApiStructure(posts, true);
      });
    });
    
    it('should require authentication for post creation', async () => {
      const postDoc = createJsonApiDocument('posts', {
        title: 'Test Post',
        content: 'Test content'
      });
      
      // No auth context
      const context = { auth: null };
      
      await assert.rejects(
        async () => {
          await api.resources.posts.post({
            inputRecord: postDoc,
            context,
            simplified: false
          });
        },
        /Access denied.*Required one of: authenticated/
      );
    });
    
    it('should allow owner to update their post', async () => {
      // Create post as user
      const postDoc = createJsonApiDocument('posts', {
        title: 'My Post',
        content: 'My content',
        user_id: userId
      });
      
      const createContext = { auth: { userId } };
      const postResult = await api.resources.posts.post({
        inputRecord: postDoc,
        context: createContext,
        simplified: false
      });
      const postId = postResult.data.id;
      
      // Update as owner
      const updateDoc = createJsonApiDocument('posts', {
        title: 'Updated Post'
      });
      updateDoc.data.id = postId;
      
      await assert.doesNotReject(async () => {
        await api.resources.posts.patch({
          id: postId,
          inputRecord: updateDoc,
          context: createContext,
          simplified: false
        });
      });
    });
    
    it('should allow editor role to update any post', async () => {
      // Create post as user
      const postDoc = createJsonApiDocument('posts', {
        title: 'User Post',
        content: 'User content',
        user_id: userId
      });
      
      const userContext = { auth: { userId } };
      const postResult = await api.resources.posts.post({
        inputRecord: postDoc,
        context: userContext,
        simplified: false
      });
      const postId = postResult.data.id;
      
      // Update as editor (different user)
      const updateDoc = createJsonApiDocument('posts', {
        title: 'Editor Updated'
      });
      updateDoc.data.id = postId;
      
      const editorContext = {
        auth: {
          userId: 'editor-789',
          roles: ['editor']
        }
      };
      
      await assert.doesNotReject(async () => {
        await api.resources.posts.patch({
          id: postId,
          inputRecord: updateDoc,
          context: editorContext,
          simplified: false
        });
      });
    });
    
    it('should allow admin to do anything', async () => {
      // Create post as user
      const postDoc = createJsonApiDocument('posts', {
        title: 'User Post',
        content: 'User content',
        user_id: userId
      });
      
      const userContext = { auth: { userId } };
      const postResult = await api.resources.posts.post({
        inputRecord: postDoc,
        context: userContext,
        simplified: false
      });
      const postId = postResult.data.id;
      
      // Admin can update
      const updateDoc = createJsonApiDocument('posts', {
        title: 'Admin Updated'
      });
      updateDoc.data.id = postId;
      
      const adminContext = {
        auth: {
          userId: adminId,
          roles: ['admin']
        }
      };
      
      await assert.doesNotReject(async () => {
        await api.resources.posts.patch({
          id: postId,
          inputRecord: updateDoc,
          context: adminContext,
          simplified: false
        });
      });
      
      // Admin can delete
      await assert.doesNotReject(async () => {
        await api.resources.posts.delete({
          id: postId,
          context: adminContext,
          simplified: false
        });
      });
    });
    
    it('should deny non-owner non-admin from updating', async () => {
      // Create post as user
      const postDoc = createJsonApiDocument('posts', {
        title: 'User Post',
        content: 'User content',
        user_id: userId
      });
      
      const userContext = { auth: { userId } };
      const postResult = await api.resources.posts.post({
        inputRecord: postDoc,
        context: userContext,
        simplified: false
      });
      const postId = postResult.data.id;
      
      // Try to update as different user without special roles
      const updateDoc = createJsonApiDocument('posts', {
        title: 'Hacker Updated'
      });
      updateDoc.data.id = postId;
      
      const otherUserContext = {
        auth: {
          userId: 'other-999',
          roles: ['user']
        }
      };
      
      await assert.rejects(
        async () => {
          await api.resources.posts.patch({
            id: postId,
            inputRecord: updateDoc,
            context: otherUserContext,
            simplified: false
          });
        },
        /Access denied.*Required one of: is_owner, has_role:editor, admin/
      );
    });
  });
  
  describe('Auth Helpers', () => {
    beforeEach(async () => {
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET
        }
      });
      
      await api.use(JwtAuthPlugin);
    });
    
    it('should check authentication with requireAuth', () => {
      const helpers = api.vars.helpers;
      
      // Not authenticated
      assert.throws(() => {
        helpers.auth.requireAuth({ auth: null });
      }, /Authentication required/);
      
      // Authenticated
      const auth = helpers.auth.requireAuth({ 
        auth: { userId: '123' } 
      });
      assert.equal(auth.userId, '123');
    });
    
    it('should check roles with requireRoles', () => {
      const helpers = api.vars.helpers;
      const context = {
        auth: {
          userId: '123',
          roles: ['user', 'editor']
        }
      };
      
      // Has required role
      assert.doesNotThrow(() => {
        helpers.auth.requireRoles(context, ['editor']);
      });
      
      // Missing required role
      assert.throws(() => {
        helpers.auth.requireRoles(context, ['admin']);
      }, /Required role/);
      
      // At least one role matches
      assert.doesNotThrow(() => {
        helpers.auth.requireRoles(context, ['admin', 'editor']);
      });
    });
    
    it('should check ownership with various inputs', () => {
      const helpers = api.vars.helpers;
      const context = {
        auth: {
          userId: '123',
          roles: ['user']
        }
      };
      
      // With direct user ID
      assert.doesNotThrow(() => {
        helpers.auth.requireOwnership(context, '123');
      });
      
      assert.throws(() => {
        helpers.auth.requireOwnership(context, '456');
      }, /Access denied/);
      
      // With record object
      const ownedRecord = { id: '1', user_id: '123', title: 'My Post' };
      assert.doesNotThrow(() => {
        helpers.auth.requireOwnership(context, ownedRecord);
      });
      
      const otherRecord = { id: '2', user_id: '456', title: 'Other Post' };
      assert.throws(() => {
        helpers.auth.requireOwnership(context, otherRecord);
      }, /Access denied/);
      
      // Admin can access any resource
      const adminContext = {
        auth: {
          userId: '999',
          roles: ['admin']
        }
      };
      assert.doesNotThrow(() => {
        helpers.auth.requireOwnership(adminContext, otherRecord);
      });
    });
  });
  
  describe('Custom Auth Checkers', () => {
    beforeEach(async () => {
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET
        }
      });
      
      await api.use(JwtAuthPlugin);
    });
    
    it('should allow registering custom auth checkers', async () => {
      const helpers = api.vars.helpers;
      
      // Register custom checker
      helpers.auth.registerChecker('is_moderator', (context) => {
        return context.auth?.roles?.includes('moderator');
      });
      
      // Add resource using custom checker
      await api.addResource('moderated_posts', {
        schema: {
          id: { type: 'id' },
          title: { type: 'string', required: true },
          flagged: { type: 'boolean', default: false }
        },
        auth: {
          query: ['public'],
          patch: ['is_moderator']
        }
      });
      
      await api.resources.moderated_posts.createKnexTable();
      
      // Create a post
      const postDoc = createJsonApiDocument('moderated_posts', {
        title: 'Test Post',
        flagged: true
      });
      
      const createContext = { auth: { userId: '123' } };
      const postResult = await api.resources.moderated_posts.post({
        inputRecord: postDoc,
        context: createContext,
        simplified: false
      });
      const postId = postResult.data.id;
      
      // Try to update without moderator role
      const updateDoc = createJsonApiDocument('moderated_posts', {
        flagged: false
      });
      updateDoc.data.id = postId;
      
      await assert.rejects(
        async () => {
          await api.resources.moderated_posts.patch({
            id: postId,
            inputRecord: updateDoc,
            context: { auth: { userId: '123', roles: ['user'] } },
            simplified: false
          });
        },
        /Access denied.*Required one of: is_moderator/
      );
      
      // Update with moderator role should work
      await assert.doesNotReject(async () => {
        await api.resources.moderated_posts.patch({
          id: postId,
          inputRecord: updateDoc,
          context: { auth: { userId: '456', roles: ['moderator'] } },
          simplified: false
        });
      });
    });
  });
});