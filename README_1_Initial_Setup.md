# Basic usage and basic configuration

This section explains how to set up `json-rest-api` in your code.

## Defining the Basic Tables

The documentation uses a consistent example throughout - a book catalog system with authors, publishers, and countries.

**Important**: The five tables defined below (countries, publishers, authors, books, and book_authors) form the foundation for all examples, tests, and documentation in this guide. We'll consistently reference this same schema structure to demonstrate all features of the library. At times, we will change the definition of some of them to show specific features.

Also for brevity, the `inspect()` function will be assumed to be set.

Also, since we are using them, you will need to install:

```bash
npm install json-rest-api
npm install knex
npm install better-sqlite3
```

You won't need to install `hooned-api` since it's already a dependency of json-rest-api.

So this is the first basic script:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 5 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', version: '1.0.0' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
});
await api.resources.countries.createKnexTable()

// Publishers table
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 200, search: true },
    country_id: { type: 'number',  belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' }
  }
});
await api.resources.publishers.createKnexTable()

// Authors table
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 200, search: true },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' }
  }
});
await api.resources.authors.createKnexTable()

// Books table
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 300, search: true },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', belongsTo: 'publishers', as: 'publisher' },
    year: { type: 'number', search: true },
    isbn: { type: 'string', search: true },
    inStock: { type: 'boolean', default: true },
    rating: { type: 'number', default: 0 },
    tags: { type: 'array', default: [] },
    metadata: { type: 'object', default: {} }
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' }
  }
});
await api.resources.books.createKnexTable()

// Book-Authors pivot table (many-to-many relationship)
await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await api.resources.book_authors.createKnexTable()

// Reviews table (polymorphic - can review books, authors, or publishers)
await api.addResource('reviews', {
  schema: {
    review_author: { type: 'string', required: true, max: 100 },
    review_text: { type: 'string', required: true, max: 5000 },
    review_rating: { type: 'number', required: true, min: 1, max: 5 },
    reviewable_type: { type: 'string', required: true },
    reviewable_id: { type: 'number', required: true },
    // Define the polymorphic field
    reviewable: {
      belongsToPolymorphic: {
        types: ['books', 'authors', 'publishers'],
        typeField: 'reviewable_type',
        idField: 'reviewable_id'
      },
      as: 'reviewable'
    }
  }
});
await api.resources.reviews.createKnexTable()


/// *** ...programmatic calls here... ***

// Close the database connection (since there is no server waiting)
await knex.destroy();
console.log('\nAll schemas created successfully!');
console.log('Database connection closed.');
```

#### Loglevels

The available log levels in hooked-api are (from most verbose to least verbose):

  1. 'trace' - Most verbose, shows everything including internal operations
  2. 'debug' - Debug information for development
  3. 'info' - Informational messages (DEFAULT)
  4. 'warn' - Only warnings and errors
  5. 'error' - Only error messages
  6. 'silent' - No logging at all

To change loglevels, pass a logLevel option to the API:

```javascript
const api = new Api({ 
  name: 'book-catalog-api', 
  version: '1.0.0',
  logLevel: 'warn'  // Only show warnings and errors
});
```

By default, the INFO level logs you're seeing are the default. To reduce them, you could use:

- logLevel: 'warn' - Only see warnings and errors
- logLevel: 'error' - Only see errors
- logLevel: 'silent' - No logs at all

To see more detail for debugging:

- logLevel: 'debug' - More detailed information
- logLevel: 'trace' - Everything, including hook executions and internal operations

### Database Options

The `json-rest-knex-plugin` plugin uses `knex` as its database abstraction layer, which supports a wide variety of SQL databases.
In the example above, we configured `knex` to use an in-memory SQLite database for simplicity:

```javascript
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:' // In-memory database for quick examples
  },
  useNullAsDefault: true // Recommended for SQLite
});
```

To connect to a different database, you would simply change the `client` and `connection` properties in the `knexLib` configuration. Here are a few common examples:

**PostgreSQL:**

```javascript
const knex = knexLib({
  client: 'pg', // PostgreSQL client
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 5432 // Default PostgreSQL port
  }
});
```
**MySQL / MariaDB:**

```javascript
const knex = knexLib({
  client: 'mysql', // or 'mariasql' for MariaDB
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 3306 // Default MySQL/MariaDB port
  }
});
```

Remember to install the corresponding `knex` driver for your chosen database (e.g., `npm install pg` for PostgreSQL, `npm install mysql2` for MySQL) just as we had to `npm install` the `better-sqlite3` package to make the first example work. 

## Basic Usage

The `json-rest-api` plugin extends your `hooked-api` instance with powerful RESTful capabilities, allowing you to interact with your defined resources both programmatically within your application code and via standard HTTP requests.

The instanced object becomes a fully-fledged, database and schema aware API.

### Programmatic Usage

Once your resources are defined using `api.addResource()`, you can directly call CRUD (Create, Read, Update, Delete) methods on `api.resources.<resourceName>`.

Let's start by creating a `country` record:

```javascript
// Example: Create a country
const countryUs = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});
console.log('Created Country:', inspect(countryUs));
// Expected Output:
// Created Country: { id: '1', name: 'United States', code: 'US' }
```

Now, let's retrieve this country data using its ID:

```javascript
// Example: Refetch a country by ID
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.id, // Use the ID returned from the POST operation
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output:
// Refetched Country: { id: '1', name: 'United States', code: 'US' }
```

### REST Usage (HTTP Endpoints)

Since this is a REST API, its main purpose is to be used with a REST interface over HTTP.
To expose your API resources via HTTP, you need to install one of the connector plugins:

* **`ExpressPlugin`**: If you are using `Express.js` in your application.

* **`(Coming soon)`**: Fastify and Koa are planned and coming soon

Thanks to the ExpressPlugin, `json-rest-api` is able to export an Express router that you can just `use()` in Express.

Just modify the example above so that it looks like this:

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express';
const app = express();

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 5 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', version: '1.0.0' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin);

// *** ...schema definitions as above... ***

app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
});

// Close the database connection // no longer happening
// await knex.destroy();
// console.log('\n✅ All schemas created successfully!');
// console.log('Database connection closed.');

```

Since you added `express`, you will need to install it:

```bash
npm install express
```

Note how the `HttpPlugin` doesn't actually add any routes to the server. All it does, is expose `api.http.express.router` which is a 

Once the server is running, you can interact with your API using tools like `curl`.

**REST Example: Create a Country**

```bash
curl -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```

**REST Example: Get a Country by ID**

```bash
curl -X GET http://localhost:3000/api/countries/2
```


**From now on, all examples will provide both programmatic usage and `curl` usage.** This ensures you understand how to interact with the API directly in your code and how it translates to standard HTTP requests.

### Simplified Mode

TODO: Explain what simplified mode is, and what its defaults are. API use is simplified, online use is non-simplified.
Explain where the settings come from

TODO: Explain how to declare 'books' simplified, and show that it will work in simplified mode. Note: cover simplifiedApi
and simplifiedTransport (as options).

In "simplified mode":

* **Input:** You can pass plain JavaScript objects directly for attributes, and related resource IDs for relationships.

* **Output:** Responses are flattened, with `id` and `attributes` merged directly into the top-level object, and `belongsTo` relationships are represented as foreign key IDs. <--- TODO: check this

The `simplified` mode is controlled by options passed during plugin installation or directly to method calls. It cascades, meaning a setting at a lower level overrides a higher one:

TODO: Redo the next bit, since now we have two different flags, one of the API and one for the network connections 
1. **Global (default):** `RestApiPlugin`'s options (`simplified: true/false`).

2. **Per-Resource:** `addResource()` options (`simplified: true/false`).

3. **Per-Method Call:** The `params` object passed to individual `api.resources.<resource>.method()` calls.

By default, `simplifiedApi` is `true` and simplifiedTransport is `false` for HTTP calls (to maintain JSON:API compliance on the wire).


### Return Full Record

TODO: Explain the returnFullRecord option in detail 




### Search (Filtering)

TODO

### Sparse Fields

The JSON:API specification allows clients to request only a subset of fields for a given resource, a feature known as "sparse fieldsets". This is crucial for optimizing network traffic by reducing the size of the response payload, especially when dealing with large records.

You can specify which fields to return using the `fields[resourceType]=field1,field2` query parameter.

**Programmatic Example: Get only `name` for `countries`**

```javascript
TODO
```

**HTTP Example: Get Books with only `title` and `isbn`**

TODO

Sparse fieldsets also apply to `included` resources. If you request related data, you can specify which fields of those related resources should be returned as well.


## belongsTo records

### Search (belongsTo)

### Sparse fields (belongsTo)

### Computed and hidden fields




## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## hasMany records (polymorphic)

### Search (hasMany)

### Sparse fields (hasMany)

### Computed and hidden fields




## Many to many (hasMany with through records)

### Search (many to many)

### Sparse fields (many to many)

### Computed and hidden fields






## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later











