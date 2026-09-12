---
title: JSON REST API
---

# Resources in code. JSON:API over HTTP.

JSON REST API is a mini-ORM and JSON:API library for Node.js 24+. Define resource
schemas and relationships, call resource methods from application code, and
expose those resources through Express or Fastify when you need HTTP endpoints.

[Get started](QUICKSTART.md) · [Browse the numbered guide](GUIDE/index.md) · [Migrate to v2](GUIDE/33-migrating-to-v2.md)

## Call resources directly

After registering your resources, application code can create and query plain
records without an HTTP round trip:

```javascript
const author = await api.resources.authors.post({
  data: { name: 'George', surname: 'Orwell' }
})

const books = await api.resources.books.query({
  queryParams: {
    filters: { author: author.id },
    sort: ['title'],
    page: { number: 1, size: 20 }
  }
})
```

This fragment assumes an `authors` resource and a `books` resource with a declared
`author` filter and sortable `title`. The [quickstart](QUICKSTART.md) provides a
complete runnable setup, including the database, schemas and HTTP server.

## Choose the contract you need

| Area | What the library provides | Read next |
| --- | --- | --- |
| Records and relationships | CRUD, linkage, includes, sparse fields and polymorphic relationships | [Resources and relationships](GUIDE/02-resources-and-relationships.md) |
| Queries | Declared filters, sorting, numbered and cursor pagination | [Pagination and sorting](GUIDE/09-pagination-and-sorting.md) |
| Visibility | Permission hooks and mandatory row policies | [Row policies](GUIDE/17-row-policies.md) |
| Transactions | Explicit ownership, callback transactions and structured failure outcomes | [Managed transactions](GUIDE/19-managed-transactions.md) |
| HTTP | Express and Fastify connectors with JSON:API request and response handling | [Quickstart](QUICKSTART.md), [Fastify](GUIDE/23-fastify.md) |
| Extensions | Resource methods, sequential hooks and focused plugins | [Writing plugins](GUIDE/29-writing-plugins.md) |
| Storage | Ordinary resource tables or canonical storage through Knex | [Backend capabilities and limits](GUIDE/30-backend-capabilities.md) |

Programmatic calls default to plain records. Supply plain writes in `data` or
JSON:API input in `document`. Use `format: 'jsonapi'` for JSON:API output; the HTTP
connectors select that representation explicitly. Database
behavior, file cleanup and notification delivery have specific limits documented
in their chapters.

## Install and learn

```sh
npm install json-rest-api knex better-sqlite3 express
```

These are the v2 documentation. Existing applications should follow the
[migration guide](GUIDE/33-migrating-to-v2.md) before upgrading. For a source checkout
before publication, install its packed tarball instead of the registry version.

The [API reference](API.md) describes method arguments and defaults.
[Architecture](architecture.md) explains the implementation, and
[contributing](contributing.md) covers development and verification.
