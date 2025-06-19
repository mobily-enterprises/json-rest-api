# Relationships & Joins Guide

Build sophisticated data models with relationships. JSON REST API makes it easy to define foreign keys, perform automatic joins, and manage related data efficiently.

## Table of Contents

1. [Defining Relationships](#defining-relationships)
2. [Automatic Joins](#automatic-joins)
3. [Nested Joins](#nested-joins)
4. [Join Configuration](#join-configuration)
5. [Performance Optimization](#performance-optimization)
6. [Common Patterns](#common-patterns)

## Defining Relationships

Relationships are defined in your schema using the `refs` property:

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

## Automatic Joins

The `join` configuration enables automatic data fetching:

### Basic Join

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

### Advanced Join Configuration

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

## Nested Joins

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

### Nested Join Rules

1. **Each level must have join config** - Every field in the path needs `refs.join`
2. **Parent joins are automatic** - Requesting `a.b.c` includes `a` and `a.b`
3. **Hooks run innermost first** - Country → City → User → Post
4. **Placement follows field config** - Each level's placement rules apply

## Join Configuration

### Eager vs Lazy Loading

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

### Field Selection

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

### Hook Execution

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

## Performance Optimization

### 1. Select Only Needed Fields

```javascript
// Bad: Joining all fields
join: true

// Good: Only needed fields
join: {
  fields: ['id', 'name', 'avatar']
}
```

### 2. Use Eager Loading Wisely

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

### 3. Avoid Deep Nesting

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

### 4. Use Indexes

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

### 5. Batch Join Requests

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

## Common Patterns

### 1. Many-to-Many Relationships

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

### 2. Self-Referential Relationships

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

### 3. Polymorphic Relationships

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

### 4. Circular Reference Prevention

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

### 5. Conditional Joins

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

### 6. Aggregated Relationships

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

## JSON:API Relationships

When using HTTPPlugin, relationships follow JSON:API spec:

```javascript
// Query
GET /api/posts?include=author,category

// Response
{
  "data": [{
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "Hello World"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "10" }
      },
      "category": {
        "data": { "type": "categories", "id": "5" }
      }
    }
  }],
  "included": [
    {
      "id": "10",
      "type": "users",
      "attributes": {
        "name": "Alice"
      }
    },
    {
      "id": "5",
      "type": "categories", 
      "attributes": {
        "name": "Technology"
      }
    }
  ]
}
```

## Best Practices

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

## Troubleshooting

### "Cannot join field X - no join configuration"
Add `join` configuration to the field's `refs`.

### Circular reference errors
Disable hooks with `runHooks: false` or limit join depth.

### Performance issues with joins
- Reduce fields with `fields` array
- Add database indexes
- Consider denormalization for read-heavy scenarios

### Joined data not appearing
- Check that `joins` parameter includes the field
- Verify the related record exists
- Ensure proper permissions to view related data

## Next Steps

- Master [Querying & Filtering](./QUERYING.md) for complex data retrieval
- Learn about [Hooks](./HOOKS.md) to process relationships
- Explore [MySQL Plugin](./PLUGINS.md#mysqlplugin) for optimized joins

← Back to [Guide](./GUIDE.md) | Next: [Querying & Filtering](./QUERYING.md) →