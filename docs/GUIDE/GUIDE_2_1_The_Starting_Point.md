# 2.1 The starting point

```javascript
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
const api = new Api({ name: 'book-catalog-api' });

// Install plugins
await api.use(RestApiPlugin, {returnBasePath: '/api' });
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

Note that every time we provide a snippet of code, it will be assumed that

1. The script is edited in the section `/// *** ...programmatic calls here... ***`
2. The code is stopped with CTRL-C and then restarted. 
3. The core proposed in each snippet _replaces_ the code provided earlier.

This will ensure that each example has a fresh start.

Each example will be introduced programmatically first, and then via HTTP. The HTTP calls will be run assuming that the API calls (and any data created with them) stay. The use of the in-memory database will be assumed, which means that the data will start afresh each time.

---

[Back to Guide](./README.md) | [Next: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)