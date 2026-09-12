import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import knexLib from 'knex'
import { io as ioClient } from 'socket.io-client'
import { SignJWT } from 'jose'
import {

  cleanTables,
  createJsonApiDocument,
  createRelationship,
  resourceIdentifier
} from './helpers/test-utils.js'
import { createWebSocketApi, closeWebSocketApi } from './fixtures/api-configs.js'
import { waitForSocketEvent, installSocketBarrier, drainSocketEvents } from './helpers/socketio.js'

// Create JWT token using jose
async function createToken (payload = {}, secret = 'test-secret-key') {
  const encoder = new TextEncoder()
  const key = encoder.encode(secret)

  const jwt = new SignJWT({
    sub: '123',
    email: 'test@example.com',
    roles: ['user'],
    ...payload,
    jti: `test-${Date.now()}`
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')

  return await jwt.sign(key)
}

// Create Knex instance for tests
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
})

// API instance that persists across ALL tests
let api
let server

describe('WebSocket/Socket.IO Plugin', () => {
  // IMPORTANT: before() runs ONCE for the entire test suite
  before(async () => {
    // Create API instance ONCE with WebSocket support
    const result = await createWebSocketApi(knex)
    api = result.api
    server = result.server
    installSocketBarrier(api.io)
  })

  // IMPORTANT: after() cleans up resources
  after(async () => {
    try {
      await closeWebSocketApi(api, server)
    } finally {
      await knex.destroy()
    }
  })

  // IMPORTANT: beforeEach() cleans data but does NOT recreate API
  beforeEach(async () => {
    // Clean all tables
    await cleanTables(knex, [
      'basic_countries',
      'basic_publishers',
      'basic_authors',
      'basic_books',
      'basic_book_authors'
    ])
  })

  describe('Basic Subscription and Notifications', () => {
    it('should receive minimal notifications for subscribed resources', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')

        // Subscribe to posts with status filter
        const subResponse = await socket.timeout(5000).emitWithAck('subscribe', {
          resource: 'books',
          filters: { title: 'Test Book' }  // Exact match
        })

        assert(subResponse.success, 'Subscription should succeed')
        assert(subResponse.data.subscriptionId, 'Should return subscription ID')

        // Listen for updates
        const updatePromise = waitForSocketEvent(socket, 'subscription.update')

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        // Create a book using API
        const bookDoc = createJsonApiDocument('books',
          { title: 'Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )

        const createResult = await api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        })

        // Check notification
        const notification = await updatePromise
        assert.equal(notification.type, 'resource.created')
        assert.equal(notification.resource, 'books')
        assert.equal(String(notification.id), String(createResult.data.id))
        assert.equal(notification.action, 'post')
        assert(!notification.data, 'Should not include data in notification')
      } finally {
        socket.close()
      }
    })

    it('should not receive notifications for non-matching filters', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')

        // Subscribe with specific filter
        await socket.timeout(5000).emitWithAck('subscribe', {
          resource: 'books',
          filters: { title: 'Specific Title' }
        })

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        const notifications = []
        socket.on('subscription.update', value => notifications.push(value))

        // Create a book that doesn't match filter
        const bookDoc = createJsonApiDocument('books',
          { title: 'Different Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )

        await api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        })

        // Should not receive update
        await drainSocketEvents(socket)
        assert.deepEqual(notifications, [])
      } finally {
        socket.close()
      }
    })
  })

  describe('Filter Validation', () => {
    it('should validate filters against searchSchema', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Try invalid filter
        const response = await socket.timeout(5000).emitWithAck('subscribe', {
          resource: 'books',
          filters: { invalid_field: 'value' }
        })

        assert(response.error, 'Should return error')
        assert.equal(response.error.code, 'INVALID_FILTERS')
      } finally {
        socket.close()
      }
    })

    it('accepts a public relationship filter', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Create a country first
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        // Subscribe using the public relationship alias.
        const response = await socket.timeout(5000).emitWithAck('subscribe', {
          resource: 'books',
          filters: { country: countryResult.data.id }
        })

        // Should succeed for simple filters
        assert(response.success, 'Should succeed for simple filters')
      } finally {
        socket.close()
      }
    })
  })

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

      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')

        // Subscribe to all books
        await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        // Track notifications
        const notifications = []
        socket.on('subscription.update', (notification) => {
          notifications.push(notification)
        })

        // Try to create a book without required country relationship
        const bookDoc = createJsonApiDocument('books',
          { title: 'Invalid Book' }
          // Missing required country relationship
        )

        await assert.rejects(api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        }))

        // Flush server packets before asserting absence
        await drainSocketEvents(socket)

        // Should not have received any notification
        assert.equal(notifications.length, 0, 'Should not receive any notifications for failed operations')
      } finally {
        socket.close()
      }
    })

    it('should broadcast after successful operations', async () => {
      // This test verifies that broadcasts happen after successful operations
      // The library handles transactions internally and uses afterCommit hook
      // to ensure broadcasts happen only after successful commit

      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')

        // Subscribe to all books
        await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        // Track notifications
        const notifications = []
        socket.on('subscription.update', (notification) => {
          notifications.push(notification)
        })

        // Create book - the library will handle transaction internally if configured
        const bookDoc = createJsonApiDocument('books',
          { title: 'Broadcast Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )

        const createResult = await api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        })

        // Flush server packets after the committed operation
        await drainSocketEvents(socket)

        // Should have received the notification
        assert.equal(notifications.length, 1, 'Should receive one notification')
        assert.equal(notifications[0].type, 'resource.created')
        assert.equal(notifications[0].resource, 'books')
        assert.equal(String(notifications[0].id), String(createResult.data.id))
      } finally {
        socket.close()
      }
    })

    it('should broadcast deferred patch notifications from relationship PATCH', async () => {
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')

        const country = await api.resources.countries.post({
          document: createJsonApiDocument('countries', {
            name: 'Original Country',
            code: 'OC'
          }),
          format: 'jsonapi'
        })

        const nextCountry = await api.resources.countries.post({
          document: createJsonApiDocument('countries', {
            name: 'Next Country',
            code: 'NC'
          }),
          format: 'jsonapi'
        })

        const book = await api.resources.books.post({
          document: createJsonApiDocument(
            'books',
            { title: 'Relationship Patch Broadcast' },
            { country: createRelationship(resourceIdentifier('countries', country.data.id)) }
          ),
          format: 'jsonapi'
        })

        await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        const updatePromise = waitForSocketEvent(socket, 'subscription.update', 1000)

        await api.resources.books.patchRelationship({
          id: book.data.id,
          relationshipName: 'country',
          relationshipData: resourceIdentifier('countries', nextCountry.data.id)
        })

        const notification = await updatePromise
        assert.equal(notification.type, 'resource.updated')
        assert.equal(notification.resource, 'books')
        assert.equal(String(notification.id), String(book.data.id))
        assert.equal(notification.action, 'patch')
      } finally {
        socket.close()
      }
    })
  })

  describe('Multiple Subscriptions', () => {
    it('should handle multiple subscriptions from same client', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Subscribe to books and countries
        const bookSubResponse = await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        const countrySubResponse = await socket.timeout(5000).emitWithAck('subscribe', { resource: 'countries' })

        assert(bookSubResponse.success)
        assert(countrySubResponse.success)
        assert.notEqual(bookSubResponse.data.subscriptionId, countrySubResponse.data.subscriptionId)

        // Create both resources
        const notifications = []
        socket.on('subscription.update', (notification) => {
          notifications.push(notification)
        })

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', { name: 'Multi Test Country', code: 'MT' })
        const countryResult = await api.resources.countries.post({ document: countryDoc, format: 'jsonapi' })

        const bookDoc = createJsonApiDocument('books',
          { title: 'Multi Test Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        await api.resources.books.post({ document: bookDoc, format: 'jsonapi' })

        const countryDoc2 = createJsonApiDocument('countries', { name: 'Multi Test Country 2', code: 'MT2' })
        await api.resources.countries.post({ document: countryDoc2, format: 'jsonapi' })

        // Flush server packets after the writes
        await drainSocketEvents(socket)

        assert.equal(notifications.length, 3, 'Should receive 3 notifications')
        assert.equal(notifications.filter(n => n.resource === 'books').length, 1, 'Should receive 1 book notification')
        assert.equal(notifications.filter(n => n.resource === 'countries').length, 2, 'Should receive 2 country notifications')
      } finally {
        socket.close()
      }
    })

    it('should unsubscribe correctly', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Subscribe
        const subResponse = await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        const subscriptionId = subResponse.data.subscriptionId

        // Unsubscribe
        const unsubResponse = await socket.timeout(5000).emitWithAck('unsubscribe', { subscriptionId })

        assert(unsubResponse.success)

        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        const notifications = []
        socket.on('subscription.update', value => notifications.push(value))

        // Create a book
        const bookDoc = createJsonApiDocument('books',
          { title: 'After Unsub Book' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        await api.resources.books.post({ document: bookDoc, format: 'jsonapi' })

        // Should not receive notification
        await drainSocketEvents(socket)
        assert.deepEqual(notifications, [])
      } finally {
        socket.close()
      }
    })
  })

  describe('Update and Delete Notifications', () => {
    it('should receive notifications for updates', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        // Create a book first
        const bookDoc = createJsonApiDocument('books',
          { title: 'Original Title' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        const createResult = await api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        })
        const bookId = createResult.data.id

        // Subscribe to books
        await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        // Update the book
        const updatePromise = waitForSocketEvent(socket, 'subscription.update')

        const patchDoc = {
          data: {
            type: 'books',
            id: String(bookId),
            attributes: { title: 'Updated Title' }
          }
        }

        await api.resources.books.patch({
          id: bookId,
          document: patchDoc,
          format: 'jsonapi'
        })

        // Check notification
        const notification = await updatePromise
        assert.equal(notification.type, 'resource.updated')
        assert.equal(notification.resource, 'books')
        assert.equal(String(notification.id), String(bookId))
        assert.equal(notification.action, 'patch')
      } finally {
        socket.close()
      }
    })

    it('should receive notifications for deletes', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Create a country first (required for books)
        const countryDoc = createJsonApiDocument('countries', {
          name: 'Test Country',
          code: 'TC'
        })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        // Create a book first
        const bookDoc = createJsonApiDocument('books',
          { title: 'To Delete' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        const createResult = await api.resources.books.post({
          document: bookDoc,
          format: 'jsonapi'
        })
        const bookId = createResult.data.id

        // Subscribe to books
        await socket.timeout(5000).emitWithAck('subscribe', { resource: 'books' })

        // Delete the book
        const deletePromise = waitForSocketEvent(socket, 'subscription.update')

        await api.resources.books.delete({ id: bookId })

        // Check notification
        const notification = await deletePromise
        assert.equal(notification.type, 'resource.deleted')
        assert.equal(notification.resource, 'books')
        assert.equal(String(notification.id), String(bookId))
        assert.equal(notification.action, 'delete')
      } finally {
        socket.close()
      }
    })
  })

  describe('Relationship Filters', () => {
    it('should filter by relationship fields', async () => {
      // Generate a real JWT token for testing
      const token = await createToken({ userId: 'test-user', role: 'user' }, 'test-secret-key')

      const socket = ioClient(`http://localhost:${server.address().port}`, {
        path: '/api/socket.io',
        auth: { token }
      })

      try {
        // Wait for connection
        await waitForSocketEvent(socket, 'connect', 5000, 'connect_error')
        // Create test data
        const countryDoc = createJsonApiDocument('countries', { name: 'Filter Country', code: 'FC' })
        const countryResult = await api.resources.countries.post({
          document: countryDoc,
          format: 'jsonapi'
        })

        const publisherDoc = createJsonApiDocument('publishers',
          { name: 'Filter Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        const publisherResult = await api.resources.publishers.post({
          document: publisherDoc,
          format: 'jsonapi'
        })

        // Subscribe to books filtered by publisher
        await socket.timeout(5000).emitWithAck('subscribe', {
          resource: 'books',
          filters: { publisher: publisherResult.data.id }
        })

        // Create book with matching publisher
        const matchingBookPromise = waitForSocketEvent(socket, 'subscription.update')

        const matchingBookDoc = createJsonApiDocument('books',
          { title: 'Matching Book' },
          {
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', publisherResult.data.id))
          }
        )
        await api.resources.books.post({
          document: matchingBookDoc,
          format: 'jsonapi'
        })

        // Should receive notification
        const notification = await matchingBookPromise
        assert.equal(notification.resource, 'books')

        // Create book with different publisher
        const otherPublisherDoc = createJsonApiDocument('publishers',
          { name: 'Other Publisher' },
          { country: createRelationship(resourceIdentifier('countries', countryResult.data.id)) }
        )
        const otherPublisherResult = await api.resources.publishers.post({
          document: otherPublisherDoc,
          format: 'jsonapi'
        })

        const notifications = []
        socket.on('subscription.update', value => notifications.push(value))

        const nonMatchingBookDoc = createJsonApiDocument('books',
          { title: 'Non-Matching Book' },
          {
            country: createRelationship(resourceIdentifier('countries', countryResult.data.id)),
            publisher: createRelationship(resourceIdentifier('publishers', otherPublisherResult.data.id))
          }
        )
        await api.resources.books.post({
          document: nonMatchingBookDoc,
          format: 'jsonapi'
        })

        // Should not receive notification for non-matching book
        await drainSocketEvents(socket)
        assert.deepEqual(notifications, [])
      } finally {
        socket.close()
      }
    })
  })
})
