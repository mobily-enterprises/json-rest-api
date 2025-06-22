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

#### ComputedPlugin

Generate data on-the-fly without any database storage. Perfect for computed/derived data, external API proxies, real-time calculations, and mock data.

```javascript
import { ComputedPlugin } from 'json-rest-api';

api.use(ComputedPlugin);

// Mix computed resources with database-backed ones!
api.addResource('user-stats', statsSchema, {
  compute: {
    get: async (userId, context) => {
      // Access other resources
      const user = await context.api.resources.users.get(userId);
      const posts = await context.api.resources.posts.query({ 
        filter: { userId } 
      });
      
      // Return computed data
      return {
        id: userId,
        username: user.data.attributes.name,
        postCount: posts.data.length,
        avgPostLength: calculateAverage(posts)
      };
    },
    
    query: async (params, context) => {
      // Generate multiple items
      // Plugin handles filtering, sorting, pagination!
      return generateData();
    }
  }
});
```

Features:
- No database required - generates data on demand
- Full API feature support (validation, auth, hooks, filtering, etc.)
- Can access other resources (both computed and database)
- Automatic filtering/sorting/pagination
- Performance optimization options
- Perfect for aggregations, external APIs, real-time data

### Feature Plugins

#### ValidationPlugin

Validates data against schemas. **Always included automatically!**

```javascript
// No need to add manually, but you can customize
api.use(ValidationPlugin, {
  // Custom error messages
  messages: {
    required: 'Field {field} is required',
    min: 'Field {field} must be at least {min}'
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
  
  // Strict JSON:API compliance mode (new!)
  strictJsonApi: true,  // Enforce JSON:API spec compliance
  
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

**Strict JSON:API Mode:**

When `strictJsonApi: true` is enabled:

1. **Content-Type Enforcement**: Only accepts `application/vnd.api+json` for POST/PUT/PATCH requests
   - Returns 415 Unsupported Media Type for other content types
   - GET and DELETE requests are not affected

2. **Query Parameter Validation**: Only accepts standard JSON:API query parameters
   - ✅ Allowed: `include`, `fields`, `sort`, `page`, `filter`, `view`
   - ❌ Rejected: Unknown parameters, legacy parameters (`pageSize`, `joins`)
   - Returns 400 Bad Request with details about unknown parameters

3. **No Legacy Filter Support**: Direct filter parameters are rejected
   - ❌ `GET /api/users?name=John` (legacy)
   - ✅ `GET /api/users?filter[name]=John` (JSON:API)

Example with strict mode:
```javascript
// Strict mode configuration
api.use(HTTPPlugin, {
  strictJsonApi: true  // Enable strict compliance
});

// Valid requests:
POST /api/users
Content-Type: application/vnd.api+json

GET /api/users?filter[name]=John&page[size]=10

// Invalid requests (return errors):
POST /api/users
Content-Type: application/json  // 415 error

GET /api/users?name=John&unknownParam=value  // 400 error
```

#### SimplifiedRecordsPlugin

Transform JSON:API compliant responses into a simplified, more convenient format. The library is JSON:API compliant by default, and this plugin provides a simpler format that's easier to work with.

```javascript
import { SimplifiedRecordsPlugin } from 'json-rest-api';

// Enable simplified format
api.use(SimplifiedRecordsPlugin, {
  flattenResponse: false,   // Keep data wrapper
  includeType: true,        // Keep type field
  embedRelationships: true  // Embed related objects
});
```

**What This Plugin Does:**

1. **Flattens Attributes**
   - Moves attributes directly into the resource object
   - No need to access `data.attributes.field`
   - Just use `data.field` directly

2. **Embeds Relationships**
   - Places related objects directly in the response
   - No need to resolve relationships from `included` array
   - Related data is right where you expect it

3. **Optional Response Flattening**
   - Remove the `data` wrapper for single resources
   - Collections can return as `{ records: [...], meta: {...} }`
   - Cleaner, more intuitive responses

4. **Type Field Control**
   - Optionally exclude the `type` field
   - Useful when working with single-type endpoints

**Example Transformation:**

```javascript
// Default JSON:API format:
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Blog Post",
      "content": "Post content here"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" }
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

// With SimplifiedRecordsPlugin:
{
  "data": {
    "id": "1",
    "type": "posts",
    "title": "My Blog Post",
    "content": "Post content here",
    "authorId": "42",
    "author": {
      "id": "42",
      "type": "users",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
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
