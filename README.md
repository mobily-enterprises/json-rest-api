# JSON REST API

A modern, plugin-based JSON REST API library with JSON:API compliance, schema validation, and extensible storage backends.

## Features

- **Plugin Architecture**: Extensible through plugins using `.use()` pattern
- **JSON:API Compliant**: Follows JSON:API specification for RESTful APIs
- **Schema Validation**: Built-in schema validation with extensible types and parameters
- **Multiple Storage Backends**: Memory and MySQL support out of the box
- **Automatic API Versioning**: Built-in version management with automatic routing
- **Positioning**: Manage record ordering with drag-and-drop support
- **Resource Versioning**: Track changes with version history
- **TypeScript-like Schema**: Define schemas with types, validation rules, and defaults
- **Hooks System**: Extensible through before/after hooks
- **Express Integration**: Easy integration with Express.js
- **Security**: Built-in security plugin with rate limiting, CORS, and authentication
- **Logging**: Structured logging with sensitive data redaction
- **OpenAPI**: Auto-generated API documentation

## Installation

```bash
npm install jsonrestapi
```

## Quick Start

```javascript
import { createApi, Schema } from 'jsonrestapi';
import express from 'express';

// Create an API with automatic versioning
const api = createApi({
  name: 'myapp',
  version: '1.0.0',
  storage: 'memory',
  http: { basePath: '/api' }
});

// Define a schema
const userSchema = new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true, min: 2, max: 100 },
  email: { type: 'string', required: true, lowercase: true },
  active: { type: 'boolean', default: true }
});

// Register the schema
api.addResource('users', userSchema);

// Create Express app and mount API
const app = express();
api.mount(app);

app.listen(3000);
```

## Core Concepts

### Schema Definition

Schemas define the structure and validation rules for your data:

```javascript
const schema = new Schema({
  // Numeric types
  id: { type: 'id' },
  age: { type: 'number', min: 0, max: 150 },
  price: { type: 'number', currency: true },
  
  // String types
  name: { type: 'string', required: true, min: 2, max: 50 },
  email: { type: 'string', lowercase: true },
  description: { type: 'string', max: 1000 },
  
  // Boolean type
  active: { type: 'boolean', default: true },
  
  // Date types
  createdAt: { type: 'timestamp', default: () => Date.now() },
  birthDate: { type: 'date' },
  lastLogin: { type: 'dateTime' },
  
  // Complex types
  tags: { type: 'array', default: [] },
  metadata: { type: 'object' },
  
  // Special types
  data: { type: 'serialize' }, // Circular JSON support
  file: { type: 'blob' }
});
```

### Plugin System

Extend functionality through plugins:

```javascript
const api = new Api();

api
  .use(ValidationPlugin)
  .use(MySQLPlugin, { connection: dbConfig })
  .use(HTTPPlugin, { basePath: '/api' })
  .use(PositioningPlugin)
  .use(VersioningPlugin, { trackHistory: true });
```

### Custom Plugins

Create your own plugins:

```javascript
const MyPlugin = {
  install(api, options) {
    // Add new methods
    api.myMethod = () => { /* ... */ };
    
    // Register hooks
    api.hook('beforeInsert', async (context) => {
      // Modify context before insert
    });
    
    // Add custom types
    api.registerType('myType', ({ value }) => {
      // Custom type logic
      return processedValue;
    });
  }
};

api.use(MyPlugin, { /* options */ });
```

## API Methods

### CRUD Operations

```javascript
// Get single resource
const user = await api.get('123', { type: 'users' });

// Query resources
const users = await api.query({
  filter: { active: true },
  sort: '-createdAt,name',
  page: { size: 20, number: 1 }
}, { type: 'users' });

// Insert resource
const newUser = await api.insert({
  name: 'John Doe',
  email: 'john@example.com'
}, { type: 'users' });

// Update resource
const updated = await api.update('123', {
  name: 'Jane Doe'
}, { type: 'users' });

// Delete resource
await api.delete('123', { type: 'users' });
```

### HTTP Endpoints

When using HTTPPlugin, the following endpoints are available:

- `GET /api/{type}` - List resources
- `GET /api/{type}/{id}` - Get single resource
- `POST /api/{type}` - Create resource
- `PATCH /api/{type}/{id}` - Update resource
- `DELETE /api/{type}/{id}` - Delete resource

Query parameters:
- `filter[field]=value` - Filter by field
- `sort=-field1,field2` - Sort by fields
- `page[size]=10&page[number]=2` - Pagination
- `include=relation1,relation2` - Include relationships

## Storage Backends

### Memory Storage

```javascript
api.use(MemoryPlugin, {
  initialData: [
    { id: 1, name: 'Item 1' },
    { id: 2, name: 'Item 2' }
  ]
});
```

### MySQL Storage

```javascript
api.use(MySQLPlugin, {
  connection: {
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'myapp'
  }
});

// Sync schema with database
await api.syncSchema(userSchema, 'users');
```

## Advanced Features

### Positioning

Manage record order:

```javascript
api.use(PositioningPlugin);

// Insert at specific position
await api.insert({
  name: 'Item',
  beforeId: '123' // Place before item with ID 123
}, {
  type: 'items',
  positioning: { enabled: true }
});

// Reposition existing item
await api.reposition('items', '456', null); // Move to end
```

### API Versioning

Create multiple versions of your API with automatic version negotiation:

```javascript
// Version 1.0.0
const apiV1 = createApi({
  name: 'users',
  version: '1.0.0',
  storage: 'memory'
});

apiV1.addResource('users', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
}));

// Version 2.0.0 with new fields
const apiV2 = createApi({
  name: 'users',
  version: '2.0.0',
  storage: 'memory'
});

apiV2.addResource('users', new Schema({
  id: { type: 'id' },
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  phone: { type: 'string' },  // New field
  active: { type: 'boolean', default: true }  // New field
}));

// Automatic version selection
const api = Api.get('users', 'latest');  // Gets v2.0.0
const apiV1Compat = Api.get('users', '1.0.0');  // Gets v1.0.0 or higher

// HTTP endpoints with automatic versioning
// GET /api/1.0.0/users
// GET /api/2.0.0/users
// GET /api/users?v=2.0.0
// GET /api/users (with API-Version: 2.0.0 header)
```

### Resource Versioning

Track changes to individual resources:

```javascript
api.use(VersioningPlugin, {
  trackHistory: true,
  optimisticLocking: true
});

// Automatic version tracking
const user = await api.insert({ name: 'John' }, { type: 'users' });
// user.version = 1

const updated = await api.update(user.id, { name: 'Jane' }, { type: 'users' });
// updated.version = 2

// Get version history
const history = await api.getVersionHistory('users', user.id);

// Restore previous version
await api.restoreVersion('users', user.id, 1);

// Compare versions
const diff = await api.diffVersions('users', user.id, 1, 2);
```

### Hooks

Extend behavior with hooks:

```javascript
// Validation hooks
api.hook('beforeValidate', async (context) => {
  // Modify data before validation
});

api.hook('afterValidate', async (context) => {
  // Add custom validation
  if (context.data.price < 0) {
    context.errors.push({
      field: 'price',
      message: 'Price cannot be negative'
    });
  }
});

// CRUD hooks
api.hook('beforeInsert', async (context) => {
  context.data.createdBy = context.options.userId;
});

api.hook('transformResult', async (context) => {
  // Add computed fields
  if (context.result) {
    context.result.displayName = context.result.name.toUpperCase();
  }
});
```

## Schema Extensions

Add custom types and parameters:

```javascript
// Custom type
schema.registerType('phone', ({ value }) => {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length !== 10) {
    throw new Error('Invalid phone number');
  }
  return cleaned;
});

// Custom parameter
schema.registerParam('unique', async ({ value, fieldName, object }) => {
  const exists = await checkUniqueness(fieldName, value);
  if (exists) {
    throw new Error(`${fieldName} must be unique`);
  }
});

// Use in schema
const schema = new Schema({
  phone: { type: 'phone', required: true },
  username: { type: 'string', unique: true }
});
```

## Cross-API Communication

APIs can access each other with automatic version compatibility:

```javascript
// Orders API can access Users API
const ordersApi = createApi({
  name: 'orders',
  version: '1.0.0'
});

ordersApi.hook('afterInsert', async (context) => {
  // Automatically gets a compatible users API
  const usersApi = ordersApi.apis.users;
  
  if (usersApi && context.data.userId) {
    const user = await usersApi.get(context.data.userId, { type: 'users' });
    console.log('Order created for:', user);
  }
});
```

## Security Best Practices

Enable comprehensive security features:

```javascript
import { SecurityPlugin, LoggingPlugin } from 'jsonrestapi';

api
  .use(SecurityPlugin, {
    rateLimit: { max: 100, windowMs: 15 * 60 * 1000 },
    authentication: { type: 'bearer', required: true },
    cors: { origin: 'https://app.example.com' }
  })
  .use(LoggingPlugin, {
    level: 'info',
    auditLog: true
  });
```

## Error Handling

Errors follow JSON:API format:

```javascript
try {
  await api.insert({ name: '' }, { type: 'users' });
} catch (error) {
  console.log(error.errors);
  // [{
  //   status: '422',
  //   title: 'Validation Error',
  //   detail: 'Field required',
  //   source: { pointer: '/data/attributes/name' }
  // }]
}
```

## License

MIT