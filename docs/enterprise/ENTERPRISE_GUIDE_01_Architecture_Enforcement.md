# Enterprise Guide: Chapter 1 - Architecture Enforcement

## When You Need Architecture Enforcement

As your team grows beyond 10 developers, maintaining consistency becomes challenging. Without enforcement, you end up with:
- Resources named `users`, `UserAccounts`, `user-profiles`, and `CUSTOMERS` 
- Some resources with audit trails, others without
- Security implemented differently across teams
- Critical hooks missing on sensitive resources

The Architecture Enforcement Plugin acts as your automated architecture review board, catching violations before they reach production.

## Understanding the Problem

Let's start with a real scenario. Your company has three teams:

**Team A's code:**
```javascript
api.addResource('customer_accounts', {
  schema: customerSchema,
  hooks: {
    beforeInsert: async (context) => {
      context.data.created = new Date()
    }
  }
})
```

**Team B's code:**
```javascript
api.addResource('UserProfiles', {
  schema: profileSchema
  // No hooks at all!
})
```

**Team C's code:**
```javascript
api.addResource('orders', {
  schema: orderSchema,
  hooks: {
    afterInsert: async (context) => {
      // Different audit approach
      await auditLog.record('INSERT', context)
    }
  }
})
```

Three teams, three different approaches. This is a maintenance nightmare.

## Setting Up Architecture Enforcement

### Step 1: Define Your Standards

First, decide on your company's standards. Here's a typical enterprise setup:

```javascript
// architecture-config.js
export const architectureConfig = {
  // Resource naming: lowercase, plural, no underscores
  namingConventions: {
    resources: '^[a-z][a-z]+s$',  // matches: users, orders, accounts
    fields: '^[a-z][a-zA-Z0-9]*$' // matches: userId, firstName, isActive
  },
  
  // Every API must have these plugins
  requiredPlugins: [
    'ValidationPlugin',      // Input validation
    'AuthorizationPlugin',   // Access control
    'LoggingPlugin',        // Audit trail
    'SecurityPlugin'        // Security headers
  ],
  
  // Hooks required for different resource types
  requiredHooks: {
    // All resources must have these
    '*': ['beforeInsert', 'beforeUpdate', 'afterInsert', 'afterUpdate'],
    
    // Financial resources need extra hooks
    'payments': ['beforeDelete', 'afterDelete'],
    'invoices': ['beforeDelete', 'afterDelete'],
    'transactions': ['beforeDelete', 'afterDelete'],
    
    // User resources need special handling
    'users': ['beforeDelete'],
    'accounts': ['beforeDelete']
  },
  
  // Environment-specific rules
  allowedOperations: {
    production: {
      // Never allow these in production
      blockedOperations: [
        'delete:users',      // Don't delete users, deactivate them
        'delete:accounts',   // Don't delete accounts, archive them
        'delete:payments'    // Financial records must be permanent
      ],
      blockedResources: ['debug', 'test', 'temp']
    },
    staging: {
      blockedOperations: ['delete:payments'],
      blockedResources: ['debug']
    },
    development: {
      // Allow everything in dev
      blockedOperations: [],
      blockedResources: []
    }
  }
}
```

### Step 2: Implement the Plugin

```javascript
import { Api, ArchitectureEnforcementPlugin } from 'json-rest-api'
import { architectureConfig } from './architecture-config.js'

const api = new Api()

// Add the enforcement plugin
api.use(ArchitectureEnforcementPlugin, {
  ...architectureConfig,
  
  // Strict mode: throw errors instead of warnings
  strict: true,
  
  // Require audit trail on all write operations
  enforceAudit: true,
  
  // Current environment
  environment: process.env.NODE_ENV || 'development'
})
```

### Step 3: See It In Action

Now when Team B tries to add their resource:

```javascript
// This will throw an error!
api.addResource('UserProfiles', {
  schema: profileSchema
})

// Error: Architecture violations detected:
// - Resource 'UserProfiles' violates naming convention: ^[a-z][a-z]+s$
// - Resource 'UserProfiles' missing required hook: beforeInsert
// - Resource 'UserProfiles' missing required hook: beforeUpdate
// - Resource 'UserProfiles' missing required hook: afterInsert
// - Resource 'UserProfiles' missing required hook: afterUpdate
```

The correct implementation:

```javascript
// This passes all checks
api.addResource('userprofiles', {
  schema: profileSchema,
  hooks: {
    beforeInsert: async (context) => {
      context.data.createdAt = new Date()
      context.data.createdBy = context.user?.id
    },
    beforeUpdate: async (context) => {
      context.data.updatedAt = new Date()
      context.data.updatedBy = context.user?.id
    },
    afterInsert: async (context) => {
      await auditLog.record('INSERT', context)
      context.auditRecorded = true // Required for enforceAudit
    },
    afterUpdate: async (context) => {
      await auditLog.record('UPDATE', context)
      context.auditRecorded = true
    }
  }
})
```

## Advanced Patterns

### Pattern 1: Resource Type Detection

Automatically enforce different rules based on resource patterns:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  requiredHooks: {
    '*': ['beforeInsert', 'afterInsert'],
    
    // Financial resources (detected by name)
    '/.*payment.*|.*invoice.*|.*transaction.*/': [
      'beforeInsert', 'beforeUpdate', 'beforeDelete',
      'afterInsert', 'afterUpdate', 'afterDelete'
    ],
    
    // User-related resources
    '/.*user.*|.*account.*|.*profile.*/': [
      'beforeInsert', 'beforeUpdate', 'beforeDelete',
      'afterInsert', 'afterUpdate'
    ],
    
    // Audit log resources
    '/.*audit.*|.*log.*/': [
      'beforeInsert', 'afterInsert'
      // No updates or deletes allowed on audit logs!
    ]
  }
})
```

### Pattern 2: Relationship Rules

Control how resources can reference each other:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  relationshipRules: {
    // Define allowed relationship patterns
    allowedPatterns: [
      // Orders can reference users and products
      { from: 'orders', to: 'users' },
      { from: 'orders', to: 'products' },
      
      // Payments can only reference orders
      { from: 'payments', to: 'orders' },
      
      // Audit logs can reference anything
      { from: 'auditlogs', to: '*' },
      
      // Nothing can reference audit logs
      { from: '*', to: 'auditlogs', allowed: false },
      
      // Users can reference organizations
      { from: 'users', to: 'organizations' },
      
      // Prevent circular dependencies
      { from: 'organizations', to: 'users', allowed: false }
    ],
    
    // Maximum relationships per resource
    maxPerResource: 5,
    
    // Require documentation for relationships
    requireDocumentation: true
  }
})
```

This prevents architecture anti-patterns:

```javascript
// This will fail - circular dependency
api.addResource('users', {
  schema: new Schema({
    organizationId: { type: 'id', refs: 'organizations' }
  })
})

api.addResource('organizations', {
  schema: new Schema({
    ownerId: { type: 'id', refs: 'users' } // Error! Circular dependency
  })
})
```

### Pattern 3: Custom Architecture Rules

Add company-specific rules:

```javascript
// Add rule: Financial resources must have specific fields
api.addArchitectureRule({
  type: 'custom',
  name: 'financial-resource-requirements',
  validate: async (context) => {
    const { name, options } = context
    
    // Check if this is a financial resource
    if (name.includes('payment') || name.includes('invoice') || name.includes('transaction')) {
      const schema = options.schema
      
      // Must have amount field
      if (!schema.fields.amount) {
        return {
          valid: false,
          message: `Financial resource '${name}' must have an 'amount' field`
        }
      }
      
      // Must have currency field
      if (!schema.fields.currency) {
        return {
          valid: false,
          message: `Financial resource '${name}' must have a 'currency' field`
        }
      }
      
      // Must have status field with specific values
      if (!schema.fields.status || !schema.fields.status.enum) {
        return {
          valid: false,
          message: `Financial resource '${name}' must have a 'status' field with enum values`
        }
      }
      
      // Must have immutable audit fields
      const requiredAuditFields = ['createdAt', 'createdBy', 'approvedAt', 'approvedBy']
      for (const field of requiredAuditFields) {
        if (!schema.fields[field]) {
          return {
            valid: false,
            message: `Financial resource '${name}' must have '${field}' field`
          }
        }
      }
    }
    
    return { valid: true }
  }
})

// Add rule: Sensitive resources must use encryption
api.addArchitectureRule({
  type: 'custom',
  name: 'encryption-requirements',
  validate: async (context) => {
    const { name, options } = context
    const sensitiveResources = ['users', 'accounts', 'payments', 'creditcards']
    
    if (sensitiveResources.includes(name)) {
      // Check if encryption plugin is configured
      if (!options.plugins?.includes('EncryptionPlugin')) {
        return {
          valid: false,
          message: `Sensitive resource '${name}' must use EncryptionPlugin`
        }
      }
      
      // Check for PII fields without encryption
      const piiFields = ['ssn', 'taxId', 'creditCardNumber', 'bankAccount']
      for (const [fieldName, fieldConfig] of Object.entries(options.schema.fields)) {
        if (piiFields.some(pii => fieldName.toLowerCase().includes(pii))) {
          if (!fieldConfig.encrypted) {
            return {
              valid: false,
              message: `PII field '${name}.${fieldName}' must be marked as encrypted`
            }
          }
        }
      }
    }
    
    return { valid: true }
  }
})
```

## Real-World Example: E-Commerce Platform

Let's implement architecture enforcement for a real e-commerce platform:

```javascript
// ecommerce-architecture.js
import { Api, ArchitectureEnforcementPlugin, MySQLPlugin, ValidationPlugin, 
         AuthorizationPlugin, LoggingPlugin, SecurityPlugin } from 'json-rest-api'

export function createEnterpriseApi() {
  const api = new Api()
  
  // Core plugins required by architecture
  api.use(MySQLPlugin, { 
    host: process.env.DB_HOST,
    database: process.env.DB_NAME 
  })
  api.use(ValidationPlugin)
  api.use(AuthorizationPlugin)
  api.use(LoggingPlugin, { 
    level: process.env.LOG_LEVEL || 'info' 
  })
  api.use(SecurityPlugin)
  
  // Architecture enforcement
  api.use(ArchitectureEnforcementPlugin, {
    // Naming standards
    namingConventions: {
      resources: '^[a-z][a-z]+s$',
      fields: '^[a-z][a-zA-Z0-9]*$'
    },
    
    // Required plugins check
    requiredPlugins: [
      'ValidationPlugin',
      'AuthorizationPlugin', 
      'LoggingPlugin',
      'SecurityPlugin'
    ],
    
    // Hook requirements by resource pattern
    requiredHooks: {
      '*': ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate'],
      
      // Financial resources
      'orders': ['beforeDelete', 'afterDelete', 'beforeStatusChange'],
      'payments': ['beforeDelete', 'afterDelete', 'beforeStatusChange'],
      'refunds': ['beforeDelete', 'afterDelete', 'beforeApproval'],
      'invoices': ['beforeDelete', 'afterDelete'],
      
      // Inventory
      'products': ['beforeStockChange', 'afterStockChange'],
      'inventory': ['beforeAdjustment', 'afterAdjustment'],
      
      // Users and auth
      'users': ['beforeDelete', 'beforePasswordChange', 'afterPasswordChange'],
      'sessions': ['beforeCreate', 'afterExpire']
    },
    
    // Relationship rules
    relationshipRules: {
      allowedPatterns: [
        // Orders
        { from: 'orders', to: 'users' },
        { from: 'orders', to: 'addresses' },
        { from: 'orderitems', to: 'orders' },
        { from: 'orderitems', to: 'products' },
        
        // Payments
        { from: 'payments', to: 'orders' },
        { from: 'payments', to: 'paymentmethods' },
        { from: 'refunds', to: 'payments' },
        
        // Products
        { from: 'products', to: 'categories' },
        { from: 'products', to: 'brands' },
        { from: 'inventory', to: 'products' },
        { from: 'inventory', to: 'warehouses' },
        
        // Users
        { from: 'users', to: 'roles' },
        { from: 'addresses', to: 'users' },
        { from: 'paymentmethods', to: 'users' },
        { from: 'wishlists', to: 'users' },
        { from: 'carts', to: 'users' },
        
        // Reviews
        { from: 'reviews', to: 'products' },
        { from: 'reviews', to: 'users' },
        
        // Block dangerous patterns
        { from: 'users', to: 'orders', allowed: false }, // Use orders->users instead
        { from: '*', to: 'auditlogs', allowed: false }   // Audit logs are write-only
      ],
      
      maxPerResource: 6
    },
    
    // Environment rules
    allowedOperations: {
      production: {
        blockedOperations: [
          'delete:users',     // Soft delete only
          'delete:orders',    // Orders are permanent
          'delete:payments',  // Financial records are permanent
          'delete:invoices',  // Legal requirement
          'delete:auditlogs'  // Audit logs are permanent
        ],
        blockedResources: ['debug', 'test', 'migrations']
      }
    },
    
    strict: true,
    enforceAudit: true,
    environment: process.env.NODE_ENV
  })
  
  // Add custom rules
  
  // Rule: All resources must have timestamps
  api.addArchitectureRule({
    type: 'custom',
    name: 'timestamp-requirement',
    validate: async (context) => {
      const { name, options } = context
      const schema = options.schema
      
      if (!schema.fields.createdAt || !schema.fields.updatedAt) {
        return {
          valid: false,
          message: `Resource '${name}' must have createdAt and updatedAt fields`
        }
      }
      
      return { valid: true }
    }
  })
  
  // Rule: Financial resources must be immutable after certain states
  api.addArchitectureRule({
    type: 'custom',
    name: 'financial-immutability',
    validate: async (context) => {
      const { name, options } = context
      const financialResources = ['payments', 'invoices', 'refunds']
      
      if (financialResources.includes(name)) {
        // Must have beforeUpdate hook that checks status
        const beforeUpdate = options.hooks?.beforeUpdate
        if (!beforeUpdate) {
          return {
            valid: false,
            message: `Financial resource '${name}' must implement status-based immutability`
          }
        }
      }
      
      return { valid: true }
    }
  })
  
  return api
}

// Usage in your application
const api = createEnterpriseApi()

// This will pass all architecture checks
api.addResource('products', {
  schema: new Schema({
    // Naming convention: camelCase ✓
    name: { type: 'string', required: true },
    description: { type: 'string' },
    price: { type: 'number', required: true, min: 0 },
    currency: { type: 'string', default: 'USD' },
    stockQuantity: { type: 'number', default: 0 },
    categoryId: { type: 'id', refs: 'categories' }, // Allowed relationship ✓
    brandId: { type: 'id', refs: 'brands' },       // Allowed relationship ✓
    
    // Required timestamps ✓
    createdAt: { type: 'timestamp', default: () => Date.now() },
    updatedAt: { type: 'timestamp', default: () => Date.now() }
  }),
  
  hooks: {
    // Required hooks ✓
    beforeInsert: async (context) => {
      context.data.createdAt = new Date()
      context.data.createdBy = context.user?.id
    },
    afterInsert: async (context) => {
      await api.log.info('Product created', { 
        id: context.result.id,
        name: context.data.name 
      })
      context.auditRecorded = true
    },
    beforeUpdate: async (context) => {
      context.data.updatedAt = new Date()
      context.data.updatedBy = context.user?.id
    },
    afterUpdate: async (context) => {
      await api.log.info('Product updated', {
        id: context.id,
        changes: context.changes
      })
      context.auditRecorded = true
    },
    
    // Custom hooks for inventory
    beforeStockChange: async (context) => {
      const oldQuantity = context.existing.stockQuantity
      const newQuantity = context.data.stockQuantity
      
      if (newQuantity < 0) {
        throw new Error('Stock quantity cannot be negative')
      }
      
      context.stockChange = {
        old: oldQuantity,
        new: newQuantity,
        difference: newQuantity - oldQuantity
      }
    },
    afterStockChange: async (context) => {
      await api.log.info('Stock changed', {
        productId: context.id,
        change: context.stockChange
      })
    }
  }
})

// This will fail architecture checks
try {
  api.addResource('Order-Items', { // Wrong naming convention!
    schema: new Schema({
      order_id: { type: 'id' }, // Wrong field naming!
      ProductID: { type: 'id' }  // Wrong field naming!
    })
    // Missing required hooks!
  })
} catch (error) {
  console.error('Architecture violation:', error.message)
}
```

## Testing Your Architecture

Create tests to ensure your architecture rules work:

```javascript
// architecture.test.js
import { createEnterpriseApi } from './ecommerce-architecture.js'

describe('Architecture Enforcement', () => {
  let api
  
  beforeEach(() => {
    api = createEnterpriseApi()
  })
  
  test('should reject resources with wrong naming', () => {
    expect(() => {
      api.addResource('UserAccounts', { schema: new Schema({}) })
    }).toThrow(/violates naming convention/)
  })
  
  test('should reject resources without required hooks', () => {
    expect(() => {
      api.addResource('products', {
        schema: new Schema({ name: { type: 'string' } })
        // Missing hooks
      })
    }).toThrow(/missing required hook/)
  })
  
  test('should reject invalid relationships', () => {
    expect(() => {
      api.addResource('users', {
        schema: new Schema({
          orderId: { type: 'id', refs: 'orders' } // Not allowed!
        }),
        hooks: { /* ... */ }
      })
    }).toThrow(/not allowed by architecture rules/)
  })
  
  test('should allow valid resources', () => {
    expect(() => {
      api.addResource('products', {
        schema: new Schema({
          name: { type: 'string' },
          price: { type: 'number' },
          categoryId: { type: 'id', refs: 'categories' },
          createdAt: { type: 'timestamp' },
          updatedAt: { type: 'timestamp' }
        }),
        hooks: {
          beforeInsert: async () => {},
          afterInsert: async (ctx) => { ctx.auditRecorded = true },
          beforeUpdate: async () => {},
          afterUpdate: async (ctx) => { ctx.auditRecorded = true },
          beforeStockChange: async () => {},
          afterStockChange: async () => {}
        }
      })
    }).not.toThrow()
  })
})
```

## Gradual Adoption Strategy

### Phase 1: Warning Mode (Month 1)

Start with warnings to identify violations without breaking existing code:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  ...architectureConfig,
  strict: false  // Just warn, don't throw errors
})
```

### Phase 2: Partial Enforcement (Month 2)

Enforce critical rules while warning on others:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  ...architectureConfig,
  strict: ['namingConventions', 'requiredHooks'],  // Enforce these
  warn: ['relationshipRules']  // Just warn on these
})
```

### Phase 3: Full Enforcement (Month 3)

Enable full strict mode:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  ...architectureConfig,
  strict: true
})
```

## Monitoring and Reporting

Get architecture compliance reports:

```javascript
// Check current architecture state
const report = api.checkArchitecture()
console.log('Architecture Report:', {
  valid: report.valid,
  violations: report.violations,
  resourceCount: Object.keys(api.resources).length
})

// Export architecture documentation
const architectureDocs = api.exportArchitecture()
fs.writeFileSync('architecture.json', JSON.stringify(architectureDocs, null, 2))
```

## Common Pitfalls and Solutions

### Pitfall 1: Over-Restrictive Rules

**Problem:** Rules so strict that development becomes painful.

**Solution:** Start permissive and tighten gradually:

```javascript
// Start with basics
const basicRules = {
  namingConventions: {
    resources: '^[a-zA-Z]+$'  // Just letters
  },
  requiredHooks: {
    '*': ['beforeInsert']  // Just one hook
  }
}

// Evolve to stricter rules over time
const stricterRules = {
  namingConventions: {
    resources: '^[a-z][a-z]+s$'  // lowercase, plural
  },
  requiredHooks: {
    '*': ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate']
  }
}
```

### Pitfall 2: Missing Context in Errors

**Problem:** Developers get cryptic error messages.

**Solution:** Add helpful error messages:

```javascript
api.addArchitectureRule({
  type: 'custom',
  validate: async (context) => {
    // Provide helpful context
    return {
      valid: false,
      message: `Resource '${context.name}' must have audit fields.
      
      Add these fields to your schema:
      - createdAt: { type: 'timestamp', default: () => Date.now() }
      - createdBy: { type: 'string' }
      - updatedAt: { type: 'timestamp', default: () => Date.now() }
      - updatedBy: { type: 'string' }
      
      And implement these hooks:
      - beforeInsert: Set createdAt and createdBy
      - beforeUpdate: Set updatedAt and updatedBy
      
      See: https://docs.company.com/architecture/audit-fields`
    }
  }
})
```

### Pitfall 3: Different Rules for Different Teams

**Problem:** Backend and frontend teams have different needs.

**Solution:** Use resource prefixes or namespaces:

```javascript
api.use(ArchitectureEnforcementPlugin, {
  // Different rules for different prefixes
  namingConventions: {
    'api:*': '^api[A-Z][a-zA-Z]+$',     // apiUsers, apiOrders
    'internal:*': '^int[A-Z][a-zA-Z]+$', // intAuditLogs
    '*': '^[a-z][a-z]+s$'               // Default: users, orders
  },
  
  requiredHooks: {
    'api:*': ['beforeInsert', 'afterInsert'],
    'internal:*': ['beforeInsert'],
    '*': ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate']
  }
})
```

## Summary

Architecture enforcement is about maintaining consistency and quality at scale. Start with basic rules, monitor violations, and gradually increase strictness. The goal is to make the right thing the easy thing.

Next chapter: [Dependency Management →](./ENTERPRISE_GUIDE_02_Dependency_Management.md)