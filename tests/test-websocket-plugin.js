import { test, describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { Api, Schema, HTTPPlugin, ValidationPlugin } from '../index.js';
import { WebSocketPlugin } from '../plugins/websocket/index.js';
import { setupTestApi, robustTeardown } from './lib/test-db-helper.js';

describe('WebSocket Plugin Tests', () => {
  let api, app, server, serverUrl;

  before(async () => {
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
    
    // Add test resources
    api.addResource('messages', new Schema({
      id: { type: 'id' },
      text: { type: 'string', required: true },
      roomId: { type: 'string' }
    }));
    
    api.addResource('users', new Schema({
      id: { type: 'id' },
      name: { type: 'string', required: true },
      countryId: { 
        type: 'id', 
        refs: { 
          resource: 'countries',
          join: { eager: false }
        }
      }
    }));
    
    api.addResource('countries', new Schema({
      id: { type: 'id' },
      name: { type: 'string', required: true },
      code: { type: 'string' }
    }));
    
    api.addResource('addresses', new Schema({
      id: { type: 'id' },
      street: { type: 'string', required: true },
      userId: { type: 'id', searchable: true },
      countryId: { 
        type: 'id',
        refs: { resource: 'countries' }
      }
    }));
    
    // Add virtual field for user addresses
    api.schemas.get('users').structure.addresses = {
      type: 'list',
      virtual: true,
      foreignResource: 'addresses',
      foreignKey: 'userId'
    };
    
    await api.connect();
    api.websocket.init(server);
    
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
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

  it('should connect and authenticate', async () => {
    const client = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise(resolve => client.on('connect', resolve));
    assert(client.connected);
    
    client.disconnect();
    
    // Test JWT auth
    const token = jwt.sign({ id: 'user123' }, 'test-secret');
    const authClient = ioClient(serverUrl, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false
    });
    
    await new Promise(resolve => authClient.on('connect', resolve));
    assert(authClient.connected);
    authClient.disconnect();
  });

  it('should subscribe to resources', async () => {
    const client = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise(resolve => client.on('connect', resolve));
    
    const subSuccess = new Promise(resolve => {
      client.on('subscription:success', resolve);
    });
    
    client.emit('subscribe', {
      resource: 'messages',
      id: '1'
    });
    
    const result = await subSuccess;
    assert.equal(result.resource, 'messages');
    assert.equal(result.id, '1');
    
    client.disconnect();
  });

  it('should broadcast real-time updates', async () => {
    const client1 = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    const client2 = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    
    await Promise.all([
      new Promise(resolve => client1.on('connect', resolve)),
      new Promise(resolve => client2.on('connect', resolve))
    ]);
    
    // Both subscribe to messages
    await Promise.all([
      new Promise(resolve => {
        client1.once('subscription:success', resolve);
        client1.emit('subscribe', { resource: 'messages' });
      }),
      new Promise(resolve => {
        client2.once('subscription:success', resolve);
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
    assert(update.meta.timestamp);
    
    client1.disconnect();
    client2.disconnect();
  });

  it('should handle deep subscriptions', async () => {
    const client = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise(resolve => client.on('connect', resolve));
    
    // Create test data
    const country = await api.resources.countries.create({
      name: 'United States',
      code: 'US'
    });
    
    const user = await api.resources.users.create({
      name: 'John Doe',
      countryId: country.data.id
    });
    
    // Subscribe with include
    const subscription = new Promise(resolve => {
      client.on('subscription:success', resolve);
    });
    
    client.emit('subscribe', {
      resource: 'users',
      id: user.data.id,
      include: 'countryId'
    });
    
    const subResult = await subscription;
    assert.equal(subResult.resource, 'users');
    assert.equal(subResult.include, 'countryId');
    
    // Listen for country updates
    const countryUpdate = new Promise(resolve => {
      client.on('resource:updated', (data) => {
        if (data.resource === 'countries' && data.id === country.data.id) {
          resolve(data);
        }
      });
    });
    
    // Update country
    await api.resources.countries.update(country.data.id, {
      name: 'United States of America'
    });
    
    const update = await countryUpdate;
    assert.equal(update.data.attributes.name, 'United States of America');
    
    client.disconnect();
  });

  it('should handle presence', async () => {
    const token1 = jwt.sign({ id: 'user1' }, 'test-secret');
    const token2 = jwt.sign({ id: 'user2' }, 'test-secret');
    
    const client1 = ioClient(serverUrl, {
      transports: ['websocket'],
      auth: { token: token1 },
      reconnection: false
    });
    
    const client2 = ioClient(serverUrl, {
      transports: ['websocket'],
      auth: { token: token2 },
      reconnection: false
    });
    
    await Promise.all([
      new Promise(resolve => client1.on('connect', resolve)),
      new Promise(resolve => client2.on('connect', resolve))
    ]);
    
    // Track join events
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
    
    // Test room stats
    const rooms = api.websocket.roomManager.getPresenceRooms();
    const room1 = rooms.find(r => r.channel === 'room1');
    assert(room1);
    assert(room1.users >= 2);
    
    client1.disconnect();
    client2.disconnect();
  });

  it('should include metadata in broadcasts', async () => {
    const client = ioClient(serverUrl, {
      transports: ['websocket'],
      reconnection: false
    });
    
    await new Promise(resolve => client.on('connect', resolve));
    
    // Get socket ID
    const socketIdPromise = new Promise(resolve => {
      client.on('connection:established', data => {
        resolve(data.socketId);
      });
    });
    
    // Trigger reconnection to get the event
    client.disconnect();
    client.connect();
    
    const socketId = await socketIdPromise;
    
    // Subscribe to messages
    await new Promise(resolve => {
      client.on('subscription:success', resolve);
      client.emit('subscribe', { resource: 'messages' });
    });
    
    // Track events
    const events = [];
    client.on('resource:created', event => {
      events.push(event);
    });
    
    // Create via WebSocket with request ID
    const requestId = 'req-123';
    const createPromise = new Promise(resolve => {
      client.once('resource:created', resolve);
    });
    
    client.emit('resource:create', {
      resource: 'messages',
      data: { text: 'Test message' },
      requestId
    });
    
    await createPromise;
    
    // Create via API (no socket ID)
    await api.resources.messages.create({
      text: 'Server message'
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should have received events with metadata
    assert(events.length >= 2);
    
    // Find our own event
    const ownEvent = events.find(e => e.meta && e.meta.originSocketId === socketId);
    assert(ownEvent);
    assert.equal(ownEvent.meta.requestId, requestId);
    
    // Find server event
    const serverEvent = events.find(e => e.meta && !e.meta.originSocketId);
    assert(serverEvent);
    
    client.disconnect();
  });
});