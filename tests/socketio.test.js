import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import knexLib from 'knex';
import { io as ioClient } from 'socket.io-client';
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
import { SocketIOPlugin } from '../plugins/core/socketio-plugin.js';
import { HttpPlugin } from '../plugins/core/connectors/http-plugin.js';

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

// Helper to wait for Socket.io event
function waitForSocketEvent(socket, eventName, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);
    
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Helper to create Socket.io client
function createSocketClient(port, auth = {}) {
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth
  });
}

describe('Socket.io Plugin', () => {
  let knex;
  let api;
  let httpServer;
  let ioServer;
  const socketPort = 3001;
  const httpPort = 3002;
  
  before(async () => {
    knex = knexLib({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });
  });
  
  after(async () => {
    if (ioServer) {
      await ioServer.close();
    }
    if (httpServer) {
      await httpServer.close();
    }
    await knex.destroy();
  });
  
  describe('Basic Socket.io Functionality', () => {
    beforeEach(async () => {
      // Create fresh API instance
      api = await createBasicApi(knex, {
        jwtAuth: {
          secret: TEST_SECRET,
          revocation: {
            enabled: true,
            storage: 'database'
          }
        }
      });
      
      // Install plugins
      await api.use(JwtAuthPlugin);
      await api.use(SocketIOPlugin, {
        port: socketPort
      });
      
      // Add HTTP server for REST operations
      await api.use(HttpPlugin, { port: httpPort });
      httpServer = api.vars.httpServer;
      
      // Store Socket.io server reference
      ioServer = api.io;
      
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
          patch: ['is_owner', 'admin'],
          delete: ['is_owner', 'admin']
        }
      });
      
      await api.resources.posts.createKnexTable();
      await cleanTables(knex, ['posts', 'revoked_tokens']);
    });
    
    it('should establish connection without authentication', async () => {
      const socket = createSocketClient(socketPort);
      
      const connectedData = await waitForSocketEvent(socket, 'connected');
      
      assert(connectedData.socketId, 'Should have socket ID');
      assert.equal(connectedData.authenticated, false);
      assert.equal(connectedData.userId, undefined);
      assert(connectedData.timestamp, 'Should have timestamp');
      
      socket.disconnect();
    });
    
    it('should establish authenticated connection', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      
      const connectedData = await waitForSocketEvent(socket, 'connected');
      
      assert(connectedData.socketId, 'Should have socket ID');
      assert.equal(connectedData.authenticated, true);
      assert.equal(connectedData.userId, '123');
      
      socket.disconnect();
    });
    
    it('should handle connection with invalid token gracefully', async () => {
      const socket = createSocketClient(socketPort, { token: 'invalid-token' });
      
      const connectedData = await waitForSocketEvent(socket, 'connected');
      
      // Should connect but not be authenticated
      assert.equal(connectedData.authenticated, false);
      assert.equal(connectedData.userId, undefined);
      
      socket.disconnect();
    });
  });
  
  describe('Subscription Management', () => {
    let userId = '123';
    let adminId = '456';
    
    beforeEach(async () => {
      api = await createBasicApi(knex);
      
      await api.use(JwtAuthPlugin, {
        secret: TEST_SECRET,
        ownershipField: 'user_id'
      });
      
      await api.use(SocketIOPlugin, {
        port: socketPort
      });
      
      await api.use(HttpPlugin, { port: httpPort });
      httpServer = api.vars.httpServer;
      ioServer = api.io;
      
      await api.addResource('books', {
        schema: {
          id: { type: 'id' },
          title: { type: 'string', required: true },
          user_id: { type: 'string' },
          published: { type: 'boolean', default: false }
        },
        auth: {
          query: ['public'],
          get: ['public'],
          post: ['authenticated'],
          patch: ['is_owner', 'admin'],
          delete: ['is_owner', 'admin']
        }
      });
      
      await api.resources.books.createKnexTable();
      await cleanTables(knex, ['books']);
    });
    
    it('should subscribe to resources with callback', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe using callback style
      const response = await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          filters: { published: true },
          subscriptionId: 'my-books'
        }, (response) => {
          resolve(response);
        });
      });
      
      assert.equal(response.success, true);
      assert.equal(response.data.subscriptionId, 'my-books');
      assert.equal(response.data.resource, 'books');
      assert.deepEqual(response.data.filters, { published: true });
      assert.equal(response.data.status, 'active');
      
      socket.disconnect();
    });
    
    it('should subscribe to resources with events', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe using event style
      const subscriptionPromise = waitForSocketEvent(socket, 'subscription.created');
      
      socket.emit('subscribe', {
        resource: 'books',
        filters: { published: true }
      });
      
      const subscriptionData = await subscriptionPromise;
      assert(subscriptionData.subscriptionId, 'Should have subscription ID');
      assert.equal(subscriptionData.resource, 'books');
      assert.deepEqual(subscriptionData.filters, { published: true });
      
      socket.disconnect();
    });
    
    it('should receive updates for subscribed resources', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe to all books
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          subscriptionId: 'all-books'
        }, resolve);
      });
      
      // Create a book via REST API
      const bookDoc = createJsonApiDocument('books', {
        title: 'Test Book',
        user_id: userId,
        published: true
      });
      
      const updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      const response = await fetch(`http://localhost:${httpPort}/api/books`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookDoc)
      });
      
      const createResult = await response.json();
      
      // Should receive Socket.io update
      const updateData = await updatePromise;
      assert.equal(updateData.type, 'resource.update');
      assert.equal(updateData.subscriptionId, 'all-books');
      assert.equal(updateData.resource, 'books');
      assert.equal(updateData.operation, 'create');
      assert.equal(updateData.data.type, 'books');
      assert.equal(updateData.data.attributes.title, 'Test Book');
      
      socket.disconnect();
    });
    
    it('should filter updates based on subscription filters', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe only to published books
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          filters: { published: true },
          subscriptionId: 'published-books'
        }, resolve);
      });
      
      // Create unpublished book - should NOT receive update
      const unpublishedDoc = createJsonApiDocument('books', {
        title: 'Unpublished Book',
        user_id: userId,
        published: false
      });
      
      await fetch(`http://localhost:${httpPort}/api/books`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(unpublishedDoc)
      });
      
      // Create published book - SHOULD receive update
      const publishedDoc = createJsonApiDocument('books', {
        title: 'Published Book',
        user_id: userId,
        published: true
      });
      
      const updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      await fetch(`http://localhost:${httpPort}/api/books`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(publishedDoc)
      });
      
      const updateData = await updatePromise;
      assert.equal(updateData.data.attributes.title, 'Published Book');
      assert.equal(updateData.data.attributes.published, true);
      
      socket.disconnect();
    });
    
    it('should unsubscribe from resources', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          subscriptionId: 'books-to-remove'
        }, resolve);
      });
      
      // Unsubscribe with callback
      const response = await new Promise((resolve) => {
        socket.emit('unsubscribe', {
          subscriptionId: 'books-to-remove'
        }, resolve);
      });
      
      assert.equal(response.success, true);
      assert.equal(response.data.subscriptionId, 'books-to-remove');
      assert.equal(response.data.status, 'removed');
      
      socket.disconnect();
    });
    
    it('should handle invalid resource subscription', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Try to subscribe to non-existent resource
      const response = await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'invalid-resource'
        }, resolve);
      });
      
      assert.equal(response.error.code, 'RESOURCE_NOT_FOUND');
      assert(response.error.message.includes('invalid-resource'));
      
      socket.disconnect();
    });
  });
  
  describe('Authentication and Authorization', () => {
    let userToken;
    let adminToken;
    let userId = '123';
    let adminId = '456';
    let otherUserId = '789';
    
    beforeEach(async () => {
      api = await createBasicApi(knex);
      
      await api.use(JwtAuthPlugin, {
        secret: TEST_SECRET,
        ownershipField: 'user_id'
      });
      
      await api.use(SocketIOPlugin, {
        port: socketPort
      });
      
      await api.use(HttpPlugin, { port: httpPort });
      httpServer = api.vars.httpServer;
      ioServer = api.io;
      
      await api.addResource('private_posts', {
        schema: {
          id: { type: 'id' },
          title: { type: 'string', required: true },
          content: { type: 'text' },
          user_id: { type: 'string' },
          private: { type: 'boolean', default: true }
        },
        auth: {
          query: ['authenticated'],
          get: ['is_owner', 'admin'],
          post: ['authenticated'],
          patch: ['is_owner'],
          delete: ['is_owner', 'admin']
        }
      });
      
      await api.resources.private_posts.createKnexTable();
      await cleanTables(knex, ['private_posts']);
      
      // Create tokens
      userToken = createToken({ sub: userId });
      adminToken = createToken({ sub: adminId, roles: ['admin'] });
    });
    
    it('should deny subscription to unauthenticated users for protected resources', async () => {
      const socket = createSocketClient(socketPort); // No auth
      await waitForSocketEvent(socket, 'connected');
      
      const response = await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'private_posts'
        }, resolve);
      });
      
      assert.equal(response.error.code, 'PERMISSION_DENIED');
      
      socket.disconnect();
    });
    
    it('should respect declarative auth rules for updates', async () => {
      // Create posts by different users
      const userPostDoc = createJsonApiDocument('private_posts', {
        title: 'User Post',
        content: 'My private content',
        user_id: userId
      });
      
      const otherPostDoc = createJsonApiDocument('private_posts', {
        title: 'Other User Post',
        content: 'Other private content',
        user_id: otherUserId
      });
      
      // Create posts via REST
      await fetch(`http://localhost:${httpPort}/api/private_posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userPostDoc)
      });
      
      const otherToken = createToken({ sub: otherUserId });
      await fetch(`http://localhost:${httpPort}/api/private_posts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${otherToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(otherPostDoc)
      });
      
      // Connect as user and subscribe
      const socket = createSocketClient(socketPort, { token: userToken });
      await waitForSocketEvent(socket, 'connected');
      
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'private_posts',
          subscriptionId: 'my-private-posts'
        }, resolve);
      });
      
      // Update user's own post - should receive update
      const updateDoc = {
        data: {
          type: 'private_posts',
          id: '1',
          attributes: {
            title: 'Updated User Post'
          }
        }
      };
      
      const updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      await fetch(`http://localhost:${httpPort}/api/private_posts/1`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateDoc)
      });
      
      const updateData = await updatePromise;
      assert.equal(updateData.data.attributes.title, 'Updated User Post');
      
      // Update other user's post - should NOT receive update due to auth rules
      const otherUpdateDoc = {
        data: {
          type: 'private_posts',
          id: '2',
          attributes: {
            title: 'Updated Other Post'
          }
        }
      };
      
      await fetch(`http://localhost:${httpPort}/api/private_posts/2`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${otherToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(otherUpdateDoc)
      });
      
      // Wait a bit to ensure no message is received
      await assert.rejects(
        waitForSocketEvent(socket, 'resource.update', 500),
        /Timeout/,
        'Should not receive update for other user\'s post'
      );
      
      socket.disconnect();
    });
    
    it('should disconnect on logout', async () => {
      const token = createToken({ jti: 'logout-test-123' });
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe to verify connection is active
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'private_posts'
        }, resolve);
      });
      
      // Setup disconnect listener
      const disconnectPromise = new Promise((resolve) => {
        socket.on('logout', (data) => {
          resolve(data);
        });
      });
      
      // Logout via REST API
      await fetch(`http://localhost:${httpPort}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      // Should receive logout message and disconnect
      const logoutData = await disconnectPromise;
      assert.equal(logoutData.message, 'You have been logged out');
      
      // Socket should be disconnected
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(socket.connected, false);
    });
  });
  
  describe('Real-time Updates', () => {
    beforeEach(async () => {
      api = await createBasicApi(knex);
      
      await api.use(JwtAuthPlugin, {
        secret: TEST_SECRET
      });
      
      await api.use(SocketIOPlugin, {
        port: socketPort
      });
      
      await api.use(HttpPlugin, { port: httpPort });
      httpServer = api.vars.httpServer;
      ioServer = api.io;
      
      await cleanTables(knex, ['basic_books', 'basic_countries']);
    });
    
    it('should broadcast create, update, and delete operations', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe to books
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          subscriptionId: 'books-crud'
        }, resolve);
      });
      
      // Create country first
      const countryDoc = createJsonApiDocument('countries', {
        name: 'Test Country',
        code: 'TC'
      });
      
      const countryRes = await fetch(`http://localhost:${httpPort}/api/countries`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(countryDoc)
      });
      
      const countryResult = await countryRes.json();
      const countryId = countryResult.data.id;
      
      // CREATE: Create a book
      const bookDoc = createJsonApiDocument('books', {
        title: 'Real-time Book',
        country_id: countryId
      });
      
      let updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      const createRes = await fetch(`http://localhost:${httpPort}/api/books`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookDoc)
      });
      
      const createResult = await createRes.json();
      const bookId = createResult.data.id;
      
      let updateData = await updatePromise;
      assert.equal(updateData.operation, 'create');
      assert.equal(updateData.data.type, 'books');
      assert.equal(updateData.data.attributes.title, 'Real-time Book');
      
      // UPDATE: Update the book
      const updateDoc = {
        data: {
          type: 'books',
          id: String(bookId),
          attributes: {
            title: 'Updated Real-time Book'
          }
        }
      };
      
      updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      await fetch(`http://localhost:${httpPort}/api/books/${bookId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateDoc)
      });
      
      updateData = await updatePromise;
      assert.equal(updateData.operation, 'update');
      assert.equal(updateData.data.id, String(bookId));
      assert.equal(updateData.data.attributes.title, 'Updated Real-time Book');
      
      // DELETE: Delete the book
      updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      await fetch(`http://localhost:${httpPort}/api/books/${bookId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      updateData = await updatePromise;
      assert.equal(updateData.operation, 'delete');
      assert.equal(updateData.data.id, String(bookId));
      
      socket.disconnect();
    });
    
    it('should support multiple concurrent subscriptions', async () => {
      const token = createToken();
      const socket = createSocketClient(socketPort, { token });
      await waitForSocketEvent(socket, 'connected');
      
      // Subscribe to multiple resources
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'countries',
          subscriptionId: 'countries-sub'
        }, resolve);
      });
      
      await new Promise((resolve) => {
        socket.emit('subscribe', {
          resource: 'books',
          subscriptionId: 'books-sub'
        }, resolve);
      });
      
      // Create a country - should receive update
      const countryDoc = createJsonApiDocument('countries', {
        name: 'Multi Sub Country',
        code: 'MS'
      });
      
      let updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      const countryRes = await fetch(`http://localhost:${httpPort}/api/countries`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(countryDoc)
      });
      
      const countryResult = await countryRes.json();
      
      let updateData = await updatePromise;
      assert.equal(updateData.subscriptionId, 'countries-sub');
      assert.equal(updateData.data.type, 'countries');
      
      // Create a book - should receive update
      const bookDoc = createJsonApiDocument('books', {
        title: 'Multi Sub Book',
        country_id: countryResult.data.id
      });
      
      updatePromise = waitForSocketEvent(socket, 'resource.update');
      
      await fetch(`http://localhost:${httpPort}/api/books`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookDoc)
      });
      
      updateData = await updatePromise;
      assert.equal(updateData.subscriptionId, 'books-sub');
      assert.equal(updateData.data.type, 'books');
      
      socket.disconnect();
    });
  });
});