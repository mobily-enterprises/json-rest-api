# JSON REST API

A lightweight, plugin-based REST API framework for Node.js that speaks native JSON:API.

## Documentation

- [Quick Start](QUICKSTART.md) - Get up and running in 5 minutes
- [Complete Guide](GUIDE.md) - In-depth documentation with examples
- [API Reference](API.md) - Detailed API documentation
- [Onboarding Guide](ONBOARDING.md) - Step-by-step tutorial

## Features

- **Plugin Architecture** - Extend functionality with plugins
- **JSON:API Compliant** - Native JSON:API support
- **Multiple Storage Backends** - In-memory (AlaSQL) or MySQL
- **Schema Validation** - Built-in runtime validation
- **Smart Relationships** - Automatic joins and nested queries
- **Hooks System** - Lifecycle events for all operations

## Quick Example

```javascript
import { Api, HTTPPlugin, MemoryPlugin } from 'json-rest-api'
import { Schema } from 'json-rest-api'
import express from 'express'

const api = new Api()
api.use(MemoryPlugin)
api.use(HTTPPlugin, { app: express() })

const userSchema = new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', format: 'email' }
})

api.addResource('users', userSchema)
api.listen(3000)
```

## Installation

```bash
npm install json-rest-api
```

## License

MIT