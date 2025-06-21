# JSON REST API Client

A type-safe JavaScript/TypeScript client for consuming APIs built with json-rest-api.

## Overview

The client directory contains a lightweight, type-safe client SDK that can be used to consume APIs built with json-rest-api. It provides:

- **Type-safe operations** - Full TypeScript support with automatic type inference
- **JSON:API compliant** - Follows JSON:API specification
- **Interceptors** - Request/response/error interceptors for auth, logging, retries
- **Zero dependencies** - Uses native fetch API
- **Tree-shakeable** - Import only what you need

## Installation

The client can be used in several ways:

### 1. As part of json-rest-api package

```javascript
import { createClient } from 'json-rest-api/client';
```

### 2. As a standalone package (if published separately)

```bash
npm install @your-org/json-rest-api-client
```

### 3. Copy directly into your project

The client has zero dependencies and can be copied directly.

## Basic Usage

```javascript
import { createClient } from 'json-rest-api/client';

// Create client instance
const client = createClient({
  baseURL: 'https://api.example.com',
  headers: {
    'X-API-Key': 'your-api-key'
  }
});

// Use type-safe resources
const user = await client.resources.users.create({
  email: 'john@example.com',
  name: 'John Doe'
});

const posts = await client.resources.posts.query({
  filter: { authorId: user.id },
  include: ['author', 'comments'],
  sort: '-createdAt',
  page: { size: 10 }
});
```

## TypeScript Usage

Define your API types for full type safety:

```typescript
import { createClient, RestClient } from 'json-rest-api/client';
import type { User, Post } from './types';

interface ApiResources {
  users: {
    get(id: string | number): Promise<User>;
    query(options?: QueryOptions): Promise<QueryResult<User>>;
    create(data: Omit<User, 'id'>): Promise<User>;
    update(id: string | number, data: Partial<User>): Promise<User>;
    delete(id: string | number): Promise<void>;
  };
  posts: {
    get(id: string | number): Promise<Post>;
    query(options?: QueryOptions): Promise<QueryResult<Post>>;
    create(data: Omit<Post, 'id'>): Promise<Post>;
    update(id: string | number, data: Partial<Post>): Promise<Post>;
    delete(id: string | number): Promise<void>;
  };
}

const client = createClient<ApiResources>({
  baseURL: 'https://api.example.com'
});

// Now all operations are fully typed
const user = await client.resources.users.get(123); // user is typed as User
```

## Interceptors

### Request Interceptor

```javascript
client.addRequestInterceptor(async (config, url) => {
  console.log(`${config.method} ${url}`);
  
  // Add timestamp
  config.headers['X-Request-Time'] = Date.now().toString();
  
  return config;
});
```

### Response Interceptor

```javascript
client.addResponseInterceptor(async (result) => {
  console.log(`Response status: ${result.response.status}`);
  
  // Transform response
  if (result.data?.meta) {
    result.data.meta.responseTime = Date.now();
  }
  
  return result;
});
```

### Error Interceptor

```javascript
import { retryInterceptor } from 'json-rest-api/client';

// Add retry logic
client.addErrorInterceptor(retryInterceptor(3, 1000));

// Custom error handling
client.addErrorInterceptor(async (error) => {
  if (error.status === 401) {
    // Refresh token
    await refreshAuth();
    // Retry original request
    return error.config._originalRequest();
  }
  throw error;
});
```

## Authentication

```javascript
// Set bearer token
client.setAuthToken('your-jwt-token');

// Clear token
client.clearAuthToken();

// Custom auth header
client.headers['X-API-Key'] = 'your-api-key';
```

## Advanced Features

### Query Building

```javascript
const posts = await client.resources.posts.query({
  // Filtering
  filter: {
    status: 'published',
    authorId: 123,
    createdAt: { gte: '2024-01-01' }
  },
  
  // Sorting
  sort: ['-createdAt', 'title'],
  
  // Pagination
  page: {
    size: 20,
    number: 2
  },
  
  // Relationships
  include: ['author', 'comments.author'],
  
  // Sparse fieldsets
  fields: {
    posts: ['title', 'summary', 'createdAt'],
    users: ['name', 'avatar']
  }
});
```

### Error Handling

```javascript
try {
  const user = await client.resources.users.get(999);
} catch (error) {
  if (error.status === 404) {
    console.log('User not found');
  } else if (error.status === 422) {
    console.log('Validation errors:', error.data.errors);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Timeout Control

```javascript
const client = createClient({
  baseURL: 'https://api.example.com',
  timeout: 5000 // 5 seconds
});

// Override for specific request
const data = await client.resources.reports.query({
  filter: { type: 'annual' }
}, {
  timeout: 30000 // 30 seconds for slow reports
});
```

## Architecture

The client is designed to be:

1. **Lightweight** - No external dependencies, uses native fetch
2. **Type-safe** - Full TypeScript support with generics
3. **Extensible** - Interceptor system for customization
4. **Standards-compliant** - Follows JSON:API specification
5. **Universal** - Works in browsers and Node.js 18+

## Files

- `index.js` - Main client implementation
- `index.d.ts` - TypeScript definitions
- `README.md` - This file

## Contributing

The client is part of the json-rest-api project. See the main repository for contribution guidelines.