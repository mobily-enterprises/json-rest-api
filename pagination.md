# Pagination Guide

This guide covers all pagination features available in the JSON REST API framework, including offset-based pagination, cursor-based pagination, and JSON:API compliant responses.

## Table of Contents

1. [Overview](#overview)
2. [Basic Setup](#basic-setup)
3. [Offset-Based Pagination](#offset-based-pagination)
4. [Cursor-Based Pagination](#cursor-based-pagination)
5. [Pagination Metadata](#pagination-metadata)
6. [Navigation Links](#navigation-links)
7. [Self Links](#self-links)
8. [Configuration Options](#configuration-options)
9. [Combining with Other Features](#combining-with-other-features)
10. [Performance Considerations](#performance-considerations)

## Overview

The pagination system provides:
- **Offset-based pagination** - Traditional page number/size pagination
- **Cursor-based pagination** - Efficient "load more" functionality
- **JSON:API compliance** - Full compliance with pagination metadata and links
- **Self links** - Automatic self links for all resources
- **Configurable counts** - Optional total count queries

## Basic Setup

First, let's set up a simple API with two resources to demonstrate pagination:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api/plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from 'json-rest-api/plugins/core/rest-api-knex-plugin.js';

// Create API with pagination configuration
const api = new Api({
  name: 'my-api'
});

await api.use(RestApiPlugin, {
  queryDefaultLimit: 10,      // Default page size
  queryMaxLimit: 100,         // Maximum allowed page size
  resourceUrlPrefix: 'https://api.example.com/v1',  // For self links
  enablePaginationCounts: true  // Enable count queries (default: true)
});

await api.use(RestApiKnexPlugin, { knex });

// Define resources
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    code: { type: 'string', required: true }
  }
});

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' }
  }
});
```

## Offset-Based Pagination

Traditional pagination using page numbers and size.

### Basic Usage

```javascript
// Get page 2 with 5 items per page
const result = await api.resources.books.query({
  queryParams: {
    page: { 
      number: 2,   // Page number (1-indexed)
      size: 5      // Items per page
    }
  }
});
```

### Response Structure

```json
{
  "data": [
    {
      "type": "books",
      "id": "6",
      "attributes": {
        "title": "Book 6",
        "country_id": 1
      },
      "relationships": {
        "country": {
          "data": { "type": "countries", "id": "1" }
        }
      },
      "links": {
        "self": "https://api.example.com/v1/books/6"
      }
    },
    "... 4 more books ..."
  ],
  "meta": {
    "pagination": {
      "page": 2,
      "pageSize": 5,
      "pageCount": 4,
      "total": 20,
      "hasMore": true
    }
  },
  "links": {
    "self": "https://api.example.com/v1/books?page[number]=2&page[size]=5",
    "first": "https://api.example.com/v1/books?page[number]=1&page[size]=5",
    "prev": "https://api.example.com/v1/books?page[number]=1&page[size]=5",
    "next": "https://api.example.com/v1/books?page[number]=3&page[size]=5",
    "last": "https://api.example.com/v1/books?page[number]=4&page[size]=5"
  }
}
```

## Cursor-Based Pagination

Efficient pagination for "load more" functionality, especially useful for real-time data.

### Basic Usage

```javascript
// Initial request
const firstPage = await api.resources.books.query({
  queryParams: {
    page: { size: 5 },
    sort: ['-id']  // Sort by ID descending
  }
});

// Get the cursor from the response
const nextCursor = firstPage.meta.pagination.cursor.next;

// Load next page using cursor
const secondPage = await api.resources.books.query({
  queryParams: {
    page: { 
      size: 5,
      after: nextCursor
    },
    sort: ['-id']
  }
});
```

### Response Structure

```json
{
  "data": ["... books ..."],
  "meta": {
    "pagination": {
      "pageSize": 5,
      "hasMore": true,
      "cursor": {
        "next": "eyJpZCI6MTB9"  // Base64 encoded cursor
      }
    }
  },
  "links": {
    "self": "https://api.example.com/v1/books?page[size]=5&sort=-id",
    "first": "https://api.example.com/v1/books?page[size]=5&sort=-id",
    "next": "https://api.example.com/v1/books?page[size]=5&sort=-id&page[after]=eyJpZCI6MTB9"
  }
}
```

### How Cursors Work

Cursors are Base64-encoded JSON objects containing the sort field values of the last record:

```javascript
// Cursor for record with id=10
const cursor = "eyJpZCI6MTB9";

// Decoded:
// {"id": 10}
```

This allows efficient pagination by using WHERE clauses instead of OFFSET.

## Pagination Metadata

All paginated responses include metadata in the `meta.pagination` object:

### With Count Queries Enabled (default)

```json
{
  "meta": {
    "pagination": {
      "page": 2,          // Current page (offset-based only)
      "pageSize": 10,     // Items per page
      "pageCount": 5,     // Total number of pages
      "total": 50,        // Total number of items
      "hasMore": true     // Whether more pages exist
    }
  }
}
```

### With Count Queries Disabled

```json
{
  "meta": {
    "pagination": {
      "page": 2,
      "pageSize": 10
      // No total, pageCount, or hasMore
    }
  }
}
```

## Navigation Links

The `links` object provides URLs for pagination navigation:

### Offset-Based Navigation

- `self` - Current page URL
- `first` - First page URL
- `last` - Last page URL (only with counts enabled)
- `prev` - Previous page URL (omitted on first page)
- `next` - Next page URL (omitted on last page)

### Cursor-Based Navigation

- `self` - Current page URL
- `first` - First page URL (without cursor)
- `next` - Next page URL with cursor (omitted when no more data)

## Self Links

When `resourceUrlPrefix` is configured, all resources automatically get self links:

```json
{
  "data": {
    "type": "books",
    "id": "1",
    "attributes": { "title": "Book 1" },
    "links": {
      "self": "https://api.example.com/v1/books/1"
    }
  }
}
```

This works for:
- Individual resources (GET /books/1)
- Collection resources (GET /books)
- Included resources (GET /books?include=country)

## Configuration Options

### API-Level Configuration

```javascript
await api.use(RestApiPlugin, {
  // Pagination defaults
  queryDefaultLimit: 10,        // Default page size when not specified
  queryMaxLimit: 100,          // Maximum allowed page size
  
  // URL configuration
  resourceUrlPrefix: 'https://api.example.com/v1',  // Base URL for self links
  
  // Performance options
  enablePaginationCounts: true  // Enable/disable count queries
});
```

### Resource-Level Configuration

```javascript
await api.addResource('books', {
  // ... schema ...
  vars: {
    queryDefaultLimit: 20,      // Override default for this resource
    queryMaxLimit: 50,          // Override max for this resource
    enablePaginationCounts: false  // Disable counts for this resource
  }
});
```

## Combining with Other Features

Pagination works seamlessly with other query features:

### With Filtering

```javascript
const result = await api.resources.books.query({
  queryParams: {
    page: { number: 1, size: 10 },
    filters: {
      country_id: 1
    }
  }
});
```

### With Sorting

```javascript
const result = await api.resources.books.query({
  queryParams: {
    page: { size: 10 },
    sort: ['-title', 'id']  // Sort by title DESC, then id ASC
  }
});
```

### With Includes

```javascript
const result = await api.resources.books.query({
  queryParams: {
    page: { number: 1, size: 10 },
    include: ['country'],
    filters: { country_id: 1 }
  }
});
```

### With Sparse Fieldsets

```javascript
const result = await api.resources.books.query({
  queryParams: {
    page: { number: 1, size: 10 },
    fields: {
      books: ['title'],
      countries: ['name']
    },
    include: ['country']
  }
});
```

## Performance Considerations

### Count Query Performance

Count queries can be expensive on large tables. You can disable them:

```javascript
// Disable globally
await api.use(RestApiPlugin, {
  enablePaginationCounts: false
});

// Or per resource
api.resources.books.vars.enablePaginationCounts = false;
```

Without counts, you lose:
- `total` in pagination metadata
- `pageCount` in pagination metadata
- `last` link in navigation
- `hasMore` in offset-based pagination (cursor-based still works)

### Cursor vs Offset Pagination

**Use Cursor-Based When:**
- Implementing "load more" functionality
- Data changes frequently
- Working with large datasets
- Consistent pagination is critical

**Use Offset-Based When:**
- Users need to jump to specific pages
- Total count is important
- Working with static data
- Traditional pagination UI is required

### Example: Infinite Scroll Implementation

```javascript
let cursor = null;
let allBooks = [];

async function loadMore() {
  const result = await api.resources.books.query({
    queryParams: {
      page: { 
        size: 20,
        ...(cursor && { after: cursor })
      },
      sort: ['-id']
    }
  });
  
  allBooks = [...allBooks, ...result.data];
  
  if (result.meta.pagination.hasMore) {
    cursor = result.meta.pagination.cursor.next;
    // Show "Load More" button
  } else {
    // Hide "Load More" button
  }
}
```

### Query String Preservation

All pagination links preserve other query parameters:

```
GET /books?page[number]=2&sort=-title&filters[country_id]=1&include=country

Links will maintain sort, filters, and include parameters:
- next: /books?page[number]=3&sort=-title&filters[country_id]=1&include=country
- prev: /books?page[number]=1&sort=-title&filters[country_id]=1&include=country
```

This ensures consistent results when navigating between pages.