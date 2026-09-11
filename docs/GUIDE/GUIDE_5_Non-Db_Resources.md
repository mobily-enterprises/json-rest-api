# Custom data sources and storage extensions

The built-in resource CRUD lifecycle currently supports the two Knex storage
plugins: ordinary tables and canonical AnyAPI storage. It is not a generic
remote-service or NoSQL adapter interface. Assigning eight `data*` helpers does
not supply a complete backend.

The previous in-memory example did exactly that and fails its first POST with
`No transaction factory is installed`. Supplying a dummy transaction would not
make its changes atomic or implement the remaining storage requirements.

## Choose the integration boundary

| Need | Existing approach |
| --- | --- |
| Disposable, in-memory resource CRUD with normal JSON:API behavior | Use `better-sqlite3` with `filename: ':memory:'` and `RestApiKnexPlugin`. |
| Multiple logical resources in shared SQL tables | Use `RestApiAnyapiKnexPlugin`; initialize its canonical schema and select a fixed tenant namespace. |
| Application-specific calls to a service or other data source | Add an explicit plugin method and implement its input, authorization and result contract. |
| A new storage engine behind all resource methods | Treat it as a core integration project and verify the full storage/transaction contract below. |

See [initial setup](GUIDE_1_Initial_Setup.md) for a complete in-memory SQLite
example, and [backend capabilities](BACKEND_CAPABILITIES.md) for the tested SQL
combinations and their limits. In-memory SQLite remains a database; it provides
real transactions rather than pretending a JavaScript Map can roll back.

## A custom service method

This example uses `hooked-api` extension methods without installing database
storage. Run the three blocks together in an ESM file in an application with
`hooked-api` and `json-rest-api` installed. The injected loader returns a small
fixed result so the example is executable without an external service.
Replace that loader with application-owned service access when integrating.

```javascript
import { JsonRestApi } from 'json-rest-api'
import { RestApiPlugin } from 'json-rest-api'

const serviceApi = new JsonRestApi({ name: 'service-example' })
await serviceApi.use(RestApiPlugin)
const AvailabilityPlugin = {
  name: 'availability-service',
  dependencies: ['rest-api'],
  install ({ addResourceMethod, pluginOptions }) {
    addResourceMethod('lookupAvailability', async ({ params, context }) => {
      if (context.auth?.canCheckAvailability !== true) throw new Error('Availability access denied')
      if (typeof params.sku !== 'string' || !params.sku.trim()) throw new Error('sku is required')
      return pluginOptions.loadAvailability(params.sku)
    })
  }
}
await serviceApi.use(AvailabilityPlugin, {
  loadAvailability: async sku => ({ sku, available: sku === 'BOOK-1' })
})
```

The method explicitly checks its application authorization and input. The
loader is trusted application configuration, not client-supplied code.

```javascript
await serviceApi.addResource('catalog', {
  schema: { sku: { type: 'string', required: true } }
})
```

Registration provides the scope for the custom method; it does not install
storage or make the built-in CRUD methods usable.

```javascript
const availability = await serviceApi.resources.catalog.lookupAvailability(
  { sku: 'BOOK-1' },
  { auth: { canCheckAvailability: true } }
)
console.log(availability)
```

The result is `{ sku: 'BOOK-1', available: true }`. This method has its own return
shape. It does not automatically acquire resource CRUD validation, permissions,
JSON:API formatting, includes, pagination, transactions or HTTP routes. A custom
HTTP endpoint must translate and authorize its request and response explicitly.
Do not route a remote write through a local transaction and claim the remote
service participates in its rollback.

See [Writing Plugins](GUIDE_X_Writing_Plugins.md) for registration and custom
methods, and [hooks](GUIDE_7_Hooks_Data_Management_And_Plugins.md) for the distinct
built-in resource lifecycle.

## What a complete storage integration must cover

The current implementation depends on more than individual CRUD helpers:

- Schema compilation, logical IDs, field/column translation, serializers and
  storage metadata must agree across reads, writes, filters and sorting.
- `dataGetMinimal` supports both individual and batched lookup paths. Visibility
  checks and relationship validation need the same policy behavior as normal
  reads, including hidden/missing equivalence.
- Queries must preserve authorized counts, stable pagination, sparse fields,
  computed dependencies, includes and per-parent limits. Filtering a response
  after pagination does not satisfy this contract.
- Relationship mutations need target validation, membership storage, reverse
  changes, locks and version invalidation. Core currently uses Knex builders
  and storage adapters directly for parts of these operations.
- Writes need an actual transaction factory and the managed ownership contract,
  including acknowledged commit/rollback, uncertain completion, completion
  hooks and failure diagnostics. Remote side effects need their own semantics.
- Bulk operations and schema changes must preserve their documented atomicity
  and publication boundaries. Supporting a single-record happy path is not
  sufficient evidence for the backend.

The source checkout's `plugins/core/lib/storage/storage-types.d.ts` describes
internal Knex-oriented boundaries; it is not a storage-agnostic public driver
specification. The ordinary and canonical storage plugins are the current
implementations to inspect. Do not copy an outdated list of helpers as a
substitute for reviewing their callers.

A new backend needs conformance tests for its supported capabilities and explicit
rejections for unsupported operations. Use the source checkout's
`tests/README.md` and `docs/development/conformance.md` to select the relevant
fixtures and matrices. The current library does not ship a verified generic
in-memory Map, MongoDB, DynamoDB or remote JSON:API backend.
