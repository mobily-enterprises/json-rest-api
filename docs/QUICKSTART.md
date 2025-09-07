# Quickstart


## Make a new npm project and install the basic NPM modules

```bash
mkdir quickstart-api
cd quickstart-api
npm init
npm install json-rest-api
npm install knex
npm install better-sqlite3
npm install express
```

These modules are all defined as peer dependencies and will be 

## Use ESM syntax for importing

Make sure package.json has `type: "module"` in it

## Create a basic file

```javascript
//
// index.js
//
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 8 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api'});

// Install plugins
await api.use(RestApiPlugin); // URLs auto-detected from request headers
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

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
```

## Add a couple of resources

In the snippet above, add a couple of related resourcs:

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
});
await api.resources.authors.createKnexTable();
```

## Run the program

```bash
$ node index.js 
2025-08-01T00:25:50.730Z [INFO] [book-catalog-api] Installing plugin 'rest-api'
2025-08-01T00:25:50.736Z [INFO] [book-catalog-api] Plugin 'rest-api' installed successfully { duration: '2ms' }
2025-08-01T00:25:50.736Z [INFO] [book-catalog-api] Installing plugin 'rest-api-knex' { options: '[Object with methods]' }
2025-08-01T00:25:50.745Z [INFO] [book-catalog-api:plugin:rest-api-knex] Database capabilities detected: { database: 'SQLite', version: '3.50.2', windowFunctions: true }
2025-08-01T00:25:50.746Z [INFO] [book-catalog-api:plugin:rest-api-knex] RestApiKnexPlugin installed - basic CRUD operations ready
2025-08-01T00:25:50.747Z [INFO] [book-catalog-api] Plugin 'rest-api-knex' installed successfully { duration: '10ms' }
2025-08-01T00:25:50.747Z [INFO] [book-catalog-api] Installing plugin 'express' { options: { mountPath: '/api' } }
2025-08-01T00:25:50.750Z [INFO] [book-catalog-api:plugin:express] Express plugin initialized successfully
2025-08-01T00:25:50.751Z [INFO] [book-catalog-api] Plugin 'express' installed successfully { duration: '4ms' }
2025-08-01T00:25:50.751Z [INFO] [book-catalog-api] Scope 'publishers' added successfully
2025-08-01T00:25:50.758Z [INFO] [book-catalog-api:global] Routes registered for scope 'publishers'
2025-08-01T00:25:50.763Z [INFO] [book-catalog-api] Scope 'authors' added successfully
2025-08-01T00:25:50.765Z [INFO] [book-catalog-api:global] Routes registered for scope 'authors'
Express server started on port 3000. API available at http://localhost:3000/api
```

Success!

## Try the API programmatically

Stop the server (CTRL-C).
Now, just after the creation of the knex table for authors, make some queries programmatically:

```javascript
// Method 1: Simplified mode without inputRecord (most concise)
const penguinResult = await api.resources.publishers.post({
  name: 'Penguin Random House'
});
console.log('Created publisher:', inspect(penguinResult));

// Method 2: Simplified mode with inputRecord (explicit)
const harperResult = await api.resources.publishers.post({
  inputRecord: {
    name: 'HarperCollins'
  }
});

// Method 3: Full JSON:API mode (standards compliant)
const oxfordResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Oxford University Press'
      }
    }
  },
  simplified: false
});
console.log('JSON:API response:', inspect(oxfordResult));

// Create an author linked to the first publisher (simplified)
const authorResult = await api.resources.authors.post({
  name: 'George',
  surname: 'Orwell',
  publisher: penguinResult.id
});
console.log('Created author:', inspect(authorResult));

// Get all publishers
const allPublishers = await api.resources.publishers.query({});
console.log('All publishers:', inspect(allPublishers));

// Get publisher with included authors
const publisherWithAuthors = await api.resources.publishers.get({
  id: penguinResult.id,
  include: ['authors']
});
console.log('Publisher with authors:', inspect(publisherWithAuthors));

// Search authors by name
const searchResult = await api.resources.authors.query({
  filter: { name: 'George' }
});
console.log('Search results:', inspect(searchResult));

// Update an author
const updateResult = await api.resources.authors.patch({
  id: authorResult.id,
  surname: 'Orwell (Eric Blair)'
});
console.log('Updated author:', inspect(updateResult));
```

The API supports three different ways to interact with resources programmatically:

1. **Simplified mode without inputRecord** (default): Pass attributes directly as top-level properties. This is the most concise approach.
2. **Simplified mode with inputRecord**: Explicitly wrap attributes in an `inputRecord` property. Still returns simplified objects.
3. **Full JSON:API mode**: Set `simplified: false` to use the complete JSON:API specification format for both requests and responses. This provides full standards compliance and access to all JSON:API features.

Restart the server, and watch the output:

```text
Created publisher: { id: '1', name: 'Penguin Random House', authors_ids: [] }
JSON:API response: {
  data: {
    type: 'publishers',
    id: '3',
    attributes: { name: 'Oxford University Press' },
    relationships: { authors: { data: [] } },
    links: { self: '/api/publishers/3' }
  },
  links: { self: '/api/publishers/3' }
}
Created author: { id: '1', name: 'George', surname: 'Orwell', publisher: { id: '1' } }
All publishers: {
  data: [
    { id: '1', name: 'Penguin Random House', authors: [ { id: '1' } ] },
    { id: '2', name: 'HarperCollins', authors: [] },
    { id: '3', name: 'Oxford University Press', authors: [] }
  ],
  links: { self: '/api/publishers' }
}
Publisher with authors: { id: '1', name: 'Penguin Random House', authors: [ { id: '1' } ] }
Search results: {
  data: [ { id: '1', name: 'George', surname: 'Orwell', publisher: { id: '1' } } ],
  links: { self: '/api/authors' }
}
Updated author: {
  id: '1',
  name: 'George',
  surname: 'Orwell (Eric Blair)',
  publisher: { id: '1' }
}
```

## Try the API via cURL

With the server running on port 3000 and the data created programmatically above, you can interact with the API using cURL:

```bash

# Get all publishers
curl http://localhost:3000/api/publishers

# Get all authors
curl http://localhost:3000/api/authors

# Get a specific publisher with included authors
curl "http://localhost:3000/api/publishers/1?include=authors"

# Search authors by name
curl "http://localhost:3000/api/authors?filter[name]=George"

# Search authors by publisher name (cross-table search)
curl "http://localhost:3000/api/authors?filter[publisherName]=Penguin"

# Get authors with sparse fields (only name and surname)
curl "http://localhost:3000/api/authors?fields[authors]=name,surname"

# Update an author
curl -X PATCH http://localhost:3000/api/authors/1 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "1",
      "attributes": {
        "surname": "Orwell (Blair)"
      }
    }
  }'

# Create a new author
curl -X POST http://localhost:3000/api/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "attributes": {
        "name": "Jane",
        "surname": "Austen"
      },
      "relationships": {
        "publisher": {
          "data": { "type": "publishers", "id": "2" }
        }
      }
    }
  }'

# Update the new author's surname
curl -X PATCH http://localhost:3000/api/authors/2 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "2",
      "attributes": {
        "surname": "Austen (1775-1817)"
      }
    }
  }'

# Update author's relationship to a different publisher
curl -X PATCH http://localhost:3000/api/authors/2 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "2",
      "relationships": {
        "publisher": {
          "data": { "type": "publishers", "id": "1" }
        }
      }
    }
  }'

# Delete the newly created author
curl -X DELETE http://localhost:3000/api/authors/2

# Get publishers with pagination
curl "http://localhost:3000/api/publishers?page[offset]=0&page[limit]=10"

# Sort authors by surname descending
curl "http://localhost:3000/api/authors?sort=-surname"
```

## Read the guide and party!

You've successfully set up a basic JSON REST API! This quickstart covered the essentials, but there's much more to explore.

Check out the [full guide](./GUIDE) to learn about:
- Advanced relationships (many-to-many, polymorphic)
- Authentication and authorization
- Hooks and middleware
- Custom validation
- Pagination strategies
- Performance optimization
- And much more!

Happy coding!
