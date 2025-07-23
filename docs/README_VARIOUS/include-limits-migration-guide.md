# Include Limits Migration Guide

This guide explains how to use the new window function-based include limits feature in the JSON REST API plugin.

## Overview

The include limits feature allows you to control how many related records are returned when using the `?include` parameter in JSON:API queries. With window function support, you can set true per-parent limits rather than global limits.

## Configuration

Add include configuration to your relationship definitions:

```javascript
await api.addResource('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' }
  },
  relationships: {
    comments: {
      hasMany: 'comments',
      foreignKey: 'article_id',
      // NEW: Include configuration
      include: {
        limit: 10,                    // Max 10 comments per article when included
        orderBy: ['-created_at'],     // Most recent first (- prefix for DESC)
        strategy: 'window'            // Use window functions for per-parent limits
      }
    },
    tags: {
      hasMany: 'tags',
      through: 'article_tags',
      foreignKey: 'article_id',
      otherKey: 'tag_id',
      include: {
        limit: 20,                    // Max 20 tags per article
        orderBy: ['name']             // Alphabetical order
      }
    }
  }
});
```

## Include Configuration Options

### `limit` (number)
Maximum number of related records to include per parent record.

### `orderBy` (array of strings)
Sort order for the included records. Use `-` prefix for descending order.
- `['created_at']` - Ascending by created_at
- `['-created_at']` - Descending by created_at
- `['-created_at', 'id']` - Descending by created_at, then ascending by id

### `strategy` (string)
- `'window'` - Use window functions for true per-parent limits (requires database support)
- Omit or `undefined` - Use standard queries with global limits

## Database Support

Window functions are supported in:
- PostgreSQL 8.4+
- MySQL 8.0+
- MariaDB 10.2+
- SQLite 3.25+
- SQL Server 2005+
- Oracle (most versions)

The plugin automatically detects your database version and capabilities at startup.

## Examples

### Modern Database with Window Functions

```javascript
// Configuration
relationships: {
  comments: {
    hasMany: 'comments',
    include: {
      limit: 5,
      orderBy: ['-created_at', 'id'],
      strategy: 'window'
    }
  }
}

// Query
GET /articles?include=comments

// Result
{
  "data": [
    {
      "type": "articles",
      "id": "1",
      "attributes": { ... },
      "relationships": {
        "comments": {
          "data": [
            // Exactly 5 most recent comments for article 1
          ]
        }
      }
    },
    {
      "type": "articles", 
      "id": "2",
      "attributes": { ... },
      "relationships": {
        "comments": {
          "data": [
            // Exactly 5 most recent comments for article 2
          ]
        }
      }
    }
  ],
  "included": [
    // All included comment records
  ]
}
```

### Older Database Fallback

For databases without window function support:

```javascript
relationships: {
  comments: {
    hasMany: 'comments',
    include: {
      limit: 100,  // Global limit to prevent memory issues
      orderBy: ['article_id', '-created_at']  // Order by parent first
      // No strategy specified - uses standard query
    }
  }
}
```

This will apply a global limit of 100 comments total, not per article.

### Many-to-Many Relationships

Window functions also work with many-to-many relationships:

```javascript
relationships: {
  tags: {
    hasMany: 'tags',
    through: 'article_tags',
    foreignKey: 'article_id',
    otherKey: 'tag_id',
    include: {
      limit: 10,
      orderBy: ['name'],
      strategy: 'window'
    }
  }
}
```

## Error Handling

If you try to use window functions on an unsupported database:

```
RestApiResourceError: Include limits require window function support. 
Your database (MySQL 5.7.38) does not support this feature. 
Window functions are supported in: PostgreSQL 8.4+, MySQL 8.0+, 
MariaDB 10.2+, SQLite 3.25+, SQL Server 2005+
```

## Best Practices

1. **Always set reasonable limits** on hasMany relationships to prevent memory issues
2. **Use window functions** when available for accurate per-parent limits
3. **Consider separate endpoints** for large collections:
   ```
   // Instead of: GET /articles?include=comments
   // Use: GET /articles/123/comments?page[size]=10
   ```
4. **Test your database version** before deploying:
   ```javascript
   // The plugin logs capabilities at startup:
   // "Database capabilities detected: { 
   //   database: 'PostgreSQL', 
   //   version: '14.5', 
   //   windowFunctions: true 
   // }"
   ```

## Migration Checklist

- [ ] Check your database version supports window functions
- [ ] Add include configuration to relationships that need limits
- [ ] Test queries with includes to verify limits work as expected
- [ ] Update any frontend code that expects unlimited includes
- [ ] Monitor query performance with the new limits

## Performance Considerations

Window function queries are generally efficient, but consider:
- Indexes on foreign keys and order by columns
- The total number of parent records being queried
- The complexity of nested includes

For very large datasets, consider using dedicated relationship endpoints with pagination instead of includes.