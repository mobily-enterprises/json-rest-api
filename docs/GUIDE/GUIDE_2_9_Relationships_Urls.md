# REST API Relationships Plugin Guide

The REST API Relationships Plugin adds JSON:API compliant relationship endpoints to your API, allowing clients to view and manage relationships between resources as first-class citizens. This guide shows you how to use these powerful features with our book catalog system.

## Table of Contents
- [Why Use Relationship Endpoints?](#why-use-relationship-endpoints)
- [Installation](#installation)
- [Understanding Relationship Endpoints](#understanding-relationship-endpoints)
- [Working with Relationships](#working-with-relationships)
  - [Viewing Relationship Links](#viewing-relationship-links)
  - [Fetching Related Resources](#fetching-related-resources)
  - [Adding Relationships](#adding-relationships)
  - [Replacing Relationships](#replacing-relationships)
  - [Removing Relationships](#removing-relationships)
- [Relationship Types](#relationship-types)
- [Security and Permissions](#security-and-permissions)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Why Use Relationship Endpoints?

Relationship endpoints provide several advantages:

1. **Efficient Relationship Management**: Add or remove related items without fetching and updating entire resources
2. **Clear API Navigation**: Self-documenting links show how resources connect
3. **Reduced Payload Size**: Fetch just relationship data without full resource details
4. **Atomic Operations**: Manage relationships in isolation with proper transaction support

## Installation

To use relationship endpoints, install the plugin after your core REST API setup:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';

const api = new Api();

// Core plugins first
await api.use(RestApiPlugin, {
  resourceUrlPrefix: '/api'  // Important: enables relationship links
});
await api.use(RestApiKnexPlugin, { knex });

// Define your resources as usual
await api.addResource('books', { /* schema */ });
await api.addResource('authors', { /* schema */ });
```

## Understanding Relationship Endpoints

The plugin creates two types of endpoints for each relationship:

### 1. Relationship Endpoints (Linkage)
- **URL Pattern**: `/api/{resource}/{id}/relationships/{relationshipName}`
- **Purpose**: View and manage just the linkage data (IDs and types)
- **Example**: `/api/books/1/relationships/authors`
- **Returns**: Minimal data showing which resources are connected

### 2. Related Resource Endpoints
- **URL Pattern**: `/api/{resource}/{id}/{relationshipName}`
- **Purpose**: Fetch the full related resources
- **Example**: `/api/books/1/authors`
- **Returns**: Complete resource data for all related items

## Working with Relationships

Let's explore each operation using our book catalog system.

### Setup Test Data

First, let's create some test data to work with:

```javascript
// Create a country
const usa = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});

// Create authors
const stephenKing = await api.resources.authors.post({
  name: 'Stephen King'
});

const peterStraub = await api.resources.authors.post({
  name: 'Peter Straub'
});

// Create a publisher
const scribner = await api.resources.publishers.post({
  name: 'Scribner',
  country_id: usa.id
});

// Create a book with initial relationships
const talisman = await api.resources.books.post({
  title: 'The Talisman',
  country_id: usa.id,
  publisher_id: scribner.id
}, {
  simplified: false  // Use full JSON:API format
});
```

### Viewing Relationship Links

Get just the relationship linkage data without fetching full resources:

**Programmatic:**
```javascript
const bookAuthorsRelationship = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'authors'
});

console.log(bookAuthorsRelationship);
// Output:
// {
//   data: [],  // Empty because we haven't added authors yet
//   links: {
//     self: "/api/books/1/relationships/authors",
//     related: "/api/books/1/authors"
//   }
// }
```

**HTTP:**
```bash
curl -X GET http://localhost:3000/api/books/1/relationships/authors

# Response:
# {
#   "data": [],
#   "links": {
#     "self": "/api/books/1/relationships/authors",
#     "related": "/api/books/1/authors"
#   }
# }
```

### Fetching Related Resources

Get the full related resources with all their attributes:

**Programmatic:**
```javascript
const bookAuthors = await api.resources.books.getRelated({
  id: talisman.data.id,
  relationshipName: 'authors',
  queryParams: {
    fields: { authors: 'name' }  // Optional: sparse fieldsets
  }
});

console.log(bookAuthors);
// Output:
// {
//   data: [
//     {
//       type: "authors",
//       id: "1",
//       attributes: { name: "Stephen King" }
//     }
//   ]
// }
```

**HTTP:**
```bash
curl -X GET 'http://localhost:3000/api/books/1/authors?fields[authors]=name'

# Response:
# {
#   "data": [
#     {
#       "type": "authors",
#       "id": "1",
#       "attributes": { "name": "Stephen King" }
#     }
#   ]
# }
```

### Adding Relationships

Add new relationships without replacing existing ones (only for to-many relationships):

**Programmatic:**
```javascript
// Add Stephen King and Peter Straub as authors
const addAuthorsResult = await api.resources.books.postRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: stephenKing.id },
      { type: 'authors', id: peterStraub.id }
    ]
  }
});

console.log('Authors added successfully');
```

**HTTP:**
```bash
curl -X POST http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "1" },
      { "type": "authors", "id": "2" }
    ]
  }'

# Response: 204 No Content (success)
```

### Replacing Relationships

Replace all existing relationships with a new set:

**Programmatic:**
```javascript
// Replace all authors with just Stephen King
const replaceAuthorsResult = await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: stephenKing.id }
    ]
  }
});

// For to-one relationships, you can also set to null
const removePublisher = await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher',
  inputRecord: {
    data: null
  }
});
```

**HTTP:**
```bash
# Replace all authors
curl -X PATCH http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "1" }
    ]
  }'

# Remove publisher (set to null)
curl -X PATCH http://localhost:3000/api/books/1/relationships/publisher \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": null
  }'
```

### Removing Relationships

Remove specific relationships without affecting others (only for to-many relationships):

**Programmatic:**
```javascript
// Remove Peter Straub from the book's authors
const removeAuthorResult = await api.resources.books.deleteRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: peterStraub.id }
    ]
  }
});
```

**HTTP:**
```bash
curl -X DELETE http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "2" }
    ]
  }'

# Response: 204 No Content (success)
```

## Relationship Types

The plugin handles all relationship types defined in your schema:

### belongsTo Relationships

Books belong to publishers:

```javascript
// View the publisher relationship
const bookPublisher = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher'
});
// Returns: { data: { type: "publishers", id: "1" }, links: {...} }

// Change the publisher
await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher',
  inputRecord: {
    data: { type: 'publishers', id: '2' }
  }
});
```

### hasOne Relationships

The inverse of belongsTo (automatically created):

```javascript
// If you define country → publishers (hasMany)
// Each publisher has one country (implicit hasOne)
const publisherCountry = await api.resources.publishers.getRelationship({
  id: scribner.id,
  relationshipName: 'country'
});
```

### hasMany Relationships

Publishers have many books:

```javascript
// View all books for a publisher
const publisherBooks = await api.resources.publishers.getRelated({
  id: scribner.id,
  relationshipName: 'books',
  queryParams: {
    sort: '-year',  // Sort by year descending
    filter: { inStock: true }  // Only in-stock books
  }
});
```

### Many-to-Many Relationships

Books have many authors through the book_authors pivot table:

```javascript
// This is the most flexible relationship type
// Supports POST (add), PATCH (replace), and DELETE (remove)
const bookAuthors = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'authors'
});
```

## Security and Permissions

The plugin respects your existing security setup and adds specific hooks:

```javascript
// Add permission checks for relationship operations
api.addHook('checkPermissionsGetRelationship', async ({ context }) => {
  // Check if user can view this relationship
  if (!context.auth?.userId) {
    throw new Error('Authentication required');
  }
});

api.addHook('checkPermissionsPostRelationship', async ({ context }) => {
  // Check if user can add relationships
  const { scopeName, relationshipName } = context;
  
  if (scopeName === 'books' && relationshipName === 'authors') {
    // Only editors can modify book authors
    if (context.auth?.role !== 'editor') {
      throw new Error('Only editors can modify book authors');
    }
  }
});
```

## Error Handling

Common errors you might encounter:

### Relationship Not Found
```javascript
try {
  await api.resources.books.getRelationship({
    id: '1',
    relationshipName: 'invalid'
  });
} catch (error) {
  // RestApiResourceError: Relationship 'invalid' not found on resource 'books'
}
```

### Invalid Operation
```javascript
try {
  // Can't POST to a to-one relationship
  await api.resources.books.postRelationship({
    id: '1',
    relationshipName: 'publisher',  // belongsTo is to-one
    inputRecord: { data: { type: 'publishers', id: '1' } }
  });
} catch (error) {
  // RestApiValidationError: POST operation not allowed on to-one relationship
}
```

### Resource Not Found
```javascript
try {
  await api.resources.books.getRelationship({
    id: '999',  // Non-existent book
    relationshipName: 'authors'
  });
} catch (error) {
  // RestApiResourceError: Resource not found
}
```

## Best Practices

### 1. Use Relationship Endpoints for Bulk Operations

Instead of updating each book individually to add an author:
```javascript
// ❌ Inefficient
for (const bookId of bookIds) {
  const book = await api.resources.books.get({ id: bookId });
  await api.resources.books.patch({
    id: bookId,
    inputRecord: {
      data: {
        type: 'books',
        id: bookId,
        relationships: {
          authors: {
            data: [...book.data.relationships.authors.data, newAuthor]
          }
        }
      }
    }
  });
}

// ✅ Efficient
for (const bookId of bookIds) {
  await api.resources.books.postRelationship({
    id: bookId,
    relationshipName: 'authors',
    inputRecord: {
      data: [newAuthor]
    }
  });
}
```

### 2. Use Links for API Discovery

The `links` object in responses helps clients navigate your API:
```javascript
const relationship = await api.resources.books.getRelationship({
  id: '1',
  relationshipName: 'authors'
});

console.log(relationship.links);
// {
//   self: "/api/books/1/relationships/authors",
//   related: "/api/books/1/authors"
// }

// Client can use these links directly
const fullAuthors = await fetch(relationship.links.related);
```

### 3. Choose the Right Endpoint

- **Use relationship endpoints** when you only need to manage connections
- **Use related endpoints** when you need full resource data
- **Use regular PATCH** when updating multiple aspects of a resource

### 4. Handle Transactions Properly

The plugin automatically handles transactions for data integrity:
```javascript
// This is atomic - either all authors are added or none
await api.resources.books.postRelationship({
  id: bookId,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: '1' },
      { type: 'authors', id: '2' },
      { type: 'authors', id: '3' }
    ]
  }
});
```

## Summary

The REST API Relationships Plugin transforms relationships from second-class citizens to fully manageable resources. It provides efficient, standards-compliant endpoints that make working with related data intuitive and performant. By following JSON:API specifications, it ensures your API remains consistent and predictable for clients.

Whether you're building a simple blog or a complex e-commerce system, relationship endpoints help you create cleaner, more maintainable APIs that scale with your application's needs.