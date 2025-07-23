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
npm install json-rest-api hooked-api json-rest-schema knex sqlite3
```

> **Note:** `json-rest-schema` and a database driver like `knex` and `sqlite3` are peer dependencies, meaning you need to install them explicitly. This gives you control over your database choice.

## Quick Start

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from 'json-rest-api/plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from 'json-rest-api/plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from 'json-rest-api/plugins/core/connectors/express-plugin.js';
import express from 'express';
import knex from 'knex';

// Create API instance
const api = new Api({ name: 'my-api' });

// Set up database
const db = knex({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(ExpressPlugin, { app: express() });

// Define a resource
await api.addScope('articles', {
  restApi: {
    schema: {
      attributes: {
        title: { type: 'string', required: true },
        content: { type: 'string' },
        publishedAt: { type: 'string', format: 'date-time' }
      }
    }
  }
});

// Mount Express routes
const app = express();
api.http.express.mount(app);
app.listen(3000);

// Your API is ready! Try:
// GET http://localhost:3000/api/articles
// POST http://localhost:3000/api/articles
```

## Documentation

### Core Guides
- [Initial Setup Guide](README_1_Initial_Setup.md) - Complete walkthrough for getting started
- [Computed and Hidden Fields](README_2_Computed_and_hidden_fields.md) - Advanced field handling
- [Hook System Guide](README_X_Hooks.md) - Extend and customize API behavior
- [API Tutorial](docs/GUIDE.md) - Step-by-step tutorial

### Feature Guides
- [Permissions & Authentication](README_X_Permissions.md) - JWT auth and declarative permissions
- [CORS Configuration](README_X_Cors.md) - Cross-origin resource sharing setup
- [Relationships](README_X_Relationship_Plugin.md) - Working with related data
- [Bulk Operations](README_X_Bulk_Operations.md) - Efficient batch processing
- [File Uploads](docs/fileUploads.md) - Handling file uploads
- [WebSocket Support](README_X_SocketIO.md) - Real-time updates with Socket.IO

### Advanced Topics
- [Polymorphic Relationships](README_8_Polymorphic_Relationships.md) - Flexible relationship patterns
- [Multi-tenancy](README_X_Multihome.md) - Isolating data by tenant
- [Advanced Relationships](RELATIONSHIPS_ADVANCED.md) - Complex relationship scenarios

## License

MIT



