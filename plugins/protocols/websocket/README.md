# WebSocket Plugin

Real-time bidirectional communication for your JSON REST API with automatic relationship tracking and intelligent update handling.

## Features

- 🔄 **Real-time Updates** - Automatic broadcasts for all CRUD operations
- 🎯 **Deep Subscriptions** - Subscribe to resources and their relationships with a single call
- 🧠 **Smart Client Updates** - Metadata for intelligent client-side handling
- 🌐 **Multi-Server Support** - Redis adapter for horizontal scaling
- 🔐 **Authentication** - JWT-based authentication with user rooms
- 📊 **Live Queries** - Track query results with automatic updates
- 👥 **Presence Tracking** - Know who's online in real-time
- ⚡ **Rate Limiting** - Built-in protection against abuse

## Installation

```javascript
import { WebSocketPlugin } from '@json-rest-api/websocket';
import { Api } from 'json-rest-api';

const api = new Api();
api.use(WebSocketPlugin, {
  jwtSecret: 'your-secret-key',
  rateLimit: { points: 100, duration: 60 }
});
```

## Basic Usage

### Server Setup

```javascript
import express from 'express';
import { createServer } from 'http';

const app = express();
const server = createServer(app);

// Initialize WebSocket server
api.websocket.init(server);

server.listen(3000);
```

### Client Connection

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['websocket'],
  auth: {
    token: 'your-jwt-token' // Optional authentication
  }
});

// Get your socket ID for tracking
socket.on('connection:established', (data) => {
  console.log('Connected with ID:', data.socketId);
});
```

## Subscriptions

### Basic Resource Subscription

```javascript
// Subscribe to a single resource
socket.emit('subscribe', {
  resource: 'users',
  id: 123
});

// Subscribe to all resources of a type
socket.emit('subscribe', {
  resource: 'posts'
});

// Subscribe with filters
socket.emit('subscribe', {
  resource: 'posts',
  filter: { status: 'published', authorId: 123 }
});
```

### Deep Subscriptions (Include Relationships)

Subscribe to a resource and its related data in one call:

```javascript
// Subscribe to user and their relationships
socket.emit('subscribe', {
  resource: 'users',
  id: 123,
  include: 'countryId,addresses,addresses.countryId'
});
```

This automatically subscribes to:
- The user record
- The user's country (1:1 relationship)
- All user's addresses (1:n relationship)
- Each address's country (nested relationship)

### Subscription Options

```javascript
socket.emit('subscribe', {
  resource: 'tasks',
  filter: { userId: 123 },
  include: 'projectId,tags',
  excludeSelf: true,  // Don't receive notifications for your own changes
  options: {
    liveQuery: true   // Track query results
  }
});
```

## Receiving Updates

### Update Events

```javascript
// Resource created
socket.on('resource:created', (event) => {
  console.log('New resource:', event.resource);
  console.log('Data:', event.data);
  console.log('Metadata:', event.meta);
});

// Resource updated
socket.on('resource:updated', (event) => {
  console.log('Updated:', event.resource, event.id);
  console.log('New data:', event.data);
});

// Resource deleted
socket.on('resource:deleted', (event) => {
  console.log('Deleted:', event.resource, event.id);
});
```

### Event Metadata

All broadcast events include metadata for intelligent handling:

```javascript
{
  resource: 'tasks',
  data: { id: '1', type: 'tasks', attributes: { ... } },
  meta: {
    originSocketId: 'abc123',        // Socket that initiated the change
    requestId: 'req-1234-abcd',      // Unique request identifier
    timestamp: '2024-01-15T10:30:00Z'
  }
}
```

## Smart Client Updates

### Tracking Your Own Changes

Prevent double updates and confirm operations:

```javascript
class SmartClient {
  constructor() {
    this.pendingRequests = new Map();
    this.socketId = null;
  }

  connect() {
    this.socket = io('http://localhost:3000');
    
    this.socket.on('connection:established', (data) => {
      this.socketId = data.socketId;
    });

    this.socket.on('resource:created', (event) => {
      // Check if this is our own request
      if (event.meta.requestId && this.pendingRequests.has(event.meta.requestId)) {
        console.log('✅ Our operation confirmed');
        this.pendingRequests.delete(event.meta.requestId);
        return; // Skip UI update - already done optimistically
      }

      // Update from another client
      this.updateUI(event.data);
    });
  }

  createResource(resource, data) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Track pending request
    this.pendingRequests.set(requestId, { resource, data });
    
    // Send with request ID
    this.socket.emit('resource:create', {
      resource,
      data,
      requestId
    });
    
    // Optimistic UI update
    this.updateUI(data);
  }
}
```

### Exclude Self Option

For simpler use cases, you can exclude your own updates entirely:

```javascript
socket.emit('subscribe', {
  resource: 'messages',
  excludeSelf: true  // Won't receive broadcasts for your own changes
});
```

## CRUD Operations via WebSocket

### Create Resource

```javascript
socket.emit('resource:create', {
  resource: 'posts',
  data: { title: 'Hello World', content: 'My first post' },
  requestId: 'req-123'  // Optional but recommended
});

// Response
socket.on('resource:created', (response) => {
  if (response.requestId === 'req-123') {
    console.log('Created:', response.data);
  }
});
```

### Update Resource

```javascript
socket.emit('resource:update', {
  resource: 'posts',
  id: 1,
  data: { title: 'Updated Title' },
  requestId: 'req-124'
});
```

### Delete Resource

```javascript
socket.emit('resource:delete', {
  resource: 'posts',
  id: 1,
  requestId: 'req-125'
});
```

## Live Queries

Track query results that automatically update:

```javascript
// Subscribe with live query
socket.emit('subscribe', {
  resource: 'tasks',
  filter: { status: 'pending', assigneeId: 123 },
  options: { liveQuery: true }
});

// Receive query updates
socket.on('livequery:update', (event) => {
  console.log('Query results changed:', event.data);
  console.log('Operation:', event.operation); // 'created', 'updated', 'deleted'
});
```

## Presence Tracking

Track who's online in real-time:

```javascript
// Join a presence channel
socket.emit('presence:join', 'room-123');

// Listen for presence events
socket.on('presence:user:joined', (event) => {
  console.log('User joined:', event.userId);
});

socket.on('presence:user:left', (event) => {
  console.log('User left:', event.userId);
});

// Leave presence channel
socket.emit('presence:leave', 'room-123');
```

## Custom Events

Send custom events to other clients in the same room:

```javascript
// Join a room first
socket.emit('presence:join', 'chat-room');

// Send custom event
socket.emit('custom:event', {
  event: 'typing',
  payload: { message: 'User is typing...' },
  room: 'presence:chat-room'
});

// Receive custom events
socket.on('custom:typing', (event) => {
  console.log('From:', event.from);
  console.log('Payload:', event.payload);
});
```

## Multi-Server Support

Enable horizontal scaling with Redis:

```javascript
import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

api.use(WebSocketPlugin, {
  redis: redis,  // Enable Redis adapter
  jwtSecret: 'your-secret'
});
```

With Redis adapter:
- Broadcasts reach all clients across all servers
- Presence tracking works across servers
- Live queries sync across instances

### Load Balancer Configuration

Ensure sticky sessions for WebSocket connections:

```nginx
# Nginx example
upstream app {
    ip_hash;  # Sticky sessions
    server app1:3000;
    server app2:3000;
    server app3:3000;
}
```

## Configuration Options

```javascript
api.use(WebSocketPlugin, {
  // Socket.IO path
  path: '/socket.io',
  
  // CORS configuration
  cors: {
    origin: '*',
    credentials: true
  },
  
  // Transport options
  transports: ['websocket', 'polling'],
  
  // Timeouts
  pingTimeout: 60000,
  pingInterval: 25000,
  
  // Buffer size
  maxHttpBufferSize: 1e6,
  
  // Connection recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  },
  
  // Rate limiting
  rateLimit: {
    points: 100,    // Number of requests
    duration: 60    // Per 60 seconds
  },
  
  // Authentication
  jwtSecret: 'your-secret-key',
  
  // Redis adapter (optional)
  redis: redisClient
});
```

## API Reference

### Server Methods

```javascript
// Initialize WebSocket server
api.websocket.init(httpServer)

// Emit to specific room
api.websocket.emit(room, event, data)

// Emit to specific user
api.websocket.emitToUser(userId, event, data)

// Broadcast to all clients
api.websocket.broadcast(event, data)

// Get connected sockets
api.websocket.getConnectedSockets()

// Get sockets in room
api.websocket.getSocketsInRoom(room)

// Get user's sockets
api.websocket.getUserSockets(userId)

// Disconnect user
api.websocket.disconnectUser(userId, reason)

// Close WebSocket server
await api.websocket.close()
```

### Client Events

**Outgoing:**
- `subscribe` - Subscribe to resources
- `unsubscribe` - Unsubscribe from resources
- `resource:create` - Create a resource
- `resource:update` - Update a resource
- `resource:delete` - Delete a resource
- `presence:join` - Join presence channel
- `presence:leave` - Leave presence channel
- `custom:event` - Send custom event

**Incoming:**
- `connection:established` - Connection confirmed with socket ID
- `subscription:success` - Subscription confirmed
- `subscription:error` - Subscription failed
- `resource:state` - Initial resource state
- `collection:state` - Initial collection state
- `resource:created` - Resource created
- `resource:updated` - Resource updated
- `resource:deleted` - Resource deleted
- `resource:error` - Operation failed
- `livequery:created` - Live query created
- `livequery:update` - Live query results changed
- `presence:user:joined` - User joined presence channel
- `presence:user:left` - User left presence channel
- `custom:*` - Custom events

## Security Considerations

1. **Authentication**: Always validate JWT tokens
2. **Permissions**: Resource permissions are enforced automatically
3. **Rate Limiting**: Configure appropriate limits for your use case
4. **Input Validation**: All inputs are validated against schemas
5. **CORS**: Configure CORS appropriately for production

## Performance Tips

1. **Use `excludeSelf: true`** when you handle optimistic updates
2. **Batch subscriptions** when possible
3. **Unsubscribe** from resources when no longer needed
4. **Use filters** to reduce unnecessary updates
5. **Enable Redis** for multi-server deployments

## Troubleshooting

### Connection Issues
- Check CORS configuration
- Verify JWT token is valid
- Ensure WebSocket transport is not blocked

### Missing Updates
- Verify subscription was successful
- Check resource permissions
- Ensure filters match the data

### Performance Issues
- Reduce number of subscriptions
- Use more specific filters
- Enable Redis for scaling
- Adjust rate limits

## Examples

See the `examples` directory for complete examples:
- `websocket-basic.js` - Basic subscriptions
- `websocket-deep-subscriptions.js` - Relationship tracking
- `websocket-smart-updates.js` - Intelligent client handling