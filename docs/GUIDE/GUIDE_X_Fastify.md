# Fastify Integration

`json-rest-api` now ships a Fastify-oriented connector:

```js
import fastify from 'fastify'
import {
  RestApiPlugin,
  RestApiKnexPlugin,
  FastifyPlugin
} from 'json-rest-api'

const app = fastify()

await api.use(RestApiPlugin, {
  simplifiedApi: false,
  simplifiedTransport: false
})

await api.use(RestApiKnexPlugin, { knex })

await api.use(FastifyPlugin, {
  app,
  mountPath: '/api'
})
```

## What the connector does

The Fastify connector listens to the same `addRoute` hook as the Express connector and registers the generated REST routes on the Fastify instance you pass in `pluginOptions.app`.

It also consumes the transport schema exported by `json-rest-schema` before the request reaches the resource method:

- `POST` routes use the schema export in `create` mode
- `PUT` routes use the schema export in `replace` mode
- `PATCH` routes use the schema export in `patch` mode
- relationship `POST` / `PATCH` / `DELETE` routes use JSON:API relationship document schemas

Those field schemas are wrapped in the JSON:API document envelope expected by `json-rest-api`.

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

This keeps Fastify transport validation aligned with the same transport rules already enforced by the runtime methods.

## Content types

The connector registers an `application/vnd.api+json` parser and rejects unsupported write content types before the route handler runs.

Accepted write content types are:

- `application/vnd.api+json`
- `application/json`

## Scope

This connector is intentionally narrow:

- it uses the exported schema already owned by `json-rest-schema`
- it does not add a JSKIT-specific compatibility layer
- it does not move business validation out of the resource methods

The goal is transport-level shape rejection, not a second validation system.
