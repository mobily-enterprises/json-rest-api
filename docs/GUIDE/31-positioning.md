---
title: "Positioning"
chapter: 31
chapter_label: "31"
---

# 31. Positioning

The positioning plugin assigns fractional string keys for custom ordering within
groups, such as sortable lists and drag-and-drop interfaces.

Position allocation is coordinated by the database and participates in the
resource operation's managed transaction. Separate-connection tests cover
concurrent inserts, moves, group changes, rollback and earlier transaction
snapshots on PostgreSQL and MySQL, in both ordinary and canonical storage.
SQLite reports a busy/snapshot conflict when another connection holds its write
lock; it does not silently allocate the same key.

## Setup

Install `fractional-indexing` alongside the ordinary Knex dependencies. The plugin
is available through its package subpath, rather than the root exports:

```javascript
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api'
import { PositioningPlugin } from 'json-rest-api/plugins/core/rest-api-positioning-plugin.js'

// knex is application-owned; use bytewise position-column/database collation.
const api = new JsonRestApi({ name: 'ordered-tasks' })
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.use(PositioningPlugin, { filters: ['status'], autoIndex: false })

await api.addResource('tasks', {
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', required: true, search: true },
    position: { type: 'string', max: 255, maxLength: 255, search: true },
    beforeId: { type: 'string', virtual: true }
  }
})
await api.resources.tasks.createKnexTable()
```

Declare the position field yourself. The plugin validates its presence; it does
not add the field or migrate an existing database. Install the plugin before
registering participating resources. Each resource not excluded by configuration
must also declare the grouping fields.

Validation uses the compiled schema after `schema:enrich`, so a setup hook may
supply the position field. Its final definition must be a string without a setter.

Installation creates the internal `json_rest_api_positioning_locks` table when
it is absent. It stores one coordinator row per physical resource, including
the tenant/resource identity for canonical storage. Provision that table during
deployment if the runtime database account cannot create tables:

```javascript
await knex.schema.createTable('json_rest_api_positioning_locks', table => {
  table.string('resource', 64).primary()
})
```

The plugin then needs ordinary read/write access to the table. Keep the table
and its rows while applications are running; removing a live coordinator would
allow writers to use different locks.

## Resource calls

```javascript
const first = await api.resources.tasks.post({
  data: { title: 'First task', status: 'todo' }
})
const last = await api.resources.tasks.post({
  data: { title: 'Last task', status: 'todo', beforeId: null }
})
await api.resources.tasks.post({
  data: { title: 'Middle task', status: 'todo', beforeId: last.id }
})
await api.resources.tasks.patch({
  id: last.id,
  data: { beforeId: first.id }
})
```

`beforeId` identifies another item in the destination group. `null` means the end
of that group, and `'FIRST'` means its beginning. New records without `beforeId`
use `defaultPosition`. Updates within the same group retain their position when
`beforeId` is omitted; changing a grouping field allocates a position in the
destination group using `defaultPosition`. An explicit `beforeId` chooses a
different placement. PUT creates and replacements follow the same rules.

A self-targeted move within the same group keeps its position. Missing targets
and targets outside the destination group fall back to appending. Explicit
targets pass through the resource's normal GET visibility and permission checks;
a permission error rejects the write. Manual position values are ignored.

The plugin supplies position sorting when a query has no explicit sort. Position
keys are strings, not numbers. Use a bytewise collation for the stored position
column so ordinary queries display their intended order: PostgreSQL `C`, MySQL
`utf8mb4_bin`, or SQLite `BINARY`, for example. The allocator uses explicit binary
comparisons, but ordinary sorting and cursor predicates still use the column's
database collation. A case-insensitive collation can display or paginate the
wrong order. Do not substitute arbitrary integer strings for valid fractional keys.
Grouping separates ordering sequences; it does not provide authorization.
Use [row policies](17-row-policies.md) for mandatory visibility restrictions.

## HTTP input

The connectors accept JSON:API documents. A request to move an existing task
uses `PATCH /api/tasks/42` with `Content-Type: application/vnd.api+json`:

```json
{
  "data": {
    "type": "tasks",
    "id": "42",
    "attributes": { "beforeId": "17" }
  }
}
```

Plain records belong in programmatic `data` arguments; they are not the
HTTP document contract.

## Configuration and limits

| Option | Default | Behavior |
| --- | --- | --- |
| `field` | `position` | Declared string field holding the ordering key |
| `filters` | `[]` | Fields defining independent position groups |
| `excludeResources` | `['system_migrations', 'system_logs']` | Resources exempt from positioning |
| `beforeIdField` | `beforeId` | Request attribute containing the placement target |
| `defaultPosition` | `last` | Default placement for new records; `first` is also supported |
| `strategy` | `fractional` | The implemented strategy; `integer` rejects |
| `autoIndex` | `true` | Attempts an ordinary-table index during resource registration |

Automatic index creation skips canonical storage and tables that do not yet
exist. Failures are logged rather than aborting setup. Manage required indexes
through reviewed [schema migrations](21-schema-and-migrations.md); do not assume
that enabling `autoIndex` created an index.

`api.positioning.getConfig()` returns the configuration, and
`api.positioning.isEnabled(resourceName)` reports whether a registered resource
participates. The old no-op `api.positioning.reorder()` helper has been removed;
use resource PATCH operations or [atomic bulk PATCH](27-bulk-operations.md).
The formerly inert `rebalanceThreshold` option now rejects.

There is no automatic rebalancing. Keys that exceed the tighter of the schema's
`max` and `maxLength` (default physical length: 255) reject before storage, so a
database cannot silently truncate a newly allocated key. The
`rebalancePositions()` utility calculates replacement keys in memory; it does
not persist them. `getUnpositionedItems()` and `assignInitialPositions()` support
offline data migrations, using actual fractional-key validation.

## Concurrency and transaction boundaries

Positioned POST/PUT/PATCH operations lock one coordinator row before processing
the request. All position groups within that resource share the lock. This
deliberately serializes positioned writes to keep empty groups and moves between
groups safe without multiple group locks. The lock lasts until the owning
transaction commits or rolls back, including when the operation borrows an
`api.transaction()` handle. Keep those transactions short.

PostgreSQL and MySQL wait for the earlier writer and then allocate against
current rows. PostgreSQL repeatable-read transactions with an older snapshot
can reject with a serialization conflict; SQLite can reject with a busy/snapshot
conflict. Deadlocks, timeouts and connection failures remain ordinary transaction
failures. No hooks or external effects are replayed automatically. When an
application retries a failed move, it must start a fresh operation/transaction.

The coordination guarantee covers writers using this plugin against the same
database and lock table. Direct SQL imports, manual rebalancing and other writers
must not change positions concurrently. Do not add a setter to the managed
position field or change position/group fields after allocation. The plugin
retains normal resource permissions, validation and commit/rollback handling.

For existing data, plan a separate migration with valid keys, explicit ordering
and database-appropriate collation. Back up data and inspect the result before
enabling the plugin; registration does not convert existing positions or repair
duplicate keys. Existing groups must start with valid, distinct keys.
