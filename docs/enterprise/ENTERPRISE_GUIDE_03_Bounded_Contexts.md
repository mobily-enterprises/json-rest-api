# Enterprise Guide: Chapter 3 - Bounded Contexts

## The Communication Problem

Picture this conversation happening in your company:

**Sales Team**: "We need to update the customer's status to 'gold'."  
**Billing Team**: "Customer? You mean account? And what's 'gold'? We only have 'premium' and 'standard'."  
**Support Team**: "Wait, I thought we called them 'users' and they have 'priority levels', not status..."  
**Engineering**: "Actually, in the database it's `usr_tier_cd` and it's an integer..."

This is the bounded context problem. Different parts of your business use different language for the same concepts, and forcing everyone to use the same terms creates a mess. Bounded contexts solve this by acknowledging these differences and managing them explicitly.

## Understanding Bounded Contexts

### What's a Bounded Context?

A bounded context is a boundary within which a specific model applies. Inside that boundary:
- Terms have specific, consistent meanings
- The model is optimized for that context's needs
- Changes don't leak out to other contexts

Think of it like international business - the USA and UK both use "dollars" and "pounds", but they mean completely different things. The country is the context that gives meaning to the terms.

### Real Example: E-Commerce System

Let's see how the same "user" means different things across contexts:

```javascript
// Customer Context - focused on shopping experience
const CustomerUser = {
  id: 'uuid',
  name: 'John Doe',
  email: 'john@example.com',
  preferredName: 'Johnny',
  shoppingCart: [...],
  wishlist: [...],
  recentlyViewed: [...],
  preferences: {
    currency: 'USD',
    language: 'en',
    newsletter: true
  }
}

// Billing Context - focused on payments and invoicing
const BillingAccount = {
  accountId: 'ACC-12345',
  legalName: 'John William Doe',
  taxId: '123-45-6789',
  billingEmail: 'billing@johndoe.com',
  paymentTerms: 'NET30',
  creditLimit: 10000,
  balance: -1523.50,
  status: 'CURRENT' // CURRENT, OVERDUE, SUSPENDED
}

// Shipping Context - focused on deliveries
const ShippingRecipient = {
  recipientId: 'RCP-98765',
  fullName: 'John Doe',
  addresses: [
    {
      type: 'DEFAULT',
      street: '123 Main St',
      validated: true,
      instructions: 'Leave at door'
    }
  ],
  phoneNumbers: ['+1-555-0123'],
  deliveryPreferences: {
    signature: false,
    safeDropOff: true
  }
}

// Support Context - focused on help and tickets
const SupportContact = {
  contactId: 'SUP-45678',
  displayName: 'jdoe',
  email: 'john@example.com',
  tier: 'GOLD', // Support priority
  tickets: [...],
  knowledge: {
    articlesRead: 45,
    videosWatched: 12
  }
}
```

Same person, four different models, each optimized for its context!

## Implementing Bounded Contexts

### Step 1: Identify Your Contexts

Start by mapping your business domains:

```javascript
// contexts-map.js
export const contextsMap = {
  // Customer-facing contexts
  customer: {
    name: 'Customer Experience',
    description: 'Shopping, browsing, personalization',
    team: 'Frontend Team',
    resources: ['users', 'carts', 'wishlists', 'preferences']
  },
  
  // Order management contexts
  ordering: {
    name: 'Order Management',
    description: 'Order placement and tracking',
    team: 'Order Team',
    resources: ['orders', 'orderitems', 'orderstatuses']
  },
  
  // Financial contexts
  billing: {
    name: 'Billing & Invoicing',
    description: 'Payments, invoices, accounting',
    team: 'Finance Team',
    resources: ['accounts', 'invoices', 'payments', 'credits']
  },
  
  // Fulfillment contexts
  shipping: {
    name: 'Shipping & Logistics',
    description: 'Warehouses, shipments, carriers',
    team: 'Logistics Team',
    resources: ['shipments', 'packages', 'carriers', 'warehouses']
  },
  
  // Inventory contexts
  inventory: {
    name: 'Inventory Management',
    description: 'Stock levels, suppliers, purchasing',
    team: 'Supply Chain Team',
    resources: ['products', 'stock', 'suppliers', 'purchaseorders']
  },
  
  // Support contexts
  support: {
    name: 'Customer Support',
    description: 'Tickets, help, communication',
    team: 'Support Team',
    resources: ['tickets', 'contacts', 'conversations', 'solutions']
  }
}
```

### Step 2: Set Up the Plugin

```javascript
import { Api, BoundedContextPlugin } from 'json-rest-api'

const api = new Api()

api.use(BoundedContextPlugin, {
  contexts: contextsMap,
  
  // Resources used by multiple contexts
  sharedKernel: [
    'currencies',     // Everyone needs currency codes
    'countries',      // Everyone needs country data
    'timezones',      // Shared time zone data
    'emailtemplates'  // Shared email templates
  ],
  
  // Enforce context boundaries
  anticorruption: true,
  
  // Optional: event bus for context communication
  eventBus: new EventEmitter()
})
```

### Step 3: Define Context-Specific Models

Each context has its own optimized model:

```javascript
// Customer Context
api.createContext('customer', {
  namespace: 'customer'
})

api.addResourceToContext('customer', 'users', {
  schema: new Schema({
    // Customer-focused fields
    id: { type: 'uuid', generated: true },
    email: { type: 'string', required: true },
    name: { type: 'string' },
    preferredName: { type: 'string' },
    avatar: { type: 'string' },
    
    // Shopping behavior
    lastVisit: { type: 'timestamp' },
    visitCount: { type: 'number', default: 0 },
    abandonedCarts: { type: 'number', default: 0 },
    
    // Preferences
    currency: { type: 'string', default: 'USD' },
    language: { type: 'string', default: 'en' },
    theme: { type: 'string', default: 'light' }
  })
})

// Billing Context - same user, different view
api.createContext('billing', {
  namespace: 'billing'
})

api.addResourceToContext('billing', 'accounts', {
  schema: new Schema({
    // Billing-focused fields
    accountId: { type: 'string', generated: true },
    customerId: { type: 'uuid' }, // Links to customer context
    
    // Legal/financial data
    legalName: { type: 'string', required: true },
    taxId: { type: 'string', encrypted: true },
    vatNumber: { type: 'string' },
    
    // Billing details
    billingEmail: { type: 'string', required: true },
    paymentTerms: { type: 'string', default: 'IMMEDIATE' },
    creditLimit: { type: 'number', default: 0 },
    
    // Financial status
    balance: { type: 'number', default: 0 },
    status: { 
      type: 'string', 
      enum: ['CURRENT', 'OVERDUE', 'SUSPENDED', 'CLOSED']
    },
    
    // Risk assessment
    riskScore: { type: 'number', min: 0, max: 100 },
    paymentHistory: { type: 'array' }
  })
})
```

### Step 4: Define Context Mappings

Define how data translates between contexts:

```javascript
// When customer context needs billing data
api.defineContextMapping('customer', 'billing', {
  type: 'conformist', // Customer conforms to billing's model
  accounts: {
    fields: {
      accountId: 'billingAccountId',
      status: (value) => {
        // Translate billing status to customer-friendly
        const statusMap = {
          'CURRENT': 'active',
          'OVERDUE': 'needs-attention',
          'SUSPENDED': 'suspended',
          'CLOSED': 'inactive'
        }
        return statusMap[value] || 'unknown'
      },
      balance: (value) => {
        // Customer context shows positive balance
        return Math.abs(value)
      },
      creditLimit: null, // Don't expose to customer
      riskScore: null    // Don't expose to customer
    }
  }
})

// When billing context needs customer data
api.defineContextMapping('billing', 'customer', {
  type: 'anticorruption', // Billing protects itself from customer changes
  users: {
    fields: {
      id: 'customerId',
      email: 'contactEmail',
      name: 'legalName', // Might be different!
      // Billing doesn't care about shopping behavior
      lastVisit: null,
      visitCount: null,
      abandonedCarts: null,
      avatar: null,
      theme: null
    },
    transform: (customerData) => {
      // Additional transformation logic
      return {
        customerId: customerData.id,
        contactEmail: customerData.email,
        legalName: customerData.name || 'Unknown',
        // Derive risk score from behavior
        riskScore: calculateRiskScore(customerData)
      }
    }
  }
})

function calculateRiskScore(customerData) {
  let score = 50 // Start neutral
  
  // High abandonment rate increases risk
  if (customerData.abandonedCarts > 5) score += 10
  
  // Low visit count increases risk
  if (customerData.visitCount < 3) score += 15
  
  // Recent activity decreases risk
  const daysSinceVisit = (Date.now() - customerData.lastVisit) / (1000 * 60 * 60 * 24)
  if (daysSinceVisit < 7) score -= 20
  
  return Math.max(0, Math.min(100, score))
}
```

## Advanced Patterns

### Pattern 1: Shared Kernel

Some concepts are truly shared across contexts:

```javascript
// Shared kernel resources - used by everyone
api.addResource('currencies', {
  schema: new Schema({
    code: { type: 'string', required: true }, // USD, EUR, GBP
    name: { type: 'string', required: true },
    symbol: { type: 'string', required: true },
    decimals: { type: 'number', default: 2 }
  }),
  shared: true // Mark as shared kernel
})

// All contexts can use currencies without translation
const customerContext = api.withinContext('customer')
const currency = await customerContext.resources.currencies.get('USD')

const billingContext = api.withinContext('billing')
const sameCurrency = await billingContext.resources.currencies.get('USD')
// Same data, no translation needed
```

### Pattern 2: Published Language

When contexts need to communicate, use a published language:

```javascript
// Define events as published language
const OrderEvents = {
  OrderPlaced: {
    orderId: 'string',
    customerId: 'string',
    total: 'number',
    currency: 'string',
    items: 'array'
  },
  
  OrderShipped: {
    orderId: 'string',
    shipmentId: 'string',
    carrier: 'string',
    trackingNumber: 'string'
  },
  
  OrderDelivered: {
    orderId: 'string',
    deliveredAt: 'timestamp',
    signedBy: 'string'
  }
}

// Ordering context publishes events
const orderingContext = api.withinContext('ordering')

orderingContext.publish('OrderPlaced', {
  orderId: 'ORD-123',
  customerId: 'CUST-456',
  total: 99.99,
  currency: 'USD',
  items: [
    { sku: 'WIDGET-1', quantity: 2, price: 49.99 }
  ]
})

// Other contexts subscribe and translate
const shippingContext = api.withinContext('shipping')

shippingContext.subscribe('ordering', 'OrderPlaced', async (event) => {
  // Translate to shipping's model
  const shipment = {
    orderId: event.data.orderId,
    // Look up customer's shipping address
    recipientId: await lookupRecipient(event.data.customerId),
    items: event.data.items.map(item => ({
      sku: item.sku,
      quantity: item.quantity,
      // Shipping cares about weight, not price
      weight: await getProductWeight(item.sku)
    })),
    priority: calculateShippingPriority(event.data.total)
  }
  
  await shippingContext.resources.shipments.insert(shipment)
})
```

### Pattern 3: Anti-Corruption Layer

Protect your context from external changes:

```javascript
// External payment provider integration
class PaymentGatewayACL {
  constructor(context) {
    this.context = context
    this.gateway = new ExternalPaymentGateway()
  }
  
  async processPayment(billingPayment) {
    // Translate our model to external API
    const externalRequest = {
      // Their API uses different field names
      transaction_id: billingPayment.paymentId,
      amount_cents: Math.round(billingPayment.amount * 100),
      currency_code: billingPayment.currency,
      card_token: billingPayment.paymentMethod.token,
      
      // They require fields we don't use
      merchant_ref: `${process.env.MERCHANT_ID}-${billingPayment.paymentId}`,
      ip_address: billingPayment.metadata?.ipAddress || '0.0.0.0',
      
      // Transform our status to their codes
      capture_mode: billingPayment.captureImmediate ? 'AUTO' : 'MANUAL'
    }
    
    try {
      // Call external API
      const response = await this.gateway.charge(externalRequest)
      
      // Translate response back to our model
      return {
        success: response.status === 'APPROVED',
        transactionId: response.gateway_ref,
        processorResponse: response.processor_code,
        // Map their status to ours
        status: this.mapStatus(response.status),
        // Extract what we care about
        fees: {
          processing: response.fees.processing / 100,
          gateway: response.fees.gateway / 100
        }
      }
    } catch (error) {
      // Protect our context from their errors
      throw new PaymentProcessingError(
        'Payment processing failed',
        { originalError: error.message }
      )
    }
  }
  
  mapStatus(externalStatus) {
    const statusMap = {
      'APPROVED': 'completed',
      'PENDING': 'processing',
      'DECLINED': 'failed',
      'ERROR': 'failed',
      'CANCELLED': 'cancelled'
    }
    return statusMap[externalStatus] || 'unknown'
  }
}

// Use the ACL in billing context
const billingContext = api.withinContext('billing')
const paymentACL = new PaymentGatewayACL(billingContext)

// Process payment through ACL
const result = await paymentACL.processPayment({
  paymentId: 'PAY-123',
  amount: 99.99,
  currency: 'USD',
  paymentMethod: { token: 'tok_visa' },
  captureImmediate: true
})
```

## Real-World Example: Multi-Brand E-Commerce

Let's implement a complete multi-brand e-commerce system with proper bounded contexts:

```javascript
// Initialize the system
import { Api, BoundedContextPlugin, MySQLPlugin } from 'json-rest-api'

class MultiTenantEcommerce {
  constructor() {
    this.contexts = new Map()
    this.eventBus = new EventEmitter()
  }
  
  async initialize() {
    // Create separate API instances for each context
    // This provides true isolation
    
    // Customer Context - handles shopping experience
    this.contexts.set('customer', await this.createCustomerContext())
    
    // Catalog Context - manages products across brands
    this.contexts.set('catalog', await this.createCatalogContext())
    
    // Ordering Context - handles order lifecycle
    this.contexts.set('ordering', await this.createOrderingContext())
    
    // Billing Context - payments and invoicing
    this.contexts.set('billing', await this.createBillingContext())
    
    // Inventory Context - stock management
    this.contexts.set('inventory', await this.createInventoryContext())
    
    // Set up inter-context communication
    this.setupEventRouting()
  }
  
  async createCustomerContext() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'ecommerce_customer'
    })
    
    api.use(BoundedContextPlugin, {
      contexts: {
        customer: {
          name: 'Customer Experience',
          resources: ['users', 'sessions', 'carts', 'wishlists', 'reviews']
        }
      },
      eventBus: this.eventBus
    })
    
    // User model optimized for shopping
    api.addResource('users', {
      schema: new Schema({
        id: { type: 'uuid', generated: true },
        email: { type: 'string', required: true, unique: true },
        
        // Multi-brand support
        brandPreferences: {
          type: 'object',
          default: {},
          structure: {
            '*': {
              lastVisit: { type: 'timestamp' },
              favoriteCategories: { type: 'array' },
              sizeProfile: { type: 'object' }
            }
          }
        },
        
        // Personalization data
        browsingHistory: { type: 'array', maxItems: 100 },
        purchaseHistory: { type: 'array' },
        recommendations: { type: 'array' },
        
        // Engagement metrics
        loyaltyPoints: { type: 'number', default: 0 },
        tier: { type: 'string', default: 'bronze' },
        lifetimeValue: { type: 'number', default: 0 }
      })
    })
    
    // Shopping cart with brand isolation
    api.addResource('carts', {
      schema: new Schema({
        id: { type: 'uuid', generated: true },
        userId: { type: 'uuid', refs: 'users' },
        brandId: { type: 'string', required: true },
        
        items: {
          type: 'array',
          items: {
            productId: { type: 'string' }, // From catalog context
            variantId: { type: 'string' },
            quantity: { type: 'number', min: 1 },
            price: { type: 'number' }, // Snapshot at add time
            
            // Personalization
            addedFrom: { type: 'string' }, // 'search', 'recommendation', etc
            savedForLater: { type: 'boolean', default: false }
          }
        },
        
        // Cart analytics
        createdAt: { type: 'timestamp', generated: true },
        updatedAt: { type: 'timestamp' },
        abandonedAt: { type: 'timestamp' },
        recoveryAttempts: { type: 'number', default: 0 }
      })
    })
    
    return api
  }
  
  async createCatalogContext() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'ecommerce_catalog'
    })
    
    // Catalog manages products for multiple brands
    api.addResource('brands', {
      schema: new Schema({
        id: { type: 'string', required: true }, // 'nike', 'adidas', etc
        name: { type: 'string', required: true },
        
        // Brand configuration
        config: {
          type: 'object',
          structure: {
            currencies: { type: 'array' }, // Supported currencies
            languages: { type: 'array' },  // Supported languages
            warehouses: { type: 'array' }, // Available warehouses
            
            // Brand-specific rules
            returnPolicy: { type: 'object' },
            shippingRules: { type: 'object' },
            pricingRules: { type: 'object' }
          }
        }
      })
    })
    
    api.addResource('products', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        brandId: { type: 'string', refs: 'brands', required: true },
        
        // Multi-locale support
        content: {
          type: 'object',
          structure: {
            '*': { // Locale code (en-US, fr-FR, etc)
              title: { type: 'string' },
              description: { type: 'string' },
              features: { type: 'array' },
              seoData: { type: 'object' }
            }
          }
        },
        
        // Product data
        sku: { type: 'string', required: true },
        category: { type: 'string', required: true },
        tags: { type: 'array' },
        
        // Variants (size, color, etc)
        variants: {
          type: 'array',
          items: {
            id: { type: 'string' },
            attributes: { type: 'object' }, // {size: 'M', color: 'Blue'}
            sku: { type: 'string' },
            barcode: { type: 'string' },
            
            // Pricing per market
            pricing: {
              type: 'object',
              structure: {
                '*': { // Market code
                  currency: { type: 'string' },
                  listPrice: { type: 'number' },
                  salePrice: { type: 'number' },
                  taxRate: { type: 'number' }
                }
              }
            }
          }
        },
        
        // Publishing control
        status: { type: 'string', enum: ['draft', 'active', 'discontinued'] },
        publishedAt: { type: 'timestamp' },
        publishedMarkets: { type: 'array' } // Which markets can see this
      })
    })
    
    return api
  }
  
  async createOrderingContext() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'ecommerce_ordering'
    })
    
    // Orders span multiple contexts
    api.addResource('orders', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        number: { type: 'string', unique: true }, // Human-readable
        
        // Links to other contexts
        customerId: { type: 'uuid' },    // From customer context
        brandId: { type: 'string' },     // From catalog context
        
        // Order data
        items: {
          type: 'array',
          items: {
            productId: { type: 'string' },
            variantId: { type: 'string' },
            quantity: { type: 'number' },
            
            // Snapshot data at order time
            price: { type: 'number' },
            tax: { type: 'number' },
            discount: { type: 'number' },
            productData: { type: 'object' } // Snapshot of product
          }
        },
        
        // Totals
        subtotal: { type: 'number' },
        tax: { type: 'number' },
        shipping: { type: 'number' },
        discount: { type: 'number' },
        total: { type: 'number' },
        currency: { type: 'string' },
        
        // Status management
        status: {
          type: 'string',
          enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
        },
        
        // Addresses
        shippingAddress: { type: 'object' },
        billingAddress: { type: 'object' },
        
        // Metadata
        placedAt: { type: 'timestamp' },
        confirmedAt: { type: 'timestamp' },
        fulfilledAt: { type: 'timestamp' }
      }),
      
      hooks: {
        afterInsert: async (context) => {
          // Publish event for other contexts
          context.api.publish('OrderPlaced', {
            orderId: context.result.id,
            customerId: context.result.customerId,
            brandId: context.result.brandId,
            total: context.result.total,
            items: context.result.items
          })
        },
        
        afterUpdate: async (context) => {
          // Publish status changes
          if (context.changes.status) {
            context.api.publish('OrderStatusChanged', {
              orderId: context.id,
              oldStatus: context.existing.status,
              newStatus: context.data.status,
              changedAt: new Date()
            })
          }
        }
      }
    })
    
    return api
  }
  
  async createBillingContext() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'ecommerce_billing'
    })
    
    // Billing has its own view of customers
    api.addResource('accounts', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        customerId: { type: 'uuid' }, // Link to customer context
        
        // Billing information
        legalEntity: {
          type: 'object',
          structure: {
            type: { type: 'string' }, // 'individual', 'company'
            name: { type: 'string' },
            taxId: { type: 'string', encrypted: true },
            address: { type: 'object' }
          }
        },
        
        // Payment methods
        paymentMethods: {
          type: 'array',
          items: {
            id: { type: 'string' },
            type: { type: 'string' }, // 'card', 'bank', 'paypal'
            isDefault: { type: 'boolean' },
            
            // Encrypted payment data
            data: { type: 'object', encrypted: true }
          }
        },
        
        // Account status
        status: { type: 'string' },
        creditLimit: { type: 'number' },
        balance: { type: 'number' },
        
        // Billing preferences
        invoiceEmail: { type: 'string' },
        paymentTerms: { type: 'string' },
        autoCharge: { type: 'boolean' }
      })
    })
    
    // Payments linked to orders
    api.addResource('payments', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        accountId: { type: 'string', refs: 'accounts' },
        orderId: { type: 'string' }, // From ordering context
        
        // Payment details
        amount: { type: 'number', required: true },
        currency: { type: 'string', required: true },
        method: { type: 'string' },
        
        // Transaction data
        status: { type: 'string' },
        processedAt: { type: 'timestamp' },
        processor: { type: 'string' },
        processorTransactionId: { type: 'string' },
        
        // For reconciliation
        fees: { type: 'number' },
        netAmount: { type: 'number' }
      })
    })
    
    return api
  }
  
  async createInventoryContext() {
    const api = new Api()
    
    api.use(MySQLPlugin, {
      host: process.env.DB_HOST,
      database: 'ecommerce_inventory'
    })
    
    // Inventory tracks stock across warehouses
    api.addResource('stock', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        
        // What and where
        productId: { type: 'string' },  // From catalog
        variantId: { type: 'string' },
        warehouseId: { type: 'string' },
        
        // Quantities
        available: { type: 'number', default: 0 },
        reserved: { type: 'number', default: 0 },
        incoming: { type: 'number', default: 0 },
        
        // Stock management
        reorderPoint: { type: 'number' },
        reorderQuantity: { type: 'number' },
        
        // Last update tracking
        lastCount: { type: 'timestamp' },
        lastReplenishment: { type: 'timestamp' }
      })
    })
    
    // Reservations for orders
    api.addResource('reservations', {
      schema: new Schema({
        id: { type: 'string', generated: true },
        orderId: { type: 'string' },
        
        items: {
          type: 'array',
          items: {
            stockId: { type: 'string', refs: 'stock' },
            quantity: { type: 'number' },
            expiresAt: { type: 'timestamp' }
          }
        },
        
        status: { type: 'string' },
        createdAt: { type: 'timestamp' }
      })
    })
    
    return api
  }
  
  setupEventRouting() {
    // Customer → Ordering: Cart checkout
    this.eventBus.on('customer.CartCheckedOut', async (event) => {
      const orderingApi = this.contexts.get('ordering')
      
      // Transform cart to order
      const order = {
        customerId: event.data.userId,
        brandId: event.data.brandId,
        items: event.data.items.map(item => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price
        })),
        status: 'pending'
      }
      
      await orderingApi.resources.orders.insert(order)
    })
    
    // Ordering → Inventory: Reserve stock
    this.eventBus.on('ordering.OrderPlaced', async (event) => {
      const inventoryApi = this.contexts.get('inventory')
      
      // Create reservation
      const reservation = {
        orderId: event.data.orderId,
        items: [],
        status: 'pending'
      }
      
      // Find available stock for each item
      for (const item of event.data.items) {
        const stocks = await inventoryApi.resources.stock.query({
          filter: {
            productId: item.productId,
            variantId: item.variantId,
            available: { $gte: item.quantity }
          },
          sort: 'warehouseId' // Prefer certain warehouses
        })
        
        if (stocks.length > 0) {
          const stock = stocks[0]
          
          // Reserve the stock
          await inventoryApi.resources.stock.update(stock.id, {
            available: stock.available - item.quantity,
            reserved: stock.reserved + item.quantity
          })
          
          reservation.items.push({
            stockId: stock.id,
            quantity: item.quantity,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 min
          })
        }
      }
      
      await inventoryApi.resources.reservations.insert(reservation)
    })
    
    // Ordering → Billing: Process payment
    this.eventBus.on('ordering.OrderConfirmed', async (event) => {
      const billingApi = this.contexts.get('billing')
      
      // Find account
      const accounts = await billingApi.resources.accounts.query({
        filter: { customerId: event.data.customerId }
      })
      
      if (accounts.length > 0) {
        const account = accounts[0]
        
        // Create payment
        await billingApi.resources.payments.insert({
          accountId: account.id,
          orderId: event.data.orderId,
          amount: event.data.total,
          currency: event.data.currency,
          method: account.paymentMethods.find(m => m.isDefault)?.type || 'card',
          status: 'pending'
        })
      }
    })
  }
}

// Initialize the system
const ecommerce = new MultiTenantEcommerce()
await ecommerce.initialize()

// Use contexts independently
const customerApi = ecommerce.contexts.get('customer')
const catalogApi = ecommerce.contexts.get('catalog')

// Each context has its own API
const user = await customerApi.resources.users.get('user-123')
const product = await catalogApi.resources.products.get('prod-456')
```

## Testing Bounded Contexts

### Unit Testing Context Isolation

```javascript
describe('Bounded Context Isolation', () => {
  let system
  
  beforeEach(async () => {
    system = new MultiTenantEcommerce()
    await system.initialize()
  })
  
  test('contexts should be isolated', async () => {
    const customerApi = system.contexts.get('customer')
    const billingApi = system.contexts.get('billing')
    
    // Create user in customer context
    const user = await customerApi.resources.users.insert({
      email: 'test@example.com',
      name: 'Test User'
    })
    
    // Billing context can't directly access customer users
    await expect(
      billingApi.resources.users.get(user.id)
    ).rejects.toThrow(/Resource 'users' not found/)
    
    // Must go through proper channels
    const account = await billingApi.resources.accounts.query({
      filter: { customerId: user.id }
    })
    expect(account).toHaveLength(0) // No account yet
  })
  
  test('events should translate between contexts', async () => {
    const customerApi = system.contexts.get('customer')
    const orderingApi = system.contexts.get('ordering')
    
    // Spy on order creation
    const orderSpy = jest.spyOn(orderingApi.resources.orders, 'insert')
    
    // Customer checks out
    await customerApi.publish('CartCheckedOut', {
      userId: 'user-123',
      brandId: 'nike',
      items: [
        { productId: 'prod-1', quantity: 2, price: 50 }
      ]
    })
    
    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Order should be created in ordering context
    expect(orderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'user-123',
        brandId: 'nike',
        status: 'pending'
      })
    )
  })
  
  test('anti-corruption layer should protect context', async () => {
    const billingApi = system.contexts.get('billing')
    
    // External API returns unexpected format
    const externalData = {
      usr_id: '12345',           // Wrong field name
      LEGAL_NAME: 'JOHN DOE',    // Wrong case
      tax_identifier: '123456',   // Wrong field name
      account_balance: '-150.00', // String instead of number
      status_code: 'ACT'         // Cryptic code
    }
    
    // ACL translates to our model
    const account = billingApi.translateExternalAccount(externalData)
    
    expect(account).toEqual({
      customerId: '12345',
      legalEntity: {
        name: 'John Doe',
        taxId: '123456'
      },
      balance: -150,
      status: 'active'
    })
  })
})
```

### Integration Testing Across Contexts

```javascript
describe('Cross-Context Integration', () => {
  test('complete order flow across contexts', async () => {
    const system = new MultiTenantEcommerce()
    await system.initialize()
    
    // 1. Customer browses products
    const customerApi = system.contexts.get('customer')
    const catalogApi = system.contexts.get('catalog')
    
    const products = await catalogApi.resources.products.query({
      filter: { brandId: 'nike', category: 'shoes' }
    })
    
    // 2. Customer adds to cart
    const cart = await customerApi.resources.carts.insert({
      userId: 'user-123',
      brandId: 'nike',
      items: [{
        productId: products[0].id,
        variantId: products[0].variants[0].id,
        quantity: 1,
        price: products[0].variants[0].pricing.US.salePrice
      }]
    })
    
    // 3. Customer checks out
    await customerApi.publish('CartCheckedOut', {
      cartId: cart.id,
      userId: cart.userId,
      brandId: cart.brandId,
      items: cart.items
    })
    
    // Wait for all events to process
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 4. Verify order created
    const orderingApi = system.contexts.get('ordering')
    const orders = await orderingApi.resources.orders.query({
      filter: { customerId: 'user-123' }
    })
    
    expect(orders).toHaveLength(1)
    expect(orders[0].status).toBe('pending')
    
    // 5. Verify stock reserved
    const inventoryApi = system.contexts.get('inventory')
    const reservations = await inventoryApi.resources.reservations.query({
      filter: { orderId: orders[0].id }
    })
    
    expect(reservations).toHaveLength(1)
    expect(reservations[0].items).toHaveLength(1)
    
    // 6. Verify payment initiated
    const billingApi = system.contexts.get('billing')
    const payments = await billingApi.resources.payments.query({
      filter: { orderId: orders[0].id }
    })
    
    expect(payments).toHaveLength(1)
    expect(payments[0].status).toBe('pending')
  })
})
```

## Common Pitfalls and Solutions

### Pitfall 1: Shared Database

**Problem**: Teams share a database and step on each other's toes.

**Solution**: Each context gets its own database:

```javascript
// Each context has its own database
const customerDb = 'ecommerce_customer'
const billingDb = 'ecommerce_billing'
const inventoryDb = 'ecommerce_inventory'

// Or at least separate schemas
const customerSchema = 'customer'
const billingSchema = 'billing'
const inventorySchema = 'inventory'
```

### Pitfall 2: Chatty Contexts

**Problem**: Contexts constantly call each other, creating tight coupling.

**Solution**: Use events for loose coupling:

```javascript
// BAD: Direct calls create coupling
const customerApi = getCustomerContext()
const billingApi = getBillingContext()

// Billing calls customer directly
const user = await customerApi.resources.users.get(userId)
const account = await billingApi.resources.accounts.insert({
  customerId: user.id,
  name: user.name // Tight coupling!
})

// GOOD: Events maintain independence
customerApi.publish('UserRegistered', {
  userId: user.id,
  email: user.email,
  name: user.name
})

// Billing listens and translates
billingApi.subscribe('customer', 'UserRegistered', async (event) => {
  await billingApi.resources.accounts.insert({
    customerId: event.data.userId,
    legalName: event.data.name || 'Unknown',
    billingEmail: event.data.email
  })
})
```

### Pitfall 3: Transaction Boundaries

**Problem**: Can't have ACID transactions across contexts.

**Solution**: Use sagas for distributed transactions:

```javascript
class OrderSaga {
  constructor(contexts) {
    this.contexts = contexts
    this.compensations = []
  }
  
  async execute(orderData) {
    try {
      // Step 1: Reserve inventory
      const reservation = await this.reserveInventory(orderData)
      this.compensations.push(() => this.releaseInventory(reservation))
      
      // Step 2: Create order
      const order = await this.createOrder(orderData)
      this.compensations.push(() => this.cancelOrder(order))
      
      // Step 3: Process payment
      const payment = await this.processPayment(order)
      this.compensations.push(() => this.refundPayment(payment))
      
      // Step 4: Confirm order
      await this.confirmOrder(order)
      
      // Success! Clear compensations
      this.compensations = []
      
      return order
      
    } catch (error) {
      // Failure! Run compensations in reverse order
      console.error('Saga failed:', error)
      
      for (const compensation of this.compensations.reverse()) {
        try {
          await compensation()
        } catch (compError) {
          console.error('Compensation failed:', compError)
          // Log for manual intervention
        }
      }
      
      throw error
    }
  }
  
  async reserveInventory(orderData) {
    const inventoryApi = this.contexts.get('inventory')
    return await inventoryApi.resources.reservations.insert({
      items: orderData.items,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    })
  }
  
  async releaseInventory(reservation) {
    const inventoryApi = this.contexts.get('inventory')
    await inventoryApi.resources.reservations.update(reservation.id, {
      status: 'cancelled'
    })
  }
  
  // ... other saga steps
}
```

## Monitoring Bounded Contexts

### Context Health Dashboard

```javascript
class ContextMonitor {
  constructor(contexts) {
    this.contexts = contexts
    this.metrics = new Map()
  }
  
  async collectMetrics() {
    for (const [name, api] of this.contexts) {
      const metrics = {
        name,
        timestamp: new Date(),
        
        // Resource counts
        resources: Object.keys(api.resources).length,
        totalRecords: 0,
        
        // Event metrics
        eventsPublished: 0,
        eventsReceived: 0,
        eventErrors: 0,
        
        // Performance
        avgResponseTime: 0,
        errorRate: 0,
        
        // Dependencies
        dependsOn: [],
        dependedBy: []
      }
      
      // Count records in each resource
      for (const [resourceName, resource] of Object.entries(api.resources)) {
        const count = await resource.query({ count: true })
        metrics.totalRecords += count
      }
      
      this.metrics.set(name, metrics)
    }
  }
  
  generateReport() {
    console.log('=== Bounded Context Health Report ===\n')
    
    for (const [name, metrics] of this.metrics) {
      console.log(`Context: ${name}`)
      console.log(`  Resources: ${metrics.resources}`)
      console.log(`  Total Records: ${metrics.totalRecords.toLocaleString()}`)
      console.log(`  Events Published: ${metrics.eventsPublished}`)
      console.log(`  Events Received: ${metrics.eventsReceived}`)
      console.log(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`)
      console.log()
    }
    
    // Check for issues
    this.detectIssues()
  }
  
  detectIssues() {
    const issues = []
    
    for (const [name, metrics] of this.metrics) {
      // High error rate
      if (metrics.errorRate > 0.05) {
        issues.push({
          context: name,
          type: 'high-error-rate',
          severity: 'high',
          message: `Error rate ${(metrics.errorRate * 100).toFixed(2)}% exceeds 5% threshold`
        })
      }
      
      // No events (isolated context)
      if (metrics.eventsPublished === 0 && metrics.eventsReceived === 0) {
        issues.push({
          context: name,
          type: 'isolated-context',
          severity: 'medium',
          message: 'Context neither publishes nor receives events'
        })
      }
      
      // Large context
      if (metrics.totalRecords > 1000000) {
        issues.push({
          context: name,
          type: 'large-context',
          severity: 'low',
          message: `Context has ${metrics.totalRecords.toLocaleString()} records, consider splitting`
        })
      }
    }
    
    if (issues.length > 0) {
      console.log('=== Issues Detected ===\n')
      issues.forEach(issue => {
        console.log(`[${issue.severity.toUpperCase()}] ${issue.context}: ${issue.message}`)
      })
    }
  }
}

// Monitor contexts
const monitor = new ContextMonitor(system.contexts)
await monitor.collectMetrics()
monitor.generateReport()
```

## Summary

Bounded contexts are about acknowledging that different parts of your business speak different languages and have different needs. Instead of forcing a single model on everyone, embrace the differences and manage the boundaries explicitly.

Key takeaways:

1. **Context per team/domain** - Let each team own their model
2. **Events over direct calls** - Maintain loose coupling
3. **Translate at boundaries** - Use ACLs and mappings
4. **No shared databases** - Each context owns its data
5. **Monitor boundaries** - Track events and errors

Remember: The goal isn't to eliminate all coupling, but to make it explicit and manageable.

Next chapter: [Enterprise Best Practices →](./ENTERPRISE_GUIDE_04_Best_Practices.md)