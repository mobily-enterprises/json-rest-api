import { Api, Schema, MemoryPlugin, HTTPPlugin, ValidationPlugin } from '../index.js';
import { WebSocketPlugin } from '../plugins/protocols/websocket/index.js';
import express from 'express';
import { createServer } from 'http';
import { io as ioClient } from 'socket.io-client';

// Create API instance
const api = new Api();
const app = express();
const server = createServer(app);

// Apply plugins
api.use(MemoryPlugin);
api.use(HTTPPlugin, { app });
api.use(ValidationPlugin);
api.use(WebSocketPlugin);

// Define schema
api.addResource('tasks', new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  completed: { type: 'boolean', default: false },
  userId: { type: 'id' }
}));

// Connect and start server
await api.connect();
api.websocket.init(server);

const port = 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Smart client that handles its own updates intelligently
class SmartWebSocketClient {
  constructor(url) {
    this.url = url;
    this.socketId = null;
    this.pendingRequests = new Map();
  }

  async connect() {
    this.socket = ioClient(this.url, {
      transports: ['websocket']
    });

    // Wait for connection and get our socket ID
    await new Promise(resolve => {
      this.socket.on('connection:established', (data) => {
        this.socketId = data.socketId;
        console.log(`✅ Connected with socket ID: ${this.socketId}`);
        resolve();
      });
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle resource updates
    this.socket.on('resource:created', (event) => {
      this.handleResourceEvent('created', event);
    });

    this.socket.on('resource:updated', (event) => {
      this.handleResourceEvent('updated', event);
    });

    this.socket.on('resource:deleted', (event) => {
      this.handleResourceEvent('deleted', event);
    });
  }

  handleResourceEvent(type, event) {
    const { meta, resource, data, id } = event;
    const isOwnUpdate = meta?.originSocketId === this.socketId;
    const requestId = meta?.requestId;

    // Check if this is a response to our own request
    if (isOwnUpdate && requestId && this.pendingRequests.has(requestId)) {
      console.log(`✅ Confirmed: Our ${type} request ${requestId} succeeded`);
      this.pendingRequests.delete(requestId);
      return; // Skip UI update - we already updated optimistically
    }

    // This is an update from another client or server
    console.log(`\n📨 ${type.toUpperCase()} notification received:`);
    console.log(`Resource: ${resource}${id ? ` #${id}` : ''}`);
    console.log(`From: ${isOwnUpdate ? 'OWN REQUEST (no requestId)' : meta?.originSocketId || 'server'}`);
    
    if (type !== 'deleted' && data) {
      console.log(`Data:`, data.attributes || data);
    }

    // Here you would update your UI/state
    this.updateLocalState(type, resource, id, data);
  }

  updateLocalState(type, resource, id, data) {
    // Simulate UI update
    console.log(`🔄 Updating UI for ${type} ${resource}...`);
  }

  // Make requests with tracking
  async createResource(resource, data) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.pendingRequests.set(requestId, { resource, data });

    console.log(`\n📤 Creating ${resource} with request ID: ${requestId}`);
    
    // Optimistic UI update
    console.log(`⚡ Optimistic update: Adding ${resource} to UI immediately`);

    this.socket.emit('resource:create', {
      resource,
      data,
      requestId
    });

    // Clean up pending request after timeout
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        console.log(`⚠️ Request ${requestId} timed out`);
        this.pendingRequests.delete(requestId);
      }
    }, 5000);
  }

  subscribe(resource, options = {}) {
    this.socket.emit('subscribe', {
      resource,
      ...options
    });
  }
}

// Demo the smart update handling
async function demo() {
  // Create two clients
  const client1 = new SmartWebSocketClient(`http://localhost:${port}`);
  const client2 = new SmartWebSocketClient(`http://localhost:${port}`);

  await client1.connect();
  await client2.connect();

  // Both clients subscribe to tasks
  client1.subscribe('tasks');
  client2.subscribe('tasks');

  // Wait for subscriptions
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('\n🎯 Demo: Smart update handling\n');

  // Client 1 creates a task
  console.log('Client 1 creating task...');
  await client1.createResource('tasks', {
    title: 'Buy groceries',
    completed: false
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Client 2 creates a task
  console.log('\nClient 2 creating task...');
  await client2.createResource('tasks', {
    title: 'Walk the dog',
    completed: false
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Server-side update (no socket ID)
  console.log('\nServer creating task directly...');
  await api.resources.tasks.create({
    title: 'Server-generated task',
    completed: false
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n✅ Demo complete! Notice how:');
  console.log('- Clients skip their own updates (already applied optimistically)');
  console.log('- Clients receive updates from other clients');
  console.log('- All clients receive server-initiated updates');
  console.log('\nPress Ctrl+C to exit.');
}

// Run the demo
demo().catch(console.error);