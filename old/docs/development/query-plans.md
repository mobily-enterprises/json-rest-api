# Query plans and index choices

The A8-10 review measures generated SQL against disposable, populated databases.
It introduces one runtime correction: SQLite ordering now uses native null
placement. Index candidates are recommendations for matching workloads, tested
through the existing Knex schema mechanism; this work does not silently create
indexes in application databases.

## Reproduce the review

Select Node 24, then run from the repository root:

```sh
# SQLite, one storage mode
JSON_REST_API_STORAGE=knex node scripts/measure-query-plans.js
JSON_REST_API_STORAGE=anyapi node scripts/measure-query-plans.js

# Both modes on SQLite, PostgreSQL and MySQL
node scripts/test-databases.js all scripts/measure-query-plans.js
```

The native runner uses the setup described in [real databases](real-databases.md).
The script creates its own fixture database and removes it after success or
failure. It never accepts an application resource/database as its workload.
The fixture contains 10,000 items, 100 groups and 20,000 membership links.
One thousand ranks are null; non-null ranks repeat, exercising ID tie-breaking.
Each group has 100 children and 200 many-to-many members. Canonical storage
shares the record/link tables within one synthetic tenant.

Eleven operations run before and after candidate indexes: flat and sparse ID
pages, selective name filtering, nullable ascending/descending rank pages,
a nullable cursor boundary, hasMany and many-to-many pages with counts, nested
includes, replacement retaining 101 of 200 links and removal of 101 links.
Writes borrow a transaction, verify pending membership, then roll back; the
original membership is verified again after the batch. Result IDs, ordering,
counts, included groups and hidden fields are checked independently of plans.

The script captures the actual executed SQL and bound parameters from Knex's
query events. It explains SELECT/DELETE statements after the operation and
rollback, using the driver's existing placeholders. It prints plan nodes,
index names, estimates and operation counters, omitting raw SQL, bound values,
filter expressions, credentials and record contents. Timing covers the operation
and its in-operation verification, not the subsequent EXPLAIN queries.

These are optimizer plans, not measured row visits. PostgreSQL and MySQL report
estimates; SQLite describes its access strategy. EXPLAIN does not use ANALYZE,
so explaining a DELETE does not execute it. The interpretation follows
[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/16/sql-explain.html),
[SQLite query plans](https://sqlite.org/eqp.html) and
[MySQL EXPLAIN output](https://dev.mysql.com/doc/refman/8.0/en/explain-output.html).
The script updates table statistics before each phase. It does not disable
sequential scans or force index selection. Exact plan text and cost estimates
are not portable test assertions; the focused SQLite regression checks the
specific unnecessary sort reproduced on the supported fixture.

## Findings

| Query shape | Existing access | Candidate result and limitation |
| --- | --- | --- |
| ID pagination | PostgreSQL/MySQL ordinary tables use their primary key; SQLite's emulated null ordering adds a full temporary sort | Native SQLite null placement removes that sort in both modes without a new index. A SQLite `SCAN` on its rowid table can supply ID order; that label alone does not prove all rows are visited before LIMIT. |
| Nullable rank ordering | Without a matching rank index, ordering scans/sorts candidates | PostgreSQL uses the ascending rank index for the ascending page. SQLite uses it after the SQL correction, retaining a partial sort for ID ties. Mixed descending rank/ascending ID and explicit null placement can still require sorting. MySQL retains filesort for nullable ordering in this fixture. |
| HasMany filtering/counts and nested children | Ordinary children lack a foreign-key lookup index in this fixture; canonical lookup otherwise scans within resource scope | A group-reference index supplies the equality lookup on all three databases. Counts and subsequent relationship hydration can still have separate work. |
| Many-to-many pages and writes | Ordinary pivot scans and canonical relationship/resource prefixes do not select a particular owner efficiently | Ordinary parent/child indexes and canonical owner indexes improve matching lookups. Different engines still choose different joins, union materialization and residual filters; no candidate removes every scan or sort. |
| Selective name filtering | The fixture's search `indexed` marker does not create a physical name index | The tested relationship/rank candidates do not solve name filtering. Declare and measure an actual field `index` or top-level index when this is an important application workload. |
| Large replacement/removal | Batched SQL can still scan unrelated owners when its predicate lacks an appropriate index | Owner indexes improve the tested plans. Replacement still locks/validates retained targets and has a complete keep-list predicate; the index does not remove that work or prove every replacement is faster. |

Candidate plans are more selective for relationship work, but not universally
better: for example, MySQL canonical linkage hydration may still choose an old
relationship-prefix index, and PostgreSQL can retain sequential scans for small
or broadly selected relations. One phase runs after the other, so reported
elapsed times include cache warming and scheduling effects. They are descriptive
samples, not a controlled throughput comparison or a latency guarantee.

## SQLite ordering correction

**A8-F09 — Emulated SQLite null placement forces a full sort (A8-10; fixed).**

The old SQL ordered by `rank IS NULL`, then `rank`, then an equivalent pair for
the ID. That expression prevented SQLite from using an ordinary rank index for
the first ordering term. It also introduced a temporary sort for ID-only pages.
The shared stored-column and query-field helpers now emit native
`ASC/DESC NULLS FIRST/LAST` for SQLite. Direction is normalized to fixed SQL
keywords; projection bindings remain separate parameters.

Native null ordering was added in [SQLite 3.30.0](https://www.sqlite.org/releaselog/3_30_0.html).
The verified driver contains SQLite 3.49.2. Older SQLite engines below 3.30 are
outside this implementation's support; PostgreSQL and MySQL SQL is unchanged.
No response, cursor or caller argument changes are needed.

With the candidate rank index, SQLite's full rank sort becomes an index-ordered
scan with sorting of the last ID term within equal ranks. Explicit ID null
placement can still cause that partial sort even though public IDs are non-null.
The fix does not claim to eliminate it. Ten regression cases check stored and
projected values in both directions and null positions, expression bindings,
ID pagination and index use. Existing pagination/include/visibility tests cover
the public paths and cursor semantics.

## Apply indexes through existing migrations

For ordinary resource tables, use authored field `index: true` or the existing
resource `indexes` array, preserving logical-to-physical mappings:

```js
indexes: [
  { name: 'items_group_idx', columns: ['groupId'] },
  { name: 'items_rank_id_idx', columns: ['rank', 'id'] }
]
```

For a pivot queried from the parent, the tested composite order is
`['groupId', 'itemId']`; evaluate the reverse direction separately. Generate and
review an existing-table diff with `generateKnexMigrationDiff()`, retaining all
current authored metadata. Use `createKnexTable()`/`generateKnexMigration()` for
new tables. The [migration guide](../GUIDE/GUIDE_X_Knex_Schema_And_Migrations.md)
describes execution, inspection and backend limitations.

Canonical owner indexes belong to the existing physical Knex migration:

```js
export async function up (knex) {
  await knex.schema.alterTable('any_links', table => {
    table.index(['tenant_id', 'left_resource', 'left_id'], 'any_links_left_owner_idx')
    table.index(['tenant_id', 'right_resource', 'right_id'], 'any_links_right_owner_idx')
  })
}

export async function down (knex) {
  await knex.schema.alterTable('any_links', table => {
    table.dropIndex(['tenant_id', 'left_resource', 'left_id'], 'any_links_left_owner_idx')
    table.dropIndex(['tenant_id', 'right_resource', 'right_id'], 'any_links_right_owner_idx')
  })
}
```

The tested candidates use these three-column owner prefixes, not every string
in the relationship predicate. Their complete columns fit the tested MySQL
schema and collation; adding more wide string columns can exceed key limits.
Retain relationship/type predicates in SQL. An index is an access path, not an
authorization or uniqueness constraint. Do not remove existing indexes merely
because this fixture chooses another one.

The canonical reference/rank candidates prepend `tenant_id, resource` to the
actual descriptor's reference slot, or rank slot followed by `logical_id`.
Resolve those slots from the deployed resource mapping before authoring a
migration; different resources can assign different meanings to the same slot.
Do not index every canonical slot by default. Index storage, write amplification,
production distributions, collations and consumer workflows remain part of
application-specific evaluation. Partial/expression indexes are outside the
current simple-column snapshot/diff contract and are not introduced here.

Exact runs, source hashes and regression results are in the
[verification log](verification-progress.md#2026-09-10-query-plans-and-sqlite-ordering).
