# Shared conformance tests

The shared conformance suites assert public behavior against explicit regular
Knex and AnyAPI fixtures. The [database runner](real-databases.md) now executes
every shared suite against actual SQLite, PostgreSQL and MySQL databases. The
ordinary npm test commands still use SQLite; coverage follows the executed
command and fixture, not the suite name.

## Capability map

A2-16 maps the current public surface to executed tests: all fourteen plugin and
file-storage exports in `index.js`, its errors/constants and URL helper, the
resource/API methods installed by those plugins, and the documented bulk and
positioning deep imports. The shared-file map below accounts for all 65 current
`conformance-*.test.js` files. Mapping coverage does not complete the separately
tracked lifecycle, storage-interface, transaction API, consumer or final-review
requirements. Known failures remain failures.

The current worktree includes B1's `RestApiWriteError` carrier and migrated
write assertions. Its [verified checkpoint](verification-progress.md#2026-09-10-write-error-outcomes-and-retry-guidance)
completes the specified B1 failure tests and retry guidance. The subsequent
[owned-savepoint checkpoint](verification-progress.md#2026-09-10-owned-savepoints-and-managed-transaction-contract)
completes B1 outcome population with 18 new nesting/cleanup cases. Managed
completion, the broader failure audit and consumer migration remain open.

Verification uses **Node 24 only** for the Node 24+ runtime contract. The latest
full gate and each native batch are recorded in the
[execution evidence](verification-progress.md). A file being discovered by the
runner is not evidence that a new version of it has executed. The latest full
SQLite gate covers the current shared files; native evidence comes from the
recorded full-driver milestone and subsequent focused batches. No single recent
run of the entire current native matrix is claimed.

In the tables, shared names abbreviate `tests/conformance-<name>.test.js`;
other names retain their test filename. SQL means actual SQLite/`better-sqlite3`,
PostgreSQL/`pg` and MySQL/`mysql2`. Both storage invocations run each shared file,
but explicitly regular or canonical fixtures keep their own selection.

| Public capability | Executed tests and scope | Remaining boundary |
| --- | --- | --- |
| `RestApiPlugin`: query/get/post/put/patch/delete | Shared formats, values, IDs, generated/model and lifecycle suites; real Express/Fastify resource routes | Selected hook contracts, remaining failure stages and consumer migration are A4/A7/Part M |
| Plain/JSON:API input and output; none/minimal/full returns | Shared formats, fieldsets, response-metadata, plain-collections, cyclic/empty includes; `return-record-settings.test.js` rejects removed options; real HTTP representation checks | Write outcomes are a separate B1 capability; these checks do not implement them |
| getRelated/getRelationship and three relationship writes | Shared related, relationship-writes/metadata/batching, target-validation and storage-specific link/pivot suites; actual relationship HTTP requests | Relationship/bulk traces and outer transaction completion remain A4/A7/B2 |
| `enrichAttributes`, `checkPermissions`, `applyQueryFilters` and extension hooks | Shared dependencies, serializers, authorization, include-adapters/failures and query-visibility; direct helper calls in `computed-fields.test.js`, `virtual-fields.test.js`, `projected-fields.test.js` | Complete retained external hook/proxy surface and its migration remain A4/A6 |
| `addRoute` and `release` | Resource/relationship/custom routes in real connector tests; `cors-transport.test.js` calls addRoute; successful release in `anyapi-basic.test.js`, `anyapi-custom-idproperty.test.js`, `put-create-parity.test.js` teardown | Release failure/order and host-owned server shutdown are not established by successful teardown; lifecycle work remains A4/A7 |
| `RestApiKnexPlugin` and `RestApiAnyapiKnexPlugin`: stored values, queries and relationships | All applicable shared SQL suites; explicit storage-boundary, tenant/resource, ID, temporal, structured-value, sorting and pagination assertions | Other drivers/versions are unverified; arbitrary Knex/proxy methods are not covered by core CRUD |
| Ordinary `createKnexTable`, `addKnexFields`, `alterKnexFields`, `introspectKnexTableSnapshot`, `generateKnexMigration` and `generateKnexMigrationDiff` | `db-schema-conformance.test.js`, `db-field-alterations.test.js` execute real ordinary DDL/migrations on SQL; `db-introspection.test.js`, `db-table-operations.test.js` add unit cases | These methods do not imply canonical DDL support; dialect-specific warnings/rebuild requirements are retained |
| Canonical `createKnexTable`/`addKnexFields`, registry and `api.anyapi.links` (attachMany/syncMany/removeMany/listMany/fetchManyToManyRows) | `anyapi-field-evolution.test.js`, `anyapi-temporal-migration.test.js`, registry/descriptor failure suites and shared metadata-cache; direct attach/list/remove/replace calls in canonical link and relationship suites on SQL | General canonical alterKnexFields rejects; ordinary introspection/migration methods are not supplied by this plugin; broader configuration contract is A5/A6 |
| `AutoFilterPlugin` and `RowPolicyPlugin`, including getConfig/getScopeConfig inspection | `autofilter.test.js`, `row-policy.test.js` inspect configurations; shared authorization/search/related/include/bulk/socket suites execute SQL predicates and denials | Deferred side effects and outer transaction outcomes remain A7/B2 |
| `QueryProjectionsPlugin` | `projected-fields.test.js`, shared queries, serializers, structured-queries, include-adapters, linkage-projections and sort-fields on SQL | Whole structured values cannot be generic filter/sort/cursor keys; declared scalar JSON-key projections have separate tests |
| `LabelPlugin` | Shared labels covers authored/stored/computed labels, hidden sources, aliases, null/falsy values, custom IDs and disabled labels on SQL; schema-enrichment/dependencies cover recompilation | Selected extension failure/context contracts remain A4/A7 |
| `ExpressPlugin` (4/5) and `FastifyPlugin` (5) | `http-connectors-parity.test.js`, `fastify-plugin.test.js`, parser/multipart/CORS/Socket.IO tests and shared suites making real HTTP requests; Express 4 has its own alias selection | Other framework majors unverified; SQLite-only transport cases are not native SQL evidence |
| `FileHandlingPlugin` and `LocalStorage` | Real Busboy/Formidable uploads, aborts, disk cleanup and path containment in multipart/file/local-storage tests; shared file-failures adds SQL transaction/HTTP errors, non-atomic bulk file cleanup and indexed retained tracking | Borrowed/atomic-bulk completion and previous-file replacement/deletion remain A7/B2 |
| `S3Storage` | Three cases in `s3-storage.test.js`: required bucket, mock save/delete URLs and explicit rejection of real mode; executed by both full gates | Real S3 operations are not implemented; mocks provide no S3 service coverage |
| `CorsPlugin` | `cors.test.js`, `cors-transport.test.js`: real preflights, async origins, Vary/cache headers and error boundaries | Raw host responses and failures before connector entry remain host responsibilities |
| `SocketIOPlugin` | `socketio.test.js`, `socketio-contract.test.js`, shared socketio-authorization on SQL, including non-atomic bulk commits and rejected entries; real Redis lifecycle/notification suites run separately | Redis uses SQLite application storage; SQL and Redis jobs do not establish their combined cross-product. Cluster/Sentinel, durable delivery and open-network hangs are unverified; outer transaction timing remains A7/B2 |
| `BulkOperationsPlugin` (documented deep import): bulkPost/bulkPatch/bulkDelete | `bulk-operations.test.js`, shared bulk-authorization/configuration/failures and transaction isolation on SQL; caller-owned commit/rollback, pending records/linkage, invalid non-atomic participation, real bulk HTTP routes, indexed child cleanup and non-atomic file/notification behavior | Managed transaction completion, outcomes and successful atomic-batch notifications remain A7/B1/B2 |
| `PositioningPlugin` (documented deep import) | Four `positioning*.test.js` files passed SQLite gates. Initial native ordinary PostgreSQL/MySQL runs each pass 55/60 | Five concurrent insert/move cases fail with duplicate keys; native canonical runs not executed. Paused by maintainer, without a production fix |
| Seven `RestApi*Error` classes, three error-code constants and `getUrlPrefix` | Shared fieldset/temporal/include/resource/payload validation and rejection suites; `error-context.test.js`, `write-error-handling.test.js`, real HTTP error mappings; immutable write-outcome snapshots and original causes; pagination/empty-include link generation and real refresh requests | B1 consumer migration, A7 extension/network boundaries, B2 managed completion, final package exports and clean-install consumers remain open |

### Explicit backend and integration limits

The [database guide](real-databases.md) records tested versions and collations.
SQLite's concurrent-writer busy/snapshot rejection is asserted explicitly.
Canonical opaque IDs sort lexically; ordinary numeric IDs sort numerically.
Default native MySQL IDs use binary comparison; dedicated ordinary collation
cases and canonical attachment cases configure different column collations.
None establishes arbitrary-collation coverage. Temporal precision, schema
warnings, unsupported serializer combinations and per-parent include capability
requirements have their own assertions below; shared assertions are not relaxed
to conceal these differences.

MariaDB, MSSQL, Oracle, other Knex clients, other server versions and Windows are
**unverified**, even where helper code has dialect branches. Real S3 is
**unimplemented**. Native positioning concurrency is a **known failure**, and
its canonical native run is **not run because work is paused**. These are
separate states, not interchangeable descriptions of a passing capability.

The current commands are `npm run verify` (types, query budgets, SQLite, Express
4, lint and docs), `npm run test:databases` (SQL) and `npm run test:redis` (Redis).
`tests/database-runner.test.js` verifies failures/interruption and teardown.
The [final reconciliation batch](verification-progress.md#2026-09-10-capability-evidence-reconciliation)
refreshes labels and SQL-backed Socket.IO authorization on all six SQL/storage
combinations (684/684) and real Redis in both storage modes (68/68), with no skips
or failures. That batch changed documentation only. The subsequent
[borrowed bulk correction](verification-progress.md#2026-09-10-borrowed-bulk-transactions)
adds 24 ownership cases per mode and passes the full Node 24 gate plus 1,024
selected SQL cases; it leaves managed outer completion and consumer work open.
The subsequent [non-atomic bulk verification](verification-progress.md#2026-09-10-non-atomic-bulk-cleanup-and-delivery)
adds indexed cleanup/tracking, stored file-handle decoding and actual per-entry
notification checks. The final source passes the full Node 24 gate, 1,680 selected
SQL cases and 92 real Redis cases. The first PostgreSQL failure and its decoding
correction remain in the evidence; successful SQL/Redis jobs retain their separate
integration scope.
The [driver completion correction](verification-progress.md#2026-09-10-driver-completion-evidence-and-outcome-vocabulary)
adds 44 shared resource/relationship/bulk cases and twelve canonical registry
cases for control-query rejection and simulated lost completion acknowledgements.
Its final Node 24 gate, 2,278 selected native cases and 92 Redis cases pass.
The [write-outcome checkpoint](verification-progress.md#2026-09-10-write-error-outcomes-and-retry-guidance)
adds the public carrier, immutable outcome/cause assertions, HTTP metadata and
per-entry bulk outcomes. Both full SQLite suites, 6,226 selected SQL cases and
92 Redis cases pass. The initial canonical full run found one remaining old
identity assertion; its correction and successful rerun are recorded explicitly.
Consumer verification is paused. Full current native/package/consumer runs and
three final reviews remain required by their own checklist items.

### Earlier capability-audit milestones

The paragraphs below preserve the evidence and decisions that led to this map.
Their counts describe those earlier source revisions.

The label/include audit reproduced `REST_API_FIELDSET_INVALID` for a declared
relationship alias. The completed fieldset regression file then failed all
64 cases against the pre-fix runtime (`/tmp/library-node24-fieldsets-before.log`).
It covers relationship names, omitted relationships, empty fieldsets, unselected
computed functions, custom IDs/mappings, reverse/polymorphic/many-to-many
relationships, nested included types and full write responses in both formats.
GET/query finish-hook additions cannot override the requested fieldset. Existing
permission tests now select their relationship explicitly, retaining the same
visibility assertions. Eighteen HTTP cases per storage mode exercise empty and
relationship fieldsets through Express 5 and Fastify 5; nine also run on Express 4.

The write-response review adds 36 fieldset cases, bringing that suite to 100.
Final write normalization reapplies requested fields after finish hooks. The
prepared minimal/full response is copied before commit, so after-commit mutations
cannot reintroduce fields or native/invalid dates. The temporal suite adds 36
cases for these boundaries. Generated-ID lifecycle traces and 20 reused-context
cases establish hook-visible ID timing. Current full and native results are in
the [execution evidence](verification-progress.md).

The write-failure review adds 48 shared resource/relationship cases per
combination for owned/borrowed transactions, rollback and rollback-hook failures,
stored-state recovery and diagnostic clearing on context reuse. Combined with
the lifecycle, transaction-context and relationship-write suites, Node 24 passes
2,844 native checks. Eighteen helper regressions separately cover original
rejection identity and synchronous/asynchronous logging failures. Bulk cleanup,
other extension boundaries and transaction outcome metadata remain open.

Selection uses the existing relationship resolver, moved to the shared
relationship-contract module, and a single fieldset parser in `field-utils`.
SQL still fetches internal IDs, relationship keys, sort values and declared
computed dependencies when needed; the response boundary removes unrequested
attributes and relationships after read hooks. JSON:API includes retain requested
resource objects even if sparse fields omit their linkage. Plain output follows
selected relationship properties. The [migration guide](../GUIDE/MIGRATING_API_V2.md#sparse-fieldsets-include-relationships)
shows the required request updates. The current capability map above reconciles
this milestone with the later suites and remaining checklist requirements.

The earlier Redis/fieldset full gates passed on Node 22.16.0 and 24.6.0: 2129/2130 regular SQLite
(one existing skip), 2126/2126 canonical SQLite, 337/337 Express 4 per mode,
lint and docs. Node 22's five-suite fieldset/label/authorization/related/query
matrix passes 1,728 checks across all SQL/storage combinations; Node 24's
fieldset-only native matrix passes 384. The subsequent Redis lifecycle batch
passes the full gates again, 68 Redis cases and eight runner-failure cases per
runtime, plus 360 native Socket.IO authorization checks on Node 22. Exact logs
and scope limits are in
the [evidence record](verification-progress.md).

## Expanded database coverage

The matrix currently discovers all 65 `conformance-*.test.js` files and adds
the query-budget script and seven environment/schema/migration/failure files. Both storage modes execute on each
selected driver, including the formerly SQLite-only bulk-authorization,
relationship-write and Socket.IO-authorization fixtures. A fixture cannot
silently select a different driver. At the 24-file CI milestone, Node 22 and
Node 24 each passed **6,849 checks**,
with no failures, cancellations or skips. Exact runtime results and CI validation
are in the [evidence log](verification-progress.md).

| Shared files | Executed assertion scope |
| --- | --- |
| `conformance-formats`, `conformance-values` | CRUD, explicit response options, defaults, absent/null/falsy values and write invariants |
| `conformance-ids`, `conformance-bigint-ids` | Custom/generated/mapped/opaque IDs, exact SQL bigint identity, driver allocation and cross-resource linkage |
| `conformance-generated`, `conformance-model` | Seeded values/relationships, shrinking and independent write/query/pagination operation sequences |
| `conformance-temporal`, `conformance-serializers`, `conformance-structured-values` | Temporal precision/ranges, driver representations, custom scalar/object/array conversions, callbacks and storage errors |
| `conformance-field-names`, `conformance-field-namespace` | Field-name/configuration validation and collisions between authored fields, logical IDs, aliases and query namespaces |
| `conformance-field-dependencies`, `conformance-schema-enrichment` | Compiled callback dependencies, order/cycles, enriched/late declarations, recompilation and request/HTTP contract agreement |
| `conformance-fieldsets`, `conformance-response-metadata` | Attribute/relationship sparse selection and public response metadata after hooks, including writes and internal dependencies |
| `conformance-plain-collections`, `conformance-cyclic-includes`, `conformance-empty-includes` | Plain collection conversion, unique cyclic resource graphs, empty/null data and include/self-link round trips |
| `conformance-queries`, `conformance-structured-queries` | Filters/counts/projections, scalar JSON keys, whole-document query rejection and PostgreSQL distinct-parent selections |
| `conformance-hidden-sorts`, `conformance-sort-fields`, `conformance-reference-sorting` | Visibility, logical-field/alias precedence, typed cursors, stable null/tie ordering and authorized reference sorts |
| `conformance-pagination`, `conformance-sort-indexes` | Default/capped sizes, offset/cursor traversal, page/cursor errors, SQLite native NULLS ordering and indexed result equivalence |
| `conformance-authorization`, `conformance-query-visibility`, `conformance-search-authorization` | Primary SQL visibility, replaced filter builders, join/search authorization, collations and context isolation |
| `conformance-related`, `conformance-related-permissions` | Related reads, filters/pages/links, relationship identity, permissions and real HTTP access boundaries |
| `conformance-include-permissions`, `conformance-include-limits` | All relationship kinds, nested/limited includes, target and pivot authorization, standard/window strategies and HTTP results |
| `conformance-include-adapters`, `conformance-include-batches`, `conformance-include-allocation` | Cold/late adapters, bounded parent/edge reads, limited maps, callbacks, permissions and include assembly |
| `conformance-sparse-hydration`, `conformance-visibility-batches` | Avoiding omitted relationship hydration and batching visible linkage without skipping filters or permissions |
| `conformance-linkage-projections`, `conformance-relationship-metadata` | Required reverse/aliased keys, target type/ID metadata, malformed declarations and stored-data rejection |
| `conformance-relationship-writes`, `conformance-relationship-batching`, `conformance-target-validation` | Add/remove/replace semantics, bounded minimal target checks, custom IDs, hooks, permission rejection and rollback |
| `conformance-collection-id-lists`, `conformance-reverse-membership` | Complete large predicates, repeated input IDs, reverse membership reads/writes and database-equality cases |
| `conformance-pivot-batches`, `conformance-pivot-reads` | Ordinary pivot target batches and bounded physical pages, duplicates, native identity/locks and transaction ownership |
| `conformance-link-prefetch` | Canonical forward/inverse/unpaired link pages, SQL visibility, missing/duplicate edges, 205-parent batches and failures |
| `conformance-canonical-link-deletes`, `conformance-canonical-link-attachments` | Canonical edge deletion/replacement and attachment paging, retained payloads/inverse markers, duplicate rows, locks and rollback; attachment adds explicit MySQL collation cases |
| `conformance-bulk-authorization`, `conformance-bulk-configuration`, `conformance-bulk-failures` | Atomic/non-atomic policy, batch option validation, child/validation/commit failures, rejected rollback, indexed secondary diagnostics, post-commit rejection, context reuse and caller-owned bulk transactions with separate-connection visibility |
| `conformance-lifecycle`, `conformance-transaction-context`, `conformance-transactions` | Resource hook order/counts/awaiting, borrowed contexts, actual concurrent connections, commit/rollback and relationship races |
| `conformance-write-failures`, `conformance-post-write-read-failures` | Original write/refresh errors, driver completion promises, PostgreSQL COMMIT reporting ROLLBACK, rollback/cleanup failures, stored-state recovery and response preparation |
| `conformance-field-callback-failures`, `conformance-include-failures`, `conformance-query-failures` | Getter/setter/projection/copy rejection, every include kind, nested paths, logging failures and owned/borrowed failure behavior |
| `conformance-storage-boundaries`, `conformance-metadata-cache` | Direct mappings/bindings/serializer boundaries, tenant/resource constraints, borrowed transactions, descriptor retention and invalidation |
| `conformance-labels` | Authored and generated labels, aliases, visibility, fallback values, custom IDs and plugin disabling |
| `conformance-file-failures` | Filesystem cleanup diagnostics, transaction isolation, non-Error extension failures, real HTTP classification and non-atomic bulk tracking/diagnostics across success, rollback, post-commit failure and context reuse; public UTF-8 file handles and invalid byte rejection |
| `conformance-socketio-authorization` | Actual polling/WebSocket notifications, trusted contexts, SQL-backed subscription filters and non-atomic bulk delivery with middle-entry rejection and cleanup-hook failures |

Authorization/include/search/sort/limit files also send real Express and Fastify
requests on those databases. The standard gate separately tests Express 4,
multipart parsers, CORS and additional Socket.IO contracts on SQLite; those files
are not automatically promoted to native-database coverage.

Regular-table schema/collation cases and canonical-only migration cases retain
their explicit storage selection, even when repeated by the other invocation.
The [database guide](real-databases.md) records these boundaries, driver versions,
case-sensitive/default collations and intentionally unverified combinations.
The sections below also retain earlier milestone results; the expanded matrix
supersedes their earlier statements that shared cases awaited native execution.
The map records current coverage; optional integrations, consumer migrations and
final reviews retain the explicit limits and open work listed above.

## Fixture contract

`tests/fixtures/conformance.js` exports `createConformanceFixture({ storage,
knexConfig, databaseOptions, apiOptions })`. `storage` is explicitly `knex` or `anyapi` and defaults
to the selected test mode. The created API is checked against that selection.
Unknown storage names fail. The fixture exposes:

| Member | Responsibility |
| --- | --- |
| `api` | Public resource methods for `items` and `groups` |
| `knex` | The fixture's owned connection, available for storage inspection |
| `databaseName` | The fixture's isolated real database name, or SQLite filename (`:memory:` by default) |
| `storage`, `idOrder` | Actual backend and its ID ordering contract |
| `reset()` | Clean mapped tables/tenant records and reset fixture ID allocation |
| `seed(type, attributes, relationships)` | Insert through the public API with deterministic client-provided IDs |
| `count(type)` | Inspect persisted counts through the existing database helpers |
| `close()` | Destroy the connection, drop its disposable real database, and clear its cleanup registry |

Resource definitions stay in `tests/fixtures/api-configs.js`. The interface reuses
the existing backend setup, table mapping, cleanup and count helpers. Setup
failure destroys the owned connection and drops its disposable database. Without
an explicit `knexConfig`, the fixture selects SQLite by default or the driver
provided by the [real-database runner](real-databases.md). During a selected
database run, a mismatched explicit driver is rejected. Each suite creates its API once; tests and
generated/shrunk cases clean its data before use. IDs start at `1` for each resource
in each case, so replay does not depend on database sequences from earlier cases.
Separate fixed tests still exercise server-assigned IDs.

`databaseOptions: { concurrent: true }` gives SQLite a disposable file in WAL
mode and a four-connection pool. Every connection enables foreign keys and uses
an immediate busy error: a synchronous driver lock wait must not block the Node
event loop that needs to release the competing transaction. Closing the fixture
destroys its pool and removes its private directory. PostgreSQL/MySQL fixtures
already use independent pooled connections.

Regular fixture IDs use an integer primary key, while AnyAPI's `logical_id`
column is text and also supports opaque IDs. These have different established ID
orders: `1,2,...,10` versus `1,10,2,...`. A fixed digit-boundary test specifies both
orders. Generated expectations use that explicit storage contract for ID ties;
all other value, relationship, membership and pagination assertions are shared.
No numeric cast was added to AnyAPI's opaque ID domain. Further adapter/driver
contract work remains in A3/A6.

## Executed real-driver ID, query and temporal coverage

The earlier A3-03 [database matrix](real-databases.md) ran the environment,
`conformance-ids`, `conformance-queries`, `conformance-include-limits` and
`conformance-temporal` suites, plus ordinary table-helper execution in
`db-schema-conformance`,
on SQLite, PostgreSQL and MySQL with both storage modes. All fixtures in these
selected suites use the actual requested database. The completed A3-03 matrix
passed 345 regular / 344 AnyAPI checks on SQLite and 345 per mode on
PostgreSQL/MySQL: 2,069 passing checks, no skips. The schema suite adds ordinary
table checks; it does not use canonical storage during the AnyAPI invocation.
Exact versions, subsequent matrix results, logs and remaining scope are in
[verification evidence](verification-progress.md).

| A3-04 contract | Executed assertions |
| --- | --- |
| Custom/opaque IDs and mapped keys | Integer/string IDs, zero, large numeric strings, Unicode/punctuation, custom ID/attribute/pivot columns, CRUD and relationship round trips |
| Generated IDs and insert results | Six generated-key cases across both formats and all write returns; unique persisted IDs, GET/query agreement and parent/child membership; actual PostgreSQL RETURNING and MySQL insert-result behavior |
| Qualified joins, aliases and bindings | Mapped relationship filters, many-to-many membership, bound projection expressions, DISTINCT search joins and projection ordering |
| Count and pagination SQL | Offset totals, cursor traversal in both directions, nullable/tied sort keys, sparse projections, generated-link round trips and per-parent/global include limits |

Explicit seed IDs and generated-ID cases are separate: inserting an explicit
PostgreSQL ID does not advance its sequence. LIKE matching follows the fixture's
SQL collation rather than promising identical case behavior for every database.
The fixture uses MySQL `utf8mb4_bin`, PostgreSQL's `C` locale and SQLite's default
LIKE behavior. Expected type names and authored concatenation SQL likewise state
each driver's actual contract. The temporal section below describes the completed
A3-03 cases and deliberate native storage limits. Schema/migration, concurrency
and capability coverage were still open at that milestone; later evidence and
the current capability map above supersede that status.

`db-schema-conformance` currently has 33 SQLite, 36 PostgreSQL and 37 MySQL
cases per invocation. It exercises direct/generated creation, executable
BigInt defaults, empty/quoted/padded/null defaults, numeric default comparison,
mapped columns and types, function defaults excluded from DDL, inline enums,
checks, additive and precision migrations with existing rows, foreign-key
replacement and an empty second diff. The PostgreSQL-only partial-index case
asserts explicit rejection of a shape the snapshot cannot represent. Native
precision cases are absent on SQLite because its storage does not enforce that
precision. Eight cases use the actual public resource wrappers with custom IDs,
explicit mappings, both naming settings, direct/generated creation, non-stored
fields, static/function defaults, and field additions/default alterations.
Five composite-dependency cases execute index replacement, foreign-key action
changes, their combination, removal of uniqueness, and explicit column drops.
They check preserved rows, rejected cross-pair references, cascading updates or
deletes, and an empty second diff. MySQL restores foreign keys after replacing
their supporting indexes. Five further cases exercise escaped enum values and
text/JSON/array defaults in direct/generated DDL, with empty second diffs, and
the standalone generator's explicit-dialect requirement. Canonical existing-data
and field-evolution coverage is described below.
Two MySQL-only cases execute native SET creation/introspection/alteration,
including escaped values and preserved existing rows.

`db-field-alterations` adds 14 SQLite, 18 PostgreSQL and 12 MySQL cases. These
execute public field additions/alterations and deep-helper transaction calls:
enum defaults/replacements/removal, rejection of SQLite rebuild requirements,
static defaults, failed batches with unchanged definitions/data, owner rollback,
savepoint recovery, opaque primary keys, physical names with spaces, native
temporal precision, PostgreSQL qualified tables/partial indexes/case-sensitive
checks, and SQLite parent/child preservation. The suite always uses regular
tables, including when repeated in the AnyAPI invocation. MySQL borrowed DDL
transactions and SQLite borrowed rebuilds with foreign-key enforcement enabled
are explicitly rejected before side effects. Application-transaction and
isolation coverage is recorded in the concurrent-transaction section below.

Additional review cases execute native enum changes, verify rejection preserves
the existing values/constraints, change only enum defaults, and preserve a
structured object default. SQLite's unsupported enum-value alteration produces
an explicit table-rebuild warning and leaves the original column intact; the
test does not treat that warning as an executed enum migration.

## Independent write and response invariants

These expectations define A2-11 independently of the production implementation.
A shared backend result is not its own oracle: expected values come from the
submitted input, explicit fixture relationships, a JavaScript state model, or
fixed public error/value contracts. Database inspection checks persisted state;
it does not compute an expected response using the production normalizer.

| Invariant | Independent expectation and executed assertions |
| --- | --- |
| Successful writes | POST creates exactly one record with the selected public ID. PATCH changes only supplied values; PUT follows the documented replacement/omission rules. DELETE removes the addressed record. Other rows remain unchanged. `conformance-model`, `conformance-values`, `conformance-formats`, and `conformance-ids` compare submitted values, model state and persisted counts, including none/minimal/full responses. |
| Rejected writes | Invalid input, hidden targets, denied permission and failures before owned commit leave the previous committed records and relationships unchanged. A failure with a borrowed transaction leaves completion to its owner; inspect after the owner's rollback. `conformance-model`, `conformance-temporal`, `conformance-bulk-authorization`, and `conformance-transaction-context` check those states without treating any caught exception as success. |
| Bulk writes | An owned atomic batch rolls back earlier changes when a later entry fails before commit. Caller-owned batches leave changes pending for the owner. Non-atomic calls identify rejected indexes and preserve committed entries; after-commit rejection can report a failed call whose data is stored. Bulk operation/authorization/failure suites check explicit rows, membership, counts and secondary diagnostics. File and Socket.IO suites check non-atomic cleanup and event delivery. Managed outer completion remains unfinished work. |
| Relationship integrity | Membership matches the declared target type and submitted identifier set. Append/removal preserve unrelated memberships and child records; replacement handles the full set despite public query caps. Failed multi-child changes roll back earlier changes. `conformance-relationship-writes`, `relationship-endpoints`, the generated relationship model, and `row-policy` compare explicit assignments and stored links. |
| Typed rejection | Invalid payload/ID consistency, missing/hidden resources, bad fieldsets/includes and unrepresentable temporal values retain their specified error codes/subtypes and structured details. `conformance-ids`, `conformance-queries`, `conformance-temporal`, and real connector suites assert fixed contracts. Transport status and JSON:API error fields are checked separately from programmatic error fields; a generic resource error currently has no wire `code`. |
| Final response values | Public IDs are strings; both formats expose the same permitted values and relationships. Native dates/epochs returned by getters, computed fields or finish hooks are normalized to explicit expected public values after the last mutation point. Invalid non-null temporal values reject, including before an owned write commits. `conformance-temporal`, `temporal-boundaries`, `conformance-generated`, and `conformance-authorization` use fixed timestamps, submitted scalar values and explicit visible identifiers. |

The action-permission and visibility contracts are distinct. Target to-one
related reads must execute the target GET permission lifecycle independently
of field/include selection, as asserted by `conformance-related-permissions`.
GET-only data hooks do not define collection/include visibility; SQL row
policies and autofilters are the corresponding shared selection mechanisms.
The include, notification and search/reference checks below extend that audit.
The authorization reconciliation below closes A2-10. The current capability map
above includes the subsequent independent verification of the other public surfaces.

These invariants do not turn an acknowledged commit into a rollback when a
later hook fails. Failed commit/rollback outcomes, borrowed bulk and outer-event
ownership, real-driver concurrency and optional optimistic locking remain
A3/A7/B1/B2/B3 requirements. This section closes the definition/evidence item,
not those unfinished capabilities or the final review.

## Generated checks

`fast-check` 4.9.0 is a development dependency and runs inside `node:test`.

| Property | Default seed | Cases | Independent expectation |
| --- | ---: | ---: | --- |
| Strict/simplified field round trips | 20260908 | 40 | Submitted strings, nulls, booleans and numbers |
| Complete pagination | 20260909 | 40 | JavaScript ordering of submitted rows, explicit ID domain, unique membership and bounded termination |
| Relationship shapes | 20260910 | 40 | Generated item-to-group assignments, empty groups, repeated references and finite include cycles |
| Operation model | 20260911 | 80 | A Map of records and group assignments updated by successful commands only |

The model generates create, PATCH, relate/unrelate, filtered query, rejected write
and delete commands, up to 25 per sequence. Every command is followed by a complete
state/count/linkage assertion. The default run verifies that all command kinds
were exercised. The model does not call production normalization or query code
to compute expectations. Pagination uses the production cursor builder only to
construct the initial backward request, and the connector's actual query parser
to consume generated links; expected ordering and membership are independent.

There are 200 generated cases per default backend run, alongside fixed examples.
The existing full test commands include these files automatically. Focused commands:

```sh
npm run test:conformance
npm run test:conformance:knex
npm run test:conformance:anyapi
```

`FC_SEED`, `FC_RUNS` and `FC_PATH` override the generated run. A model replay also
accepts `FC_REPLAY_PATH`, printed in the failing command sequence. Select the
failing test when replaying a path; unrelated properties have different arbitrary
structures. Keep the package lock used for the failure.

```sh
JSON_REST_API_STORAGE=anyapi FC_SEED=20260908 FC_PATH=0:0:0:0:0:0 FC_RUNS=1 \
  node --test --test-name-pattern='round-trips generated field values' tests/conformance-generated.test.js
```

Failures include the seed, shrink path, minimal counterexample and original error
in the test output. `includeErrorInReport` is enabled because Node 22's reporter
did not display fast-check's nested cause. Model replay follows the documented
[fast-check command replay contract](https://fast-check.dev/docs/advanced/model-based-testing/#replay-model-based-tests).

## Confirmed explicit-ID regression

With a numeric schema ID, validation can turn document ID `"1"` into number `1`.
AnyAPI previously bound that number directly into its text `logical_id` column.
The tested SQLite driver stored `"1.0"`; a subsequent public GET for `"1"` could
not find it. A full-return POST rolled back on its nested GET, while a no-return
POST could commit a record inaccessible under the requested public ID.

AnyAPI's existing `normalizeId` now runs before binding an explicit POST ID.
No new normalization helper was introduced. A permanent fixed test covers numeric
and numeric-string IDs with no/minimal/full returns and reads each record by its
public ID. The generated value test independently exposed the same defect once
fixture IDs became deterministic.

The fixed explicit-ID test and the replay command above were each run with the
old line restored temporarily: both exited 1 with `Resource not found`. After
restoring the fix, the same commands exited 0. The worktree was restored in
`finally`; the failing variant is not retained. The generated failure shrank to
one record with `{ name: 'a', note: null, rank: null, active: false, score: 0 }`.

## Executed coverage and remaining work

The roadmap items are broader than a file name or a successful run. This map
records the relevant assertions and identifies remaining coverage work.

| Area | Shared evidence | Remaining scope |
| --- | --- | --- |
| Basic operations and PUT semantics | `conformance-values`, `conformance-formats`, `conformance-relationship-writes` run on all three databases; `relationship-endpoints` supplies additional SQLite cases; endpoint map below | Selected lifecycle/outcome contract and consumer migration |
| Formats and write returns | `conformance-formats`: 60 cases per backend on all three databases for plain/JSON:API reads, writes, plugin/resource defaults and overrides; `return-record-settings` boundaries; real connector matrix below | Remaining B0 consumer migration |
| IDs and storage mappings | `conformance-ids` runs mapped integer/string keys in both modes on all three databases; `id-normalization`, `custom-idproperty-relationships`, actual HTTP ID links and integer migration execution | Broader compiled metadata and mapping contracts remain A5/A6 |
| Field boundaries | `conformance-values`: absent/undefined/null/false/zero/empty string, defaults, virtual/hidden/normally-hidden fields | Broader application-specific transformations remain in their own suites |
| Temporal and transformed values | `conformance-temporal`: 101 regular / 102–103 AnyAPI cases on actual SQLite/PostgreSQL/MySQL; temporal boundaries/transforms; executable canonical existing-data migration and regular schema/default/precision coverage | Broader schema metadata and validation remain A5 |
| Relationship/include shapes | Native shared related/include/relationship-write/generated suites cover fan-out, cycles and permissions; `include-traversal`, `includes`, `relationships`, `polymorphic-relationships` add SQLite regressions | Complete capability/interaction map and remaining lifecycle contracts |
| Queries and pagination | Native generated traversals and shared query/related/include-limit/reference-sort cases; `pagination-boundaries`, `pagination-cursor-multifield`, `query-limits` add SQLite regressions | Supported query-builder extension surface and measured query/performance budgets |
| Authorization and atomic failures | Native shared authorization, related/include/search/reference-sort/bulk/transaction/Socket.IO suites; `row-policy`, `autofilter`, `bulk-operations` add SQLite regressions | Transaction outcomes, bulk borrowing and deferred notifications under the selected lifecycle contract |
| Model and replay | `conformance-model`, `conformance-generated`, permanent explicit-ID case | Further confirmed regressions become additional fixed examples |

Some files in the legacy full suites instantiate regular Knex directly even
when the process selects AnyAPI: `custom-id-simplified-post`,
`logical-id-write-validation`, `nested-includes`,
`projected-fields`, `query-limits`, `storage-mapping` and `virtual-fields`.
`db-table-operations` contains direct regular-storage setup; the simulated MySQL
returning-fallback test is also regular storage. Their execution under the AnyAPI
command does not prove AnyAPI coverage. `anyapi-basic` explicitly uses AnyAPI in
both commands. The existing introspection and custom-ID suites also have
mode-specific skips. These distinctions remain open in the complete A2/A3 map.

Inspection also found stale examples using `default` where the authored schema
expects `defaultTo`, or `max` for string length where it expects `maxLength`.
Parts of the PUT guide still describe silent clearing even though an updated
section correctly documents rejection of omitted existing stored values.
The conformance fixture uses the authored options and tests that rejection before
an explicit replacement. The broader documentation corrections remain under A10.

## Related collection regressions

`conformance-related.test.js` adds 20 shared cases on each backend, using the
existing conformance fixture with explicitly configured searchability and a
mapped foreign-key column. It covers both response formats, fields/includes,
offset counts and link traversal, forward/backward cursors, independent public
filters, empty/missing parents, borrowed-transaction membership, public URL
prefixes, and a separate query started by a finish hook. The latter must see its
own collection rather than inherit the outer relationship constraint.

`include-traversal` additionally checks reverse polymorphic related reads with
non-searchable type/ID fields and nested includes. `row-policy` checks related
limits/counts with denied rows, a different visible parent, and another workspace
present. `relationship-endpoints` follows generated pagination links through
real Express request handling and excludes an unrelated book.

Before correction, the initial 23-case related/include run had **10 failing
tests**, including non-searchable relationships, parent-filter replacement and
pagination URLs. The fix uses a small internal constraint carrying logical field
values to the existing storage adapters; it is not a public filter or alternate
query parser. Both backends apply it before limiting/counting, and each nested
query resets it unless explicitly supplied for that query. Pagination URLs keep
the parent route without serializing the internal constraint.

The final focused run passed **62 regular / 63 AnyAPI tests**, zero failures or
skips. These counts include the policy and existing endpoint suites. Full-suite
and consumer results are in [verification progress](verification-progress.md).

The adjacent audit reproduced hasMany POST/DELETE failures caused by raw
foreign-key writes and hasMany PATCH returning success without changing
membership. The next batch, below, corrects these paths and adds mutation
regressions; the earlier related-read run did not cover them.

## Resource and relationship endpoint map

The shared public-operation coverage for A2-03 is distributed across these
parameterized fixtures. Each command runs the same assertions under regular
Knex and AnyAPI; real-driver and connector matrices remain separate A3 work.

| Operation | Assertions |
| --- | --- |
| Resource GET/query | `conformance-values` and `conformance-formats`: stored values, collection membership, missing/deleted records, fields and includes |
| Resource POST/PATCH | `conformance-formats`, `conformance-values`, generated state model: persistence, partial updates, validation and unchanged state on rejection |
| Resource PUT-create/replace | `conformance-formats`, `conformance-values`: explicit identity, single persisted row, full replacement, omitted stored-value rejection; `conformance-relationship-writes`: reverse relationships on creation/replacement and omitted relationship objects |
| Resource DELETE | `conformance-values`, `conformance-formats`, generated state model: persisted count becomes zero and subsequent GET rejects |
| Relationship GET linkage/related | `conformance-relationship-writes`: belongsTo, hasOne, hasMany, polymorphic belongsTo and reverse hasMany; `relationship-endpoints`: many-to-many, inverse membership, empty results; `conformance-related`: hasMany queries |
| Relationship POST | Reverse-write and endpoint suites: append, repeated identifiers/calls, unchanged existing membership, wrong target types, actual persisted linkage |
| Relationship PATCH | Reverse-write suite: to-one replacement/null, complete to-many replacement/clear beyond query caps; endpoint suite: many-to-many replacement/clear through actual Express |
| Relationship DELETE | Reverse-write and endpoint suites: remove selected membership, repeated/missing members, unrelated/other-parent members unchanged, child resources retained |
| Invalid relationship calls | Endpoint/reverse-write suites: unknown relationships, malformed identifiers, wrong target types and cardinality, POST rejection on to-one relationships |

`conformance-relationship-writes` adds 42 cases: 21 assertions for each child ID
property (`id` and `key`). It uses a mapped child foreign key, a unique hasOne
constraint, polymorphic type/ID pairs, and four initial members despite a public
default limit of two and maximum of three. Replacement must handle the complete
membership. Required foreign keys reject unlinking; removable ones explicitly
declare `nullable: true`.

The same suite checks actual child PATCH hook calls, caller context, rollback
after an earlier child mutation, and borrowed transactions that remain open for
their owner on both success and failure. `row-policy` additionally checks hidden
children during replacement/removal, generic public rejection without exposing
an unrequested hidden ID, rollback of earlier visible changes, and many-to-many
replacement with the caller's workspace/visibility context intact.

The endpoint fixture maps both many-to-many pivot columns. This exposed raw
logical names in regular-storage linkage, include and delete queries; those
paths now reuse the existing column mapping. Duplicate and repeated additions
are checked against persisted pivot counts. Aliased many-to-many relationships
also verify the declared target type in linkage, related reads and includes.
Sparse polymorphic linkage reads use both declared discriminator fields.

An older custom-ID fixture declared its polymorphic relationship inside
`schema`, so it had only tested two ordinary attributes. It now declares the
relationship under `relationships` and asserts actual forward/reverse linkage
and related reads. Early rejection of malformed declarations remains A5 work.

This operation map does not establish complete format/connector parity, all
opaque-ID/serializer combinations, real-database concurrent writes, final
transaction/hook outcomes, or many-to-many pagination/query budgets. Those
remain separately tracked under A2/A3/A4/A7/A8 and Part B. Full command results
and their backend limitations are recorded in
[verification progress](verification-progress.md).

## Real connector defaults and validation

`http-connectors-parity` runs Express 5.1.0 and Fastify 5.12.3 under all three
programmatic return defaults, with both actual storage backends selected and
asserted. There are 144 integration cases per backend, plus three real Fastify
schema/registration tests and six query-parser tests. Express 4.22.2 runs the
same 72 Express cases separately for each backend using a test-only import
preload; the production connector itself resolves Express 4 in that job.

The matrix compares HTTP and programmatic request validation, accepted scalar
coercion/nulls, JSON:API/full HTTP defaults under plain programmatic defaults,
resource overrides, PUT-create/replacement, all CRUD and relationship routes,
includes, pagination links, sparse fields, filtering, trusted public URLs, and
request/response headers. Rejected writes are checked against persisted state.

Additional regressions cover exact media types and JSON:API parameters, Accept
quality/wildcards/alternatives, body limits, scalar/null/array documents,
malformed JSON, bodyless DELETE, fractional pagination, retired query controls,
literal question marks in query values,
prototype-like fieldsets, unknown API routes, and asynchronous request-hook
failures. Exact response media types are asserted after real serialization.
Host routes, custom parsers and 404 handlers outside the prefix stay intact.

Fastify's malformed-URL handling runs before connector hooks. The matrix
asserts its native 400 error separately; the Fastify guide shows the host-wide
`onBadUrl` option for applications requiring JSON:API at that boundary. This
explicit framework boundary is not evidence that a connector hook executed.

The Fastify connector uses one child scope for routes/parsers and the existing
compiled resource validator. This fixes bodyless DELETE parsing without
replacing a host parser. Express maps parser, asynchronous request-hook and
route-matching errors through the existing error handler. The old Fastify fake
has been removed; schema checks observe real `onRoute` registration.

These checks support A2-04, A3-07, A3-08 and A3-09. They do not establish real
PostgreSQL/MySQL, complete transaction/notification failure semantics, every query/serializer
combination, or completion of B0 and the consumer migration. Those remain
separate checklist requirements.


## Real multipart parsing and persistence

`multipart-detectors` has 20 native HTTP cases across Busboy 1.6.0 and
Formidable 3.5.4: binary contents/metadata, UTF-8 filenames, empty files, repeated
text fields, own prototype-like names, concurrent uploads, duplicate files,
exact byte limits, field/file/part caps, malformed bodies, missing boundaries,
and disconnects. Formidable cancellation waits for a nonempty file on disk;
cleanup assertions also preserve an unrelated file in the parent directory.

`multipart-uploads` has 24 cases per selected storage mode, also run with Express
4.22.2. The suite uses real LocalStorage and asserts stored bytes and URLs,
POST/PUT-create/PATCH semantics, required files, numeric schema size limits,
unknown fields, errors, rollback after upload, and rollback after a canceled
real request. Both storage modes are asserted explicitly. `file-handling` adds
seven focused custom-detector cases, including plain-format input handling,
unexpected failures and prototype-like attributes in both public formats.

The prototype regression exposed existing unsafe attribute copies in the plain
input transformer and common schema-validation preparation. The current copies
preserve own keys for the existing validator, rather than special-casing names
in a separate upload validator. Formidable cleans its per-request directory
before returning buffers; duplicate files are rejected instead of choosing one.

These checks establish A3-10's parser/API coverage. They do not close A7/B2 file
ownership and transaction semantics: committed-file replacement/deletion,
borrowed transactions, secondary cleanup failures and external stores remain
separate requirements. The included S3 adapter is still a mock.

## CORS and response error boundaries

`tests/cors-transport.test.js` exercises 28 Express and 27 Fastify cases on each
SQLite storage mode. Express cases also run against the actual Express 4 alias.
The fixture reuses the connector resources, with the older parity header hook
turned off so it cannot accidentally supply a missing Origin vary field.

Coverage includes resource and relationship responses, 204 deletion, malformed
JSON, body limits, unsupported request/response types, explicit rejection,
request-hook errors, schema errors, missing records and routes. Trace assertions
check response-hook attempt counts and prove request hooks do not run before
failed parsing. Response-hook failure on success and on an existing request
error is covered, as is an origin predicate failing during error handling.

Origin cases include async permission/denial/errors and arrays, stateful regular
expressions, reflected/wildcard/disabled origins, absent and denied origins,
preflights, zero cache age and existing Vary fields from the host, custom route
and hooks. A wildcard vary value is retained. Hooks use hooked-api's actual
beforeFunction/afterFunction placement options; its ignored numeric order
option is no longer used by CorsPlugin or these tests.

The native Fastify malformed-URL response and host routes outside the API
prefix remain outside connector CORS. Explicit raw-response ownership and
later hooks that replace header fields remain application responsibilities.
The existing CORS and Socket.IO suites now run in the focused connector matrix.
The Socket.IO rejection and relationship-event cases below complete A3-11;
managed transaction/outcome and broader committed event guarantees remain A7/B2.

## Socket.IO requests and resource notifications

`tests/socketio-contract.test.js` runs 36 cases over WebSocket and the same 36
through HTTP polling, with actual Socket.IO 4.8.1 clients/server and the selected
SQLite backend. Both transports are exercised with Express 5 and the actual
Express 4 alias. The original 12 cases remain, including JWT authentication.
They now use shared event waiting and an acknowledgement barrier; no negative
assertion can miss an event by attaching after the operation, and an expected
write rejection no longer catches its own failed assertion.

New cases cover authenticated connection rejection and spoofed client identity,
resource query denial on admission and on later notification, unknown resources
and filters, malformed filter containers, removed options, invalid/duplicate
subscription IDs, concurrent limit enforcement, restoration, unsubscribe and
multiple matching subscriptions. A custom SQL predicate uses the actual
`applyFilter` search contract without a parallel record matcher. Direct query
assertions independently check the expected selected record on both modes.

Write cases cover explicit event types and string IDs, PUT-create/replacement,
HTTP validation, pre-commit finish failure after queuing, filtered membership
changes, many-to-many and reverse POST/PATCH/DELETE relationships, parent and
child notifications, and child rollback with no events. Trace assertions check
actual completed transactions before the committed notification is observed.
Relationship hooks expose scopeName and the existing parent record. The later
visibility correction below performs explicit before/after subscriber queries;
it supersedes snapshot matching.

The Redis adapter 8.3.0 uses JSON.stringify for fetchSockets responses. A
round-trip regression demonstrates that subscription data retains IDs, resource,
filters and authentication after that encoding; the former Map lost its entries.
This is serialization evidence only. Redis server was unavailable locally and a
live multi-server run remains required in later service/capability coverage.
Caller-owned transactions, successful atomic bulk delivery, failed commit/rollback
and failed side effects remain open under A7/B2. The notification query checks
below establish row-policy/autofilter isolation for the tested operations;
small payloads alone do not prove those guarantees.

`conformance-socketio-authorization.test.js` adds 60 cases per backend across
WebSocket and HTTP polling, also selected in Express 4, authorization and socket
commands. Independent expected IDs cover visible/hidden CRUD across two workspace
and row-policy contexts, spoofed handshake fields, entering/leaving visibility,
changed-ID intersection, missing context and query failures, trusted admission
context, reused PUT-create context, non-atomic bulk success/failure, atomic rollback,
queued subscription replacement and all three relationship writes. SQL predicate
cases cover text collation, nulls, ranges, membership arrays, multi-field/split
search and joins, with update and deletion expectations. Removing the last child
matching a relationship filter must still invalidate its former parent result.

Runtime eligibility reuses ordinary resource queries and the internal query
constraint already used by related reads. It does not add a second filter engine.
No response fieldset or explicit sort is forced: normal resource query hooks
retain attributes and the resource's supported default sort. Queue entries capture
operation values and subscription generations, not mutable writer context.
Query failure counts as a nonmatch; before or after success is sufficient.

## ID domains, storage mappings and HTTP links

`conformance-ids.test.js` runs **64 identical public-behavior cases per backend**
using custom primary-key names, mapped attribute/foreign-key columns, and
integer and opaque string ID declarations. The shared fixture accepts its
resource factory and table map so reset/inspection/teardown use the same
interface; resource definitions remain in `tests/fixtures/api-configs.js`.
Regular tables use actual integer or string keys; AnyAPI uses its logical-ID
storage. Assertions select the backend explicitly and do not infer parity from
legacy files fixed to Knex.

Coverage includes zero IDs through all POST return modes, PATCH/PUT path/body
consistency, body-only and path-only identity, malformed IDs without writes,
custom column inspection, filters/sorting, belongsTo/hasOne/hasMany/many-to-many
and polymorphic linkage, nested includes and related endpoints. Opaque IDs
include case-sensitive strings, leading zeroes, large numeric strings,
punctuation/Unicode and JavaScript prototype property names. Both formats use
the same expected public IDs. The value suite separately proves that
`type: 'id'` still rejects non-positive IDs in either format.

The normalization suite checks plugin/resource precedence, referenced-resource
normalization, pivot storage, and path/body comparison after normalization.
Historical custom-ID suites retain generated-ID and nested relationship cases.
The real connector file adds six rejection cases across programmatic return
defaults and eight native HTTP link-following cases per backend (Express 5 and
Fastify 5), with seven of those also exercised under Express 4. Link tests follow
POST Location, resource self links, forward linkage/related links, and reverse
relationship links for zero, punctuation/Unicode and prototype-like IDs.

Inspection/regressions found falsy IDs treated as missing, inherited object
properties used as relationship lookup entries, unencoded IDs causing invalid
Location headers after a committed write, and implicit object-to-string path
IDs. Small fixes retain existing normalization, request contracts and URL
builders. Null-prototype dictionaries replace ID-indexed plain objects; raw
SQL zero values remain eligible for includes and polymorphic minimal records.
PUT validation recognizes supplied polymorphic fields already extracted from
relationships instead of demanding them again as attributes.

A mapped pivot exposed integer declarations falling through to string columns.
Table creation, generated migrations and migration-diff type classification
now recognize integer fields. The table helper suite executes both creation
paths against SQLite, checks actual column types and stored numeric values,
checks the signed column's migration diff, and runs the generated down migration.
This does not prove unsigned enforcement or real PostgreSQL/MySQL behavior.
Existing string columns are not automatically converted. The migration guide
explains this change and the scoped consumer source search.

This establishes A2-05's shared behavior coverage. Real-driver comparisons,
additional malformed schema declarations, full policy/failure guarantees and
final coordinated dependency/application verification remain A3/A5/A7/M/C work.

## Temporal values, transformations and serialization

`conformance-temporal` has **101 regular cases** on each database, **102 SQLite
AnyAPI cases** and **103 PostgreSQL/MySQL AnyAPI cases**. Ten are direct
normalization cases for driver/extension values; the remaining cases exercise
public/storage behavior, including canonical migration guards. It reuses
`createConformanceFixture` and `createTemporalBoundaryApi`, asserts the actual
backend, registers resources in the fixture module and resets data per case.

Both formats exercise POST/PUT/PATCH with all write-return options, leap days,
early calendar years, offsets crossing days/years, time-only strings, zero and
negative epochs, epoch limits, nullable updates, and rejected writes preserving
existing rows. Rejection covers malformed calendars/times, excess precision,
unsafe epochs and offsets outside the four-digit UTC year domain. No/minimal
returns also reject those unrepresentable dates before creating rows.

Async setters and getters return Date objects with independent expected
timestamps. Computed date/dateTime/time/epoch fields normalize to explicit
JSON values through writes, reads, sparse queries, reverse includes and related
queries. The fixture's setter advances one minute and its getter one second;
direct database inspection proves that only the setter's value was persisted.
The historical boundary suite additionally covers finish hooks and typed errors.

Public cursor traversals cover dates, millisecond timestamps, times, epochs and
custom six-digit timestamps in both directions. Expectations use fixed values
and IDs rather than the production normalizer. The backward cursor is explicitly
constructed from the known public boundary: the existing API exposes a next
cursor, not a `meta.pagination.cursor.prev` property. Plain sparse responses may
also carry relationship linkage, so the temporal attribute assertion accounts
for the declared person relationship.

Custom serializer cases verify actual stored bytes, scalar and declared array
filters, one serialization call per filtered query, POST/PUT/PATCH metadata,
and owned-transaction rollback on serializer failure. AnyAPI keeps callable
storage metadata from the compiled schema, uses the same serialization choice
as regular storage, and applies the shared filter pass once. Custom-serialized
and projected cursor comparisons bind the SQL value directly without invoking
a write serializer. Projected date/time/custom timestamp cursors cover sparse
fields, ties and nulls through complete forward/backward traversal. Query
projections no longer declare storage serializers; their selected SQL value
retains the database representation and precision.
Its former private filter pass and now-unused
coercion helpers were removed. The original AnyAPI serializer skip is gone.

Raw database cases inspect SQL temporal strings, offsets, negative epochs and
corrupt values. Native database rejection asserts the specific driver error and
unchanged stored value; SQLite's more permissive storage exercises the library's
typed read rejection. Actual standard/window includes and related queries retain
calendar dates, times and custom microseconds in both formats and fieldsets.
Library query options preserve temporal strings without changing native results
for caller-owned raw Knex queries.

| A3-03 storage capability | Executed contract |
| --- | --- |
| PostgreSQL timezone and early years | Explicit UTC writes, offset and historical seconds-offset reads, public year 0000 encoded as 1 BC, fixed expected calendar/datetime values |
| MySQL native year range | Years below 1000 rejected before built-in DATE/DATETIME writes for all return modes; canonical text calendar dates retain the broader public domain |
| Native timestamp/time precision | New unspecified-precision columns use 6; default milliseconds and time microseconds survive writes, reads and filters; custom serializers preserve timestamp microseconds |
| Public time spelling | Seconds always present; declared precision pads digits, unspecified precision trims redundant zeros; equivalent spellings match the same stored rows |
| Finer time precision | Native SQL time writes reject more than six meaningful fractional digits; SQLite and canonical text storage retain finer values |
| AnyAPI existing schema | Incompatible calendar/time slot metadata and native timestamp precision fail explicitly; tests restore their deliberately altered metadata/schema |

The [migration guide](../GUIDE/MIGRATING_API_V2.md) explains the changed shapes,
native limits and requirements for preserving existing data. Startup guards do
not perform data migration. The separate execution coverage below tests the
one-off migration example. Broader schema evolution, consumer migrations,
concurrency and the complete database capability matrix remain open under A3/A5.

### Existing AnyAPI temporal data migration

`anyapi-temporal-migration.test.js` runs 20 cases against the requested real
database, always using canonical storage. Its repetition during the regular
invocation is not evidence for regular-table migration. The fixture creates old
date/time slot metadata and existing data directly; it does not claim to run an
old library version or a consumer's database.

The suite executes `examples/migrations/anyapi-temporal-v2.js` and checks:

- Exact before/after snapshots of all five canonical data/configuration tables:
  only selected destination values and the two field mappings change. Old slots,
  physical/logical IDs, tenant/resource identifiers, unrelated fields, relationship
  rows and link payloads remain intact. Overlapping IDs in two tenants and a
  different resource expose missing scoping.
- Fresh API initialization with the complete new canonical map, both response
  formats, belongsTo/many-to-many includes, calendar/time filters, forward/backward
  cursor traversal with ties and nulls, and subsequent writes.
- Native timestamp precision 3-to-6 DDL for standard nullable columns with no
  defaults. The existing schema guard rejects the old precision before that DDL.
  MySQL raw strings gain padding but retain their values. SQLite's old epoch
  dates and bare time strings are copied without requiring a native type change.
- Existing microseconds reach the explicit converter without driver Date
  conversion; nulls bypass it. Three batches copy 205 records, including null
  values and a soft-deleted row. Empty-resource metadata also migrates.
- Occupied/duplicate/invalid targets, stale sources, unknown fields and missing
  converters reject the migration. Conversion exceptions, invalid/null output,
  excessive precision and caller-directed rollback preserve the entire original
  snapshot, including writes made earlier in the transaction.
- Resource re-registration validates persisted mappings before replacing them.
  Direct registration with owned/borrowed transactions and fresh API startup
  reject unmigrated fields without changing the affected resource's metadata or
  any stored records. This closes a startup path that bypassed the descriptor
  guard by overwriting the old mapping first.

These are synthetic UTC fixtures. Applications must choose conversion for their
original timezone/serializer convention, inspect column modifiers before DDL,
stop writers and supply their own transaction. This is not an online migration,
automatic timezone inference, a MySQL transactional-DDL guarantee, or proof that
consumer data has been migrated. Consumer repositories remain on hold.

### Canonical field evolution

`anyapi-field-evolution.test.js` runs 13 cases on the actual requested database,
always using canonical storage. Its regular invocation is repeated canonical
coverage, not ordinary table DDL coverage. The tests exercise:

- Public `addKnexFields` after reads/writes have cached request contracts, in
  JSON:API and plain formats. Existing rows remain intact, new static/function
  defaults apply only on subsequent writes, and added getters/setters and direct
  or explicit search filters work immediately.
- Complete added definitions after descriptor reload; explicit slots during
  registration before `createKnexTable`; repeated creation without metadata
  replacement; and fresh declarations retaining slots, belongsTo linkage and
  callback defaults.
- Batch rollback after an earlier successful allocation, unchanged runtime
  schema/cache on failure, retry with distinct slots, rejection of duplicate
  fields, unknown map entries and invalid setter dependencies.
- Invalid slot indices/spellings and mismatched relationship columns, including
  names such as `string_01` that resemble a valid index but are not real columns.
- Added computed/virtual definitions without storage slots, rejection of their
  slot overrides, and a newly added storage serializer used for both writes and
  filters.
- Direct registry allocation/re-registration with borrowed transactions: local
  reads see local metadata, the global cache retains committed descriptors,
  rollback preserves the original tables, and explicit invalidation reloads a
  committed borrowed change.

The implementation reuses the existing compiler, descriptor loader, slot parser
and options registry. It removes ineffective reads/writes of `scopeOptions` on
the method proxy, persists schema JSON alongside allocations, groups a public
batch in one transaction, and publishes its compiled schema after commit.
There is no new schema engine or compatibility proxy.

This does not verify concurrent schema writers, online connector schema/route
refresh, arbitrary field-type alteration, or backfilling existing rows. Native
regular public field/migration helpers and composite dependencies are covered
separately above. A3-05 is complete; broader metadata/concurrency review remains
under A5/A3-06.

### Canonical registry failure handling

`anyapi-registry-failures.test.js` runs 49 cases against real canonical metadata
tables, with application records seeded through the shared fixture. Like the
field-evolution suite, it always uses canonical storage; its regular invocation
is repeated canonical coverage. The default native database runner includes it.

New registration, existing registration and field allocation cover typed and
frozen errors, null/undefined rejections, failed rollback, synchronous/asynchronous
logger failure, completed transactions and retry after confirmed rollback. The
tests inspect resource, field and relationship metadata, existing records,
transaction completion, rollback/commit attempts and cached descriptors.
Independent caller-owned commit/rollback cases verify no library completion or
global publication of uncommitted metadata. Another case reproduces colliding
tenant/resource cache keys and verifies isolated reads, updates and invalidation.

The registry reuses `rollbackAfterError`, invalidates its owned write's cache
entry on failure and passes cleanup diagnostics to guarded error logging. The
suite replaces the registry logger method to return its promise; it does not
prove that the installed hook dispatcher's logger forwards an asynchronous sink
return value. Public outcome metadata, concurrent metadata writers and arbitrary
dependency hook failures remain separate work.

### Descriptor reads and post-write refresh

`anyapi-descriptor-failures.test.js` contains 65 canonical cases. It traces
descriptor reads on successful public operations, then injects a failure at
each observed read in turn and verifies recovery. Forty programmatic/direct
cases exercise 420 injected failures across collection/single/related/linkage
reads, every include kind with nested paths, resource creation/update and
relationship replacement/removal. Writes cover both representations and owned/
borrowed transactions, with real record/link snapshots before and after failure.
One case distinguishes a null registry lookup from a required missing descriptor.
Another 24 cases use actual HTTP listeners for Express and Fastify, asserting
error status, absence of successful data, unchanged records and recovery. The
Express 4 connector commands include the 12 Express cases as well.

The descriptor probe bypasses caching to reach the actual metadata-query
boundary. Its SQLite fixture uses the existing isolated file/WAL configuration
so metadata reads can borrow another connection during a write; an initial
single-connection in-memory attempt was stopped before recording the baseline.
The suite always uses canonical storage, including when the outer command
selects regular storage. It does not assert concurrent schema-change semantics.

`conformance-post-write-read-failures.test.js` adds 48 shared cases for POST,
PUT-create/update and PATCH. They cover full/minimal/no response modes, JSON:API/
plain output, typed/frozen/null/undefined failures and owned/borrowed writes.
Tests inspect records and many-to-many linkage, require finish/commit hooks to
remain uncalled on failure, check borrowed local state and verify rollback and
successful recovery. Initial test-draft fixes used the fixture's actual custom
ID column for snapshots and supplied the persisted fields required by PUT.

The changes use the existing error wrapper and write lifecycle: descriptor
failures gain tenant/resource context, broad relationship catches are removed,
and a failed post-write refresh rejects before finish/commit. There is no
best-effort switch. The later callback work below removes getter/computed
fallbacks. Arbitrary hook-dispatch errors and machine-readable outcomes remain
unfinished A7/B4 work.

## Field callback failures

`conformance-field-callback-failures.test.js` has 220 cases shared by ordinary
and canonical storage. Its callback probe is provided through the existing
ID conformance fixture; it does not replace a storage operation. Coverage is:

- 48 primary GET/query callback rejections, 48 failures across all six include
  kinds, four nested failures and four unselected-callback checks. Both getters
  and computed fields run in JSON:API and plain output; typed, frozen, null,
  undefined and string errors are exercised through synchronous throws and
  asynchronous rejections.
- Eight minimal/none writes avoid callbacks needed only for an unused full
  response. Another 48 writes fail in setters/getters/computed callbacks across
  POST, PUT-create/update and PATCH, formats and owned/borrowed transactions.
- 36 pivot-validation failures preserve related getter/computed errors across
  POST, PATCH and relationship replacement, with both ownership modes.
- 24 real Express/Fastify PATCH requests verify 403/422/500 classification,
  absence of successful data, unchanged database state and successful recovery.
  The 12 Express cases also run in the Express 4 connector commands.

Write assertions inspect actual record and pivot rows, completion state and
rollback; borrowed writes are rolled back by the test owner. The existing
getter/computed fallback tests now require rejection and owned rollback, then
seed with minimal output to test rejection on a subsequent read. Their failing
resource declarations are registered once in the shared fixture. The setter
rollback assertion now checks the collection's `data.length`.

Unexpected callback failures use the existing error wrapper and retain
field/resource/phase context. Typed errors retain identity. Ordinary pivot
validation directly awaits the target read instead of translating every
failure to 404. This does not introduce a fallback option or change post-commit
and cleanup handling. The remaining metadata guards and dependency boundary
are listed in the [error-policy inventory](write-lifecycle.md#b4-callbackinclude-policy-inventory).

## Stored linkage and schema metadata

`conformance-relationship-metadata.test.js` adds 34 shared cases. Tests alter
real mapped columns or canonical slots to store undeclared polymorphic types,
including a registered but disallowed resource, an unregistered type and an
empty type string. GET/query in both formats, direct linkage, nested includes
and real Express/Fastify GET/PATCH requests must reject without successful
partial data. A post-write hook corrupts linkage inside the write transaction;
the full-response failure must roll back owned changes and leave borrowed
completion to the owner. The probe asserts that this hook actually ran.

The suite also checks nullable linkage, valid sparse output and client-side
validation classification. Missing reverse metadata is injected into resource
definitions and, for canonical storage, actual `any_resource_configs` JSON with
targeted cache invalidation. Mutating a returned descriptor is insufficient
because the registry returns a clone; tests verify the injected stored value.
Recovery restores both definitions and stored metadata before a successful read.

Two public GET/query cases warm the request contract, trace schema relationship
reads and inject a frozen error at every observed read in turn. Ten additional
cases in `include-error-handling.test.js` exercise typed/frozen/null errors in
field selection and conversion, and distinguish missing required schema from
empty work. The existing polymorphic-union traversal regression still permits
a nested path that exists on some declared target types and rejects an unknown
path before querying, including with no stored rows.

The first draft used an unavailable scope customization method, then an
incorrect hook name; final tests use `api.customize` and `afterDataCallPatch`.
The plain/null control follows the documented omitted-field convention, and
valid sparse output is checked separately from corrupt data examined by the
preliminary record read. These draft corrections are not runtime behavior
changes. Focused coverage also includes IDs, fieldsets and storage mappings.

## Query selection, filtering and related pagination

`conformance-queries.test.js` runs 89 shared cases per backend plus two regular
pivot-resource hook cases. Its shared fixture configures mapped pivot keys,
inverse many-to-many relationships, explicit search fields and SQL projections.
Both formats use independent expected IDs, values and counts for nulls, booleans,
empty IN lists, ranges, text comparisons, OR/AND split searches, cross-table
searches and custom `applyFilter` callbacks. Invalid ranges now reject rather
than silently removing a filter; scalar equality remains a separate operator.

Sparse projections verify hidden fields and internal sort dependencies do not
escape into the response. Cursor and offset traversals follow generated links
with tied/null/projected sort values, capped page sizes, sparse fields and joins.
Many-to-many and hasMany related reads check target filters, includes, counts
and route preservation. Extra cases cover inverse link orientation, empty
parents, duplicate physical links, borrowed-transaction rollback, target query
denial/filtering, regular pivot permission/filter hooks, and independent nested
queries. Reading three members issues the same number of SQL statements as one;
this is a focused regression budget, not the full A8 performance assessment.

Many-to-many membership now uses a SQL subquery and the existing target resource
query. This removes per-member GETs and ensures selection/filtering/pagination
share the normal collection path. AnyAPI qualifies physical selected/sorted
columns and cursor predicates when canonical tables are joined. Both backends
count distinct primary IDs, preventing fan-out joins from inflating offset totals.
The count regression independently expects two parents from three matching
child rows. Plugin-level disabled counts are checked against actual SQL events.

Include paths are validated against existing compiled relationship definitions,
including inferred many-to-many targets and declared polymorphic branches.
Unknown attributes/relationships, nested paths and prototype names produce
`REST_API_INCLUDE_INVALID`; empty collections and absent to-one targets also
reject unsupported paths. Real Express 4/5 and Fastify tests check HTTP 400 and
`source.parameter`. Existing cycle, hasOne, nested and polymorphic traversal
tests still execute, with a new case for paths supported by only one polymorphic
target type. The migration guide records changed results, errors and read hooks.

The new `npm run test:queries` command runs both modes; `npm run verify` includes
these files through its full suite glob. The recorded passing gate establishes
A2-09's behavioral coverage. It does not establish real PostgreSQL/
MySQL collation, join planning or driver behavior, the full authorization matrix,
Socket.IO filter equivalence, every schema declaration, or final review closure.

## Authorization and to-one linkage

`conformance-authorization` runs 60 identical cases on each backend using the
existing row-policy fixture and its optional polymorphic relationships. A shared
seed exposes records to an administrator, then tests a narrower viewer. One suite
hides targets by policy; the other moves them to another workspace in storage
while granting the same group, isolating autofilter behavior from the policy.

The matrix asserts primary and included belongsTo/polymorphic identifiers,
empty linkage, GET/query and both formats, sparse fields, linkage/related
endpoints, related counts and full PATCH responses. Direct inspection checks
that hidden relationships stay stored. A borrowed transaction hides an initially
visible parent; the child response respects that uncommitted change, leaves
transaction ownership to the caller, and exposes the parent again after rollback.

GET/query share outgoing to-one linkage filtering through the existing storage
adapters and query-filter hooks. The former AnyAPI identifier filter is reused
by both backends rather than copied into another implementation. Primary and
included references are grouped by target resource type. Plain null belongsTo
fields remain omitted; JSON:API linkage is explicitly null. Public zero IDs are
retained by canonical string-ID comparisons, as checked by the existing ID suite.

Four additional cases cover a polymorphic target whose resource type is the
same as its parent, with both formats and hidden-by-policy/workspace fixtures.
The parent retains full attributes for its own permission hook; target GET
denial still rejects the related read, with and without target fieldsets.

`conformance-related-permissions` adds 114 cases per backend for target GET
action/data permissions and finish hooks on belongsTo, polymorphic and hasOne
reads, under both formats and no selection/fields/includes. It also verifies
parent data permission checks, mapped zero IDs and borrowed transactions.
Thirty real HTTP cases assert forbidden reads return 403 without target data;
the 15 Express cases run under Express 4 as well. Linkage cases additionally
cover parent data-permission denial for belongsTo, polymorphic, hasOne,
hasMany, reverse polymorphic and many-to-many relationships. The internal
parent GET retains attributes for its data-permission hook rather than
silently forcing a minimal ID-only fieldset.

`npm run test:authorization` also runs the historical row-policy/autofilter
suites and the bulk/context suites below. The include permission, notification,
reference and include-limit sections complete the recorded SQLite authorization
matrix. See the evidence log for exact passing gates and regression history;
consumer artifact results there precede the current migration hold.

## Bulk permissions and reused context

`conformance-bulk-authorization` adds 56 cases on each backend. Atomic batches
roll back permitted entries when another is denied; non-atomic batches preserve
permitted entries and report the denied index. Separate fixtures exercise row
policy and workspace boundaries, while independent permission hooks deny an
otherwise visible write. Full responses keep hidden linkage filtered. Both
formats and all return modes are checked against persisted records. A mapped
integer-ID fixture covers numeric zero without relaxing the positive `id` type.

Real Express/Fastify tests cover POST/PATCH/DELETE, request identity and workspace
forwarding, permission rejection, non-atomic partial success and malformed atomic
values. Plain/none programmatic defaults verify explicit JSON:API/full transport
selection. Express 4 runs the same 11 Express cases via the connector command.
The tests reproduced obsolete route registration, missing context forwarding,
ignored atomic query values and discarded DELETE batch responses.

`conformance-transaction-context` adds 16 cases per backend. Every resource and
relationship write is rejected after a prior committed call, with rollback
required for owned transactions and completion left to the borrower otherwise.
Stored resources and relationship membership are inspected after rollback.
Two additional cases distinguish current PUT input/existence from stale context.
These regressions exposed an inherited commit flag that leaked a transaction
after denial, plus inherited input/minimal-record snapshots that broke PUT
replacement/creation validation. Captured transactions are released even when
an assertion fails. This is focused failure coverage, not completion of the
real-driver, outcome, bulk borrowing or deferred-notification requirements.

## Concurrent application transactions

The default native matrix now runs `conformance-transaction-context` and the
`conformance-transactions` suite (32 SQLite / 33 PostgreSQL / 33 MySQL cases)
in both storage modes on all three
databases. The latter uses separate connections, including file-backed SQLite,
and checks stored results independently of the write response:

- Borrowed POST reads its own uncommitted records, belongsTo includes, reverse
  linkage and related resources; a second transaction and fresh requests cannot
  see them until the owner commits. Owner rollback removes the whole change.
- Reverse hasMany, hasOne and polymorphic writes share rollback with many-to-many
  membership. A failure in the second child rolls back the earlier child, and
  separate reads see neither partial change.
- Explicit repeatable-read transactions retain their snapshot after another
  writer commits. Overlapping PATCH reads preserve independently submitted
  fields on PostgreSQL/MySQL. SQLite rejects the stale snapshot's write upgrade;
  a new transaction after rollback can retry without losing the committed field.
- An atomic bulk PATCH keeps the first update private while its second item is
  paused. Success publishes both; failure rolls back both.
- Concurrent generated-ID POSTs on PostgreSQL/MySQL return distinct identities
  before either commits. SQLite rejects the second active writer immediately;
  the test retries after releasing the first. Rollback does not promise that an
  unused generated ID can never be reused.
- Competing reverse hasMany, hasOne and polymorphic replacements and
  many-to-many replacements do not merge both requests. Repeated additions,
  including opposite relationship endpoints, leave one stored edge. Direct
  resource PATCH/PUT and relationship endpoints share these guarantees.
- Requests with older repeatable-read snapshots either apply a complete current
  replacement or fail with the driver's concurrency error. Tests retry only
  after owner rollback and check final membership independently.
- A parent or target deleted after validation cannot receive a newly attached
  many-to-many reference. Six further cases cover target deletion during
  POST/PUT/PATCH with ordinary and polymorphic belongs-to references.
- A deliberate native deadlock rejects exactly one of two transactions. After
  owner rollback/commit, both surviving row changes belong to the winner; the
  loser's earlier update is absent. SQLite exercises its single-writer/busy
  behavior instead of claiming native deadlock coverage.

The tests coordinate through bounded hook barriers and clean up borrowed
transactions in failure paths. The reused-context POST case now supplies an
explicit free ID, so PostgreSQL's unadvanced sequence cannot mask its intended
pre-commit failure. The ID fixture now registers its canonical link mapping with
the existing cleanup helper, so later cases start without old edges. Parent
locks use the existing storage adapter and a no-op ID update to advance the row
version. Target and membership reads use locking queries; canonical reads still
use the existing link loader. No transaction framework or retry loop was added.

The suite exercises A3-06's commit/rollback, separate connections, isolation,
relationship integrity and driver conflict behavior. Bulk borrowing, complete
outcome/notification semantics and cleanup failures retain their separate A7/B2
requirements. It does not introduce automatic deletion cascades, replace declared
database constraints, or promise that arbitrary direct SQL obeys ORM locks.


## Included-resource permissions and pivot policies

`conformance-include-permissions.test.js` executes 72 cases against the selected
backend plus 12 explicit regular-pivot cases in each invocation (84 total).
The shared cases cover all six relationship shapes through GET/query in both
formats, target-query denial on related/linkage endpoints, default identifiers,
trusted query metadata and borrowed transaction identity, selected write response
permissions and rollback, third-level includes, and 24 real Express/Fastify
requests. The Express 4 command selects the twelve Express HTTP cases.

The fixed regular cases use actual RowPolicyPlugin membership predicates and
mapped target/pivot keys. Standard/windowed includes apply the predicate before
a one-row limit, and linkage/related counts select the independently expected
membership. Pivot query denial is asserted separately. Canonical AnyAPI links do
not use a declared pivot resource's row policy; these twelve cases do not claim
that capability for AnyAPI.

The plain converter's five direct graph regressions cover three-level expansion,
repeated sibling references, per-primary traversal, finite cycle identifiers,
polymorphic types, leaf relationships and partially included to-many membership.
The four nested API cases in the permissions suite exercise the same converter
against both storage modes. Expected graph values are explicit, and original
input relationships are checked unchanged.

## Search joins and relationship backing attributes

`conformance-search-authorization.test.js` runs 90 cases on the selected backend
(62 programmatic and 28 real Express/Fastify requests), plus one explicit regular
SQLite collation case. Express 4 selects fourteen HTTP cases. The fixture uses
real row policies and workspace autofilters, custom primary keys and mapped tables
and columns. Assertions cover belongs-to, reverse, intermediate and polymorphic
joins, null predicates, OR matches, distinct parent counts, target query permission
and borrowed transaction visibility. Combined direct/nested polymorphic filters
are tested in both argument orders.

Reference filters cover direct foreign keys, relationship aliases, polymorphic
ID/type pairs, shared IDs across types, joined backing fields, self references,
null/inequality/list/range operators, caller changes and forward/backward pagination.
The regular collation case uses an actual SQLite NOCASE foreign-key column. Both
formats and sparse field requests must omit backing attributes. Canonical descriptor
reload/re-registration must preserve existing slots and newly stored ID values.

The eight query-parser tests include lossless null/array/object filter serialization,
embedded commas, malformed typed input, prototype keys, final occurrence behavior,
literal strings and opaque cursors. HTTP tests exercise typed nulls, empty lists
and malformed JSON through both frameworks. Generated links retain nullable filters
instead of silently broadening the next page.

These cases do not establish general schema migration, PostgreSQL/MySQL coverage,
or final review completion. The reference-sort regressions are covered below.
The collection include-limit matrix is recorded below. Later native batches and
the capability map above supply the expanded database evidence; configuration
and storage-contract work remains under A5/A6.

## Reference sorting and cursor visibility

`conformance-reference-sorting.test.js` contains 54 selected-backend cases plus two
explicit regular SQLite collation cases. Thirty-eight programmatic cases use
row policies and workspace autofilters, fourteen use real Express/Fastify HTTP,
and two cover default sorts and collisions with declared fields/query projections.
Express 4 selects seven HTTP cases.

Independent expected ID orders and cursor strings cover ascending/descending
belongs-to and polymorphic keys, aliases, hidden/null ties, secondary sorts,
sparse/plain responses and complete forward/backward traversal. Self references,
combined type/ID sorting, joined filters with includes, caller changes and borrowed
transactions are exercised. Source/target lookups must not see other resources
sharing an ID; the AnyAPI branch additionally inserts conflicting canonical rows
in another tenant/resource and checks unchanged order and cursors.

The two fixed regular cases use a real NOCASE reference column and mixed-case
cursor boundaries. The result-name fixture uses schema/column names and a query
projection that collide with the initial temporary-sort naming scheme; public
attributes must survive and temporary columns must not escape. The default-sort
cases exercise both cursor pages and the ordinary default limit. HTTP cases cover
offset counts, cursor link traversal, null linkage and target permission denial.

These checks establish the tested SQLite sort fix. The include-limit cases below
extend that coverage. Real-driver, general transaction/notification outcome and
final review requirements remain open.

## Collection include limits and ordering

`conformance-include-limits.test.js` runs 75 cases against the selected backend;
none of these fixtures switch back to regular storage in the AnyAPI job. The
48-case core compares ordinary hasMany, reverse polymorphic and many-to-many
collections under both formats, standard/window strategies, ascending/descending
ordering and sparse query projections. Expected per-parent IDs and included
target sets are written independently of the production query builder.

Sixteen further cases cover duplicate physical links and caller-owned transaction
visibility. Six real Express/Fastify cases verify sparse projected fields, trusted
request visibility and per-parent linkage. Four cases exercise zero and explicit
null limits, including 22 children beyond the target's default query limit.
One reference-order case proves a hidden foreign key sorts as null before the
limited subset is chosen. Express 4 selects its three HTTP cases.

The shared SQL helper now applies ordering and limits to an already filtered
selection. Per-parent ranking retains the parent key until grouping is complete;
global many-to-many selection counts each target once. Mapped identifiers and
projection expressions are bound through existing query/storage helpers. Native
loaders share their field-selection/filtering sequence and AnyAPI uses the same
limit helper. Canonical link selections constrain tenant, resource, relationship
and target type in both directions. No per-parent API loop was introduced.

## A2-10 authorization coverage reconciliation

| Required surface | Executed evidence and independent expectation |
| --- | --- |
| Primary records | `row-policy`, `autofilter`, `conformance-authorization` and `conformance-related-permissions`: hidden primaries cannot be read or modified; parent data/action checks retain the attributes they need. |
| Includes | `conformance-authorization`, `conformance-include-permissions`, `conformance-include-limits`: target permission denial rejects, row/workspace predicates filter rows, hidden references are nulled, and limits rank the visible subset. Pivot policy runs before native membership selection. |
| Relationship linkage and related reads | `conformance-related-permissions`, `conformance-authorization`, `conformance-related` and `conformance-relationship-writes`: all relationship kinds retain parent/target boundaries, correct visible membership and borrowed transaction state. |
| Search and counts | `conformance-search-authorization` and `conformance-queries`: direct/joined/polymorphic filters, OR/null cases and relationship counts match independently specified visible IDs. |
| Ordering, pagination and links | `conformance-reference-sorting`, `conformance-search-authorization`, `conformance-include-limits`: hidden values cannot affect the tested reference comparisons or appear in cursors; typed filters and forward/backward links retain the selected collection. |
| Bulk operations | `conformance-bulk-authorization`, `bulk-operations`, `conformance-transaction-context`: denied writes preserve stored state, atomic batches roll back, and non-atomic batches retain exactly their permitted entries. |
| Representations and transports | Both plain/JSON:API assertions, sparse/default/full write responses, real Express 4/5 and Fastify requests exercise these surfaces. `conformance-socketio-authorization` separately verifies subscriber identity, workspace, SQL filter membership and notification visibility. |

This reconciles A2-10's shared SQLite conformance scope; it is not Part C's final
whole-patch audit or a claim of real PostgreSQL/MySQL execution. Arbitrary custom
SQL predicates/projections remain application-authored code. Later native
concurrency and capability batches are recorded above; configuration validation,
transaction completion/failure events, migrations and final reviews remain
separate checklist work.
