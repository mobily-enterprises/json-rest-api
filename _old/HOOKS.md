# Hooks & Events Guide

Hooks are the primary way to extend and customize JSON REST API behavior. They allow you to intercept operations, modify data, add validation, and implement complex business logic.

## Table of Contents

1. [Understanding Hooks](#understanding-hooks)
2. [The Context Object](#the-context-object)
3. [Lifecycle Hooks](#lifecycle-hooks)
4. [Hook Priorities](#hook-priorities)
5. [Common Patterns](#common-patterns)
6. [Best Practices](#best-practices)

## Understanding Hooks

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

### Key Concepts

1. **Hooks are async** - Always use async/await
2. **Modify context** - Changes affect the operation
3. **Return false to stop** - Prevents further hooks
4. **Throw to fail** - Stops operation with error

## The Context Object

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

## Lifecycle Hooks

### Validation Hooks

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

### CRUD Operation Hooks

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

### Transform Hooks

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

### HTTP-Specific Hooks

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

## Hook Priorities

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

## Common Patterns

### 1. Computed Fields

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

### 2. Cascading Operations

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

### 3. Multi-Tenant Filtering

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

### 4. Audit Logging

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

### 5. Validation Beyond Schema

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

### 6. Dynamic Permissions

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

## Best Practices

### 1. Keep Hooks Focused

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

### 2. Handle Errors Gracefully

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

### 3. Use Context for State

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

### 4. Consider Performance

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

### 5. Document Hook Behavior

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

## Hook Reference

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

## Next Steps

- Explore [Relationships & Joins](./RELATIONSHIPS.md) for connected data
- Master [Querying & Filtering](./QUERYING.md) for data retrieval
- See [Plugin Guide](./PLUGINS.md) for creating hook-based plugins

← Back to [Guide](./GUIDE.md) | Next: [Relationships & Joins](./RELATIONSHIPS.md) →