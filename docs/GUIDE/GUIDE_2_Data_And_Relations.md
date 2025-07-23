# Data and relations

* Power is in relations
* Not an ORM: a JSON:API compliant API
* Defining dataset and explaining all possible relations

## The starting point

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
const api = new Api({ name: 'book-catalog-api', version: '1.0.0' });

// Install plugins
await api.use(RestApiPlugin, { publicBaseUrl: '/api/1.0' });
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  },
/*  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
*/
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

// Createthe express server and add the API's routes 
const app = express();
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);

app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
});
```


## Queries and fields with no relationships

In the example above, a resource without any relationship is clearly `countries`:

```javascript
// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
```

It just has two fields, name and code, both searchable.

Programmatically you can `post` and `get` easily:

```javascript
const addedFrance = await api.resources.countries.post({ name: 'France', code: 'FR' });
console.log('Added record    :', inspect(addedFrance))

const fetchedFrance = await api.resources.countries.get({ id: addedFrance.id });
console.log('Refetched record:', inspect(fetchedFrance))
```

After the logging messages, you will see:

```text
Added record    : { id: '1', name: 'France', code: 'FR' }
Refetched record: { id: '1', name: 'France', code: 'FR' }
Express server started on port 3000. API available at http://localhost:3000/api
```

You can do the same thing talking to the server directly (although you will be dealing with JSON:API results):

```bash
$ curl -i -X POST -H "Content-Type: application/vnd.api+json" -d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```
```text
HTTP/1.1 204 No Content
X-Powered-By: Express
Location: /api/1.0/countries/1
ETag: W/"a-bAsFyilMr4Ra1hIU5PyoyFRunpI"
Date: Wed, 23 Jul 2025 07:54:09 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```
```bash
$ curl -i -X GET http://localhost:3000/api/countries/1
```
```text
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/vnd.api+json; charset=utf-8
Content-Length: 169
ETag: W/"a9-lnEVXaZ/V6qra0YgjpoEBUTZ3EY"
Date: Wed, 23 Jul 2025 07:54:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":{"type":"countries","id":"2","attributes":{"name":"United Kingdom","code":"UK"},"links":{"self":"/api/1.0/countries/2"}},"links":{"self":"/api/1.0/countries/2"}}
```

Note: since in these examples we are using the memory store, every time you stop the server from running you will reset the data.

#### Sparse fields on get calls

The JSON:API specification allows clients to request only a subset of fields for a given resource, a feature known as "sparse fieldsets". This is crucial for optimizing network traffic by reducing the size of the response payload, especially when dealing with large records.

You can specify which fields to return using the `fields[resourceType]=field1,field2` query parameter.

CLAUDE: Write an example of defining what fields to return when doing a get


### Search (Filtering)

CLAUDE: Write an example of searching. Add three countries, and then run a search on them, see the result

#### Sparse fields on queries

**Programmatic Example: Get only `name` for `countries`**

```javascript
TODO
```

**HTTP Example:**

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


