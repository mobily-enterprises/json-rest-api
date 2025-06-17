# JSON REST API - Complete Guide

Welcome to the JSON REST APIs! This guide will take you from zero to hero, one step at a time. We'll build a complete task management system to learn every feature of this library.

## Table of Contents

1. [Quick Start Guide](#quick-start-guide)
2. [Core Concepts Tutorial](#core-concepts-tutorial)
3. [Plugin Tutorials](#plugin-tutorials)
4. [Advanced Features](#advanced-features)

---

# Quick Start Guide

Let's build a simple task management API in 10 minutes!

## Step 1: Installation

```bash
npm init -y
npm install express mysql2
npm install json-rest-api
```

## Step 2: Create Your First API

Create a file called `server.js`:

```javascript
import express from 'express';
import { createApi, Schema } from 'json-rest-api';

// Create Express app
const app = express();

// Create your API with a name and version
const api = createApi({
  name: 'taskmanager',
  version: '1.0.0',
  storage: 'memory',  // We'll use memory for now
  http: { basePath: '/api' }  // This automatically adds HTTPPlugin!
});

// Define a schema for tasks
const taskSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  completed: { type: 'boolean', default: false },
  priority: { type: 'string', default: 'medium' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Register the schema
api.addResource('tasks', taskSchema);

// Mount the API on Express
api.mount(app);

// Start the server
app.listen(3000, () => {
  console.log('🚀 API running at http://localhost:3000');
  console.log('📝 Try: GET http://localhost:3000/api/1.0.0/tasks');
});
```

### 💡 Behind the Scenes: What createApi Does

The `createApi()` helper is a convenience function that automatically configures plugins for you. Here's what the above code would look like WITHOUT the helper:

```javascript
import express from 'express';
import { 
  Api, 
  Schema, 
  ValidationPlugin, 
  MemoryPlugin, 
  HTTPPlugin 
} from 'json-rest-api';

const app = express();

// Manual approach - full control over plugins
const api = new Api({
  name: 'taskmanager',
  version: '1.0.0'
});

// Manually add each plugin
api.use(ValidationPlugin);  // Always needed for schemas
api.use(MemoryPlugin);      // For in-memory storage
api.use(HTTPPlugin, { basePath: '/api' });  // For REST endpoints

// Rest is the same...
```

The `createApi()` helper automatically adds plugins based on your options:
- `storage: 'memory'` → adds MemoryPlugin
- `storage: 'mysql'` → adds MySQLPlugin
- `http: { ... }` → adds HTTPPlugin
- `positioning: { ... }` → adds PositioningPlugin
- `versioning: { ... }` → adds VersioningPlugin
- ValidationPlugin is always added (unless `validation: false`)

Use `createApi()` for quick setup, or use `Api` directly when you need full control!

## Step 3: Test Your API

Run your server:
```bash
node server.js
```

Now you can:

```bash
# Create a task
curl -X POST http://localhost:3000/api/1.0.0/tasks \
  -H "Content-Type: application/json" \
  -d '{"data": {"type": "tasks", "attributes": {"title": "Learn JSON REST API"}}}'

# List all tasks
curl http://localhost:3000/api/1.0.0/tasks

# Get a specific task
curl http://localhost:3000/api/1.0.0/tasks/1

# Update a task
curl -X PATCH http://localhost:3000/api/1.0.0/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"data": {"attributes": {"completed": true}}}'

# Delete a task
curl -X DELETE http://localhost:3000/api/1.0.0/tasks/1
```

## Step 4: Add MySQL Storage

Let's make it persistent! Update your `server.js`:

```javascript
import { createApi, Schema, MySQLPlugin } from 'json-rest-api';

// Create API with MySQL
const api = createApi({
  name: 'taskmanager',
  version: '1.0.0',
  storage: 'mysql',
  mysql: {
    connection: {
      host: 'localhost',
      user: 'root',
      password: 'password',
      database: 'taskmanager'
    }
  },
  http: { basePath: '/api' }
});

// Same schema as before
const taskSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  completed: { type: 'boolean', default: false },
  priority: { type: 'string', default: 'medium' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

api.addResource('tasks', taskSchema);

// Magic! Sync the database automatically
await api.syncSchema(taskSchema, 'tasks');

api.mount(app);
```

## Step 5: Add Users with Relationships

Let's add a users table:

```javascript
// User schema
const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true, min: 3, max: 50 },
  email: { type: 'string', required: true, lowercase: true },
  passwordHash: { type: 'string', required: true },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Update task schema to include user
const taskSchema = new Schema({
  id: { type: 'id' },
  userId: { type: 'id', required: true },  // Link to user
  title: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  completed: { type: 'boolean', default: false },
  priority: { type: 'string', default: 'medium' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
});

// Register both schemas
api.addResource('users', userSchema);
api.addResource('tasks', taskSchema);

// Sync both tables
await api.syncSchema(userSchema, 'users');
await api.syncSchema(taskSchema, 'tasks');
```

Congratulations! You now have a working API with two related tables! 🎉

---

# Core Concepts Tutorial

## Understanding Schemas

Schemas are the heart of your API. They define what your data looks like and how it's validated.

### Basic Types

```javascript
const productSchema = new Schema({
  // Numeric types
  id: { type: 'id' },                    // Auto-incrementing ID
  price: { type: 'number', min: 0 },     // Positive numbers only
  stock: { type: 'number', default: 0 }, // Default value
  
  // String types
  name: { type: 'string', required: true },
  sku: { type: 'string', uppercase: true },  // Auto-uppercase
  description: { type: 'string', max: 1000 },
  
  // Boolean
  active: { type: 'boolean', default: true },
  featured: { type: 'boolean' },
  
  // Dates
  createdAt: { type: 'timestamp' },
  launchDate: { type: 'date' },        // YYYY-MM-DD
  lastModified: { type: 'dateTime' },  // Full datetime
  
  // Complex types
  tags: { type: 'array', default: [] },
  metadata: { type: 'object' },
  
  // Special types
  image: { type: 'blob' },
  config: { type: 'serialize' }  // Handles circular references
});
```

### Advanced Validation

```javascript
const advancedSchema = new Schema({
  // Custom validation
  email: { 
    type: 'string', 
    required: true,
    lowercase: true,
    validator: (value) => {
      if (!value.includes('@')) return 'Invalid email';
    }
  },
  
  // Conditional defaults
  code: {
    type: 'string',
    default: () => 'PROD-' + Date.now()
  },
  
  // Trimming and length
  title: {
    type: 'string',
    trim: 100,     // Max 100 chars
    notEmpty: true // Can't be empty string
  },
  
  // Null handling
  notes: {
    type: 'string',
    canBeNull: true,    // Allows null
    emptyAsNull: true   // "" becomes null
  }
});
```

## Understanding the Api Class

The Api class is your central hub:

```javascript
// Create with options
const api = new Api({
  name: 'myapp',
  version: '1.0.0',
  idProperty: 'id'  // Default is 'id'
});

// Add plugins
api
  .use(ValidationPlugin)
  .use(MySQLPlugin, { connection: dbConfig })
  .use(HTTPPlugin, { basePath: '/api' });

// Register schemas
api.addResource('products', productSchema);

// Use programmatically - OLD WAY (still works)
const product = await api.insert({
  name: 'Awesome Widget',
  price: 29.99
}, { type: 'products' });

// NEW WAY - Much more intuitive!
const product = await api.resources.products.create({
  name: 'Awesome Widget',
  price: 29.99
});

// All operations available
const found = await api.resources.products.get(123);
const updated = await api.resources.products.update(123, { price: 39.99 });
const results = await api.resources.products.query({ filter: { active: true } });
await api.resources.products.delete(123);
```

## Understanding Hooks

Hooks let you inject custom logic at any point:

```javascript
// Before validation
api.hook('beforeValidate', async (context) => {
  // context.method: 'insert', 'update', 'delete', 'get', 'query'
  // context.data: The data being processed
  // context.options: Options passed to the method
  
  if (context.method === 'insert') {
    context.data.createdBy = context.options.userId;
  }
});

// After validation
api.hook('afterValidate', async (context) => {
  // context.errors: Array of validation errors
  
  // Add custom validation
  if (context.data.price > 1000 && !context.data.approved) {
    context.errors.push({
      field: 'price',
      message: 'High-value items need approval',
      code: 'NEEDS_APPROVAL'
    });
  }
});

// Transform results
api.hook('transformResult', async (context) => {
  // context.result: The data being returned
  
  if (context.result && context.options.type === 'products') {
    // Add computed field
    context.result.displayPrice = `$${context.result.price.toFixed(2)}`;
  }
});
```

---

# Plugin Tutorials

## ValidationPlugin Tutorial

The ValidationPlugin is automatically included and provides schema validation.

### Step 1: Basic Validation

```javascript
const api = createApi({ storage: 'memory' });

// Define strict schema
const userSchema = new Schema({
  username: { 
    type: 'string', 
    required: true, 
    min: 3, 
    max: 20,
    pattern: /^[a-zA-Z0-9_]+$/  // Alphanumeric + underscore only
  },
  age: { 
    type: 'number', 
    min: 13, 
    max: 120 
  }
});

api.addResource('users', userSchema);

// This will fail validation
try {
  await api.insert({
    username: 'a',  // Too short!
    age: 200        // Too old!
  }, { type: 'users' });
} catch (error) {
  console.log(error.errors);
  // [
  //   { field: 'username', message: 'username is too short' },
  //   { field: 'age', message: 'age is too high' }
  // ]
}
```

### Step 2: Custom Validators

```javascript
const schema = new Schema({
  password: {
    type: 'string',
    required: true,
    validator: (value) => {
      if (value.length < 8) return 'Password must be at least 8 characters';
      if (!/[A-Z]/.test(value)) return 'Password must contain uppercase';
      if (!/[0-9]/.test(value)) return 'Password must contain number';
    }
  },
  confirmPassword: {
    type: 'string',
    required: true
  }
});

// Cross-field validation
api.hook('afterValidate', async (context) => {
  if (context.data.password !== context.data.confirmPassword) {
    context.errors.push({
      field: 'confirmPassword',
      message: 'Passwords do not match'
    });
  }
});
```

### Step 3: Conditional Validation

```javascript
const orderSchema = new Schema({
  type: { type: 'string', required: true },
  amount: { type: 'number', required: true },
  giftMessage: { type: 'string' }
});

api.hook('afterValidate', async (context) => {
  const { data } = context;
  
  // Gift orders require a message
  if (data.type === 'gift' && !data.giftMessage) {
    context.errors.push({
      field: 'giftMessage',
      message: 'Gift orders require a message'
    });
  }
});
```

### 🚀 Pro Tip: Cleaner Resource Definition

Instead of adding hooks separately, you can define them with the resource:

```javascript
const userSchema = new Schema({
  email: { type: 'string', required: true, lowercase: true },
  password: { type: 'string', required: true },
  role: { type: 'string', default: 'user' }
});

const userHooks = {
  async afterValidate(context) {
    const { data, method, errors } = context;
    
    // Check email uniqueness
    if (method === 'insert' || method === 'update') {
      const existing = await context.api.query({
        filter: { email: data.email }
      }, { type: 'users' });
      
      if (existing.meta.total > 0) {
        errors.push({
          field: 'email',
          message: 'Email already exists'
        });
      }
    }
  },
  
  async beforeInsert(context) {
    // Hash password
    const bcrypt = await import('bcrypt');
    context.data.password = await bcrypt.hash(context.data.password, 10);
  },
  
  async transformResult(context) {
    // Never return password
    if (context.result?.attributes) {
      delete context.result.attributes.password;
    }
  }
};

// Add resource with schema AND hooks together!
api.addResource('users', userSchema, userHooks);
```

This approach keeps all resource logic in one place, making it easier to maintain!

## Modular Resources (Advanced)

When your API grows, you'll want to organize resources into separate files. Here's the challenge and solution:

### The Challenge: Why Not Use createApi() Everywhere?

You might think to do this in each resource file:
```javascript
// ❌ DON'T DO THIS - api/1.0.0/users.js
const api = createApi({ ... });  // Creates NEW api instance
api.addResource('users', schema);
export default api;

// ❌ DON'T DO THIS - api/1.0.0/products.js  
const api = createApi({ ... });  // Creates ANOTHER api instance!
api.addResource('products', schema);
export default api;
```

**Problems:**
- Each file creates a separate API instance
- Multiple database connections (waste of resources)
- Resources can't interact with each other
- Configuration is duplicated everywhere

### The Solution: Shared API Instances

Resources in the same version should SHARE one API instance:

```javascript
// ✅ DO THIS - api/1.0.0/users.js
import { Api, Schema } from 'json-rest-api';

// Get existing or create shared instance for v1.0.0
const api = Api.get('myapp', '1.0.0') || new Api({ 
  name: 'myapp', 
  version: '1.0.0' 
});

// Configure plugins only if not already done
if (!api.hasPlugin(HTTPPlugin)) {
  api.use(HTTPPlugin, { basePath: '/api/1.0.0' });
}

// Define schema and hooks together
const userSchema = new Schema({ ... });
const userHooks = {
  async beforeInsert(context) {
    // Hash passwords, etc.
  }
};

// Add resource with hooks
api.addResource('users', userSchema, userHooks);

export default api;
```

### Even Better: Using defineResource Helper

The library includes a helper that manages this for you:

```javascript
// api/config.js - Shared configuration
export const apiConfig = {
  name: 'myapp',
  mysql: {
    connections: [{
      name: 'main',
      config: { host: 'localhost', ... }
    }]
  }
};

// api/1.0.0/users.js - Clean resource file
import { Schema, defineResource } from 'json-rest-api/resource-helper.js';
import { apiConfig } from '../config.js';

export default defineResource('1.0.0', 'users', {
  api: apiConfig,  // Shared config
  
  schema: new Schema({
    id: { type: 'id' },
    name: { type: 'string', required: true },
    email: { type: 'string', required: true }
  }),
  
  hooks: {
    async beforeInsert(context) {
      // Your logic here
    }
  }
});
```

### Loading Resources in Your Server

```javascript
// server.js - Super clean!
import express from 'express';
const app = express();

// Option 1: Manual loading
const apis = [
  await import('./api/1.0.0/users.js'),
  await import('./api/1.0.0/products.js'),
];
apis.forEach(module => module.default.mount(app));

// Option 2: Auto-loading (like the old library!)
import { loadResourcesFromPath } from './load-resources.js';
await loadResourcesFromPath(join(__dirname, 'api'), app);

app.listen(3000);
```

### Key Concepts to Remember

1. **createApi()** = Creates a NEW api instance (use for simple, single-file APIs)
2. **Api.get() || new Api()** = Gets or creates a SHARED instance (use in resource files)
3. **defineResource()** = Helper that does the sharing for you (recommended)
4. **One API instance per version** = All resources in v1.0.0 share the same API
5. **api.resources.{name}** = NEW intuitive way to access resources!

This way your server stays clean (one line per resource), resources are modular, and everything shares the same database connections and configuration!

## Programmatic API Usage

The new programmatic API makes working with resources intuitive and chainable:

### Basic CRUD Operations

```javascript
// After registering a resource
api.addResource('users', userSchema);

// Create
const user = await api.resources.users.create({
  username: 'johndoe',
  email: 'john@example.com'
});

// Read
const found = await api.resources.users.get(user.data.id);

// Update
const updated = await api.resources.users.update(user.data.id, {
  email: 'newemail@example.com'
});

// Delete
await api.resources.users.delete(user.data.id);

// Query
const results = await api.resources.users.query({
  filter: { active: true },
  sort: '-createdAt',
  page: { size: 10, number: 1 }
});
```

### Batch Operations

```javascript
// Create multiple users at once
const users = await api.resources.users.batch.create([
  { username: 'user1', email: 'user1@example.com' },
  { username: 'user2', email: 'user2@example.com' },
  { username: 'user3', email: 'user3@example.com' }
]);

// Update multiple users
await api.resources.users.batch.update([
  { id: 1, data: { active: false } },
  { id: 2, data: { active: false } }
]);

// Delete multiple users
await api.resources.users.batch.delete([1, 2, 3]);
```

### Accessing Different Versions

```javascript
// Default: uses the current API version
const user = await api.resources.users.get(123);

// Access a specific version
const userV1 = await api.resources.users.version('1.0.0').get(123);
const userV2 = await api.resources.users.version('2.0.0').get(123);

// This is especially useful when migrating between versions
const oldData = await api.resources.users.version('1.0.0').query();
for (const item of oldData.data) {
  await api.resources.users.version('2.0.0').create(migrateData(item));
}
```

### Direct Access to Schema and Hooks

```javascript
// Get the schema for a resource
const schema = api.resources.users.schema;

// Get the hooks for a resource
const hooks = api.resources.users.hooks;

// Check if a resource exists
if ('users' in api.resources) {
  console.log('Users resource is available');
}

// List all resources
const allResources = Object.keys(api.resources);
console.log('Available resources:', allResources);
```

### Alternative Syntax

If you prefer function calls over property access:

```javascript
// Using resource() method
const user = await api.resource('users').get(123);
const posts = await api.resource('posts').query();

// This is useful when resource names are dynamic
const resourceName = 'users';
const data = await api.resource(resourceName).get(123);
```

## MySQLPlugin Tutorial

### Step 1: Basic Setup

```javascript
import { Api, MySQLPlugin, Schema } from 'json-rest-api';

const api = new Api();
api.use(MySQLPlugin, {
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  }
});
```

### Step 2: Schema Synchronization

```javascript
// Define your schema
const postSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true, max: 200 },
  content: { type: 'string', text: true },  // Creates TEXT column
  views: { type: 'number', default: 0 },
  published: { type: 'boolean', default: false },
  publishDate: { type: 'dateTime' },
  tags: { type: 'array' },  // Stored as JSON
  metadata: { type: 'object' }  // Stored as JSON
});

// Sync creates/updates the table automatically!
await api.syncSchema(postSchema, 'posts');
```

### Step 3: Advanced MySQL Features

```javascript
// Multiple connections
api.use(MySQLPlugin, {
  connections: [
    {
      name: 'primary',
      config: { host: 'primary.db', ... }
    },
    {
      name: 'replica',
      config: { host: 'replica.db', ... }
    }
  ]
});

// Use specific connection - OLD WAY
const data = await api.query({}, {
  type: 'posts',
  connection: 'replica'  // Read from replica
});

// NEW WAY - Much cleaner!
const data = await api.resources.posts.query({}, {
  connection: 'replica'  // Read from replica
});

// Direct SQL access when needed
const { pool } = api.getConnection('primary');
const [rows] = await pool.query(
  'SELECT * FROM posts WHERE MATCH(title, content) AGAINST(?)',
  ['search term']
);
```

### Step 4: Transactions

```javascript
const { pool } = api.getConnection();
const connection = await pool.getConnection();

try {
  await connection.beginTransaction();
  
  // Create author
  const author = await api.insert({
    name: 'John Doe',
    email: 'john@example.com'
  }, {
    type: 'authors',
    connection  // Use transaction connection
  });
  
  // Create post
  const post = await api.insert({
    authorId: author.data.id,
    title: 'My First Post',
    content: 'Hello World!'
  }, {
    type: 'posts',
    connection
  });
  
  await connection.commit();
  console.log('Transaction successful!');
  
} catch (error) {
  await connection.rollback();
  console.error('Transaction failed:', error);
} finally {
  connection.release();
}
```

## HTTPPlugin Tutorial

### Step 1: Basic HTTP Setup

```javascript
import express from 'express';

const app = express();
const api = createApi({
  name: 'blog',
  version: '1.0.0',
  storage: 'memory',
  http: { 
    basePath: '/api',
    app  // Pass Express app directly
  }
});

// That's it! Your API is now available at:
// GET    /api/1.0.0/posts
// GET    /api/1.0.0/posts/:id
// POST   /api/1.0.0/posts
// PATCH  /api/1.0.0/posts/:id
// DELETE /api/1.0.0/posts/:id
```

### Step 2: Query Parameters

```javascript
// Filtering
GET /api/1.0.0/posts?filter[published]=true&filter[category]=tech

// Sorting (-prefix for descending)
GET /api/1.0.0/posts?sort=-createdAt,title

// Pagination
GET /api/1.0.0/posts?page[size]=10&page[number]=2

// Combined
GET /api/1.0.0/posts?filter[published]=true&sort=-views&page[size]=5
```

### Step 3: JSON:API Format

The HTTP plugin follows JSON:API specification:

```javascript
// Request body for POST/PATCH
{
  "data": {
    "type": "posts",
    "attributes": {
      "title": "Hello World",
      "content": "My first post"
    }
  }
}

// Response format
{
  "data": {
    "id": "123",
    "type": "posts",
    "attributes": {
      "title": "Hello World",
      "content": "My first post",
      "createdAt": 1639094400000
    }
  }
}

// Collection response
{
  "data": [
    { "id": "1", "type": "posts", "attributes": {...} },
    { "id": "2", "type": "posts", "attributes": {...} }
  ],
  "meta": {
    "total": 50,
    "pageSize": 10,
    "pageNumber": 1,
    "totalPages": 5
  },
  "links": {
    "self": "/api/1.0.0/posts?page[number]=1",
    "next": "/api/1.0.0/posts?page[number]=2",
    "last": "/api/1.0.0/posts?page[number]=5"
  }
}
```

### Step 4: Custom Middleware

```javascript
// Add middleware to all routes
api.useMiddleware((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Add middleware to specific routes
api.useRouteMiddleware('post', '/:type', async (req, res, next) => {
  // Check API key for POST requests
  if (!req.headers['x-api-key']) {
    return res.status(401).json({
      errors: [{ status: '401', title: 'API key required' }]
    });
  }
  next();
});
```

## PositioningPlugin Tutorial

Perfect for drag-and-drop interfaces!

### Step 1: Enable Positioning

```javascript
import { PositioningPlugin } from 'json-rest-api';

const api = createApi({ storage: 'memory' });
api.use(PositioningPlugin);

const todoSchema = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  position: { type: 'number' }  // Required field!
});

api.addResource('todos', todoSchema);
```

### Step 2: Insert with Position

```javascript
// Insert at the end (default)
const todo1 = await api.insert({
  title: 'First task'
}, { 
  type: 'todos',
  positioning: { enabled: true }
});
// position: 1

// Insert at the end explicitly
const todo2 = await api.insert({
  title: 'Second task',
  beforeId: null  // null = end
}, { 
  type: 'todos',
  positioning: { enabled: true }
});
// position: 2

// Insert before another item
const todo3 = await api.insert({
  title: 'Urgent task',
  beforeId: todo1.data.id  // Insert before first task
}, { 
  type: 'todos',
  positioning: { enabled: true }
});
// position: 1 (others shift up)
```

### Step 3: Reposition Existing Items

```javascript
// Move to end
await api.reposition('todos', todoId, null);

// Move before another item
await api.reposition('todos', todoId, beforeTodoId);

// Update with positioning
await api.update(todoId, {
  title: 'Updated title',
  beforeId: anotherId  // Also reposition
}, {
  type: 'todos',
  positioning: { enabled: true }
});
```

### Step 4: Position Filters (Groups)

```javascript
// Configure positioning within groups
api.use(PositioningPlugin, {
  positionField: 'position',
  positionFilters: ['projectId', 'status']  // Separate positions per project/status
});

// Now positions are scoped
await api.insert({
  title: 'Project A Task',
  projectId: 1,
  status: 'active',
  beforeId: null
}, { 
  type: 'todos',
  positioning: { enabled: true }
});
// This gets position 1 within project=1, status=active
```

### Step 5: Normalize Positions

```javascript
// Remove gaps in position numbers
await api.normalizePositions('todos', {
  projectId: 1  // Normalize within this project
});

// Get next available position
const nextPos = await api.getNextPosition('todos', {
  projectId: 1,
  status: 'active'
});
```

## VersioningPlugin Tutorial

### Part 1: API Versioning

```javascript
// Version 1.0.0 of your API
const apiV1 = createApi({
  name: 'blog',
  version: '1.0.0',
  storage: 'memory'
});

const postSchemaV1 = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string', required: true }
});

apiV1.addResource('posts', postSchemaV1);

// Version 2.0.0 - Added author field
const apiV2 = createApi({
  name: 'blog',
  version: '2.0.0',
  storage: 'memory'
});

const postSchemaV2 = new Schema({
  id: { type: 'id' },
  title: { type: 'string', required: true },
  content: { type: 'string', required: true },
  author: { type: 'string', required: true },  // NEW!
  tags: { type: 'array', default: [] }        // NEW!
});

apiV2.addResource('posts', postSchemaV2);
```

### Part 2: Version Selection

```javascript
// Get specific version
const v1 = Api.get('blog', '1.0.0');

// Get latest
const latest = Api.get('blog', 'latest');

// Get minimum version
const v2plus = Api.get('blog', '2.0.0');  // Gets 2.0.0 or higher

// Use in your app
async function createPost(data) {
  // Auto-select version based on data
  const hasAuthor = 'author' in data;
  const api = Api.get('blog', hasAuthor ? '2.0.0' : '1.0.0');
  
  return api.insert(data, { type: 'posts' });
}
```

### Part 3: Resource Versioning

```javascript
import { VersioningPlugin } from 'json-rest-api';

const api = createApi({ storage: 'mysql' });
api.use(VersioningPlugin, {
  trackHistory: true,
  optimisticLocking: true,
  versionField: 'version',
  lastModifiedField: 'lastModified',
  modifiedByField: 'modifiedBy'
});

// Automatic version tracking
const post = await api.insert({
  title: 'Original Title',
  content: 'Original content'
}, { 
  type: 'posts',
  userId: 'user123'
});
// version: 1, modifiedBy: 'user123'

// Update increments version
const updated = await api.update(post.data.id, {
  title: 'Updated Title'
}, { 
  type: 'posts',
  userId: 'user456'
});
// version: 2, modifiedBy: 'user456'
```

### Part 4: Version History

```javascript
// Get full history
const history = await api.getVersionHistory('posts', postId);
// Returns all versions with timestamps

// Restore old version
await api.restoreVersion('posts', postId, 1);
// Post is now back to version 1 content (as version 3)

// Compare versions
const diff = await api.diffVersions('posts', postId, 1, 2);
console.log(diff);
// {
//   version1: 1,
//   version2: 2,
//   changes: [
//     { field: 'title', oldValue: 'Original Title', newValue: 'Updated Title' }
//   ]
// }
```

### Part 5: Optimistic Locking

```javascript
// Prevent concurrent updates
const post = await api.get(postId, { type: 'posts' });

try {
  await api.update(postId, {
    title: 'New Title',
    version: post.data.attributes.version  // Include current version
  }, { type: 'posts' });
} catch (error) {
  if (error.code === 'VERSION_CONFLICT') {
    console.log('Someone else updated this post!');
    // Reload and try again
  }
}
```

## SecurityPlugin Tutorial

### Step 1: Basic Security

```javascript
import { SecurityPlugin } from 'json-rest-api';

api.use(SecurityPlugin, {
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,  // 100 requests per window
    message: 'Too many requests'
  },
  
  // CORS
  cors: {
    origin: ['https://app.example.com', 'http://localhost:3000'],
    credentials: true
  },
  
  // Authentication
  authentication: {
    type: 'bearer',  // or 'apikey', 'basic'
    required: true,
    header: 'Authorization'
  }
});
```

### Step 2: Token Authentication

```javascript
api.use(SecurityPlugin, {
  authentication: {
    type: 'bearer',
    required: true
  },
  verifyToken: async (token, context) => {
    // Verify JWT token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return {
        id: decoded.userId,
        email: decoded.email,
        roles: decoded.roles
      };
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
});

// Token is now available in hooks
api.hook('beforeInsert', async (context) => {
  context.data.createdBy = context.options.user?.id;
});
```

### Step 3: API Key Authentication

```javascript
api.use(SecurityPlugin, {
  authentication: {
    type: 'apikey',
    header: 'X-API-Key',
    queryParam: 'apikey'  // Also allow ?apikey=xxx
  },
  verifyToken: async (apiKey) => {
    // Look up API key in database
    const keyData = await findApiKey(apiKey);
    if (!keyData) throw new Error('Invalid API key');
    
    return {
      id: keyData.userId,
      permissions: keyData.permissions
    };
  }
});
```

### Step 4: Public/Private Routes

```javascript
api.use(SecurityPlugin, {
  publicRead: true,  // Allow GET without auth
  authentication: {
    type: 'bearer',
    required: true
  }
});

// Or fine-grained control
api.hook('beforeValidate', async (context) => {
  const isPublic = 
    context.options.type === 'posts' && 
    context.method === 'query';
    
  if (!isPublic && !context.options.authenticated) {
    context.errors.push({
      field: null,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
});
```

### Step 5: Security Headers

The SecurityPlugin automatically adds:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000`
- `Content-Security-Policy` with safe defaults

## LoggingPlugin Tutorial

### Step 1: Basic Logging

```javascript
import { LoggingPlugin } from 'json-rest-api';

api.use(LoggingPlugin, {
  level: 'info',  // error, warn, info, debug
  format: 'json',  // or 'pretty'
  includeRequest: true,
  includeResponse: true,
  includeTiming: true
});

// Now all operations are logged!
```

### Step 2: Custom Logger

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

api.use(LoggingPlugin, {
  logger,  // Use Winston instead of console
  sensitiveFields: ['password', 'creditCard', 'ssn']
});
```

### Step 3: Audit Logging

```javascript
api.use(LoggingPlugin, {
  auditLog: true,  // Log all data changes
  level: 'info'
});

// Creates detailed audit trail
// INFO: Resource created {
//   audit: true,
//   operation: 'create',
//   type: 'users',
//   id: '123',
//   userId: 'admin',
//   changes: { name: 'John', email: 'john@example.com' }
// }
```

### Step 4: Manual Logging

```javascript
// Use the logger directly
api.log.info('Processing payment', {
  orderId: '12345',
  amount: 99.99,
  currency: 'USD'
});

api.log.error('Payment failed', {
  orderId: '12345',
  error: 'Insufficient funds',
  attempts: 3
});

api.log.debug('Cache hit', {
  key: 'user:123',
  ttl: 3600
});
```

## OpenAPIPlugin Tutorial

### Step 1: Generate Documentation

```javascript
import { OpenAPIPlugin } from 'json-rest-api';

api.use(OpenAPIPlugin, {
  title: 'My Awesome API',
  version: '1.0.0',
  description: 'The best API ever created',
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Development' }
  ],
  contact: {
    name: 'API Support',
    email: 'support@example.com'
  }
});

// Documentation available at:
// GET /api/docs      - Swagger UI
// GET /api/openapi.json - OpenAPI spec
```

### Step 2: Enhance Schema Documentation

```javascript
const userSchema = new Schema({
  id: { 
    type: 'id',
    description: 'Unique user identifier'
  },
  email: { 
    type: 'string',
    required: true,
    description: 'User email address',
    example: 'user@example.com'
  },
  role: {
    type: 'string',
    enum: ['user', 'admin', 'moderator'],
    description: 'User role in the system',
    default: 'user'
  }
});

// This generates rich OpenAPI documentation!
```

---

# Advanced Features

## Cross-API Communication

APIs can talk to each other!

```javascript
// Users API
const usersApi = createApi({
  name: 'users',
  version: '1.0.0',
  storage: 'mysql'
});

// Orders API
const ordersApi = createApi({
  name: 'orders',
  version: '1.0.0',
  storage: 'mysql'
});

// Orders can access users!
ordersApi.hook('afterInsert', async (context) => {
  if (context.result) {
    // Automatically gets compatible users API
    const usersApi = ordersApi.apis.users;
    
    // Get user details
    const user = await usersApi.get(
      context.result.userId, 
      { type: 'users' }
    );
    
    // Send confirmation email
    await sendEmail(user.data.attributes.email, {
      subject: 'Order Confirmed',
      orderId: context.result.id
    });
  }
});
```

## Creating Custom Plugins

Build your own plugins!

```javascript
const CachePlugin = {
  install(api, options = {}) {
    const cache = new Map();
    const ttl = options.ttl || 60000;  // 1 minute default
    
    // Cache GET requests
    api.hook('beforeGet', async (context) => {
      const key = `${context.options.type}:${context.id}`;
      const cached = cache.get(key);
      
      if (cached && cached.expires > Date.now()) {
        context.result = cached.data;
        context.fromCache = true;
        return false;  // Skip further processing
      }
    });
    
    // Store in cache after GET
    api.hook('afterGet', async (context) => {
      if (!context.fromCache && context.result) {
        const key = `${context.options.type}:${context.id}`;
        cache.set(key, {
          data: context.result,
          expires: Date.now() + ttl
        });
      }
    });
    
    // Invalidate on update/delete
    api.hook('afterUpdate', async (context) => {
      const key = `${context.options.type}:${context.id}`;
      cache.delete(key);
    });
    
    api.hook('afterDelete', async (context) => {
      const key = `${context.options.type}:${context.id}`;
      cache.delete(key);
    });
    
    // Add cache methods
    api.clearCache = () => cache.clear();
    api.getCacheSize = () => cache.size;
  }
};

// Use it!
api.use(CachePlugin, { ttl: 300000 });  // 5 minutes
```

## Complex Validation Scenarios

```javascript
// Product with complex rules
const productSchema = new Schema({
  name: { type: 'string', required: true },
  price: { type: 'number', required: true, min: 0 },
  salePrice: { type: 'number', min: 0 },
  category: { type: 'string', required: true },
  stock: { type: 'number', default: 0, min: 0 },
  sku: { type: 'string', required: true }
});

// Multi-field validation
api.hook('afterValidate', async (context) => {
  const { data, errors, method } = context;
  
  // Sale price must be less than regular price
  if (data.salePrice && data.salePrice >= data.price) {
    errors.push({
      field: 'salePrice',
      message: 'Sale price must be less than regular price'
    });
  }
  
  // SKU must be unique
  if ((method === 'insert' || method === 'update') && data.sku) {
    const existing = await api.query({
      filter: { sku: data.sku }
    }, { type: 'products' });
    
    const isDuplicate = method === 'insert' 
      ? existing.data.length > 0
      : existing.data.some(p => p.id !== context.id);
      
    if (isDuplicate) {
      errors.push({
        field: 'sku',
        message: 'SKU already exists'
      });
    }
  }
  
  // Category-specific validation
  if (data.category === 'electronics' && !data.warrantyPeriod) {
    errors.push({
      field: 'warrantyPeriod',
      message: 'Electronics must have warranty period'
    });
  }
});
```

## Performance Optimization

```javascript
// Batch operations
async function importProducts(products) {
  const batchSize = 100;
  const results = [];
  
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(product => 
        api.insert(product, { type: 'products' })
          .catch(error => ({ error, product }))
      )
    );
    
    results.push(...batchResults);
    
    // Progress
    console.log(`Imported ${Math.min(i + batchSize, products.length)} / ${products.length}`);
  }
  
  return results;
}

// Optimized queries
const results = await api.query({
  filter: { category: 'electronics', active: true },
  sort: '-price',
  page: { size: 50 }  // Don't fetch everything!
}, {
  type: 'products',
  fields: ['id', 'name', 'price']  // Only needed fields
});
```

## Error Recovery

```javascript
// Retry logic
async function reliableInsert(data, options, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await api.insert(data, options);
    } catch (error) {
      lastError = error;
      
      // Don't retry validation errors
      if (error.status === 422) throw error;
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Graceful degradation
async function getProductWithFallback(id) {
  try {
    // Try primary database
    return await api.get(id, { 
      type: 'products',
      connection: 'primary'
    });
  } catch (error) {
    console.warn('Primary database failed, trying cache...');
    
    try {
      // Try cache
      return await cacheApi.get(id, { type: 'products' });
    } catch (cacheError) {
      console.error('Cache also failed, returning degraded response');
      
      // Return degraded response
      return {
        data: {
          id,
          type: 'products',
          attributes: {
            name: 'Product temporarily unavailable',
            available: false
          }
        }
      };
    }
  }
}
```

## Testing Your API

```javascript
import { createApi, Schema } from 'json-rest-api';
import { describe, it, expect, beforeEach } from 'vitest';

describe('User API', () => {
  let api;
  
  beforeEach(() => {
    // Fresh API for each test
    api = createApi({
      name: 'test',
      version: '1.0.0',
      storage: 'memory'
    });
    
    const userSchema = new Schema({
      id: { type: 'id' },
      email: { type: 'string', required: true },
      name: { type: 'string', required: true }
    });
    
    api.addResource('users', userSchema);
  });
  
  it('should create a user', async () => {
    const user = await api.insert({
      email: 'test@example.com',
      name: 'Test User'
    }, { type: 'users' });
    
    expect(user.data.attributes.email).toBe('test@example.com');
    expect(user.data.id).toBeDefined();
  });
  
  it('should validate required fields', async () => {
    await expect(
      api.insert({ email: 'test@example.com' }, { type: 'users' })
    ).rejects.toThrow();
  });
  
  it('should update users', async () => {
    const user = await api.insert({
      email: 'test@example.com',
      name: 'Original Name'
    }, { type: 'users' });
    
    const updated = await api.update(user.data.id, {
      name: 'Updated Name'
    }, { type: 'users' });
    
    expect(updated.data.attributes.name).toBe('Updated Name');
  });
});
```

---

Congratulations! You've mastered the JSON REST API library! 🎉

Remember:
- Start simple with memory storage
- Add MySQL when you need persistence
- Use plugins to add features incrementally
- Hooks are your friends for custom logic
- The library handles versioning automatically
- Always validate your data
- Security first!

Happy coding! 🚀