# Storage operations used by the core

Source inventory for **A6-01**, 2026-09-09. This maps the current library's
callers to existing storage operations. Implementation, typing, proxy removal,
consumer migration and the other A6 acceptance checks remain separate work.
jskit-ai, vibe64, their seeds and positioning changes remain paused.

## Module responsibilities

The canonical plugin installs storage services and owns registration and
data-operation entry points. Its link storage and relationship reads have
separate owners. Paths below are relative to `plugins/core/lib/`.

| Module | Responsibility |
| --- | --- |
| `anyapi/canonical-link-store.js` | Canonical link orientation, tenant-scoped membership queries, mutations, deletion and inverse-version invalidation. Exposes the existing `api.anyapi.links` methods plus the queries used by relationship reads. |
| `anyapi/canonical-relationship-reader.js` | Canonical linkage, sparse-field selection, includes and their output links. Uses the link store for physical membership. |
| `querying/knex-relationship-includes.js` | Ordinary include graph traversal, path tracking and final included-resource assembly. |
| `querying/include-to-one.js` | Belongs-to, has-one and polymorphic belongs-to loaders. |
| `querying/include-to-many.js` | Collection and reverse-polymorphic loaders, including per-parent ordering and limits. |
| `querying/include-query-helpers.js` | Shared adapter/column lookup, visibility queries, include parsing and relationship metadata. |
| `querying/relationship-identifiers.js` | Ordinary linkage reads for relationships that are not expanded by includes. |

Canonical services retain API-level dependencies, not request context. Each
operation supplies its transaction; descriptor and adapter lookups stay live.
The ordinary graph owner passes `deps.loadNestedIncludes` to loaders explicitly,
so loaders can traverse child paths without importing their caller. Direct
internal imports target these owners; there is no compatibility barrel.

## Existing layers and owners

Resource methods decide validation, permission checks, relationship operations,
transaction ownership and response preparation. They call `helpers.data*`
implemented by the installed Knex plugin. Those helpers combine query building,
storage execution and JSON:API assembly. The smaller storage adapter supplies
field/value translation and scoped query construction; it is not the owner of
the resource lifecycle.

Ordinary storage maps logical fields to a resource table and configured columns.
Canonical storage maps them to slots in the shared records table, with logical
IDs distinct from internal row IDs and mandatory tenant/resource predicates.
Both expose the same resource operations while retaining different physical
storage and relationship implementations.

The adapter factories, ordinary/canonical mapping helpers and hook adapter
utilities now have checked JSDoc contracts, described in
[incremental type checking](typechecking.md). `storage-types.d.ts` names their
existing input/output shapes. Values remain unknown until the responsible
schema/driver conversion, and builder construction borrows its DB handle.
The mandatory membership helper also has a checked symbol-keyed constraint
contract for its resource, logical equality map and ID subquery. Related-resource
and socket membership callers retain their existing object shape.
The read/write, relationship/count and transaction helper declarations below
complete the caller-facing storage boundary inventory. Broader implementation
body and lifecycle checking remains under A9.

## Operations and actual callers

Paths in this table are relative to `plugins/core/`.

| Required operation | Existing implementation | Core callers and boundary facts |
| --- | --- | --- |
| Resolve table, logical ID and physical field | Adapter `getTableName`, `getIdColumn`, `translateColumn`; `storage-mapping.js` and `canonical-storage-mapping.js` | Reads, writes, joins, cursor predicates, relationship target locks and include loaders need these operations. Logical `id` must resolve to a configured ordinary ID column or canonical logical-ID slot, not a shared table's internal row ID. |
| Extract a logical value from a row | Adapter `getFieldValue` and mapping helpers | Includes group rows by parent/target IDs, relationship writes compare memberships, and pagination builds cursors. Selected aliases and raw physical rows both occur. |
| Translate stored attributes | Adapter `toStorageRow`; `translateAttributesForStorage` / `translateCanonicalAttributesForStorage` | `dataPost`, `dataPut`, `dataPatch` receive validated, setter-transformed input. These helpers exclude nonstored values, choose columns/slots and invoke storage serialization. Canonical belongs-to slots additionally store target type/ID. |
| Translate a comparison value | Adapter `translateFilterValue`, `translateCursorValue`; `serializeFieldValueForStorage` | Search filters, membership constraints, target locks and joined predicates use logical field/value pairs. Scalar, array and null values occur. Custom-serialized and projected cursor values come from SQL and bind directly; other cursor values use `translateCursorValue` with the resolved stored field and built-in conversion, without resolving filter aliases. |
| Start a physically scoped query | Adapter `buildBaseQuery({ transaction })` and `applyResourceScope` | Shared include, relationship, reference-sort and reverse-write helpers need builders already constrained to the physical resource. Ordinary scoping is the resource table; canonical scoping adds tenant/resource predicates. Authorization remains a separate step. |
| Select columns and expressions | `knex-field-helpers.js`, `knex-query-helpers-base.js`, `query-field-helpers.js`, adapter select translators | GET/query/include paths select logical IDs, requested fields, required linkage/cursor fields and transitive callback dependencies. Query projection definitions are compiled metadata; SQL expressions are built for the current request. |
| Apply public filters and row policies | `apply-query-filters.js`, `knex-query-helpers.js`, each plugin's filtering hooks | Collection, minimal, include, joined-search and linkage reads pass query purpose, resource, adapter and DB/transaction context. Hooks may replace a builder. Nested work restores the prior hook context. Physical resource scope and row authorization are distinct requirements. |
| Apply mandatory relationship membership | `query-constraint.js`; `helpers.dataRelatedIdsQuery` | `get-related.js` constrains the target query with logical values or an ID subquery, independently of public searchability and caller filters. Ordinary many-to-many reads build a permission-filtered pivot subquery; canonical reads use scoped link storage. |
| Order records and page through them | Plugin sort-descriptor builders, `sort-helpers.js`, `query-field-sort-helpers.js`, `knex-pagination-helpers.js` | Query paths share stable logical ordering, scalar cursor validation, predicate chains and `applyPaginationToQuery` for mode, capped size, limits/offsets and cursor setup. Builders retain physical columns or projection expressions, direction and field definitions. Plugins own count query construction and physical result assembly. Dialect-specific null ordering remains explicit. |
| Check existence and obtain a minimal row | `helpers.dataExists`, `helpers.dataGetMinimal` in both Knex plugins | PUT uses existence to choose insert/update; GET and writes use minimal reads for authorization and post-write state. Minimal reads return a JSON:API resource or null, without includes/computations. Their filtering/context support is part of the current contract. Existence alone is not authorization. |
| Read a resource or collection | `helpers.dataGet`, `helpers.dataQuery` in both plugins | `get.js` and `query.js` receive documents with primary data, included resources and query metadata. Core normalizes values, checks data permissions, runs getters/computations and prepares final format. Data helpers already perform some JSON:API assembly; treating them as raw-row-only helpers would require a deliberate migration. |
| Count matching records | Collection count queries; canonical `helpers.dataQueryCount` | Pagination needs counts from the same applicable filters/scopes. The separate canonical count helper has a direct caller in `tests/row-policy.test.js`; it is not a shared core helper in ordinary storage. |
| Insert/update/delete a resource | `helpers.dataPost`, `dataPut`, `dataPatch`, `dataDelete` | Resource methods own transactions and response refresh. POST supplies an ID candidate for core validation; PUT/PATCH/DELETE return backend-specific write results/counts consumed internally. Ordinary ID-returning fallbacks are dialect-specific. Canonical generated IDs require insert followed by assigning the generated logical ID within the active write. |
| Lock and validate relationship targets | `writing/relationship-processor.js`, adapter scoped query methods | Write paths lock target IDs inside the active transaction, and resource reads/permission checks establish allowed linkage. Locking must use translated IDs and physical scope. |
| Add, synchronize, remove and list many-to-many linkage | `writing/many-to-many-manipulations.js`, relationship resource methods, `api.anyapi.links` | Ordinary storage uses mapped pivot columns, membership reads and insert/delete deltas. Canonical `attachMany`, `syncMany`, `removeMany`, `listMany` and bulk link reads use tenant/resource/relationship-keyed link rows, including inverse relationships. These paths also validate/filter targets. |
| Change reverse has-one/has-many linkage | `writing/reverse-relationship-manipulations.js` | Complete membership is read and locked internally, then each actual child change goes through child PATCH with the borrowed transaction. Removal precedes addition for a unique has-one slot. Child validation/authorization cannot be replaced with an unconditional bulk update. |
| Load and filter relationship identifiers/includes | `querying/knex-relationship-includes.js`, `knex-process-includes.js`, canonical include helpers | To-one, to-many, polymorphic, nested and limited includes need scoped ID loads, joins, grouping, per-parent ordering/limits and output conversion. Fallback adapter construction exists for resources without an attached adapter. |
| Begin a transaction; commit or roll back owned work | Plugin `helpers.newTransaction`; `rest-api-plugin-methods/common.js`; `lib/error-context.js` | Core passes `context.db` / `transaction` through storage work and prepares full write responses before owned commit. Borrowed transactions remain caller-owned. Relationship and bulk operations reuse resource methods with the appropriate transaction. |

## Adapter and query state lifetimes

Each Knex plugin caches adapters by resource name and the identity of
`schemaInfo`; replacement of compiled metadata rebuilds the adapter. It also
attaches the current adapter to `resource.vars.storageAdapter`. Include helpers
can construct a fallback from the resource's compiled metadata. The hook utility
in `querying/storage-adapter-utils.js` keeps a separate map local to a query/hook
invocation. Its aliases and active adapter come from that invocation's context.

Ordinary included resources can remain without an attached adapter throughout
GET/query includes; their local fallback uses the compiled table, ID and field
mapping. All include kinds select visible projections and callback dependencies
through the existing field-selection helpers, with or without a sparse fieldset.
Canonical registration attaches adapters eagerly. Its supported `addKnexFields`
path replaces the compiled metadata and refreshes the attached adapter before
returning, so includes can read newly added fields before another direct target
read. Ordinary `addKnexFields` is a table DDL helper, not a runtime resource
recompilation API.

Canonical collection and count queries now use native builders from the existing
storage adapter. `buildBaseQuery({ transaction, tableAlias })` applies both
physical tenant/resource predicates with the active alias. The query proxy,
related-descriptor traversal and resource/table alias maps have been removed.
Filtering contexts expose the existing storage adapter; custom filters receive
explicit column/value helpers. Native Knex owns builder methods and cloning.
A6-09/A6-10 still require broader verification and external-hook migration;
the consumer repositories remain paused.

`adapter.selectColumns` has an existing positioning-plugin caller. Positioning
work is paused, so removing that method now would discard a known caller.
Schema DDL/introspection, canonical registry allocation and optional-plugin raw
queries are adjacent storage consumers with their own contracts and tests.

## Direct adapter checks

`tests/conformance-storage-boundaries.test.js` registers real compiled metadata
through the shared fixture, then calls the adapter and Knex directly. Resource
GET/POST/PATCH methods do not orchestrate the assertions. The cases cover:

- Logical/physical IDs and mapped fields, including zero, empty string, null and
  absent values. Ordinary extraction preserves driver scalar types; canonical
  logical IDs are strings. Getters and computed callbacks belong to the response
  lifecycle and do not run in the adapter.
- Quoted column names, reserved words, whitespace and quote characters in
  aliases, with user values retained in SQL bindings. `createSelectTranslator`
  translates logical selection fields. `selectColumns` accepts already physical
  selections and explicit result aliases without changing the builder.
- Scalar/array/null comparisons, search-value aliases and synchronous custom
  serialization. The write mapper receives already validated/transformed
  attributes, excludes virtual/computed fields and preserves serialization
  field/column/context metadata. Temporal and full custom-serialization
  equivalence remain separately tracked under A6-07.
- Fresh query builders, borrowed transaction execution/rollback and canonical
  tenant/resource predicates on reads, updates and deletes. Scope predicates do
  not supply ownership columns for inserts; the storage writer supplies those.
- Invocation-local hook adapter lookup and alias resolution. These checks do not
  claim that the canonical query proxy's entire intercepted surface is covered.

The fixture exposed two table-helper defects: declared integer/string primary
IDs were missed when detecting the physical ID column, and snapshot validation
required database-generated integer IDs. The shared table-schema decision now
uses the mapped ID column; snapshots accept non-null, single-column integer or
string primary keys. Tests execute direct and generated DDL and require an empty
diff for the unchanged result. Invalid opaque-ID auto-increment configuration
rejects before producing DDL. A6-02 typing and the remaining A6 requirements stay
open independently of these direct boundary checks.

## Concrete follow-up work

- Extend the existing field-selection and sort descriptors where shared
  decisions can replace repeated plugin branches. Keep SQL builder/transaction
  handles visible at the execution boundary.
- Preserve A6-07's scalar/structured serializer checks when changing storage
  boundaries. Custom serializers, logical reference IDs and built-in temporal
  conversion have distinct, documented responsibilities.
- Verify how physical resource scope and policy filters survive subqueries,
  joins, counts, includes and builder replacement. An adapter's physical scope
  does not by itself establish authorization.
- Keep fallback/include tests when changing adapter initialization or supported
  canonical field additions; these use distinct attachment and refresh paths.
- Keep DDL/returning/temporal capabilities tied to the responsible backend. The
  capability descriptions and preflight checks are verified under A6-12/A6-13;
  retain their separate schema/value and transaction guarantees.

## Structured value boundary

The existing database value normalizer now encodes logical object/array values
for built-in storage and decodes driver JSON text on reads. Canonical arrays
share the existing JSON text pool with objects. Reads defer custom-getter fields
to their getter before checking the final structured shape; built-in fields are
decoded in the existing pre-enrichment pass. No second decoding pass was added
to `enrichAttributes`.

Custom serializers continue to own their stored representation. Default
serialization rejects wrong-shaped setter output and JSON serialization errors
before writes, even when no record is returned. The existing `wrapUnexpectedError`
retains the cause and field/resource context.

Whole-document object/array filters and sorts now reject explicitly. Compilation
checks local search/default-sort/explicit-sort/projection declarations; field
resolution checks related targets, and direct adapter comparison conversion
rejects before running serializers. Scalar `in`/`between` operands retain their
existing behavior. Custom `applyFilter` callbacks own application-specific JSON
predicates and value encoding; scalar SQL projections supply sortable JSON keys.

PostgreSQL stored-field and projection selections share `normalizeStructuredSelect`
in `query-field-helpers.js`. It uses `to_jsonb` for structured SQL results so
`DISTINCT` can deduplicate parent rows produced by joins, preserving public JSON
values without table changes. Structured custom encodings must use JSON-compatible
SQL representations. Arbitrary binary SQL mappings are outside this structured
field contract.

## Logical sorting and cursor values

`resolveSortField` in the existing sort helper gives resource IDs, stored fields
and projections precedence over filter names. A distinct search alias resolves
once to its stored target. Both Knex sort builders, reference visibility queries,
include window/standard ordering and required-field selection use that helper.
SQL column/slot translation remains in the adapters. Filter aliases continue to
use their explicit `actualField` even when they overlap a stored field name.

Sort descriptors retain the actual logical field and result column. Ordinary
cursor generation now reads those result columns, including sparse scalar
aliases; canonical generation already uses result-column metadata. Temporary
reference-visibility columns remain internal. `translateCursorValue` converts
built-in cursor scalars using stored metadata and the backend's temporal format.
It preserves relationship ID strings and invokes no user serializers/getters.
Custom-serialized and projection predicates keep their existing direct SQL
value path in `applySortDescriptorPredicate`.

Resource defaults accept strings or string arrays. The shared effective-sort
helper rejects other shapes instead of privately accepting an object that the
public request contract rejected. It still deduplicates fields and appends the
logical ID for stable ties. See the [API migration](../GUIDE/MIGRATING_API_V2.md#sort-fields-and-defaults).

`applyPaginationToQuery` in the existing pagination helper now owns the shared
page mode, capped size, limit/offset and cursor setup. It accepts the validated
page options, resource variables, sort descriptors and storage adapter, modifies
the supplied Knex query and returns `{ mode, page, pageSize, before }`. Both
plugins use that result to choose their count/result branch. The request contract
validates page inputs/conflicts; the pagination helper parses cursor syntax and
uses the existing scalar-contract and predicate-chain helpers. Links and metadata
also remain in this module. No second page parser or generic query engine exists.

Cursor pages select one extra row and never count; ordinary storage previously
ran a discarded count for size-only pages. Count SQL and physical row extraction
remain visible in their plugins: ordinary counts rebuild scoped filters,
canonical counts clone the scoped base query, and logical ID extraction still
differs by storage. Unifying these separate responsibilities is outside this
pagination setup change. Checklist status and final validation are recorded in
the master and [verification log](verification-progress.md).

## Source and verification references

- [Storage adapter](../../plugins/core/lib/storage/storage-adapter.js),
  [ordinary mapping](../../plugins/core/lib/storage/storage-mapping.js),
  [canonical mapping](../../plugins/core/lib/storage/canonical-storage-mapping.js).
- [Ordinary Knex plugin](../../plugins/core/rest-api-knex-plugin.js) and
  [canonical Knex plugin](../../plugins/core/rest-api-anyapi-knex-plugin.js).
- [Shared write lifecycle](../../plugins/core/rest-api-plugin-methods/common.js),
  [query filtering](../../plugins/core/rest-api-plugin-methods/apply-query-filters.js),
  [include/linkage loading](../../plugins/core/lib/querying/knex-relationship-includes.js),
  [query builder/context helpers](../../plugins/core/lib/querying/query-builder-utils.js).
- [Compiled metadata inventory](compiled-resources.md) records overlapping
  ownership and cache risks. The [verification log](verification-progress.md)
  records existing native and conformance evidence; it does not mark unexecuted
  A6 acceptance requirements complete.

## Capability consolidation audit

The current source has an existing capability home,
`querying-writing/database-capabilities.js`; A6-12 should extend that boundary
rather than introduce a second adapter framework. The ordinary plugin calls
`supportsWindowFunctions` and `getDatabaseInfo` separately, repeating the version
query on MySQL/SQLite. The canonical plugin publishes only `windowFunctions`,
while ordinary storage also publishes `dbInfo`. Include loaders consume the
existing `windowFunctions` flag.

| Requirement | Current owner | Consolidation constraint |
| --- | --- | --- |
| Version-dependent include windows | `database-capabilities.js`, both plugin initializers | Share one detection result; retain the include-loader predicate. Unknown versions must produce a boolean unsupported result. |
| Insert result/identity extraction | Both plugin write helpers, `databaseIdentityExpression` | Describe actual returned rows versus insert IDs without hiding identity precision or canonical internal/logical ID differences. |
| Temporal precision and driver values | Database value normalizers and schema column helpers | Distinguish native ordinary columns from canonical text storage; do not infer every field's representation solely from the client name. |
| Schema alteration ownership | `dbTablesOperations.js` | Preserve PostgreSQL owner/savepoint rules, MySQL standalone DDL and SQLite rebuild recovery. One generic transactional-DDL flag would lose required distinctions. |
| Relationship features | Compiled relationship declarations, adapters and include loaders | Resource/tenant scoping and supported relation shapes remain resource-aware; a backend flag cannot establish authorization. |
| Serialization/query support | Field capability validation, mapping and cursor helpers | Preserve explicit structured-predicate and asynchronous-serializer rejection; custom serializers own their encoding. |

A direct Node 24 probe found that unparseable MySQL/SQLite versions currently
return `null` from `supportsWindowFunctions`, contrary to its documented boolean
result. Both assertions failed (`null !== false`), retained in
`/tmp/library-capability-baseline.log`. Existing callers treat this as falsy, so
this is a boundary-contract defect rather than evidence of unsupported SQL being
executed. The three parser branches now return explicit booleans. Eleven direct cases
and 172 capability/include checks across both storage modes pass. Broader
capability consolidation and enforcement under A6-12/A6-13 remain open.

### Shared version observation

`getDatabaseCapabilities` now composes the existing information and window
helpers. Both plugin initializers call it and publish `{ dbInfo, windowFunctions }`.
For the tested PostgreSQL/MySQL/SQLite paths, the version is observed once; the
MySQL/SQLite window check consumes the already fetched version. Standalone window
checks still fetch the version when none is supplied. Detection stays scoped to
the initialized database instance, without a global cache or an adapter registry.

This removes the ordinary MySQL/SQLite duplicate query and gives canonical
startup the same version information. Canonical PostgreSQL initialization now
performs one version query where it previously assumed window support without
fetching a version; request-time query counts are unaffected. It does not change include strategy or
claim support for schema/returning/serialization capabilities not yet described.
The direct detector cases and installed-plugin query observation pass on SQLite
in both modes; native verification is recorded in the verification log.

### Field-alteration capabilities

The capability module now exposes `getSchemaCapabilities(dialect)`, and startup
publishes its result as `api.knex.capabilities.schema`. The existing field-alteration
runner and native-set column validation consume the same description.

| Schema capability | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| `fieldAlteration` | `transaction` | `standalone` | `sqlite-rebuild` |
| `callerFieldAlteration` | `savepoint` | `forbidden` | `foreign-keys-off` |
| `setValues` | false | true | false |

These fields describe the library's existing field helper, not every SQL DDL
operation. SQLite's prerequisite means foreign keys must be disabled before
starting the caller transaction; the existing runtime preflight still checks it.
MySQL callers still reject before alteration, while PostgreSQL retains its owner
or caller-savepoint completion path. Unknown dialects report
`recognizedDialect: false` and describe the existing fallback transaction path;
that is not a claim of verified support. The helper performs no version query
and adds no global cache.

Returning behavior, temporal representation, and relationship/serialization
capabilities still need their separate descriptions and checks under A6-12/13.

### Insert result capabilities

`api.knex.capabilities.insertResult` describes the SQL insert result used by the
library: `insert-id` for MySQL, `rows` for the tested PostgreSQL/SQLite paths, and
`driver-defined` for other clients. This is separate from the public API's
`returning: none|minimal|full` response option. It does not promise SQL RETURNING
support on untested historical SQLite versions or unknown drivers.

The existing capability module's `applyInsertReturning` is the only runtime
caller of Knex `.returning()`. Ordinary data writes, canonical data writes and
canonical registry inserts use it. MySQL keeps the insert query without requesting
an ignored RETURNING clause; other clients retain their existing query form.
Logical/physical ID extraction, explicit-ID fallback, SQLite wide-integer
expressions and driver read options remain at their existing responsible callers.
The helper neither executes the builder nor changes transaction ownership.

### Temporal conversion capabilities

The existing converter consumes `getTemporalStorageCapabilities(client,
{ textStorage })`. Startup publishes the native and text variants under
`api.knex.capabilities.temporal`. These describe built-in write conversion, not
the maximum precision a custom serializer or database column can represent.

| Built-in boundary | PostgreSQL | MySQL | SQLite |
| --- | --- | --- | --- |
| Native date minimum year | 0 | 1000 | 0 |
| Text date minimum year | 0 | 0 | 0 |
| dateTime minimum year | 0 | 1000 | 0 |
| Maximum public year | 9999 | 9999 | 9999 |
| dateTime fractional digits | 3 | 3 | 3 |
| Native time fractional digits | 6 | 6 | No added SQL cap |
| Text time fractional digits | No added SQL cap | No added SQL cap | No added SQL cap |

`timeFractionDigits: null` means this converter adds no SQL precision cap; field
schema validation and normalization still apply. The text flag changes date/time
storage, not the built-in dateTime conversion. In canonical storage the actual
slot selects that flag: date and time use string slots, while dateTime uses a
date slot. Custom serializers continue to own their stored representation.

Year, submillisecond and native-time guards now read these limits while retaining
their existing errors. UTC conversion, PostgreSQL year-zero spelling, MySQL wire
format and precision-preserving reads remain in the original converter. No new
serialization pass or per-field capability cache was introduced.

### Relationship and serialization capabilities

Both initialized storage modes publish the same frozen built-in feature
descriptions. `relationships.attributeKinds` lists `belongsTo` and
`belongsToPolymorphic`; `relationships.declaredCardinalities` maps `hasOne` to
`one` and `hasMany`/`manyToMany` to `many`. The existing relationship cardinality
helper consumes these definitions, preserving attribute precedence and returning
null for unknown kinds. Scope validation still checks each declaration's target,
keys, pivot configuration and permitted polymorphic types. Capability metadata
does not grant access to a target or bypass row policies. Version-dependent
include windows continue to use the separate `windowFunctions` flag.

`serialization` describes synchronous custom serializer results, built-in JSON
encoding for object/array values, and rejection of built-in whole-document
predicates. The converter and scalar-query validator share the frozen structured
type list. The existing storage serializer still rejects thenables and retains
its field/context metadata; custom serializers own their encoding, and custom
`applyFilter` callbacks own their JSON predicates. These are descriptive rules,
not configurable feature switches. Nested arrays/maps are frozen to prevent one
consumer from altering the shared rules for another initialized API.

## Capability description acceptance review (A6-12)

The internal description now covers all requested areas through existing owners:
version-dependent include windows, SQL insert results, field-alteration ownership
and native sets, temporal native/text write limits, supported relationship forms,
and built-in/custom serialization boundaries. It deliberately does not claim that
an unrecognized driver, an old untested engine version or an arbitrary resource
declaration is supported merely because a fallback path exists.

The evidence combines direct metadata/query-form checks, actual installed-plugin
version observations and current conformance, plus native schema, identity and
temporal selections recorded for each preceding capability slice. The final
combined full gate passed 11,229 checks with one existing skip, and the native
relationship/serialization selection passed 730 checks. All 271 source hashes
matched the tested snapshot, completing A6-12. Required-operation preflight and capability enforcement
remain a distinct audit under A6-13. This description does not close consumer
migration, public declarations, query-proxy migration or authorization requirements.

### Native temporal-column preflight

`schema.temporalColumnFractionDigits` describes the native PostgreSQL/MySQL
column maximum (6); it is distinct from the built-in dateTime write converter's
millisecond limit. SQLite/unknown dialects add no native column cap through this
helper. The shared table-schema preparation validates time/dateTime precision
shape for all targets, applies the known native maximum, and requires an explicit
migration dialect above precision 6. A diff resolves its target from options or
the introspected snapshot before validating.

Runtime create/add/alter pass the detected client into preparation after caller
options, so an override cannot bypass a native limit. Invalid definitions reject
before SQL, preserving rows and schema; native zero-precision columns still work.
The generator does not emit migration code for unsupported declarations. These
checks do not narrow canonical string-slot precision or custom serializer values.

### Capability preflight acceptance review (A6-13)

| Required capability | Guard and evidence |
| --- | --- |
| Per-parent include windows | The shared include builder rejects an unavailable flag before window SQL. Ordinary GET now forwards the API dependency, as collection reads already did; failed full-write response preparation rolls back, while none/minimal writes avoid that response query. |
| Native temporal column precision | Shared schema preparation validates shapes and the actual/resolved dialect before SQL or code emission. Tests assert no SQL, unchanged schema/rows, zero-precision acceptance and resistance to a misleading runtime dialect option. |
| Native SET columns | Runtime create/add/alter validate the complete schema before SQL. Code generation requires a declared MySQL target. Cross-dialect diffs retain warnings and omit unsupported SET operations. |
| Schema alteration ownership | MySQL rejects caller-owned alterations; SQLite checks the foreign-key prerequisite; PostgreSQL uses its owner/savepoint path. Enum and constraint alterations retain their existing data/schema snapshots and failure checks. |
| Insert results | All three insert sites choose the existing MySQL insert-ID form without an ignored RETURNING request. Native generated/explicit/mapped/wide-ID and registry checks preserve identity behavior. |
| Temporal value ranges and precision | Built-in conversion checks submillisecond dateTime values, native-time precision and date ranges before data writes/comparisons; schema and custom serializer rules remain distinct. |
| Structured predicates and serializers | Scalar-query validation rejects whole-document comparisons/sorts; compilation rejects unsupported declarations. Synchronous-result validation rejects thenables before writes/filter execution; persistence checks retain the original data. |
| Canonical field capacity | All six finite slot pools reject exhaustion. Registration, replacement and field allocation preserve persisted metadata and cached/fresh descriptors after rejection; registration uses transaction rollback for its metadata preparation. |
| Relationship forms | Scope/request validation checks target declarations, keys and cardinality; polymorphic linkage checks declared types. Capability metadata cannot substitute for resource-specific checks or authorization. |

This is preflight for required supported operations, not a promise that all
data-dependent database failures can be predicted before SQL. MySQL migration
DDL is explicitly nontransactional, and warning-only diff omissions are not
claimed as applied desired changes. Unknown custom drivers and raw extension SQL
remain outside the verified backend matrix.

The native selections for each capability slice and the combined Node 24 gate
supply the evidence. The final SET selection passed 414 native checks; the
additional canonical-capacity suite passed 18 SQLite and 72 native checks. The
combined Node 24 gate passed 11,307 tests with one existing skip, types, both
query budgets, lint and documentation. All 273 snapshotted source files match;
the capacity test was added afterwards and verified separately. A6-13 is complete.
The separate dependency logging/error-preservation limitation stays under A7.

## Query requirement objects: A6-04 acceptance audit

The current core already passes small query descriptions between the modules
that own the relevant decisions:

| Description | Shared decision and consumers |
| --- | --- |
| Field selection | `buildFieldSelection` returns stored/projected fields, requested fields and output-only dependency metadata. `applyFieldSelectionToQuery` consumes it in both plugins and supplies the current query plus projection runtimes. It does not copy an entire resource or own transactions. |
| Sort descriptor | Logical field, direction, resolved column or projection runtime, field definition and relationship/result metadata are consumed by shared cursor validation and predicate helpers. Physical resolution remains storage-specific. The shared ordering helper also consumes this shape for direction reversal and null placement. |
| Cursor predicate chain | `buildCursorPredicateChains` creates comparison groups from those descriptors, tie-break values and traversal direction. Both storage modes use the same null/tie rules. |
| Mandatory membership | The symbol-keyed constraint carries the target resource, logical equality values and an optional unexecuted ID query. Shared application keeps it independent from public searchable fields and intersects it with the existing query. |
| Pagination input/result | `applyPaginationToQuery` receives the existing query, page request, sort descriptors and adapter, then returns the mode/size/cursor state used by response assembly. Physical count-query construction stays with each plugin. |

The sort-order follow-up removes the remaining repeated direction/null-choice
branch while preserving the existing builders and their physical decisions. The
exact draft source that passed 968 native cases is now applied after the previous
full gate passed 11,349 tests. Normal-import SQLite checks pass 483 tests, with
types, both query budgets and lint passing. All 275 source hashes reconcile,
including exact equality with the three native-tested modules. A6-04 is complete. Wider storage
typing, proxy usage, physical scope isolation and consumer examples remain
separate A6 acceptance items; no general query-plan framework is proposed.

The ordering review confirms that both callers supply `asc` or `desc` from
`parseSortEntry`. The helper reverses exactly those directions for a before
cursor, chooses the same first/last null placement, and calls the unchanged
column/projection dialect helpers. It does not change logical-field resolution,
visibility queries, emitted descriptor metadata, fallback handling or response
assembly. A mutation removing reversal fails both selected backward projection
cases. The full 11,349-test result predates this separately verified sort change;
it is not presented as a full run of the subsequent source.

## Scope and policy preservation: A6-11 acceptance audit

The audit follows the library's generated queries and its documented filtering
hook contract through each required query shape:

| Query shape | Constraint owner and verified behavior |
| --- | --- |
| Base reads and replacements | Canonical adapter builders add both tenant and resource predicates; ordinary builders identify their physical table. Replacement hooks clone the supplied builder. `conformance-query-visibility.test.js` now leaves foreign-tenant and foreign-resource rows with overlapping logical IDs present across its page, count, include and transaction cases. A control checks those rows really exist. |
| Joins and nested search | Canonical join clauses bind tenant/resource in their ON conditions. Shared search builds scoped, permission-filtered target queries; nested and polymorphic paths reuse them. `conformance-search-authorization.test.js` separately varies row policy and workspace visibility. Added cases insert visible foreign-scope groups/teams inside a borrowed transaction: direct, nested and polymorphic filters must exclude their labels and count zero while legitimate target labels still match once. |
| Includes and linkage | Include loading applies the target query permission and row-policy/filter lifecycle before per-parent limits. Replacement-visibility cases verify selected parent linkage and included IDs in JSON:API/plain formats; existing include-adapter cases exercise cold/warm adapters, mapped columns and both relationship directions. |
| Counts | Ordinary collections apply mandatory membership and run filtering for the separate count builder. Canonical collections clone the filtered builder before clearing selections/order. Offset/count assertions in the replacement and search suites must agree with visible rows, including when client filters are absent. |
| Cursor predicates and ordering | `applyCursorPredicate` wraps its OR chains in a WHERE group. Scoped/filter predicates therefore remain conjunctive. Replacement tests traverse forward and backward with overlapping foreign IDs present; reference-sort tests cover hidden/null ties, self references, joined filters and caller-specific visibility. |
| Request/transaction state | Nested filtering restores its enclosing context after success or failure. Tests reuse a context with changed visibility and query uncommitted rows through a borrowed transaction without completing or caching its outcome. |

Custom filtering hooks are trusted query code: the existing migration guide
requires a replacement to clone the supplied query and retain its tenant/resource,
membership and visibility predicates, with compound conditions grouped. This
audit does not claim to repair a hook that deliberately clears constraints or
substitutes unrelated raw SQL. Wider proxy-method compatibility and raw-query
consumer migration remain A6-09/A6-10/A6-16 work.

The new overlap checks require no runtime change. The replacement selection
passes 37 SQLite and 74 native tests; the search selection passes 192 SQLite
and 384 native tests on Node 24. The search file includes a deliberately ordinary
collation case in each runner mode; all native cases use the selected database.
The previous sort checkpoint adds 968 native pagination/reference/temporal checks.
All four native runners exited zero and removed their servers/directories.
Source reconciliation confirms that only the two test files changed after the
verified sort checkpoint; the runtime is unchanged. A6-11 is complete.

## Canonical query proxy usage: A6-09/A6-10 investigation

Historical investigation before the removal documented in the following section.
At that checkpoint, the library constructed `AnyapiQueryAdapter` in two places: canonical
`helpers.dataQuery` and `helpers.dataQueryCount`. Each uses its query builder and
table alias; the wrapper is also exposed in filtering context. Searches found no
external-to-the-class callers of `registerAlias`, `translateColumns` or the
`__adapter__` marker in this repository's runtime, examples or tests. This is an
internal inventory, not a fresh inventory of the paused consumer repositories.

The proxy intercepts join, predicate, select, grouping, order and aggregate
methods. The shared query helpers already translate fields through storage
adapters in most paths. Source review also shows why retaining this broad
emulation deserves justification: clone results are returned as native builders,
and automatic join-scope predicates are added only in the callback join branch.
Those observations are not evidence that unsupported custom SQL is protected.

A Node 24 loader experiment replaced only `this.proxy =
this.#createProxy(this.builder)` with the already scoped native builder. No
worktree runtime file was changed. The combined canonical query-visibility,
search-authorization, reference-sort, query and pagination selection passed
285/287 tests. Both failures were `customRank` in the query fixture, whose
`applyFilter(query, value)` uses the logical string `rank` directly; ordinary
storage has that column, canonical storage does not. All the other selected
paths worked with the native builder. This is a bounded dependency result, not
proof that the proxy can already be deleted from the whole library.

Next, give custom filter code an explicit way to resolve physical fields, migrate
actual in-repository callers, and expand verification before removing proxy
interception. Reuse the existing storage/column helpers. Do not add more Knex
method emulation merely to retain this implicit translation. The migration guide
must explain the resulting query-hook/custom-filter contract; downstream source
changes remain paused. A6-09/A6-10 stay open.

## Applied native-builder migration: verification in progress

The experiment's remaining `customRank` dependency now uses the new third
`applyFilter` argument: `{ column, value, context, scopeName }`. Local and declared
joined-path callbacks use the existing mapping/serialization helpers. Both
fixture callbacks that previously relied on logical column names were migrated;
other in-repository callback searches found explicit adapter translation already
in use. The guide now uses identifier bindings with translated columns.

The 655-line query-proxy module was removed. The two canonical query/count
construction sites use the existing storage adapter's aliased base-query option.
Sort and count expressions keep their established alias, mandatory scoping and
transaction handle. There is no replacement Knex-method emulation or shim.

The migration guide documents native builders, the new callback details,
qualified aliases, value serialization, callback ownership, and removal of the
old proxy metadata/internal import. Full verification passes 11,360 tests with one existing skip; 1,250 native
checks, strict types, query budgets, lint and documentation pass. All 275 source
hashes match and the removed proxy is absent. A6-09/A6-10 remain open, including actual external-hook migration.

### Retained native method use

| Actual caller | Methods whose behavior remains native |
| --- | --- |
| Shared filtering/search | Grouped `where`/`orWhere` callbacks, physical-column comparisons, subquery joins in callback and column-pair forms, aliased targets, raw SQL with bindings, and `distinct` for multiplicative relationships |
| Field selection and projections | `select` arrays/alias maps and raw projection expressions; storage helpers supply physical identifiers |
| Collection pagination and totals | `clone`, selection/order clearing, `countDistinct`, ordering, limits/offsets and grouped cursor comparisons |
| Existing extension fixtures | The migrated rank/availability filters use callback translation; structured JSON filters and socket title filters already use explicit storage conversion. Replacement-query hooks clone the original builder and retain its predicates. |

This inventory does not retain the old proxy's claim to rewrite arbitrary Knex
method arguments. Method names are now Knex's own surface; source helpers resolve
the logical resource fields they need. Whole-codebase verification passes at the recorded checkpoint,
and the paused external consumers still require their own query-hook inventory
and port before A6-09/A6-10/A6-16 can be considered fully reconciled.

## Physical storage ownership: A6-06 acceptance audit

The responsible storage implementation consists of the installed Knex plugin,
its existing storage adapter/mapping helpers, and shared SQL helpers. This audit
does not require moving every SQL operation into a single adapter class.

| Physical concern | Owner and caller boundary |
| --- | --- |
| Ordinary column names and logical IDs | `storage-mapping.js` and `storage-adapter.js` resolve configured columns and identifier fields. Resource methods pass logical fields; field-selection/filter/relationship SQL consumes the translated identifiers. |
| Canonical slots and backing fields | `canonical-storage-mapping.js`, the canonical adapter, registry and descriptor helpers own slots, logical/internal ID distinctions and relationship storage. The descriptor helper is imported only by the canonical Knex plugin. |
| Tenant/resource predicates | The canonical adapter's base builder owns record scoping, including qualified predicates when an alias is supplied. Canonical link/registry SQL remains in its backend implementation. The removed query proxy no longer duplicates record scope construction. |
| Dialect SQL | Shared Knex helpers own native null ordering, projection expressions, identifier-list SQL and database identity expressions. Resource-operation methods do not branch on database client or build those expressions. Keeping these functions shared avoids reproducing them in both storage modes. |
| Driver values and insert results | Storage serializers and `database-value-normalizers.js` own driver/value conversion. `database-capabilities.js` chooses insert-result query forms; backend write helpers retain driver-specific identity extraction. Resource lifecycle code receives logical results and transaction outcomes. |
| Extension boundary | Filter/hook code receives the storage adapter or explicit column/value helpers plus the native builder. Ordinary/canonical naming is resolved before passing identifiers to Knex; raw user SQL is not guessed or rewritten. |

Source inspection found no slot, canonical record-table, tenant-column or raw-SQL
construction in `rest-api-plugin-methods`. Outside canonical/storage modules,
the shared library helpers contain no canonical slot or tenant-table literals.
The actual resource-method/helper call inventory above remains the basis of the
boundary; search results alone do not establish equivalence.

Direct storage checks execute quoted aliases, mapped identifiers, scalar/array/
null conversion, scoped queries and borrowed transactions. The native-builder
selection additionally exercises related visibility, joins, projections, counts
and cursor behavior on all three databases. It passes 625 initial SQLite and
1,250 final native tests. The full Node 24 gate passes **11,360 tests with one
existing skip**, strict types, both query budgets, lint and documentation. All
275 source hashes match and the deleted proxy remains absent. A6-06 is complete.
A6-09/A6-10's external-hook migration and A6-16's consumer examples stay separate.

## Shared query decisions: A6-08 acceptance review

The selected query contract is implemented by the existing shared helpers and
consumed directly by both storage plugins. This review closes the consolidation
work represented by A6-08; broader storage typing, further duplication reviews
and external query-hook migration remain their own checklist items.

| Decision or result | Implementation and acceptance evidence |
| --- | --- |
| Selected fields and projections | Both plugins call `buildFieldSelection` and `applyFieldSelectionToQuery`. Query conformance asserts sparse projections, retained internal dependencies and absence of dependency fields in public responses. |
| Membership and resource visibility | Both query paths apply `applyQueryConstraint`; related queries retain that constraint independently of public filters. Scope/search/replacement suites check permissions, hidden targets, nested queries, overlapping foreign IDs and borrowed transaction visibility. |
| Ordering and cursors | Both sort builders use `buildEffectiveSortList`, `resolveSortField` and `applySortDescriptorOrder`; shared cursor validation/predicate chains own tie/null traversal. Tests follow forward/backward pages and round-trip links with sparse projections, joined filters and visible references. |
| Pagination limits and counts | Both plugins call `applyPaginationToQuery`. Tests check default/capped sizes, enabled/disabled counts, distinct parent counts, related membership totals, empty pages and count-query budgets. Physical count assembly remains explicit in each backend. |
| Links and metadata | Query tests parse generated links and execute subsequent offset/cursor pages; count/hasMore assertions agree with visible results. Both JSON:API and plain formats are exercised. |
| Typed failures | Pagination cases reject malformed cursor syntax and conflicting/invalid page options before SQL with validation errors. Query tests reject invalid projections/fields/includes, including empty results; target-permission suites retain the expected error classification. |

These are the existing `conformance-queries`, `conformance-pagination`,
`conformance-query-visibility`, `conformance-search-authorization`,
`conformance-reference-sorting`, `conformance-custom-filter-context` and direct
storage cases, not a new set of assertions that merely mirrors helper internals.
Their current native selection passed 1,250 tests. The full Node 24 gate passed
11,360 tests with one existing skip, plus strict types, query budgets, lint and
documentation. All 275 runtime/test/configuration source hashes still match that
verified checkpoint; no implementation changed for this acceptance review.

Driver collation behavior remains an explicit fixture/backend distinction. This
review does not claim byte-identical arbitrary SQL behavior across databases or
completion of the paused consumer ports. A6-08 is complete.

## Query-context duplication review

`withQueryFilteringContext` in the existing `query-builder-utils.js` now owns
one repeated operation: install query-hook state, await filtering, capture the
possibly replaced builder, and restore the enclosing state on success or failure.
Its six callers are ordinary collection/count/minimal reads, canonical
collection/minimal reads, and the core `applyQueryFilters` method. The helper
returns `{ query }`; returning a native thenable builder from an async function
would execute it before the caller applies its remaining selection or limits.
It retains the original builder when a hook clears the temporary query/state.

Backend filter ordering remains explicit at the call sites. Canonical paths
still run built-in filters before extension hooks. The core method still checks
include/relationship/search permissions before filtering and restores its
separate temporary storage adapter. Ordinary offset counts still rerun filters;
canonical collection counts still clone the filtered query. This change does
not merge those count strategies or change transaction ownership.

The remaining duplication review distinguishes different responsibilities:

| Area | Current decision / follow-up |
| --- | --- |
| Adapter cache lookup in both plugins | Both now use `createStorageAdapterLookup` in the existing storage adapter module. The scope-name/schema-identity cache rule is unchanged; cold/warm includes and canonical field-addition refresh remain covered. Broader A5 configuration lifetime remains open. |
| Write attribute preparation | Ordinary storage merges belongs-to foreign keys; canonical storage assigns slots and physical ownership. Keep physical writes explicit; assess repeated ordinary POST/PUT/PATCH preparation separately. |
| Includes and relationship writes | Shared selection, permission, batching and mapping helpers already exist. Canonical edge tables and ordinary pivots/reverse child lifecycles have distinct execution requirements. |
| Sort and pagination | Shared descriptors, ordering and pagination rules are already reconciled under A6-04/A6-08. Physical reference-column construction remains backend-owned. |
| Query-context restoration | Six repeated sequences now use the same small helper, with nested/failing filters and unexecuted-builder checks. |

A6-15 remains open while the remaining candidates are assessed. External query
hook/example migration remains tracked separately under A6-09/A6-10/A6-16.

Before application, an isolated `createStorageAdapterLookup` draft passed two checks per storage mode
using the real conformance fixture's compiled resources. It retains the existing
scope-name/schema-identity cache rule, publishes fresh adapters, avoids caching
missing scopes, and isolates independent lookup instances. The draft and probe
are `/tmp/library-adapter-lookup-draft.mjs` and
`/tmp/library-adapter-lookup-probe.test.mjs`; logs use
`/tmp/library-adapter-lookup-probe-`. The draft has now been applied to both plugins in the existing storage adapter
module. Resource resolution stays at each plugin call site. The shared helper
owns lookup, construction and attachment; it caches neither missing resources
nor request/authorization state. Applied checks cover installed helper paths,
cache identity/isolation, and the existing include/field-addition suites.
Strict typing checks its resolver and nullable result. See the verification log
for final native results.

## Write preparation duplication review

Core POST/PUT/PATCH process relationships, validate attributes, merge the logical
foreign-key updates and run setters before calling the storage helper. Ordinary
PUT/PATCH additionally called `processBelongsToRelationships`, but it read the
obsolete `schemaInfo.schema` instead of the compiler's `schemaInstance` and
`schemaStructure`. Current compiled resources therefore produced no updates in
that second pass. The only two runtime callers and the unused internal module
have been removed. Both storage modes consume core-prepared attributes and retain
their existing physical mapping; no replacement conversion layer is introduced.

New shared tests cover async belongs-to setters returning null, callback count
and input, full stored rows and JSON:API/plain responses across POST, PUT-create,
PUT-update and PATCH. The corrected tests pass before removal as well as checking
the new implementation. Initial test failures came from using a JSON:API input
with plain format, incomplete PUT attributes, and expecting plain output to keep
a null relationship property; they were fixture/assertion mistakes, not defects.

Remaining small write similarities stay explicit: ordinary POST handles generated
or explicit physical IDs, PUT has create/update decisions, PATCH leaves omitted
fields alone, and canonical writes supply physical tenant/resource ownership and
logical-ID slots. Both use the existing row translators. Sharing these snippets
would conceal those differences without removing another duplicated algorithm.

## Remaining storage duplication: A6-15 acceptance

The operation inventory now has a concrete owner for each consolidated decision:

| Repeated behavior | Owner and evidence |
| --- | --- |
| Query selections, sort/cursor rules and pagination | Existing shared field/sort/pagination helpers; A6-04/A6-08 acceptance matrices. |
| Temporary filtering state | `withQueryFilteringContext`, used at six call sites; seven direct checks, full 11,374-pass gate and 554 selected native passes. |
| Adapter construction/cache attachment | `createStorageAdapterLookup`, used by both plugins; strict contracts, 111 applied SQLite and 222 native checks. |
| Logical relationship write preparation | Core relationship processing/attribute validation/setters; the obsolete ordinary second conversion is removed. Applied selection: 1,170 tests per mode, plus 120 per mode on each native database. |
| Physical SQL, IDs, ownership and relationship persistence | Existing backend, mapping and relationship helpers. Differences reviewed above stay explicit rather than becoming flags in a generic writer. |

The last applied write selection totals 2,340 SQLite and 480 native passes,
with no failures/skips; native runners exit zero and remove their servers.
The new setter cases pass on the pre-removal implementation too. This is a
verified removal of redundant work, not a claim to fix a setter defect.
Types, query budgets and lint pass. The full gate cited for query-context work
predates the later cache/write extractions; their selected evidence is listed
separately. A6-15 is complete. Wider compiled-metadata authority, public types,
external query hooks and consumer migrations remain under their own open items.

## Write-helper signatures

`storage-types.d.ts` now names the existing write-helper input and result
contracts, and both installed plugins annotate their five helper assignments.
These are internal declarations for callers; the large plugin implementation
bodies are not yet under `@ts-check`. The negative type fixture checks use of
these declarations, not proof that every implementation branch satisfies them.

| Helper | Core input | Ordinary result | Canonical result |
| --- | --- | --- | --- |
| `dataExists` | Logical ID, compiled schema and active DB | Boolean | Boolean |
| `dataPost` | Setter-transformed JSON:API-shaped input, compiled schema and active DB | Backend-dependent insert ID/result | Explicit/generated logical ID, or absent insert result |
| `dataPut` | Write input plus logical ID and explicit `isCreate` | `undefined` | Affected count, or 1 for create |
| `dataPatch` | Write input plus logical ID | `undefined` | Affected count, or 0 for empty attributes |
| `dataDelete` | Logical ID, compiled schema and active DB | `{ success: true }` | Affected count |

The shared POST declaration deliberately returns `unknown`: the implementations
extract driver results, with ordinary custom-ID/dialect fallbacks. A declaration
must not turn an unchecked driver result into a guaranteed string. Core assigns
POST's result to `context.id`; it ignores the PUT/PATCH/DELETE results. Existence
is used to choose the PUT branch, with authorization handled separately.

Both write contexts name the active DB handle supplied by core. Ordinary helpers
also have their existing instance fallback for dynamic callers. Attributes are
`Record<string, unknown>` because setters may produce storage-oriented values;
these are not asserted to be public JSON. Relationship processing and setters
precede the data call. Borrowed transaction completion still belongs to its
owner; these signatures add no runtime transaction layer.

The declarations preserve the observed result differences. Unifying them would
be a separate API decision and require direct helper/consumer review. The read-helper overloads are documented below; checked plugin bodies and
broader lifecycle coverage remain open.

## Read-helper signatures

Both plugins now declare `dataGetMinimal`, `dataGet` and `dataQuery` through
`storage-types.d.ts`. Minimal reads have two overloads: explicit `ids` (including
an empty array) returns an array of resources; an omitted `ids` requires a
context ID and returns one resource or null. They return resources directly,
not documents. The batch path can use filtering and mandatory membership while
remaining a bounded read owned by its caller.

Full reads return resource documents. Ordinary `dataGet` throws for an absent
row; canonical `dataGet` returns null. Collection reads return documents with
array data and optional included resources, links and metadata. Core supplies
query parameters and return-metadata state for collection helpers. Resource
attributes remain unknown-valued because final output normalization and response
processing still occur after these helpers. These declarations describe internal
storage results, not the public plain/JSON:API response union.

Filtering callbacks receive native query state. Their returned value stays
unknown because existing callers unwrap hook-supplied state dynamically; this
does not prove builder validity. The plugin bodies remain unchecked. The read
fixtures prove single/batch/document distinctions and required inputs at the
declared boundary; runtime conformance and fully checked implementations are
separate requirements.

### Capability observation diagnostics

Both storage plugin initializers pass their configured logger to the existing
capability detector. Version observation has one query/error boundary. Failed
queries and malformed version rows retain `version: 'unknown'` with an error
summary; version-dependent window checks return false without repeating the
query. Existing dialect-known window support (including PostgreSQL) does not
depend on a successful version query. This remains capability observation, not
a database connection health check.

The detector uses the shared bounded diagnostic formatter and emits
`operation: 'database-capabilities'`, `phase: 'version-observation'` and the
backend name. It no longer writes directly to the global console. A failing
diagnostic sink cannot replace the observation fallback. Arbitrary driver error
messages are not guaranteed to be secret-free; applications still control their
logging destinations and policies. No resource schema exists at this boundary
from which to derive attribute visibility.

## Storage-boundary declaration acceptance

A6-02 concerns the existing storage interfaces used by callers. The boundary
inventory is now represented by the following declarations and documentation;
checking every branch of the large plugin bodies remains A9 implementation work.
No generic replacement backend, query proxy or runtime type hierarchy is added.

| Boundary from the operation inventory | Declared contract and implementation owner |
| --- | --- |
| Physical naming, row/value conversion, scoped builders and selections | `StorageAdapter`, `StorageInfo`, `CanonicalDescriptor`, `StorageSchemaInfo` and selection types in `storage-types.d.ts`; adapter/mapping implementations are checked. |
| Filtering and mandatory membership | `QueryFilteringState`, checked filtering helpers and the existing constraint declaration describe builder/context replacement and resource membership. Native Knex owns joins, cloning, aggregation and SQL expressions. |
| Full/minimal reads and resource writes | `DataReadHelpers`, `DataMinimalReader`, `DataWriteHelpers` and stage-specific input shapes annotate both plugins' existing `helpers.data*` assignments; the read/write tables above retain backend result differences. |
| Deferred relationship membership query | `DataRelatedIdsQuery` requires the ordinary pivot's key names; `CanonicalDataRelatedIdsQuery` resolves its relationship by resource/name. Both return `{ query }`, preserving the unexecuted Knex builder across the async boundary. |
| Standalone canonical count | `DataQueryCount` returns a number and accepts the existing DB/transaction/filter context; it does not require an already supplied schema or manufacture a pagination document. The ordinary plugin has no standalone count helper. |
| Canonical link operations | `CanonicalLinkHelpers` annotates attach/sync/remove/list and parent-row fetching. Mutations return void, synchronization requires explicit update/create intent, and raw listed IDs remain nullable until validated. Parent fetches return normalized parent/child/type triples; they do not promise authorization unless the actual caller applies it. |
| Transaction creation/completion | Both `newTransaction` assignments reuse `TransactionFactory`; the checked transaction modules own completion, outcome and cleanup contracts. Adapters/link helpers borrow handles and do not become completion owners. |
| Backend-dependent operation forms | `DatabaseCapabilities`, schema/temporal interfaces and checked capability helpers describe version observations, returning modes, alteration ownership and nullable precision. Driver-result validation remains a runtime responsibility. |

Relationships and includes compose the scoped builder, field/value mapping,
filtering and data contracts above. Their method-specific traversal, target
permissions, child writes and batching remain visible in existing functions.
This declaration acceptance does not imply that arbitrary relationship/plugin
bodies are statically verified, nor does it close the separate consumer query-hook
migration under A6-09/A6-10/A6-16.

The new direct boundary test awaits the installed relationship helper, observes
zero executed statements, constrains a cloned builder to an empty result, and
then executes the original builder to obtain the complete membership. This
protects the wrapper against accidentally awaiting its thenable query too early.
The source inventory confirms annotations on all 10 ordinary and 11 canonical
data/transaction helper assignments. Eight negative compiler fixtures check deferred-query versus array results,
pivot key/parent-ID requirements, numeric counts, explicit synchronization mode,
void mutation results, nullable raw IDs and required parent lists. The broader
adapter, read/write, filtering, ownership and capability fixtures remain in the
same required typecheck gate.
