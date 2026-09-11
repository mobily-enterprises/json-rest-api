# Basic usage and configuration

The guide uses a book catalog with countries, publishers, authors, books and
book-author links. Start with countries here; subsequent chapters add the
related resources. The [quickstart](../QUICKSTART.md) provides a complete
Express server with related publishers and authors.

Use Node 24 or newer; development verification runs on Node 24. These examples
use the revised contract in the [migration guide](MIGRATING_API_V2.md). Until
its release is published, install the intended library tarball instead of the
registry package.

## Install and create a resource

```bash
npm init -y
npm pkg set type=module
npm install json-rest-api hooked-api knex better-sqlite3
```

Save this as `index.js`. The database is in memory, so records disappear when
the process exits. Resource schemas are flat field maps. Related resources are
not declared in this first example because their definitions come later.

```javascript
import { RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api'
import { Api } from 'hooked-api'
import knexLib from 'knex'

const knex = knexLib({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true
})
const api = new Api({
  name: 'book-catalog-api',
  logging: { level: 'warn' }
})

try {
  await api.use(RestApiPlugin)
  await api.use(RestApiKnexPlugin, { knex })
  await api.addResource('countries', {
    schema: {
      name: { type: 'string', required: true, max: 100, search: true },
      code: { type: 'string', max: 2, unique: true, search: true }
    }
  })
  await api.resources.countries.createKnexTable()

  const country = await api.resources.countries.post({
    inputRecord: { name: 'United States', code: 'US' }
  })
  const refetched = await api.resources.countries.get({ id: country.id })
  console.log('Country:', refetched)

  const matches = await api.resources.countries.query({
    queryParams: {
      filters: { code: 'US' },
      sort: ['name'],
      page: { number: 1, size: 10 }
    }
  })
  console.log('Matches:', matches.data)

  const changed = await api.resources.countries.patch({
    id: country.id,
    inputRecord: { name: 'United States of America' },
    returning: 'minimal'
  })
  console.log('Changed identifier:', changed)

  const document = await api.resources.countries.get({
    id: country.id,
    format: 'jsonapi'
  })
  console.log('JSON:API attributes:', document.data.attributes)
} finally {
  await knex.destroy()
}
```

Run `node index.js`. The first record has name `United States` and code `US`;
the query returns that record. PATCH returns `{ type: 'countries', id: country.id }`.
The final JSON:API read has `data.attributes.name` equal to
`United States of America`.

When adapting later examples to this script, insert their operations inside the
`try` block after resource registration and before the database is destroyed.

## Logging

Configure logging on `new Api({ logging: { level: 'warn' } })`. Levels are
`trace`, `debug`, `info`, `warn`, `error` and `silent`; the default is `info`.
The logger belongs to hooked-api. Resource and connector diagnostics also use
the library's bounded error formatting; see the [API reference](../API.md)
for diagnostic and error contracts.

## Database configuration

`RestApiKnexPlugin` uses the supplied Knex instance. Install the driver for the
selected database. For PostgreSQL, use `npm install pg` and configure:

```javascript
const knex = knexLib({
  client: 'pg',
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 5432
  }
})
```

For MySQL 8, use `npm install mysql2` and configure:

```javascript
const knex = knexLib({
  client: 'mysql2',
  connection: {
    host: '127.0.0.1',
    user: 'your_username',
    password: 'your_password',
    database: 'your_database_name',
    port: 3306
  }
})
```

The verified combinations are SQLite through better-sqlite3, PostgreSQL 16
through pg and MySQL 8 through mysql2. Review the
[backend capabilities](BACKEND_CAPABILITIES.md) before switching: precision,
collation, schema evolution and transaction behavior have backend-specific
limits. Other Knex clients and server versions are unverified.

## Method arguments and response options

Call resources through `api.resources.countries`. Methods accept operation
parameters first and optional application context second. Write records always
go in `inputRecord`; the target ID, transaction handle and response options
remain outside the record. Query selection goes in `queryParams`.

| Option | Values | Programmatic default |
| --- | --- | --- |
| `format` | `'plain'`, `'jsonapi'` | `'plain'` |
| `returning` | `'none'`, `'minimal'`, `'full'` | `'full'` |

`format` selects both input and output representation. Plain `get` returns a
record; plain `query` returns a collection whose `data` contains records.
JSON:API calls accept documents under `inputRecord` and return documents with
`data`. Record attributes never become top-level method parameters.

For POST, PUT and PATCH, `returning: 'minimal'` returns `{ type, id }` in plain
format or `{ data: { type, id } }` in JSON:API format. `returning: 'none'` returns
undefined. Full responses run the resource read/enrichment path, including its
visibility rules and selected fields. DELETE and relationship writes return
undefined. `returning` does not change read results.

You can set programmatic defaults when installing `RestApiPlugin`, override
them in a resource definition, and override those defaults for a particular
call. Each setting accepts a single value, not a per-method map or boolean.

```javascript
await api.use(RestApiPlugin, { format: 'plain', returning: 'minimal' })
await api.addResource('countries', {
  returning: 'full',
  schema: { name: { type: 'string', required: true } }
})
const result = await api.resources.countries.post({
  inputRecord: { name: 'Canada' },
  returning: 'none'
})
// result is undefined
```

This is an alternative configuration for a fresh API instance; do not install
the plugin or register the same resource twice in the initial script.

PUT creates a missing target or replaces a visible existing record according
to schema requirements, defaults and nullability. PATCH changes supplied fields.
Both accept the target ID as `params.id` or in the input record; conflicting
IDs are rejected. For exact payloads, relationships and pagination, see the
[API reference](../API.md).

## HTTP endpoints

The library provides [Express](../QUICKSTART.md) and
[Fastify](GUIDE_X_Fastify.md) connectors. Install the connector before resource
registration. Express exposes `api.http.express.router` and
`api.http.express.notFoundRouter`, which your application mounts with `app.use`.
The quickstart contains the complete setup and shutdown code.

Generated HTTP routes explicitly use JSON:API format and full write responses.
They do not inherit a resource's programmatic plain/minimal defaults. There is
no separate simplified-transport switch.

For a server exposing the countries resource at `/api`, create a country with:

```bash
curl -i -X POST http://localhost:3000/api/countries \
  -H 'Content-Type: application/vnd.api+json' \
  -d '{"data":{"type":"countries","attributes":{"name":"United Kingdom","code":"GB"}}}'
```

Successful POST returns 201 with a JSON:API document. Use its `data.id` in a
subsequent GET, for example `curl http://localhost:3000/api/countries/1` on an
otherwise empty database. Successful PUT/PATCH with a response body return 200;
DELETE returns 204 with no body. A custom endpoint selecting no write result
returns 204; it must not send a JSON body with that status. These describe normal
successful responses; application hooks can reject requests or customize responses.

## Limits and resource configuration

Configure limits through documented plugin/resource options, rather than
mutating compiled resource metadata after registration.

| Option | Default | Purpose |
| --- | --- | --- |
| `queryDefaultLimit` | `20` | Default collection size |
| `queryMaxLimit` | `100` | Maximum requested collection size |
| `includeDepthLimit` | `3` | Maximum nested include depth |
| `enablePaginationCounts` | `true` | Counts for numbered pagination |
| `idProperty` | `'id'` | Physical primary-key column for table-backed resources |
| `normalizeId` | Built-in normalizer | Canonical resource identifiers |

Counts do not turn cursor pagination into numbered pagination. Omitted or empty
page options use the default collection cap without pagination metadata.
`sortableFields` and `defaultSort` control resource sorting; see
[pagination and ordering](GUIDE_2_7_Pagination_And_Ordering.md) for their contracts.

# Logical IDs and Physical Columns

For table-backed resources, `idProperty` defines the physical primary-key column. The API surface still uses the logical resource id.

- plain writes use `inputRecord.id`
- JSON:API writes use `inputRecord.data.id`
- responses expose `id` or `data.id`
- the resource id is not part of `attributes`

```javascript
await api.addResource('profiles', {
  idProperty: 'user_id',
  schema: {
    id: { type: 'id', required: true, storage: { column: 'user_id' } },
    displayName: { type: 'string', required: true },
    loginCount: { type: 'number', defaultTo: 0 }
  },
  tableName: 'profiles'
});
```

For table-backed resources, storage columns default to snake_case, so `displayName` maps to `display_name` and `loginCount` maps to `login_count`. Use `storage.column` for a per-field override, or `storage: { naming: 'exact' }` when physical column names should match logical field names exactly.

## ID normalization

`normalizeId` lets you canonicalize resource identifiers before the library reads, writes, validates, or links records.

The default normalizer already handles the common cases:

- trims surrounding whitespace from strings
- converts finite numbers and bigints to strings
- rejects values that normalize to an empty identifier

You only need to provide `normalizeId` when your resource ids need additional canonicalization, such as uppercasing, lowercasing, or removing formatting characters.

```javascript
await api.use(RestApiPlugin, {
  normalizeId: (value) => {
    if (value === null || value === undefined) return null

    const normalized = String(value).trim()
    return normalized ? normalized.toUpperCase() : null
  }
})

await api.addResource('countries', {
  // Override the plugin-wide normalizer for this one resource
  normalizeId: (value) => {
    if (value === null || value === undefined) return null

    const normalized = String(value).trim()
    return normalized ? normalized.toLowerCase() : null
  },
  schema: {
    name: { type: 'string', required: true }
  }
})
```

Normalization is applied consistently to:

- `get`, `put`, `patch`, `delete`, `getRelated`, and `getRelationship` parent ids
- explicit resource ids in `POST`, `PUT`, and `PATCH` documents
- relationship identifiers supplied to `postRelationship`, `patchRelationship`, and `deleteRelationship`

The resource-level `normalizeId` override also applies to relationship identifiers when that resource appears as the related target.

If an id normalizes to an empty value:

- existing-resource operations behave as `not_found`
- explicit `POST` document ids are rejected as validation errors on `data.id`

For full examples of table creation, physical column naming, and migration generation, see [Knex Schema and Migrations](GUIDE_X_Knex_Schema_And_Migrations.md).

## Transactions and database helpers

Use `api.transaction(callback, context?)` for a unit of library writes and pass
its managed handle as each operation's `transaction` parameter. Raw Knex
transactions are available for direct SQL and reads; they are not accepted as
owners of library writes. See [managed transactions](managed-transactions.md)
and [transaction outcomes](transaction-outcomes.md) before composing operations.

`api.knex.instance` exposes the supplied Knex instance and
`api.knex.capabilities` describes detected backend capabilities. Table-backed
resources provide `createKnexTable`, `introspectKnexTableSnapshot`,
`generateKnexMigration`, `generateKnexMigrationDiff`, `addKnexFields` and
`alterKnexFields`. These helpers have different applicability to canonical
storage; use the [schema and migration guide](GUIDE_X_Knex_Schema_And_Migrations.md)
for examples and limitations.

Continue with [the starting point](GUIDE_2_1_The_Starting_Point.md) or return to
the [guide index](index.md).
