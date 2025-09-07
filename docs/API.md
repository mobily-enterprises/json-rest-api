# JSON REST API - Complete API Reference

This reference provides comprehensive documentation for all methods, parameters, and features available in the json-rest-api library.

## Important Notes

1. **Context Parameter**: The `context` parameter shown in method signatures is typically managed internally by the framework. When using the API programmatically, you usually don't need to provide it unless you're implementing custom authentication or request-specific data.

2. **Simplified Mode Defaults**: 
   - `simplifiedApi`: `true` (default for programmatic API calls)
   - `simplifiedTransport`: `false` (default for HTTP transport)

3. **All parameters must be passed within a single params object** as the first argument to each method.

## Table of Contents

1. [Core API Methods](#core-api-methods)
   - [QUERY - Retrieve Collections](#query---retrieve-collections)
   - [GET - Retrieve Single Resource](#get---retrieve-single-resource)
   - [POST - Create Resource](#post---create-resource)
   - [PUT - Replace Resource](#put---replace-resource)
   - [PATCH - Update Resource](#patch---update-resource)
   - [DELETE - Remove Resource](#delete---remove-resource)
2. [Relationship Methods](#relationship-methods)
   - [getRelated - Retrieve Related Resources](#getrelated---retrieve-related-resources)
   - [getRelationship - Retrieve Relationship Identifiers](#getrelationship---retrieve-relationship-identifiers)
   - [postRelationship - Add to Relationship](#postrelationship---add-to-relationship)
   - [patchRelationship - Replace Relationship](#patchrelationship---replace-relationship)
   - [deleteRelationship - Remove from Relationship](#deleterelationship---remove-from-relationships)
3. [Hook System](#hook-system)
   - [Complete Hook Execution Order](#complete-hook-execution-order)
   - [Hook Context Objects](#hook-context-objects)
4. [Query Features](#query-features)
   - [Filtering](#filtering)
   - [Sorting](#sorting)
   - [Pagination](#pagination)
   - [Sparse Fieldsets](#sparse-fieldsets)
   - [Including Related Resources](#including-related-resources)
5. [Configuration Options](#configuration-options)
6. [Schema Configuration](#schema-configuration)
7. [Error Handling](#error-handling)
8. [Advanced Features](#advanced-features)

---

## Core API Methods

### QUERY - Retrieve Collections

Retrieves a collection of resources with support for filtering, sorting, pagination, and relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].query(params, context)
```

#### Parameters

All parameters are passed within a single `params` object:

```javascript
{
  queryParams: {
    include: Array,      // Relationship paths to include
    fields: Object,      // Sparse fieldsets
    filters: Object,     // Filter conditions
    sort: Array,         // Sort fields
    page: Object         // Pagination parameters
  },
  simplified: Boolean,   // Override simplified mode (default: true for API)
  transaction: Object    // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `queryParams` | Object | No | Query parameters container |
| `queryParams.include` | Array | No | Relationship paths to include (e.g., `['author', 'comments.user']`) |
| `queryParams.fields` | Object | No | Sparse fieldsets - keys are resource types, values are comma-separated field names |
| `queryParams.filters` | Object | No | Filter conditions based on searchSchema configuration |
| `queryParams.sort` | Array | No | Sort fields, prefix with '-' for DESC (e.g., `['title', '-created-at']`) |
| `queryParams.page` | Object | No | Pagination parameters |
| `queryParams.page.number` | Number | No | Page number (1-based, offset pagination) |
| `queryParams.page.size` | Number | No | Items per page |
| `queryParams.page.after` | String | No | Cursor for forward pagination |
| `queryParams.page.before` | String | No | Cursor for backward pagination |
| `simplified` | Boolean | No | Override simplified mode setting (default: true) |
| `transaction` | Object | No | Database transaction object |

#### Return Value

**JSON:API Mode (simplified: false):**
```javascript
{
  data: [
    {
      type: 'articles',
      id: '1',
      attributes: {
        title: 'First Article',
        content: 'Article content...'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '10' }
        }
      }
    }
  ],
  included: [
    {
      type: 'users',
      id: '10',
      attributes: {
        name: 'John Doe'
      }
    }
  ],
  meta: {
    page: {
      total: 50,
      size: 10,
      number: 1
    }
  },
  links: {
    self: '/articles?page[number]=1',
    next: '/articles?page[number]=2',
    last: '/articles?page[number]=5'
  }
}
```

**Simplified Mode (simplified: true - default):**
```javascript
{
  data: [
    {
      id: '1',
      title: 'First Article',
      content: 'Article content...',
      author: '10',
      author: {
        id: '10',
        name: 'John Doe'
      }
    }
  ],
  meta: {
    page: {
      total: 50,
      size: 10,
      number: 1
    }
  }
}
```

#### HTTP Equivalent

```http
GET /articles?include=author&fields[articles]=title,content&fields[users]=name&filter[status]=published&sort=-created-at&page[number]=1&page[size]=10
Accept: application/vnd.api+json
```

#### Examples

**Basic Query:**
```javascript
// Get all articles (simplified mode by default)
const result = await api.resources.articles.query({});

// HTTP equivalent
// GET /articles
```

**Query with Filtering:**
```javascript
// Get published articles by a specific author
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      status: 'published',
      author: '10'
    }
  }
});

// HTTP equivalent
// GET /articles?filter[status]=published&filter[author]=10
```

**Query with Sorting and Pagination:**
```javascript
// Get articles sorted by creation date (newest first), page 2
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-created-at', 'title'],
    page: {
      number: 2,
      size: 20
    }
  }
});

// HTTP equivalent
// GET /articles?sort=-created-at,title&page[number]=2&page[size]=20
```

**Query with Includes and Sparse Fields:**
```javascript
// Get articles with author and comments, only specific fields
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'comments.user'],
    fields: {
      articles: 'title,summary',
      users: 'name,avatar',
      comments: 'content,created-at'
    }
  }
});

// HTTP equivalent
// GET /articles?include=author,comments.user&fields[articles]=title,summary&fields[users]=name,avatar&fields[comments]=content,created-at
```

**JSON:API Mode Query:**
```javascript
// Force JSON:API response format
const result = await api.resources.articles.query({
  queryParams: {
    filters: { status: 'published' },
    include: ['author']
  },
  simplified: false
});

// Returns full JSON:API structure with type, id, attributes, relationships
```

**Cursor-based Pagination:**
```javascript
// Get next page using cursor
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      after: 'eyJpZCI6MTAsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTUifQ==',
      size: 10
    }
  }
});

// HTTP equivalent
// GET /articles?page[after]=eyJpZCI6MTAsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTUifQ==&page[size]=10
```

---

### GET - Retrieve Single Resource

Retrieves a single resource by its ID with optional relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].get(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,     // Required: The unique ID of the resource
  queryParams: {
    include: Array,      // Relationship paths to include
    fields: Object       // Sparse fieldsets
  },
  simplified: Boolean,   // Override simplified mode (default: true for API)
  transaction: Object    // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | The unique ID of the resource |
| `queryParams` | Object | No | Query parameters |
| `queryParams.include` | Array | No | Relationship paths to include |
| `queryParams.fields` | Object | No | Sparse fieldsets for specific resource types |
| `simplified` | Boolean | No | Override simplified mode setting (default: true) |
| `transaction` | Object | No | Database transaction object |

#### Return Value

**JSON:API Mode (simplified: false):**
```javascript
{
  data: {
    type: 'articles',
    id: '1',
    attributes: {
      title: 'Article Title',
      content: 'Full article content...'
    },
    relationships: {
      author: {
        data: { type: 'users', id: '10' }
      }
    }
  },
  included: [
    {
      type: 'users',
      id: '10',
      attributes: {
        name: 'John Doe'
      }
    }
  ]
}
```

**Simplified Mode (simplified: true - default):**
```javascript
{
  id: '1',
  title: 'Article Title',
  content: 'Full article content...',
  author: '10',
  author: {
    id: '10',
    name: 'John Doe'
  }
}
```

#### HTTP Equivalent

```http
GET /articles/1?include=author&fields[articles]=title,content
Accept: application/vnd.api+json
```

#### Examples

**Basic Get:**
```javascript
// Get article by ID (simplified mode by default)
const result = await api.resources.articles.get({
  id: '1'
});

// HTTP equivalent
// GET /articles/1
```

**Get with Relationships:**
```javascript
// Get article with author and comments
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author', 'comments']
  }
});

// HTTP equivalent
// GET /articles/1?include=author,comments
```

**Get with Sparse Fields:**
```javascript
// Get article with only specific fields
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author'],
    fields: {
      articles: 'title,summary',
      users: 'name'
    }
  }
});

// HTTP equivalent
// GET /articles/1?include=author&fields[articles]=title,summary&fields[users]=name
```

**JSON:API Mode Get:**
```javascript
// Get in JSON:API format
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author', 'tags']
  },
  simplified: false
});

// Returns full JSON:API document structure
```

---

### POST - Create Resource

Creates a new resource with attributes and optional relationships.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].post(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Resource data (JSON:API or simplified)
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Resource data to create |
| `inputRecord.data` | Object | Yes (JSON:API) | Resource data container |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | Yes (JSON:API) | Resource attributes |
| `inputRecord.data.relationships` | Object | No | Related resources |
| `queryParams` | Object | No | For includes/fields in response |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting ('no', 'minimal', 'full') |

#### Return Value Behavior

The return value depends on `returnFullRecord` setting and whether it's an API or transport call:

**Default behavior:**
- API calls (programmatic): `returnFullRecord = 'full'` (returns complete resource)
- Transport calls (HTTP): `returnFullRecord = 'no'` (returns 204 No Content)

**Options:**
- `'no'`: Returns `undefined` (204 No Content)
- `'minimal'`: Returns resource with ID only
- `'full'`: Returns complete resource with all fields

#### HTTP Equivalent

```http
POST /articles
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "attributes": {
      "title": "New Article",
      "content": "Article content..."
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "10" }
      }
    }
  }
}
```

#### Examples

**Basic Create (Simplified Mode):**
```javascript
// Create article with simplified input (default mode)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...',
    status: 'draft',
    author: '10'
  }
});

// Returns full record by default for API calls
```

**Create with JSON:API Format:**
```javascript
// Create article with JSON:API format
const result = await api.resources.articles.post({
  inputRecord: {
    data: {
      type: 'articles',
      attributes: {
        title: 'New Article',
        content: 'Article content...',
        status: 'draft'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '10' }
        }
      }
    }
  },
  simplified: false
});
```

**Create with Multiple Relationships:**
```javascript
// Create article with author and tags (simplified)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...',
    author: '10',
    tags: ['1', '2', '3']
  },
  queryParams: {
    include: ['author', 'tags']
  }
});
```

**Create with Minimal Return:**
```javascript
// Create and return only ID
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...'
  },
  returnFullRecord: 'minimal'
});

// Returns (simplified mode):
// {
//   id: '123'
// }
```

**Create with No Return:**
```javascript
// Create without returning data (like HTTP transport)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...'
  },
  returnFullRecord: 'no'
});

// Returns: undefined
```

---

### PUT - Replace Resource

Completely replaces an existing resource. All attributes must be provided; missing relationships are removed.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].put(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Complete resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Complete resource data |
| `inputRecord.id` | String | Yes (simplified) | Resource ID |
| `inputRecord.data.id` | String | Yes (JSON:API) | Must match the resource ID |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | Yes (JSON:API) | All resource attributes |
| `inputRecord.data.relationships` | Object | No | All relationships (missing ones are nulled) |
| `queryParams` | Object | No | For response formatting |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting |

#### Return Value

Updated resource based on `returnFullRecord` setting (defaults: API='full', transport='no').

#### HTTP Equivalent

```http
PUT /articles/1
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "Updated Title",
      "content": "New content...",
      "status": "published"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "10" }
      }
    }
  }
}
```

#### Examples

**Basic Replace (Simplified):**
```javascript
// Replace entire article (simplified mode)
const result = await api.resources.articles.put({
  inputRecord: {
    id: '1',
    title: 'Completely New Title',
    content: 'Entirely new content',
    status: 'published',
    author: '10'
    // Note: All attributes must be provided
  }
});
```

**Replace with JSON:API Format:**
```javascript
// Replace article with JSON:API format
const result = await api.resources.articles.put({
  inputRecord: {
    data: {
      type: 'articles',
      id: '1',
      attributes: {
        title: 'Updated Article',
        content: 'Updated content',
        status: 'published'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '20' } // Changed author
        },
        tags: {
          data: [] // Remove all tags
        }
      }
    }
  },
  simplified: false
});
```

**Replace and Remove Relationships:**
```javascript
// Replace and explicitly remove relationships
const result = await api.resources.articles.put({
  inputRecord: {
    id: '1',
    title: 'Article Without Author',
    content: 'Content...',
    status: 'draft',
    author: null,  // Remove author
    tags: []       // Remove all tags
  }
});
```

---

### PATCH - Update Resource

Partially updates an existing resource. Only provided attributes and relationships are modified.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].patch(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Partial resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Partial resource data |
| `inputRecord.id` | String | Yes (simplified) | Resource ID |
| `inputRecord.data.id` | String | Yes (JSON:API) | Resource ID |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | No | Attributes to update |
| `inputRecord.data.relationships` | Object | No | Relationships to update |
| `queryParams` | Object | No | For response formatting |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting |

#### Return Value

Updated resource based on `returnFullRecord` setting (defaults: API='full', transport='no').

#### HTTP Equivalent

```http
PATCH /articles/1
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "status": "published"
    }
  }
}
```

#### Examples

**Basic Update (Simplified):**
```javascript
// Update only the status (simplified mode)
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    status: 'published'
  }
});

// Only status is updated, other fields remain unchanged
```

**Update Multiple Attributes:**
```javascript
// Update title and content
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    title: 'Updated Title',
    content: 'Updated content only',
    updated_at: new Date().toISOString()
  }
});
```

**Update with JSON:API Format:**
```javascript
// Update with JSON:API format
const result = await api.resources.articles.patch({
  inputRecord: {
    data: {
      type: 'articles',
      id: '1',
      attributes: {
        status: 'published',
        published_at: new Date().toISOString()
      },
      relationships: {
        author: {
          data: { type: 'users', id: '30' }
        }
      }
    }
  },
  simplified: false
});
```

**Update Relationships Only:**
```javascript
// Change author and add tags (simplified)
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    author: '30',
    tags: ['3', '4', '5']
  }
});
```

**Remove Optional Relationship:**
```javascript
// Set featured_image to null
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    featured_image_id: null
  }
});
```

---

### DELETE - Remove Resource

Permanently deletes a resource from the system.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].delete(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,    // Required: ID of resource to delete
  transaction: Object   // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | ID of resource to delete |
| `transaction` | Object | No | Database transaction object |

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
DELETE /articles/1
Accept: application/vnd.api+json
```

#### Examples

**Basic Delete:**
```javascript
// Delete article by ID
await api.resources.articles.delete({
  id: '1'
});

// Returns undefined (no content)

// HTTP equivalent
// DELETE /articles/1
```

**Delete with Transaction:**
```javascript
// Delete within a transaction
const trx = await knex.transaction();
try {
  // Delete article
  await api.resources.articles.delete({
    id: '1',
    transaction: trx
  });
  
  // Delete related comments
  await api.resources.comments.delete({
    id: '10',
    transaction: trx
  });
  
  await trx.commit();
} catch (error) {
  await trx.rollback();
  throw error;
}
```

**Note on Transaction Auto-commit:**
The library automatically manages transaction commits when you don't provide one:
- If you provide a transaction, you're responsible for committing/rolling back
- If you don't provide a transaction, the library creates one and auto-commits

---

## Relationship Methods

### getRelated - Retrieve Related Resources

Retrieves the actual related resources with full data, not just identifiers.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].getRelated(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  queryParams: Object,         // Standard query parameters
  transaction: Object          // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | Parent resource ID |
| `relationshipName` | String | Yes | Name of the relationship |
| `queryParams` | Object | No | Standard query parameters for related resources |
| `transaction` | Object | No | Database transaction object |

#### Return Value

JSON:API response with related resources (supports all query features like filtering, pagination, etc.)

#### HTTP Equivalent

```http
GET /articles/1/author
GET /articles/1/comments?page[size]=10&sort=-created-at
Accept: application/vnd.api+json
```

#### Examples

**Get Related To-One:**
```javascript
// Get author of article
const result = await api.resources.articles.getRelated({
  id: '1',
  relationshipName: 'author'
});

// Returns single resource (simplified mode by default):
// {
//   id: '10',
//   name: 'John Doe',
//   email: 'john@example.com'
// }

// HTTP equivalent
// GET /articles/1/author
```

**Get Related To-Many with Pagination:**
```javascript
// Get comments with pagination
const result = await api.resources.articles.getRelated({
  id: '1',
  relationshipName: 'comments',
  queryParams: {
    page: { size: 5, number: 1 },
    sort: ['-created-at']
  }
});

// Returns paginated collection

// HTTP equivalent
// GET /articles/1/comments?page[size]=5&page[number]=1&sort=-created-at
```

---

### getRelationship - Retrieve Relationship Identifiers

Retrieves only the resource identifiers for a relationship, not the full resource data.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].getRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  transaction: Object          // Database transaction object
}
```

#### Return Value

JSON:API relationship document with resource identifiers only

#### HTTP Equivalent

```http
GET /articles/1/relationships/author
GET /articles/1/relationships/tags
Accept: application/vnd.api+json
```

#### Examples

**Get To-One Relationship:**
```javascript
// Get author relationship
const result = await api.resources.articles.getRelationship({
  id: '1',
  relationshipName: 'author'
});

// Returns:
// {
//   data: { type: 'users', id: '10' }
// }

// HTTP equivalent
// GET /articles/1/relationships/author
```

**Get To-Many Relationship:**
```javascript
// Get tags relationship
const result = await api.resources.articles.getRelationship({
  id: '1',
  relationshipName: 'tags'
});

// Returns:
// {
//   data: [
//     { type: 'tags', id: '1' },
//     { type: 'tags', id: '2' },
//     { type: 'tags', id: '3' }
//   ]
// }

// HTTP equivalent
// GET /articles/1/relationships/tags
```

---

### postRelationship - Add to Relationship

Adds new members to a to-many relationship without affecting existing members.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].postRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  relationshipData: Array,     // Required: Array of resource identifiers
  transaction: Object          // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
POST /articles/1/relationships/tags
Content-Type: application/vnd.api+json

{
  "data": [
    { "type": "tags", "id": "4" },
    { "type": "tags", "id": "5" }
  ]
}
```

#### Examples

**Add Tags to Article:**
```javascript
// Add new tags without removing existing ones
await api.resources.articles.postRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '4' },
    { type: 'tags', id: '5' }
  ]
});

// Existing tags remain, new tags are added
```

---

### patchRelationship - Replace Relationship

Completely replaces a relationship. For to-one relationships, sets the new related resource. For to-many relationships, replaces all members.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].patchRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,                    // Required: Parent resource ID
  relationshipName: String,             // Required: Name of the relationship
  relationshipData: Object|Array|null,  // Required: New relationship data
  transaction: Object                   // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
PATCH /articles/1/relationships/author
Content-Type: application/vnd.api+json

{
  "data": { "type": "users", "id": "20" }
}
```

#### Examples

**Replace To-One Relationship:**
```javascript
// Change article author
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'author',
  relationshipData: { type: 'users', id: '20' }
});
```

**Replace To-Many Relationship:**
```javascript
// Replace all tags
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '1' },
    { type: 'tags', id: '2' }
  ]
});

// All previous tags are removed, only specified tags remain
```

**Clear Relationship:**
```javascript
// Remove all tags
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: []
});

// Remove author
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'author',
  relationshipData: null
});
```

---

### deleteRelationship - Remove from Relationships

Removes specific members from a to-many relationship.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].deleteRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  relationshipData: Array,     // Required: Array of resource identifiers to remove
  transaction: Object          // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
DELETE /articles/1/relationships/tags
Content-Type: application/vnd.api+json

{
  "data": [
    { "type": "tags", "id": "2" },
    { "type": "tags", "id": "3" }
  ]
}
```

#### Examples

**Remove Specific Tags:**
```javascript
// Remove specific tags from article
await api.resources.articles.deleteRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '2' },
    { type: 'tags', id: '3' }
  ]
});

// Only specified tags are removed, others remain
```

---

## Hook System

The library provides a comprehensive hook system for customizing behavior at every stage of request processing.

### Hook Execution Order by Method

Each API method has its own specific hook execution order. Here's the exact sequence for each method:

#### QUERY Method Hooks
```
1. beforeData
2. beforeDataQuery
3. knexQueryFiltering (multiple times for different filter types)
   - polymorphicFiltersHook
   - crossTableFiltersHook
   - basicFiltersHook
4. enrichRecord (for each record)
5. finish
6. finishQuery
```

#### GET Method Hooks
```
1. beforeData
2. beforeDataGet
3. checkDataPermissions
4. checkDataPermissionsGet
5. enrichRecord
6. enrichRecordWithRelationships
7. finish
8. finishGet
```

#### POST Method Hooks
```
1. beforeProcessing
2. beforeProcessingPost
3. beforeSchemaValidate
4. beforeSchemaValidatePost
5. afterSchemaValidatePost
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPost
9. [Database INSERT operation]
10. afterDataCallPost
11. afterDataCall
12. finish
13. finishPost
14. afterCommit (if transaction was created)
```

#### PUT Method Hooks
```
1. beforeProcessing
2. beforeProcessingPut
3. beforeSchemaValidate
4. beforeSchemaValidatePut
5. afterSchemaValidatePut
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPut
9. [Database UPDATE operation - full replacement]
10. afterDataCallPut
11. afterDataCall
12. finish
13. finishPut
14. afterCommit (if transaction was created)
```

#### PATCH Method Hooks
```
1. beforeProcessing
2. beforeProcessingPatch
3. beforeSchemaValidate
4. beforeSchemaValidatePatch
5. afterSchemaValidatePatch
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPatch
9. [Database UPDATE operation - partial update]
10. afterDataCallPatch
11. afterDataCall
12. finish
13. finishPatch
14. afterCommit (if transaction was created)
```

#### DELETE Method Hooks
```
1. beforeDataCall
2. beforeDataCallDelete
3. [Database DELETE operation]
4. afterDataCallDelete
5. afterDataCall
6. finish
7. finishDelete
8. afterCommit (if transaction was created)
```

#### Relationship Method Hooks

**getRelated:**
```
1. checkPermissions
2. checkPermissionsGetRelated
3. [Delegates to GET or QUERY methods internally]
```

**getRelationship:**
```
1. checkPermissions
2. checkPermissionsGetRelationship
3. [Delegates to GET method internally]
```

**postRelationship:**
```
1. checkPermissions
2. checkPermissionsPostRelationship
3. [Relationship manipulation]
4. finish
5. finishPostRelationship
```

**patchRelationship:**
```
1. checkPermissions
2. checkPermissionsPatchRelationship
3. [Delegates to PATCH method internally]
4. finish
5. finishPatchRelationship
```

**deleteRelationship:**
```
1. checkPermissions
2. checkPermissionsDeleteRelationship
3. [Relationship manipulation]
4. finish
5. finishDeleteRelationship
```

### Key Differences Between Methods

1. **Processing Hooks**: Only POST, PUT, and PATCH have `beforeProcessing` hooks
2. **Schema Validation**: Only POST, PUT, and PATCH have schema validation hooks
3. **Permission Checks**: GET uses `checkDataPermissions`, while relationship methods use `checkPermissions`
4. **Query Filtering**: Only QUERY method triggers `knexQueryFiltering` hooks
5. **Enrichment**: Only GET and QUERY have `enrichRecord` hooks
6. **Relationships**: Only GET has `enrichRecordWithRelationships`
7. **Transactions**: All write methods (POST, PUT, PATCH, DELETE) can trigger `afterCommit`/`afterRollback`

### Hook Context Objects

Each hook receives a context object with different properties based on the hook type and method:

#### beforeProcessing / beforeProcessing[Method]

```javascript
{
  method: 'post',              // HTTP method
  resourceType: 'articles',    // Resource being accessed
  params: {                    // Request parameters
    inputRecord: {...},
    queryParams: {...},
    simplified: true
  },
  auth: {...},                 // Authentication info
  transaction: {...},          // Database transaction
  schemaInfo: {...},           // Resource schema
  db: {...}                    // Database connection
}
```

**What can be modified:**
- `params` - Modify input data
- Add custom properties to context

**Example:**
```javascript
api.resource('articles').hook('beforeProcessingPost', async (context) => {
  // Add default status if not provided
  if (context.params.inputRecord && !context.params.inputRecord.status) {
    context.params.inputRecord.status = 'draft';
  }
  
  // Add metadata to context
  context.requestTime = new Date();
});
```

#### beforeSchemaValidate / afterSchemaValidate

```javascript
{
  method: 'patch',
  resourceType: 'articles',
  inputData: {                 // Parsed input data
    attributes: {...},
    relationships: {...}
  },
  existingRecord: {...},       // For update operations
  auth: {...},
  transaction: {...},
  schemaInfo: {...}
}
```

**What can be modified:**
- `inputData` - Modify before/after validation
- Throw errors for custom validation

**Example:**
```javascript
api.resource('articles').hook('afterSchemaValidate', async (context) => {
  // Custom validation
  if (context.inputData.attributes.status === 'published' && 
      !context.inputData.attributes.published_at) {
    throw new Error('Published articles must have a published_at date');
  }
});
```

#### checkDataPermissions / checkDataPermissions[Method]

```javascript
{
  method: 'delete',
  resourceType: 'articles',
  id: '1',                     // For single resource operations
  auth: {...},
  existingRecord: {...},       // For update/delete
  transaction: {...}
}
```

**Purpose:** Authorization checks - throw error to deny access

**Example:**
```javascript
api.resource('articles').hook('checkDataPermissionsDelete', async (context) => {
  // Only author or admin can delete
  if (context.auth.userId !== context.existingRecord.relationships?.author?.data?.id && 
      !context.auth.isAdmin) {
    throw new Error('Unauthorized to delete this article');
  }
});
```

#### beforeData / afterData

```javascript
{
  method: 'get',
  resourceType: 'articles',
  storageParams: {             // Parameters for storage layer
    id: '1',
    include: ['author'],
    fields: {...},
    filters: {...}
  },
  result: {...},               // After data operations
  auth: {...},
  transaction: {...},
  schemaInfo: {...}
}
```

**What can be modified:**
- `storageParams` (beforeData) - Modify query parameters
- `result` (afterData) - Modify query results

**Example:**
```javascript
api.resource('articles').hook('beforeDataQuery', async (context) => {
  // Add automatic filtering based on user
  if (context.auth.userId && !context.auth.isAdmin) {
    context.storageParams.filters = {
      ...context.storageParams.filters,
      author: context.auth.userId
    };
  }
});
```

#### enrichRecord

```javascript
{
  method: 'get',
  resourceType: 'articles',
  record: {                    // Full JSON:API record
    type: 'articles',
    id: '1',
    attributes: {...},
    relationships: {...}
  },
  isMainResource: true,        // vs included resource
  auth: {...},
  requestedFields: [...],      // Fields requested via sparse fieldsets
  parentContext: {...}         // Parent request context
}
```

**What can be modified:**
- `record` - Modify the entire record structure

**Example:**
```javascript
api.resource('articles').hook('enrichRecord', async (context) => {
  // Add metadata
  context.record.meta = {
    can_edit: context.auth.userId === context.record.attributes.author_id,
    version: context.record.attributes.version || 1
  };
});
```

#### enrichAttributes

```javascript
{
  method: 'get',
  resourceType: 'articles',
  attributes: {...},           // Current attributes
  requestedComputedFields: ['word_count', 'reading_time'],
  isMainResource: true,
  record: {...},               // Full record for reference
  auth: {...},
  parentContext: {...},
  computedDependencies: Set    // Fields to remove if not requested
}
```

**What can be modified:**
- `attributes` - Add/modify attribute values

**Example:**
```javascript
api.resource('articles').hook('enrichAttributes', async (context) => {
  // Add computed fields
  if (context.requestedComputedFields.includes('word_count')) {
    context.attributes.word_count = 
      context.attributes.content.split(/\s+/).length;
  }
  
  if (context.requestedComputedFields.includes('reading_time')) {
    const wordsPerMinute = 200;
    context.attributes.reading_time = 
      Math.ceil(context.attributes.word_count / wordsPerMinute);
  }
});
```

#### finish / finish[Method]

```javascript
{
  method: 'post',
  resourceType: 'articles',
  response: {                  // Final response object
    data: {...},
    included: [...],
    meta: {...}
  },
  auth: {...}
}
```

**What can be modified:**
- `response` - Final modifications to response

**Example:**
```javascript
api.resource('articles').hook('finish', async (context) => {
  // Add response metadata
  context.response.meta = {
    ...context.response.meta,
    generated_at: new Date().toISOString(),
  };
});
```

#### afterCommit / afterRollback

```javascript
{
  method: 'post',
  resourceType: 'articles',
  result: {...},               // Operation result
  error: {...},                // For rollback
  auth: {...},
  params: {...}                // Original parameters
}
```

**Use cases:**
- Send emails, notifications
- Clear caches
- Log events
- Cleanup on failure

**Example:**
```javascript
api.resource('articles').hook('afterCommit', async (context) => {
  if (context.method === 'post') {
    // Send notification email
    await emailService.sendNewArticleNotification({
      articleId: context.result.data.id,
      authorId: context.auth.userId
    });
  }
});
```

### Method-Specific Hooks

You can register hooks for specific methods by appending the method name:

```javascript
// Runs only for POST requests
api.resource('articles').hook('beforeDataPost', async (context) => {
  context.inputData.attributes.created_by = context.auth.userId;
});

// Runs only for PATCH requests
api.resource('articles').hook('beforeDataPatch', async (context) => {
  context.inputData.attributes.updated_by = context.auth.userId;
  context.inputData.attributes.updated_at = new Date().toISOString();
});

// Runs only for DELETE requests
api.resource('articles').hook('beforeDataDelete', async (context) => {
  // Archive instead of delete
  context.softDelete = true;
  context.inputData = {
    attributes: {
      deleted_at: new Date().toISOString(),
      deleted_by: context.auth.userId
    }
  };
});
```

### Query-Specific Hooks

#### knexQueryFiltering

Special hook for modifying database queries:

```javascript
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters, resourceSchema } = context;
  
  // Add custom where clauses
  if (filters.search) {
    query.where(function() {
      this.where('title', 'like', `%${filters.search}%`)
          .orWhere('content', 'like', `%${filters.search}%`);
    });
  }
  
  // Add joins for complex filtering
  if (filters.author_name) {
    query.join('users', 'articles.author_id', 'users.id')
         .where('users.name', 'like', `%${filters.author_name}%`);
  }
});
```

---

## Query Features

### Filtering

The library supports flexible filtering through the `filters` parameter in query operations.

#### Basic Filtering

```javascript
// Simple equality filter
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      status: 'published',
      author: '10'
    }
  }
});

// HTTP equivalent
// GET /articles?filter[status]=published&filter[author]=10
```

#### Operator-based Filtering

Filters support various operators when defined in the resource schema:

```javascript
// Resource schema configuration
searchSchema: {
  created_at: {
    type: 'datetime',
    operators: ['gt', 'gte', 'lt', 'lte']
  },
  title: {
    type: 'string',
    operators: ['eq', 'like', 'ilike']
  },
  view_count: {
    type: 'number',
    operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'in']
  }
}

// Usage
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      'created_at:gte': '2024-01-01',
      'created_at:lt': '2024-02-01',
      'title:like': '%javascript%',
      'view_count:gt': 100
    }
  }
});
```

#### Array Filters (IN operator)

```javascript
// Find articles with specific IDs
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      'id:in': ['1', '2', '3'],
      'status:in': ['published', 'featured']
    }
  }
});

// HTTP equivalent (comma-separated)
// GET /articles?filter[id:in]=1,2,3&filter[status:in]=published,featured
```

#### Custom Filter Logic

Use the `knexQueryFiltering` hook for complex filtering:

```javascript
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  // Full-text search
  if (filters.q) {
    query.whereRaw("to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ?)", [filters.q]);
  }
  
  // Date range
  if (filters.date_from && filters.date_to) {
    query.whereBetween('created_at', [filters.date_from, filters.date_to]);
  }
  
  // Complex boolean logic
  if (filters.featured_or_trending) {
    query.where(function() {
      this.where('is_featured', true)
          .orWhere('trending_score', '>', 0.8);
    });
  }
});
```

### Sorting

Control the order of results using the `sort` parameter.

#### Basic Sorting

```javascript
// Sort by single field (ascending)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['title']
  }
});

// Sort by single field (descending)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-created_at']
  }
});

// HTTP equivalent
// GET /articles?sort=title
// GET /articles?sort=-created_at
```

#### Multi-field Sorting

```javascript
// Sort by multiple fields
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-featured', '-created_at', 'title']
  }
});

// HTTP equivalent (comma-separated)
// GET /articles?sort=-featured,-created_at,title
```

#### Sorting on Related Fields

```javascript
// Sort by related resource fields (if configured)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['author.name', '-category.priority']
  }
});
```

### Pagination

The library supports multiple pagination strategies:

#### Offset Pagination

```javascript
// Page-based pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      number: 2,
      size: 20
    }
  }
});

// Response includes:
// {
//   data: [...],
//   meta: {
//     page: {
//       total: 150,      // Total records (if enablePaginationCounts: true)
//       size: 20,        // Page size
//       number: 2,       // Current page
//       totalPages: 8    // Total pages (if counts enabled)
//     }
//   },
//   links: {
//     first: '/articles?page[number]=1&page[size]=20',
//     prev: '/articles?page[number]=1&page[size]=20',
//     self: '/articles?page[number]=2&page[size]=20',
//     next: '/articles?page[number]=3&page[size]=20',
//     last: '/articles?page[number]=8&page[size]=20'
//   }
// }

// HTTP equivalent
// GET /articles?page[number]=2&page[size]=20
```

#### Cursor Pagination

```javascript
// Forward pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      after: 'eyJpZCI6MTAwLCJjcmVhdGVkX2F0IjoiMjAyNC0wMS0xNSJ9',
      size: 10
    }
  }
});

// Backward pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      before: 'eyJpZCI6NTAsImNyZWF0ZWRfYXQiOiIyMDI0LTAxLTEwIn0=',
      size: 10
    }
  }
});

// Response includes:
// {
//   data: [...],
//   meta: {
//     page: {
//       hasMore: true,   // More records available
//       size: 10         // Page size
//     }
//   },
//   links: {
//     prev: '/articles?page[before]=...',
//     self: '/articles?page[after]=...',
//     next: '/articles?page[after]=...'
//   }
// }
```

#### Pagination Configuration

```javascript
// Configure in plugin
const restApiPlugin = new RestApiPlugin({
  queryDefaultLimit: 20,      // Default page size
  queryMaxLimit: 100,         // Maximum allowed page size
  enablePaginationCounts: true // Enable total counts (may impact performance)
});
```

### Sparse Fieldsets

Request only specific fields to reduce payload size:

```javascript
// Request specific fields for articles
const result = await api.resources.articles.query({
  queryParams: {
    fields: {
      articles: 'title,summary,published_at'
    }
  }
});

// With includes - specify fields for each type
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'category'],
    fields: {
      articles: 'title,summary',
      users: 'name,avatar',
      categories: 'name,slug'
    }
  }
});

// HTTP equivalent
// GET /articles?fields[articles]=title,summary&fields[users]=name,avatar
```

### Including Related Resources

Load related resources in a single request:

#### Basic Includes

```javascript
// Include single relationship
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author']
  }
});

// Include multiple relationships
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'category', 'tags']
  }
});

// HTTP equivalent
// GET /articles?include=author,category,tags
```

#### Nested Includes

```javascript
// Include nested relationships
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author.profile', 'comments.user', 'category.parent']
  }
});

// Deep nesting (limited by includeDepthLimit)
const result = await api.resources.articles.query({
  queryParams: {
    include: ['comments.user.profile.avatar']
  }
});

// HTTP equivalent
// GET /articles?include=comments.user.profile.avatar
```

#### Include with Filtering

Some implementations support filtering included resources:

```javascript
// Custom hook to filter included resources
api.resource('articles').hook('afterDataQuery', async (context) => {
  if (context.result.included) {
    // Filter included comments to only show approved
    context.result.included = context.result.included.filter(resource => {
      if (resource.type === 'comments') {
        return resource.attributes.status === 'approved';
      }
      return true;
    });
  }
});
```

---

## Configuration Options

### Plugin Configuration

```javascript
const restApiPlugin = new RestApiPlugin({
  // API behavior
  simplifiedApi: true,              // Use simplified mode for programmatic calls (default: true)
  simplifiedTransport: false,       // Use JSON:API for HTTP transport (default: false)
  
  // Return record configuration
  returnRecordApi: {
    post: 'full',                   // Return full record after create (default)
    put: 'full',                    // Return full record after replace (default)
    patch: 'full',                  // Return full record after update (default)
    delete: 'no'                    // Return nothing after delete (default)
  },
  
  returnRecordTransport: {
    post: 'no',                     // Return 204 for HTTP POST (default)
    put: 'no',                      // Return 204 for HTTP PUT (default)
    patch: 'no',                    // Return 204 for HTTP PATCH (default)
    delete: 'no'                    // Return 204 for HTTP DELETE (default)
  },
  
  // Query limits
  queryDefaultLimit: 20,            // Default pagination size
  queryMaxLimit: 100,               // Maximum allowed page size
  
  // Include depth
  includeDepthLimit: 3,             // Maximum relationship nesting depth
  
  // Performance
  enablePaginationCounts: true,     // Execute count queries for total pages
  
  // Error handling
  exposeErrors: false,              // Include error details in responses
  
  // Custom serializers
  serializers: {
    articles: customArticleSerializer
  }
});
```

---

## Schema Configuration

### Resource Schema Structure

```javascript
api.addResource({
  name: 'articles',
  
  // Primary key configuration
  idProperty: 'id',                 // Custom primary key field (default: 'id')
  
  schema: {
    // Attributes
    attributes: {
      title: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      content: {
        type: 'string',
        required: true
      },
      status: {
        type: 'string',
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
      },
      published_at: {
        type: 'datetime',
        nullable: true
      },
      metadata: {
        type: 'object',
        // Custom getter/setter for data transformation
        getter: (value) => JSON.parse(value || '{}'),
        setter: (value) => JSON.stringify(value)
      },
      price: {
        type: 'number',
        // Store as cents, display as dollars
        getter: (value) => value / 100,
        setter: (value) => Math.round(value * 100)
      }
    },
    
    // Virtual fields (excluded from database operations)
    virtualFields: ['temp_data', 'ui_state'],
    
    // Relationships
    relationships: {
      author: {
        type: 'users',
        required: true,
        relationshipType: 'belongsTo',
        foreignKey: 'author_id'        // Explicit foreign key
      },
      category: {
        type: 'categories',
        relationshipType: 'belongsTo',
        nullable: true
      },
      tags: {
        type: 'tags',
        relationshipType: 'manyToMany',
        through: 'article_tags',       // Junction table
        pivotFields: ['sort_order']    // Additional pivot fields
      },
      comments: {
        type: 'comments',
        relationshipType: 'hasMany',
        foreignKey: 'article_id'
      },
      // Polymorphic relationship
      commentable: {
        polymorphic: true,
        types: ['articles', 'videos', 'photos'],
        typeField: 'commentable_type',
        idField: 'commentable_id'
      }
    },
    
    // Computed fields
    computedFields: {
      word_count: {
        type: 'number',
        compute: (record) => record.content.split(/\s+/).length,
        dependencies: ['content']      // Recompute when content changes
      },
      reading_time: {
        type: 'number',
        compute: (record) => Math.ceil(record.word_count / 200),
        dependencies: ['word_count']
      },
      full_name: {
        type: 'string',
        compute: (record) => `${record.first_name} ${record.last_name}`,
        dependencies: ['first_name', 'last_name']
      }
    },
    
    // Hidden fields (never exposed in API)
    hiddenFields: ['internal_notes', 'admin_flags'],
    
    // Search configuration
    searchSchema: {
      title: {
        type: 'string',
        operators: ['eq', 'like', 'ilike']
      },
      status: {
        type: 'string',
        operators: ['eq', 'in']
      },
      published_at: {
        type: 'datetime',
        operators: ['gt', 'gte', 'lt', 'lte']
      },
      author: {
        type: 'number',
        operators: ['eq', 'in']
      },
      view_count: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between']
      }
    },
    
    // Permissions
    permissions: {
      create: ['author', 'admin'],
      read: ['*'],
      update: ['author', 'editor', 'admin'],
      delete: ['admin']
    },
    
    // Soft delete configuration
    softDelete: {
      field: 'deleted_at',
      includeDeleted: false
    },
    
    // Custom validation
    validate: async (data, method, context) => {
      if (data.status === 'published' && !data.published_at) {
        throw new Error('Published articles must have published_at date');
      }
      
      if (method === 'post' && data.title.length < 10) {
        throw new Error('Title must be at least 10 characters');
      }
    }
  }
});
```

### Important Schema Features

#### ID Property Configuration
```javascript
// Custom primary key
api.addResource({
  name: 'users',
  idProperty: 'user_id',  // Use 'user_id' instead of 'id'
  schema: {
    attributes: {
      user_id: { type: 'number', required: true },
      email: { type: 'string', required: true }
    }
  }
});
```

#### Virtual Fields
Virtual fields are excluded from database operations but can be used for temporary UI state:

```javascript
virtualFields: ['expanded', 'selected', 'temp_calculation']

// These fields are ignored during database operations
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    expanded: true,  // Ignored in database
    selected: false  // Ignored in database
  }
});
```

#### Field Transformations
Use getters and setters for automatic data transformation:

```javascript
attributes: {
  // JSON storage
  settings: {
    type: 'object',
    getter: (value) => JSON.parse(value || '{}'),
    setter: (value) => JSON.stringify(value)
  },
  
  // Encryption
  ssn: {
    type: 'string',
    getter: (value) => decrypt(value),
    setter: (value) => encrypt(value)
  },
  
  // Unit conversion
  temperature_c: {
    type: 'number',
    getter: (value) => value,  // Store as Celsius
    setter: (value) => value
  },
  temperature_f: {
    type: 'number',
    virtual: true,
    getter: (record) => (record.temperature_c * 9/5) + 32,
    setter: (value, record) => {
      record.temperature_c = (value - 32) * 5/9;
    }
  }
}
```

---

## Error Handling

The library uses standard JSON:API error format:

### Error Response Format

```javascript
{
  errors: [
    {
      status: '422',
      code: 'VALIDATION_ERROR',
      title: 'Validation Failed',
      detail: 'The title field is required.',
      source: {
        pointer: '/data/attributes/title'
      },
      meta: {
        field: 'title',
        rule: 'required'
      }
    }
  ]
}
```

### Common Error Types

#### Validation Errors (422)
```javascript
{
  errors: [{
    status: '422',
    code: 'VALIDATION_ERROR',
    title: 'Validation Failed',
    detail: 'The email field must be a valid email address.',
    source: { pointer: '/data/attributes/email' }
  }]
}
```

#### Not Found Errors (404)
```javascript
{
  errors: [{
    status: '404',
    code: 'RESOURCE_NOT_FOUND',
    title: 'Resource Not Found',
    detail: 'Article with id 999 not found.'
  }]
}
```

#### Permission Errors (403)
```javascript
{
  errors: [{
    status: '403',
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'You do not have permission to update this article.'
  }]
}
```

#### Relationship Errors (400)
```javascript
{
  errors: [{
    status: '400',
    code: 'INVALID_RELATIONSHIP',
    title: 'Invalid Relationship',
    detail: 'Cannot set author to user 999: user does not exist.',
    source: { pointer: '/data/relationships/author' }
  }]
}
```

### Custom Error Handling

```javascript
// In hooks
api.resource('articles').hook('beforeDataPost', async (context) => {
  if (context.inputData.attributes.title.length < 10) {
    const error = new Error('Title too short');
    error.status = 422;
    error.code = 'TITLE_TOO_SHORT';
    error.pointer = '/data/attributes/title';
    throw error;
  }
});

// Custom error transformation
api.hook('errorTransform', async (error, context) => {
  return {
    status: error.status || '500',
    code: error.code || 'INTERNAL_ERROR',
    title: error.title || 'Error',
    detail: error.message,
    meta: {
      timestamp: new Date().toISOString(),
      request_id: context.requestId
    }
  };
});
```

---

## Advanced Features

### Transaction Support

All methods support database transactions with automatic management:

```javascript
// Automatic transaction (recommended)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Content...'
  }
  // No transaction provided - library creates and auto-commits
});

// Manual transaction management
const trx = await knex.transaction();
try {
  // Create article
  const article = await api.resources.articles.post({
    inputRecord: {
      title: 'New Article',
      content: 'Content...'
    },
    transaction: trx  // Provide transaction
  });
  
  // Create related comments
  for (const commentData of comments) {
    await api.resources.comments.post({
      inputRecord: {
        content: commentData.content,
        article_id: article.id
      },
      transaction: trx  // Same transaction
    });
  }
  
  await trx.commit();  // Manual commit required
} catch (error) {
  await trx.rollback();
  throw error;
}
```

**Important:** When you provide a transaction, you're responsible for committing/rolling back. When you don't provide one, the library auto-commits.

### Batch Operations

Process multiple operations efficiently:

```javascript
// Batch create with transaction
const createArticles = async (articlesData) => {
  const trx = await knex.transaction();
  const results = [];
  
  try {
    for (const data of articlesData) {
      const result = await api.resources.articles.post({
        inputRecord: data,
        transaction: trx,
        returnFullRecord: 'minimal' // Optimize for batch
      });
      results.push(result);
    }
    
    await trx.commit();
    return results;
  } catch (error) {
    await trx.rollback();
    throw error;
  }
};

// Batch update
const updateArticles = async (updates) => {
  const trx = await knex.transaction();
  
  try {
    for (const { id, data } of updates) {
      await api.resources.articles.patch({
        inputRecord: { id, ...data },
        transaction: trx,
        returnFullRecord: 'no'  // Skip return for performance
      });
    }
    
    await trx.commit();
  } catch (error) {
    await trx.rollback();
    throw error;
  }
};
```

### Computed Fields

Add dynamic fields calculated at runtime:

```javascript
// In resource schema
computedFields: {
  full_name: {
    type: 'string',
    compute: (record) => `${record.first_name} ${record.last_name}`,
    dependencies: ['first_name', 'last_name']
  },
  age: {
    type: 'number',
    compute: (record) => {
      const birthDate = new Date(record.birth_date);
      const today = new Date();
      return today.getFullYear() - birthDate.getFullYear();
    },
    dependencies: ['birth_date']
  },
  // Async computed field
  stats: {
    type: 'object',
    compute: async (record, context) => {
      return await statsService.getArticleStats(record.id);
    },
    dependencies: []
  }
}

// Request computed fields
const result = await api.resources.users.get({
  id: '1',
  queryParams: {
    fields: {
      users: 'first_name,last_name,full_name,age'
    }
  }
});
```

### Polymorphic Relationships

Support relationships to multiple resource types:

```javascript
// Schema configuration
relationships: {
  commentable: {
    polymorphic: true,
    types: ['articles', 'videos', 'photos'],
    typeField: 'commentable_type',
    idField: 'commentable_id'
  }
}

// Usage
const result = await api.resources.comments.post({
  inputRecord: {
    content: 'Great article!',
    commentable_type: 'articles',
    commentable_id: '1'
  }
});

// Query polymorphic relationships
const result = await api.resources.comments.query({
  queryParams: {
    include: ['commentable'],  // Includes the related article/video/photo
    filters: {
      commentable_type: 'articles'
    }
  }
});
```

### Soft Deletes

Implement soft deletion pattern:

```javascript
// Configure in schema
softDelete: {
  field: 'deleted_at',
  includeDeleted: false  // Default behavior
}

// Hook implementation
api.resource('articles').hook('beforeDataDelete', async (context) => {
  // Convert delete to update
  context.method = 'patch';
  context.inputData = {
    attributes: {
      deleted_at: new Date().toISOString()
    }
  };
});

// Query including soft-deleted
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      include_deleted: true
    }
  }
});

// Restore soft-deleted record
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    deleted_at: null
  }
});
```

### Field-Level Permissions

Control access to specific fields:

```javascript
// In enrichAttributes hook
api.resource('users').hook('enrichAttributes', async (context) => {
  // Hide sensitive fields for non-admin users
  if (!context.auth.isAdmin) {
    delete context.attributes.email;
    delete context.attributes.phone;
    delete context.attributes.internal_notes;
  }
  
  // Show computed permission fields
  if (context.requestedComputedFields.includes('can_edit')) {
    context.attributes.can_edit = 
      context.auth.userId === context.record.id || 
      context.auth.isAdmin;
  }
});

// In beforeSchemaValidate hook - prevent updates
api.resource('users').hook('beforeSchemaValidatePatch', async (context) => {
  // Prevent non-admins from updating certain fields
  if (!context.auth.isAdmin) {
    const restrictedFields = ['role', 'permissions', 'verified'];
    for (const field of restrictedFields) {
      if (field in context.inputData.attributes) {
        throw new Error(`Cannot update field: ${field}`);
      }
    }
  }
});
```

### Cross-Table Search

The library supports searching across related tables:

```javascript
// Using knexQueryFiltering hook
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  // Search across multiple tables
  if (filters.global_search) {
    query.leftJoin('users', 'articles.author_id', 'users.id')
         .leftJoin('categories', 'articles.category_id', 'categories.id')
         .where(function() {
           this.where('articles.title', 'like', `%${filters.global_search}%`)
               .orWhere('articles.content', 'like', `%${filters.global_search}%`)
               .orWhere('users.name', 'like', `%${filters.global_search}%`)
               .orWhere('categories.name', 'like', `%${filters.global_search}%`);
         });
  }
});
```

### Database-Specific Features

The library detects database capabilities and adjusts behavior:

```javascript
// Window functions (PostgreSQL, MySQL 8+, SQLite 3.25+)
api.resource('articles').hook('afterDataQuery', async (context) => {
  // Add ranking if database supports window functions
  if (context.db.supportsWindowFunctions) {
    // Ranking logic using ROW_NUMBER(), RANK(), etc.
  }
});

// JSON operations (PostgreSQL, MySQL 5.7+)
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  if (filters.metadata_key && context.db.supportsJsonb) {
    // PostgreSQL JSONB query
    query.whereRaw("metadata->>'key' = ?", [filters.metadata_key]);
  }
});
```