# JSON REST API - Complete Guide

Welcome! This guide will teach you everything about the JSON REST API library through practical examples and clear explanations.

## 📚 Learning Path

### 1. [Core Concepts](./GUIDE.md#core-concepts) 
Understand the fundamental building blocks:
- API instances and configuration
- Schemas and validation
- Resources and the proxy API
- CRUD operations

### 2. [Plugins Guide](./PLUGINS.md) 
Master the plugin system:
- Using built-in plugins
- Plugin order and dependencies
- Creating custom plugins
- Plugin cookbook

### 3. [Hooks & Events](./HOOKS.md)
Extend functionality with hooks:
- Lifecycle hooks
- Context object
- Hook priorities
- Common patterns

### 4. [Relationships & Joins](./RELATIONSHIPS.md)
Build connected data models:
- Defining relationships with refs
- Automatic joins
- Nested joins
- Performance optimization

### 5. [Querying & Filtering](./QUERYING.md)
Powerful data retrieval:
- Filter syntax and operators
- Sorting and pagination
- Field selection
- Advanced query patterns

### 6. [API Reference](./API.md)
Complete method and option reference

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
  storage: 'memory'
});

// Option 2: Manual setup for full control
const api = new Api({
  name: 'myapp',
  version: '1.0.0'
});
api.use(ValidationPlugin);
api.use(MemoryPlugin);
```

### Schemas Define Your Data

Schemas are like TypeScript interfaces but with runtime validation:

```javascript
import { Schema } from 'json-rest-api';

const userSchema = new Schema({
  // Basic types
  name: { type: 'string', required: true, min: 2, max: 100 },
  email: { type: 'string', required: true, match: /^[^@]+@[^@]+\.[^@]+$/ },
  age: { type: 'number', min: 0, max: 150 },
  active: { type: 'boolean', default: true },
  
  // Special types
  id: { type: 'id' },  // Auto-increment ID
  createdAt: { type: 'timestamp' },  // Unix timestamp
  birthday: { type: 'date' },  // YYYY-MM-DD
  metadata: { type: 'object' },  // JSON object
  tags: { type: 'array' },  // JSON array
  
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
// Instead of: api.insert(data, { type: 'users' })
// You write: api.resources.users.create(data)

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
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, unique: true },
  bio: { type: 'string', max: 500 }
});

const postSchema = new Schema({
  title: { type: 'string', required: true, min: 5, max: 200 },
  slug: { type: 'string', unique: true },
  content: { type: 'string', required: true },
  published: { type: 'boolean', default: false },
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
  tags: { type: 'array', default: [] }
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
// GET    /api/posts?filter[published]=true&include=author
// POST   /api/posts
// PATCH  /api/posts/123
// DELETE /api/posts/123
```

## What's Next?

Now that you understand the basics:

1. **[Read the Plugins Guide](./PLUGINS.md)** to learn about all available plugins
2. **[Explore Hooks](./HOOKS.md)** for custom business logic
3. **[Master Relationships](./RELATIONSHIPS.md)** for complex data models
4. **[Learn Advanced Querying](./QUERYING.md)** for powerful data retrieval

Or jump to a specific topic:
- [Schema Validation Rules](./API.md#schema-validation)
- [Error Handling](./API.md#error-handling)
- [API Versioning](./architecture/api-versioning.md)
- [HTTP Plugin Details](./architecture/HTTP%20EXPLANATION.md)

## Common Patterns

### 1. Computed Fields

Add fields that are calculated on-the-fly:

```javascript
api.hook('afterGet', async (context) => {
  if (context.options.type === 'users' && context.result) {
    // Add post count
    const posts = await api.resources.posts.query({
      filter: { authorId: context.result.id }
    });
    context.result.postCount = posts.meta.total;
  }
});
```

### 2. Soft Delete

Track deleted records without removing them:

```javascript
const schema = new Schema({
  // ... other fields
  deletedAt: { type: 'timestamp', default: null }
});

// Override delete to soft delete
api.hook('beforeDelete', async (context) => {
  if (context.options.type === 'posts') {
    // Update instead of delete
    await api.resources.posts.update(context.id, {
      deletedAt: Date.now()
    });
    // Prevent actual deletion
    context.skip = true;
  }
});

// Filter out soft-deleted records
api.hook('beforeQuery', async (context) => {
  if (context.options.type === 'posts') {
    context.params.filter = context.params.filter || {};
    context.params.filter.deletedAt = null;
  }
});
```

### 3. Audit Trail

Track all changes to records:

```javascript
// Add audit fields to schema
const auditableSchema = new Schema({
  // ... your fields
  createdBy: { type: 'id', refs: { resource: 'users' } },
  updatedBy: { type: 'id', refs: { resource: 'users' } },
  version: { type: 'number', default: 1 }
});

// Track changes
api.hook('beforeInsert', async (context) => {
  context.data.createdBy = context.options.userId;
  context.data.updatedBy = context.options.userId;
});

api.hook('beforeUpdate', async (context) => {
  context.data.updatedBy = context.options.userId;
  context.data.version = (context.existing?.version || 0) + 1;
});
```

## Best Practices

1. **Always define schemas** - They're your contract and documentation
2. **Use the proxy API** - It's cleaner than passing type everywhere
3. **Order plugins correctly** - Storage → Validation → Features → HTTP
4. **Validate early** - Let schemas catch errors before they hit the database
5. **Use refs for relationships** - It enables automatic joins and consistency
6. **Hook into the right lifecycle** - beforeInsert vs afterInsert matters
7. **Keep hooks focused** - One hook should do one thing
8. **Use transactions for complex operations** - Especially with MySQL
9. **Test with different storage plugins** - Memory for tests, MySQL for production
10. **Version your APIs** - It's built-in, use it!

## Troubleshooting

### "No storage plugin installed"
You forgot to add a storage plugin. Add MemoryPlugin or MySQLPlugin.

### "Resource 'users' not found"
You're trying to use a resource before calling `addResource()`.

### Validation errors
Check your schema definition. The error will tell you which field failed.

### Relationships not joining
Make sure you have `refs` defined and include the field in your query.

## Get Help

- 📖 Check the [API Reference](./API.md)
- 🏗️ Browse [examples](../examples/)
- 💬 Ask questions on GitHub

Ready to become an expert? Continue with the [Plugins Guide](./PLUGINS.md) →