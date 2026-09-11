---
title: "Fastify integration"
chapter: 23
chapter_label: "23"
---

# 23. Fastify integration

`json-rest-api` includes a Fastify connector. Integration tests exercise
Fastify with ordinary Knex and canonical AnyAPI SQLite storage. The current
verification runtime is Node 24; see [backend capabilities](30-backend-capabilities.md)
for the supported matrix and limits.

## Runnable connector example

Install `fastify` alongside the library and database dependencies. Begin with
an API instance that has `RestApiPlugin` and one storage plugin installed, as in
[initial setup](01-getting-started.md). Use a fresh database and run the next
three blocks before registering other resources.

```javascript
import fastify from 'fastify'
import { FastifyPlugin } from 'json-rest-api'

const app = fastify()
await api.use(FastifyPlugin, { app, mountPath: '/api' })
```

```javascript
await api.addResource('books', {
  schema: { title: { type: 'string', required: true } }
})
await api.resources.books.createKnexTable()
```

Fastify's `inject` runs its HTTP routing, parsers and handlers without opening a
listening socket. This makes the example runnable as a short verification script.

```javascript
let createdResponse, listResponse, invalidResponse, malformedResponse
try {
  await app.ready()
  createdResponse = await app.inject({
    method: 'POST', url: '/api/books',
    headers: { 'content-type': 'application/vnd.api+json' },
    payload: { data: { type: 'books', attributes: { title: 'Fastify example' } } }
  })
  listResponse = await app.inject({ method: 'GET', url: '/api/books?page[number]=1&page[size]=10' })
  invalidResponse = await app.inject({
    method: 'POST', url: '/api/books',
    headers: { 'content-type': 'application/vnd.api+json' },
    payload: { data: { type: 'books', attributes: {} } }
  })
  malformedResponse = await app.inject({
    method: 'POST', url: '/api/books',
    headers: { 'content-type': 'application/vnd.api+json' }, payload: '{'
  })
  console.log(createdResponse.statusCode, listResponse.json(), invalidResponse.statusCode, malformedResponse.statusCode)
} finally { await app.close() }
```

Creation returns 201 and a JSON:API resource even when programmatic calls default
to plain records. The list contains one book and reports a total of 1. Missing
required title returns 422, while malformed JSON returns 400. Neither rejected
request creates another book.

In a running application, call `await app.listen({ port: 3000 })` after declaring
resources instead of running the injection block. Close the Fastify app and
destroy its database connection during application shutdown.

## What the connector does

The Fastify connector listens to the same `addRoute` hook as the Express connector and registers the generated REST routes on the Fastify instance you pass in `pluginOptions.app`.

It publishes the transport schema exported by `json-rest-schema` and uses the
existing compiled request contract through Fastify's route validator compiler:

- `POST` routes use the schema export in `create` mode
- `PUT` routes use the schema export in `replace` mode
- `PATCH` routes use the schema export in `patch` mode
- relationship `POST` / `PATCH` / `DELETE` routes use JSON:API relationship document schemas

Those field schemas are wrapped in the JSON:API document envelope expected by
`json-rest-api`. Resource routes select JSON:API input/output and full write
responses explicitly, regardless of the programmatic or resource defaults.
Relationship writes and resource DELETE return 204 with no body.

The route validator resolves the current cached contract for each payload, so
canonical field additions also update resource write validation. The JSON
Schema published when registering the route is an initialization snapshot;
finalize declarations before generating route-based API documentation.

The route validator uses the same contract as programmatic calls. This avoids
Ajv rejecting `json-rest-schema` metadata at server startup, stripping unknown
fields, or applying different coercion rules before the resource sees the input.
The connector registers routes and JSON parsers in a child Fastify scope. The
host application's parser and validator configuration is not replaced. Register
resources before calling `app.ready()` or `app.listen()`. Custom routes
without resource metadata keep their existing unschematized behavior.

## What gets rejected early

Fastify can now stop malformed write payloads before they reach the app layer:

- missing `data`
- invalid `data.type`
- invalid `data.id` on `PUT` / `PATCH`
- malformed attribute payloads
- unknown attribute fields
- invalid scalar types according to the resource schema
- malformed relationship write documents

The transport schema also reflects the existing write contract:

- output-only computed fields are removed from `data.attributes`
- direct `belongsTo` foreign keys are removed from `data.attributes`
- relationship linkage still belongs under `data.relationships`

Invalid request documents use the library's typed validation error and HTTP 422
response. Malformed JSON uses HTTP 400. Resource attribute validation, setters,
permissions, storage and transaction decisions still run in the resource method.
Transport request hooks run before document validation; errors with an existing
request context pass through the transport response hook.

## HTTP boundaries

The connector accepts `application/vnd.api+json` and `application/json` request
bodies, and sends `application/vnd.api+json` responses without a charset
parameter. Both input types use the same JSON parser inside the connector's
scope. Bodyless resource DELETE works with either content type. Invalid JSON is
400; a valid JSON value that is not a resource document is 422.

Unsupported write media types are rejected with 415 before parsing. JSON:API
`charset` parameters and extensions are rejected; unknown profiles are ignored.
An incompatible `Accept` header produces 406, including an explicit zero quality
for JSON:API. Valid wildcards and JSON:API alternatives are accepted. Responses
include `Vary: Accept`, preserving other values set by response hooks. These
rules follow [JSON:API content negotiation](https://jsonapi.org/format/#content-negotiation).

Configure the body size limit on the Fastify instance (`fastify({ bodyLimit:
1048576 })`). The Express connector's corresponding option is
`requestSizeLimit`. Oversized bodies produce 413 before storage runs.

Unknown routes under `mountPath` return a JSON:API 404 and run the transport
response hook. `handle404: false` leaves these responses to the host application.
Host routes and parsers outside the API prefix keep their own behavior.

Fastify handles malformed URL encodings before plugin lifecycle hooks. Its
default is a native Fastify 400 document. Applications requiring JSON:API at that
boundary can configure the host's
[`routerOptions.onBadUrl`](https://fastify.dev/docs/latest/Reference/Server/#onbadurl)
when constructing the server:

```js
const app = fastify({
  routerOptions: {
    onBadUrl (path, req, res) {
      res.writeHead(400, { 'Content-Type': 'application/vnd.api+json' })
      res.end(JSON.stringify({
        errors: [{ status: '400', title: 'Bad Request', detail: 'Malformed URL' }]
      }))
    }
  }
})
```

This is a host-wide setting using raw Node request/response objects. The
connector cannot install it after receiving an existing Fastify instance.

## Executed coverage

`tests/http-connectors-parity.test.js` exercises real Fastify injection and
Express 4/5 request handling against both storage modes. It checks resource CRUD,
PUT creation/replacement, relationship routes, includes, sparse fields,
pagination links, scalar coercion/nulls, defaults, headers, trusted URL overrides,
validation, parsing, body limits, content negotiation, asynchronous request-hook
failures, and host route/parser isolation. Registration/schema tests also use a
real Fastify instance. Multipart and real database coverage remain separate
roadmap requirements.
