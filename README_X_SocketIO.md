# Socket.io Real-time Updates Guide

The Socket.io Plugin enables real-time updates for your JSON:API server using Socket.io. It integrates seamlessly with the JWT Authentication Plugin and supports both single-server and multi-server deployments.

## Table of Contents
- [Overview](#overview)
- [Installation](#installation)
- [Configuration](#configuration)
- [Client Connection](#client-connection)
- [Subscriptions](#subscriptions)
- [Authentication](#authentication)
- [Message Reference](#message-reference)
- [Examples](#examples)
- [Multi-Server Deployment](#multi-server-deployment)
- [Best Practices](#best-practices)

## Overview

The Socket.io plugin provides:
- Real-time updates when resources are created, updated, or deleted
- JWT authentication using the same tokens as your REST API
- Declarative permission enforcement
- Filtered subscriptions
- Automatic disconnection on logout
- Optional Redis support for multi-server deployments
- Callback and event-based messaging patterns

## Installation

```javascript
import { SocketIOPlugin } from 'json-rest-api/plugins/core/socketio-plugin.js';

// The Socket.io plugin depends on JWT Auth
await api.use(JwtAuthPlugin, {
  jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
});

// Install Socket.io plugin
await api.use(SocketIOPlugin, {
  port: 3001,                    // Socket.io server port
  cors: {                        // CORS configuration
    origin: '*',
    credentials: true
  }
});
```

## Configuration

### Basic Configuration

```javascript
await api.use(SocketIOPlugin, {
  // Socket.io server port (default: 3001)
  port: 3001,
  
  // CORS settings
  cors: {
    origin: ['http://localhost:3000', 'https://myapp.com'],
    credentials: true
  }
});
```

### Multi-Server Configuration with Redis

```javascript
await api.use(SocketIOPlugin, {
  port: 3001,
  
  // Enable Redis adapter for multi-server support
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  }
});
```

## Client Connection

### Installation

```bash
npm install socket.io-client
```

### Basic Connection

```javascript
import { io } from 'socket.io-client';

// Connect without authentication
const socket = io('http://localhost:3001');

socket.on('connected', (data) => {
  console.log('Connected:', data);
  // { socketId: 'abc123', authenticated: false, timestamp: '...' }
});
```

### Authenticated Connection

```javascript
// With Supabase
const { data: { session } } = await supabase.auth.getSession();

// Connect with JWT token
const socket = io('http://localhost:3001', {
  auth: {
    token: session.access_token
  }
});

socket.on('connected', (data) => {
  console.log('Connected:', data);
  // { socketId: 'abc123', authenticated: true, userId: '123', timestamp: '...' }
});
```

### Alternative Authentication Methods

```javascript
// 1. Via auth object (recommended)
const socket = io('http://localhost:3001', {
  auth: {
    token: jwtToken
  }
});

// 2. Via Authorization header
const socket = io('http://localhost:3001', {
  extraHeaders: {
    'Authorization': `Bearer ${jwtToken}`
  }
});
```

## Subscriptions

### Subscribe to Resources

Socket.io plugin supports both callback and event-based patterns:

#### Callback Style (Recommended)

```javascript
// Subscribe with callback for immediate confirmation
socket.emit('subscribe', {
  resource: 'books',
  filters: { published: true },
  subscriptionId: 'published-books' // Optional
}, (response) => {
  if (response.success) {
    console.log('Subscribed:', response.data);
    // { subscriptionId: 'published-books', resource: 'books', status: 'active' }
  } else {
    console.error('Subscribe failed:', response.error);
  }
});
```

#### Subscribe to a Specific Record by ID

```javascript
// Get updates only for a specific post
socket.emit('subscribe', {
  resource: 'posts',
  filters: { id: '123' },  // Filter by ID
  subscriptionId: 'post-123'
}, (response) => {
  if (response.success) {
    console.log('Subscribed to post 123');
  }
});

// You'll only receive updates when post 123 changes
socket.on('resource.update', (data) => {
  if (data.subscriptionId === 'post-123') {
    console.log('Post 123 was updated:', data);
  }
});
```

#### Event Style

```javascript
// Subscribe using events
socket.emit('subscribe', {
  resource: 'books',
  filters: { published: true }
});

socket.on('subscription.created', (data) => {
  console.log('Subscribed:', data);
});

socket.on('subscription.error', (error) => {
  console.error('Subscribe failed:', error);
});
```

### Subscription Options

```javascript
socket.emit('subscribe', {
  // Required: Resource name
  resource: 'posts',
  
  // Optional: Filter criteria
  filters: {
    user_id: '123',
    published: true,
    category: 'tech'
  },
  
  // Optional: Custom subscription ID
  subscriptionId: 'my-tech-posts'
}, callback);
```

**Note on Filtering**: Currently, filters only support simple equality checks. Complex queries like `$gt`, `$in`, etc. are not supported in subscriptions. Only fields that exist on the resource can be filtered.

### Unsubscribe

```javascript
// Unsubscribe with callback
socket.emit('unsubscribe', {
  subscriptionId: 'my-tech-posts'
}, (response) => {
  if (response.success) {
    console.log('Unsubscribed');
  }
});

// Or using events
socket.emit('unsubscribe', {
  subscriptionId: 'my-tech-posts'
});

socket.on('subscription.removed', (data) => {
  console.log('Unsubscribed:', data.subscriptionId);
});
```

### Receiving Updates

When a subscribed resource changes:

```javascript
socket.on('resource.update', (data) => {
  console.log('Resource updated:', data);
  /*
  {
    type: 'resource.update',
    subscriptionId: 'my-tech-posts',
    resource: 'posts',
    operation: 'create', // or 'update', 'delete'
    data: {
      type: 'posts',
      id: '123',
      attributes: {
        title: 'New Post',
        content: '...',
        published: true
      }
    },
    meta: {
      timestamp: '2024-01-01T12:00:00.000Z'
    }
  }
  */
});
```

## Authentication

### How It Works

1. **Token Validation**: The Socket.io plugin uses your JWT Auth plugin to validate tokens
2. **Permission Enforcement**: Declarative auth rules are enforced for subscriptions and updates
3. **User Rooms**: Authenticated users automatically join a user-specific room
4. **Logout Handling**: Sockets are disconnected when users log out

### Permission Checking

The plugin respects your resource auth rules:

```javascript
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    status: { type: 'string' },
    published: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['public'],         // Who can subscribe
    get: ['public'],          // Who can see individual records
    post: ['authenticated'],   
    patch: ['is_owner', 'has_role:editor'],      
    delete: ['is_owner', 'admin']
  }
});
```

For subscriptions:
- The `query` permission determines who can subscribe
- When broadcasting, only records the user can `get` are sent
- Filters are applied before permission checks

### Logout Handling

When a user logs out via REST API:

```javascript
// User logs out
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// Socket.io connection receives logout event and disconnects
socket.on('logout', (data) => {
  console.log('Logged out:', data.message);
  // Socket will disconnect automatically
});
```

## Message Reference

### Client → Server Messages

#### subscribe
```javascript
socket.emit('subscribe', {
  resource: 'books',           // Required
  filters: { /* optional */ },
  subscriptionId: 'custom-id'  // Optional
}, callback);
```

#### unsubscribe
```javascript
socket.emit('unsubscribe', {
  subscriptionId: 'custom-id'  // Required
}, callback);
```

### Server → Client Messages

#### connected
```javascript
socket.on('connected', (data) => {
  // {
  //   socketId: 'unique-socket-id',
  //   authenticated: true/false,
  //   userId: 'user-123',  // if authenticated
  //   timestamp: '2024-01-01T12:00:00.000Z'
  // }
});
```

#### resource.update
```javascript
socket.on('resource.update', (data) => {
  // {
  //   type: 'resource.update',
  //   subscriptionId: 'your-subscription-id',
  //   resource: 'books',
  //   operation: 'create' | 'update' | 'delete',
  //   data: { /* JSON:API resource */ },
  //   meta: { timestamp: '...' }
  // }
});
```

#### subscription.created / subscription.removed
```javascript
socket.on('subscription.created', (data) => {
  // { subscriptionId, resource, filters, status: 'active' }
});
```

#### subscription.error
```javascript
socket.on('subscription.error', (error) => {
  // { 
  //   subscriptionId: '...', 
  //   error: { 
  //     code: 'RESOURCE_NOT_FOUND', 
  //     message: '...' 
  //   } 
  // }
});
```

#### logout
```javascript
socket.on('logout', (data) => {
  // { message: 'You have been logged out' }
  // Socket disconnects after this
});
```

## Examples

### React Hook

```javascript
import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

function useSocketIO(url, token) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  
  useEffect(() => {
    const newSocket = io(url, {
      auth: { token }
    });
    
    newSocket.on('connected', (data) => {
      setConnected(true);
      console.log('Socket connected:', data);
    });
    
    newSocket.on('disconnect', () => {
      setConnected(false);
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.close();
    };
  }, [url, token]);
  
  const subscribe = useCallback((resource, filters, callback) => {
    if (!socket) return;
    
    socket.emit('subscribe', {
      resource,
      filters,
      subscriptionId: `${resource}-${Date.now()}`
    }, callback);
  }, [socket]);
  
  return { socket, connected, subscribe };
}

// Usage
function BookList() {
  const { session } = useAuth();
  const { socket, connected, subscribe } = useSocketIO(
    'http://localhost:3001',
    session?.access_token
  );
  
  useEffect(() => {
    if (!connected) return;
    
    // Subscribe to books
    subscribe('books', { published: true }, (response) => {
      if (response.success) {
        console.log('Subscribed to books');
      }
    });
    
    // Listen for updates
    socket.on('resource.update', (data) => {
      if (data.resource === 'books') {
        // Update your state/cache
        updateBookList(data);
      }
    });
  }, [connected, socket, subscribe]);
}
```

### Vue 3 Composable

```javascript
// composables/useSocketIO.js
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

export function useSocketIO(url, token) {
  const socket = ref(null);
  const connected = ref(false);
  const subscriptions = ref(new Map());
  
  onMounted(() => {
    socket.value = io(url, {
      auth: { token }
    });
    
    socket.value.on('connected', (data) => {
      connected.value = true;
    });
    
    socket.value.on('resource.update', (data) => {
      const handlers = subscriptions.value.get(data.subscriptionId);
      if (handlers) {
        handlers.forEach(handler => handler(data));
      }
    });
  });
  
  onUnmounted(() => {
    if (socket.value) {
      socket.value.close();
    }
  });
  
  const subscribe = (resource, filters, handler) => {
    if (!socket.value) return;
    
    const subscriptionId = `${resource}-${Date.now()}`;
    
    socket.value.emit('subscribe', {
      resource,
      filters,
      subscriptionId
    }, (response) => {
      if (response.success) {
        if (!subscriptions.value.has(subscriptionId)) {
          subscriptions.value.set(subscriptionId, []);
        }
        subscriptions.value.get(subscriptionId).push(handler);
      }
    });
    
    return subscriptionId;
  };
  
  const unsubscribe = (subscriptionId) => {
    if (!socket.value) return;
    
    socket.value.emit('unsubscribe', { subscriptionId });
    subscriptions.value.delete(subscriptionId);
  };
  
  return {
    socket,
    connected,
    subscribe,
    unsubscribe
  };
}
```

### Complete Real-time Blog Example

```javascript
// Backend setup
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    published: { type: 'boolean', default: false },
    tags: { type: 'json' }
  },
  
  auth: {
    query: ['public'],         // Anyone can subscribe
    get: ['public'],          
    post: ['authenticated'],   // Must be logged in to create
    patch: ['is_owner', 'has_role:editor'],  // Owner or editor can edit
    delete: ['is_owner', 'admin']  // Owner or admin can delete
  }
});

// Frontend React component
import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

function LiveBlog() {
  const [posts, setPosts] = useState([]);
  const [socket, setSocket] = useState(null);
  const { session } = useSupabase();
  
  useEffect(() => {
    // Connect with authentication
    const newSocket = io('http://localhost:3001', {
      auth: {
        token: session?.access_token
      }
    });
    
    setSocket(newSocket);
    
    newSocket.on('connected', (data) => {
      console.log('Connected:', data);
      
      // Subscribe to published posts
      newSocket.emit('subscribe', {
        resource: 'posts',
        filters: { published: true },
        subscriptionId: 'live-posts'
      }, (response) => {
        if (response.success) {
          console.log('Subscribed to posts');
        }
      });
    });
    
    // Handle real-time updates
    newSocket.on('resource.update', (update) => {
      if (update.resource !== 'posts') return;
      
      switch (update.operation) {
        case 'create':
          setPosts(prev => [...prev, update.data]);
          break;
          
        case 'update':
          setPosts(prev => prev.map(post => 
            post.id === update.data.id ? update.data : post
          ));
          break;
          
        case 'delete':
          setPosts(prev => prev.filter(post => 
            post.id !== update.data.id
          ));
          break;
      }
    });
    
    // Load initial posts
    fetch('/api/posts?filter[published]=true')
      .then(res => res.json())
      .then(data => setPosts(data.data));
    
    return () => {
      newSocket.close();
    };
  }, [session]);
  
  const createPost = async (title, content) => {
    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          type: 'posts',
          attributes: { title, content, published: true }
        }
      })
    });
    
    // The post will appear via Socket.io update
  };
  
  return (
    <div>
      {/* Post creation form */}
      {/* Post list that updates in real-time */}
    </div>
  );
}
```

## Multi-Server Deployment

### Single Server (Default)

No special configuration needed:

```javascript
await api.use(SocketIOPlugin, {
  port: 3001
});
```

### Multi-Server with Redis

For load-balanced environments:

```javascript
await api.use(SocketIOPlugin, {
  port: 3001,
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  }
});
```

This enables:
- Cross-server message broadcasting
- Sticky sessions not required
- Horizontal scaling support

### AWS Deployment Example

```javascript
// Use ElastiCache Redis
await api.use(SocketIOPlugin, {
  port: 3001,
  redis: {
    url: `redis://${process.env.ELASTICACHE_ENDPOINT}:6379`
  }
});

// Load balancer configuration:
// - Route /api/* to API servers
// - Route Socket.io traffic to any server (no sticky sessions needed)
```

## Best Practices

### 1. Connection Management

```javascript
class SocketManager {
  constructor(url, getToken) {
    this.url = url;
    this.getToken = getToken;
    this.socket = null;
    this.reconnectDelay = 1000;
  }
  
  connect() {
    this.socket = io(this.url, {
      auth: {
        token: this.getToken()
      },
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: 10000
    });
    
    this.socket.on('connect_error', (error) => {
      if (error.message === 'Authentication failed') {
        // Token might be expired, refresh it
        this.refreshConnection();
      }
    });
  }
  
  async refreshConnection() {
    const newToken = await this.getToken(true); // Force refresh
    this.socket.auth.token = newToken;
    this.socket.connect();
  }
}
```

### 2. Subscription Lifecycle

```javascript
// Clean up subscriptions properly
useEffect(() => {
  const subscriptionId = 'my-posts';
  
  socket.emit('subscribe', {
    resource: 'posts',
    filters: { user_id: userId },
    subscriptionId
  });
  
  return () => {
    // Unsubscribe on cleanup
    socket.emit('unsubscribe', { subscriptionId });
  };
}, [userId]);
```

### 3. Error Handling

```javascript
// Global error handler
socket.on('error', (error) => {
  console.error('Socket error:', error);
  // Show user notification
});

// Subscription error handling
socket.emit('subscribe', { resource: 'posts' }, (response) => {
  if (!response.success) {
    switch (response.error.code) {
      case 'PERMISSION_DENIED':
        // User doesn't have access
        break;
      case 'RESOURCE_NOT_FOUND':
        // Resource doesn't exist
        break;
    }
  }
});
```

### 4. Optimizing Subscriptions

```javascript
// Good: Specific filters reduce unnecessary updates
socket.emit('subscribe', {
  resource: 'posts',
  filters: { 
    user_id: currentUser.id,
    status: 'draft'
  }
});

// Avoid: Broad subscriptions
socket.emit('subscribe', {
  resource: 'posts'  // Gets ALL post updates
});
```

### 5. TypeScript Support

```typescript
interface ResourceUpdate<T = any> {
  type: 'resource.update';
  subscriptionId: string;
  resource: string;
  operation: 'create' | 'update' | 'delete';
  data: {
    type: string;
    id: string;
    attributes: T;
  };
  meta: {
    timestamp: string;
  };
}

// Type-safe event handling
socket.on('resource.update', (update: ResourceUpdate<Post>) => {
  if (update.resource === 'posts') {
    handlePostUpdate(update.data.attributes);
  }
});
```

## Summary

The Socket.io Plugin provides production-ready real-time capabilities for your JSON:API server:

- **Easy Integration**: Works with your existing JWT auth and permissions
- **Flexible Deployment**: Single server or multi-server with Redis
- **Developer Friendly**: Callback and event-based APIs
- **Type Safe**: Full TypeScript support
- **Battle Tested**: Built on Socket.io's proven infrastructure

Whether you're building a chat app, live dashboard, or collaborative tool, the Socket.io plugin gives you real-time updates that respect your existing security model.