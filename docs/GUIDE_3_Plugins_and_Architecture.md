# Plugins & Architecture

This section covers the plugin system, built-in plugins, and how to create your own custom plugins.

## Table of Contents

1. [Plugin System](#plugin-system)
2. [Built-in Plugins](#built-in-plugins)
3. [Creating Custom Plugins](#creating-custom-plugins)

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

Features:
- Schema-based validation for all field types
- Custom validation functions
- Foreign key reference validation (ensures referenced records exist)
- Automatic error formatting to JSON:API specification
- Support for partial updates vs full record validation

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

#### JSONAPIStrictPlugin

Transform API responses to be fully compliant with the JSON:API specification. This plugin converts the simplified default format into strict JSON:API format with proper relationship objects, compound documents, and standardized meta information.

```javascript
import { JSONAPIStrictPlugin } from 'json-rest-api';

// Enable strict JSON:API compliance
api.use(JSONAPIStrictPlugin);
```

**What This Plugin Does:**

1. **Moves Relationships Out of Attributes**
   - Foreign key fields (like `authorId`) are removed from attributes
   - Relationships are placed in a separate `relationships` object
   - Each relationship includes `data` with type and id

2. **Creates Compound Documents**
   - Related resources are moved to an `included` array
   - Prevents duplicate resources in the included array
   - Maintains resource linkage through type/id references

3. **Adds Relationship Links**
   - Each relationship gets `self` and `related` links
   - Self link: `/api/posts/1/relationships/author`
   - Related link: `/api/posts/1/author`

4. **Standardizes Meta Information**
   - Ensures consistent meta format in collections
   - Includes `totalCount`, `currentPage`, `pageSize`

5. **Formats Errors to JSON:API Spec**
   - Errors returned as array with standard fields
   - Each error has status, code, title, and detail

**Example Transformation:**

```javascript
// Without JSONAPIStrictPlugin (default simplified format):
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Blog Post",
      "content": "Post content here",
      "authorId": "42",              // Foreign key in attributes
      "author": {                    // Joined data in attributes
        "id": 42,
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  }
}

// With JSONAPIStrictPlugin (strict JSON:API format):
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Blog Post",
      "content": "Post content here"
      // No foreign keys or joined data here
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" },
        "links": {
          "self": "/api/posts/1/relationships/author",
          "related": "/api/posts/1/author"
        }
      }
    }
  },
  "included": [{
    "id": "42",
    "type": "users",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }]
}
```

**Working with Includes:**

```javascript
// Request multiple related resources
GET /api/posts/1?include=author,category,comments

// Response includes all in the included array
{
  "data": { /* post data */ },
  "included": [
    { "type": "users", "id": "42", /* author */ },
    { "type": "categories", "id": "5", /* category */ },
    { "type": "comments", "id": "101", /* comment 1 */ },
    { "type": "comments", "id": "102", /* comment 2 */ }
  ]
}
```

**Collection Responses:**

```javascript
GET /api/posts?page[size]=10

{
  "data": [ /* array of posts */ ],
  "meta": {
    "total": 145,
    "totalCount": 145,      // JSON:API style
    "currentPage": 1,
    "pageSize": 10,
    "pageCount": 15
  },
  "links": {
    "first": "/api/posts?page[number]=1&page[size]=10",
    "last": "/api/posts?page[number]=15&page[size]=10",
    "next": "/api/posts?page[number]=2&page[size]=10"
  }
}
```

**Error Responses:**

```javascript
// 404 Not Found
{
  "errors": [{
    "status": "404",
    "code": "NOT_FOUND",
    "title": "NotFoundError",
    "detail": "Post with id '999' not found",
    "source": { "parameter": "id" }
  }]
}
```

**Important Notes:**

1. **Request Format Unchanged**: You still send data in the simple format
2. **Response Only**: The plugin only transforms responses
3. **Sparse Fieldsets Work**: `?fields[posts]=title,content` still works
4. **Performance**: Minimal overhead, transformation happens after query
5. **Opt-in**: Only active when you explicitly use the plugin

**When to Use This Plugin:**

- ✅ Building a public API that needs JSON:API compliance
- ✅ Integrating with JSON:API client libraries (Ember Data, etc.)
- ✅ Need standardized relationship handling
- ✅ Want consistent error formatting

**When NOT to Use:**

- ❌ Internal APIs where simplicity matters more
- ❌ Mobile apps where bandwidth is critical (more verbose)
- ❌ Simple CRUD apps without complex relationships

#### PositioningPlugin

Manage record order for drag-and-drop interfaces.

```javascript
import { PositioningPlugin } from 'json-rest-api';

api.use(PositioningPlugin, {
  positionField: 'position',     // Field name for position
  beforeIdField: 'beforeId',     // Virtual field for repositioning
  
  // Position within filtered subsets
  typeOptions: {
    tasks: {
      groupBy: ['projectId', 'status']  // Separate position per group
    }
  }
});

// Resource configuration
api.addResource('tasks', taskSchema, {
  positioning: {
    field: 'position',
    groupBy: 'projectId'  // Separate sequences per project
  }
});
```

**Features:**
- **Automatic Positioning**: New records get next available position
- **Drag & Drop Support**: Use `beforeId` to reposition records
- **Position Groups**: Maintain separate sequences with `groupBy`
- **Database Transactions**: Uses transactions when available (MySQL)
- **Simple Fallback**: Basic positioning for memory storage

**Usage Examples:**

```javascript
// Create with position
await api.resources.tasks.create({
  title: 'New task',
  beforeId: '123'  // Place before task 123
});

// Reposition
await api.reposition('tasks', '456', '789'); // Move 456 before 789
await api.reposition('tasks', '456', null);  // Move to end

// Note: With memory storage, concurrent creates may produce duplicate positions
// Use MySQL for guaranteed atomic positioning
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


---

**← Previous**: [Core Features](./GUIDE_2_Core_Features.md) | **Next**: [Advanced Topics →](./GUIDE_4_Advanced_Topics.md)
