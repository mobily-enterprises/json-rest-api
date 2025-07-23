# Hidden and Computed Fields Tutorial

This tutorial covers advanced field management features in JSON-REST-API: hidden fields, normally hidden fields, and computed (virtual) fields with automatic dependency resolution.

## Table of Contents
1. [Field Visibility Control](#field-visibility-control)
2. [Computed Fields](#computed-fields)
3. [Dependency Resolution](#dependency-resolution)
4. [Complete Examples](#complete-examples)

## Field Visibility Control

JSON-REST-API provides fine-grained control over which fields are visible in API responses.

### Field Visibility Options

| Option | Description | Can be requested via sparse fieldsets? | Example Use Case |
|--------|-------------|----------------------------------------|------------------|
| (default) | Always visible | Yes | Regular data fields like `title`, `price` |
| `normallyHidden: true` | Hidden by default | Yes | Sensitive data like `cost`, `internal_notes` |
| `hidden: true` | Never visible | No | Secrets like `password_hash`, `api_key` |

### Basic Example

```javascript
await api.addResource('products', {
  schema: {
    // Always visible field
    name: { type: 'string', required: true },
    
    // Hidden by default, but can be requested
    cost: { 
      type: 'number', 
      required: true, 
      normallyHidden: true 
    },
    
    // Never visible in API responses
    internal_key: { 
      type: 'string', 
      hidden: true 
    }
  }
});
```

### How It Works

```javascript
// Without sparse fieldsets - returns all visible fields
const product = await api.resources.products.get({ id: 1 });
// Returns: { id: '1', name: 'Widget' }
// Note: cost (normallyHidden) and internal_key (hidden) are not included

// Request normallyHidden field explicitly
const productWithCost = await api.resources.products.get({ 
  id: 1,
  queryParams: { fields: { products: 'name,cost' } }
});
// Returns: { id: '1', name: 'Widget', cost: 50 }

// Trying to request hidden field - it's ignored
const attempt = await api.resources.products.get({ 
  id: 1,
  queryParams: { fields: { products: 'name,internal_key' } }
});
// Returns: { id: '1', name: 'Widget' }
// Note: internal_key is NEVER returned
```

## Computed Fields

Computed fields are virtual fields calculated on-the-fly from other field values. They're not stored in the database but computed when requested.

### Defining Computed Fields

```javascript
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', required: true, normallyHidden: true },
    tax_rate: { type: 'number', required: true }
  },
  
  // Computed fields are defined separately from schema
  computed: {
    profit_margin: {
      type: 'number',
      dependencies: ['price', 'cost'], // Fields needed for computation
      compute: ({ attributes }) => {
        if (attributes.price && attributes.cost) {
          return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
        }
        return null;
      }
    },
    
    display_name: {
      type: 'string',
      dependencies: ['name', 'price'],
      compute: ({ attributes }) => {
        return `${attributes.name} - $${attributes.price}`;
      }
    }
  }
});
```

### Compute Function Context

The compute function receives a rich context object:

```javascript
computed: {
  advanced_calculation: {
    type: 'string',
    dependencies: ['field1', 'field2'],
    compute: async (context) => {
      // Available in context:
      // - attributes: all record attributes (including dependencies)
      // - record: full record with id
      // - context: request context with transaction, knex, etc.
      // - helpers: API helpers
      // - api: full API instance
      // - scopeName: current resource name
      
      // Example: Make a database query
      const relatedData = await context.context.knex('related_table')
        .where('product_id', context.record.id)
        .first();
      
      return `Calculated: ${context.attributes.field1} + ${relatedData.value}`;
    }
  }
}
```

## Dependency Resolution

The most powerful feature is automatic dependency resolution. When you request a computed field, its dependencies are automatically fetched from the database but only returned if explicitly requested.

### How Dependency Resolution Works

```javascript
// Product with computed field that depends on normallyHidden fields
await api.addResource('products', {
  schema: {
    name: { type: 'string' },
    price: { type: 'number' },
    cost: { type: 'number', normallyHidden: true },
    tax_rate: { type: 'number', normallyHidden: true }
  },
  computed: {
    profit_margin: {
      type: 'number',
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    }
  }
});

// Request ONLY the computed field
const result = await api.resources.products.get({
  id: 1,
  queryParams: { fields: { products: 'profit_margin' } }
});
// Returns: { id: '1', profit_margin: '40.00' }
// SQL Query includes: SELECT id, price, cost FROM products
// But response only includes: id, profit_margin

// Request computed field AND one dependency
const result2 = await api.resources.products.get({
  id: 1,
  queryParams: { fields: { products: 'profit_margin,price' } }
});
// Returns: { id: '1', price: 100, profit_margin: '40.00' }
// Note: 'cost' was fetched for calculation but not returned
```

### Dependency Resolution Rules

| Scenario | SQL Query Includes | API Response Includes |
|----------|-------------------|---------------------|
| Request computed field only | All dependencies | Only computed field |
| Request computed field + some dependencies | All dependencies | Computed field + requested dependencies |
| Request fields without computed | Only requested fields | Only requested fields |
| No sparse fieldsets | All visible fields + all dependencies | All visible fields + all computed fields |

## Complete Examples

### Example 1: E-commerce Product Pricing

```javascript
await api.addResource('products', {
  schema: {
    sku: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    
    // Pricing fields - some hidden by default
    base_cost: { type: 'number', required: true, normallyHidden: true },
    shipping_cost: { type: 'number', normallyHidden: true },
    list_price: { type: 'number', required: true },
    discount_percent: { type: 'number', default: 0 },
    
    // Internal fields - never exposed
    supplier_code: { type: 'string', hidden: true },
    warehouse_location: { type: 'string', hidden: true }
  },
  
  computed: {
    // Sale price after discount
    sale_price: {
      type: 'number',
      dependencies: ['list_price', 'discount_percent'],
      compute: ({ attributes }) => {
        const discount = attributes.discount_percent || 0;
        return (attributes.list_price * (1 - discount / 100)).toFixed(2);
      }
    },
    
    // Profit margin (requires hidden cost fields)
    profit_margin: {
      type: 'number',
      dependencies: ['list_price', 'base_cost', 'shipping_cost', 'discount_percent'],
      compute: ({ attributes }) => {
        const salePrice = attributes.list_price * (1 - (attributes.discount_percent || 0) / 100);
        const totalCost = (attributes.base_cost || 0) + (attributes.shipping_cost || 0);
        if (totalCost === 0) return null;
        return (((salePrice - totalCost) / salePrice) * 100).toFixed(2);
      }
    },
    
    // Display title for UI
    display_title: {
      type: 'string',
      dependencies: ['name', 'sku', 'discount_percent'],
      compute: ({ attributes }) => {
        let title = `${attributes.name} (${attributes.sku})`;
        if (attributes.discount_percent > 0) {
          title += ` - ${attributes.discount_percent}% OFF!`;
        }
        return title;
      }
    }
  }
});

// Customer-facing query (no access to costs)
const customerView = await api.resources.products.get({
  id: 1,
  queryParams: { fields: { products: 'name,list_price,sale_price,display_title' } }
});
// Returns: {
//   id: '1',
//   name: 'Premium Widget',
//   list_price: 99.99,
//   sale_price: '79.99',
//   display_title: 'Premium Widget (WDG-001) - 20% OFF!'
// }

// Admin query (with profit visibility)
const adminView = await api.resources.products.get({
  id: 1,
  queryParams: { fields: { products: 'name,list_price,base_cost,profit_margin' } }
});
// Returns: {
//   id: '1',
//   name: 'Premium Widget',
//   list_price: 99.99,
//   base_cost: 45.00,  // normallyHidden field explicitly requested
//   profit_margin: '43.75'
// }
```

### Example 2: User Profiles with Computed Statistics

```javascript
await api.addResource('users', {
  schema: {
    username: { type: 'string', required: true },
    email: { type: 'string', required: true },
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    created_at: { type: 'datetime', required: true },
    
    // Security fields - never visible
    password_hash: { type: 'string', hidden: true },
    salt: { type: 'string', hidden: true },
    
    // Private fields - hidden by default
    date_of_birth: { type: 'date', normallyHidden: true },
    phone_number: { type: 'string', normallyHidden: true },
    
    // Stats fields (updated by background jobs)
    post_count: { type: 'number', default: 0 },
    comment_count: { type: 'number', default: 0 },
    last_login_at: { type: 'datetime', normallyHidden: true }
  },
  
  computed: {
    // Full name from parts
    full_name: {
      type: 'string',
      dependencies: ['first_name', 'last_name'],
      compute: ({ attributes }) => {
        const parts = [attributes.first_name, attributes.last_name].filter(Boolean);
        return parts.join(' ') || attributes.username;
      }
    },
    
    // Age calculation (requires hidden date_of_birth)
    age: {
      type: 'number',
      dependencies: ['date_of_birth'],
      compute: ({ attributes }) => {
        if (!attributes.date_of_birth) return null;
        const today = new Date();
        const birth = new Date(attributes.date_of_birth);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
        return age;
      }
    },
    
    // Member duration
    member_for_days: {
      type: 'number',
      dependencies: ['created_at'],
      compute: ({ attributes }) => {
        const created = new Date(attributes.created_at);
        const now = new Date();
        const diffTime = Math.abs(now - created);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    },
    
    // Activity level based on posts and comments
    activity_level: {
      type: 'string',
      dependencies: ['post_count', 'comment_count', 'created_at'],
      compute: ({ attributes }) => {
        const total = (attributes.post_count || 0) + (attributes.comment_count || 0);
        const created = new Date(attributes.created_at);
        const daysActive = Math.max(1, Math.ceil((new Date() - created) / (1000 * 60 * 60 * 24)));
        const avgPerDay = total / daysActive;
        
        if (avgPerDay >= 5) return 'very_active';
        if (avgPerDay >= 1) return 'active';
        if (avgPerDay >= 0.1) return 'moderate';
        return 'lurker';
      }
    }
  }
});

// Public profile view
const publicProfile = await api.resources.users.get({
  id: 1,
  queryParams: { fields: { users: 'username,full_name,member_for_days,activity_level' } }
});
// Returns: {
//   id: '1',
//   username: 'john_doe',
//   full_name: 'John Doe',
//   member_for_days: 365,
//   activity_level: 'active'
// }

// Private profile (user viewing their own)
const privateProfile = await api.resources.users.get({
  id: 1,
  queryParams: { fields: { users: 'username,email,age,phone_number' } }
});
// Returns: {
//   id: '1',
//   username: 'john_doe',
//   email: 'john@example.com',
//   age: 28,  // Computed from hidden date_of_birth
//   phone_number: '+1-555-0123'  // normallyHidden field explicitly requested
// }
```

### Example 3: JSON:API Format with Computed Fields

```javascript
// Using JSON:API format
const response = await api.resources.products.get({
  id: 1,
  queryParams: { fields: { products: 'name,profit_margin' } },
  simplified: false  // Use JSON:API format
});

// Returns:
{
  "data": {
    "type": "products",
    "id": "1",
    "attributes": {
      "name": "Premium Widget",
      "profit_margin": "43.75"
    }
  }
}

// Note: Dependencies (price, cost) were fetched but not included in response
```

## Best Practices

1. **Use `normallyHidden` for sensitive business data** that some users might need access to (costs, margins, internal notes)

2. **Use `hidden` for security-critical fields** that should never be exposed (passwords, API keys, tokens)

3. **Keep computed functions simple and fast** - they run on every request that includes them

4. **Declare all dependencies** - the system needs to know which fields to fetch from the database

5. **Consider caching for expensive computations** - use the context to access caching mechanisms

6. **Use sparse fieldsets** to optimize performance - only request the fields you need

7. **Document your computed fields** - they're part of your API contract

## Performance Considerations

- Computed fields are calculated on every request - keep calculations fast
- Dependencies are always fetched from DB when computed field is requested
- Use sparse fieldsets to avoid unnecessary computations
- Consider moving expensive calculations to background jobs and storing results
- The system optimizes SQL queries to only fetch required fields

## Migration Guide

If you're upgrading from a version without these features:

1. Review your schemas for sensitive fields that should be `normallyHidden` or `hidden`
2. Identify calculated fields that could be moved to `computed`
3. Update your API clients to request normallyHidden fields explicitly when needed
4. Remove any manual field filtering logic - the framework handles it now