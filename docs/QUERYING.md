# Querying & Filtering Guide

Master the powerful query capabilities of JSON REST API. From simple filters to complex aggregations, this guide covers everything you need to retrieve data efficiently.

## Table of Contents

1. [Query Basics](#query-basics)
2. [Filtering](#filtering)
3. [Sorting](#sorting)
4. [Pagination](#pagination)
5. [Field Selection](#field-selection)
6. [Advanced Operators](#advanced-operators)
7. [Full-Text Search](#full-text-search)
8. [Query Optimization](#query-optimization)

## Query Basics

The query method accepts parameters for filtering, sorting, pagination, and more:

```javascript
const results = await api.resources.posts.query({
  filter: { published: true },
  sort: '-createdAt',
  page: { size: 10, number: 1 },
  fields: ['title', 'summary'],
  joins: ['authorId']
});

// Results structure
{
  data: [...],      // Array of resources
  meta: {
    total: 45,      // Total matching records
    pageSize: 10,   // Items per page
    pageNumber: 1,  // Current page
    totalPages: 5   // Total pages
  }
}
```

### HTTP Query Parameters

When using HTTPPlugin, queries use URL parameters:

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

## Filtering

### Basic Filters

Simple equality filters:

```javascript
// Single filter
await api.resources.users.query({
  filter: { active: true }
});

// Multiple filters (AND)
await api.resources.posts.query({
  filter: {
    published: true,
    authorId: '123',
    category: 'tech'
  }
});

// HTTP
GET /api/posts?filter[published]=true&filter[category]=tech
```

### Operators

Use operators for complex comparisons:

```javascript
// Greater than / Less than
filter: {
  age: { $gt: 18 },
  price: { $lte: 100 }
}

// Not equal
filter: {
  status: { $ne: 'deleted' }
}

// In array
filter: {
  status: { $in: ['active', 'pending'] },
  category: { $nin: ['spam', 'trash'] }
}

// Between (inclusive)
filter: {
  createdAt: { $between: ['2024-01-01', '2024-12-31'] }
}

// Like (pattern matching)
filter: {
  email: { $like: '%@example.com' },
  name: { $like: 'John%' }
}

// HTTP operators
GET /api/users?filter[age][$gt]=18&filter[age][$lt]=65
```

### Operator Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal (default) | `{ age: { $eq: 25 } }` |
| `$ne` | Not equal | `{ status: { $ne: 'deleted' } }` |
| `$gt` | Greater than | `{ price: { $gt: 100 } }` |
| `$gte` | Greater or equal | `{ age: { $gte: 18 } }` |
| `$lt` | Less than | `{ stock: { $lt: 10 } }` |
| `$lte` | Less or equal | `{ price: { $lte: 50 } }` |
| `$in` | In array | `{ status: { $in: ['a', 'b'] } }` |
| `$nin` | Not in array | `{ role: { $nin: ['admin'] } }` |
| `$like` | SQL LIKE | `{ email: { $like: '%@gmail%' } }` |
| `$between` | Between values | `{ age: { $between: [18, 65] } }` |

### Complex Filters

Combine filters with logical operators:

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

// HTTP (URL encoded)
GET /api/posts?filter[$or][0][status]=published&filter[$or][1][authorId]=123
```

### NULL Values

Handle null/undefined values:

```javascript
// IS NULL
filter: {
  deletedAt: null
}

// IS NOT NULL  
filter: {
  deletedAt: { $ne: null }
}

// HTTP
GET /api/posts?filter[deletedAt]=null
GET /api/posts?filter[deletedAt][$ne]=null
```

## Sorting

### Basic Sorting

```javascript
// Single field ascending
sort: 'title'

// Single field descending
sort: '-createdAt'

// Multiple fields
sort: ['-priority', 'createdAt', 'title']

// HTTP
GET /api/posts?sort=-createdAt,title
```

### Sort with Objects

More control with object syntax:

```javascript
sort: [
  { field: 'priority', direction: 'desc' },
  { field: 'createdAt', direction: 'asc' }
]
```

### Common Sort Patterns

```javascript
// Most recent first
sort: '-createdAt'

// Alphabetical
sort: 'name'

// By priority then date
sort: ['-priority', '-createdAt']

// Random order (MySQL)
sort: 'RAND()'
```

## Pagination

### Page-Based Pagination

```javascript
// Request specific page
page: {
  size: 20,    // Items per page
  number: 3    // Page number (1-based)
}

// Response includes metadata
{
  data: [...],
  meta: {
    total: 156,
    pageSize: 20,
    pageNumber: 3,
    totalPages: 8
  }
}

// HTTP
GET /api/posts?page[size]=20&page[number]=3
```

### Offset-Based Pagination

```javascript
// Using limit/offset
limit: 20,
offset: 40  // Skip first 40

// Equivalent to page 3 with size 20
```

### Cursor-Based Pagination

For large datasets:

```javascript
// First page
const page1 = await api.resources.events.query({
  sort: 'id',
  limit: 100
});

// Next page using last ID
const page2 = await api.resources.events.query({
  filter: { id: { $gt: page1.data[99].id } },
  sort: 'id',
  limit: 100
});
```

## Field Selection

### Select Specific Fields

Reduce payload size by selecting only needed fields:

```javascript
// Only these fields
fields: ['id', 'title', 'summary']

// HTTP
GET /api/posts?fields[posts]=id,title,summary
```

### Exclude Fields

Using schema configuration:

```javascript
const userSchema = new Schema({
  name: { type: 'string' },
  email: { type: 'string' },
  password: { type: 'string', silent: true },  // Never in queries
  apiKey: { type: 'string', silent: true }     // Never in queries
});
```

### Related Resource Fields

When joining, select fields from related resources:

```javascript
// Query
await api.resources.posts.query({
  joins: ['authorId', 'categoryId'],
  fields: {
    posts: ['title', 'summary'],
    users: ['name', 'avatar'],
    categories: ['name', 'slug']
  }
});

// HTTP
GET /api/posts?
  include=author,category&
  fields[posts]=title,summary&
  fields[users]=name,avatar&
  fields[categories]=name,slug
```

## Advanced Operators

### Custom Operators

Define custom query operators:

```javascript
// In your plugin
api.registerOperator('$regex', (field, pattern) => {
  return `${field} REGEXP ${api.escape(pattern)}`;
});

// Usage
filter: {
  email: { $regex: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$' }
}
```

### Aggregation Support

For MySQL storage:

```javascript
// Count by category
const stats = await api.query({
  select: ['category', 'COUNT(*) as count'],
  groupBy: ['category'],
  having: 'count > 10'
}, { type: 'posts' });

// With query builder
const query = new QueryBuilder('posts')
  .select('authorId', 'COUNT(*) as postCount')
  .groupBy('authorId')
  .having('postCount > ?', 5)
  .orderBy('postCount', 'DESC');
```

### Subqueries

Complex queries with subqueries:

```javascript
// Users with recent posts
filter: {
  id: {
    $in: api.subquery()
      .select('DISTINCT authorId')
      .from('posts')
      .where('createdAt > ?', '2024-01-01')
  }
}
```

## Full-Text Search

### Basic Search

```javascript
// Simple search across fields
const results = await api.resources.posts.query({
  search: 'javascript tutorial'
});

// Configure searchable fields in schema
const postSchema = new Schema({
  title: { type: 'string', searchable: true },
  content: { type: 'string', searchable: true },
  tags: { type: 'array', searchable: true }
});
```

### Advanced Search

With search plugin or MySQL FULLTEXT:

```javascript
// MySQL FULLTEXT search
filter: {
  $match: {
    fields: ['title', 'content'],
    query: 'node.js express',
    mode: 'boolean'  // or 'natural'
  }
}

// Weighted search
filter: {
  $search: {
    query: 'tutorial',
    weights: {
      title: 10,
      summary: 5,
      content: 1
    }
  }
}
```

### Search with Filters

Combine search with other filters:

```javascript
await api.resources.posts.query({
  search: 'javascript',
  filter: {
    published: true,
    category: 'tutorials',
    createdAt: { $gte: '2024-01-01' }
  },
  sort: '-relevance,-createdAt'
});
```

## Query Optimization

### 1. Use Indexes

Ensure filtered fields are indexed:

```javascript
const schema = new Schema({
  email: { type: 'string', index: true },
  status: { type: 'string', index: true },
  createdAt: { type: 'timestamp', index: true }
});

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

## Common Query Patterns

### 1. Recent Items

```javascript
// Last 10 posts
await api.resources.posts.query({
  filter: { published: true },
  sort: '-createdAt',
  limit: 10
});
```

### 2. Popular Items

```javascript
// Most liked posts this month
await api.resources.posts.query({
  filter: {
    createdAt: { $gte: startOfMonth },
    published: true
  },
  sort: ['-likeCount', '-createdAt'],
  page: { size: 20 }
});
```

### 3. User's Items

```javascript
// Current user's draft posts
await api.resources.posts.query({
  filter: {
    authorId: currentUserId,
    status: 'draft'
  },
  sort: '-updatedAt'
});
```

### 4. Search with Facets

```javascript
// Products with category counts
const products = await api.resources.products.query({
  search: 'laptop',
  filter: { available: true }
});

const facets = await api.query({
  select: ['category', 'COUNT(*) as count'],
  filter: { available: true },
  groupBy: ['category']
}, { type: 'products' });
```

### 5. Related Items

```javascript
// Posts similar to current
const similarPosts = await api.resources.posts.query({
  filter: {
    id: { $ne: currentPostId },
    $or: [
      { categoryId: post.categoryId },
      { tags: { $in: post.tags } }
    ]
  },
  sort: '-score',
  limit: 5
});
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

## Best Practices

1. **Always paginate** - Never return unbounded results
2. **Select only needed fields** - Reduces bandwidth and processing
3. **Use appropriate operators** - `$in` for multiple values, not multiple ORs
4. **Index filtered fields** - Critical for performance
5. **Test with real data volumes** - Performance changes with scale
6. **Monitor slow queries** - Log queries over threshold
7. **Consider denormalization** - For complex read-heavy queries
8. **Use query builder for complex logic** - More readable than raw SQL
9. **Cache frequently used queries** - Especially for public data
10. **Document complex queries** - Help future maintainers

## Troubleshooting

### Query returns no results
- Check filter syntax
- Verify data exists matching criteria
- Test with fewer filters

### Query is slow
- Add indexes on filtered/sorted fields
- Reduce number of joins
- Limit selected fields
- Consider caching

### Invalid operator error
- Check operator name (e.g., `$gte` not `$gte=`)
- Verify operator is supported by storage plugin

## Next Steps

- Review the [API Reference](./API.md) for all query options
- Learn about [Performance](./architecture/performance.md) optimization
- Explore [MySQL Plugin](./PLUGINS.md#mysqlplugin) features

← Back to [Guide](./GUIDE.md) | [API Reference](./API.md) →