# Bulk Operations Guide

The **Bulk Operations Plugin** enables efficient processing of multiple records in a single request, supporting atomic transactions, batch processing, and error handling. This guide demonstrates how to create, update, and delete multiple records efficiently.

## Overview

Bulk operations are essential for:
- **Data Import/Export**: Processing large datasets efficiently
- **Batch Updates**: Modifying multiple records with consistent rules
- **Transactional Safety**: Ensuring all-or-nothing operations
- **Performance**: Reducing network overhead and database round-trips

The plugin provides three main operations:
- **bulkPost**: Create multiple records
- **bulkPatch**: Update multiple records
- **bulkDelete**: Delete multiple records

## Installation and Setup

First, install the Bulk Operations plugin alongside the standard REST API plugins:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { BulkOperationsPlugin } from 'json-rest-api/plugins/core/bulk-operations-plugin.js';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// Utility for displaying results
const inspect = (obj) => util.inspect(obj, { depth: 5 });

// Create database connection
const knex = knexLib({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
});

// Install plugins in order
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Install Bulk Operations plugin with configuration
await api.use(BulkOperationsPlugin, {
  'bulk-operations': {
    maxBulkOperations: 100,     // Maximum records per request
    defaultAtomic: true,        // Default transaction mode
    batchSize: 10,             // Internal batch processing size
    enableOptimizations: true   // Enable database-specific optimizations
  }
});
```

## Configuration Options

The Bulk Operations plugin supports several configuration options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxBulkOperations` | number | 100 | Maximum number of records that can be processed in a single request |
| `defaultAtomic` | boolean | true | Whether operations are atomic (all-or-nothing) by default |
| `batchSize` | number | 100 | Number of records to process in each internal batch |
| `enableOptimizations` | boolean | true | Enable database-specific bulk optimizations when available |

## Using the Book Catalog Schema

Let's use the standard book catalog schema for all examples:

```javascript
// Define the book catalog schema
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  }
});

await api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});

await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 }
  },
  relationships: {
    books: { 
      manyToMany: {
        through: 'book_authors',
        foreignKey: 'author_id',
        otherKey: 'book_id'
      }
    }
  }
});

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher' }
  },
  relationships: {
    authors: { 
      manyToMany: {
        through: 'book_authors',
        foreignKey: 'book_id',
        otherKey: 'author_id'
      }
    }
  }
});

await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
  }
});

// Create tables
await api.resources.countries.createKnexTable();
await api.resources.publishers.createKnexTable();
await api.resources.authors.createKnexTable();
await api.resources.books.createKnexTable();
await api.resources.book_authors.createKnexTable();
```

## Bulk Create (bulkPost)

Create multiple records in a single operation. The `bulkPost` method accepts an array of JSON:API documents.

### Basic Bulk Create

```javascript
// Create multiple authors at once
const bulkCreateResult = await api.scopes.authors.bulkPost({
  inputRecords: [
    { type: 'authors', attributes: { name: 'J.K. Rowling' } },
    { type: 'authors', attributes: { name: 'George R.R. Martin' } },
    { type: 'authors', attributes: { name: 'Brandon Sanderson' } }
  ],
  atomic: true  // All succeed or all fail
});

console.log(inspect(bulkCreateResult));
// Output:
// {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'J.K. Rowling' } },
//     { type: 'authors', id: '2', attributes: { name: 'George R.R. Martin' } },
//     { type: 'authors', id: '3', attributes: { name: 'Brandon Sanderson' } }
//   ],
//   meta: {
//     total: 3,
//     succeeded: 3,
//     failed: 0,
//     atomic: true
//   }
// }
```

### Bulk Create with Relationships

Create records with relationships to existing data:

```javascript
// First, create some countries and publishers
await api.resources.countries.post({
  inputRecord: { type: 'countries', attributes: { name: 'United States', code: 'US' } }
});
await api.resources.countries.post({
  inputRecord: { type: 'countries', attributes: { name: 'United Kingdom', code: 'UK' } }
});

// Create publishers with country relationships
const publisherResult = await api.scopes.publishers.bulkPost({
  inputRecords: [
    { 
      type: 'publishers', 
      attributes: { name: 'Penguin Random House' },
      relationships: {
        country: { data: { type: 'countries', id: '1' } }  // US
      }
    },
    { 
      type: 'publishers', 
      attributes: { name: 'Bloomsbury Publishing' },
      relationships: {
        country: { data: { type: 'countries', id: '2' } }  // UK
      }
    }
  ]
});

console.log('Created publishers:', publisherResult.meta.succeeded);
```

### Non-Atomic Mode (Partial Success)

Allow some records to fail while others succeed:

```javascript
const partialResult = await api.scopes.authors.bulkPost({
  inputRecords: [
    { type: 'authors', attributes: { name: 'Valid Author' } },
    { type: 'authors', attributes: {} },  // Invalid - missing required name
    { type: 'authors', attributes: { name: 'Another Valid Author' } }
  ],
  atomic: false  // Allow partial success
});

console.log(inspect(partialResult));
// Output:
// {
//   data: [
//     { type: 'authors', id: '4', attributes: { name: 'Valid Author' } },
//     { type: 'authors', id: '5', attributes: { name: 'Another Valid Author' } }
//   ],
//   errors: [{
//     index: 1,
//     status: 'error',
//     error: {
//       code: 'REST_API_VALIDATION',
//       message: 'Schema validation failed for resource attributes',
//       details: { fields: ['data.attributes.name'], violations: [...] }
//     }
//   }],
//   meta: {
//     total: 3,
//     succeeded: 2,
//     failed: 1,
//     atomic: false
//   }
// }
```

## Bulk Update (bulkPatch)

Update multiple records with different values in a single operation.

### Basic Bulk Update

```javascript
// Update multiple authors
const bulkUpdateResult = await api.scopes.authors.bulkPatch({
  operations: [
    { 
      id: '1', 
      data: { 
        type: 'authors', 
        id: '1', 
        attributes: { name: 'J.K. Rowling (Harry Potter)' } 
      }
    },
    { 
      id: '2', 
      data: { 
        type: 'authors', 
        id: '2', 
        attributes: { name: 'George R.R. Martin (Game of Thrones)' } 
      }
    }
  ],
  atomic: true
});

console.log('Updated authors:', bulkUpdateResult.meta.succeeded);
```

### Updating Relationships

Bulk update relationships between resources:

```javascript
// Create some books first
const bookResults = await api.scopes.books.bulkPost({
  inputRecords: [
    { 
      type: 'books', 
      attributes: { title: 'Harry Potter and the Philosopher\'s Stone' },
      relationships: { 
        country: { data: { type: 'countries', id: '2' } }  // UK
      }
    },
    { 
      type: 'books', 
      attributes: { title: 'A Game of Thrones' },
      relationships: { 
        country: { data: { type: 'countries', id: '1' } }  // US
      }
    }
  ]
});

// Now update the books to assign publishers
const bookIds = bookResults.data.map(book => book.id);
const updateOps = await api.scopes.books.bulkPatch({
  operations: [
    {
      id: bookIds[0],
      data: {
        type: 'books',
        id: bookIds[0],
        attributes: {},
        relationships: {
          publisher: { data: { type: 'publishers', id: '2' } }  // Bloomsbury
        }
      }
    },
    {
      id: bookIds[1],
      data: {
        type: 'books',
        id: bookIds[1],
        attributes: {},
        relationships: {
          publisher: { data: { type: 'publishers', id: '1' } }  // Penguin
        }
      }
    }
  ]
});

console.log('Updated book relationships:', updateOps.meta.succeeded);
```

### Handling Update Errors

When updating non-existent records or with invalid data:

```javascript
const errorResult = await api.scopes.authors.bulkPatch({
  operations: [
    { id: '1', data: { type: 'authors', id: '1', attributes: { name: 'Updated Name' } } },
    { id: '999', data: { type: 'authors', id: '999', attributes: { name: 'Non-existent' } } },
    { id: '2', data: { type: 'authors', id: '2', attributes: { name: '' } } }  // Empty name
  ],
  atomic: false  // Allow partial success
});

console.log(inspect(errorResult));
// Shows successful updates and errors for failed operations
```

## Bulk Delete (bulkDelete)

Delete multiple records by their IDs.

### Basic Bulk Delete

```javascript
// Delete multiple authors
const bulkDeleteResult = await api.scopes.authors.bulkDelete({
  ids: ['4', '5', '6'],
  atomic: true
});

console.log(inspect(bulkDeleteResult));
// Output:
// {
//   meta: {
//     total: 3,
//     succeeded: 3,
//     failed: 0,
//     deleted: ['4', '5', '6'],
//     atomic: true
//   }
// }
```

### Handling Referential Integrity

When deleting records with relationships:

```javascript
// Try to delete a country that has books
try {
  await api.scopes.countries.bulkDelete({
    ids: ['1', '2'],  // Countries with related books
    atomic: true
  });
} catch (error) {
  console.log('Cannot delete:', error.message);
  // Will fail due to foreign key constraints
}

// First delete the related records
await api.scopes.books.bulkDelete({
  ids: bookIds,  // Delete books first
  atomic: true
});

// Now can delete the countries
await api.scopes.countries.bulkDelete({
  ids: ['1', '2'],
  atomic: true
});
```

### Mixed Success Scenarios

Handle cases where some deletes succeed and others fail:

```javascript
const mixedResult = await api.scopes.authors.bulkDelete({
  ids: ['1', '999', '2', '888'],  // Mix of valid and invalid IDs
  atomic: false  // Allow partial success
});

console.log(inspect(mixedResult));
// Output:
// {
//   meta: {
//     total: 4,
//     succeeded: 2,
//     failed: 2,
//     deleted: ['1', '2'],
//     atomic: false
//   },
//   errors: [
//     { index: 1, id: '999', status: 'error', error: { code: 'REST_API_RESOURCE', message: 'Resource not found' } },
//     { index: 3, id: '888', status: 'error', error: { code: 'REST_API_RESOURCE', message: 'Resource not found' } }
//   ]
// }
```

## HTTP API Usage

When using the Express plugin, bulk operations are available via HTTP endpoints:

```javascript
import { ExpressPlugin } from 'json-rest-api/plugins/core/connectors/express-plugin.js';
import express from 'express';

// Add Express plugin
await api.use(ExpressPlugin);

// Create and mount Express app
const app = express();
app.use(express.json());
api.http.express.mount(app);

app.listen(3000, () => {
  console.log('API with bulk operations running on http://localhost:3000');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

### HTTP Bulk Create

```bash
POST /api/authors/bulk
Content-Type: application/json

{
  "data": [
    { "type": "authors", "attributes": { "name": "Author One" } },
    { "type": "authors", "attributes": { "name": "Author Two" } }
  ]
}

# With query parameter for non-atomic mode
POST /api/authors/bulk?atomic=false
```

### HTTP Bulk Update

```bash
PATCH /api/authors/bulk
Content-Type: application/json

{
  "operations": [
    { "id": "1", "data": { "type": "authors", "id": "1", "attributes": { "name": "Updated Name" } } },
    { "id": "2", "data": { "type": "authors", "id": "2", "attributes": { "name": "Another Update" } } }
  ]
}
```

### HTTP Bulk Delete

```bash
DELETE /api/authors/bulk
Content-Type: application/json

{
  "data": ["1", "2", "3"]
}

# Alternative format
{
  "ids": ["1", "2", "3"]
}
```

## Advanced Features

### Batch Processing

The plugin processes records in configurable batches to manage memory usage:

```javascript
// Configure smaller batches for memory-constrained environments
await api.use(BulkOperationsPlugin, {
  'bulk-operations': {
    batchSize: 5,  // Process 5 records at a time internally
    maxBulkOperations: 1000  // But allow up to 1000 total
  }
});

// Create 100 records - processed in batches of 5
const largeDataset = Array.from({ length: 100 }, (_, i) => ({
  type: 'authors',
  attributes: { name: `Author ${i + 1}` }
}));

const result = await api.scopes.authors.bulkPost({
  inputRecords: largeDataset,
  atomic: true
});

console.log(`Created ${result.meta.succeeded} authors in batches`);
```

### Transaction Context

Bulk operations provide context information to hooks and plugins:

```javascript
// Add a hook that runs for each bulk operation
api.addHook('beforePost', 'bulkTracking', {}, async ({ context, params }) => {
  if (context.bulkOperation) {
    console.log(`Processing bulk item ${context.bulkIndex + 1}`);
  }
});
```

### Error Handling Patterns

Implement robust error handling for bulk operations:

```javascript
async function importAuthors(authorData) {
  try {
    const result = await api.scopes.authors.bulkPost({
      inputRecords: authorData,
      atomic: false  // Continue on errors
    });
    
    // Log successful imports
    console.log(`Imported ${result.meta.succeeded} of ${result.meta.total} authors`);
    
    // Handle errors if any
    if (result.errors && result.errors.length > 0) {
      console.error('Import errors:');
      result.errors.forEach(error => {
        console.error(`  Row ${error.index}: ${error.error.message}`);
      });
      
      // Return failed records for retry
      return authorData.filter((_, index) => 
        result.errors.some(e => e.index === index)
      );
    }
    
    return [];  // All succeeded
  } catch (error) {
    // Handle complete failure (e.g., database connection error)
    console.error('Bulk import failed completely:', error.message);
    throw error;
  }
}
```

### Performance Considerations

1. **Use Atomic Mode Wisely**: Atomic operations provide consistency but may be slower for large datasets
2. **Adjust Batch Sizes**: Larger batches improve performance but use more memory
3. **Enable Optimizations**: The plugin uses database-specific bulk insert optimizations when available
4. **Monitor Limits**: Set appropriate `maxBulkOperations` to prevent resource exhaustion

## Complete Example: Book Import System

Here's a complete example showing how to import a book catalog with all relationships:

```javascript
async function importBookCatalog(catalogData) {
  // Step 1: Import countries
  console.log('Importing countries...');
  const countryResult = await api.scopes.countries.bulkPost({
    inputRecords: catalogData.countries,
    atomic: true
  });
  
  // Step 2: Import publishers with country relationships
  console.log('Importing publishers...');
  const publisherResult = await api.scopes.publishers.bulkPost({
    inputRecords: catalogData.publishers,
    atomic: true
  });
  
  // Step 3: Import authors
  console.log('Importing authors...');
  const authorResult = await api.scopes.authors.bulkPost({
    inputRecords: catalogData.authors,
    atomic: true
  });
  
  // Step 4: Import books with country and publisher relationships
  console.log('Importing books...');
  const bookResult = await api.scopes.books.bulkPost({
    inputRecords: catalogData.books,
    atomic: false  // Allow partial success for books
  });
  
  // Step 5: Create author-book relationships
  console.log('Creating author-book relationships...');
  const relationshipData = [];
  
  for (const book of bookResult.data) {
    const bookAuthors = catalogData.bookAuthors[book.attributes.title] || [];
    for (const authorName of bookAuthors) {
      const author = authorResult.data.find(a => a.attributes.name === authorName);
      if (author) {
        relationshipData.push({
          type: 'book_authors',
          attributes: {
            book_id: parseInt(book.id),
            author_id: parseInt(author.id)
          }
        });
      }
    }
  }
  
  const relationshipResult = await api.scopes.book_authors.bulkPost({
    inputRecords: relationshipData,
    atomic: false
  });
  
  // Summary
  console.log('\nImport Summary:');
  console.log(`- Countries: ${countryResult.meta.succeeded}`);
  console.log(`- Publishers: ${publisherResult.meta.succeeded}`);
  console.log(`- Authors: ${authorResult.meta.succeeded}`);
  console.log(`- Books: ${bookResult.meta.succeeded} (${bookResult.meta.failed} failed)`);
  console.log(`- Relationships: ${relationshipResult.meta.succeeded}`);
  
  return {
    countries: countryResult.meta.succeeded,
    publishers: publisherResult.meta.succeeded,
    authors: authorResult.meta.succeeded,
    books: bookResult.meta.succeeded,
    relationships: relationshipResult.meta.succeeded,
    errors: bookResult.errors || []
  };
}

// Example usage
const catalogData = {
  countries: [
    { type: 'countries', attributes: { name: 'United States', code: 'US' } },
    { type: 'countries', attributes: { name: 'United Kingdom', code: 'UK' } }
  ],
  publishers: [
    { 
      type: 'publishers', 
      attributes: { name: 'Penguin Random House' },
      relationships: { country: { data: { type: 'countries', id: '1' } } }
    }
  ],
  authors: [
    { type: 'authors', attributes: { name: 'Stephen King' } },
    { type: 'authors', attributes: { name: 'J.K. Rowling' } }
  ],
  books: [
    {
      type: 'books',
      attributes: { title: 'The Shining' },
      relationships: {
        country: { data: { type: 'countries', id: '1' } },
        publisher: { data: { type: 'publishers', id: '1' } }
      }
    }
  ],
  bookAuthors: {
    'The Shining': ['Stephen King']
  }
};

const importResults = await importBookCatalog(catalogData);
```

## Summary

The Bulk Operations plugin provides powerful capabilities for processing multiple records efficiently:

- **Three Core Operations**: bulkPost, bulkPatch, and bulkDelete
- **Atomic Transactions**: All-or-nothing processing for data consistency
- **Partial Success Mode**: Continue processing despite individual failures
- **Batch Processing**: Efficient handling of large datasets
- **Full JSON:API Support**: Maintains compatibility with standard format
- **HTTP Endpoints**: RESTful API for bulk operations

Use bulk operations when you need to:
- Import or export large datasets
- Apply consistent updates across multiple records
- Delete multiple records safely
- Optimize performance by reducing API calls

Remember to consider transaction modes, error handling, and performance implications when designing your bulk operation workflows.