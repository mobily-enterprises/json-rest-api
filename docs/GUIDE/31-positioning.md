---
title: "Positioning (experimental)"
chapter: 31
chapter_label: "31"
---

# 31. Positioning (experimental)

The positioning plugin assigns fractional string keys for custom ordering within
groups, such as sortable lists and drag-and-drop interfaces.

**Experimental:** native database concurrency has a known failure; canonical
native concurrency is unverified. Applications requiring safe concurrent
reordering should not enable this plugin. The sequential interface below does
not establish that guarantee.

## Setup

Install `fractional-indexing` alongside the ordinary Knex dependencies. The plugin
is available through its package subpath, rather than the root exports:

```javascript
import { JsonRestApi, RestApiPlugin, RestApiKnexPlugin } from 'json-rest-api'
import { PositioningPlugin } from 'json-rest-api/plugins/core/rest-api-positioning-plugin.js'

// knex is an application-owned, configured Knex instance.
const api = new JsonRestApi({ name: 'ordered-tasks' })
await api.use(RestApiPlugin)
await api.use(RestApiKnexPlugin, { knex })
await api.use(PositioningPlugin, { filters: ['status'], autoIndex: false })

await api.addResource('tasks', {
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', required: true, search: true },
    position: { type: 'string', max: 255, search: true }
  }
})
await api.resources.tasks.createKnexTable()
```

Declare the position field yourself. The plugin validates its presence; it does
not add the field or migrate an existing database. Install the plugin before
registering participating resources. Each resource not excluded by configuration
must also declare the grouping fields.

## Sequential resource calls

```javascript
const first = await api.resources.tasks.post({
  inputRecord: { title: 'First task', status: 'todo' }
})
const last = await api.resources.tasks.post({
  inputRecord: { title: 'Last task', status: 'todo', beforeId: null }
})
await api.resources.tasks.post({
  inputRecord: { title: 'Middle task', status: 'todo', beforeId: last.id }
})
await api.resources.tasks.patch({
  id: last.id,
  inputRecord: { beforeId: first.id }
})
```

`beforeId` identifies another item in the destination group. `null` means the end
of that group. New records without `beforeId` use `defaultPosition`. Updating a
record without `beforeId` retains its current position, even when a grouping
field changes. Supply an explicit placement when moving between groups.

The plugin supplies position sorting when a query has no explicit sort. Position
keys are strings, not numbers. Do not substitute arbitrary integer strings for
valid fractional keys or assume all database collations order them identically.
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

Plain records belong in programmatic `inputRecord` arguments; they are not the
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
| `rebalanceThreshold` | `50` | Stored configuration only; automatic rebalancing is not implemented |

Automatic index creation skips canonical storage and tables that do not yet
exist. Failures are logged rather than aborting setup. Manage required indexes
through reviewed [schema migrations](21-schema-and-migrations.md); do not assume
that enabling `autoIndex` created an index.

The `api.positioning.reorder` helper is a placeholder that logs a request without
performing a reorder. Do not use it for application writes. Use individual
resource operations for sequential changes, subject to the limitations above.
There is no guaranteed conflict-free bulk reordering or automatic rebalancing.
The internal `rebalancePositions()` utility calculates replacement keys in memory;
it is not called by the plugin and does not persist those keys.

For existing data, plan a separate migration with valid keys, explicit ordering
and database-appropriate collation. Back up data and inspect the result before
enabling the plugin; registration does not convert existing positions.
