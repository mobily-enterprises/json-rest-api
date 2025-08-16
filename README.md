# JSON REST API

A powerful REST API plugin for [hooked-api](https://github.com/mobily-enterprises/hooked-api) that provides JSON:API-compliant endpoints with minimal configuration. This library makes it easy to create fully-featured REST APIs with support for relationships, filtering, sorting, pagination, and file uploads.

[Official Website](https://mobily-enterprises.github.io/json-rest-api/)

## Features

* **JSON:API Compliant** - Full support for the JSON:API specification
* **Relationship Support** - `belongsTo`, `hasMany`, and many-to-many relationships, including polymorphic
* **Advanced Querying** - Filtering, sorting, pagination, and field selection (sparse fieldsets)
* **File Uploads** - Built-in support for file handling with multiple storage adapters (local, S3)
* **Framework Agnostic** - Works with raw Node.js HTTP, Express, and other Node.js frameworks via flexible connectors
* **Validation** - Schema-based validation with detailed error messages and custom rules
* **Simplified Mode** - A developer-friendly option to work with plain JavaScript objects instead of verbose JSON:API structure
* **Extensible** - Built on `hooked-api`'s powerful plugin and hook system for deep customization

## Installation

```bash
npm install json-rest-api knex better-sqlite3 express
```

## Quick Start

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from './index.js'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {filename: ':memory:' }
});

// Create API instance
const api = new Api({ name: 'book-catalog-api', logLevel: 'trace' });

// Install plugins
await api.use(RestApiPlugin, {returnBasePath: '/api' });
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin


// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
  },
});
await api.resources.authors.createKnexTable();

// Run the server
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

- [Quick Start](QUICKSTART.md) - Quick start
- [Complete guide](GUIDE/) - Comprehensive guide
- [API Reference](API.md) - API reference
- [Why json-rest-api?](docs/COMPARISON.md) - Step-by-step tutorial