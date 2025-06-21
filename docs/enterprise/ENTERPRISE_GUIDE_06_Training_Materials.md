# Enterprise Guide: Chapter 6 - Training Materials

## The Training Challenge

I once watched a Fortune 100 company try to train 500 developers on their new API architecture. Their approach?

**Day 1**: 8 hours of PowerPoint slides  
**Day 2**: 8 more hours of PowerPoint slides  
**Day 3**: "Now go build microservices!"

Result: Complete chaos. Teams built incompatible services, duplicated functionality, and created a distributed monolith worse than what they started with.

This chapter provides battle-tested training materials that actually work.

## Training Philosophy

### The 10-20-70 Rule

Effective API training follows the 10-20-70 model:
- **10%** Formal instruction (concepts, theory)
- **20%** Learning from others (pair programming, code reviews)
- **70%** Hands-on experience (building real things)

Most corporate training does 90% instruction, 10% hands-on. That's why it fails.

## Workshop 1: API Fundamentals (2 Days)

### Day 1 Morning: Core Concepts (2 hours)

#### Opening Exercise: The API Disaster

```javascript
// Start with this broken code
// Ask: "What's wrong with this API?"

app.get('/get-user-data', (req, res) => {
  const userId = req.query.user_id
  const userData = db.query(`SELECT * FROM users WHERE id = ${userId}`)
  res.send(userData)
})

app.post('/update-user-info', (req, res) => {
  const sql = `UPDATE users SET ${req.body.fields} WHERE id = ${req.body.id}`
  db.execute(sql)
  res.send('OK')
})

app.delete('/DELETE_USER!!!', (req, res) => {
  db.execute(`DELETE FROM users WHERE id = ${req.params.id}`)
  res.send('User deleted forever!')
})

// Teams identify 15+ problems:
// - SQL injection
// - No validation
// - Inconsistent naming
// - No error handling
// - No authentication
// - Wrong HTTP methods
// - No versioning
// - Returns raw DB data
// etc.
```

This exercise immediately shows why we need structured APIs.

#### Hands-On: Building Your First Resource (1 hour)

```javascript
// Live coding session - build together
import { Api, Schema, MemoryPlugin } from 'json-rest-api'

const api = new Api()
api.use(MemoryPlugin)

// Start simple
const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
})

api.addResource('users', { schema: userSchema })

// Test immediately
const user = await api.resources.users.insert({
  name: 'John Doe',
  email: 'john@example.com'
})

console.log('Created:', user)

// Common mistake #1: Wrong data types
try {
  await api.resources.users.insert({
    name: 123, // Wrong type!
    email: 'bad@example.com'
  })
} catch (error) {
  console.log('Validation works!', error.message)
}

// Build up complexity gradually
const enhancedSchema = new Schema({
  name: { type: 'string', required: true, min: 2, max: 50 },
  email: { type: 'string', required: true, pattern: /^[^@]+@[^@]+\.[^@]+$/ },
  age: { type: 'number', min: 0, max: 150 },
  role: { type: 'string', enum: ['user', 'admin'], default: 'user' }
})

// Key learning: Schemas prevent bugs before they happen
```

#### Interactive Lab: Schema Design Challenge (1 hour)

```javascript
// Challenge: Design schemas for a real e-commerce system
// Teams work in pairs, then present solutions

// Team 1 might create:
const productSchema = new Schema({
  name: { type: 'string', required: true },
  price: { type: 'number', required: true },
  stock: { type: 'number', default: 0 }
})

// Instructor asks: "What about currency? What about negative prices?"
// Iterate to better design:

const moneyType = {
  type: 'object',
  structure: {
    amount: { type: 'number', required: true, min: 0 },
    currency: { type: 'string', required: true, length: 3 }
  }
}

const improvedProductSchema = new Schema({
  name: { type: 'string', required: true, min: 1, max: 200 },
  sku: { type: 'string', required: true, unique: true, pattern: /^[A-Z0-9-]+$/ },
  price: { ...moneyType, required: true },
  compareAtPrice: moneyType,
  stock: { 
    type: 'object',
    structure: {
      available: { type: 'number', min: 0, default: 0 },
      reserved: { type: 'number', min: 0, default: 0 }
    }
  },
  status: { type: 'string', enum: ['draft', 'active', 'archived'], default: 'draft' }
})

// Key learning: Good schemas model your domain accurately
```

### Day 1 Afternoon: Querying and Relationships (4 hours)

#### Hands-On: Query Operations (1 hour)

```javascript
// Set up test data
const setupTestData = async (api) => {
  // Create categories
  const electronics = await api.resources.categories.insert({ 
    name: 'Electronics',
    slug: 'electronics'
  })
  
  const computers = await api.resources.categories.insert({
    name: 'Computers',
    slug: 'computers',
    parentId: electronics.id
  })
  
  // Create products
  const products = [
    { name: 'Laptop Pro', price: 1299, categoryId: computers.id, brand: 'TechCorp' },
    { name: 'Laptop Air', price: 999, categoryId: computers.id, brand: 'TechCorp' },
    { name: 'Desktop Beast', price: 1999, categoryId: computers.id, brand: 'PowerTech' },
    { name: 'Budget Desktop', price: 599, categoryId: computers.id, brand: 'ValueBrand' }
  ]
  
  for (const product of products) {
    await api.resources.products.insert(product)
  }
}

// Exercise 1: Basic Filtering
const expensive = await api.resources.products.query({
  filter: { price: { $gt: 1000 } }
})

// Exercise 2: Multiple Filters
const techCorpLaptops = await api.resources.products.query({
  filter: {
    brand: 'TechCorp',
    name: { $like: '%Laptop%' }
  }
})

// Exercise 3: Sorting and Pagination
const cheapestFirst = await api.resources.products.query({
  sort: 'price',
  page: { size: 2, number: 1 }
})

// Exercise 4: Complex Queries
const query = await api.resources.products.query({
  filter: {
    $or: [
      { price: { $lt: 700 } },
      { brand: 'TechCorp' }
    ]
  },
  sort: '-price',
  fields: ['name', 'price']
})

// Common mistakes to address:
// 1. Forgetting to make fields searchable
// 2. Using wrong operators
// 3. Not understanding pagination
```

#### Deep Dive: Relationships Workshop (2 hours)

```javascript
// Part 1: Understanding Relationships
const orderSchema = new Schema({
  orderNumber: { type: 'string', required: true },
  customerId: { 
    type: 'id',
    refs: 'customers' // Simple reference
  },
  items: {
    type: 'array',
    items: {
      productId: { type: 'id', refs: 'products' },
      quantity: { type: 'number', min: 1 }
    }
  }
})

// Part 2: Include Pattern
const orders = await api.resources.orders.query({
  include: 'customerId'
})

// Explain the JSON:API response format
console.log('Order data:', orders.data)
console.log('Included customers:', orders.included)

// Part 3: Nested Includes
const deepQuery = await api.resources.orders.query({
  include: 'customerId.addressId.countryId'
})

// Part 4: Performance Considerations
// Show N+1 query problem
const badWay = async () => {
  const orders = await api.resources.orders.query()
  for (const order of orders) {
    order.customer = await api.resources.customers.get(order.customerId)
  }
  // This makes N+1 queries!
}

const goodWay = async () => {
  const orders = await api.resources.orders.query({
    include: 'customerId'
  })
  // This makes 2 queries total!
}

// Exercise: Design a relationship model
// Teams design schemas for: Users → Posts → Comments → Reactions
// Then implement and test the includes
```

#### Practical Exercise: Building a Blog API (1 hour)

```javascript
// Teams build a complete blog API
// Requirements:
// - Users can create posts
// - Posts have categories (many-to-many)
// - Users can comment on posts
// - Comments can be nested (replies)

// Instructor provides skeleton:
class BlogAPIWorkshop {
  async setup() {
    this.api = new Api()
    this.api.use(MemoryPlugin)
    
    // TODO: Add schemas
    this.defineSchemas()
    
    // TODO: Add relationships
    this.defineRelationships()
    
    // TODO: Add business logic
    this.addBusinessLogic()
  }
  
  defineSchemas() {
    // Teams implement this
  }
  
  defineRelationships() {
    // Teams implement this
  }
  
  addBusinessLogic() {
    // Teams implement this
  }
}

// Review solutions as a group
// Discuss different approaches and trade-offs
```

### Day 2 Morning: Hooks and Business Logic (3 hours)

#### Interactive Demo: Hook Lifecycle (1 hour)

```javascript
// Visual demonstration of hook flow
const api = new Api()

// Add logging to every hook
const hookLogger = (hookName) => ({
  priority: 0,
  handler: async (context) => {
    console.log(`[${hookName}] Resource: ${context.resource}, Method: ${context.method}`)
    console.log(`[${hookName}] Data:`, context.data)
    console.log('---')
  }
})

api.hook('beforeOperation', hookLogger('beforeOperation'))
api.hook('beforeInsert', hookLogger('beforeInsert'))
api.hook('afterInsert', hookLogger('afterInsert'))
api.hook('afterOperation', hookLogger('afterOperation'))

// Run operations and watch the flow
await api.resources.users.insert({ name: 'Test User' })

// Key insights:
// 1. Hooks run in specific order
// 2. Context flows through all hooks
// 3. Any hook can modify context
// 4. Errors stop the chain
```

#### Hands-On: Common Hook Patterns (2 hours)

```javascript
// Pattern 1: Audit Trail
const auditHooks = {
  beforeInsert: async (context) => {
    context.data.createdAt = new Date()
    context.data.createdBy = context.user?.id || 'system'
  },
  
  beforeUpdate: async (context) => {
    context.data.updatedAt = new Date()
    context.data.updatedBy = context.user?.id || 'system'
    
    // Store what changed
    context.data.lastModified = {
      fields: Object.keys(context.changes),
      timestamp: new Date()
    }
  }
}

// Pattern 2: Computed Fields
const computedFieldHooks = {
  beforeInsert: async (context) => {
    if (context.resource === 'users') {
      // Compute full name
      context.data.fullName = `${context.data.firstName} ${context.data.lastName}`
      
      // Compute age from birthdate
      if (context.data.birthDate) {
        context.data.age = calculateAge(context.data.birthDate)
      }
    }
  },
  
  afterQuery: async (context) => {
    // Add computed fields to query results
    for (const record of context.result) {
      record.displayName = record.fullName || record.email
    }
  }
}

// Pattern 3: Business Rules
const businessRuleHooks = {
  beforeInsert: async (context) => {
    if (context.resource === 'orders') {
      // Validate inventory
      for (const item of context.data.items) {
        const stock = await checkStock(item.productId)
        if (stock < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.productId}`)
        }
      }
      
      // Calculate totals
      context.data.subtotal = calculateSubtotal(context.data.items)
      context.data.tax = context.data.subtotal * 0.08
      context.data.total = context.data.subtotal + context.data.tax
    }
  }
}

// Exercise: Implement a discount system
// Requirements:
// - Coupons give percentage or fixed discount
// - Some coupons have minimum order amount
// - Coupons can expire
// - One coupon per order
// Teams implement hooks to handle this
```

### Day 2 Afternoon: Plugins and Production (3 hours)

#### Building Custom Plugins Workshop (1.5 hours)

```javascript
// Live coding: Build a real plugin together
export const MetricsPlugin = {
  install(api, options = {}) {
    const metrics = {
      requests: new Map(),
      errors: new Map(),
      performance: new Map()
    }
    
    // Track all operations
    api.hook('beforeOperation', async (context) => {
      context.startTime = Date.now()
      
      const key = `${context.method}:${context.resource}`
      metrics.requests.set(key, (metrics.requests.get(key) || 0) + 1)
    })
    
    api.hook('afterOperation', async (context) => {
      const duration = Date.now() - context.startTime
      const key = `${context.method}:${context.resource}`
      
      if (!metrics.performance.has(key)) {
        metrics.performance.set(key, [])
      }
      metrics.performance.get(key).push(duration)
    })
    
    api.hook('error', async (context) => {
      const key = `${context.method}:${context.resource}`
      metrics.errors.set(key, (metrics.errors.get(key) || 0) + 1)
    })
    
    // Expose metrics endpoint
    if (options.endpoint) {
      api.addCustomRoute('GET', options.endpoint, async (req, res) => {
        const report = {
          requests: Object.fromEntries(metrics.requests),
          errors: Object.fromEntries(metrics.errors),
          performance: {}
        }
        
        // Calculate performance stats
        for (const [key, durations] of metrics.performance) {
          report.performance[key] = {
            count: durations.length,
            min: Math.min(...durations),
            max: Math.max(...durations),
            avg: durations.reduce((a, b) => a + b, 0) / durations.length,
            p95: percentile(durations, 0.95),
            p99: percentile(durations, 0.99)
          }
        }
        
        res.json(report)
      })
    }
  }
}

// Use the plugin
api.use(MetricsPlugin, { endpoint: '/metrics' })

// Exercise: Teams build their own plugins
// Ideas:
// - CachePlugin - Cache GET requests
// - RateLimitPlugin - Limit requests per user
// - WebhookPlugin - Send webhooks on changes
// - ValidationPlugin - Custom validation rules
```

#### Production Deployment Workshop (1.5 hours)

```javascript
// Real deployment scenarios

// Scenario 1: Database Setup
const productionSetup = async () => {
  const api = new Api()
  
  // Use MySQL in production
  api.use(MySQLPlugin, {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    
    // Production settings
    connectionLimit: 20,
    ssl: { rejectUnauthorized: true },
    timezone: 'Z'
  })
  
  // Add production plugins
  api.use(LoggingPlugin, {
    level: 'info',
    transport: 'elasticsearch'
  })
  
  api.use(MonitoringPlugin, {
    apm: 'datadog',
    tracing: true
  })
  
  api.use(SecurityPlugin, {
    rateLimit: { window: 60000, max: 100 },
    cors: { origins: process.env.ALLOWED_ORIGINS.split(',') },
    helmet: true
  })
  
  return api
}

// Scenario 2: Zero-Downtime Migration
class ZeroDowntimeMigration {
  async execute() {
    // Step 1: Deploy new version alongside old
    console.log('Deploying new version...')
    await this.deployNewVersion()
    
    // Step 2: Test new version
    console.log('Running smoke tests...')
    await this.runSmokeTests()
    
    // Step 3: Gradually shift traffic
    console.log('Shifting traffic...')
    await this.shiftTraffic(10) // 10%
    await this.monitorMetrics(5 * 60 * 1000) // 5 minutes
    
    await this.shiftTraffic(50) // 50%
    await this.monitorMetrics(10 * 60 * 1000) // 10 minutes
    
    await this.shiftTraffic(100) // 100%
    
    // Step 4: Decommission old version
    console.log('Decommissioning old version...')
    await this.decommissionOld()
  }
}

// Exercise: Deploy to cloud
// Teams get cloud accounts and deploy their APIs
// Cover:
// - Environment variables
// - Database connections
// - Health checks
// - Logging
// - Monitoring
```

## Workshop 2: Advanced Patterns (2 Days)

### Day 1: Microservices and Bounded Contexts

#### Morning Session: Breaking the Monolith (4 hours)

```javascript
// Start with a monolithic schema
const monolithSchema = {
  users: new Schema({
    // User fields
    email: { type: 'string' },
    password: { type: 'string' },
    
    // Profile fields
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    
    // Billing fields
    creditCard: { type: 'string' },
    billingAddress: { type: 'object' },
    
    // Preferences
    notifications: { type: 'object' },
    theme: { type: 'string' }
  }),
  
  products: new Schema({
    // Product fields
    name: { type: 'string' },
    price: { type: 'number' },
    
    // Inventory fields
    stock: { type: 'number' },
    warehouse: { type: 'string' },
    
    // Vendor fields
    vendorId: { type: 'string' },
    vendorPrice: { type: 'number' }
  })
}

// Exercise: Break into bounded contexts
// Teams identify boundaries and create separate services

// Solution discussion:
const contexts = {
  identity: {
    purpose: 'Authentication and basic user info',
    schemas: {
      users: new Schema({
        email: { type: 'string' },
        passwordHash: { type: 'string' },
        emailVerified: { type: 'boolean' }
      })
    }
  },
  
  profile: {
    purpose: 'User profiles and preferences',
    schemas: {
      profiles: new Schema({
        userId: { type: 'id' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        preferences: { type: 'object' }
      })
    }
  },
  
  billing: {
    purpose: 'Payment and billing',
    schemas: {
      paymentMethods: new Schema({
        userId: { type: 'id' },
        type: { type: 'string' },
        token: { type: 'string', encrypted: true }
      })
    }
  },
  
  catalog: {
    purpose: 'Product information',
    schemas: {
      products: new Schema({
        name: { type: 'string' },
        description: { type: 'string' },
        basePrice: { type: 'number' }
      })
    }
  },
  
  inventory: {
    purpose: 'Stock management',
    schemas: {
      stock: new Schema({
        productId: { type: 'id' },
        warehouseId: { type: 'id' },
        quantity: { type: 'number' }
      })
    }
  }
}

// Key learnings:
// 1. Each context has clear purpose
// 2. Minimal overlap between contexts
// 3. Clear owner for each piece of data
```

#### Afternoon Session: Inter-Service Communication (4 hours)

```javascript
// Pattern 1: Synchronous HTTP
class ProductService {
  async getProductWithInventory(productId) {
    // Get product from local database
    const product = await this.db.products.get(productId)
    
    // Call inventory service
    try {
      const inventory = await fetch(
        `http://inventory-service/api/stock/${productId}`
      ).then(r => r.json())
      
      product.availability = inventory.quantity > 0 ? 'in-stock' : 'out-of-stock'
    } catch (error) {
      // Graceful degradation
      product.availability = 'unknown'
    }
    
    return product
  }
}

// Pattern 2: Asynchronous Events
class OrderService {
  async createOrder(orderData) {
    // Create order
    const order = await this.db.orders.insert(orderData)
    
    // Publish event (fire and forget)
    await this.eventBus.publish('order.created', {
      orderId: order.id,
      userId: order.userId,
      items: order.items,
      total: order.total
    })
    
    return order
  }
}

class InventoryService {
  constructor() {
    // Subscribe to order events
    this.eventBus.subscribe('order.created', this.handleOrderCreated.bind(this))
  }
  
  async handleOrderCreated(event) {
    // Reserve inventory
    for (const item of event.items) {
      await this.db.stock.decrement(item.productId, item.quantity)
    }
  }
}

// Pattern 3: Saga Pattern
class CheckoutSaga {
  async execute(checkoutData) {
    const compensations = []
    
    try {
      // Step 1: Reserve inventory
      const reservation = await this.inventoryService.reserve(checkoutData.items)
      compensations.push(() => this.inventoryService.release(reservation.id))
      
      // Step 2: Process payment
      const payment = await this.paymentService.charge(checkoutData.payment)
      compensations.push(() => this.paymentService.refund(payment.id))
      
      // Step 3: Create order
      const order = await this.orderService.create(checkoutData)
      compensations.push(() => this.orderService.cancel(order.id))
      
      // Success! Clear compensations
      compensations.length = 0
      
      return order
      
    } catch (error) {
      // Run compensations in reverse order
      for (const compensate of compensations.reverse()) {
        try {
          await compensate()
        } catch (compError) {
          console.error('Compensation failed:', compError)
        }
      }
      throw error
    }
  }
}

// Exercise: Implement a distributed transaction
// Scenario: User updates email
// - Update identity service
// - Update profile service  
// - Update notification service
// - Send confirmation email
// Handle partial failures!
```

### Day 2: Performance and Scale

#### Morning: Performance Optimization (4 hours)

```javascript
// Performance Lab Setup
class PerformanceLab {
  async setup() {
    // Generate test data
    console.log('Generating test data...')
    await this.generateUsers(10000)
    await this.generateProducts(5000)
    await this.generateOrders(50000)
  }
  
  async runExperiments() {
    // Experiment 1: N+1 Query Problem
    console.log('\n=== N+1 Query Problem ===')
    
    // Bad approach
    console.time('N+1 Query')
    const orders = await api.resources.orders.query({ limit: 100 })
    for (const order of orders) {
      order.user = await api.resources.users.get(order.userId)
      order.items = await api.resources.orderItems.query({
        filter: { orderId: order.id }
      })
    }
    console.timeEnd('N+1 Query') // ~500ms
    
    // Good approach
    console.time('Optimized Query')
    const optimizedOrders = await api.resources.orders.query({
      limit: 100,
      include: 'userId,items'
    })
    console.timeEnd('Optimized Query') // ~50ms
    
    // Experiment 2: Index Impact
    console.log('\n=== Index Impact ===')
    
    // Without index
    console.time('No Index')
    await api.resources.products.query({
      filter: { category: 'electronics', status: 'active' }
    })
    console.timeEnd('No Index') // ~200ms
    
    // Add index
    await api.db.query(
      'CREATE INDEX idx_products_category_status ON products(category, status)'
    )
    
    // With index
    console.time('With Index')
    await api.resources.products.query({
      filter: { category: 'electronics', status: 'active' }
    })
    console.timeEnd('With Index') // ~5ms
    
    // Experiment 3: Caching Strategy
    console.log('\n=== Caching Strategy ===')
    
    // No cache
    console.time('No Cache - 10 requests')
    for (let i = 0; i < 10; i++) {
      await api.resources.products.get('popular-product')
    }
    console.timeEnd('No Cache - 10 requests') // ~100ms
    
    // With cache
    api.use(CachePlugin, { ttl: 60 })
    
    console.time('With Cache - 10 requests')
    for (let i = 0; i < 10; i++) {
      await api.resources.products.get('popular-product')
    }
    console.timeEnd('With Cache - 10 requests') // ~11ms (first request + 9 cache hits)
  }
}

// Exercise: Optimize slow queries
// Given: Query that takes 2+ seconds
// Task: Make it under 100ms
// Teams compete for best optimization
```

#### Afternoon: Scaling Strategies (4 hours)

```javascript
// Horizontal Scaling Workshop
class ScalingWorkshop {
  async demonstrateScalingPatterns() {
    // Pattern 1: Read Replicas
    const api = new Api()
    
    api.use(MySQLPlugin, {
      write: {
        host: 'primary-db.example.com'
      },
      read: [
        { host: 'replica-1.example.com' },
        { host: 'replica-2.example.com' },
        { host: 'replica-3.example.com' }
      ],
      
      // Route reads to replicas
      routeToReplica: (operation) => {
        return ['get', 'query'].includes(operation)
      }
    })
    
    // Pattern 2: Sharding
    class ShardedAPI {
      constructor() {
        this.shards = {
          'A-F': new Api(),
          'G-M': new Api(),
          'N-S': new Api(),
          'T-Z': new Api()
        }
      }
      
      getShardForUser(userId) {
        const firstLetter = userId[0].toUpperCase()
        
        if (firstLetter <= 'F') return this.shards['A-F']
        if (firstLetter <= 'M') return this.shards['G-M']
        if (firstLetter <= 'S') return this.shards['N-S']
        return this.shards['T-Z']
      }
      
      async getUser(userId) {
        const shard = this.getShardForUser(userId)
        return shard.resources.users.get(userId)
      }
    }
    
    // Pattern 3: Caching Layers
    class CachingStrategy {
      constructor() {
        this.l1Cache = new Map() // In-memory
        this.l2Cache = new Redis() // Redis
        this.db = new Api() // Database
      }
      
      async get(key) {
        // Check L1 cache
        if (this.l1Cache.has(key)) {
          return this.l1Cache.get(key)
        }
        
        // Check L2 cache
        const l2Value = await this.l2Cache.get(key)
        if (l2Value) {
          this.l1Cache.set(key, l2Value)
          return l2Value
        }
        
        // Get from database
        const dbValue = await this.db.resources.data.get(key)
        
        // Populate caches
        await this.l2Cache.set(key, dbValue, 300) // 5 min TTL
        this.l1Cache.set(key, dbValue)
        
        return dbValue
      }
    }
  }
}

// Load Testing Exercise
class LoadTestingExercise {
  async run() {
    // Tool: k6 or Artillery
    const testScenarios = [
      {
        name: 'Baseline',
        vus: 10, // Virtual users
        duration: '1m',
        target: 100 // Requests per second
      },
      {
        name: 'Normal Load',
        vus: 50,
        duration: '5m',
        target: 500
      },
      {
        name: 'Peak Load',
        vus: 200,
        duration: '10m',
        target: 2000
      },
      {
        name: 'Stress Test',
        vus: 500,
        duration: '15m',
        target: 5000
      }
    ]
    
    // Teams run tests and analyze:
    // - Response time percentiles
    // - Error rates
    // - Throughput
    // - Resource utilization
    
    // Identify bottlenecks and fix them
  }
}
```

## Workshop 3: Enterprise Architecture (3 Days)

### Day 1: Architecture Patterns

#### Morning: Event-Driven Architecture (4 hours)

```javascript
// Complete Event-Driven System
class EventDrivenWorkshop {
  async buildSystem() {
    // Event Store
    class EventStore {
      constructor() {
        this.events = []
        this.subscribers = new Map()
      }
      
      async append(eventType, data, metadata = {}) {
        const event = {
          id: generateId(),
          type: eventType,
          data,
          metadata: {
            ...metadata,
            timestamp: new Date(),
            version: 1
          }
        }
        
        this.events.push(event)
        
        // Notify subscribers
        const handlers = this.subscribers.get(eventType) || []
        for (const handler of handlers) {
          // Async, non-blocking
          setImmediate(() => handler(event))
        }
        
        return event
      }
      
      subscribe(eventType, handler) {
        if (!this.subscribers.has(eventType)) {
          this.subscribers.set(eventType, [])
        }
        this.subscribers.get(eventType).push(handler)
      }
    }
    
    // Event Sourced Aggregate
    class Order {
      constructor(id) {
        this.id = id
        this.status = 'initial'
        this.items = []
        this.total = 0
        this.events = []
      }
      
      static fromEvents(events) {
        const order = new Order(events[0]?.data.orderId)
        
        for (const event of events) {
          order.apply(event)
        }
        
        return order
      }
      
      apply(event) {
        switch (event.type) {
          case 'OrderCreated':
            this.status = 'pending'
            this.customerId = event.data.customerId
            break
            
          case 'ItemAdded':
            this.items.push(event.data.item)
            this.total += event.data.item.price * event.data.item.quantity
            break
            
          case 'OrderConfirmed':
            this.status = 'confirmed'
            this.confirmedAt = event.metadata.timestamp
            break
            
          case 'OrderShipped':
            this.status = 'shipped'
            this.trackingNumber = event.data.trackingNumber
            break
        }
        
        this.events.push(event)
      }
      
      // Commands
      addItem(item) {
        if (this.status !== 'pending') {
          throw new Error('Cannot add items to confirmed order')
        }
        
        return {
          type: 'ItemAdded',
          data: { orderId: this.id, item }
        }
      }
      
      confirm() {
        if (this.status !== 'pending') {
          throw new Error('Order already confirmed')
        }
        
        if (this.items.length === 0) {
          throw new Error('Cannot confirm empty order')
        }
        
        return {
          type: 'OrderConfirmed',
          data: { orderId: this.id }
        }
      }
    }
    
    // Projections
    class OrderProjection {
      constructor(eventStore) {
        this.orders = new Map()
        
        // Subscribe to events
        eventStore.subscribe('OrderCreated', this.onOrderCreated.bind(this))
        eventStore.subscribe('ItemAdded', this.onItemAdded.bind(this))
        eventStore.subscribe('OrderConfirmed', this.onOrderConfirmed.bind(this))
      }
      
      async onOrderCreated(event) {
        this.orders.set(event.data.orderId, {
          id: event.data.orderId,
          customerId: event.data.customerId,
          status: 'pending',
          items: [],
          total: 0,
          createdAt: event.metadata.timestamp
        })
      }
      
      async onItemAdded(event) {
        const order = this.orders.get(event.data.orderId)
        if (order) {
          order.items.push(event.data.item)
          order.total += event.data.item.price * event.data.item.quantity
        }
      }
      
      async onOrderConfirmed(event) {
        const order = this.orders.get(event.data.orderId)
        if (order) {
          order.status = 'confirmed'
          order.confirmedAt = event.metadata.timestamp
        }
      }
      
      // Queries
      async getOrder(orderId) {
        return this.orders.get(orderId)
      }
      
      async getOrdersByCustomer(customerId) {
        return Array.from(this.orders.values())
          .filter(order => order.customerId === customerId)
      }
    }
    
    // Exercise: Build a complete order system
    // - Commands: CreateOrder, AddItem, RemoveItem, ConfirmOrder, CancelOrder
    // - Events: OrderCreated, ItemAdded, ItemRemoved, etc.
    // - Projections: OrderList, CustomerOrders, ProductSales
    // - Policies: LowStockAlert, FraudDetection
  }
}
```

#### Afternoon: CQRS Implementation (4 hours)

```javascript
// Full CQRS System
class CQRSWorkshop {
  buildCQRSSystem() {
    // Command Side
    class CommandBus {
      constructor() {
        this.handlers = new Map()
      }
      
      register(commandType, handler) {
        this.handlers.set(commandType, handler)
      }
      
      async execute(command) {
        const handler = this.handlers.get(command.type)
        if (!handler) {
          throw new Error(`No handler for command: ${command.type}`)
        }
        
        return await handler(command)
      }
    }
    
    // Command Handlers
    class CreateUserHandler {
      constructor(writeDb, eventStore) {
        this.writeDb = writeDb
        this.eventStore = eventStore
      }
      
      async handle(command) {
        // Validate
        if (!command.email || !command.name) {
          throw new Error('Email and name required')
        }
        
        // Check uniqueness
        const existing = await this.writeDb.users.findByEmail(command.email)
        if (existing) {
          throw new Error('Email already exists')
        }
        
        // Create user
        const user = {
          id: generateId(),
          email: command.email,
          name: command.name,
          createdAt: new Date()
        }
        
        await this.writeDb.users.insert(user)
        
        // Publish event
        await this.eventStore.publish('UserCreated', user)
        
        return user.id
      }
    }
    
    // Query Side
    class QueryBus {
      constructor() {
        this.handlers = new Map()
      }
      
      register(queryType, handler) {
        this.handlers.set(queryType, handler)
      }
      
      async execute(query) {
        const handler = this.handlers.get(query.type)
        if (!handler) {
          throw new Error(`No handler for query: ${query.type}`)
        }
        
        return await handler(query)
      }
    }
    
    // Read Model Updates
    class UserReadModelUpdater {
      constructor(readDb, eventStore) {
        this.readDb = readDb
        
        eventStore.subscribe('UserCreated', this.onUserCreated.bind(this))
        eventStore.subscribe('UserUpdated', this.onUserUpdated.bind(this))
      }
      
      async onUserCreated(event) {
        // Denormalized view
        await this.readDb.userList.insert({
          id: event.data.id,
          email: event.data.email,
          name: event.data.name,
          displayName: `${event.data.name} <${event.data.email}>`,
          createdAt: event.data.createdAt,
          postCount: 0,
          lastActivity: event.data.createdAt
        })
      }
      
      async onUserUpdated(event) {
        await this.readDb.userList.update(event.data.id, event.data.changes)
      }
    }
    
    // Complete Example
    const system = {
      commandBus: new CommandBus(),
      queryBus: new QueryBus(),
      eventStore: new EventStore(),
      writeDb: new WriteDatabase(),
      readDb: new ReadDatabase()
    }
    
    // Register handlers
    system.commandBus.register('CreateUser', 
      new CreateUserHandler(system.writeDb, system.eventStore).handle
    )
    
    system.queryBus.register('GetUserList',
      async (query) => {
        return system.readDb.userList.query({
          filter: query.filter,
          sort: query.sort,
          limit: query.limit
        })
      }
    )
    
    // Usage
    const userId = await system.commandBus.execute({
      type: 'CreateUser',
      email: 'john@example.com',
      name: 'John Doe'
    })
    
    const users = await system.queryBus.execute({
      type: 'GetUserList',
      filter: { createdAt: { $gt: '2024-01-01' } },
      sort: '-createdAt',
      limit: 10
    })
  }
}
```

### Day 2: Enterprise Integration

Full day workshop on integrating with enterprise systems:

```javascript
// Enterprise Integration Patterns
class EnterpriseIntegrationWorkshop {
  // Pattern 1: Legacy System Integration
  async integrateLegacySystem() {
    // Anti-Corruption Layer
    class LegacySystemAdapter {
      constructor(legacyDb, modernApi) {
        this.legacy = legacyDb
        this.api = modernApi
      }
      
      async syncUser(legacyUserId) {
        // Get from legacy system
        const legacyUser = await this.legacy.query(
          'SELECT * FROM USR_TBL WHERE USR_ID = ?',
          [legacyUserId]
        )
        
        // Transform to modern format
        const modernUser = {
          id: legacyUser.USR_ID,
          email: legacyUser.EMAIL_ADDR.toLowerCase(),
          name: `${legacyUser.FRST_NM} ${legacyUser.LST_NM}`.trim(),
          status: this.mapStatus(legacyUser.STS_CD),
          createdAt: new Date(legacyUser.CRT_DT)
        }
        
        // Validate and clean
        if (!this.isValidEmail(modernUser.email)) {
          throw new Error(`Invalid email for user ${legacyUserId}`)
        }
        
        // Create or update in modern system
        try {
          await this.api.resources.users.get(modernUser.id)
          // Update existing
          await this.api.resources.users.update(modernUser.id, modernUser)
        } catch (error) {
          if (error.code === 'NOT_FOUND') {
            // Create new
            await this.api.resources.users.insert(modernUser)
          } else {
            throw error
          }
        }
        
        return modernUser
      }
      
      mapStatus(legacyStatus) {
        const statusMap = {
          'A': 'active',
          'I': 'inactive',
          'S': 'suspended',
          'D': 'deleted'
        }
        return statusMap[legacyStatus] || 'unknown'
      }
    }
    
    // Change Data Capture
    class CDCProcessor {
      constructor(adapter) {
        this.adapter = adapter
        this.lastProcessed = null
      }
      
      async processChanges() {
        // Get changes since last run
        const changes = await this.legacy.query(`
          SELECT * FROM AUDIT_LOG
          WHERE CHG_DT > ? AND TBL_NM = 'USR_TBL'
          ORDER BY CHG_DT
        `, [this.lastProcessed || new Date(0)])
        
        for (const change of changes) {
          try {
            await this.adapter.syncUser(change.REC_ID)
            this.lastProcessed = change.CHG_DT
          } catch (error) {
            console.error(`Failed to sync user ${change.REC_ID}:`, error)
            // Store for retry
            await this.storeFailedSync(change, error)
          }
        }
      }
    }
  }
  
  // Pattern 2: External API Integration
  async integrateExternalAPIs() {
    // Circuit Breaker Pattern
    class CircuitBreaker {
      constructor(fn, options = {}) {
        this.fn = fn
        this.failures = 0
        this.state = 'closed' // closed, open, half-open
        this.timeout = options.timeout || 60000
        this.threshold = options.threshold || 5
        this.resetTimeout = null
      }
      
      async call(...args) {
        if (this.state === 'open') {
          throw new Error('Circuit breaker is open')
        }
        
        try {
          const result = await this.fn(...args)
          this.onSuccess()
          return result
        } catch (error) {
          this.onFailure()
          throw error
        }
      }
      
      onSuccess() {
        this.failures = 0
        this.state = 'closed'
      }
      
      onFailure() {
        this.failures++
        
        if (this.failures >= this.threshold) {
          this.state = 'open'
          
          // Schedule reset to half-open
          this.resetTimeout = setTimeout(() => {
            this.state = 'half-open'
          }, this.timeout)
        }
      }
    }
    
    // Retry with Exponential Backoff
    class RetryClient {
      constructor(client, options = {}) {
        this.client = client
        this.maxAttempts = options.maxAttempts || 3
        this.baseDelay = options.baseDelay || 1000
        this.maxDelay = options.maxDelay || 30000
      }
      
      async request(method, ...args) {
        let lastError
        
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
          try {
            return await this.client[method](...args)
          } catch (error) {
            lastError = error
            
            if (!this.isRetryable(error) || attempt === this.maxAttempts) {
              throw error
            }
            
            const delay = Math.min(
              this.baseDelay * Math.pow(2, attempt - 1),
              this.maxDelay
            )
            
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
        
        throw lastError
      }
      
      isRetryable(error) {
        return [
          'ECONNRESET',
          'ETIMEDOUT',
          'ENOTFOUND'
        ].includes(error.code) || error.status >= 500
      }
    }
  }
}
```

### Day 3: Team Scaling and Governance

#### Morning: Multi-Team Development (4 hours)

```javascript
// Team Organization Workshop
class TeamOrganizationWorkshop {
  demonstrateTeamPatterns() {
    // Pattern 1: API-First Development
    const apiContract = {
      version: '1.0.0',
      resources: {
        users: {
          schema: {
            // Define schema first
            id: { type: 'uuid', generated: true },
            email: { type: 'string', required: true },
            profile: { type: 'object' }
          },
          
          operations: {
            create: {
              input: { email: 'required', profile: 'optional' },
              output: { id: 'uuid', email: 'string' },
              errors: ['DUPLICATE_EMAIL', 'INVALID_EMAIL']
            },
            
            get: {
              input: { id: 'uuid' },
              output: 'User',
              errors: ['NOT_FOUND']
            }
          }
        }
      }
    }
    
    // Teams implement against contract
    class TeamAImplementation {
      async createUser(data) {
        // Team A's implementation
      }
    }
    
    class TeamBImplementation {
      async createUser(data) {
        // Team B's implementation
      }
    }
    
    // Contract testing
    class ContractTest {
      async testImplementation(impl) {
        // Test create
        const result = await impl.createUser({
          email: 'test@example.com'
        })
        
        assert(result.id, 'Must return id')
        assert(result.email === 'test@example.com', 'Must return email')
        
        // Test duplicate
        await assertThrows(
          () => impl.createUser({ email: 'test@example.com' }),
          'DUPLICATE_EMAIL'
        )
      }
    }
    
    // Pattern 2: Domain Ownership
    const domainOwnership = {
      identity: {
        team: 'Identity Team',
        resources: ['users', 'sessions', 'permissions'],
        apis: ['auth', 'users'],
        databases: ['identity_db'],
        
        responsibilities: [
          'Authentication',
          'Authorization',
          'User management',
          'Session management'
        ]
      },
      
      commerce: {
        team: 'Commerce Team',
        resources: ['products', 'cart', 'orders'],
        apis: ['catalog', 'checkout'],
        databases: ['commerce_db'],
        
        responsibilities: [
          'Product catalog',
          'Shopping cart',
          'Order processing',
          'Inventory management'
        ]
      }
    }
    
    // Pattern 3: Shared Libraries
    class SharedLibraries {
      // Common types
      static MoneyType = {
        type: 'object',
        structure: {
          amount: { type: 'decimal', precision: 19, scale: 4 },
          currency: { type: 'string', length: 3 }
        }
      }
      
      // Common validations
      static EmailValidator = {
        pattern: /^[^@]+@[^@]+\.[^@]+$/,
        transform: (email) => email.toLowerCase().trim()
      }
      
      // Common hooks
      static AuditHooks = {
        beforeInsert: async (context) => {
          context.data.createdAt = new Date()
          context.data.createdBy = context.user?.id
        },
        
        beforeUpdate: async (context) => {
          context.data.updatedAt = new Date()
          context.data.updatedBy = context.user?.id
        }
      }
    }
  }
}
```

#### Afternoon: Governance and Standards (4 hours)

```javascript
// Governance Workshop
class GovernanceWorkshop {
  implementGovernance() {
    // API Design Review Process
    class APIDesignReview {
      constructor() {
        this.reviewers = ['architect', 'security', 'operations']
        this.checklist = this.createChecklist()
      }
      
      createChecklist() {
        return {
          naming: {
            resourcesPlural: 'Are all resources pluralized?',
            camelCase: 'Are all fields in camelCase?',
            meaningful: 'Are names meaningful and consistent?'
          },
          
          security: {
            authentication: 'Is authentication required?',
            authorization: 'Are permissions properly defined?',
            encryption: 'Is sensitive data encrypted?',
            rateLimit: 'Are rate limits configured?'
          },
          
          performance: {
            pagination: 'Is pagination implemented?',
            indexes: 'Are queries indexed?',
            caching: 'Is caching strategy defined?'
          },
          
          operations: {
            monitoring: 'Are metrics exposed?',
            logging: 'Is logging configured?',
            healthCheck: 'Is health check endpoint available?',
            documentation: 'Is API documented?'
          }
        }
      }
      
      async reviewAPI(apiDefinition) {
        const results = {
          passed: [],
          failed: [],
          warnings: []
        }
        
        // Automated checks
        for (const [category, checks] of Object.entries(this.checklist)) {
          for (const [check, description] of Object.entries(checks)) {
            const result = await this.runCheck(check, apiDefinition)
            
            if (result.status === 'pass') {
              results.passed.push({ category, check, description })
            } else if (result.status === 'fail') {
              results.failed.push({ 
                category, 
                check, 
                description,
                details: result.details
              })
            } else {
              results.warnings.push({ 
                category, 
                check, 
                description,
                details: result.details
              })
            }
          }
        }
        
        return results
      }
    }
    
    // Automated Standards Enforcement
    class StandardsEnforcement {
      static analyzeCodebase() {
        const rules = [
          {
            name: 'no-direct-db-access',
            check: (code) => !code.includes('db.query('),
            message: 'Use API resources instead of direct database access'
          },
          {
            name: 'use-schemas',
            check: (code) => !code.includes('addResource(') || code.includes('schema:'),
            message: 'All resources must have schemas'
          },
          {
            name: 'error-handling',
            check: (code) => code.includes('try') && code.includes('catch'),
            message: 'Proper error handling required'
          }
        ]
        
        // Git pre-commit hook
        const preCommitHook = `
#!/bin/bash
# Run standards check
npm run standards:check

if [ $? -ne 0 ]; then
  echo "Standards check failed. Please fix issues before committing."
  exit 1
fi
        `
        
        return { rules, preCommitHook }
      }
    }
    
    // Architecture Decision Records
    class ADRTemplate {
      static create(decision) {
        return `
# ${decision.title}

## Status
${decision.status}

## Context
${decision.context}

## Decision
${decision.decision}

## Consequences
${decision.consequences.join('\n')}

## Date
${new Date().toISOString()}

## Approvers
${decision.approvers.join(', ')}
        `
      }
      
      static example() {
        return this.create({
          title: 'Use JSON REST API for all services',
          status: 'Accepted',
          context: 'We need a consistent API framework across all teams',
          decision: 'We will use JSON REST API library for all REST services',
          consequences: [
            'All teams must learn the framework',
            'Consistent API design across services',
            'Shared tooling and libraries',
            'Easier to move between teams'
          ],
          approvers: ['CTO', 'VP Engineering', 'Principal Architect']
        })
      }
    }
  }
}
```

## Self-Paced Learning Materials

### Interactive Tutorials

```javascript
// Tutorial System
class InteractiveTutorial {
  constructor() {
    this.lessons = this.createLessons()
    this.progress = new Map()
  }
  
  createLessons() {
    return [
      {
        id: 'basics-1',
        title: 'Creating Your First Resource',
        
        instruction: `
Welcome to JSON REST API! Let's create your first resource.

Task: Create a 'tasks' resource with the following fields:
- title (string, required)
- completed (boolean, default: false)
- priority (number, 1-5)
        `,
        
        startingCode: `
import { Api, Schema, MemoryPlugin } from 'json-rest-api'

const api = new Api()
api.use(MemoryPlugin)

// TODO: Create your schema here
const taskSchema = new Schema({
  // Add fields here
})

// TODO: Add the resource
// api.addResource(...)

export { api }
        `,
        
        solution: `
import { Api, Schema, MemoryPlugin } from 'json-rest-api'

const api = new Api()
api.use(MemoryPlugin)

const taskSchema = new Schema({
  title: { type: 'string', required: true },
  completed: { type: 'boolean', default: false },
  priority: { type: 'number', min: 1, max: 5 }
})

api.addResource('tasks', { schema: taskSchema })

export { api }
        `,
        
        tests: [
          {
            name: 'Schema has required fields',
            test: async (api) => {
              const schema = api.schemas.get('tasks')
              assert(schema.fields.title.required === true)
              assert(schema.fields.completed.default === false)
            }
          },
          {
            name: 'Can create a task',
            test: async (api) => {
              const task = await api.resources.tasks.insert({
                title: 'Learn JSON REST API',
                priority: 5
              })
              assert(task.title === 'Learn JSON REST API')
              assert(task.completed === false)
            }
          }
        ]
      },
      
      // More lessons...
    ]
  }
  
  async runLesson(lessonId) {
    const lesson = this.lessons.find(l => l.id === lessonId)
    if (!lesson) throw new Error('Lesson not found')
    
    console.log(lesson.instruction)
    
    // Wait for user to write code
    const userCode = await this.getUserCode()
    
    // Run tests
    const results = await this.runTests(userCode, lesson.tests)
    
    if (results.allPassed) {
      this.progress.set(lessonId, 'completed')
      console.log('Great job! Moving to next lesson...')
    } else {
      console.log('Not quite right. Here are the issues:')
      results.failures.forEach(f => console.log(`- ${f.message}`))
    }
  }
}
```

### Code Katas

```javascript
// API Design Katas
const katas = [
  {
    name: 'Blog API',
    difficulty: 'beginner',
    requirements: [
      'Users can create posts',
      'Posts have title, content, and publish date',
      'Posts can be draft or published',
      'Users can comment on posts',
      'Comments can be nested (replies)'
    ],
    hints: [
      'Think about the relationships between users, posts, and comments',
      'How will you handle nested comments?',
      'What hooks might you need for publishing?'
    ]
  },
  
  {
    name: 'E-Commerce Cart',
    difficulty: 'intermediate',
    requirements: [
      'Users can add products to cart',
      'Cart persists across sessions',
      'Apply discount codes',
      'Calculate shipping based on weight/location',
      'Handle inventory reservation'
    ],
    hints: [
      'How do you prevent overselling?',
      'When should inventory be reserved?',
      'How do you handle abandoned carts?'
    ]
  },
  
  {
    name: 'Multi-Tenant SaaS',
    difficulty: 'advanced',
    requirements: [
      'Support multiple companies (tenants)',
      'Data isolation between tenants',
      'Tenant-specific configurations',
      'Usage tracking per tenant',
      'Different feature tiers'
    ],
    hints: [
      'How will you partition data?',
      'How do you handle cross-tenant queries?',
      'What about shared resources?'
    ]
  }
]
```

## Assessment and Certification

### Practical Exam Structure

```javascript
// Certification Exam
class CertificationExam {
  constructor() {
    this.tasks = [
      {
        id: 'design',
        points: 30,
        timeLimit: '45 minutes',
        description: 'Design an API for a ride-sharing service',
        
        requirements: [
          'User registration and profiles',
          'Driver applications and approval',
          'Ride requests and matching',
          'Real-time location tracking',
          'Payment processing',
          'Rating system'
        ],
        
        evaluation: {
          schemaDesign: 10,
          relationships: 5,
          businessLogic: 10,
          errorHandling: 5
        }
      },
      
      {
        id: 'implementation',
        points: 40,
        timeLimit: '90 minutes',
        description: 'Implement core functionality',
        
        tasks: [
          'Implement user and driver resources',
          'Create ride matching algorithm',
          'Add payment processing hooks',
          'Implement rating system with constraints'
        ],
        
        evaluation: {
          correctness: 20,
          performance: 10,
          codeQuality: 10
        }
      },
      
      {
        id: 'debugging',
        points: 30,
        timeLimit: '45 minutes',
        description: 'Debug and optimize existing API',
        
        problems: [
          'API returns 500 errors intermittently',
          'Queries are taking 5+ seconds',
          'Data inconsistencies between services',
          'Memory usage grows over time'
        ],
        
        evaluation: {
          problemIdentification: 10,
          solutions: 15,
          explanation: 5
        }
      }
    ]
  }
  
  grade(submission) {
    let totalScore = 0
    const feedback = []
    
    for (const task of this.tasks) {
      const taskScore = this.gradeTask(submission[task.id], task)
      totalScore += taskScore.points
      
      feedback.push({
        task: task.id,
        score: taskScore.points,
        maxScore: task.points,
        comments: taskScore.comments
      })
    }
    
    return {
      totalScore,
      maxScore: 100,
      passed: totalScore >= 70,
      feedback,
      certification: totalScore >= 70 ? this.generateCertificate() : null
    }
  }
}
```

## Resources and References

### Recommended Reading Order

1. **Week 1**: Core Concepts
   - Schema Design Patterns
   - REST Best Practices
   - JSON:API Specification

2. **Week 2**: Advanced Features
   - Hook Patterns
   - Query Optimization
   - Relationship Design

3. **Week 3**: Architecture
   - Microservices Patterns
   - Event-Driven Design
   - CQRS and Event Sourcing

4. **Week 4**: Enterprise
   - Bounded Contexts
   - Migration Strategies
   - Team Organization

### Practice Projects

1. **Personal Blog** (Beginner)
   - Time: 1 week
   - Learn: Basics, relationships, auth

2. **Task Management** (Intermediate)
   - Time: 2 weeks
   - Learn: Complex queries, real-time, collaboration

3. **E-Commerce Platform** (Advanced)
   - Time: 1 month
   - Learn: Scale, transactions, integrations

4. **SaaS Platform** (Expert)
   - Time: 2 months
   - Learn: Multi-tenancy, billing, analytics

## Summary

Effective training is about practice, not PowerPoints. Use these materials to create hands-on learning experiences that prepare teams for real-world API development.

Remember: The best architects are teachers, and the best teachers are practitioners.

---

This completes the Enterprise Guide for JSON REST API. Ready to build amazing APIs! 🚀