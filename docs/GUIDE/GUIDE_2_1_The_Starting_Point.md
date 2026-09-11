# 2.1 The starting point

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express';

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
const api = new Api({ name: 'book-catalog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' }); // Links are generated under /api

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

Note that every time we provide a snippet of code, it will be assumed that

1. The script is edited in the section `/// *** ...programmatic calls here... ***`
2. The code is stopped with CTRL-C and then restarted. 
3. The code proposed in each snippet _replaces_ the code provided earlier.

This will ensure that each example has a fresh start.

Each example will be introduced programmatically first, and then via HTTP. The HTTP calls will be run assuming that the API calls (and any data created with them) stay. The use of the in-memory database will be assumed, which means that the data will start afresh each time.

## Logical fields and storage columns

Resource definitions describe logical fields and relationships. Table-backed
storage maps those fields to physical columns: snake_case by default, explicit
`storage.column` overrides, or exact naming when configured. Canonical storage
uses its own allocation and descriptor mapping. A logical field name is not a
portable physical SQL column name.

For a definition such as `country_id: { type: 'id', belongsTo: 'countries',
as: 'country' }`, callers write the relationship through
`inputRecord: { country: countryId }`. Plain output contains a `country` object
with its ID; an unassigned to-one relationship is omitted from plain output.
Including the country adds its selected attributes.
JSON:API output represents linkage under `data.relationships.country` and
included records under `included`.

Hooks operate at specific processing stages. The write pipeline converts plain
input into its internal JSON:API representation before validation and storage.
Do not assume every hook receives raw columns or the original public payload.
Use the [hook guide](GUIDE_7_Hooks_Data_Management_And_Plugins.md) and the
[API reference](../API.md) for the context available at each stage.

Search schemas name the filters callers may use and map them to logical fields
or declared related-resource fields. Raw SQL remains available through Knex,
but code that uses physical tables/columns must account for the selected storage
backend and does not automatically inherit resource access policies.

---

[Back to Guide](index.md) | [Next: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)
