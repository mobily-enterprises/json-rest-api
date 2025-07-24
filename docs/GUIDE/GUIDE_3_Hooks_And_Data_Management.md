# Hook System Guide


 
### Default values, required fields, computed/virtual fields

Change the definition of the `countries` resource with this:

```javascript
// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true, filterUsing: 'like' },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
    screenName: { type: 'string', computed: true },
  }
});
await api.resources.countries.createKnexTable()
```


The hook system in JSON REST API provides a powerful way to extend and customize API behavior at various points in the request lifecycle. This guide explains how to use hooks effectively.

## Table of Contents
- [Overview](#overview)
- [Hook Basics](#hook-basics)
- [Available Hooks](#available-hooks)
- [Hook Context](#hook-context)
- [Creating Hook Handlers](#creating-hook-handlers)
- [Hook Execution Order](#hook-execution-order)
- [Common Patterns](#common-patterns)
- [Best Practices](#best-practices)

## Overview

Hooks allow you to:
- Intercept and modify requests/responses
- Add custom validation or authorization
- Transform data before/after operations
- React to events (like record creation or deletion)
- Extend core functionality without modifying plugins

## Hook Basics

### Hook Signatures

The hook system uses a simple, consistent signature where all data is passed through a single `context` object.

```javascript
// Running hooks
await runHooks('hookName', context);

// Hook handler
addHook('hookName', 'handlerName', {}, async ({ context }) => {
  const { someData } = context;
});
```

### Adding Hook Handlers

Hook handlers are added using the `addHook` function:

```javascript
api.addHook(hookName, handlerName, options, handlerFunction);
```

Parameters:
- `hookName`: The name of the hook to listen to
- `handlerName`: A unique name for your handler
- `options`: Configuration object (optional)
  - `order`: Numeric execution order (lower runs first)
  - `sequence`: Alternative to order
- `handlerFunction`: Async function that receives hook context

## Available Hooks

### Transport Hooks

#### `transport:request`
Runs when a request is received by the transport layer (e.g., Express).

```javascript
api.addHook('transport:request', 'auth-check', {}, async ({ context }) => {
  // context includes transport-specific data
  const { request, response } = context.transport;
  
  // You can:
  // - Extract auth tokens
  // - Set security headers
  // - Log requests
  // - Block requests by setting context.handled = true
});
```

#### `transport:response`
Runs before sending the response back to the client.

```javascript
api.addHook('transport:response', 'add-headers', {}, async ({ context }) => {
  const { request, response } = context.transport;
  
  // Add custom headers
  response.headers['X-Custom-Header'] = 'value';
  
  // Modify response based on request
  if (request.path.startsWith('/api/public')) {
    response.headers['Cache-Control'] = 'public, max-age=3600';
  }
});
```

### REST API Operation Hooks

#### `beforeProcessing`
Runs before processing any REST API operation (POST, PUT, PATCH).

```javascript
api.addHook('beforeProcessing', 'validate-data', {}, async ({ context }) => {
  const { method, scopeName, params } = context;
  
  // Perform validation
  if (method === 'post' && scopeName === 'articles') {
    // Custom validation logic
  }
});
```

#### `checkPermissions`
Runs during permission checking phase.

```javascript
api.addHook('checkPermissions', 'custom-permissions', {}, async ({ context }) => {
  const { method, scopeName, auth, id } = context;
  
  // Implement custom permission logic
  if (scopeName === 'admin-resources' && !auth?.roles?.includes('admin')) {
    throw new Error('Admin access required');
  }
});
```

#### `beforeData` / `afterData`
Run before/after data operations.

```javascript
// Before data operation
api.addHook('beforeData', 'prepare-data', {}, async ({ context }) => {
  // Modify query parameters, add filters, etc.
});

// After data operation
api.addHook('afterData', 'transform-data', {}, async ({ context }) => {
  // Transform the returned data
  if (context.record) {
    context.record.attributes.processedAt = new Date();
  }
});
```

#### `finish`
Runs after successful operation completion.

```javascript
api.addHook('finish', 'log-success', {}, async ({ context }) => {
  const { method, scopeName, id } = context;
  console.log(`Operation ${method} on ${scopeName}/${id} completed`);
});
```

### Schema Hooks

#### `schema:enrich`
Allows modification of resource schemas.

```javascript
api.addHook('schema:enrich', 'add-timestamps', {}, async ({ context }) => {
  const { schema, scopeName } = context;
  
  // Add timestamp fields to all resources
  schema.attributes.createdAt = { 
    type: 'string', 
    format: 'date-time',
    computed: true 
  };
  schema.attributes.updatedAt = { 
    type: 'string', 
    format: 'date-time',
    computed: true 
  };
});
```

### Authentication Hooks

#### `afterAuthentication`
Runs after successful JWT authentication.

```javascript
api.addHook('afterAuthentication', 'enrich-auth', {}, async ({ context }) => {
  const { auth, authPayload } = context;
  
  // Enrich auth context with additional data
  const user = await db('users').where({ id: auth.userId }).first();
  context.auth.profile = user;
});
```

#### `afterLogout`
Runs after user logout.

```javascript
api.addHook('afterLogout', 'cleanup', {}, async ({ context }) => {
  const { logoutUserId } = context;
  
  // Clean up user sessions, caches, etc.
  await cache.delete(`user:${logoutUserId}`);
});
```

### Database Query Hooks (Knex Plugin)

#### `knexQueryFiltering`
Allows modification of database queries.

```javascript
api.addHook('knexQueryFiltering', 'tenant-filter', { order: -100 }, 
  async ({ context }) => {
    const { query, auth } = context;
    
    // Add tenant isolation
    if (auth?.tenantId) {
      query.where('tenant_id', auth.tenantId);
    }
  }
);
```

## Hook Context

The context object passed to hooks contains all relevant data for the operation. Common properties include:

```javascript
{
  // Operation details
  method: 'post',              // HTTP method
  scopeName: 'articles',       // Resource name
  id: '123',                   // Resource ID (for single-resource ops)
  
  // Authentication
  auth: {
    userId: 'user-123',
    email: 'user@example.com',
    roles: ['admin'],
    permissions: ['articles:write']
  },
  
  // Request data
  params: {},                  // Request parameters
  inputRecord: {},            // Input data (for mutations)
  queryParams: {},            // Query parameters
  
  // Response data
  record: {},                 // Single record
  records: [],               // Multiple records
  
  // Transport-specific (in transport hooks)
  transport: {
    request: {
      method: 'POST',
      path: '/api/articles',
      headers: {},
      body: {}
    },
    response: {
      status: 200,
      headers: {},
      body: {}
    }
  },
  
  // Database transaction
  transaction: knexTransaction,
  
  // Helpers and utilities
  db: knexInstance,
  log: logger
}
```

## Creating Hook Handlers

### Basic Handler

```javascript
api.addHook('beforeProcessing', 'my-handler', {}, async ({ context }) => {
  // Access context properties
  const { method, scopeName, auth } = context;
  
  // Perform operations
  if (scopeName === 'sensitive-data' && !auth) {
    throw new Error('Authentication required');
  }
  
  // Modify context (changes are passed to next handlers)
  context.customFlag = true;
});
```

### Handler with Dependencies

```javascript
// In a plugin
const MyPlugin = {
  name: 'my-plugin',
  
  async install({ api, addHook, vars, helpers }) {
    // Use plugin context
    addHook('beforeData', 'my-handler', {}, async ({ context }) => {
      // Access plugin vars
      const config = vars.myPluginConfig;
      
      // Use helpers
      const result = await helpers.validateData(context.inputRecord);
      
      // Modify operation
      if (!result.valid) {
        throw new ValidationError(result.errors);
      }
    });
  }
};
```

### Conditional Handler

```javascript
api.addHook('finish', 'conditional-handler', {}, async ({ context }) => {
  // Only run for specific operations
  if (context.method !== 'post' || context.scopeName !== 'orders') {
    return; // Skip this handler
  }
  
  // Send notification for new orders
  await sendNotification({
    type: 'new-order',
    orderId: context.record.id
  });
});
```

## Hook Execution Order

Hooks execute in a specific order determined by:

1. **Hook type order** - Different hook types run at different lifecycle points
2. **Handler order** - Within a hook type, handlers run by their `order` value
3. **Registration order** - Handlers with same order run in registration sequence

```javascript
// These will execute in order: -1000, -100, 0, 100
api.addHook('checkPermissions', 'first', { order: -1000 }, handler1);
api.addHook('checkPermissions', 'second', { order: -100 }, handler2);
api.addHook('checkPermissions', 'third', {}, handler3); // default order: 0
api.addHook('checkPermissions', 'fourth', { order: 100 }, handler4);
```

### Stopping Hook Execution

Return `false` from a handler to stop the hook chain:

```javascript
api.addHook('transport:request', 'rate-limiter', { order: -1000 }, 
  async ({ context }) => {
    const { request } = context.transport;
    
    if (await isRateLimited(request.ip)) {
      context.rejection = {
        status: 429,
        message: 'Too many requests'
      };
      return false; // Stop processing
    }
  }
);
```

## Common Patterns

### Data Validation

```javascript
api.addHook('beforeProcessing', 'validate-articles', {}, async ({ context }) => {
  if (context.scopeName !== 'articles') return;
  
  const { inputRecord, method } = context;
  
  if (['post', 'put', 'patch'].includes(method)) {
    const { title, content } = inputRecord.data.attributes;
    
    if (title && title.length > 200) {
      throw new ValidationError('Title too long');
    }
    
    if (content && content.length < 10) {
      throw new ValidationError('Content too short');
    }
  }
});
```

### Automatic Field Population

```javascript
api.addHook('beforeProcessing', 'auto-fields', {}, async ({ context }) => {
  const { method, auth, inputRecord } = context;
  
  if (method === 'post' && auth) {
    // Set creator
    inputRecord.data.attributes.createdBy = auth.userId;
    inputRecord.data.attributes.createdAt = new Date().toISOString();
  }
  
  if (['put', 'patch'].includes(method) && auth) {
    // Set updater
    inputRecord.data.attributes.updatedBy = auth.userId;
    inputRecord.data.attributes.updatedAt = new Date().toISOString();
  }
});
```

### Filtering Based on User

```javascript
api.addHook('knexQueryFiltering', 'user-filter', {}, async ({ context }) => {
  const { query, auth, scopeName } = context;
  
  if (scopeName === 'user-data' && auth) {
    // Users only see their own data
    query.where('user_id', auth.userId);
  }
});
```

### Audit Logging

```javascript
api.addHook('finish', 'audit-log', { order: 1000 }, async ({ context }) => {
  const { method, scopeName, id, auth, record } = context;
  
  // Skip read operations
  if (method === 'get' || method === 'query') return;
  
  await db('audit_logs').insert({
    user_id: auth?.userId || 'anonymous',
    action: method,
    resource_type: scopeName,
    resource_id: id || record?.id,
    changes: JSON.stringify(record),
    timestamp: new Date()
  });
});
```

### Caching

```javascript
const cache = new Map();

// Cache reads
api.addHook('beforeData', 'cache-check', { order: -1000 }, 
  async ({ context }) => {
    if (context.method !== 'get') return;
    
    const cacheKey = `${context.scopeName}:${context.id}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      context.record = cached;
      context.skipDataOperation = true; // Custom flag
    }
  }
);

// Update cache on writes
api.addHook('finish', 'cache-update', { order: 1000 }, 
  async ({ context }) => {
    const { method, scopeName, id, record } = context;
    
    if (method === 'get' && record) {
      cache.set(`${scopeName}:${id}`, record);
    }
    
    if (['patch', 'put', 'delete'].includes(method)) {
      cache.delete(`${scopeName}:${id}`);
    }
  }
);
```

## Best Practices

### 1. Use Descriptive Handler Names

```javascript
// ❌ Bad
api.addHook('checkPermissions', 'handler1', {}, async ({ context }) => {});

// ✅ Good
api.addHook('checkPermissions', 'require-admin-for-settings', {}, 
  async ({ context }) => {});
```

### 2. Handle Errors Gracefully

```javascript
api.addHook('beforeProcessing', 'validate-safely', {}, async ({ context }) => {
  try {
    await validateData(context.inputRecord);
  } catch (error) {
    // Log error with context
    context.log.error('Validation failed', {
      error: error.message,
      scopeName: context.scopeName,
      method: context.method
    });
    
    // Re-throw with user-friendly message
    throw new ValidationError('Invalid data provided');
  }
});
```

### 3. Check Context Before Operating

```javascript
api.addHook('finish', 'send-notifications', {}, async ({ context }) => {
  // Ensure required data exists
  if (!context.record?.id || !context.auth?.userId) {
    return; // Skip if missing required data
  }
  
  // Safe to proceed
  await notifyUser(context.auth.userId, context.record);
});
```

### 4. Use Order for Dependencies

```javascript
// Ensure auth runs before permissions
api.addHook('checkPermissions', 'populate-user', { order: -100 }, 
  async ({ context }) => {
    if (context.auth?.userId) {
      context.user = await getUser(context.auth.userId);
    }
  }
);

api.addHook('checkPermissions', 'check-user-status', { order: 0 }, 
  async ({ context }) => {
    // Can safely use context.user set by previous handler
    if (context.user?.suspended) {
      throw new Error('Account suspended');
    }
  }
);
```

### 5. Avoid Heavy Operations in Hooks

```javascript
// ❌ Bad - Synchronous heavy operation
api.addHook('finish', 'process-images', {}, async ({ context }) => {
  if (context.record?.images) {
    // This blocks the response
    await processImages(context.record.images);
  }
});

// ✅ Good - Queue for background processing
api.addHook('finish', 'queue-image-processing', {}, async ({ context }) => {
  if (context.record?.images) {
    // Quick operation to queue the job
    await jobQueue.add('process-images', {
      recordId: context.record.id,
      images: context.record.images
    });
  }
});
```

### 6. Document Hook Side Effects

```javascript
/**
 * Auto-assigns articles to the default category if none specified.
 * Modifies: inputRecord.data.relationships.category
 * Depends on: categories table having a 'default' entry
 */
api.addHook('beforeProcessing', 'auto-assign-category', {}, 
  async ({ context }) => {
    if (context.scopeName !== 'articles' || context.method !== 'post') {
      return;
    }
    
    const { relationships } = context.inputRecord.data;
    if (!relationships?.category) {
      context.inputRecord.data.relationships = {
        ...relationships,
        category: {
          data: { type: 'categories', id: 'default' }
        }
      };
    }
  }
);
```

### 7. Use Type Guards

```javascript
api.addHook('beforeData', 'type-safe-handler', {}, async ({ context }) => {
  // Check types before using
  if (typeof context.auth?.userId !== 'string') {
    return;
  }
  
  if (!Array.isArray(context.queryParams?.include)) {
    context.queryParams.include = [];
  }
  
  // Now safe to use
  context.queryParams.include.push('author');
});
```

## Debugging Hooks

Enable debug logging to see hook execution:

```javascript
const api = new Api({ 
  name: 'my-api',
  log: { level: 'debug' }
});

// Hooks will log execution details
// [DEBUG] Running hook 'checkPermissions' with 3 handlers
// [DEBUG] Hook handler 'require-auth' completed in 2ms
```

Add custom debugging:

```javascript
api.addHook('beforeProcessing', 'debug-hook', { order: -9999 }, 
  async ({ context }) => {
    console.log('Hook context:', {
      method: context.method,
      scopeName: context.scopeName,
      auth: context.auth ? 'authenticated' : 'anonymous',
      hasInput: !!context.inputRecord
    });
  }
);
```

