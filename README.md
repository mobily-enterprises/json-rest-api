# JSON REST API

([Website](https://mobily-enterprises.github.io/json-rest-api/))

> **What if building REST APIs was as simple as defining schemas?**

Transform your schemas into fully-featured REST APIs with one line of code. No boilerplate. No repetition. Just pure productivity.

```javascript
// This is all you need for a complete REST API with validation, 
// pagination, filtering, and more:

import { createApi, Schema } from 'json-rest-api';
import express from 'express';

const app = express();
const api = createApi({ 
  storage: 'memory',
  http: { app }  // Pass Express app to enable HTTP
});

api.addResource('users', new Schema({
  name: { type: 'string', required: true, searchable: true },
  email: { type: 'string', unique: true, searchable: true },
  role: { type: 'string', enum: ['user', 'admin'], searchable: true }
}));

app.listen(3000); // Done! Full REST API ready at http://localhost:3000/api/users
```

---

*A heartfelt thank you to Dario and Daniela Amodei and the entire Anthropic team for creating transformative AI technology that opens endless possibilities for developers worldwide. Your vision, combined with incredibly accessible pricing, has democratized access to cutting-edge AI and empowered countless innovators to build the future. (No, we weren't asked nor paid in any way for this message - we're just genuinely grateful!)*

---

## ✨ The Magic

With just a schema definition, you get:

- ✅ **Complete REST endpoints** - GET, POST, PATCH, DELETE
- ✅ **Automatic validation** - Type checking, constraints, custom rules  
- ✅ **Smart querying** - Filtering, sorting, pagination, search
- ✅ **Relationships** - Automatic joins, nested includes
- ✅ **Versioning** - API and resource versioning built-in
- ✅ **JSON:API compliant** - Industry standard responses
- ✅ **Extensible** - Hooks, plugins, custom types
- ✅ **Multiple backends** - Memory (AlaSQL), MySQL, or build your own

## 🚀 See It In Action

```bash
npm install json-rest-api
```

```javascript
import { createApi, Schema } from 'json-rest-api';
import express from 'express';

// Create Express app
const app = express();

// Create your API - choose your storage
const api = createApi({
  storage: 'memory', // Perfect for development/testing
  http: { app }      // Enable HTTP endpoints
  
  // OR use MySQL for production:
  // storage: 'mysql',
  // connection: { host: 'localhost', database: 'myapp' },
  // http: { app }
});

// Define a resource (no relationships needed for simple example)
api.addResource('posts', new Schema({
  title: { type: 'string', required: true, min: 5, searchable: true },
  content: { type: 'string', required: true },
  author: { type: 'string', required: true, searchable: true },
  published: { type: 'boolean', default: false, searchable: true },
  tags: { type: 'array' },
  createdAt: { type: 'timestamp', default: () => Date.now() }
}));

// Start the server
app.listen(3000, () => {
  console.log('API running at http://localhost:3000/api');
});

// That's it! You now have:
// GET    /api/posts?filter[published]=true&filter[author]=jane
// GET    /api/posts?sort=-createdAt&page[size]=10
// POST   /api/posts
// PATCH  /api/posts/123
// DELETE /api/posts/123
```

## 🎯 Why This Library?

**Traditional approach:** Write controllers, validators, queries, serializers... hundreds of lines per resource.

**Our approach:** Define your schema. We handle everything else.

```javascript
// Need custom logic? Just hook in:
api.hook('beforeInsert', async (context) => {
  if (context.options.type === 'posts') {
    context.data.slug = slugify(context.data.title);
  }
});

// Need computed fields? Easy:
api.hook('afterGet', async (context) => {
  if (context.options.type === 'posts' && context.result) {
    // Add word count to each post
    context.result.wordCount = context.result.content.split(/\s+/).length;
  }
});
```

## 📚 Ready to Dive In?

**→ Just getting started?** Check out [QUICKSTART.md](docs/QUICKSTART.md) for a 5-minute tutorial

**→ Want to master it?** Read the comprehensive [Guide](docs/GUIDE.md)

**→ Need the details?** See the complete [API Reference](docs/API.md)

**→ Curious about internals?** Explore the [architecture docs](docs/architecture/)

## 🛠️ Quick Examples

<details>
<summary><strong>Automatic Validation</strong></summary>

```javascript
const userSchema = new Schema({
  email: { 
    type: 'string', 
    required: true,
    match: /^[^@]+@[^@]+\.[^@]+$/,
    lowercase: true
  },
  age: { type: 'number', min: 13, max: 120 },
  username: { 
    type: 'string', 
    required: true,
    min: 3,
    max: 20,
    match: /^[a-zA-Z0-9_]+$/
  }
});

// Validation happens automatically on all write operations
```
</details>

<details>
<summary><strong>Smart Relationships</strong></summary>

```javascript
// First, define the users resource
api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', required: true },
  avatar: { type: 'string' }
}));

// Then, define posts with a relationship to users
api.addResource('posts', new Schema({
  title: { type: 'string', required: true },
  content: { type: 'string', required: true },
  authorId: { 
    type: 'id',
    refs: { 
      resource: 'users',
      join: { 
        eager: true,           // Auto-include author
        fields: ['name', 'avatar'], // Only these fields
        resourceField: 'author'     // Place at post.author
      }
    }
  }
}));

// GET /api/posts returns:
{
  "data": [{
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "Hello World",
      "content": "My first post",
      "authorId": {
        "id": "42",
        "name": "Jane Doe",
        "avatar": "https://..."
      }
    }
  }]
}
```
</details>

<details>
<summary><strong>Powerful Queries</strong></summary>

```javascript
// All query combinations work out of the box:
GET /api/posts?
  filter[published]=true&
  filter[author]=jane&
  filter[tags]=javascript,nodejs&
  filter[createdAt][$gte]=2024-01-01&
  sort=-createdAt,title&
  page[size]=10&
  page[number]=2&
  fields[posts]=title,author,tags,createdAt
```
</details>

<details>
<summary><strong>Advanced Query Operators</strong></summary>

```javascript
// Comparison operators
GET /api/products?filter[price][gt]=100        // Greater than
GET /api/products?filter[price][gte]=100       // Greater than or equal
GET /api/products?filter[price][lt]=1000       // Less than
GET /api/products?filter[price][lte]=1000      // Less than or equal
GET /api/products?filter[status][ne]=draft     // Not equal

// Set operators
GET /api/products?filter[category][in]=electronics,accessories
GET /api/products?filter[tags][nin]=discontinued,legacy

// String operators
GET /api/products?filter[name][startsWith]=Apple
GET /api/products?filter[name][endsWith]=Pro
GET /api/products?filter[description][contains]=wireless
GET /api/products?filter[name][like]=%phone%   // SQL LIKE pattern

// Combine multiple operators
GET /api/products?
  filter[price][gte]=100&
  filter[price][lt]=1000&
  filter[category][in]=electronics,computers&
  filter[name][contains]=Pro
```
</details>

<details>
<summary><strong>API Versioning</strong></summary>

```javascript
// Version 1
const apiV1 = createApi({ 
  name: 'myapp', 
  version: '1.0.0' 
});

// Version 2 with breaking changes
const apiV2 = createApi({ 
  name: 'myapp', 
  version: '2.0.0' 
});

// Clients can request specific versions:
// GET /api/v1/users
// GET /api/v2/users
// GET /api/users (Header: API-Version: 2.0.0)
```
</details>

## 🔌 Extensible Plugin System

```javascript
// Use built-in plugins
api
  .use(MySQLPlugin, { connection: dbConfig })
  .use(TimestampsPlugin)      // Adds createdAt/updatedAt
  .use(ValidationPlugin)      // Schema validation
  .use(VersioningPlugin)      // API and resource versioning
  .use(LoggingPlugin)         // Structured logging
  .use(SecurityPlugin)        // Security headers & rate limiting

// Or create your own
const SlugPlugin = {
  install(api) {
    api.hook('beforeInsert', async (ctx) => {
      if (ctx.data.title) {
        ctx.data.slug = slugify(ctx.data.title);
      }
    });
  }
};
```

## 🏗️ Production Ready

- **Battle-tested** - 95% test coverage
- **Performance** - Optimized queries, connection pooling
- **Security** - Built-in protections against common vulnerabilities
- **Monitoring** - Structured logging, error tracking
- **Standards** - JSON:API compliant, REST best practices

## 🔒 Security Features

### Built-in Protections

- **SQL Injection Prevention** - Parameterized queries and identifier escaping
- **Prototype Pollution Protection** - Automatic sanitization of dangerous keys
- **Circular Reference Protection** - Prevents DoS from circular JSON structures
- **Input Size Validation** - Configurable limits on arrays and objects
- **Error Sanitization** - Stack traces hidden in production
- **Content-Type Validation** - Strict media type checking
- **JWT Authentication** - Secure token-based auth via JwtPlugin
- **CORS Support** - Configurable cross-origin policies
- **ReDoS Protection** - Safe regex patterns with timeout detection
- **Timing Attack Prevention** - Constant-time token validation

### Example: Input Validation

```javascript
const schema = new Schema({
  email: {
    type: 'string',
    format: 'email'  // Safe email validation with ReDoS protection
  },
  tags: { 
    type: 'array',
    maxItems: 100    // Prevent DoS from huge arrays
  },
  metadata: { 
    type: 'object',
    maxKeys: 50,     // Limit object properties
    maxDepth: 5      // Limit nesting depth
  }
});
```

### Example: Content-Type Validation

```javascript
api.use(HTTPPlugin, {
  app,
  validateContentType: true,  // Default: true
  allowedContentTypes: ['application/json', 'application/vnd.api+json']
});
```

See [Security Guide](docs/GUIDE_7_Security.md) for comprehensive security documentation.

For JSON:API specification compliance details, see [JSON:API Compliance Guide](docs/JSON-API-COMPLIANCE.md).

## Installation

```bash
npm install json-rest-api
```

## License

MIT

---

**Ready to build something amazing?** Start with [QUICKSTART.md](docs/QUICKSTART.md) →