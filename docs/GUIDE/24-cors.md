---
title: "CORS"
chapter: 24
chapter_label: "24"
---

# 24. CORS

`CorsPlugin` adds CORS response headers and handles OPTIONS requests beneath the
HTTP connector's API prefix. Install Express or Fastify before this plugin.
Register resources and plugins before starting the server.

CORS controls whether browser JavaScript can read a cross-origin response.
Authentication, authorization and CSRF protection remain application concerns;
an ordinary request from a disallowed origin can still execute. A denied
preflight stops the browser from sending the subsequent request. See the
[Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

## Basic setup

This runnable example uses an in-memory database. The response is visible to
`https://app.example.com`, including when a request returns an error.

```js
import { JsonRestApi } from 'json-rest-api'
import { RestApiPlugin, RestApiKnexPlugin, ExpressPlugin, CorsPlugin } from 'json-rest-api'
import express from 'express'
import knex from 'knex'

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const app = express()
const api = new JsonRestApi({ name: 'cors-example' })
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex: db })
await api.use(ExpressPlugin, { mountPath: '/api' })
await api.use(CorsPlugin, {
  origin: 'https://app.example.com',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Location', 'Link'],
  maxAge: 600
})
await api.addResource('countries', {
  schema: { id: { type: 'id' }, name: { type: 'string', required: true } }
})
await api.resources.countries.createKnexTable()
api.http.express.mount(app)
const server = app.listen(3000)
```

Close `server` and call `db.destroy()` when shutting down. The database and its
records in this example last only for the lifetime of the process.

For Fastify, replace the Express import, app creation, connector installation and
mount/listen lines with the following respective equivalents. Keep the resource
and CORS setup before `listen()`:

```js
import fastify from 'fastify'
import { FastifyPlugin } from 'json-rest-api'

const app = fastify()
await api.use(FastifyPlugin, { app, mountPath: '/api' })
// Install CorsPlugin and register resources here.
await app.listen({ port: 3000 })
```

## Configuration options

Pass options directly to `api.use(CorsPlugin, options)`.

| Option | Default | Behavior |
| --- | --- | --- |
| `origin` | `'*'` | Exact string, regular expression, array of candidates, function, or `false` to disable origin permission |
| `credentials` | `true` | Adds `Access-Control-Allow-Credentials: true` for allowed origins |
| `methods` | GET, POST, PUT, PATCH, DELETE, OPTIONS | Array advertised in preflight `Access-Control-Allow-Methods` |
| `allowedHeaders` | Content-Type, Authorization, X-Requested-With, X-HTTP-Method-Override, Accept, Origin | Array advertised in preflight `Access-Control-Allow-Headers` |
| `exposedHeaders` | X-Total-Count, X-Page-Count, Link, Location | Array of response headers available to browser JavaScript; `[]` omits this header |
| `maxAge` | `86400` | Preflight cache lifetime in seconds; `0` is respected |
| `optionsSuccessStatus` | `204` | Successful OPTIONS status; use `200` if required by your client |

The default permits every origin, including credentialed requests. With
`origin: '*'` and `credentials: true`, the plugin reflects the request's Origin.
Use an explicit list for applications with credentialed browser sessions. For
public responses without credentials:

```js
await api.use(CorsPlugin, { origin: '*', credentials: false })
```

This returns the literal `Access-Control-Allow-Origin: *` and omits the credential
header. A browser credentialed fetch requires an explicit allowed origin;
the literal wildcard is insufficient. The
[Fetch credentials table](https://fetch.spec.whatwg.org/#cors-protocol-and-credentials)
shows how these response headers interact.

An origin function receives the request Origin and returns a boolean or a
promise for one. It is evaluated once per HTTP response, including preflight:

```js
const allowedOrigins = new Set(['https://app.example.com', 'https://admin.example.com'])
await api.use(CorsPlugin, {
  origin: async origin => allowedOrigins.has(origin),
  credentials: true
})
```

A false result grants no CORS permission. A thrown/rejected predicate produces a
500 JSON:API error without an allowed-origin header; it is not retried while
constructing that response. Array candidates are awaited in order. Regular
expressions match independently for each request without modifying `lastIndex`.

`api.vars.cors` contains the current configuration. Changes apply to later
requests. Prefer updating an origin allowlist used by your predicate rather than
reinstalling the plugin or duplicating its OPTIONS route.

## Preflights and rejected requests

Allowed OPTIONS requests return the configured status, origin, methods, headers
and cache age. Disallowed origins receive 403 with a JSON:API error document:

```json
{"errors":[{"status":"403","title":"Forbidden","detail":"CORS origin not allowed"}]}
```

The plugin advertises the configured methods and headers; the browser checks
whether the requested method/headers are allowed. It does not add or authorize
resource methods. Application request hooks also run for OPTIONS: an
application that requires authentication on every request should deliberately
handle browser preflights in its authentication hook, since a preflight does not
carry the later request's credentials.

CORS headers are applied to connector responses for malformed JSON (400), body
limits (413), unsupported media types (415), incompatible Accept (406), rejected
request hooks, resource validation, missing records, API 404s and successful
writes/deletes. A disallowed ordinary request receives no CORS permission, but
its resource operation is still governed by normal application authorization.

When a response reflects or filters Origin, `Vary` includes Origin even for
absent or denied origins. Host, custom-route and response-hook vary fields are
merged case-insensitively with the connector's Accept field; `Vary: *` stays `*`.
Header order is not significant.

The CORS hook appends to headers already present when it runs. A later custom
hook that replaces `response.headers.vary` must preserve any existing fields.
Use the runtime's `beforeFunction`/`afterFunction` placement options when hook
order matters; numeric ordering options are not supported.

## Response hooks and host boundaries

`transport:response` is attempted once for each connector-generated HTTP
response, including early parser/media errors and `context.reject(...)`.
On early errors, `context.transport.request.body` can be undefined because the
parser or resource method never ran. Use `context.transport.response.status`
when examining the attempted response. If a response hook throws, the connector
maps the error without running the hook chain a second time. A failure at this
stage cannot undo a write that has already committed.

Host routes outside the API prefix, host middleware that sends its own response,
and a hook that takes over the raw response are outside this lifecycle. Fastify
rejects malformed URL escapes before connector hooks; its native 400 response
therefore has no connector CORS headers. Configure the host's error boundary if
needed; see the [Fastify guide](23-fastify.md). Express route-parameter decode
errors do reach the connector error handler.

Socket.IO has its own handshake/transport CORS configuration. Configure it
through `startSocketServer` or the Socket.IO plugin options; this HTTP plugin
does not replace Socket.IO authentication or subscription permissions.
