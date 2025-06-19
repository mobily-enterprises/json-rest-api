# JSON REST API - Complete Guide

Welcome! This guide will teach you everything about the JSON REST API library through practical examples and clear explanations.

## Table of Contents

### Getting Started
1. [Core Concepts](#core-concepts) - API instances, schemas, resources, CRUD operations
2. [Quick Example: Blog API](#quick-example-blog-api) - See it all in action
3. [Installation & Setup](#installation--setup) - Get up and running

### Core Features
4. [Schemas & Validation](#schemas--validation) - Define your data models
5. [Resources & CRUD Operations](#resources--crud-operations) - Work with your data
6. [Querying & Filtering](#querying--filtering) - Powerful data retrieval
7. [Relationships & Joins](#relationships--joins) - Connect your data
8. [Hooks & Events](#hooks--events) - Extend functionality

### Plugins & Architecture
9. [Plugin System](#plugin-system) - How plugins work
10. [Built-in Plugins](#built-in-plugins) - Storage, features, and more
11. [Creating Custom Plugins](#creating-custom-plugins) - Build your own

### Advanced Topics
12. [API Versioning](#api-versioning) - Version your APIs
13. [Programmatic Usage](#programmatic-usage) - Use without HTTP
14. [Query Builder](#query-builder) - Advanced SQL queries
15. [Error Handling](#error-handling) - Handle errors gracefully
16. [Performance Optimization](#performance-optimization) - Make it fast

### Production & Deployment
17. [Organizing Resources](#organizing-resources) - Structure your project
18. [Authentication & Security](#authentication--security) - Secure your API
19. [Best Practices](#best-practices) - Do's and don'ts

### Reference
20. [API Reference](#api-reference) - Complete method reference
21. [Architecture & Design](#architecture--design) - Under the hood
22. [HTTP Plugin Details](#http-plugin-details) - REST endpoints
23. [Testing](#testing) - Test suites and strategies
24. [Contributing](#contributing) - Help improve the library

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

## Schemas & Validation

### Schema Structure

```javascript
const schema = new Schema({
  fieldName: {
    type: 'string',           // Required
    required: true,           // Optional
    default: 'value',         // Optional
    min: 1,                   // Optional (string length or number value)
    max: 100,                 // Optional
    unique: true,             // Optional
    silent: true,             // Optional - exclude from default SELECT
    searchable: true,         // Optional - allow filtering by this field
    refs: {                   // Optional - foreign key reference
      resource: 'users',
      join: {                 // Optional - automatic join config
        eager: true,
        fields: ['id', 'name']
      }
    }
  }
});
```

### Field Types

| Type | Description | MySQL Type |
|------|-------------|------------|
| `'id'` | Auto-incrementing ID | INT AUTO_INCREMENT |
| `'string'` | Text field | VARCHAR(255) |
| `'number'` | Numeric field | DOUBLE |
| `'boolean'` | True/false | BOOLEAN |
| `'timestamp'` | Unix timestamp | BIGINT |
| `'json'` | JSON data | TEXT |
| `'array'` | Array (stored as JSON) | TEXT |
| `'object'` | Object (stored as JSON) | TEXT |

### Validation Rules

```javascript
const userSchema = new Schema({
  // String validation
  username: { 
    type: 'string', 
    required: true,
    min: 3,        // Min length
    max: 20,       // Max length
    match: /^[a-zA-Z0-9_]+$/,  // Regex pattern
    lowercase: true  // Transform to lowercase
  },
  
  // Number validation
  age: { 
    type: 'number',
    min: 0,        // Min value
    max: 150,      // Max value
    integer: true  // Must be integer
  },
  
  // Enum validation
  role: {
    type: 'string',
    enum: ['user', 'admin', 'moderator'],
    default: 'user'
  },
  
  // Custom validation
  email: {
    type: 'string',
    validate: async (value) => {
      if (!value.includes('@')) {
        throw new Error('Invalid email format');
      }
      return value.toLowerCase();
    }
  }
});
```

### Silent Fields

Fields marked as `silent: true` are excluded from query results by default:

```javascript
const userSchema = new Schema({
  name: { type: 'string' },
  email: { type: 'string' },
  password: { type: 'string', silent: true },  // Never in queries
  apiKey: { type: 'string', silent: true }     // Never in queries
});
```

## Resources & CRUD Operations

### Adding Resources

```javascript
// Basic resource
api.addResource('users', userSchema);

// With hooks
api.addResource('posts', postSchema, {
  beforeInsert: async (context) => {
    context.data.slug = slugify(context.data.title);
  },
  afterUpdate: async (context) => {
    await clearCache(context.id);
  }
});

// With searchable field mappings
api.addResource('posts', postSchema, {
  searchableFields: {
    author: 'authorId.name',      // Filter by author name
    authorEmail: 'authorId.email', // Filter by author email
    category: 'categoryId.title'   // Filter by category title
  }
});
```

### Create (Insert)

```javascript
// Single create
const user = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});

// Batch create
const users = await api.resources.users.batch.create([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' }
]);
```

### Read (Get)

```javascript
// Get by ID
const user = await api.resources.users.get(123);

// Get with joins
const post = await api.resources.posts.get(456, {
  joins: ['authorId', 'categoryId']
});

// Handle not found
const user = await api.resources.users.get(999, {
  allowNotFound: true  // Returns null instead of throwing
});
```

### Update

```javascript
// Partial update (PATCH semantics)
const updated = await api.resources.users.update(123, {
  name: 'Jane Doe'
});

// Full update (PUT semantics)
const replaced = await api.resources.users.update(123, {
  name: 'Jane Doe',
  email: 'jane@example.com',
  active: true
}, {
  fullRecord: true  // Requires complete record
});
```

### Delete

```javascript
// Delete by ID
await api.resources.users.delete(123);

// Soft delete (with plugin)
await api.resources.posts.delete(456);  // Sets deletedAt timestamp
```

### Query (List)

```javascript
// Simple query
const users = await api.resources.users.query();

// Advanced query
const results = await api.resources.posts.query({
  filter: { 
    published: true,
    authorId: '123',
    tags: 'javascript'  // Searches array field
  },
  sort: '-createdAt,title',  // Sort by createdAt DESC, then title ASC
  page: { size: 20, number: 1 },
  joins: ['authorId', 'categoryId']
});

// Response structure
{
  data: [...],      // Array of resources
  meta: {
    total: 45,      // Total matching records
    pageSize: 20,   // Items per page
    pageNumber: 1,  // Current page
    totalPages: 3   // Total pages
  }
}
```

## Querying & Filtering

### Searchable Fields

**Important:** Only fields marked as `searchable: true` in the schema can be filtered:

```javascript
const postSchema = new Schema({
  title: { type: 'string', required: true, searchable: true },
  content: { type: 'string', required: true }, // NOT searchable
  published: { type: 'boolean', searchable: true },
  authorId: { type: 'id', searchable: true },
  category: { type: 'string', searchable: true },
  tags: { type: 'array', searchable: true }
});

// These filters will work:
await api.resources.posts.query({
  filter: {
    published: true,
    category: 'tech',
    tags: 'javascript'
  }
});

// This will throw an error (content is not searchable):
await api.resources.posts.query({
  filter: { content: 'some text' } // ERROR!
});
```

### Mapped Search Fields

You can also define searchable field mappings for filtering by joined fields:

```javascript
api.addResource('posts', postSchema, {
  searchableFields: {
    author: 'authorId.name',      // Filter by author name
    authorEmail: 'authorId.email', // Filter by author email
    category: 'categoryId.title'   // Filter by category title
  }
});

// Now you can filter by author name:
await api.resources.posts.query({
  filter: { author: 'John Doe' }
});
// This translates to a JOIN and filters by users.name
```

### Filter Operators

```javascript
// Basic equality
filter: { active: true }

// Comparison operators
filter: {
  age: { $gt: 18 },        // Greater than
  price: { $lte: 100 },    // Less than or equal
  status: { $ne: 'deleted' } // Not equal
}

// Array operators
filter: {
  status: { $in: ['active', 'pending'] },
  category: { $nin: ['spam', 'trash'] }
}

// Range operator
filter: {
  createdAt: { $between: ['2024-01-01', '2024-12-31'] }
}

// Pattern matching
filter: {
  email: { $like: '%@example.com' },
  name: { $like: 'John%' }
}
```

### Complex Queries

```javascript
// OR conditions
filter: {
  $or: [
    { status: 'published' },
    { authorId: currentUserId }
  ]
}

// Nested AND/OR
filter: {
  category: 'tech',
  $or: [
    { featured: true },
    { 
      $and: [
        { likes: { $gte: 100 } },
        { publishedAt: { $gte: '2024-01-01' } }
      ]
    }
  ]
}
```

### Sorting

```javascript
// Single field
sort: 'title'              // Ascending
sort: '-createdAt'         // Descending

// Multiple fields
sort: ['-priority', 'createdAt', 'title']

// Object syntax
sort: [
  { field: 'priority', direction: 'desc' },
  { field: 'createdAt', direction: 'asc' }
]
```

### Pagination

```javascript
// Page-based
const page1 = await api.resources.posts.query({
  page: { size: 20, number: 1 }
});

// Offset-based
const results = await api.resources.posts.query({
  limit: 20,
  offset: 40  // Skip first 40
});

// Cursor-based (for large datasets)
const page1 = await api.resources.events.query({
  sort: 'id',
  limit: 100
});

const page2 = await api.resources.events.query({
  filter: { id: { $gt: page1.data[99].id } },
  sort: 'id',
  limit: 100
});
```

### Field Selection

```javascript
// Select specific fields
const users = await api.resources.users.query({
  fields: ['id', 'name', 'email']
});

// With joins - select fields from related resources
const posts = await api.resources.posts.query({
  joins: ['authorId', 'categoryId'],
  fields: {
    posts: ['title', 'summary'],
    users: ['name', 'avatar'],
    categories: ['name', 'slug']
  }
});
```

### HTTP Query Parameters

When using HTTPPlugin, queries use URL parameters:

```
GET /api/posts?
  filter[published]=true&
  filter[authorId]=123&
  filter[tags]=javascript,nodejs&
  sort=-createdAt,title&
  page[size]=10&
  page[number]=2&
  fields[posts]=title,summary&
  include=author,category
```

## Relationships & Joins

Build sophisticated data models with relationships. JSON REST API makes it easy to define foreign keys, perform automatic joins, and manage related data efficiently.

### Defining Relationships

```javascript
const postSchema = new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string' },
  
  // Simple foreign key
  authorId: {
    type: 'id',
    refs: { resource: 'users' }
  },
  
  // With automatic join configuration
  categoryId: {
    type: 'id',
    refs: {
      resource: 'categories',
      join: {
        eager: true,              // Always join
        fields: ['name', 'slug'], // Only these fields
        resourceField: 'category' // Store at post.category
      }
    }
  }
});
```

### Basic refs Configuration

```javascript
refs: {
  resource: 'users',     // Target resource name (required)
  field: 'id',          // Target field (default: 'id')
  onDelete: 'restrict', // What happens on delete
  onUpdate: 'cascade'   // What happens on update
}
```

### Automatic Joins

The `join` configuration enables automatic data fetching:

#### Basic Join

```javascript
// Schema definition
const orderSchema = new Schema({
  customerId: {
    type: 'id',
    refs: {
      resource: 'customers',
      join: true  // Simple join - includes all fields
    }
  }
});

// Query with join
const orders = await api.resources.orders.query({
  joins: ['customerId']
});

// Result includes customer data
{
  id: '123',
  customerId: '456',
  customer: {
    id: '456',
    name: 'John Doe',
    email: 'john@example.com'
  }
}
```

#### Advanced Join Configuration

```javascript
const postSchema = new Schema({
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        // When to join
        eager: false,          // Don't join by default
        lazy: true,           // Allow on-demand joining
        
        // What to include
        fields: ['id', 'name', 'avatar'],     // Specific fields
        excludeFields: ['password', 'token'],  // Or exclude fields
        includeSilent: false,                  // Include silent fields?
        
        // Where to place data
        resourceField: 'author',  // Custom field name
        preserveId: true,        // Keep authorId field too
        
        // Processing
        runHooks: true,          // Run afterGet hooks
        hookContext: {           // Additional hook context
          isJoinResult: true
        },
        
        // Join type (MySQL)
        type: 'left'            // 'inner' | 'left' | 'right'
      }
    }
  }
});
```

### Join Modes

Three ways to place joined data:

#### 1. Replace Mode (Default)
```javascript
// Configuration
refs: {
  resource: 'users',
  join: { /* ... */ }
}

// Result
{
  id: '1',
  authorId: {  // ID replaced with object
    id: '123',
    name: 'Alice'
  }
}
```

#### 2. Resource Field Mode
```javascript
// Configuration  
refs: {
  resource: 'users',
  join: {
    resourceField: 'author'
  }
}

// Result
{
  id: '1',
  authorId: '123',  // ID preserved
  author: {         // Data in new field
    id: '123',
    name: 'Alice'
  }
}
```

#### 3. Preserve ID Mode
```javascript
// Configuration
refs: {
  resource: 'users', 
  join: {
    preserveId: true
  }
}

// Result
{
  id: '1',
  authorId: '123',    // ID preserved
  author: {           // Data in computed field
    id: '123',
    name: 'Alice'
  }
}
```

### Nested Joins

Join through multiple levels of relationships using dot notation:

```javascript
// Schema setup
const countrySchema = new Schema({
  name: { type: 'string' },
  code: { type: 'string' }
});

const citySchema = new Schema({
  name: { type: 'string' },
  countryId: {
    type: 'id',
    refs: {
      resource: 'countries',
      join: { fields: ['name', 'code'] }
    }
  }
});

const userSchema = new Schema({
  name: { type: 'string' },
  cityId: {
    type: 'id',
    refs: {
      resource: 'cities',
      join: { fields: ['name'] }
    }
  }
});

const postSchema = new Schema({
  title: { type: 'string' },
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: { fields: ['name'] }
    }
  }
});

// Query with nested joins
const posts = await api.resources.posts.query({
  joins: ['authorId.cityId.countryId']
});

// Result
{
  id: '1',
  title: 'Hello World',
  authorId: '10',
  author: {
    id: '10',
    name: 'Alice',
    cityId: '20',
    city: {
      id: '20', 
      name: 'New York',
      countryId: '30',
      country: {
        id: '30',
        name: 'United States',
        code: 'US'
      }
    }
  }
}
```

#### Nested Join Rules

1. **Each level must have join config** - Every field in the path needs `refs.join`
2. **Parent joins are automatic** - Requesting `a.b.c` includes `a` and `a.b`
3. **Hooks run innermost first** - Country → City → User → Post
4. **Placement follows field config** - Each level's placement rules apply

### Join Configuration

#### Eager vs Lazy Loading

```javascript
// Eager loading - Always join
const orderSchema = new Schema({
  customerId: {
    type: 'id',
    refs: {
      resource: 'customers',
      join: {
        eager: true  // Joins on every query
      }
    }
  }
});

// Lazy loading - Join on demand
const postSchema = new Schema({
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: false,  // Don't join by default
        lazy: true     // But allow via joins parameter
      }
    }
  }
});

// Request specific joins
const posts = await api.resources.posts.query({
  joins: ['authorId']  // Explicit join request
});
```

#### Field Selection

Control which fields are included:

```javascript
// Include specific fields
join: {
  fields: ['id', 'name', 'email']
}

// Exclude sensitive fields
join: {
  excludeFields: ['password', 'apiKey', 'resetToken']
}

// Include silent fields
join: {
  includeSilent: true,  // Include fields marked silent
  fields: ['id', 'name', 'internalNote']
}
```

#### Hook Execution

Run lifecycle hooks on joined data:

```javascript
// Schema
refs: {
  resource: 'users',
  join: {
    runHooks: true,
    hookContext: { source: 'join' }
  }
}

// Hook sees join context
api.hook('afterGet', async (context) => {
  if (context.options.isJoinResult) {
    // This is joined data
    console.log('Joined from:', context.options.parentType);
    console.log('Join field:', context.options.parentField);
  }
});
```

### Performance Optimization

#### 1. Select Only Needed Fields

```javascript
// Bad: Joining all fields
join: true

// Good: Only needed fields
join: {
  fields: ['id', 'name', 'avatar']
}
```

#### 2. Use Eager Loading Wisely

```javascript
// Bad: Always eager load everything
refs: {
  resource: 'users',
  join: { eager: true }
}

// Good: Eager load only when commonly needed
refs: {
  resource: 'categories',  // Always needed
  join: { eager: true, fields: ['name', 'slug'] }
}

refs: {
  resource: 'users',      // Sometimes needed
  join: { eager: false, lazy: true }
}
```

#### 3. Avoid Deep Nesting

```javascript
// Bad: Too many levels
const data = await api.resources.comments.query({
  joins: ['postId.authorId.departmentId.companyId.countryId']
});

// Good: Limit depth or break into steps
const comments = await api.resources.comments.query({
  joins: ['postId.authorId']
});

// Fetch additional data separately if needed
const authorIds = [...new Set(comments.map(c => c.post?.authorId))];
const authors = await api.resources.users.query({
  filter: { id: { $in: authorIds } },
  joins: ['departmentId']
});
```

#### 4. Use Indexes

Ensure foreign key fields are indexed in MySQL:

```javascript
const schema = new Schema({
  authorId: {
    type: 'id',
    refs: { resource: 'users' },
    index: true  // Create index for joins
  }
});
```

#### 5. Batch Join Requests

```javascript
// Bad: Multiple queries with same joins
const post1 = await api.resources.posts.get(1, { joins: ['authorId'] });
const post2 = await api.resources.posts.get(2, { joins: ['authorId'] });
const post3 = await api.resources.posts.get(3, { joins: ['authorId'] });

// Good: Single query
const posts = await api.resources.posts.query({
  filter: { id: { $in: [1, 2, 3] } },
  joins: ['authorId']
});
```

### Common Patterns

#### Many-to-Many Relationships

```javascript
// Junction table
const postTagSchema = new Schema({
  postId: {
    type: 'id',
    refs: { resource: 'posts' }
  },
  tagId: {
    type: 'id',
    refs: { 
      resource: 'tags',
      join: { fields: ['name', 'slug'] }
    }
  }
});

// Query posts with tags
api.hook('afterGet', async (context) => {
  if (context.options.type === 'posts' && context.result) {
    // Fetch tags for post
    const postTags = await api.resources.postTags.query({
      filter: { postId: context.result.id },
      joins: ['tagId']
    });
    
    context.result.tags = postTags.data.map(pt => pt.tag);
  }
});
```

#### Self-Referential Relationships

```javascript
// Employee with manager
const employeeSchema = new Schema({
  name: { type: 'string' },
  email: { type: 'string' },
  managerId: {
    type: 'id',
    refs: {
      resource: 'employees',  // Self reference
      join: {
        fields: ['id', 'name', 'email'],
        resourceField: 'manager'
      }
    }
  }
});

// Query with manager data
const employees = await api.resources.employees.query({
  joins: ['managerId']
});
```

#### Polymorphic Relationships

```javascript
// Comment can belong to posts or videos
const commentSchema = new Schema({
  content: { type: 'string' },
  commentableType: { 
    type: 'string', 
    enum: ['posts', 'videos'] 
  },
  commentableId: { type: 'id' }
});

// Dynamic join based on type
api.hook('afterGet', async (context) => {
  if (context.options.type === 'comments' && context.result) {
    const { commentableType, commentableId } = context.result;
    
    if (commentableType && commentableId) {
      const parent = await api.resources[commentableType].get(commentableId);
      context.result.commentable = parent.data;
    }
  }
});
```

#### Circular Reference Prevention

```javascript
// Prevent infinite loops in circular relationships
const userSchema = new Schema({
  name: { type: 'string' },
  bestFriendId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        fields: ['id', 'name'],
        // Don't join the friend's best friend
        runHooks: false
      }
    }
  }
});
```

#### Conditional Joins

```javascript
// Join based on user permissions
api.hook('beforeQuery', async (context) => {
  if (context.options.type === 'posts') {
    const user = context.options.user;
    
    // Admins see author details
    if (user?.role === 'admin') {
      context.params.joins = context.params.joins || [];
      context.params.joins.push('authorId');
    }
    
    // Premium users see category details
    if (user?.isPremium) {
      context.params.joins = context.params.joins || [];
      context.params.joins.push('categoryId');
    }
  }
});
```

#### Aggregated Relationships

```javascript
// Include counts and summaries
api.hook('afterGet', async (context) => {
  if (context.options.type === 'users' && context.result) {
    // Add post count
    const posts = await api.resources.posts.query({
      filter: { authorId: context.result.id }
    });
    context.result.stats = {
      postCount: posts.meta.total,
      lastPostDate: posts.data[0]?.createdAt
    };
  }
});

// Or define virtual fields
const userSchema = new Schema({
  name: { type: 'string' },
  // Virtual relationship
  postCount: {
    type: 'virtual',
    async resolve(user) {
      const result = await api.resources.posts.query({
        filter: { authorId: user.id }
      });
      return result.meta.total;
    }
  }
});
```

### Best Practices

1. **Define refs for all foreign keys** - Enables consistency and features
2. **Use appropriate join modes** - Replace, resourceField, or preserveId
3. **Limit join depth** - Usually 2-3 levels maximum
4. **Select only needed fields** - Reduces data transfer and processing
5. **Consider eager vs lazy** - Eager for always-needed, lazy for sometimes
6. **Index foreign keys** - Critical for MySQL performance
7. **Handle missing relationships** - Joins might return null
8. **Test with real data** - Performance characteristics change with scale
9. **Monitor query complexity** - Deep joins can be expensive
10. **Document relationships** - Clear schema comments help teammates

## Hooks & Events

Hooks are the primary way to extend and customize JSON REST API behavior. They allow you to intercept operations, modify data, add validation, and implement complex business logic.

### Understanding Hooks

Hooks are functions that run at specific points in the API lifecycle:

```javascript
// Basic hook structure
api.hook('hookName', async (context) => {
  // Your logic here
  // Modify context to affect the operation
});

// Resource-specific hook
api.addResource('users', userSchema, {
  beforeInsert: async (context) => {
    // Only runs for users
  }
});
```

#### Key Concepts

1. **Hooks are async** - Always use async/await
2. **Modify context** - Changes affect the operation
3. **Return false to stop** - Prevents further hooks
4. **Throw to fail** - Stops operation with error

### The Context Object

The context object is passed to every hook and contains all operation data:

```javascript
{
  // Core properties
  api: Api,              // The API instance
  method: 'insert',      // Current operation
  options: {             // Operation options
    type: 'users',       // Resource type
    userId: '123',       // Custom options
    connection: 'main'   // DB connection
  },
  
  // Data properties (varies by operation)
  data: { },            // For insert/update
  id: '123',            // For get/update/delete
  params: { },          // For query
  result: { },          // Operation result
  results: [],          // For query
  
  // Metadata
  errors: [],           // Validation errors
  meta: { },            // Response metadata
  
  // Control flow
  skip: false,          // Skip operation
  
  // Custom properties
  user: { },            // Add your own
  startTime: Date.now()
}
```

### Lifecycle Hooks

#### Validation Hooks

```javascript
// Before validation runs
api.hook('beforeValidate', async (context) => {
  // Normalize data
  if (context.data.email) {
    context.data.email = context.data.email.toLowerCase().trim();
  }
});

// After validation runs
api.hook('afterValidate', async (context) => {
  // Add custom validation
  if (context.data.age < 18 && context.data.parentConsent !== true) {
    context.errors.push({
      field: 'parentConsent',
      message: 'Parent consent required for minors'
    });
  }
});
```

#### Insert Hooks

```javascript
// Before insert
api.hook('beforeInsert', async (context) => {
  // Set defaults
  context.data.status = context.data.status || 'draft';
  
  // Add metadata
  context.data.createdBy = context.options.userId;
  context.data.createdFrom = context.options.ipAddress;
});

// After insert
api.hook('afterInsert', async (context) => {
  // Send notifications
  if (context.options.type === 'posts') {
    await notifySubscribers(context.result);
  }
  
  // Update related data
  if (context.options.type === 'comments') {
    await api.resources.posts.update(context.data.postId, {
      commentCount: { $increment: 1 }
    });
  }
});
```

#### Update Hooks

```javascript
// Before update
api.hook('beforeUpdate', async (context) => {
  // Track changes
  const existing = await api.resources[context.options.type].get(context.id);
  context.previousData = existing.data;
  
  // Prevent certain changes
  if (context.data.email && existing.data.emailVerified) {
    throw new Error('Cannot change verified email');
  }
});

// After update  
api.hook('afterUpdate', async (context) => {
  // Log changes
  const changes = {};
  for (const [key, value] of Object.entries(context.data)) {
    if (context.previousData[key] !== value) {
      changes[key] = {
        from: context.previousData[key],
        to: value
      };
    }
  }
  
  if (Object.keys(changes).length > 0) {
    await api.resources.auditLogs.create({
      resource: context.options.type,
      resourceId: context.id,
      action: 'update',
      changes,
      userId: context.options.userId
    });
  }
});
```

#### Delete Hooks

```javascript
// Before delete
api.hook('beforeDelete', async (context) => {
  // Check dependencies
  if (context.options.type === 'users') {
    const posts = await api.resources.posts.query({
      filter: { authorId: context.id }
    });
    
    if (posts.meta.total > 0) {
      throw new Error('Cannot delete user with posts');
    }
  }
  
  // Soft delete instead
  if (context.options.softDelete) {
    await api.resources[context.options.type].update(context.id, {
      deletedAt: new Date(),
      deletedBy: context.options.userId
    });
    context.skip = true; // Skip actual deletion
  }
});

// After delete
api.hook('afterDelete', async (context) => {
  // Cascade deletes
  if (context.options.type === 'projects') {
    await api.resources.tasks.delete({
      filter: { projectId: context.id }
    });
  }
  
  // Clean up files
  if (context.deletedRecord?.avatarUrl) {
    await deleteFile(context.deletedRecord.avatarUrl);
  }
});
```

#### Query Hooks

```javascript
// Before query
api.hook('beforeQuery', async (context) => {
  // Add default filters
  if (context.options.type === 'posts') {
    context.params.filter = context.params.filter || {};
    
    // Only show published posts to non-admins
    if (!context.options.user?.isAdmin) {
      context.params.filter.published = true;
    }
    
    // Add tenant filtering
    if (context.options.tenantId) {
      context.params.filter.tenantId = context.options.tenantId;
    }
  }
  
  // Add default sorting
  if (!context.params.sort) {
    context.params.sort = '-createdAt';
  }
});

// After query
api.hook('afterQuery', async (context) => {
  // Enrich results
  if (context.results) {
    for (const item of context.results) {
      // Add computed fields
      if (context.options.type === 'users') {
        item.displayName = `${item.firstName} ${item.lastName}`;
        item.initials = `${item.firstName[0]}${item.lastName[0]}`;
      }
      
      // Add view tracking
      if (context.options.trackViews) {
        await api.resources.views.create({
          resourceType: context.options.type,
          resourceId: item.id,
          userId: context.options.userId
        });
      }
    }
  }
  
  // Add metadata
  context.meta.queryTime = Date.now() - context.startTime;
});
```

#### Get Hooks

```javascript
// Before get
api.hook('beforeGet', async (context) => {
  // Access control
  if (context.options.type === 'privateNotes') {
    const note = await api.resources.privateNotes.get(context.id);
    if (note.data.userId !== context.options.userId) {
      throw new ForbiddenError('Access denied');
    }
  }
});

// After get
api.hook('afterGet', async (context) => {
  if (!context.result) return;
  
  // Increment view count
  if (context.options.type === 'articles') {
    await api.resources.articles.update(context.id, {
      viewCount: { $increment: 1 }
    });
  }
  
  // Add user-specific data
  if (context.options.type === 'posts' && context.options.userId) {
    const like = await api.resources.likes.query({
      filter: {
        postId: context.id,
        userId: context.options.userId
      }
    });
    context.result.isLikedByUser = like.meta.total > 0;
  }
});
```

#### Transform Hooks

```javascript
// Transform results before sending
api.hook('transformResult', async (context) => {
  // Hide sensitive fields
  if (context.result && context.options.type === 'users') {
    delete context.result.password;
    delete context.result.resetToken;
    
    // Hide email for non-owners
    if (context.result.id !== context.options.userId) {
      context.result.email = '***@***.***';
    }
  }
  
  // Add URLs
  if (context.result && context.options.baseUrl) {
    context.result.url = `${context.options.baseUrl}/${context.options.type}/${context.result.id}`;
  }
});
```

#### HTTP-Specific Hooks

```javascript
// Before sending HTTP response
api.hook('beforeSend', async (context) => {
  // Add custom headers
  context.res.setHeader('X-Total-Count', context.meta.total || 0);
  context.res.setHeader('X-Response-Time', Date.now() - context.startTime);
  
  // Add rate limit headers
  if (context.rateLimit) {
    context.res.setHeader('X-RateLimit-Limit', context.rateLimit.limit);
    context.res.setHeader('X-RateLimit-Remaining', context.rateLimit.remaining);
  }
});
```

### Hook Priorities

Hooks run in priority order (lower numbers first):

```javascript
// Default priority is 50
api.hook('beforeInsert', handler1); // Priority 50

// Set custom priority
api.hook('beforeInsert', handler2, 10); // Runs first
api.hook('beforeInsert', handler3, 90); // Runs last

// Resource hooks have priority 10
api.addResource('users', schema, {
  beforeInsert: handler4 // Priority 10
});
```

Priority guidelines:
- **0-20**: Critical validation/security
- **30-40**: Data normalization
- **50**: Default (general logic)
- **60-70**: Enhancement/enrichment
- **80-100**: Logging/metrics

### Common Hook Patterns

#### Computed Fields

```javascript
// Define virtual fields in schema
const orderSchema = new Schema({
  items: { type: 'array' },
  paidAt: { type: 'timestamp' },
  shippedAt: { type: 'timestamp' },
  // Virtual fields (not stored in database)
  total: { type: 'number', virtual: true },
  status: { type: 'string', virtual: true }
});

// Add fields calculated from other fields
api.hook('afterGet', async (context) => {
  if (context.result && context.options.type === 'orders') {
    // Calculate total
    context.result.total = context.result.items.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );
    
    // Add status based on conditions
    if (context.result.paidAt && context.result.shippedAt) {
      context.result.status = 'completed';
    } else if (context.result.paidAt) {
      context.result.status = 'processing';
    } else {
      context.result.status = 'pending';
    }
  }
});
```

#### Cascading Operations

```javascript
// Update related data when something changes
api.hook('afterUpdate', async (context) => {
  // Update user stats when profile changes
  if (context.options.type === 'profiles') {
    await api.resources.users.update(context.data.userId, {
      profileCompleteness: calculateCompleteness(context.result)
    });
  }
  
  // Recalculate aggregates
  if (context.options.type === 'orderItems') {
    const order = await api.resources.orders.get(context.data.orderId);
    const items = await api.resources.orderItems.query({
      filter: { orderId: context.data.orderId }
    });
    
    const total = items.data.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );
    
    await api.resources.orders.update(context.data.orderId, { total });
  }
});
```

#### Multi-Tenant Filtering

```javascript
// Ensure users only see their tenant's data
api.hook('beforeQuery', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (!tenantId) return;
  
  // Add tenant filter
  context.params.filter = context.params.filter || {};
  context.params.filter.tenantId = tenantId;
});

api.hook('beforeGet', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (!tenantId) return;
  
  // Verify tenant access
  const record = await api.implementers.get('get')(context);
  if (record && record.tenantId !== tenantId) {
    throw new ForbiddenError('Access denied');
  }
});

// Add tenant ID to new records
api.hook('beforeInsert', async (context) => {
  const tenantId = context.options.user?.tenantId;
  if (tenantId) {
    context.data.tenantId = tenantId;
  }
});
```

#### Audit Logging

```javascript
// Comprehensive audit trail
const auditLog = async (action, context) => {
  const log = {
    action,
    resourceType: context.options.type,
    resourceId: context.id || context.result?.id,
    userId: context.options.userId,
    timestamp: new Date(),
    ip: context.options.ip,
    userAgent: context.options.userAgent
  };
  
  if (action === 'update') {
    log.changes = context.changes;
  }
  
  if (action === 'delete') {
    log.deletedData = context.deletedRecord;
  }
  
  await api.resources.auditLogs.create(log);
};

// Hook into all operations
['insert', 'update', 'delete'].forEach(method => {
  api.hook(`after${method.charAt(0).toUpperCase() + method.slice(1)}`, 
    async (context) => auditLog(method, context),
    95 // High priority to run last
  );
});
```

#### Validation Beyond Schema

```javascript
// Complex business rules
api.hook('afterValidate', async (context) => {
  if (context.options.type === 'appointments') {
    const { startTime, endTime, doctorId } = context.data;
    
    // Check business hours
    const startHour = new Date(startTime).getHours();
    if (startHour < 9 || startHour >= 17) {
      context.errors.push({
        field: 'startTime',
        message: 'Appointments must be between 9 AM and 5 PM'
      });
    }
    
    // Check for conflicts
    const conflicts = await api.resources.appointments.query({
      filter: {
        doctorId,
        $or: [
          { startTime: { $between: [startTime, endTime] } },
          { endTime: { $between: [startTime, endTime] } }
        ]
      }
    });
    
    if (conflicts.meta.total > 0) {
      context.errors.push({
        field: 'startTime',
        message: 'This time slot is already booked'
      });
    }
  }
});
```

#### Dynamic Permissions

```javascript
// Role-based field filtering
api.hook('transformResult', async (context) => {
  const userRole = context.options.user?.role;
  
  // Only apply filtering on read operations
  if (context.method !== 'get' && context.method !== 'query') {
    return;
  }
  
  if (!userRole || userRole !== 'admin') {
    // Hide sensitive fields from non-admins
    if (context.result && context.options.type === 'users') {
      delete context.result.ssn;
      delete context.result.salary;
      delete context.result.internalNotes;
    }
    
    // Hide draft posts
    if (context.results && context.options.type === 'posts') {
      context.results = context.results.filter(post => 
        post.status === 'published' || post.authorId === context.options.userId
      );
    }
  }
});
```

### Best Practices

#### 1. Keep Hooks Focused

```javascript
// ❌ Bad: Doing too much in one hook
api.hook('afterInsert', async (context) => {
  // Send email
  await sendEmail(...);
  
  // Update stats
  await updateStats(...);
  
  // Log to external service
  await logToService(...);
  
  // Generate thumbnail
  await generateThumbnail(...);
});

// ✅ Good: Separate concerns
api.hook('afterInsert', async (context) => {
  if (context.options.type === 'users') {
    await sendWelcomeEmail(context.result);
  }
}, 30);

api.hook('afterInsert', async (context) => {
  await updateResourceStats(context.options.type);
}, 40);

api.hook('afterInsert', async (context) => {
  if (context.result.imageUrl) {
    // Queue job instead of blocking
    await queueJob('generateThumbnail', {
      url: context.result.imageUrl,
      resourceId: context.result.id
    });
  }
}, 50);
```

#### 2. Handle Errors Gracefully

```javascript
// ❌ Bad: Letting errors break the operation
api.hook('afterInsert', async (context) => {
  await riskyOperation(); // Could throw
});

// ✅ Good: Handle non-critical errors
api.hook('afterInsert', async (context) => {
  try {
    await sendNotification(context.result);
  } catch (error) {
    // Log but don't fail the operation
    console.error('Notification failed:', error);
    
    // Optionally track the failure
    await api.resources.failedJobs.create({
      type: 'notification',
      error: error.message,
      payload: context.result
    });
  }
});
```

#### 3. Use Context for State

```javascript
// ❌ Bad: Using global variables
let previousValue;

api.hook('beforeUpdate', async (context) => {
  previousValue = await api.get(context.id);
});

// ✅ Good: Store in context
api.hook('beforeUpdate', async (context) => {
  context.previousValue = await api.get(context.id, context.options);
});

api.hook('afterUpdate', async (context) => {
  const changes = diff(context.previousValue, context.result);
  // ...
});
```

#### 4. Consider Performance

```javascript
// ❌ Bad: N+1 queries
api.hook('afterQuery', async (context) => {
  for (const item of context.results) {
    const author = await api.resources.users.get(item.authorId);
    item.authorName = author.data.name;
  }
});

// ✅ Good: Batch operations
api.hook('afterQuery', async (context) => {
  const authorIds = [...new Set(context.results.map(r => r.authorId))];
  const authors = await api.resources.users.query({
    filter: { id: { $in: authorIds } }
  });
  
  const authorMap = new Map(
    authors.data.map(a => [a.id, a.name])
  );
  
  context.results.forEach(item => {
    item.authorName = authorMap.get(item.authorId);
  });
});
```

#### 5. Document Hook Behavior

```javascript
/**
 * Generates SEO-friendly slugs for posts
 * - Runs before insert and update
 * - Only generates if title changes
 * - Ensures uniqueness by appending numbers
 */
api.hook('beforeInsert', generateSlug, 20);
api.hook('beforeUpdate', generateSlug, 20);

async function generateSlug(context) {
  // Implementation...
}
```

### Hook Reference

| Hook | When It Runs | Common Uses |
|------|--------------|-------------|
| beforeValidate | Before schema validation | Normalize data, set defaults |
| afterValidate | After schema validation | Custom validation rules |
| beforeInsert | Before creating record | Set metadata, generate values |
| afterInsert | After creating record | Send notifications, update related |
| beforeUpdate | Before updating record | Validate changes, track previous |
| afterUpdate | After updating record | Sync related data, audit logs |
| beforeDelete | Before deleting record | Check dependencies, soft delete |
| afterDelete | After deleting record | Cascade deletes, cleanup |
| beforeGet | Before fetching one | Access control, modify query |
| afterGet | After fetching one | Enrich data, track views |
| beforeQuery | Before fetching many | Add filters, modify params |
| afterQuery | After fetching many | Transform results, add metadata |
| transformResult | Before returning data | Hide fields, format output |
| beforeSend | Before HTTP response | Set headers, final transforms |

## Plugin System

### How Plugins Work

Plugins extend the API by:
- Adding hooks to intercept operations
- Implementing storage methods
- Adding new API methods
- Registering custom types and validators

```javascript
const MyPlugin = {
  name: 'MyPlugin',
  
  install(api, options) {
    // Add hooks
    api.hook('beforeInsert', async (context) => {
      // Your logic here
    });
    
    // Add methods
    api.myMethod = () => { /* ... */ };
    
    // Implement storage
    api.implement('get', async (context) => {
      // Custom get implementation
    });
  }
};

// Use it
api.use(MyPlugin, { /* options */ });
```

### Plugin Order Matters

Plugins must be added in the correct order:

```javascript
// ✅ CORRECT ORDER
api
  .use(ValidationPlugin)      // 1. Validation (usually automatic)
  .use(MySQLPlugin)          // 2. Storage (MUST be early)
  .use(TimestampsPlugin)     // 3. Features that modify data
  .use(VersioningPlugin)     // 4. Features that track changes
  .use(SecurityPlugin)       // 5. Security layers
  .use(LoggingPlugin)        // 6. Logging (see everything)
  .use(HTTPPlugin);          // 7. HTTP (MUST be last)

// ❌ WRONG - HTTP before storage
api
  .use(HTTPPlugin)           // ❌ No storage to handle requests!
  .use(MySQLPlugin);         // Too late!
```

Rule of thumb:
1. **Storage first** - Everything needs storage
2. **Data modifiers next** - Timestamps, versions, etc.
3. **Security/logging** - See all operations
4. **HTTP last** - Needs everything else ready

## Built-in Plugins

### Storage Plugins

#### MemoryPlugin

In-memory storage using AlaSQL, perfect for development and testing.

```javascript
import { MemoryPlugin } from 'json-rest-api';

api.use(MemoryPlugin, {
  // Optional: Pre-populate with data
  initialData: {
    users: [
      { id: 1, name: 'Admin', email: 'admin@example.com' }
    ]
  }
});
```

Features:
- Uses AlaSQL for full SQL support
- Fast performance
- No setup required
- Data lost on restart
- Supports all query operations including JOINs
- Automatic schema synchronization
- Compatible with searchable fields

#### MySQLPlugin

Production-ready MySQL storage with advanced features.

```javascript
import { MySQLPlugin } from 'json-rest-api';

api.use(MySQLPlugin, {
  // Single connection
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp'
  },
  
  // Or multiple connections
  connections: [
    {
      name: 'main',
      config: { /* ... */ }
    },
    {
      name: 'readonly',
      config: { /* ... */ }
    }
  ]
});

// Sync schemas to create/update tables
await api.syncSchema(userSchema, 'users');
```

Features:
- Connection pooling
- Automatic table creation/updates
- Transaction support
- Advanced querying with QueryBuilder
- Multiple connection support

### Feature Plugins

#### ValidationPlugin

Validates data against schemas. **Always included automatically!**

```javascript
// No need to add manually, but you can customize
api.use(ValidationPlugin, {
  // Custom error messages
  messages: {
    required: 'Field {{field}} is required',
    min: 'Field {{field}} must be at least {{min}}'
  }
});
```

#### TimestampsPlugin

Automatically manages created/updated timestamps.

```javascript
import { TimestampsPlugin } from 'json-rest-api';

api.use(TimestampsPlugin, {
  createdField: 'createdAt',  // Default
  updatedField: 'updatedAt',  // Default
  format: 'timestamp',  // 'timestamp' | 'date' | 'dateTime'
  touchOnGet: false  // Update timestamp on reads
});
```

#### HTTPPlugin

Adds REST endpoints to Express.

```javascript
import { HTTPPlugin } from 'json-rest-api';

api.use(HTTPPlugin, {
  basePath: '/api',
  
  // Per-resource options
  typeOptions: {
    users: {
      searchFields: ['name', 'email'],
      allowedMethods: ['GET', 'POST']  // Restrict methods
    }
  },
  
  // Global middleware
  middleware: [authenticate, authorize],
  
  // CORS configuration
  cors: {
    origin: 'https://app.example.com',
    credentials: true
  }
});
```

Endpoints created:
- `GET /api/{type}` - List with filtering, sorting, pagination
- `GET /api/{type}/{id}` - Get single resource
- `POST /api/{type}` - Create resource
- `PATCH /api/{type}/{id}` - Update resource
- `DELETE /api/{type}/{id}` - Delete resource

#### PositioningPlugin

Manage record order for drag-and-drop interfaces.

```javascript
import { PositioningPlugin } from 'json-rest-api';

api.use(PositioningPlugin, {
  field: 'position',  // Field name for position
  
  // Position within filtered subsets
  typeOptions: {
    tasks: {
      groupBy: ['projectId', 'status']  // Separate position per group
    }
  }
});

// Usage
await api.resources.tasks.create({
  title: 'New task',
  beforeId: '123'  // Place before task 123
});

// Reposition
await api.reposition('tasks', '456', '789'); // Move 456 before 789
await api.reposition('tasks', '456', null);  // Move to end
```

## Creating Custom Plugins

### Basic Plugin Structure

```javascript
const MyPlugin = {
  // Optional: Plugin name for debugging
  name: 'MyPlugin',
  
  // Required: Install function
  install(api, options = {}) {
    // Your plugin logic here
  },
  
  // Optional: Dependencies
  requires: ['OtherPlugin'],
  
  // Optional: Version
  version: '1.0.0'
};
```

### Example: Slug Plugin

Auto-generate URL-friendly slugs from titles:

```javascript
const SlugPlugin = {
  name: 'SlugPlugin',
  
  install(api, options = {}) {
    const {
      sourceField = 'title',
      targetField = 'slug',
      unique = true
    } = options;
    
    // Add hook to generate slug
    api.hook('beforeInsert', async (context) => {
      const data = context.data;
      
      // Skip if slug already provided
      if (data[targetField]) return;
      
      // Skip if no source field
      if (!data[sourceField]) return;
      
      // Generate slug
      let slug = data[sourceField]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Ensure uniqueness if required
      if (unique) {
        const existing = await api.query({
          filter: { [targetField]: slug }
        }, context.options);
        
        if (existing.results.length > 0) {
          slug = `${slug}-${Date.now()}`;
        }
      }
      
      data[targetField] = slug;
    });
  }
};

// Use it
api.use(SlugPlugin, {
  sourceField: 'name',
  targetField: 'username',
  unique: true
});
```

### Example: Cache Plugin

Add caching layer for read operations:

```javascript
const CachePlugin = {
  name: 'CachePlugin',
  
  install(api, options = {}) {
    const {
      ttl = 60 * 1000,  // 1 minute default
      storage = new Map()  // Simple in-memory cache
    } = options;
    
    // Cache key generator
    const getCacheKey = (method, type, id, params) => {
      return `${method}:${type}:${id || 'list'}:${JSON.stringify(params || {})}`;
    };
    
    // Intercept get operations
    const originalGet = api.implementers.get('get');
    api.implement('get', async (context) => {
      const key = getCacheKey('get', context.options.type, context.id);
      
      // Check cache
      const cached = storage.get(key);
      if (cached && cached.expires > Date.now()) {
        return cached.data;
      }
      
      // Get from storage
      const result = await originalGet(context);
      
      // Cache result
      storage.set(key, {
        data: result,
        expires: Date.now() + ttl
      });
      
      return result;
    });
    
    // Clear cache on mutations
    ['insert', 'update', 'delete'].forEach(method => {
      api.hook(`after${method.charAt(0).toUpperCase() + method.slice(1)}`, async (context) => {
        // Clear all cache for this type
        for (const [key] of storage) {
          if (key.includes(`:${context.options.type}:`)) {
            storage.delete(key);
          }
        }
      });
    });
  }
};
```

### Plugin Cookbook

#### Soft Delete Plugin

```javascript
const SoftDeletePlugin = {
  name: 'SoftDeletePlugin',
  
  install(api, options = {}) {
    const { field = 'deletedAt' } = options;
    
    // Override delete to soft delete
    api.hook('beforeDelete', async (context) => {
      // Update instead of delete
      const result = await api.update(
        context.id,
        { [field]: new Date().toISOString() },
        context.options
      );
      
      // Store result and skip actual delete
      context.result = result;
      context.skip = true;
    });
    
    // Filter out soft-deleted records
    api.hook('beforeQuery', async (context) => {
      context.params.filter = context.params.filter || {};
      
      // Only show non-deleted by default
      if (context.params.filter[field] === undefined) {
        context.params.filter[field] = null;
      }
    });
    
    // Add restore method
    api.restore = async (type, id) => {
      return api.update(id, { [field]: null }, { type });
    };
  }
};
```

#### Webhook Plugin

```javascript
const WebhookPlugin = {
  name: 'WebhookPlugin',
  
  install(api, options = {}) {
    const { endpoints = {} } = options;
    
    // Send webhooks after operations
    ['insert', 'update', 'delete'].forEach(operation => {
      api.hook(`after${operation.charAt(0).toUpperCase() + operation.slice(1)}`, async (context) => {
        const config = endpoints[context.options.type];
        if (!config) return;
        
        const events = config[operation] || config.all;
        if (!events) return;
        
        // Send webhooks in parallel
        await Promise.all(events.map(async (endpoint) => {
          try {
            await fetch(endpoint.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...endpoint.headers
              },
              body: JSON.stringify({
                event: `${context.options.type}.${operation}`,
                data: context.result,
                timestamp: new Date().toISOString()
              })
            });
          } catch (error) {
            console.error(`Webhook failed: ${endpoint.url}`, error);
          }
        }));
      });
    });
  }
};

// Use it
api.use(WebhookPlugin, {
  endpoints: {
    users: {
      insert: [
        { url: 'https://slack.com/webhook', headers: { 'X-Token': 'secret' } }
      ],
      all: [
        { url: 'https://analytics.example.com/events' }
      ]
    }
  }
});
```

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

## Organizing Resources

### Directory Structure

```
project/
├── server.js
├── api/
│   ├── 1.0.0/
│   │   ├── users.js      # Self-contained users resource
│   │   ├── products.js   # Self-contained products resource
│   │   └── orders.js     # Self-contained orders resource
│   └── 2.0.0/
│       ├── users.js      # Updated users resource
│       ├── products.js   # Updated products resource
│       └── orders.js     # Orders resource
└── config/
    └── database.js       # Database configuration
```

### Resource File Structure

Each resource file is self-contained and handles its own setup:

```javascript
// api/1.0.0/users.js
import { Api, Schema, MySQLPlugin, ValidationPlugin, HTTPPlugin } from 'json-rest-api';
import { dbConfig } from '../../config/database.js';

// Get or create the API instance for this version
const api = Api.get('myapp', '1.0.0') || new Api({ 
  name: 'myapp', 
  version: '1.0.0' 
});

// Ensure plugins are loaded (safe to call multiple times)
api
  .use(ValidationPlugin)
  .use(MySQLPlugin, {
    connections: [{
      name: 'main',
      config: dbConfig
    }]
  })
  .use(HTTPPlugin, {
    basePath: '/api/1.0.0'
  });

// Define schema
const userSchema = new Schema({
  id: { type: 'id' },
  username: { type: 'string', required: true, min: 3, max: 50 },
  email: { type: 'string', required: true, lowercase: true },
  password: { type: 'string', required: true, min: 8 },
  role: { type: 'string', default: 'user' },
  active: { type: 'boolean', default: true }
});

// Define hooks for this resource
const userHooks = {
  async afterValidate(context) {
    const { data, method, errors } = context;
    
    if (method === 'insert' || method === 'update') {
      // Check for duplicate email
      const existing = await context.api.resources.users.query({
        filter: { email: data.email }
      });
      
      if (existing.meta.total > 0 && existing.results[0].id !== data.id) {
        errors.push({
          field: 'email',
          message: 'Email already in use',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }
  },
  
  async transformResult(context) {
    const { result } = context;
    
    // Never return password field
    if (result && result.attributes) {
      delete result.attributes.password;
    }
  }
};

// Add the resource with schema and hooks
api.addResource('users', userSchema, userHooks);

// Export for server to mount
export default api;
```

### Minimal Server Setup

```javascript
// server.js
import express from 'express';

const app = express();

// Middleware
app.use(express.json());

// Load all resources - ONE LINE PER RESOURCE!
const apis = [
  await import('./api/1.0.0/users.js'),
  await import('./api/1.0.0/products.js'),
  await import('./api/1.0.0/orders.js'),
  await import('./api/2.0.0/users.js'),
  await import('./api/2.0.0/products.js'),
  await import('./api/2.0.0/orders.js'),
];

// Mount all APIs - that's it!
apis.forEach(module => module.default.mount(app));

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### Programmatic Access Between Resources

Resources that share an API instance can interact with each other:

```javascript
// api/1.0.0/orders.js
const orderHooks = {
  async afterInsert(context) {
    const { result } = context;
    const order = result.data;
    
    // Access other resources using the intuitive API
    const user = await api.resources.users.get(order.attributes.userId);
    const product = await api.resources.products.get(order.attributes.productId);
    
    // Send email notification
    await sendOrderConfirmation(user.data.attributes.email, {
      order,
      product: product.data.attributes
    });
  }
};
```

## Authentication & Security

### Adding Authentication Middleware

```javascript
// api/1.0.0/secure-resource.js
import { Schema } from 'json-rest-api';

const api = Api.get('myapp', '1.0.0');

// Add authentication middleware
api.useMiddleware((req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ 
      error: 'Authentication required' 
    });
  }
  next();
});

// Or use hooks for fine-grained control
api.hook('beforeOperation', async (context) => {
  if (context.options.type !== 'secrets') return;
  
  const { method, request } = context;
  
  if (!request.session?.userId) {
    throw Object.assign(new Error('Authentication required'), { 
      status: 401 
    });
  }
  
  if (method === 'delete' && request.session.role !== 'admin') {
    throw Object.assign(new Error('Admin access required'), { 
      status: 403 
    });
  }
});
```

### Security Best Practices

1. **Never expose sensitive fields**
   ```javascript
   password: { type: 'string', silent: true }
   ```

2. **Validate all input**
   ```javascript
   email: { type: 'string', match: /^[^@]+@[^@]+$/ }
   ```

3. **Use parameterized queries** (automatic with QueryBuilder)

4. **Add rate limiting**
   ```javascript
   api.use(RateLimitPlugin, {
     windowMs: 15 * 60 * 1000,
     max: 100
   });
   ```

5. **Enable CORS properly**
   ```javascript
   api.use(HTTPPlugin, {
     cors: {
       origin: 'https://yourdomain.com',
       credentials: true
     }
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
11. **Always paginate** - Never return unbounded results
12. **Select only needed fields** - Reduces bandwidth and processing
13. **Use appropriate operators** - `$in` for multiple values, not multiple ORs
14. **Index filtered fields** - Critical for performance
15. **Monitor slow queries** - Log queries over threshold
16. **Consider denormalization** - For complex read-heavy queries
17. **Cache frequently used queries** - Especially for public data
18. **Document complex queries** - Help future maintainers
19. **Mark fields as searchable** - Only searchable fields can be filtered
20. **Use searchableFields mappings** - For filtering by joined data

## API Reference

### Api Class

#### Constructor
```javascript
new Api(options?: ApiOptions)
```

Options:
- `idProperty`: string (default: 'id') - Name of the ID field
- `name`: string - API name for registry
- `version`: string - API version (semver)
- `artificialDelay`: number - Delay in ms for testing

#### Methods

##### `use(plugin, options?)`
Add a plugin to the API.

##### `addResource(type, schema, hooksOrOptions?)`
Register a resource type.

##### `hook(name, handler, priority?)`
Register a global hook.

##### `mount(app, basePath?)`
Mount the API on an Express app (requires HTTPPlugin).

### Schema Class

#### Constructor
```javascript
new Schema(structure: SchemaStructure)
```

#### Methods

##### `validate(data, options?)`
Validate data against the schema.

Options:
- `partial`: boolean - Allow partial data (for updates)
- `skipRequired`: boolean - Skip required field validation

### Resource Proxy Methods

All methods are accessed through `api.resources.{type}`:

##### `get(id, options?)`
Get a single resource by ID.

##### `query(params?, options?)`
Query multiple resources.

##### `create(data, options?)` / `post(data, options?)`
Create a new resource.

##### `update(id, data, options?)` / `put(id, data, options?)`
Update a resource.

##### `delete(id, options?)` / `remove(id, options?)`
Delete a resource.

### Common Options

All methods accept an options object:

| Option | Type | Description |
|--------|------|-------------|
| `joins` | boolean \| string[] | Control which joins to perform |
| `excludeJoins` | string[] | Exclude specific eager joins |
| `artificialDelay` | number | Override delay for this operation |
| `allowNotFound` | boolean | Don't throw if resource not found |
| `skipValidation` | boolean | Skip schema validation |
| `partial` | boolean | Allow partial data (update only) |
| `fullRecord` | boolean | Require complete record |

## Architecture & Design

### Plugin Architecture

The library uses a plugin-based architecture where all functionality is added through plugins:

```
┌─────────────────┐
│   Express App   │
└────────┬────────┘
         │ mount()
┌────────▼────────┐
│   HTTP Plugin   │ 
├─────────────────┤
│    API Core     │ ◄── Hooks, Resources, Registry
├─────────────────┤
│ Storage Plugin  │ ◄── MySQL, Memory, Custom
├─────────────────┤  
│ Feature Plugins │ ◄── Timestamps, Versioning, etc.
└─────────────────┘
```

**Why Plugins?**
- **Modularity**: Users only include what they need
- **Extensibility**: Easy to add new features without modifying core
- **Testability**: Plugins can be tested in isolation
- **Maintainability**: Clear separation of concerns

### Hook System

The hook system provides an event-based extensibility mechanism:

**Why Hooks?**
- **Decoupling**: Features don't directly modify core logic
- **Composition**: Multiple features can enhance same operation
- **Debugging**: Clear interception points
- **Priority control**: Deterministic execution order

All hooks are async-first and modify a context object:

```javascript
api.hook('beforeInsert', async (context) => {
  context.data.timestamp = Date.now();
});
```

### Schema Design

Schemas use a TypeScript-like syntax with runtime validation:

**Design Choices:**
- **Declarative Over Imperative**: Easier to serialize and analyze
- **Extensible Type System**: Users can add domain-specific types
- **Silent Fields**: Security by default for sensitive data
- **Searchable Fields**: Explicit control over what can be filtered

### Resource Proxy API

The proxy API uses JavaScript Proxy for dynamic property access:

```javascript
api.resources.users.get('123'); // Instead of api.get('123', { type: 'users' })
```

**Why Proxy?**
- **Developer experience**: Natural, intuitive syntax
- **Type inference**: Better IDE support
- **Consistency**: Same pattern for all operations
- **Discoverability**: Resources visible in autocomplete

### Error Handling

Structured error classes provide rich context:

```javascript
throw new NotFoundError('users', '123')
  .withContext({ searchParams: params });
```

**Benefits:**
- **Debugging**: Errors carry context about what went wrong
- **Type safety**: Can use instanceof checks
- **Standards**: JSON:API compliant error format
- **i18n ready**: Error codes enable translation

### Query Building

The QueryBuilder provides a safe, flexible way to build SQL:

```javascript
const query = new QueryBuilder('users')
  .where('active = ?', true)
  .orderBy('createdAt', 'DESC')
  .limit(10);
```

**Features:**
- **Safety**: Parameterized queries prevent injection
- **Flexibility**: Compose complex queries programmatically
- **Schema integration**: Automatic joins from refs
- **Readability**: Cleaner than string concatenation

### JSON:API Compliance

HTTP responses follow the JSON:API specification:

```json
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": { /* ... */ },
    "relationships": { /* ... */ }
  },
  "included": [ /* ... */ ],
  "meta": { /* ... */ }
}
```

**Benefits:**
- **Standards**: Well-established REST API standard
- **Tooling**: Existing client libraries
- **Features**: Relationships, includes, meta, errors
- **Consistency**: Predictable response format

## HTTP Plugin Details

The HTTP plugin transforms the core API functionality into RESTful HTTP endpoints that strictly follow the JSON:API specification.

### Routes Created

- `GET /api/{type}` - List resources with filtering, sorting, pagination
- `GET /api/{type}/{id}` - Get single resource
- `POST /api/{type}` - Create new resource
- `PATCH /api/{type}/{id}` - Update resource
- `DELETE /api/{type}/{id}` - Delete resource
- `OPTIONS /api/{type}` - CORS preflight

### Query Parameters

The plugin supports JSON:API query parameters:

```
GET /api/posts?
  filter[published]=true&
  filter[authorId]=123&
  sort=-createdAt,title&
  page[size]=10&
  page[number]=2&
  fields[posts]=title,summary&
  include=author,category
```

### Request/Response Format

#### Create Request (POST)
```json
{
  "data": {
    "type": "posts",
    "attributes": {
      "title": "Hello World",
      "content": "..."
    }
  }
}
```

#### Update Request (PATCH)
```json
{
  "data": {
    "type": "posts",
    "id": "123",
    "attributes": {
      "title": "Updated Title"
    }
  }
}
```

#### Response Format
```json
{
  "data": {
    "type": "posts",
    "id": "123",
    "attributes": {
      "title": "Hello World",
      "content": "...",
      "createdAt": 1234567890
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "456" }
      }
    }
  },
  "included": [{
    "type": "users",
    "id": "456",
    "attributes": {
      "name": "John Doe"
    }
  }]
}
```

### Error Responses

All errors return JSON:API compliant error objects:

```json
{
  "errors": [{
    "status": "400",
    "title": "VALIDATION_ERROR",
    "detail": "Email is required",
    "source": {
      "pointer": "/data/attributes/email"
    }
  }]
}
```

### Status Codes

- **200 OK**: Successful GET requests
- **201 Created**: Successful POST with new resource
- **204 No Content**: Successful DELETE
- **400 Bad Request**: Validation errors, malformed requests
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Unexpected errors

## Testing

The JSON REST API library has a comprehensive test suite organized into multiple files, each focusing on different aspects of the system.

### Test Suite Overview

#### 1. Main Test Suite (`tests/test-suite.js`)
- **Plugin Used**: MemoryPlugin
- **Coverage**: Core API functionality, basic CRUD operations, validation, timestamps, hooks, error handling
- **Tests**: 71 tests
- **Command**: `npm test`

#### 2. MySQL Test Suite (`tests/test-suite-mysql.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: MySQL-specific features like schema synchronization, foreign keys, indexes
- **Tests**: 6 tests
- **Command**: `npm run test:mysql`
- **Requirements**: MySQL credentials via environment variables

#### 3. MySQL Comprehensive Tests (`tests/test-mysql-comprehensive.js`)
- **Plugin Used**: MySQLPlugin
- **Coverage**: Complete MySQL integration including refs, joins, JSON fields, timestamps
- **Tests**: 34 tests
- **Command**: `npm run test:mysql:comprehensive`
- **Requirements**: MySQL credentials via environment variables

#### 4. Edge Cases Tests (`tests/test-edge-cases.js`)
- **Plugins Used**: 
  - MemoryPlugin (for general edge cases)
  - MySQLPlugin (for MySQL-specific edge cases when credentials provided)
- **Coverage**: Null handling, special characters, concurrent operations, large datasets
- **Tests**: 17 tests (13 MemoryPlugin + 4 MySQLPlugin)
- **Command**: `node tests/test-edge-cases.js`

#### 5. Plugin Tests (`tests/test-plugins.js`)
- **Plugins Used**: 
  - MemoryPlugin (as base storage)
  - PositioningPlugin, VersioningPlugin (feature plugins being tested)
  - MySQLPlugin (for MySQL-specific plugin tests when credentials provided)
- **Coverage**: Plugin-specific functionality, plugin interactions
- **Tests**: 19 tests
- **Command**: `node tests/test-plugins.js`

#### 6. Advanced Query Tests (`tests/test-advanced-queries.js`)
- **Plugins Used**:
  - MemoryPlugin (for basic operator tests)
  - MySQLPlugin (for MySQL-specific features when credentials provided)
- **Coverage**: Advanced query operators (LIKE, BETWEEN, IN, EXISTS), aggregations, performance
- **Tests**: 22 tests (many fail due to unimplemented features)
- **Command**: `node tests/test-advanced-queries.js`

### Plugin Usage by Test Type

| Test Suite | Primary Plugin | Additional Plugins | Notes |
|------------|----------------|-------------------|-------|
| test-suite.js | MemoryPlugin | ValidationPlugin, TimestampsPlugin | Core functionality testing |
| test-suite-mysql.js | MySQLPlugin | ValidationPlugin | MySQL-specific features |
| test-mysql-comprehensive.js | MySQLPlugin | ValidationPlugin, TimestampsPlugin | Full MySQL integration |
| test-edge-cases.js | MemoryPlugin | MySQLPlugin (conditional) | Mixed based on test type |
| test-plugins.js | MemoryPlugin | Various feature plugins | Plugin functionality testing |
| test-advanced-queries.js | MemoryPlugin | MySQLPlugin (conditional) | Advanced query features |

### Running Tests

#### Quick Start: Run Core Tests
```bash
npm test
```
This runs only `test-suite.js` with MemoryPlugin - the fastest way to verify core functionality.

#### Run All MySQL Tests
```bash
# Set MySQL credentials
export MYSQL_USER=root
export MYSQL_PASSWORD=your_password

# Run MySQL-specific tests
npm run test:mysql
npm run test:mysql:comprehensive
```

#### Run ALL Tests
To run the complete test suite including all edge cases, plugins, and advanced queries:

```bash
# Without MySQL (MemoryPlugin tests only)
npm run test:all

# With MySQL (includes all MySQL tests)
MYSQL_USER=root MYSQL_PASSWORD=your_password npm run test:all
```

The `test:all` script runs:
1. Main test suite (test-suite.js)
2. MySQL test suite (test-suite-mysql.js) - if credentials provided
3. MySQL comprehensive tests - if credentials provided
4. Edge cases tests
5. Plugin tests
6. Advanced query tests

#### Run Individual Test Files
```bash
# Run specific test file
node tests/test-edge-cases.js

# Run with MySQL support
MYSQL_USER=root MYSQL_PASSWORD=your_password node tests/test-plugins.js
```

### Test Execution Flow

When you run `npm test`:

1. **Script Execution**: npm runs the script defined in package.json: `"test": "node tests/test-suite.js"`

2. **Test Initialization**: 
   - The test file imports required modules
   - Creates an Api instance
   - Registers MemoryPlugin as the storage backend

3. **Test Execution**:
   - Each `describe` block groups related tests
   - `before/after` hooks set up and tear down test data
   - Individual tests (`it` blocks) verify specific functionality

4. **Results**: 
   - TAP (Test Anything Protocol) format output
   - Summary shows total tests, passed, failed, and duration

### Understanding Test Results

#### Successful Test Output
```
✨ All tests completed!
# tests 71
# pass 71
# fail 0
```

#### Failed Test Output
```
not ok 1 - should support LIKE operator
  ---
  error: 'Expected values to be strictly equal'
  expected: 1
  actual: 0
  ...
```

### Test Categories

#### 1. **Implemented Features** (100% pass rate)
- Basic CRUD operations
- Schema validation
- Relationships and joins
- Hooks and middleware
- Error handling
- MySQL schema synchronization

#### 2. **Unimplemented Features** (expected failures)
- Advanced query operators in MemoryPlugin (LIKE, BETWEEN, IN)
- Some MySQL-specific features (JSON operations, subqueries)
- Complex aggregations

#### 3. **Plugin-Specific Tests**
- PositioningPlugin: Record ordering, beforeId functionality
- VersioningPlugin: Version tracking, history
- TimestampsPlugin: Automatic timestamp management

### MySQL Test Database Management

MySQL tests automatically:
1. Create test databases if they don't exist
2. Synchronize schemas before running tests
3. Clean up connections using `robustTeardown`

Test databases used:
- `jsonrestapi_test` - Main MySQL tests
- `jsonrestapi_test_comprehensive` - Comprehensive tests
- `jsonrestapi_test_edge_cases` - Edge case tests
- `jsonrestapi_test_plugins` - Plugin tests
- `jsonrestapi_test_advanced` - Advanced query tests

### Debugging Tests

#### Run Tests with Verbose Output
```bash
DEBUG=* npm test
```

#### Run Specific Test Groups
Use test runners that support filtering:
```bash
# Install a test runner with filtering
npm install -g mocha

# Run only tests matching a pattern
mocha tests/test-suite.js --grep "validation"
```

#### Common Issues

1. **MySQL Connection Errors**
   - Ensure MySQL is running
   - Check credentials in environment variables
   - Verify user has CREATE DATABASE permissions

2. **Timeout Errors**
   - Tests use `robustTeardown` to clean up connections
   - Increase timeout if needed for slow systems

3. **Memory Plugin Limitations**
   - No support for advanced operators
   - No persistence between test runs
   - Array/object fields stored by reference

### Contributing Tests

When adding new features:
1. Add tests to the appropriate test file
2. Use MemoryPlugin for basic functionality tests
3. Add MySQL tests if the feature has database-specific behavior
4. Follow existing test patterns and naming conventions
5. Ensure all tests pass before submitting

### Test Performance

Typical execution times:
- Main test suite: ~150ms
- MySQL comprehensive: ~2-3s
- All tests (without MySQL): ~2s
- All tests (with MySQL): ~10-15s

The MemoryPlugin tests are fastest as they run entirely in memory, while MySQL tests require database operations.

## Contributing

Thank you for your interest in contributing! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/json-rest-api.git
cd json-rest-api

# Install dependencies
npm install

# Run tests
npm test

# Run MySQL tests (requires MySQL)
npm run test:mysql
```

### Code Style

1. **No comments** unless specifically requested
2. **Consistency** is paramount
3. **Clarity** over cleverness
4. **Async/await** over callbacks
5. **Early returns** over nested ifs

### Creating Plugins

Basic plugin structure:

```javascript
export const MyPlugin = {
  name: 'MyPlugin',
  version: '1.0.0',
  requires: ['OtherPlugin'],
  
  install(api, options = {}) {
    // Add hooks
    api.hook('beforeInsert', this.beforeInsert.bind(this));
    
    // Add methods
    api.myMethod = this.myMethod.bind(this);
    
    // Implement storage methods
    api.implement('get', this.get.bind(this));
  },
  
  async beforeInsert(context) {
    // Your logic
  }
};
```

### Testing

Write tests using Node.js test runner:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';

test('My Feature', async (t) => {
  await t.test('should do something', async () => {
    const api = createApi({ storage: 'memory' });
    // Test your feature
    assert.strictEqual(result, expected);
  });
});
```

### Submission Process

1. Fork and create a feature branch
2. Make your changes with tests
3. Update documentation if needed
4. Submit a pull request

## Troubleshooting

### "No storage plugin installed"
You forgot to add a storage plugin. Add MemoryPlugin or MySQLPlugin.

### "Resource 'users' not found"
You're trying to use a resource before calling `addResource()`.

### Validation errors
Check your schema definition. The error will tell you which field failed.

### Relationships not joining
Make sure you have `refs` defined and include the field in your query.

### Query returns no results
- Check filter syntax
- Verify data exists matching criteria
- Test with fewer filters
- Ensure fields are marked as `searchable: true`

### Query is slow
- Add indexes on filtered/sorted fields
- Reduce number of joins
- Limit selected fields
- Consider caching

### Process hangs after tests
Use `robustTeardown` from test-teardown.js to properly close connections.

## Get Help

- 📖 Check this guide
- 🏗️ Browse [examples](../examples/)
- 💬 Ask questions on GitHub

Ready to build something amazing? Let's go! 🚀