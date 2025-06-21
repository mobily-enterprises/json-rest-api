# Advanced Topics

This section covers advanced features including API versioning, programmatic usage, query builder, error handling, and performance optimization.

## Table of Contents

1. [API Versioning](#api-versioning)
2. [Programmatic Usage](#programmatic-usage)
3. [Query Builder](#query-builder)
4. [Error Handling](#error-handling)
5. [Best Practices](#best-practices)
6. [Performance Optimization](#performance-optimization)

## API Versioning

### Creating Versioned APIs

```javascript
// Version 1
const apiV1 = createApi({
  name: 'myapp',
  version: '1.0.0',
  storage: 'memory'
});

apiV1.addResource('products', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  price: { type: 'number', required: true }
}));

// Version 2 with new field
const apiV2 = createApi({
  name: 'myapp',
  version: '2.0.0',
  storage: 'memory'
});

apiV2.addResource('products', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  price: { type: 'number', required: true },
  category: { type: 'string', required: true }  // New!
}));
```

### Using APIs Programmatically

```javascript
// Get latest version automatically
const api = Api.find('myapp', 'latest');

// Get specific version
const apiV1 = Api.find('myapp', '1.0.0');

// Get minimum version (2.0.0 or higher)
const apiV2Plus = Api.find('myapp', '2.0.0');

// Use it with the resource proxy
const user = await api.resources.users.create({
  name: 'John',
  email: 'john@example.com'
});
```

### Cross-API Communication

APIs can access each other automatically with version compatibility:

```javascript
const ordersApi = createApi({
  name: 'orders',
  version: '1.0.0'
});

// Inside orders API, access users API from registry
ordersApi.hook('afterInsert', async (context) => {
  // Get a compatible users API from the registry
  const usersApi = Api.find('users', '>=1.0.0');
  if (usersApi) {
    const user = await usersApi.resources.users.get(context.data.userId);
    // Use the user data...
  }
});
```

### HTTP Version Negotiation

The library handles all HTTP version routing automatically:

```javascript
// Mount APIs - versioning is automatic
userApiV1.mount(app);   // Available at /api/1.0.0/users
userApiV2.mount(app);   // Available at /api/2.0.0/users

// Clients can request versions:
// Via header
fetch('/api/users', {
  headers: { 'API-Version': '2.0.0' }
});

// Via query
fetch('/api/users?v=2.0.0');

// Via path
fetch('/api/2.0.0/users');
```

### Version Resolution Rules

The library automatically finds the right version:

- `'latest'` → Newest version
- `'2.0.0'` → Exactly 2.0.0 OR the newest version ≥ 2.0.0
- `'^2.0.0'` → Any 2.x.x version (npm style)
- `'~2.1.0'` → Any 2.1.x version (npm style)
- `'>=2.0.0'` → Any version ≥ 2.0.0

### Registry Access

The Api class provides a rich registry API:

```javascript
// Check if an API exists
if (Api.registry.has('products', '2.0.0')) {
  const api = Api.registry.get('products', '2.0.0');
}

// Get all versions of an API
const versions = Api.registry.versions('products');
// ['2.0.0', '1.0.0']

// List all registered APIs
const allApis = Api.registry.list();
// { products: ['2.0.0', '1.0.0'], users: ['1.0.0'] }
```

## Programmatic Usage

Here's how to use the JSON REST API methods programmatically without HTTP:

### Basic Setup

```javascript
import { createApi, Schema } from 'json-rest-api';

// Create API instance
const api = createApi({
  storage: 'memory', // or 'mysql'
  http: false        // Disable HTTP if using programmatically only
});

// Define a schema
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true, lowercase: true },
  age: { type: 'number', min: 0 },
  active: { type: 'boolean', default: true }
});

// Register schema
api.addResource('users', userSchema);
```

### CRUD Operations

```javascript
// Create
const newUser = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30
});

// Read
const user = await api.resources.users.get('1');

// Update
const updated = await api.resources.users.update('1', {
  age: 31,
  active: false
});

// Delete
await api.resources.users.delete('1');

// Query
const activeAdults = await api.resources.users.query({
  filter: {
    active: true,
    age: { $gte: 18 }
  },
  sort: '-age,name',
  page: {
    size: 20,
    number: 1
  }
});
```

### Advanced Usage

#### With MySQL Storage

```javascript
import { Api, MySQLPlugin, ValidationPlugin } from 'json-rest-api';

const api = new Api()
  .use(ValidationPlugin)
  .use(MySQLPlugin, {
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'myapp'
    }
  });

// Sync schema with database
await api.syncSchema(userSchema, 'users');
```

#### With Authentication Context

```javascript
// All operations can include auth context
const result = await api.resources.posts.create({
  title: 'Secure Post',
  content: 'This is secure'
}, {
  userId: 'user-123',      // From decoded JWT
  authenticated: true,
  permissions: ['create', 'read']
});
```

#### Batch Operations

```javascript
// Insert multiple records
const users = [
  { name: 'User 1', email: 'user1@example.com' },
  { name: 'User 2', email: 'user2@example.com' },
  { name: 'User 3', email: 'user3@example.com' }
];

const created = await Promise.all(
  users.map(user => api.resources.users.create(user))
);
```

#### With Transactions (MySQL)

```javascript
// Get connection pool
const { pool } = api.getConnection();
const connection = await pool.getConnection();

try {
  await connection.beginTransaction();

  // Create user
  const user = await api.resources.users.create({
    name: 'Transaction User',
    email: 'tx@example.com'
  }, {
    connection  // Pass connection for transaction
  });

  // Create related profile
  await api.resources.profiles.create({
    userId: user.data.id,
    bio: 'Created in transaction'
  }, {
    connection
  });

  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}
```

### Complete Example: Task Manager

```javascript
import { createApi, Schema, PositioningPlugin } from 'json-rest-api';

// Create API
const api = createApi({ storage: 'memory' })
  .use(PositioningPlugin);

// Define schema
const taskSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  completed: { type: 'boolean', default: false },
  priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
  dueDate: { type: 'date' },
  position: { type: 'number' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

api.addResource('tasks', taskSchema);

// Usage
async function taskManager() {
  // Create tasks
  const task1 = await api.resources.tasks.create({
    title: 'Write documentation',
    priority: 'high',
    dueDate: '2024-12-31'
  });

  const task2 = await api.resources.tasks.create({
    title: 'Review PR',
    priority: 'medium',
    beforeId: task1.data.id  // Position before first task
  });

  // List high priority incomplete tasks
  const urgent = await api.resources.tasks.query({
    filter: {
      completed: false,
      priority: 'high'
    },
    sort: 'position,dueDate'
  });

  console.log(`Found ${urgent.meta.total} urgent tasks`);

  // Complete a task
  await api.resources.tasks.update(task1.data.id, {
    completed: true
  });

  // Reorder tasks
  await api.reposition('tasks', task2.data.id, null); // Move to end
}
```

## Query Builder

For complex queries, use the QueryBuilder directly:

```javascript
import { QueryBuilder } from 'json-rest-api';

const query = new QueryBuilder('posts')
  .select('posts.*', 'users.name as authorName')
  .leftJoin('users', 'users.id = posts.authorId')
  .where('posts.published = ?', true)
  .where('posts.createdAt > ?', '2024-01-01')
  .groupBy('posts.categoryId')
  .having('COUNT(*) > ?', 5)
  .orderBy('posts.createdAt', 'DESC')
  .limit(10);

const sql = query.toSQL();
const results = await api.mysql.query(sql, query.getArgs());
```

### QueryBuilder Methods

#### `select(...fields)`
Add fields to SELECT clause.
```javascript
query.select('id', 'name', 'email');
query.select('COUNT(*) as total');
```

#### `where(condition, ...args)`
Add WHERE condition.
```javascript
query.where('active = ?', true);
query.where('age BETWEEN ? AND ?', 18, 65);
```

#### `join(type, tableOrField, on?)`
Add JOIN clause. If `on` is omitted and the field has refs, uses automatic join.
```javascript
// Manual join
query.leftJoin('comments', 'comments.userId = users.id');

// Automatic join using refs
query.leftJoin('authorId'); // Uses schema refs
```

#### `orderBy(field, direction?)`
Add ORDER BY clause.
```javascript
query.orderBy('createdAt', 'DESC');
query.orderBy('name'); // Default: ASC
```

#### `limit(limit, offset?)`
Add LIMIT clause.
```javascript
query.limit(20);       // LIMIT 20
query.limit(20, 40);   // LIMIT 40, 20 (MySQL syntax)
```

## Error Handling

### Error Classes

All errors extend the base `ApiError` class:

```javascript
class ApiError extends Error {
  status: number;        // HTTP status code
  code: string;         // Error code
  title: string;        // Error title
  context: any;         // Additional context
  
  withContext(context): this;
}
```

### Specific Errors

#### ValidationError
```javascript
const error = new ValidationError();
error.addFieldError('email', 'Invalid format', 'INVALID_FORMAT');
throw error;
```

#### NotFoundError
```javascript
throw new NotFoundError('users', 123);
```

#### BadRequestError
```javascript
throw new BadRequestError('Invalid filter parameter')
  .withContext({ parameter: 'filter[status]' });
```

#### ConflictError
```javascript
throw new ConflictError('Email already exists')
  .withContext({ field: 'email' });
```

### Error Handling Patterns

```javascript
try {
  const user = await api.resources.users.create({
    name: 'J',  // Too short!
    email: 'invalid-email'
  });
} catch (error) {
  if (error.errors) {
    // Validation errors
    error.errors.forEach(err => {
      console.log(`${err.field}: ${err.message}`);
    });
  } else {
    // Other errors
    console.error('Unexpected error:', error);
  }
}
```

### Error Response Format

```json
{
  "errors": [{
    "status": "400",
    "title": "REQUIRED_FIELD",
    "detail": "Email is required",
    "source": {
      "pointer": "/data/attributes/email"
    }
  }]
}
```

## Best Practices

### 1. Always Use the Resource Proxy API

The resource proxy API provides a more intuitive and maintainable way to interact with your resources:

```javascript
// ✅ Preferred
const user = await api.resources.users.get(123);
const posts = await api.resources.posts.query({ filter: { authorId: 123 } });

// ❌ Avoid
const user = await api.get(123, { type: 'users' });
const posts = await api.query({ filter: { authorId: 123 } }, { type: 'posts' });
```

### 2. Always Mark Searchable Fields

Only fields marked as `searchable: true` can be filtered in queries. This prevents arbitrary field access and improves security:

```javascript
const schema = new Schema({
  // Can be filtered
  email: { type: 'string', searchable: true },
  status: { type: 'string', searchable: true },
  
  // Cannot be filtered
  internalNotes: { type: 'string' },
  apiKey: { type: 'string', silent: true }
});
```

### 3. Use Virtual Search Fields

For complex searches that don't map directly to database columns:

```javascript
api.addResource('posts', schema, {
  searchableFields: {
    title: 'title',     // Normal field mapping
    author: 'authorId', // Different name mapping
    search: '*'         // Virtual field (marked with *)
  }
});

// Handle virtual fields in hooks
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    const searchTerm = context.params.filter.search;
    delete context.params.filter.search;
    
    // Transform to actual database query
    context.query.where(
      '(title LIKE ? OR content LIKE ? OR tags LIKE ?)',
      `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`
    );
  }
});
```

### 4. Common Patterns

#### Multi-Tenant APIs

Implement tenant isolation at the query level:

```javascript
// Add tenant context to all queries
api.hook('beforeQuery', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (tenantId) {
    context.params.filter.tenantId = tenantId;
  }
});

// Add tenant ID on creation
api.hook('beforeInsert', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (tenantId) {
    context.data.tenantId = tenantId;
  }
});
```

#### Audit Logging

Track all data modifications:

```javascript
api.hook('afterInsert', async (context) => {
  await auditLog.create({
    action: 'create',
    resource: context.options.type,
    resourceId: context.result.data.id,
    userId: context.options.user?.id,
    data: context.result.data,
    timestamp: Date.now()
  });
});

api.hook('afterUpdate', async (context) => {
  await auditLog.create({
    action: 'update',
    resource: context.options.type,
    resourceId: context.id,
    userId: context.options.user?.id,
    changes: context.data,
    timestamp: Date.now()
  });
});
```

#### Soft Deletes

Implement soft deletes instead of hard deletes:

```javascript
// Add deletedAt field to schema
const schema = new Schema({
  // ... other fields
  deletedAt: { type: 'timestamp', silent: true }
});

// Override delete behavior
api.hook('beforeDelete', async (context) => {
  // Convert delete to update
  context.method = 'update';
  context.data = { deletedAt: Date.now() };
});

// Filter out soft-deleted records
api.hook('beforeQuery', async (context) => {
  // Add filter to exclude soft-deleted records
  if (!context.params.filter.includeDeleted) {
    context.params.filter.deletedAt = null;
  }
});
```

## Performance Optimization

### 1. Use Indexes

Ensure searchable fields are indexed:

```javascript
const schema = new Schema({
  email: { type: 'string', searchable: true, index: true },
  status: { type: 'string', searchable: true, index: true },
  createdAt: { type: 'timestamp', searchable: true, index: true }
});

// Note: Making a field searchable allows filtering,
// adding index improves query performance

// Composite indexes for common queries
await api.syncSchema(schema, 'users', {
  indexes: [
    { fields: ['status', 'createdAt'] },
    { fields: ['email'], unique: true }
  ]
});
```

### 2. Limit Result Size

```javascript
// Bad: Fetch everything
const allUsers = await api.resources.users.query();

// Good: Paginate
const users = await api.resources.users.query({
  page: { size: 50 }
});

// Good: Limit fields
const userList = await api.resources.users.query({
  fields: ['id', 'name', 'email'],
  page: { size: 50 }
});
```

### 3. Avoid N+1 Queries

```javascript
// Bad: N+1 problem
const posts = await api.resources.posts.query();
for (const post of posts.data) {
  const author = await api.resources.users.get(post.authorId);
  post.authorName = author.data.name;
}

// Good: Use joins
const posts = await api.resources.posts.query({
  joins: ['authorId']
});

// Good: Batch fetch
const authorIds = [...new Set(posts.data.map(p => p.authorId))];
const authors = await api.resources.users.query({
  filter: { id: { $in: authorIds } }
});
```

### 4. Query Analysis

Use MySQL EXPLAIN for complex queries:

```javascript
// In development, analyze queries
api.hook('beforeQuery', async (context) => {
  if (process.env.NODE_ENV === 'development') {
    const query = context.query.toSQL();
    const explain = await api.mysql.query(`EXPLAIN ${query}`);
    console.log('Query plan:', explain);
  }
});
```

### 5. Caching Strategies

```javascript
// Cache common queries
const cachedQuery = async (params, options) => {
  const key = JSON.stringify({ params, type: options.type });
  
  let result = cache.get(key);
  if (!result) {
    result = await api.query(params, options);
    cache.set(key, result, 300); // 5 minutes
  }
  
  return result;
};
```


---

**← Previous**: [Plugins & Architecture](./GUIDE_3_Plugins_and_Architecture.md) | **Next**: [Production, Deployment & Testing →](./GUIDE_5_Production_and_Deployment.md)
