# JSON REST API

Build powerful REST APIs in minutes with automatic validation, relationships, and advanced querying.

## Features

- 🚀 **Quick Setup** - Create a full API in under 5 minutes
- 🔌 **Plugin System** - Extend with storage adapters, auth, and more
- 🛡️ **Secure by Default** - JWT auth, RBAC, field security built-in
- 📊 **Advanced Queries** - Filtering, sorting, pagination, joins
- ✅ **Schema Validation** - Automatic validation and type safety
- 🎯 **Best Practices** - JSON:API compliant, RESTful design

## Get Started

Check out the [Quick Start Guide](QUICKSTART.md) to build your first API!

## Installation

```bash
npm install json-rest-api
```

## Example

```javascript
import { createApi, Schema } from 'json-rest-api';

const api = createApi({ storage: 'memory' });

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Full CRUD API ready at /api/users
```
