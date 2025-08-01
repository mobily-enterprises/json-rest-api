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

const api = new Api({ name: 'bookstore-api', version: '1.0.0' });
await api.use(RestApiPlugin, { publicBaseUrl: '/api/v1' });
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

const api = new Api({ name: 'books-api', version: '1.0.0' });
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

const api = new Api({ name: 'full-featured-api', version: '1.0.0' });

// Core functionality
await api.use(RestApiPlugin, { publicBaseUrl: '/api/v1' });
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

const api = new Api({ name: 'books-api', version: '1.0.0' });
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

const api = new Api({ name: 'books-api', version: '1.0.0' });
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

For teams building JSON:API services in 2025, json-rest-api offers the best combination of compliance, features, and developer experience.