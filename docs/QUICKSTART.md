---
title: "Quickstart"
---

# Quickstart

Use Node 24 or newer. Development verification runs on Node 24. This example
uses an in-memory SQLite database: restarting the process discards its records.

## Install

```bash
mkdir quickstart-api
cd quickstart-api
npm init -y
npm pkg set type=module
npm install json-rest-api knex better-sqlite3 express
```

These examples use the revised API described in the
[migration guide](GUIDE/33-migrating-to-v2.md). Until that release is published,
install the intended library tarball in place of the registry package.

## Define resources

Create `index.js` with the following code. Install the HTTP connector before
registering resources so it can register their routes.

```javascript
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin, ExpressPlugin } from 'json-rest-api'
import knexLib from 'knex'
import express from 'express'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const api = new JsonRestApi({ name: 'book-catalog-api' })
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.use(ExpressPlugin, { mountPath: '/api' })

await api.addResource('publishers', {
  schema: {
    name: { type: 'string', required: true, max: 255, search: true }
  },
  relationships: {
    authors: { type: 'hasMany', target: 'authors', foreignKey: 'publisher_id' }
  }
})
await api.addResource('authors', {
  schema: {
    name: { type: 'string', required: true, max: 100, search: true },
    surname: { type: 'string', required: true, max: 100 },
    publisher_id: { type: 'id', belongsTo: 'publishers', as: 'publisher', nullable: true }
  },
  searchSchema: {
    nameContains: { type: 'string', actualField: 'name', filterOperator: 'contains' }
  }
})
await api.resources.publishers.createKnexTable()
await api.resources.authors.createKnexTable()
```

`searchSchema` declares accepted public filters; `actualField` maps a filter to
a resource field. See [searching](GUIDE/04-creating-and-querying.md)
for more complex filters and [schema migrations](GUIDE/21-schema-and-migrations.md)
for persistent databases.

## Call the API programmatically

Append this code before starting the HTTP server:

```javascript
const publisher = await api.resources.publishers.post({
  data: { name: 'Penguin Random House' }
})
const author = await api.resources.authors.post({
  data: { name: 'George', surname: 'Orwell', publisher: publisher.id }
})

const found = await api.resources.authors.query({
  queryParams: {
    filters: { nameContains: 'Georg' },
    sort: ['surname'],
    page: { number: 1, size: 10 }
  }
})
console.log('Matching authors:', found.data)
console.log('Pagination:', found.meta.pagination)

const withAuthors = await api.resources.publishers.get({
  id: publisher.id,
  queryParams: { include: ['authors'] }
})
console.log('Publisher and included authors:', withAuthors)

const updated = await api.resources.authors.patch({
  id: author.id,
  data: { surname: 'Orwell (Eric Blair)' },
  returning: 'minimal'
})
console.log('Updated identifier:', updated)

const document = await api.resources.publishers.post({
  format: 'jsonapi',
  document: {
    data: {
      type: 'publishers',
      attributes: { name: 'Oxford University Press' }
    }
  }
})
console.log('JSON:API publisher:', document.data)
```

Programmatic calls default to `format: 'plain'` and `returning: 'full'`.
Writes accept either plain resource values in `data` or a JSON:API document in
`document`, never both. Read selection, filtering,
sorting and pagination go in `queryParams`; identifiers and response options
remain method parameters.

Plain reads return a record for `get`, and a collection with `data` for `query`.
The filtered query above returns George and pagination metadata with `total: 1`.
The PATCH returns `{ type: 'authors', id: author.id }` because it selects
`returning: 'minimal'`. Use `returning: 'none'` for an undefined write result.
`format` selects only the output. You can request JSON:API output from plain
`data`, or plain output from a JSON:API `document`. The input key selects the
input contract; the library does not guess from its contents.

## Start the HTTP server

Append this last block:

```javascript
const app = express()
app.use(api.http.express.router)
app.use(api.http.express.notFoundRouter)
const server = app.listen(3000, () => {
  console.log('API listening at http://localhost:3000/api')
})

async function shutdown () {
  server.close(async () => { await knex.destroy() })
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
```

Run `node index.js`. HTTP requests use JSON:API documents. The connector handles
request-body parsing. The following commands assume a fresh run of the example;
use returned IDs when adapting them to an existing database. `--globoff` keeps
curl from interpreting the square brackets in query parameters.

```bash
curl http://localhost:3000/api/publishers
curl --globoff 'http://localhost:3000/api/publishers/1?include=authors'
curl --globoff 'http://localhost:3000/api/authors?filter[nameContains]=Georg'
curl --globoff 'http://localhost:3000/api/authors?fields[authors]=name,surname'
curl --globoff 'http://localhost:3000/api/publishers?page[number]=1&page[size]=10'
curl 'http://localhost:3000/api/authors?sort=-surname'

curl -X POST http://localhost:3000/api/authors \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"authors","attributes":{"name":"Jane","surname":"Austen"},"relationships":{"publisher":{"data":{"type":"publishers","id":"1"}}}}}'

curl -X PATCH http://localhost:3000/api/authors/2 \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"authors","id":"2","attributes":{"surname":"Austen (1775-1817)"}}}'

curl -X DELETE http://localhost:3000/api/authors/2
```

For an API without an HTTP server, omit the connector/server setup and call
`await knex.destroy()` after the programmatic operations finish.

Continue with the [full guide](GUIDE/index.md),
[API reference](API.md), and [verified backend capabilities](GUIDE/30-backend-capabilities.md).
