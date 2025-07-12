# JSON REST API

A powerful REST API plugin for [hooked-api](https://github.com/mobily-enterprises/hooked-api) that provides JSON:API-compliant endpoints with minimal configuration. This library makes it easy to create fully-featured REST APIs with support for relationships, filtering, sorting, pagination, and file uploads.

## Features

- =� **JSON:API Compliant** - Full support for the JSON:API specification
- = **Relationship Support** - belongsTo, hasMany, and many-to-many relationships
- =
 **Advanced Querying** - Filtering, sorting, pagination, and field selection
- =� **File Uploads** - Built-in support for file handling with multiple storage adapters
- = **Framework Agnostic** - Works with Express, HTTP, and other Node.js frameworks
- =� **Validation** - Schema-based validation with detailed error messages
- <� **Type Safety** - Full TypeScript support (coming soon)

## Installation

```bash
npm install json-rest-api hooked-api
```

## Defining the basic tables

This README uses a consistent example throughout - a book catalog system with authors, publishers, and countries. 

**Important**: The five tables defined below (countries, publishers, authors, books, and book_authors) form the foundation for all examples, tests, and documentation in this guide. We'll consistently reference this same schema structure to demonstrate all features of the library.

Also for brevity, the `inspect()` function will be assumed to be set:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';


// import { setupDatabase } from './setup-database.js';

const inspect = (obj) => util.inspect(obj, { depth: 5 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
  version: '1.0.0'
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
  // tableName: 'stocazzo',
  // idProperty: 'anotherId'
});
await api.resources.countries.createKnexTable()

// Publishers table
await api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number',  belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await api.resources.publishers.createKnexTable()

// Authors table
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});
await api.resources.authors.createKnexTable()

// Books table
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' },
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id', sideLoadMany: true },
  }
});
await api.resources.books.createKnexTable()

// Book-Authors pivot table (many-to-many relationship)
await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await api.resources.book_authors.createKnexTable()
```
### Database optons

Explain how this part:

```javascript
// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});
```

Can be changed into something else, depending on the storage requied (MariaDb, PostgreSL, etc.)

## Basic API usage of the library

## Basic usage

Intro: this is the basic usage.

### Programmatic usage

WRITE: Writeup on how to create records in the "countries" resource.

```javascript
  // Create a country
  const countryUs = await api.resources.countries.post({
    name: 'United States',
    code: 'US'
  });
  console.log('Country:', inspect(countryUs));
```

WRITE: And explain that data can then be refetched:

```javascript
 const countryUsRefetched = await api.resources.publishers.get({ 
    id: country.id,
  }) 
  console.log('Refetched country:', inspect(countryUs));
```

### Rest usage

Explain how it's easy to make this available via the HTTP plugin or the Expres plugin.
Explain basic usage of both.
The, explain the example REST usage of the two calls above and explain that the rest of this guide
From now on, every usage will explain CURL usage and programmatic usage.

Probably noticed how the server response (and requests) were more complex. The reason is that the command
line works in simplified mode.

### Simplified mode

WRITE: Then explain that by default API calls are set accept and return data in "simplified" mode.
In "simplified" mode the input can be just an object, and the result is flat.

Show the exact same operations above, but in "simplified" mode. Explain also that when in simplified mode
you can also pass `inputRecord` (and have extra parameters if needed). And also explain that in simplified mode you can still pass a full record. However, you CANNOT pass a simplified record in normal mode.

Explain in detail where the simplified mode setting comes from

### Return full record

Show how to use the settings for returnFullRecord. Show what the differences are by creating a new country, and
showing have the result come -- or not.


NOTE: MAYBE RETURN THE ID IN COMMAND LINE MODE, AND IF THE RSPONSE IS OF TYPE INTEGER, TREAT IT AS NO DATA

### Search

Introduce straight search using just normal field. Explain the while "searchable" issue and searchSchema,
and explain how the searchSchema defines what can be searched. Also explain how searchSchema is
dynamically created from "searchable" in schema.

### Sparse fields

Explain how users can decide what fields they can see


## belongsTo records

Adding a record 

### Search (belongsTo)

### Sparse fields (belongsTo)

## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)

## hasMany with through records

### Search (hasMany with through)

### Sparse fields (hasMany with through)


## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later

















### Via API usage

```javascript
// Now you can use the API directly in your code
// Create a country
const countryResult = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: {
        name: 'United States',
        code: 'US'
      }
    }
  }
});
console.log('Created country:', countryResult.data.id);

// Create a publisher
const publisherResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Penguin Random House',
      },
      relationships: {
        country: {
          data: { type: 'countries', id: countryResult.data.id }
        }
      }
    }
  }
});
console.log('Created publisher:', publisherResult.data.id);

// Query all publishers
const publishers = await api.resources.publishers.query({
  queryParams: {
    include: ['country'],
    sort: ['name']
  }
});
console.log('Found', publishers.data.length, 'publishers');



