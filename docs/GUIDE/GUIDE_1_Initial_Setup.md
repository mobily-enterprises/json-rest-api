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
const api = new Api({ name: 'book-catalog-api' });

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
    publishers: { type: 'hasMany', target: 'publishers', foreignKey: 'country_id' },
    books: { type: 'hasMany', target: 'books', foreignKey: 'country_id' }
  },
});
await api.resources.countries.createKnexTable()


/// *** ...programmatic calls here... ***

// Close the database connection (since there is no server waiting)
await knex.destroy();
console.log('\nAll schemas created successfully!');
console.log('Database connection closed.');
```

This set of resources cover a lot of ground in terms of relationships etc. Those other tables will be covered in the next part of this guide.

#### Loglevels

The available log levels in hooked-api are (from most verbose to least verbose):

  1. `trace` - Most verbose, shows everything including internal operations
  2. `debug` - Debug information for development
  3. `info` - Informational messages (DEFAULT)
  4. `warn` - Only warnings and errors
  5. `error` - Only error messages
  6. `silent` - No logging at all

To change loglevels, pass a logLevel option to the API:

```javascript
const api = new Api({ 
  name: 'book-catalog-api', 
  logLevel: 'warn'  // Only show warnings and errors
});
```

By default, the INFO level logs you're seeing are the default. To reduce them, you could use:

- logLevel: `warn` - Only see warnings and errors
- logLevel: `error` - Only see errors
- logLevel: `silent` - No logs at all

To see more detail for debugging:

- logLevel: `debug` - More detailed information
- logLevel: `trace` - Everything, including hook executions and internal operations

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
//     links: { self: '/api/countries/1' }
//   },
//   links: { self: '/api/countries/1' }
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
//     links: { self: '/api/countries/1' }
//   },
//   links: { self: '/api/countries/1' }
// }
```

(Note that the full JSON:API record includes links to resources, which are automatically generated based on the request headers.)

As you can see, when `simplified: false` is used:

- Input requires the full JSON:API document structure with `data`, `type`, and `attributes`
- Output returns the full JSON:API response with the same nested structure (and links)
- You need to access the ID as `result.data.id` instead of just `result.id`

**NOTE**: For programmatic API calls, simplified mode defaults to true but can be configured at multiple levels: globally via `simplifiedApi: true/false` when installing RestApiPlugin, per-resource when calling `addResource()`, or per-call by setting `simplified: true/false` in the call parameters, with the hierarchy being per-call → per-resource → global default; additionally, when passing attributes directly (without inputRecord), simplified mode is always true regardless of configuration.

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     simplifiedApi: false,      // All API calls will use JSON:API format by default
     simplifiedTransport: true  // All HTTP calls will use simplified format by default
   });
   ```

2. **Per-resource override**: Set when defining a resource
   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
     simplifiedApi: false,      // API calls to this resource use JSON:API format
     simplifiedTransport: true  // HTTP calls to this resource use simplified format
   });
   ```

NOTE: this can also be written as:

   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
    
    },{
      // Parameters set directly into 'vars'
      vars: {
        simplifiedApi: false,      // API calls to this resource use JSON:API format
        simplifiedTransport: true  // HTTP calls to this resource use simplified format
      }
    }
   );
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

The hierarchy is: **per-call → per-resource (parameters or variables) → global default**

**Important**: The resource-level configuration supports separate settings for API and transport modes, allowing you to have different behaviors for programmatic calls versus HTTP endpoints for the same resource.

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

When performing write operations (POST, PUT, PATCH), you can control what data is returned. This is useful for balancing between getting complete data and optimizing performance.

There are TWO separate settings for this:

1. **`returnRecordApi`** - Controls what **programmatic API calls** return (default: `'full'`)
2. **`returnRecordTransport`** - Controls what **HTTP/REST endpoints** return (default: `'no'`)

This separation allows you to have different behaviors for internal API usage versus external HTTP clients. For example, your internal code might want full records for convenience, while HTTP clients might prefer minimal responses for performance.

Both settings accept three string values:
- **`'full'`**: Returns the complete record with all attributes, relationships, computed fields, and links
- **`'minimal'`**: Returns only the resource type and ID
- **`'no'`**: Returns nothing (undefined in programmatic calls, 204 No Content in HTTP)

Here's how these settings work:

```javascript
// Example 1: Using defaults
const api = new Api({ name: 'api' });
await api.use(RestApiPlugin); 
// Default: returnRecordApi='full', returnRecordTransport='no'

// Programmatic API call returns full record by default
const country = await api.resources.countries.post({
  name: 'Canada',
  code: 'CA'
});
console.log('API result:', country);
// Expected Output:
// API result: { id: '1', name: 'Canada', code: 'CA' }

// But the same operation via HTTP returns 204 No Content by default
// POST /api/countries -> 204 No Content (no body)

// Example 2: Different settings for API and Transport
await api.use(RestApiPlugin, {
  returnRecordApi: 'minimal',      // API calls return minimal
  returnRecordTransport: 'full'    // HTTP calls return full
});

// API call returns minimal
const apiResult = await api.resources.countries.post({
  name: 'Mexico',
  code: 'MX'
});
console.log('API result:', apiResult);
// Expected Output:
// API result: { id: '2', type: 'countries' }

// HTTP call returns full record
// POST /api/countries -> 204 No Content
// Body: { data: { type: 'countries', id: '3', attributes: { name: 'Mexico', code: 'MX' } } }

// Example 3: Per-method configuration
await api.use(RestApiPlugin, {
  returnRecordApi: {
    post: 'full',     // API POST returns full
    put: 'minimal',   // API PUT returns minimal
    patch: 'no'       // API PATCH returns nothing
  },
  returnRecordTransport: {
    post: 'minimal',  // HTTP POST returns minimal
    put: 'no',        // HTTP PUT returns 204
    patch: 'full'     // HTTP PATCH returns full
  }
});
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
  simplified: false
});
console.log('Full JSON:API response:', inspect(fullJsonApi));
// Expected Output:
// Full JSON:API response: {
//   data: {
//     type: 'countries',
//     id: '4',
//     attributes: { name: 'France', code: 'FR' },
//     links: { self: '/api/countries/4' }
//   },
//   links: { self: '/api/countries/4' }
// }

// Non-simplified mode with minimal return
const minimalJsonApi = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'Germany', code: 'DE' }
    }
  },
  simplified: false
});
console.log('Minimal JSON:API response:', inspect(minimalJsonApi));
// Expected Output:
// Minimal JSON:API response: { id: '5', type: 'countries' }
```

**Configuration Levels**: Both `returnRecordApi` and `returnRecordTransport` can be configured at multiple levels, with the hierarchy being: per-call → per-resource → global default.

**Important**: Like the simplified settings, the resource-level configuration supports separate settings for API and transport modes, allowing fine-grained control over what data is returned for programmatic calls versus HTTP endpoints.

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     returnRecordApi: {
       post: 'full',      // API POST returns full
       put: 'minimal',    // API PUT returns minimal
       patch: 'full'      // API PATCH returns full
     },
     returnRecordTransport: {
       post: 'minimal',   // HTTP POST returns minimal
       put: 'no',         // HTTP PUT returns 204
       patch: 'minimal'   // HTTP PATCH returns minimal
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
     returnRecordApi: 'full',        // All API methods return full
     returnRecordTransport: 'minimal' // All HTTP methods return minimal
   });
   
   // Or with per-method granularity:
   await api.addResource('products', {
     schema: {
       name: { type: 'string', required: true },
       price: { type: 'number', required: true }
     },
     returnRecordApi: {
       post: 'full',     // API POST returns full record
       put: 'minimal',   // API PUT returns minimal
       patch: 'no'       // API PATCH returns nothing
     },
     returnRecordTransport: {
       post: 'minimal',  // HTTP POST returns minimal
       put: 'no',        // HTTP PUT returns 204
       patch: 'full'     // HTTP PATCH returns full record
     }
   });
   ```

3. **Per-call override**: Set in individual method calls
   ```javascript
   // Override for a specific API call
   const result = await api.resources.countries.patch({
     inputRecord: {
       id: '1',
       name: 'United States of America'
     },
     returnFullRecord: 'minimal'  // Overrides the configured setting
   });
   // result = { id: '1', type: 'countries' }
   ```

**Performance consideration**: When using `'full'`, the API performs an additional GET request internally after the write operation to fetch the complete record with all computed fields and relationships. Using `'minimal'` or `'no'` skips this extra query, improving performance when you don't need the full data.

**Remember the defaults**:
- `returnRecordApi` defaults to `'full'` (convenient for development)
- `returnRecordTransport` defaults to `'no'` (optimal for performance)

### REST Usage (HTTP Endpoints)

Since this is a REST API, its main purpose is to be used with a REST interface over HTTP.
To expose your API resources via HTTP, you need to install one of the connector plugins:

* **`ExpressPlugin`**: If you are using `Express.js` in your application.

* **`(Coming soon)`**: Fastify and Koa are planned and coming soon

Thanks to the ExpressPlugin, `json-rest-api` is able to export an Express router that you can just `use()` in Express.

Just modify the example above so that it looks like this:

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

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
const api = new Api({ name: 'book-catalog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' }); // Added: Express Plugin

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()

/// *** ...programmatic calls here... ***

// Create the express server and add the API's routes 
const app = express();
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});

// Close the database connection // no longer happening since the server stays on
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
curl -i -X POST -H "Content-Type: application/vnd.api+json" \
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

This will have no response (204 No Content) since by default resources won't return anything when using HTTP:

```
HTTP/1.1 204 No Content
X-Powered-By: Express
Location: http://localhost:3000/api/countries/1
ETag: W/"a-bAsFyilMr4Ra1hIU5PyoyFRunpI"
Date: Tue, 22 Jul 2025 14:54:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

**REST Example: Get a Country by ID**

```bash
curl -X GET http://localhost:3000/api/countries/2
```

The result:

```json
{
  "data": {
    "type": "countries",
    "id": "1",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    },
    "links": {
      "self": "http://localhost:3000/api/countries/1"
    }
  },
  "links": {
    "self": "http://localhost:3000/api/countries/1"
  }
}
```

### Simplified Mode

The simplified mode concept works exactly the same way over HTTP as it does for programmatic API calls (see "API usage and simplified mode" above). However, there's an important difference in the defaults:

- **Programmatic API**: `simplifiedApi` defaults to `true` (convenient for developers)
- **HTTP/REST**: `simplifiedTransport` defaults to `false` (JSON:API compliance)

This means that by default, HTTP endpoints expect and return proper JSON:API format:

Most production servers will keep `simplifiedTransport: false` to maintain JSON:API compliance for client applications. You can enable simplified mode for HTTP if needed:

```javascript
await api.use(RestApiPlugin, {
  simplifiedTransport: true  // Enable simplified mode for HTTP (not recommended)
});
```

The result:

```json
{
  "id":"1",
  "name":"United Kingdom",
  "code":"UK"
}
```

Keep in mind that to get this result you will need to:

1) Amend your test file, adding `simplifiedTransport: true` to the RestApiPlugin
2) Restart your server (CTRL-C and re-run it)
3) Re-add a country with the POST Curl command shown earlier
4) Finally, re-fetch it and see the record in simplified form.

Once again, it will be uncommon to use the simplified version for the HTTP transport, but it can be used to satisfy legacy clients etc.

### Return Record Settings for HTTP

The `returnRecordTransport` setting controls what HTTP/REST endpoints return (see "API usage and returning records" above for full details). The HTTP status codes vary based on the operation and setting:

**POST operations:**
- `returnRecordTransport: 'full'` → Returns `204 No Content` with the full record in the body
- `returnRecordTransport: 'minimal'` → Returns `204 No Content` with minimal response `{ id: '...', type: '...' }`
- `returnRecordTransport: 'no'` → Returns `204 No Content` with no body

**PUT/PATCH operations:**
- `returnRecordTransport: 'full'` → Returns `204 No Content` with the full record in the body
- `returnRecordTransport: 'minimal'` → Returns `204 No Content` with minimal response `{ id: '...', type: '...' }`
- `returnRecordTransport: 'no'` → Returns `204 No Content` with no body

**DELETE operations:**
- Always returns `204 No Content` with no body (regardless of settings)

**Remember**: The default for `returnRecordTransport` is `'no'`, which means HTTP write operations return 204 No Content by default. This is different from programmatic API calls which default to returning full records.

# A practical example

If you want your server to reply with a full record, you can set it this way:

```javascript
await api.use(RestApiPlugin, {
  returnRecordTransport: 'full'
});
```

Restart once again the server. Then add a country using cUrl:

```bash
curl -i -X POST -H "Content-Type: application/vnd.api+json" \
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
The result:

```
HTTP/1.1 204 No Content
X-Powered-By: Express
Content-Type: application/vnd.api+json; charset=utf-8
Location: http://localhost:3000/api/countries/1
Content-Length: 203
ETag: W/"cb-ycYSy+lmxv51HwwBAEPFd465J8M"
Date: Tue, 22 Jul 2025 15:14:13 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{
  "data": {
    "type": "countries",
    "id": "1",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    },
    "links": {
      "self": "http://localhost:3000/api/countries/1"
    }
  },
  "links": {
    "self": "http://localhost:3000/api/countries/1"
  }
}
```

# Plugin and resource variables

When passing a parameter, `rest-api-plugin` normalises them (when needed) and stores them into plugin variables. This means that these two ways of defining `returnRecordApi` is identical:

```javascript
await api.use(RestApiPlugin, { returnRecordTransport: 'minimal' });

// ...or...

await api.use(RestApiPlugin, { 
  vars: {
    returnRecordTransport: 'minimal'
  }
});
```

Here is a full list of parameters and their respective variables:

| Parameter | Variable Name | Default Value | Description | Scope Override |
|-----------|--------------|---------------|-------------|----------------|
| `queryDefaultLimit` | `vars.queryDefaultLimit` | `25` | Default number of records returned in query results | ✓ |
| `queryMaxLimit` | `vars.queryMaxLimit` | `100` | Maximum allowed limit for query results | ✓ |
| `includeDepthLimit` | `vars.includeDepthLimit` | `3` | Maximum depth for nested relationship includes | ✓ |
| `enablePaginationCounts` | `vars.enablePaginationCounts` | `true` | Whether to include total count in pagination metadata | ✓ |
| `simplifiedApi` | `vars.simplifiedApi` | `true` | Use simplified format for programmatic API calls | ✓ |
| `simplifiedTransport` | `vars.simplifiedTransport` | `false` | Use simplified format for HTTP/REST endpoints | ✓ |
| `idProperty` | `vars.idProperty` | `'id'` | Name of the ID field in resources | ✓ |
| `returnRecordApi` | `vars.returnRecordApi` | `{ post: 'full', put: 'full', patch: 'full' }` | What to return for programmatic API write operations | ✓ |
| `returnRecordTransport` | `vars.returnRecordTransport` | `{ post: 'no', put: 'no', patch: 'no' }` | What to return for HTTP/REST write operations | ✓ |

**Resource-specific parameters** (only available at resource level, not plugin level):

| Parameter | Variable Name | Default Value | Description |
|-----------|--------------|---------------|-------------|
| `sortableFields` | `vars.sortableFields` | `[]` | Array of field names that can be used for sorting |
| `defaultSort` | `vars.defaultSort` | `null` | Default sort order for queries (e.g., `['-createdAt', 'name']`) |

**Notes:**
- "Scope Override" indicates whether the parameter can be overridden at the resource (scope) level
- `returnRecordApi` and `returnRecordTransport` can be either:
  - A string: `'no'`, `'minimal'`, or `'full'` (applies to all methods)
  - An object: `{ post: 'full', put: 'minimal', patch: 'no' }` (per-method configuration)
- All parameters support the cascade: per-call → resource-level → plugin-level default

# Custom ID parameter

TODO: Explain how idParam works, clarify that for the api it's always 'id' and there is no ID in the attributes

# Helpers and Methods Provided by REST API Plugins

The REST API plugins extend your API instance with various helpers and methods at different levels. Here's what becomes available:

## API-Level Helpers

When you install the REST API plugins, the following helpers are added to `api.helpers`:

### From RestApiPlugin

- **`api.helpers.getLocation(scopeName, id)`** - Generates the full URL for a resource
  ```javascript
  const url = api.helpers.getLocation('countries', '1');
  // Returns: 'http://localhost:3000/api/countries/1'
  ```

- **`api.helpers.getUrlPrefix(scope, context)`** - Gets the URL prefix for generating links
  ```javascript
  const prefix = api.helpers.getUrlPrefix(scope, context);
  // Returns: 'http://localhost:3000/api'
  ```

### From RestApiKnexPlugin

- **`api.helpers.newTransaction()`** - Creates a new database transaction for atomic operations
  ```javascript
  const trx = await api.helpers.newTransaction();
  try {
    // Use transaction in multiple operations
    await api.resources.countries.post({ name: 'France', code: 'FR' }, { transaction: trx });
    await api.resources.publishers.post({ name: 'French Press', country: 1 }, { transaction: trx });
    await trx.commit();
  } catch (error) {
    await trx.rollback();
    throw error;
  }
  ```

## API Namespaces

The plugins also create organized namespaces on the API instance:

### `api.knex` Namespace (from RestApiKnexPlugin)

- **`api.knex.instance`** - Direct access to the Knex database instance
  ```javascript
  // Run raw queries when needed
  const result = await api.knex.instance.raw('SELECT COUNT(*) FROM countries');
  ```

- **`api.knex.capabilities`** - Information about database capabilities
  ```javascript
  console.log(api.knex.capabilities);
  // { windowFunctions: true, dbInfo: { client: 'sqlite3', version: '3.36.0' } }
  ```

### `api.http` Namespace (from connector plugins)

When using ExpressPlugin:

- **`api.http.express.router`** - The Express router containing all API endpoints
- **`api.http.express.notFoundRouter`** - Express middleware for handling 404 errors

```javascript
// In your Express app
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);
```

## Resource-Level Methods

Each resource (added via `api.addResource()`) gets these methods automatically:

### CRUD Operations

- **`api.resources.{resourceName}.query(params)`** - List resources with filtering, sorting, pagination
  ```javascript
  const countries = await api.resources.countries.query({
    queryParams: {
      filters: { name: 'United' },
      sort: ['name'],
      page: { size: 10, number: 1 }
    }
  });
  ```

- **`api.resources.{resourceName}.get(params)`** - Retrieve a single resource by ID
  ```javascript
  const country = await api.resources.countries.get({ id: '1' });
  ```

- **`api.resources.{resourceName}.post(params)`** - Create a new resource
  ```javascript
  const newCountry = await api.resources.countries.post({
    name: 'Canada',
    code: 'CA'
  });
  ```

- **`api.resources.{resourceName}.put(params)`** - Replace an entire resource
  ```javascript
  const updated = await api.resources.countries.put({
    id: '1',
    name: 'United States of America',
    code: 'USA'
  });
  ```

- **`api.resources.{resourceName}.patch(params)`** - Partially update a resource
  ```javascript
  const patched = await api.resources.countries.patch({
    id: '1',
    name: 'USA'
  });
  ```

- **`api.resources.{resourceName}.delete(params)`** - Delete a resource
  ```javascript
  await api.resources.countries.delete({ id: '1' });
  ```

### Database Operations

- **`api.resources.{resourceName}.createKnexTable()`** - Creates the database table for this resource
  ```javascript
  // Create the table based on the schema definition
  await api.resources.countries.createKnexTable();
  ```


## API Namespaces (internal, for plugin developers)

### `api.rest` Namespace (from RestApiPlugin)

- **`api.rest.registerFileDetector(detector)`** - Registers file upload detectors (requires FileHandlingPlugin)
- **`api.rest.fileDetectors`** - Registry of file detectors for handling uploads

## Summary

These helpers and methods provide a complete toolkit for:
- Building RESTful APIs with full CRUD support
- Managing database transactions
- Generating proper URLs and links
- Accessing the underlying database when needed
- Integrating with web frameworks like Express

The architecture ensures clean separation between HTTP transport, business logic, and data persistence layers.