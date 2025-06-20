# Examples

This section provides working examples demonstrating various features of the JSON REST API library. All examples follow best practices and are ready to run.

## Table of Contents

1. [Basic Example - Getting Started](#basic-example---getting-started)
2. [API Versioning Example](#api-versioning-example)
3. [Advanced Queries Example](#advanced-queries-example)
4. [Advanced References Demo](#advanced-references-demo)
5. [Silent Fields Example](#silent-fields-example)
6. [Smart Joins Example](#smart-joins-example)
7. [Query Builder Example](#query-builder-example)
8. [No SQL Strings Example](#no-sql-strings-example)

## Basic Example - Getting Started

**File**: [`example.js`](./examples/example.js)

This example demonstrates:
- Creating APIs with both memory and MySQL storage
- Using the resource proxy API (best practice)
- Setting up schemas with validation
- Using plugins (Positioning, Versioning)
- Custom hooks for business logic
- Batch operations
- Express integration

### Key Concepts Shown

```javascript
// Best practice: Use createApi for simple setup
const api = createApi({
  storage: 'memory',  // or 'mysql'
  name: 'myapp',
  version: '1.0.0'
});

// Best practice: Use resource proxy API
const user = await api.resources.users.create({
  name: 'John Doe',
  email: 'john@example.com'
});

// Best practice: Define searchable fields in schema
const schema = new Schema({
  name: { type: 'string', searchable: true },
  email: { type: 'string', searchable: true }
});
```

## API Versioning Example

**File**: [`example-versioning.js`](./examples/example-versioning.js)

This example demonstrates:
- Creating multiple versions of the same API
- Automatic version resolution
- Registry API usage
- Version negotiation in Express
- Cross-API communication

### Key Concepts Shown

```javascript
// Create versioned APIs
const apiV1 = createApi({
  name: 'users',
  version: '1.0.0',
  storage: 'memory'
});

// Find APIs by version
const api = Api.find('users', 'latest');
const api2 = Api.find('users', '>=2.0.0');

// Automatic version routing
apiV1.mount(app);  // Available at /api/1.0.0/users
apiV2.mount(app);  // Available at /api/2.0.0/users
```

## Advanced Queries Example

**File**: [`advanced-queries.js`](./examples/advanced-queries.js)

This example demonstrates:
- Complex filtering with operators ($gt, $in, $between, etc.)
- Nested filters with $and/$or
- Sorting and pagination
- Field selection
- Joins with related data
- Aggregation queries

### Key Concepts Shown

```javascript
// Complex query with multiple operators
const results = await api.resources.posts.query({
  filter: {
    published: true,
    likes: { $gte: 100 },
    tags: { $in: ['javascript', 'nodejs'] },
    createdAt: { $between: ['2024-01-01', '2024-12-31'] }
  },
  sort: ['-likes', 'title'],
  page: { size: 20, number: 1 },
  joins: ['authorId', 'categoryId']
});
```

## Advanced References Demo

**File**: [`advanced-refs-demo.js`](./examples/advanced-refs-demo.js)

This example demonstrates:
- Setting up complex relationships
- Automatic joins with field selection
- Nested joins (multi-level)
- Different join configurations
- Performance considerations

### Key Concepts Shown

```javascript
// Define relationships with automatic joins
const postSchema = new Schema({
  authorId: {
    type: 'id',
    refs: {
      resource: 'users',
      join: {
        eager: true,
        fields: ['name', 'avatar'],
        resourceField: 'author'
      }
    }
  }
});

// Query with nested joins
const posts = await api.resources.posts.query({
  joins: ['authorId.departmentId.companyId']
});
```

## Silent Fields Example

**File**: [`silent-fields.js`](./examples/silent-fields.js)

This example demonstrates:
- Using silent fields for sensitive data
- Password handling best practices
- Conditional field visibility
- Transform hooks for security

### Key Concepts Shown

```javascript
// Define silent fields that are excluded from queries
const userSchema = new Schema({
  email: { type: 'string' },
  password: { type: 'string', silent: true },
  apiKey: { type: 'string', silent: true }
});

// Silent fields are never returned in queries
const users = await api.resources.users.query();
// password and apiKey are NOT in the results
```

## Smart Joins Example

**File**: [`smart-joins.js`](./examples/smart-joins.js) / [`simple-smart-joins.js`](./examples/simple-smart-joins.js)

This example demonstrates:
- Automatic join detection from schema refs
- Join optimization
- Selective field inclusion
- Performance best practices

### Key Concepts Shown

```javascript
// Automatic joins based on refs
const orders = await api.resources.orders.query({
  joins: ['customerId', 'productId']  // Automatically uses refs config
});

// Optimized field selection
const posts = await api.resources.posts.query({
  joins: ['authorId'],
  fields: {
    posts: ['title', 'summary'],
    users: ['name', 'avatar']  // Only needed fields
  }
});
```

## Query Builder Example

**File**: [`query-builder-json-api.js`](./examples/query-builder-json-api.js)

This example demonstrates:
- Direct QueryBuilder usage for complex queries
- Raw SQL generation with safety
- Custom joins and aggregations
- Integration with JSON:API format

### Key Concepts Shown

```javascript
import { QueryBuilder } from 'json-rest-api';

const query = new QueryBuilder('posts')
  .select('posts.*', 'COUNT(comments.id) as commentCount')
  .leftJoin('comments', 'comments.postId = posts.id')
  .where('posts.published = ?', true)
  .groupBy('posts.id')
  .having('COUNT(comments.id) > ?', 5)
  .orderBy('commentCount', 'DESC')
  .limit(10);

const sql = query.toSQL();
const results = await connection.query(sql, query.getArgs());
```

## No SQL Strings Example

**File**: [`no-sql-strings.js`](./examples/no-sql-strings.js)

This example demonstrates:
- Type-safe query building
- No manual SQL string concatenation
- Automatic parameterization
- Protection against SQL injection

### Key Concepts Shown

```javascript
// Never write SQL strings manually
// ❌ Bad: 
// const sql = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ Good: Use QueryBuilder or resource methods
const users = await api.resources.users.query({
  filter: { email: userInput }  // Automatically parameterized
});

// ✅ Good: QueryBuilder for complex queries
const query = new QueryBuilder('users')
  .where('email = ?', userInput)  // Safe parameterization
  .toSQL();
```

## Virtual Search Fields Example

**File**: [`virtual-search-fields.js`](./examples/virtual-search-fields.js)

This example demonstrates:
- Creating virtual searchable fields that don't map to database columns
- Multi-field search across multiple columns
- Advanced search syntax (Gmail-style: `in:inbox`, `from:user`)
- Custom search handlers for specialized logic
- Barcode/SKU exact matching
- Complex search patterns with operators

### Key Concepts Shown

```javascript
// Define virtual search fields with '*'
api.addResource('messages', messageSchema, {
  searchableFields: {
    from: 'from',        // Regular field
    folder: 'folder',    // Regular field
    search: '*',         // Virtual: multi-field search
    smart: '*'           // Virtual: advanced syntax
  }
});

// Handle virtual fields in hooks
api.hook('modifyQuery', async (context) => {
  if (context.params.filter?.search) {
    const value = context.params.filter.search;
    
    // Multi-field search with safe parameterization
    context.query.where(
      '(messages.subject LIKE ? OR messages.body LIKE ?)',
      `%${value}%`, `%${value}%`
    );
    
    delete context.params.filter.search;
  }
});

// Usage examples:
await api.resources.messages.query({
  filter: { search: 'meeting' }  // Searches multiple fields
});

await api.resources.messages.query({
  filter: { smart: 'in:inbox urgent' }  // Advanced syntax
});
```

## Running the Examples

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **For MySQL examples**, set up your database:
   ```bash
   export MYSQL_USER=root
   export MYSQL_PASSWORD=your_password
   export MYSQL_DATABASE=jsonrestapi_examples
   ```

3. **Run an example**:
   ```bash
   node docs/examples/example.js
   node docs/examples/example-versioning.js
   ```

## Best Practices Demonstrated

All examples follow these best practices:

1. **Use the resource proxy API** - `api.resources.users.get()` instead of `api.get(id, {type: 'users'})`
2. **Mark fields as searchable** - Only searchable fields can be filtered
3. **Use proper plugin order** - Storage → Features → HTTP
4. **Handle errors gracefully** - Try/catch blocks where appropriate
5. **Use batch operations** - For multiple inserts/updates
6. **Select only needed fields** - For better performance
7. **Use parameterized queries** - Never concatenate SQL strings
8. **Define relationships properly** - Use refs for foreign keys

---

**← Previous**: [Production, Deployment & Testing](./GUIDE_5_Production_and_Deployment.md)