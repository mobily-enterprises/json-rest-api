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

// Option 1: Use createApi() for quick setup
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

#### What is createApi()?

`createApi()` is a convenience function that automatically configures common plugins based on your options:

- Sets up storage (memory/mysql) with appropriate adapter
- Adds validation if `validation: true` (default)
- Configures HTTP plugin if Express app is provided
- Handles all the plugin ordering for you

Use `createApi()` when you want standard functionality quickly. Use manual setup when you need precise control over plugin ordering or custom configurations.

#### API Calling Methods

There are two ways to interact with resources:

**1. Resource Proxy API (Recommended)**
```javascript
// Direct, intuitive syntax through the resources property
await api.resources.users.get(123);
await api.resources.users.create({ name: 'Alice' });
await api.resources.users.query({ filter: { active: true } });
```

**2. API-Level Methods**
```javascript
// Specify resource type in options
await api.get(123, { type: 'users' });
await api.create({ name: 'Alice' }, { type: 'users' });
await api.query({ type: 'users', filter: { active: true } });
```

The resource proxy API (`api.resources.users`) is the recommended approach because:
- More intuitive and readable
- Better TypeScript support
- Cleaner syntax for complex operations
- Natural chaining for relationships

The API-level methods are still supported and useful when the resource type is dynamic or determined at runtime.

### Schemas Define Your Data

Schemas are like TypeScript interfaces but with runtime validation. This is **schema-driven development** - your data structure drives everything:

```javascript
import { Schema } from 'json-rest-api';

const userSchema = new Schema({
  // Basic types with format validation
  name: { type: 'string', required: true, min: 2, max: 100, searchable: true },
  email: { 
    type: 'string', 
    required: true, 
    format: 'email',  // Safe email validation (ReDoS protected)
    searchable: true 
  },
  age: { type: 'number', min: 0, max: 150, searchable: true },
  active: { type: 'boolean', default: true, searchable: true },
  
  // Security considerations
  password: { type: 'string', silent: true }, // Never exposed in queries
  apiKey: { type: 'string', silent: true },   // Hidden from responses
  
  // Field-level permissions (new!)
  salary: { 
    type: 'number',
    permissions: { read: ['hr', 'admin', 'self'] }  // Role-based access
  },
  
  // Special types
  id: { type: 'id' },  // Auto-increment ID
  createdAt: { type: 'timestamp' },  // Unix timestamp
  birthday: { type: 'date' },  // YYYY-MM-DD
  metadata: { 
    type: 'object',
    maxKeys: 50,     // Prevent DoS attacks
    maxDepth: 5      // Limit nesting
  },
  tags: { 
    type: 'array', 
    searchable: true,
    maxItems: 20     // Limit array size
  },
  
  // Relationships with auto-join
  teamId: { 
    type: 'id',
    refs: { 
      resource: 'teams',
      join: {
        eager: true,  // Auto-include team data
        fields: ['id', 'name']  // Only these fields
      }
    }
  },
  
  // Virtual fields (computed, not stored)
  fullName: {
    type: 'string',
    virtual: true  // Populated by hooks
  }
});
```

**Key concepts:**
- `searchable: true` - Field can be filtered in queries
- `silent: true` - Field is never exposed (for passwords, secrets)
- `required: true` - Field must be provided on creation
- `default: value` - Auto-fill if not provided

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

### Using the Resource Proxy API

The resource proxy API provides an intuitive interface for all operations:

```javascript
// All CRUD operations
await api.resources.users.create({ name: 'Bob' });
await api.resources.users.get(123);
await api.resources.users.query({ filter: { active: true } });
await api.resources.users.update(123, { name: 'Robert' });
await api.resources.users.delete(123);

// With includes (relationship loading)
await api.resources.users.get(123, { 
  include: 'teamId,posts'  // Load related data
});

// Nested includes (new!)
await api.resources.posts.get(456, {
  include: 'authorId.teamId'  // Load author AND their team
});

// Bulk operations (new!)
await api.resources.users.bulk.create([
  { name: 'Charlie' },
  { name: 'David' }
]);

// Advanced filtering with operators
await api.resources.users.query({
  filter: {
    age: { gte: 18, lt: 65 },  // Age between 18-65
    email: { endsWith: '@company.com' },
    tags: { contains: 'vip' }
  }
});
```

### Plugin Architecture

Plugins extend functionality by hooking into the API lifecycle. **Plugin order is critical**:

```javascript
// Always load plugins in this order:
api
  .use(MySQLPlugin)        // Storage first (or MemoryPlugin)
  .use(ValidationPlugin)   // Validation 
  .use(AuthorizationPlugin) // Security/auth plugins
  .use(HTTPPlugin)         // HTTP last (mounts routes)

// ❌ Wrong order - HTTP before storage
api.use(HTTPPlugin).use(MySQLPlugin);  // Will fail!

// ✅ Correct order - storage → features → HTTP
api
  .use(MySQLPlugin, config)
  .use(ValidationPlugin)
  .use(TimestampsPlugin)
  .use(HTTPPlugin);
```

**Why order matters:**
- Storage plugins implement the core CRUD operations
- Feature plugins hook into these operations
- HTTP plugin creates routes based on what's available

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

// Your API is ready with advanced features!
// GET    /api/posts?filter[published]=true&filter[tags]=nodejs&include=author
// GET    /api/posts?filter[title][like]=%javascript%  // Pattern search
// GET    /api/posts?include=authorId.countryId  // Nested includes
// GET    /api/posts?filter[createdAt][gte]=2024-01-01  // Date filtering
// POST   /api/posts
// PATCH  /api/posts/123
// DELETE /api/posts/123

// Relationship endpoints (automatic with refs + provideUrl)
// GET    /api/posts/123/author  // Get author of post
// GET    /api/posts/123/relationships/author  // Get relationship data
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