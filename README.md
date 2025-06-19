# JSON REST API

> **What if building REST APIs was as simple as defining schemas?**

Transform your schemas into fully-featured REST APIs with one line of code. No boilerplate. No repetition. Just pure productivity.

```javascript
// This is all you need for a complete REST API with validation, 
// pagination, filtering, and more:

const api = createApi({ storage: 'memory' });

api.addResource('users', new Schema({
  name: { type: 'string', required: true },
  email: { type: 'string', unique: true },
  role: { type: 'string', enum: ['user', 'admin'] }
}));

api.mount(app); // Done! Full REST API ready at /api/users
```

## ✨ The Magic

With just a schema definition, you get:

- ✅ **Complete REST endpoints** - GET, POST, PATCH, DELETE
- ✅ **Automatic validation** - Type checking, constraints, custom rules  
- ✅ **Smart querying** - Filtering, sorting, pagination, search
- ✅ **Relationships** - Automatic joins, nested includes
- ✅ **Versioning** - API and resource versioning built-in
- ✅ **JSON:API compliant** - Industry standard responses
- ✅ **Extensible** - Hooks, plugins, custom types
- ✅ **Multiple backends** - Memory, MySQL, or build your own

## 🚀 See It In Action

```bash
npm install json-rest-api
```

```javascript
import { createApi, Schema } from 'json-rest-api';
import express from 'express';

// Create your API
const api = createApi({
  storage: 'mysql',
  connection: { host: 'localhost', database: 'myapp' }
});

// Define a resource with relationships
api.addResource('posts', new Schema({
  title: { type: 'string', required: true, min: 5 },
  content: { type: 'string', required: true },
  authorId: { 
    type: 'id', 
    refs: { 
      resource: 'users',
      join: { eager: true, fields: ['name', 'avatar'] }
    }
  },
  published: { type: 'boolean', default: false },
  tags: { type: 'array' }
}));

// That's it! You now have:
// GET    /api/posts?filter[published]=true&include=author
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
  if (context.options.type === 'users' && context.result) {
    const posts = await api.resources.posts.query({
      filter: { authorId: context.result.id }
    });
    context.result.postCount = posts.meta.total;
  }
});
```

## 📚 Ready to Dive In?

**→ Just getting started?** Check out [GET_STARTED.md](docs/GET_STARTED.md) for a 5-minute tutorial

**→ Want to master it?** Read the comprehensive [GUIDES.md](docs/GUIDES.md)

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
// Define relationships in your schema
const postSchema = new Schema({
  title: { type: 'string', required: true },
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
});

// GET /api/posts returns:
{
  "data": [{
    "id": "1",
    "type": "posts",
    "attributes": {
      "title": "Hello World",
      "authorId": "42",
      "author": {
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
  filter[tags]=javascript,nodejs&
  filter[createdAt][$gte]=2024-01-01&
  sort=-createdAt,title&
  page[size]=10&
  page[number]=2&
  include=author,comments.author&
  fields[posts]=title,summary&
  fields[users]=name,avatar
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
  .use(TimestampsPlugin)  // Adds createdAt/updatedAt
  .use(SoftDeletePlugin)  // Adds deletedAt
  .use(AuditPlugin)       // Tracks who changed what

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
- **Security** - Rate limiting, CORS, authentication hooks
- **Monitoring** - Structured logging, error tracking
- **Standards** - JSON:API compliant, REST best practices

## Installation

```bash
npm install json-rest-api
```

## License

MIT

---

**Ready to build something amazing?** Start with [GET_STARTED.md](docs/GET_STARTED.md) →