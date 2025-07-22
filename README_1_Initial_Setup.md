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
await api.use(RestApiPlugin, { publicBaseUrl: '/api/1.0' });
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

### Programmatic Usage

The `json-rest-api` plugin extends your `hooked-api` instance with powerful RESTful capabilities, allowing you to interact with your defined resources both programmatically within your application code and via standard HTTP requests.

The instanced object becomes a fully-fledged, database and schema aware API.

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

The database is populated, and the newly added record is then fetched.

#### API usage and simplified mode

In the examples above, we're using the API in **simplified mode** (which is the default for programmatic usage). Simplified mode is a convenience feature that allows you to work with plain JavaScript objects instead of the full JSON:API document structure. However, it's important to understand that internally, everything is still processed as proper JSON:API documents.

Simplified mode changes:
- **Input**: You can pass plain objects with just the attributes
- **Output**: You get back plain objects with id and attributes merged at the top level

Here's how the same operations look when **NOT** using simplified mode:

```javascript
// Create a country (non-simplified mode)
const countryUs = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: {
        name: 'United States',
        code: 'US'
      }
    }
  },
  simplified: false
});
console.log('Created Country:', inspect(countryUs));
// Expected Output:
// Created Country: {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' },
//     links: { self: '/api/1.0/countries/1' }
//   },
//   links: { self: '/api/1.0/countries/1' }
// }

// Fetch a country by ID (non-simplified mode)
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.data.id,
  simplified: false
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output (a  full JSON:API record):
// Refetched Country: {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' },
//     links: { self: '/api/1.0/countries/1' }
//   },
//   links: { self: '/api/1.0/countries/1' }
// }
```

(Note that the full JSON:API record includes links to resources, which use `publicBaseUrl` set in when `use()`ing the `json-rest-api` plugin.)

As you can see, when `simplified: false` is used:

- Input requires the full JSON:API document structure with `data`, `type`, and `attributes`
- Output returns the full JSON:API response with the same nested structure (and links)
- You need to access the ID as `result.data.id` instead of just `result.id`

**NOTE**: For programmatic API calls, simplified mode defaults to true but can be configured at multiple levels: globally via `simplifiedApi: true/false` when installing RestApiPlugin, per-resource when calling `addResource()`, or per-call by setting `simplified: true/false` in the call parameters, with the hierarchy being per-call → per-resource → global default; additionally, when passing attributes directly (without inputRecord), simplified mode is always true regardless of configuration.

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     simplifiedApi: false  // All API calls will use JSON:API format by default
   });
   ```

2. **Per-resource override**: Set when defining a resource
   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
     simplified: false  // This resource always uses JSON:API format
   });
   ```

3. **Per-call override**: Set in individual method calls
   ```javascript
   // Force non-simplified for this call only
  const result = await api.resources.countries.post({
    inputRecord: {
      data: {
        type: 'countries',
        attributes: {
          name: 'United States',
          code: 'US'
        }
      }
    },
    simplified: false
  });

   ```

The hierarchy is: **per-call → per-resource → global default**

**Special case**: When passing attributes directly (without `inputRecord`), simplified mode is always `true` regardless of configuration:
```javascript
// This ALWAYS uses simplified mode, even if global/resource setting is false
const result = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});
```

By default, `simplifiedApi` is `true` for programmatic usage, making it easier to work with the API in your code while still maintaining full JSON:API compliance internally.

#### API usage and returning records

In the previous examples, each POST call returned the full record. However, this is not always the case -- especially since a re-fetch is a power-consuming operation. The **returnFullRecord** option controls what data is returned after write operations (POST, PUT, PATCH). This is useful for balancing between getting complete data and optimizing performance.

`returnFullRecord` accepts three string values:
- **`'full'`**: Returns the complete record with all attributes, relationships, computed fields, and links
- **`'minimal'`**: Returns only the resource type and ID
- **`'no'`**: Returns nothing (undefined in programmatic calls, 204 No Content in HTTP)

Here's how the same POST operation behaves with different `returnFullRecord` settings:

```javascript
// Default behavior: 'no' - returns nothing
const api = new Api({ name: 'api', version: '1.0.0' });
await api.use(RestApiPlugin); // Default is returnFullRecord: 'no'

const countryNoReturn = await api.resources.countries.post({
  name: 'Canada',
  code: 'CA'
});
console.log('Created with no return:', countryNoReturn);
// Expected Output:
// Created with no return: undefined

// Configure to return minimal record
await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: 'minimal',
    put: 'minimal',
    patch: 'minimal'
  }
});

const countryMinimal = await api.resources.countries.post({
  inputRecord: {
    name: 'Mexico',
    code: 'MX'
  }
});
console.log('Created with minimal return:', inspect(countryMinimal));
// Expected Output:
// Created with minimal return: { id: '2', type: 'countries' }

// Configure to return full record
await api.use(RestApiPlugin, {
  returnFullRecord: {
    post: 'full',
    put: 'full',
    patch: 'full'
  }
});

const countryFull = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});
console.log('Created with full record:', inspect(countryFull));
// Expected Output:
// Created with full record: {
//   id: '3',
//   name: 'United States',
//   code: 'US'
// }
```

When combined with non-simplified mode, the difference is even more apparent:

```javascript
// Non-simplified mode with full record
const fullJsonApi = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'France', code: 'FR' }
    }
  },
  simplified: false,
  returnFullRecord: 'full'
});
console.log('Full JSON:API response:', inspect(fullJsonApi));
// Expected Output:
// Full JSON:API response: {
//   data: {
//     type: 'countries',
//     id: '4',
//     attributes: { name: 'France', code: 'FR' },
//     links: { self: '/api/1.0/countries/4' }
//   },
//   links: { self: '/api/1.0/countries/4' }
// }

// Non-simplified mode with minimal return
const minimalJsonApi = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'Germany', code: 'DE' }
    }
  },
  simplified: false,
  returnFullRecord: 'minimal'
});
console.log('Minimal JSON:API response:', inspect(minimalJsonApi));
// Expected Output:
// Minimal JSON:API response: { id: '5', type: 'countries' }
```

**NOTE**: `returnFullRecord` defaults to `'no'` for all operations (POST, PUT, PATCH) but can be configured at multiple levels: globally when installing RestApiPlugin, per-resource when calling `addResource()`, or per-call in the method parameters, with the same hierarchy as simplified mode (per-call → per-resource → global default).

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     returnFullRecord: {
       post: 'minimal',   // Return minimal response after POST
       put: 'minimal',    // Return minimal response after PUT
       patch: 'full'      // Return full records after PATCH
     }
   });
   ```

2. **Per-resource override**: Set when defining a resource
   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
     returnFullRecord: {
       post: 'full',     // Return full records after POST
       put: 'full',      // Return full records after PUT
       patch: 'minimal'  // Return minimal response after PATCH
     }
   });
   ```

3. **Per-call override**: Set in individual method calls
   ```javascript
   // Override to get minimal response for this specific call
   const result = await api.resources.countries.patch({
     inputRecord: {
       id: '1',
       name: 'United States of America'
     },
     returnFullRecord: 'minimal'
   });
   // result = { id: '1', type: 'countries' }
   ```

**Performance consideration**: When `returnFullRecord: 'full'`, the API performs an additional GET request internally after the write operation to fetch the complete record with all computed fields and relationships. Setting it to `'minimal'` or `'no'` skips this extra query, improving performance when you don't need the full data.

By default, all operations return nothing (`'no'`), but you can set `returnFullRecord: 'minimal'` to get just the ID and type, or `'full'` to get the complete record with all fields.

Note that the setting will affect **both** API usage **and** HTTP usage.

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
await api.use(ExpressPlugin, {  mountPath: '/api' });

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

The simplified mode concept works exactly the same way over HTTP as it does for programmatic API calls (see "API usage and simplified mode" above). However, there's an important difference in the defaults:

- **Programmatic API**: `simplifiedApi` defaults to `true` (convenient for developers)
- **HTTP/REST**: `simplifiedTransport` defaults to `false` (JSON:API compliance)

This means that by default, HTTP endpoints expect and return proper JSON:API format:

```bash
# POST request must use JSON:API format (simplified: false by default)
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

Most production servers will keep `simplifiedTransport: false` to maintain JSON:API compliance for client applications. You can enable simplified mode for HTTP if needed:

```javascript
await api.use(RestApiPlugin, {
  simplifiedTransport: true  // Enable simplified mode for HTTP (not recommended)
});
```

### Return Full Record

The `returnFullRecord` behavior over HTTP is identical to programmatic usage (see "API usage and returning records" above), but the HTTP status codes vary based on the operation and setting:

**POST operations:**
- `returnFullRecord: 'full'` → Returns `201 Created` with the full record in the body
- `returnFullRecord: 'minimal'` → Returns `201 Created` with minimal response `{ id: '...', type: '...' }`
- `returnFullRecord: 'no'` → Returns `204 No Content` with no body

**PUT/PATCH operations:**
- `returnFullRecord: 'full'` → Returns `200 OK` with the full record in the body
- `returnFullRecord: 'minimal'` → Returns `200 OK` with minimal response `{ id: '...', type: '...' }`
- `returnFullRecord: 'no'` → Returns `204 No Content` with no body

**DELETE operations:**
- Always returns `204 No Content` with no body (regardless of `returnFullRecord`)



TODO: Implement flag to decide if minimal records or no record is returned. Probably change the setting to responseRecord that can be 'full', 'minimal' or 'none'

