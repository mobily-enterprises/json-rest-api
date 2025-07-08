# belongsTo Functionality Analysis

## Overview
The `belongsTo` property in json-rest-api is a schema field property that marks a field as a foreign key reference to another resource. While it doesn't provide visible functionality on its own, it serves as essential metadata for other features.

## What belongsTo Does

### 1. Marks Fields as Foreign Keys
When you define a field with `belongsTo`:
```javascript
author_id: {
  type: 'number',
  belongsTo: 'authors',
  as: 'author'
}
```

The field is:
- Identified as a foreign key by `getForeignKeyFields()` in the Knex plugin
- **Automatically filtered out of the attributes section** in JSON:API responses
- Still stored in the database and accessible internally

### 2. Enables Relationship-based Mutations
Even without `sideLoad` or `sideSearch`, belongsTo allows setting foreign keys through the relationships section in POST/PUT/PATCH requests:

```javascript
// Instead of:
{
  data: {
    type: 'articles',
    attributes: {
      title: 'My Article',
      author_id: 123  // Direct foreign key
    }
  }
}

// You can use:
{
  data: {
    type: 'articles',
    attributes: {
      title: 'My Article'
    },
    relationships: {
      author: {  // Uses the 'as' property
        data: { type: 'authors', id: '123' }
      }
    }
  }
}
```

### 3. Stores Metadata for Other Features
The belongsTo information is preserved in the schema and used by:
- **sideLoad**: When `sideLoad: true` is added, the relationship can be included in responses
- **sideSearch**: When `sideSearch: true` is added, cross-table searches become available
- **Schema introspection**: The relationship information is available via `getSchema()`

## What belongsTo Does NOT Do

1. **Does NOT add relationships section to responses** (unless sideLoad is enabled)
2. **Does NOT enforce foreign key constraints** at the API level
3. **Does NOT validate that referenced records exist**
4. **Does NOT automatically load related data**

## Code Analysis

### Key Files Using belongsTo

1. **rest-api-plugin.js**
   - `processRelationships()` function processes relationships section in mutations
   - Maps relationship names to foreign key fields using schema metadata

2. **rest-api-knex-plugin.js**
   - `getForeignKeyFields()` identifies all fields with belongsTo
   - `toJsonApi()` filters out foreign key fields from attributes

3. **relationship-includes.js**
   - Uses belongsTo metadata when sideLoad is enabled
   - `loadBelongsTo()` loads related records for includes

4. **cross-table-search.js**
   - Uses belongsTo metadata when sideSearch is enabled
   - Enables searching across related tables

## Summary

`belongsTo` without `sideLoad` or `sideSearch` is essentially a metadata marker that:
1. Identifies foreign key fields for internal processing
2. Enables setting foreign keys via the relationships section
3. Filters foreign key fields from the attributes in responses
4. Provides the foundation for sideLoad and sideSearch features

It's a building block that other features depend on, rather than a standalone feature.