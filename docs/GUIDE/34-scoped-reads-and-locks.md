---
title: "Scoped reads, locks and system work"
chapter: 34
chapter_label: "34"
---

# 34. Scoped reads, locks and system work

Ownership filters ([autofiltering](16-autofiltering.md)) and
[row policies](17-row-policies.md) apply to every resource method. This chapter
covers the tools for work that does not fit a page of records, so that
it does not need hand-written Knex that skips them:

- shared rows that every owner reads;
- `scopedQuery`, a read-only Knex builder already limited to the caller's rows;
- `queryAll`, every matching row in cursor pages;
- window includes, the newest few related rows per parent;
- `lockByIds`, `lockWhere` and `claim`, row locks inside a transaction;
- `lockVersionField`, a counter every update advances;
- system contexts, for jobs that work across every owner.

Together with [many-row writes](27-many-row-writes.md) and
[aggregates](../API.md#aggregate---grouped-totals) they cover reports, imports and
background jobs. Locks and lock versions need table storage
(`RestApiKnexPlugin`). On AnyAPI storage `scopedQuery` builds on the canonical
rows, whose fields live in storage slots, so there it suits counts and id
subqueries rather than reports by field name.

## Runnable example

Insert the following five JavaScript blocks into the
[starting script](03-running-example.md), after installing table storage and
before starting the server, on a fresh database.

```javascript
import { AutoFilterPlugin, createSystemContext } from 'json-rest-api'

await api.use(AutoFilterPlugin, {
  resolvers: { workspace: ({ context }) => context.session?.workspaceId },
  presets: {
    workspace: { filters: [{ field: 'workspace_id', resolver: 'workspace' }] },
    workspaceOrShared: { filters: [{ field: 'workspace_id', resolver: 'workspace', shared: true }] }
  }
})
await api.addResource('categories', {
  schema: {
    name: { type: 'string', required: true },
    workspace_id: { type: 'string', nullable: true }
  },
  autofilter: 'workspaceOrShared'
})
await api.addResource('jobs', {
  schema: {
    title: { type: 'string', required: true, search: true },
    state: { type: 'string', defaultTo: 'queued', search: true },
    priority: { type: 'integer', defaultTo: 0 },
    workspace_id: { type: 'string', required: true },
    lock_version: { type: 'integer', defaultTo: 0 }
  },
  autofilter: 'workspace',
  lockVersionField: 'lock_version'
})
await api.resources.categories.createKnexTable()
await api.resources.jobs.createKnexTable()
const workspace = workspaceId => ({ session: { workspaceId } })
```

```javascript
const seeding = createSystemContext('seed shared categories')
await api.resources.categories.post({ data: { name: 'General', workspace_id: null } }, seeding)
await api.resources.categories.post({ data: { name: 'Acme only' } }, workspace('acme'))
const acmeCategories = await api.resources.categories.query({ format: 'plain' }, workspace('acme'))
const otherCategories = await api.resources.categories.query({ format: 'plain' }, workspace('other'))
const general = acmeCategories.data.find(category => category.name === 'General')
let sharedEdit
try {
  await api.resources.categories.patch({ id: general.id, data: { name: 'Renamed' } }, workspace('acme'))
} catch (error) { sharedEdit = error.cause ?? error }
console.log(acmeCategories.data.map(category => category.name), otherCategories.data.map(category => category.name), sharedEdit.subtype)
```

Acme reads General and Acme only; the other workspace reads only General. An
ordinary context cannot change the shared row, so the patch fails as
`forbidden`.

```javascript
await api.resources.jobs.postMany({
  data: [
    { title: 'Resize images', priority: 5 },
    { title: 'Send digest', priority: 1 },
    { title: 'Rebuild index', priority: 9, state: 'done' }
  ]
}, workspace('acme'))
await api.resources.jobs.post({ data: { title: 'Other workspace job' } }, workspace('other'))

const { query } = await api.resources.jobs.scopedQuery({}, workspace('acme'))
const byState = await query.select('state').count({ total: '*' }).groupBy('state').orderBy('state')
const everyJob = await api.resources.jobs.queryAll({ format: 'plain', pageSize: 2 }, workspace('acme'))
console.log(byState, everyJob.data.map(job => job.title))
```

The scoped query counts only Acme's jobs: one `done` and two `queued`.
`queryAll` reads Acme's three jobs in two pages.

```javascript
const claimed = await api.transaction(async transaction => {
  const taken = await api.resources.jobs.claim({
    filters: { state: 'queued' }, sort: ['-priority'], limit: 1, format: 'plain', transaction
  }, workspace('acme'))
  await api.resources.jobs.patchWhereIds({
    ids: taken.data.map(job => job.id), data: { state: 'running' }, transaction
  }, workspace('acme'))
  return taken.data
})
const locked = await api.transaction(async transaction => {
  const { data } = await api.resources.jobs.lockByIds({ ids: [claimed[0].id], format: 'plain', transaction }, workspace('acme'))
  return data[0]
})
let outsideTransaction
try {
  await api.resources.jobs.lockByIds({ ids: [claimed[0].id] }, workspace('acme'))
} catch (error) { outsideTransaction = error }
console.log(claimed.map(job => job.title), locked.state, locked.lock_version, outsideTransaction.name)
```

The claim takes the queued job with the highest priority, Resize images, and
marks it running in the same transaction. The update advanced its lock version
to 1. Locks need a transaction, so the last call fails with
`RestApiLockOutsideTransactionError`.

```javascript
const nightly = createSystemContext('nightly job report')
const everyOwner = await api.resources.jobs.queryAll({ format: 'plain' }, nightly)
let forged
try {
  await api.resources.jobs.query({ format: 'plain' }, { system: true })
} catch (error) { forged = error.cause ?? error }
console.log(everyOwner.data.length, forged.code)
```

The system context reads all four jobs. A context that only claims
`system: true` fails with `REST_API_SYSTEM_CONTEXT_FORGED`.

## Shared rows

An autofilter filter with `shared: true` marks rows whose field is NULL as
shared: every owner reads them. The field must be `nullable`.

| Operation | Sees |
| --- | --- |
| `query`, `get`, includes, `aggregate`, `scopedQuery` (`purpose: 'report'`) | the owner's rows and shared rows |
| many-row writes, `lockByIds`, `lockWhere`, `claim`, `scopedQuery` with `purpose` `'bulk-write'`, `'lock'` or `'claim'` | only the owner's rows |
| single `patch`, `put`, `delete` of a shared row, and `postRelationship` or `deleteRelationship` on it | refused as `forbidden` outside a system context |
| `post` | stamps the owner; a create that would leave the field NULL is `forbidden` |

A filter with `required: false` may not resolve, for example for a caller
without a workspace. Reads are then not narrowed by it, but writes, locks and
claims still skip the shared rows, and a create outside a system context must
name an owner.

`deleteRelationship` on a many-to-many relationship leaves links to targets
the caller cannot see, as it leaves links to missing targets: when the target
type has ownership filters or a row policy, it reads which targets are visible
first (one read per type and 1,000 ids).

A read shows a belongs-to link whose target the caller cannot see as
unassigned (`data: null`), so a caller that writes the record back, as a form
sends what it read, sends null for a link it never saw. `patch`, `put` and
the many-row patches therefore keep such a link: a belongs-to (or polymorphic
belongs-to) the write sets to null, whose stored target exists but is hidden
from the writer, stays as stored, and the rest of the write applies. Linking
a visible target, and clearing a link to a visible or missing target, apply as
asked. Only a write that clears a link pays for the check: one read of the
targets' visibility, and one more of the hidden targets' existence. A
many-row patch with such a row reads its rows first.

Create and change shared rows with a [system context](#system-contexts).
`api.autofilter.getScopeConfig(...)` reports `shared` for each filter, and
`schemaInfo.ownershipFields` lists a resource's autofilter fields.

## scopedQuery

`scopedQuery(params, context)` resolves to `{ query }`: a Knex builder over the
resource's rows with the caller's ownership filters, row policy and the given
search `filters` already applied. (It is wrapped in an object because a Knex
builder is thenable and would run if an async method returned it.) Use it for
reports that `aggregate` cannot express, and as a subquery.

The builder selects from a derived table, `(SELECT alias.* FROM table AS alias
WHERE …) AS alias`, so conditions you add, `orWhere` and `whereRaw('a OR b')`
included, can only narrow the scoped rows. Refer to columns as `alias.column`
or by bare name.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `filters` | | Search filters, validated as `query` validates them |
| `alias` | the table name | Table alias for your column references |
| `purpose` | `'report'` | `'report'` includes shared rows; `'bulk-write'`, `'lock'` and `'claim'` do not. Row policies receive it as `queryPurpose` |
| `transaction` | | Knex transaction to read in |

```js
const { query } = await api.resources.entries.scopedQuery({ alias: 'e', filters: { status: 'open' } }, context)
const totals = await query
  .join('accounts as a', 'a.id', 'e.account_id')
  .select('a.name')
  .sum({ total: 'e.amount' })
  .groupBy('a.name')
```

The caller needs `query` permission on the resource. The builder is
SELECT-only: `insert`, `update`, `delete`, `forUpdate` and the other locking
reads, table changes (`from`, `fromRaw`, `table`), the methods that clear
existing predicates, set operations (`union`, `unionAll`, `intersect`,
`except`), common table expressions (`with`, `withRecursive`,
`withMaterialized`), access to its Knex `client`, replacing its statement
lists (`_statements`, `_single`), and defining or deleting its properties throw
`RestApiScopedQueryReadOnlyError`, on clones too. Read from outside Knex's own
methods, `_statements` and `_single` are frozen copies, so they cannot be
changed in place either. The builder
guards against mistakes, not hostile code: code that means to bypass it can use
Knex directly. A table you join is not scoped by the builder; join only what
the caller may see, or scope it with its own `scopedQuery`.
`readOnlyQueryBuilder(builder, { resourceType })` is exported for builders your
own code produces.

## queryAll

`query` returns one page. `queryAll(params, context)` returns every matching
record, reading cursor pages in id order (or the given `queryParams.sort`):

```js
const { data } = await api.resources.entries.queryAll({
  queryParams: { filters: { account: accountId }, include: ['labels'] },
  pageSize: 1000,
  rowLimit: 10000
}, context)
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `queryParams` | | As for `query`, without `page` |
| `pageSize` | 1,000 | Rows per statement |
| `rowLimit` | none | Throws `RestApiRowLimitError` once more rows than this are read |
| `format`, `transaction` | | As for `query` |

It costs one statement per page plus the page's includes. Use it for id-list
reads, one parent's rows and jobs; for request handlers, set a `rowLimit` and
send larger work to a background job.

## Window includes

An include normally applies one limit to all included targets. With the
window strategy a to-many relationship includes up to `limit` related rows
per parent, ordered by `orderBy`, which is how to read "the newest snapshot of
each booking" in one query:

```js
await api.addResource('bookings', {
  schema: { reference: { type: 'string', required: true } },
  relationships: {
    snapshots: {
      type: 'hasMany',
      target: 'snapshots',
      foreignKey: 'booking_id',
      include: { strategy: 'window', limit: 1, orderBy: ['-revision'] }
    }
  }
})

const page = await api.resources.bookings.query({ queryParams: { include: ['snapshots'] } }, context)
```

The strategy is part of the relationship definition, not of the query. The
included rows pass the target's ownership filters, row policy and permission
check before the window is applied. The database must support window functions
(`api.knex.capabilities.windowFunctions`); SQLite 3.25+, PostgreSQL, MySQL 8
and MariaDB 10.2+ do. AnyAPI storage applies the same rule.

## Row locks

`lockByIds`, `lockWhere` and `claim` lock rows until the transaction ends. All
three refuse to run outside a transaction (`RestApiLockOutsideTransactionError`);
pass one from `api.transaction`. They return the records as the locking read saw
them, through the read pipeline of `query`: `checkDataPermissions` runs for each
row as for `get`, then `enrichRecord`, computed fields and the `finish` and
`finishQuery` hooks, which see `method: 'query'` and `lock: true`.

The locking read is the lock's first statement on the resource's rows and
carries the caller's ownership and row-policy predicates itself; the library
makes no plain read of those rows before it. On MySQL and MariaDB this matters:
under REPEATABLE READ the first plain read of a transaction fixes its
snapshot, so a plain read before a lock wait would hide from every later read
in the transaction what the lock holder committed while it waited (and with
`innodb_snapshot_isolation=ON` the lock itself would fail with
`ER_CHECKREAD`). After a lock, plain reads in the same transaction see what the
previous holder committed, as long as the transaction made no plain read
before the lock. Some plain reads can still come first or run inside the
statement, and start the snapshot: subqueries of a row policy (InnoDB reads a
locking read's subqueries without locks, from the snapshot), the scope
subquery of a selection write's locking read on MySQL (`patchWhere`,
`deleteWhere`), a `checkPermissions` or `knexQueryFiltering` hook that queries
the database, and the first `lockWhere` for a MySQL table and set of filtered
columns, which reads the table's indexes (below). Where the snapshot matters, keep those reads out of the lock's
path, or make them before the transaction. For the same reason the query must
stay a plain `SELECT` on the resource's table: a row policy or
`knexQueryFiltering` hook that adds joins, a common table expression or a set
operation, or replaces the source table, is refused for all three (rule
`lock_single_table` or `claim_single_table`), because the database would lock
the joined rows too or lock nothing at all.

`lockByIds({ ids, transaction, missing, format, queryParams: { fields } })`
locks the listed rows the caller can see, in id order, so two transactions that
lock overlapping sets cannot deadlock on each other. It locks 1,000 ids per
statement; longer lists are sorted first (integer ids numerically, other ids
by code unit, the database's order for integer keys and binary collations), so
they too lock in one order. Hidden or missing ids throw
`RestApiRecordsNotFoundError`, or are left out with `missing: 'skip'`. The
locked rows show the latest committed values even when the transaction began
earlier.

On MySQL and MariaDB, InnoDB locks each listed primary-key row before it
evaluates the ownership and row-policy predicates, and under REPEATABLE READ
holds that lock until commit. A listed id the caller cannot see is therefore
still locked, and waited for when another transaction holds it, although it
is not returned: its lock is a short denial of service against the row's owner
and its wait a timing signal that the row exists. This is how
`WHERE id = ? AND owner = ? FOR UPDATE` behaves on InnoDB. Pass `lockByIds` ids
from a scoped read or from a route that has already checked the caller may use
them, never a raw list from a request.

`lockWhere({ filters, transaction, format, queryParams: { fields } })` locks
every row the filters select that the caller can see, in id order, waiting for
transactions that hold them, and returns them. A row that starts to match while
it waits is locked and returned too: InnoDB's locking reads see the latest rows,
and on PostgreSQL, whose statements only find rows committed when they began,
`lockWhere` reads again under the locks it holds until no new row appears. It
locks at most 1,000 rows and throws `RestApiRowLimitError` when more match. Use
it, not `scopedQuery`, to lock by filter: the scoped builder is a read-only
derived table that cannot lock.

On MySQL and MariaDB, InnoDB locks every row a locking read examines, and every
gap between them, until commit. Ordering by id could make it walk the primary
key across every owner's rows, so there `lockWhere` has no `ORDER BY` and
forces (`FORCE INDEX`) an index that keeps the read inside the caller's rows;
rows come in that index's order. The index's leading columns must be the whole
ownership (autofilter) columns the read is limited to (a prefix index on them
does not count), or, when no ownership condition applies, it must start with a
column the filters compare. Among those, an index whose next column the filters
compare is preferred. Invisible (MySQL) and ignored (MariaDB) indexes cannot be
forced and do not count. Without such an index `lockWhere` throws
`RestApiBulkWriteUnsupportedError` before locking anything. Each call reads the
connection's schema with `SELECT DATABASE()`, which reads no table, so one pool
can serve several databases. The first call for a schema, table and set of
columns also reads the table's indexes, in the transaction, and the index it
picks is remembered while the process runs: restart after changing the
indexes of a table that `lockWhere` uses.

No ownership condition applies to a resource without ownership fields, to a
system context, or to a resource that has only a row policy, which is not an
ownership condition. There the forced index starts with a filtered column, so
the read examines and locks every row the filters match, the rows of other
policy owners included, although it returns only the rows the policy shows.
Give such a resource ownership fields, or lock its rows with `lockByIds` on ids
from a scoped read.

`claim({ filters, sort, limit, transaction, format, queryParams: { fields } })`
takes up to `limit` matching rows (default 1, at most 1,000) that no other
transaction holds, in `sort` order (stored fields; default `['id']`). Rows other
workers hold are skipped (`SKIP LOCKED`), so several workers can share one
queue. Change the claimed rows in the same transaction, as the example does.
A row policy that joins other tables is refused for `claim`, because the
database would lock the joined rows too.

| Database | `lockByIds` | `lockWhere` | `claim` |
| --- | --- | --- | --- |
| PostgreSQL | `FOR UPDATE` on the visible ids | `FOR UPDATE`, read again until no new row appears | `FOR UPDATE SKIP LOCKED` |
| MySQL 8, MariaDB 10.6+ | `FOR UPDATE` on the listed ids, hidden ones included (above) | `FOR UPDATE` without `ORDER BY`, forced onto an index that starts with the ownership or a filtered column | reads candidates, then locks windows of them by primary key on the bare table with `SKIP LOCKED` (InnoDB locks every row a locking read examines), and reads the held rows again under the lock to drop any that stopped matching |
| SQLite | the write lock, then a scoped read | the write lock, then a scoped read | the write lock, then a scoped read |

On MySQL and MariaDB the candidate read of `claim` is a plain read, the only way
to choose rows in sort order without locking every row the sort examines, so it
starts the transaction's snapshot. `claim` never waits for a lock, so that
snapshot misses only what commits during the claim itself; with
`innodb_snapshot_isolation=ON` a candidate that another transaction changes
between the two reads makes the claim fail with `ER_CHECKREAD`, and the caller
retries.

SQLite allows one writer at a time, but a transaction that has only read holds a
shared lock, which does not keep another connection from writing, and its own
later write could then fail with `SQLITE_BUSY` halfway through the work. So on
SQLite each lock first runs a write that changes nothing
(`UPDATE … SET id = id WHERE 0 = 1`), which takes the database's write lock for
the rest of the transaction, once per transaction, and then reads the rows. The
caller's transaction can stay a deferred `BEGIN`. Because the lock is a write,
it fails with `SQLITE_READONLY` on a read-only connection. In WAL mode, a
transaction that has already read keeps that snapshot, and if another
connection has written since, taking the write lock fails with
`SQLITE_BUSY_SNAPSHOT`; roll back and run the transaction again.

## Lock versions

`lockVersionField` names a stored, non-nullable integer field that the library
advances on every update: single `patch` and `put`, every many-row patch and
upsert merge set it to `column + 1` in the UPDATE itself. Callers cannot set it,
and a `put` need not repeat it.

```js
await api.addResource('orders', {
  schema: {
    status: { type: 'string', required: true },
    lock_version: { type: 'integer', defaultTo: 0 }
  },
  lockVersionField: 'lock_version'
})
```

Combine it with `onlyIf` for compare-and-set updates (see
[many-row writes](27-many-row-writes.md#options)). It is separate from
`versionField`, the revision token of [HTTP validators](22-version-field-migrations.md):
the field may not be the id, the `versionField`, a relationship, or have
getters, setters or a storage serializer. AnyAPI storage refuses it.

## System contexts

Some work legitimately spans every owner: nightly reports, imports, cleanup
jobs. Give it a system context instead of a context with forged scope values:

```js
import { createSystemContext, isSystemContext } from 'json-rest-api'

const context = createSystemContext('close the month for every workspace', { jobId })
await api.resources.entries.patchWhere({ filters: { status: 'open' }, data: { status: 'closed' } }, context)
```

`createSystemContext(reason, values)` returns a context marked with a private
symbol. Object spread keeps the marker, so contexts the library derives from it
stay system contexts; serialization drops it, so request input can never carry
it. `reason` is required and appears in diagnostics.

With a system context:

- autofilter applies no ownership filters, and creates must set every ownership
  field explicitly (NULL creates a shared row);
- row policies receive `system: true` and decide what it means for them;
- permission checks run as usual; `isSystemContext(context)` lets them tell;
- `aggregate` may group by, and count distinct, a hidden ownership field, so a
  job can find its units of work, then run each under a context for that owner:

  ```js
  const { data } = await api.resources.entries.aggregate({
    groupBy: ['workspace_id'],
    measures: { rows: { count: '*' } },
    queryParams: { filters: { status: 'open' } }
  }, createSystemContext('find workspaces with open entries'))
  ```

A context with `system: true` but no marker throws
`REST_API_SYSTEM_CONTEXT_FORGED`. Create system contexts only in server code
that has already decided the work may see every owner's rows; never from
request input.
