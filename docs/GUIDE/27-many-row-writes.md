---
title: "Many-row writes"
chapter: 27
chapter_label: "27"
---

# 27. Many-row writes

Every table-storage resource has six methods that write many rows at once:

| Method | Writes |
| --- | --- |
| `postMany({ data })` | one new record per entry |
| `patchMany({ data: [{ id, ... }] })` | each entry's own changes to the record with that id |
| `patchWhereIds({ ids, data })` | the same changes to every listed record |
| `patchWhere({ filters, data })` | the same changes to every record the filters select (or `all: true`) |
| `deleteMany({ ids })` | the listed records |
| `deleteWhere({ filters })` | every record the filters select (or `all: true`) |

Each call is all-or-nothing. Every row still goes through validation,
ownership stamping (autofilter), setters, relationship checks and
`checkPermissions`, but in memory; the database then sees one statement per
chunk of rows, not one per row. A batch of 10 rows and a batch of 200 run the
same number of statements. Use these methods for imports, mass updates and
jobs; use the single-record methods when each write needs its own hooks.

## Runnable example

Insert the following four JavaScript blocks into the
[starting script](03-running-example.md), after installing table storage and
before declaring other resources, on a fresh database. Many-row writes need
table storage (`RestApiKnexPlugin`); AnyAPI storage refuses them.

```javascript
await api.addResource('books', {
  schema: {
    title: { type: 'string', required: true, search: true },
    isbn: { type: 'string', required: true },
    stock: { type: 'integer', defaultTo: 0 }
  },
  indexes: [{ columns: ['isbn'], unique: true }]
})
await api.resources.books.createKnexTable()
```

```javascript
const created = await api.resources.books.postMany({
  data: [
    { title: 'Alpha', isbn: '111', stock: 3 },
    { title: 'Beta', isbn: '222', stock: 0 }
  ],
  format: 'plain',
  returning: 'full'
})
const restocked = await api.resources.books.postMany({
  data: [{ title: 'Alpha', isbn: '111', stock: 9 }, { title: 'Gamma', isbn: '333' }],
  onConflict: { keys: ['isbn'], action: 'merge', merge: ['stock'] },
  returning: 'minimal'
})
console.log(created.data, restocked.data)
```

Rows come back in input order. Many-row writes return nothing unless you ask:
`returning: 'minimal'` gives identifiers and `returning: 'full'` the records,
read back in the write's transaction. The second call is an upsert: Alpha's
ISBN already exists, so its stock becomes 9, and Gamma is inserted.

```javascript
const [alpha, beta] = created.data
const updated = await api.resources.books.patchMany({
  data: [{ id: alpha.id, title: 'Alpha, 2nd edition' }, { id: beta.id, stock: 4 }],
  returning: 'minimal'
})
const emptied = await api.resources.books.patchWhere({
  filters: { title: 'Gamma' }, data: { stock: 0 }, returning: 'minimal'
})
console.log(updated.data, emptied.data)
```

`patchMany` takes one change set per id. `patchWhereIds` and `patchWhere` apply
one change set to many records. `filters` are the resource's search filters,
validated exactly as `query` validates them.

```javascript
let invalidRow
try {
  await api.resources.books.postMany({ data: [{ title: 'Delta', isbn: '444' }, { isbn: '555' }] })
} catch (error) { invalidRow = error.cause ?? error }
const deleted = await api.resources.books.deleteMany({ ids: [beta.id], returning: 'minimal' })
const remaining = await api.resources.books.query({ format: 'plain' })
console.log(invalidRow.details.index, deleted.data, remaining.data.map(book => book.title))
```

The second row has no title, so the batch writes nothing and the error names
the row: `details.index` is 1 and the field paths start with `data.1.`. Delta
is not stored. The delete removes Beta; Alpha, 2nd edition and Gamma remain.

## Input

`postMany` and `patchMany` take either plain records as `data: [...]` or
JSON:API resource objects as `document: { data: [...] }`, never both. The
`format` option selects only the output. `patchWhereIds` and `patchWhere` take
one record: `data: { ... }` or `document: { data: { type, attributes } }`.

```js
await api.resources.books.postMany({
  document: { data: [{ type: 'books', attributes: { title: 'Epsilon', isbn: '666' } }] }
})
```

Rows may set belongs-to relationships. The library checks every target the
batch names with one scoped read per related type and locks the targets once
for the batch. Rows that set many-to-many or reverse (has-many) relationships
are refused; change those links with single writes or the relationship
methods.

`patchMany`, `patchWhereIds` and `patchWhere` refuse:

- the id;
- autofilter (ownership) fields and the relationships that set them;
- the resource's `lockVersionField`, which every update advances by itself.

They accept a `knex.raw(...)` value for a stored, non-relationship field, so a
counter can move inside the statement:

```js
const knex = api.knex.instance
await api.resources.books.patchWhereIds({
  ids: ['1', '2'], data: { stock: knex.raw('?? + 1', ['stock']) }
})
```

Only a real Knex raw value counts. An object that merely carries an
`isRawInstance` flag, as JSON input can, is refused with a validation error, so
the HTTP routes never pass SQL through. Batch hooks find the fields that raw
values set in `context.rawFields`, and the file-field and positioning refusals
below apply to them as well.

Every row also goes through the resource's setters, and creates through
`defaultTo` values and autofilter stamping, as single writes do. Rows may omit
different fields. On SQLite, a field that some rows set and others omit is
written as NULL for the rows that omit it, so a column default that the schema
does not declare with `defaultTo` does not apply to them.

## Options

| Option | Methods | Default | Meaning |
| --- | --- | --- | --- |
| `returning` | all | `'none'` | `'minimal'` returns `{ data: [{ type, id }] }`; `'full'` (not for deletes) returns the records |
| `format` | writes | resource default | Output format of `'full'` records |
| `queryParams` | writes | | `fields` and `include` of `'full'` records |
| `transaction` | all | | A transaction from `api.transaction` to join |
| `chunkSize` | all | 500 | Rows per statement, lowered further to the database's parameter limit |
| `missing` | `patchMany`, `patchWhereIds`, `deleteMany` | `'throw'` | `'skip'` ignores ids the caller cannot see |
| `onlyIf` | patches | | Compare-and-set: change only rows whose stored values equal these |
| `all` | `patchWhere`, `deleteWhere` | | `true` acts on every row the caller can see; needed when there are no `filters` |
| `onConflict` | `postMany` | | Upsert, below |

Ids that do not exist or that the caller cannot see (another owner's rows,
rows a row policy hides) throw `RestApiRecordsNotFoundError` (subtype
`not_found`, HTTP 404) before anything is written. The error gives only a
count, so it does not reveal which ids exist. With `missing: 'skip'` they are
left out. A batch may not name the same id twice.

With `missing: 'skip'`, `patchMany`, `patchWhereIds` and `deleteMany` read
nothing first when the resource has no `checkPermissions` hook and no
`beforeDataCallPatchMany` or `beforeDataCallDeleteMany` hook (those need the
visible rows before the write). The UPDATE or DELETE carries the caller's
scope, row policy included, as a subquery, and its changed rows are the
answer: the UPDATE and the DELETE return them with `RETURNING` on PostgreSQL
and SQLite; on MySQL and MariaDB a locking read of the scoped rows comes first,
then the write of exactly those rows.

`patchWhere` and `deleteWhere` are set operations. They read the ids of the
rows their selection finds, then write those rows with the caller's scope and
the filters inside every UPDATE or DELETE (on MySQL and MariaDB inside a locking
read of the rows, followed by the write of exactly those). A row that another
transaction deletes, moves out of the caller's scope or changes so that it no
longer matches in the meantime is left out. The result lists the rows actually
written, and the methods never throw `RestApiRecordsNotFoundError`; they take no
`missing` option.

The UPDATE, DELETE and lock statements repeat the caller's ownership
(autofilter) conditions as plain column predicates. A row that another
transaction moves to a different owner between the visibility read and the
write is therefore neither written nor locked, and counts as missing:
`missing: 'throw'` rolls the batch back, `'skip'` leaves the row out of the
result, and with `onlyIf` it is reported unchanged. Row policies are checked by
the visibility read only, as for a single `patch`: a row that leaves the policy
between the read and the write is still written. Without a visibility read
(`missing: 'skip'`, above) the policy is checked by the write's subquery,
which reads as of the statement's start.

`patchWhere` and `deleteWhere` need non-empty `filters`. To change or delete
every row the caller can see, pass `all: true` instead (not both); in a
[system context](34-scoped-reads-and-locks.md#system-contexts) that is the whole
table.

`onlyIf` makes a patch conditional. Only the rows whose stored values still
equal the given ones change, and with `returning: 'minimal'` or `'full'` the
result lists only those rows. With a
[`lockVersionField`](34-scoped-reads-and-locks.md#lock-versions) this is
optimistic locking for many rows:

```js
const changed = await api.resources.orders.patchMany({
  data: [{ id: order.id, status: 'shipped' }],
  onlyIf: { lock_version: order.lock_version },
  returning: 'minimal'
})
if (changed.data.length === 0) {
  // Someone else changed the order first.
}
```

## Upserts

`onConflict: { keys, action, merge }` turns `postMany` into an upsert.
`keys` are the stored fields of a unique index. Each row must give them values,
no two rows may repeat them, and rows may not carry an `id`: the keys identify
the record. With `action: 'ignore'`, rows that match an existing record are
skipped and only the inserted rows are returned. With `action: 'merge'`, the
matching record is updated: the fields in `merge` that the row supplies, or by
default every stored field the rows supply except the keys, the id, ownership
fields and the lock version. A row supplies the fields the caller sent, its
belongs-to links and the fields a setter adds; schema defaults (`defaultTo`)
apply only to the rows merge inserts, never to the records it updates.

Keys compare exactly. A stored value is first read as its field reads it, so
`true` matches a boolean stored as 1 and `1.5` a decimal stored as `1.50`, but
strings compare as they are, without the column's collation. When the database
finds a record that matches the keys only by its own comparison, for example
`'Urgent'` against `'urgent'` under MySQL's case-insensitive collations, the
batch fails with a `conflict` error (409) instead of guessing.

Upserts cannot reach another owner's rows:

- `keys` must include every autofilter (ownership) field of the resource. The
  unique index should include them too.
- `merge` is refused on a resource with a row policy. Insert with `ignore`,
  then `patchMany` the rows the caller may change.
- Only a match on the conflict keys counts. A row that clashes with an existing
  record on any other unique index, the primary key included, fails the batch.
- `merge`, and `ignore` on MySQL and MariaDB, need a unique index whose
  columns are all among the keys, and refuse the batch
  (`RestApiBulkWriteUnsupportedError`) without one. Without it the keys could
  match several records, and the locking read would examine, and on MySQL
  lock, every row of the table. (`ignore` on PostgreSQL and SQLite needs a
  unique index on exactly the keys, as `ON CONFLICT` does.) The first upsert
  on a table reads its indexes once.

`merge` reads the records that match the keys under a row lock, inserts the
other rows with a plain INSERT and updates the matched records by id, a fixed
number of statements per chunk. The records it updates go through a patch's
checks as well as a create's: `checkPermissions` runs with `method: 'patch'`
and the matched record as `minimalRecord`, the resource is refused if a
per-record patch hook without `{ batch: true }` runs for it, and a key that
matches a record the caller cannot see fails the batch as `forbidden`.

`ignore` runs `INSERT … ON CONFLICT DO NOTHING` on PostgreSQL and SQLite. On
MySQL and MariaDB, whose `ON DUPLICATE KEY` fires on every unique index, it
reads the matching keys under a row lock and inserts the rest. With `merge`,
and with `ignore` on MySQL and MariaDB, two transactions that upsert the same
new key at the same time can fail with a unique-key error (PostgreSQL 23505)
or a deadlock (MySQL 1213); retry the batch. InnoDB keeps the locks of every
row a locking read examined until the transaction ends, so keep upserting
transactions short.

## Transactions

Without a `transaction` the call owns one transaction and commits it at the end,
or rolls everything back on any failure. To combine a many-row write with other
work, pass a transaction from `api.transaction`; the method joins it and never
commits or rolls it back.

```js
await api.transaction(async transaction => {
  const order = await api.resources.orders.post({ data: { number: 'A-1' }, transaction, format: 'plain' })
  await api.resources.order_lines.postMany({
    data: lines.map(line => ({ ...line, order: order.id })), transaction
  })
})
```

A raw Knex transaction, a savepoint or a completed transaction is refused before
anything runs. Errors are `RestApiWriteError`s carrying the
`transactionOutcome`; the original error is their `cause`.

## Hooks and refusals

Many-row methods run batch hooks once per call instead of the per-record write
hooks:

| Method | Batch hooks (in order) | Context |
| --- | --- | --- |
| `postMany` | `beforeProcessingPostMany`, `beforeDataCallPostMany`, `afterDataCallPostMany` | `inputRecords`; `ids` after the insert |
| `patchMany`, `patchWhereIds`, `patchWhere` | `beforeProcessingPatchMany`, `beforeDataCallPatchMany`, `afterDataCallPatchMany` | `inputRecords`, `rawFields`, `ids` |
| `deleteMany`, `deleteWhere` | `beforeDataCallDeleteMany`, `afterDataCallDeleteMany` | `ids` |

In the `afterDataCall…Many` hooks, `ids` lists only the rows the write
changed, and for patches `inputRecords` lists their inputs in the same order,
so a row that `missing: 'skip'`, `onlyIf` or a selection left out appears in
neither. `afterCommit` and `afterRollback` run once, with `context.method` set
to the many-row method. `checkPermissions` still runs for every row, with
`method` `'post'`, `'patch'` or `'delete'` and the row's position as
`originalContext.bulkIndex`.

A resource whose per-record write hooks would be skipped is refused rather than
written around them. Register a per-record handler with `{ batch: true }` when
a batch hook does its work, or when it does not apply to many-row writes:

```js
api.addHook('afterDataCallPost', 'audit-create', { batch: true }, auditOne)
api.addHook('afterDataCallPostMany', 'audit-create-many', {}, auditMany)
```

The built-in plugins have batch forms. Autofilter stamps every row; Socket.IO
notifies each changed record that matches a subscription; query projections
apply to every row. Some features stay single-row. The methods throw
`RestApiBulkWriteUnsupportedError` (code `REST_API_BULK_WRITE_UNSUPPORTED`,
HTTP 422) before writing when:

- the resource uses AnyAPI storage;
- the resource has a `versionField`, or its writes advance another resource's
  version (use single writes with `expectedVersion`, or a `lockVersionField`
  with `onlyIf`);
- a per-record write hook without `{ batch: true }` runs for the resource
  (the error's `details.hooks` names them; HTTP responses leave details out);
- rows set many-to-many or reverse relationships;
- rows set file fields (`FileHandlingPlugin`), directly or with raw values;
- rows create positioned records or move them (`PositioningPlugin`), directly
  or with raw values.

## HTTP routes

`BulkOperationsPlugin` exposes the methods over HTTP. Install it after the
connector and before declaring resources:

```js
import { BulkOperationsPlugin } from 'json-rest-api/plugins/core/bulk-operations-plugin.js'

await api.use(BulkOperationsPlugin, { maxBulkOperations: 1000 })
```

`maxBulkOperations` (default 1,000) is the only option; requests with more
entries fail with 422 before anything runs.

| Request | Body | Runs | Response |
| --- | --- | --- | --- |
| `POST /api/books/bulk` | `{ data: [resource objects] }` | `postMany` | 201, `{ data: [records] }` |
| `PATCH /api/books/bulk` | `{ data: [resource objects with id] }` | `patchMany` | 200, `{ data: [records] }` |
| `DELETE /api/books/bulk` | `{ data: [{ type, id }] }` | `deleteMany` | 200, `{ data: [identifiers] }` |

```json
{
  "data": [
    { "type": "books", "id": "1", "attributes": { "title": "Revised" } },
    { "type": "books", "id": "2", "attributes": { "stock": 5 } }
  ]
}
```

Responses are full JSON:API records. The routes take no query parameters and
no `If-Match`. The request's authenticated context reaches every permission
check. Ids the caller cannot see give 404, a permission denial 403, invalid
rows and refused resources 422. Nothing is written in any of these cases. The
plugin reserves `/RESOURCE/bulk`, including when the resource accepts opaque
ids. This protocol is not the JSON:API Atomic Operations extension.

Coming from the 2.x `bulkPost`, `bulkPatch` and `bulkDelete`? See
[migrating to v3](35-migrating-to-v3.md#many-row-writes-replace-the-bulk-methods).
