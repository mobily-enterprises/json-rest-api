# JSON REST API Onboarding Guide

Welcome! This guide will teach you everything about this codebase. We'll start from the basics and build up your understanding step by step.

## Table of Contents

1. [What is this codebase?](#what-is-this-codebase)
2. [Architecture Overview](#architecture-overview)
3. [The Main API Class](#the-main-api-class)
4. [Core Concepts](#core-concepts)
5. [Plugin System](#plugin-system)
6. [Storage Plugins](#storage-plugins)
7. [Feature Plugins](#feature-plugins)
8. [How Everything Fits Together](#how-everything-fits-together)

## What is this codebase?

This is a **plugin-based JSON REST API library**. Think of it like building blocks:
- You start with a basic API object
- You add plugins to give it superpowers (like database storage, validation, etc.)
- You define resources (like "users", "posts", "comments")
- The library automatically creates REST endpoints for these resources

### Why is it built this way?

Most REST APIs do the same things over and over:
- Create records (POST)
- Read records (GET)
- Update records (PUT/PATCH)
- Delete records (DELETE)
- List/search records (GET with filters)

Instead of writing this code repeatedly, this library does it for you!

## Architecture Overview

```
┌─────────────────────┐
│     Your App        │
├─────────────────────┤
│    API Instance     │  ← Main orchestrator
├─────────────────────┤
│     Resources       │  ← Your data types (users, posts, etc.)
├─────────────────────┤
│      Plugins        │  ← Add features
├─────────────────────┤
│   Storage Layer     │  ← Where data lives (Memory, MySQL, etc.)
└─────────────────────┘
```

## The Main API Class

Let's dive into the main file: `lib/api.js`

### Creating an API Instance

```javascript
const api = new Api(options);
```

When you create a new API, here's what happens inside:

```javascript
constructor(options = {}) {
  // Merge user options with defaults
  this.options = {
    idProperty: 'id',          // What field is the ID?
    artificialDelay: 0,        // Slow down for testing?
    apiRoot: '',              // URL prefix
    schemaVersion: null,      // Version support
    debug: false,             // Show debug logs?
    debugSQL: false,          // Show SQL queries?
    ...options                // Your custom options
  };
```

**Why these defaults?**
- `idProperty: 'id'` - Most databases use 'id', but some use '_id' or 'uuid'
- `artificialDelay: 0` - Useful for testing loading states in your UI
- `debug: false` - You don't want logs in production

### Internal Properties

```javascript
this._resources = {};              // Stores all your resources
this._resourceSchemas = {};        // Stores schemas for validation
this._schemaMap = new Map();       // Fast schema lookup
this._plugins = [];                // List of installed plugins
this._hooks = {};                  // Event system
this._implementations = {};        // Plugin implementations
this._proxies = {};                // Caches for resource proxies
```

**Why so many storage objects?**
- `_resources` - Quick lookup by name: "users" → user config
- `_resourceSchemas` - Validation rules for each resource
- `_schemaMap` - Even faster lookup using Map (better performance)
- `_hooks` - Allows plugins to react to events

### The Plugin System

```javascript
use(plugin, options = {}) {
  if (!plugin || typeof plugin.install !== 'function') {
    throw new Error('Plugin must have an install method');
  }
  
  // Track that we installed this plugin
  this._plugins.push({ plugin, options });
  
  // Let the plugin set itself up
  plugin.install(this, options);
  
  return this; // For chaining: api.use(Plugin1).use(Plugin2)
}
```

**Example of using a plugin:**
```javascript
api.use(MySQLPlugin, { 
  host: 'localhost',
  user: 'root',
  password: 'secret'
});
```

**Why return `this`?**
It allows chaining: `api.use(Plugin1).use(Plugin2).use(Plugin3)`

### Adding Resources

This is where you define your data types:

```javascript
addResource(type, schema, options = {}) {
  // Validate inputs
  if (!type || typeof type !== 'string') {
    throw new ValidationError('Resource type must be a non-empty string');
  }
  
  if (!schema || !(schema instanceof Schema)) {
    throw new ValidationError('Schema must be an instance of Schema class');
  }
```

**Example:**
```javascript
// Define a user schema
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  age: { type: 'number', min: 0, max: 150 }
});

// Add it to the API
api.addResource('users', userSchema);
```

**What happens next:**
1. The schema is stored for validation
2. Default config is created (storage, timestamps, etc.)
3. A resource proxy is created for easy access

### Resource Proxy - The Magic

When you add a resource, you can access it like this:
```javascript
api.resources.users.create({ name: 'John', email: 'john@example.com' })
api.resources.users.get(123)
api.resources.users.update(123, { name: 'John Doe' })
api.resources.users.delete(123)
api.resources.users.query({ filter: { age: { $gte: 18 } } })
```

**How does this work?**

```javascript
createResourceProxy(type) {
  const self = this;
  
  return new Proxy({}, {
    get(target, method) {
      // Map method names to implementations
      const methodMap = {
        'get': (...args) => self.get({ type }, ...args),
        'find': (...args) => self.get({ type }, ...args),
        'create': (data, options) => self.insert({ type, data }, options),
        'post': (data, options) => self.insert({ type, data }, options),
        'update': (id, data, options) => self.update({ type, id, data }, options),
        'delete': (id, options) => self.delete({ type, id }, options),
        'query': (params = {}, options = {}) => self.query({ type, ...params }, options),
        'list': (params = {}, options = {}) => self.query({ type, ...params }, options)
      };
```

**Why use a Proxy?**
- Natural syntax: `api.resources.users.get(123)` instead of `api.get('users', 123)`
- Type safety: You can't typo the resource name
- Consistency: All resources work the same way

### Virtual Search Fields (The "*" Feature)

This is a powerful feature for implementing custom search logic:

```javascript
api.addResource('posts', postSchema, {
  searchableFields: {
    title: 'title',              // Maps to real field
    authorName: 'author.name',   // Maps to joined field
    search: '*',                 // Virtual field - no direct mapping
    q: '*'                       // Another virtual field
  }
});
```

**What does "*" mean?**
- It marks a field as "virtual" - it doesn't map to any database column
- The SQL generator skips these fields
- You handle them manually in hooks

**How it works:**

1. **User sends query:**
   ```javascript
   GET /api/posts?filter[search]=javascript
   ```

2. **Validation passes** because 'search' is in searchableFields

3. **SQL generation skips** the virtual field:
   ```javascript
   // In sql-generic.js
   if (actualPath === '*') {
     // Skip - will be handled by hooks
     continue;
   }
   ```

4. **Your hook handles it:**
   ```javascript
   api.hook('modifyQuery', async (context) => {
     if (context.params.filter?.search && context.options.type === 'posts') {
       const searchTerm = context.params.filter.search;
       
       // Remove from filter to prevent SQL errors
       delete context.params.filter.search;
       
       // Add custom SQL for multi-field search
       context.query.where(
         '(posts.title LIKE ? OR posts.content LIKE ? OR posts.tags LIKE ?)',
         `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`
       );
     }
   });
   ```

**Real-world example - Advanced search syntax:**
```javascript
// Support complex search syntax
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    const search = context.params.filter.search;
    delete context.params.filter.search;
    
    // Parse special syntax
    if (search.startsWith('author:')) {
      const authorName = search.substring(7);
      context.query.join('users', 'posts.authorId', 'users.id');
      context.query.where('users.name LIKE ?', `%${authorName}%`);
      
    } else if (search.startsWith('tag:')) {
      const tag = search.substring(4);
      context.query.where('posts.tags LIKE ?', `%${tag}%`);
      
    } else if (search.includes(' OR ')) {
      // Handle OR searches
      const terms = search.split(' OR ');
      const conditions = terms.map(() => 'posts.title LIKE ? OR posts.content LIKE ?');
      const params = terms.flatMap(term => [`%${term}%`, `%${term}%`]);
      context.query.where(`(${conditions.join(' OR ')})`, ...params);
      
    } else {
      // Default multi-field search
      context.query.where(
        '(posts.title LIKE ? OR posts.content LIKE ?)',
        `%${search}%`, `%${search}%`
      );
    }
  }
});

// Now users can search like:
// GET /api/posts?filter[search]=javascript
// GET /api/posts?filter[search]=author:john
// GET /api/posts?filter[search]=tag:tutorial
// GET /api/posts?filter[search]=react OR vue
```

**Why use virtual fields?**
1. **Flexibility** - Implement any search logic
2. **Clean API** - Users don't need to know your schema
3. **Performance** - Can optimize queries based on search type
4. **Advanced features** - Full-text search, fuzzy matching, etc.

### The Hook System

Hooks let plugins (and your code) react to events:

```javascript
hook(eventName, handler, priority = 10) {
  if (!this._hooks[eventName]) {
    this._hooks[eventName] = [];
  }
  
  this._hooks[eventName].push({ handler, priority });
  
  // Sort by priority (lower numbers run first)
  this._hooks[eventName].sort((a, b) => a.priority - b.priority);
}
```

**Example hooks:**
```javascript
// Run before any insert
api.hook('beforeInsert', async (context) => {
  // Add timestamp
  context.data.createdAt = new Date();
});

// Run after successful insert
api.hook('afterInsert', async (context) => {
  // Send email
  await sendWelcomeEmail(context.result.email);
});
```

**Available hooks:**
- `beforeInsert`, `afterInsert`
- `beforeUpdate`, `afterUpdate`
- `beforeDelete`, `afterDelete`
- `beforeGet`, `afterGet`
- `beforeQuery`, `afterQuery`
- `modifyQuery` - Special hook for changing SQL queries

### Running Hooks

```javascript
async runHooks(eventName, context, options = {}) {
  const hooks = this._hooks[eventName] || [];
  
  for (const { handler } of hooks) {
    try {
      const result = await handler.call(this, context, options);
      
      // If a hook returns false, stop the chain
      if (result === false) {
        return false;
      }
    } catch (error) {
      // Wrap errors with context
      throw new InternalError(`Hook error in ${eventName}: ${error.message}`, {
        cause: error,
        event: eventName,
        context
      });
    }
  }
  
  return true;
}
```

**Why can hooks return false?**
To stop an operation. For example:
```javascript
api.hook('beforeDelete', async (context) => {
  if (context.id === 1) {
    // Don't allow deleting the admin user
    return false;
  }
});
```

### CRUD Operations

Let's look at each operation in detail:

#### INSERT (Create)

```javascript
async insert(params, options = {}) {
  // 1. Validate parameters
  const validation = paramsValidation.insert.validate(params);
  if (validation.error) {
    throw new ValidationError('Invalid insert parameters', {
      validationErrors: validation.error.details
    });
  }
```

**Input example:**
```javascript
api.insert({
  type: 'users',
  data: {
    name: 'John Doe',
    email: 'john@example.com',
    age: 25
  }
});
```

**What happens step by step:**

1. **Parameter validation** - Checks that type and data are provided
2. **Get resource config** - Looks up schema and settings
3. **Create context object:**
   ```javascript
   const context = {
     type: params.type,
     data: { ...params.data },  // Copy to avoid mutations
     options,
     api: this,
     config: this._resources[params.type]
   };
   ```
4. **Run beforeInsert hooks** - Plugins can modify data
5. **Schema validation** - Check required fields, types, etc.
6. **Execute storage insert** - Actually save to database
7. **Run afterInsert hooks** - Send emails, update cache, etc.
8. **Format response** - Convert to JSON:API format

**Output example:**
```javascript
{
  data: {
    type: 'users',
    id: '123',
    attributes: {
      name: 'John Doe',
      email: 'john@example.com',
      age: 25,
      createdAt: '2024-01-20T10:30:00Z'
    }
  }
}
```

#### GET (Read One)

```javascript
async get(params, options = {}) {
  // Special handling for direct ID
  if (typeof params === 'object' && params.id && !params.type) {
    throw new ValidationError('Direct get() calls require type parameter');
  }
```

**Input examples:**
```javascript
// Using resource proxy (recommended)
api.resources.users.get(123)

// Direct call
api.get({ type: 'users', id: 123 })

// With options
api.resources.users.get(123, { 
  fields: ['id', 'name'],  // Only get these fields
  allowNotFound: true      // Return null instead of error
})
```

**Why `allowNotFound` option?**
Sometimes you want to check if something exists without throwing an error:
```javascript
const user = await api.resources.users.get(123, { allowNotFound: true });
if (!user) {
  // User doesn't exist, create it
}
```

#### QUERY (List/Search)

This is the most complex operation:

```javascript
async query(params, options = {}) {
  // Set defaults
  const queryParams = {
    filter: params.filter || {},
    fields: params.fields || null,
    sort: params.sort || null,
    page: params.page || { limit: 50, offset: 0 },
    joins: params.joins || [],
    ...params
  };
```

**Input example:**
```javascript
api.resources.users.query({
  filter: {
    age: { $gte: 18 },           // Age >= 18
    email: { $like: '%@gmail.com' } // Gmail users
  },
  sort: ['-createdAt', 'name'],   // Newest first, then by name
  page: { limit: 10, offset: 20 }, // Page 3 (skip 20, take 10)
  fields: ['id', 'name', 'email'], // Only these fields
  joins: ['profile', 'posts']      // Include related data
})
```

**Filter operators:**
- `$eq` - Equals (default)
- `$ne` - Not equals
- `$gt`, `$gte` - Greater than (or equal)
- `$lt`, `$lte` - Less than (or equal)
- `$in` - In array
- `$nin` - Not in array
- `$like` - SQL LIKE
- `$null` - IS NULL
- `$notNull` - IS NOT NULL

**Sort syntax:**
- `'name'` - Ascending
- `'-name'` - Descending (note the minus)
- `['name', '-age']` - Multiple sorts

#### UPDATE

```javascript
async update(params, options = {}) {
  // Handle both syntaxes
  if (typeof params === 'object' && params.id && params.data && !params.type) {
    throw new ValidationError('Direct update() calls require type parameter');
  }
```

**Input examples:**
```javascript
// Full update (replaces all fields)
api.resources.users.update(123, {
  name: 'Jane Doe',
  email: 'jane@example.com',
  age: 26
})

// Partial update (only specified fields)
api.resources.users.update(123, {
  age: 27
}, { partial: true })
```

**Why partial updates?**
- Full update: Required fields must be present
- Partial update: Only validate provided fields

#### DELETE

```javascript
async delete(params, options = {}) {
  // Simple operation but important
```

**Input example:**
```javascript
api.resources.users.delete(123)
```

**What happens:**
1. beforeDelete hooks (can cancel)
2. Check if resource exists
3. Delete from storage
4. afterDelete hooks (cleanup related data)

### Error Handling

The API uses custom error classes:

```javascript
class ApiError extends Error {
  constructor(message, statusCode = 500, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.context = context;
  }
}
```

**Error types:**
- `ValidationError` (400) - Bad input
- `NotFoundError` (404) - Resource doesn't exist
- `ConflictError` (409) - Duplicate or conflicting data
- `InternalError` (500) - Something went wrong

**Why custom errors?**
```javascript
try {
  await api.resources.users.get(999);
} catch (error) {
  if (error instanceof NotFoundError) {
    // Handle missing user
  } else if (error instanceof ValidationError) {
    // Show validation errors to user
  } else {
    // Unexpected error
  }
}
```

## Core Concepts

### Schema

The Schema class (`lib/schema.js`) defines your data structure:

```javascript
const userSchema = new Schema({
  id: { type: 'id' },
  name: { 
    type: 'string', 
    required: true,
    min: 2,        // Minimum length
    max: 100       // Maximum length
  },
  email: {
    type: 'string',
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/  // Email regex
  },
  age: {
    type: 'number',
    min: 0,
    max: 150
  },
  isActive: {
    type: 'boolean',
    default: true    // Default value if not provided
  },
  password: {
    type: 'string',
    silent: true     // Never return in responses
  },
  metadata: {
    type: 'object'   // Can store any object
  },
  tags: {
    type: 'array',   // Array of any values
    default: []
  },
  role: {
    type: 'string',
    enum: ['user', 'admin', 'moderator']  // Must be one of these
  },
  profileId: {
    type: 'id',
    refs: {          // Relationship to another resource
      resource: 'profiles',
      join: {
        eager: true  // Always include profile data
      }
    }
  }
});
```

**Field types:**
- `id` - Unique identifier (auto-generated)
- `string` - Text
- `number` - Integer or decimal
- `boolean` - true/false
- `date` - Date/datetime
- `object` - Nested object
- `array` - List of items

**Why use schemas?**
1. **Validation** - Catch errors before they hit the database
2. **Documentation** - Self-documenting API
3. **Type safety** - Know what to expect
4. **Security** - Prevent SQL injection, hide sensitive fields

### Query Builder

The QueryBuilder (`lib/query-builder.js`) constructs SQL queries:

```javascript
const query = new QueryBuilder('users')
  .select(['id', 'name', 'email'])
  .where('age', '>=', 18)
  .where('isActive', '=', true)
  .orderBy('name', 'ASC')
  .limit(10)
  .offset(20);

console.log(query.toSQL());
// SELECT id, name, email FROM users 
// WHERE age >= ? AND isActive = ? 
// ORDER BY name ASC 
// LIMIT 10 OFFSET 20

console.log(query.getParams());
// [18, true]
```

**Why use a query builder?**
1. **Security** - Prevents SQL injection with parameterized queries
2. **Portability** - Works with different databases
3. **Composability** - Build complex queries step by step

## Plugin System

### How Plugins Work

A plugin is just an object with an `install` method:

```javascript
const MyPlugin = {
  install(api, options) {
    // Add functionality to the api
    api.hook('beforeInsert', async (context) => {
      console.log('Inserting:', context.data);
    });
  }
};
```

### Plugin Types

1. **Storage Plugins** - Where data is saved
2. **Feature Plugins** - Add functionality
3. **Middleware Plugins** - Modify requests/responses

## Storage Plugins

### Memory Plugin (`plugins/memory.js`)

This stores data in memory using AlaSQL (an in-memory SQL database).

```javascript
export const MemoryPlugin = {
  install(api, options) {
    const adapter = new AlaSQL();
    
    // Implement storage methods
    api.implement('insert', async (context) => {
      const { type, data } = context;
      
      // Generate ID if needed
      if (!data[api.options.idProperty]) {
        data[api.options.idProperty] = generateId();
      }
      
      // Insert into memory database
      const query = `INSERT INTO ${type} VALUES ?`;
      adapter.exec(query, [data]);
      
      return data;
    });
```

**When to use Memory storage:**
- Development and testing
- Temporary data
- Small datasets
- When you don't need persistence

**Example data flow:**
```javascript
// Input
api.resources.users.create({ name: 'John' })

// Storage receives
{
  type: 'users',
  data: { name: 'John' }
}

// Storage adds ID
{
  type: 'users', 
  data: { id: '123', name: 'John' }
}

// Saved in memory as
memory.users = [
  { id: '123', name: 'John' }
]
```

### MySQL Plugin (`plugins/mysql.js`)

This stores data in a MySQL database:

```javascript
export const MySQLPlugin = {
  install(api, options) {
    // Create connection pool
    const pool = mysql.createPool({
      host: options.host,
      user: options.user,
      password: options.password,
      database: options.database,
      waitForConnections: true,
      connectionLimit: 10
    });
```

**Connection pooling:**
- Reuses connections (faster)
- Limits concurrent connections
- Handles connection failures

**Schema synchronization:**
```javascript
async function syncSchema(api, connection, type, schema) {
  // 1. Check if table exists
  const [tables] = await connection.query(
    'SHOW TABLES LIKE ?', [type]
  );
  
  if (tables.length === 0) {
    // 2. Create table
    const sql = generateCreateTable(type, schema);
    await connection.query(sql);
  } else {
    // 3. Update table structure
    await updateTableSchema(connection, type, schema);
  }
}
```

**Why sync schemas?**
- No manual SQL needed
- Automatic migrations
- Keeps code and database in sync

**Example MySQL operations:**

```javascript
// INSERT
const query = new QueryBuilder(type)
  .insert(data)
  .toSQL();
// INSERT INTO users (name, email) VALUES (?, ?)

// SELECT with joins
const query = new QueryBuilder('posts')
  .select(['posts.*', 'users.name as authorName'])
  .join('users', 'posts.authorId', 'users.id')
  .where('posts.published', '=', true)
  .toSQL();
// SELECT posts.*, users.name as authorName 
// FROM posts 
// JOIN users ON posts.authorId = users.id 
// WHERE posts.published = ?
```

### SQL Generic Plugin (`plugins/sql-generic.js`)

This is the base for all SQL storage plugins. It handles:

1. **Query transformation** - Convert REST filters to SQL
2. **Joins** - Automatic relationship loading
3. **Field mapping** - Handle nested fields
4. **Search fields** - Map search aliases to real fields

```javascript
function parseFilter(filter, query, searchableFields, basePath = '') {
  for (const [key, value] of Object.entries(filter)) {
    // Handle operators
    if (key.startsWith('$')) {
      handleOperator(key, value, query, basePath);
      continue;
    }
    
    // Handle nested fields
    const actualPath = searchableFields?.[key] || key;
    
    // Handle different value types
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Nested operators like { age: { $gte: 18 } }
      parseFilter(value, query, searchableFields, actualPath);
    } else {
      // Simple equality
      query.where(actualPath, '=', value);
    }
  }
}
```

**Virtual fields:**
```javascript
// In searchableFields
searchableFields: {
  search: '*',  // Virtual field marker
  authorName: 'author.name'  // Map to joined field
}

// Handled by
if (actualPath === '*') {
  // Skip SQL generation - handled by hooks
  continue;
}
```

## Feature Plugins

### Validation Plugin (`plugins/validation.js`)

Ensures data is valid before saving:

```javascript
export const ValidationPlugin = {
  install(api) {
    // Validate before insert
    api.hook('beforeInsert', async (context) => {
      const schema = api.getSchema(context.type);
      if (!schema) return;
      
      const validation = schema.validate(context.data);
      if (!validation.isValid) {
        throw new ValidationError('Validation failed', {
          validationErrors: validation.errors
        });
      }
    }, 5); // Priority 5 - runs early
```

**Validation flow:**
```javascript
// Input
{ name: '', email: 'invalid', age: 200 }

// Schema validation finds
[
  { field: 'name', message: 'Required field' },
  { field: 'email', message: 'Invalid email format' },
  { field: 'age', message: 'Maximum value is 150' }
]

// Throws ValidationError with details
```

### Timestamps Plugin (`plugins/timestamps.js`)

Automatically adds created/updated timestamps:

```javascript
export const TimestampsPlugin = {
  install(api, options = {}) {
    const {
      createdField = 'createdAt',
      updatedField = 'updatedAt',
      format = 'date'  // 'date' or 'unix'
    } = options;
    
    // Add timestamp on insert
    api.hook('beforeInsert', async (context) => {
      const now = format === 'unix' 
        ? Math.floor(Date.now() / 1000)
        : new Date();
        
      context.data[createdField] = now;
      context.data[updatedField] = now;
    });
```

**Example:**
```javascript
// Before insert
{ name: 'John' }

// After timestamps plugin
{
  name: 'John',
  createdAt: '2024-01-20T10:30:00Z',
  updatedAt: '2024-01-20T10:30:00Z'
}
```

### Positioning Plugin (`plugins/positioning.js`)

Manages item order/position:

```javascript
export const PositioningPlugin = {
  install(api, options = {}) {
    const {
      field = 'position',      // Field name
      groupBy = null,          // Group positions by field
      startAt = 0,            // First position
      increment = 100         // Gap between positions
    } = options;
```

**Why increment by 100?**
Allows inserting items between existing ones without reordering everything:
```
Item A: position = 100
Item B: position = 200
Item C: position = 300

// Insert between A and B
Item D: position = 150
```

**Bulk position shifting:**
```javascript
// When inserting at position 150
// Shift all items >= 150 up by increment
UPDATE items 
SET position = position + 100 
WHERE position >= 150
```

### HTTP Plugin (`plugins/http.js`)

Creates REST endpoints using Express:

```javascript
export const HTTPPlugin = {
  install(api, options) {
    const { app, middleware = [] } = options;
    
    // Create routes for each resource
    api.hook('afterAddResource', (context) => {
      const { type } = context;
      const base = `${api.options.apiRoot}/${type}`;
      
      // GET /users (list)
      app.get(base, ...middleware, async (req, res, next) => {
        try {
          const result = await api.query({
            type,
            ...parseQueryParams(req.query)
          });
          res.json(result);
        } catch (error) {
          next(error);
        }
      });
      
      // GET /users/:id (single)
      app.get(`${base}/:id`, ...middleware, async (req, res, next) => {
        try {
          const result = await api.get({
            type,
            id: req.params.id
          });
          res.json(result);
        } catch (error) {
          next(error);
        }
      });
```

**URL to query translation:**
```
GET /users?filter[age][$gte]=18&sort=-createdAt&page[limit]=10

Becomes:
{
  type: 'users',
  filter: { age: { $gte: 18 } },
  sort: ['-createdAt'],
  page: { limit: 10 }
}
```

### Versioning Plugin (`plugins/versioning.js`)

Tracks changes to records:

```javascript
export const VersioningPlugin = {
  install(api, options = {}) {
    const {
      versionField = 'version',
      historyResource = null  // Store old versions here
    } = options;
    
    // Increment version on update
    api.hook('beforeUpdate', async (context) => {
      const current = await api.get({
        type: context.type,
        id: context.id
      });
      
      // Save to history if configured
      if (historyResource) {
        await api.insert({
          type: historyResource,
          data: {
            ...current.data.attributes,
            originalId: context.id,
            versionedAt: new Date()
          }
        });
      }
      
      // Increment version
      context.data[versionField] = (current.data.attributes[versionField] || 0) + 1;
    });
```

**Version tracking example:**
```javascript
// Original
{ id: 1, name: 'John', version: 1 }

// After update
{ id: 1, name: 'John Doe', version: 2 }

// History table
[
  { originalId: 1, name: 'John', version: 1, versionedAt: '...' }
]
```

### Soft Delete Plugin (`plugins/soft-delete.js`)

Marks records as deleted instead of removing them:

```javascript
export const SoftDeletePlugin = {
  install(api, options = {}) {
    const {
      field = 'deletedAt',
      exclude = true  // Exclude from queries by default
    } = options;
    
    // Override delete to soft delete
    api.hook('beforeDelete', async (context) => {
      // Update instead of delete
      await api.update({
        type: context.type,
        id: context.id,
        data: { [field]: new Date() }
      });
      
      // Prevent actual deletion
      return false;
    });
    
    // Filter out soft deleted records
    if (exclude) {
      api.hook('beforeQuery', async (context) => {
        context.params.filter = {
          ...context.params.filter,
          [field]: { $null: true }
        };
      });
    }
```

**Why soft delete?**
- Recover accidentally deleted data
- Audit trail
- Referential integrity (keep foreign key references valid)

## How Everything Fits Together

Let's trace a complete request:

### Example: Creating a User

```javascript
// 1. Your code
const user = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

**Step-by-step flow:**

1. **Resource proxy** converts to internal call:
   ```javascript
   api.insert({ 
     type: 'users', 
     data: { name: 'John Doe', email: 'john@example.com' }
   })
   ```

2. **Parameter validation** checks required params

3. **Create context object:**
   ```javascript
   {
     type: 'users',
     data: { name: 'John Doe', email: 'john@example.com' },
     options: {},
     api: api,
     config: { /* resource config */ }
   }
   ```

4. **Run beforeInsert hooks** (in priority order):
   - ValidationPlugin (priority 5): Validates against schema
   - TimestampsPlugin (priority 10): Adds createdAt, updatedAt
   - Your custom hooks: Maybe lowercase email, hash password

5. **Execute storage insert:**
   - MySQLPlugin: Generates SQL, executes query
   - Returns: `{ id: 123, name: 'John Doe', email: 'john@example.com', createdAt: '...', updatedAt: '...' }`

6. **Run afterInsert hooks:**
   - Maybe send welcome email
   - Update search index
   - Clear cache

7. **Format response** as JSON:API:
   ```javascript
   {
     data: {
       type: 'users',
       id: '123',
       attributes: {
         name: 'John Doe',
         email: 'john@example.com',
         createdAt: '2024-01-20T10:30:00Z',
         updatedAt: '2024-01-20T10:30:00Z'
       }
     }
   }
   ```

### Example: Complex Query

```javascript
// Find active Gmail users who joined this year, with their profiles
const users = await api.resources.users.query({
  filter: {
    email: { $like: '%@gmail.com' },
    isActive: true,
    createdAt: { $gte: '2024-01-01' }
  },
  joins: ['profile'],
  sort: ['-createdAt'],
  page: { limit: 10 }
});
```

**Processing steps:**

1. **beforeQuery hooks** might add default filters

2. **SQL generation:**
   ```sql
   SELECT 
     users.*,
     profiles.id as profile__id,
     profiles.bio as profile__bio
   FROM users
   LEFT JOIN profiles ON users.profileId = profiles.id
   WHERE 
     users.email LIKE ? 
     AND users.isActive = ?
     AND users.createdAt >= ?
   ORDER BY users.createdAt DESC
   LIMIT 10
   ```

3. **Execute query** with params: `['%@gmail.com', true, '2024-01-01']`

4. **Transform results:**
   ```javascript
   // Raw from database
   [{
     id: 123,
     name: 'John',
     email: 'john@gmail.com',
     profileId: 456,
     profile__id: 456,
     profile__bio: 'Developer'
   }]
   
   // Transformed to
   [{
     id: '123',
     name: 'John',
     email: 'john@gmail.com',
     profile: {
       id: '456',
       bio: 'Developer'
     }
   }]
   ```

5. **Format as JSON:API** with pagination metadata

### Plugin Interaction Example

Let's see how multiple plugins work together:

```javascript
// Setup
api.use(MySQLPlugin, { /* connection */ });
api.use(ValidationPlugin);
api.use(TimestampsPlugin);
api.use(SoftDeletePlugin);

// Add users with required email
api.addResource('users', new Schema({
  id: { type: 'id' },
  email: { type: 'string', required: true },
  name: { type: 'string' }
}));

// Create a user
await api.resources.users.create({ name: 'John' });
// ValidationPlugin: Throws error - email is required!

// Create with email
await api.resources.users.create({ 
  name: 'John',
  email: 'john@example.com'
});
// ValidationPlugin: ✓ Valid
// TimestampsPlugin: Adds createdAt, updatedAt
// MySQLPlugin: INSERT INTO users ...

// Delete the user
await api.resources.users.delete(123);
// SoftDeletePlugin: Intercepts, sets deletedAt instead

// Query users
await api.resources.users.query({});
// SoftDeletePlugin: Adds filter { deletedAt: null }
// Returns only non-deleted users
```

## Best Practices

1. **Always use resource proxies** for cleaner code:
   ```javascript
   // Good
   api.resources.users.get(123)
   
   // Less clean
   api.get({ type: 'users', id: 123 })
   ```

2. **Install plugins in order**:
   ```javascript
   // Storage first
   api.use(MySQLPlugin, config);
   
   // Then features
   api.use(ValidationPlugin);
   api.use(TimestampsPlugin);
   ```

3. **Use appropriate hook priorities**:
   ```javascript
   // Validation should run early
   api.hook('beforeInsert', validateData, 5);
   
   // Timestamps can run later
   api.hook('beforeInsert', addTimestamps, 10);
   ```

4. **Handle errors properly**:
   ```javascript
   try {
     await api.resources.users.get(id);
   } catch (error) {
     if (error instanceof NotFoundError) {
       // Handle missing user
     } else {
       // Unexpected error
       throw error;
     }
   }
   ```

5. **Use schemas for validation**:
   ```javascript
   // Define constraints in schema
   new Schema({
     email: { 
       type: 'string', 
       required: true,
       pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
     }
   })
   
   // Not in application code
   if (!email || !email.includes('@')) { ... }
   ```

## Detailed Plugin Analysis

Let's dive deeper into each plugin's implementation:

### Logging Plugin (`plugins/logging.js`)

This plugin provides structured logging with security features:

```javascript
export const LoggingPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      level: process.env.LOG_LEVEL || 'info',
      format: 'json', // 'json' or 'pretty'
      includeRequest: true,
      includeResponse: true,
      includeTiming: true,
      sensitiveFields: ['password', 'token', 'secret', 'authorization'],
      logger: console, // Can be replaced with winston, bunyan, etc.
      ...options
    };
```

**Key features:**

1. **Structured logging with levels:**
   ```javascript
   api.log.info('User created', { userId: 123, email: 'john@example.com' });
   api.log.error('Database connection failed', { error: err.message });
   api.log.debug('SQL query', { sql: query, duration: 45 });
   ```

2. **Automatic sensitive data redaction:**
   ```javascript
   // Input
   { name: 'John', password: 'secret123', email: 'john@example.com' }
   
   // Logged as
   { name: 'John', password: '[REDACTED]', email: 'john@example.com' }
   ```

3. **Performance timing:**
   ```javascript
   // Automatically tracks operation duration
   {
     operation: 'get',
     type: 'users',
     duration: 45, // milliseconds
     requestId: 'abc123'
   }
   ```

4. **Request tracking with IDs:**
   ```javascript
   // Each request gets a unique ID for tracing
   api.hook('beforeValidate', async (context) => {
     context.options.requestId = generateId();
   });
   ```

**Example log output:**
```json
{
  "timestamp": "2024-01-20T10:30:00.123Z",
  "level": "info",
  "message": "GET users completed",
  "operation": "get",
  "type": "users",
  "id": "123",
  "requestId": "x7h3k9",
  "userId": "456",
  "duration": 23,
  "resultCount": 1
}
```

**Why this approach?**
- **Structured logs** are easier to search and analyze
- **Request IDs** help trace issues across distributed systems
- **Automatic redaction** prevents accidental security leaks
- **Performance metrics** help identify bottlenecks

### Security Plugin (`plugins/security.js`)

Comprehensive security features following OWASP best practices:

```javascript
export const SecurityPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP'
      },
      cors: {
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count', 'Link']
      },
      authentication: {
        type: 'bearer', // 'bearer', 'basic', 'apikey'
        header: 'Authorization',
        queryParam: 'api_key'
      }
    };
```

**Security features implemented:**

1. **Complete HTTP Security Headers:**
   ```javascript
   // Automatically adds these headers to all responses:
   'X-Content-Type-Options': 'nosniff'              // Prevent MIME sniffing
   'X-Frame-Options': 'DENY'                        // Prevent clickjacking
   'X-XSS-Protection': '1; mode=block'              // Enable XSS filter
   'Strict-Transport-Security': 'max-age=31536000'  // Force HTTPS
   'Content-Security-Policy': "default-src 'self'"  // Control resources
   ```

2. **Rate Limiting with Headers:**
   ```javascript
   // Response includes rate limit info
   X-RateLimit-Limit: 100
   X-RateLimit-Remaining: 87
   X-RateLimit-Reset: 2024-01-20T11:45:00Z
   
   // After limit exceeded
   {
     "errors": [{
       "status": "429",
       "title": "Too Many Requests",
       "detail": "Too many requests from this IP"
     }]
   }
   ```

3. **Multiple Authentication Methods:**
   ```javascript
   // Bearer Token (JWT)
   Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
   
   // API Key (header or query)
   X-API-Key: sk_live_abc123
   // or
   GET /api/users?api_key=sk_live_abc123
   
   // Basic Auth
   Authorization: Basic dXNlcjpwYXNz
   ```

4. **Input Sanitization:**
   ```javascript
   // Automatically escapes dangerous characters
   Input:  { name: "<script>alert('XSS')</script>" }
   Stored: { name: "&lt;script&gt;alert(&#x27;XSS&#x27;)&lt;/script&gt;" }
   ```

5. **Request Tracking:**
   ```javascript
   // Every request gets a unique ID
   X-Request-ID: req_1705751400123_a8b2c3d4e
   
   // Use for debugging across services
   api.log.error('Failed to process', { requestId: req.id });
   ```

**Configuration example:**
```javascript
api.use(SecurityPlugin, {
  rateLimit: {
    windowMs: 5 * 60 * 1000,  // 5 minutes
    max: 50                   // 50 requests per window
  },
  authentication: {
    type: 'bearer',
    required: true
  },
  verifyToken: async (token) => {
    // Your token verification logic
    const user = await jwt.verify(token, process.env.JWT_SECRET);
    return user;
  },
  publicRead: true  // Allow GET without auth
});
```

**Why these features?**
- **Headers** prevent common attacks (XSS, clickjacking, MIME sniffing)
- **Rate limiting** prevents DoS and brute force attacks
- **CORS** controls which domains can access your API
- **CSP** prevents loading malicious resources
- **Sanitization** prevents XSS attacks in stored data

### Timestamps Plugin (`plugins/timestamps.js`)

Automatically manages created and updated timestamps:

```javascript
export const TimestampsPlugin = {
  install(api, options = {}) {
    const {
      createdAtField = 'createdAt',
      updatedAtField = 'updatedAt',
      touchOnGet = false,  // Update timestamp on read
      format = 'timestamp'  // 'timestamp', 'date', 'dateTime'
    } = options;
```

**Key features:**

1. **Automatic schema enhancement:**
   ```javascript
   // Your schema
   { id: { type: 'id' }, name: { type: 'string' } }
   
   // After plugin adds fields
   {
     id: { type: 'id' },
     name: { type: 'string' },
     createdAt: { type: 'number' },  // Added automatically
     updatedAt: { type: 'number' }   // Added automatically
   }
   ```

2. **Multiple time formats:**
   ```javascript
   // timestamp (default) - milliseconds since epoch
   { createdAt: 1705751400000, updatedAt: 1705751400000 }
   
   // date - YYYY-MM-DD
   { createdAt: '2024-01-20', updatedAt: '2024-01-20' }
   
   // dateTime - ISO 8601
   { createdAt: '2024-01-20T10:30:00.000Z', updatedAt: '2024-01-20T10:30:00.000Z' }
   ```

3. **Smart delay for uniqueness:**
   ```javascript
   // Adds 1-2ms delay to ensure timestamps differ
   // Important for tests and rapid operations
   ```

4. **Touch functionality:**
   ```javascript
   // Manual touch
   await api.touchRecord('posts', 123);
   
   // Auto-touch on read (if enabled)
   api.use(TimestampsPlugin, { touchOnGet: true });
   await api.resources.posts.get(123); // Updates updatedAt
   ```

**Why timestamps matter:**
- Track when records were created/modified
- Sort by recency
- Implement caching strategies
- Audit trails and compliance
- Conflict resolution in distributed systems

### Validation Plugin (`plugins/validation.js`)

Advanced validation with error codes and permissions:

```javascript
export const ValidationPlugin = {
  install(api, options = {}) {
    // Initialize schemas map
    if (!api.schemas) {
      api.schemas = new Map();
    }

    // Add validation hooks
    api.hook('beforeValidate', async (context) => {
      const schema = api.schemas.get(type);
      
      // Validate with proper error codes
      const mappedErrors = errors.map(err => {
        let code = ErrorCodes.INVALID_VALUE;
        
        if (err.message.includes('required')) {
          code = ErrorCodes.REQUIRED_FIELD;
        } else if (err.message.includes('too long')) {
          code = ErrorCodes.FIELD_TOO_LONG;
        }
        // ... more mappings
      });
    });
```

**Key features:**

1. **Structured error codes:**
   ```javascript
   {
     field: 'email',
     message: 'Invalid email format',
     code: 'INVALID_FORMAT',
     value: 'not-an-email'
   }
   ```

2. **Partial validation for updates:**
   ```javascript
   // Only validate provided fields on PATCH
   api.resources.users.update(123, { age: 25 }, { partial: true });
   ```

3. **Search parameter validation:**
   ```javascript
   // Create search schema from main schema
   const searchSchema = api.createSearchSchema(userSchema, ['name', 'email']);
   
   // Validates query parameters
   api.resources.users.query({
     filter: { email: 'invalid' }  // Will be validated
   });
   ```

4. **Permission checking:**
   ```javascript
   api.use(ValidationPlugin, {
     checkPermissions: async (context) => {
       const user = context.options.user;
       if (context.method === 'delete' && !user.isAdmin) {
         return { granted: false, message: 'Only admins can delete' };
       }
       return { granted: true };
     }
   });
   ```

5. **Field cleanup:**
   ```javascript
   // Remove fields not in schema
   // Remove silent fields from responses
   api.use(ValidationPlugin, {
     cleanupFields: true,
     removeSilentFields: true
   });
   ```

### Positioning Plugin (`plugins/positioning.js`)

Manages ordered lists with automatic position assignment:

```javascript
export const PositioningPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      positionField: 'position',
      beforeIdField: 'beforeId',
      positionFilters: [],
      ...options
    };
```

**Key features:**

1. **Automatic position assignment:**
   ```javascript
   // First item gets position 1
   await api.resources.todos.create({ title: 'First' });
   // { id: 1, title: 'First', position: 1 }
   
   // Next item gets position 2
   await api.resources.todos.create({ title: 'Second' });
   // { id: 2, title: 'Second', position: 2 }
   ```

2. **Insert before specific item:**
   ```javascript
   // Insert between items
   await api.resources.todos.create({
     title: 'New',
     beforeId: 2  // Insert before item 2
   });
   // Automatically shifts positions:
   // Item 1: position 1
   // New item: position 2
   // Item 2: position 3 (shifted)
   ```

3. **Position groups:**
   ```javascript
   // Configure grouped positioning
   api.addResource('tasks', schema, {
     positioning: {
       field: 'position',
       groupBy: ['projectId', 'status']  // Separate positions per group
     }
   });
   
   // Each project+status combo has its own sequence
   await api.resources.tasks.create({ 
     projectId: 1, 
     status: 'todo',
     title: 'Task 1'
   }); // position: 1 in project 1, todo
   
   await api.resources.tasks.create({ 
     projectId: 1, 
     status: 'done',
     title: 'Task 2'
   }); // position: 1 in project 1, done (different group)
   ```

4. **Bulk position operations:**
   ```javascript
   // Efficiently shifts many records
   await api.shiftPositions('todos', {
     field: 'position',
     from: 5,      // Shift items from position 5
     delta: 2,     // Move them up by 2
     filter: { projectId: 1 }
   });
   ```

5. **Position normalization:**
   ```javascript
   // Remove gaps in positions
   await api.normalizePositions('todos', { projectId: 1 });
   // Before: [1, 3, 7, 8]
   // After:  [1, 2, 3, 4]
   ```

**Why positioning matters:**
- Drag-and-drop interfaces
- Custom sorting that persists
- Priority management
- Kanban boards
- Playlist/queue management

### HTTP Plugin (`plugins/http.js`)

Creates Express routes with JSON:API compliance:

```javascript
export const HTTPPlugin = {
  install(api, options = {}) {
    const router = express.Router();
    api.router = router;

    // Middleware for JSON parsing
    router.use(express.json({
      type: ['application/json', 'application/vnd.api+json']
    }));
```

**Key features:**

1. **Automatic route creation:**
   ```javascript
   api.addResource('posts', schema);
   
   // Creates these routes:
   GET    /api/posts        // List
   GET    /api/posts/:id    // Get one
   POST   /api/posts        // Create
   PATCH  /api/posts/:id    // Update
   DELETE /api/posts/:id    // Delete
   ```

2. **JSON:API request/response format:**
   ```javascript
   // Request
   POST /api/posts
   {
     "data": {
       "type": "posts",
       "attributes": {
         "title": "Hello World",
         "content": "..."
       }
     }
   }
   
   // Response
   {
     "data": {
       "type": "posts",
       "id": "123",
       "attributes": {
         "title": "Hello World",
         "content": "..."
       }
     }
   }
   ```

3. **Query parameter parsing:**
   ```javascript
   GET /api/posts?
     filter[status]=published&
     filter[authorId]=123&
     sort=-createdAt,title&
     page[size]=10&
     page[number]=2&
     joins=author,comments&
     fields[posts]=title,content
   
   // Parsed to:
   {
     filter: { status: 'published', authorId: '123' },
     sort: [
       { field: 'createdAt', direction: 'DESC' },
       { field: 'title', direction: 'ASC' }
     ],
     page: { size: 10, number: 2 },
     joins: ['author', 'comments'],
     fields: { posts: ['title', 'content'] }
   }
   ```

4. **Compound documents with includes:**
   ```javascript
   GET /api/posts/123?include=author,comments
   
   {
     "data": { /* post */ },
     "included": [
       { "type": "users", "id": "456", /* author */ },
       { "type": "comments", "id": "789", /* comment */ }
     ]
   }
   ```

5. **Error handling:**
   ```javascript
   // Validation errors
   {
     "errors": [{
       "status": "422",
       "source": { "pointer": "/data/attributes/email" },
       "title": "Validation Error",
       "detail": "Email format is invalid"
     }]
   }
   ```

### Versioning Plugin (`plugins/versioning.js`)

Manages API versions and resource versions:

```javascript
export const VersioningPlugin = {
  install(api, options = {}) {
    const defaultOptions = {
      // API versioning
      apiVersion: '1.0.0',
      versionHeader: 'api-version',
      
      // Resource versioning
      versionField: 'version',
      lastModifiedField: 'lastModified',
      trackHistory: false
    };
```

**Key features:**

1. **API version negotiation:**
   ```javascript
   // Via header
   GET /api/users
   API-Version: 2.0.0
   
   // Via query param
   GET /api/users?v=2.0.0
   
   // Response includes version
   API-Version: 1.0.0
   ```

2. **Optimistic concurrency control:**
   ```javascript
   // Get resource with version
   const post = await api.resources.posts.get(123);
   // { id: 123, title: 'Old', version: 1 }
   
   // Update with version check
   await api.resources.posts.update(123, {
     title: 'New',
     version: 1  // Expected version
   });
   
   // If someone else updated (version now 2), throws ConflictError
   ```

3. **Automatic version increment:**
   ```javascript
   // Before update: { id: 1, title: 'Hello', version: 1 }
   await api.resources.posts.update(1, { title: 'Hi' });
   // After update: { id: 1, title: 'Hi', version: 2 }
   ```

4. **History tracking:**
   ```javascript
   api.use(VersioningPlugin, {
     trackHistory: true,
     historyTable: 'posts_history'
   });
   
   // Updates create history records
   // posts_history table contains all previous versions
   ```

5. **Modified tracking:**
   ```javascript
   {
     id: 123,
     title: 'Post',
     version: 3,
     lastModified: '2024-01-20T10:30:00Z',
     modifiedBy: 'user-456'
   }
   ```

### SQL Generic Plugin (`plugins/sql-generic.js`)

Base plugin that handles SQL query generation for all SQL databases:

```javascript
// This is the core of how filters become SQL
function parseFilter(filter, query, searchableFields, basePath = '') {
  for (const [key, value] of Object.entries(filter)) {
    // Handle operators like $gte, $like, etc.
    if (key.startsWith('$')) {
      handleOperator(key, value, query, basePath);
      continue;
    }
    
    // Map field names using searchableFields
    const actualPath = searchableFields?.[key] || key;
    
    // IMPORTANT: Handle virtual fields marked with '*'
    if (actualPath === '*') {
      // Skip SQL generation - will be handled by modifyQuery hooks
      continue;
    }
    
    // Generate SQL for real fields
    query.where(actualPath, '=', value);
  }
}
```

**Key responsibilities:**

1. **Filter parsing** - Converts REST filters to SQL WHERE clauses
2. **Field mapping** - Uses searchableFields to map API names to DB columns
3. **Virtual field detection** - Skips fields marked with '*'
4. **Operator handling** - Supports $gte, $like, $in, etc.
5. **Join processing** - Handles nested field access like 'author.name'

**Filter operators supported:**
```javascript
// Comparison
filter: { age: { $gte: 18 } }        // age >= 18
filter: { age: { $lt: 65 } }         // age < 65

// Pattern matching  
filter: { email: { $like: '%@gmail.com' } }  // LIKE '%@gmail.com'

// Lists
filter: { status: { $in: ['active', 'pending'] } }     // IN ('active', 'pending')
filter: { role: { $nin: ['banned', 'deleted'] } }      // NOT IN (...)

// Null checks
filter: { deletedAt: { $null: true } }     // IS NULL
filter: { deletedAt: { $notNull: true } }  // IS NOT NULL

// Negation
filter: { status: { $ne: 'deleted' } }     // != 'deleted'
```

**Why this plugin is important:**
- Shared by all SQL storage plugins (MySQL, PostgreSQL, SQLite)
- Handles the complex mapping from REST API to SQL
- Enables the virtual field feature
- Provides consistent query behavior across databases

### Memory Plugin (`plugins/memory.js`)

In-memory storage using AlaSQL:

```javascript
export const MemoryPlugin = {
  install(api, options = {}) {
    // Creates SQL-compatible in-memory database
    const alasql = new AlaSQL();
```

**When to use:**
- Development and testing
- Prototyping
- Small datasets
- Temporary data

**Features:**
- Full SQL support in memory
- No setup required
- Fast for small datasets
- Supports joins and complex queries

### MySQL Plugin (`plugins/mysql.js`)

Production-ready MySQL storage with connection pooling:

```javascript
export const MySQLPlugin = {
  install(api, options) {
    const pool = mysql.createPool({
      host: options.host,
      user: options.user,
      password: options.password,
      database: options.database,
      waitForConnections: true,
      connectionLimit: 10
    });
```

**Key features:**

1. **Automatic schema sync:**
   ```javascript
   // Your schema
   new Schema({
     id: { type: 'id' },
     email: { type: 'string', unique: true },
     age: { type: 'number', index: true }
   });
   
   // Automatically creates:
   CREATE TABLE users (
     id INT AUTO_INCREMENT PRIMARY KEY,
     email VARCHAR(255) UNIQUE,
     age INT,
     INDEX idx_age (age)
   );
   ```

2. **Connection pooling:**
   - Reuses connections
   - Handles connection failures
   - Configurable pool size

3. **Bulk operations:**
   ```javascript
   // Efficient bulk position shift
   UPDATE todos 
   SET position = position + 1 
   WHERE position >= 5 AND projectId = 1
   ```

4. **Transaction support:**
   ```javascript
   const conn = await api.getConnection();
   await conn.beginTransaction();
   try {
     // Multiple operations
     await conn.commit();
   } catch (error) {
     await conn.rollback();
   }
   ```

## Common Patterns and Recipes

### Pattern 1: Multi-tenant System

```javascript
// Add tenant isolation
api.hook('beforeQuery', async (context) => {
  const tenantId = context.options.tenantId;
  if (!tenantId) {
    throw new Error('Tenant ID required');
  }

  context.params.filter = {
    ...context.params.filter,
    tenantId
  };
});

api.hook('beforeInsert', async (context) => {
  const tenantId = context.options.tenantId;
  if (!tenantId) {
    throw new Error('Tenant ID required');
  }

  context.data.tenantId = tenantId;
});
```

### Pattern 2: Computed Fields

```javascript
// Add computed fields after fetching
api.hook('afterGet', async (context) => {
  if (context.type === 'users' && context.result) {
    const user = context.result.data.attributes;
    
    // Add computed field
    user.fullName = `${user.firstName} ${user.lastName}`;
    user.age = calculateAge(user.birthDate);
  }
});
```

### Pattern 3: Cascading Deletes

```javascript
// Delete related records
api.hook('afterDelete', async (context) => {
  if (context.type === 'users') {
    // Delete user's posts
    const posts = await api.resources.posts.query({
      filter: { userId: context.id }
    });

    for (const post of posts.data) {
      await api.resources.posts.delete(post.id);
    }
  }
});
```

### Pattern 4: Data Denormalization

```javascript
// Update denormalized data
api.hook('afterUpdate', async (context) => {
  if (context.type === 'users') {
    // Update author name in all posts
    await api.execute('db.query', {
      sql: 'UPDATE posts SET authorName = ? WHERE authorId = ?',
      params: [context.result.name, context.id]
    });
  }
});
```

### Pattern 5: Custom Validation

```javascript
// Business logic validation
api.hook('beforeInsert', async (context) => {
  if (context.type === 'orders') {
    const product = await api.resources.products.get(context.data.productId);
    
    if (product.data.attributes.stock < context.data.quantity) {
      throw new ValidationError('Insufficient stock', {
        validationErrors: [{
          field: 'quantity',
          message: `Only ${product.data.attributes.stock} items available`
        }]
      });
    }
  }
});
```

## Tricky Concepts and Gotchas

### Hook Context Mutations

**Important:** Context objects are passed by reference through all hooks!

```javascript
// WRONG - Direct mutation affects all subsequent hooks
api.hook('beforeInsert', async (context) => {
  context.data.createdBy = 'system';  // This modifies the original!
});

// CORRECT - For adding fields
api.hook('beforeInsert', async (context) => {
  context.data = { ...context.data, createdBy: 'system' };
});

// ALSO CORRECT - When you intend to modify
api.hook('beforeInsert', async (context) => {
  // Document that this is intentional
  context.data.email = context.data.email.toLowerCase(); // Normalize email
});
```

**Why this matters:**
- Plugins can see each other's modifications
- Order of operations becomes critical
- Debugging becomes harder with mutations

### Virtual Field Deletion Requirement

**Critical:** You MUST delete virtual fields from filter to avoid SQL errors!

```javascript
// WRONG - Will cause SQL error "Unknown column 'search'"
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    const search = context.params.filter.search;
    context.query.where('title LIKE ?', `%${search}%`);
    // Forgot to delete!
  }
});

// CORRECT - Delete the virtual field
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    const search = context.params.filter.search;
    delete context.params.filter.search;  // CRITICAL!
    context.query.where('title LIKE ?', `%${search}%`);
  }
});
```

### Hook Cancellation Flow

When a hook returns `false`, here's what happens:

```javascript
// Hook returns false
api.hook('beforeInsert', async (context) => {
  if (context.data.protected) {
    return false;  // Cancel operation
  }
});

// Result:
// 1. Remaining beforeInsert hooks DO NOT run
// 2. The insert operation DOES NOT happen
// 3. afterInsert hooks DO NOT run
// 4. The operation returns undefined
```

**Exception:** Throwing an error is different:
```javascript
api.hook('beforeInsert', async (context) => {
  if (context.data.invalid) {
    throw new ValidationError('Invalid data');  // Throws to caller
  }
});
// Error propagates immediately, no cleanup hooks run
```

### Plugin Order Dependencies

**Critical plugin ordering:**

```javascript
// CORRECT ORDER
api.use(MySQLPlugin);        // 1. Storage MUST be first
api.use(ValidationPlugin);   // 2. Validates before other plugins modify
api.use(TimestampsPlugin);   // 3. Adds fields after validation
api.use(PositioningPlugin);  // 4. Needs storage for queries
api.use(HTTPPlugin);         // 5. Needs all CRUD operations ready

// WRONG - Will break!
api.use(HTTPPlugin);         // ❌ No storage to handle requests!
api.use(TimestampsPlugin);   // ❌ Fields added before validation!
api.use(MySQLPlugin);        // ❌ Too late!
```

### Schema Type Coercion

The system tries to be helpful but can surprise you:

```javascript
// Schema expects number
{ age: { type: 'number' } }

// Input variations:
{ age: "25" }      // ✅ Coerced to 25
{ age: "25.5" }    // ✅ Coerced to 25.5
{ age: "twenty" }  // ❌ Validation error
{ age: "" }        // ❌ Validation error (not null)
{ age: null }      // ✅ Allowed if not required
{ age: undefined } // ✅ Treated as not provided
```

**Important distinctions:**
- `null` = "I explicitly want no value"
- `undefined` = "I'm not providing this field"
- `""` = Empty string, fails number validation

### Connection Pool Exhaustion

**Common mistake that kills production:**

```javascript
// WRONG - Leaks connections!
async function getDataBadly() {
  const results = [];
  for (let i = 0; i < 100; i++) {
    // Each query takes a connection from the pool
    const user = await api.resources.users.get(i);
    results.push(user);
  }
  return results;
  // If pool size is 10, this hangs after 10 iterations!
}

// CORRECT - Use batch operations
async function getDataProperly() {
  const userIds = Array.from({ length: 100 }, (_, i) => i);
  return await api.resources.users.query({
    filter: { id: { $in: userIds } },
    page: { size: 100 }
  });
}
```

### Silent Field Leaks

Silent fields can still leak in unexpected ways:

```javascript
// Schema with silent password
{ password: { type: 'string', silent: true } }

// DANGER - Password visible in hooks!
api.hook('afterInsert', async (context) => {
  console.log(context.data);  // Includes password!
  await auditLog(context.data);  // Leaked to audit system!
});

// DANGER - Error messages might include values
try {
  await api.resources.users.create({ password: '123' });
} catch (error) {
  // Error context might contain { password: '123' }
  console.log(error.context);  
}

// SAFE - Explicitly exclude silent fields
api.hook('afterInsert', async (context) => {
  const { password, ...safeData } = context.data;
  await auditLog(safeData);
});
```

### Join Performance Cliffs

Eager joins can destroy performance:

```javascript
// DANGER - N+1 query problem
const posts = await api.resources.posts.query({
  joins: ['author', 'comments', 'comments.author'],  // Deep joins!
  page: { size: 100 }
});
// Might run 100s of queries!

// BETTER - Selective joining
const posts = await api.resources.posts.query({
  joins: ['author'],  // Only what you need
  page: { size: 100 }
});

// BEST - Field selection
const posts = await api.resources.posts.query({
  fields: ['id', 'title', 'author.name'],
  joins: ['author'],
  page: { size: 100 }
});
```

### Transaction Edge Cases

Transactions aren't automatic:

```javascript
// WRONG - Not atomic!
await api.resources.accounts.update(1, { balance: 100 });
await api.resources.accounts.update(2, { balance: -100 });
// If second fails, first is still committed!

// CORRECT - Use transactions (MySQL example)
const conn = await api.getConnection();
await conn.beginTransaction();
try {
  await conn.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 1]);
  await conn.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 2]);
  await conn.commit();
} catch (error) {
  await conn.rollback();
  throw error;
} finally {
  conn.release();
}
```

### Resource Proxy Memory

Resource proxies are cached - this can surprise you:

```javascript
// First access creates proxy
const users1 = api.resources.users;  // Creates proxy

// Later access returns SAME proxy
const users2 = api.resources.users;  // Same object!

// This means:
users1 === users2;  // true

// Custom properties persist
users1.myCustomProp = 'test';
console.log(users2.myCustomProp);  // 'test' - Same object!

// If you need fresh state, use the direct API
await api.get({ type: 'users', id: 123 });
```

### SearchableFields Path Resolution

Nested paths have subtle behaviors:

```javascript
searchableFields: {
  authorName: 'author.name',     // Works if relationship exists
  cityName: 'author.address.city' // Fails if author has no address!
}

// Query with missing relationship
GET /api/posts?filter[cityName]=London
// Returns NO results if any author.address is null
// Not an error, just empty results!

// BETTER - Use left joins and handle nulls
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.cityName) {
    context.query.leftJoin(...);  // Handle missing relationships
  }
});
```

### Pagination with Joins Gotcha

Joins can cause duplicate counting issues:

```javascript
// PROBLEM - Count includes duplicates!
const posts = await api.resources.posts.query({
  joins: ['tags'],  // Many-to-many relationship
  page: { size: 10 }
});
// If a post has 3 tags, it appears 3 times in results!
// Page size 10 might only return 3-4 unique posts

// SOLUTION - Use DISTINCT or handle in application
api.hook('modifyQuery', async (context) => {
  if (context.joins?.includes('tags')) {
    context.query.distinct();  // Add DISTINCT
  }
});
```

### Default Values vs Required Fields

This combination can be confusing:

```javascript
// Schema
{
  status: { 
    type: 'string', 
    required: true,  // Required...
    default: 'draft' // ...but has default
  }
}

// These all work:
api.resources.posts.create({ title: 'Test' });  // status = 'draft'
api.resources.posts.create({ title: 'Test', status: 'published' });
api.resources.posts.create({ title: 'Test', status: null });  // Error!

// On update, default is NOT applied:
api.resources.posts.update(123, { title: 'New' });  // status unchanged
```

### Hook Priority Tiebreakers

When priorities match, registration order wins:

```javascript
api.hook('beforeInsert', hookA, 10);  // Runs first
api.hook('beforeInsert', hookB, 10);  // Runs second
api.hook('beforeInsert', hookC, 5);   // Actually runs first! (lower = earlier)

// To guarantee order with same priority:
const hooks = [hookA, hookB, hookC];
hooks.forEach((hook, index) => {
  api.hook('beforeInsert', hook, 10 + (index * 0.1));
});
// Now: hookA=10.0, hookB=10.1, hookC=10.2
```

### Artificial Delay Gotcha

The artificial delay can break connection pools:

```javascript
const api = new Api({ 
  artificialDelay: 1000  // 1 second delay
});

// DANGER - With pool size 10:
const promises = [];
for (let i = 0; i < 20; i++) {
  promises.push(api.resources.users.get(i));
}
await Promise.all(promises);
// First 10 start, hold connections for 1 second
// Next 10 wait for connections... timeout!

// SOLUTION - Increase pool size or reduce concurrency
```

### Schema Validation vs Database Constraints

These are separate and can conflict:

```javascript
// Schema says optional
{ email: { type: 'string', required: false } }

// But database has NOT NULL constraint
CREATE TABLE users (email VARCHAR(255) NOT NULL);

// Result:
api.resources.users.create({ name: 'John' });
// ✅ Passes schema validation
// ❌ Database error: Column 'email' cannot be null

// Always keep schema and database in sync!
```

### Error Context vs Error Message

Don't put sensitive data in error messages:

```javascript
// WRONG - Password in message
throw new ValidationError(`Invalid password: ${password}`);

// WRONG - Sensitive data in error
throw new ValidationError('Invalid password', {
  context: { password: actualPassword }  // Logs might capture this
});

// CORRECT - Generic message, safe context
throw new ValidationError('Invalid password', {
  context: { 
    field: 'password',
    reason: 'too_short',
    minLength: 8
  }
});
```

## Debugging Tips

### 1. Enable Debug Mode

```javascript
const api = new Api({ 
  debug: true,      // General debug
  debugSQL: true    // SQL queries
});
```

### 2. Log Hook Execution

```javascript
// Temporary debugging hook
api.hook('beforeInsert', async (context) => {
  console.log('Insert context:', JSON.stringify(context, null, 2));
});
```

### 3. Use the Logging Plugin

```javascript
api.use(LoggingPlugin, {
  level: 'debug',
  includeData: true,
  includeResult: true
});
```

### 4. Check Hook Order

```javascript
// List all hooks and their priorities
console.log('Hooks:', api._hooks);
```

### 5. Test in Isolation

```javascript
// Test with memory storage first
const testApi = new Api();
testApi.use(MemoryPlugin);
testApi.addResource('test', schema);

// Then switch to real storage
```

## Performance Tips

### 1. Use Field Selection

```javascript
// Only fetch needed fields
const users = await api.resources.users.query({
  fields: ['id', 'name', 'email']  // Don't fetch large fields
});
```

### 2. Implement Pagination

```javascript
// Always paginate large datasets
const results = await api.resources.logs.query({
  page: { limit: 50, offset: 0 }
});
```

### 3. Use Indexes

```javascript
// In schema definition
new Schema({
  email: { type: 'string', index: true },
  createdAt: { type: 'date', index: true }
});
```

### 4. Cache Frequently Accessed Data

```javascript
api.use(CachingPlugin, {
  ttl: 600,  // 10 minutes
  cacheGets: true,
  cacheQueries: true
});
```

### 5. Batch Operations

```javascript
// Instead of many individual inserts
const users = [...];
for (const user of users) {
  await api.resources.users.create(user);  // Slow!
}

// Use bulk operations
await api.resources.users.bulkCreate(users);  // Fast!
```

## Full Example: Building a Blog API

Let's put it all together to build a complete blog API:

```javascript
import { Api, Schema, MySQLPlugin, ValidationPlugin, TimestampsPlugin, 
         PositioningPlugin, HTTPPlugin, SecurityPlugin, LoggingPlugin } from 'json-rest-api';
import express from 'express';

// 1. Create API instance
const api = new Api({
  idProperty: 'id',
  debug: true
});

// 2. Install plugins in order
api.use(MySQLPlugin, {
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'blog'
});

api.use(ValidationPlugin);
api.use(TimestampsPlugin);
api.use(PositioningPlugin);
api.use(SecurityPlugin, {
  rateLimit: { windowMs: 15 * 60 * 1000, max: 100 },
  publicRead: true  // Allow reading without auth
});
api.use(LoggingPlugin, { level: 'info' });

// 3. Define schemas
const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true, unique: true, min: 3, max: 20 },
  email: { type: 'string', required: true, unique: true },
  password: { type: 'string', required: true, silent: true }, // Never returned
  role: { type: 'string', enum: ['user', 'admin'], default: 'user' }
});

const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, max: 200 },
  slug: { type: 'string', unique: true },
  content: { type: 'string', required: true },
  excerpt: { type: 'string', max: 500 },
  status: { type: 'string', enum: ['draft', 'published'], default: 'draft' },
  authorId: { 
    type: 'id', 
    refs: { 
      resource: 'users',
      join: { eager: true, fields: ['id', 'username'] }
    }
  },
  categoryId: { type: 'id', refs: { resource: 'categories' } },
  tags: { type: 'array', default: [] }
});

const commentSchema = new Schema({
  id: { type: 'id' },
  postId: { type: 'id', refs: { resource: 'posts' } },
  userId: { type: 'id', refs: { resource: 'users' } },
  content: { type: 'string', required: true, max: 1000 },
  status: { type: 'string', enum: ['pending', 'approved', 'spam'], default: 'pending' }
});

const categorySchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, unique: true },
  slug: { type: 'string', unique: true },
  parentId: { type: 'id', refs: { resource: 'categories' } }
});

// 4. Add resources with configuration
api.addResource('users', userSchema);

api.addResource('posts', postSchema, {
  searchableFields: {
    title: 'title',
    content: 'content', 
    authorName: 'author.username',
    search: '*'  // Virtual field for multi-field search
  }
});

api.addResource('comments', commentSchema, {
  positioning: { 
    field: 'position',
    groupBy: 'postId'  // Separate position sequence per post
  }
});

api.addResource('categories', categorySchema, {
  positioning: { field: 'position' }
});

// 5. Add business logic hooks
// Auto-generate slugs
api.hook('beforeInsert', async (context) => {
  if (context.type === 'posts' && !context.data.slug) {
    context.data.slug = context.data.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
  }
});

// Hash passwords
api.hook('beforeInsert', async (context) => {
  if (context.type === 'users' && context.data.password) {
    context.data.password = await bcrypt.hash(context.data.password, 10);
  }
});

// Virtual search field
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search && context.options.type === 'posts') {
    const search = context.params.filter.search;
    delete context.params.filter.search;
    
    // Search in multiple fields
    context.query.where(
      '(posts.title LIKE ? OR posts.content LIKE ? OR users.username LIKE ?)',
      `%${search}%`, `%${search}%`, `%${search}%`
    );
  }
});

// Auto-approve comments from admin users
api.hook('beforeInsert', async (context) => {
  if (context.type === 'comments' && context.options.user?.role === 'admin') {
    context.data.status = 'approved';
  }
});

// 6. Set up Express app with HTTP plugin
const app = express();

api.use(HTTPPlugin, { 
  app,
  basePath: '/api'
});

// 7. Connect and start
await api.connect();

app.listen(3000, () => {
  console.log('Blog API running on http://localhost:3000');
});

// Example API calls:
// GET    /api/posts?filter[status]=published&sort=-createdAt&page[size]=10
// GET    /api/posts/123?joins=author,category,comments
// POST   /api/posts
// PATCH  /api/posts/123
// DELETE /api/posts/123
// GET    /api/posts?filter[search]=javascript
```

## Summary

This codebase implements a **plugin-based REST API system** where:

1. **The Api class** orchestrates everything
   - Manages resources and schemas
   - Runs hooks in order
   - Delegates storage to plugins
   - Provides a consistent interface

2. **Plugins** add specific features
   - **Storage**: Memory, MySQL (where data lives)
   - **Features**: Validation, Timestamps, Positioning
   - **Security**: Authentication, Rate limiting, CORS
   - **API**: HTTP endpoints, Versioning
   - **Monitoring**: Logging

3. **Schemas** define data structure
   - Field types and validation rules
   - Relationships between resources
   - Default values and constraints
   - Silent fields (never exposed)

4. **Hooks** enable extensibility
   - Lifecycle events (before/after operations)
   - Priority ordering
   - Context passing
   - Operation cancellation

5. **Resource proxies** provide clean syntax
   - `api.resources.users.get(123)` instead of `api.get('users', 123)`
   - Natural, intuitive API
   - Type safety through consistency

The architecture follows these principles:

- **Separation of Concerns**: Each plugin does one thing well
- **Composition over Inheritance**: Build complex features by combining simple plugins
- **Convention over Configuration**: Sensible defaults, override when needed
- **Progressive Enhancement**: Start simple, add features as needed
- **Storage Agnostic**: Same API works with any storage backend

Remember:
- **Every plugin is optional** - Use only what you need
- **Order matters** - Storage first, then features
- **Hooks are powerful** - Most customization happens here
- **Context flows through** - Data passes between hooks
- **Errors bubble up** - Handle at the appropriate level

Happy coding! You now understand how this entire codebase works. Start simple, add features as needed, and let the plugins handle the complexity.