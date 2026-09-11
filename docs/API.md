---
title: "API reference"
---

# JSON REST API - Complete API Reference

This reference provides comprehensive documentation for all methods, parameters, and features available in the json-rest-api library.

## Current contract

This reference describes the v2 API. See the [migration guide](GUIDE/33-migrating-to-v2.md) and
[backend limits](GUIDE/30-backend-capabilities.md) before upgrading.

Pass method controls in the first `params` object and application-owned
identity/authentication data in the optional second context object. Write data
belongs under `inputRecord`; direct attribute shorthand is not accepted.

`format: 'plain' | 'jsonapi'` selects the input/output representation.
Programmatic calls default to `plain`. POST/PUT/PATCH use
`returning: 'none' | 'minimal' | 'full'`, defaulting to `full`. Per-call options
override configured resource/plugin defaults. The built-in HTTP connectors
select JSON:API with full write responses independently of these defaults;
resource deletion and relationship mutations return no content.
Boolean representation/return aliases are removed and rejected.

On a resource configured with `versionField`, PUT/PATCH/DELETE and relationship
writes accept an `expectedVersion` string; unconditional writes may omit it.
POST does not accept that condition. See [optimistic concurrency](GUIDE/33-migrating-to-v2.md)
for version-field configuration, bulk version arrays and the separate opt-in
HTTP validator contract.

Read calls can borrow raw Knex transactions. Library writes must use the handle
from `api.transaction` when grouping operations; they reject unmanaged raw
transactions. Context is application-owned but enriched during each call, so use
a separate context for each enlisted operation. See [transaction support](#transaction-support).

## Table of Contents

1. [API setup and runtime](#api-setup-and-runtime)
2. [Core API Methods](#core-api-methods)
   - [QUERY - Retrieve Collections](#query---retrieve-collections)
   - [GET - Retrieve Single Resource](#get---retrieve-single-resource)
   - [POST - Create Resource](#post---create-resource)
   - [PUT - Replace Resource](#put---replace-resource)
   - [PATCH - Update Resource](#patch---update-resource)
   - [DELETE - Remove Resource](#delete---remove-resource)
3. [Relationship Methods](#relationship-methods)
   - [getRelated - Retrieve Related Resources](#getrelated---retrieve-related-resources)
   - [getRelationship - Retrieve Relationship Identifiers](#getrelationship---retrieve-relationship-identifiers)
   - [postRelationship - Add to Relationship](#postrelationship---add-to-relationship)
   - [patchRelationship - Replace Relationship](#patchrelationship---replace-relationship)
   - [deleteRelationship - Remove from Relationship](#deleterelationship---remove-from-relationships)
4. [Hook System](#hook-system)
   - [Complete Hook Execution Order](#complete-hook-execution-order)
   - [Hook Context Objects](#hook-context-objects)
5. [Query Features](#query-features)
   - [Filtering](#filtering)
   - [Sorting](#sorting)
   - [Pagination](#pagination)
   - [Sparse Fieldsets](#sparse-fieldsets)
   - [Including Related Resources](#including-related-resources)
6. [Configuration Options](#configuration-options)
7. [Schema Configuration](#schema-configuration)
8. [Error Handling](#error-handling)
9. [Advanced Features](#advanced-features)

---

## API setup and runtime

Import `JsonRestApi` from `json-rest-api`. Create an instance, await each plugin
installation, then register resources before accepting requests.

```js
const api = new JsonRestApi({ name: 'catalog', logger: applicationLogger })
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.addResource('books', bookOptions)
```

The [quickstart](QUICKSTART.md) supplies a complete setup with imports and schemas.
`name` and `logger` are optional. The logger accepts `trace`, `debug`, `info`,
`warn`, `error` and `fatal` methods; omitted methods are silent. Configure log
formatting and filtering in your logger. Old `log` and `logging` options reject.

| Member | Contract |
| --- | --- |
| `api.use(plugin, options?)` | Installs a named plugin after checking dependencies; resolves to the API |
| `api.addResource(name, options?)` | Registers a unique resource, runs setup hooks and resolves to that resource |
| `api.resources[name]` | The registered resource object and its methods |
| `api.customize({ hooks, methods, vars, helpers })` | Adds global hooks, shared resource methods and API defaults; resolves to the API |
| `api.runHooks(event, context?)` | Runs global handlers sequentially; resolves to `false` if one stops the list, otherwise `true` |
| `api.vars`, `api.helpers` | Defaults inherited by resource vars and helpers |

Resource options include schemas and plugin configuration, plus local `hooks`,
`methods`, `vars` and `helpers`. Resource methods receive the runtime argument
object, not positional data arguments; see [writing plugins](GUIDE/29-writing-plugins.md).
Global setup hooks run before resource-local operation hooks are registered.

Shared resource methods require their resource as the receiver. Keep calls such
as `api.resources.books.get(params, context)` intact, or bind the resource when
passing a method as a callback. Local vars/helpers override inherited defaults;
`Object.keys` lists local entries only. Shared method replacements apply to
resources without their own local override.

Await setup sequentially. Setup failure is not rolled back; discard that instance
and correct its configuration before starting again. Registration and
`customize()` do not migrate stored data or rebuild arbitrary schema mutations.

## Core API Methods

### QUERY - Retrieve Collections

Retrieves a collection of resources with support for filtering, sorting, pagination, and relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources[resourceType].query(params, context)
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
  format: String,          // 'plain' (default) or 'jsonapi'
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
| `format` | String | No | `'plain'` or `'jsonapi'`; uses the configured default when omitted |
| `transaction` | Object | No | Database transaction object |

#### Return Value

**JSON:API Mode (format: 'jsonapi'):**
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
    pagination: {
      page: 1,
      pageSize: 10,
      pageCount: 5,
      total: 50,
      hasMore: true
    }
  },
  links: {
    self: '/articles?page[number]=1',
    next: '/articles?page[number]=2',
    last: '/articles?page[number]=5'
  }
}
```

**Plain Mode (format: 'plain' - default):**
```javascript
{
  data: [
    {
      id: '1',
      title: 'First Article',
      content: 'Article content...',
      author: {
        id: '10',
        name: 'John Doe'
      }
    }
  ],
  meta: {
    pagination: {
      page: 1,
      pageSize: 10,
      pageCount: 5,
      total: 50,
      hasMore: true
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
// Get all articles (plain mode by default)
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
  format: 'jsonapi'
});

// Returns full JSON:API structure with type, id, attributes, relationships
```

**Cursor-based Pagination:**
```javascript
const firstPage = await api.resources.articles.query({
  queryParams: { page: { size: 10 } }
});
const cursor = firstPage.meta.pagination.cursor?.next;
if (cursor) {
  const nextPage = await api.resources.articles.query({
    queryParams: { page: { after: cursor, size: 10 } }
  });
}
```

---

### GET - Retrieve Single Resource

Retrieves a single resource by its ID with optional relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources[resourceType].get(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,     // Required: The unique ID of the resource
  queryParams: {
    include: Array,      // Relationship paths to include
    fields: Object       // Sparse fieldsets
  },
  format: String,          // 'plain' (default) or 'jsonapi'
  transaction: Object    // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | The unique ID of the resource |
| `queryParams` | Object | No | Query parameters |
| `queryParams.include` | Array | No | Relationship paths to include |
| `queryParams.fields` | Object | No | Sparse fieldsets for specific resource types |
| `format` | String | No | `'plain'` or `'jsonapi'`; uses the configured default when omitted |
| `transaction` | Object | No | Database transaction object |

`id` is normalized with the effective `normalizeId` function before validation and lookup. If it normalizes to an empty value, the operation fails as `REST_API_RESOURCE` with subtype `not_found`.

#### Return Value

**JSON:API Mode (format: 'jsonapi'):**
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

**Plain Mode (format: 'plain' - default):**
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
// Get article by ID (plain mode by default)
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
  format: 'jsonapi'
});

// Returns full JSON:API document structure
```

---

### POST - Create Resource

Creates a new resource with attributes and optional relationships.

#### Method Signature
```javascript
const result = await api.resources[resourceType].post(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Resource data (JSON:API or plain)
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  format: String,          // 'plain' (default) or 'jsonapi'
  transaction: Object,      // Database transaction object
  returning: String         // 'none', 'minimal' or 'full' (default)
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Resource data to create |
| `inputRecord.id` | String | No (plain) | Optional explicit logical resource ID |
| `inputRecord.data` | Object | Yes (JSON:API) | Resource data container |
| `inputRecord.data.id` | String | No (JSON:API) | Optional explicit logical resource ID |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | No | Resource attributes, subject to schema requirements/defaults |
| `inputRecord.data.relationships` | Object | No | Related resources |
| `queryParams` | Object | No | For includes/fields in response |
| `format` | String | No | `'plain'` or `'jsonapi'`; uses the configured default when omitted |
| `transaction` | Object | No | Database transaction object |
| `returning` | String | No | `'none'`, `'minimal'` or `'full'`; booleans are rejected |

When an explicit resource id is provided, `normalizeId` runs before persistence and before any follow-up record fetch used for the return payload. If the normalized id is empty, the request fails as `REST_API_VALIDATION` on `data.id`.

#### Return Value Behavior

POST/PUT/PATCH use the selected `returning` mode:

| Mode | Plain output | JSON:API output |
| --- | --- | --- |
| `none` | `undefined` | `undefined` |
| `minimal` | `{ type, id }` | `{ data: { type, id } }` |
| `full` | Resource object | Resource document |

Full responses honor requested fieldsets/includes and visibility; they do not
promise every declared field. Programmatic calls default to `full`. HTTP
connectors choose their response behavior explicitly and map no-content writes
to 204. A POST with a response body uses 201; PUT/PATCH with a body use 200.

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

**Basic Create (Plain Mode):**
```javascript
// Create article with plain input (default mode)
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
  format: 'jsonapi'
});
```

**Create with Explicit ID and Normalization:**
```javascript
// With normalizeId configured to trim and uppercase ids,
// this record is stored as ARTICLE-42
const result = await api.resources.articles.post({
  inputRecord: {
    data: {
      type: 'articles',
      id: '  article-42  ',
      attributes: {
        title: 'Canonical ID Example',
        content: 'Stored under the normalized id'
      }
    }
  },
  format: 'jsonapi'
});
```

**Create with Multiple Relationships:**
```javascript
// Create article with author and tags (plain)
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
  returning: 'minimal'
});

// Returns (plain mode):
// {
//   type: 'articles',
//   id: '123'
// }
```

**Create with No Return:**
```javascript
// Create without returning data to this programmatic caller
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...'
  },
  returning: 'none'
});

// Returns: undefined
```

---

### PUT - Replace Resource

Creates a missing target at the supplied ID or replaces a visible existing
resource. Replacement applies schema required/default/nullability rules and the
method's relationship-omission semantics. See [PUT and PATCH](GUIDE/10-put-and-patch.md).
Target visibility checks still apply.

#### Method Signature
```javascript
const result = await api.resources[resourceType].put(params, context)
```

#### Parameters

```javascript
{
  id: String|Number|BigInt, // Target ID; may instead be supplied in inputRecord
  inputRecord: Object,      // Required: Complete resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  format: String,          // 'plain' (default) or 'jsonapi'
  transaction: Object,      // Database transaction object
  returning: String         // 'none', 'minimal' or 'full' (default)
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Complete resource data |
| `id` | String\|Number\|BigInt | Conditional | Target ID; required if the input document does not supply one |
| `inputRecord.id` | String\|Number | Conditional (plain) | Target ID when top-level `id` is omitted |
| `inputRecord.data.id` | String\|Number | Conditional (JSON:API) | Target ID when top-level `id` is omitted |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | Yes (JSON:API) | All resource attributes |
| `inputRecord.data.relationships` | Object | No | All relationships (missing ones are nulled) |
| `queryParams` | Object | No | For response formatting |
| `format` | String | No | `'plain'` or `'jsonapi'`; uses the configured default when omitted |
| `transaction` | Object | No | Database transaction object |
| `returning` | String | No | `'none'`, `'minimal'` or `'full'`; booleans are rejected |

`inputRecord.id` and `inputRecord.data.id` always refer to the logical resource id. `idProperty` and storage mapping affect the backing column name, not the API field name, and the resource id is not part of `attributes`.

If both the URL id and body id are present, both are normalized before the equality check. If either id normalizes to an empty value, the operation fails before storage is touched.

#### Return Value

Returns according to `returning`: `none`, `minimal` or `full`. See the POST return-value table.

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

**Basic Replace (Plain):**
```javascript
// Replace entire article (plain mode)
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
  format: 'jsonapi'
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
const result = await api.resources[resourceType].patch(params, context)
```

#### Parameters

```javascript
{
  id: String|Number|BigInt, // Target ID; may instead be supplied in inputRecord
  inputRecord: Object,      // Required: Partial resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  format: String,          // 'plain' (default) or 'jsonapi'
  transaction: Object,      // Database transaction object
  returning: String         // 'none', 'minimal' or 'full' (default)
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Partial resource data |
| `id` | String\|Number\|BigInt | Conditional | Target ID; required if the input document does not supply one |
| `inputRecord.id` | String\|Number | Conditional (plain) | Target ID when top-level `id` is omitted |
| `inputRecord.data.id` | String\|Number | Conditional (JSON:API) | Target ID when top-level `id` is omitted |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | No | Attributes to update |
| `inputRecord.data.relationships` | Object | No | Relationships to update |
| `queryParams` | Object | No | For response formatting |
| `format` | String | No | `'plain'` or `'jsonapi'`; uses the configured default when omitted |
| `transaction` | Object | No | Database transaction object |
| `returning` | String | No | `'none'`, `'minimal'` or `'full'`; booleans are rejected |

If both the URL id and body id are present, both are normalized before the equality check. If either id normalizes to an empty value, the operation fails before storage is touched.

#### Return Value

Returns according to `returning`: `none`, `minimal` or `full`. See the POST return-value table.

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

**Basic Update (Plain):**
```javascript
// Update only the status (plain mode)
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
  format: 'jsonapi'
});
```

**Update Relationships Only:**
```javascript
// Change author and add tags (plain)
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
const result = await api.resources[resourceType].delete(params, context)
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

`id` is normalized with the effective `normalizeId` function before validation and lookup. If it normalizes to an empty value, the operation fails as `REST_API_RESOURCE` with subtype `not_found`.

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
await api.transaction(async transaction => {
  // Delete article
  await api.resources.articles.delete({
    id: '1',
    transaction
  });
  
  // Delete related comments
  await api.resources.comments.delete({
    id: '10',
    transaction
  });
  
});
```

**Note on Transaction Auto-commit:**
Writes without a transaction own their completion. To compose writes, pass the
handle supplied by `api.transaction`; the helper awaits the callback, commits and
then runs completion hooks, or rolls back when the unit fails. Raw transactions and
savepoints cannot own library writes.

---

## Relationship Methods

### getRelated - Retrieve Related Resources

Retrieves the actual related resources with full data, not just identifiers.

#### Method Signature
```javascript
const result = await api.resources[resourceType].getRelated(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  format: String,             // plain or jsonapi
  queryParams: Object,         // Selection; collection filters/sort/page for to-many
  transaction: Object          // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | Parent resource ID |
| `relationshipName` | String | Yes | Name of the relationship |
| `format` | String | No | plain or jsonapi; uses the configured default |
| `queryParams` | Object | No | Selection options; collection filters/sort/page only for to-many |
| `transaction` | Object | No | Database transaction object |

`id` is normalized with the effective `normalizeId` function before validation and lookup. If it normalizes to an empty value, the operation fails as `REST_API_RESOURCE` with subtype `not_found`.

#### Return Value

Uses the selected `format` (default `plain`). A to-one relationship returns one
resource or null; a to-many relationship returns a collection envelope. JSON:API
wraps either cardinality under `data`. Collection filters/sort/page apply to
to-many related resources; to-one reads accept selection options.

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

// Returns single resource (plain mode by default):
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
const result = await api.resources[resourceType].getRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  transaction: Object          // Database transaction object
}
```

`id` is normalized with the effective `normalizeId` function before validation and lookup. If it normalizes to an empty value, the operation fails as `REST_API_RESOURCE` with subtype `not_found`.

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
const result = await api.resources[resourceType].postRelationship(params, context)
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

The parent `id` is normalized with the parent resource's normalizer. Each `relationshipData[*].id` is normalized with the related target resource's normalizer before validation and persistence.

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

If `normalizeId` is configured, both the parent id and each relationship identifier are normalized before the relationship is written.

---

### patchRelationship - Replace Relationship

Completely replaces a relationship. For to-one relationships, sets the new related resource. For to-many relationships, replaces all members.

#### Method Signature
```javascript
const result = await api.resources[resourceType].patchRelationship(params, context)
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

The parent `id` is normalized with the parent resource's normalizer. Each relationship identifier inside `relationshipData` is normalized with the related target resource's normalizer before validation and persistence.

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
const result = await api.resources[resourceType].deleteRelationship(params, context)
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

The parent `id` is normalized with the parent resource's normalizer. Each `relationshipData[*].id` is normalized with the related target resource's normalizer before validation and persistence.

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

Register hooks with `api.customize({ hooks })`, or with a resource's `extras`
when declaring it. Handlers receive an injected argument object containing
`context`; they do not receive that context as the entire first argument.
The library does not provide the `api.resource(...).hook(...)` API used by older
examples in this reference.

```javascript
await api.customize({
  hooks: {
    beforeSchemaValidatePost: {
      functionName: 'trim-article-title',
      handler: ({ context }) => {
        if (context.scopeName !== 'articles') return;
        const attributes = context.inputRecord.data.attributes;
        if (typeof attributes?.title === 'string') attributes.title = attributes.title.trim();
      }
    }
  }
});
```

### Complete Hook Execution Order

POST, PUT and PATCH retain their method-specific behavior within this sequence:

1. Set up the transaction and response options; run `beforeProcessing`, then the
   method-specific processing hook.
2. Validate the request/relationships and perform the method's existence checks.
   Run `beforeSchemaValidate`, then its method-specific hook; validate attributes;
   run method-specific `afterSchemaValidate`, then `afterSchemaValidate`.
3. Authorize the write; run `beforeDataCall`, then its method-specific hook.
4. Lock the required records, apply setters and perform the storage operation.
5. Run method-specific `afterDataCall`, then `afterDataCall`; update relationships
   and refresh minimal stored data.
6. Prepare the selected response; run `finish`, then its method-specific hook.
7. An owning operation commits and awaits `afterCommit`. Managed participants
   defer completion to their owner.

`returning: 'full'` performs a nested GET during response preparation. Its GET
hooks observe `method: 'get'`, while outer write hooks retain their write method.
The nested read keeps authentication and transaction identity. None/minimal
responses do not imply that validation, setters or finish hooks are skipped.

GET and QUERY run `beforeData` and their method-specific hook before reading.
They run enrichment and finish hooks over the internal JSON:API record before
final output conversion. GET additionally runs data-permission checks and
`enrichRecordWithRelationships`. DELETE and relationship writes have their own
sequences; use the [hook and lifecycle guide](GUIDE/13-hooks-and-lifecycle.md)
for those contracts rather than extrapolating POST's stages.

### Hook Context Objects

Context availability is stage-specific:

| Stage | Fields and use |
| --- | --- |
| Write processing/schema validation | `method`, `scopeName`, `inputRecord`, `format`, `returning`, `queryParams`, `schemaInfo`, `transaction`, `db`; plain input has been converted to an internal JSON:API `inputRecord`. Modify `inputRecord.data.attributes` before validation when preparing input. |
| After attribute validation | `inputRecord.data.attributes` contains validated values; setters run later. `originalInputAttributes` retains the pre-validation attribute snapshot. |
| After storage write | POST has assigned its storage ID; after-data hooks see transformed input attributes. Method-specific PUT/PATCH behavior remains visible. |
| Read enrichment/finish | `record` is the internal JSON:API document. Final normalization/field filtering and plain conversion happen after finish. |
| Write finish | `responseRecord` holds the selected output; minimal stored data is separately available. A full response may already have run nested GET hooks. |
| Completion | `afterCommit` follows acknowledged commit; `afterRollback` follows acknowledged rollback. A managed participant finishes its data work before its owner's completion hooks. |

Application authentication is not defined by the library. Pass trusted
application context from the caller/transport; do not infer it from payload data.
Use [row policies](GUIDE/17-row-policies.md) for mandatory row visibility.
Do not treat a single GET permission hook as a universal query/relationship guard.

An ordinary failure stops later stages. A post-commit failure cannot undo the
write; unknown outcomes require reconciliation. Original and secondary diagnostics
remain subject to the [transaction/error contract](#transaction-support).

#### knexQueryFiltering

Query customization operates on native builders with explicit storage mapping.
Use the [query hook migration contract](GUIDE/33-migrating-to-v2.md#native-query-builders-and-explicit-custom-filter-translation)
for aliases, logical/physical fields and canonical tenant/resource scoping.
Keep mandatory predicates in the supported policy/filtering mechanisms. A raw
query fragment is not automatically translated or made tenant-safe.

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

Name filters explicitly in `searchSchema`, selecting the underlying field and
operator. Field type names and `filterOperator` values follow their actual
contracts; an arbitrary `operators` array does not register filter aliases.

```javascript
searchSchema: {
  publishedAfter: { type: 'dateTime', actualField: 'published_at', filterOperator: '>=' },
  titleContains: { type: 'string', actualField: 'title', filterOperator: 'contains' },
  above: { type: 'number', actualField: 'view_count', filterOperator: '>' },
  articleIds: { type: 'array', actualField: 'id', filterOperator: 'in' }
}
```

With those declarations:

```javascript
const result = await api.resources.articles.query({
  queryParams: { filters: { titleContains: 'javascript', above: 100 } }
});
```

#### Array Filters (IN operator)

```javascript
const result = await api.resources.articles.query({
  queryParams: { filters: { articleIds: ['1', '2', '3'] } }
});
```

Use the [structured-query transport contract](GUIDE/33-migrating-to-v2.md) when
encoding non-scalar filter values for HTTP. Declared field equality/search
capabilities and mandatory row policies still apply.

#### Custom Filter Logic

Declare custom filters in the resource's `searchSchema`. `applyFilter` receives
the native builder, validated filter input and explicit mapping helpers:

```javascript
searchSchema: {
  minimumRank: {
    type: 'number',
    applyFilter(query, input, { column, value }) {
      query.where(column('rank'), '>=', value('rank', input));
    }
  }
}
```

Here `rank` must be a declared stored field. Mapping helpers resolve the active
alias and storage representation in either storage mode. Callbacks run
synchronously and must mutate the supplied builder. Raw SQL and extra joins
remain responsible for their own physical columns and visibility semantics.
See [custom-filter migration](GUIDE/33-migrating-to-v2.md#native-query-builders-and-explicit-custom-filter-translation).

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

| `queryParams.page` | Behavior |
| --- | --- |
| Omitted or `{}` | Capped default limit, no pagination metadata |
| `{ number: 2, size: 20 }` | Offset page 2 |
| `{ size: 20 }` | First cursor page |
| `{ after: cursor, size: 20 }` | Forward cursor page |
| `{ before: cursor, size: 20 }` | Backward cursor page |

Use one of `number`, `after` or `before`. Sizes/numbers must be positive integers;
empty or malformed cursors reject. Treat cursors as opaque and follow generated
links to preserve the resource, selection, filters, sort and effective size.
Do not construct base64 cursor payloads yourself.

#### Offset Pagination

```javascript
const result = await api.resources.articles.query({
  queryParams: { page: { number: 2, size: 20 } }
});
// With counts enabled and 150 matching records:
// result.meta.pagination = { page: 2, pageSize: 20, pageCount: 8, total: 150, hasMore: true }
```

Pagination metadata is under `meta.pagination`. With counts disabled, it includes
`page` and `pageSize`, without
promising totals or `hasMore`. The library supplies pagination links appropriate
to the available count/boundary information.

#### Cursor Pagination

```javascript
const firstPage = await api.resources.articles.query({
  queryParams: { page: { size: 20 } }
});
// Follow firstPage.links.next through the HTTP client, or use the returned
// cursor with the same query configuration for a programmatic next-page call.
```

Cursor pages use an extra row for `hasMore`; they never issue an offset count
query. See [pagination and ordering](GUIDE/09-pagination-and-sorting.md)
for cursor metadata, link traversal and ordering guarantees.

#### Pagination Configuration

```javascript
await api.use(RestApiPlugin, {
  queryDefaultLimit: 20,
  queryMaxLimit: 100,
  enablePaginationCounts: true
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

An unknown field raises `RestApiFieldsetError` with the stable code
`REST_API_FIELDSET_INVALID` and HTTP status `400`. The same error is preserved
for primary resources and included relationships, so transports can classify it
without parsing error messages.

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

Use target-resource policies and supported query/filter configuration to control
which related records are visible. Filtering `included` after fetching does not
remove corresponding linkage, authorize the target rows, or establish correct
per-parent limits. The library does not provide an `afterDataQuery` hook for that
purpose. See [row policies](GUIDE/17-row-policies.md),
[include configuration](GUIDE/33-migrating-to-v2.md#include-configuration-is-validated-before-publication)
and the query hook contract above.

## Configuration Options

### Plugin Configuration

```javascript
await api.use(RestApiPlugin, {
  format: 'plain',
  returning: 'full',
  queryDefaultLimit: 20,
  queryMaxLimit: 100,
  includeDepthLimit: 3,
  enablePaginationCounts: true,
  normalizeId: value => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized ? normalized.toUpperCase() : null;
  }
});
```

---

## Schema Configuration

### Resource Schema Structure

Pass the resource name separately from its options. `schema` is the field map;
relationships and search configuration are sibling resource options.

```javascript
await api.addResource('articles', {
  tableName: 'articles',
  sortableFields: ['id', 'title'],
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 200, search: true },
    content: { type: 'string', required: true },
    published_at: { type: 'dateTime', nullable: true },
    metadata: { type: 'object', nullable: true },
    internal_notes: { type: 'string', hidden: true },
    preview: { type: 'boolean', virtual: true },
    word_count: {
      type: 'number', computed: true, dependencies: ['content'],
      compute: ({ attributes }) => attributes.content.trim().split(/\s+/).filter(Boolean).length
    }
  },
  searchSchema: {
    titleContains: { type: 'string', actualField: 'title', filterOperator: 'contains' }
  }
});
await api.resources.articles.createKnexTable();
```

Stored belongs-to fields declare `belongsTo: 'users'` and `as: 'author'` on their
schema field. Reverse and many-to-many relationships live in the sibling
`relationships` map, for example `{ type: 'hasMany', target: 'comments',
foreignKey: 'article_id' }`. A many-to-many definition specifies `target`,
`through`, `foreignKey` and `otherKey`; register its target and pivot resources.
Use the [relationship guides](GUIDE/02-resources-and-relationships.md) for complete
related declarations, nullability and cardinality rules.

Schema compilation snapshots declarations. Install enrichment hooks before
registration; changing an earlier declaration object does not recompile a live
resource. See [schema compilation](GUIDE/33-migrating-to-v2.md#schema-compilation-snapshots-declarations)
and [table/schema helper contracts](GUIDE/21-schema-and-migrations.md).

### Important Schema Features

#### ID Property Configuration
```javascript
// Physical primary key column: user_id
await api.addResource('users', {
  idProperty: 'user_id',
  schema: {
    id: { type: 'id', required: true, storage: { column: 'user_id' } },
    email: { type: 'string', required: true },
    displayName: { type: 'string' }
  }
});
```

`idProperty` names the physical primary-key column for table-backed resources. At the API layer, the resource id remains `id`, so writes use `inputRecord.id` or `inputRecord.data.id`, reads return `id` or `data.id`, and the resource id is not part of `attributes`.

#### Resource ID Normalization

`normalizeId` canonicalizes resource identifiers before the library reads, writes, validates, or links records.

The default normalizer:

- trims surrounding whitespace from strings
- converts finite numbers and bigints to strings
- rejects values that normalize to an empty identifier

Provide a custom normalizer when your ids need additional canonicalization:

```javascript
await api.use(RestApiPlugin, {
  normalizeId: (value) => {
    if (value === null || value === undefined) {
      return null
    }

    const normalized = String(value).trim()
    return normalized ? normalized.toUpperCase() : null
  }
});
```

Resource-level overrides take precedence over the plugin-level default:

```javascript
await api.addResource('countries', {
  normalizeId: (value) => {
    if (value === null || value === undefined) {
      return null
    }

    const normalized = String(value).trim()
    return normalized ? normalized.toLowerCase() : null
  },
  schema: {
    name: { type: 'string', required: true }
  }
});
```

Normalization is applied to:

- parent ids used by `get`, `put`, `patch`, `delete`, `getRelated`, and `getRelationship`
- explicit `POST`, `PUT`, and `PATCH` document ids
- relationship identifiers used by `postRelationship`, `patchRelationship`, and `deleteRelationship`

Relationship identifiers use the normalizer of the related target resource, not the parent resource.

If an id normalizes to an empty value:

- existing-resource operations fail as `REST_API_RESOURCE` with subtype `not_found`
- explicit `POST` document ids fail as `REST_API_VALIDATION` on `data.id`

#### Storage Column Naming

Table-backed resources use snake_case physical columns by default. For example, `displayName` maps to `display_name`.

Use `storage.column` when a field needs a specific column name:

```javascript
await api.addResource('profiles', {
  schema: {
    id: { type: 'id' },
    displayName: { type: 'string', required: true },
    legacyRef: { type: 'string', storage: { column: 'legacy_profile_ref' } }
  }
});
```

If physical columns should match logical field names exactly for an entire resource, use `storage: { naming: 'exact' }`.

#### Virtual Fields

Mark an individual schema field with `virtual: true`, for example
`preview: { type: 'boolean', virtual: true }`. It is validated but omitted from
database writes; it is not a persisted UI-state field. Use a setter when a
virtual input needs to prepare other stored attributes. A `virtualFields` array
is not the resource declaration contract. See [virtual-field behavior](GUIDE/12-field-transformations.md).

#### Field Transformations

Getters and setters receive a value and an injected context. Computed fields
receive the context object with `attributes`, not a bare record positional
argument. Declare dependencies when another field's value is needed.

```javascript
schema: {
  temperature_c: { type: 'number' },
  temperature_f: {
    type: 'number', computed: true, dependencies: ['temperature_c'],
    compute: ({ attributes }) => attributes.temperature_c * 9 / 5 + 32
  },
  settings: { type: 'object', nullable: true }
}
```

Object/array storage already serializes and decodes JSON; do not add
JSON.stringify/JSON.parse callbacks solely to duplicate that conversion.
Use a synchronous `storage.serialize` when writes and filter comparisons need
a custom storage representation. Getters/setters may be asynchronous; their
failures propagate under the documented error contract. See
[field transformations](GUIDE/12-field-transformations.md) and
[serializer migration](GUIDE/33-migrating-to-v2.md#temporal-values-and-storage-serializers).

## Error Handling

The library uses standard JSON:API error format:

### Error Response Format

HTTP connectors return JSON:API `errors` arrays. Fields depend on the mapped
error; a programmatic error's `code` is not copied into every HTTP error object.
For example, a resource not-found error maps to:

```javascript
{
  errors: [{ status: '404', title: 'Not Found', detail: 'Article not found' }]
}
```

### Common Error Types

| Programmatic error/code | Default HTTP status |
| --- | --- |
| `RestApiValidationError` / `REST_API_VALIDATION` | 422 |
| `RestApiResourceError`, subtype `not_found` | 404 |
| `RestApiResourceError`, subtype `forbidden` | 403 |
| `RestApiResourceError`, subtype `conflict` | 409 |
| Other resource/relationship subtypes | 400 |
| `RestApiPayloadError` | 400, or 413 for a size rejection |
| `REST_API_FIELDSET_INVALID`, `REST_API_INCLUDE_INVALID` | 400 |
| `REST_API_VERSION_CONFLICT` | 409 |
| `REST_API_PRECONDITION_FAILED` | 412 |
| Unexpected or temporal output failure | 500 |

Validation violations produce individual HTTP errors with their message and
field location; generic validation errors retain their available details.
Relationship validation/access failures follow their actual typed classification,
not a universal `INVALID_RELATIONSHIP` code. Write errors additionally carry
transaction outcome metadata as described below.

### Custom Error Handling

Typed API errors thrown by getters, setters, computed fields, file detectors, or upload adapters retain their original code and details. For example, throwing `new RestApiResourceError('Upload forbidden', { subtype: 'forbidden' })` from an upload adapter produces a 403 response and still runs temporary-file cleanup.

Unexpected setter/getter/computed failures reject the operation with their
original `cause` and `context: { scopeName, fieldName, phase }`; on writes, this
diagnostic error is the outer `RestApiWriteError`'s cause. HTTP connectors
return 500. Getters no longer retain an untransformed value after failure, and
computed fields no longer substitute null. Use `RestApiValidationError` for
intentional validation rejection (422). Full write-response enrichment fails
before owned commit; borrowed transactions remain the owner's responsibility.
See the [callback migration guide](GUIDE/33-migrating-to-v2.md#setter-getter-and-computed-field-failures)
for examples and intentional fallback handling.

Resource, relationship, bulk and canonical registry write failures use the root
export `RestApiWriteError`. Its immutable `transactionOutcome` is `none`,
`pending`, `committed`, `rolledBack` or `unknown`. Its `cause` preserves the
original thrown value, including frozen errors, while classification fields
such as `code`, `subtype` and `details` remain directly readable. Read errors
retain their existing contract.

HTTP JSON:API write errors include `meta.transactionOutcome`; non-atomic bulk
entries include `error.transactionOutcome`. A failed call can represent a
committed write when a later hook rejects. Retrying that call can duplicate its
effects; neither an HTTP status nor an unknown outcome authorizes automatic
replay. See the [transaction migration guide](GUIDE/33-migrating-to-v2.md#transactions-and-errors)
for all five meanings and cause-chain handling. If acknowledgement is lost,
`unknown` requires application reconciliation before replay or file deletion;
see [commit uncertainty](GUIDE/20-transaction-outcomes.md#when-commit-acknowledgement-is-lost).
Consumer migration remains separate.

```javascript
import { RestApiValidationError } from 'json-rest-api';

await api.customize({
  hooks: {
    beforeSchemaValidatePost: {
      functionName: 'validate-article-title',
      handler: ({ context }) => {
        if (context.scopeName !== 'articles') return;
        const title = context.inputRecord.data.attributes?.title;
        if (typeof title === 'string' && title.length < 10) {
          throw new RestApiValidationError('Title too short', { fields: ['title'] });
        }
      }
    }
  }
});
```

For HTTP customization use the documented transport response/error hooks.
There is no library-wide `api.hook('errorTransform', ...)` API. Preserve typed
error classification, original causes and write outcomes when customizing output.

---

## Advanced Features

### Transaction Support

`api.transaction(callback, context = {})` owns one top-level transaction and
awaits completion hooks before returning the callback value unchanged. The
callback receives a real Knex transaction for library operations and raw SQL.
Await every operation and use a separate context object per enlisted operation.

```javascript
// Automatic transaction (recommended)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Content...'
  }
  // No transaction provided - library creates and auto-commits
});

// Several writes in one managed unit
const article = await api.transaction(async transaction => {
  // Create article
  const article = await api.resources.articles.post({
    inputRecord: {
      title: 'New Article',
      content: 'Content...'
    },
    format: 'plain',
    transaction
  });
  
  // Create related comments
  for (const commentData of comments) {
    await api.resources.comments.post({
      inputRecord: {
        content: commentData.content,
        article_id: article.id
      },
      format: 'plain',
      transaction
    });
  }
  
  return article;
});
```

Return normally to commit; throw to roll back. A caught participating write or
observed SQL failure still aborts the unit. Do not call `commit()` or `rollback()`
inside the callback. Another `api.transaction()` call creates an independent
top-level unit; compose work by forwarding the existing handle. Raw Knex
transactions remain available for direct SQL and read-only API calls.

See the [managed contract](GUIDE/19-managed-transactions.md)
and [migration guide](GUIDE/33-migrating-to-v2.md#transactions-and-errors).

### Knex Schema Helpers

When a resource is backed by `RestApiKnexPlugin`, its scope also exposes table-management helpers:

```javascript
await api.resources.articles.createKnexTable()

const snapshot = await api.resources.articles.introspectKnexTableSnapshot()
const createMigration = await api.resources.articles.generateKnexMigration()
const diff = await api.resources.articles.generateKnexMigrationDiff()
```

Available helpers:

- `createKnexTable()`
- `addKnexFields({ fields })`
- `alterKnexFields({ fields })`
- `introspectKnexTableSnapshot()`
- `generateKnexMigration()`
- `generateKnexMigrationDiff()`

`generateKnexMigrationDiff()` returns:

```javascript
{
  migration,
  warnings,
  plan
}
```

Important boundaries:

- this is a live-table snapshot diff, not migration-history reconstruction
- `addKnexFields()` and `alterKnexFields()` are field-only helpers
- indexes, foreign keys, and check constraints belong on the full table schema surface

For full examples and dialect notes, see [Knex Schema and Migrations](GUIDE/21-schema-and-migrations.md).

### Batch Operations

Process multiple operations efficiently:

```javascript
// Batch create with transaction
const createArticles = async (articlesData) => {
  return api.transaction(async transaction => {
    const results = [];
    for (const data of articlesData) {
      const result = await api.resources.articles.post({
        inputRecord: data,
        transaction,
        format: 'plain',
        returning: 'minimal'
      });
      results.push(result);
    }
    
    return results;
  });
};

// Batch update
const updateArticles = async (updates) => {
  return api.transaction(async transaction => {
    for (const { id, data } of updates) {
      await api.resources.articles.patch({
        id,
        inputRecord: data,
        transaction,
        format: 'plain',
        returning: 'none'
      });
    }
    
  });
};
```

### Computed Fields

Declare computed fields in `schema`, with `computed: true`, `dependencies` and
`compute: ({ id, attributes, context }) => value`. Computed values are not stored
columns. Callbacks can return promises; requested fieldsets determine which
computed values and their dependencies are evaluated. Dependencies establish
read preparation/order, not a persistent reactive cache.

The resource schema example above declares `word_count`. Request it through
`queryParams.fields`, for example `{ articles: 'title,word_count' }`. See
[field transformations](GUIDE/12-field-transformations.md) for hidden
dependencies, getter ordering and callback context.

### Polymorphic Relationships

Declare a polymorphic belongs-to relationship under the resource's sibling
`relationships` option:

```javascript
relationships: {
  commentable: {
    belongsToPolymorphic: {
      types: ['articles', 'videos', 'photos'],
      typeField: 'commentable_type',
      idField: 'commentable_id'
    }
  }
}
```

For a JSON:API write, send the selected target as relationship linkage,
for example `relationships: { commentable: { data: { type: 'articles', id: '1' } } }`
inside the document's `data`. The target type must be declared and the referenced
record must satisfy visibility/validation rules. Reverse polymorphic relationships
use their declared `via` relationship. See the [polymorphic guide](GUIDE/07-polymorphic-relationships.md)
for complete schemas and reverse declarations.

### Soft Deletes

Soft deletion is an application policy, not a built-in `softDelete` resource
option. Declare a nullable timestamp/marker and explicitly PATCH it when archiving.
Changing `context.method` during DELETE does not change the executing method into
PATCH. Apply a row policy for normal visibility and design a separate authorized
restore path; an arbitrary `include_deleted` filter does not enable bypassing that
policy. See [row policies](GUIDE/17-row-policies.md) and the transaction
contract when archiving must update related records.

### Field-Level Permissions

Declare `hidden` or `normallyHidden` output fields according to their intended
visibility. Output omission is not write authorization. Use trusted application
context and the appropriate validation/permission hook to reject unauthorized
attribute changes before storage. Global customizations must restrict themselves
to the intended `context.scopeName`; write attributes at schema-validation stages
are in `context.inputRecord.data.attributes`.

See [field transformations and visibility](GUIDE/12-field-transformations.md)
and [row policies](GUIDE/17-row-policies.md). Computed values must obey the
selected fieldset and the application's authorization rules too.

### Cross-Table Search

Prefer declared cross-resource search paths so the library can prepare aliases
and apply target-resource visibility. A native join in a custom filtering hook
does not automatically gain those permission checks. Custom SQL must use the
active `context.knexQuery` builder/alias and explicit storage mappings, with
bindings for values. See [native query builders](GUIDE/33-migrating-to-v2.md#native-query-builders-and-explicit-custom-filter-translation)
and [query projections](GUIDE/15-query-projections.md).

### Database-Specific Features

Both Knex plugins expose the detected window-function capability as
`api.knex.capabilities.windowFunctions`. Per-parent include limits require that
capability; the library rejects those limits when detection reports no support.
The operation's `context.db` is a Knex connection or transaction. It does not
provide `supportsWindowFunctions` or `supportsJsonb` flags.

Use declared scalar JSON-key query fields for structured-value filtering,
sorting and cursors. Whole object/array fields are not generic query keys;
custom raw SQL remains specific to its actual driver and physical storage.
See the [query projection guide](GUIDE/15-query-projections.md) and
[backend capabilities](GUIDE/30-backend-capabilities.md) for supported
operations, tests and limitations. A dialect branch in a helper is not evidence
that every server version or storage combination has been verified.
