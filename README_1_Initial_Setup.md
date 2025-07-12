
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
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
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
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
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
// Expected Output (simplified JSON:API for brevity):
// {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' }
//   }
// }
```

Now, let's retrieve this country data using its ID:

```javascript
// Example: Refetch a country by ID
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.data.id, // Use the ID returned from the POST operation
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output (simplified JSON:API for brevity):
// {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' }
//   }
// }
```

### REST Usage (HTTP Endpoints)

To expose your API resources via HTTP, you need to install one of the connector plugins:

* **`HttpPlugin`**: For a lightweight, standalone Node.js HTTP server.

* **`ExpressPlugin`**: If you are using `Express.js` in your application.

Let's see how to set up and use both:

#### Using `HttpPlugin`

```javascript
// In your main application file (e.g., app.js)
import { HttpPlugin, RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// ... (Knex and API instance setup as shown in "Defining the Basic Tables")

// Install the HTTP Plugin
await api.use(HttpPlugin, {
  port: 3000,
  basePath: '/api' // All API routes will be under /api
});

// Start the HTTP server
api.http.startServer();
console.log('HTTP server started. API available at http://localhost:3000/api');
```

#### Using `ExpressPlugin`

You can also use Express: thanks to the ExpressPlugin, json-rest-api is able to export an Express
router that you can just `use()` in Express:

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

You might have noticed that the programmatic examples initially returned and accepted data in a more complex, nested structure (JSON:API format), while you might prefer working with simpler, "flat" JavaScript objects.

By default, the `json-rest-api` library operates in **JSON:API mode**, which strictly adheres to the specification. However, it also provides a convenient **"simplified mode"** that abstracts away some of the JSON:API boilerplate, making direct API use ergonomic when you don't need the full verbosity.

In "simplified mode":

* **Input:** You can pass plain JavaScript objects directly for attributes, and related resource IDs for relationships.

* **Output:** Responses are flattened, with `id` and `attributes` merged directly into the top-level object, and `belongsTo` relationships are represented as foreign key IDs.

The `simplified` mode is controlled by options passed during plugin installation or directly to method calls. It cascades, meaning a setting at a lower level overrides a higher one:

1. **Global (default):** `RestApiPlugin`'s options (`simplified: true/false`).

2. **Per-Resource:** `addResource()` options (`simplified: true/false`).

3. **Per-Method Call:** The `params` object passed to individual `api.resources.<resource>.method()` calls.

By default, `simplified` is `true` for programmatic calls and `false` for HTTP calls (to maintain JSON:API compliance on the wire).

Let's set `simplified: true` globally for programmatic usage and see the difference:

```javascript
await apiSimplified.use(RestApiPlugin, {
  simplified: true // Set simplified mode globally for programmatic calls
});
```

```javascript
// Re-initialize API to set global simplified mode
const apiSimplified = new Api({
  name: 'book-catalog-api-simplified',
  version: '1.0.0'
});

await apiSimplified.use(RestApiPlugin, {
  simplified: true // Set simplified mode globally for programmatic calls
});
await apiSimplified.use(RestApiKnexPlugin, { knex });

// Redefine resources for apiSimplified instance (same definitions as above)
await apiSimplified.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true },
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
});
await apiSimplified.resources.countries.createKnexTable()

await apiSimplified.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200, search: true },
    country_id: { type: 'number',  belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await apiSimplified.resources.publishers.createKnexTable()

await apiSimplified.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200, search: true },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});
await apiSimplified.resources.authors.createKnexTable()

await apiSimplified.addResource('books', {
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
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id', sideLoadMany: true },
  }
});
await apiSimplified.resources.books.createKnexTable()

await apiSimplified.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await apiSimplified.resources.book_authors.createKnexTable()

// Example: Create a country in simplified mode
const countryCanada = await apiSimplified.resources.countries.post({
  name: 'Canada',
  code: 'CA'
});
console.log('Created Country (Simplified):', inspect(countryCanada));
// Expected Output:
// { id: '1', name: 'Canada', code: 'CA' }
// Notice the flat structure and direct access to properties.

// Example: Refetch a country in simplified mode
const countryCanadaRefetched = await apiSimplified.resources.countries.get({
  id: countryCanada.id, // Direct ID access
});
console.log('Refetched Country (Simplified):', inspect(countryCanadaRefetched));
// Expected Output:
// { id: '1', name: 'Canada', code: 'CA' }
```

You can also explicitly set `simplified: false` for a specific method call even if the global/resource setting is `true`, to send or receive a full JSON:API document:

```javascript
// Example: Create a publisher, explicitly requesting full JSON:API response
const publisherPenguin = await apiSimplified.resources.publishers.post({
  // Input can still be simplified due to global setting
  name: 'Penguin Random House',
  country_id: countryCanada.id, // Directly pass foreign key ID
}, {
  simplified: false // Request full JSON:API response for this call
});
console.log('Created Publisher (Explicitly JSON:API):', inspect(publisherPenguin));
// Expected Output (full JSON:API response):
// {
//   data: {
//     type: 'publishers',
//     id: '2',
//     attributes: { name: 'Penguin Random House' },
//     relationships: {
//       country: { data: { type: 'countries', id: '1' } }
//     }
//   }
// }

```

> **Important Note:** When using **HTTP requests** (via `HttpPlugin` or `ExpressPlugin`), the default behavior is always **JSON:API compliant**, meaning you must send and receive data in the full JSON:API format. The `simplified` option primarily affects programmatic interactions within your application. You **cannot** pass a simplified record directly through the HTTP body when the connector is configured for full JSON:API compliance.

### Return Full Record

By default, `POST`, `PUT`, and `PATCH` operations often return the full representation of the modified resource. However, sometimes you might only need the ID, or want to reduce network payload. The `returnFullRecord` option allows you to control this behavior for mutation operations.

This setting also cascades:

1. **Global:** `RestApiPlugin`'s options (`returnFullRecord: { post: true, put: true, patch: true }`).
2. **Per-Resource:** `addResource()` options (`returnFullRecord: { post: true, put: true, patch: true }`).
3. **Per-Method Call:** The `params` object passed to individual `api.resources.<resource>.method()` calls (`returnFullRecord: true/false`).
4. **Remote Override (HTTP):** An `allowRemoteOverride: true` setting (at global or resource level) allows clients to override the default via a `?returnFullRecord=true/false` query parameter in HTTP requests.

Let's demonstrate how `returnFullRecord` affects a `POST` operation:

```javascript
// Re-initialize API to showcase returnFullRecord settings
const apiReturnControl = new Api({
  name: 'book-catalog-api-return-control',
  version: '1.0.0'
});

await apiReturnControl.use(RestApiPlugin, {
  simplified: true, // Keep simplified for cleaner programmatic output
  returnFullRecord: {
    post: false, // Default to NOT returning full record for POST
    put: false,
    patch: false,
    allowRemoteOverride: true // Allow clients to override via query param
  }
});
await apiReturnControl.use(RestApiKnexPlugin, { knex });
// Assuming ExpressPlugin is also installed and listening on port 3000
// await apiReturnControl.use(ExpressPlugin, { basePath: '/api-return' });

// Redefine resources for apiReturnControl instance
await apiReturnControl.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true },
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
});
await apiReturnControl.resources.countries.createKnexTable()

await apiReturnControl.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200, search: true },
    country_id: { type: 'number',  belongsTo: 'countries', as: 'country' },
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await apiReturnControl.resources.publishers.createKnexTable()

await apiReturnControl.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200, search: true },
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});
await apiReturnControl.resources.authors.createKnexTable()

await apiReturnControl.addResource('books', {
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
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id', sideLoadMany: true },
  }
});
await apiReturnControl.resources.books.createKnexTable()

await apiReturnControl.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' },
  }
});
await apiReturnControl.resources.book_authors.createKnexTable()

// Programmatic Example: Create a country (defaulting to no full record return)
const countryGermany = await apiReturnControl.resources.countries.post({
  name: 'Germany',
  code: 'DE'
});
console.log('Created Country (No Full Record):', inspect(countryGermany));
// Expected Output:
// { id: '3' } // Only returns the ID (or an empty object if no ID is generated)

// Programmatic Example: Create another country, but override to return full record
const countryFrance = await apiReturnControl.resources.countries.post({
  name: 'France',
  code: 'FR'
}, {
  returnFullRecord: true // Override for this specific call
});
console.log('Created Country (Full Record):', inspect(countryFrance));
// Expected Output:
// { id: '4', name: 'France', code: 'FR' }


// Start Express server for HTTP examples (assuming you have Express setup)
// If you're running this as a standalone script, you'll need to manually start an Express server
// and mount apiReturnControl.http.express.router on it.
// Example:
// import express from 'express';
// const app = express();
// app.use(express.json()); // Needed for body parsing
// app.use('/api-return', apiReturnControl.http.express.router);
// app.listen(3000, () => console.log('API running on :3000 for return control tests'));

```

**HTTP Example: Create a Country (No Full Record - Default)**

```bash
curl -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "Spain",
      "code": "ES"
    }
  }
}' http://localhost:3000/api-return/countries
# Expected HTTP Response (Status 201 Created):
# {
#   "data": {
#     "type": "countries",
#     "id": "5"
#   }
# }
# Note: By default, if returnFullRecord is false for HTTP, it should return an identifier object.
# The previous test had `returnFullRecord: { post: false }` set globally.
```

**HTTP Example: Create a Country (Force Full Record via Query Parameter)**

```bash
curl -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "Italy",
      "code": "IT"
    }
  }
}' 'http://localhost:3000/api-return/countries?returnFullRecord=true'
# Expected HTTP Response (Status 201 Created):
# {
#   "data": {
#     "type": "countries",
#     "id": "6",
#     "attributes": {
#       "name": "Italy",
#       "code": "IT"
#     }
#   }
# }

```

### Search (Filtering)

The `json-rest-api` provides powerful filtering capabilities. You can search for records based on specific field values.

For a field to be searchable, it must either have `search: true` in its schema definition or be explicitly defined in a `searchSchema` option when adding the resource. The `RestApiPlugin` automatically generates a `searchSchema` for fields marked `search: true`, providing sensible defaults. This `searchSchema` defines exactly which fields can be used for filtering and how they behave (e.g., exact match, partial match, range).

In our base schema, we already marked `name` and `code` for `countries` as `search: true`:

```javascript
// In the countries resource definition:
//   name: { type: 'string', required: true, max: 100, search: true },
//   code: { type: 'string', max: 2, unique: true, search: true },

```

This configuration means that `name` and `code` fields will be automatically included in the `searchSchema` and can be used for filtering.

**Programmatic Example: Search Countries by Name**

```javascript
// Using the apiSimplified instance (simplified mode)
const searchResultCanada = await apiSimplified.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Canada'
    }
  }
});
console.log('Search result for Canada:', inspect(searchResultCanada));
// Expected Output (simplified mode):
// [ { id: '1', name: 'Canada', code: 'CA' } ]
```

**HTTP Example: Search Countries by Code**

For HTTP requests, filters are passed using bracket notation in the query string: `filter[fieldName]=value`.

```bash
curl -X GET 'http://localhost:3000/api/countries?filter[code]=US'
# Expected HTTP Response (Status 200 OK):
# {
#   "data": [
#     {
#       "type": "countries",
#       "id": "1",
#       "attributes": { "name": "United States", "code": "US" }
#     }
#   ]
# }
```

You can also define custom search behavior or search across related tables using the `searchSchema` option when defining a resource. For more complex filtering scenarios including cross-table searches (e.g., searching books by author name) refer to the [Advanced Querying Guide](https://www.google.com/search?q=%23advanced-querying-guide).

### Sparse Fields

The JSON:API specification allows clients to request only a subset of fields for a given resource, a feature known as "sparse fieldsets". This is crucial for optimizing network traffic by reducing the size of the response payload, especially when dealing with large records.

You can specify which fields to return using the `fields[resourceType]=field1,field2` query parameter.

**Programmatic Example: Get only `name` for `countries`**

```javascript
// Using the apiSimplified instance (simplified mode)
const countriesSparse = await apiSimplified.resources.countries.query({
  queryParams: {
    fields: {
      countries: 'name' // Request only the 'name' field for countries
    }
  }
});
console.log('Countries (Sparse Fields - Name Only):', inspect(countriesSparse));
// Expected Output (simplified mode):
// [
//   { id: '1', name: 'United States' },
//   { id: '3', name: 'Germany' },
//   { id: '4', name: 'France' },
//   { id: '5', name: 'Spain' },
//   { id: '6', name: 'Italy' }
// ]
// Note: The 'id' field is always included implicitly, even if not requested.
```

**HTTP Example: Get Books with only `title` and `isbn`**

```bash
curl -X GET 'http://localhost:3000/api/books?fields[books]=title,isbn'
# Expected HTTP Response (Status 200 OK, partial data shown):
# {
#   "data": [
#     {
#       "type": "books",
#       "id": "1",
#       "attributes": {
#         "title": "My First Book",
#         "isbn": "978-1234567890"
#       }
#     },
#     {
#       "type": "books",
#       "id": "2",
#       "attributes": {
#         "title": "Another Book Title",
#         "isbn": "978-0987654321"
#       }
#     }
#   ]
# }

```

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



