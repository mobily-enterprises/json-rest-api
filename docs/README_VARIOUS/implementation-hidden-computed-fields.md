# Implementation Guide: Hidden and Computed Fields

This document explains the internal implementation of hidden and computed fields in JSON-REST-API.

## Architecture Overview

The feature is implemented across several modules:

```
┌─────────────────────┐
│  Schema Definition  │ (User defines schema with hidden/computed fields)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  compileSchemas.js  │ (Validates and stores field definitions)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ knex-field-helpers  │ (Determines which fields to SELECT from DB)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Knex Plugin        │ (Executes SQL query with dependencies)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  REST API Plugin    │ (Computes fields and removes dependencies)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  JSON:API Response  │ (Final filtered response to client)
└─────────────────────┘
```

## Key Components

### 1. Schema Compilation (`compileSchemas.js`)

When a resource is defined, the schema compiler:
- Validates computed field definitions
- Ensures each computed field has a type
- Validates compute functions if provided
- Stores computed fields separately from database schema

```javascript
// Internal storage after compilation:
scope.vars.schemaInfo = {
  schema: schemaObject,           // Database schema
  computed: computedFields,        // Computed field definitions
  schemaStructure: enrichedSchema, // Raw schema structure
  // ... other properties
}
```

### 2. Field Selection (`knex-field-helpers.js`)

The `buildFieldSelection` function is the brain of the operation:

```javascript
// Returns detailed information:
{
  fieldsToSelect: ['id', 'price', 'cost'],     // SQL SELECT fields
  requestedFields: ['profit_margin'],           // User requested fields
  computedDependencies: ['cost']                // Dependencies to remove
}
```

**Algorithm:**
1. Always include ID field
2. Parse sparse fieldsets if provided
3. Skip computed fields (not in database)
4. Apply visibility rules (hidden/normallyHidden)
5. Add dependencies for requested computed fields
6. Track which dependencies weren't explicitly requested

### 3. Database Query (Knex Plugin)

The Knex plugin:
1. Calls `buildFieldSelection` to get field list
2. Stores `computedDependencies` in context
3. Executes SQL query with all needed fields
4. Passes raw data to REST API plugin

```javascript
// Example SQL generated:
SELECT id, price, cost FROM products WHERE id = 1
// Even though user only requested 'profit_margin'
```

### 4. Attribute Enrichment (REST API Plugin)

The `enrichAttributes` method:
1. Filters hidden fields based on visibility rules
2. Determines which computed fields to calculate
3. Executes compute functions with full attribute context
4. Runs enrichAttributes hooks for custom logic
5. Removes dependencies that weren't requested

```javascript
// Data flow example:
// Input: { id: 1, price: 100, cost: 60, tax_rate: 8.5 }
// Requested: profit_margin
// After compute: { id: 1, price: 100, cost: 60, profit_margin: "40.00" }
// After cleanup: { id: 1, profit_margin: "40.00" }
```

## Detailed Flow Example

User request: `GET /products/1?fields[products]=name,profit_margin`

```javascript
// 1. buildFieldSelection analyzes request
{
  fieldsToSelect: ['id', 'name', 'price', 'cost'],  // Includes dependencies
  requestedFields: ['name', 'profit_margin'],
  computedDependencies: ['price', 'cost']           // Added for profit_margin
}

// 2. SQL query fetches all needed fields
SELECT id, name, price, cost FROM products WHERE id = 1

// 3. Database returns
{ id: 1, name: 'Widget', price: 100, cost: 60 }

// 4. enrichAttributes processes
- Filters hidden fields (none in this case)
- Computes profit_margin: ((100-60)/100*100) = "40.00"
- Removes dependencies not in requestedFields: price, cost

// 5. Final response
{ id: '1', name: 'Widget', profit_margin: '40.00' }
```

## Visibility Rules

### Hidden Fields (`hidden: true`)
- **Never** included in SQL SELECT
- **Never** returned in responses
- **Cannot** be requested via sparse fieldsets
- **Cannot** be used as dependencies

### Normally Hidden Fields (`normallyHidden: true`)
- **Always** included in SQL SELECT
- **Not** returned by default
- **Can** be requested via sparse fieldsets
- **Can** be used as dependencies
- **Automatically** fetched if needed for computed fields

### Regular Fields
- **Always** included in SQL SELECT (unless sparse fieldsets)
- **Always** returned by default
- **Can** be filtered via sparse fieldsets

## Compute Function Context

Compute functions receive a rich context object:

```javascript
{
  attributes: {            // All attributes including dependencies
    id: 1,
    name: 'Widget',
    price: 100,
    cost: 60,              // Available even if normallyHidden
    tax_rate: 8.5
  },
  record: { /* same as attributes */ },
  context: {
    transaction: knexTransaction,  // For DB queries
    knex: knexInstance,           // Direct DB access
    scopeName: 'products',
    // ... other context
  },
  helpers: { /* API helpers */ },
  api: { /* full API instance */ },
  scopeName: 'products',
  requestContext: { /* original request context */ }
}
```

## Performance Considerations

1. **Dependency Tracking**: Dependencies are tracked per-request to minimize DB queries
2. **Selective Computation**: Only requested computed fields are calculated
3. **Error Isolation**: Compute errors don't fail the request (return null)
4. **SQL Optimization**: Only needed fields are SELECTed from database

## Hook Integration

The system integrates with existing hooks:

- `schema:enrich` - Can modify schema before compilation
- `enrichAttributes` - Can override or add computed values
- Standard REST API hooks still apply

## Edge Cases Handled

1. **Circular Dependencies**: Not directly prevented but will fail at compute time
2. **Missing Dependencies**: Compute function should handle gracefully
3. **Hidden Dependencies**: Cannot use hidden:true fields as dependencies
4. **Async Computation**: Fully supported with async compute functions
5. **Included Resources**: Computed fields work for included relationships too

## Future Enhancements

Potential improvements:
1. Dependency graph validation
2. Compute function result caching
3. Batch computation for query operations
4. Dependency analysis from function source
5. Computed fields in search/filter operations