# JSON REST API Guide

A powerful, plugin-based JSON REST API framework for Node.js with automatic joins, schema validation, and JSON:API compliance.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Concepts](#core-concepts)
3. [Schema Definition](#schema-definition)
4. [Advanced Refs (Automatic Joins)](#advanced-refs-automatic-joins)
5. [Plugins](#plugins)
6. [Hook System](#hook-system)
7. [Query Builder](#query-builder)
8. [Error Handling](#error-handling)
9. [HTTP API](#http-api)
10. [Best Practices](#best-practices)

## Quick Start

```javascript
import express from 'express';
import { createApi, Schema } from 'jsonrestapi';

// Create Express app
const app = express();

// Create API instance
const api = createApi({
  name: 'myapp',
  version: '1.0.0',
  storage: 'mysql',
  mysql: {
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'myapp_db'
    }
  }
});

// Define a schema
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  createdAt: { type: 'timestamp' }
});

// Add the resource
api.addResource('users', userSchema);

// Mount on Express
api.mount(app, '/api');

// Start server
app.listen(3000, () => {
  console.log('API running at http://localhost:3000/api/1.0.0/users');
});
```

## Core Concepts

### API Instance

The API instance is the central object that manages resources, plugins, and hooks:

```javascript
const api = new Api(options);
// or
const api = createApi(options); // Convenience function
```

### Resources

Resources represent your data models. Each resource has:
- A unique type name (e.g., 'users', 'posts')
- A schema that defines its structure
- Optional hooks for custom behavior

```javascript
api.addResource('posts', postSchema, {
  // Resource-specific hooks
  afterInsert: async (context) => {
    // Custom logic after inserting a post
  }
});
```

### Resource Proxy API

Access resources through the intuitive proxy API:

```javascript
// CRUD operations
const user = await api.resources.users.get(123);
const users = await api.resources.users.query({ filter: { active: true } });
const newUser = await api.resources.users.create({ name: 'John', email: 'john@example.com' });
const updated = await api.resources.users.update(123, { name: 'John Doe' });
await api.resources.users.delete(123);
```

## Schema Definition

Schemas define the structure and validation rules for your resources:

```javascript
const productSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, min: 1, max: 200 },
  price: { type: 'number', required: true, min: 0 },
  description: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  metadata: { type: 'object' },
  inStock: { type: 'boolean', default: true },
  
  // Silent fields are excluded from default SELECT queries
  internalNotes: { type: 'string', silent: true },
  
  // Foreign key with relationship
  categoryId: { 
    type: 'id',
    refs: { resource: 'categories' }
  }
});
```

### Field Types

- `string` - Text values
- `number` - Numeric values (integers or floats)
- `boolean` - True/false values
- `id` - Auto-incrementing identifier
- `timestamp` - Unix timestamp
- `array` - Array of values
- `object` - Nested object
- `json` - JSON data (stored as TEXT in MySQL)

### Field Options

- `required` - Field must be present
- `default` - Default value if not provided
- `min`/`max` - Length (string) or value (number) constraints
- `unique` - Enforce uniqueness
- `silent` - Exclude from default SELECT queries
- `refs` - Define foreign key relationships

## Advanced Refs (Automatic Joins)

The most powerful feature of this library is automatic joins through the `refs` configuration:

### Basic Foreign Key

```javascript
const reviewSchema = new Schema({
  id: { type: 'id' },
  rating: { type: 'number', required: true },
  comment: { type: 'string' },
  
  // Simple foreign key - no automatic joins
  userId: { 
    type: 'id',
    refs: { resource: 'users' }
  }
});
```

### Eager Joins (Automatic)

```javascript
const reviewSchema = new Schema({
  id: { type: 'id' },
  rating: { type: 'number' },
  
  // Eager join - automatically loads user data
  userId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      join: {
        eager: true,              // Always join automatically
        fields: ['id', 'name', 'email', 'avatar']  // Only these fields
      }
    }
  }
});

// Query returns:
{
  id: 1,
  rating: 5,
  userId: {                       // Replaced with full object!
    id: 123,
    name: "John Doe",
    email: "john@example.com",
    avatar: "john.jpg"
  }
}
```

### Lazy Joins (On Demand)

```javascript
const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string' },
  
  // Lazy join - only loads when requested
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: false,             // Must explicitly request
        resourceField: 'category' // Put data in separate field
      }
    }
  }
});

// Normal query:
await api.resources.posts.get(1);
// Returns: { id: 1, title: "...", categoryId: 5 }

// With join:
await api.resources.posts.get(1, { joins: ['categoryId'] });
// Returns: { id: 1, title: "...", categoryId: 5, category: { id: 5, name: "Tech" } }
```

### Join Configuration Options

```javascript
join: {
  // When to join
  eager: true,              // Auto-join on all queries (default: false)
  type: 'left',            // Join type: 'left', 'inner' (default: 'left')
  
  // What to select
  fields: ['id', 'name'],  // Specific fields only
  excludeFields: ['password'], // Or exclude specific fields
  includeSilent: false,    // Include silent fields (default: false)
  
  // Where to put data
  resourceField: 'author', // Separate field (e.g., authorId stays as ID, author has object)
  preserveId: true,        // Keep ID and add object to derived field name
  
  // Hook execution
  runHooks: true,          // Run afterGet hooks on joined data (default: true)
  hookContext: 'join'      // Context passed to hooks (default: 'join')
}
```

### Join Control in Queries

```javascript
// Disable all joins (even eager ones)
await api.resources.posts.query({ joins: false });

// Enable specific joins only
await api.resources.posts.query({ joins: ['categoryId', 'authorId'] });

// Exclude specific eager joins
await api.resources.posts.query({ excludeJoins: ['authorId'] });

// HTTP API
GET /api/1.0.0/posts?joins=categoryId,tagIds
GET /api/1.0.0/posts?joins=false
GET /api/1.0.0/posts?excludeJoins=authorId
```

### Complex Example

```javascript
const articleSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string' },
  
  // Replace ID with author object
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['id', 'name', 'email', 'avatar']
      }
    }
  },
  
  // Keep categoryId as ID, populate category field
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: false,
        resourceField: 'category'
      }
    }
  },
  
  // Keep both ID and object in derived field
  editorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        preserveId: true,
        fields: ['id', 'name']
      }
    }
  }
});

// Result structure:
{
  id: 1,
  title: "My Article",
  content: "...",
  
  // Replaced with object
  authorId: {
    id: 123,
    name: "John Doe",
    email: "john@example.com",
    avatar: "john.jpg"
  },
  
  // Separate fields
  categoryId: 5,
  category: null,  // Not loaded (eager: false)
  
  // Both ID and object
  editorId: 456,
  editor: {
    id: 456,
    name: "Jane Smith"
  }
}
```

## Plugins

### Built-in Plugins

#### MemoryPlugin
In-memory storage for testing:
```javascript
import { MemoryPlugin } from 'jsonrestapi/plugins';
api.use(MemoryPlugin);
```

#### MySQLPlugin
MySQL database storage:
```javascript
import { MySQLPlugin } from 'jsonrestapi/plugins';
api.use(MySQLPlugin, {
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp'
  }
});
```

#### HTTPPlugin
Express/HTTP integration:
```javascript
import { HTTPPlugin } from 'jsonrestapi/plugins';
api.use(HTTPPlugin, {
  basePath: '/api',
  app: expressApp  // Optional, can use api.mount() instead
});
```

#### TimestampsPlugin
Automatic timestamp management:
```javascript
import { TimestampsPlugin } from 'jsonrestapi/plugins';
api.use(TimestampsPlugin, {
  createdAtField: 'createdAt',
  updatedAtField: 'updatedAt',
  touchOnGet: false
});
```

### Creating Custom Plugins

```javascript
const MyPlugin = {
  name: 'MyPlugin',
  install(api, options) {
    // Register hooks
    api.hook('beforeInsert', async (context) => {
      // Modify data before insert
      context.data.customField = 'custom value';
    });
    
    // Implement storage methods
    api.implement('get', async (context) => {
      // Custom get implementation
    });
    
    // Add API methods
    api.myCustomMethod = () => {
      // Custom functionality
    };
  }
};

api.use(MyPlugin, { option1: 'value1' });
```

## Hook System

Hooks allow you to intercept and modify operations at various points:

### Available Hooks

- `beforeValidate` / `afterValidate` - Schema validation
- `beforeGet` / `afterGet` - Single resource retrieval
- `beforeQuery` / `afterQuery` - Multiple resource queries
- `beforeInsert` / `afterInsert` - Resource creation
- `beforeUpdate` / `afterUpdate` - Resource updates
- `beforeDelete` / `afterDelete` - Resource deletion
- `initializeQuery` / `modifyQuery` / `finalizeQuery` - Query building
- `beforeSend` - Before HTTP response (HTTP plugin)
- `transformResult` - Final result transformation

### Hook Registration

```javascript
// Global hook (all resources)
api.hook('beforeInsert', async (context) => {
  console.log('Inserting:', context.options.type);
}, priority); // Priority: lower = earlier (default: 50)

// Resource-specific hook
api.addResource('posts', postSchema, {
  afterInsert: async (context) => {
    // Only runs for posts
    await notifySubscribers(context.result);
  }
});
```

### Hook Context

```javascript
api.hook('afterGet', async (context) => {
  // Available properties:
  context.api          // API instance
  context.method       // Operation: 'get', 'query', 'insert', etc.
  context.options      // Options including type, isHttp, isJoinResult
  context.result       // The result (for after* hooks)
  context.data         // Input data (for insert/update)
  context.id           // Resource ID (for get/update/delete)
  context.params       // Query parameters
  
  // For joins
  if (context.options.isJoinResult) {
    context.options.joinContext    // 'join' by default
    context.options.parentType     // Parent resource type
    context.options.parentId       // Parent resource ID
    context.options.parentField    // Field name in parent
  }
});
```

### Query Hooks

```javascript
api.hook('initializeQuery', async (context) => {
  // Set up base query
  // context.query is the QueryBuilder instance
});

api.hook('modifyQuery', async (context) => {
  // Add joins, filters, etc.
  context.query
    .leftJoin('users')
    .where('status = ?', 'active');
});

api.hook('finalizeQuery', async (context) => {
  // Last chance to modify query
});
```

## Query Builder

The QueryBuilder provides a fluent interface for constructing SQL queries:

```javascript
// Basic usage
const query = new QueryBuilder('users', api);
query
  .select('id', 'name', 'email')
  .where('active = ?', true)
  .orderBy('createdAt', 'DESC')
  .limit(10);

// In hooks
api.hook('modifyQuery', async (context) => {
  if (context.options.type === 'posts') {
    context.query
      // Smart joins using refs
      .leftJoin('authorId')  // Uses schema refs
      
      // Include related fields
      .includeRelated('authorId', ['name', 'email'])
      
      // Complex conditions
      .where('status = ?', 'published')
      .where('createdAt > ?', lastWeek)
      
      // Grouping and aggregation
      .select('COUNT(comments.id) as commentCount')
      .leftJoin('comments', 'comments.postId = posts.id')
      .groupBy('posts.id')
      .having('commentCount > ?', 5);
  }
});
```

### Smart Joins with Refs

```javascript
// Schema with refs
const postSchema = new Schema({
  authorId: { 
    type: 'id', 
    refs: { resource: 'users' }
  }
});

// Query builder uses refs automatically
query.leftJoin('authorId');
// Generates: LEFT JOIN users ON users.id = posts.authorId

// Include related fields
query.includeRelated('authorId', ['name', 'email']);
// Selects and aliases: users.name as authorId_name, users.email as authorId_email
```

## Error Handling

The library provides structured error classes:

```javascript
import { 
  BadRequestError, 
  NotFoundError, 
  ValidationError,
  ConflictError,
  InternalError 
} from 'jsonrestapi/errors';

// In your hooks or custom code
api.hook('beforeInsert', async (context) => {
  if (await isDuplicate(context.data.email)) {
    throw new ConflictError('Email already exists')
      .withContext({ 
        field: 'email',
        value: context.data.email 
      });
  }
});

// Validation errors
const error = new ValidationError();
error.addFieldError('email', 'Invalid email format', 'INVALID_FORMAT');
error.addFieldError('age', 'Must be at least 18', 'MIN_VALUE');
throw error;

// HTTP responses follow JSON:API error format
{
  "errors": [{
    "status": 422,
    "code": "VALIDATION_ERROR",
    "title": "Validation failed",
    "detail": "The request contains invalid data",
    "source": { "pointer": "/data/attributes/email" }
  }]
}
```

## HTTP API

### Routes

All routes follow the pattern: `/api/{version}/{resourceType}`

```
GET    /api/1.0.0/users          # List users
GET    /api/1.0.0/users/123      # Get user 123
POST   /api/1.0.0/users          # Create user
PUT    /api/1.0.0/users/123      # Full update
PATCH  /api/1.0.0/users/123      # Partial update
DELETE /api/1.0.0/users/123      # Delete user
```

### Query Parameters

```
# Filtering
GET /api/1.0.0/posts?filter[status]=published
GET /api/1.0.0/posts?filter[authorId]=123

# Sorting
GET /api/1.0.0/posts?sort=-createdAt,title

# Pagination
GET /api/1.0.0/posts?page[size]=20&page[number]=2

# Sparse fieldsets
GET /api/1.0.0/posts?fields[posts]=title,content
GET /api/1.0.0/posts?fields[users]=name,email

# Including relationships (JSON:API)
GET /api/1.0.0/posts?include=author,category

# Join control
GET /api/1.0.0/posts?joins=categoryId,tagIds
GET /api/1.0.0/posts?joins=false
GET /api/1.0.0/posts?excludeJoins=authorId
```

### JSON:API Responses

```json
{
  "data": {
    "type": "posts",
    "id": "1",
    "attributes": {
      "title": "My Post",
      "content": "...",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "123" }
      }
    }
  },
  "included": [{
    "type": "users",
    "id": "123",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }]
}
```

## Best Practices

### 1. Schema Design

- Use `silent: true` for sensitive fields (passwords, keys)
- Define all relationships with `refs`
- Use appropriate field types and constraints
- Consider using `default` values for optional fields

### 2. Join Configuration

- Use `eager: true` for frequently needed relationships
- Use `resourceField` when you need both ID and object
- Limit fields in joins to improve performance
- Consider hook performance with `runHooks: false` for bulk operations

### 3. Hook Organization

```javascript
// Separate concerns into different hooks
api.hook('beforeInsert', validateBusinessRules, 10);
api.hook('beforeInsert', checkPermissions, 20);
api.hook('beforeInsert', setDefaults, 30);

// Use priorities to control execution order
// Lower priority = runs first
```

### 4. Error Handling

- Use appropriate error classes
- Add context to errors for debugging
- Let errors bubble up to the HTTP layer
- Don't catch errors unless you can handle them

### 5. Performance

- Use field lists in joins to avoid fetching unnecessary data
- Mark large fields as `silent` to exclude from default queries
- Use query builder's field selection for specific queries
- Consider pagination for large result sets

### 6. Testing

```javascript
// Use MemoryPlugin for tests
const testApi = new Api();
testApi.use(MemoryPlugin);

// Test with real operations
const user = await testApi.resources.users.create({
  name: 'Test User',
  email: 'test@example.com'
});

// Verify joins work correctly
const result = await testApi.resources.posts.get(postId);
assert(typeof result.data.authorId === 'object');
```

## Advanced Examples

### Multi-tenant System

```javascript
// Add tenant isolation
api.hook('beforeQuery', async (context) => {
  const tenantId = context.options.tenantId || getCurrentTenantId();
  context.query.where('tenantId = ?', tenantId);
});

api.hook('beforeInsert', async (context) => {
  context.data.tenantId = getCurrentTenantId();
});
```

### Soft Deletes

```javascript
// Mark as deleted instead of removing
api.hook('beforeDelete', async (context) => {
  context.softDelete = true; // Prevent actual deletion
  
  // Update instead
  await api.update(context.id, {
    deletedAt: Date.now()
  }, context.options);
});

// Filter out deleted records
api.hook('modifyQuery', async (context) => {
  context.query.where('deletedAt IS NULL');
});
```

### Computed Fields

```javascript
api.hook('afterGet', async (context) => {
  if (context.options.type === 'users') {
    // Add computed field
    context.result.fullName = 
      `${context.result.firstName} ${context.result.lastName}`;
    
    // Add aggregate data
    const postCount = await api.resources.posts.query({
      filter: { authorId: context.result.id }
    });
    context.result.postCount = postCount.meta.total;
  }
});
```

### Audit Trail

```javascript
const AuditPlugin = {
  install(api) {
    // Track all changes
    ['afterInsert', 'afterUpdate', 'afterDelete'].forEach(hook => {
      api.hook(hook, async (context) => {
        await api.resources.auditLogs.create({
          resourceType: context.options.type,
          resourceId: context.id || context.result?.id,
          action: context.method,
          userId: context.options.userId,
          timestamp: Date.now(),
          changes: context.data
        });
      }, 90); // Run late
    });
  }
};
```

## Migration from v0.x

If you're migrating from an older version:

1. **Resource Access**: Use `api.resources.users` instead of `api.users`
2. **Registry Access**: Use `Api.registry` instead of `api.apis`
3. **Type Parameter**: No longer needed in operations (it's inferred from the resource proxy)
4. **Joins**: Configure in schema with `refs.join` instead of manual JOIN queries

---

For more details, see the [API Reference](./API.md).