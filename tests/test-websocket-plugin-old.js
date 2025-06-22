import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import { io as ioClient } from 'socket.io-client';
import { Api, Schema, HTTPPlugin, ValidationPlugin } from '../index.js';
import { WebSocketPlugin } from '../plugins/protocols/websocket/index.js';
import { setupTestApi, robustTeardown } from './lib/test-db-helper.js';

describe('WebSocket Plugin Tests', () => {
  let api;
  let app;
  let server;
  let clientSocket;
  let serverUrl;

  beforeEach(async () => {
    api = await setupTestApi();
    app = express();
    app.use(express.json());
    server = createServer(app);
    
    api.use(HTTPPlugin, { app });
    api.use(ValidationPlugin);
    api.use(WebSocketPlugin, {
      jwtSecret: 'test-secret',
      rateLimit: { points: 10, duration: 1000 }
    });
    
    await api.connect();
    
    // Initialize WebSocket server
    api.websocket.init(server);
    
    // Start server
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    
    // Close WebSocket server first
    if (api.websocket) {
      await api.websocket.close();
    }
    
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    
    await robustTeardown({ api });
  });

  describe('Connection and Authentication', () => {
    it('should connect without authentication', async () => {
      clientSocket = ioClient(serverUrl, {
        transports: ['websocket']
      });

      await new Promise((resolve, reject) => {
        clientSocket.on('connect', resolve);
        clientSocket.on('connect_error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      assert(clientSocket.connected);
    });

    it('should connect with JWT authentication', async () => {
      const jwt = await import('jsonwebtoken');
      const token = jwt.default.sign({ id: '123', name: 'Test User' }, 'test-secret');

      clientSocket = ioClient(serverUrl, {
        transports: ['websocket'],
        auth: { token }
      });

      await new Promise((resolve, reject) => {
        clientSocket.on('connect', resolve);
        clientSocket.on('connect_error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      assert(clientSocket.connected);
    });

    it('should handle invalid authentication', async () => {
      clientSocket = ioClient(serverUrl, {
        transports: ['websocket'],
        auth: { token: 'invalid-token' }
      });

      const error = await new Promise((resolve) => {
        clientSocket.on('connect_error', resolve);
        setTimeout(() => resolve(null), 2000);
      });

      assert(error);
      assert(error.message.includes('Authentication failed'));
    });

    it('should track connected sockets', async () => {
      const socket1 = ioClient(serverUrl, { transports: ['websocket'] });
      const socket2 = ioClient(serverUrl, { transports: ['websocket'] });

      await Promise.all([
        new Promise(resolve => socket1.on('connect', resolve)),
        new Promise(resolve => socket2.on('connect', resolve))
      ]);

      const sockets = api.websocket.getConnectedSockets();
      assert.equal(sockets.length, 2);

      socket1.disconnect();
      socket2.disconnect();
    });
  });

  describe('Resource Subscriptions', () => {
    beforeEach(async () => {
      api.addResource('posts', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        content: { type: 'string' },
        status: { type: 'string', searchable: true }
      }));

      clientSocket = ioClient(serverUrl, {
        transports: ['websocket']
      });

      await new Promise(resolve => clientSocket.on('connect', resolve));
    });

    it('should subscribe to single resource', async () => {
      const post = await api.resources.posts.create({
        title: 'Test Post',
        content: 'Test content'
      });

      const subscription = new Promise(resolve => {
        clientSocket.on('subscription:success', resolve);
      });

      const state = new Promise(resolve => {
        clientSocket.on('resource:state', resolve);
      });

      clientSocket.emit('subscribe', {
        resource: 'posts',
        id: post.data.id
      });

      const [subResult, stateResult] = await Promise.all([subscription, state]);

      assert.equal(subResult.resource, 'posts');
      assert.equal(subResult.id, post.data.id);
      assert.equal(stateResult.data.attributes.title, 'Test Post');
    });

    it('should subscribe to resource collection', async () => {
      await api.resources.posts.create({ title: 'Post 1', status: 'published' });
      await api.resources.posts.create({ title: 'Post 2', status: 'draft' });

      const subscription = new Promise(resolve => {
        clientSocket.on('subscription:success', resolve);
      });

      const state = new Promise(resolve => {
        clientSocket.on('collection:state', resolve);
      });

      clientSocket.emit('subscribe', {
        resource: 'posts'
      });

      const [subResult, stateResult] = await Promise.all([subscription, state]);

      assert.equal(subResult.resource, 'posts');
      assert.equal(stateResult.data.length, 2);
      assert.equal(stateResult.meta.total, 2);
    });

    it('should subscribe with filters', async () => {
      await api.resources.posts.create({ title: 'Post 1', status: 'published' });
      await api.resources.posts.create({ title: 'Post 2', status: 'draft' });
      await api.resources.posts.create({ title: 'Post 3', status: 'published' });

      const state = new Promise(resolve => {
        clientSocket.on('collection:state', resolve);
      });

      clientSocket.emit('subscribe', {
        resource: 'posts',
        filter: { status: 'published' }
      });

      const stateResult = await state;
      assert.equal(stateResult.data.length, 2);
      assert(stateResult.data.every(post => 
        post.attributes.status === 'published'
      ));
    });

    it('should handle subscription errors', async () => {
      const error = new Promise(resolve => {
        clientSocket.on('subscription:error', resolve);
      });

      clientSocket.emit('subscribe', {
        resource: 'invalid-resource'
      });

      const errorResult = await error;
      assert.equal(errorResult.resource, 'invalid-resource');
      assert(errorResult.error);
    });

    it('should unsubscribe from resources', async () => {
      // Subscribe first
      await new Promise(resolve => {
        clientSocket.on('subscription:success', resolve);
        clientSocket.emit('subscribe', { resource: 'posts' });
      });

      // Unsubscribe
      clientSocket.emit('unsubscribe', { resource: 'posts' });

      // Verify by checking room membership (implementation specific)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Socket should no longer receive updates for this resource
      const rooms = api.websocket.roomManager.getRoomsForSocket(clientSocket.id);
      assert(!rooms.includes('posts:all'));
    });
  });

  describe('Real-time CRUD Operations', () => {
    beforeEach(async () => {
      api.addResource('items', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        value: { type: 'number' }
      }));

      clientSocket = ioClient(serverUrl, {
        transports: ['websocket']
      });

      await new Promise(resolve => clientSocket.on('connect', resolve));
    });

    it('should create resource via WebSocket', async () => {
      const created = new Promise(resolve => {
        clientSocket.on('resource:created', resolve);
      });

      clientSocket.emit('resource:create', {
        resource: 'items',
        data: { name: 'New Item', value: 100 },
        requestId: 'req-1'
      });

      const result = await created;
      assert.equal(result.requestId, 'req-1');
      assert(result.data.id);
      assert.equal(result.data.attributes.name, 'New Item');
    });

    it('should update resource via WebSocket', async () => {
      const item = await api.resources.items.create({ name: 'Original', value: 50 });

      const updated = new Promise(resolve => {
        clientSocket.on('resource:updated', resolve);
      });

      clientSocket.emit('resource:update', {
        resource: 'items',
        id: item.data.id,
        data: { name: 'Updated' },
        requestId: 'req-2'
      });

      const result = await updated;
      assert.equal(result.requestId, 'req-2');
      assert.equal(result.data.attributes.name, 'Updated');
      assert.equal(result.data.attributes.value, 50); // Unchanged
    });

    it('should delete resource via WebSocket', async () => {
      const item = await api.resources.items.create({ name: 'To Delete' });

      const deleted = new Promise(resolve => {
        clientSocket.on('resource:deleted', resolve);
      });

      clientSocket.emit('resource:delete', {
        resource: 'items',
        id: item.data.id,
        requestId: 'req-3'
      });

      const result = await deleted;
      assert.equal(result.requestId, 'req-3');
      assert.equal(result.id, item.data.id);

      // Verify deletion
      const checkResult = await api.resources.items.get(item.data.id, {
        allowNotFound: true
      });
      assert.equal(checkResult.data, null);
    });

    it('should handle operation errors', async () => {
      const error = new Promise(resolve => {
        clientSocket.on('resource:error', resolve);
      });

      clientSocket.emit('resource:create', {
        resource: 'items',
        data: { value: 100 }, // Missing required name
        requestId: 'req-error'
      });

      const result = await error;
      assert.equal(result.requestId, 'req-error');
      assert(result.error);
    });
  });

  describe('Real-time Updates', () => {
    let client1, client2;

    beforeEach(async () => {
      api.addResource('messages', new Schema({
        id: { type: 'id' },
        text: { type: 'string', required: true },
        roomId: { type: 'string', searchable: true }
      }));

      client1 = ioClient(serverUrl, { transports: ['websocket'] });
      client2 = ioClient(serverUrl, { transports: ['websocket'] });

      await Promise.all([
        new Promise(resolve => client1.on('connect', resolve)),
        new Promise(resolve => client2.on('connect', resolve))
      ]);
    });

    afterEach(() => {
      if (client1) client1.disconnect();
      if (client2) client2.disconnect();
    });

    it('should broadcast resource creation', async () => {
      // Both clients subscribe to messages
      await Promise.all([
        new Promise(resolve => {
          client1.on('subscription:success', resolve);
          client1.emit('subscribe', { resource: 'messages' });
        }),
        new Promise(resolve => {
          client2.on('subscription:success', resolve);
          client2.emit('subscribe', { resource: 'messages' });
        })
      ]);

      // Client 2 listens for updates
      const updatePromise = new Promise(resolve => {
        client2.on('resource:created', resolve);
      });

      // Create message via API
      await api.resources.messages.create({
        text: 'Hello World',
        roomId: 'general'
      });

      const update = await updatePromise;
      assert.equal(update.resource, 'messages');
      assert.equal(update.data.attributes.text, 'Hello World');
    });

    it('should broadcast resource updates to specific subscribers', async () => {
      const message = await api.resources.messages.create({
        text: 'Original',
        roomId: 'general'
      });

      // Client 1 subscribes to specific message
      await new Promise(resolve => {
        client1.on('subscription:success', resolve);
        client1.emit('subscribe', {
          resource: 'messages',
          id: message.data.id
        });
      });

      // Client 2 subscribes to all messages
      await new Promise(resolve => {
        client2.on('subscription:success', resolve);
        client2.emit('subscribe', { resource: 'messages' });
      });

      // Both should receive update
      const update1 = new Promise(resolve => {
        client1.on('resource:updated', resolve);
      });
      const update2 = new Promise(resolve => {
        client2.on('resource:updated', resolve);
      });

      await api.resources.messages.update(message.data.id, {
        text: 'Updated'
      });

      const [result1, result2] = await Promise.all([update1, update2]);
      assert.equal(result1.data.attributes.text, 'Updated');
      assert.equal(result2.data.attributes.text, 'Updated');
    });

    it('should broadcast deletions', async () => {
      const message = await api.resources.messages.create({
        text: 'To Delete'
      });

      await new Promise(resolve => {
        client1.on('subscription:success', resolve);
        client1.emit('subscribe', { resource: 'messages' });
      });

      const deletion = new Promise(resolve => {
        client1.on('resource:deleted', resolve);
      });

      await api.resources.messages.delete(message.data.id);

      const result = await deletion;
      assert.equal(result.resource, 'messages');
      assert.equal(result.id, message.data.id);
    });

    it('should handle filtered subscriptions', async () => {
      // Client 1 subscribes to room 'general'
      await new Promise(resolve => {
        client1.on('subscription:success', resolve);
        client1.emit('subscribe', {
          resource: 'messages',
          filter: { roomId: 'general' }
        });
      });

      // Client 2 subscribes to room 'private'
      await new Promise(resolve => {
        client2.on('subscription:success', resolve);
        client2.emit('subscribe', {
          resource: 'messages',
          filter: { roomId: 'private' }
        });
      });

      let client1Received = false;
      let client2Received = false;

      client1.on('resource:created', () => { client1Received = true; });
      client2.on('resource:created', () => { client2Received = true; });

      // Create message in general room
      await api.resources.messages.create({
        text: 'General message',
        roomId: 'general'
      });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      assert(client1Received, 'Client 1 should receive update');
      assert(!client2Received, 'Client 2 should not receive update');
    });
  });

  describe('Live Queries', () => {
    beforeEach(async () => {
      api.addResource('tasks', new Schema({
        id: { type: 'id' },
        title: { type: 'string', required: true },
        completed: { type: 'boolean', default: false, searchable: true },
        priority: { type: 'number', searchable: true }
      }));

      clientSocket = ioClient(serverUrl, {
        transports: ['websocket']
      });

      await new Promise(resolve => clientSocket.on('connect', resolve));
    });

    it('should create live query', async () => {
      // Create initial data
      await api.resources.tasks.create({ title: 'Task 1', priority: 1 });
      await api.resources.tasks.create({ title: 'Task 2', priority: 2 });

      const queryCreated = new Promise(resolve => {
        clientSocket.on('livequery:created', resolve);
      });

      const initialState = new Promise(resolve => {
        clientSocket.on('collection:state', resolve);
      });

      clientSocket.emit('subscribe', {
        resource: 'tasks',
        filter: { completed: false },
        options: { liveQuery: true }
      });

      const [queryResult, stateResult] = await Promise.all([queryCreated, initialState]);
      
      assert(queryResult.queryId);
      assert.equal(stateResult.data.length, 2);
    });

    it('should update live query results', async () => {
      // Subscribe with live query
      await new Promise(resolve => {
        clientSocket.on('livequery:created', resolve);
        clientSocket.emit('subscribe', {
          resource: 'tasks',
          filter: { priority: 1 },
          options: { liveQuery: true }
        });
      });

      const update = new Promise(resolve => {
        clientSocket.on('livequery:update', resolve);
      });

      // Create matching task
      await api.resources.tasks.create({
        title: 'High Priority Task',
        priority: 1
      });

      const result = await update;
      assert(result.queryId);
      assert.equal(result.operation, 'created');
      assert(result.data.length > 0);
    });
  });

  describe('Presence', () => {
    let client1, client2;

    beforeEach(async () => {
      const jwt = await import('jsonwebtoken');
      const token1 = jwt.default.sign({ id: 'user1' }, 'test-secret');
      const token2 = jwt.default.sign({ id: 'user2' }, 'test-secret');

      client1 = ioClient(serverUrl, {
        transports: ['websocket'],
        auth: { token: token1 }
      });

      client2 = ioClient(serverUrl, {
        transports: ['websocket'],
        auth: { token: token2 }
      });

      await Promise.all([
        new Promise(resolve => client1.on('connect', resolve)),
        new Promise(resolve => client2.on('connect', resolve))
      ]);
    });

    afterEach(() => {
      if (client1) client1.disconnect();
      if (client2) client2.disconnect();
    });

    it('should handle presence join/leave', async () => {
      // Collect all join events
      const joinEvents = [];
      client2.on('presence:user:joined', event => {
        joinEvents.push(event);
      });

      // First client2 joins
      client2.emit('presence:join', 'room1');
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Then client1 joins
      client1.emit('presence:join', 'room1');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Find user1's join event
      const user1JoinEvent = joinEvents.find(e => e.userId === 'user1');
      assert(user1JoinEvent, 'Should receive user1 join event');
      assert.equal(user1JoinEvent.userId, 'user1');
      assert(user1JoinEvent.timestamp);

      // Test leave
      const userLeft = new Promise(resolve => {
        client2.on('presence:user:left', event => {
          if (event.userId === 'user1') resolve(event);
        });
      });

      client1.emit('presence:leave', 'room1');

      const leaveEvent = await userLeft;
      assert.equal(leaveEvent.userId, 'user1');
    });

    it('should get presence room stats', async () => {
      client1.emit('presence:join', 'room1');
      client2.emit('presence:join', 'room1');
      client1.emit('presence:join', 'room2');
      
      // Wait for events to process
      await new Promise(resolve => setTimeout(resolve, 50));

      const rooms = api.websocket.roomManager.getPresenceRooms();
      
      const room1 = rooms.find(r => r.channel === 'room1');
      const room2 = rooms.find(r => r.channel === 'room2');
      
      assert(room1);
      assert(room2);
      assert(room1.users >= 2);
      assert(room2.users >= 1);
    });
  });

  describe('Custom Events', () => {
    let client1, client2;

    beforeEach(async () => {
      client1 = ioClient(serverUrl, { transports: ['websocket'] });
      client2 = ioClient(serverUrl, { transports: ['websocket'] });

      await Promise.all([
        new Promise(resolve => client1.on('connect', resolve)),
        new Promise(resolve => client2.on('connect', resolve))
      ]);
    });

    afterEach(() => {
      if (client1) client1.disconnect();
      if (client2) client2.disconnect();
    });

    it('should handle custom events between clients', async () => {
      // Both join same room
      client1.emit('presence:join', 'chat-room');
      client2.emit('presence:join', 'chat-room');

      await new Promise(resolve => setTimeout(resolve, 100));

      const customEvent = new Promise(resolve => {
        client2.on('custom:message', resolve);
      });

      client1.emit('custom:event', {
        event: 'message',
        payload: { text: 'Hello from client1' },
        room: 'presence:chat-room'
      });

      const result = await customEvent;
      assert.equal(result.payload.text, 'Hello from client1');
      assert(result.timestamp);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      clientSocket = ioClient(serverUrl, {
        transports: ['websocket']
      });

      await new Promise(resolve => clientSocket.on('connect', resolve));

      // Send many requests quickly
      const errors = [];
      clientSocket.on('resource:error', (err) => errors.push(err));

      // Send 15 requests (limit is 10)
      for (let i = 0; i < 15; i++) {
        clientSocket.emit('resource:create', {
          resource: 'items',
          data: { name: `Item ${i}` },
          requestId: `req-${i}`
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Should have some rate limit errors
      // Note: Exact count may vary due to timing
      assert(errors.length > 0 || api.websocket.socketManager.isRateLimited(clientSocket.id));
    });
  });

  describe('Deep Subscriptions', () => {
    // Create a fresh API instance for deep subscription tests
    let deepApi, deepServer, deepServerUrl, deepClientSocket;
    
    beforeEach(async () => {
      deepApi = await setupTestApi();
      const deepApp = express();
      deepApp.use(express.json());
      deepServer = createServer(deepApp);
      
      deepApi.use(HTTPPlugin, { app: deepApp });
      deepApi.use(ValidationPlugin);
      deepApi.use(WebSocketPlugin, { jwtSecret: 'test-secret' });
      
      // Setup resources with relationships
      deepApi.addResource('users', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        countryId: { 
          type: 'id', 
          refs: { 
            resource: 'countries',
            join: { eager: true }
          }
        }
      }));
      
      deepApi.addResource('countries', new Schema({
        id: { type: 'id' },
        name: { type: 'string', required: true },
        code: { type: 'string' }
      }));

      deepApi.addResource('addresses', new Schema({
        id: { type: 'id' },
        street: { type: 'string', required: true },
        userId: { type: 'id', searchable: true },
        countryId: { 
          type: 'id',
          refs: { resource: 'countries' }
        }
      }));

      // Add addresses as virtual field to users
      deepApi.schemas.get('users').structure.addresses = {
        type: 'list',
        virtual: true,
        foreignResource: 'addresses',
        foreignKey: 'userId'
      };
      
      await deepApi.connect();
      deepApi.websocket.init(deepServer);
      
      // Start server
      await new Promise((resolve) => {
        deepServer.listen(0, () => {
          const port = deepServer.address().port;
          deepServerUrl = `http://localhost:${port}`;
          resolve();
        });
      });

      deepClientSocket = ioClient(deepServerUrl, {
        transports: ['websocket']
      });

      await new Promise(resolve => deepClientSocket.on('connect', resolve));
    });
    
    afterEach(async () => {
      if (deepClientSocket && deepClientSocket.connected) {
        deepClientSocket.disconnect();
      }
      
      if (deepApi.websocket) {
        await deepApi.websocket.close();
      }
      
      if (deepServer) {
        await new Promise((resolve) => {
          deepServer.close(resolve);
        });
      }
      
      await robustTeardown({ api: deepApi });
    });

    it('should subscribe to included 1:1 relationships', async () => {
      // Create test data
      const country = await deepApi.resources.countries.create({
        name: 'United States',
        code: 'US'
      });

      const user = await deepApi.resources.users.create({
        name: 'John Doe',
        countryId: country.data.id
      });

      const subscription = new Promise(resolve => {
        deepClientSocket.on('subscription:success', resolve);
      });

      const state = new Promise(resolve => {
        deepClientSocket.on('resource:state', resolve);
      });

      // Subscribe with include
      deepClientSocket.emit('subscribe', {
        resource: 'users',
        id: user.data.id,
        include: 'countryId'
      });

      const [subResult, stateResult] = await Promise.all([subscription, state]);

      assert.equal(subResult.resource, 'users');
      assert.equal(subResult.include, 'countryId');
      assert(stateResult.included);

      // Verify user is subscribed to country updates
      const countryUpdate = new Promise(resolve => {
        deepClientSocket.on('resource:updated', (data) => {
          if (data.resource === 'countries') {
            resolve(data);
          }
        });
      });

      // Update country
      await deepApi.resources.countries.update(country.data.id, {
        name: 'United States of America'
      });

      const update = await countryUpdate;
      assert.equal(update.id, country.data.id);
      assert.equal(update.data.attributes.name, 'United States of America');
    });

    it('should subscribe to included 1:n relationships', async () => {
      const user = await deepApi.resources.users.create({
        name: 'Jane Doe'
      });

      await deepApi.resources.addresses.create({
        street: '123 Main St',
        userId: user.data.id
      });

      await deepApi.resources.addresses.create({
        street: '456 Oak Ave',
        userId: user.data.id
      });

      const subscription = new Promise(resolve => {
        deepClientSocket.on('subscription:success', resolve);
      });

      // Subscribe with include
      deepClientSocket.emit('subscribe', {
        resource: 'users',
        id: user.data.id,
        include: 'addresses'
      });

      await subscription;

      // Listen for new address creation
      const addressCreated = new Promise(resolve => {
        deepClientSocket.on('resource:created', (data) => {
          if (data.resource === 'addresses' && data.filter) {
            resolve(data);
          }
        });
      });

      // Create new address for user
      await deepApi.resources.addresses.create({
        street: '789 Pine Rd',
        userId: user.data.id
      });

      const creation = await addressCreated;
      assert.equal(creation.resource, 'addresses');
      assert.equal(creation.data.attributes.street, '789 Pine Rd');
    });

    it('should handle nested includes', async () => {
      const country = await deepApi.resources.countries.create({
        name: 'Canada',
        code: 'CA'
      });

      const user = await deepApi.resources.users.create({
        name: 'Bob Smith',
        countryId: country.data.id
      });

      const address = await deepApi.resources.addresses.create({
        street: '999 Maple St',
        userId: user.data.id,
        countryId: country.data.id
      });

      // Subscribe with nested include
      deepClientSocket.emit('subscribe', {
        resource: 'users',
        id: user.data.id,
        include: 'addresses,addresses.countryId'
      });

      await new Promise(resolve => {
        deepClientSocket.on('subscription:success', resolve);
      });

      // Should be subscribed to country updates via address relationship
      const countryUpdate = new Promise(resolve => {
        deepClientSocket.on('resource:updated', (data) => {
          if (data.resource === 'countries' && data.id === country.data.id) {
            resolve(data);
          }
        });
      });

      await deepApi.resources.countries.update(country.data.id, {
        code: 'CAN'
      });

      const update = await countryUpdate;
      assert.equal(update.data.attributes.code, 'CAN');
    });

    it('should clean up deep subscriptions on unsubscribe', async () => {
      const user = await deepApi.resources.users.create({
        name: 'Test User'
      });

      const country = await deepApi.resources.countries.create({
        name: 'Test Country',
        code: 'TC'
      });

      await deepApi.resources.users.update(user.data.id, {
        countryId: country.data.id
      });

      // Subscribe with includes
      await new Promise(resolve => {
        deepClientSocket.on('subscription:success', resolve);
        deepClientSocket.emit('subscribe', {
          resource: 'users',
          id: user.data.id,
          include: 'countryId'
        });
      });

      // Set up listener for country updates
      let receivedUpdate = false;
      deepClientSocket.on('resource:updated', (data) => {
        if (data.resource === 'countries' && data.id === country.data.id) {
          receivedUpdate = true;
        }
      });

      // Verify subscription works before unsubscribe
      await deepApi.resources.countries.update(country.data.id, {
        code: 'TC2'
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      assert(receivedUpdate, 'Should receive update before unsubscribe');

      // Reset flag
      receivedUpdate = false;

      // Unsubscribe
      deepClientSocket.emit('unsubscribe', {
        resource: 'users',
        id: user.data.id
      });

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update country again - should NOT receive this update
      await deepApi.resources.countries.update(country.data.id, {
        code: 'TC3'
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      assert(!receivedUpdate, 'Should NOT receive update after unsubscribe')
    });
  });

  describe('Statistics and Management', () => {
    it('should provide socket statistics', async () => {
      const socket1 = ioClient(serverUrl, { transports: ['websocket'] });
      const socket2 = ioClient(serverUrl, { transports: ['websocket'] });

      await Promise.all([
        new Promise(resolve => socket1.on('connect', resolve)),
        new Promise(resolve => socket2.on('connect', resolve))
      ]);

      const stats = api.websocket.socketManager.getStats();
      
      assert.equal(stats.totalSockets, 2);
      assert(stats.averageConnectionDuration >= 0);

      socket1.disconnect();
      socket2.disconnect();
    });

    it('should provide room statistics', async () => {
      api.addResource('chats', new Schema({
        id: { type: 'id' },
        message: { type: 'string' }
      }));

      const socket = ioClient(serverUrl, { transports: ['websocket'] });
      await new Promise(resolve => socket.on('connect', resolve));

      await new Promise(resolve => {
        socket.on('subscription:success', resolve);
        socket.emit('subscribe', { resource: 'chats' });
      });

      socket.emit('presence:join', 'lobby');
      
      // Wait for events to process
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = api.websocket.roomManager.getStats();
      
      assert(stats.totalRooms > 0);
      assert(stats.presenceRooms > 0);
      assert(stats.resourceRooms.chats > 0);

      socket.disconnect();
    });

    it('should disconnect specific users', async () => {
      const jwt = await import('jsonwebtoken');
      const token = jwt.default.sign({ id: 'user-to-disconnect' }, 'test-secret');

      const socket = ioClient(serverUrl, {
        transports: ['websocket'],
        auth: { token }
      });

      await new Promise(resolve => socket.on('connect', resolve));

      const disconnected = new Promise(resolve => {
        socket.on('disconnect', resolve);
      });

      api.websocket.disconnectUser('user-to-disconnect', 'Admin action');

      const reason = await disconnected;
      assert(reason);
    });
  });
});