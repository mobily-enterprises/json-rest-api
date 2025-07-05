# Correct Format for Searchable/Filterable Fields in REST API Plugin

## The Problem
The format you're using with `indexed: true` is not recognized by the REST API plugin for making fields searchable/filterable:

```javascript
// INCORRECT - This won't work for filtering
{
  title: { type: 'string', indexed: true, search: { filterUsing: 'like' } },
  status: { type: 'string', indexed: true, search: true }
}
```

## The Correct Format

The REST API plugin uses the `search` property within field definitions to make fields filterable. Here are the correct formats:

### 1. Simple Equality Filter (search: true)
For exact match filtering:

```javascript
{
  status: { 
    type: 'string',
    search: true  // Enables exact match filtering
  },
  author_id: {
    type: 'number',
    search: true  // Enables exact match filtering
  }
}
```

This allows queries like:
- `?filter[status]=published`
- `?filter[author_id]=123`

### 2. LIKE/Contains Filter
For partial string matching:

```javascript
{
  title: { 
    type: 'string',
    search: {
      filterUsing: 'like'  // Enables LIKE filtering
    }
  },
  body: {
    type: 'string',
    search: {
      filterUsing: 'like'
    }
  }
}
```

This allows queries like:
- `?filter[title]=JavaScript` (will match "Understanding JavaScript", "JavaScript Basics", etc.)

### 3. Multiple Filters from One Field
For creating multiple filter parameters from a single field:

```javascript
{
  published_at: {
    type: 'datetime',
    search: {
      published_after: {
        filterUsing: '>='
      },
      published_before: {
        filterUsing: '<='
      }
    }
  }
}
```

This allows queries like:
- `?filter[published_after]=2024-01-01&filter[published_before]=2024-12-31`

### 4. Multi-field Search
For searching across multiple fields:

```javascript
{
  // Regular fields
  title: { type: 'string' },
  body: { type: 'string' },
  tags: { type: 'string' },
  
  // Virtual field for multi-field search
  _virtual: {
    search: {
      fulltext: {
        type: 'string',
        likeOneOf: ['title', 'body', 'tags']
      }
    }
  }
}
```

This allows queries like:
- `?filter[fulltext]=API` (searches in title, body, AND tags)

### 5. Using Explicit searchSchema
Instead of using the `search` property in the schema, you can define a separate `searchSchema`:

```javascript
api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    price: { type: 'decimal' },
    category: { type: 'string' }
  },
  searchSchema: {
    name: {
      type: 'string',
      filterUsing: 'like'
    },
    category: {
      type: 'string'  // Exact match
    },
    price_min: {
      type: 'number',
      actualField: 'price',
      filterUsing: '>='
    },
    price_max: {
      type: 'number',
      actualField: 'price',
      filterUsing: '<='
    }
  }
});
```

## Complete Working Example

Here's the corrected schema format that will work with the REST API plugin:

```javascript
const articlesSchema = {
  id: { type: 'id' },
  
  // String field with LIKE search
  title: { 
    type: 'string', 
    required: true,
    search: {
      filterUsing: 'like'  // Enables contains/LIKE search
    }
  },
  
  // String field with exact match
  status: {
    type: 'string',
    enum: ['draft', 'published', 'archived'],
    search: true  // Enables exact match filtering
  },
  
  // Number field with exact match
  author_id: {
    type: 'number',
    search: true
  },
  
  // Field that creates multiple filters
  created_at: {
    type: 'datetime',
    search: {
      created_after: {
        filterUsing: '>='
      },
      created_before: {
        filterUsing: '<='
      }
    }
  },
  
  // Field without search (not filterable)
  view_count: {
    type: 'number'
    // No search property = not filterable
  }
};

// Add the resource with the corrected schema
api.addResource('articles', {
  schema: articlesSchema,
  sortableFields: ['title', 'created_at', 'status']
});
```

## Key Points to Remember

1. **Remove `indexed: true`** - This property is not used by the REST API plugin for filtering
2. **Use `search: true`** for simple equality filters
3. **Use `search: { filterUsing: 'like' }`** for contains/partial matching
4. **Use `search: { field_name: { filterUsing: 'operator' } }`** for custom filter names
5. The filter validation happens in the `query` method of the REST API plugin
6. If no `searchSchema` is provided, it's automatically generated from fields with the `search` property

## Filter Operators Available

- `'='` - Exact match (default)
- `'like'` - SQL LIKE operator (for contains search)
- `'>'`, `'>='`, `'<'`, `'<='` - Comparison operators
- `'in'` - Match any value in array
- `'between'` - Between two values
- Custom operators can be defined in the knex plugin

## Debugging Tips

If you're still getting "Invalid filter parameters" errors:

1. Check that the field name in the filter matches the field name in the schema
2. Ensure the field has a `search` property defined
3. Check that the value type matches the field type (e.g., don't send string for number field)
4. Use the explicit `searchSchema` option for more control over filter validation