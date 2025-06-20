# Getting Started with JSON REST API

Welcome to the JSON REST API library! This section covers the fundamental concepts and helps you get up and running quickly.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Quick Example: Blog API](#quick-example-blog-api)
3. [Installation & Setup](#installation--setup)

## Core Concepts

Let's start with the fundamental concepts you need to understand.

### The API Instance

The API instance is your central control point. It manages resources, plugins, and configurations:

```javascript
import { Api, createApi } from 'json-rest-api';

// Option 1: Use the convenience function
const api = createApi({
  name: 'myapp',
  version: '1.0.0',
  storage: 'memory'  // AlaSQL in-memory database
});

// Option 2: Manual setup for full control
import { Api, MemoryPlugin, ValidationPlugin } from 'json-rest-api';

const api = new Api({
  name: 'myapp',
  version: '1.0.0'
});
api.use(MemoryPlugin);      // In-memory storage (AlaSQL)
api.use(ValidationPlugin);   // Add validation
```

**Important**: Throughout this guide, we'll use the resource proxy API syntax (`api.resources.users.get()`) rather than the older style (`api.get(id, { type: 'users' })`). The older style is mentioned here once for reference but the proxy API is the recommended approach.

### Schemas Define Your Data

Schemas are like TypeScript interfaces but with runtime validation:

```javascript
import { Schema } from 'json-rest-api';

const userSchema = new Schema({
  // Basic types
  name: { type: 'string', required: true, min: 2, max: 100, searchable: true },
  email: { type: 'string', required: true, match: /^[^@]+@[^@]+\.[^@]+$/, searchable: true },
  age: { type: 'number', min: 0, max: 150, searchable: true },
  active: { type: 'boolean', default: true, searchable: true },
  
  // Special types
  id: { type: 'id' },  // Auto-increment ID
  createdAt: { type: 'timestamp' },  // Unix timestamp
  birthday: { type: 'date' },  // YYYY-MM-DD
  metadata: { type: 'object' },  // JSON object
  tags: { type: 'array', searchable: true },  // JSON array
  
  // Relationships
  teamId: { 
    type: 'id',
    refs: { resource: 'teams' }  // Foreign key
  }
});
```

### Resources = Your Data Models

Resources combine schemas with a unique type name:

```javascript
// Register a resource
api.addResource('users', userSchema);

// Now you can use it through the proxy API
const user = await api.resources.users.create({
  name: 'Alice',
  email: 'alice@example.com'
});
```

### The Resource Proxy API

The proxy API provides an intuitive interface for all operations:

```javascript
// All CRUD operations
await api.resources.users.create({ name: 'Bob' });
await api.resources.users.get(123);
await api.resources.users.query({ filter: { active: true } });
await api.resources.users.update(123, { name: 'Robert' });
await api.resources.users.delete(123);

// Batch operations
await api.resources.users.batch.create([
  { name: 'Charlie' },
  { name: 'David' }
]);
```

### Plugin Architecture

Plugins extend functionality by hooking into the API lifecycle:

```javascript
// Plugins are added in order
api
  .use(ValidationPlugin)      // Validates data
  .use(MySQLPlugin, config)   // Provides storage
  .use(TimestampsPlugin)      // Manages timestamps
  .use(HTTPPlugin);           // Adds REST endpoints

// Order matters! Storage plugins must come before feature plugins
```

### Hooks Enable Custom Logic

Hooks let you intercept and modify operations:

```javascript
// Global hook - runs for all resources
api.hook('beforeInsert', async (context) => {
  console.log(`Creating ${context.options.type}:`, context.data);
});

// Resource-specific hook
api.addResource('posts', postSchema, {
  afterInsert: async (context) => {
    // Notify subscribers about new post
    await notifySubscribers(context.result);
  }
});
```

## Quick Example: Blog API

Let's build a simple blog API to see how everything fits together:

```javascript
import express from 'express';
import { createApi, Schema } from 'json-rest-api';

const app = express();

// Create API
const api = createApi({
  name: 'blog',
  version: '1.0.0',
  storage: 'mysql',
  mysql: {
    connection: { 
      host: 'localhost',
      database: 'blog_db' 
    }
  }
});

// Define schemas
const authorSchema = new Schema({
  name: { type: 'string', required: true, searchable: true },
  email: { type: 'string', required: true, unique: true, searchable: true },
  bio: { type: 'string', max: 500 }
});

const postSchema = new Schema({
  title: { type: 'string', required: true, min: 5, max: 200, searchable: true },
  slug: { type: 'string', unique: true },
  content: { type: 'string', required: true },
  published: { type: 'boolean', default: false, searchable: true },
  authorId: {
    type: 'id',
    refs: {
      resource: 'authors',
      join: {
        eager: true,  // Always include author
        fields: ['name', 'email']
      }
    }
  },
  tags: { type: 'array', default: [], searchable: true }
});

// Register resources
api.addResource('authors', authorSchema);
api.addResource('posts', postSchema, {
  // Generate slug from title
  beforeInsert: async (context) => {
    if (!context.data.slug && context.data.title) {
      context.data.slug = context.data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    }
  }
});

// Mount and start
api.mount(app);
app.listen(3000);

// Your API is ready!
// GET    /api/posts?filter[published]=true&filter[tags]=nodejs&include=author
// GET    /api/posts?filter[title]=hello  // Search by title
// POST   /api/posts
// PATCH  /api/posts/123
// DELETE /api/posts/123
```

## Installation & Setup

```bash
npm install json-rest-api
```

### Basic Setup

```javascript
import { createApi } from 'json-rest-api';
import express from 'express';

const app = express();

// Create API with in-memory storage
const api = createApi({
  storage: 'memory'  // Perfect for development
});

// Or use MySQL for production
const api = createApi({
  storage: 'mysql',
  mysql: {
    connection: {
      host: 'localhost',
      user: 'dbuser',
      password: 'dbpass',
      database: 'myapp'
    }
  }
});

// Mount on Express
api.mount(app, '/api');
app.listen(3000);
```

---

**Next**: [Core Features →](./GUIDE_2_Core_Features.md)