# Enterprise Guide: Chapter 4 - Best Practices

## The Cost of Bad Practices

Let me tell you about a real disaster. A Fortune 500 company's API:

- **2,847 endpoints** (nobody knew what half of them did)
- **17 different authentication methods** (OAuth, API keys, basic auth, custom tokens...)
- **Zero documentation** ("the code is the documentation")
- **$3.2M annual maintenance cost**
- **6-month onboarding** for new developers

After implementing these best practices, they reduced it to:
- **124 well-designed endpoints**
- **1 authentication method** (JWT with refresh tokens)
- **Auto-generated documentation**
- **$400K annual maintenance**
- **1-week onboarding**

This chapter shows you how to avoid their mistakes.

## Resource Design Best Practices

### The Golden Rules

1. **Resources are nouns, not verbs**
2. **Pluralize consistently**
3. **Use relationships, not nesting**
4. **Keep it shallow**
5. **Version from day one**

### Real-World Resource Design

Let's design a real financial services API:

```javascript
// ❌ BAD: Verb-based, inconsistent, deeply nested
api.addResource('getUserAccountData', ...)
api.addResource('process-payment', ...)
api.addResource('customer/account/transaction/detail/history', ...)

// ✅ GOOD: Clean, consistent, predictable
api.addResource('users', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    email: { type: 'string', required: true, unique: true },
    profile: { type: 'object' }, // Embedded data, not nested resource
    status: { type: 'string', enum: ['active', 'suspended', 'closed'] }
  })
})

api.addResource('accounts', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    userId: { type: 'uuid', refs: 'users', required: true },
    type: { type: 'string', enum: ['checking', 'savings', 'investment'] },
    balance: { type: 'decimal', precision: 10, scale: 2 },
    currency: { type: 'string', default: 'USD' }
  })
})

api.addResource('transactions', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    accountId: { type: 'uuid', refs: 'accounts', required: true },
    type: { type: 'string', enum: ['debit', 'credit'] },
    amount: { type: 'decimal', precision: 10, scale: 2 },
    description: { type: 'string', maxLength: 200 },
    
    // Metadata, not separate resources
    metadata: {
      type: 'object',
      structure: {
        category: { type: 'string' },
        merchant: { type: 'string' },
        location: { type: 'object' }
      }
    },
    
    // Audit fields
    createdAt: { type: 'timestamp', generated: true },
    processedAt: { type: 'timestamp' },
    settledAt: { type: 'timestamp' }
  })
})
```

### Composite Resources

Sometimes you need to group related data:

```javascript
// ❌ BAD: Exposing internal complexity
api.addResource('orderheaders', ...)
api.addResource('orderlines', ...)
api.addResource('ordershipments', ...)
api.addResource('orderpayments', ...)

// ✅ GOOD: Single resource with sub-objects
api.addResource('orders', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    customerId: { type: 'uuid', refs: 'customers' },
    
    // Embedded line items
    items: {
      type: 'array',
      items: {
        productId: { type: 'uuid', refs: 'products' },
        quantity: { type: 'integer', min: 1 },
        price: { type: 'decimal', precision: 10, scale: 2 },
        discount: { type: 'decimal', precision: 5, scale: 2 }
      }
    },
    
    // Embedded shipment info
    shipping: {
      type: 'object',
      structure: {
        method: { type: 'string' },
        address: { type: 'object' },
        trackingNumber: { type: 'string' },
        estimatedDelivery: { type: 'date' }
      }
    },
    
    // Embedded payment info
    payment: {
      type: 'object',
      structure: {
        method: { type: 'string' },
        status: { type: 'string' },
        transactionId: { type: 'string' }
      }
    },
    
    // Computed fields
    subtotal: { type: 'decimal', computed: true },
    tax: { type: 'decimal', computed: true },
    total: { type: 'decimal', computed: true }
  }),
  
  hooks: {
    beforeInsert: async (context) => {
      // Calculate totals
      const items = context.data.items || []
      context.data.subtotal = items.reduce((sum, item) => 
        sum + (item.price * item.quantity * (1 - item.discount)), 0
      )
      context.data.tax = context.data.subtotal * 0.08 // 8% tax
      context.data.total = context.data.subtotal + context.data.tax
    }
  }
})
```

## Schema Design Best Practices

### Use Domain Types

Create reusable domain types for consistency:

```javascript
// Define domain types
const DomainTypes = {
  money: {
    type: 'object',
    structure: {
      amount: { type: 'decimal', precision: 19, scale: 4 },
      currency: { type: 'string', length: 3, default: 'USD' }
    }
  },
  
  address: {
    type: 'object',
    structure: {
      street1: { type: 'string', maxLength: 100 },
      street2: { type: 'string', maxLength: 100 },
      city: { type: 'string', maxLength: 50 },
      state: { type: 'string', length: 2 },
      postalCode: { type: 'string', pattern: /^\d{5}(-\d{4})?$/ },
      country: { type: 'string', length: 2, default: 'US' }
    }
  },
  
  phone: {
    type: 'string',
    pattern: /^\+?1?\d{10,14}$/,
    transform: (value) => {
      // Normalize to E.164 format
      const digits = value.replace(/\D/g, '')
      return digits.startsWith('1') ? `+${digits}` : `+1${digits}`
    }
  },
  
  email: {
    type: 'string',
    pattern: /^[^@]+@[^@]+\.[^@]+$/,
    transform: (value) => value.toLowerCase().trim()
  },
  
  percentage: {
    type: 'decimal',
    precision: 5,
    scale: 4,
    min: 0,
    max: 1
  }
}

// Use domain types in schemas
api.addResource('invoices', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    
    // Use money type
    subtotal: { ...DomainTypes.money, required: true },
    tax: { ...DomainTypes.money, required: true },
    total: { ...DomainTypes.money, required: true },
    
    // Use address type
    billingAddress: { ...DomainTypes.address, required: true },
    shippingAddress: { ...DomainTypes.address },
    
    // Use percentage type
    taxRate: { ...DomainTypes.percentage, default: 0.08 },
    discountRate: { ...DomainTypes.percentage, default: 0 }
  })
})
```

### Versioning Schemas

Plan for change from the beginning:

```javascript
// Version 1: Original schema
const UserSchemaV1 = new Schema({
  id: { type: 'uuid', generated: true },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
})

// Version 2: Split name into first/last
const UserSchemaV2 = new Schema({
  id: { type: 'uuid', generated: true },
  firstName: { type: 'string', required: true },
  lastName: { type: 'string', required: true },
  email: { type: 'string', required: true },
  
  // Computed for backwards compatibility
  name: {
    type: 'string',
    computed: true,
    get: (user) => `${user.firstName} ${user.lastName}`
  }
})

// Version 3: Add phone with validation
const UserSchemaV3 = new Schema({
  id: { type: 'uuid', generated: true },
  firstName: { type: 'string', required: true },
  lastName: { type: 'string', required: true },
  email: { ...DomainTypes.email, required: true },
  phone: { ...DomainTypes.phone }, // Optional at first
  
  // Still support v1 clients
  name: {
    type: 'string',
    computed: true,
    get: (user) => `${user.firstName} ${user.lastName}`
  }
})

// Apply version-specific schemas
api.addResource('users', {
  schema: UserSchemaV3, // Current version
  
  versions: {
    '1.0': { schema: UserSchemaV1 },
    '2.0': { schema: UserSchemaV2 },
    '3.0': { schema: UserSchemaV3 }
  },
  
  migrations: {
    '1.0_to_2.0': async (data) => {
      const [firstName, ...lastParts] = data.name.split(' ')
      return {
        ...data,
        firstName,
        lastName: lastParts.join(' ') || 'Unknown'
      }
    },
    
    '2.0_to_3.0': async (data) => {
      return data // No data migration needed
    }
  }
})
```

## Hook Best Practices

### Organize Hooks by Concern

Don't create monolithic hooks. Separate concerns:

```javascript
// ❌ BAD: Everything in one hook
api.addResource('orders', {
  hooks: {
    beforeInsert: async (context) => {
      // Validation
      if (!context.data.items || context.data.items.length === 0) {
        throw new Error('Order must have items')
      }
      
      // Check inventory
      for (const item of context.data.items) {
        const stock = await checkStock(item.productId)
        if (stock < item.quantity) {
          throw new Error('Insufficient stock')
        }
      }
      
      // Calculate prices
      context.data.subtotal = calculateSubtotal(context.data.items)
      context.data.tax = context.data.subtotal * 0.08
      context.data.total = context.data.subtotal + context.data.tax
      
      // Audit
      context.data.createdAt = new Date()
      context.data.createdBy = context.user.id
      
      // Send email
      await sendOrderConfirmation(context.data)
      
      // Update analytics
      await analytics.track('OrderCreated', context.data)
      
      // Reserve inventory
      await reserveInventory(context.data.items)
    }
  }
})

// ✅ GOOD: Separated concerns
const validationHooks = {
  beforeInsert: async (context) => {
    if (!context.data.items?.length) {
      throw new BadRequestError('Order must have items')
    }
    
    // Validate each item
    for (const item of context.data.items) {
      if (!item.productId || !item.quantity || item.quantity < 1) {
        throw new BadRequestError('Invalid order item')
      }
    }
  },
  
  beforeUpdate: async (context) => {
    if (context.existing.status === 'shipped' && context.data.items) {
      throw new BadRequestError('Cannot modify items after shipping')
    }
  }
}

const inventoryHooks = {
  beforeInsert: { 
    priority: 10, // Run after validation
    handler: async (context) => {
      for (const item of context.data.items) {
        const available = await checkAvailability(item.productId, item.quantity)
        if (!available) {
          throw new ConflictError(`Product ${item.productId} out of stock`)
        }
      }
    }
  },
  
  afterInsert: async (context) => {
    // Reserve inventory
    await reserveInventory(context.result.id, context.result.items)
  },
  
  afterDelete: async (context) => {
    // Release inventory
    await releaseInventory(context.existing.id)
  }
}

const pricingHooks = {
  beforeInsert: {
    priority: 20, // Run after inventory check
    handler: async (context) => {
      const pricing = await calculatePricing(context.data)
      Object.assign(context.data, pricing)
    }
  },
  
  beforeUpdate: async (context) => {
    if (context.data.items) {
      const pricing = await calculatePricing({
        ...context.existing,
        ...context.data
      })
      Object.assign(context.data, pricing)
    }
  }
}

const auditHooks = createAuditHooks() // Reusable audit hooks

const notificationHooks = {
  afterInsert: {
    priority: 100, // Run last
    handler: async (context) => {
      // Don't block on notifications
      setImmediate(() => {
        sendOrderConfirmation(context.result).catch(err => 
          console.error('Failed to send confirmation:', err)
        )
      })
    }
  },
  
  afterUpdate: async (context) => {
    if (context.changes.status) {
      setImmediate(() => {
        sendStatusUpdate(context.result).catch(console.error)
      })
    }
  }
}

// Combine all hooks
api.addResource('orders', {
  schema: orderSchema,
  hooks: combineHooks(
    validationHooks,
    inventoryHooks,
    pricingHooks,
    auditHooks,
    notificationHooks
  )
})

// Helper to combine hooks
function combineHooks(...hookSets) {
  const combined = {}
  
  for (const hooks of hookSets) {
    for (const [event, handler] of Object.entries(hooks)) {
      if (!combined[event]) {
        combined[event] = []
      }
      
      if (Array.isArray(combined[event])) {
        combined[event].push(handler)
      } else {
        combined[event] = [combined[event], handler]
      }
    }
  }
  
  return combined
}
```

### Reusable Hook Factories

Create factories for common patterns:

```javascript
// Audit hook factory
function createAuditHooks(options = {}) {
  const { 
    userField = 'user',
    timestampField = 'At',
    actionField = 'By'
  } = options
  
  return {
    beforeInsert: async (context) => {
      context.data[`created${timestampField}`] = new Date()
      context.data[`created${actionField}`] = context[userField]?.id
    },
    
    beforeUpdate: async (context) => {
      context.data[`updated${timestampField}`] = new Date()
      context.data[`updated${actionField}`] = context[userField]?.id
      
      // Track what changed
      context.data.lastChanges = Object.keys(context.changes)
    },
    
    beforeDelete: async (context) => {
      // Soft delete support
      if (context.soft) {
        context.data = {
          deleted: true,
          [`deleted${timestampField}`]: new Date(),
          [`deleted${actionField}`]: context[userField]?.id
        }
        context.method = 'update' // Convert to update
      }
    }
  }
}

// Validation hook factory
function createValidationHooks(rules) {
  return {
    beforeInsert: async (context) => {
      await validateData(context.data, rules.create || rules.default)
    },
    
    beforeUpdate: async (context) => {
      await validateData(context.data, rules.update || rules.default, true)
    }
  }
}

// State machine hook factory
function createStateMachineHooks(config) {
  const { field = 'status', transitions } = config
  
  return {
    beforeUpdate: async (context) => {
      if (field in context.data) {
        const currentState = context.existing[field]
        const newState = context.data[field]
        
        const allowed = transitions[currentState] || []
        if (!allowed.includes(newState)) {
          throw new BadRequestError(
            `Invalid transition from ${currentState} to ${newState}`
          )
        }
        
        // Call transition handler if defined
        const handler = config.handlers?.[`${currentState}_to_${newState}`]
        if (handler) {
          await handler(context)
        }
      }
    }
  }
}

// Use the factories
api.addResource('orders', {
  schema: orderSchema,
  hooks: combineHooks(
    createAuditHooks(),
    
    createValidationHooks({
      create: {
        items: { required: true, minLength: 1 },
        shippingAddress: { required: true }
      },
      update: {
        status: { enum: ['pending', 'processing', 'shipped', 'delivered'] }
      }
    }),
    
    createStateMachineHooks({
      field: 'status',
      transitions: {
        'pending': ['processing', 'cancelled'],
        'processing': ['shipped', 'cancelled'],
        'shipped': ['delivered', 'returned'],
        'delivered': ['returned'],
        'cancelled': [],
        'returned': []
      },
      handlers: {
        'processing_to_shipped': async (context) => {
          // Generate tracking number
          context.data.trackingNumber = await generateTrackingNumber()
          context.data.shippedAt = new Date()
        }
      }
    })
  )
})
```

## Error Handling Best Practices

### Consistent Error Responses

Always return errors in a predictable format:

```javascript
// Define error types
class DomainError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.code = code
    this.details = details
    this.timestamp = new Date()
  }
  
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp,
        requestId: this.requestId
      }
    }
  }
}

// Specific error types
class ValidationError extends DomainError {
  constructor(fields) {
    const message = 'Validation failed'
    const details = { fields }
    super(message, 'VALIDATION_ERROR', details)
    this.status = 400
  }
}

class BusinessRuleError extends DomainError {
  constructor(rule, message) {
    super(message, 'BUSINESS_RULE_VIOLATION', { rule })
    this.status = 422
  }
}

class ConcurrencyError extends DomainError {
  constructor(resource, id) {
    super('Resource was modified by another process', 'CONCURRENCY_ERROR', {
      resource,
      id
    })
    this.status = 409
  }
}

// Use in hooks
api.addResource('accounts', {
  hooks: {
    beforeUpdate: async (context) => {
      // Check version for optimistic locking
      if (context.existing.version !== context.data.version) {
        throw new ConcurrencyError('accounts', context.id)
      }
      
      // Business rule validation
      if (context.data.balance < 0 && !context.existing.allowOverdraft) {
        throw new BusinessRuleError(
          'overdraft-protection',
          'Account does not allow negative balance'
        )
      }
      
      // Field validation
      if (context.data.email && !isValidEmail(context.data.email)) {
        throw new ValidationError({
          email: {
            value: context.data.email,
            message: 'Invalid email format'
          }
        })
      }
    }
  }
})

// Global error handler
api.use(ErrorHandlerPlugin, {
  handlers: {
    ValidationError: (error, context) => {
      return {
        status: 400,
        body: {
          error: 'Validation Failed',
          code: 'VALIDATION_ERROR',
          details: error.details.fields,
          requestId: context.requestId
        }
      }
    },
    
    BusinessRuleError: (error, context) => {
      return {
        status: 422,
        body: {
          error: error.message,
          code: error.code,
          rule: error.details.rule,
          requestId: context.requestId
        }
      }
    },
    
    // Default handler
    '*': (error, context) => {
      // Log unexpected errors
      console.error('Unexpected error:', {
        error: error.stack,
        context: {
          method: context.method,
          resource: context.resource,
          user: context.user?.id
        }
      })
      
      // Don't leak internal errors
      return {
        status: 500,
        body: {
          error: 'Internal Server Error',
          code: 'INTERNAL_ERROR',
          requestId: context.requestId
        }
      }
    }
  }
})
```

### Retry Logic

Build resilience into your API:

```javascript
// Retry configuration
const retryConfig = {
  maxAttempts: 3,
  backoff: 'exponential',
  initialDelay: 100,
  maxDelay: 5000,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT', 
    'ENOTFOUND',
    'NetworkError'
  ],
  retryableStatuses: [502, 503, 504]
}

// Retry wrapper
async function withRetry(fn, config = retryConfig) {
  let lastError
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      
      // Check if retryable
      const isRetryable = 
        config.retryableErrors.includes(error.code) ||
        config.retryableStatuses.includes(error.status) ||
        error.retryable === true
      
      if (!isRetryable || attempt === config.maxAttempts) {
        throw error
      }
      
      // Calculate delay
      const delay = config.backoff === 'exponential'
        ? Math.min(config.initialDelay * Math.pow(2, attempt - 1), config.maxDelay)
        : config.initialDelay
      
      console.log(`Retry attempt ${attempt} after ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  throw lastError
}

// Use in external service calls
api.hook('beforeInsert', async (context) => {
  if (context.resource === 'payments') {
    // Retry payment processing
    const result = await withRetry(async () => {
      return await paymentGateway.process({
        amount: context.data.amount,
        currency: context.data.currency,
        method: context.data.method
      })
    })
    
    context.data.gatewayResponse = result
  }
})
```

## Performance Best Practices

### Query Optimization

Design for performance from the start:

```javascript
// ❌ BAD: N+1 queries
api.addResource('posts', {
  hooks: {
    afterQuery: async (context) => {
      // This creates N+1 queries!
      for (const post of context.result) {
        post.author = await api.resources.users.get(post.authorId)
        post.comments = await api.resources.comments.query({
          filter: { postId: post.id }
        })
      }
    }
  }
})

// ✅ GOOD: Use joins and batch loading
api.addResource('posts', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    authorId: { 
      type: 'uuid', 
      refs: {
        resource: 'users',
        join: {
          eager: true,
          fields: ['id', 'name', 'avatar']
        }
      }
    }
  }),
  
  // Batch load related data
  hooks: {
    afterQuery: async (context) => {
      if (context.params.include?.includes('comments')) {
        const postIds = context.result.map(p => p.id)
        
        // Single query for all comments
        const comments = await api.resources.comments.query({
          filter: { postId: { $in: postIds } },
          sort: 'createdAt'
        })
        
        // Group by post
        const commentsByPost = comments.reduce((acc, comment) => {
          if (!acc[comment.postId]) acc[comment.postId] = []
          acc[comment.postId].push(comment)
          return acc
        }, {})
        
        // Assign to posts
        context.result.forEach(post => {
          post.comments = commentsByPost[post.id] || []
        })
      }
    }
  }
})

// Create indexes for common queries
api.addResource('products', {
  schema: new Schema({
    id: { type: 'uuid', generated: true },
    name: { type: 'string', required: true },
    category: { type: 'string', index: true },
    brand: { type: 'string', index: true },
    price: { type: 'decimal', index: true },
    status: { type: 'string', index: true },
    
    // Composite indexes for common queries
    indexes: [
      { fields: ['category', 'brand'] },
      { fields: ['status', 'price'] },
      { fields: ['brand', 'status', 'price'] }
    ]
  })
})
```

### Caching Strategy

Implement smart caching:

```javascript
// Cache configuration
const cacheConfig = {
  // Resource-level cache rules
  resources: {
    // Static data - cache aggressively
    countries: { ttl: 86400, strategy: 'cache-first' },
    currencies: { ttl: 86400, strategy: 'cache-first' },
    
    // User data - cache with invalidation
    users: { 
      ttl: 300, 
      strategy: 'stale-while-revalidate',
      invalidateOn: ['update', 'delete']
    },
    
    // Dynamic data - minimal caching
    orders: { ttl: 30, strategy: 'network-first' },
    
    // No caching for sensitive data
    payments: { ttl: 0 }
  },
  
  // Query-level cache rules
  queries: {
    // Cache filtered queries briefly
    default: { ttl: 60 },
    
    // Cache count queries longer
    count: { ttl: 300 },
    
    // Custom cache keys
    keyGenerator: (resource, params) => {
      const parts = [resource]
      
      if (params.filter) {
        parts.push('filter', JSON.stringify(params.filter))
      }
      if (params.sort) {
        parts.push('sort', params.sort)
      }
      if (params.page) {
        parts.push('page', params.page.number, params.page.size)
      }
      
      return parts.join(':')
    }
  }
}

// Implement caching
api.use(CachePlugin, {
  store: new RedisStore({ host: 'localhost' }),
  ...cacheConfig
})

// Manual cache control
api.hook('afterGet', async (context) => {
  if (context.resource === 'reports') {
    // Cache expensive reports
    context.cache = {
      ttl: 3600,
      tags: ['reports', `user:${context.user.id}`]
    }
  }
})

// Cache invalidation
api.hook('afterUpdate', async (context) => {
  if (context.resource === 'products') {
    // Invalidate related caches
    await context.cache.invalidate([
      `products:${context.id}`,
      `categories:${context.existing.category}`,
      `brands:${context.existing.brand}`
    ])
  }
})
```

### Pagination Best Practices

Always paginate list endpoints:

```javascript
// Configure default pagination
api.use(PaginationPlugin, {
  defaultLimit: 20,
  maxLimit: 100,
  
  // Cursor-based pagination for large datasets
  cursorPagination: {
    enabled: true,
    fields: ['createdAt', 'id'] // Sort by creation time, then ID
  }
})

// Resource-specific pagination
api.addResource('logs', {
  schema: logSchema,
  pagination: {
    defaultLimit: 50,
    maxLimit: 200,
    
    // Use cursor for time-series data
    cursor: {
      field: 'timestamp',
      direction: 'desc'
    }
  }
})

// Implement efficient counting
api.hook('beforeQuery', async (context) => {
  if (context.params.count && context.resource === 'orders') {
    // Use cached count for expensive queries
    const cacheKey = `count:orders:${JSON.stringify(context.params.filter)}`
    const cached = await cache.get(cacheKey)
    
    if (cached) {
      context.result = cached
      context.skip = true // Skip actual query
      return
    }
    
    // For large tables, use approximate count
    if (!context.params.filter) {
      const result = await db.query(
        'SELECT reltuples AS count FROM pg_class WHERE relname = $1',
        ['orders']
      )
      context.result = Math.floor(result.rows[0].count)
      context.skip = true
      
      // Cache the approximate count
      await cache.set(cacheKey, context.result, 300)
    }
  }
})
```

## Security Best Practices

### Input Validation

Never trust user input:

```javascript
// Comprehensive input validation
const securityMiddleware = {
  // Sanitize all input
  beforeOperation: async (context) => {
    if (context.data) {
      context.data = sanitizeObject(context.data)
    }
    
    if (context.params) {
      context.params = sanitizeObject(context.params)
    }
  }
}

function sanitizeObject(obj, depth = 0) {
  if (depth > 10) {
    throw new BadRequestError('Object nesting too deep')
  }
  
  const sanitized = {}
  
  for (const [key, value] of Object.entries(obj)) {
    // Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    
    // Sanitize key
    const cleanKey = key.replace(/[^\w.-]/g, '')
    
    // Sanitize value
    if (value === null || value === undefined) {
      sanitized[cleanKey] = value
    } else if (typeof value === 'string') {
      sanitized[cleanKey] = sanitizeString(value)
    } else if (typeof value === 'number') {
      sanitized[cleanKey] = sanitizeNumber(value)
    } else if (Array.isArray(value)) {
      sanitized[cleanKey] = value.map(v => 
        typeof v === 'object' ? sanitizeObject(v, depth + 1) : v
      )
    } else if (typeof value === 'object') {
      sanitized[cleanKey] = sanitizeObject(value, depth + 1)
    } else if (typeof value === 'boolean') {
      sanitized[cleanKey] = value
    }
    // Ignore functions and symbols
  }
  
  return sanitized
}

function sanitizeString(str) {
  return str
    .substring(0, 10000) // Limit length
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
}

function sanitizeNumber(num) {
  if (!Number.isFinite(num)) {
    throw new BadRequestError('Invalid number')
  }
  
  // Prevent extreme values
  if (Math.abs(num) > Number.MAX_SAFE_INTEGER) {
    throw new BadRequestError('Number too large')
  }
  
  return num
}

// SQL injection prevention
api.use(SqlProtectionPlugin, {
  // Whitelist allowed operators
  allowedOperators: ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'],
  
  // Prevent dangerous patterns
  blockPatterns: [
    /(\b)(DELETE|DROP|EXEC|EXECUTE|INSERT|UPDATE)(\b)/i,
    /(-{2}|\/\*|\*\/)/  // SQL comments
  ],
  
  // Parameterize all queries
  parameterize: true
})
```

### Rate Limiting

Protect against abuse:

```javascript
// Sophisticated rate limiting
api.use(RateLimitPlugin, {
  // Global limits
  global: {
    windowMs: 60 * 1000, // 1 minute
    max: 100 // 100 requests per minute
  },
  
  // Per-resource limits
  resources: {
    // Expensive operations get lower limits
    reports: { windowMs: 300000, max: 10 }, // 10 per 5 minutes
    exports: { windowMs: 3600000, max: 5 }, // 5 per hour
    
    // Auth endpoints
    login: { windowMs: 900000, max: 5 }, // 5 per 15 minutes
    register: { windowMs: 3600000, max: 3 } // 3 per hour
  },
  
  // Dynamic limits based on user tier
  dynamic: async (context) => {
    const user = context.user
    
    if (!user) {
      return { windowMs: 60000, max: 20 } // Anonymous: 20/min
    }
    
    switch (user.tier) {
      case 'free':
        return { windowMs: 60000, max: 60 } // Free: 60/min
      case 'pro':
        return { windowMs: 60000, max: 600 } // Pro: 600/min
      case 'enterprise':
        return { windowMs: 60000, max: 6000 } // Enterprise: 6000/min
      default:
        return { windowMs: 60000, max: 60 }
    }
  },
  
  // Cost-based limiting
  costFunction: (context) => {
    const costs = {
      get: 1,
      query: 5,
      insert: 10,
      update: 10,
      delete: 10,
      
      // Expensive operations
      export: 100,
      bulkUpdate: 50,
      report: 200
    }
    
    return costs[context.operation] || 1
  },
  
  // Response headers
  headers: true,
  
  // Custom error response
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: res.getHeader('Retry-After'),
      limit: res.getHeader('X-RateLimit-Limit'),
      remaining: res.getHeader('X-RateLimit-Remaining'),
      reset: res.getHeader('X-RateLimit-Reset')
    })
  }
})
```

## Monitoring and Observability

### Structured Logging

Log everything, but smartly:

```javascript
// Structured logging setup
import winston from 'winston'
import { ElasticsearchTransport } from 'winston-elasticsearch'

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  
  defaultMeta: {
    service: 'api',
    version: process.env.APP_VERSION,
    environment: process.env.NODE_ENV
  },
  
  transports: [
    // Console for development
    new winston.transports.Console({
      format: winston.format.simple(),
      level: 'debug'
    }),
    
    // Elasticsearch for production
    new ElasticsearchTransport({
      level: 'info',
      clientOpts: { node: process.env.ELASTIC_URL },
      index: 'api-logs'
    })
  ]
})

// Request logging middleware
api.use(LoggingPlugin, {
  logger,
  
  // What to log
  logRequest: true,
  logResponse: true,
  logErrors: true,
  
  // Sensitive field masking
  maskFields: [
    'password',
    'token',
    'authorization',
    'ssn',
    'creditCard',
    'cvv'
  ],
  
  // Custom log enrichment
  enrichLog: (log, context) => {
    return {
      ...log,
      userId: context.user?.id,
      tenantId: context.tenant?.id,
      requestId: context.requestId,
      userAgent: context.headers['user-agent'],
      ip: context.ip,
      
      // Performance metrics
      duration: context.endTime - context.startTime,
      dbQueries: context.queries?.length || 0,
      cacheHit: context.cacheHit || false
    }
  }
})

// Business event logging
class BusinessEventLogger {
  constructor(logger) {
    this.logger = logger
  }
  
  logEvent(event, context) {
    this.logger.info('business_event', {
      event: event.type,
      resource: event.resource,
      resourceId: event.resourceId,
      userId: context.user?.id,
      
      // Event-specific data
      data: this.sanitizeEventData(event.data),
      
      // Categorization
      category: this.categorizeEvent(event.type),
      severity: this.calculateSeverity(event),
      
      // Tracking
      timestamp: new Date(),
      correlationId: context.correlationId
    })
  }
  
  categorizeEvent(type) {
    const categories = {
      'user.registered': 'authentication',
      'user.login': 'authentication',
      'order.placed': 'commerce',
      'payment.processed': 'commerce',
      'account.suspended': 'security',
      'data.exported': 'compliance'
    }
    
    return categories[type] || 'other'
  }
  
  calculateSeverity(event) {
    const highSeverityEvents = [
      'account.suspended',
      'payment.failed',
      'security.breach',
      'data.leaked'
    ]
    
    return highSeverityEvents.includes(event.type) ? 'high' : 'normal'
  }
  
  sanitizeEventData(data) {
    // Remove sensitive fields
    const { password, token, ssn, ...safe } = data
    return safe
  }
}
```

### Metrics and Monitoring

Track what matters:

```javascript
// Prometheus metrics
import { register, Counter, Histogram, Gauge } from 'prom-client'

const metrics = {
  // Request metrics
  requestCount: new Counter({
    name: 'api_requests_total',
    help: 'Total number of API requests',
    labelNames: ['method', 'resource', 'status']
  }),
  
  requestDuration: new Histogram({
    name: 'api_request_duration_seconds',
    help: 'API request duration in seconds',
    labelNames: ['method', 'resource'],
    buckets: [0.1, 0.5, 1, 2, 5]
  }),
  
  // Business metrics
  resourceCount: new Gauge({
    name: 'api_resource_count',
    help: 'Number of resources by type',
    labelNames: ['resource']
  }),
  
  activeUsers: new Gauge({
    name: 'api_active_users',
    help: 'Number of active users',
    labelNames: ['tier']
  }),
  
  // Performance metrics
  dbConnections: new Gauge({
    name: 'api_db_connections',
    help: 'Number of database connections',
    labelNames: ['state']
  }),
  
  cacheHitRate: new Gauge({
    name: 'api_cache_hit_rate',
    help: 'Cache hit rate',
    labelNames: ['resource']
  })
}

// Collect metrics
api.hook('afterOperation', async (context) => {
  const labels = {
    method: context.method,
    resource: context.resource,
    status: context.response?.status || 'error'
  }
  
  metrics.requestCount.inc(labels)
  metrics.requestDuration.observe(
    { method: context.method, resource: context.resource },
    (Date.now() - context.startTime) / 1000
  )
})

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Health checks
app.get('/health', async (req, res) => {
  const health = await checkHealth()
  
  res.status(health.status === 'healthy' ? 200 : 503)
  res.json(health)
})

async function checkHealth() {
  const checks = {
    database: await checkDatabase(),
    cache: await checkCache(),
    external: await checkExternalServices()
  }
  
  const status = Object.values(checks).every(c => c.status === 'healthy')
    ? 'healthy'
    : 'unhealthy'
  
  return {
    status,
    timestamp: new Date(),
    version: process.env.APP_VERSION,
    uptime: process.uptime(),
    checks
  }
}
```

## Documentation Best Practices

### Self-Documenting APIs

Make your API discoverable:

```javascript
// OpenAPI documentation
api.use(OpenAPIPlugin, {
  info: {
    title: 'E-Commerce API',
    version: '2.0.0',
    description: 'Complete e-commerce platform API',
    contact: {
      email: 'api-support@company.com'
    }
  },
  
  // Security schemes
  security: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT'
    }
  },
  
  // Custom documentation per resource
  resources: {
    orders: {
      description: 'Order management endpoints',
      externalDocs: {
        url: 'https://docs.company.com/orders',
        description: 'Detailed order documentation'
      }
    }
  },
  
  // Example responses
  examples: true,
  
  // Include error responses
  errors: true
})

// Resource-level documentation
api.addResource('products', {
  description: 'Product catalog management',
  
  schema: new Schema({
    id: { 
      type: 'uuid', 
      description: 'Unique product identifier',
      example: '123e4567-e89b-12d3-a456-426614174000'
    },
    
    name: { 
      type: 'string', 
      description: 'Product display name',
      example: 'Premium Widget',
      minLength: 3,
      maxLength: 200
    },
    
    price: {
      type: 'object',
      description: 'Product pricing information',
      structure: {
        amount: { 
          type: 'decimal', 
          description: 'Price amount in minor units (cents)',
          example: 9999
        },
        currency: { 
          type: 'string', 
          description: 'ISO 4217 currency code',
          example: 'USD',
          enum: ['USD', 'EUR', 'GBP']
        }
      }
    }
  }),
  
  // Operation-specific docs
  operations: {
    query: {
      summary: 'List products',
      description: 'Retrieve a paginated list of products with optional filtering',
      parameters: {
        category: {
          description: 'Filter by product category',
          example: 'electronics'
        },
        minPrice: {
          description: 'Minimum price filter (in cents)',
          example: 1000
        }
      }
    },
    
    get: {
      summary: 'Get product details',
      description: 'Retrieve detailed information about a specific product'
    },
    
    insert: {
      summary: 'Create new product',
      description: 'Add a new product to the catalog (requires admin role)'
    }
  }
})

// Generate documentation site
api.generateDocs({
  output: './docs',
  format: 'html',
  theme: 'corporate',
  
  // Include code examples
  examples: {
    languages: ['javascript', 'python', 'curl']
  }
})
```

## Testing Best Practices

### Comprehensive Test Coverage

Test everything that matters:

```javascript
// Test utilities
class ApiTestClient {
  constructor(api) {
    this.api = api
    this.tokens = new Map()
  }
  
  async asUser(username, fn) {
    const token = await this.getToken(username)
    const previousToken = this.currentToken
    
    this.currentToken = token
    try {
      return await fn()
    } finally {
      this.currentToken = previousToken
    }
  }
  
  async getToken(username) {
    if (!this.tokens.has(username)) {
      const token = await this.authenticate(username)
      this.tokens.set(username, token)
    }
    return this.tokens.get(username)
  }
  
  // Wrapped API methods
  async get(resource, id, options = {}) {
    return this.api.resources[resource].get(id, {
      ...options,
      user: this.currentUser
    })
  }
  
  async query(resource, params = {}, options = {}) {
    return this.api.resources[resource].query(params, {
      ...options,
      user: this.currentUser
    })
  }
  
  // ... other methods
}

// Integration tests
describe('Order API', () => {
  let api, client
  
  beforeAll(async () => {
    api = await createTestApi()
    client = new ApiTestClient(api)
  })
  
  describe('Order Creation', () => {
    test('should create order with valid data', async () => {
      await client.asUser('customer', async () => {
        const order = await client.insert('orders', {
          items: [
            { productId: 'prod-1', quantity: 2 }
          ],
          shippingAddress: mockAddress()
        })
        
        expect(order).toMatchObject({
          id: expect.any(String),
          status: 'pending',
          total: expect.any(Number)
        })
      })
    })
    
    test('should prevent ordering out-of-stock items', async () => {
      // Set up: Mark product as out of stock
      await client.asUser('admin', async () => {
        await client.update('inventory', 'prod-2', {
          available: 0
        })
      })
      
      // Test: Try to order
      await client.asUser('customer', async () => {
        await expect(
          client.insert('orders', {
            items: [{ productId: 'prod-2', quantity: 1 }]
          })
        ).rejects.toThrow('out of stock')
      })
    })
    
    test('should apply business rules', async () => {
      await client.asUser('customer', async () => {
        // Minimum order value
        await expect(
          client.insert('orders', {
            items: [{ productId: 'cheap-item', quantity: 1 }]
          })
        ).rejects.toThrow('Minimum order value is $10')
        
        // Maximum quantity per item
        await expect(
          client.insert('orders', {
            items: [{ productId: 'limited-item', quantity: 100 }]
          })
        ).rejects.toThrow('Maximum quantity per item is 10')
      })
    })
  })
  
  describe('Order State Transitions', () => {
    let orderId
    
    beforeEach(async () => {
      await client.asUser('customer', async () => {
        const order = await client.insert('orders', validOrder())
        orderId = order.id
      })
    })
    
    test('should follow valid state transitions', async () => {
      await client.asUser('admin', async () => {
        // pending → processing
        await client.update('orders', orderId, { status: 'processing' })
        
        // processing → shipped
        await client.update('orders', orderId, { status: 'shipped' })
        
        // shipped → delivered
        await client.update('orders', orderId, { status: 'delivered' })
      })
    })
    
    test('should prevent invalid state transitions', async () => {
      await client.asUser('admin', async () => {
        // pending → delivered (invalid)
        await expect(
          client.update('orders', orderId, { status: 'delivered' })
        ).rejects.toThrow('Invalid transition')
      })
    })
  })
})

// Performance tests
describe('Performance', () => {
  test('should handle concurrent requests', async () => {
    const promises = Array(100).fill(0).map((_, i) => 
      client.query('products', {
        filter: { category: 'electronics' },
        page: { number: i % 10 }
      })
    )
    
    const start = Date.now()
    await Promise.all(promises)
    const duration = Date.now() - start
    
    expect(duration).toBeLessThan(5000) // 5 seconds for 100 requests
  })
  
  test('should optimize queries', async () => {
    const start = Date.now()
    
    const orders = await client.query('orders', {
      include: ['customer', 'items.product'],
      filter: { status: 'delivered' },
      limit: 100
    })
    
    const duration = Date.now() - start
    
    // Should use joins, not N+1 queries
    expect(duration).toBeLessThan(500) // 500ms for complex query
    expect(orders[0].customer).toBeDefined()
    expect(orders[0].items[0].product).toBeDefined()
  })
})
```

## Real-World Implementation Example

Let's implement a complete financial services API using all these best practices:

```javascript
// Financial Services API
import { 
  Api, 
  Schema,
  MySQLPlugin,
  ValidationPlugin,
  AuthorizationPlugin,
  AuditPlugin,
  EncryptionPlugin,
  RateLimitPlugin,
  MonitoringPlugin,
  OpenAPIPlugin
} from 'json-rest-api'

class FinancialServicesAPI {
  async initialize() {
    this.api = new Api()
    
    // Core plugins
    this.setupStorage()
    this.setupSecurity()
    this.setupMonitoring()
    
    // Define resources
    this.defineSchemas()
    this.defineResources()
    this.setupBusinessRules()
    
    // Documentation
    this.setupDocumentation()
    
    return this.api
  }
  
  setupStorage() {
    this.api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'financial',
      pool: {
        min: 10,
        max: 100,
        acquireTimeoutMs: 30000
      },
      
      // Read replicas for queries
      replicas: [
        { host: process.env.DB_REPLICA_1 },
        { host: process.env.DB_REPLICA_2 }
      ]
    })
  }
  
  setupSecurity() {
    // Encryption for sensitive data
    this.api.use(EncryptionPlugin, {
      algorithm: 'aes-256-gcm',
      fields: ['ssn', 'accountNumber', 'routingNumber', 'taxId']
    })
    
    // Authentication & Authorization
    this.api.use(AuthorizationPlugin, {
      rbac: {
        roles: {
          customer: {
            accounts: ['read:own', 'update:own'],
            transactions: ['read:own'],
            transfers: ['create:own']
          },
          
          teller: {
            accounts: ['read', 'update'],
            transactions: ['read', 'create'],
            transfers: ['create', 'approve:small']
          },
          
          manager: {
            accounts: ['*'],
            transactions: ['*'],
            transfers: ['*'],
            reports: ['read', 'create']
          }
        }
      }
    })
    
    // Rate limiting by operation cost
    this.api.use(RateLimitPlugin, {
      costFunction: (context) => {
        const costs = {
          'GET /accounts': 1,
          'GET /transactions': 5,
          'POST /transfers': 20,
          'POST /reports': 100
        }
        
        const key = `${context.method} ${context.path}`
        return costs[key] || 10
      },
      
      limits: {
        anonymous: { budget: 100, window: '1h' },
        customer: { budget: 1000, window: '1h' },
        teller: { budget: 10000, window: '1h' },
        manager: { budget: 100000, window: '1h' }
      }
    })
  }
  
  setupMonitoring() {
    this.api.use(MonitoringPlugin, {
      prometheus: true,
      
      // Business metrics
      customMetrics: {
        dailyTransactionVolume: new Gauge({
          name: 'financial_daily_transaction_volume_usd',
          help: 'Daily transaction volume in USD'
        }),
        
        fraudulentTransactions: new Counter({
          name: 'financial_fraudulent_transactions_total',
          help: 'Total fraudulent transactions detected'
        })
      },
      
      // Alerts
      alerts: {
        highValueTransaction: {
          condition: (context) => 
            context.resource === 'transactions' && 
            context.data?.amount > 10000,
          action: async (context) => {
            await notifyCompliance({
              type: 'HIGH_VALUE_TRANSACTION',
              amount: context.data.amount,
              accountId: context.data.accountId
            })
          }
        }
      }
    })
    
    // Audit everything
    this.api.use(AuditPlugin, {
      storage: 'audit_logs',
      
      // What to audit
      events: ['*'],
      
      // Enhanced audit data
      enhance: async (entry, context) => {
        return {
          ...entry,
          ip: context.request.ip,
          userAgent: context.request.headers['user-agent'],
          sessionId: context.session?.id,
          
          // Compliance data
          regulatoryFlags: await checkRegulatory(context)
        }
      }
    })
  }
  
  defineSchemas() {
    // Reusable domain types
    this.types = {
      money: {
        type: 'object',
        required: true,
        structure: {
          amount: { 
            type: 'decimal', 
            precision: 19, 
            scale: 4,
            min: 0
          },
          currency: { 
            type: 'string', 
            length: 3,
            enum: ['USD', 'EUR', 'GBP', 'JPY']
          }
        }
      },
      
      accountNumber: {
        type: 'string',
        pattern: /^\d{10,12}$/,
        encrypted: true
      },
      
      routingNumber: {
        type: 'string',
        pattern: /^\d{9}$/,
        encrypted: true
      }
    }
    
    // Account schema
    this.accountSchema = new Schema({
      id: { type: 'uuid', generated: true },
      
      // Account identification
      accountNumber: { ...this.types.accountNumber, unique: true },
      type: { 
        type: 'string',
        enum: ['checking', 'savings', 'money_market', 'cd'],
        required: true
      },
      
      // Ownership
      customerId: { type: 'uuid', refs: 'customers', required: true },
      jointOwners: {
        type: 'array',
        items: { type: 'uuid', refs: 'customers' }
      },
      
      // Balances
      currentBalance: { ...this.types.money },
      availableBalance: { ...this.types.money },
      pendingDebits: { ...this.types.money },
      pendingCredits: { ...this.types.money },
      
      // Account status
      status: {
        type: 'string',
        enum: ['active', 'frozen', 'closed'],
        default: 'active'
      },
      
      // Limits and rules
      overdraftProtection: { type: 'boolean', default: false },
      overdraftLimit: { ...this.types.money },
      dailyWithdrawalLimit: { ...this.types.money },
      
      // Compliance
      kycStatus: {
        type: 'string',
        enum: ['pending', 'verified', 'failed'],
        default: 'pending'
      },
      
      // Metadata
      openedAt: { type: 'timestamp', generated: true },
      closedAt: { type: 'timestamp' },
      lastActivityAt: { type: 'timestamp' }
    })
    
    // Transaction schema
    this.transactionSchema = new Schema({
      id: { type: 'uuid', generated: true },
      
      // Transaction details
      accountId: { type: 'uuid', refs: 'accounts', required: true },
      type: {
        type: 'string',
        enum: ['debit', 'credit', 'fee', 'interest', 'adjustment'],
        required: true
      },
      
      // Amounts
      amount: { ...this.types.money, required: true },
      balanceBefore: { ...this.types.money },
      balanceAfter: { ...this.types.money },
      
      // Description
      description: { type: 'string', maxLength: 200, required: true },
      category: { type: 'string' },
      
      // Related entities
      relatedTransactionId: { type: 'uuid', refs: 'transactions' },
      transferId: { type: 'uuid', refs: 'transfers' },
      
      // Processing info
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed', 'reversed'],
        default: 'pending'
      },
      
      // Timestamps
      createdAt: { type: 'timestamp', generated: true },
      processedAt: { type: 'timestamp' },
      settledAt: { type: 'timestamp' }
    })
  }
  
  defineResources() {
    // Accounts with business logic
    this.api.addResource('accounts', {
      schema: this.accountSchema,
      
      hooks: combineHooks(
        createAuditHooks(),
        createValidationHooks({
          create: {
            customerId: { required: true },
            type: { required: true },
            initialDeposit: { min: this.getMinimumBalance }
          }
        }),
        
        // Business rules
        {
          beforeInsert: async (context) => {
            // Generate account number
            context.data.accountNumber = await this.generateAccountNumber()
            
            // Set initial balances
            const initialDeposit = context.data.initialDeposit || { amount: 0, currency: 'USD' }
            context.data.currentBalance = initialDeposit
            context.data.availableBalance = initialDeposit
            context.data.pendingDebits = { amount: 0, currency: initialDeposit.currency }
            context.data.pendingCredits = { amount: 0, currency: initialDeposit.currency }
            
            delete context.data.initialDeposit
          },
          
          beforeUpdate: async (context) => {
            // Prevent closed account modifications
            if (context.existing.status === 'closed') {
              throw new BusinessRuleError(
                'closed-account',
                'Cannot modify closed account'
              )
            }
            
            // Track status changes
            if (context.data.status === 'closed' && context.existing.status !== 'closed') {
              context.data.closedAt = new Date()
              
              // Check for remaining balance
              if (context.existing.currentBalance.amount > 0) {
                throw new BusinessRuleError(
                  'account-has-balance',
                  'Cannot close account with remaining balance'
                )
              }
            }
          }
        }
      )
    })
    
    // Transactions with consistency
    this.api.addResource('transactions', {
      schema: this.transactionSchema,
      
      hooks: combineHooks(
        createAuditHooks(),
        
        {
          beforeInsert: async (context) => {
            const account = await this.api.resources.accounts.get(
              context.data.accountId
            )
            
            // Check account status
            if (account.status !== 'active') {
              throw new BusinessRuleError(
                'account-not-active',
                'Account is not active'
              )
            }
            
            // Record balance before
            context.data.balanceBefore = { ...account.currentBalance }
            
            // Calculate new balance
            const newBalance = this.calculateNewBalance(
              account.currentBalance,
              context.data.type,
              context.data.amount
            )
            
            // Check overdraft
            if (newBalance.amount < 0) {
              if (!account.overdraftProtection) {
                throw new BusinessRuleError(
                  'insufficient-funds',
                  'Insufficient funds'
                )
              }
              
              const overdraftUsed = Math.abs(newBalance.amount)
              if (overdraftUsed > account.overdraftLimit.amount) {
                throw new BusinessRuleError(
                  'overdraft-limit-exceeded',
                  'Overdraft limit exceeded'
                )
              }
            }
            
            context.data.balanceAfter = newBalance
            
            // Store account update in context
            context.accountUpdate = {
              currentBalance: newBalance,
              lastActivityAt: new Date()
            }
          },
          
          afterInsert: async (context) => {
            // Update account balance atomically
            await this.api.resources.accounts.update(
              context.data.accountId,
              context.accountUpdate,
              { 
                atomic: true,
                condition: {
                  currentBalance: context.data.balanceBefore
                }
              }
            )
            
            // Check for suspicious activity
            await this.checkFraudRules(context.result)
          }
        }
      )
    })
  }
  
  setupBusinessRules() {
    // Minimum balance requirements
    this.getMinimumBalance = (accountType) => {
      const minimums = {
        checking: 0,
        savings: 25,
        money_market: 2500,
        cd: 1000
      }
      
      return {
        amount: minimums[accountType] || 0,
        currency: 'USD'
      }
    }
    
    // Balance calculation
    this.calculateNewBalance = (currentBalance, transactionType, amount) => {
      if (amount.currency !== currentBalance.currency) {
        throw new BusinessRuleError(
          'currency-mismatch',
          'Transaction currency must match account currency'
        )
      }
      
      const multipliers = {
        debit: -1,
        credit: 1,
        fee: -1,
        interest: 1,
        adjustment: 1
      }
      
      const multiplier = multipliers[transactionType]
      const newAmount = currentBalance.amount + (amount.amount * multiplier)
      
      return {
        amount: newAmount,
        currency: currentBalance.currency
      }
    }
    
    // Fraud detection
    this.checkFraudRules = async (transaction) => {
      const rules = [
        // Velocity check
        async () => {
          const recentCount = await this.api.resources.transactions.query({
            filter: {
              accountId: transaction.accountId,
              createdAt: { $gt: new Date(Date.now() - 3600000) } // Last hour
            },
            count: true
          })
          
          if (recentCount > 10) {
            return { suspicious: true, reason: 'High transaction velocity' }
          }
        },
        
        // Amount check
        async () => {
          if (transaction.amount.amount > 10000) {
            return { suspicious: true, reason: 'High value transaction' }
          }
        },
        
        // Pattern check
        async () => {
          const similarTransactions = await this.api.resources.transactions.query({
            filter: {
              accountId: transaction.accountId,
              amount: transaction.amount,
              description: transaction.description
            },
            limit: 5
          })
          
          if (similarTransactions.length > 3) {
            return { suspicious: true, reason: 'Repeated transaction pattern' }
          }
        }
      ]
      
      for (const rule of rules) {
        const result = await rule()
        if (result?.suspicious) {
          await this.flagTransaction(transaction, result.reason)
          break
        }
      }
    }
  }
  
  setupDocumentation() {
    this.api.use(OpenAPIPlugin, {
      info: {
        title: 'Financial Services API',
        version: '1.0.0',
        description: 'Secure banking and financial services API'
      },
      
      tags: [
        {
          name: 'Accounts',
          description: 'Bank account management'
        },
        {
          name: 'Transactions',
          description: 'Transaction history and processing'
        },
        {
          name: 'Transfers',
          description: 'Money transfers between accounts'
        }
      ],
      
      // Security requirements
      security: [
        { bearerAuth: [] }
      ],
      
      // Webhook documentation
      webhooks: {
        transactionCompleted: {
          post: {
            summary: 'Transaction completed',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Transaction' }
                }
              }
            }
          }
        }
      }
    })
  }
}

// Initialize and start
const financialAPI = new FinancialServicesAPI()
const api = await financialAPI.initialize()

export { api }
```

## Summary

These best practices come from real-world experience building and maintaining enterprise APIs. Key takeaways:

1. **Design for clarity** - Clear resource names, consistent patterns
2. **Plan for change** - Version from day one, use migrations
3. **Separate concerns** - Hooks by purpose, not by lifecycle
4. **Fail gracefully** - Consistent errors, helpful messages
5. **Monitor everything** - Logs, metrics, traces
6. **Document as you build** - Self-documenting APIs
7. **Test comprehensively** - Unit, integration, performance

Remember: Good practices compound. Each one makes the others easier to implement.

Next chapter: [Migration Strategies →](./ENTERPRISE_GUIDE_05_Migration_Strategies.md)