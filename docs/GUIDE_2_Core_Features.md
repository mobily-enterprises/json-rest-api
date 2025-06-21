# Core Features

This section covers the essential features of JSON REST API: schemas, resources, CRUD operations, querying, relationships, and hooks.

## Table of Contents

1. [Schemas & Validation](#schemas--validation)
2. [Resources & CRUD Operations](#resources--crud-operations)
3. [Querying & Filtering](#querying--filtering)
4. [Views & Response Shaping](#views--response-shaping)
5. [Relationships & Joins](#relationships--joins)
6. [Hooks & Events](#hooks--events)
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

// Advanced query (without ViewsPlugin)
const results = await api.resources.posts.query({
  filter: { 
    published: true,
    authorId: '123',
    tags: 'javascript'  // Searches array field
  },
  sort: '-createdAt,title',  // Sort by createdAt DESC, then title ASC
  page: { size: 20, number: 1 }
});

// With ViewsPlugin - cleaner approach using named views
const results = await api.resources.posts.query({
  filter: { published: true },
  view: 'detailed'  // Predefined view with joins and field selection
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
    category: 'categoryId.title',  // Filter by category title
    search: '*'                   // Virtual field - requires handler
  }
});

// Now you can filter by author name:
await api.resources.posts.query({
  filter: { author: 'John Doe' }
});
// This translates to a JOIN and filters by users.name

// Virtual search fields (marked with '*') require a custom handler:
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search && context.options.type === 'posts') {
    const value = context.params.filter.search;
    
    // Multi-field search
    context.query.where(
      '(posts.title LIKE ? OR posts.content LIKE ? OR posts.tags LIKE ?)',
      `%${value}%`, `%${value}%`, `%${value}%`
    );
    
    delete context.params.filter.search; // Remove to prevent column lookup
  }
});

// Now you can do powerful searches:
await api.resources.posts.query({
  filter: { search: 'javascript' } // Searches title, content, and tags
});
```

### Filter Operators

The API supports multiple operators for advanced filtering:

```javascript
// Basic equality (default when no operator specified)
filter: { active: true }
filter: { status: 'published' }

// Comparison operators
filter: {
  age: { gt: 18 },           // Greater than
  age: { gte: 18 },          // Greater than or equal
  price: { lt: 100 },        // Less than
  price: { lte: 100 },       // Less than or equal
  status: { ne: 'deleted' }  // Not equal
}

// Multiple conditions on same field
filter: {
  age: { gte: 18, lt: 65 }   // Age between 18 and 64
}

// Set operators
filter: {
  status: { in: ['active', 'pending'] },      // In array
  category: { nin: ['spam', 'trash'] }        // Not in array
}

// String matching operators
filter: {
  email: { endsWith: '@example.com' },        // Ends with
  name: { startsWith: 'John' },               // Starts with
  description: { contains: 'javascript' },     // Contains
  title: { like: 'App%Dev%' }                 // SQL LIKE pattern
}

// Case-insensitive search (database dependent)
filter: {
  name: { ilike: 'john%' }   // Case-insensitive LIKE
}
```

#### Query String Format

When using HTTP endpoints, operators use bracket notation:

```bash
# Basic equality
GET /api/posts?filter[status]=published

# Comparison operators
GET /api/posts?filter[views][gt]=100
GET /api/posts?filter[price][lte]=50

# Multiple operators on same field
GET /api/posts?filter[age][gte]=18&filter[age][lt]=65

# Set operators (comma-separated)
GET /api/posts?filter[status][in]=active,pending
GET /api/posts?filter[category][nin]=spam,trash

# String operators
GET /api/posts?filter[email][endsWith]=@example.com
GET /api/posts?filter[name][startsWith]=John
GET /api/posts?filter[title][contains]=javascript
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

## Views & Response Shaping

The ViewsPlugin provides a clean way to control what data is returned from your API without exposing technical details in URLs.

### Why Views?

Instead of allowing clients to control joins and fields directly (which exposes your database structure), views provide predefined data shapes:

```javascript
// Without views - exposes implementation
GET /api/posts?joins=authorId,categoryId&fields=id,title,excerpt

// With views - clean and secure
GET /api/posts?view=card
```

### Setting Up Views

```javascript
import { ViewsPlugin } from 'json-rest-api';

api.use(ViewsPlugin);

api.addResource('posts', postSchema, {
  // Optional: Override smart defaults
  defaults: {
    query: {
      joins: ['authorId'],    // Always include author in lists
      pageSize: 10
    },
    get: {
      joins: ['authorId', 'categoryId']  // Include these for single posts
    }
  },
  
  // Optional: Named views
  views: {
    // Minimal data for mobile/lists
    card: {
      query: {
        joins: ['authorId'],
        fields: ['id', 'title', 'excerpt', 'thumbnail', 'authorId']
      }
    },
    
    // Full data for detail pages
    full: {
      get: {
        joins: true,  // All relationships
        fields: null  // All fields
      }
    },
    
    // Admin view with extra data
    admin: {
      query: {
        joins: ['authorId', 'editorId'],
        includeFields: ['updatedAt', 'status']
      },
      get: {
        joins: true,
        includeFields: ['internalNotes', 'auditLog']
      }
    }
  },
  
  // Optional: Restrict view access
  viewPermissions: {
    admin: 'admin'  // Requires admin role
  }
});
```

### Using Views

```javascript
// List posts - uses smart defaults (no joins)
const posts = await api.resources.posts.query();

// List with specific view
const cards = await api.resources.posts.query({ view: 'card' });

// Get single post - uses smart defaults (all joins)
const post = await api.resources.posts.get(123);

// Get with minimal view
const minimal = await api.resources.posts.get(123, { view: 'minimal' });

// Admin view (requires permission)
const adminData = await api.resources.posts.query(
  { view: 'admin' },
  { user: { roles: ['admin'] } }
);
```

### Smart Defaults

Without any configuration, ViewsPlugin provides sensible defaults:

- **Queries (lists)**: No joins, reasonable page size
- **Get (single)**: All defined relationships included

This means most APIs work great with zero configuration!

### Views vs Direct Control

The ViewsPlugin is recommended over direct join/field control because:

1. **Security**: Doesn't expose database structure
2. **Performance**: Backend controls what's efficient
3. **Consistency**: Predefined shapes ensure consistent responses
4. **Versioning**: Easy to evolve views without breaking clients
5. **Documentation**: Named views are self-documenting

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

### Referential Integrity

When using the ValidationPlugin, foreign key references are automatically validated to ensure data integrity:

```javascript
// This will fail with 422 if user with ID 999 doesn't exist
await api.resources.posts.create({
  title: 'My Post',
  authorId: 999  // Non-existent user
});

// Error response:
{
  "errors": [{
    "status": "422",
    "code": "INVALID_REFERENCE",
    "title": "Validation Error",
    "detail": "Referenced users with id 999 does not exist",
    "source": { "pointer": "/data/attributes/authorId" },
    "meta": { "field": "authorId" }
  }]
}
```

This validation happens automatically for all fields with `refs` configuration when:
- Creating new records (INSERT)
- Updating existing records (UPDATE)
- The referenced ID is not null

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

// With ViewsPlugin - use predefined views
const posts = await api.resources.posts.query({
  view: 'withAuthor'  // Use a named view
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


---

**← Previous**: [Getting Started](./GUIDE_1_Getting_Started.md) | **Next**: [Plugins & Architecture →](./GUIDE_3_Plugins_and_Architecture.md)
