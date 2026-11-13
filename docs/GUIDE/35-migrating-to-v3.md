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
  storage serializer can be bucketed and take `min` and `max`. In a system
  context, a hidden ownership field may be grouped and counted distinct. See
  [AGGREGATE](../API.md#aggregate---grouped-totals).
- **One read for `get`:** a resource with no `checkPermissions`,
  `checkDataPermissions`, `checkDataPermissionsGet`, `beforeData` or
  `beforeDataGet` hook reads its record in one statement; such a get no
  longer sets `context.minimalRecord` (read `context.record` in later hooks).
- **Skipping writes in one statement:** `patchMany`, `patchWhereIds` and
  `deleteMany` with `missing: 'skip'` put the scope in the UPDATE or DELETE
  instead of reading the visible ids first, when no permission or
  before-data-call batch hook needs those rows (not on MySQL and MariaDB,
  where InnoDB would lock every listed row before checking the scope; there a
  patch of one visible row runs its UPDATE without a locking read first).
- **Fewer reads before single writes:** on table and AnyAPI storage, `patch`
  and `delete` read their row once, scoped, before the UPDATE or DELETE, and a
  `put` that replaces a row reads it twice (whether it exists, then scoped)
  instead of three times. The unscoped read that checked the row still existed
  is gone; the write's own row count answers a row that vanished in between
  (`not_found`, as before).
- **Single writes keep to their owner:** on table and AnyAPI storage, the
  UPDATE or DELETE of a single `patch`, `put` or `delete` carries the
  ownership (autofilter) conditions its scoped read found, as many-row writes
  already did. A row that another writer moved to a different owner after the
  read answers `not_found` instead of being written. On AnyAPI storage a row
  that vanished after the read now answers `not_found` too, where the write
  used to change nothing and report success.
- **Links to hidden targets survive a write-back:** a `patch`, `put`,
  many-row patch or merge upsert that sets a belongs-to to null keeps the
  stored link when its target exists but is hidden from the writer, as the read
  showed the link as unassigned. It used to clear it. Clear such links in a
  system context.
- **Polymorphic links are set through the relationship only:** the type and id
  fields behind a polymorphic belongs-to (`owner_type`, `owner_id`) are refused
  in attributes, as foreign keys already were (rule
  `foreign_key_in_attributes`), so a write cannot skip the target check or half
  clear a link. Send `owner: { _type, id }` (plain) or `relationships.owner`
  (JSON:API) instead.
- **Selection writes:** `patchWhere` and `deleteWhere` carry the scope and the
  filters in every UPDATE or DELETE and return the rows they wrote; a row that
  vanishes or stops matching in the meantime is left out, never an error.
- **Counts:** `returning: 'count'` on every many-row write returns
  `{ meta: { count } }`, the number of rows written, without reading rows back.
- **Upserts on the id:** on a resource with no ownership fields and no row
  policy, `onConflict: { keys: ['id'], action }` (or the `idProperty`, such as
  an email natural key) creates the rows that do not exist yet, atomically.
- **Integer fields over BIGINT columns read as numbers:** an `integer` or
  `number` field whose driver returns a string (PostgreSQL's BIGINT, MySQL's
  BIGINT past 2^53) reads as a number when a JavaScript number holds it exactly,
  on every read and write response, as aggregates already did. It used to stay
  a string, such as `"4400"`. A longer integer, or a fraction a number cannot
  hold exactly, keeps its digits as a string, where an aggregate used to round
  it; decimal fields (`precision` and `scale`) keep their strings.
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

## Values and links that read or write differently

| 2.x | 3.0 |
| --- | --- |
| an `integer` field over a PostgreSQL BIGINT column reads `"4400"` | `4400`; a value past 2^53 stays a string |
| an aggregate group, `min` or `max` of a BIGINT past 2^53 is a rounded number | the exact digits, as a string |
| a `patch` or `put` of `accountId: null` by a writer who cannot see the account clears the link | keeps it; clear it in a system context |
| `owner_type` and `owner_id` in attributes set a polymorphic link | refused; send `owner: { _type, id }` or `relationships.owner` |

## Blob fields (3.1.2)

A `blob` field was any value of any size, read by every list. From 3.1.2 it
holds bytes within limits on every database (see
[Blob Fields](../API.md#blob-fields)):

| 3.1.1 | 3.1.2 |
| --- | --- |
| `{ type: 'blob' }` | needs `maxBytes`, the most bytes a value holds; registration refuses it otherwise, and refuses `maxBytes` on another type |
| a blob with `search`, `unique`, `indexed` or a default | refused when the resource is added |
| a blob on AnyAPI storage | refused when the resource is added; keep the resource on table storage |
| `get` and `query` answer the blob | answered only when sparse fieldsets name it |
| any page, include or HTTP response holds blobs | a read holds at most 16 MiB of named blobs or one record's; includes, `queryAll` and HTTP responses name none (rule `blob_read`) |
| sort by a blob | refused |
| a MySQL or MariaDB `blob` column (64 KiB) | `createKnexTable` picks the column type that holds `maxBytes`; the migration diff grows a smaller one |

Upgrading: give each blob `maxBytes`, no more than its column holds, and name
the blob in `queryParams.fields` where a read needs it.

## Text filters match literally (3.1.2)

`contains`, `startsWith` and `endsWith` filters, and search fields built on them,
search for the value as written on every database: `%`, `_` and `\` match only
themselves. Before, `%` and `_` (and on MySQL and PostgreSQL `\`) were LIKE
pattern syntax, so `50%` also matched `500`. Use a search field with
`applyFilter` for a real pattern.

## Link checks on writes (3.1.3)

A write checks the targets its relationships link to with one statement per
target type, which for the belongs-to and polymorphic targets it stores also
takes their shared lock (see
[relationship locks](13-hooks-and-lifecycle.md#relationship-and-many-row-composition)):

| 3.1.2 | 3.1.3 |
| --- | --- |
| a scoped read of the targets' whole rows, then a second statement per type locking them | one scoped read per type that locks them, of their ids alone (of the minimal records, for a target resource with a `checkPermissions` hook, which receives them) |
| the targets are locked after the `beforeDataCall` hooks | they are locked while the write checks its relationships, before `beforeSchemaValidate` |
| in a system context every link is read | a belongs-to whose declared foreign key protects it is left to that key (see [system contexts](34-scoped-reads-and-locks.md#system-contexts)); a missing target then fails with the database's foreign key error, not `not_found` |

A missing target, or one its row policy hides, is refused as before
(`not_found`, with `resourceType` and `resourceId`). Upgrading: a hook that
updates a row the write links to must lock it `FOR UPDATE` in
`beforeProcessing` (or the method's processing hook), no longer in
`beforeDataCall`, which now runs after the shared lock is taken.

## Read-only subqueries and shared locks (3.1.5)

| 3.1.4 | 3.1.5 |
| --- | --- |
| a plain Knex builder taking a read-only builder (a `scopedQuery`, or `readOnlyQueryBuilder`'s) as a subquery (`whereExists`, `whereIn`, a joined or `from` subquery) compiled it without its joins: an error when a predicate named a joined table, otherwise the subquery ran without the joins' narrowing and matched more rows | the joins compile; the statement lists still read as frozen copies outside Knex's own methods |
| `lockMode` is `'update'` or `'noKeyUpdate'` | `lockByIds` and `lockWhere` also take `'share'` (`FOR SHARE`; `LOCK IN SHARE MODE` on MySQL and MariaDB); `claim` and `patchWhere` refuse it with `RestApiValidationError` (rule `lock_mode`) |

Upgrading: none. A subquery that passed only because its joins were dropped
now applies them, so check the results of plain builders that took a read-only
one. See [Lock mode](34-scoped-reads-and-locks.md#lock-mode) for when a shared
lock fits.

## Link checks within a transaction (3.1.6)

A transaction from `api.transaction` (or a write's own) answers a link check,
or the check of a to-one link a response shows, from its own earlier check of
the same row when that check sent the same statement (the same table, and the
same ownership, row policy and filter predicates with the same values) under a
lock at least as strong, and the transaction has sent nothing since that could
change the answer:

| 3.1.5 | 3.1.6 |
| --- | --- |
| every write read each row it links to, and every response each to-one link it shows | a transaction reads each row once per scope and lock, until it sends a statement that could change the answer |
| a write linking rows of one table reads them with one statement | unchanged: the rows the transaction has not already checked, with one statement |

A transaction checks a row again after it inserts into or updates a table the
check's statement names (a row policy's subqueries included), after an update
that sets a column any remembered check names (an ownership column such as
`workspace_id`, or an id), and after a delete, an upsert, a savepoint's
rollback or release, or any other statement. A check that found no row is not
remembered, the hooks that build a check's statement still run for every
check, and nothing is remembered outside a transaction or from one transaction
to the next. Installing a module (a form and a module, each with a version it
publishes, every row naming its author and publisher) in one transaction sent
55 statements and now sends 30; 32 modules in one transaction sent 1,698 and
now send 836, of which 162 are checks instead of 1,024: the two users every row
names are checked twice instead of 480 times, on MariaDB 11.4 and PostgreSQL
alike.

A remembered answer holds for the rest of the transaction as of its first
check. Under REPEATABLE READ (MySQL's and MariaDB's default) a repeated check
would read the same rows from the transaction's snapshot or its locks. Under
READ COMMITTED (PostgreSQL's default) each statement sees other transactions'
latest commits, so a row another transaction moves out of scope after this one
checked it is no longer refused by this transaction's later links to it, as it
already was not for the links made before the move.

Upgrading: none. The library sees the statements a transaction sends, not what
the database does by itself: a trigger's writes, a foreign key cascade from a
key column no remembered check names, or a row policy that reads a table only
through a view, a function or session state. A transaction that relies on one
of those to hide a row it has already linked must not count on a later link
check to refuse that row.

## Aggregates read only the rows they group (3.1.7)

| 3.1.6 | 3.1.7 |
| --- | --- |
| `aggregate` grouped the table's rows whose IDs the filtered query selected (`where id in (select id … where <filters>)`); that outer read named no filter, so the database could read every row of the table to find them | the filtered query is grouped as it reads, so only the rows its filters select are read, through their index |
| a filter or row policy that joins another table: the IDs the filtered query selects | unchanged, since a join could repeat a row inside a group |

What the old read cost depended on the planner. PostgreSQL 18 folds it back
into one read when the table is not partitioned and the ID is its primary key;
on a partitioned table, and before 18, once the selection held many rows it
joined their IDs by hash over the whole table. MySQL and MariaDB read the whole
table whenever they chose to start from it. A report over one owner's 115,000
rows in a partitioned PostgreSQL 18 table of 8.6 million rows read all 8.6
million in each of its four aggregates, 1.2 to 1.9 seconds each, and took 8.6
seconds; it now reads the owner's rows through their index and takes 0.14
seconds. Results are unchanged.

Upgrading: none.

## Lock order, lock limits and fewer statements (3.1.8)

| 3.1.7 | 3.1.8 |
| --- | --- |
| `lockWhere` locked every match, in id order (on MySQL and MariaDB in the order of the index it forces) | also takes `sort`, which locks and returns the rows in that order, then by id, and `limit` (1 to 1,000), which locks only the first rows of that order, by id without a `sort` |
| on PostgreSQL `lockWhere` always read a second time under its locks, so locking one row was two statements | it reads again only while it holds fewer rows than its `limit`: `lockWhere` with `limit: 1` that finds its row is one statement, as `lockByIds` is; without a `limit`, unchanged |
| on MySQL and MariaDB each `lockWhere` first read the connection's schema (`SELECT DATABASE()`) | once per Knex client whose connection settings name a database; at every call for a client that names none |
| a response's to-one link was read for visibility unless the context was a system context and a declared foreign key protects the link | also in any other context when the target has no ownership fields, as well as no row policy and no filtering hook of the app's own: that read would return every linked id. A write's link checks are unchanged, and SQLite still reads every link |

On MySQL and MariaDB a `sort` or `limit` needs an index that reads the rows in
the lock's order (see [Row locks](34-scoped-reads-and-locks.md#row-locks)),
since InnoDB locks rows in the order it reads them; without one `lockWhere`
throws `RestApiBulkWriteUnsupportedError`, naming the columns, before any lock.
A lock of one row by a unique key the filters fix whole needs no other index.

Upgrading: none for a `lockWhere` without the new options. A `USE` on a pooled
connection of a client whose settings name a database no longer moves
`lockWhere`'s index search to the other schema: give each database a client
of its own, or leave the database out of the client's settings. A test or
budget that counts a read's statements counts one fewer for each linked type
that now needs no read.

## Current selections, lock pages and ignored upserts with ids (3.1.9)

| 3.1.8 | 3.1.9 |
| --- | --- |
| on MySQL and MariaDB `patchWhere` and `deleteWhere` read their selection plainly, from the transaction's snapshot: inside a transaction that had already read plainly, they left out rows committed since | the selection is a locking read in the write's lock mode, which reads the latest committed rows, as `UPDATE … WHERE` does; the same statements |
| `lockWhere` locked at most 1,000 rows | `after` (an id) pages it in id order: only the rows after that id |
| an upsert row could not carry an `id`, so a table keyed by a UUID the caller generates had no insert-or-ignore | an ignore's rows may carry the ids they insert with; a row whose keys match keeps the stored id, and an id another row has, under other keys, fails as a duplicate; a merge's rows still carry none |

Upgrading: on MySQL and MariaDB a selection write now locks the rows its
selection examines from that read on, where it locked the rows it selected a
statement later, so give its filters an index. With MariaDB's
`innodb_snapshot_isolation` on, a selection that meets a row changed since the
snapshot fails with errno 1020; retry the transaction. PostgreSQL and SQLite
are unchanged.

## A lock's row policy reads current rows (3.1.10)

| 3.1.9 | 3.1.10 |
| --- | --- |
| `lockByIds` and `lockWhere` locked their own rows only; a row policy's subqueries (a `whereExists` over a membership, a `whereIn` over grants) were plain reads, which on MySQL and MariaDB under REPEATABLE READ answer from the snapshot of the transaction's first plain read: a member removed since still locked and read the rows, and a grant added, revoked or moved since was ignored | every SELECT nested in the locking read's conditions (a row policy's, at any depth and in any form the builder writes, and a filter's) takes a shared lock, `FOR SHARE` on PostgreSQL and `LOCK IN SHARE MODE` on MySQL and MariaDB, whatever `lockMode`, so the lock decides from the deciding rows as last committed, waits for a transaction changing them, and keeps them unchanged until commit |
| on PostgreSQL a lock that waited for a writer of its row rechecked the row against the policy's rows as they were when the statement began | the policy's subqueries wait for their own writers and read what they committed |

See [A lock's row policy reads current rows](34-scoped-reads-and-locks.md#a-locks-row-policy-reads-current-rows)
for why the lock is shared, the SELECTs a database refuses one on (they stay
plain reads) and what PostgreSQL's statements still cannot see.

Upgrading: no policy changes. Hand-written locking SQL that repeated a policy's
subqueries with their own lock clause, to make the decision current, can go:
call `lockByIds` or `lockWhere` instead. A lock now holds its policy's deciding
rows shared until commit, so a transaction that changes a membership or grant
waits for the locks that read it; on MySQL and MariaDB give the policy's
subqueries indexes that find those rows directly, since a locking read locks
every row it examines. With MariaDB's `innodb_snapshot_isolation` on, and on
PostgreSQL at REPEATABLE READ or SERIALIZABLE, a deciding row changed since the
transaction's snapshot can fail the lock (errno 1020; `40001`) where 3.1.9
answered from the snapshot: retry the transaction. `claim`, SQLite and every
read that takes no lock are unchanged.

## Custom storage plugins

The storage helpers gain `dataScopedQuery`, `dataVisibleIds`, `dataIdsByKeys`,
`dataInsertMany`, `dataUpdateByIds`, `dataDeleteByIds`, `dataLockByIds`,
`dataLockWhere` and `dataClaim`. They are optional: a storage plugin without them keeps working,
and the new methods refuse its resources with
`RestApiBulkWriteUnsupportedError`. `RestApiKnexPlugin` implements all of them;
`RestApiAnyapiKnexPlugin` implements all but the lock helpers `dataLockByIds`,
`dataLockWhere` and `dataClaim` (in 3.0.0 it implemented only `dataScopedQuery`).

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
