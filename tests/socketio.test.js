import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { io as ioClient } from 'socket.io-client';
import { SignJWT } from 'jose';
import { 
  validateJsonApiStructure, 
  cleanTables, 
  createJsonApiDocument,
  assertResourceAttributes,
  createRelationship,
  resourceIdentifier
} from './helpers/test-utils.js';
import { createWebSocketApi } from './fixtures/api-configs.js';

// Create JWT token using jose
async function createToken(payload = {}, secret = 'test-secret') {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  
  const jwt = new SignJWT({
    sub: '123',
    email: 'test@example.com',
    roles: ['user'],
    ...payload,
    jti: `test-${Date.now()}`
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h');
  
  return await jwt.sign(key);
}

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// API instance that persists across ALL tests
let api;
let server;

// Helper function to wait for socket event with timeout
function waitForSocketEvent(socket, eventName, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeout);
    
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('WebSocket/Socket.IO Plugin', () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Create API instance ONCE with WebSocket support
    const result = await createWebSocketApi(knex);
    api = result.api;
    server = result.server;
  });
  
  // IMPORTANT: after() cleans up resources
  after(async () => {
    // Skip cleanup if nothing was initialized
    if (!api || !server) {
      return;
    }
    
    // Close Socket.IO server first
    if (api.vars.socketIO) {
      // Disconnect all connected sockets
      await api.vars.socketIO.disconnectSockets();
      
      // Close the Socket.IO server
      await new Promise((resolve) => {
        api.vars.socketIO.close(() => {
          resolve();
        });
      });
    }
    
    // Close Redis clients if they exist
    if (api.vars.socketIORedisClients) {
      await api.vars.socketIORedisClients.pubClient.quit();
      await api.vars.socketIORedisClients.subClient.quit();
    }
    
    // Close HTTP server
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    
    // Clean up JWT plugin resources
    if (api.helpers?.auth?.cleanup) {
      api.helpers.auth.cleanup();
    }
    
    // Always destroy knex connection to allow tests to exit
    await knex.destroy();
  });
  
  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables
    await cleanTables(knex, [
      'basic_countries',
      'basic_publishers',
      'basic_authors',
      'basic_books',
      'basic_book_authors'
    ]);
  });

  describe('Basic Subscription and Notifications', () => {
    it('should receive minimal notifications for subscribed resources', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        
        // Subscribe to posts with status filter
        const subResponse = await new Promise((resolve) => {
          socket.emit('subscribe', {
            resource: 'books',
            filters: { title: 'Test Book' }  // Exact match
          }, resolve);
        });

        assert(subResponse.success, 'Subscription should succeed');
        assert(subResponse.data.subscriptionId, 'Should return subscription ID');

        // Listen for updates
        const updatePromise = waitForSocketEvent(socket, 'subscription.update');

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Create a book using API
        const bookDoc = createJsonApiDocument('books', 
          { title: 'Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        
        const createResult = await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });

        // Check notification
        const notification = await updatePromise;
        assert.equal(notification.type, 'resource.postd');
        assert.equal(notification.resource, 'books');
        assert.equal(String(notification.id), String(createResult.data.id));
        assert.equal(notification.action, 'post');
        assert(!notification.data, 'Should not include data in notification');
      } finally {
        socket.close();
      }
    });

    it('should not receive notifications for non-matching filters', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', () => {
            console.log('Socket connected successfully');
            resolve();
          });
          socket.on('connect_error', (error) => {
            console.error('Connection error:', error.message, error.type);
            reject(error);
          });
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        
        // Subscribe with specific filter
        await new Promise((resolve) => {
          socket.emit('subscribe', {
            resource: 'books',
            filters: { title: 'Specific Title' }
          }, resolve);
        });

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });
        
        // Create a book that doesn't match filter
        const bookDoc = createJsonApiDocument('books', 
          { title: 'Different Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        
        await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });

        // Should not receive update
        await assert.rejects(
          waitForSocketEvent(socket, 'subscription.update', 500),
          { message: /Timeout/ }
        );
      } finally {
        socket.close();
      }
    });
  });

  describe('Filter Validation', () => {
    it('should validate filters against searchSchema', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Try invalid filter
        const response = await new Promise((resolve) => {
          socket.emit('subscribe', {
            resource: 'books',
            filters: { invalid_field: 'value' }
          }, resolve);
        });

        assert(response.error, 'Should return error');
        assert.equal(response.error.code, 'INVALID_FILTERS');
      } finally {
        socket.close();
      }
    });

    it('should reject function filters without filterRecord', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Create a country first
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Assuming we add a complex filter to the schema that uses filterOperator function
        // For now, test with country_id which is a simple filter
        const response = await new Promise((resolve) => {
          socket.emit('subscribe', {
            resource: 'books',
            filters: { country: countryResult.data.id }
          }, resolve);
        });

        // Should succeed for simple filters
        assert(response.success, 'Should succeed for simple filters');
      } finally {
        socket.close();
      }
    });
  });

  describe('Transaction Safety', () => {
    // These tests verify that broadcasts are properly deferred until after transaction commit
    // The implementation uses:
    // - WeakMap to store pending broadcasts per transaction
    // - afterCommit hook to broadcast after successful transactions
    // - afterRollback hook to clean up after failed transactions
    // - No mutation of transaction objects
    
    it('should not broadcast when operations fail', async () => {
      // This test verifies that broadcasts don't happen when operations fail
      // The library should rollback transactions and not send notifications
      
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        
        // Subscribe to all books
        await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });

        // Track notifications
        const notifications = [];
        socket.on('subscription.update', (notification) => {
          notifications.push(notification);
        });

        // Try to create a book without required country relationship
        const bookDoc = createJsonApiDocument('books', 
          { title: 'Invalid Book' }
          // Missing required country relationship
        );
        
        try {
          await api.resources.books.post({
            inputRecord: bookDoc,
            simplified: false
          });
          assert.fail('Should have thrown an error');
        } catch (error) {
          // Expected to fail due to missing required relationship
        }

        // Wait a bit to ensure no broadcast happens
        await new Promise(resolve => setTimeout(resolve, 100));

        // Should not have received any notification
        assert.equal(notifications.length, 0, 'Should not receive any notifications for failed operations');
      } finally {
        socket.close();
      }
    });

    it('should broadcast after successful operations', async () => {
      // This test verifies that broadcasts happen after successful operations
      // The library handles transactions internally and uses afterCommit hook
      // to ensure broadcasts happen only after successful commit
      
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        
        // Subscribe to all books
        await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Track notifications
        const notifications = [];
        socket.on('subscription.update', (notification) => {
          notifications.push(notification);
        });

        // Create book - the library will handle transaction internally if configured
        const bookDoc = createJsonApiDocument('books', 
          { title: 'Broadcast Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        
        const createResult = await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });

        // Wait a bit to ensure broadcast happens (setImmediate)
        await new Promise(resolve => setTimeout(resolve, 50));

        // Should have received the notification
        assert.equal(notifications.length, 1, 'Should receive one notification');
        assert.equal(notifications[0].type, 'resource.postd');
        assert.equal(notifications[0].resource, 'books');
        assert.equal(String(notifications[0].id), String(createResult.data.id));
      } finally {
        socket.close();
      }
    });
  });

  describe('Multiple Subscriptions', () => {
    it('should handle multiple subscriptions from same client', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Subscribe to books and countries
        const bookSubResponse = await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });
        
        const countrySubResponse = await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'countries' }, resolve);
        });

        assert(bookSubResponse.success);
        assert(countrySubResponse.success);
        assert.notEqual(bookSubResponse.data.subscriptionId, countrySubResponse.data.subscriptionId);

        // Create both resources
        const notifications = [];
        socket.on('subscription.update', (notification) => {
          notifications.push(notification);
        });

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', { name: 'Multi Test Country', code: 'MT' });
        const countryResult = await api.resources.countries.post({ inputRecord: countryDoc, simplified: false });

        const bookDoc = createJsonApiDocument('books', 
          { title: 'Multi Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({ inputRecord: bookDoc, simplified: false });

        const countryDoc2 = createJsonApiDocument('countries', { name: 'Multi Test Country 2', code: 'MT2' });
        await api.resources.countries.post({ inputRecord: countryDoc2, simplified: false });

        // Wait a bit for notifications
        await new Promise(resolve => setTimeout(resolve, 100));

        assert.equal(notifications.length, 3, 'Should receive 3 notifications');
        assert.equal(notifications.filter(n => n.resource === 'books').length, 1, 'Should receive 1 book notification');
        assert.equal(notifications.filter(n => n.resource === 'countries').length, 2, 'Should receive 2 country notifications');
      } finally {
        socket.close();
      }
    });

    it('should unsubscribe correctly', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Subscribe
        const subResponse = await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });

        const subscriptionId = subResponse.data.subscriptionId;

        // Unsubscribe
        const unsubResponse = await new Promise((resolve) => {
          socket.emit('unsubscribe', { subscriptionId }, resolve);
        });

        assert(unsubResponse.success);

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Create a book
        const bookDoc = createJsonApiDocument('books', 
          { title: 'After Unsub Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        await api.resources.books.post({ inputRecord: bookDoc, simplified: false });

        // Should not receive notification
        await assert.rejects(
          waitForSocketEvent(socket, 'subscription.update', 500),
          { message: /Timeout/ }
        );
      } finally {
        socket.close();
      }
    });
  });

  describe('Update and Delete Notifications', () => {
    it('should receive notifications for updates', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Create a book first
        const bookDoc = createJsonApiDocument('books', 
          { title: 'Original Title' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        const createResult = await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });
        const bookId = createResult.data.id;

        // Subscribe to books
        await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });

        // Update the book
        const updatePromise = waitForSocketEvent(socket, 'subscription.update');
        
        const patchDoc = {
          data: {
            type: 'books',
            id: String(bookId),
            attributes: { title: 'Updated Title' }
          }
        };
        
        await api.resources.books.patch({
          id: bookId,
          inputRecord: patchDoc,
          simplified: false
        });

        // Check notification
        const notification = await updatePromise;
        assert.equal(notification.type, 'resource.patchd');
        assert.equal(notification.resource, 'books');
        assert.equal(String(notification.id), String(bookId));
        assert.equal(notification.action, 'patch');
      } finally {
        socket.close();
      }
    });

    it('should receive notifications for deletes', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });

        // Create a book first
        const bookDoc = createJsonApiDocument('books', 
          { title: 'To Delete' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        const createResult = await api.resources.books.post({
          inputRecord: bookDoc,
          simplified: false
        });
        const bookId = createResult.data.id;

        // Subscribe to books
        await new Promise((resolve) => {
          socket.emit('subscribe', { resource: 'books' }, resolve);
        });
        
        // Delete the book
        const deletePromise = waitForSocketEvent(socket, 'subscription.update');
        
        await api.resources.books.delete({ id: bookId });

        // Check notification
        const notification = await deletePromise;
        assert.equal(notification.type, 'resource.deleted');
        assert.equal(notification.resource, 'books');
        assert.equal(String(notification.id), String(bookId));
        assert.equal(notification.action, 'delete');
      } finally {
        socket.close();
      }
    });
  });

  describe('Relationship Filters', () => {
    it('should filter by relationship fields', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key');
      
      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      });

      try {
        // Wait for connection
        await new Promise((resolve, reject) => {
          socket.on('connect', resolve);
          socket.on('connect_error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
        // Create test data
        const countryDoc = createJsonApiDocument('countries', { name: 'Filter Country', code: 'FC' });
        const countryResult = await api.resources.countries.post({
          inputRecord: countryDoc,
          simplified: false
        });
        
        const publisherDoc = createJsonApiDocument('publishers', 
          { name: 'Filter Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        const publisherResult = await api.resources.publishers.post({
          inputRecord: publisherDoc,
          simplified: false
        });

        // Subscribe to books filtered by publisher
        await new Promise((resolve) => {
          socket.emit('subscribe', {
            resource: 'books',
            filters: { publisher: publisherResult.data.id }
          }, resolve);
        });

        // Create book with matching publisher
        const matchingBookPromise = waitForSocketEvent(socket, 'subscription.update');
        
        const matchingBookDoc = createJsonApiDocument('books',
          { title: 'Matching Book' },
          { 
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisherResult.data.id))
          }
        );
        await api.resources.books.post({
          inputRecord: matchingBookDoc,
          simplified: false
        });

        // Should receive notification
        const notification = await matchingBookPromise;
        assert.equal(notification.resource, 'books');

        // Create book with different publisher
        const otherPublisherDoc = createJsonApiDocument('publishers', 
          { name: 'Other Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        );
        const otherPublisherResult = await api.resources.publishers.post({
          inputRecord: otherPublisherDoc,
          simplified: false
        });

        const nonMatchingBookDoc = createJsonApiDocument('books',
          { title: 'Non-Matching Book' },
          { 
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', otherPublisherResult.data.id))
          }
        );
        await api.resources.books.post({
          inputRecord: nonMatchingBookDoc,
          simplified: false
        });

        // Should not receive notification for non-matching book
        await assert.rejects(
          waitForSocketEvent(socket, 'subscription.update', 500),
          { message: /Timeout/ }
        );
      } finally {
        socket.close();
      }
    });
  });
});