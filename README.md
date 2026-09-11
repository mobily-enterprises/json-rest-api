# JSON REST API

A powerful REST API plugin for [hooked-api](https://github.com/mobily-enterprises/hooked-api) that provides JSON:API-compliant endpoints with minimal configuration. This library makes it easy to create fully-featured REST APIs with support for relationships, filtering, sorting, pagination, and file uploads.

[Official Website](https://mobily-enterprises.github.io/json-rest-api/)

## Features

* **JSON:API Endpoints** - Resource documents, relationship linkage, includes, and sparse fields
* **Relationship Support** - `belongsTo`, `hasMany`, and many-to-many relationships, including polymorphic
* **Advanced Querying** - Filtering, sorting, pagination, and field selection (sparse fieldsets)
* **Server-Side Row Policies** - Apply mandatory visibility rules before pagination, counts, and relationship loading
* **File Uploads** - Built-in support for file handling with local storage and a mock S3-style demo adapter
* **Framework Agnostic** - Includes Express and Fastify connectors
* **Validation** - Schema-based validation with detailed error messages and custom rules
* **Plain Records** - Programmatic calls use plain objects; choose `format: 'jsonapi'` for documents
* **Extensible** - Built on `hooked-api`'s powerful plugin and hook system for deep customization

## Installation

Requires Node.js 24 or newer. Development and CI test Node 24 only; `.nvmrc`
pins the current verification baseline.

```bash
npm install json-rest-api knex better-sqlite3 express
```

## Quick Start

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import express from 'express';

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {filename: ':memory:' }
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', logging: { level: 'trace' } });

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

The [API migration guide](docs/GUIDE/MIGRATING_API_V2.md) describes the breaking
response-option changes being implemented in this worktree and their release status.


- [Quick Start](docs/QUICKSTART.md) - Quick start
- [Complete guide](docs/GUIDE/index.md) - Comprehensive guide
- [API Reference](docs/API.md) - API reference
- [Backend capabilities and limits](docs/GUIDE/BACKEND_CAPABILITIES.md) - Databases, precision, migrations, transactions and storage gaps

## Development

Contributor references below require a source checkout; they are excluded from
the npm package. The repository also contains `docs/COMPARISON.md`.

See Testing json-rest-api (source checkout: `tests/README.md`) for contributor fixture rules,
current request examples and the verification command matrix.

Use the Node version in `.nvmrc` and install dependencies with `npm ci`.
See the clean-checkout verification guide (source checkout: `docs/development/verification.md`)
for Ruby/Bundler setup, supported development runtimes and current coverage.
The real-database guide (source checkout: `docs/development/real-databases.md`) explains disposable
PostgreSQL/MySQL setup and the separate integration commands.

```bash
# Run types, query budgets, both SQLite suites, Express 4, lint and documentation
npm run verify

# Run lint separately
npm run lint

# Run the focused normalizeId suites directly
npm run test:id-contracts
npm run test:id-contracts:anyapi

# Build the docs site in docs/_site
npm run docs

# Serve the docs locally with live rebuild
npm run docs:dev
```
