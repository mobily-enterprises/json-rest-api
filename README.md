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

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import Knex from 'knex';

// Create API instance
const api = new Api({
  name: 'book-catalog-api',
  version: '1.0.0'
});

// Database connection
const knex = Knex({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', required: true, max: 2, unique: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  }
});

// Publishers table
api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});

// Authors table
api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});

// Books table
api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  }
});

// Book-Authors pivot table (many-to-many relationship)
api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
```

## Basic API usage of the library




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
```

## Available Methods

With the above configuration, each resource automatically gets these methods:

### Countries (api.resources.countries)
- `query(params)` - List all countries
- `get({ id })` - Get a specific country
- `post({ inputRecord })` - Create a new country
- `patch({ id, inputRecord })` - Update a country
- `put({ id, inputRecord })` - Replace a country
- `delete({ id })` - Delete a country

### Publishers (api.resources.publishers)
- `query(params)` - List all publishers
- `get({ id })` - Get a specific publisher
- `post({ inputRecord })` - Create a new publisher
- `patch({ id, inputRecord })` - Update a publisher
- `put({ id, inputRecord })` - Replace a publisher
- `delete({ id })` - Delete a publisher

### Authors (api.resources.authors)
- `query(params)` - List all authors
- `get({ id })` - Get a specific author
- `post({ inputRecord })` - Create a new author
- `patch({ id, inputRecord })` - Update an author
- `put({ id, inputRecord })` - Replace an author
- `delete({ id })` - Delete an author

### Books (api.resources.books)
- `query(params)` - List all books
- `get({ id })` - Get a specific book
- `post({ inputRecord })` - Create a new book
- `patch({ id, inputRecord })` - Update a book
- `put({ id, inputRecord })` - Replace a book
- `delete({ id })` - Delete a book

### Book-Authors (api.resources.book_authors)
- `query(params)` - List all book-author relationships
- `get({ id })` - Get a specific relationship
- `post({ inputRecord })` - Create a new book-author relationship
- `patch({ id, inputRecord })` - Update a relationship
- `put({ id, inputRecord })` - Replace a relationship
- `delete({ id })` - Delete a relationship

## Example Usage

### Creating a Country
```javascript
const country = await api.resources.countries.post({
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
console.log('Created country:', country.data);
```

### Creating a Publisher with Country Relationship
```javascript
const publisher = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Penguin Random House',
        founded_year: 2013,
        website: 'https://www.penguinrandomhouse.com'
      },
      relationships: {
        country: {
          data: { type: 'countries', id: country.data.id }
        }
      }
    }
  }
});
console.log('Created publisher:', publisher.data);
```

### Creating an Author
```javascript
const author = await api.resources.authors.post({
  inputRecord: {
    data: {
      type: 'authors',
      attributes: {
        name: 'George Orwell',
        birth_year: 1903,
        biography: 'English novelist and essayist, journalist and critic.'
      }
    }
  }
});
console.log('Created author:', author.data);
```

### Creating a Book with Relationships
```javascript
const book = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: '1984'
      },
      relationships: {
        country: {
          data: { type: 'countries', id: country.data.id }
        },
        authors: {
          data: [
            { type: 'authors', id: author.data.id }
          ]
        }
      }
    }
  }
});
console.log('Created book:', book.data);
```

### Querying Books with Relationships
```javascript
// Get books with their country and authors included
const booksWithRelations = await api.resources.books.query({
  queryParams: {
    include: ['country', 'authors']
  }
});

// Get books sorted by title
const sortedBooks = await api.resources.books.query({
  queryParams: {
    sort: ['title']
  }
});

// Paginate results
const paginatedBooks = await api.resources.books.query({
  queryParams: {
    page: { number: 2, size: 10 }
  }
});
```

## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later