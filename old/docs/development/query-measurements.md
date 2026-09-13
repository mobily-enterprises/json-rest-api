# Query-count and timing instrumentation

`scripts/measure-query-baseline.js` is the deterministic fixture runner for
A8-01–A8-03. It uses the existing isolated test-database helper, with in-memory
SQLite by default and disposable PostgreSQL/MySQL databases through the native
runner. It destroys its database when it finishes or fails.

Run it under the project's Node 24 verification policy:

```sh
nvm use
npm run test:query-budgets
# One storage mode:
npm run test:query-budgets:knex
npm run test:query-budgets:anyapi
# Both storage modes on all three databases, using the existing native runner:
node scripts/test-databases.js all scripts/measure-query-baseline.js
```

The native command uses the same database binaries and environment settings as
[the integration instructions](real-databases.md). It executes the script
as a Node test file; each successful file execution checks all 44 measurements.
The script is also in the native runner's default SQL files. `npm run verify`
runs both SQLite budget jobs after type checking and before the full suites;
an exceeded budget stops verification. The existing CI SQL jobs run these same
commands on Node 24.

The final JSON report contains Node/database/storage mode, scenario name, emitted SQL
statement count, its `maxStatements` ceiling, configuration-table statement count, returned/included record
counts, elapsed milliseconds and heap delta. Instrumentation observes Knex's
`query` events only while awaiting the measured operation, including transaction
and hook queries. It prints counters rather than SQL, bindings, row contents or
connection settings. Setup, seeding and post-operation verification reads are
outside the measurement. Successful writes, expected authorization rejection,
transaction completion and hooks are included. Error scenarios assert the
expected rejection; an unexpected error fails the script. Configuration-table
SQL must remain zero through every measured resource operation.

The first six scenarios retain the ten-book, three-author fixture below. The
next 36 use the existing row-policy/autofilter/polymorphic fixture, with
1, 10 and 40 visible tasks. Each collection also has an equal number of
policy-hidden tasks and tasks in another workspace, sorted before visible
records. Two polymorphic target types occur at sizes 10 and 40. Assertions check
IDs, order, filtered totals, included targets, write results and deletion.
Relationship additions test an idempotent add of visible existing members and
a denied add with one hidden target; these counts include the entire operation,
not just its permission predicate. Bulk POST/PATCH use full returns, and DELETE
verifies IDs and absence afterward, in atomic and non-atomic modes.
Two further relationship-add measurements use 101 visible targets to cross
the 100-ID write-query batch boundary, with the same success/rejection and
retained-membership checks.

Elapsed time and heap deltas are descriptive; scheduling and garbage collection
affect them. Heap delta is not peak memory usage, and can be negative. Normal
tests assert query counts and behavior, not timing or heap thresholds. These
fixture measurements are not application throughput or leak benchmarks.

## Enforced query budgets

Budgets describe the fixed fixtures above, including their authorization and
hooks. They are not limits for arbitrary application hooks or relationship
graphs. Every measurement must have an explicit budget; assertions still check
results and zero configuration SQL independently. A lower statement count passes
when those behavior checks pass. If an intentional contract or fixture change
alters the work, measure it and update the ceiling with its supporting evidence.
The budget definitions do not import runtime batch sizes or query helpers, so
changing the implementation cannot silently increase its own allowance.

For the six book scenarios, ordinary/canonical ceilings are respectively:
flat **4/4**, sparse **1/1**, nested includes **7/9**, many-to-many related
**3/3**, full PATCH **11/10**, and PATCH with nested includes **14/15**.

For the scaled policy fixture, let `N` be the number of visible requested
targets/records, `T` the number of polymorphic target types (one at size 1,
two at sizes 10 and 40), `C` be 0 for ordinary storage and 1 for canonical,
and `B = ceil(N / 100)` be the number of target-lock/edge-read batches.
Target validation uses `B` minimal-record batches. Read permission hooks still
check every distinct target; full target GETs are no longer part of validation.

| Operation shape | Statement ceiling |
| --- | --- |
| Authorized hasMany or many-to-many read | `4 + T` |
| Same read with polymorphic includes | `4 + 2 * T` |
| Idempotent relationship add, ordinary | `4 + 3 * B` |
| Idempotent relationship add, canonical | `4 + 3 * B` |
| Relationship add denied at one extra hidden target | `5 + ceil((N + 1) / 100)` |
| Bulk POST, full return | `(8 + C) * N + transaction statements` |
| Bulk PATCH, full return | `(8 - C) * N + transaction statements` |
| Bulk DELETE | `(4 - C) * N + transaction statements` |

Transaction statements are `2` for an atomic bulk call and `2 * N` for
non-atomic calls. DELETE includes the declared pivot or canonical-link cleanup.
The denied relationship case fails before target locking and
edge attachment, so only validation contributes a batch term. At 101 visible targets the allowed
add budgets are **10 ordinary / 10 canonical**; the denied add budgets are
**7 / 7**. Before minimal target batches these were 461/563 and 459/560.
The ordinary pivot-read correction adds one existing-link read at that scale;
it previously fetched the complete old membership in one query. The separate relationship-batching suite checks 205 targets,
repeated IDs, per-query binding bounds and callbacks. These budgets cover the
measured shapes; broader parameter-limit and memory work remains under A8-07.

## Optimization regression coverage

A8-11 requires regression coverage for query counts, complete results, hidden
fields, per-parent limits and callback counts. The coverage is distributed across
the existing conformance suites because these properties belong to different
operation shapes. The following map reconciles the implemented A8 optimizations;
it does not claim that the remaining bulk/child-lifecycle optimization or consumer
acceptance work is complete.

Test names below refer to files under `tests/` with the `.test.js` suffix.

| Optimized boundary | Regression assertions |
| --- | --- |
| Related endpoint collection queries | `conformance-related`, `conformance-related-permissions` and `scripts/measure-query-baseline.js` check complete ordered IDs, includes, visibility and constant read counts at 2/10/40 or 1/10/40 records. |
| Target locking and minimal validation | `conformance-relationship-batching` and `conformance-target-validation` require three reads for 205 targets, bounded bindings, all final linkage and one permission call per distinct target. Repeated IDs, missing late targets, duplicate policy joins and tenant/resource overlap are covered. |
| Ordinary pivot reads/writes and canonical edge changes | `conformance-pivot-batches`, `conformance-pivot-reads`, `conformance-canonical-link-deletes` and `conformance-canonical-link-attachments` check batch/page bounds, complete membership, repeated/equivalent IDs, retained edge payloads and rollback after later-page failures. |
| Reverse child membership changes | `conformance-reverse-membership` checks bounded candidate reads, complete keep-lists, ordered child PATCH callbacks, no callbacks for retained children, and failures after the first page. |
| Visibility and large collection predicates | `conformance-visibility-batches`, `conformance-collection-id-lists` and `conformance-include-batches` cover 33,000-ID inputs, deduplication, bounded reads/bindings, complete identities, hidden targets and nested linkage. |
| Sparse hydration and limited includes | `conformance-sparse-hydration`, `conformance-include-allocation`, `conformance-include-limits` and `conformance-query-visibility` check omitted reads/attributes, visible ordered membership, standard/global versus window/per-parent limits, duplicate edges, query replacement and pending transaction visibility. |
| Shared conversion and resource identity | `plain-include-conversion`, `conformance-plain-collections` and `conformance-cyclic-includes` cover shared lookup work, complete plain graphs, path-local cycle termination, unique represented resources and exactly one computation per represented identity. |
| Exact IDs and final output | `conformance-bigint-ids`, `conformance-output-definitions` and `conformance-linkage-projections` check lossless large identities, selected output, hidden dependency removal and enrichment/projection behavior. |
| Safe metadata reuse | `conformance-metadata-cache`, `anyapi-descriptor-transactions` and `conformance-query-visibility` check reuse/invalidation, bounded retained variants, no published pending descriptors and no cross-caller visibility cache. |
| Query plans and workload ceilings | `scripts/measure-query-plans.js` compares real SQL plans and verifies results; `scripts/measure-query-baseline.js` independently enforces 44 workload ceilings plus result/metadata checks. The normal full gate executes both storage-mode budget jobs. |

The include-allocation suite now checks exact getter/computed callback values,
not only their total count. Its 205-target fixture includes hidden rows, two
parents sharing targets and duplicate physical edges. Both GET/query and
JSON:API/plain responses run with stored-name and computed-only fieldsets, under
standard/window, zero and unlimited selections. Only selected targets may invoke
getters or computations; read setters must remain unused, omitted computed
fields must remain uncomputed, and dependency attributes must not escape the
computed-only response. Callback assertions remain paired with exact membership
and read/page bounds, so matching callback counts cannot conceal a different
selected set.

This map is an acceptance record for the optimizations already implemented.
Every subsequent optimization must update the affected regression before its
own acceptance; A8-04 and A8-12 retain unfinished implementation and consumer
requirements. Historical native/full-gate evidence remains in the linked sections
below; the latest callback expansion has its own selected native run.

## Published canonical descriptor measurement

The 2026-09-10 correction makes resource operations use the descriptor already
published with `schemaInfo`, matching their storage adapter. Previously, reads
inside a data transaction repeatedly loaded configuration through the registry.
Direct registry operations still use their own transaction/cache rules.

| Scenario | Ordinary statements | Canonical before | Canonical after | Canonical metadata before / after |
| --- | ---: | ---: | ---: | ---: |
| Flat query, 10 books | 4 | 5 | 5 | 0 / 0 |
| Sparse query, 10 books | 4 | 5 | 5 | 0 / 0 |
| Nested includes, 10 books and 5 included records | 8 | 11 | 11 | 0 / 0 |
| Many-to-many related endpoint, 3 authors | 3 | 4 | 4 | 0 / 0 |
| Full PATCH, 1 book | 11 | 32 | 11 | 21 / 0 |
| PATCH with nested includes, 1 book and 5 included records | 15 | 59 | 17 | 42 / 0 |

Two independent runs after the change produced identical statement, metadata,
record and included-record counts in each storage mode on Node 24.6.0. Ordinary
counts also match the before run. These are baselines for the stated fixture
shapes, not universal budgets independent of relationships, policies or hooks.

The public descriptor-transaction regressions assert zero configuration-table
queries through CRUD, relationship writes, nested reads, counts and rollback.
Separate tests cover publication failures, field additions, direct registry
transaction isolation, explicit slot-mapping refresh and overlapping tenant
APIs. The [verification log](verification-progress.md) records the full gates.
Batching, query plans and end-to-end improvements remain under the open A8 items.

## Workload baselines

This is the baseline before the [relationship write batching](#relationship-write-batches)
below. Keep these values for comparison rather than treating them as current budgets.

The following statement counts were measured on Node 24.6.0 with SQLite 3.49.2,
PostgreSQL 16.15 and MySQL 8.0.46. Counts match across all three databases,
including the original six book scenarios. Each cell lists
**1 / 10 / 40** visible records or requested operations. Every metadata count is
zero. Repeated SQLite runs match all 42 statement/result counter sets.

| Shape | Ordinary statements | Canonical statements |
| --- | ---: | ---: |
| Authorized hasMany or many-to-many read | 5 / 6 / 6 | 6 / 7 / 7 |
| Same read with polymorphic includes | 6 / 8 / 8 | 7 / 9 / 9 |
| Idempotent relationship add, all requested targets visible | 10 / 60 / 225 | 11 / 79 / 304 |
| Relationship add denied at one extra hidden target | 9 / 50 / 185 | 10 / 60 / 225 |
| Atomic bulk POST, full return | 10 / 82 / 322 | 11 / 92 / 362 |
| Non-atomic bulk POST, full return | 10 / 100 / 400 | 11 / 110 / 440 |
| Atomic bulk PATCH, full return | 10 / 82 / 322 | 9 / 72 / 282 |
| Non-atomic bulk PATCH, full return | 10 / 100 / 400 | 9 / 90 / 360 |
| Atomic bulk DELETE | 5 / 32 / 122 | 4 / 22 / 82 |
| Non-atomic bulk DELETE | 5 / 50 / 200 | 4 / 40 / 160 |

Read counts increase between 1 and 10 because a second polymorphic target type
appears. Even without requested includes, response linkage must be filtered for
target visibility. Between 10 and 40 the type count stays fixed and so do the SQL
round trips. This distinguishes work per target type from work per target ID.
Atomic bulk calls share one transaction; non-atomic calls complete a transaction
for each record. Neither mode currently batches the individual resource writes.
These are operation baselines, not justification to remove authorization or
transaction boundaries solely to lower a counter.

## Related endpoint review

The historical per-ID fallback in `get-related.js` has already been removed by
the query-conformance work. HasMany collections pass a mandatory parent
constraint to the normal target query. Many-to-many collections pass a SQL
membership subquery. Neither path calls GET for each result. To-one endpoints
still use the target GET lifecycle; its permission and finish hooks have a
separate verified contract.

The existing query/related suites cover target and pivot permissions, filters,
cursor/offset links, sparse fields, includes, inverse memberships, duplicate
links and borrowed transactions. Two additional cases in
`conformance-queries.test.js` compare pages of 2, 10 and 40 visible records,
in both formats, for hasMany and many-to-many relationships, with and without
polymorphic includes. They require identical statement counts at these sizes,
correct IDs and a total of 40 from 120 linked rows, omitted unselected fields,
correct included targets and zero configuration SQL. Both target types are
present at every measured page size, so the comparison holds the query shape
constant. This budget covers this fixture within a single database batch;
the enforced shape/batch budgets above complement it. Broader parameter-limit
and memory work remains under A8-07.

## Relationship write batches

The shared target-lock helper now deduplicates IDs within each resource and
locks at most 100 requested IDs per statement, through the resource's storage
adapter. It retains the caller's transaction and resource/tenant scope. A
returned ID can have a different spelling under a database collation; unmatched
spellings use the database's original single-ID comparison before reporting a
missing target. Errors retain the first missing ID in input order.

Canonical link attachment also fetches existing edges for at most 100 target
IDs at once. The predicate retains tenant, relationship, both resource types
and the owner ID in the appropriate canonical orientation. Its map lives only
within that batch. Unmatched/new IDs retain individual existence comparisons
when an existing or newly inserted row could match under the database collation.
Inserts remain individual operations. Existing payloads and missing inverse
metadata retain their prior treatment. At this stage target GET validation still
ran for each requested target. The target-validation change below removes that
extra lifecycle and deduplicates permission checks within each relationship.

| Idempotent add size | Ordinary before / after | Canonical before / after |
| --- | ---: | ---: |
| 1 | 10 / 10 | 11 / 11 |
| 10 | 60 / 51 | 79 / 61 |
| 40 | 225 / 186 | 304 / 226 |

The other 39 measurements retain their original statement counts. The separate
batch regressions require three lock reads for 205 distinct same-resource IDs,
one for 205 repeated IDs, and three edge lookups when re-adding 205 existing
canonical links. They check per-query binding bounds, resource separation,
the first missing ID, native held locks on the last target, actual case-insensitive
ordinary ID columns, every target permission check, mixed/duplicate inputs, owner
separation, inverse metadata repair, payload retention and whole-operation
rollback. The ordinary collation case runs in both storage-mode invocations;
it does not establish a changed canonical ID collation contract.

These batches limit request IDs/bindings per SQL statement. They do not impose
a limit on the full input/result arrays or repair arbitrary duplicate physical
link rows. Broader include/validation limits and memory work remain under A8-07.

## Ordinary pivot write batches

Ordinary many-to-many additions and replacements insert at most 100 pivot rows
per statement, using the existing relationship-write batch constant. Each row
contains its two mapped relationship keys, so the insert carries at most 200
bindings. The row objects are built for the current batch. Before this change,
adding or replacing 501 new links produced one SQLite compound INSERT and
failed with `SQLITE_ERROR`: too many terms in the compound SELECT.

The DELETE relationship endpoint deduplicates normalized IDs and removes at
most 100 requested target IDs per statement, retaining the owner predicate.
Removing 205 distinct links takes **3 DELETEs instead of 205**. Replacement
originally used the same batch deletion mechanism; the bounded-read correction
below replaces it with one complete keep-list exclusion query. These are pivot
statement counts, excluding authorization, parent locking and other operation
work. Empty additions/removals issue no pivot writes; empty replacement deletes
the owner's complete membership.

The existing target validation and parent/target locks precede the writes.
Every batch uses the same transaction. Replacement retains unchanged pivot
rows, including their IDs and metadata; removal does not delete target records
or another owner's membership. A second-batch failure rolls back earlier
batches in an owned transaction. In a borrowed transaction, earlier successful
batches remain pending until the caller rolls back.

`conformance-pivot-batches.test.js` verifies 501-link additions/replacements,
duplicate inputs, exact insert/delete bounds, owner isolation, retained pivots,
successful borrowed transactions and second-batch failures. It explicitly uses
ordinary tables in both runner invocations; it does not exercise canonical
link storage. Later sections record bounded canonical deletion, identifier
queries and ordinary membership reads. Full input/output allocation remains
separate A8-07 work.

## Visibility identifier batches

The shared `filterVisibleIdentifiers` helper deduplicates IDs within each target
resource type and selects at most 100 target IDs per query. It fills each batch
while iterating the existing ID set, avoiding another full translated-ID array.
The query selects distinct IDs so predicate joins do not inflate the returned
row set. For hooks that retain the identifier query's projection and scope,
each result batch contains at most 100 IDs. Policy predicates may contribute
additional bindings; the 100-ID bound is not a cap on arbitrary custom SQL.

Target query permission and filtering run for every batch. They retain caller
authorization/transaction context and exclude the parent's client filters and
ID. As described in the [row-policy contract](../GUIDE/GUIDE_X_Row_Policies.md#query-purposes-and-lifecycle-coverage),
these hooks must apply complete visibility predicates to each query. Their
frequency is now explicitly documented in the
[migration guide](../GUIDE/MIGRATING_API_V2.md#relationship-visibility-hooks).

The final result retains input order, duplicate occurrences and original
identifier objects. A failure in any batch rejects the call; it returns no
partial result and never completes a borrowed transaction. Visible-ID sets live
only in that invocation and remain separate by resource type. The input,
deduplication sets and full result still scale with collection size; this does
not establish a total request-memory limit.

The shared regression suite covers 33,000 unique IDs with 330 bounded queries,
33,000 repeated IDs with one query, duplicate predicate joins, mixed resource
types, changing policy contexts, cloned query builders, uncommitted transaction
changes, later permission/filter failures and empty input. Full API cases
return all 205 included children in both formats, with references filtered
across three batches. A canonical-only case uses two tenant APIs with overlapping
IDs. Large collection ID predicates use the single-query form described below;
complete-collection memory remains open under A8-07.

## Belongs-to include batches

Ordinary and canonical belongs-to include loaders select at most 100 target
IDs per query, separately for each polymorphic resource type. The existing
selection, projection and policy functions run on every batch using the
caller's transaction. Ordinary polymorphic grouping now uses a per-type ID
set to avoid repeatedly scanning a growing array while retaining the original
arrays, first values and duplicate semantics.

All batches for a target type are collected before traversing its nested
includes. This keeps a standard collection limit global across that parent set
and a window collection limit per parent. Sparse fields, hidden dependencies,
repeated references and mixed polymorphic types retain their existing output
contracts. SQL projection callbacks and target permission/filter hooks run per
query; the [migration guide](../GUIDE/MIGRATING_API_V2.md#nested-belongs-to-include-batches)
documents that frequency explicitly.

Canonical parent-link prefetches also deduplicate parent IDs and query at most
100 per batch, retaining tenant, resource, relationship and inverse-relationship
predicates. Each ID appears in both link orientations, so this query has up to
205 bindings. A later failure returns no partial result and does not complete
a borrowed transaction.

The regression suite exercises public nested includes with 33,000 children and
distinct targets, returning all children and 32,670 policy-visible targets.
It checks 330 target queries, at most 103 bindings each in these fixtures, and
every visible or hidden child reference. Smaller cases cover sparse projections
and computation, owned write rollback, borrowed reads, later permission and
projection failures, overlapping target IDs across types, and nested collection
limits. Canonical cases additionally cover actual forward/inverse links,
duplicate parents, empty input and later SQL failure.

These are bounds on the selected IDs, not arbitrary custom SQL or join fan-out.
Input arrays, deduplication sets, included records and complete responses still
grow with collection size. Collection loaders and reverse-linkage prefetches
use the single-query ID-list transport described below.

## Collection identifier lists

A shared `whereInIdentifiers` helper deduplicates internal ID lists and retains
one collection query. Lists of at most 100 distinct values keep ordinary `IN`.
Larger PostgreSQL lists use a bound array with
[`ANY`](https://www.postgresql.org/docs/16/functions-comparisons.html#FUNCTIONS-COMPARISONS-ANY-SOME),
and larger SQLite lists use a bound JSON array with
[`json_each`](https://www.sqlite.org/json1.html#jeach). SQL still performs the
original sort, global/per-parent limit, predicates and projection. No temporary
table, JavaScript result sorting or per-batch restart of a global limit is
needed. SQLite needs JSON1 for this large-list form.

MySQL retains Knex's existing text-protocol `IN` query after deduplication. The
installed Knex MySQL client calls `connection.query`, and an actual MySQL 8.0.46
probe with 100,000 supplied IDs succeeds. The alternative JSON-table/text-value
comparison was rejected: querying `9223372036854775806` that way also matched
`9223372036854775807`, while the existing query returned only the requested row.
The retained suite checks adjacent SQL bigint values and also tests digit strings
as text IDs. A universal JSON-table conversion would change valid comparisons.
MySQL statement/packet-size limits still apply; this is not a fixed-size SQL or
request-memory guarantee.

Fourteen collection/metadata predicate sites share the helper: ordinary
has-many, has-one, polymorphic and pivot includes, ordinary relationship
identifiers, canonical reverse-linkage reads, and both orientations of
canonical many-to-many collection queries. Their selection and hook logic stays
in its existing method. The [migration guide](../GUIDE/MIGRATING_API_V2.md#large-collection-identifier-queries)
documents the SQL-shape change; no public option or compatibility path was added.

The eight-case regression suite checks large list sorting/filtering/limits,
quoted and Unicode text, leading zeros, case-insensitive columns, exact large
integers, repeated/empty IDs, aliases/subqueries and borrowed transactions. Its
public-API case loads 33,000 parent groups with nested has-many, has-one,
polymorphic and many-to-many paths, checking every returned relationship and all
33,005 included child resources. Existing global/window include regressions run
alongside it on the native database matrix.

The helper's deduplicated list and serialized/array parameter still grow with
the number of distinct IDs. Results and included resources likewise scale with
requested data. Broader memory work and per-resource write costs remain under A8-04/A8-07.
Target validation is described below.

## Relationship target validation

Resource POST/PUT/PATCH previously authorized payload targets through individual
minimal reads and then many-to-many storage repeated a complete target GET,
including response getters, computed fields and finish hooks. The relationship-add
endpoint took this second path alone. These were different validation contracts
for the same reference.

The existing payload validation step now covers every relationship kind and the
relationship-add endpoint. It selects up to 100 distinct targets per query through
the existing minimal-record helper, applies complete target row policies to each
batch and runs read permissions against each selected target's minimal record.
A scoped single-ID lookup retains database equality for alternate spellings that
cannot be matched by ID in the batch result. Identifiers are deduplicated within
each relationship; permission checks/errors follow input order and minimal rows
are discarded after each batch. Storage link writers retain locks and existence
checks, but no longer run response GET lifecycles. No permission-result cache or
legacy GET-hook fallback is introduced.

This deliberately changes validation SQL-hook frequency and removes target
response hooks from link writes. Policies must express row predicates for the
whole batch; per-target authorization belongs in `checkPermissions`, with the
target ID and minimal record. The [migration guide](../GUIDE/MIGRATING_API_V2.md#relationship-target-validation)
shows the selected hook contract. Consumer reconciliation remains paused; these
changes are not a completed consumer migration.

The filtered query selects distinct target IDs; the same SQL statement uses that
subquery to select complete rows in the same resource/tenant scope. This bounds
result rows despite policy joins and avoids requiring SQL equality over JSON
attributes. The helper's single-record path retains its existing result shape.

| Idempotent add size | Ordinary before / after | Canonical before / after |
| --- | ---: | ---: |
| 1 | 10 / 7 | 11 / 7 |
| 10 | 51 / 7 | 61 / 7 |
| 40 | 186 / 7 | 226 / 7 |
| 101 | 461 / 9 | 563 / 10 |

These are statement counts for the unchanged policy fixture, including transaction
and lock/edge work. The corresponding hidden-target failures drop from
9/50/185/459 ordinary and 10/60/225/560 canonical to 6/6/6/7 in both modes.
Input ID sets still grow with the payload, and bulk resource writes and reverse
relationship child PATCH operations retain their individual write lifecycles.

## Authorization before limits and counts

The 2026-09-10 review traces authorization through collection queries, related
endpoints, include selection, relationship linkage and write-target validation.
Top-level collection permission is checked before data access. Included/search
targets and ordinary pivot resources receive their own query permission checks.
SQL autofilters and row policies restrict the candidate set before pagination,
include ranking/limits, reference sorting and count aggregation. Per-record GET
permission remains the single-record/write-target contract; collection visibility
belongs in a SQL predicate so excluded records cannot consume page slots.

| Guarantee | Source path and executable coverage |
| --- | --- |
| Filtered collection pages, cursor boundaries and totals | Both storage `dataQuery` implementations, `applyPaginationToQuery`; `conformance-query-visibility`, `conformance-search-authorization`, `row-policy` |
| Parent/target permission separation and related membership before pagination | `get-related`, `getVisibleRelationshipParent`, `queryConstraint`; `conformance-authorization`, `conformance-related-permissions` |
| Target and pivot visibility before standard/window include limits | `prepareCollectionInclude`, `applyScopeFiltersToIncludeQuery`, `applyIncludeQueryConfig`; `conformance-include-permissions`, `conformance-include-limits` |
| Hidden references cannot affect filters, counts or cursor sort keys | Scoped search joins and `prepareReferenceSortColumns`; `conformance-search-authorization`, `conformance-reference-sorting` |
| Batched linkage checks remain scoped to each caller/type/tenant | `filterVisibleIdentifiers`, storage base queries; `conformance-visibility-batches`, `conformance-storage-boundaries` |
| Batched target validation retains policies and individual read permissions | `validateRelationshipAccess`, `dataGetMinimal`; `conformance-target-validation` |
| Metadata caching cannot substitute another tenant's descriptor or pending schema | Registry tuple keys, cloned descriptors and transaction bypass; `anyapi-registry-failures`, `anyapi-descriptor-transactions` |

The listed names refer to files under `tests/` with the `.test.js` suffix.
Tests independently hide records through row policies and workspace autofilters,
check inaccessible rows sorted before visible ones, exercise nested and
polymorphic paths, and change caller visibility or borrowed transaction state.
Native coverage uses the [documented databases and collations](real-databases.md);
the original `row-policy.test.js` itself uses SQLite explicitly.

The review found and fixed ignored replacement builders in both collection
implementations. A `knexQueryFiltering` hook could assign a clone and add a
visibility predicate to it, but the collection continued using the old builder.
Ordinary counts honored their replacement while pages did not; canonical pages
and their cloned count query both missed it. Both paths now use the final
filtered builder and restore the enclosing `context.knexQuery` in `finally`.
Single-record/include paths already used the returned builder.
Ordinary counts still run a separate filtering pass; canonical counts clone the
filtered collection builder before pagination. This review retains that existing
callback contract. Every filtering call must apply the complete visibility
predicate, including an ordinary count call.

The new 18-case suite checks offset and forward/backward cursor pages for direct,
hasMany-related and many-to-many-related collections in both formats. It also
checks sparse projections, per-parent limited includes, a single-record control,
reused caller context, borrowed visibility/rollback, and metadata restoration
after filter success/failure. Fifteen cases fail in each storage mode before the
fix; all 18 pass afterward. Broader verification is recorded in the evidence log.

Cache inspection finds no persistent permission/result cache: visibility sets,
include maps and search/sort maps live within their invocation. Storage adapter
caches retain schema mappings within one API and refresh when `schemaInfo`
changes. Registry cache keys encode the complete tenant/resource tuple, return
cloned metadata and avoid publishing transaction-local descriptors. Row-policy
and autofilter compilation stores definitions; decisions still read the current
request. Internal storage helpers rely on their operation's authorization step;
they are not independent permission-enforcing endpoints.

## Metadata cache retention

The A8-09 review retains the existing compiled metadata and local lookup maps.
Published canonical descriptors already removed 21/42 configuration statements
from the two measured PATCH shapes above. Cursor scalar-contract reuse has its
own [measured compilation saving](compiled-resources.md#remaining-risks-and-smallest-useful-next-steps).
Neither benefit requires a second schema system or a cache of authorization
results. The existing request contract set is reused across 100 different
payload values and equivalent sort declarations in `conformance-metadata-cache`.

| Owner | Retention decision | Evidence and tradeoff |
| --- | --- | --- |
| Published schema and storage adapters | Keep metadata per registered resource; replace adapters when `schemaInfo` changes | Existing schema enrichment, field evolution and descriptor transaction suites exercise publication and refresh. These owners scale with declared resources, not request values. |
| Request contracts | Keep one current set on each `schemaInfo`; include resource name, include depth and sortable fields in its key | Reusing compiled fields under another resource name previously reused the wrong JSON:API type contract. New tests check both names, changed options and restoration without a growing variants map. |
| Canonical registry | Retain at most 100 recently used descriptors; use the same insertion rule for reads, registration and field allocation | Reading 130 tenant/resource pairs retains 100. A hit uses zero SQL; an evicted descriptor reload uses three statements on each tested database. This bounds retained entries but can increase explicit registry lookup traffic. |
| Temporal normalization | Retain only five built-in types with default or integer precision 0–6, at most 40 contracts | Unusual precision still validates without permanent caching. Functional tests repeat common and unusual declarations through precision 10,000; the finite key predicate establishes the retention bound. |
| Cursor validation | Keep the WeakMap owned by the compiled schema and keyed by normalized scalar declarations | Existing handler/precision tests and benchmark justify reuse; owner replacement permits collection of old contracts. Keys contain declarations, never cursor values. |
| Visibility, include and query lookup maps | Keep existing invocation/batch ownership | Authorization review above verifies current caller/tenant context. No persistent permission, row or query-result cache is added. |

Registry hits return clones, so modifying a returned schema cannot poison the
next lookup. Borrowed transaction reads/writes neither publish nor reorder
committed entries, including a transaction-local deletion. Negative lookups are
not retained. A nontransactional refresh that confirms a descriptor is absent
now evicts its stale entry; previously the next normal read could return it.
Read errors retain their existing error behavior and are not treated as absence.

Registry eviction does not limit the number of declared resources or invalidate
their published descriptors. A public write after eviction still performs zero
configuration-table queries and uses the same published descriptor object.
The new 13-case suite runs alongside registration failure, transaction, field
evolution, schema enrichment and temporal tests on SQLite, PostgreSQL and MySQL.
All 44 workload counters in both storage modes remain unchanged.

The current Node 24 cursor benchmark reports a 130.391ms median for five rounds
of 10,000 four-field validations while other verification jobs were running.
It is a descriptive smoke measurement, not a controlled before/after comparison
or an application throughput claim. Retention counts are not byte/peak-heap
limits. Whole-response allocation, in-place schema mutation and query-plan work
remain under their separate open items. See the
[verification log](verification-progress.md#2026-09-10-metadata-cache-retention-and-correctness).

## Relationship allocation review

**A8-07 is complete.** The bounds and retained input/output costs are reconciled
below. Earlier findings record the work still open at each stage; A8-F24 closes
the final confirmed batch intermediate. See the [final verification evidence](verification-progress.md#2026-09-10-canonical-attachment-allocation).
Per-child lifecycle work and consumer results remain under A8-04/A8-12.

**A8-F10 — Canonical reverse linkage fetched unused target attributes
(A8-07; corrected).** Hydrating hasMany/hasOne and reverse-polymorphic linkage
selected complete `any_records` rows, including every text/JSON slot, then used
only the child identity and parent reference. Both branches now select the
qualified physical ID, logical ID and reference column before the existing
filter hooks. Keeping the physical ID retains the current logical-ID fallback.
Filters, resource/tenant constraints, errors and the borrowed transaction remain
in the existing query path. Ordinary linkage already selects its two needed
columns. No result limit, field truncation or cache is added.

The fixture has 20 children carrying a roughly 9KB JSON attribute. One child is
hidden by a filtering hook that replaces the query builder; one child supplies
a separate hasOne relationship. Canonical sentinels reuse an ID in another
tenant/resource. The three GET linkage queries return 19, 19 and 1 rows:

| Observation | Before | After |
| --- | ---: | ---: |
| Columns per returned canonical row | 52 | 3 |
| Serialized bytes, first collection linkage | 199,520 | 804 |
| Serialized bytes, reverse-polymorphic linkage | 199,520 | 804 |
| Serialized bytes, hasOne linkage | 10,503 | 42 |
| Total serialized query-result bytes | 409,543 | 1,650 |

These Node 24 SQLite measurements describe the database result objects serialized
by the observer, not peak heap or network byte counts. The seven-case shared
suite checks JSON:API/plain GET and query results, selected row widths, filtering,
tenant/resource isolation, borrowed pending references and rollback, and failure
propagation. Native drivers execute the same assertions. Source and verification
details are in the [evidence log](verification-progress.md#2026-09-10-reverse-linkage-projections-and-allocation-review).

Current A8-07 allocation ownership and bounds:

| Allocation | Verified bound or purpose | Retained cost or limitation |
| --- | --- | --- |
| Target locks, validation and visibility reads | Queries take at most 100 distinct target IDs; validation/minimal maps belong to that batch | Whole normalized input and unique-ID sets still scale with request size. |
| Collection identifier predicates | Deduplicated complete sets preserve global SQL limits/order; large SQLite/PostgreSQL lists use one bound value | Parameter-count bounds are not byte limits on the input array or encoded list. |
| Canonical parent-link prefetch | At most 100 requested parents and 101 visible physical rows per query; target permissions and row filters precede link allocation | The normalized edge list and final linkage scale with visible output. The extra full identifier list, visibility map/set and filtered row list are removed (A8-F23). The explicitly raw helper still returns its complete requested edge list. |
| Reverse collection linkage | Only needed identity/reference columns are fetched | The complete visible linkage remains proportional to returned children; this change narrows rows rather than imposing a result cap. |
| Ordinary pivot changes | Reads use 100 requested IDs and pages of at most 101 physical rows; inserts use at most 100 rows and replacement uses one complete exclusion query | The normalized input and complete keep-list still scale with request size. Duplicate stored edges require additional read pages. |
| Canonical attachment | At most 100 requested target IDs, 101 physical edge rows per query and 100 retained exact-ID matches | Duplicate edges require additional locked read pages; nonmatching spellings use the existing single-row database-equality lookup. See A8-F24 below. |
| Reverse child changes | Candidate addition/removal reads take at most 100 requested IDs; replacement removal pages contain at most 101 identities | The complete keep-list and target-resolution sets scale with input; changed children still execute individual PATCH lifecycles. See A8-F22 below. |
| Included resources and plain expansion | Include traversal deduplicates resources and tracks processed paths; plain conversion builds one type/ID lookup per document | The lookup retains references to unique primary/included resources for that conversion. Repeated expanded branches still require separate output objects. |
| Final write response | A clone isolates the prepared response from after-commit observers; full PATCH samples below cover 100/1,000/5,000 children in both formats/modes | Retained-heap samples do not establish peak allocation; removing the clone requires preserving that ownership guarantee. |

### Allocation reconciliation

The remaining input/result copies have been traced through relationship
validation and locking, the two storage loaders, include traversal, plain
conversion, response normalization and bulk operations. They do not require a
new streaming API or another compatibility mechanism to satisfy A8-07:

- Normalized inputs and distinct-ID sets scale with the submitted identifiers.
  Complete replacement keep-lists and globally ordered/limited predicates must
  retain their whole meaning. Queries use bounded ID batches where those
  semantics permit splitting; large complete predicates use the verified
  PostgreSQL array/SQLite JSON parameter or MySQL text protocol. These are
  parameter-count bounds, not a maximum request-byte guarantee.
- Visible linkage, included resources and parent maps scale with the actual
  returned graph. Limited includes select targets before building parent maps;
  sparse responses omit unrequested linkage. Canonical default linkage now
  excludes hidden/missing targets before allocating edge rows. Its raw helper
  intentionally returns a complete edge list, and that list is its result.
- Include identity maps and processed-path sets belong to one traversal. Plain
  conversion shares one document lookup and retains separate output objects for
  repeated expanded branches. Its ancestor sets terminate cycles, while the
  normalizer's WeakMap reuses already-normalized object identities. Their size
  follows the requested output and traversal depth; no request graph is cached
  across calls.
- Response normalization retains simple linear attribute/relationship copies.
  The final write clone has a tested ownership purpose: after-commit mutation
  cannot change the response prepared before commit. Removing it without
  preserving that guarantee is not an allocation improvement. The public
  100/1,000/5,000-child samples below cover its retained-memory behavior.
- Bulk operations process children sequentially and enforce the configured
  positive `maxBulkOperations` count, default 100. Their result/error arrays
  scale with that accepted input. Per-child PATCH/POST lifecycle cost remains
  A8-04 work; it is not an unbounded concurrent batch.

The criterion is bounded avoidable batch intermediates and correct large/repeated
inputs, with these explicit whole-input/output costs. It is not constant total
memory for arbitrary JSON values, unlimited relationship results or custom hooks.
The final read-through after A8-F23 found canonical attachment's duplicate-edge
read. A8-F24 bounds that last confirmed intermediate, and its full/native gates
pass. This completes A8-07's allocation criterion; the separate final whole-goal
reviews remain open.

### Full write response allocation

The temporary public probe `/tmp/library-response-allocation-profile.mjs` uses
the shared ID fixture on Node 24.6.0 and SQLite 3.49.2, with a root group and
100/1,000/5,000 included items. It performs a warm-up full PATCH, then samples
heap after forced collection at `finishPatch` and `afterCommit`. At the latter
boundary it changes an included child's name in `context.responseRecord` and
verifies the caller's returned copy still contains every original child name.
Both JSON:API and plain outputs retain all distinct child identities.

| Children | Format | Serialized response bytes | Ordinary retained-heap delta | Canonical retained-heap delta |
| ---: | --- | ---: | ---: | ---: |
| 100 | JSON:API | 13,711 | 19,240 B | 10,976 B |
| 100 | Plain | 2,923 | 8,280 B | 16,192 B |
| 1,000 | JSON:API | 137,915 | 469,016 B | 483,464 B |
| 1,000 | Plain | 30,825 | 46,392 B | 7,192 B |
| 5,000 | JSON:API | 705,915 | 2,384,744 B | 2,376,096 B |
| 5,000 | Plain | 162,825 | 621,688 B | 608,496 B |

These are differences between two lifecycle heap samples, including any other
allocations or released objects between them. They are neither isolated clone
sizes nor peak-memory bounds. Small samples show collection noise; no timing or
heap threshold is asserted. The larger responses retain a second representation
for a tested ownership purpose. The probe does not justify removing that copy.

All twelve corrected observations pass. The initial canonical run failed a
probe assertion that incorrectly expected numeric rather than textual ID order;
the corrected assertion compares names by resource identity, without imposing
an order irrelevant to this measurement. Corrected logs are
`/tmp/library-response-allocation-profile-{knex,anyapi}.log`, with initial logs
retained separately. The [allocation reconciliation](#allocation-reconciliation)
now classifies these required input/result costs. These SQLite samples do not
claim peak or native-driver memory coverage.

### Plain conversion lookup

**A8-F11 — Plain expansion repeatedly scanned included resources (A8-07; corrected).**
`transformSingleJsonApiToSimplified` calls `included.find` for every expanded
reference in the previous implementation. A direct probe links one parent to N distinct included children in
matching order and instruments reads of each included record's `type`. At
N=1,000/5,000/10,000 it observes 501,500/12,507,500/50,015,000 reads. This is
quadratic lookup work despite a linear-size result. The Node 24 instrumented
times are 168.923/2,757.246/10,716.860ms under concurrent verification; accessor
instrumentation and scheduling mean these are not ordinary request latencies.
The probe is `/tmp/library-linkage-memory-plain-scan-probe.json`.

The converter now builds one nested `Map` by resource type and ID, shared by
all primary and included records in that conversion. It keeps the first record
for a repeated identity and does not coerce numeric/string IDs or combine keys
using a delimiter. No index survives the call. The same probe now observes
3,000/15,000/30,000 included-type reads. Lookup work scales with the included
document plus expanded references, instead of their product. Branch-local
ancestor tracking and independent sibling output remain unchanged.

`node scripts/measure-plain-conversion.js` separately measures ordinary objects
without accessor instrumentation. Each size has one warm-up and five timed
conversions; document creation and full result assertions are outside the timed
interval. Node 24.6.0 medians for the same fixture are:

| Included children | Before | After |
| --- | ---: | ---: |
| 1,000 | 9.736ms | 1.786ms |
| 5,000 | 82.309ms | 7.613ms |
| 10,000 | 361.120ms | 11.191ms |

These are isolated converter measurements, not end-to-end request timings or
peak-heap measurements. The new lookup requires O(unique included identities)
references. It does not bound the input, output or recursion depth, and a graph
with repeated expanded branches can still produce a large plain response.

The 13 converter tests cover complete output, strict identity, first duplicates,
polymorphic types, empty/missing included data, separate primary traversals,
sibling independence, cycles, fresh conversion state and direct single-resource
calls. Two deterministic work-count tests reject repeated scans without timing
thresholds. Two public GET/query cases use a 1,500-child fixture through
`mentions.group.items`, with sparse fields, hidden targets and cycle references,
in both storage modes. See the [verification evidence](verification-progress.md#2026-09-10-plain-conversion-lookup).

### Ordinary pivot membership reads

**A8-F12 — Ordinary pivot changes read the whole membership (A8-07; corrected).**
`createPivotRecords` and `updateManyToManyRelationship` previously selected every
existing target ID for the owner before comparing in JavaScript. A Node 24
SQLite public API probe seeds 1,001 memberships and supplies one already-linked
target. Both addition and replacement formerly read all 1,001 IDs; now each
reads one row, selecting its physical pivot ID and target key. The updated probe
returns 24 serialized row bytes. It verifies pending membership and complete
restoration after borrowed rollback. This is selected-row allocation, not a
peak-heap or request-latency claim.

The existing writer now shares a private pivot-mapping helper and one missing-link
insertion loop. Each lookup requests at most 100 distinct target IDs. A pivot
resource can contain duplicate edges, so returned rows are also paged by the
physical pivot primary key, with at most 101 rows per page. The extra row
indicates whether another page may be needed; it is processed before advancing
the key. Only exact requested IDs are retained in the lookup set, so alternate
stored spellings cannot grow that set beyond the current batch. Unmatched
spellings use a scoped database comparison when the read found existing rows.
Inserts still contain at most 100 rows and preserve existing pivot data.

Replacement locks requested targets and deletes unwanted links with one negated
predicate over the complete desired set, then uses the shared missing-link
loop. Splitting that keep-list into independent deletes would erase wanted
links. The existing identifier helper carries 33,000 SQLite/PostgreSQL IDs in
one bound list and retains MySQL's text-protocol bindings. A 33,000-ID test keeps
every pivot unchanged and verifies exactly one exclusion DELETE and 330 bounded
reads. Empty replacement performs one DELETE and no pivot read. Physical rows
belonging to other owners and target resources remain intact.

This trades round trips for bounded read allocation. The 44-workload runner's
idempotent ordinary add at 101 targets increases from **9 to 10 statements**:
validation, target locking and existing-link reads each contribute two batches.
The ceiling is now `4 + 3 * ceil(N / 100)` for both storage modes. At sizes
1/10/40, both modes still use seven statements; denial and all other retained
workload counters are unchanged. A no-op replacement now still executes its
exclusion DELETE. This is not a claim that every small write becomes faster.

**A8-F13 — Equivalent new target spellings could insert duplicate pivot edges
(corrected for database-equivalent target IDs).** A case-insensitive target and
pivot fixture with requested `BETA` and `beta` inserted two rows in the previous
writer and the first bounded-read draft. The existing target-lock helper already
resolves alternate spellings using the actual target ID column. It now returns
each resolved database identity once, retaining the first submitted spelling;
ordinary pivot writers reuse that result. A single request inserts `BETA` once,
including when the second spelling is beyond the first target-lock batch.
Existing matching pivot rows keep their IDs and values. Permission validation
still precedes these locks and is not replaced by a cached decision.

This does not merge pre-existing duplicate pivot rows or repair incompatible
collations between target IDs and reference columns. The native fixture checks
SQLite NOCASE, PostgreSQL ICU case-insensitive equality and MySQL
`utf8mb4_unicode_ci`, with matching target/pivot comparison rules. General
application schema/collation migration remains the application's responsibility.

Twenty new ordinary-storage cases cover targeted read sizes, repeated IDs,
duplicate physical edges, empty inputs, the complete large keep-list, owned
and borrowed failure after deletion, failure on the second insert, successful
rollback, and native retained/deleted row locks. Existing pivot-write checks
now expect one replacement DELETE while retaining the insert bounds, callback
counts, retained values and rollback assertions. These suites use ordinary
storage in both mode invocations; canonical link and target-lock tests run
alongside them. See the [verification evidence](verification-progress.md#2026-09-10-bounded-ordinary-pivot-reads).

### Canonical parent-link read pages

**A8-F14 — Canonical parent-link prefetch bounded parent IDs but not returned
rows (A8-07; corrected).** A public JSON:API GET for one parent with 1,001
canonical links previously loaded all 1,001 physical link rows at once, despite
the existing 100-parent batch limit. The original Node 24 SQLite probe records
seven query bindings and 1,001 returned rows in
`/tmp/library-pivot-reads-link-prefetch-probe.log`.

`fetchLinksForParents` now pages each parent batch by physical link ID, selecting
at most 101 rows at a time. The extra physical ID is used only to advance the
read; it is absent from returned linkage. Every page is processed before its last
ID becomes the next boundary. A full 101-row final page requires an empty
follow-up query, so the end condition cannot drop a boundary row. Duplicate
physical edges retain their previous multiplicity. No row limit is applied to
the complete relationship or returned include set.

| One parent, 1,001 links | Before | After |
| --- | ---: | ---: |
| Link-read statements | 1 | 10 |
| Largest returned link-row buffer | 1,001 rows | 101 rows |
| Total physical rows read | 1,001 | 1,001 |
| Returned linkage identifiers | 1,001 | 1,001 |

Nine full pages contain 101 rows each; the last contains 92. Each query
uses at most 11 bindings for this one-parent fixture, including its target-type
constraints and page cursor. This is a temporary-buffer bound, not a peak-heap
measurement or a reduction in necessary output size. Large relationships require
more round trips. The 44-workload statement/result/configuration counters are
unchanged because those fixtures' parent-link reads fit within one row page.

Paging establishes physical link-ID order within each parent's prefetched rows.
Configured include ordering and per-parent limits remain separate SQL behavior
and are checked by the existing include-limit suites. The helper still borrows
the same database/transaction handle; a later page error rejects the operation.
A failure while preparing a full write response rolls back an owned transaction;
a borrowed transaction retains the pending write until its caller acts.

**A8-F15 — Canonical prefetch omitted the declared target-resource constraint
(corrected).** Related-resource queries and link mutations already restrict both
resource types. Prefetch previously checked only the owner type and relationship
key, allowing a same-key link to another target resource into primary GET
linkage when that other target was visible. Both stored directions now also
require the relationship's declared target resource. Three isolated pre-fix
public GET regressions reproduce the incorrect target type. Tenant, relationship,
owner and target sentinels now stay outside the prefetched rows.

The 39-case suite always uses canonical storage and covers unpaired links plus
both declared inverse directions, mixing physical orientations across pages.
It verifies direct helper output, JSON:API/plain GET and query results, sparse
includes, hidden targets, exact page endings, duplicate stored edges, 33,000
repeated parents, empty inputs, pending links and later-page failures during
reads and full write responses. The existing 205-parent tests retain three
queries; their binding ceilings now include the two target-type bindings and
row limit. See the [verification evidence](verification-progress.md#2026-09-10-canonical-parent-link-pages).

### Sparse relationship hydration

**A8-F16 — Sparse responses hydrate omitted relationships (A8-04/A8-07; corrected).**
The public canonical GET with `queryParams: { fields: { items: 'name' } }`
previously returned only the requested name and an empty relationship object,
yet performed ten parent-link read pages and materialized all 1,001 links.
The same probe now performs **zero parent-link reads**, retaining that response.
`/tmp/library-link-prefetch-sparse-probe.mjs` and its `.log` record the preceding
behavior; `/tmp/library-sparse-hydration-final-probe.mjs` and its `.log` record
the corrected result. A separate regression seeds 1,001 additional reverse
children and verifies that neither storage mode fetches those omitted children.

The ordinary linkage loader and both canonical attachment helpers reuse the
existing resource-fieldset lookup and parser to select relationship names.
The final to-one visibility pass likewise checks only relationships selected
for the response. Explicit includes continue through their existing loaders,
including nested paths whose linkage fields are omitted. They retain target
authorization, filtering, field dependencies and the caller's transaction.
No selection cache, API option or new fieldset parser is added. Without a
fieldset for a resource, its existing linkage reads remain.

The 27 new shared cases reproduce **20 failures in each storage mode** against
the preceding source snapshot. Coverage includes JSON:API/plain GET and query,
empty/repeated fields, computed attributes, selected and omitted linkage,
polymorphic and inverse relationships, nested includes, visibility, read errors,
and owned/borrowed full-response writes including explicit-include failures.
Declared getter/computed dependencies already exclude relationship fields;
their existing attribute dependency processing is unchanged. Hook observers no
longer receive reads for omitted linkage, as described in the migration guide.

The existing ten-record sparse-query workload changes from **4 ordinary / 5
canonical statements to 1 / 1**. Both ceilings are tightened to one. The other
43 workloads retain their counters. This is a query-count and intermediate-row
measurement, not a claim of constant memory for complete requested output.
See the [verification evidence](verification-progress.md#2026-09-10-sparse-relationship-hydration).

### Limited include allocation

**A8-F17 — Limited includes built discarded complete linkage
(A8-04/A8-07; corrected).** A canonical GET requesting `fields[items]=name,groups`
and `include=groups` with the default 20-resource limit previously read all
1,001 preliminary links in ten pages and then loaded complete include mappings.
It now performs **zero preliminary linkage reads and loads 20 mapping rows**,
returning the same 20 links and 20 included resources. Before/after probes are
`/tmp/library-sparse-hydration-limited-include-probe.mjs` and
`/tmp/library-limited-includes-final-probe.mjs`, with their `.log` files.

Both backends skip preliminary hydration for relationships handled by the
explicit include tree. Canonical nested traversal passes the current child tree,
so a relationship name at another depth cannot suppress a needed read. Standard
many-to-many includes constrain the target query with a SQL membership subquery,
apply the existing target permissions/order/limit, and only then load mappings
for selected targets. Window includes retain their existing per-parent query.

The two standard loaders share one small parent-map reader in the existing
include module. It deduplicates requested IDs, uses at most 100 targets per
batch, and reads at most 101 distinct parent/child pairs per page. The complete
parent predicate reuses the existing large-identifier helper. Paging follows
native database ordering of both keys; returned text IDs preserve bigint
precision, while safe numeric values preserve references such as SQL `1.0`
mapping to resource ID `"1"`. The subsequent bigint correction below reuses
one identity projection per key, reducing each mapping row from four columns
to two. The helper retains only requested final mappings.

An earlier draft crossed parent and child batches, which would multiply query
counts for large inputs. The final regression requires only three reads for
205 distinct one-to-one pairs. A single target with 205 parents instead uses
three bounded pages (101/101/3). Repeated 33,000-element selections collapse to
one read, and empty selections issue none. Complete unlimited outputs still
require proportional result memory and can require more SQL statements than
the former unlimited mapping read. The database may process more candidates
than the application receives; this is not a constant-memory SQL-engine claim.

The 31 new cases cover standard/window limits, zero/unlimited results, shared
and duplicate physical edges, mixed canonical orientations, hidden targets,
sorting, callback counts, JSON:API/plain GET and query, nested paths, pending
membership, failed later mapping pages in owned/borrowed full-response writes,
large/repeated ID batches and exact 64-bit mapping keys. Existing canonical
prefetch tests now require zero preliminary reads for explicit includes while
retaining their result assertions and standalone paging/failure cases.

The existing nested-include workload improves from **8/11 to 7/9 statements**
(ordinary/canonical); PATCH with nested includes improves from **15/17 to 14/15**.
Those ceilings are tightened. The other 42 workloads retain their counters.
See the [verification evidence](verification-progress.md#2026-09-10-limited-include-allocation).

**A8-F18 — Ordinary SQL bigint resource reads can lose identity precision
(corrected; pre-existing).** A separate SQLite probe with a string API ID backed by
SQL `bigint` requests `9223372036854775806` and receives resource ID
`9223372036854776000`. Including adjacent bigint targets also produces empty
linkage. Both the preceding source snapshot and the current implementation
reproduce the same outputs. The new mapping helper's exact-key regression does
not establish correctness of the earlier public record-read stage. Evidence:
`/tmp/library-limited-includes-bigint-before-probe.mjs` and
`/tmp/library-limited-includes-bigint-probe.mjs`, with their `.log` files.
The subsequent native probe uses matching bigint primary/reference columns:
SQLite and MySQL reproduce the rounded GET ID and empty included linkage;
PostgreSQL preserves both exact adjacent IDs. The PostgreSQL snapshot probe
also returns exact IDs. An initial diagnostic fixture used varchar pivot keys
against bigint primary keys and hit a PostgreSQL type-comparison error; the
matching-column probe removes that fixture ambiguity. These scripts report
observations, so their successful process exits are not passing correctness
assertions. They force ordinary storage in both runner invocations.
Evidence: `/tmp/library-limited-includes-bigint-matched-native.log` and
`/tmp/library-limited-includes-bigint-matched-before-pg.log`, with their matching
probe scripts.

The correction uses the existing database-value normalizer module for one
SQLite identity expression and enables MySQL's per-query `supportBigNumbers`
option. SQLite returns out-of-safe-range INTEGER identities as text, retaining
safe numbers, REAL references, nulls and text spellings. Primary/minimal record
reads, visibility, reverse/pivot linkage, include parents, reference-sort cursor
values, target locks, reverse writes and INSERT RETURNING use exact identities.
Predicates, joins, ordering and keyset comparisons retain native SQL columns.
PostgreSQL retains its existing bigint decoding. There is no connection-wide
mutation, compatibility path, added query, new dependency or public option.
The parent-map reader now reuses that same boundary and returns only two keys,
removing its separate text/native pair handling.

The regression fixture uses matching bigint primary, belongs-to, polymorphic
and pivot columns. Initial SQLite public tests fail 28/28 before the correction
and pass 28/28 afterward. Expanded coverage includes positive/negative signed
64-bit limits, adjacent IDs, standard/window includes, nested/related reads,
repeated relationship writes, reverse removal, borrowed transactions, explicit
and generated inserts, sparse reference cursors and native numeric ordering.
A focused native matrix passes 192/192 cases (34 ordinary / 30 canonical per
database); generated physical bigint keys are ordinary-storage cases. Full
verification of the final source is recorded in the [verification log](verification-progress.md#2026-09-10-lossless-sql-bigint-identifiers).

The SQLite plan review identifies one unnecessary conversion in canonical
visibility: logical IDs are already text. Selecting them directly retains the
covering index and avoids a temporary DISTINCT tree. A new real-EXPLAIN
regression fails before that refinement and passes afterward. PostgreSQL/MySQL
SQL is unchanged by this guard because their identity expression already returns
the native column. Full 10,000-item/20,000-link SQLite plan fixtures are rerun
for both modes. Across the 22 canonical scenarios, temporary DISTINCT nodes
fall from 30 to zero with identical statement/result assertions; this is
plan/result evidence, not a latency threshold.

**A8-F19 — Included resources expose internal dependency metadata
(corrected; pre-existing).** An ordinary JSON:API GET with a sparse included
target formerly returned `__$jsonrestapi_computed_deps$__` on the resource, even
when the array was empty. Both storage modes exposed dependency names when an
included computed field depended on an omitted attribute. The preceding snapshot
reproduces the same output; the bigint correction did not introduce the leak.

The existing final response normalizer now removes that reserved resource-level
member after enrichment and finish hooks. Database-stage normalization retains
it for computation. Cleanup also handles minimal records without attributes and
preserves keys nested inside caller attributes, metadata and relationships. The
fix changes one runtime module and adds no response walker, option or SQL query.

The 58 new regressions initially fail 55/58 in each mode. They cover normal and
computed includes through all six relationship paths, standard/window loaders,
GET/query/related reads, full POST/PATCH/PUT, plain nesting, minimal/full borrowed
write responses, finish hooks, HTTP output and pure normalization boundaries.
They now pass, together with callback/dependency tests and full Node 24 checks.
The original GET reproducer also now exits zero in both modes. See the
[verification evidence](verification-progress.md#2026-09-10-response-dependency-metadata).

**A8-F20 — Cyclic includes duplicate primary resources (corrected;
pre-existing).** For an item linked to a group whose `items` relationship points
back to that item, both GET and query previously returned `items/1` in primary
`data` and again in `included`, invoking its computed callback twice. Both
storage modes and the preceding snapshot reproduce it. JSON:API requires one
resource object per type/ID pair throughout a compound document.
[Compound-document specification](https://jsonapi.org/format/#document-compound-documents).

Both existing include maps now start with primary resource identities. Ordinary
storage shares the primary record's relationship object with that map; canonical
storage shares the primary resource itself. Nested paths retain their traversal
and authorization queries, add linkage to that shared representation, and omit
primary entries from the returned `included` array before enrichment. Plain
conversion's existing per-document lookup now indexes primary resources too,
so peer primaries expand and actual cycles still end in identifiers.

The first canonical implementation exposed an interaction with default linkage:
a later path could replace an earlier limited collection with the complete
membership. Canonical default reverse/many-to-many hydration now reads and
assigns only missing relationships. Explicit include loaders still apply their
limits. Twelve cases cover both path orders for reverse, many-to-many and
reverse-polymorphic collections; two more cover a shared included target.

The 58-case public suite covers six relationship directions, GET/query/related
reads, multiple primary records, sparse/computed fields, visibility, plain peer
expansion, nested linkage, include limits and borrowed full POST/PATCH/PUT.
Together with the 13 plain-conversion cases, the corrected pre-fix baseline
passes 12/71 and fails 59/71 in each mode. The new shared structure assertion
checks uniqueness across both `data` and `included`. Three older regressions
that expected a duplicate primary resource now assert its absence while keeping
linkage/fieldset checks. Six real Express/Fastify cyclic HTTP cases extend the
existing metadata suite; all six Express 4 HTTP cases per mode pass as well.

No response option, schema, compatibility layer or SQL predicate is added.
Full/native evidence and the unchanged workload counters are recorded in the
[verification log](verification-progress.md#2026-09-10-cyclic-resource-identity).

**A8-F21 — Empty include results omit the included member (corrected;
pre-existing).** A successful request with an explicit supported include must
retain an `included` array even when there are no included resources.
[JSON:API inclusion requirements](https://jsonapi.org/format/#fetching-includes).

The public probe `/tmp/library-empty-included-probe.mjs` reproduced the omission
for GET/query with an empty relationship, an empty primary query and an empty
related collection. Both modes match the preceding snapshot. The response
builders now retain an empty included array for a supplied include, including
`include: []`; the related-response boundary also handles null to-one results.
Programmatic minimal/none returns retain their selected contract, and HTTP
resource writes select full JSON:API responses.

The parser and existing request setup preserve absence rather than inserting
an empty include by default. Explicit HTTP `include=` remains an empty array
and survives query serialization. An initial candidate left an own property
with value undefined, which the existing schema validator correctly rejected;
the final setup omits that property instead of weakening array validation.
No extra presence flag, response option or compatibility path is added.

Self-link round-trip tests also exposed dropped query parameters on single-resource
and related responses. The existing private pagination link builder moves to
`url-helpers.js` and is reused there. Top-level refresh links retain include and
fieldset parameters; resource identity links retain their existing URLs. Collection
pagination continues using that same builder and serializer.

The 53-case public suite covers seven relationship directions, GET/query/related
reads, null/empty data, omitted and explicit empty includes, reused query objects
and contexts, pagination/self-link round trips, plain/minimal/none formats, full
owned/borrowed POST/PATCH/PUT, real Express/Fastify and error envelopes. Two
parser cases cover absence, repeated keys and empty serialization. With the full
10-case parser suite, the pre-fix run passes 11/63 and fails 52/63 per mode.
Focused format/cyclic/include/parser checks pass 181/181 per mode, and the new
Express 4 HTTP selection passes 10/10 per mode. The original four-case probe now
passes in both modes. The older depth test now expects an empty included array
for its explicit empty include; its depth/path assertions are retained.

The [final evidence](verification-progress.md#2026-09-10-empty-include-documents)
records full/native results and unchanged query budgets. Request presence and
link construction change no SQL query or dependency. A2-16's complete capability
reconciliation and A8-07's full input/result allocation review remain open.


### Reverse membership changes

**A8-F22 — Reverse writes read and retain complete membership (corrected).**
`updateReverseRelationship` previously selected every current child
ID for additions, removals and replacements, then allocated a full membership
set and arrays of changes. Adding or removing one child among 1,001 therefore
returned 1,001 membership rows in both modes, for both ordinary and reverse
polymorphic relationships. IDs equal under the database collation could also
trigger redundant PATCH calls or fail to remove a member.

The existing helper now limits addition/removal membership reads to batches of
100 requested IDs. Additions and replacements reuse `lockRelationshipTargets`
to recheck targets and deduplicate database identities. Replacement applies one
complete keep-list exclusion and reads at most 101 removed identities per page,
using native ID ordering and a keyset predicate. It unlinks each page through
child PATCH before reading the next; no complete old membership set or removed
array remains. Requested-member removal preserves input order, including the
first submitted spelling of equivalent IDs, and still ignores unrelated or
missing targets. Removal pages complete before any hasOne replacement is linked.

The public probe uses the same fixture and assertions against the preceding
source snapshot and the changed runtime. Both relationship directions give these
Node 24 SQLite observations; child-write counts and final membership agree:

| Operation | Existing children | Largest membership read, before → after | Ordinary statements, before → after | Canonical statements, before → after |
| --- | ---: | ---: | ---: | ---: |
| Add one new child and retain one existing child | 1,001 | 1,001 → 1 | 12 → 14 | 11 → 13 |
| Remove one child | 1,001 | 1,001 → 1 | 9 → 9 | 8 → 8 |
| Replace one child while retaining 1,000 | 1,001 | 1,001 → 100 | 28 → 50 | 25 → 47 |
| Clear the collection | 205 | 205 → 101 | 827 → 829 | 621 → 623 |

This trades extra bounded queries and target identity checks for bounded
membership results; it does not reduce every operation's statement count.
Replacement still reads 1,001 membership identities in total in this probe, but
retains them per page/batch. Clearing still invokes all 205 child PATCH operations;
removing those lifecycles is separate A8-04 work. The complete input/keep-list
remains proportional to the request. No child attributes are fetched by the
membership reads, and no output cap, dependency or compatibility path is added.

The corrected 22-case pre-fix baseline passes 4 and fails 18 per mode. The suite
now has 30 cases covering both reverse directions, 33,000 repeated inputs,
multiple removal batches/pages, mapped IDs, resource PATCH/polymorphic PUT,
borrowed rollback and failures after a successful page. Three cases deliberately
use ordinary case-insensitive ID columns regardless of the outer storage mode.
The expanded selection, including existing reverse writes, bigint IDs and
concurrent transactions, passes 138/138 ordinary and 134/134 canonical on SQLite.
The full gate and 871 passing selected native checks are recorded in the
[verification evidence](verification-progress.md#2026-09-10-reverse-membership-allocation),
including corrections to PostgreSQL observation and MySQL keep-list assertions.
This entry does not close A8-07's remaining allocation reconciliation.

Probe source: `/tmp/library-reverse-membership-probe.mjs`; logs:
`/tmp/library-reverse-membership-probe-{before,after}-{knex,anyapi}.log`.
The [migration guide](../GUIDE/MIGRATING_API_V2.md#review-relationship-writes)
describes database identity equality, bounded reads and child hook ordering.

### Canonical linkage visibility allocation

**A8-F23 — Canonical linkage retains hidden edges before filtering (corrected).**
The canonical default-linkage loader used
to collect every physical link, construct identifiers, query visible target IDs
in batches, build a visibility set and filter the full row array. Its `listMany`
helper likewise loaded all identifiers before checking target visibility.

The existing scoped include-filter helper now builds an authorized target-ID
subquery, constrained to the requested parents' relationship. The existing
forward/inverse link predicates apply that subquery before fetching rows. The
physical pager still uses 100 requested parents and at most 101 link rows, in
native physical ID order. `listMany` retains its existing SQL UNION deduplication;
default linkage and the raw row helper retain their existing duplicate-edge
behavior. The raw helper still returns every requested physical edge.
This changes two existing runtime modules, exports an existing internal helper
for reuse and adds one private query-construction helper. It introduces no new
module, dependency, public option or compatibility path.

The before/after public probe uses Node 24.6.0 and canonical SQLite storage,
three relationship directions, 205 targets and two visibility settings. All
18 observations per source preserve the exact response IDs. Two targets are
hidden in the first setting; every target is hidden in the second.

| Operation | Link rows before → after, two hidden | Link rows before → after, all hidden | SQL statements before → after, two/all hidden |
| --- | --- | --- | --- |
| Sparse GET, all directions | 205 → 203 | 205 → 0 | 8 → 5 / 8 → 3 |
| getRelationship, unpaired/inverse | 205 → 203 | 205 → 0 | 8 → 5 / 8 → 3 |
| getRelationship, forward | 205 → 203 | 205 → 0 | 11 → 8 / 11 → 6 |
| listMany, all directions | 205 → 203 | 205 → 0 | 4 → 1 / 4 → 1 |

The forward endpoint also reads the parent's other reverse relationships; those
three independent filter calls remain. The requested many-to-many target filter
is built once rather than three times. Physical GET pages change from
`[101, 101, 3]` to `[101, 101, 1]` or `[0]`. `listMany` returns the complete visible
identifier result in one statement, so that result itself is not capped at 101.
These measurements establish fewer fetched rows and statements, not peak heap
or a database query-plan speedup. A subquery can still have database-side work
proportional to the relationship. Setup and result verification are outside the
SQL counts.

The initial new 51-case suite passes 39 and fails 12 before the fix. The first
focused run after implementation passes 180/181; its one assertion incorrectly
counted the forward parent's three other relationship filters. The observer now
identifies the requested link query. After direct `listMany`, missing-target and
duplicate-edge coverage, the expanded selection passes 254/254. The final suite
also covers 205 parents crossing three batches and passes 57/57 independently.
It retains the existing 33,000 repeated-parent, later-page failure and full-write
rollback tests. The shared fixture accepts the existing query-limit option to
exercise more than one parent batch.

The first 44-workload run in each mode passes its previous ceilings. Seven
canonical counters decrease by one: flat read 5→4, related many-to-many 4→3,
full PATCH 11→10, and both 40-record authorized reads 7→6 / polymorphic reads 9→8.
The corresponding ceilings are tightened; the other counters remain unchanged.
The size-1/10 policy ceilings also tighten to their already-lower actual counts.
The full Node 24 gate passes, and the selected native matrix passes 1,554/1,554
checks. All eight reports match their 44 counters and tightened ceilings across
the three databases. See [exact results and scope](verification-progress.md#2026-09-10-canonical-linkage-visibility).

Probe source: `/tmp/library-link-visibility-probe.mjs`; logs:
`/tmp/library-link-visibility-probe-{before,after}.log`. The
[migration guide](../GUIDE/MIGRATING_API_V2.md) describes filter-hook timing.

### Canonical attachment duplicate rows

**A8-F24 — Existing-edge attachment reads are not physically paged (corrected).**
The final allocation read-through found that canonical `attachLinks` constrains
each existing-edge query to 100 requested targets, but still materializes every
matching physical link. The canonical link table permits duplicate stored edges.
This is separate from the corrected default-linkage prefetch and ordinary pivot
writer, which already bound physical pages.

The public Node 24.6.0 canonical SQLite probe starts with 205 target links and
adds 500 duplicate stored copies of the first edge. An idempotent
`postRelationship` for that single target reads **501 existing-edge rows in one
query**, in unpaired, forward and inverse directions. All 705 stored edges remain
unchanged. This confirms avoidable allocation without claiming a failed write
or changing the duplicate-edge preservation contract.

Probe: `/tmp/library-duplicate-link-write-probe.mjs`; output:
`/tmp/library-duplicate-link-write-probe.log`. That initial reproduction used the
verified A8-F23 source.

The existing attachment loop now reads native physical IDs in pages of at most
101 rows for each batch of 100 requested targets. It retains the first exact-ID
match only for requested IDs, limiting the lookup to 100 entries even if stored
ID spellings vary under the column collation. The existing single-row lookup
resolves unmatched spellings through database equality. It still locks all
matching edge rows, repairs the first inverse marker and retains duplicate rows
and payloads. One existing runtime module changes; no new runtime module, helper
framework, API option or compatibility path is added.

The final 17-case SQLite regression suite fails 17/17 on the old source. The
first patched focused selection has six test-injection failures per mode: the
mock was attached to the root Knex client, while queries run through the
transaction client. Moving the injector to the observed transaction makes those
failure cases exercise the actual second read page. No runtime correction was
needed. The resulting focused selection passes 94/94 ordinary and 99/99 canonical
(22.446s / 22.416s), including existing batches, canonical deletion/replacement
and real concurrent transaction tests. Native MySQL additionally checks alternate
stored ID spellings using explicit case-insensitive ID columns. Its first run
passed both SQLite/PostgreSQL modes, then failed these three new cases because
the standard MySQL fixture deliberately uses binary equality. The tests now
configure matching case-insensitive logical/link ID columns and verify that
setup before invoking the public write. Only this MySQL-specific test block
changes after the full gate; production source and the SQLite/PostgreSQL cases
remain identical. MySQL is rerun separately after that fixture correction.

The before/after public probe confirms the following in all three relationship
directions, retaining exactly 705 stored rows and all payloads:

| Measurement, one requested existing ID | Before | After |
| --- | ---: | ---: |
| Largest existing-edge read | 501 rows | 101 rows |
| Existing-edge read pages | `[501]` | `[101, 101, 101, 101, 97]` |
| Total existing-edge rows read | 501 | 501 |
| Entire operation SQL statements | 7 | 11 |

The extra four statements bound application allocation while retaining the old
edge-lock coverage; this is not a total-row or latency reduction. Setup and
post-operation inspection are excluded from counts. No heap threshold is claimed.
The 33,000-repeat test retains borrowed transaction ownership and checks the last
edge lock on native drivers. Other cases find a retained target after duplicate
pages, cross requested-ID batches, preserve payloads/inverse markers and inject a
page failure after 100 successful inserts: owned rollback restores the original
edges, while borrowed changes remain pending until caller rollback.

Probe: `/tmp/library-link-attachment-probe.mjs`; logs:
`/tmp/library-link-attachment-probe-{before,after}.log`. The full Node 24 gate
passes, and the selected native jobs total **787/787**, without skips/failures.
All eight relevant 44-workload reports match the preceding counters and ceilings.
The final [evidence and source reconciliation](verification-progress.md#2026-09-10-canonical-attachment-allocation)
combines the first run's passing SQLite/PostgreSQL jobs with the corrected
MySQL-only run; it explains the test-only difference between source manifests.


## Query plans and index choices

The [query-plan review](query-plans.md) captures generated SQL for eleven shapes
over 10,000 items and 20,000 links, before and after candidate indexes on all
three databases. It covers nullable sorting, pagination, nested/related reads,
counts and large relationship replacement/removal. It also records the SQLite
native-null-ordering correction and the residual sorts it does not remove.
Index recommendations use existing resource metadata and Knex migrations;
application indexes are not added automatically.

## Findings and remaining work

### Canonical relationship deletion and replacement

Canonical explicit removal previously materialized the owner's entire link map
and issued a DELETE for each supplied ID. Replacement also read the full map
and deleted unwanted links individually. These results were unused after the
write. Removal now uses at most 100 distinct requested IDs per scoped DELETE;
replacement uses one exclusion predicate for the complete desired set. The
existing large-ID helper keeps that predicate within SQLite/PostgreSQL binding
limits. Splitting the keep-list into independent deletes would erase wanted
links. A 33,000-ID replacement checks that the complete set survives.

Attachment reads existing links for at most 100 requested target IDs, in either
physical orientation, before inserting missing ones. Its result map lives within
that batch. Database comparison determines which side owns a stored row, and
unmatched spellings retain the existing scoped single-ID check. Retained rows
keep their IDs and payloads; missing inverse metadata is repaired according to
the row's actual orientation. Review of the first implementation caught a
duplicate insertion when a link predated declaration of its inverse. Two
regressions cover that case through replacement, listing and subsequent removal.

Every mutation branch constrains tenant, owner, relationship and target resource
type. When an inverse relationship is known, its stored identity also matches
rows with missing inverse metadata. Listing reuses the existing scoped related-ID
query, preventing another resource type with the same ID from shadowing a valid
target. Actual deletes retain locks until the existing transaction completes.

The focused cases require three deletes and no link reads for 205 explicit IDs,
one delete for 33,000 repeats of one ID, no work for empty explicit removal, and
one delete with no link reads for empty replacement. Failure injection checks
the second removal batch and replacement after insertion, with owned rollback
and borrowed pending changes. Native tests also contend on the deleted row.
No public option, row cache or compatibility mode is added. Individual inserts,
full input sets and broader resource-write work remain under A8-04/A8-07.

One replacement DELETE does not mean one statement for the entire operation.
Replacement now reads and locks the requested targets in batches, even when all
links already exist; the previous path read the complete old membership once
and skipped attachment for retained IDs. This bounds each lookup's requested-ID
set but increases round trips for a large no-op replacement. The deletion gains
do not establish that every replacement shape is faster. Query-plan/index review
and broader replacement measurements remain under A8-10/A8-12.

**A8-F01 — Relationship write reads grow per target (partially addressed,
A8-04).** Target locks and existing canonical edge lookups are batched as
above. Target validation now uses the bounded minimal reads above. Bulk resource writes
and reverse relationship child changes still use individual resource lifecycles.
Any further batching must retain the verified authorization, customization and
transaction behavior, or explicitly migrate that contract. The measurements
alone do not prove every per-target callback can be removed.

**A8-F02 — Disconnected optimized bulk path (fixed by removal).** The bulk plugin
registered `beforeBulkPost` but never ran it; hooked-api's scope wrapper calls
the method handler directly. The dormant handler also referenced nonexistent
`validateInput`, `transformForDatabase` and `transformFromDatabase` methods.
It has been removed rather than connected to bypass the normal write lifecycle.

**A8-F03 — Invalid bulk settings could hang or skip work (fixed).** `batchSize`
only split a sequential loop, and zero/invalid increments could prevent its
progress. That loop and the ineffective `enableOptimizations` setting have been
removed. Installation accepts only a positive safe-integer `maxBulkOperations`
and boolean `defaultAtomic`, supplied directly. The 22 configuration/lifecycle
cases verify early rejection, real limits for all three methods, normal
validation/hooks, failure indexes, non-atomic defaults and atomic override.
The [migration guide](../GUIDE/MIGRATING_API_V2.md#bulk-writes) explains the
configuration change. This removes misleading controls; a bulk SQL optimization
remains unfinished.

**A8-F04 — Unbounded ordinary pivot writes (fixed).** New-link inserts could
exceed SQLite's compound SELECT limit, replacement deletes used unbounded ID
lists, and explicit relationship removal issued a DELETE for every supplied
identifier. [Bounded pivot writes](#ordinary-pivot-write-batches) correct these
paths without changing the transaction or target-validation lifecycle.

**A8-F05 — Unbounded visibility identifier queries (fixed).** A direct
call to the shared `filterVisibleIdentifiers` helper with 33,000 unique IDs
reproduces SQLite's `too many SQL variables` error in both ordinary and canonical
storage. It previously placed all IDs of a target type into one `WHERE IN`.
The [bounded visibility reads](#visibility-identifier-batches) above correct
that helper and add full-API include coverage. This does not complete the
broader include-loader and total-memory requirements of A8-07.

**A8-F06 — Oversized nested belongs-to queries (fixed).** A public
`groups.get({ id: '100000', queryParams: { include: ['mentions.group'] } })`
with `collectionInclude: { limit: null }`, 33,000 reverse-polymorphic children
and 33,000 distinct referenced groups previously failed with SQLite's
`too many SQL variables` in both storage modes. Both belongs-to loaders and
their polymorphic variants used an unbounded target-ID `WHERE IN`; canonical
parent-link prefetches could exceed the limit before reaching that loader.
The [bounded includes](#belongs-to-include-batches) above correct those paths.
Collection include predicates are corrected below; total-memory bounds remain unfinished.

**A8-F07 — Oversized collection and reverse-linkage queries (fixed).**
Using the same 33,000-child fixture with
`include: ['mentions.group.items']` previously reproduced SQLite's
`too many SQL variables` through the public API in both storage modes after
the belongs-to correction. Ordinary collection queries selected all parent IDs
as separate parameters; canonical reverse-linkage prefetch could fail before
its nested collection query. The [single-query ID-list transport](#collection-identifier-lists)
corrects these and the other collection/metadata predicates without restarting
global limits. Complete input/result memory remains separate work.

**A8-F08 — Collection filtering could discard visibility restrictions (fixed).**
Both collection storage helpers continued using the original builder after a
`knexQueryFiltering` hook replaced it. Restrictions applied to the replacement
could be absent from returned pages and canonical totals. The final builder is
now used for collection selection and pagination, and enclosing query metadata
is restored even when a filter fails. See the
[authorization review](#authorization-before-limits-and-counts).


## Compiled output definition lookups

An isolated Node 24 before/after probe normalized 5,000 sparse records, each with
three boolean-like values, against 100 stored, one computed and one projected
field definition. It warmed both variants and alternated their execution order
for seven measured batches. Data construction and assertions were outside the
timed region. The plain case called the deep normalizer once per record; it is
not a measurement of a public plain-query endpoint or database workload.

| Normalization mode | Previous median | Compiled-index median |
| --- | ---: | ---: |
| JSON:API collection | 21.630ms | 1.412ms |
| Plain records | 28.036ms | 1.834ms |

Timing used ordinary, uninstrumented metadata objects. A separate Proxy-based
observation counted enumeration of the **original source maps**: 15,000 before
versus zero after for JSON:API, and 20,000 versus zero for plain records (the latter
also includes the original relationship map). This does not mean all metadata
iteration vanished: plain traversal still iterates its compiled relationship
index. The initial instrumented timing output was retained separately and is not
used for the performance comparison above.

A separate compiler-only experiment alternated seven batches of 100 compilations
for 100 searchable stored fields plus one computed field. Median compilation
time was **4.504ms before / 4.507ms after**; sample variation was much larger than
that median difference. This establishes no meaningful slowdown in that run,
not a statistical equivalence or a production startup guarantee. The indexes
retain references to existing definitions and have resource/schema lifetime;
records, request context and authorization results are not retained in them.

The temporary before/after loaders were never shipped. Artifacts:
`/tmp/library-output-metadata-benchmark.mjs`,
`/tmp/library-output-metadata-benchmark.log`,
`/tmp/library-output-metadata-instrumented.log`, and
`/tmp/library-output-metadata-init-benchmark{.mjs,.log}`.
These measurements concern metadata assembly only; SQL budgets, full application
throughput and whole-response peak memory remain separate evidence.

## Compiled foreign-key membership

The compiler now reuses the foreign-key set already computed for dependencies;
conversion and selection consume that fact. An isolated baseline loader restores
only the prior conversion-time derivation for comparison with normal imports.
The fixture uses 103 stored fields (100 strings, an ordinary foreign key and a
polymorphic type/ID pair), compiled storage metadata, and a sparse record.
Assertions check identical output and exclusion of backing fields.

After 500 warmup conversions, seven alternating batches of 5,000 conversions
produced uninstrumented medians **14.126563ms before / 6.747824ms after**.
A separate Proxy measurement counted **5,000 / zero source field-map
enumerations**. The converter still scans polymorphic relationship definitions;
this does not eliminate every metadata traversal. These helper measurements do
not estimate database or public API throughput. No new initialization timing is
claimed for this follow-up: the compiler returns a set it already computed.
Artifacts are `/tmp/library-foreign-key-index-benchmark.mjs`, its `-loader.mjs`
and `.log`; the loader is experimental and is not shipped.

## Compiled relationship lookup

The shared `findRelationshipDefinition()` now reads an own entry from the existing
compiled relationship index. Its previous fallback scanned all stored fields for
belongs-to aliases, including every unknown-name lookup. No new compiler index
or cache is introduced by this change.

The applied-source probe uses a normally imported helper and an explicit copy of
the previous helper as baseline, with one compiled 101-field resource and 10,000
alternating known/unknown lookups. Identity and unknown/prototype-name behavior
are asserted. Separate instrumentation counts **10,000 / zero field-map scans**.
After a 10,000-lookup warmup per implementation, seven alternating batches yield
uninstrumented medians **8.576751ms before / 0.152860ms after**. This was run after
other test jobs completed; it supersedes the timing samples collected during the
full gate. These are isolated helper timings, not database or API throughput.
Initialization creates no additional retained metadata.
Artifacts: `/tmp/library-relationship-index-benchmark.mjs` and `.log`.

## Sparse computed selection

`tests/computed-field-selection.test.js` measures definition work for a sparse
request containing one existing and one missing name against 200 compiled
definitions. Before direct lookup, the helper enumerates the map once and reads
200 definitions; after direct lookup, it performs no map enumeration and reads
one definition. Output is identical. The old-source run fails only the work
assertion (`/tmp/library-computed-selection-before.log`).

This removes an all-definitions scan and intermediate visible-name array from
sparse selection. Default selection still scans the map. No initialization or
retained-cache work is added; no SQL, wall-clock, or application throughput
improvement is inferred from these counters.

## Dependency membership during compilation

`tests/dependency-sort.test.js` counts indexed name reads while sorting a fixed
200-field chain. Scanning `items.includes(dependency)` for every edge required
20,100 reads. Building one membership set reduces this to 400 reads: one pass
to build membership and one traversal of the input names. The before-change
run fails the work bound; ordering already passes. Duplicate roots, shared
dependencies, missing dependencies and cycle errors retain their behavior.

This is a compilation-local set, released with the sort call; it is not a
retained schema cache. Dependency membership becomes constant-time per edge,
with linear membership construction, instead of a field-list scan per edge.
Traversal now uses explicit iterator frames: a 12,000-field chain that formerly
overflowed the JavaScript call stack sorts successfully, and a cycle in that
chain still reports the expected field. Lazy traversal and iterator cleanup are
checked against the previous recursive implementation. These counters establish
reduced metadata work, not an SQL-count, wall-clock or throughput improvement;
the depth test is not a claim about database column limits.
## Bulk and reverse-child writes: retained lifecycle decision (2026-09-12)

`node scripts/measure-write-lifecycles.js` uses the shared row-policy fixture,
with ordinary/canonical storage selected through the existing test environment.
The same script runs under `scripts/test-databases.js pg` and `mysql2`.
Node 24.6.0 passed all 18 scenarios per storage/database combination: 108
measured scenarios across SQLite, PostgreSQL 16.15 and MySQL 8.0.46. Each of the
six combinations also passed the separate dependent-hook assertion.

Sizes are 1, 10 and 40 children. Bulk PATCH covers atomic/non-atomic ownership
and full/no returned resources; reverse relationship addition/removal calls
each child's PATCH lifecycle. Assertions check ordered before/after hooks,
persisted attributes/linkage, result counts and absence of metadata queries.
One later child hook reads the earlier child's write inside the same owner and
uses it to change its own data. That is observable behavior a single deferred
SQL batch would change.

At 40 children, all three databases produced the same statement counts:

| Operation | Ordinary reads | Canonical reads | Writes | Transaction statements |
| --- | ---: | ---: | ---: | ---: |
| Atomic bulk, full return | 300 | 260 | 40 | 2 |
| Atomic bulk, no return | 120 | 80 | 40 | 2 |
| Non-atomic bulk, full return | 300 | 260 | 40 | 80 |
| Non-atomic bulk, no return | 120 | 80 | 40 | 80 |
| Remove reverse children | 122 | 82 | 41 | 2 |
| Add reverse children | 204 | 164 | 41 | 2 |

All measured paths execute 80 ordered child hooks at size 40 and zero metadata
queries. The extra reverse write belongs to the parent lifecycle. Counts grow
linearly over the measured sizes; this is not a constant-query bulk interface.

**Decision for R-L01:** retain the direct per-record implementation. Each child
has authorization, mutable before/after hooks, its own result/error semantics
and, for non-atomic bulk, its own commit boundary. The measured dependent hook
shows why deferring all writes until after all before hooks would be incorrect.
A hook-free mode or automatic hook analysis would add a second contract for an
unproven benefit. The existing `returning: 'none'` option already cuts measured
atomic totals from 342 to 162 ordinary statements and 302 to 122 canonical
statements without changing hook execution. This batch adds evidence, not a new
performance optimization or an assertion that these paths cannot improve later.

Elapsed time and heap deltas are recorded by the script, but competing local
work, garbage collection, warm caches and fixture size make them descriptive,
not before/after performance claims. Logs:
`/tmp/jra-write-lifecycles-knex-20260912.log`,
`/tmp/jra-write-lifecycles-anyapi-20260912.log`,
`/tmp/jra-write-lifecycles-pg-20260912.log`, and
`/tmp/jra-write-lifecycles-mysql-20260912.log`.

## Bounded diagnostic formatting cost (2026-09-12)

`node scripts/measure-diagnostics.js` measures the retained enhanced logger on
Node 24.6.0: 500 warm-up calls per case, then five alternating samples of 5,000
calls. An independent review caught that the oversized error's entire details
can be dropped by the budget: secret absence alone did not prove redaction.
The script now checks a separate small preview for both explicit redaction
markers and a retained visible field, then checks the measured oversized error
is bounded. The latter contains binary data and an oversized array. It does not perform network or
disk logging and does not benchmark a complete resource operation.

| Case | Median microseconds/call | Observed min–max |
| --- | ---: | ---: |
| Direct no-op trace | 0.043 | 0.038–0.052 |
| Bounded trace with no-op writer | 8.536 | 7.310–13.597 |
| Bounded nested error with no-op writer | 50.095 | 39.327–56.077 |
| Bounded nested error with JSON sink | 52.676 | 41.405–68.565 |

The formatted error event was 594 bytes. The no-op cases explicitly show that
formatting is not free when a supplied writer discards its output. These local
samples were collected while other verification work was active; they are not
production latency, throughput or confidence intervals.

Retain the existing bounded formatter and logger contract for this batch. An
additional level-enablement protocol or implicit no-op detection is not needed
to close diagnostic correctness. This measurement makes the cost visible and
provides a repeatable baseline for a future demonstrated logging bottleneck.
No new caching, global state or formatter bypass is introduced.
Log: `/tmp/jra-diagnostics-measurement-20260912.log`.

## Final cost comparison against A0 (2026-09-13; C2-03)

Recorded 2026-09-13 from existing evidence only. No tests, benchmarks, installs, packing, publication or services were run for this comparison.

The strongest findings are lower sparse/related-query counts, a smaller publication artifact, and unchanged SQL counts in the actual accounts migration workload. The evidence does **not** establish a universal latency, memory or initialization improvement.

### Identity and comparability

- **A0:** `51302ce`, json-rest-api 1.0.29, Node **22.16.0**, SQLite 3.49.2. Source: `old/docs/development/library-improvement-baseline.md:14,218–250`; original pack metadata: `/tmp/library-baseline-package.json`.
- **Accepted library:** immutable `f97dc859321aee41915f3b0e256a861c382bc1b3`, json-rest-api 2.0.0. Latest completed library query-budget execution: Node **24.6.0**, SQLite, `/tmp/jra-post-deslop-verify-20260912.log:22` (ordinary) and `:557` (canonical). All 103 entries in `/tmp/jra-post-deslop-source-snapshot-20260912.json` were read and checked against f97; all match. Current runtime, declarations, manifest and measurement-script changes relative to f97 are empty.
- **Actual accounts comparison:** published library **1.0.28**, not A0's 1.0.29, versus f97 v2; both on **Node 26.5.0 / MySQL 8.0.46**, using the corresponding JSKIT package graphs. `/tmp/jskit-v2-rollout-42tSXQ/performance/provenance.json` confirms the candidate's 131 runtime/declaration/manifest files match f97, with no issues. This measures the coordinated consumer migration, not an isolated library swap.

### SQL work and recorded latency

The current measured statement counts equal their explicit ceilings in **all 44 scenarios per storage mode**, with **zero configuration-table statements in all 88 measurements**. Result counts and behavior are asserted independently. The four original headline shapes retain the same returned/included counts:

| Shape; returned / included | A0 ordinary / canonical statements | f97 ordinary / canonical statements |
| --- | ---: | ---: |
| Flat books; 10 / 0 | 2 / 3 | 4 / 4 |
| Sparse title; 10 / 0 | 2 / 3 | 1 / 1 |
| Publisher.country + authors; 10 / 5 | 6 / 9 | 7 / 9 |
| Related authors; 3 / 0 | 11 / 15 | 3 / 3 |

Related-author statements fall 72.7% / 80%; sparse statements fall 50% / 66.7%. Flat counts increase, and ordinary nested includes increase by one. These are honest operation-shape comparisons: the harness, visibility/linkage behavior and contracts evolved, so matching record counts alone do not establish identical complete work or attribute each difference to a single optimization. Statements include counts and other SQL, not only primary SELECTs. The A0 measurement script was introduced as development work after the baseline commit; it is not present in `51302ce` itself.

Additional current measured counts, absent from A0:

| Shape | Ordinary / canonical statements |
| --- | ---: |
| Full PATCH | 11 / 10 |
| PATCH with nested includes | 14 / 15 |
| Authorized hasMany or many-to-many read, 40 visible rows / two target types | 6 / 6 |
| Same read with polymorphic includes | 8 / 8 |
| Allowed idempotent relationship add, 40 / 101 targets | 7 / 7; 10 / 10 |
| Denied relationship add, 41 / 102 requested targets | 6 / 6; 7 / 7 |
| Atomic bulk POST / PATCH / DELETE, 40 rows | 322 / 362; 322 / 282; 162 / 122 |
| Non-atomic bulk POST / PATCH / DELETE, 40 rows | 400 / 440; 400 / 360; 240 / 200 |

Read statement counts stay constant between 10 and 40 visible rows when target-type count is unchanged. Bulk writes still execute each record's lifecycle and scale with item count. The latest authority is the actual reports and `scripts/measure-query-baseline.js:12–37`; the current budget table above has been corrected to **4/3 per item**, plus transaction statements, to cover linkage cleanup. The historical baseline result rows remain unchanged; those record the earlier implementation.

A0 recorded only an overall elapsed range **2.794–9.641 ms** and heap deltas **0.46–1.31 MB**. Current first-four-shape times are ordinary **8.756 / 2.324 / 14.078 / 6.242 ms**, canonical **16.486 / 5.305 / 16.947 / 12.743 ms**. These single observations are not controlled before/after latency measurements: Node versions, semantics, warmup, scheduling and garbage collection differ. The current canonical sparse heap delta is negative, illustrating why these deltas are not peak-memory or leak measurements. No fresh native-database budget execution is claimed here.

### Initialization and application performance

**A0 contains no whole-library startup or compiler initialization measurement.** Consequently, a numerical A0-to-f97 initialization ratio is unavailable.

The retained compiler-only experiments quantify specific implementation decisions:

| Isolated change, 101 fields | Before median | After median | Source |
| --- | ---: | ---: | --- |
| Add compiled output-definition indexes | 4.504 ms | 4.507 ms | `/tmp/library-output-metadata-init-benchmark.log:4–5`; `old/docs/development/query-measurements.md:1397` |
| Copy three enrichment-original maps | 1.324 ms | 1.884 ms | `/tmp/library-enrichment-copy-benchmark.log:4–5`; `old/docs/development/compiled-resources.md:752` |

Each used seven alternating batches of 100 warmed compilations. These are historical local before/after experiments, **not measurements rerun on exact f97** and not mutually comparable baselines. The second explicitly records an approximately 0.560 ms initialization cost for ownership correctness. The matching output-normalization experiment recorded 5,000-record JSON:API normalization **21.630 → 1.412 ms**, plain records **28.036 → 1.834 ms**; it measured normalization only, not an endpoint or SQL workload (`/tmp/library-output-metadata-benchmark.log:4–5`).

The latest actual accounts measurement is more representative of the selected consumer. Source: `/tmp/jskit-v2-rollout-42tSXQ/performance/comparison.json:10,47`, with raw samples in `baseline-result.json` / `candidate-result.json` and the exact script in `account-workload.mjs`.

| Accounts metric | Published v1.0.28 graph | Candidate v2/f97 graph |
| --- | ---: | ---: |
| Registration / login statements | 20 / 8 | 20 / 8 |
| Each measured profile PATCH / settings GET | 49 / 18 | 49 / 18 |
| Server initialization | 1,574.73 ms | 1,734.10 ms |
| RSS after initialization | 187.28 MiB | 186.88 MiB |
| Heap used after initialization | 62.39 MiB | 68.24 MiB |
| Heap increase during initialization | 42.09 MiB | 48.29 MiB |
| PATCH median / p95 | 50.69 / 80.79 ms | 55.49 / 66.32 ms |
| GET median / p95 | 17.05 / 21.82 ms | 17.66 / 24.18 ms |

There are two warmup rounds and ten measured write/read pairs per graph. The workload uses actual Fastify request injection with the real MySQL database; it excludes network transport. Startup times import the app server, create it and await readiness **after migrations**, not process spawn or database creation (`account-workload.mjs:94–105`). The two runs retain equal profile rows and migration history. Both owned databases were dropped. The corrected accepted script was identical for both runs; its first baseline-only attempt had a wrong post-check table name, retained separately and excluded.

Candidate observed startup and median request times are higher, while PATCH p95 and RSS are lower. Concurrent local acceptance work, small sample count, process/GC state and coordinated dependency changes prevent attributing these differences to v2 or promising a speedup. Ten samples make p95 effectively the maximum observed sample. The strongest reproducible comparison here is unchanged SQL work with preserved persisted behavior.

### Package contents and size

The existing npm cache artifact was read using the installed candidate's recorded SHA-512 integrity, verified, and inspected without extracting or repacking. **All 173 file bytes match f97**, including documentation. Its SHA-1 equals the final pre-commit pack log: `7de97a9f055111af4c797dd3ca2c9becbcce2421`. Read-only artifact results are saved in `/tmp/jskit-v2-rollout-42tSXQ/library-f97-package-size-evidence.json`; original acceptance logs are `/tmp/jra-post-deslop-verify-20260912.log:13` and `/tmp/jra-post-deslop-packaged-guide-20260912.log:9`.

| Artifact metric | A0 | Exact f97 | Reduction |
| --- | ---: | ---: | ---: |
| Files | 219 | 173 | 46 (21.0%) |
| Packed bytes | 564,419 | 441,672 | 122,747 (21.75%) |
| Unpacked file bytes | 2,653,339 | 1,733,356 | 919,983 (34.67%) |

The f97 artifact contains 104 plugin files, nine lib files, 15 `types/` files, both entry points, package.json, README, three license files and 38 documentation files. It contains no tests, scripts, `old/`, agent configuration or development trackers. A0 included tests, development notes and the newly written master plan, so this is publication-content hygiene, not a claim that executable code alone shrank by these percentages. Removing hooked-api also changes installed dependencies; these tarball numbers do not measure the complete dependency graph.

Current uncommitted migration-guide additions are intentionally **outside this exact f97 artifact**. A future published artifact containing those additions will have its own size and integrity; the numbers above must not be relabelled as that future artifact.

### C2-03 acceptance limit

This records the available final-vs-A0 comparison without inventing missing history. There is strong exact-snapshot SQL/package evidence, a useful real consumer before/after workload, and documented historical compiler tradeoffs. Missing evidence remains a same-runtime, same-contract A0-to-f97 controlled latency/peak-memory/whole-library initialization experiment. Closing the comparison item can acknowledge that limit; it must not imply those unperformed measurements passed or that v2 is universally faster.
