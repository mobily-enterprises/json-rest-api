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

Note that every time we provide a snippet of code, it will be assumed that

1. The script is edited in the section `/// *** ...programmatic calls here... ***`
2. The code is stopped with CTRL-C and then restarted. 
3. The core proposed in each snippet _replaces_ the code provided earlier.

This will ensure that each example has a fresh start.

Each example will be introduced programmatically first, and then via HTTP. The HTTP calls will be run assuming that the API calls (and any data created with them) stay. The use of the in-memory database will be assumed, which means that the data will start afresh each time.

## Database-First Design Philosophy

JSON REST API follows a **database-first** approach, providing different levels of abstraction for different audiences:

### For Backend Developers (Schema Definition, Hooks, and Internal Logic)

When defining schemas and writing hooks, you work directly with database reality:
- Schema fields map directly to database columns (`author_id`, `category_id`, `commentable_type`)
- Hooks receive actual database field names in `context.belongsToUpdates`
- Search schemas can reference exact database columns and table structures
- Full access to write raw Knex queries when needed

This direct approach ensures backend developers have complete control and visibility into database operations.

### For API Consumers (External Interface)

The API layer provides a clean abstraction that shields consumers from database implementation details:
- Relationships use semantic names (`author`, `category`) instead of foreign key fields
- Foreign key fields (`author_id`, `category_id`) are automatically filtered from API responses
- Polymorphic type/id fields (`commentable_type`, `commentable_id`) are hidden behind relationship objects
- Simplified mode returns intuitive objects without exposing database structure

### Why This Matters for Relationships

This abstraction is particularly important for **belongsTo** and **polymorphic** relationships, where foreign key fields would otherwise be exposed in API responses. The system ensures that:
- Input: Consumers provide relationships using clean names (`author: 123`)
- Output: Responses return relationship objects (`author: { id: '123' }`)
- Internal: Hooks and database operations work with actual columns (`author_id`)

This design provides the best of both worlds: backend developers get full database access for powerful implementations, while API consumers enjoy a clean, intuitive interface.

---

[Back to Guide](./README.md) | [Next: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)