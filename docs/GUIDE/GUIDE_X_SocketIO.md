# WebSocket Real-time Updates with Socket.IO

## Table of Contents

1. [Overview](#overview)
2. [Server Setup](#server-setup)
3. [Core Concepts](#core-concepts)
4. [The Filter System](#the-filter-system)
5. [Security Architecture](#security-architecture)
6. [Advanced Features](#advanced-features)
7. [Client Usage](#client-usage)
8. [Performance Considerations](#performance-considerations)
9. [Troubleshooting](#troubleshooting)

## Overview

The Socket.IO plugin provides real-time notifications when resources change in your json-rest-api application. It implements a **notification-only pattern** - instead of broadcasting full data (which could leak sensitive information), it only sends minimal notifications about what changed. Clients then fetch the updated data through the regular REST API, ensuring all permissions and transformations are properly applied.

### Key Benefits

- **Security First**: No data leaks possible - notifications contain only resource type and ID
- **Performance**: One broadcast per change, not N database queries for N subscribers
- **Consistency**: Uses the same searchSchema as REST API for filtering
- **Transaction Safe**: Only broadcasts after database commits succeed
- **Scalable**: Supports Redis adapter for multi-server deployments

## Server Setup

### Installation

The Socket.IO plugin is included in json-rest-api core plugins. To use it, you need to:

1. Install Socket.IO dependencies:
```bash
npm install socket.io @socket.io/redis-adapter redis
```

2. Use the plugin and start the Socket.IO server:

```javascript
import { Api } from 'json-rest-api';
import { RestApiPlugin } from 'json-rest-api/plugins/rest-api';
import { RestApiKnexPlugin } from 'json-rest-api/plugins/rest-api-knex';
import { SocketIOPlugin } from 'json-rest-api/plugins/socketio';
import { JWTAuthPlugin } from 'json-rest-api/plugins/jwt-auth';

// Create your API instance
const api = new Api({
  name: 'my-api',
});

// Add required plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });
await api.use(JWTAuthPlugin, { secret: process.env.JWT_SECRET });
await api.use(SocketIOPlugin);

// Start your HTTP server
const server = app.listen(3000).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});

// Start Socket.IO server
const io = await api.startSocketServer(server, {
  path: '/socket.io',           // Socket.IO path (default: '/socket.io')
  cors: {                       // CORS configuration
    origin: '*',                // Configure for your security needs
    methods: ['GET', 'POST']
  },
  redis: {                      // Optional: Redis adapter for scaling
    host: 'localhost',
    port: 6379
  }
});
```

### Configuration Options

The `startSocketServer` method accepts these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | '/socket.io' | URL path for Socket.IO endpoint |
| `cors` | object | `{ origin: '*', methods: ['GET', 'POST'] }` | CORS configuration |
| `redis` | object | null | Redis configuration for multi-server setup |

### How It Works

1. **REST API Integration**: The plugin hooks into the REST API's `finish` event
2. **Transaction Awareness**: Waits for database commits before broadcasting
3. **Filter Matching**: Uses `context.minimalRecord` to check subscription filters
4. **Notification Broadcasting**: Sends minimal notifications to matching subscribers

## Core Concepts

### Notification-Only Pattern

Traditional WebSocket implementations often broadcast full data:

```javascript
// ❌ INSECURE: Broadcasting full data
io.emit('user.updated', {
  id: 123,
  name: 'John Doe',
  email: 'john@example.com',
  ssn: '123-45-6789',     // LEAKED to all subscribers!
  salary: 150000,         // LEAKED to all subscribers!
  medical_notes: '...'    // LEAKED to all subscribers!
});
```

Our implementation broadcasts only notifications:

```javascript
// ✅ SECURE: Notification only
socket.emit('subscription.update', {
  type: 'resource.updated',
  resource: 'users',
  id: '123',
  action: 'update',
  subscriptionId: 'users-12345-abc',
  meta: { timestamp: '2024-01-15T10:00:00Z' }
});
```

Clients then fetch data through REST API with proper permissions:

```javascript
// Client fetches with their permissions applied
const response = await fetch('/api/users/123', {
  headers: { Authorization: `Bearer ${token}` }
});
// Server applies all permission checks, field hiding, etc.
```

### searchSchema Integration

The plugin reuses your existing searchSchema definitions for filtering subscriptions. This ensures consistency between REST API queries and WebSocket subscriptions:

```javascript
// Define your resource with searchSchema
await api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    status: { type: 'string', defaultTo: 'draft' },
    author_id: { type: 'id', required: true },
    published_at: { type: 'dateTime', nullable: true },
    view_count: { type: 'number', defaultTo: 0 }
  },
  
  searchSchema: {
    // These filters work for both REST and WebSocket
    status: { type: 'string', filterOperator: '=' },
    author_id: { type: 'id', filterOperator: '=' },
    published_at: { type: 'dateTime', filterOperator: '>=' },
    view_count: { type: 'number', filterOperator: '>' }
  }
});

// REST API query
GET /api/posts?filter[status]=published&filter[view_count]=100

// WebSocket subscription - SAME filters!
socket.emit('subscribe', {
  resource: 'posts',
  filters: {
    status: 'published',
    view_count: 100
  }
});
```

### Transaction Safety

The plugin ensures broadcasts only happen after successful database commits:

```javascript
// In a transaction
const trx = await knex.transaction();
try {
  // Create a post
  const post = await api.resources.posts.post({
    inputRecord: { /* ... */ },
    transaction: trx
  });
  
  // At this point, NO broadcast has been sent
  
  await trx.commit();
  // NOW the broadcast is sent
} catch (error) {
  await trx.rollback();
  // No broadcast is ever sent
}
```

## The Filter System

### Simple Operator Filters

Filters using simple operators (`=`, `>`, `>=`, `<`, `<=`, `!=`, `like`, `in`, `between`) work automatically for both REST and WebSocket:

```javascript
searchSchema: {
  // Equality
  status: { type: 'string', filterOperator: '=' },
  
  // Comparison
  price: { type: 'number', filterOperator: '>=' },
  stock: { type: 'number', filterOperator: '>' },
  
  // Pattern matching
  title: { type: 'string', filterOperator: 'like' },
  
  // Multiple values
  category_id: { type: 'array', filterOperator: 'in' },
  
  // Range
  created_at: { type: 'date', filterOperator: 'between' }
}

// These work for both REST and WebSocket
socket.emit('subscribe', {
  resource: 'products',
  filters: {
    status: 'active',
    price: 99.99,
    title: 'phone',
    category_id: [1, 2, 3],
    created_at: ['2024-01-01', '2024-12-31']
  }
});
```

### Complex Filters with filterRecord

When `filterOperator` is a function (for complex SQL queries), you must provide `filterRecord` for WebSocket support:

```javascript
searchSchema: {
  // Complex multi-field search
  search: {
    type: 'string',
    
    // For REST API - builds SQL query
    filterOperator: function(query, value, { tableName }) {
      query.where(function() {
        this.where(`${tableName}.title`, 'like', `%${value}%`)
            .orWhere(`${tableName}.description`, 'like', `%${value}%`)
            .orWhere(`${tableName}.tags`, 'like', `%${value}%`);
      });
    },
    
    // For WebSocket - evaluates single record (REQUIRED!)
    filterRecord: function(record, value) {
      const search = value.toLowerCase();
      const title = (record.title || '').toLowerCase();
      const desc = (record.description || '').toLowerCase();
      const tags = (record.tags || []).join(' ').toLowerCase();
      
      return title.includes(search) || 
             desc.includes(search) || 
             tags.includes(search);
    }
  },
  
  // Location-based search
  near_location: {
    type: 'object',
    
    // REST: Haversine formula in SQL
    filterOperator: function(query, value, { tableName }) {
      const { lat, lng, radius = 10 } = value;
      query.whereRaw(`
        (6371 * acos(
          cos(radians(?)) * cos(radians(${tableName}.latitude)) *
          cos(radians(${tableName}.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(${tableName}.latitude))
        )) <= ?
      `, [lat, lng, lat, radius]);
    },
    
    // WebSocket: JavaScript distance calculation
    filterRecord: function(record, value) {
      const { lat, lng, radius = 10 } = value;
      const distance = calculateDistance(
        lat, lng, 
        record.latitude, record.longitude
      );
      return distance <= radius;
    }
  },
  
  // Custom business logic
  available_for_user: {
    type: 'object',
    
    // REST: Complex JOIN with user permissions
    filterOperator: function(query, value, { tableName }) {
      const { user_id, include_private } = value;
      query.where(`${tableName}.owner_id`, user_id);
      if (!include_private) {
        query.orWhere(`${tableName}.is_public`, true);
      }
    },
    
    // WebSocket: Same logic in JavaScript
    filterRecord: function(record, value) {
      const { user_id, include_private } = value;
      if (record.owner_id === user_id) return true;
      if (record.is_public) return true;
      return include_private && record.shared_with?.includes(user_id);
    }
  }
}
```

### Filter Validation

All filters are validated against searchSchema before subscription:

```javascript
// This subscription
socket.emit('subscribe', {
  resource: 'posts',
  filters: {
    status: 'published',      // ✅ Valid: defined in searchSchema
    invalid_field: 'value'    // ❌ Error: not in searchSchema
  }
});

// Returns error:
{
  error: {
    code: 'INVALID_FILTERS',
    message: 'Invalid filter values',
    details: {
      invalid_field: {
        code: 'UNKNOWN_FIELD',
        message: 'Field not defined in searchSchema'
      }
    }
  }
}
```

## Security Architecture

### Authentication

All connections must be authenticated using JWT tokens:

```javascript
// Client must provide valid JWT
const socket = io('http://localhost:3000', {
  auth: {
    token: 'eyJhbGciOiJIUzI1NiIs...' // Your JWT token
  }
});

// Without valid token, connection is rejected
socket.on('connect_error', (error) => {
  console.error('Authentication failed:', error.message);
});
```

### Permission Checking

Subscriptions require 'query' permission on the resource:

```javascript
// In your scope definition
await api.addResource('secret-documents', {
  // ... schema ...
  
  checkPermissions: async ({ method, auth }) => {
    if (method === 'query') {
      // Check if user can query/subscribe to this resource
      return auth.roles?.includes('admin');
    }
    // ... other permission checks
  }
});
```

### Filter Injection with Hooks

Use the `subscriptionFilters` hook to enforce security policies:

```javascript
// Multi-tenancy plugin example
export const MultiTenancyPlugin = {
  name: 'multi-tenancy',
  
  install({ addHook }) {
    // This hook runs for EVERY subscription
    addHook('subscriptionFilters', 'workspace-isolation', {}, 
      async ({ subscription, auth }) => {
        // Force workspace isolation
        if (!auth.workspace_id) {
          throw new Error('User must belong to a workspace');
        }
        
        // Always add workspace filter
        subscription.filters.workspace_id = auth.workspace_id;
        
        // Prevent bypassing workspace isolation
        if (subscription.filters.workspace_id && 
            subscription.filters.workspace_id !== auth.workspace_id) {
          throw new Error('Cannot subscribe to other workspaces');
        }
      }
    );
  }
};

// Now ALL subscriptions automatically include workspace filter
socket.emit('subscribe', {
  resource: 'projects',
  filters: { status: 'active' }
});
// Server automatically adds: filters.workspace_id = user's workspace
```

### Data Isolation Example

Here's a complete example showing how data isolation works:

```javascript
// User Roles Plugin
export const UserRolesPlugin = {
  name: 'user-roles',
  
  install({ addHook }) {
    // Filter subscriptions based on user role
    addHook('subscriptionFilters', 'role-based-filters', {}, 
      async ({ subscription, auth }) => {
        const { resource, filters } = subscription;
        
        // Regular users can only see their own data
        if (!auth.roles?.includes('admin')) {
          switch (resource) {
            case 'orders':
              subscription.filters.customer_id = auth.user_id;
              break;
              
            case 'invoices':
              subscription.filters.user_id = auth.user_id;
              break;
              
            case 'messages':
              // Can see messages where they're sender or recipient
              subscription.filters.$or = [
                { sender_id: auth.user_id },
                { recipient_id: auth.user_id }
              ];
              break;
              
            case 'admin-logs':
              throw new Error('Access denied to admin resources');
          }
        }
      }
    );
  }
};
```

## Advanced Features

### Redis Adapter for Scaling

When running multiple servers, use Redis adapter for proper broadcasting:

```javascript
// Server configuration
const io = await api.startSocketServer(server, {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0
  }
});

// Now broadcasts work across all servers
// Server A: Record updated → broadcast
// Server B: Receives broadcast → notifies its connected clients
```

### Subscription Management

Each socket can have multiple subscriptions with different filters:

```javascript
// Subscribe to different filtered views
const sub1 = await subscribeToResource(socket, {
  resource: 'orders',
  filters: { status: 'pending' }
});

const sub2 = await subscribeToResource(socket, {
  resource: 'orders',
  filters: { status: 'processing', priority: 'high' }
});

const sub3 = await subscribeToResource(socket, {
  resource: 'products',
  filters: { category_id: 5, in_stock: true }
});

// Unsubscribe from specific subscription
socket.emit('unsubscribe', { 
  subscriptionId: sub1.subscriptionId 
});
```

### Include and Fields Storage

While notifications don't include data, subscriptions can store include/fields preferences:

```javascript
// Subscribe with preferred includes and fields
socket.emit('subscribe', {
  resource: 'posts',
  filters: { status: 'published' },
  include: ['author', 'comments.user'],
  fields: {
    posts: ['title', 'summary', 'published_at'],
    users: ['name', 'avatar'],
    comments: ['body', 'created_at']
  }
});

// Client can use these when fetching
socket.on('subscription.update', async (notification) => {
  // Use the stored preferences for fetching
  const url = `/api/posts/${notification.id}?` +
    'include=author,comments.user&' +
    'fields[posts]=title,summary,published_at&' +
    'fields[users]=name,avatar';
    
  const response = await fetch(url);
});
```

### Reconnection Support

Restore subscriptions after reconnection:

```javascript
// Store active subscriptions
const activeSubscriptions = new Map();

socket.on('subscription.created', (response) => {
  activeSubscriptions.set(response.subscriptionId, response);
});

// On reconnect, restore all subscriptions
socket.on('connect', async () => {
  if (activeSubscriptions.size > 0) {
    const { restored, failed } = await restoreSubscriptions(
      socket, 
      Array.from(activeSubscriptions.values())
    );
    
    console.log(`Restored ${restored.length} subscriptions`);
    if (failed.length > 0) {
      console.error(`Failed to restore ${failed.length} subscriptions`);
    }
  }
});

async function restoreSubscriptions(socket, subscriptions) {
  return new Promise((resolve) => {
    socket.emit('restore-subscriptions', 
      { subscriptions }, 
      resolve
    );
  });
}
```

### Error Handling

The plugin provides detailed error information:

```javascript
socket.on('subscription.error', (error) => {
  switch (error.code) {
    case 'RESOURCE_NOT_FOUND':
      console.error(`Resource type '${error.resource}' doesn't exist`);
      break;
      
    case 'PERMISSION_DENIED':
      console.error('You lack permission to subscribe to this resource');
      break;
      
    case 'INVALID_FILTERS':
      console.error('Filter validation failed:', error.details);
      break;
      
    case 'UNSUPPORTED_FILTER':
      console.error(`Filter requires 'filterRecord' for WebSocket support`);
      break;
      
    case 'FILTERING_NOT_ENABLED':
      console.error('Resource does not have searchSchema defined');
      break;
  }
});
```

## Client Usage

### Basic Setup

```javascript
import { io } from 'socket.io-client';

// Connect with authentication
const socket = io('http://localhost:3000', {
  auth: {
    token: localStorage.getItem('jwt_token')
  }
});

// Handle connection events
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('Connection failed:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});
```

### Subscribing to Resources

```javascript
// Helper function for subscribing
async function subscribeToResource(socket, options) {
  return new Promise((resolve, reject) => {
    socket.emit('subscribe', options, (response) => {
      if (response.error) {
        reject(response.error);
      } else {
        resolve(response.data);
      }
    });
  });
}

// Subscribe to filtered resources
try {
  const subscription = await subscribeToResource(socket, {
    resource: 'posts',
    filters: {
      status: 'published',
      category_id: 5
    }
  });
  
  console.log('Subscribed:', subscription.subscriptionId);
} catch (error) {
  console.error('Subscription failed:', error);
}
```

### Handling Updates

```javascript
// Set up update handler
socket.on('subscription.update', async (notification) => {
  console.log('Resource updated:', notification);
  // {
  //   type: 'resource.updated',
  //   resource: 'posts',
  //   id: '123',
  //   action: 'update',
  //   subscriptionId: 'posts-1234567-abc',
  //   meta: { timestamp: '2024-01-15T10:00:00Z' }
  // }
  
  // Handle different actions
  switch (notification.action) {
    case 'post':
      await handleNewResource(notification);
      break;
      
    case 'update':
    case 'patch':
      await handleUpdatedResource(notification);
      break;
      
    case 'delete':
      await handleDeletedResource(notification);
      break;
  }
});

// Fetch updated data when needed
async function handleUpdatedResource(notification) {
  // Check if user is viewing this resource
  if (isCurrentlyViewing(notification.resource, notification.id)) {
    // Fetch immediately
    const response = await fetch(
      `/api/${notification.resource}/${notification.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      updateUI(data);
    }
  } else {
    // Just invalidate cache
    cacheManager.invalidate(notification.resource, notification.id);
  }
}
```

### Complete Client Example

```javascript
class RealtimeResourceManager {
  constructor(apiUrl, token) {
    this.apiUrl = apiUrl;
    this.token = token;
    this.subscriptions = new Map();
    this.cache = new Map();
    
    this.socket = io(apiUrl, {
      auth: { token }
    });
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.restoreSubscriptions();
    });
    
    this.socket.on('subscription.update', (notification) => {
      this.handleUpdate(notification);
    });
    
    this.socket.on('subscription.created', (response) => {
      this.subscriptions.set(response.subscriptionId, response);
    });
  }
  
  async subscribe(resource, filters = {}, options = {}) {
    return new Promise((resolve, reject) => {
      this.socket.emit('subscribe', {
        resource,
        filters,
        ...options
      }, (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response.data);
        }
      });
    });
  }
  
  async handleUpdate(notification) {
    const { resource, id, action } = notification;
    
    // Invalidate cache
    const cacheKey = `${resource}:${id}`;
    this.cache.delete(cacheKey);
    
    // Emit custom event for UI updates
    this.emit('resource:updated', {
      resource,
      id,
      action,
      notification
    });
  }
  
  async fetchResource(resource, id, options = {}) {
    const cacheKey = `${resource}:${id}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Fetch from API
    const queryString = new URLSearchParams(options).toString();
    const url = `${this.apiUrl}/${resource}/${id}${queryString ? '?' + queryString : ''}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${resource}/${id}`);
    }
    
    const data = await response.json();
    
    // Cache the result
    this.cache.set(cacheKey, data);
    
    return data;
  }
  
  async restoreSubscriptions() {
    if (this.subscriptions.size === 0) return;
    
    const subscriptions = Array.from(this.subscriptions.values());
    
    return new Promise((resolve) => {
      this.socket.emit('restore-subscriptions', 
        { subscriptions }, 
        (response) => {
          if (response.error) {
            console.error('Failed to restore subscriptions:', response.error);
          } else {
            console.log(`Restored ${response.restored.length} subscriptions`);
          }
          resolve(response);
        }
      );
    });
  }
}

// Usage
const realtime = new RealtimeResourceManager(
  'http://localhost:3000',
  localStorage.getItem('jwt_token')
);

// Subscribe to posts
await realtime.subscribe('posts', {
  status: 'published',
  author_id: currentUser.id
});

// React to updates
realtime.on('resource:updated', async ({ resource, id, action }) => {
  if (resource === 'posts' && isViewingPost(id)) {
    const post = await realtime.fetchResource('posts', id, {
      include: 'author,comments'
    });
    updatePostUI(post);
  }
});
```

## Performance Considerations

### Subscription Limits

Each socket is limited to 100 subscriptions to prevent memory exhaustion:

```javascript
// After 100 subscriptions, new ones are rejected
socket.emit('subscribe', { resource: 'posts' }, (response) => {
  if (response.error?.code === 'SUBSCRIPTION_LIMIT_EXCEEDED') {
    console.error('Too many active subscriptions');
  }
});
```

### Filter Efficiency

- **Simple operators** (`=`, `>`, etc.) are very fast - just property comparisons
- **Complex filters** with `filterRecord` functions should be kept lightweight
- **Avoid expensive operations** in filterRecord (no async calls, minimal computation)

### Broadcast Optimization

The plugin optimizes broadcasts by:

1. **Single broadcast per change** - Not N broadcasts for N subscribers
2. **Room-based delivery** - Socket.IO efficiently handles room broadcasts
3. **Minimal payload** - Notifications are tiny (< 200 bytes)
4. **In-memory filtering** - Uses context.minimalRecord, no database queries

### Client-Side Optimization

Optimize your client implementation:

```javascript
// Batch fetch requests
const pendingFetches = new Set();

socket.on('subscription.update', (notification) => {
  pendingFetches.add(`${notification.resource}:${notification.id}`);
});

// Fetch in batches every 100ms
setInterval(async () => {
  if (pendingFetches.size === 0) return;
  
  const toFetch = Array.from(pendingFetches);
  pendingFetches.clear();
  
  // Batch fetch multiple resources
  const results = await Promise.all(
    toFetch.map(key => {
      const [resource, id] = key.split(':');
      return fetchResource(resource, id);
    })
  );
  
  // Update UI with all results
  updateBatchUI(results);
}, 100);
```

## Troubleshooting

### Common Issues

**1. Subscriptions not receiving updates**

Check:
- Are filters too restrictive?
- Does the record pass `context.minimalRecord` filtering?
- Are you in a transaction that hasn't committed?

**2. "UNSUPPORTED_FILTER" errors**

If using custom filterOperator functions, you must provide filterRecord:

```javascript
// ❌ This will error for WebSocket
searchSchema: {
  complex_search: {
    type: 'string',
    filterOperator: function(query, value) { /* SQL */ }
  }
}

// ✅ This works for both REST and WebSocket
searchSchema: {
  complex_search: {
    type: 'string',
    filterOperator: function(query, value) { /* SQL */ },
    filterRecord: function(record, value) { /* JavaScript */ }
  }
}
```

**3. Authentication failures**

Ensure:
- JWT token is valid and not expired
- Token is sent in auth.token, not headers
- JWT plugin is configured correctly

**4. Redis connection issues**

If using Redis adapter:
- Check Redis server is running
- Verify connection credentials
- Ensure all servers use same Redis instance

### Debug Logging

Enable debug logging to troubleshoot:

```javascript
// Server-side
const api = new Api({
  name: 'my-api',
  logging: { level: 'debug' }
});

// Client-side
localStorage.debug = 'socket.io-client:*';
```

### Testing WebSocket Functionality

```javascript
// Test helper for WebSocket subscriptions
async function testWebSocketSubscription() {
  const socket = io('http://localhost:3000', {
    auth: { token: testToken }
  });
  
  return new Promise((resolve, reject) => {
    socket.on('connect', async () => {
      console.log('✓ Connected to WebSocket');
      
      // Test subscription
      socket.emit('subscribe', {
        resource: 'posts',
        filters: { status: 'published' }
      }, (response) => {
        if (response.error) {
          console.error('✗ Subscription failed:', response.error);
          reject(response.error);
        } else {
          console.log('✓ Subscription successful:', response.data);
          
          // Wait for an update
          socket.once('subscription.update', (notification) => {
            console.log('✓ Received update:', notification);
            socket.close();
            resolve(notification);
          });
          
          // Trigger an update
          createTestPost();
        }
      });
    });
    
    socket.on('connect_error', (error) => {
      console.error('✗ Connection failed:', error.message);
      reject(error);
    });
  });
}
```