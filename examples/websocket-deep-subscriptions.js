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

// Define schemas with relationships
api.addResource('countries', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  code: { type: 'string', required: true }
}));

api.addResource('users', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string' },
  countryId: { 
    type: 'id', 
    refs: { 
      resource: 'countries',
      join: { eager: true }
    }
  }
}));

api.addResource('addresses', new Schema({
  id: { type: 'id' },
  street: { type: 'string', required: true },
  city: { type: 'string' },
  userId: { type: 'id', searchable: true },
  countryId: { 
    type: 'id',
    refs: { resource: 'countries' }
  }
}));

// Add addresses as virtual field to users
api.schemas.get('users').structure.addresses = {
  type: 'list',
  virtual: true,
  foreignResource: 'addresses',
  foreignKey: 'userId'
};

// Connect and start server
await api.connect();
api.websocket.init(server);

const port = 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Demo client code
async function demoDeepSubscriptions() {
  // Create test data
  const usa = await api.resources.countries.create({
    name: 'United States',
    code: 'US'
  });

  const user = await api.resources.users.create({
    name: 'John Doe',
    email: 'john@example.com',
    countryId: usa.data.id
  });

  const address1 = await api.resources.addresses.create({
    street: '123 Main St',
    city: 'New York',
    userId: user.data.id,
    countryId: usa.data.id
  });

  const address2 = await api.resources.addresses.create({
    street: '456 Oak Ave',
    city: 'Boston',
    userId: user.data.id,
    countryId: usa.data.id
  });

  // Connect WebSocket client
  const client = ioClient(`http://localhost:${port}`, {
    transports: ['websocket']
  });

  await new Promise(resolve => client.on('connect', resolve));
  console.log('WebSocket connected');

  // Subscribe to user with deep includes
  // excludeSelf: true means this client won't receive notifications for its own changes
  client.emit('subscribe', {
    resource: 'users',
    id: user.data.id,
    include: 'countryId,addresses,addresses.countryId',
    excludeSelf: true  // Don't notify me of my own changes
  });

  // Listen for real-time updates
  client.on('resource:updated', (data) => {
    console.log('\n📨 Real-time update received:');
    console.log(`Resource: ${data.resource}`);
    console.log(`ID: ${data.id}`);
    
    if (data.resource === 'countries') {
      console.log(`Country updated: ${data.data.attributes.name}`);
    } else if (data.resource === 'users') {
      console.log(`User updated: ${data.data.attributes.name}`);
    } else if (data.resource === 'addresses') {
      console.log(`Address updated: ${data.data.attributes.street}`);
    }
  });

  client.on('resource:created', (data) => {
    console.log('\n✨ New resource created:');
    console.log(`Resource: ${data.resource}`);
    if (data.filter) {
      console.log(`Matching filter:`, data.filter);
    }
  });

  // Wait for subscription confirmation
  await new Promise(resolve => {
    client.on('subscription:success', (data) => {
      console.log('\n✅ Subscription successful:', data);
      resolve();
    });
  });

  // Demo updates that will trigger real-time notifications
  console.log('\n🔄 Making changes to test real-time updates...\n');
  console.log('Note: excludeSelf is set to true, so this client won\'t see its own changes');
  console.log('but will see changes made by other clients or server-side operations.\n');

  // 1. Update the country (will notify because user references it)
  setTimeout(async () => {
    console.log('Updating country name...');
    await api.resources.countries.update(usa.data.id, {
      name: 'United States of America'
    });
  }, 1000);

  // 2. Update an address (will notify because it belongs to the user)
  setTimeout(async () => {
    console.log('Updating address...');
    await api.resources.addresses.update(address1.data.id, {
      street: '123 Main Street Suite 100'
    });
  }, 2000);

  // 3. Create a new address for the user (will notify via filter)
  setTimeout(async () => {
    console.log('Creating new address for user...');
    await api.resources.addresses.create({
      street: '789 Pine Rd',
      city: 'Chicago',
      userId: user.data.id,
      countryId: usa.data.id
    });
  }, 3000);

  // 4. Update the user directly
  setTimeout(async () => {
    console.log('Updating user email...');
    await api.resources.users.update(user.data.id, {
      email: 'john.doe@example.com'
    });
  }, 4000);

  // Keep the demo running
  setTimeout(() => {
    console.log('\n👋 Demo complete! Press Ctrl+C to exit.');
  }, 5000);
  
  // Optional: Create a second client to demonstrate the difference
  setTimeout(async () => {
    console.log('\n🔄 Creating second client without excludeSelf...');
    
    const client2 = ioClient(`http://localhost:${port}`, {
      transports: ['websocket']
    });
    
    await new Promise(resolve => client2.on('connect', resolve));
    
    // This client will receive ALL updates, including its own
    client2.emit('subscribe', {
      resource: 'addresses',
      filter: { userId: user.data.id },
      excludeSelf: false  // Default behavior - get all notifications
    });
    
    client2.on('resource:created', (data) => {
      console.log('\n📢 Client 2 sees new address:', data.data.attributes.street);
    });
    
    // Client 2 creates an address - it WILL see its own creation
    setTimeout(async () => {
      console.log('\nClient 2 creating address (will see its own change)...');
      await api.resources.addresses.create({
        street: '999 Elm St',
        city: 'Seattle',
        userId: user.data.id,
        countryId: usa.data.id
      });
    }, 500);
  }, 4500);
}

// Run the demo
demoDeepSubscriptions().catch(console.error);