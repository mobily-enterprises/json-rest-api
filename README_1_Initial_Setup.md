
## Defining the Basic Tables

This GUIDE uses a consistent example throughout - a book catalog system with authors, publishers, and countries.

**Important**: The five tables defined below (countries, publishers, authors, books, and book_authors) form the foundation for all examples, tests, and documentation in this guide. We'll consistently reference this same schema structure to demonstrate all features of the library.

Also for brevity, the `inspect()` function will be assumed to be set:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// Utility used throughout this guide
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
    id: { type: 'id' },
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
    id: { type: 'id' },
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
    id: { type: 'id' },
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
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await api.resources.book_authors.createKnexTable()

// Reviews table (polymorphic - can review books, authors, or publishers)
await api.addResource('reviews', {
  schema: {
    id: { type: 'id' },
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
```

### Database Options

The `json-rest-api` library uses `knex` as its database abstraction layer, which supports a wide variety of SQL databases. In the example above, we configured `knex` to use an in-memory SQLite database for simplicity:

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

Remember to install the corresponding `knex` driver for your chosen database (e.g., `npm install pg` for PostgreSQL, `npm install mysql2` for MySQL).

## Basic Usage

The `json-rest-api` plugin extends your `hooked-api` instance with powerful RESTful capabilities, allowing you to interact with your defined resources both programmatically within your application code and via standard HTTP requests.

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
// TODO: Check what this will return
```

Now, let's retrieve this country data using its ID:

```javascript
// Example: Refetch a country by ID
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.data.id, // Use the ID returned from the POST operation
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output:
// TODO: Check
```

### REST Usage (HTTP Endpoints)

To expose your API resources via HTTP, you need to install one of the connector plugins:

* **`ExpressPlugin`**: If you are using `Express.js` in your application.

* **`(Coming soon)`**: Fastify and Koa are planned and coming soon

Thanks to the ExpressPlugin, json-rest-api is able to export an Express router that you can just `use()` in Express:

```javascript
// In your main application file (e.g., app.js)
import { ExpressPlugin, RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import express from 'express';
import knexLib from 'knex';
import util from 'util';

// ... (Knex and API instance setup as shown in "Defining the Basic Tables")

const app = express();

// Install the Express Plugin
await api.use(ExpressPlugin, {
  basePath: '/api' // All API routes will be under /api
});

// Mount the API router
app.use(api.http.express.router); // Mounts the router generated by ExpressPlugin
// Alternatively, for more control: app.use('/my-custom-path', api.http.express.router);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
});
```

### Making the CURL calls

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




## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)




## hasMany records

### Search (hasMany)

### Sparse fields (hasMany)




## Many to many (hasMany with through records)

### Search (many to many)

### Sparse fields (many to many)






## Next Steps

- [Schema Definition Guide](docs/schemas.md) - Learn about all field types and validation rules
- [Relationships Guide](docs/relationships.md) - Deep dive into relationship configuration
- [Querying Guide](docs/querying.md) - Advanced filtering, sorting, and pagination
- [File Uploads Guide](docs/file-uploads.md) - Handle file uploads with various storage backends
- [Authentication Guide](docs/authentication.md) - Add authentication and authorization
- [Testing Guide](docs/testing.md) - Write tests for your API

## License

GPL-3.0-or-later











