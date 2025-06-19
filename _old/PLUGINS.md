# Plugins Guide

Plugins are the heart of JSON REST API's extensibility. They add features, storage backends, and integrations through a consistent interface.

## Table of Contents

1. [How Plugins Work](#how-plugins-work)
2. [Built-in Plugins](#built-in-plugins)
3. [Plugin Order Matters](#plugin-order-matters)
4. [Creating Custom Plugins](#creating-custom-plugins)
5. [Plugin Cookbook](#plugin-cookbook)

## How Plugins Work

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

#### VersioningPlugin
Track changes to resources over time.

```javascript
import { VersioningPlugin } from 'json-rest-api';

api.use(VersioningPlugin, {
  trackHistory: true,  // Keep all versions
  versionField: 'version',
  optimisticLocking: true  // Prevent concurrent updates
});

// Usage
const user = await api.resources.users.get(1);
// user.version = 1

// Update increments version
const updated = await api.resources.users.update(1, { name: 'New Name' });
// updated.version = 2

// Get history
const history = await api.getVersionHistory('users', 1);

// Restore old version
await api.restoreVersion('users', 1, 1);
```

#### SecurityPlugin
Add authentication, authorization, and rate limiting.

```javascript
import { SecurityPlugin } from 'json-rest-api';

api.use(SecurityPlugin, {
  // Authentication
  authentication: {
    type: 'bearer',  // or 'basic', 'custom'
    required: true,
    
    // Custom validator
    validate: async (token) => {
      const user = await validateToken(token);
      return { valid: !!user, user };
    }
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,  // Max requests per window
    
    // Different limits per resource
    typeOptions: {
      auth: { max: 5 },  // Strict for auth endpoints
      public: { max: 1000 }  // Relaxed for public data
    }
  },
  
  // CORS
  cors: {
    origin: ['https://app.example.com'],
    credentials: true
  }
});
```

#### LoggingPlugin
Structured logging with sensitive data protection.

```javascript
import { LoggingPlugin } from 'json-rest-api';

api.use(LoggingPlugin, {
  level: 'info',  // 'debug' | 'info' | 'warn' | 'error'
  
  // Redact sensitive fields
  redactFields: ['password', 'token', 'ssn'],
  
  // Custom logger
  logger: winston.createLogger({ /* ... */ }),
  
  // Audit logging
  auditLog: {
    enabled: true,
    storage: 'database',  // or 'file'
    includeBefore: true  // Log before state for updates
  }
});
```

#### OpenAPIPlugin
Auto-generate OpenAPI/Swagger documentation.

```javascript
import { OpenAPIPlugin } from 'json-rest-api';

api.use(OpenAPIPlugin, {
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'API for my amazing app'
  },
  
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Development' }
  ],
  
  // Serve UI at /api-docs
  ui: true,
  uiPath: '/api-docs'
});

// Access OpenAPI spec
const spec = api.getOpenAPISpec();
```

## Plugin Order Matters

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
    
    // Also handle updates
    api.hook('beforeUpdate', async (context) => {
      const data = context.data;
      
      // Only regenerate if title changed
      if (data[sourceField] && !data[targetField]) {
        // Same logic as insert
        // ... (abbreviated for brevity)
      }
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
    
    // Add cache management methods
    api.clearCache = (type) => {
      if (type) {
        for (const [key] of storage) {
          if (key.includes(`:${type}:`)) {
            storage.delete(key);
          }
        }
      } else {
        storage.clear();
      }
    };
  }
};
```

## Plugin Cookbook

### Soft Delete Plugin

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

### Webhook Plugin

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

### Search Plugin

Add full-text search capabilities (Note: basic search is built-in via searchable fields):

```javascript
const SearchPlugin = {
  name: 'SearchPlugin',
  
  install(api, options = {}) {
    // Add search method to resources
    api.hook('beforeQuery', async (context) => {
      const { search } = context.params;
      if (!search) return;
      
      const config = options[context.options.type];
      if (!config) return;
      
      // Build search conditions for searchable fields
      const schema = api.getSchema(context.options.type);
      const searchableFields = Object.entries(schema.structure)
        .filter(([field, def]) => def.searchable)
        .map(([field]) => field);
      
      if (searchableFields.length === 0) return;
      
      const searchConditions = searchableFields.map(field => ({
        [field]: { $like: `%${search}%` }
      }));
      
      // Add to filter with OR logic
      context.params.filter = {
        ...context.params.filter,
        $or: searchConditions
      };
      
      // Remove search param so it doesn't interfere
      delete context.params.search;
    });
  }
};

// Schema with searchable fields
const userSchema = new Schema({
  name: { type: 'string', searchable: true },
  email: { type: 'string', searchable: true },
  bio: { type: 'string', searchable: true },
  password: { type: 'string' }  // Not searchable
});

// Now you can search searchable fields
const results = await api.resources.users.query({
  search: 'john'  // Searches name, email, and bio only
});
```

## Best Practices

1. **Name your plugins** - Helps with debugging
2. **Document options** - Clear defaults and examples
3. **Check dependencies** - Use `requires` array
4. **Handle errors gracefully** - Don't break the API
5. **Clean up on uninstall** - If you add global state
6. **Respect existing functionality** - Enhance, don't replace
7. **Use appropriate hooks** - before vs after matters
8. **Test with different storage** - Ensure compatibility
9. **Consider performance** - Especially in hooks
10. **Make it configurable** - Options for everything

## Next Steps

- Learn about [Hooks & Events](./HOOKS.md) for deeper customization
- Explore [Relationships & Joins](./RELATIONSHIPS.md) for connected data
- Master [Querying & Filtering](./QUERYING.md) for data retrieval

← Back to [Guide](./GUIDE.md) | Next: [Hooks & Events](./HOOKS.md) →