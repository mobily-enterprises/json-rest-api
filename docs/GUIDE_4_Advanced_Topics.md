# Advanced Topics

This section covers advanced features including API versioning, programmatic usage, query builder, error handling, performance optimization, transactions, batch operations, and connection pool management.

## Table of Contents

1. [API Versioning](#api-versioning)
2. [Programmatic Usage](#programmatic-usage)
3. [Query Builder](#query-builder)
4. [Error Handling](#error-handling)
5. [Best Practices](#best-practices)
6. [Performance Optimization](#performance-optimization)
7. [Transactions](#transactions)
8. [Batch Operations](#batch-operations)
9. [Bulk Operations](#bulk-operations)
10. [HTTP Endpoints](#http-endpoints)
11. [Connection Pool Management](#connection-pool-management)

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

## Transactions

JSON REST API provides high-level transaction support for database operations.

### Basic Transactions

```javascript
// Execute operations within a transaction
const result = await api.transaction(async (trx) => {
  // All operations use the same database connection
  const user = await trx.resources.users.create({
    name: 'Alice',
    email: 'alice@example.com'
  });
  
  const account = await trx.resources.accounts.create({
    userId: user.id,
    balance: 1000
  });
  
  // Return value is passed through
  return { user, account };
});

// If any operation fails, everything is rolled back
```

### Transaction Options

```javascript
await api.transaction(async (trx) => {
  // Operations here
}, {
  timeout: 5000,              // Transaction timeout in milliseconds
  retries: 3,                 // Retry on deadlock/conflict
  isolationLevel: 'READ COMMITTED'  // MySQL isolation level
});
```

### Savepoints

```javascript
await api.transaction(async (trx) => {
  const order = await trx.resources.orders.create({ total: 100 });
  
  try {
    // Create a savepoint for risky operations
    await trx.savepoint('process_payment', async () => {
      await trx.resources.payments.create({
        orderId: order.id,
        amount: 100,
        status: 'pending'
      });
      
      // This might fail
      await processExternalPayment(order);
    });
  } catch (error) {
    // Only the savepoint is rolled back, not the entire transaction
    await trx.resources.orders.update(order.id, { status: 'payment_failed' });
  }
});
```

## Batch Operations

Execute multiple operations efficiently with batch operations.

### Mixed Batch Operations

```javascript
// Execute different types of operations
const results = await api.batch([
  { method: 'create', type: 'users', data: { name: 'Alice' } },
  { method: 'create', type: 'users', data: { name: 'Bob' } },
  { method: 'update', type: 'products', id: 123, data: { price: 99.99 } },
  { method: 'delete', type: 'orders', id: 456 },
  { method: 'query', type: 'users', params: { filter: { active: true } } }
], {
  stopOnError: false,    // Continue even if some operations fail
  parallel: true         // Execute independent operations in parallel
});

// Check results
console.log(`Success: ${results.successful}, Failed: ${results.failed}`);
results.results.forEach(result => {
  if (result.success) {
    console.log('Operation succeeded:', result.data);
  } else {
    console.error('Operation failed:', result.error);
  }
});
```

### Transactional Batches

```javascript
// All operations in a single transaction
await api.batch.transaction(async (batch) => {
  // Create multiple accounts
  const accounts = await batch.resources.accounts.create([
    { name: 'Checking', balance: 1000 },
    { name: 'Savings', balance: 5000 }
  ]);
  
  // Update multiple users
  await batch.resources.users.update([
    { id: 1, data: { accountId: accounts[0].id } },
    { id: 2, data: { accountId: accounts[1].id } }
  ]);
  
  // If anything fails, everything is rolled back
});
```

## Bulk Operations

Optimized operations for multiple records of the same type.

### Bulk Create

```javascript
// Create multiple records with a single query
const users = await api.resources.users.bulk.create([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
  { name: 'Charlie', email: 'charlie@example.com' }
], {
  chunk: 1000,         // Process in chunks to avoid memory issues
  validate: true,      // Pre-validate all records
  returnIds: true,     // Include generated IDs in response
  onProgress: (current, total) => {
    console.log(`Processed ${current}/${total}`);
  }
});
```

### Bulk Update

```javascript
// Update specific records
const results = await api.resources.products.bulk.update([
  { id: 1, data: { price: 19.99, discounted: true } },
  { id: 2, data: { price: 29.99, discounted: true } },
  { id: 3, data: { price: 39.99, discounted: true } }
]);

// Update by filter (single UPDATE query)
const result = await api.resources.products.bulk.update({
  filter: { category: 'electronics', price: { gt: 100 } },
  data: { discounted: true, discountPercent: 20 }
});
console.log(`Updated ${result.updated} products`);
```

### Bulk Delete

```javascript
// Delete specific records
await api.resources.users.bulk.delete([1, 2, 3, 4, 5]);

// Delete by filter (single DELETE query)
const result = await api.resources.logs.bulk.delete({
  filter: { 
    createdAt: { lt: '2023-01-01' },
    level: 'debug'
  }
});
console.log(`Deleted ${result.deleted} old debug logs`);
```

## HTTP Endpoints

When using the HTTPPlugin, batch and bulk operations are exposed via HTTP endpoints.

### Batch Endpoint

```http
POST /api/batch
Content-Type: application/json

{
  "operations": [
    {
      "method": "create",
      "type": "users",
      "data": {
        "type": "users",
        "attributes": { "name": "Alice", "email": "alice@example.com" }
      }
    },
    {
      "method": "query",
      "type": "users",
      "params": { "filter": { "active": true } }
    }
  ],
  "options": {
    "stopOnError": false
  }
}
```

### Bulk Endpoints

```http
# Bulk create
POST /api/users/bulk
Content-Type: application/json

{
  "data": [
    { "type": "users", "attributes": { "name": "Alice" } },
    { "type": "users", "attributes": { "name": "Bob" } }
  ]
}

# Bulk update by filter
PATCH /api/products/bulk
Content-Type: application/json

{
  "filter": { "category": "electronics" },
  "data": { "attributes": { "discounted": true } }
}

# Bulk delete
DELETE /api/logs/bulk
Content-Type: application/json

{
  "filter": { "createdAt": { "lt": "2023-01-01" } }
}
```

## Connection Pool Management

Configure and monitor database connection pools for optimal performance.

### Configuration

```javascript
const api = createApi({
  storage: 'mysql',
  mysql: {
    host: 'localhost',
    database: 'myapp',
    pool: {
      max: 20,                    // Maximum pool size
      min: 5,                     // Minimum pool size
      acquireTimeout: 30000,      // Max wait for connection (ms)
      idleTimeout: 60000,         // Close idle connections after (ms)
      connectionLimit: 100,       // Global connection limit
      queueLimit: 0,              // Max queued requests (0 = unlimited)
      enableKeepAlive: true,      // TCP keep-alive
      keepAliveInitialDelay: 0    // Keep-alive delay
    }
  }
});
```

### Monitoring

```javascript
// Get pool statistics
const stats = await api.getPoolStats();
console.log(`Active: ${stats.active}/${stats.total}`);
console.log(`Waiting: ${stats.waiting}`);

// Monitor pool events
api.on('pool:acquire', (connection) => {
  console.log('Connection acquired:', connection.threadId);
});

api.on('pool:timeout', (info) => {
  console.error('Connection timeout - pool may be exhausted');
  // Consider scaling or optimizing queries
});
```

### Best Practices

1. **Size appropriately**: Set `max` based on your database's connection limit
2. **Monitor in production**: Track pool stats to identify bottlenecks
3. **Handle timeouts gracefully**: Implement retry logic for pool timeouts
4. **Close connections**: Always call `api.disconnect()` on shutdown
5. **Use transactions wisely**: Long transactions hold connections


## Computed Resources (No Database)

The ComputedPlugin enables you to create API resources that generate data on-the-fly without any database storage. This powerful feature allows you to mix computed resources with database-backed resources in the same API instance.

### When to Use Computed Resources

Computed resources are perfect for:

1. **Aggregations & Statistics**: Calculate real-time statistics from existing data
2. **External API Proxies**: Wrap third-party APIs with your schema and features
3. **Real-time Data**: System metrics, server status, live calculations
4. **Mock Data**: Generate test data during development
5. **Derived Values**: Data that can be calculated from other sources

### Basic Usage

```javascript
import { ComputedPlugin } from 'json-rest-api';

api.use(ComputedPlugin);

// Simple computed resource
api.addResource('random-numbers', numberSchema, {
  compute: {
    get: async (id, context) => {
      return {
        id,
        value: Math.random() * 1000,
        generatedAt: new Date()
      };
    },
    
    query: async (params, context) => {
      // Generate 100 items
      // The plugin handles filtering, sorting, pagination!
      return Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        value: Math.random() * 1000,
        category: ['A', 'B', 'C'][i % 3]
      }));
    }
  }
});

// Use it like any other resource!
// GET /api/random-numbers?filter[value][gte]=500&sort=-value
```

### Aggregating Database Data

Computed resources can access other resources to create aggregations:

```javascript
api.addResource('dashboard-stats', statsSchema, {
  compute: {
    get: async (period, context) => {
      // Access multiple resources
      const [users, orders, revenue] = await Promise.all([
        context.api.resources.users.query({
          filter: { createdAt: { gte: periodStart(period) } }
        }),
        context.api.resources.orders.query({
          filter: { status: 'completed' }
        }),
        context.api.resources.transactions.query({
          filter: { type: 'revenue' }
        })
      ]);
      
      // Calculate and return statistics
      return {
        id: period,
        newUsers: users.data.length,
        totalOrders: orders.data.length,
        revenue: revenue.data.reduce((sum, t) => 
          sum + t.attributes.amount, 0
        ),
        period,
        calculatedAt: new Date()
      };
    }
  }
});
```

### External API Proxy Pattern

Wrap external APIs with your schema and get all API features for free:

```javascript
api.addResource('github-repos', repoSchema, {
  compute: {
    query: async (params, context) => {
      // Use filters in external API call
      const username = params.filter?.username || 'torvalds';
      
      // Fetch from GitHub
      const response = await fetch(
        `https://api.github.com/users/${username}/repos`
      );
      const repos = await response.json();
      
      // Transform to your schema
      return repos.map(repo => ({
        id: repo.id,
        name: repo.name,
        stars: repo.stargazers_count,
        language: repo.language,
        owner: username
      }));
    },
    
    get: async (repoId, context) => {
      const response = await fetch(
        `https://api.github.com/repositories/${repoId}`
      );
      
      if (!response.ok) return null; // Triggers NotFoundError
      
      const repo = await response.json();
      return transformRepo(repo);
    }
  }
});

// Now you get validation, filtering, sorting, pagination, auth, etc.!
// GET /api/github-repos?filter[language]=JavaScript&sort=-stars
```

### Performance Optimization

By default, the plugin handles filtering, sorting, and pagination for you. For external APIs or large datasets, you can optimize by handling these yourself:

```javascript
api.addResource('products', productSchema, {
  compute: {
    query: async (params, context) => {
      // Build external API URL with parameters
      const url = new URL('https://api.store.com/products');
      
      // Apply filters directly
      if (params.filter?.category) {
        url.searchParams.set('category', params.filter.category);
      }
      
      // Apply sorting
      if (params.sort) {
        url.searchParams.set('sort', params.sort);
      }
      
      // Apply pagination
      if (params.page) {
        url.searchParams.set('limit', params.page.size);
        url.searchParams.set('offset', 
          (params.page.number - 1) * params.page.size
        );
      }
      
      const response = await fetch(url);
      const data = await response.json();
      
      return data.products;
    },
    
    // Tell plugin you handle these operations
    handlesFiltering: true,
    handlesSorting: true,
    handlesPagination: true
  }
});
```

### Real-time System Metrics

```javascript
import os from 'os';

api.addResource('system-health', healthSchema, {
  compute: {
    get: async (metric, context) => {
      switch (metric) {
        case 'cpu':
          const load = os.loadavg();
          return {
            id: 'cpu',
            usage: load[0],
            cores: os.cpus().length,
            loadAverage: load
          };
          
        case 'memory':
          const total = os.totalmem();
          const free = os.freemem();
          return {
            id: 'memory',
            total,
            used: total - free,
            percentage: ((total - free) / total) * 100
          };
          
        default:
          return null;
      }
    }
  }
});
```

### Write Operations

Computed resources can also support insert, update, and delete:

```javascript
api.addResource('cache-entries', cacheSchema, {
  compute: {
    insert: async (data, context) => {
      const entry = {
        id: generateId(),
        key: data.key,
        value: data.value,
        ttl: data.ttl || 3600
      };
      
      await redisClient.set(entry.key, entry.value, {
        EX: entry.ttl
      });
      
      return entry;
    },
    
    update: async (id, data, context) => {
      const existing = await redisClient.get(id);
      if (!existing) return null;
      
      await redisClient.set(id, { ...existing, ...data });
      return { id, ...data };
    },
    
    delete: async (id, context) => {
      const result = await redisClient.del(id);
      return result > 0; // true if deleted
    }
  }
});
```

### Best Practices

1. **Always Return Arrays from query**: The query function must return an array
2. **Return null for Not Found**: In get/update, return null to trigger NotFoundError
3. **Include IDs**: Ensure all returned objects have an ID field
4. **Handle Errors Gracefully**: Catch and wrap external API errors
5. **Consider Caching**: Cache expensive computations when appropriate
6. **Use Context**: Access `context.api` for other resources, `context.options.user` for auth

### Advanced Patterns

#### Search Aggregator

```javascript
api.addResource('search', searchResultSchema, {
  compute: {
    query: async (params, context) => {
      const query = params.filter?.q;
      if (!query) return [];
      
      // Search across multiple resources
      const [users, posts, products] = await Promise.all([
        context.api.resources.users.query({
          filter: { name: { contains: query } }
        }),
        context.api.resources.posts.query({
          filter: { title: { contains: query } }
        }),
        context.api.resources.products.query({
          filter: { name: { contains: query } }
        })
      ]);
      
      // Combine and score results
      return [
        ...users.data.map(u => ({
          id: `user-${u.id}`,
          type: 'user',
          title: u.attributes.name,
          score: calculateRelevance(u.attributes.name, query)
        })),
        ...posts.data.map(p => ({
          id: `post-${p.id}`,
          type: 'post',
          title: p.attributes.title,
          score: calculateRelevance(p.attributes.title, query)
        })),
        // ... products
      ].sort((a, b) => b.score - a.score);
    }
  }
});
```

#### Computed Relationships

Regular resources can have computed relationships:

```javascript
api.addResource('users', userSchema.extend({
  // Virtual computed field
  stats: {
    type: 'object',
    virtual: true,
    computed: true,
    async resolve(user, context) {
      const stats = await context.api.resources['user-stats'].get(user.id);
      return stats.data.attributes;
    }
  }
}));
```

### Summary

The ComputedPlugin provides incredible flexibility for creating dynamic API resources without database storage. By combining computed and database resources, you can build rich APIs that serve exactly the data your clients need, whether it's aggregated statistics, external API data, real-time metrics, or complex calculations.

---

**← Previous**: [Plugins & Architecture](./GUIDE_3_Plugins_and_Architecture.md) | **Next**: [Production, Deployment & Testing →](./GUIDE_5_Production_and_Deployment.md)
