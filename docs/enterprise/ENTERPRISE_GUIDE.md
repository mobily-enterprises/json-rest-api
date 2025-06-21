# Enterprise Architecture Guide for JSON REST API

This guide is designed for architects, consultants, and enterprise teams implementing large-scale systems with the JSON REST API library.

## Table of Contents
1. [Architecture Enforcement](#architecture-enforcement)
2. [Dependency Management](#dependency-management)
3. [Bounded Contexts](#bounded-contexts)
4. [Best Practices](#best-practices)
5. [Migration Strategies](#migration-strategies)
6. [Training Materials](#training-materials)

## Architecture Enforcement

The Architecture Enforcement Plugin ensures your teams follow consistent patterns across large codebases.

### Setup

```javascript
import { Api, ArchitectureEnforcementPlugin } from 'json-rest-api'

const api = new Api()
api.use(ArchitectureEnforcementPlugin, {
  // Naming conventions
  namingConventions: {
    resources: '^[a-z][a-zA-Z]+s$',  // camelCase, plural
    fields: '^[a-z][a-zA-Z]*$'       // camelCase
  },
  
  // Required plugins for all APIs
  requiredPlugins: [
    'ValidationPlugin',
    'AuthorizationPlugin',
    'LoggingPlugin'
  ],
  
  // Required hooks per resource
  requiredHooks: {
    '*': ['beforeInsert', 'afterUpdate'],  // All resources
    'users': ['beforeDelete'],             // Specific resource
    'payments': ['afterInsert', 'afterUpdate']
  },
  
  // Environment-specific restrictions
  allowedOperations: {
    production: {
      blockedOperations: ['delete:users', 'delete:accounts'],
      blockedResources: ['debug', 'test']
    },
    development: {
      blockedOperations: [],
      blockedResources: []
    }
  },
  
  // Relationship rules
  relationshipRules: {
    allowedPatterns: [
      { from: 'orders', to: 'users' },
      { from: 'orders', to: 'products' },
      { from: 'payments', to: 'orders' },
      { from: '*', to: 'currencies' }  // Anyone can reference currencies
    ],
    maxPerResource: 5  // Max foreign keys per table
  },
  
  // Strict mode - throws errors instead of warnings
  strict: true,
  
  // Enforce audit trail
  enforceAudit: true
})
```

### Custom Architecture Rules

```javascript
// Add domain-specific rules
api.addArchitectureRule({
  type: 'custom',
  validate: async (context) => {
    // Financial resources must have audit fields
    if (context.name.includes('payment') || context.name.includes('transaction')) {
      const schema = context.options.schema
      if (!schema.fields.auditedBy || !schema.fields.auditedAt) {
        return {
          valid: false,
          message: `Financial resource '${context.name}' must have auditedBy and auditedAt fields`
        }
      }
    }
    return { valid: true }
  }
})

// Check current violations
const { valid, violations } = api.checkArchitecture()
if (!valid) {
  console.error('Architecture violations:', violations)
}
```

## Dependency Management

The Dependency Graph Plugin helps manage complex relationships between resources.

### Setup and Analysis

```javascript
import { Api, DependencyGraphPlugin } from 'json-rest-api'

const api = new Api()
api.use(DependencyGraphPlugin, {
  detectCircular: true,    // Throw on circular dependencies
  maxDepth: 10,           // Max depth for impact analysis
  exportFormat: 'dot',    // Default export format
  strict: true            // Throw errors vs warnings
})

// Define resources with complex relationships
api.addResource('organizations', { schema: organizationSchema })
api.addResource('departments', { 
  schema: new Schema({
    name: { type: 'string', required: true },
    organizationId: { type: 'id', refs: 'organizations', required: true },
    parentDepartmentId: { type: 'id', refs: 'departments' }
  })
})
api.addResource('employees', {
  schema: new Schema({
    name: { type: 'string', required: true },
    departmentId: { type: 'id', refs: 'departments', required: true },
    managerId: { type: 'id', refs: 'employees' },
    organizationId: { type: 'id', refs: 'organizations', required: true }
  })
})
```

### Dependency Analysis

```javascript
// Get full dependency graph
const graph = api.dependencies.graph()
console.log(`Total resources: ${Object.keys(graph.nodes).length}`)
console.log(`Total relationships: ${graph.edges.length}`)

// Detect circular dependencies
const circles = api.dependencies.circles()
if (circles.length > 0) {
  console.error('Circular dependencies found:', circles)
}

// Impact analysis - what breaks if we change 'departments'?
const impact = api.dependencies.impact('departments')
console.log('Direct impacts:', impact.direct)
console.log('Indirect impacts:', impact.indirect)

// Export for visualization
const dotGraph = api.dependencies.export('dot')
// Save to file and visualize with Graphviz

const mermaidGraph = api.dependencies.export('mermaid')
// Use in documentation or GitHub
```

### Schema Migration Planning

```javascript
// Plan migration when schema changes
const migration = api.dependencies.migration('users', {
  removedFields: ['legacyId'],
  typeChanges: {
    status: { from: 'string', to: 'number' }
  },
  addedFields: ['externalId']
})

console.log('Required updates:', migration.requiredUpdates)
// Shows which resources need updating due to schema changes
```

## Bounded Contexts

The Bounded Context Plugin implements Domain-Driven Design patterns for large systems.

### Basic Setup

```javascript
import { Api, BoundedContextPlugin } from 'json-rest-api'

const api = new Api()
api.use(BoundedContextPlugin, {
  contexts: {
    customer: {
      resources: ['users', 'accounts', 'preferences'],
      namespace: 'customer'
    },
    billing: {
      resources: ['users', 'invoices', 'payments'],
      namespace: 'billing'
    },
    inventory: {
      resources: ['products', 'warehouses', 'stock'],
      namespace: 'inventory'
    }
  },
  
  sharedKernel: ['currencies', 'countries'],  // Shared across contexts
  anticorruption: true,  // Enforce context boundaries
  eventBus: myEventBus   // Optional: for context communication
})
```

### Context Mappings

```javascript
// Define how data translates between contexts
api.defineContextMapping('customer', 'billing', {
  type: 'anticorruption',  // anticorruption, conformist, partnership
  users: {
    fields: {
      id: 'customerId',           // Simple rename
      name: 'customerName',
      email: 'billingEmail',
      creditScore: null,          // Don't expose to billing
      balance: (value, data) => {  // Transform
        return Math.round(value * 100)  // Cents for billing
      }
    },
    transform: (source, mapped) => {
      // Custom transformation logic
      return {
        ...mapped,
        customerType: source.premium ? 'premium' : 'standard'
      }
    }
  }
})
```

### Working Within Contexts

```javascript
// Access resources within a context
const customerContext = api.withinContext('customer')

// Only see resources in this context
const user = await customerContext.resources.users.get(123)

// Publish context events
customerContext.publish('user.upgraded', { userId: 123, plan: 'premium' })

// Subscribe to events from other contexts
customerContext.subscribe('billing', 'payment.received', async (event) => {
  // Update user status based on payment
  await customerContext.resources.users.update(event.data.userId, {
    paymentStatus: 'current'
  })
})

// Call another context (goes through anti-corruption layer)
const billingUser = await customerContext.callOtherContext(
  'billing', 'users', 'get', 123
)
// Data is automatically translated based on mappings
```

### Multiple API Instances (Recommended for Microservices)

```javascript
// Each bounded context as separate API
const customerApi = new Api()
customerApi.use(MySQLPlugin, { database: 'customer_db' })
customerApi.use(ValidationPlugin)
customerApi.addResource('users', customerUserSchema)

const billingApi = new Api()
billingApi.use(MySQLPlugin, { database: 'billing_db' })
billingApi.use(ValidationPlugin)
billingApi.addResource('users', billingUserSchema)  // Different schema!
billingApi.addResource('invoices', invoiceSchema)

// Use API Gateway to unify
import { ApiGatewayPlugin } from 'json-rest-api'

const gateway = new Api()
gateway.use(ApiGatewayPlugin, {
  services: {
    customer: { api: customerApi, prefix: '/customer' },
    billing: { api: billingApi, prefix: '/billing' }
  }
})
```

## Best Practices

### 1. Resource Design

```javascript
// Use value objects for complex fields
const moneySchema = new Schema({
  amount: { type: 'number', required: true },
  currency: { type: 'string', required: true, refs: 'currencies' }
})

// Aggregate boundaries
api.addResource('orders', {
  schema: new Schema({
    // Order is the aggregate root
    id: { type: 'id', generated: true },
    customerId: { type: 'id', refs: 'customers', required: true },
    
    // Order items are part of the aggregate
    items: {
      type: 'array',
      items: {
        productId: { type: 'id', refs: 'products' },
        quantity: { type: 'number', min: 1 },
        price: { type: 'object', schema: moneySchema }
      }
    },
    
    // Computed field
    total: { type: 'object', schema: moneySchema, computed: true }
  })
})
```

### 2. Hook Organization

```javascript
// Organize hooks by concern
const auditHooks = {
  async beforeInsert(context) {
    context.data.createdBy = context.user.id
    context.data.createdAt = new Date()
  },
  async beforeUpdate(context) {
    context.data.updatedBy = context.user.id
    context.data.updatedAt = new Date()
  }
}

const validationHooks = {
  async beforeInsert(context) {
    // Business validation beyond schema
    if (context.resource === 'orders') {
      await validateInventory(context.data.items)
    }
  }
}

// Apply hooks to resources
api.addResource('orders', {
  schema: orderSchema,
  hooks: { ...auditHooks, ...validationHooks }
})
```

### 3. Testing Strategy

```javascript
// Test contexts in isolation
describe('Customer Context', () => {
  let api
  
  beforeEach(() => {
    api = new Api()
    api.use(MemoryPlugin)  // In-memory for tests
    api.use(BoundedContextPlugin, getTestContextConfig())
  })
  
  test('should enforce context boundaries', async () => {
    // Test anti-corruption layer
    const customerContext = api.withinContext('customer')
    const billingContext = api.withinContext('billing')
    
    // Create user in customer context
    await customerContext.resources.users.insert({
      name: 'John Doe',
      creditScore: 750  // Customer-specific field
    })
    
    // Access from billing context
    const billingUser = await billingContext.callOtherContext(
      'customer', 'users', 'get', 1
    )
    
    // Credit score should not be exposed
    expect(billingUser.creditScore).toBeUndefined()
    expect(billingUser.customerName).toBe('John Doe')
  })
})
```

## Migration Strategies

### From Monolith to Bounded Contexts

1. **Identify Contexts**
   ```javascript
   // Start with logical groupings
   const contexts = analyzeCodebase()
   // Look for: separate teams, different change rates, distinct vocabulary
   ```

2. **Create Context Map**
   ```javascript
   // Document current relationships
   const contextMap = {
     customer: { upstream: [], downstream: ['billing', 'shipping'] },
     billing: { upstream: ['customer'], downstream: ['reporting'] },
     inventory: { upstream: [], downstream: ['shipping'] }
   }
   ```

3. **Gradual Migration**
   ```javascript
   // Phase 1: Add contexts without enforcement
   api.use(BoundedContextPlugin, { anticorruption: false })
   
   // Phase 2: Add mappings
   api.defineContextMapping('customer', 'billing', mappings)
   
   // Phase 3: Enable enforcement
   api.use(BoundedContextPlugin, { anticorruption: true })
   ```

### From REST to Event-Driven

```javascript
// Add event sourcing gradually
api.use(CQRSPlugin)

// Start with key aggregates
api.implement('afterInsert', async (context) => {
  if (context.resource === 'orders') {
    await api.eventStore.append('OrderCreated', {
      orderId: context.result.id,
      data: context.data
    })
  }
})

// Build read models
api.projection('orderSummary', {
  events: ['OrderCreated', 'OrderUpdated', 'OrderCancelled'],
  handler: async (event, projection) => {
    // Update materialized view
  }
})
```

## Training Materials

### Workshop 1: Architecture Patterns (2 days)

**Day 1: Foundations**
- JSON REST API core concepts
- Plugin architecture deep dive
- Hands-on: Building custom plugins
- Lab: Implement company-specific plugin

**Day 2: Enterprise Patterns**
- Bounded contexts and DDD
- Dependency management
- Architecture enforcement
- Lab: Design multi-context system

### Workshop 2: Migration Strategies (1 day)

**Morning: Planning**
- Analyzing existing systems
- Creating context maps
- Identifying anti-corruption layers
- Defining migration phases

**Afternoon: Implementation**
- Hands-on migration exercise
- Testing strategies
- Rollback procedures
- Performance considerations

### Architecture Decision Records (ADRs)

**ADR-001: Plugin Architecture**
- Status: Accepted
- Context: Need extensible architecture for enterprise requirements
- Decision: Use plugin pattern with hooks
- Consequences: Flexible but requires governance

**ADR-002: Bounded Contexts**
- Status: Accepted
- Context: Multiple teams working on large system
- Decision: Implement bounded contexts with anti-corruption layers
- Consequences: Clear boundaries but more complex integration

**ADR-003: Event Communication**
- Status: Proposed
- Context: Contexts need to communicate without coupling
- Decision: Use event bus for inter-context communication
- Consequences: Eventual consistency, need for event store

### Security Checklist

- [ ] All APIs use AuthorizationPlugin
- [ ] Sensitive fields marked with `silent: true`
- [ ] Cross-context access controlled
- [ ] Audit trails implemented
- [ ] Rate limiting configured
- [ ] Input validation enabled
- [ ] SQL injection prevention (parameterized queries)
- [ ] API keys rotated regularly
- [ ] HTTPS enforced
- [ ] CORS properly configured

### Performance Tuning

1. **Query Optimization**
   - Use field selection: `?fields=id,name`
   - Implement pagination: `?limit=20&offset=0`
   - Add database indexes for searchable fields
   - Use query result caching

2. **Connection Pooling**
   ```javascript
   api.use(MySQLPlugin, {
     connectionLimit: 20,
     queueLimit: 100,
     acquireTimeout: 30000
   })
   ```

3. **Caching Strategy**
   - Cache immutable resources (countries, currencies)
   - Use ETags for conditional requests
   - Implement Redis for distributed cache
   - Clear cache on updates

This guide provides enterprise teams with the patterns and practices needed to build large-scale systems with the JSON REST API library. The plugin architecture enables enforcement of company standards while maintaining flexibility for team-specific needs.