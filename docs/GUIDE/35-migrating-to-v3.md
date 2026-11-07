---
title: "Migrating to v3"
chapter: 35
chapter_label: "35"
---

# 35. Migrating to v3

Version 3 adds a data-access layer for work that does not fit one record at a
time: reports, imports and background jobs. It replaces the 2.x bulk methods,
which wrote one row per call, with many-row writes that run one statement per
chunk. Single-record methods, relationship methods, HTTP routes other than
`/bulk` and stored data are unchanged. There is no compatibility mode; the old
bulk options are rejected with a message that names their replacement.

## What is new

- **Many-row writes:** `postMany`, `patchMany`, `patchWhereIds`, `patchWhere`,
  `deleteMany` and `deleteWhere`, all-or-nothing, with upserts (`onConflict`)
  and compare-and-set (`onlyIf`). See [many-row writes](27-many-row-writes.md).
- **Scoped reads:** `scopedQuery`, a read-only Knex builder limited to the
  caller's rows, and `queryAll`, every matching row in cursor pages.
- **Row locks:** `lockByIds`, `lockWhere` and `claim` (`SKIP LOCKED`), inside a
  transaction.
- **Lock versions:** `lockVersionField`, a counter every update advances.
- **Shared rows:** an autofilter filter with `shared: true` lets every owner
  read rows whose owner field is NULL.
- **System contexts:** `createSystemContext(reason)` for work across every
  owner; `isSystemContext(context)`; `readOnlyQueryBuilder(builder)`.
- **Batch hooks:** `beforeProcessingPostMany`, `beforeDataCallPostMany`,
  `afterDataCallPostMany` and the `PatchMany` and `DeleteMany` forms; hook
  registrations take `{ batch: true }`.
- **Aggregates:** measures take a `where` condition; `groupBy` takes date
  buckets (`day`, `week`, `month`, `year`) with a time zone; date fields with a
  storage serializer can be bucketed and take `min` and `max`. See
  [AGGREGATE](../API.md#aggregate---grouped-totals).
- **One read for `get`:** a resource with no `checkPermissions`,
  `checkDataPermissions`, `checkDataPermissionsGet`, `beforeData` or
  `beforeDataGet` hook reads its record in one statement; such a get no
  longer sets `context.minimalRecord` (read `context.record` in later hooks).
- **Skipping writes in one statement:** `patchMany`, `patchWhereIds` and
  `deleteMany` with `missing: 'skip'` put the scope in the UPDATE or DELETE
  instead of reading the visible ids first, when no permission or
  before-data-call batch hook needs those rows (not on MySQL and MariaDB,
  where InnoDB would lock every listed row before checking the scope).
- **Selection writes:** `patchWhere` and `deleteWhere` carry the scope and the
  filters in every UPDATE or DELETE and return the rows they wrote; a row that
  vanishes or stops matching in the meantime is left out, never an error.
- **Counts:** `returning: 'count'` on every many-row write returns
  `{ meta: { count } }`, the number of rows written, without reading rows back.
- **Upserts on the id:** on a resource with no ownership fields and no row
  policy, `onConflict: { keys: ['id'], action }` (or the `idProperty`, such as
  an email natural key) creates the rows that do not exist yet, atomically.
- **Numbered pages without counts:** with `enablePaginationCounts: false` an
  offset page reads one extra row and reports `hasMore` and a `next` link,
  still without a count query.

Scoped reads, row locks, lock versions, shared rows and system contexts are
described in [scoped reads, locks and system work](34-scoped-reads-and-locks.md).

## Many-row writes replace the bulk methods

`bulkPost`, `bulkPatch` and `bulkDelete` are removed. Their replacements run
the per-row checks in memory and one INSERT, UPDATE or DELETE per chunk.

| 2.x | 3.0 |
| --- | --- |
| `bulkPost({ data: [...] })` | `postMany({ data: [...] })` |
| `bulkPost({ document: { data: [...] } })` | `postMany({ document: { data: [...] } })` |
| `bulkPatch({ operations: [{ id, data: { ... } }] })` | `patchMany({ data: [{ id, ... }] })` |
| `bulkPatch({ operations: [{ id, document: { data } }] })` | `patchMany({ document: { data: [{ type, id, attributes }] } })` |
| the same change for many ids | `patchWhereIds({ ids, data })` or `patchWhere({ filters, data })` |
| `bulkDelete({ ids })` | `deleteMany({ ids })` or `deleteWhere({ filters })` |
| the same change for, or deletion of, every row | `patchWhere({ all: true, data })`, `deleteWhere({ all: true })`: without `filters`, `all: true` is required |
| `atomic: true` | remove: every call is all-or-nothing |
| `atomic: false` | remove; for rows that must succeed independently, call single writes in a loop |
| `expectedVersion`, `expectedVersions` | removed: resources with a `versionField` refuse many-row writes. Use single writes with `expectedVersion`, or a `lockVersionField` with `onlyIf` |
| result `{ meta: { total, succeeded, failed, atomic }, errors, data }` | nothing by default; `returning: 'minimal'` gives `{ data: [{ type, id }] }`, `'full'` gives `{ data: [records] }`, `'count'` gives `{ meta: { count } }` |
| `errors[i].index` for a failed entry | the call throws; a validation error names the row in `details.index`, and its field paths start with `data.<index>.` |
| `meta.deleted` | `deleteMany({ ids, returning: 'minimal' }).data` |
| default `returning` of the resource | `'none'` unless the call says otherwise |

```js
// Before (2.x)
await api.resources.books.bulkPatch({
  operations: rows.map(row => ({ id: row.id, data: { title: row.title } })),
  atomic: true,
  format: 'plain'
})

// After (3.0)
await api.resources.books.patchMany({
  data: rows.map(row => ({ id: row.id, title: row.title })),
  format: 'plain'
})
```

Ids that are missing or hidden from the caller now fail the whole call with
`RestApiRecordsNotFoundError` (404) before anything is written; pass
`missing: 'skip'` to ignore them instead.

### Behaviour that bulk writes had and many-row writes refuse

The 2.x methods ran the full single-record pipeline for every entry, so they
accepted anything a single write did. Many-row writes throw
`RestApiBulkWriteUnsupportedError` (`REST_API_BULK_WRITE_UNSUPPORTED`, 422)
before writing in these cases; keep single writes for them:

| Case | Single-write alternative |
| --- | --- |
| AnyAPI storage | single writes |
| a resource with a `versionField`, or whose writes advance another resource's version | single writes with `expectedVersion` |
| rows that set many-to-many or has-many relationships | single writes or the relationship methods |
| rows that set file fields | single writes with uploads |
| creating positioned records, or moving them | single writes |
| per-record write hooks without a batch form | add `{ batch: true }` and a batch hook (below) |

### Hooks

Many-row writes do not run the per-record write hooks (`beforeProcessing`,
`beforeSchemaValidate*`, `beforeDataCall*`, `afterDataCall*`, `finish*` for
post, patch and delete). If a resource has such a handler, its many-row writes
are refused, naming the handler. For each one, either:

- register it with `{ batch: true }` and add the matching batch hook
  (`beforeProcessingPostMany`, `beforeDataCallPostMany`,
  `afterDataCallPostMany`, `beforeProcessingPatchMany`,
  `beforeDataCallPatchMany`, `afterDataCallPatchMany`,
  `beforeDataCallDeleteMany`, `afterDataCallDeleteMany`); or
- register it with `{ batch: true }` alone when it does not apply to many-row
  writes.

```js
// Before (2.x): ran once for every bulk entry
api.addHook('afterDataCallPost', 'audit', {}, auditOne)

// After (3.0)
api.addHook('afterDataCallPost', 'audit', { batch: true }, auditOne)
api.addHook('afterDataCallPostMany', 'audit-many', {}, ({ context }) => auditMany(context.ids))
```

`context.bulkOperation` is gone. `checkPermissions` still runs once per row, with
the row's position in `originalContext.bulkIndex`. `afterCommit` and
`afterRollback` run once per call. The built-in autofilter, Socket.IO and query
projection plugins already have batch forms.

### BulkOperationsPlugin and the HTTP routes

The plugin now only adds the HTTP routes; programs call the resource methods.

| 2.x | 3.0 |
| --- | --- |
| `{ maxBulkOperations, defaultAtomic }` | `{ maxBulkOperations }`; `defaultAtomic` is rejected |
| `maxBulkOperations` default 100 | default 1,000 |
| `POST /bulk` body `{ data: [...] }` | unchanged; runs `postMany` |
| `PATCH /bulk` body `{ operations: [{ id, data }] }` | `{ data: [{ type, id, attributes }] }`; runs `patchMany` |
| `DELETE /bulk` body `{ ids: [...] }` | `{ data: [{ type, id }] }`; runs `deleteMany` |
| `?atomic=true` / `?atomic=false` | removed; any query parameter is a 422 |
| `expectedVersions` in the body | removed; versioned resources answer 422 |
| 200/201 with `{ meta, errors, data }`, even when entries failed | 201 or 200 with `{ data }` when every row was written; otherwise an error response (404, 403 or 422) and nothing is written |

### Types

`types/bulk-methods` and its exports (`BulkResourceMethods`, `BulkPostInput`,
`BulkPatchInput`, `BulkWriteResult`, `BulkDeleteResult`, `BulkMeta`,
`BulkError`, `BulkTransactionOptions`) are removed. Resource handles carry the
new methods; their parameter types are exported from the package root
(`ManyRowWriteOptions`, `ManyRowCreateInput`, `ManyRowPatchInput`,
`SharedPatchInput`, `UpsertOptions`, `ManyRowResult`, `ScopedQueryParams`,
`RecordsResult` and others). `BulkOperationsPluginOptions` has only
`maxBulkOperations`.

## Objects in single-value fields

Only `object` and `array` fields store a structure. A write, filter or cursor
that gives any other field an object or array, as a `none` or `blob` field
accepted from JSON, now fails with `RestApiValidationError` (rule
`single_value`) before any SQL runs. In 2.x, MySQL drivers that format queries
on the client (mysql2 before 3.17, mysql) expanded such an object into
`column = value` pairs, so a value for one column could set others; PostgreSQL
stored the JSON text and SQLite refused it. This also ships in 2.4.1.

| 2.x | 3.0 |
| --- | --- |
| `{ type: 'none' }` holding an object | `{ type: 'object' }`, or a `storage.serialize` function |
| `{ type: 'blob' }` given JSON | a `Buffer` or `Uint8Array` from server code |

## `get` reads once

A `get` on a resource with no `checkPermissions`, `checkDataPermissions`,
`checkDataPermissionsGet`, `beforeData` or `beforeDataGet` hook (for the
resource or global) reads its record in one statement, scope and row policy
included, instead of a minimal read followed by a full read. Not found stays
`not_found` and still answers before an invalid fieldset. Such a get no longer
sets `context.minimalRecord`.

| 2.x | 3.0 |
| --- | --- |
| `enrichRecord`, `finish` or `finishGet` reading `context.minimalRecord` | read `context.record`, or register a `checkPermissions` or `beforeDataGet` hook to keep the minimal read |

## Write failure logs

The `Error in METHOD method` entry that a failed write logs at error level now
carries only the resource, the operation and error codes. In 2.x it also held
the request's `inputRecord` (hidden fields redacted, every other value kept)
and the formatted error, whose message and SQL can repeat the values being
written, so logs collected payment state, ciphertext and other stored secrets.
The error the call throws is unchanged and still carries its `cause`.

| 2.x log field | 3.0 |
| --- | --- |
| `inputRecord` | removed; log what you need from the input yourself, in your own code |
| `error`, `errorSummary` (message, stack, details) | `code`: the error's `code`, or its `name` when it has none |
| `cleanupErrors: [{ phase, error }]` | `cleanupErrors: [{ phase, code }]` |
| `method`, `scopeName`, `phase`, `backend`, `transactionOutcome` | unchanged |

## HTTP error answers and logs

A 500 answer for an error that is not one of the library's own `RestApi…Error`
classes, such as a database error or a plain `Error` thrown by a hook, now has
the detail `An unexpected error occurred`. In 2.x it carried the error's
message, and a database error's message repeats the SQL with its values (Knex
puts the statement and its bindings in it), so a duplicate key answered with
the value that clashed. For a database error, the connector's `HTTP request
error` or `Fastify request error` log entry now records only its `name` and
`code`; PostgreSQL's `detail` and MySQL's `sql` repeat the values too.

| 2.x | 3.0 |
| --- | --- |
| 500 `detail` is the error's message | the message for a `RestApi…Error`; otherwise `An unexpected error occurred` |
| a hook throws `new Error(message)` to tell the client why | throw a `RestApiResourceError` or `RestApiValidationError`, or call `context.reject` in a transport hook |
| the HTTP error log entry holds the database error (message, SQL, values) | `{ name, code }` of the database error |

## System contexts and `context.system`

The autofilter and row-policy plugins now reserve `context.system`. A context
with `system: true` that was not made by `createSystemContext` throws
`REST_API_SYSTEM_CONTEXT_FORGED`. If your application used its own `system`
flag, rename it; if it used one to skip ownership filters, use
`createSystemContext(reason)`.

```js
// Before (2.x): a hand-made flag that each hook had to check
await api.resources.entries.query({}, { system: true })

// After (3.0)
await api.resources.entries.query({}, createSystemContext('monthly report'))
```

A system create must set every autofilter field explicitly; NULL creates a
shared row on a `shared` filter. Row policies receive `system` alongside
`context`.

## Autofilter `shared`

Filter definitions take `shared: true | false` (default false). A value other
than a boolean, or `shared: true` on a field that is not `nullable`, fails when
the resource is added. `getScopeConfig` reports `shared` for each filter.
Outside a system context, shared rows refuse `patch`, `put`, `delete`,
`postRelationship` and `deleteRelationship`, and a create may not leave the
field NULL, also when an optional (`required: false`) filter does not resolve.

## Custom storage plugins

The storage helpers gain `dataScopedQuery`, `dataVisibleIds`, `dataIdsByKeys`,
`dataInsertMany`, `dataUpdateByIds`, `dataDeleteByIds`, `dataLockByIds` and
`dataClaim`. They are optional: a storage plugin without them keeps working,
and the new methods refuse its resources with
`RestApiBulkWriteUnsupportedError`. `RestApiKnexPlugin` implements all of them;
`RestApiAnyapiKnexPlugin` implements only `dataScopedQuery`.

## Verify the port

1. Search for `bulkPost`, `bulkPatch`, `bulkDelete`, `atomic`,
   `expectedVersions`, `defaultAtomic` and `operations:`, and port each call.
2. Search for `system: true` in contexts.
3. Run the application's tests. A many-row write on a resource with per-record
   hooks fails with `RestApiBulkWriteUnsupportedError`; its `details.hooks`
   names the hooks to give a batch form.
4. Search for `patchWhere` and `deleteWhere` calls without `filters`, and add
   `all: true` where every visible row is meant.
5. Update HTTP clients of `/RESOURCE/bulk` to the new PATCH and DELETE bodies
   and to error responses for failed batches.
