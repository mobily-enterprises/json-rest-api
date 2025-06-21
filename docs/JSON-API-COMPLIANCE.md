# JSON:API Compliance Guide

This document explains how the JSON REST API library implements the [JSON:API specification](https://jsonapi.org/), and how to use the SimplifiedRecordsPlugin for a more convenient format.

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Default JSON:API Compliance](#default-jsonapi-compliance)
3. [SimplifiedRecordsPlugin](#simplifiedrecordsplugin)
4. [Compliance Assessment](#compliance-assessment)
5. [Usage Examples](#usage-examples)

## Design Philosophy

The JSON REST API library is **100% JSON:API compliant by default** while offering flexibility through plugins:

1. **Standards first** - Full JSON:API compliance out of the box
2. **Developer choice** - Use SimplifiedRecordsPlugin for convenience
3. **Performance** - Efficient implementation without compromises
4. **Flexibility** - Choose your preferred format via plugins

## Default JSON:API Compliance

The library implements the complete JSON:API v1.0 specification by default:

### ✅ Resource Objects
```javascript
{
  "data": {
    "id": "1",
    "type": "users",
    "attributes": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

### ✅ Relationships
```javascript
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Post"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" }
      }
    }
  }
}
```

### ✅ Compound Documents
```javascript
{
  "data": {
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "My Post"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "42" }
      }
    }
  },
  "included": [{
    "type": "users",
    "id": "42",
    "attributes": {
      "name": "John Doe"
    }
  }]
}
```

### ✅ Collection Responses
```javascript
{
  "data": [
    /* array of resource objects */
  ],
  "meta": {
    "totalCount": 100,
    "pageNumber": 1,
    "pageSize": 10,
    "totalPages": 10
  },
  "links": {
    "self": "http://api.example.com/posts?page[number]=1",
    "first": "http://api.example.com/posts?page[number]=1",
    "last": "http://api.example.com/posts?page[number]=10",
    "next": "http://api.example.com/posts?page[number]=2"
  }
}
```

### ✅ Error Responses
```javascript
{
  "errors": [{
    "id": "error-uuid",
    "status": "404",
    "code": "NOT_FOUND",
    "title": "NotFoundError",
    "detail": "Resource not found: users/123",
    "source": {
      "pointer": "/data/id"
    },
    "meta": {
      "timestamp": "2024-01-01T12:00:00Z"
    }
  }]
}
```

### ✅ Query Parameters
- **Filtering**: `?filter[name]=John&filter[age]=25`
- **Sorting**: `?sort=-createdAt,name`
- **Pagination**: `?page[size]=10&page[number]=2`
- **Sparse fieldsets**: `?fields[users]=name,email`
- **Including relationships**: `?include=author,comments.author`

### ✅ Content Type
- Accepts both `application/json` and `application/vnd.api+json`
- Returns `application/json` by default (allowed by spec)

## SimplifiedRecordsPlugin

For developers who prefer a simpler format, the `SimplifiedRecordsPlugin` transforms JSON:API responses into a more convenient structure:

### Installation
```javascript
import { createApi, SimplifiedRecordsPlugin } from 'json-rest-api';

const api = createApi({ 
  storage: 'memory',
  http: { app }
});

// Enable simplified format
api.use(SimplifiedRecordsPlugin, {
  flattenResponse: false,   // Keep data wrapper
  includeType: true,        // Keep type field
  embedRelationships: true  // Embed related objects
});
```

### What It Does

1. **Flattens Attributes**
   ```javascript
   // JSON:API (default)
   {
     "data": {
       "id": "1",
       "type": "users",
       "attributes": {
         "name": "John"
       }
     }
   }
   
   // Simplified
   {
     "data": {
       "id": "1",
       "type": "users",
       "name": "John"  // Attributes flattened
     }
   }
   ```

2. **Embeds Relationships**
   ```javascript
   // JSON:API (default)
   {
     "data": {
       "id": "1",
       "type": "posts",
       "attributes": {
         "title": "My Post"
       },
       "relationships": {
         "author": {
           "data": { "type": "users", "id": "42" }
         }
       }
     },
     "included": [{
       "type": "users",
       "id": "42",
       "attributes": { "name": "John" }
     }]
   }
   
   // Simplified
   {
     "data": {
       "id": "1",
       "type": "posts",
       "title": "My Post",
       "authorId": "42",
       "author": {
         "id": "42",
         "type": "users",
         "name": "John"
       }
     }
   }
   ```

3. **Optional Response Flattening**
   ```javascript
   // With flattenResponse: true
   
   // Single resource
   await api.resources.users.get(1)
   // Returns: { id: "1", name: "John" }
   
   // Collection with meta
   await api.resources.users.query({ pageSize: 10 })
   // Returns: { 
   //   records: [...], 
   //   meta: { totalCount: 100, ... } 
   // }
   ```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `flattenResponse` | `false` | Remove data wrapper for single resources |
| `includeType` | `true` | Include the type field in responses |
| `embedRelationships` | `true` | Embed related objects instead of using relationships/included |

## Compliance Assessment

### Default: 100% JSON:API Compliant ✅

| Feature | Compliance | Implementation |
|---------|------------|----------------|
| **Document Structure** | ✅ 100% | Full `data`, `errors`, `meta`, `links`, `included` support |
| **Resource Objects** | ✅ 100% | Proper `id`, `type`, `attributes`, `relationships` |
| **Relationships** | ✅ 100% | Separate relationships object with proper structure |
| **Compound Documents** | ✅ 100% | Full `included` array with deduplication |
| **Links** | ✅ 100% | Pagination links, relationship links (when using HTTP) |
| **Error Objects** | ✅ 100% | Complete error object structure |
| **Query Parameters** | ✅ 100% | All standard parameters supported |
| **Sparse Fieldsets** | ✅ 100% | `fields[type]=field1,field2` syntax |
| **Sorting** | ✅ 100% | Multi-field with `-` prefix for descending |
| **Pagination** | ✅ 100% | Page-based with proper meta and links |
| **Filtering** | ✅ 100% | `filter[field]=value` with operators |
| **Include** | ✅ 100% | Dot-notation for nested includes |
| **Content Type** | ✅ 100% | Accepts required media types |
| **HTTP Semantics** | ✅ 100% | Correct methods and status codes |

### With SimplifiedRecordsPlugin: Convenient Format 🔄

The plugin provides a familiar format while maintaining all functionality:

| Feature | Format | Notes |
|---------|--------|-------|
| **Responses** | Simplified | Attributes flattened, relationships embedded |
| **Requests** | JSON:API | No change to request format |
| **Query Parameters** | JSON:API | All parameters work identically |
| **Error Handling** | JSON:API | Errors remain fully compliant |
| **Features** | 100% | All features continue to work |

## Usage Examples

### Client Code Examples

#### Reading Data
```javascript
// With SimplifiedRecordsPlugin
const user = await api.resources.users.get(1);
console.log(user.data.name); // Direct access

// Without plugin (JSON:API)
const user = await api.resources.users.get(1);
console.log(user.data.attributes.name); // Via attributes
```

#### Working with Relationships
```javascript
// With SimplifiedRecordsPlugin
const post = await api.resources.posts.get(1);
console.log(post.data.author.name); // Embedded object

// Without plugin (JSON:API)
const post = await api.resources.posts.get(1);
const author = post.included.find(
  r => r.type === 'users' && r.id === post.data.relationships.author.data.id
);
console.log(author.attributes.name);
```

## Summary

- **Default**: 100% JSON:API v1.0 compliant
- **SimplifiedRecordsPlugin**: Convenient format for easier development
- **Flexibility**: Choose your format based on your needs
- **Performance**: Minimal overhead in either mode

The JSON REST API library provides full JSON:API compliance by default while offering the flexibility to use a simplified format when preferred.