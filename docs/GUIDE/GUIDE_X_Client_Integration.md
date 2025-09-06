# Client Integration and RelationMap

## Overview

When building client applications that consume json-rest-api endpoints, one of the key challenges is handling the transformation between JSON:API's relationship format and the simpler object structures typically used in client code. The `relationMap` is a metadata structure that json-rest-api can provide to help clients understand which fields are relationships and how to handle them.

## The RelationMap Structure

The `relationMap` is a simple object that describes the relationships in a resource. It tells the client:
- Which fields are relationships (not regular attributes)
- What type of relationship each field represents
- The target resource type for each relationship

### Structure Format

```javascript
{
  fieldName: {
    type: 'belongsTo' | 'manyToMany',
    resourceType: 'targetResource',  // For regular relationships
    polymorphic: true                 // For polymorphic relationships
  }
}
```

### Example RelationMap

For a typical blog application with articles, authors, and tags:

```javascript
{
  // Regular belongsTo relationship
  author: {
    type: 'belongsTo',
    resourceType: 'users'
  },
  
  // Many-to-many relationship
  tags: {
    type: 'manyToMany',
    resourceType: 'tags'
  },
  
  // Polymorphic belongsTo relationship
  commentable: {
    type: 'belongsTo',
    polymorphic: true
  }
}
```

## How json-rest-api Generates the RelationMap

The relationMap is automatically generated from your resource schema definitions:

### From Schema Fields (belongsTo)

When you define a field with `belongsTo` in your schema:

```javascript
schema: {
  author_id: { 
    type: 'number', 
    belongsTo: 'users', 
    as: 'author'  // This becomes the relationship name
  }
}
```

This generates:
```javascript
relationMap: {
  author: {
    type: 'belongsTo',
    resourceType: 'users'
  }
}
```

### From Relationships Object (manyToMany)

When you define relationships in the `relationships` object:

```javascript
relationships: {
  tags: {
    manyToMany: {
      through: 'article_tags',
      foreignKey: 'article_id',
      otherKey: 'tag_id'
    }
  }
}
```

This generates:
```javascript
relationMap: {
  tags: {
    type: 'manyToMany',
    resourceType: 'tags'
  }
}
```

### Polymorphic Relationships

For polymorphic relationships defined in your schema:

```javascript
schema: {
  commentable_type: { type: 'string' },
  commentable_id: { type: 'number' },
  // ... with appropriate belongsToPolymorphic configuration
}

relationships: {
  commentable: {
    belongsToPolymorphic: {
      typeField: 'commentable_type',
      idField: 'commentable_id',
      types: ['articles', 'posts', 'videos']
    }
  }
}
```

This generates:
```javascript
relationMap: {
  commentable: {
    type: 'belongsTo',
    polymorphic: true
  }
}
```

## Accessing the RelationMap

### Via HTTP Metadata Endpoint

If your application provides a metadata or serverInfo endpoint, you can include the relationMap for each resource:

```javascript
// GET /api/serverInfo
{
  resources: {
    articles: {
      resourceName: 'articles',
      schema: { /* ... */ },
      relationMap: {
        author: { type: 'belongsTo', resourceType: 'users' },
        tags: { type: 'manyToMany', resourceType: 'tags' }
      }
    }
  }
}
```

### Programmatically

Resources exposed through json-rest-api contain the schema information needed to generate the relationMap. Your server application can expose this information through metadata endpoints or generate it on demand.

## Using the RelationMap in Client Applications

The relationMap enables clients to intelligently transform data between their internal format and JSON:API format. Clients can implement transformation functions that use the relationMap to convert between simplified objects and JSON:API structure.

### Transformation Pattern: Client → Server

When sending data to the server, clients need to convert simple objects to JSON:API format:

```javascript
// Client has simple object
const articleData = {
  id: '123',
  title: 'My Article',
  author: 42,        // Simple ID reference
  tags: [1, 2, 3]    // Array of ID references
};

// Transform to JSON:API format using relationMap
// Result would be:
{
  data: {
    type: 'articles',
    id: '123',
    attributes: { title: 'My Article' },
    relationships: {
      author: { data: { type: 'users', id: '42' } },
      tags: { data: [
        { type: 'tags', id: '1' },
        { type: 'tags', id: '2' },
        { type: 'tags', id: '3' }
      ]}
    }
  }
}
```

### Transformation Pattern: Server → Client

When receiving JSON:API responses, clients can transform them to simpler objects:

```javascript
// JSON:API response from server
{
  data: {
    type: 'articles',
    id: '123',
    attributes: { title: 'My Article' },
    relationships: {
      author: { data: { type: 'users', id: '42' } },
      tags: { data: [
        { type: 'tags', id: '1' },
        { type: 'tags', id: '2' }
      ]}
    }
  }
}

// Transform to simple object using relationMap
// Result would be:
{
  id: '123',
  title: 'My Article',
  author: '42',        // Simplified to just ID
  tags: ['1', '2']     // Simplified to array of IDs
}
```

## Benefits of Using RelationMap

1. **Schema-Agnostic Clients**: Clients don't need to know the database schema or field naming conventions
2. **Automatic Transformation**: No manual configuration needed when using json-rest-api
3. **Type Safety**: Explicit relationship types prevent transformation errors
4. **Polymorphic Support**: Handles complex polymorphic relationships correctly
5. **Standards Compliance**: Enables proper JSON:API communication while maintaining simple client interfaces

## Example: Client Implementation Pattern

Here's a conceptual example of how clients can leverage the relationMap:

```javascript
// Client receives relationMap from server metadata
const articleRelationMap = {
  author: { type: 'belongsTo', resourceType: 'users' },
  tags: { type: 'manyToMany', resourceType: 'tags' }
};

// Client works with simple objects internally
const article = {
  id: '123',
  title: 'My Article',
  author: '42',        // Just the ID
  tags: ['1', '2']     // Array of IDs
};

// When sending to server: transform to JSON:API
// POST /api/articles
// Content-Type: application/vnd.api+json
// Body: {
//   data: {
//     type: 'articles',
//     attributes: { title: 'My Article' },
//     relationships: {
//       author: { data: { type: 'users', id: '42' } },
//       tags: { data: [
//         { type: 'tags', id: '1' },
//         { type: 'tags', id: '2' }
//       ]}
//     }
//   }
// }

// When receiving from server: transform from JSON:API
// The JSON:API response gets transformed back to simple objects
// using the relationMap to identify which fields are relationships
```

## Important Notes

1. **HasMany Relationships**: The relationMap typically doesn't include `hasMany` relationships because they're not sent from client to server (they're managed by the foreign key on the other side)

2. **Field Naming**: The relationMap uses the relationship name (the `as` property in schema), not the database field name

3. **Type Coercion**: IDs are converted to strings in JSON:API format as per the specification

4. **Null Handling**: Null relationships are properly handled in both directions

5. **Collections**: When transforming collection responses, apply the transformation to each item in the array

## Conclusion

The relationMap provides a simple yet powerful way to bridge the gap between json-rest-api's schema-based approach and client applications that need to work with JSON:API format. By providing this metadata, json-rest-api enables clients to be completely agnostic about the server's implementation details while still maintaining full JSON:API compliance.