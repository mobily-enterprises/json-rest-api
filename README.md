# JSON REST API

A JSON:API library and mini-ORM for Node.js 24+. Define resources once, call them directly from application code, or expose them through HTTP connectors. It supports relationships, filtering, sorting, pagination, managed transactions and file uploads.

[Official Website](https://mobily-enterprises.github.io/json-rest-api/)

## Features

* **JSON:API Endpoints** - Resource documents, relationship linkage, includes, and sparse fields
* **Relationship Support** - `belongsTo`, `hasMany`, and many-to-many relationships, including polymorphic
* **Advanced Querying** - Filtering, sorting, pagination, and field selection (sparse fieldsets)
* **Server-Side Row Policies** - Apply mandatory visibility rules before pagination, counts, and relationship loading
* **File Uploads** - File handling with local storage and custom storage adapters
* **Framework Agnostic** - Includes Express and Fastify connectors
* **Validation** - Schema-based validation with detailed error messages and custom rules
* **Plain Records** - Write plain values with `data` or JSON:API documents with `document`; choose output independently with `format`
* **Extensible** - Resource methods, sequential hooks and explicit plugin installation

## Installation

Requires Node.js 24 or newer. Development and CI test Node 24 only; `.nvmrc`
pins the current verification baseline.

```bash
npm install json-rest-api knex better-sqlite3 express
```

## Quick Start

```javascript
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import knexLib from 'knex';
import express from 'express';

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {filename: ':memory:' }
});

// Create API instance
const api = new JsonRestApi({ name: 'book-catalog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, { mountPath: '/api' }); // Express connector


// Define an authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
  },
});
await api.resources.authors.createKnexTable();

// Run the server
const app = express();
api.http.express.mount(app);
app.listen(3000, () => {
  console.log('Express server started on port 3000. API available at http://localhost:3000/api');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});

// Your API is ready! Try:
// GET http://localhost:3000/api/authors
// POST http://localhost:3000/api/authors
```

## Documentation

The [API migration guide](docs/GUIDE/33-migrating-to-v2.md) describes the breaking
v2 API changes and the steps for upgrading applications.


- [Quick Start](docs/QUICKSTART.md) - Quick start
- [Complete guide](docs/GUIDE/index.md) - Comprehensive guide
- [API Reference](docs/API.md) - API reference
- [Backend capabilities and limits](docs/GUIDE/30-backend-capabilities.md) - Databases, precision, migrations, transactions and storage gaps

## Development

See [contributing](docs/contributing.md) for setup, focused checks, native database
verification and releases. [Architecture](docs/architecture.md) maps the main
execution paths. Test fixture conventions live in `tests/README.md` in a source checkout.

```sh
nvm use
npm ci
npm run verify
```

The full gate includes types, package contracts, query budgets, both SQLite
storage suites, Express 4, lint and the documentation build. Native database,
Redis and fresh-install checks are separate commands described in contributing.
Use `npm run docs:dev -- --no-open` to serve the documentation locally.

## License

Choose either the [MIT license](LICENSE-MIT) or the
[GNU GPL version 3 or later](LICENSE-GPL-3.0). See [LICENSE](LICENSE) for the
dual-license notice. Dependencies retain their own licenses.
