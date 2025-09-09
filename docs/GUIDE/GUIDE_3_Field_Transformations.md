# 2.7 Field Transformations

The JSON REST API library provides a comprehensive system for transforming data as it flows through your application. This chapter covers all the ways you can transform, compute, and control field visibility in your API.

## Overview

Field transformations allow you to:
- Accept temporary data that isn't stored (virtual fields)
- Transform data before storing it (setters)
- Transform data when retrieving it (getters)
- Calculate values from other fields (computed fields)
- Control which fields are visible in responses (hidden fields)

## The Data Transformation Pipeline

Understanding when each transformation occurs is crucial for building robust APIs:

```
INPUT FLOW (POST/PUT/PATCH):
┌─────────────┐     ┌──────────────────┐     ┌─────────┐     ┌──────────┐
│ User Input  │ --> │ Validate Schema  │ --> │ Setters │ --> │ Database │
│   (JSON)    │     │ (including virt) │     │         │     │ (no virt)│
└─────────────┘     └──────────────────┘     └─────────┘     └──────────┘
                              ↓
                    Virtual fields validated
                    and preserved for response

OUTPUT FLOW (GET):
┌──────────┐     ┌─────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────┐
│ Database │ --> │ Getters │ --> │   Computed   │ --> │ Merge Virtual & │ --> │ Response │
│          │     │         │     │    Fields    │     │ Apply Hidden    │     │  (JSON)  │
└──────────┘     └─────────┘     └──────────────┘     └─────────────────┘     └──────────┘
```

## Virtual Fields

Virtual fields are fields that pass through the API but are never stored in the database. They're perfect for temporary data needed during request processing.

### Defining Virtual Fields

```javascript
await api.addResource('users', {
  schema: {
    username: { type: 'string', required: true },
    email: { type: 'string', required: true },
    password: { type: 'string', required: true, hidden: true },
    
    // Virtual fields - not stored in database
    passwordConfirmation: { type: 'string', virtual: true },
    termsAccepted: { type: 'boolean', virtual: true },
    captchaToken: { type: 'string', virtual: true }
  }
});
```

### Common Use Cases

1. **Password Confirmation**
   ```javascript
   // Client sends:
   {
     "username": "john",
     "password": "secret123",
     "passwordConfirmation": "secret123"  // Virtual field
   }
   
   // Use in a hook to validate:
   api.on('beforeData:create:users', ({ inputRecord }) => {
     const { password, passwordConfirmation } = inputRecord.data.attributes;
     if (password !== passwordConfirmation) {
       throw new Error('Passwords do not match');
     }
   });
   ```

2. **Terms Acceptance**
   ```javascript
   api.on('beforeData:create:users', ({ inputRecord }) => {
     if (!inputRecord.data.attributes.termsAccepted) {
       throw new Error('You must accept the terms of service');
     }
   });
   ```

3. **UI State or Metadata**
   ```javascript
   // Client can send UI state that's returned but not stored
   {
     "title": "My Article",
     "content": "...",
     "editorState": { ... },  // Virtual field with editor metadata
     "isDraft": true          // Virtual field for UI state
   }
   ```

### Key Characteristics

- **Input**: Accepted in POST/PUT/PATCH requests
- **Validation**: Validated according to schema rules
- **Storage**: Never stored in the database
- **Output**: Returned in responses if provided
- **Hooks**: Available to all hooks during request processing

## Setters and Getters

Setters and getters transform data at the database boundary. Setters run before saving, getters run after loading.

### Setters - Transform Before Storage

```javascript
await api.addResource('users', {
  schema: {
    email: { 
      type: 'string', 
      required: true,
      setter: (value) => value.toLowerCase().trim()
    },
    phone: {
      type: 'string',
      setter: (value) => {
        // Remove all non-digits
        return value ? value.replace(/\D/g, '') : null;
      }
    },
    metadata: {
      type: 'object',
      setter: (value) => JSON.stringify(value || {})
    }
  }
});
```

### Getters - Transform After Retrieval

```javascript
await api.addResource('users', {
  schema: {
    email: { 
      type: 'string',
      getter: (value) => value?.toLowerCase()
    },
    phone: {
      type: 'string',
      getter: (value) => {
        // Format as (XXX) XXX-XXXX
        if (!value || value.length !== 10) return value;
        return `(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}`;
      }
    },
    metadata: {
      type: 'string',
      getter: (value) => {
        try {
          return value ? JSON.parse(value) : {};
        } catch {
          return {};
        }
      }
    }
  }
});
```

### Using Virtual Fields with Setters

A common pattern is using virtual fields to provide data that setters will process:

```javascript
await api.addResource('products', {
  schema: {
    price: { 
      type: 'number',
      setter: function(value, { attributes }) {
        // Use virtual priceInCents if provided
        if (attributes.priceInCents !== undefined) {
          return attributes.priceInCents / 100;
        }
        return value;
      }
    },
    priceInCents: { type: 'number', virtual: true }
  }
});

// Client can send either format:
// { "price": 19.99 } 
// OR
// { "priceInCents": 1999 }
```

### Async Setters and Getters

Both setters and getters can be async:

```javascript
await api.addResource('secure_data', {
  schema: {
    secret: {
      type: 'string',
      setter: async (value) => {
        // Encrypt before storing
        const encrypted = await encrypt(value);
        return encrypted;
      },
      getter: async (value) => {
        // Decrypt after retrieving
        const decrypted = await decrypt(value);
        return decrypted;
      }
    }
  }
});
```

### Setter and Getter Context

Both functions receive a context object as the second parameter:

```javascript
setter: (value, context) => {
  // context contains:
  // - attributes: all field values
  // - record: the full record (on updates)
  // - scopeName: resource name
  // - method: 'post', 'put', or 'patch'
  
  if (context.method === 'post') {
    // Special handling for creation
  }
  return value;
}
```

## Computed Fields

Computed fields are output-only fields calculated from other fields. They're never stored and always calculated fresh when requested.

### Basic Computed Fields

```javascript
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', required: true, normallyHidden: true },
    
    // Computed fields
    profitMargin: {
      type: 'number',
      computed: true,
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || !attributes.cost) return null;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    
    displayName: {
      type: 'string',
      computed: true,
      dependencies: ['name', 'price'],
      compute: ({ attributes }) => {
        return `${attributes.name} - $${attributes.price}`;
      }
    }
  }
});
```

### Dependencies and Hidden Fields

Computed fields can depend on hidden fields:

```javascript
await api.addResource('users', {
  schema: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    dateOfBirth: { type: 'date', normallyHidden: true },
    
    fullName: {
      type: 'string',
      computed: true,
      dependencies: ['firstName', 'lastName'],
      compute: ({ attributes }) => {
        return [attributes.firstName, attributes.lastName]
          .filter(Boolean)
          .join(' ');
      }
    },
    
    age: {
      type: 'number',
      computed: true,
      dependencies: ['dateOfBirth'],  // Depends on hidden field
      compute: ({ attributes }) => {
        if (!attributes.dateOfBirth) return null;
        const birth = new Date(attributes.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
        return age;
      }
    }
  }
});
```

### Async Computed Fields

```javascript
await api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    
    inventoryStatus: {
      type: 'string',
      computed: true,
      dependencies: ['id'],
      compute: async ({ attributes, context }) => {
        // Could check external inventory system
        const count = await context.knex('inventory')
          .where('product_id', attributes.id)
          .sum('quantity as total')
          .first();
        
        if (count.total > 100) return 'In Stock';
        if (count.total > 0) return 'Low Stock';
        return 'Out of Stock';
      }
    }
  }
});
```

### Compute Function Context

The compute function receives a rich context:

```javascript
compute: (context) => {
  // context contains:
  // - attributes: all record attributes (including dependencies)
  // - record: full record with id
  // - context: request context with knex, transaction, etc.
  // - helpers: API helpers
  // - api: full API instance
  // - scopeName: current resource name
}
```

### Important Notes on Computed Fields

1. **Output Only**: If a computed field is sent in input, it's ignored with a warning
2. **Always Fresh**: Calculated on every request (no caching)
3. **Dependencies**: The system automatically fetches dependency fields from the database
4. **Sparse Fieldsets**: Work seamlessly with JSON:API sparse fieldsets
5. **Performance**: Keep computations fast as they run on every request

## Hidden Fields

Control which fields are visible in API responses:

### Hidden Fields - Never Visible

```javascript
await api.addResource('users', {
  schema: {
    email: { type: 'string', required: true },
    passwordHash: { type: 'string', hidden: true },
    salt: { type: 'string', hidden: true },
    internalNotes: { type: 'string', hidden: true }
  }
});

// These fields are NEVER returned in responses, even if explicitly requested
```

### Normally Hidden Fields - Available on Request

```javascript
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', normallyHidden: true },
    supplierCode: { type: 'string', normallyHidden: true }
  }
});

// Hidden by default
GET /products/1
// Returns: { id: '1', name: 'Widget', price: 99.99 }

// Explicitly request hidden fields
GET /products/1?fields[products]=name,price,cost
// Returns: { id: '1', name: 'Widget', price: 99.99, cost: 45.00 }
```

## Advanced Transformations with Hooks

For complex transformations that depend on context (user permissions, time of day, etc.), use the `enrichAttributes` hook:

```javascript
// Add permission-based field visibility
api.on('enrichAttributes', ({ attributes, context }) => {
  if (context.user?.role !== 'admin') {
    delete attributes.profitMargin;
    delete attributes.cost;
  }
  return attributes;
});

// Add dynamic computed fields
api.on('enrichAttributes', ({ attributes, context }) => {
  if (context.scopeName === 'products') {
    attributes.isOnSale = attributes.price < attributes.regularPrice;
  }
  return attributes;
});
```

For more details on hooks, see the [Hooks Documentation](./GUIDE_3_Hooks.md).

## Complete Example: E-commerce Product

Here's a complete example showing all transformation types working together:

```javascript
await api.addResource('products', {
  schema: {
    // Regular fields
    sku: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    
    // Price with setter for cents conversion
    price: { 
      type: 'number', 
      required: true,
      setter: function(value, { attributes }) {
        // Accept price in cents via virtual field
        if (attributes.priceInCents !== undefined) {
          return attributes.priceInCents / 100;
        }
        return value;
      },
      getter: (value) => Number(value.toFixed(2))
    },
    
    // Hidden cost field
    cost: { 
      type: 'number', 
      required: true, 
      normallyHidden: true 
    },
    
    // Never visible
    supplierApiKey: { 
      type: 'string', 
      hidden: true 
    },
    
    // Virtual fields for input
    priceInCents: { type: 'number', virtual: true },
    importFromSupplier: { type: 'boolean', virtual: true },
    
    // Computed fields for output
    profitMargin: {
      type: 'number',
      computed: true,
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || !attributes.cost) return null;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    
    displayPrice: {
      type: 'string',
      computed: true,
      dependencies: ['price'],
      compute: ({ attributes }) => {
        return `$${attributes.price.toFixed(2)}`;
      }
    }
  }
});

// Usage example:
// POST /products
{
  "data": {
    "type": "products",
    "attributes": {
      "sku": "WIDGET-001",
      "name": "Super Widget",
      "description": "The best widget",
      "priceInCents": 9999,        // Virtual field (converted to 99.99)
      "cost": 45.00,
      "importFromSupplier": true,  // Virtual field (triggers hook)
      "supplierApiKey": "secret"   // Hidden field (stored but never returned)
    }
  }
}

// Hook to handle virtual field
api.on('beforeData:create:products', async ({ inputRecord, context }) => {
  if (inputRecord.data.attributes.importFromSupplier) {
    // Use the hidden supplierApiKey to fetch data
    const data = await fetchFromSupplier(inputRecord.data.attributes.supplierApiKey);
    inputRecord.data.attributes.description = data.description;
  }
});

// Response:
{
  "data": {
    "type": "products",
    "id": "1",
    "attributes": {
      "sku": "WIDGET-001",
      "name": "Super Widget",
      "description": "The best widget",
      "price": 99.99,              // Setter converted from cents
      "displayPrice": "$99.99",    // Computed field
      "profitMargin": "54.95",     // Computed field (if user has permission)
      "importFromSupplier": true   // Virtual field preserved
      // Note: cost, supplierApiKey not included
    }
  }
}
```

## Best Practices

### When to Use Each Transformation Type

| Need | Use | Example |
|------|-----|---------|
| Temporary request data | Virtual field | Password confirmation |
| Clean input data | Setter | Lowercase emails, trim whitespace |
| Format output data | Getter | Format phone numbers, parse JSON |
| Calculate from other fields | Computed field | Full names, totals, percentages |
| Security-sensitive data | Hidden field | Password hashes, API keys |
| Sensitive business data | Normally hidden field | Costs, internal notes |
| Context-aware transforms | enrichAttributes hook | Permission-based visibility |

### Performance Considerations

1. **Setters/Getters**: Keep them fast and synchronous when possible
2. **Computed Fields**: 
   - Calculated on every request (no caching)
   - Dependencies are always fetched from DB
   - Consider storing frequently accessed computed values
3. **Virtual Fields**: No performance impact (not stored/retrieved)
4. **Hidden Fields**: Filtered after retrieval (minimal impact)

### Common Pitfalls to Avoid

1. **Don't use computed fields for heavy calculations** - Consider background jobs instead
2. **Don't put validation logic in setters** - Use schema validation or hooks
3. **Remember computed fields are output-only** - They're ignored in input
4. **Test edge cases** - Null values, missing dependencies, etc.
5. **Document virtual fields** - They're part of your API contract

## Migration Tips

If you're migrating from an older version:
- Computed fields now use `computed: true` in the schema (not a separate object)
- Virtual fields use `virtual: true` in the schema
- All field transformations are defined in one place: the schema

## Summary

The JSON REST API library provides a complete transformation pipeline:
- **Virtual fields** for temporary data that flows through but isn't stored
- **Setters** for cleaning and transforming input before storage
- **Getters** for formatting and transforming output after retrieval
- **Computed fields** for deriving values from other fields
- **Hidden fields** for controlling visibility
- **Hooks** for advanced context-aware transformations

By combining these tools, you can build APIs that accept user-friendly input, store data efficiently, and return perfectly formatted responses.

---

# Detailed Guide: Computed Fields

Computed fields are virtual fields that don't exist in your database but are calculated on-the-fly from other fields. They're computed after the database load, every time they're requested, and can depend on other fields (including hidden ones). Computed fields work seamlessly with sparse fieldsets and are calculated for both main resources and included resources.

Let's create a complete example with products and reviews:

```javascript
// Define products resource with computed fields
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    price: { type: 'number', required: true, min: 0 },
    cost: { type: 'number', required: true, min: 0, normallyHidden: true },
    profit_margin: {
      type: 'number',
      computed: true,  // Mark as computed field
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || attributes.price === 0) return 0;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    // Computed fields can also be async
    availability_status: {
      type: 'string',
      computed: true,  // Mark as computed field
      dependencies: ['name'],
      compute: async ({ attributes }) => {
        // Simulate async operation (e.g., checking external inventory)
        await new Promise(resolve => setTimeout(resolve, 10));
        return `${attributes.name} - In Stock`;
      }
    }
  },
  relationships: {
    reviews: { type: 'hasMany', target: 'reviews', foreignKey: 'product_id' }
  }
});
await api.resources.products.createKnexTable();

// Define reviews resource with computed fields
await api.addResource('reviews', {
  schema: {
    product_id: { type: 'id', belongsTo: 'products', as: 'product', required: true },
    reviewer_name: { type: 'string', required: true },
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 1000 },
    helpful_votes: { type: 'number', default: 0 },
    total_votes: { type: 'number', default: 0 },
    helpfulness_score: {
      type: 'number',
      computed: true,  // Mark as computed field
      dependencies: ['helpful_votes', 'total_votes'],
      compute: ({ attributes }) => {
        if (attributes.total_votes === 0) return null;
        return ((attributes.helpful_votes / attributes.total_votes) * 100).toFixed(0);
      }
    }
  }
});
await api.resources.reviews.createKnexTable();
```

The key features to note:
- `cost` is marked as `normallyHidden` - it won't be returned unless explicitly requested
- `profit_margin` depends on both `price` and `cost`
- `helpfulness_score` is computed for each review

## Basic Usage

Let's create some data and see how computed fields work:

```javascript
// Create a product
const product = await api.resources.products.post({
  name: 'Premium Headphones',
  price: 199.99,
  cost: 89.50
});

// Fetch the product - computed fields are automatically calculated
const fetchedProduct = await api.resources.products.get({ id: product.id });
console.log(fetchedProduct);
// {
//   id: '1',
//   name: 'Premium Headphones',
//   price: 199.99,
//   profit_margin: '55.23',    // Computed: (199.99 - 89.50) / 199.99 * 100
//   availability_status: 'Premium Headphones - In Stock' // Async computed field
// }
// Note: 'cost' is not included (normallyHidden)

// Add some reviews
const review1 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Alice',
  rating: 5,
  comment: 'Excellent sound quality!',
  helpful_votes: 45,
  total_votes: 50
});
console.log(review1);

const review2 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Bob',
  rating: 4,
  comment: 'Good, but a bit pricey',
  helpful_votes: 10,
  total_votes: 25
});
console.log(review2);


```

## Sparse Fieldsets and Dependencies

When you request a computed field via sparse fieldsets, the system automatically fetches its dependencies:

```javascript
// Request only name and profit_margin
const sparseProduct = await api.resources.products.get({
  id: product.id,
  queryParams: {
    fields: { products: 'name,profit_margin' }
  }
});
console.log('Product with sparse fields:', sparseProduct);

const productWithCost = await api.resources.products.get({
  id: product.id,
  queryParams: {
    fields: { products: 'name,cost,profit_margin' }
  }
});
console.log('Product with sparse fields includig cost:', productWithCost);
```

**Expected output**:

```text
Product with sparse fields: {
  id: '1',
  name: 'Premium Headphones',
  profit_margin: '55.25',
  availability_status: 'Premium Headphones - In Stock',
  reviews_ids: [ '1', '2' ]
}
Product with sparse fields includig cost: {
  id: '1',
  name: 'Premium Headphones',
  cost: 89.5,
  profit_margin: '55.25',
  reviews_ids: [ '1', '2' ]
}
```

## Computed Fields in Included Resources

Computed fields work seamlessly with included resources:

```javascript
// Fetch product with reviews
const productWithReviews = await api.resources.products.get({
  id: product.id,
  queryParams: {
    include: ['reviews']
  }
});
console.log('Product With Reviews:', productWithReviews);

// Use sparse fieldsets on included resources
const productWithSparseReviews = await api.resources.products.get({
  id: product.id,
  queryParams: {
    include: ['reviews'],
    fields: {
      products: 'name,price',
      reviews: 'reviewer_name,rating,helpfulness_score'  // Only these fields
    }
  }
});
console.log('Product With Sparse Reviews:', productWithSparseReviews);
```

**Expected Output**:

```text
Product With Reviews: {
  id: '1',
  name: 'Premium Headphones',
  price: 199.99,
  profit_margin: '55.25',
  availability_status: 'Premium Headphones - In Stock',
  reviews_ids: [ '1', '2' ],
  reviews: [
    {
      id: '1',
      reviewer_name: 'Alice',
      rating: 5,
      comment: 'Excellent sound quality!',
      helpful_votes: 45,
      total_votes: 50,
      helpfulness_score: '90'
    },
    {
      id: '2',
      reviewer_name: 'Bob',
      rating: 4,
      comment: 'Good, but a bit pricey',
      helpful_votes: 10,
      total_votes: 25,
      helpfulness_score: '40'
    }
  ]
}
Product With Sparse Reviews: {
  id: '1',
  name: 'Premium Headphones',
  price: 199.99,
  reviews_ids: [ '1', '2' ],
  reviews: [
    {
      id: '1',
      reviewer_name: 'Alice',
      rating: 5,
      helpfulness_score: '90'
    },
    {
      id: '2',
      reviewer_name: 'Bob',
      rating: 4,
      helpfulness_score: '40'
    }
  ]
}
```

## Error Handling

Computed fields handle errors gracefully:

```javascript

// Create a review with no votes
const review3 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Charlie',
  rating: 3,
  comment: 'Average product',
  helpful_votes: 0,
  total_votes: 0  // This will cause division by zero
});

const fetchedReviewWithError = await api.resources.reviews.get({ id: review3.id });
console.log('Fetched review (with error in helpfulness score):', fetchedReviewWithError
```

**Expected Output**:

```text
Fetched review (with error in helpfulness score): {
  id: '3',
  reviewer_name: 'Charlie',
  rating: 3,
  comment: 'Average product',
  helpful_votes: 0,
  total_votes: 0,
  helpfulness_score: null,
  product_id: '1'
}
```

## Key Points

1. **Always Computed** - Computed fields are calculated fresh on every request, there's no caching.

2. **Dependencies Are Fetched** - When you request a computed field, all its dependencies are automatically fetched from the database, even if they won't appear in the response.

3. **Works with Sparse Fieldsets** - You can request computed fields just like regular fields using sparse fieldsets.

4. **Hidden Dependencies** - Fields marked as `normallyHidden` can be used as dependencies and will be fetched for computation, but won't appear in the response unless explicitly requested.

5. **Included Resources** - Computed fields are calculated for all resources, whether they're the main resource or included via relationships.

6. **Error Handling** - If a computation fails, the field is set to `null` and an error is logged, but the request continues.

## Async Computed Fields

Computed fields can be asynchronous - simply return a Promise or use async/await. The compute function will be awaited during field resolution:

```javascript
schema: {
  name: { type: 'string', required: true },
  availability_status: {
    type: 'string',
    computed: true,  // Mark as computed field
    dependencies: ['name'],
    compute: async ({ attributes }) => {
      // Perform async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      return `${attributes.name} - In Stock`;
    }
  }
}
```

## Best Practices

1. **Keep Computations Simple** - Computed fields should be quick calculations. While async is supported, avoid heavy operations like database queries or external API calls.

2. **Declare All Dependencies** - Always list all fields your computation needs in the `dependencies` array.

3. **Handle Edge Cases** - Check for null values and division by zero in your compute functions.

4. **Consider Performance** - Remember that dependencies are always fetched. If you have expensive computations or many dependencies, consider storing the computed value as a regular field instead.

---

# Detailed Guide: Getters and Setters

## Introduction

Field getters and setters allow you to transform data as it moves between your API and database:

- **Getters**: Transform data when reading from the database (e.g., formatting phone numbers, trimming strings)
- **Setters**: Transform data before writing to the database (e.g., normalizing emails, hashing passwords)

This is different from computed fields, which are virtual fields calculated on-the-fly. Getters and setters work with actual database columns.

## Initial Setup: A Blog System

Let's start with a simple blog system without any getters or setters:

```javascript
import { Api } from 'hooked-api';
import RestApiPlugin from 'json-rest-api/plugins/core/rest-api-plugin.js';
import RestApiKnexPlugin from 'json-rest-api/plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

// Create database connection
const db = knex({
  client: 'better-sqlite3',
  connection: { filename: './blog.db' }
});

// Create API instance
const api = new Api({ name: 'blog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });

// Define authors resource (no getters/setters yet)
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    bio: { type: 'string', nullable: true }
  },
  relationships: {
    posts: { type: 'hasMany', target: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Define posts resource (no getters/setters yet)
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    author_id: { type: 'number', belongsTo: 'authors', as: 'author' },
    published_at: { type: 'dateTime', default: 'now()' }
  },
  tableName: 'posts'
});

// Create tables
await api.resources.authors.createKnexTable();
await api.resources.posts.createKnexTable();

// Create test data
const author = await api.resources.authors.post({
  email: '  Jane.Doe@BLOG.COM  ',
  name: '  Jane Doe  ',
  bio: '  Software developer and writer  '
});

const post1 = await api.resources.posts.post({
  title: '  Getting Started with APIs  ',
  content: '  This is my first post about APIs...  ',
  author_id: author.id
});

const post2 = await api.resources.posts.post({
  title: '  advanced api patterns  ',
  content: '  Let\'s explore some advanced patterns...  ',
  author_id: author.id
});

// Fetch author with posts
const authorWithPosts = await api.resources.authors.get({
  id: author.id,
  queryParams: { include: ['posts'] }
});

console.log('Author with posts (no getters):', authorWithPosts);
// Notice the messy data:
// - Email has spaces and mixed case
// - Name and bio have extra spaces
// - Post titles are inconsistently cased
// - Content has leading/trailing spaces
```

## Adding Getters: Transform Data on Read

Now let's add getters to clean up the data automatically:

```javascript
// Enhanced authors resource with getters
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      getter: (value) => value?.toLowerCase().trim()
    },
    name: { 
      type: 'string',
      required: true,
      getter: (value) => value?.trim()
    },
    bio: { 
      type: 'string',
      nullable: true,
      getter: (value) => value?.trim()
    }
  },
  relationships: {
    posts: { type: 'hasMany', target: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Enhanced posts resource with getters
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { 
      type: 'string',
      required: true,
      getter: (value) => {
        // Capitalize first letter of each word
        return value?.trim()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    },
    content: { 
      type: 'string',
      required: true,
      getter: (value) => value?.trim()
    },
    author_id: { type: 'number', belongsTo: 'authors', as: 'author' },
    published_at: { type: 'dateTime', default: 'now()' }
  },
  tableName: 'posts'
});

// Now fetch the same author with posts
const cleanAuthorWithPosts = await api.resources.authors.get({
  id: author.id,
  queryParams: { include: ['posts'] }
});

console.log('Author:', cleanAuthorWithPosts);
// {
//   id: '1',
//   email: 'jane.doe@blog.com',      // Normalized
//   name: 'Jane Doe',                 // Trimmed
//   bio: 'Software developer and writer', // Trimmed
//   posts: [
//     {
//       id: '1',
//       title: 'Getting Started With Apis',  // Title case
//       content: 'This is my first post about APIs...', // Trimmed
//       author_id: 1,
//       published_at: '2024-01-15T10:30:00.000Z'
//     },
//     {
//       id: '2', 
//       title: 'Advanced Api Patterns',      // Title case
//       content: 'Let\'s explore some advanced patterns...', // Trimmed
//       author_id: 1,
//       published_at: '2024-01-15T10:31:00.000Z'
//     }
//   ]
// }

// Getters also work in queries
const allPosts = await api.resources.posts.query({
  queryParams: { 
    include: ['author'],
    filters: { author_id: author.id }
  }
});

console.log('All posts with author:', allPosts);
// Both posts and included authors have getters applied
```

## Adding Setters: Transform Data on Write

Setters ensure data is normalized before it's stored:

```javascript
// Add setters to authors
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      setter: (value) => value?.toLowerCase().trim(),
      getter: (value) => value
    },
    name: { 
      type: 'string',
      required: true,
      setter: (value) => value?.trim(),
      getter: (value) => value
    },
    bio: { 
      type: 'string',
      nullable: true,
      setter: (value) => value?.trim(),
      getter: (value) => value
    }
  },
  relationships: {
    posts: { type: 'hasMany', target: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Now when we create an author, data is cleaned before storage
const newAuthor = await api.resources.authors.post({
  email: '  JOHN.SMITH@BLOG.COM  ',
  name: '  John Smith  ',
  bio: '  Tech enthusiast  '
});

console.log('New author:', newAuthor);
// Data is already clean:
// {
//   id: '2',
//   email: 'john.smith@blog.com',
//   name: 'John Smith',
//   bio: 'Tech enthusiast'
// }
```

## Async Setters for Secure Data

Use async setters for operations like password hashing:

```javascript
await api.addResource('users', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      setter: (value) => value?.toLowerCase().trim()
    },
    password: { 
      type: 'string',
      required: true,
      min: 8,
      setter: async (value) => {
        // Simulate password hashing
        await new Promise(resolve => setTimeout(resolve, 10));
        return `hashed:${value}`;
      },
      getter: () => '[PROTECTED]' // Never expose hashed passwords
    }
  },
  tableName: 'users'
});

const user = await api.resources.users.post({
  email: '  USER@EXAMPLE.COM  ',
  password: 'mySecretPassword123'
});

console.log('Created user:', user);
// {
//   id: '1',
//   email: 'user@example.com',
//   password: '[PROTECTED]'
// }
```

## Setter Dependencies

When setters depend on other fields, use `runSetterAfter`:

```javascript
await api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    base_price: { 
      type: 'number',
      setter: (value) => Math.round(value * 100) // Convert to cents
    },
    tax_rate: { 
      type: 'number',
      setter: (value) => value || 0
    },
    total_price: {
      type: 'number',
      setter: (value, { attributes }) => {
        // Calculate from base_price (already in cents) and tax_rate
        const total = attributes.base_price * (1 + attributes.tax_rate);
        return Math.round(total);
      },
      runSetterAfter: ['base_price', 'tax_rate']
    }
  },
  tableName: 'products'
});
```

## Summary

Getters and setters provide automatic data transformation:

- **Getters** transform data when reading (including in relationships and queries)
- **Setters** transform data before storing
- Both support async operations and dependencies
- They work with actual database columns

Common uses:
- Email normalization
- String trimming
- Title case formatting
- Password hashing
- Price calculations
- Data consistency across related records